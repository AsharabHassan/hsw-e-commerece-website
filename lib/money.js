// Money is integer pence everywhere in this codebase.
//
// Floats are never used for money. 0.1 + 0.2 !== 0.3, and a shop whose totals
// drift by a penny is a shop with an accounting problem. Pence go in, a
// formatted string comes out, and the conversion happens only at the boundary:
// templates on the way out, admin forms on the way in.

const GBP = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * @param {number} pence
 * @returns {string} e.g. "£54.00"
 */
export function formatPence(pence) {
  const n = Number(pence);
  if (!Number.isFinite(n)) return GBP.format(0);
  return GBP.format(Math.round(n) / 100);
}

/**
 * Parse a human-typed pounds amount from an admin form into integer pence.
 * Accepts "54", "54.5", "54.50", "£54.50", "1,054.50".
 * @param {string|number} input
 * @returns {number|null} pence, or null if it is not a valid amount
 */
export function parsePounds(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  if (typeof input !== 'string') return null;

  const cleaned = input.trim().replace(/[£\s,]/g, '');
  if (cleaned === '' || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const [pounds, fraction = ''] = cleaned.split('.');
  const pence = fraction.padEnd(2, '0');
  return Number(pounds) * 100 + Number(pence);
}

/** Pence as a plain decimal string for form inputs: 5400 -> "54.00" */
export function penceToInput(pence) {
  const n = Math.round(Number(pence) || 0);
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
}

/**
 * Sum `qty * unit_price_pence` over lines.
 * @param {{qty: number, unit_price_pence: number}[]} lines
 */
export function sumLines(lines) {
  return lines.reduce((total, line) => total + line.unit_price_pence * line.qty, 0);
}
