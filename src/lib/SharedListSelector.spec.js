import { page } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SharedListSelector from './SharedListSelector.svelte';
import { isValidSpanishMnemonic } from './spanish-mnemonic.js';

describe('SharedListSelector', () => {
	it('generates, validates and copies a canonical mnemonic', async () => {
		const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
		render(SharedListSelector, { value: 'luna-camino-verde' });
		const input = page.getByTestId('shared-list-mnemonic-input');
		await expect.element(input).toHaveValue('luna-camino-verde');

		await page.getByRole('button', { name: 'Copy', exact: true }).click();
		expect(writeText).toHaveBeenCalledWith('luna-camino-verde');
		await expect.element(page.getByRole('button', { name: 'Copied!', exact: true })).toBeVisible();

		await page.getByRole('button', { name: 'Generate new' }).click();
		const generatedValue = /** @type {HTMLInputElement} */ (input.element()).value;
		expect(isValidSpanishMnemonic(generatedValue)).toBe(true);
	});

	it('shows an accessible validation error for an unknown word', async () => {
		render(SharedListSelector, { value: 'luna-camino-verde' });
		const input = page.getByTestId('shared-list-mnemonic-input');
		await input.fill('luna-desconocida-verde');
		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('Unknown Spanish share-code word');
		await expect.element(input).toHaveAttribute('aria-invalid', 'true');
	});
});
