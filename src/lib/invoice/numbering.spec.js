import { describe, expect, it } from 'vitest';
import {
	formatInvoiceNumber,
	nextInvoiceNumber,
	parseInvoiceNumber,
	startFromNumber,
	validatePattern
} from './numbering.js';

/** Local noon, so no time zone can move the date across a year boundary. */
const on = (/** @type {string} */ day) => new Date(`${day}T12:00:00`);

/** @type {import('./numbering.js').NumberCircle} */
const yearly = { pattern: '{YYYY}-{NNN}', reset: 'yearly' };

describe('validatePattern', () => {
	it('accepts the usual circles', () => {
		expect(validatePattern('{YYYY}-{NNN}', 'yearly')).toBeNull();
		expect(validatePattern('RE-{YY}{MM}-{NN}', 'monthly')).toBeNull();
		expect(validatePattern('R{NNNNN}', 'never')).toBeNull();
	});

	it('refuses a yearly circle without the year, because numbers would repeat', () => {
		expect(validatePattern('RE-{NNN}', 'yearly')).toMatch(/Jahr/);
	});

	it('refuses a monthly circle without year and month', () => {
		expect(validatePattern('{YYYY}-{NNN}', 'monthly')).toMatch(/Monat/);
	});

	it('refuses zero or two counters, and unknown placeholders', () => {
		expect(validatePattern('{YYYY}', 'yearly')).toMatch(/Zähler/);
		expect(validatePattern('{YYYY}-{NN}-{NN}', 'yearly')).toMatch(/Zähler/);
		expect(validatePattern('{YYYY}-{NNN}-{KUNDE}', 'yearly')).toMatch(/Platzhalter/);
	});
});

describe('formatInvoiceNumber and parseInvoiceNumber', () => {
	it('pads the counter to the number of Ns and lets it grow past them', () => {
		expect(formatInvoiceNumber('RE-{YYYY}-{NNN}', { year: 2026, month: 9, counter: 3 })).toBe(
			'RE-2026-003'
		);
		expect(formatInvoiceNumber('{YY}{MM}-{N}', { year: 2026, month: 9, counter: 1000 })).toBe(
			'2609-1000'
		);
	});

	it('reads its own numbers back, and nothing else', () => {
		expect(parseInvoiceNumber('RE-{YYYY}-{NNN}', 'RE-2026-003')).toEqual({
			year: 2026,
			counter: 3
		});
		expect(parseInvoiceNumber('{YY}{MM}-{NN}', '2609-12')).toEqual({
			year: 2026,
			month: 9,
			counter: 12
		});
		expect(parseInvoiceNumber('RE-{YYYY}-{NNN}', 'GS-2026-003')).toBeNull();
		expect(parseInvoiceNumber('RE-{YYYY}-{NNN}', 'RE-2026-003-B')).toBeNull();
		expect(parseInvoiceNumber('{YY}{MM}-{NN}', '2613-01')).toBeNull();
	});

	it('treats pattern text literally, dots and brackets included', () => {
		expect(parseInvoiceNumber('R.{YYYY}.({NNN})', 'R.2026.(007)')).toEqual({
			year: 2026,
			counter: 7
		});
		expect(parseInvoiceNumber('R.{YYYY}.({NNN})', 'Rx2026x(007)')).toBeNull();
	});
});

describe('nextInvoiceNumber', () => {
	it('starts a fresh circle at 1', () => {
		expect(nextInvoiceNumber(yearly, [], on('2026-09-15'))).toBe('2026-001');
	});

	it('continues after the highest number issued this year', () => {
		const issued = ['2026-001', '2026-004', '2026-002'];
		expect(nextInvoiceNumber(yearly, issued, on('2026-09-15'))).toBe('2026-005');
	});

	it('begins at the chosen first number when switching over from SumUp', () => {
		const circle = { ...yearly, start: { period: '2026', counter: 3 } };
		expect(nextInvoiceNumber(circle, [], on('2026-09-15'))).toBe('2026-003');
		expect(nextInvoiceNumber(circle, ['2026-003'], on('2026-09-16'))).toBe('2026-004');
	});

	it('never goes back below a number already issued', () => {
		const circle = { ...yearly, start: { period: '2026', counter: 3 } };
		expect(nextInvoiceNumber(circle, ['2026-010'], on('2026-09-15'))).toBe('2026-011');
	});

	it('restarts in the new year, and the old start no longer applies', () => {
		const circle = { ...yearly, start: { period: '2026', counter: 3 } };
		expect(nextInvoiceNumber(circle, ['2026-041'], on('2027-01-02'))).toBe('2027-001');
	});

	it('restarts every month in a monthly circle', () => {
		const monthly = { pattern: '{YYYY}{MM}-{NN}', reset: /** @type {const} */ ('monthly') };
		expect(nextInvoiceNumber(monthly, ['202609-07'], on('2026-09-30'))).toBe('202609-08');
		expect(nextInvoiceNumber(monthly, ['202609-07'], on('2026-10-01'))).toBe('202610-01');
	});

	it('keeps counting across years in a circle that never restarts', () => {
		const running = { pattern: 'R{NNNNN}', reset: /** @type {const} */ ('never') };
		expect(nextInvoiceNumber(running, ['R00041'], on('2027-01-02'))).toBe('R00042');
	});

	it('ignores numbers from other circles', () => {
		const issued = ['GS-2026-009', '2026-002', 'SUMUP-17'];
		expect(nextInvoiceNumber(yearly, issued, on('2026-09-15'))).toBe('2026-003');
	});

	it('throws on a pattern that would repeat numbers', () => {
		expect(() =>
			nextInvoiceNumber({ pattern: 'RE-{NNN}', reset: 'yearly' }, [], on('2026-09-15'))
		).toThrow(/Jahr/);
	});
});

describe('startFromNumber', () => {
	it('turns the chosen first number into a start for its period', () => {
		expect(startFromNumber(yearly, '2026-003')).toEqual({ period: '2026', counter: 3 });
		expect(startFromNumber({ pattern: 'R{NNNNN}', reset: 'never' }, 'R00120')).toEqual({
			period: '',
			counter: 120
		});
	});

	it('refuses a number that does not fit the pattern', () => {
		expect(startFromNumber(yearly, 'RE-2026-003')).toBeNull();
		expect(startFromNumber(yearly, '2026-000')).toBeNull();
	});
});
