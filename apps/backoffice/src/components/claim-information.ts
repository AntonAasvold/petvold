/**
 * <pv-claim-information>: requests for information on a claim (ADR 0036). Shows
 * open and expired requests with their due dates, lets a handler answer or
 * cancel them, and ask for more. Emits pv-changed when the claim changed.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import type { Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { IdempotencyKeys } from '../decide.ts';
import {
  INFORMATION_ITEMS,
  emptyInformation,
  informationBody,
  informationProblems,
  mayAnswer,
  mayCancel,
  mayRequestInformation,
  toggleItem,
  type InformationForm,
  type Recipient,
} from '../information-logic.ts';
import { formatDate, formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { informationItemLabel, problemLabel, recipientLabel } from '../views/labels.ts';

type InformationRequest = components['schemas']['InformationRequest'];

const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-claim-information')
export class ClaimInformation extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'claim-id' }) claimId = '';
  @property() status = '';
  @property({ attribute: false }) requests: InformationRequest[] = [];
  /** The latest request expired without an answer. */
  @property({ type: Boolean, attribute: 'information-missing' }) informationMissing = false;

  @state() private form: InformationForm = emptyInformation();
  /** The form for a new request is folded away until asked for. */
  @state() private asking = false;
  @state() private shown: string[] = [];
  @state() private notes: Record<string, string> = {};
  @state() private busy = '';
  @state() private notice: { variant: 'success' | 'warning' | 'danger'; text: string } | null = null;
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
      :host {
        display: grid;
        gap: var(--wa-space-l);
      }
      :host([hidden]) {
        display: none;
      }
      form {
        display: grid;
        gap: var(--wa-space-m);
      }
      fieldset {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        margin: 0;
        padding: 0;
        border: 0;
      }
      legend {
        padding: 0 0 var(--space-2);
        font: 500 13px/1.4 var(--font-sans);
        color: var(--text-secondary);
      }
      .pv-choice:focus-within {
        outline: var(--border-strong) solid var(--focus);
        outline-offset: 2px;
      }
      .pv-card__body p {
        margin: 0;
      }
      .request + .request {
        border-top: var(--border-hairline) solid var(--line);
        padding-top: var(--space-4);
      }
      .request {
        display: grid;
        gap: var(--space-3);
      }
      .row {
        display: flex;
        gap: var(--wa-space-s);
        flex-wrap: wrap;
      }
    `,
  ];

  render() {
    const waiting = this.requests.filter((r) => r.status === 'open' || r.status === 'expired');
    const may = mayRequestInformation(this.me, this.status);
    if (!waiting.length && !may && !this.informationMissing) return nothing;
    return html`
      ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>${this.notice.text}</wa-callout>` : nothing}
      ${waiting.length || this.informationMissing
        ? html`<section class="pv-card ${waiting.some((r) => r.status === 'open') ? 'pv-card--strong' : ''}" aria-labelledby="info-open">
            <div class="pv-card__head"><h2 class="pv-card__title" id="info-open">${msg('Awaiting information', { id: 'claims.status.awaiting-information' })}</h2></div>
            <div class="pv-card__body">
              ${this.informationMissing
                ? html`<p class="pv-note">
                    ${msg('The information did not come in. Decide on what there is; the claim is not rejected for that alone.', { id: 'info.missing' })}
                  </p>`
                : nothing}
              ${waiting.map((r) => this.request(r))}
            </div>
          </section>`
        : nothing}
      ${may
        ? this.asking
          ? this.requestForm()
          : html`<wa-button appearance="outlined" @click=${() => (this.asking = true)}>${msg('Ask for information', { id: 'info.title' })}</wa-button>`
        : nothing}
    `;
  }

  private request(r: InformationRequest) {
    const lang = getLocale();
    const note = this.notes[r.id] ?? '';
    return html`<div class="request">
      <dl class="pv-dl">
        <div class="pv-dl__row"><dt>${msg('To', { id: 'info.to' })}</dt><dd>${recipientLabel(r.recipient)}</dd></div>
        <div class="pv-dl__row"><dt>${msg('Missing', { id: 'info.items' })}</dt><dd>${r.items.map((i) => informationItemLabel(i)).join(', ')}</dd></div>
        <div class="pv-dl__row"><dt>${msg('Note', { id: 'info.note' })}</dt><dd>${r.note}</dd></div>
        <div class="pv-dl__row">
          <dt>${msg('Answer by', { id: 'info.dueDate' })}</dt>
          <dd>${formatDate(r.dueDate, lang)} <span class="pv-badge ${r.status === 'expired' ? 'pv-badge--solid' : 'pv-badge--pending'}">${r.status === 'expired' ? msg('Expired', { id: 'info.expired' }) : msg('Open', { id: 'info.open' })}</span></dd>
        </div>
        ${r.remindOn
          ? html`<div class="pv-dl__row">
              <dt>${msg('Reminder', { id: 'info.reminder' })}</dt>
              <dd>${r.remindedAt ? `${msg('Sent', { id: 'info.reminded' })} ${formatDateTime(r.remindedAt, lang)}` : formatDate(r.remindOn, lang)}</dd>
            </div>`
          : nothing}
        <div class="pv-dl__row"><dt>${msg('Asked by', { id: 'info.by' })}</dt><dd>${r.requestedBy}, ${formatDateTime(r.requestedAt, lang)}</dd></div>
      </dl>
      ${mayAnswer(this.me, r) || mayCancel(this.me, r)
        ? html`<wa-textarea
              label=${msg('Note (optional for an answer, needed to cancel)', { id: 'info.closingNote' })}
              rows="2"
              .value=${note}
              @input=${(e: Event) => (this.notes = { ...this.notes, [r.id]: (e.target as HTMLTextAreaElement).value })}
            ></wa-textarea>
            <div class="row">
              ${mayAnswer(this.me, r)
                ? html`<wa-button variant="brand" ?loading=${this.busy === `answer:${r.id}`} @click=${() => this.answer(r)}>${msg('The information came in', { id: 'info.answer' })}</wa-button>`
                : nothing}
              ${mayCancel(this.me, r)
                ? html`<wa-button appearance="outlined" ?loading=${this.busy === `cancel:${r.id}`} @click=${() => this.cancel(r)}>${msg('Cancel the request', { id: 'info.cancel' })}</wa-button>`
                : nothing}
            </div>`
        : nothing}
    </div>`;
  }

  private requestForm() {
    const f = this.form;
    const set = (patch: Partial<InformationForm>) => (this.form = { ...this.form, ...patch });
    const choice = (value: Recipient) => html`<label class="pv-choice">
      <input type="radio" name="recipient" value=${value} .checked=${f.recipient === value} @change=${() => set({ recipient: value })} />
      <span><span class="pv-choice__title">${recipientLabel(value)}</span></span>
    </label>`;
    return html`<section class="pv-card" aria-labelledby="info-ask">
      <div class="pv-card__head"><h2 class="pv-card__title" id="info-ask">${msg('Ask for information', { id: 'info.title' })}</h2></div>
      <form class="pv-card__body" @submit=${this.ask}>
        <p>${msg('The claim waits until the information comes in. A reminder and the due date follow the product\'s claims rules.', { id: 'info.why' })}</p>
        <fieldset>
          <legend>${msg('To', { id: 'info.to' })}</legend>
          ${choice('customer')} ${choice('clinic')}
        </fieldset>
        <fieldset>
          <legend>${msg('Missing', { id: 'info.items' })}</legend>
          ${INFORMATION_ITEMS.map(
            (i) => html`<wa-checkbox .checked=${f.items.includes(i)} @change=${(e: Event) => set({ items: toggleItem(f.items, i, (e.target as HTMLInputElement).checked) })}
              >${informationItemLabel(i)}</wa-checkbox
            >`,
          )}
        </fieldset>
        <wa-textarea label=${msg('What is missing', { id: 'info.noteInput' })} rows="3" .value=${f.note} @input=${(e: Event) => set({ note: (e.target as HTMLTextAreaElement).value })}></wa-textarea>
        <wa-input
          type="date"
          label=${msg('Answer by (optional)', { id: 'info.dueInput' })}
          hint=${msg('Empty: from the product\'s claims rules, normally 30 days.', { id: 'info.dueHint' })}
          .value=${f.dueDate}
          @input=${(e: Event) => set({ dueDate: (e.target as HTMLInputElement).value })}
        ></wa-input>
        ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing}
        <div class="row">
          <wa-button type="submit" variant="brand" ?loading=${this.busy === 'ask'}>${msg('Ask for information', { id: 'info.submit' })}</wa-button>
          <wa-button appearance="plain" @click=${() => ((this.asking = false), (this.shown = []))}>${msg('Cancel', { id: 'catalog.cancel' })}</wa-button>
        </div>
      </form>
    </section>`;
  }

  private async ask(e: Event) {
    e.preventDefault();
    this.shown = informationProblems(this.form, today());
    if (this.shown.length) return;
    const ok = await this.run('ask', () =>
      this.api.POST('/v1/claims/{claimId}/information-requests', {
        params: { path: { claimId: this.claimId }, header: { 'Idempotency-Key': this.keys.for(`ask:${this.claimId}`) } },
        body: informationBody(this.form),
      }),
    );
    if (ok) {
      this.form = emptyInformation();
      this.asking = false;
      this.notice = { variant: 'success', text: msg('The request is sent. The claim waits for the information.', { id: 'info.asked' }) };
    }
  }

  private async answer(r: InformationRequest) {
    const note = (this.notes[r.id] ?? '').trim();
    const ok = await this.run(`answer:${r.id}`, () =>
      this.api.POST('/v1/claims/{claimId}/information-requests/{requestId}/answers', {
        params: { path: { claimId: this.claimId, requestId: r.id }, header: { 'Idempotency-Key': this.keys.for(`answer:${r.id}`) } },
        body: note ? { note } : {},
      }),
    );
    if (ok) this.notice = { variant: 'success', text: msg('Registered. The claim is back in the queue.', { id: 'info.answered' }) };
  }

  private async cancel(r: InformationRequest) {
    const reason = (this.notes[r.id] ?? '').trim();
    if (!reason) {
      this.notice = { variant: 'danger', text: problemLabel('decide.needReason') };
      return;
    }
    const ok = await this.run(`cancel:${r.id}`, () =>
      this.api.POST('/v1/claims/{claimId}/information-requests/{requestId}/cancellations', {
        params: { path: { claimId: this.claimId, requestId: r.id }, header: { 'Idempotency-Key': this.keys.for(`cancel:${r.id}`) } },
        body: { reason },
      }),
    );
    if (ok) this.notice = { variant: 'success', text: msg('The request is cancelled.', { id: 'info.cancelled' }) };
  }

  /** Runs a call; true when it went through. A conflict says the claim changed. */
  private async run(action: string, call: () => Promise<{ response: Response; error?: unknown }>): Promise<boolean> {
    this.busy = action;
    this.notice = null;
    try {
      const { response, error } = await call();
      if (response.ok) {
        this.keys.done(action.startsWith('ask') ? `ask:${this.claimId}` : action);
        this.dispatchEvent(new CustomEvent('pv-changed', { bubbles: true, composed: true }));
        return true;
      }
      const p = (error ?? {}) as { title?: string; detail?: string };
      this.notice =
        response.status === 409
          ? { variant: 'warning', text: `${msg('The claim has changed since you opened it.', { id: 'common.conflict' })} ${p.detail ?? p.title ?? ''}` }
          : { variant: 'danger', text: p.detail ?? p.title ?? response.statusText };
    } catch {
      this.notice = { variant: 'danger', text: msg('Something went wrong.', { id: 'common.error' }) };
    } finally {
      this.busy = '';
    }
    return false;
  }
}
