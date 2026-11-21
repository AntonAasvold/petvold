/**
 * Petvold's document templates (ADR 0038 point 3): HTML and CSS with the design
 * system's tokens, per name, market and language, versioned with a checksum.
 * A template fills in the data it is given; amounts and dates are formatted the
 * market's way, and the texts come from the language catalogue.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { en, type TemplateTexts } from './texts-en.ts';
import { sv } from './texts-sv.ts';

/** What the reader needs beyond the stored data. Names and addresses are read when the document is made and never stored as data. */
export interface RenderContext {
  recipient?: { name: string; addressLines: string[] };
  /** The insurer, e.g. its name and contact details. */
  sender?: string;
  animalName?: string;
  productName?: string;
  /** A reason or a calculation step as text, the same text as the API's explanation. */
  reason?: (r: { reason: string; params: Record<string, string | number> }) => string;
  /** When the document is made, for its date. */
  now: string;
}

export interface Template {
  name: string;
  market: string;
  language: string;
  version: number;
  /** sha256 of the template's source, its texts and the design tokens. */
  checksum: string;
  render(data: Record<string, unknown>, ctx: RenderContext): string;
}

const TEXTS: Record<string, TemplateTexts> = { sv, en };
const LOCALES: Record<string, string> = { sv: 'sv-SE', en: 'en-GB' };

const tokens = JSON.parse(readFileSync(new URL('../../../../design/tokens.json', import.meta.url), 'utf8')) as {
  color: { tokens: { name: string; value: string | { light: string } }[] };
  type: { families: Record<string, string> };
};
const colour = (name: string) => {
  const v = tokens.color.tokens.find((t) => t.name === name)?.value;
  return typeof v === 'string' ? v : (v?.light ?? '#000000');
};

/** The design system for print: black and white, borders, no shadows. Inter is not in Gotenberg; Liberation Sans stands in. */
const CSS = `
@page { size: A4; margin: 18mm 18mm 20mm; }
:root { --ink: ${colour('ink')}; --paper: ${colour('paper')}; --muted: ${colour('text-muted')}; --secondary: ${colour('text-secondary')}; --line: ${colour('line')}; --surface: ${colour('surface-muted')}; }
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); background: var(--paper); font: 10.5pt/1.5 ${tokens.type.families.sans}, 'Liberation Sans', sans-serif; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; margin-bottom: 14mm; }
.sender { font-weight: 700; white-space: pre-line; }
.recipient { margin: 0 0 12mm; white-space: pre-line; }
.meta { color: var(--muted); font-size: 9pt; text-align: right; }
h1 { font: 700 22pt/1.1 ${tokens.type.families.display}, 'Liberation Sans', sans-serif; letter-spacing: -0.02em; margin: 0 0 4mm; }
h2 { font-size: 12pt; margin: 8mm 0 3mm; }
.lead { font-size: 12pt; margin: 0 0 6mm; }
dl { display: grid; grid-template-columns: 45mm 1fr; margin: 0; border-top: 1px solid var(--line); }
dt, dd { margin: 0; padding: 2mm 0; border-bottom: 1px solid var(--line); }
dt { color: var(--secondary); }
dd { font-weight: 600; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 2mm 0; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--secondary); font-weight: 500; font-size: 9pt; }
td.amount, th.amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tr.total td { border-top: 2px solid var(--ink); border-bottom: 0; font-weight: 700; }
.box { border: 1px solid var(--ink); padding: 4mm; margin: 6mm 0; }
.note { background: var(--surface); padding: 4mm; margin: 6mm 0; }
.mono { font-family: ${tokens.type.families.mono}, 'Liberation Mono', monospace; font-size: 9pt; }
footer { margin-top: 12mm; color: var(--muted); font-size: 8.5pt; }
`;

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** The pieces every template uses. */
function kit(language: string, ctx: RenderContext) {
  const t = TEXTS[language] ?? en;
  const locale = LOCALES[language] ?? 'en-GB';
  const money = (m: { amount: number; currency: string } | undefined) => {
    if (!m) return '–';
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: m.currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.amount / 10 ** digits);
  };
  const date = (d: string | undefined) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(d.length === 10 ? `${d}T12:00:00Z` : d)) : '–');
  const reason = (r: { reason: string; params: Record<string, string | number> } | undefined) => (r ? (ctx.reason?.(r) ?? r.reason) : '');
  const page = (title: string, body: string, data: Record<string, unknown>) => `<!doctype html>
<html lang="${esc(language)}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head>
<body>
<header>
  <div class="sender">${esc(ctx.sender ?? (data.sender as string | undefined) ?? '')}</div>
  <div class="meta">${esc(t.date)}: ${esc(date(ctx.now))}</div>
</header>
${ctx.recipient ? `<div class="recipient">${esc([ctx.recipient.name, ...ctx.recipient.addressLines].join('\n'))}</div>` : ''}
<main>
<h1>${esc(title)}</h1>
${body}
</main>
</body></html>`;
  return { t, money, date, reason, page };
}

type Render = (data: Record<string, any>, ctx: RenderContext, k: ReturnType<typeof kit>) => string;

/** The claims decision (ADR 0036): the outcome, the calculation step by step, and how it is reviewed. */
const claimDecision: Render = (d, ctx, { t, money, reason, page }) => {
  const outcome = t[`outcome.${d.outcome}` as keyof TemplateTexts] ?? d.outcome;
  const steps: { step: string; amount: number; reason: string; params: Record<string, string | number> }[] = d.steps ?? [];
  const currency = d.payout?.currency ?? 'SEK';
  const body = `
<p class="lead">${esc(reason(d.mainReason))}</p>
<dl>
  <dt>${esc(t.claimNo)}</dt><dd class="mono">${esc(d.claimNo)}</dd>
  <dt>${esc(t.animal)}</dt><dd>${esc(ctx.animalName ?? d.animalId)}</dd>
  <dt>${esc(t.outcome)}</dt><dd>${esc(outcome)}</dd>
  <dt>${esc(t.payout)}</dt><dd>${esc(money(d.payout))}</dd>
</dl>
${
  steps.length
    ? `<h2>${esc(t.calculation)}</h2>
<table><thead><tr><th scope="col"></th><th scope="col" class="amount">${esc(t.amount)}</th></tr></thead><tbody>
${steps.map((s) => `<tr><td>${esc(reason(s))}</td><td class="amount">${esc(money({ amount: s.amount, currency }))}</td></tr>`).join('\n')}
<tr class="total"><td>${esc(t.payout)}</td><td class="amount">${esc(money(d.payout))}</td></tr>
</tbody></table>`
    : ''
}
${d.deviation ? `<div class="box"><strong>${esc(t.deviation)}</strong><p>${esc(d.deviation.reason)}</p></div>` : ''}
<p class="note">${esc(d.automated ? t.automated : t.byPerson)}</p>
${d.review ? `<h2>${esc(t.review)}</h2><p>${esc(d.review)}</p>` : ''}`;
  return page(`${t.claimDecision} ${d.claimNo ?? ''}`.trim(), body, d);
};

/** The policy confirmation (FAL 2 kap. 4 §): the policy's terms for the period. */
const policyConfirmation: Render = (d, ctx, { t, money, date, page }) => {
  const v = d.vetCare ?? {};
  const ded = v.deductible ?? {};
  const currency = d.premium?.currency ?? 'SEK';
  const riders: { description: string; diagnosisCodes: string[] }[] = d.riders ?? [];
  const docs: { type: string; language: string }[] = d.acceptedDocuments ?? [];
  const body = `
<dl>
  <dt>${esc(t.policy)}</dt><dd class="mono">${esc(d.policyId)}</dd>
  <dt>${esc(t.animal)}</dt><dd>${esc(ctx.animalName ?? d.animalId)}</dd>
  <dt>${esc(t.product)}</dt><dd>${esc(ctx.productName ?? d.productVersion)}</dd>
  <dt>${esc(t.period)}</dt><dd>${esc(date(d.startDate))} – ${esc(date(d.endDate))}</dd>
  <dt>${esc(t.premium)}</dt><dd>${esc(money(d.premium))}</dd>
  <dt>${esc(t.annualLimit)}</dt><dd>${esc(money(v.annualLimit !== undefined ? { amount: v.annualLimit, currency } : undefined))}</dd>
  <dt>${esc(t.deductible)}</dt><dd>${esc(t.fixedDeductible)} ${esc(money(ded.fixed !== undefined ? { amount: ded.fixed, currency } : undefined))}, ${esc(t.variableDeductible)} ${esc((ded.variableBp ?? 0) / 100)} %</dd>
  <dt>${esc(t.waitingPeriod)}</dt><dd>${esc(v.waitingPeriodDays ?? '–')} ${esc(t.days)}</dd>
</dl>
<h2>${esc(t.riders)}</h2>
${riders.length ? `<ul>${riders.map((r) => `<li>${esc(r.description)} <span class="mono">${esc(r.diagnosisCodes.join(', '))}</span></li>`).join('')}</ul>` : `<p>${esc(t.noRiders)}</p>`}
${docs.length ? `<h2>${esc(t.documents)}</h2><ul>${docs.map((x) => `<li>${esc(t[`document.${x.type}` as keyof TemplateTexts] ?? x.type)} (${esc(x.language)})</li>`).join('')}</ul>` : ''}`;
  return page(t.policyConfirmation, body, d);
};

/**
 * The invoice (ADR 0040; FAL 5 kap. 1 §): what to pay, by when and with which
 * reference, where to pay, and the installments it holds. The period shows its
 * last day, since the plan's end is exclusive.
 */
const invoice: Render = (d, _ctx, { t, money, date, page }) => {
  const currency = d.total?.currency ?? 'SEK';
  const lines: { policyId: string; periodStart: string; periodEnd: string; premium: number; tax: number; fee: number; amount: number }[] = d.lines ?? [];
  const hasTax = lines.some((l) => l.tax > 0);
  const hasFee = lines.some((l) => l.fee > 0);
  const lastDay = (end: string) => new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const refLabel = t[`reference.${d.reference?.type}` as keyof TemplateTexts] ?? t['reference.rf'];
  const amount = (n: number) => esc(money({ amount: n, currency }));
  const body = `
<p class="lead">${esc(t.payLead.replace('{amount}', money(d.total)).replace('{date}', date(d.dueDate)))}</p>
<div class="box">
<dl>
  <dt>${esc(t.toPay)}</dt><dd>${esc(money(d.total))}</dd>
  <dt>${esc(t.dueDate)}</dt><dd>${esc(date(d.dueDate))}</dd>
  <dt>${esc(refLabel)}</dt><dd class="mono">${esc(d.reference?.value)}</dd>
  ${d.payment ? `<dt>${esc(t.payTo)}</dt><dd>${esc(d.payment)}</dd>` : ''}
</dl>
</div>
<p class="note">${esc(t.referenceNote)}</p>
<dl>
  <dt>${esc(t.invoiceNo)}</dt><dd class="mono">${esc(d.invoiceNo)}</dd>
  <dt>${esc(t.issueDate)}</dt><dd>${esc(date(d.issueDate))}</dd>
</dl>
<h2>${esc(t.specification)}</h2>
<table><thead><tr><th scope="col">${esc(t.policy)}</th><th scope="col">${esc(t.insurancePeriod)}</th>${hasTax ? `<th scope="col" class="amount">${esc(t.tax)}</th>` : ''}${hasFee ? `<th scope="col" class="amount">${esc(t.fee)}</th>` : ''}<th scope="col" class="amount">${esc(t.amount)}</th></tr></thead><tbody>
${lines
  .map(
    (l) =>
      `<tr><td class="mono">${esc(l.policyId)}</td><td>${esc(date(l.periodStart))} – ${esc(date(lastDay(l.periodEnd)))}</td>${hasTax ? `<td class="amount">${amount(l.tax)}</td>` : ''}${hasFee ? `<td class="amount">${amount(l.fee)}</td>` : ''}<td class="amount">${amount(l.amount)}</td></tr>`,
  )
  .join('\n')}
<tr class="total"><td colspan="${2 + (hasTax ? 1 : 0) + (hasFee ? 1 : 0)}">${esc(t.toPay)}</td><td class="amount">${esc(money(d.total))}</td></tr>
</tbody></table>`;
  return page(`${t.invoice} ${d.invoiceNo ?? ''}`.trim(), body, d);
};

const SOURCES: { name: string; version: number; render: Render }[] = [
  { name: 'claim-decision', version: 1, render: claimDecision },
  { name: 'policy-confirmation', version: 1, render: policyConfirmation },
  { name: 'invoice', version: 1, render: invoice },
];

/** The markets and languages the templates are made for. */
const VARIANTS: { market: string; language: string }[] = [
  { market: 'SE', language: 'sv' },
  { market: 'SE', language: 'en' },
];

export const TEMPLATES: Template[] = SOURCES.flatMap((s) =>
  VARIANTS.map(({ market, language }) => ({
    name: s.name,
    market,
    language,
    version: s.version,
    checksum: createHash('sha256')
      .update(s.render.toString())
      .update(CSS)
      .update(JSON.stringify(TEXTS[language] ?? en))
      .digest('hex'),
    render: (data: Record<string, unknown>, ctx: RenderContext) => s.render(data, ctx, kit(language, ctx)),
  })),
);

export function findTemplate(name: string, market: string, language: string): Template | undefined {
  return TEMPLATES.find((t) => t.name === name && t.market === market && t.language === language) ?? TEMPLATES.find((t) => t.name === name && t.market === market);
}
