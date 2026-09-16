import { page } from '@vitest/browser/context';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { locale } from '$lib/i18n/index.js';
import BudgetNotices from './BudgetNotices.svelte';
import BudgetRowNote from './BudgetRowNote.svelte';
import TechnicalExplanation from './TechnicalExplanation.svelte';
import TechnicalToggle from './TechnicalToggle.svelte';
import { dismissBudgetNotice, budgetNoticeStore } from './budget-store.js';
import { CATALOGUES, EVIDENCE } from './explanations/index.js';
import { TECHNICAL_VIEW_STORAGE_KEY, technicalView } from './technical-view.js';

/** @type {import('./budget.js').Budget} */
const funded = {
	mode: 'zama-confidential',
	status: 'funded',
	token: '0xfa4e00000000000000000000000000000000c05d7',
	escrow: '0xfa4e00000000000000000000000000000000e5c70',
	todoRef: `0x${'ab'.repeat(32)}`,
	lockTx: `0x${'cd'.repeat(32)}`,
	releaseTx: null,
	lastError: null
};

/** @type {import('./budget.js').Budget} */
const underfunded = { ...funded, status: 'failed', lastError: 'insufficient-balance' };

const withoutBackticks = (/** @type {string} */ text) => text.split('`').join('');

beforeEach(() => {
	locale.set('en');
	technicalView.set(false);
});

afterEach(() => {
	technicalView.set(false);
	dismissBudgetNotice();
	localStorage.removeItem(TECHNICAL_VIEW_STORAGE_KEY);
});

describe('a technical explanation', () => {
	it('is not there in the simple view', async () => {
		render(TechnicalExplanation, { step: 'lock' });
		await tick();
		expect(document.querySelector('[data-testid="technical-explanation"]')).toBeNull();
	});

	it('appears with its title and section headings in the technical view', async () => {
		render(TechnicalExplanation, { step: 'lock' });
		technicalView.set(true);

		const block = page.getByTestId('technical-explanation');
		await expect.element(block).toBeVisible();
		await expect.element(block).toHaveAttribute('data-step', 'lock');
		await expect.element(block).toHaveAttribute('open');
		await expect
			.element(page.getByTestId('technical-title'))
			.toHaveTextContent(CATALOGUES.en.lock.title);
		for (const section of CATALOGUES.en.lock.sections) {
			await expect.element(page.getByText(section.heading, { exact: true })).toBeVisible();
		}
	});

	it('renders code as code and every point as plain text', async () => {
		render(TechnicalExplanation, { step: 'lock', expanded: true });
		technicalView.set(true);
		await expect.element(page.getByTestId('technical-explanation')).toBeVisible();

		const points = [...document.querySelectorAll('[data-testid="technical-point"]')];
		const expected = CATALOGUES.en.lock.sections.flatMap((section) => section.points);
		expect(points.map((point) => point.textContent?.replace(/\s+/g, ' ').trim())).toEqual(
			expected.map((text) => withoutBackticks(text).replace(/\s+/g, ' ').trim())
		);
		const codes = [...document.querySelectorAll('[data-testid="technical-point"] code')].map(
			(code) => code.textContent
		);
		expect(codes).toContain('FHE.allowTransient(requested, token)');
		expect(codes).toContain('Locked(creator, todoRef, beneficiary, deadline)');
		expect(document.querySelector('[data-testid="technical-explanation"] script, img')).toBeNull();
	});

	it('links the evidence on Etherscan, and names its documents', async () => {
		render(TechnicalExplanation, { step: 'demo', expanded: true });
		technicalView.set(true);
		await expect.element(page.getByTestId('technical-explanation')).toBeVisible();

		const links = /** @type {HTMLAnchorElement[]} */ ([
			...document.querySelectorAll('[data-testid="technical-evidence"]')
		]);
		expect(links.map((link) => link.getAttribute('href')).sort()).toEqual(
			Object.values(EVIDENCE)
				.map((entry) => entry.href)
				.sort()
		);
		for (const link of links) {
			expect(link.getAttribute('rel')).toContain('noopener');
			expect(link.getAttribute('target')).toBe('_blank');
		}
		const sources = document.querySelector('[data-testid="technical-sources"]')?.textContent ?? '';
		expect(sources).toContain('docs/escrow.md › The confidential escrow');
	});

	it('follows the language, down to the documents it cites', async () => {
		render(TechnicalExplanation, { step: 'underfunded', expanded: true });
		technicalView.set(true);
		locale.set('de');

		await expect
			.element(page.getByTestId('technical-title'))
			.toHaveTextContent(CATALOGUES.de.underfunded.title);
		await expect
			.element(page.getByTestId('technical-sources').first())
			.toHaveTextContent('docs/escrow.de.md › Ungedeckte Sperre: technisch');
	});

	it('says the flow on screen is simulated when it is', async () => {
		render(TechnicalExplanation, { step: 'release', simulated: true });
		technicalView.set(true);
		await expect.element(page.getByTestId('technical-simulated')).toBeVisible();
	});
});

describe('the switch', () => {
	it('names the view it switches to, and switches the whole page', async () => {
		render(TechnicalToggle, {});
		const button = page.getByTestId('technical-toggle');
		await expect.element(button).toHaveTextContent('Technical');
		await expect.element(button).toHaveAttribute('data-technical', 'false');

		await button.click();
		await expect.element(button).toHaveTextContent('Simple');
		await expect.element(button).toHaveAttribute('data-technical', 'true');
		expect(localStorage.getItem(TECHNICAL_VIEW_STORAGE_KEY)).toBe('true');
	});
});

describe('both levels under a todo’s budget', () => {
	it('always says who can see the amount; the technical step only when asked', async () => {
		render(BudgetRowNote, {
			budget: funded,
			todoKey: 'todo-1',
			perspective: 'owner',
			party: 'did:key:z6Mk…bob'
		});

		const note = page.getByTestId('todo-budget-note');
		await expect.element(note).toHaveTextContent('Only you, did:key:z6Mk…bob and the auditor');
		await expect.element(note).toHaveAttribute('data-step', 'locked');
		expect(document.querySelector('[data-testid="technical-explanation"]')).toBeNull();

		technicalView.set(true);
		const block = page.getByTestId('technical-explanation');
		await expect.element(block).toHaveAttribute('data-step', 'locked');
		// Rows repeat, so the block starts folded to its title line.
		expect(/** @type {HTMLDetailsElement} */ (block.element()).open).toBe(false);
		await expect
			.element(page.getByTestId('technical-title'))
			.toHaveTextContent(CATALOGUES.en.locked.title);

		technicalView.set(false);
		await expect.element(note).toBeVisible();
		await expect
			.poll(() => document.querySelector('[data-testid="technical-explanation"]'))
			.toBeNull();
	});
});

describe('the underfunded lock notice', () => {
	it('no longer says nothing was transferred', async () => {
		budgetNoticeStore.set({ action: 'lock', code: 'insufficient-balance', todoKey: 'todo-2' });
		render(BudgetNotices, { active: true });

		const notice = page.getByTestId('budget-notice');
		await expect.element(notice).toHaveTextContent('Budget not funded.');
		await expect
			.element(notice)
			.toHaveTextContent(
				'The lock still went through: the fee was paid, and an encrypted 0 was transferred.'
			);
		expect(notice.element().textContent).not.toContain('Nothing was transferred');
		expect(document.querySelector('[data-testid="technical-explanation"]')).toBeNull();

		technicalView.set(true);
		await expect
			.element(notice.getByTestId('technical-explanation'))
			.toHaveAttribute('data-step', 'underfunded');

		locale.set('de');
		await expect.element(notice).toHaveTextContent('Budget nicht gedeckt.');
		await expect
			.element(notice)
			.toHaveTextContent(
				'Die Sperre ging trotzdem durch: Die Gebühr ist bezahlt, und überwiesen wurde eine verschlüsselte 0.'
			);
		expect(notice.element().textContent).not.toContain('Es wurde nichts überwiesen');
	});

	it('explains the row’s encrypted 0 in the notice, not twice', async () => {
		budgetNoticeStore.set({ action: 'lock', code: 'insufficient-balance', todoKey: 'todo-3' });
		technicalView.set(true);
		render(BudgetRowNote, { budget: underfunded, todoKey: 'todo-3', perspective: 'owner' });

		const note = page.getByTestId('todo-budget-note');
		await expect.element(note).toHaveTextContent('The lock holds an encrypted 0');
		expect(document.querySelector('[data-testid="technical-explanation"]')).toBeNull();

		dismissBudgetNotice();
		await expect
			.element(page.getByTestId('technical-explanation'))
			.toHaveAttribute('data-step', 'underfunded');
	});
});

describe('the other notices that stay on screen', () => {
	it('a cancelled passkey prompt: nothing signed, nothing sent', async () => {
		budgetNoticeStore.set({ action: 'lock', code: 'passkey-cancelled', todoKey: 'todo-4' });
		render(BudgetNotices, { active: true });

		const notice = page.getByTestId('budget-notice');
		await expect.element(notice).toHaveAttribute('data-kind', 'cancelled');
		await expect.element(notice).toHaveTextContent('Nothing was signed and nothing was sent.');

		technicalView.set(true);
		await expect
			.element(notice.getByTestId('technical-explanation'))
			.toHaveAttribute('data-step', 'cancelled');
	});

	it('expired read access: the delegation with an expiry', async () => {
		// The fake's own lever, as in the demo; this file's module instance only.
		/** @type {any} */ (window).simpleTodoBudgetDemo.expireReadKey();
		render(BudgetNotices, { active: true });

		const expired = page.getByTestId('budget-read-expired');
		await expect.element(expired).toHaveTextContent('Read access expired.');
		expect(expired.element().querySelector('[data-testid="technical-explanation"]')).toBeNull();

		technicalView.set(true);
		await expect
			.element(expired.getByTestId('technical-explanation'))
			.toHaveAttribute('data-step', 'readExpired');
	});
});
