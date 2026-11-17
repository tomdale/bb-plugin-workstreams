/**
 * How the Usage page and Settings write money, counts, and tokens. A cost the
 * provider did not report is `null` and reads "No cost reported" (or a dash in
 * a column), never $0.00: zero would claim the call was free.
 */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const COUNT = new Intl.NumberFormat("en-US");

/** `$12.34`; a sum under a cent keeps four decimals so it doesn't read as zero. */
export function formatMoney(usd: number): string {
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`;
  return USD.format(usd);
}

/** `formatMoney`, or a dash for a cost nobody reported. */
export function formatCost(usd: number | null): string {
  return usd === null ? "—" : formatMoney(usd);
}

export function formatCount(count: number): string {
  return COUNT.format(count);
}

/** `1,234`, `12.3k`, `1.2M`. */
export function formatTokens(tokens: number): string {
  if (tokens < 10_000) return COUNT.format(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
