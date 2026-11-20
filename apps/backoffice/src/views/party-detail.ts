/**
 * <pv-party-detail>: a party (ADR 0026, 0028). Its details, numbers (personal
 * numbers masked) and policies beside what may be done: change the details
 * with a reason, add a number, and ask for erasure. History as an event log.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import '../components/data-grid.ts';
import '../components/event-log.ts';
import type { Column } from '../components/data-grid.ts';
import type { LogEntry } from '../components/event-log.ts';
import { partyFields } from '../components/party-fields.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate, formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { changeBody, displayName, partyProblems, partyToForm, type IdentifierForm, type PartyForm } from '../party-logic.ts';
import type { Me } from '../permissions.ts';
import { versionOn } from '../policy-logic.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { groupKindLabel, policyStatusLabel, problemLabel } from './labels.ts';

type Party = components['schemas']['PartyRecord'];
type Policy = components['schemas']['PolicyRecord'];
type Revision = components['schemas']['Party'];
type Animal = components['schemas']['AnimalRecord'];
type Group = components['schemas']['PolicyGroup'];

const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-party-detail')
export class PartyDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'party-id' }) partyId = '';
  @state() private party: Party | null = null;
  @state() private policies: Policy[] = [];
  @state() private revisions: Revision[] = [];
  @state() private animals: Animal[] = [];
  @state() private groups: Group[] = [];
  @state() private newGroup = { kind: 'household' as 'household' | 'litter', litterId: '' };
  @state() private problem: Problem | null = null;
  @state() private editing: PartyForm | null = null;
  @state() private reason = '';
  @state() private identifier: IdentifierForm = { type: 'personal-number', country: 'SE', value: '' };
  @state() private erasureReason = '';
  @state() private shown: string[] = [];
  @state() private notice: Notice | null = null;
  @state() private busy = '';
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
      .crumbs {
        display: flex;
        gap: var(--space-2);
        font-size: 13px;
        color: var(--text-muted);
      }
      .crumbs a {
        color: var(--text-secondary);
      }
      .title {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-3);
        margin: var(--space-2) 0 var(--space-8);
      }
      h1 {
        margin: 0;
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
      }
      .cols {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-6);
      }
      .basis {
        flex: 999 1 520px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      .side {
        flex: 1 1 340px;
        max-width: 420px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-4);
      }
      .row > * {
        flex: 1 1 160px;
      }
      .pv-card__body p {
        margin: 0;
      }
      .pv-dl__row dd {
        overflow-wrap: anywhere;
      }
      @media (max-width: 900px) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('partyId') || changed.has('api')) void this.load();
  }

  private async load() {
    this.problem = null;
    const path = { params: { path: { partyId: this.partyId } } };
    try {
      const [party, revisions, policies, animals, groups] = await Promise.all([
        unwrap(this.api.GET('/v1/parties/{partyId}', path)),
        unwrap(this.api.GET('/v1/parties/{partyId}/revisions', path)),
        // Only for whoever may read policies; otherwise the card is not shown.
        this.may('policies:read')
          ? this.api.GET('/v1/policies', { params: { query: { policyholderPartyId: this.partyId } } }).then((r) => r.data?.items ?? [], () => [])
          : Promise.resolve([]),
        this.may('animals:read')
          ? this.api.GET('/v1/animals', { params: { query: { ownerPartyId: this.partyId } } }).then((r) => r.data?.items ?? [], () => [])
          : Promise.resolve([]),
        this.may('policies:read')
          ? this.api.GET('/v1/policy-groups', { params: { query: { policyholderPartyId: this.partyId } } }).then((r) => r.data?.items ?? [], () => [])
          : Promise.resolve([]),
      ]);
      this.animals = animals;
      this.groups = groups;
      this.party = party;
      this.revisions = revisions.items;
      this.policies = policies;
      this.identifier = { ...this.identifier, country: party.market };
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  private may(p: string): boolean {
    return !!this.me?.permissions.includes(p);
  }

  render() {
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/parties" @click=${(e: Event) => (e.preventDefault(), navigate('/parties'))}>${msg('Parties', { id: 'nav.parties' })}</a>
      <span aria-hidden="true">/</span><span aria-current="page">${this.partyId}</span>
    </nav>`;
    if (this.problem) return html`${crumbs}<wa-callout variant="neutral">${msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' })}</wa-callout>`;
    const p = this.party;
    if (!p) return html`${crumbs}<wa-spinner></wa-spinner>`;
    const writable = this.may('parties:write') && !p.anonymized;
    return html`
      ${crumbs}
      <div class="title">
        <h1>${displayName(p) || p.id}</h1>
        <span class="pv-badge pv-badge--id">${p.id}</span>
        <span class="pv-badge">${p.kind === 'person' ? msg('Person', { id: 'party.person' }) : msg('Organization', { id: 'party.organization' })} · ${p.market}</span>
        ${p.anonymized ? html`<span class="pv-badge pv-badge--solid">${msg('Anonymized', { id: 'party.anonymized' })}</span>` : nothing}
        ${p.restrictedUntil ? html`<span class="pv-badge pv-badge--pending">${msg('Restricted until', { id: 'party.restricted' })} ${p.restrictedUntil}</span>` : nothing}
      </div>
      ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>${this.notice.text}</wa-callout>` : nothing}
      <div class="cols">
        <div class="basis">
          ${this.detailsCard(p)} ${this.identifiersCard(p, writable)}
          ${this.may('animals:read') ? this.animalsCard() : nothing}
          ${this.may('policies:read')
            ? html`<section class="pv-card" aria-labelledby="policies">
            <div class="pv-card__head">
              <h2 class="pv-card__title" id="policies">${msg('Policies as policyholder', { id: 'party.policies' })}</h2>
              ${this.may('policies:write') && !p.anonymized
                ? html`<wa-button size="small" appearance="outlined" @click=${() => navigate(`/policies/new?holder=${encodeURIComponent(this.partyId)}`)}
                    >${msg('Issue a policy', { id: 'policy.issue' })}</wa-button
                  >`
                : nothing}
            </div>
            <pv-data-grid
              .columns=${this.policyColumns()}
              .rows=${this.policies}
              label=${msg('Policies as policyholder', { id: 'party.policies' })}
              empty-text=${msg('No policies.', { id: 'party.noPolicies' })}
              @pv-row-activate=${(e: CustomEvent<{ row: Policy }>) => navigate(`/policies/${encodeURIComponent(e.detail.row.id)}`)}
            ></pv-data-grid>
          </section>`
            : nothing}
        </div>
        <div class="side">
          ${this.may('policies:read') ? this.groupsCard(p) : nothing}
          ${writable ? this.changeCard(p) : nothing} ${this.may('parties:privacy') && !p.anonymized ? this.erasureCard() : nothing}
          <pv-event-log heading=${msg('History', { id: 'claim.history' })} .entries=${this.history()}></pv-event-log>
        </div>
      </div>
    `;
  }

  /** Litter and household groups the party holds (ADR 0007), and a form for a new one. */
  private groupsCard(p: Party) {
    const writable = this.may('policies:write') && !p.anonymized;
    return html`<section class="pv-card" aria-labelledby="groups">
      <div class="pv-card__head"><h2 class="pv-card__title" id="groups">${msg('Groups', { id: 'group.groups' })}</h2></div>
      <div class="pv-card__body">
        ${this.groups.length
          ? html`<dl class="pv-dl">
              ${this.groups.map(
                (g) => html`<div class="pv-dl__row">
                  <dt>${groupKindLabel(g.kind)} · ${g.members.filter((m) => !m.to).length} ${msg('members', { id: 'group.membersLower' })}</dt>
                  <dd><a href=${`/groups/${g.id}`} class="pv-mono" @click=${(e: Event) => (e.preventDefault(), navigate(`/groups/${encodeURIComponent(g.id)}`))}>${g.id}</a></dd>
                </div>`,
              )}
            </dl>`
          : html`<p>${msg('No groups.', { id: 'group.none' })}</p>`}
        ${writable
          ? html`<form class="row" @submit=${this.createGroup}>
              <wa-select label=${msg('New group', { id: 'group.new' })} value=${this.newGroup.kind} @change=${(e: Event) => (this.newGroup = { ...this.newGroup, kind: (e.target as HTMLSelectElement).value as 'household' | 'litter' })}>
                <wa-option value="household">${groupKindLabel('household')}</wa-option>
                <wa-option value="litter">${groupKindLabel('litter')}</wa-option>
              </wa-select>
              ${this.newGroup.kind === 'litter'
                ? html`<wa-input label=${msg('Litter id', { id: 'group.litterId' })} .value=${this.newGroup.litterId} @input=${(e: Event) => (this.newGroup = { ...this.newGroup, litterId: (e.target as HTMLInputElement).value })}></wa-input>`
                : nothing}
              <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'group'}>${msg('Create the group', { id: 'group.create' })}</wa-button>
            </form>`
          : nothing}
      </div>
    </section>`;
  }

  private async createGroup(e: Event) {
    e.preventDefault();
    const g = this.newGroup;
    if (g.kind === 'litter' && !/^lit_[A-Za-z0-9]+$/.test(g.litterId.trim())) {
      this.notice = { variant: 'danger', text: problemLabel('group.needLitter') };
      return;
    }
    this.busy = 'group';
    let created: { id: string } | undefined;
    const { ok, notice } = await act(
      async () => {
        const r = await this.api.POST('/v1/policy-groups', {
          params: { header: { 'Idempotency-Key': this.keys.for(`group:${g.kind}:${g.litterId}`) } },
          body: { market: this.party!.market, kind: g.kind, holderPartyId: this.partyId, ...(g.kind === 'litter' ? { litterId: g.litterId.trim() } : {}) },
        });
        created = r.data;
        return r;
      },
      () => ({ variant: 'success', text: msg('The group is created.', { id: 'group.created' }) }),
    );
    this.busy = '';
    this.notice = notice;
    if (ok && created) navigate(`/groups/${encodeURIComponent(created.id)}`);
  }

  private animalsCard() {
    return html`<section class="pv-card" aria-labelledby="animals">
      <div class="pv-card__head">
        <h2 class="pv-card__title" id="animals">${msg('Animals owned today', { id: 'party.animals' })}</h2>
        ${this.may('animals:write') && !this.party?.anonymized
          ? html`<wa-button size="small" appearance="outlined" @click=${() => navigate(`/animals/new?owner=${encodeURIComponent(this.partyId)}`)}
              >${msg('Register an animal', { id: 'animal.register' })}</wa-button
            >`
          : nothing}
      </div>
      <pv-data-grid
        .columns=${[
          { key: 'name', header: msg('Name', { id: 'party.name' }), value: (a: Animal) => a.name },
          { key: 'id', header: msg('Animal id', { id: 'animal.id' }), value: (a: Animal) => a.id },
          { key: 'born', header: msg('Date of birth', { id: 'party.birthDate' }), value: (a: Animal) => formatDate(a.birthDate, getLocale()) },
        ]}
        .rows=${this.animals}
        label=${msg('Animals owned today', { id: 'party.animals' })}
        empty-text=${msg('No animals.', { id: 'party.noAnimals' })}
        @pv-row-activate=${(e: CustomEvent<{ row: Animal }>) => navigate(`/animals/${encodeURIComponent(e.detail.row.id)}`)}
      ></pv-data-grid>
    </section>`;
  }

  private detailsCard(p: Party) {
    const lang = getLocale();
    const row = (label: string, value: unknown) => (value ? html`<div class="pv-dl__row"><dt>${label}</dt><dd>${value}</dd></div>` : nothing);
    const a = p.address;
    return html`<section class="pv-card" aria-labelledby="details">
      <div class="pv-card__head">
        <h2 class="pv-card__title" id="details">${msg('Details', { id: 'claim.facts' })}</h2>
        <span class="pv-card__meta">${msg('revision', { id: 'party.revision' })} ${p.revision} · ${p.changedBy}, ${formatDateTime(p.changedAt, lang)}</span>
      </div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${row(msg('Date of birth', { id: 'party.birthDate' }), p.birthDate ? formatDate(p.birthDate, lang) : '')} ${row(msg('Email', { id: 'party.email' }), p.email)}
          ${row(msg('Phone', { id: 'party.phone' }), p.phone)} ${row(msg('Address', { id: 'party.address' }), a ? `${a.street}, ${a.postalCode} ${a.city}, ${a.country}` : '')}
          ${row(msg('Language', { id: 'nav.language' }), p.language)}
        </dl>
      </div>
    </section>`;
  }

  private identifiersCard(p: Party, writable: boolean) {
    return html`<section class="pv-card" aria-labelledby="ids">
      <div class="pv-card__head"><h2 class="pv-card__title" id="ids">${msg('Numbers', { id: 'party.numbers' })}</h2></div>
      <div class="pv-card__body">
        ${p.identifiers.length
          ? html`<dl class="pv-dl">
              ${p.identifiers.map(
                (i) => html`<div class="pv-dl__row">
                  <dt>${i.type === 'personal-number' ? msg('Personal number', { id: 'party.personalNumber' }) : msg('Organization number', { id: 'party.orgNumber' })}, ${i.country}</dt>
                  <dd class="pv-mono">${i.value}</dd>
                </div>`,
              )}
            </dl>`
          : html`<p>${msg('No numbers.', { id: 'party.noNumbers' })}</p>`}
        ${writable
          ? html`<form class="row" @submit=${this.addIdentifier}>
              <wa-select label=${msg('Number', { id: 'party.number' })} value=${this.identifier.type} @change=${(e: Event) => (this.identifier = { ...this.identifier, type: (e.target as HTMLSelectElement).value as IdentifierForm['type'] })}>
                <wa-option value="personal-number">${msg('Personal number', { id: 'party.personalNumber' })}</wa-option>
                <wa-option value="organization-number">${msg('Organization number', { id: 'party.orgNumber' })}</wa-option>
              </wa-select>
              <wa-input label=${msg('Value', { id: 'party.value' })} autocomplete="off" .value=${this.identifier.value} @input=${(e: Event) => (this.identifier = { ...this.identifier, value: (e.target as HTMLInputElement).value })}></wa-input>
              <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'identifier'}>${msg('Add the number', { id: 'party.addNumber' })}</wa-button>
            </form>`
          : nothing}
      </div>
    </section>`;
  }

  private changeCard(p: Party) {
    if (!this.editing) {
      return html`<section class="pv-card" aria-labelledby="change">
        <div class="pv-card__head"><h2 class="pv-card__title" id="change">${msg('Change the details', { id: 'party.change' })}</h2></div>
        <div class="pv-card__body">
          <p>${msg('Every change is a new revision with who, when and why.', { id: 'party.changeHow' })}</p>
          <wa-button appearance="outlined" @click=${() => (this.editing = partyToForm(p as never))}>${msg('Change the details', { id: 'party.change' })}</wa-button>
        </div>
      </section>`;
    }
    const set = (patch: Partial<PartyForm>) => (this.editing = { ...this.editing!, ...patch });
    return html`<section class="pv-card pv-card--strong" aria-labelledby="change">
      <div class="pv-card__head"><h2 class="pv-card__title" id="change">${msg('Change the details', { id: 'party.change' })}</h2></div>
      <form class="pv-card__body" @submit=${this.change} novalidate>
        ${partyFields(this.editing, set, { fixed: true })}
        <wa-textarea label=${msg('Reason', { id: 'claim.reason' })} rows="2" .value=${this.reason} @input=${(e: Event) => (this.reason = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
        ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((x) => html`<div>${problemLabel(x)}</div>`)}</wa-callout>` : nothing}
        <div class="row">
          <wa-button type="submit" variant="brand" ?loading=${this.busy === 'change'}>${msg('Save the change', { id: 'party.save' })}</wa-button>
          <wa-button appearance="plain" @click=${() => ((this.editing = null), (this.shown = []))}>${msg('Cancel', { id: 'common.cancel' })}</wa-button>
        </div>
      </form>
    </section>`;
  }

  private erasureCard() {
    return html`<section class="pv-card" aria-labelledby="erase">
      <div class="pv-card__head"><h2 class="pv-card__title" id="erase">${msg('Ask for erasure', { id: 'party.erase' })}</h2></div>
      <form class="pv-card__body" @submit=${this.requestErasure}>
        <p>${msg('The person has asked to be erased. Another privacy officer approves or rejects the request.', { id: 'party.eraseHow' })}</p>
        <wa-textarea
          label=${msg('Reason, without personal data', { id: 'party.eraseReason' })}
          rows="2"
          .value=${this.erasureReason}
          @input=${(e: Event) => (this.erasureReason = (e.target as HTMLTextAreaElement).value)}
        ></wa-textarea>
        <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'erase'}>${msg('Ask for erasure', { id: 'party.erase' })}</wa-button>
      </form>
    </section>`;
  }

  private history(): LogEntry[] {
    return this.revisions.map((r) => ({
      key: `rev:${r.revision}`,
      at: r.changedAt,
      state: 'solid' as const,
      badge: `${msg('Revision', { id: 'party.revisionBadge' })} ${r.revision}`,
      line: r.reason ?? '',
      status: `party.${r.revision === 1 ? 'registered' : 'changed'} · ${r.changedBy}`,
    }));
  }

  private policyColumns(): Column<Policy>[] {
    return [
      { key: 'id', header: msg('Policy', { id: 'claims.col.policy' }), value: (x) => x.id },
      { key: 'animal', header: msg('Animal', { id: 'policy.animal' }), value: (x) => x.animalId },
      { key: 'product', header: msg('Product', { id: 'policy.product' }), value: (x) => x.terms.at(-1)?.productVersion ?? '–' },
      { key: 'status', header: msg('Status', { id: 'claims.col.status' }), value: (x) => policyStatusLabel(versionOn(x.versions, today())?.status ?? 'active') },
    ];
  }

  private async change(e: Event) {
    e.preventDefault();
    const f = this.editing!;
    this.shown = [...partyProblems(f), ...(this.reason.trim() ? [] : ['settings.needReason'])];
    if (this.shown.length) return;
    await this.send('change', () =>
      this.api.PUT('/v1/parties/{partyId}', { params: { path: { partyId: this.partyId } }, body: changeBody(f, this.party!.revision, this.reason) as never }),
      msg('The details are changed.', { id: 'party.changed' }),
      () => ((this.editing = null), (this.reason = '')),
    );
  }

  private async addIdentifier(e: Event) {
    e.preventDefault();
    if (!this.identifier.value.trim()) return;
    await this.send(
      'identifier',
      () =>
        this.api.POST('/v1/parties/{partyId}/identifiers', {
          params: { path: { partyId: this.partyId }, header: { 'Idempotency-Key': this.keys.for(`id:${this.identifier.value}`) } },
          body: { type: this.identifier.type, country: this.identifier.country, value: this.identifier.value.trim() },
        }),
      msg('The number is added.', { id: 'party.numberAdded' }),
      () => (this.identifier = { ...this.identifier, value: '' }),
    );
  }

  private async requestErasure(e: Event) {
    e.preventDefault();
    if (!this.erasureReason.trim()) {
      this.notice = { variant: 'danger', text: problemLabel('settings.needReason') };
      return;
    }
    await this.send(
      'erase',
      () =>
        this.api.POST('/v1/parties/{partyId}/erasure-requests', {
          params: { path: { partyId: this.partyId }, header: { 'Idempotency-Key': this.keys.for('erase') } },
          body: { basis: 'subject-request', reason: this.erasureReason.trim() },
        }),
      msg('The request waits for another privacy officer.', { id: 'party.eraseRequested' }),
      () => (this.erasureReason = ''),
    );
  }

  private async send(what: string, call: () => Promise<{ response: Response; error?: unknown }>, text: string, after: () => void) {
    this.busy = what;
    const { ok, notice } = await act(call, () => ({ variant: 'success', text }));
    this.busy = '';
    this.notice = notice;
    if (ok) {
      after();
      await this.load();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-party-detail': PartyDetail;
  }
}
