import { page } from '@vitest/browser/context';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { locale } from '$lib/i18n/index.js';
import AddTodoForm from './AddTodoForm.svelte';

afterEach(() => {
	locale.set('en');
});

/**
 * `mount` takes `events` for components that dispatch, but the options type
 * `render` declares does not list it.
 *
 * @param {{ props: Record<string, unknown>, events: Record<string, (event: CustomEvent) => void> }} options
 * @returns {any}
 */
const withEvents = (options) => options;

/** Every button that adds the todo, wherever it is. */
const submitButtons = () =>
	[...document.querySelectorAll('button')].filter((button) =>
		/Add TODO/.test(button.textContent ?? '')
	);

describe('the form for a new todo (escrow01)', () => {
	it('is one line: the text, and the button beside it', async () => {
		render(AddTodoForm, { delegationEnabled: true, budgetEnabled: true });

		const input = page.getByPlaceholder('What needs to be done?');
		await expect.element(input).toBeVisible();
		expect(submitButtons()).toHaveLength(1);
		// Beside the field, not under it.
		const field = input.element().getBoundingClientRect();
		const button = submitButtons()[0].getBoundingClientRect();
		expect(Math.abs(button.top - field.top)).toBeLessThan(field.height);
		expect(document.querySelector('[data-testid="add-todo-delegation"]')).toBeNull();
	});

	it('folds out delegation, deadline and budget on request, and the button follows them', async () => {
		render(AddTodoForm, { delegationEnabled: true, budgetEnabled: true });

		await page.getByTestId('add-todo-delegate-toggle').click();
		await expect.element(page.getByTestId('add-todo-budget')).toBeVisible();

		// Still exactly one: a test, and a person, looking for "the" button must
		// not find two.
		expect(submitButtons()).toHaveLength(1);
		const budget = page.getByTestId('add-todo-budget').element().getBoundingClientRect();
		expect(submitButtons()[0].getBoundingClientRect().top).toBeGreaterThan(budget.bottom);
	});

	it('folds back to one line once the todo is added, so the list is in view again', async () => {
		render(
			AddTodoForm,
			withEvents({ props: { delegationEnabled: true }, events: { add: () => {} } })
		);

		await page.getByTestId('add-todo-delegate-toggle').click();
		await page.getByPlaceholder('What needs to be done?').fill('Unterlagen prüfen');
		await page.getByTestId('add-todo-delegate-did').fill('did:key:z6MkexampleDelegate');
		await page.getByRole('button', { name: 'Add TODO' }).click();

		await expect
			.poll(() => document.querySelector('[data-testid="add-todo-delegation"]'))
			.toBeNull();
		await expect.element(page.getByTestId('add-todo-delegate-toggle')).not.toBeChecked();
		expect(submitButtons()).toHaveLength(1);
	});

	it('adds the todo from the button beside the field', async () => {
		/** @type {any[]} */
		const added = [];
		render(
			AddTodoForm,
			withEvents({
				props: { delegationEnabled: false },
				events: { add: (/** @type {CustomEvent} */ event) => added.push(event.detail) }
			})
		);

		await page.getByPlaceholder('What needs to be done?').fill('Unterlagen anfordern');
		await page.getByRole('button', { name: 'Add TODO' }).click();

		await expect.poll(() => added.length).toBe(1);
		expect(added[0]).toMatchObject({ text: 'Unterlagen anfordern', delegateDid: null });
	});
});
