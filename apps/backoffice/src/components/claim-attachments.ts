/**
 * <pv-claim-attachments>: the claim's attachments as references to the
 * insurer's archive (ADR 0036), and the form to add one. Petvold never holds the
 * file: "Open" goes to the archive, which decides who may see it. Emits
 * pv-changed when one was added.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import type { Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import { ATTACHMENT_KINDS, attachmentBody, attachmentProblems, emptyAttachment, formatSize, mayAddAttachment, replacedIds, type AttachmentForm, type AttachmentKind } from '../attachment-logic.ts';
import { IdempotencyKeys } from '../decide.ts';
import { archiveUrl, archivedDocumentId, uploadProblems } from '../document-logic.ts';
import { formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { attachmentKindLabel, problemLabel } from '../views/labels.ts';

type Attachment = components['schemas']['ClaimAttachment'];

@customElement('pv-claim-attachments')
export class ClaimAttachments extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'claim-id' }) claimId = '';
  @property() status = '';
  @property({ attribute: false }) attachments: Attachment[] = [];
  @state() private adding = false;
  @state() private form: AttachmentForm = emptyAttachment();
  @state() private shown: string[] = [];
  @state() private notice: Notice | null = null;
  @state() private busy = false;
  /** Upload a file to Petvold's archive, or give an address in the insurer's (ADR 0038). */
  @state() private source: 'upload' | 'address' = 'upload';
  @state() private file: File | null = null;
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
      :host {
        display: block;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--space-1) var(--space-3);
        padding: var(--space-3) 0;
        border-bottom: var(--border-hairline) solid var(--line);
      }
      li.replaced .what {
        text-decoration: line-through;
      }
      .what {
        font-weight: 600;
      }
      .meta {
        color: var(--text-secondary);
        font-size: 13px;
      }
      .sha {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-muted);
      }
      .open {
        margin-left: auto;
      }
      form {
        display: grid;
        gap: var(--space-3);
        margin-top: var(--space-4);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
        align-items: start;
      }
      .row > * {
        flex: 1 1 12rem;
        min-width: 0;
      }
      .mono::part(input) {
        font-family: var(--font-mono);
      }
      fieldset {
        display: grid;
        gap: var(--space-2);
        margin: 0;
        padding: 0;
        border: 0;
      }
      legend,
      .file > span {
        padding: 0 0 var(--space-2);
        font: 500 13px/1.4 var(--font-sans);
        color: var(--text-secondary);
      }
      .file {
        display: grid;
      }
      .file input {
        font: inherit;
        padding: var(--space-2);
        border: var(--border-hairline) solid var(--line-control, var(--line));
      }
      button.link {
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        color: var(--ink);
        text-decoration: underline;
        cursor: pointer;
      }
    `,
  ];

  render() {
    const lang = getLocale();
    const replaced = replacedIds(this.attachments);
    const may = mayAddAttachment(this.me, this.status);
    return html`<section class="pv-card" aria-labelledby="attachments">
      <div class="pv-card__head">
        <h2 class="pv-card__title" id="attachments">${msg('Attachments', { id: 'attachment.title' })}</h2>
        <span class="pv-card__meta">${msg("Petvold's and the insurer's archive", { id: 'document.meta' })}</span>
      </div>
      <div class="pv-card__body">
        ${this.attachments.length
          ? html`<ul>
              ${this.attachments.map(
                (a) => html`<li class=${replaced.has(a.id) ? 'replaced' : ''}>
                  <span class="what">${attachmentKindLabel(a.kind)}</span>
                  <span class="meta">${a.mediaType} · ${formatSize(a.size)} · ${a.addedBy}, ${formatDateTime(a.addedAt, lang)}</span>
                  ${replaced.has(a.id) ? html`<span class="pv-badge pv-badge--pending">${msg('Replaced', { id: 'attachment.replaced' })}</span>` : nothing}
                  ${a.replaces ? html`<span class="meta">${msg('Replaces', { id: 'attachment.replaces' })} ${a.replaces}</span>` : nothing}
                  ${archivedDocumentId(a.url)
                    ? html`<button class="open link" type="button" @click=${() => this.openArchived(archivedDocumentId(a.url)!)}>${msg('Open', { id: 'history.open' })}</button>`
                    : /^https:/i.test(a.url)
                      ? html`<a class="open" href=${a.url} target="_blank" rel="noopener noreferrer">${msg('Open in the archive', { id: 'attachment.open' })}</a>`
                      : html`<span class="open pv-mono">${a.url}</span>`}
                  <span class="sha" title="sha256">${a.sha256}</span>
                </li>`,
              )}
            </ul>`
          : html`<p class="pv-note">${msg('No attachments.', { id: 'attachment.none' })}</p>`}
        ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>${this.notice.text}</wa-callout>` : nothing}
        ${may && !this.adding
          ? html`<wa-button appearance="outlined" @click=${() => (this.adding = true)}>${msg('Add an attachment', { id: 'attachment.add' })}</wa-button>`
          : nothing}
        ${may && this.adding ? this.addForm(replaced) : nothing}
      </div>
    </section>`;
  }

  private addForm(replaced: Set<string>) {
    const f = this.form;
    const set = (patch: Partial<AttachmentForm>) => {
      this.form = { ...this.form, ...patch };
      this.keys.done('add');
    };
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    const replaceable = this.attachments.filter((a) => !replaced.has(a.id));
    return html`<form @submit=${this.add} novalidate>
      <fieldset>
        <legend>${msg('The file', { id: 'attachment.source' })}</legend>
        <label class="pv-choice">
          <input type="radio" name="source" .checked=${this.source === 'upload'} @change=${() => (this.source = 'upload')} />
          <span><span class="pv-choice__title">${msg("Upload to Petvold's archive", { id: 'attachment.upload' })}</span><span class="pv-choice__desc">${msg('PDF, JPEG, PNG or HEIC, at most 25 MB.', { id: 'attachment.uploadDesc' })}</span></span>
        </label>
        <label class="pv-choice">
          <input type="radio" name="source" .checked=${this.source === 'address'} @change=${() => (this.source = 'address')} />
          <span><span class="pv-choice__title">${msg("In the insurer's archive", { id: 'attachment.archive' })}</span><span class="pv-choice__desc">${msg("Petvold keeps the address and the checksum, not the file.", { id: 'attachment.addressDesc' })}</span></span>
        </label>
      </fieldset>
      <div class="row">
        <wa-select label=${msg('Kind', { id: 'catalog.kind' })} value=${f.kind} @change=${(e: Event) => set({ kind: value(e) as AttachmentKind })}>
          ${ATTACHMENT_KINDS.map((k) => html`<wa-option value=${k}>${attachmentKindLabel(k)}</wa-option>`)}
        </wa-select>
        ${replaceable.length
          ? html`<wa-select label=${msg('Replaces (optional)', { id: 'attachment.replacesInput' })} value=${f.replaces || 'none'} @change=${(e: Event) => set({ replaces: value(e) === 'none' ? '' : value(e) })}>
              <wa-option value="none">${msg('Nothing', { id: 'attachment.replacesNothing' })}</wa-option>
              ${replaceable.map((a) => html`<wa-option value=${a.id}>${attachmentKindLabel(a.kind)} · ${a.id}</wa-option>`)}
            </wa-select>`
          : nothing}
      </div>
      ${this.source === 'upload'
        ? html`<label class="file">
            <span>${msg('File', { id: 'attachment.file' })}</span>
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/heic" @change=${(e: Event) => ((this.file = (e.target as HTMLInputElement).files?.[0] ?? null), this.keys.done('add'))} />
          </label>`
        : html`<wa-input class="mono" label=${msg('Address in the archive', { id: 'attachment.url' })} hint=${msg('https://… or urn:…', { id: 'attachment.urlHint' })} .value=${f.url} @input=${(e: Event) => set({ url: value(e) })}></wa-input>
            <wa-input class="mono" label=${msg('Checksum (sha256)', { id: 'attachment.sha' })} .value=${f.sha256} @input=${(e: Event) => set({ sha256: value(e) })}></wa-input>
            <div class="row">
              <wa-input class="mono" label=${msg('Media type', { id: 'attachment.mediaType' })} .value=${f.mediaType} @input=${(e: Event) => set({ mediaType: value(e) })}></wa-input>
              <wa-input label=${msg('Size in bytes', { id: 'attachment.size' })} inputmode="numeric" .value=${f.size} @input=${(e: Event) => set({ size: value(e) })}></wa-input>
            </div>`}
      ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing}
      <div class="row">
        <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Add the attachment', { id: 'attachment.submit' })}</wa-button>
        <wa-button appearance="plain" @click=${() => ((this.adding = false), (this.shown = []))}>${msg('Cancel', { id: 'catalog.cancel' })}</wa-button>
      </div>
    </form>`;
  }

  /** Opens a file in Petvold's archive through a link that works 15 minutes (ADR 0038). */
  private async openArchived(documentId: string) {
    const { data, error } = await this.api.POST('/v1/documents/{documentId}/links', {
      params: { path: { documentId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { audience: 'internal' },
    });
    if (data) window.open(data.url, '_blank', 'noopener');
    else this.notice = { variant: 'danger', text: (error as { title?: string } | undefined)?.title ?? msg('Something went wrong.', { id: 'common.error' }) };
  }

  /** The file to Petvold's archive first; its checksum, size and type become the attachment's. */
  private async uploaded(): Promise<{ url: string; sha256: string; size: number; mediaType: string } | null> {
    const form = new FormData();
    form.append('file', this.file!);
    const { data, error } = await this.api.POST('/v1/claims/{claimId}/documents', {
      params: { path: { claimId: this.claimId }, header: { 'Idempotency-Key': this.keys.for('upload') } },
      body: form as never,
      bodySerializer: (b: unknown) => b as FormData,
    });
    if (!data) {
      const p = (error ?? {}) as { title?: string; detail?: string };
      this.notice = { variant: 'danger', text: p.detail ?? p.title ?? msg('Something went wrong.', { id: 'common.error' }) };
      return null;
    }
    this.keys.done('upload');
    return { url: archiveUrl(data.id), sha256: data.sha256, size: data.size, mediaType: data.mediaType };
  }

  private async add(e: Event) {
    e.preventDefault();
    this.shown = this.source === 'upload' ? uploadProblems(this.file) : attachmentProblems(this.form);
    if (this.shown.length) return;
    this.busy = true;
    this.notice = null;
    const stored = this.source === 'upload' ? await this.uploaded() : null;
    if (this.source === 'upload' && !stored) {
      this.busy = false;
      return;
    }
    const body = stored ? { kind: this.form.kind, ...stored, ...(this.form.replaces ? { replaces: this.form.replaces } : {}) } : attachmentBody(this.form);
    const { ok, notice } = await act(
      () =>
        this.api.POST('/v1/claims/{claimId}/attachments', {
          params: { path: { claimId: this.claimId }, header: { 'Idempotency-Key': this.keys.for('add') } },
          body,
        }),
      () => ({ variant: 'success', text: msg('The attachment is added.', { id: 'attachment.added' }) }),
    );
    this.busy = false;
    this.notice = { ...notice, reload: false };
    if (ok) {
      this.keys.done('add');
      this.form = emptyAttachment();
      this.file = null;
      this.adding = false;
      this.dispatchEvent(new CustomEvent('pv-changed', { bubbles: true, composed: true }));
    }
  }
}
