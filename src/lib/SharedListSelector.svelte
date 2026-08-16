<script>
	import { generateSpanishMnemonic, normalizeSpanishMnemonic } from './spanish-mnemonic.js';

	export let value = '';
	export let disabled = false;

	let copied = false;
	let touched = false;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let copiedTimeout = null;

	$: validation = validate(value);

	function generateNew() {
		value = generateSpanishMnemonic();
		touched = true;
	}

	async function copyMnemonic() {
		if (!validation.canonical) return;
		await navigator.clipboard.writeText(validation.canonical);
		copied = true;
		if (copiedTimeout) clearTimeout(copiedTimeout);
		copiedTimeout = setTimeout(() => (copied = false), 2000);
	}

	/** @param {string} input */
	function validate(input) {
		try {
			return { canonical: normalizeSpanishMnemonic(input), error: '' };
		} catch (error) {
			return { canonical: '', error: error instanceof Error ? error.message : String(error) };
		}
	}
</script>

<section
	class="rounded-lg border border-cyan-200 bg-cyan-50 p-4"
	data-testid="shared-list-selector"
>
	<label for="shared-list-mnemonic" class="block text-sm font-semibold text-heading">
		Shared list mnemonic
	</label>
	<p id="shared-list-help" class="mt-1 text-xs leading-relaxed text-text">
		Share these three Spanish words to join the same public writable OrbitDB list. This is a share
		code, not a password or encryption key.
	</p>
	<input
		id="shared-list-mnemonic"
		data-testid="shared-list-mnemonic-input"
		bind:value
		{disabled}
		on:input={() => (touched = true)}
		aria-describedby="shared-list-help shared-list-error"
		aria-invalid={validation.error ? 'true' : 'false'}
		class="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-cyan-500 disabled:bg-surface-2"
		placeholder="luna-camino-verde"
	/>
	{#if validation.error && touched}
		<p id="shared-list-error" role="alert" class="mt-1 text-xs text-danger-700">
			{validation.error}
		</p>
	{:else}
		<p id="shared-list-error" class="sr-only">Enter exactly three valid Spanish words.</p>
	{/if}
	<div class="mt-3 flex flex-wrap gap-2">
		<button
			type="button"
			on:click={generateNew}
			{disabled}
			class="rounded-md border border-cyan-300 bg-surface px-3 py-1.5 text-xs font-medium text-cyan-800 hover:bg-cyan-100 disabled:opacity-50"
		>
			Generate new
		</button>
		<button
			type="button"
			on:click={copyMnemonic}
			disabled={disabled || !validation.canonical}
			class="rounded-md border border-cyan-300 bg-surface px-3 py-1.5 text-xs font-medium text-cyan-800 hover:bg-cyan-100 disabled:opacity-50"
		>
			{copied ? 'Copied!' : 'Copy'}
		</button>
	</div>
</section>
