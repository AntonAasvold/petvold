/** ISO 3166-1 alpha-2, e.g. 'SE', 'NO', 'DK', 'FI', 'DE', 'FR', 'GB'. */
export type MarketCode = string;
/** ISO 4217, e.g. 'SEK', 'NOK', 'DKK', 'EUR', 'GBP'. */
export type CurrencyCode = string;

const MARKET_RE = /^[A-Z]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

export const isMarketCode = (v: string): v is MarketCode => MARKET_RE.test(v);
export const isCurrencyCode = (v: string): v is CurrencyCode => CURRENCY_RE.test(v);

export function assertMarketCode(v: string, field: string): void {
  if (!isMarketCode(v)) throw new Error(`${field}: invalid market '${v}', expected ISO 3166-1 alpha-2`);
}

export function assertCurrencyCode(v: string, field: string): void {
  if (!isCurrencyCode(v)) throw new Error(`${field}: invalid currency '${v}', expected ISO 4217`);
}
