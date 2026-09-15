/**
 * Invoice number circles (Nummernkreise).
 *
 * §14 Abs. 4 Nr. 4 UStG asks for a number that identifies the invoice once and
 * only once. UStAE 14.5 Abs. 10 allows several series, letters mixed in, and
 * does not demand a gap-free sequence. A circle here is a pattern plus a reset
 * rule:
 *
 *   RE-{YYYY}-{NNN}, yearly   →   RE-2026-003, RE-2026-004, … RE-2027-001
 *
 * The next number is derived from the numbers already issued in the current
 * period, never from a counter stored on the side. A second device that has
 * replicated the issued invoices therefore continues where the first one left
 * off. Two devices issuing while both are offline can still collide; that is a
 * property of any local-first counter and is caught when their invoices meet.
 *
 * `start` covers the switch from another tool: "the first number here is
 * 2026-003" continues SumUp's series without re-entering its invoices.
 */

/** @typedef {'yearly' | 'monthly' | 'never'} ResetRule */

/**
 * @typedef {{
 *   pattern: string
 *   reset: ResetRule
 *   start?: { period: string, counter: number } | null
 * }} NumberCircle
 */

/** @typedef {{ year?: number, month?: number, counter: number }} ParsedNumber */

const TOKEN = /\{(YYYY|YY|MM|N+)\}/g;

/**
 * Why a pattern cannot be used, or null when it can.
 *
 * A circle that restarts every year but does not carry the year would hand out
 * RE-001 in 2026 and again in 2027 — two invoices, one number. That is the one
 * mistake worth refusing outright.
 *
 * @param {string} pattern
 * @param {ResetRule} reset
 * @returns {string | null}
 */
export function validatePattern(pattern, reset) {
	const tokens = [...pattern.matchAll(TOKEN)].map((match) => match[1]);
	const counters = tokens.filter((token) => token.startsWith('N'));
	const hasYear = tokens.includes('YYYY') || tokens.includes('YY');
	const hasMonth = tokens.includes('MM');

	if (counters.length !== 1) {
		return 'Das Muster braucht genau einen Zähler, zum Beispiel {NNN}.';
	}
	if (/[{}]/.test(pattern.replace(TOKEN, ''))) {
		return 'Erlaubt sind nur {YYYY}, {YY}, {MM} und {N…} als Platzhalter.';
	}
	if (reset === 'yearly' && !hasYear) {
		return 'Ein Kreis, der jedes Jahr neu beginnt, braucht das Jahr in der Nummer, sonst entstehen doppelte Nummern.';
	}
	if (reset === 'monthly' && !(hasYear && hasMonth)) {
		return 'Ein Kreis, der jeden Monat neu beginnt, braucht Jahr und Monat in der Nummer.';
	}
	return null;
}

/**
 * @param {string} pattern
 * @param {{ year: number, month: number, counter: number }} values
 */
export function formatInvoiceNumber(pattern, { year, month, counter }) {
	return pattern.replace(TOKEN, (_, token) => {
		if (token === 'YYYY') return String(year).padStart(4, '0');
		if (token === 'YY') return String(year % 100).padStart(2, '0');
		if (token === 'MM') return String(month).padStart(2, '0');
		return String(counter).padStart(token.length, '0');
	});
}

/** @param {string} text */
function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Read year, month and counter back out of a number written with `pattern`.
 *
 * @param {string} pattern
 * @param {string} number
 * @returns {ParsedNumber | null} null when the number does not belong to this circle
 */
export function parseInvoiceNumber(pattern, number) {
	/** @type {string[]} */
	const order = [];
	let source = '';
	let last = 0;
	for (const match of pattern.matchAll(TOKEN)) {
		source += escapeRegExp(pattern.slice(last, match.index));
		const token = match[1];
		order.push(token);
		source +=
			token === 'YYYY' ? '(\\d{4})' : token === 'YY' || token === 'MM' ? '(\\d{2})' : '(\\d+)';
		last = (match.index ?? 0) + match[0].length;
	}
	source += escapeRegExp(pattern.slice(last));

	const found = new RegExp(`^${source}$`).exec(number.trim());
	if (!found) return null;

	/** @type {ParsedNumber} */
	const parsed = { counter: 0 };
	order.forEach((token, index) => {
		const value = Number(found[index + 1]);
		if (token === 'YYYY') parsed.year = value;
		else if (token === 'YY') parsed.year = 2000 + value;
		else if (token === 'MM') parsed.month = value;
		else parsed.counter = value;
	});
	if (parsed.month !== undefined && (parsed.month < 1 || parsed.month > 12)) return null;
	return parsed;
}

/**
 * The period a number belongs to: "2026", "2026-09" or "" for a circle that
 * never restarts.
 *
 * @param {ResetRule} reset
 * @param {{ year?: number, month?: number }} values
 */
function periodKey(reset, { year, month }) {
	if (reset === 'yearly') return String(year);
	if (reset === 'monthly') return `${year}-${String(month).padStart(2, '0')}`;
	return '';
}

/**
 * The next number this circle hands out on `date`.
 *
 * It is the highest counter already issued in the period plus one, but never
 * below `start` when `start` falls into the same period.
 *
 * @param {NumberCircle} circle
 * @param {string[]} issuedNumbers every number issued so far, from any circle
 * @param {Date} [date] the issue date; local time, as on the invoice
 */
export function nextInvoiceNumber(circle, issuedNumbers, date = new Date()) {
	const problem = validatePattern(circle.pattern, circle.reset);
	if (problem) throw new Error(problem);

	const year = date.getFullYear();
	const month = date.getMonth() + 1;
	const period = periodKey(circle.reset, { year, month });

	let highest = 0;
	for (const number of issuedNumbers) {
		const parsed = parseInvoiceNumber(circle.pattern, number);
		if (!parsed || periodKey(circle.reset, parsed) !== period) continue;
		highest = Math.max(highest, parsed.counter);
	}

	const startCounter = circle.start && circle.start.period === period ? circle.start.counter : 1;
	const counter = Math.max(highest + 1, startCounter);
	return formatInvoiceNumber(circle.pattern, { year, month, counter });
}

/**
 * Turn "the first number should be 2026-003" into a `start` for the circle.
 *
 * @param {Pick<NumberCircle, 'pattern' | 'reset'>} circle
 * @param {string} firstNumber
 * @returns {{ period: string, counter: number } | null} null when the number does not fit the pattern
 */
export function startFromNumber(circle, firstNumber) {
	const parsed = parseInvoiceNumber(circle.pattern, firstNumber);
	if (!parsed || parsed.counter < 1) return null;
	return { period: periodKey(circle.reset, parsed), counter: parsed.counter };
}
