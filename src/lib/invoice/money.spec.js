import { describe, expect, it } from 'vitest';
import {
	computeTotals,
	formatEuro,
	lineNetCents,
	parseEuroToCents,
	parseQuantity,
	vatCents
} from './money.js';

/** Intl puts a no-break space before the euro sign; compare with a plain one. */
const plain = (/** @type {string} */ text) => text.replace(/\s/g, ' ');

describe('lineNetCents', () => {
	it('multiplies quantity by the unit price', () => {
		expect(lineNetCents(3, 9500)).toBe(28500);
		expect(lineNetCents(1.5, 9500)).toBe(14250);
	});

	it('rounds half away from zero, once, at the line', () => {
		// 0.333 h × 10.00 € = 3.33 €; 2.5 × 0.01 € = 0.025 € → 0.03 €
		expect(lineNetCents(0.333, 1000)).toBe(333);
		expect(lineNetCents(2.5, 1)).toBe(3);
		expect(lineNetCents(2.5, -1)).toBe(-3);
	});

	it('does not drift on quantities binary floats cannot represent', () => {
		// 1.005 × 100.00 € must be 100.50 €, not 100.49 €
		expect(lineNetCents(1.005, 10000)).toBe(10050);
	});

	it('stays exact for large amounts', () => {
		// 123456789 × 99999999 / 10000 = 1234567877654.3211
		expect(lineNetCents(12345.6789, 99999999)).toBe(1234567877654);
	});
});

describe('vatCents', () => {
	it('takes the rate on the taxable amount and rounds half away from zero', () => {
		expect(vatCents(10000, 19)).toBe(1900);
		expect(vatCents(10050, 19)).toBe(1910); // 19.095 → 19.10
		expect(vatCents(1050, 7)).toBe(74); // 0.735 → 0.74
		expect(vatCents(10000, 0)).toBe(0);
	});
});

describe('computeTotals', () => {
	const lines = [
		{ quantity: 10, unitPriceCents: 9500, vatRate: 19 },
		{ quantity: 1, unitPriceCents: 4990, vatRate: 7 },
		{ quantity: 2.5, unitPriceCents: 9500, vatRate: 19 }
	];

	it('groups VAT by rate and adds the totals up exactly', () => {
		const totals = computeTotals(lines);
		expect(totals.lines.map((line) => line.netCents)).toEqual([95000, 4990, 23750]);
		expect(totals.vatBreakdown).toEqual([
			{ category: 'S', rate: 19, taxableCents: 118750, taxCents: 22563 },
			{ category: 'S', rate: 7, taxableCents: 4990, taxCents: 349 }
		]);
		expect(totals.netTotalCents).toBe(123740);
		expect(totals.taxTotalCents).toBe(22912);
		expect(totals.grossTotalCents).toBe(146652);
		expect(totals.dueCents).toBe(146652);
	});

	it('shows no VAT for a Kleinunternehmer, whatever rate a line carries', () => {
		const totals = computeTotals(lines, 'kleinunternehmer');
		expect(totals.vatBreakdown).toEqual([
			{ category: 'E', rate: 0, taxableCents: 123740, taxCents: 0 }
		]);
		expect(totals.grossTotalCents).toBe(123740);
	});

	it('shows no VAT under reverse charge and marks the category AE', () => {
		const totals = computeTotals(lines, 'reverse-charge');
		expect(totals.vatBreakdown).toEqual([
			{ category: 'AE', rate: 0, taxableCents: 123740, taxCents: 0 }
		]);
	});

	it('marks a 0 % line zero-rated under standard taxation', () => {
		const totals = computeTotals([{ quantity: 1, unitPriceCents: 1000, vatRate: 0 }]);
		expect(totals.vatBreakdown).toEqual([
			{ category: 'Z', rate: 0, taxableCents: 1000, taxCents: 0 }
		]);
	});

	it('keeps whatever else a line carries', () => {
		const totals = computeTotals([
			{ quantity: 1, unitPriceCents: 1000, vatRate: 19, description: 'Beratung', todoKey: 'todo_1' }
		]);
		expect(totals.lines[0]).toMatchObject({ description: 'Beratung', todoKey: 'todo_1' });
	});
});

describe('formatEuro', () => {
	it('uses German grouping and the decimal comma', () => {
		expect(plain(formatEuro(146652))).toBe('1.466,52 €');
		expect(plain(formatEuro(5))).toBe('0,05 €');
		expect(plain(formatEuro(-12345))).toBe('-123,45 €');
	});
});

describe('parseEuroToCents', () => {
	it.each([
		['95', 9500],
		['95,5', 9550],
		['95,50', 9550],
		['1.234,56', 123456],
		['1.234', 123400],
		['1.234.567', 123456700],
		['95.5', 9550],
		['1,234.56', 123456],
		['  95,00 € ', 9500],
		['-12,34', -1234],
		[',5', 50]
	])('reads %j as %i cents', (input, cents) => {
		expect(parseEuroToCents(input)).toBe(cents);
	});

	it.each(['', 'abc', '12,345', '1,2,3', '9,5x', '-', '.'])('refuses %j', (input) => {
		expect(parseEuroToCents(input)).toBeNull();
	});
});

describe('parseQuantity', () => {
	it('reads decimal commas and dots', () => {
		expect(parseQuantity('1,5')).toBe(1.5);
		expect(parseQuantity('2.25')).toBe(2.25);
		expect(parseQuantity(3)).toBe(3);
	});

	it('refuses negatives, words and more than four decimals', () => {
		expect(parseQuantity('-1')).toBeNull();
		expect(parseQuantity('zwei')).toBeNull();
		expect(parseQuantity('1,23456')).toBeNull();
	});
});
