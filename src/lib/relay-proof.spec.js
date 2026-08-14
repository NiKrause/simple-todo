import { describe, it, expect } from 'vitest';
import {
	decideProofOutcome,
	nextProofDelayMs,
	statusForExhaustedBudget,
	RELAY_PROOF_BUDGET_MS
} from './relay-proof.js';

const ENTRY = 'zdpuAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const OTHER = 'zdpuByyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy';

describe('decideProofOutcome', () => {
	it('trusts a membership hit', () => {
		expect(decideProofOutcome({ membership: { ok: true, hasEntry: true }, entryHash: ENTRY })).toBe(
			'pinned'
		);
	});

	it('treats a scanned miss as absent', () => {
		expect(
			decideProofOutcome({ membership: { ok: true, hasEntry: false }, entryHash: ENTRY })
		).toBe('absent');
	});

	it('treats an unscannable relay as indeterminate, not absent', () => {
		// The distinction this whole module exists for: "I could not look" must
		// never render as "it is not there".
		expect(
			decideProofOutcome({
				membership: { ok: true, hasEntry: null, source: 'database-not-open' },
				entryHash: ENTRY
			})
		).toBe('indeterminate');
	});

	it('ignores a membership answer that failed', () => {
		expect(
			decideProofOutcome({ membership: { ok: false, hasEntry: null }, entryHash: ENTRY })
		).toBe('indeterminate');
	});

	it('falls back to lastRecord equality when membership is unavailable', () => {
		expect(
			decideProofOutcome({
				membership: null,
				sync: { ok: true, lastRecord: { hash: ENTRY } },
				entryHash: ENTRY
			})
		).toBe('pinned');
	});

	it('does not read a superseded lastRecord as absent', () => {
		// The exact regression: a later todo moved lastRecord on, which says
		// nothing about whether this entry replicated.
		expect(
			decideProofOutcome({
				membership: null,
				sync: { ok: true, lastRecord: { hash: OTHER } },
				entryHash: ENTRY
			})
		).toBe('indeterminate');
	});

	it('prefers membership over the fallback when both are present', () => {
		expect(
			decideProofOutcome({
				membership: { ok: true, hasEntry: true },
				sync: { ok: true, lastRecord: { hash: OTHER } },
				entryHash: ENTRY
			})
		).toBe('pinned');

		expect(
			decideProofOutcome({
				membership: { ok: true, hasEntry: false },
				sync: { ok: true, lastRecord: { hash: ENTRY } },
				entryHash: ENTRY
			})
		).toBe('absent');
	});

	it('is indeterminate with no answers at all', () => {
		expect(decideProofOutcome({ entryHash: ENTRY })).toBe('indeterminate');
		expect(decideProofOutcome({ membership: null, sync: null, entryHash: ENTRY })).toBe(
			'indeterminate'
		);
	});
});

describe('nextProofDelayMs', () => {
	it('starts responsive and grows', () => {
		expect(nextProofDelayMs(1)).toBe(500);
		expect(nextProofDelayMs(2)).toBe(1000);
		expect(nextProofDelayMs(3)).toBe(2000);
	});

	it('caps so a long budget cannot turn into one huge sleep', () => {
		expect(nextProofDelayMs(10)).toBe(5000);
		expect(nextProofDelayMs(100)).toBe(5000);
	});

	it('never returns a delay that alone outlasts the budget', () => {
		for (let attempt = 1; attempt <= 50; attempt++) {
			expect(nextProofDelayMs(attempt)).toBeLessThan(RELAY_PROOF_BUDGET_MS);
		}
	});
});

describe('statusForExhaustedBudget', () => {
	it('only reports unavailable after a definite miss', () => {
		expect(statusForExhaustedBudget('absent')).toBe('unavailable');
		expect(statusForExhaustedBudget('indeterminate')).toBe('unknown');
	});
});
