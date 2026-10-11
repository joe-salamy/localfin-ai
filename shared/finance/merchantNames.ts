// Merchant-name hygiene shared by the CSV parser, the stored-name migration,
// and the merchant-key category lookup.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode HTML character references (Chase exports `&` as `&amp;`). Unknown names stay as-is. */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref.startsWith("#x") || ref.startsWith("#X")) {
      return String.fromCodePoint(parseInt(ref.slice(2), 16));
    }
    if (ref.startsWith("#")) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

// Bank boilerplate that precedes the merchant on US Bank / card exports
// ("ELECTRONIC WITHDRAWAL SOCAL GAS", "DEBIT PURCHASE -VISA VENMO *X").
const BOILERPLATE_PREFIX =
  /^(?:recurring|debit|credit|electronic|purchase|withdrawal|deposit|pos|ach|check|-?visa)\b[\s-]*/i;
// Discover appends the wallet, sometimes glued to the state code.
const WALLET_SUFFIX = /apple pay ending in\s*\d*/gi;

/**
 * Bank-independent merchant identity: letters only, uppercased, with bank
 * boilerplate, wallet suffixes, digits (store numbers, refs, dates) and
 * punctuation removed. `MTA*NYCT PAYGO` and
 * `MTA*NYCT PAYGO NEW YORK NYAPPLE PAY ENDING IN` share the prefix `MTANYCTPAYGO`.
 */
export function merchantKey(name: string): string {
  let value = decodeHtmlEntities(name).replace(WALLET_SUFFIX, " ").trim();
  for (;;) {
    const next = value.replace(BOILERPLATE_PREFIX, "");
    if (next === value) break;
    value = next;
  }
  return value.toUpperCase().replace(/[^A-Z]+/g, "");
}

/** Shortest key that may match fuzzily; shorter keys (VENMO, LYFT) are too generic. */
export const MERCHANT_KEY_MIN_LENGTH = 8;
/** Banks truncate merchant names differently; compare at most this many leading letters. */
export const MERCHANT_KEY_PREFIX_LENGTH = 16;

/** Same merchant when both keys share their first min(16, shorter length) letters, at least 8. */
export function merchantKeysMatch(a: string, b: string): boolean {
  const length = Math.min(MERCHANT_KEY_PREFIX_LENGTH, a.length, b.length);
  if (length < MERCHANT_KEY_MIN_LENGTH) return false;
  return a.slice(0, length) === b.slice(0, length);
}
