/**
 * <pv-animal-detail>: an animal (ADR 0024, 0027). Its details, numbers, owners
 * and policies beside what may be done: correct the details with a reason,
 * add a number, and change the owner. History as an event log.
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
import { IDENTIFIER_TYPES, animalToForm, correctionBody, correctionProblems, normalizeChip, ownerOn, transferProblems, type AnimalForm, type IdentifierType } from '../animal-logic.ts';
import { animalFields } from '../components/animal-fields.ts';
import '../components/data-grid.ts';
import '../components/event-log.ts';
import type { Column } from '../components/data-grid.ts';
import type { LogEntry } from '../components/event-log.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { versionOn } from '../policy-logic.ts';
import { labelOf, loadReferences, type References } from '../reference.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { identifierLabel, policyStatusLabel, problemLabel } from './labels.ts';

type Animal = components['schemas']['AnimalRecord'];
type Revision = components['schemas']['Animal'];
type Policy = components['schemas']['PolicyRecord'];

const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-animal-detail')
export class AnimalDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'animal-id' }) animalId = '';
  @state() private animal: Animal | null = null;
  @state() private revisions: Revision[] = [];
  @state() private policies: Policy[] = [];
  @state() private refs: References | null = null;
  @state() private problem: Problem | null = null;
  @state() private editing: AnimalForm | null = null;
  @state() private reason = '';
  @state() private identifier: { type: IdentifierType; value: string } = { type: 'microchip', value: '' };
  @state() private transfer = { partyId: '', from: today(), reason: '' };
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
      .row.checks > * {
        flex: 0 0 auto;
      }
      .pv-card__body p {
        margin: 0;
      }
      a {
        color: var(--ink);
      }
      @media (max-width: 900px) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    void loadReferences(this.api).then((r) => (this.refs = r), () => undefined);
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('animalId') || changed.has('api')) void this.load();
  }

  private may(p: string): boolean {
    return !!this.me?.permissions.includes(p);
  }

  private async load() {
    this.problem = null;
    const path = { params: { path: { animalId: this.animalId } } };
    try {
      const [animal, revisions, policies] = await Promise.all([
        unwrap(this.api.GET('/v1/animals/{animalId}', path)),
        unwrap(this.api.GET('/v1/animals/{animalId}/revisions', path)),
        this.may('policies:read') ? this.api.GET('/v1/policies', { params: { query: { animalId: this.animalId } } }).then((r) => r.data?.items ?? [], () => []) : Promise.resolve([]),
      ]);
      this.animal = animal;
      this.revisions = revisions.items;
      this.policies = policies;
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  render() {
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/animals" @click=${(e: Event) => (e.preventDefault(), navigate('/animals'))}>${msg('Animals', { id: 'nav.animals' })}</a>
      <span aria-hidden="true">/</span><span aria-current="page">${this.animalId}</span>
    </nav>`;
    if (this.problem) return html`${crumbs}<wa-callout variant="neutral">${msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' })}</wa-callout>`;
    const a = this.animal;
    if (!a) return html`${crumbs}<wa-spinner></wa-spinner>`;
    const r = this.refs;
    const writable = this.may('animals:write');
    return html`
      ${crumbs}
      <div class="title">
        <h1>${a.name}</h1>
        <span class="pv-badge pv-badge--id">${a.id}</span>
        <span class="pv-badge">${labelOf(r?.species ?? [], a.species)}${a.breed ? `, ${labelOf(r?.breeds ?? [], a.breed)}` : ''} · ${a.market}</span>
        ${a.deceasedOn ? html`<span class="pv-badge pv-badge--solid">${msg('Died', { id: 'animal.died' })} ${a.deceasedOn}</span>` : nothing}
      </div>
      ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>${this.notice.text}</wa-callout>` : nothing}
      <div class="cols">
        <div class="basis">
          ${this.detailsCard(a)} ${this.identifiersCard(a, writable)} ${this.ownersCard(a)}
          ${this.may('policies:read')
            ? html`<section class="pv-card" aria-labelledby="policies">
                <div class="pv-card__head"><h2 class="pv-card__title" id="policies">${msg('Policies', { id: 'nav.policies' })}</h2></div>
                <pv-data-grid
                  .columns=${this.policyColumns()}
                  .rows=${this.policies}
                  label=${msg('Policies', { id: 'nav.policies' })}
                  empty-text=${msg('No policies.', { id: 'party.noPolicies' })}
                  @pv-row-activate=${(e: CustomEvent<{ row: Policy }>) => navigate(`/policies/${encodeURIComponent(e.detail.row.id)}`)}
                ></pv-data-grid>
              </section>`
            : nothing}
        </div>
        <div class="side">
          ${writable && !a.deceasedOn ? this.transferCard(a) : nothing} ${writable ? this.correctCard(a) : nothing}
          <pv-event-log heading=${msg('History', { id: 'claim.history' })} .entries=${this.history()}></pv-event-log>
        </div>
      </div>
    `;
  }

  private detailsCard(a: Animal) {
    const lang = getLocale();
    const r = this.refs;
    const row = (label: string, value: unknown) => html`<div class="pv-dl__row"><dt>${label}</dt><dd>${value}</dd></div>`;
    return html`<section class="pv-card" aria-labelledby="details">
      <div class="pv-card__head">
        <h2 class="pv-card__title" id="details">${msg('Details', { id: 'claim.facts' })}</h2>
        <span class="pv-card__meta">${msg('revision', { id: 'party.revision' })} ${a.revision}</span>
      </div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${row(msg('Sex', { id: 'animal.sex' }), `${labelOf(r?.sexes ?? [], a.sex)}${a.neutered ? `, ${msg('neutered', { id: 'animal.neuteredLower' })}` : ''}`)}
          ${row(msg('Date of birth', { id: 'party.birthDate' }), formatDate(a.birthDate, lang))}
          ${row(msg('Clinics may find it by its microchip', { id: 'animal.allowLookup' }), a.allowLookup ? msg('Yes', { id: 'common.yes' }) : msg('No', { id: 'common.no' }))}
          ${a.litterId
            ? row(
                msg('Litter', { id: 'litter.title' }),
                html`<a href=${`/litters/${a.litterId}`} @click=${(e: Event) => (e.preventDefault(), navigate(`/litters/${encodeURIComponent(a.litterId!)}`))} class="pv-mono">${a.litterId}</a>`,
              )
            : nothing}
        </dl>
      </div>
    </section>`;
  }

  private identifiersCard(a: Animal, writable: boolean) {
    return html`<section class="pv-card" aria-labelledby="ids">
      <div class="pv-card__head"><h2 class="pv-card__title" id="ids">${msg('Numbers', { id: 'party.numbers' })}</h2></div>
      <div class="pv-card__body">
        ${a.identifiers.length
          ? html`<dl class="pv-dl">${a.identifiers.map((i) => html`<div class="pv-dl__row"><dt>${identifierLabel(i.type)}</dt><dd class="pv-mono">${i.value}</dd></div>`)}</dl>`
          : html`<p>${msg('No numbers.', { id: 'party.noNumbers' })}</p>`}
        ${writable
          ? html`<form class="row" @submit=${this.addIdentifier}>
              <wa-select label=${msg('Number', { id: 'party.number' })} value=${this.identifier.type} @change=${(e: Event) => (this.identifier = { ...this.identifier, type: (e.target as HTMLSelectElement).value as IdentifierType })}>
                ${IDENTIFIER_TYPES.map((t) => html`<wa-option value=${t}>${identifierLabel(t)}</wa-option>`)}
              </wa-select>
              <wa-input label=${msg('Value', { id: 'party.value' })} autocomplete="off" .value=${this.identifier.value} @input=${(e: Event) => (this.identifier = { ...this.identifier, value: (e.target as HTMLInputElement).value })}></wa-input>
              <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'identifier'}>${msg('Add the number', { id: 'party.addNumber' })}</wa-button>
            </form>`
          : nothing}
      </div>
    </section>`;
  }

  private ownersCard(a: Animal) {
    const lang = getLocale();
    const current = ownerOn(a.ownerships, today());
    return html`<section class="pv-card" aria-labelledby="owners">
      <div class="pv-card__head"><h2 class="pv-card__title" id="owners">${msg('Owners', { id: 'animal.owners' })}</h2></div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${[...a.ownerships].reverse().map(
            (o) => html`<div class="pv-dl__row">
              <dt>
                ${o.validTo ? `${formatDate(o.validFrom, lang)} – ${formatDate(o.validTo, lang)}` : `${msg('From', { id: 'animal.from' })} ${formatDate(o.validFrom, lang)}`}${o === current
                  ? ` · ${msg('now', { id: 'animal.now' })}`
                  : ''}
              </dt>
              <dd><a href=${`/parties/${o.partyId}`} @click=${(e: Event) => (e.preventDefault(), navigate(`/parties/${encodeURIComponent(o.partyId)}`))} class="pv-mono">${o.partyId}</a></dd>
            </div>`,
          )}
        </dl>
      </div>
    </section>`;
  }

  private transferCard(a: Animal) {
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    return html`<section class="pv-card" aria-labelledby="transfer">
      <div class="pv-card__head"><h2 class="pv-card__title" id="transfer">${msg('Change of owner', { id: 'animal.transfer' })}</h2></div>
      <form class="pv-card__body" @submit=${(e: Event) => this.doTransfer(e, a)}>
        <p>${msg('The current ownership ends the day the new one starts. A policy on the animal gets a proposal for transfer.', { id: 'animal.transferHow' })}</p>
        <wa-input label=${msg('New owner (party id)', { id: 'animal.newOwner' })} .value=${this.transfer.partyId} @input=${(e: Event) => (this.transfer = { ...this.transfer, partyId: value(e) })}></wa-input>
        <wa-input type="date" label=${msg('Owner from', { id: 'animal.ownerFrom' })} .value=${this.transfer.from} @input=${(e: Event) => (this.transfer = { ...this.transfer, from: value(e) })}></wa-input>
        <wa-textarea label=${msg('Reason (optional)', { id: 'animal.reasonOptional' })} rows="2" .value=${this.transfer.reason} @input=${(e: Event) => (this.transfer = { ...this.transfer, reason: value(e) })}></wa-textarea>
        <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'transfer'}>${msg('Change the owner', { id: 'animal.submitTransfer' })}</wa-button>
      </form>
    </section>`;
  }

  private correctCard(a: Animal) {
    if (!this.editing) {
      return html`<section class="pv-card" aria-labelledby="correct">
        <div class="pv-card__head"><h2 class="pv-card__title" id="correct">${msg('Correct the details', { id: 'animal.correct' })}</h2></div>
        <div class="pv-card__body">
          <p>${msg('For example neutered, a corrected breed or a date of death. Species and market never change.', { id: 'animal.correctHow' })}</p>
          <wa-button appearance="outlined" @click=${() => (this.editing = animalToForm(a))}>${msg('Correct the details', { id: 'animal.correct' })}</wa-button>
        </div>
      </section>`;
    }
    const set = (patch: Partial<AnimalForm>) => (this.editing = { ...this.editing!, ...patch });
    return html`<section class="pv-card pv-card--strong" aria-labelledby="correct">
      <div class="pv-card__head"><h2 class="pv-card__title" id="correct">${msg('Correct the details', { id: 'animal.correct' })}</h2></div>
      <form class="pv-card__body" @submit=${this.correct} novalidate>
        ${animalFields({ ...this.editing, species: a.species }, this.refs, set, { correcting: true })}
        <wa-textarea label=${msg('Reason', { id: 'claim.reason' })} rows="2" .value=${this.reason} @input=${(e: Event) => (this.reason = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
        ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((x) => html`<div>${problemLabel(x)}</div>`)}</wa-callout>` : nothing}
        <div class="row">
          <wa-button type="submit" variant="brand" ?loading=${this.busy === 'correct'}>${msg('Save the change', { id: 'party.save' })}</wa-button>
          <wa-button appearance="plain" @click=${() => ((this.editing = null), (this.shown = []))}>${msg('Cancel', { id: 'common.cancel' })}</wa-button>
        </div>
      </form>
    </section>`;
  }

  private history(): LogEntry[] {
    const a = this.animal!;
    const revisions: LogEntry[] = this.revisions.map((r) => ({
      key: `rev:${r.revision}`,
      at: r.changedAt,
      state: 'solid' as const,
      badge: `${msg('Revision', { id: 'party.revisionBadge' })} ${r.revision}`,
      line: (r as { reason?: string }).reason ?? '',
      status: `animal.${r.revision === 1 ? 'registered' : 'corrected'} · ${r.changedBy}`,
    }));
    const owners: LogEntry[] = a.ownerships.slice(1).map((o) => ({
      key: `own:${o.seq}`,
      at: o.recordedAt,
      state: 'solid' as const,
      badge: msg('New owner', { id: 'animal.newOwnerBadge' }),
      line: `${o.partyId}${o.reason ? ` · ${o.reason}` : ''}`,
      status: `animal.ownership_changed · ${o.recordedBy}`,
    }));
    return [...revisions, ...owners];
  }

  private policyColumns(): Column<Policy>[] {
    return [
      { key: 'id', header: msg('Policy', { id: 'claims.col.policy' }), value: (x) => x.id },
      { key: 'holder', header: msg('Policyholder', { id: 'policy.holder' }), value: (x) => versionOn(x.versions, today())?.policyholderPartyId ?? '–' },
      { key: 'product', header: msg('Product', { id: 'policy.product' }), value: (x) => x.terms.at(-1)?.productVersion ?? '–' },
      { key: 'status', header: msg('Status', { id: 'claims.col.status' }), value: (x) => policyStatusLabel(versionOn(x.versions, today())?.status ?? 'active') },
    ];
  }

  private async correct(e: Event) {
    e.preventDefault();
    const f = this.editing!;
    this.shown = correctionProblems(f, this.reason, today());
    if (this.shown.length) return;
    await this.send(
      'correct',
      () => this.api.PUT('/v1/animals/{animalId}', { params: { path: { animalId: this.animalId } }, body: correctionBody(f, this.animal!.revision, this.reason) as never }),
      msg('The details are changed.', { id: 'party.changed' }),
      () => ((this.editing = null), (this.reason = '')),
    );
  }

  private async addIdentifier(e: Event) {
    e.preventDefault();
    const raw = this.identifier.value.trim();
    if (!raw) return;
    const value = this.identifier.type === 'microchip' ? normalizeChip(raw) : raw;
    await this.send(
      'identifier',
      () =>
        this.api.POST('/v1/animals/{animalId}/identifiers', {
          params: { path: { animalId: this.animalId }, header: { 'Idempotency-Key': this.keys.for(`id:${value}`) } },
          body: { type: this.identifier.type, value },
        }),
      msg('The number is added.', { id: 'party.numberAdded' }),
      () => (this.identifier = { ...this.identifier, value: '' }),
    );
  }

  private async doTransfer(e: Event, a: Animal) {
    e.preventDefault();
    const problems = transferProblems(this.transfer, ownerOn(a.ownerships, today()));
    if (problems.length) {
      this.notice = { variant: 'danger', text: problems.map(problemLabel).join(' ') };
      return;
    }
    const t = this.transfer;
    await this.send(
      'transfer',
      () =>
        this.api.POST('/v1/animals/{animalId}/ownerships', {
          params: { path: { animalId: this.animalId }, header: { 'Idempotency-Key': this.keys.for(`transfer:${t.partyId}:${t.from}`) } },
          body: { partyId: t.partyId.trim(), from: t.from, ...(t.reason.trim() ? { reason: t.reason.trim() } : {}) },
        }),
      msg('The owner is changed.', { id: 'animal.transferred' }),
      () => (this.transfer = { partyId: '', from: today(), reason: '' }),
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
    'pv-animal-detail': AnimalDetail;
  }
}
