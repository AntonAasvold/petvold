/**
 * <pv-settings>: the installation's versioned settings (ADR 0020, 0028, 0032):
 * roles and limits, retention, and the insurer's notice texts. Each change is
 * a new version based on the one in force, with a reason; a 409 means someone
 * else changed it first.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/radio-group/radio-group.js';
import '@awesome.me/webawesome/dist/components/radio/radio.js';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { can, type Me } from '../permissions.ts';
import { noticeMarketSettings, noticeSettingsProblems, retentionProblems, toMinorUnits, withLimit, type NoticeMarketForm, type RoleDefinitions } from '../settings-logic.ts';
import { noticeTypeLabel, problemLabel } from './labels.ts';

type RoleConfig = components['schemas']['RoleConfig'];
type Retention = components['schemas']['RetentionSettings'];
type NoticeSettings = components['schemas']['NoticeSettings'];
type Tab = 'roles' | 'retention' | 'notices';
type Version = { version: number; changedBy: string; changedAt: string; reason: string };
const CURRENCIES = ['SEK', 'EUR', 'NOK', 'DKK'];
const OPTIONAL_NOTICES = ['cancellation-confirmation', 'transfer-offer', 'claim-information-expired'] as const;

@customElement('pv-settings')
export class SettingsView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @state() private tab: Tab = 'roles';
  @state() private roles: RoleConfig | null = null;
  @state() private retention: Retention | null = null;
  @state() private notices: NoticeSettings | null = null;
  @state() private versions: Version[] = [];
  @state() private reason = '';
  @state() private notice: Notice | null = null;
  @state() private shown: string[] = [];
  @state() private busy = false;
  /** Roles: the draft being edited. */
  @state() private draftRoles: RoleDefinitions = {};
  @state() private limitRole = '';
  @state() private limitKind: 'decisionLimits' | 'approvalLimits' = 'decisionLimits';
  @state() private limitCurrency = 'SEK';
  @state() private limitAmount = '';
  /** Retention: rows being edited. */
  @state() private rows: { market: string; years: string }[] = [];
  /** Notices: the market and its form. */
  @state() private market = '';
  @state() private form: NoticeMarketForm = { promptlyDays: '', disabledTypes: [], texts: { sv: { sender: '', review: '' }, en: { sender: '', review: '' } } };
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    h2 {
      margin-top: 0;
    }
    wa-tab-group {
      margin-bottom: var(--wa-space-m);
    }
    wa-card {
      margin: var(--wa-space-l) 0;
    }
    form {
      display: grid;
      gap: var(--wa-space-m);
      max-width: 44rem;
    }
    .row {
      display: flex;
      gap: var(--wa-space-s);
      flex-wrap: wrap;
      align-items: end;
    }
    .row > * {
      flex: 1;
      min-width: 8rem;
    }
    .meta {
      color: var(--wa-color-text-quiet);
    }
  `;

  private tabs(): Tab[] {
    return [...(can(this.me, 'access:read') ? (['roles'] as const) : []), ...(can(this.me, 'parties:privacy') ? (['retention'] as const) : []), ...(can(this.me, 'notices:read') ? (['notices'] as const) : [])];
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.tab = this.tabs()[0] ?? 'roles';
    void this.load();
  }

  private async load() {
    this.shown = [];
    this.reason = '';
    try {
      if (this.tab === 'roles') {
        const [cur, all] = await Promise.all([unwrap(this.api.GET('/v1/settings/roles')), unwrap(this.api.GET('/v1/settings/roles/versions', { params: { query: { limit: 200 } } }))]);
        this.roles = cur;
        this.draftRoles = structuredClone(cur.roles) as RoleDefinitions;
        this.limitRole ||= Object.keys(cur.roles).find((r) => cur.roles[r]?.decisionLimits) ?? Object.keys(cur.roles)[0] ?? '';
        this.versions = all.items;
      } else if (this.tab === 'retention') {
        const [cur, all] = await Promise.all([unwrap(this.api.GET('/v1/settings/retention')), unwrap(this.api.GET('/v1/settings/retention/versions', { params: { query: { limit: 200 } } }))]);
        this.retention = cur;
        this.rows = Object.entries(cur.markets).map(([market, r]) => ({ market, years: String(r.years) }));
        this.versions = all.items;
      } else {
        const [cur, all] = await Promise.all([unwrap(this.api.GET('/v1/settings/notices')), unwrap(this.api.GET('/v1/settings/notices/versions', { params: { query: { limit: 200 } } }))]);
        this.notices = cur;
        this.market ||= Object.keys(cur.markets)[0] ?? 'SE';
        this.fillNoticeForm();
        this.versions = all.items;
      }
    } catch (e) {
      this.notice = { variant: 'danger', text: (e as { title?: string }).title ?? msg('Something went wrong.', { id: 'common.error' }) };
    }
  }

  private fillNoticeForm() {
    const m = this.notices?.markets[this.market] ?? {};
    const text = (lang: string) => ({ sender: m.texts?.[lang]?.sender ?? '', review: m.texts?.[lang]?.review ?? '' });
    this.form = { documentMaker: m.documentMaker ?? 'insurer', promptlyDays: m.promptlyDays ? String(m.promptlyDays) : '', disabledTypes: [...(m.disabledTypes ?? [])], texts: { sv: text('sv'), en: text('en') } };
  }

  private show(tab: Tab) {
    this.tab = tab;
    this.notice = null;
    void this.load();
  }

  private tabLabel(t: Tab) {
    return t === 'roles' ? msg('Roles and limits', { id: 'settings.roles' }) : t === 'retention' ? msg('Retention', { id: 'settings.retention' }) : msg('Notices', { id: 'notices.title' });
  }

  render() {
    const current = this.tab === 'roles' ? this.roles : this.tab === 'retention' ? this.retention : this.notices;
    return html`
      <h2>${msg('Settings', { id: 'settings.title' })}</h2>
      <wa-tab-group @wa-tab-show=${(e: CustomEvent<{ name: string }>) => this.show(e.detail.name as Tab)}>
        ${this.tabs().map((t) => html`<wa-tab panel=${t} ?active=${t === this.tab}>${this.tabLabel(t)}</wa-tab>`)}
      </wa-tab-group>
      ${this.notice
        ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}
            >${this.notice.text}
            ${this.notice.reload ? html`<wa-button size="small" appearance="outlined" @click=${() => this.load()}>${msg('Reload', { id: 'common.reload' })}</wa-button>` : nothing}</wa-callout
          >`
        : nothing}
      ${current
        ? html`<p class="meta">
            ${msg('Version', { id: 'settings.version' })} ${current.version} · ${current.changedBy}, ${formatDateTime(current.changedAt, getLocale())} · ${current.reason}
          </p>`
        : html`<wa-spinner></wa-spinner>`}
      ${this.tab === 'roles' && this.roles ? this.rolesTab() : nothing} ${this.tab === 'retention' && this.retention ? this.retentionTab() : nothing}
      ${this.tab === 'notices' && this.notices ? this.noticesTab() : nothing}
      <h3>${msg('Versions', { id: 'settings.versions' })}</h3>
      <pv-data-grid .columns=${this.versionColumns()} .rows=${[...this.versions].reverse()} label=${msg('Versions', { id: 'settings.versions' })}></pv-data-grid>
    `;
  }

  private rolesTab() {
    const lang = getLocale();
    const roles = Object.entries(this.draftRoles);
    const limits = (l?: Record<string, number>) => (l ? Object.entries(l).map(([c, a]) => formatMoney(a, c, lang)).join(', ') : msg('No limit', { id: 'settings.noLimit' }));
    const columns: Column<[string, RoleDefinitions[string]]>[] = [
      { key: 'role', header: msg('Role', { id: 'settings.role' }), value: ([r]) => r },
      { key: 'binds', header: msg('Bound to', { id: 'settings.binds' }), value: ([, d]) => d.bindsTo ?? '–' },
      { key: 'decide', header: msg('Decides alone up to', { id: 'settings.decisionLimits' }), value: ([, d]) => (d.permissions.includes('claims:decide') ? limits(d.decisionLimits) : '–') },
      { key: 'approve', header: msg('Approves up to', { id: 'settings.approvalLimits' }), value: ([, d]) => (d.permissions.includes('claims:approve') ? limits(d.approvalLimits) : '–') },
      { key: 'permissions', header: msg('Permissions', { id: 'settings.permissions' }), value: ([, d]) => d.permissions.join(', ') },
    ];
    return html`
      <pv-data-grid .columns=${columns} .rows=${roles} label=${msg('Roles and limits', { id: 'settings.roles' })}></pv-data-grid>
      ${can(this.me, 'access:manage')
        ? html`<wa-card>
            <h3 slot="header">${msg('Change a limit', { id: 'settings.changeLimit' })}</h3>
            <form @submit=${this.saveRoles}>
              <div class="row">
                <wa-select label=${msg('Role', { id: 'settings.role' })} value=${this.limitRole} @change=${(e: Event) => (this.limitRole = (e.target as HTMLSelectElement).value)}>
                  ${roles.map(([r]) => html`<wa-option value=${r}>${r}</wa-option>`)}
                </wa-select>
                <wa-select label=${msg('Limit', { id: 'settings.limit' })} value=${this.limitKind} @change=${(e: Event) => (this.limitKind = (e.target as HTMLSelectElement).value as 'decisionLimits' | 'approvalLimits')}>
                  <wa-option value="decisionLimits">${msg('Decides alone up to', { id: 'settings.decisionLimits' })}</wa-option>
                  <wa-option value="approvalLimits">${msg('Approves up to', { id: 'settings.approvalLimits' })}</wa-option>
                </wa-select>
                <wa-select label=${msg('Currency', { id: 'settings.currency' })} value=${this.limitCurrency} @change=${(e: Event) => (this.limitCurrency = (e.target as HTMLSelectElement).value)}>
                  ${CURRENCIES.map((c) => html`<wa-option value=${c}>${c}</wa-option>`)}
                </wa-select>
                <wa-input
                  label=${msg('Amount', { id: 'settings.amount' })}
                  hint=${msg('Empty removes the limit for the currency', { id: 'settings.amountHint' })}
                  .value=${this.limitAmount}
                  @input=${(e: Event) => (this.limitAmount = (e.target as HTMLInputElement).value)}
                ></wa-input>
              </div>
              ${this.reasonField()} ${this.problems()}
              <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Save a new version', { id: 'settings.save' })}</wa-button>
            </form>
          </wa-card>`
        : nothing}
    `;
  }

  private retentionTab() {
    return html`<wa-card>
      <h3 slot="header">${msg('Years after the last relation', { id: 'settings.retentionYears' })}</h3>
      <form @submit=${this.saveRetention}>
        ${this.rows.map(
          (r, i) => html`<div class="row">
            <wa-input label=${msg('Market', { id: 'policy.market' })} .value=${r.market} @input=${(e: Event) => this.setRow(i, { market: (e.target as HTMLInputElement).value.toUpperCase() })}></wa-input>
            <wa-input label=${msg('Years', { id: 'settings.years' })} .value=${r.years} @input=${(e: Event) => this.setRow(i, { years: (e.target as HTMLInputElement).value })}></wa-input>
            ${can(this.me, 'parties:erase') ? html`<wa-button appearance="plain" @click=${() => (this.rows = this.rows.filter((_, j) => j !== i))}>${msg('Remove', { id: 'settings.remove' })}</wa-button>` : nothing}
          </div>`,
        )}
        ${can(this.me, 'parties:erase')
          ? html`<div class="row"><wa-button appearance="outlined" @click=${() => (this.rows = [...this.rows, { market: '', years: '' }])}>${msg('Add a market', { id: 'settings.addMarket' })}</wa-button></div>
              <p class="meta">${msg('A market left out is never erased automatically.', { id: 'settings.retentionHelp' })}</p>
              ${this.reasonField()} ${this.problems()}
              <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Save a new version', { id: 'settings.save' })}</wa-button>`
          : nothing}
      </form>
    </wa-card>`;
  }

  private setRow(i: number, patch: Partial<{ market: string; years: string }>) {
    this.rows = this.rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
  }

  private noticesTab() {
    const edit = can(this.me, 'notices:configure');
    const markets = Object.keys(this.notices!.markets);
    const text = (lang: 'sv' | 'en', field: 'sender' | 'review') => (e: Event) =>
      (this.form = { ...this.form, texts: { ...this.form.texts, [lang]: { ...this.form.texts[lang]!, [field]: (e.target as HTMLTextAreaElement).value } } });
    return html`<wa-card>
      <h3 slot="header">${msg("The insurer's notice settings", { id: 'settings.noticeTitle' })}</h3>
      <form @submit=${this.saveNotices}>
        <wa-select label=${msg('Market', { id: 'policy.market' })} value=${this.market} @change=${(e: Event) => ((this.market = (e.target as HTMLSelectElement).value), this.fillNoticeForm())}>
          ${markets.map((m) => html`<wa-option value=${m}>${m}</wa-option>`)}
        </wa-select>
        <wa-radio-group
          label=${msg('Who makes the documents', { id: 'settings.documentMaker' })}
          hint=${msg('Petvold makes claims decisions and policy confirmations as PDF from its templates; other notices stay with the document system.', { id: 'settings.documentMakerHint' })}
          value=${this.form.documentMaker ?? 'insurer'}
          ?disabled=${!edit}
          @change=${(e: Event) => (this.form = { ...this.form, documentMaker: (e.target as HTMLInputElement).value as 'insurer' | 'petvold' })}
        >
          <wa-radio value="insurer">${msg("The insurer's document system", { id: 'settings.makerInsurer' })}</wa-radio>
          <wa-radio value="petvold">${msg('Petvold', { id: 'settings.makerPetvold' })}</wa-radio>
        </wa-radio-group>
        <wa-input
          label=${msg('Days that "promptly" gives', { id: 'settings.promptly' })}
          hint=${msg("1-30. Empty: Petvold's default", { id: 'settings.promptlyHint' })}
          ?disabled=${!edit}
          .value=${this.form.promptlyDays}
          @input=${(e: Event) => (this.form = { ...this.form, promptlyDays: (e.target as HTMLInputElement).value })}
        ></wa-input>
        <div>
          <p>${msg('Turned off (not required by law)', { id: 'settings.disabledTypes' })}</p>
          ${OPTIONAL_NOTICES.map(
            (t) =>
              html`<wa-checkbox
                ?disabled=${!edit}
                ?checked=${this.form.disabledTypes.includes(t)}
                @change=${(e: Event) =>
                  (this.form = {
                    ...this.form,
                    disabledTypes: (e.target as HTMLInputElement).checked ? [...this.form.disabledTypes, t] : this.form.disabledTypes.filter((x) => x !== t),
                  })}
                >${noticeTypeLabel(t)}</wa-checkbox
              >`,
          )}
        </div>
        ${(['sv', 'en'] as const).map(
          (lang) => html`<wa-input label=${`${msg('Sender', { id: 'settings.sender' })} (${lang})`} ?disabled=${!edit} .value=${this.form.texts[lang]!.sender} @input=${text(lang, 'sender')}></wa-input>
            <wa-textarea
              label=${`${msg('How a decision is reviewed', { id: 'settings.review' })} (${lang})`}
              hint=${lang === 'sv' ? msg('Required by law in a refusal (FAL 7 kap. 6 §).', { id: 'settings.reviewHint' }) : ''}
              rows="3"
              ?disabled=${!edit}
              .value=${this.form.texts[lang]!.review}
              @input=${text(lang, 'review')}
            ></wa-textarea>`,
        )}
        ${edit
          ? html`${this.reasonField()} ${this.problems()}
              <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Save a new version', { id: 'settings.save' })}</wa-button>`
          : nothing}
      </form>
    </wa-card>`;
  }

  private reasonField() {
    return html`<wa-input label=${msg('Reason for the change', { id: 'settings.reason' })} .value=${this.reason} @input=${(e: Event) => (this.reason = (e.target as HTMLInputElement).value)}></wa-input>`;
  }

  private problems() {
    return this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing;
  }

  private async save(key: string, call: () => Promise<{ response: Response; error?: unknown }>) {
    this.busy = true;
    const r = await act(call, () => ({ variant: 'success', text: msg('Saved as a new version.', { id: 'settings.saved' }) }));
    this.busy = false;
    this.notice = r.notice;
    if (r.ok) {
      this.keys.done(key);
      void this.load();
    }
  }

  private async saveRoles(e: Event) {
    e.preventDefault();
    const amount = this.limitAmount.trim() === '' ? null : toMinorUnits(this.limitAmount, this.limitCurrency);
    this.shown = [...(this.limitAmount.trim() && amount === null ? ['settings.badAmount'] : []), ...(this.reason.trim() ? [] : ['settings.needReason'])];
    if (this.shown.length) return;
    const roles = withLimit(this.draftRoles, this.limitRole, this.limitKind, this.limitCurrency, amount);
    await this.save('roles', () =>
      this.api.POST('/v1/settings/roles/versions', {
        params: { header: { 'Idempotency-Key': this.keys.for('roles') } },
        body: { basedOnVersion: this.roles!.version, roles: roles as never, reason: this.reason.trim() },
      }),
    );
    this.limitAmount = '';
  }

  private async saveRetention(e: Event) {
    e.preventDefault();
    this.shown = retentionProblems(this.rows, this.reason);
    if (this.shown.length) return;
    await this.save('retention', () =>
      this.api.POST('/v1/settings/retention/versions', {
        params: { header: { 'Idempotency-Key': this.keys.for('retention') } },
        body: { basedOnVersion: this.retention!.version, reason: this.reason.trim(), markets: Object.fromEntries(this.rows.map((r) => [r.market, { years: Number(r.years) }])) },
      }),
    );
  }

  private async saveNotices(e: Event) {
    e.preventDefault();
    this.shown = noticeSettingsProblems(this.form, this.reason);
    if (this.shown.length) return;
    const markets = { ...this.notices!.markets, [this.market]: noticeMarketSettings(this.form) };
    await this.save('notices', () =>
      this.api.POST('/v1/settings/notices/versions', {
        params: { header: { 'Idempotency-Key': this.keys.for('notices') } },
        body: { basedOnVersion: this.notices!.version, reason: this.reason.trim(), markets: markets as never },
      }),
    );
  }

  private versionColumns(): Column<Version>[] {
    const lang = getLocale();
    return [
      { key: 'version', header: msg('Version', { id: 'settings.version' }), value: (v) => v.version },
      { key: 'by', header: msg('By', { id: 'policy.by' }), value: (v) => v.changedBy },
      { key: 'at', header: msg('When', { id: 'policy.when' }), value: (v) => formatDateTime(v.changedAt, lang) },
      { key: 'reason', header: msg('Reason', { id: 'claim.reason' }), value: (v) => v.reason },
    ];
  }
}

