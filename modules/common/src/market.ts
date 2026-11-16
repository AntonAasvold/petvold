/** ISO 3166-1 alpha-2, e.g. 'SE', 'NO', 'DK', 'FI', 'DE', 'FR', 'GB'. */
export type MarketCode = string;
/** ISO 4217, e.g. 'SEK', 'NOK', 'DKK', 'EUR', 'GBP'. */
export type CurrencyCode = string;

const MARKET_RE = /^[A-Z]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

export const isMarketCode = (v: string): v is MarketCode => MARKET_RE.test(v);
export const isCurrencyCode = (v: string): v is CurrencyCode => CURRENCY_RE.test(v);

/**
 * The languages of each market, ISO 639-1. The first is the one the customer
 * gets documents in unless they ask for another (Sweden: FAL 2 kap. 1 §,
 * distansavtalslagen 3 kap. 8 §). A market missing here has no default.
 */
export const MARKET_LANGUAGES: Readonly<Record<string, readonly string[]>> = {
  SE: ['sv'],
  NO: ['nb', 'nn'],
  DK: ['da'],
  FI: ['fi', 'sv'],
  DE: ['de'],
  NL: ['nl'],
  BE: ['nl', 'fr', 'de'],
  FR: ['fr'],
  ES: ['es'],
  IT: ['it'],
  AT: ['de'],
  CH: ['de', 'fr', 'it'],
  IE: ['en', 'ga'],
  GB: ['en'],
  PL: ['pl'],
};

/** The language a market's documents are in by default, or undefined for a market without one. */
export const marketLanguage = (market: string): string | undefined => MARKET_LANGUAGES[market]?.[0];

export function assertMarketCode(v: string, field: string): void {
  if (!isMarketCode(v)) throw new Error(`${field}: invalid market '${v}', expected ISO 3166-1 alpha-2`);
}

export function assertCurrencyCode(v: string, field: string): void {
  if (!isCurrencyCode(v)) throw new Error(`${field}: invalid currency '${v}', expected ISO 4217`);
}
