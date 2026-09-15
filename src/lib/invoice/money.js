/**
 * Money for invoices, in integer cents.
 *
 * Floating-point euros drift (0.1 + 0.2), and an invoice whose lines do not add
 * up to its totals by one cent fails EN 16931's own consistency rules
 * (BR-CO-10, BR-CO-15) — and later the e-invoice validator. So every amount here
 * is an integer number of cents, quantities are scaled to ten-thousandths, and
 * each figure is rounded exactly once: half away from zero ("kaufmännisch"),
 * the way German invoices are expected to round.
 */

const QTY_SCALE = 10_000n;

/**
 * Integer division rounding half away from zero.
 *
 * @param {bigint} numerator
 * @param {bigint} divisor positive
 * @returns {bigint}
 */
function divRound(numerator, divisor) {
	const negative = numerator < 0n;
	const abs = negative ? -numerator : numerator;
	const quotient = abs / divisor;
	const remainder = abs - quotient * divisor;
	const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
	return negative ? -rounded : rounded;
}

/**
 * Net amount of one invoice line (BT-131 = BT-129 × BT-146).
 *
 * @param {number} quantity may carry up to four decimals, e.g. 1.5 hours
 * @param {number} unitPriceCents net price per unit, integer cents
 * @returns {number} integer cents
 */
export function lineNetCents(quantity, unitPriceCents) {
	const scaledQuantity = BigInt(Math.round(quantity * Number(QTY_SCALE)));
	return Number(divRound(scaledQuantity * BigInt(unitPriceCents), QTY_SCALE));
}

/**
 * VAT for one rate, taken on the sum of the net amounts at that rate
 * (BT-117 = BT-116 × BT-119 / 100). Computing it per line and adding up would be
 * a cent off now and then, and it is the per-rate figure that EN 16931 checks.
 *
 * @param {number} taxableCents
 * @param {number} ratePercent e.g. 19 or 7
 * @returns {number} integer cents
 */
export function vatCents(taxableCents, ratePercent) {
	const basisPoints = BigInt(Math.round(ratePercent * 100));
	return Number(divRound(BigInt(taxableCents) * basisPoints, 10_000n));
}

/**
 * How VAT applies to the whole invoice.
 *
 * - `standard`: each line carries its rate (19, 7 or 0).
 * - `kleinunternehmer`: §19 UStG, no VAT may be shown at all.
 * - `reverse-charge`: the recipient owes the VAT (§13b UStG, B2B services
 *   into another EU country); the invoice shows none.
 *
 * @typedef {'standard' | 'kleinunternehmer' | 'reverse-charge'} TaxMode
 */

/**
 * The VAT category code EN 16931 uses for a line (BT-151).
 *
 * @param {number} ratePercent
 * @param {TaxMode} taxMode
 * @returns {'S' | 'Z' | 'E' | 'AE'}
 */
export function vatCategoryFor(ratePercent, taxMode) {
	if (taxMode === 'kleinunternehmer') return 'E';
	if (taxMode === 'reverse-charge') return 'AE';
	return ratePercent > 0 ? 'S' : 'Z';
}

/**
 * @typedef {{ quantity: number, unitPriceCents: number, vatRate: number }} PricedLine
 * @typedef {{ category: 'S' | 'Z' | 'E' | 'AE', rate: number, taxableCents: number, taxCents: number }} VatBreakdown
 */

/**
 * Line amounts, the VAT breakdown and the totals of an invoice.
 *
 * Without allowances or charges the EN 16931 totals collapse to three figures:
 * the sum of line nets (BT-106, equal to BT-109), the VAT total (BT-110) and
 * the gross total (BT-112), which is also the amount due (BT-115).
 *
 * @template {PricedLine} L
 * @param {L[]} lines
 * @param {TaxMode} [taxMode]
 */
export function computeTotals(lines, taxMode = 'standard') {
	const priced = lines.map((line) => {
		const vatRate = taxMode === 'standard' ? line.vatRate : 0;
		return {
			...line,
			vatRate,
			vatCategory: vatCategoryFor(vatRate, taxMode),
			netCents: lineNetCents(line.quantity, line.unitPriceCents)
		};
	});

	/** @type {Map<string, VatBreakdown>} */
	const groups = new Map();
	for (const line of priced) {
		const key = `${line.vatCategory}:${line.vatRate}`;
		const group = groups.get(key) ?? {
			category: line.vatCategory,
			rate: line.vatRate,
			taxableCents: 0,
			taxCents: 0
		};
		group.taxableCents += line.netCents;
		groups.set(key, group);
	}

	const vatBreakdown = [...groups.values()]
		.map((group) => ({ ...group, taxCents: vatCents(group.taxableCents, group.rate) }))
		.sort((a, b) => b.rate - a.rate);

	const netTotalCents = priced.reduce((sum, line) => sum + line.netCents, 0);
	const taxTotalCents = vatBreakdown.reduce((sum, group) => sum + group.taxCents, 0);
	const grossTotalCents = netTotalCents + taxTotalCents;

	return {
		lines: priced,
		vatBreakdown,
		netTotalCents,
		taxTotalCents,
		grossTotalCents,
		dueCents: grossTotalCents
	};
}

const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/**
 * "1.234,56 €" — German grouping and decimal comma, as on the printed invoice.
 *
 * @param {number} cents
 */
export function formatEuro(cents) {
	return euroFormat.format(cents / 100);
}

/**
 * Parse what someone types into a price field.
 *
 * German input first: a comma is the decimal separator ("95,50") and dots group
 * thousands ("1.234,56"). A lone dot followed by one or two digits is read as a
 * decimal point too ("95.5"), because that is what a pasted English number
 * means; a dot followed by exactly three digits stays a thousands separator
 * ("1.234" is 1234 €). More than two decimals is refused rather than rounded —
 * a price should never silently change on its way in.
 *
 * @param {string | number} input
 * @returns {number | null} integer cents, or null when the input is not a price
 */
export function parseEuroToCents(input) {
	const text = String(input).replace(/[\s€]/g, '').replace(/^\+/, '');
	if (!/^-?[\d.,]+$/.test(text) || !/\d/.test(text)) return null;

	const negative = text.startsWith('-');
	const unsigned = negative ? text.slice(1) : text;
	const lastComma = unsigned.lastIndexOf(',');
	const lastDot = unsigned.lastIndexOf('.');

	let decimalAt = -1;
	if (lastComma >= 0 && lastDot >= 0) {
		decimalAt = Math.max(lastComma, lastDot);
	} else if (lastComma >= 0) {
		if (unsigned.indexOf(',') !== lastComma) return null;
		decimalAt = lastComma;
	} else if (lastDot >= 0 && unsigned.indexOf('.') === lastDot) {
		const decimals = unsigned.length - lastDot - 1;
		if (decimals === 1 || decimals === 2) decimalAt = lastDot;
	}

	const integerPart = (decimalAt >= 0 ? unsigned.slice(0, decimalAt) : unsigned).replace(
		/[.,]/g,
		''
	);
	const fractionPart = decimalAt >= 0 ? unsigned.slice(decimalAt + 1) : '';
	if (!/^\d*$/.test(fractionPart) || fractionPart.length > 2) return null;
	if (!/^\d*$/.test(integerPart) || (integerPart === '' && fractionPart === '')) return null;

	const cents = Number(integerPart || '0') * 100 + Number(fractionPart.padEnd(2, '0'));
	return negative ? -cents : cents;
}

/**
 * Parse a quantity: "1,5" or "1.5" hours, at most four decimals.
 *
 * @param {string | number} input
 * @returns {number | null}
 */
export function parseQuantity(input) {
	const text = String(input).trim().replace(',', '.');
	if (!/^\d+(\.\d{1,4})?$/.test(text)) return null;
	return Number(text);
}
