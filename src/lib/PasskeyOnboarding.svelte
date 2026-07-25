<script>
	// Identity chooser for the onboarding modal: every user decides before the
	// P2P stack starts whether this session uses a passkey-backed DID identity
	// (new or recovered) or the anonymous throwaway identity from the previous
	// chapters. The actual WebAuthn calls happen in +page.svelte on proceed —
	// they need the button click's user gesture.
	import { hasStoredPasskeyCredential } from './passkey-identity.js';

	/** @type {'create' | 'existing' | 'anonymous'} */
	export let mode = 'anonymous';
	export let userId = '';
	export let displayName = '';

	const hasStoredPasskey = hasStoredPasskeyCredential();

	const options = [
		{
			value: 'create',
			label: 'Create a passkey',
			hint: 'Register a new WebAuthn passkey and derive your OrbitDB identity (DID) from it.'
		},
		{
			value: 'existing',
			label: 'Use an existing passkey',
			hint: hasStoredPasskey
				? 'A passkey from an earlier session was found on this device.'
				: 'Recover your identity from a passkey created earlier on this origin.'
		},
		{
			value: 'anonymous',
			label: 'Continue without a passkey',
			hint: 'Use a random per-browser identity, exactly like the previous chapter.'
		}
	];
</script>

<fieldset class="mb-4 rounded-lg border border-gray-200 p-3" data-testid="passkey-onboarding">
	<legend class="px-1 text-sm font-semibold">Your identity</legend>
	<div class="space-y-2">
		{#each options as option (option.value)}
			<label class="flex cursor-pointer items-start gap-2 text-sm">
				<input
					type="radio"
					name="identity-mode"
					value={option.value}
					bind:group={mode}
					data-testid={`identity-mode-${option.value}`}
					class="mt-0.5"
				/>
				<span>
					<span class="font-medium">{option.label}</span>
					<span class="block text-xs text-gray-500">{option.hint}</span>
				</span>
			</label>
		{/each}
	</div>

	{#if mode === 'create'}
		<div class="mt-3 grid gap-2 sm:grid-cols-2">
			<input
				type="text"
				bind:value={userId}
				placeholder="user id (e.g. alice@example.com)"
				data-testid="passkey-user-id"
				class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
			/>
			<input
				type="text"
				bind:value={displayName}
				placeholder="display name (e.g. Alice)"
				data-testid="passkey-display-name"
				class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
			/>
		</div>
	{/if}
</fieldset>
