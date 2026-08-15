<script>
	// Identity, chosen inside the running app instead of in front of it.
	//
	// The other chapters put this in the consent modal, which had one property
	// that mattered and was easy to miss: WebAuthn refuses to run outside a user
	// gesture, and the modal's "proceed" click was that gesture. Deleting the
	// modal without replacing it would not have removed a screen — it would have
	// removed the only way to ever create or recover a passkey, on the very
	// chapter whose unguessable list addresses depend on having an identity.
	//
	// So the app now starts anonymously with no interaction at all, and every
	// WebAuthn call below sits behind a button, which is the gesture.
	import {
		createPasskeyCredential,
		recoverPasskeyCredential,
		hasStoredPasskeyCredential
	} from './passkey-identity.js';
	import { restartP2P, ownDidStore } from './p2p.js';

	/** @type {'idle' | 'busy'} */
	let state = 'idle';
	/** @type {string | null} */
	let error = null;
	let userId = '';
	let displayName = '';
	let showCreateForm = false;

	const hasStoredPasskey = hasStoredPasskeyCredential();

	$: usingPasskey = Boolean($ownDidStore) && $ownDidStore.startsWith('did:');

	/** @param {() => Promise<any>} obtain */
	async function adopt(obtain) {
		state = 'busy';
		error = null;
		try {
			// Must be awaited inside the click's call stack — see the note above.
			const passkeyCredential = await obtain();
			if (!passkeyCredential) {
				throw new Error('No passkey was returned. Create one first, or continue anonymously.');
			}
			await restartP2P({ passkeyCredential });
			showCreateForm = false;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			state = 'idle';
		}
	}

	const create = () =>
		adopt(() => {
			if (!userId.trim() || !displayName.trim()) {
				throw new Error('Enter a user id and a display name for the new passkey.');
			}
			return createPasskeyCredential({ userId: userId.trim(), displayName: displayName.trim() });
		});

	const recover = () => adopt(() => recoverPasskeyCredential());
</script>

<section
	class="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
	data-testid="identity-panel"
>
	<h2 class="text-sm font-semibold text-heading">Identity</h2>
	<p class="mt-1 text-xs text-faint">
		{#if usingPasskey}
			This session uses a passkey-backed DID. Lists you create can only be written by it.
		{:else if hasStoredPasskey}
			<!-- Every reload lands here, and silently: WebAuthn cannot be prompted
			     from `onMount`, so a passkey session always restarts anonymous. The
			     registry is keyed to a signing identity, so the lists made with the
			     passkey are not gone but not visible either — say so, because an
			     empty list switcher otherwise reads as data loss. -->
			This session started anonymously. A passkey exists on this device, and
			<strong>lists you created with it stay hidden until you restore it.</strong>
		{:else}
			This session uses an anonymous identity. It works, but it is gone when this browser's storage
			is cleared — a passkey survives and identifies you to the people you hand lists to.
		{/if}
	</p>

	{#if error}
		<p class="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="identity-error">{error}</p>
	{/if}

	{#if !usingPasskey}
		<div class="mt-3 flex flex-wrap gap-2">
			<button
				type="button"
				class="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
				disabled={state === 'busy'}
				on:click={() => (showCreateForm = !showCreateForm)}
				data-testid="identity-create-toggle">Create a passkey</button
			>
			<button
				type="button"
				class="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
				disabled={state === 'busy'}
				on:click={recover}
				data-testid="identity-recover"
			>
				{hasStoredPasskey ? 'Use the passkey on this device' : 'Use an existing passkey'}
			</button>
		</div>

		{#if showCreateForm}
			<div class="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
				<input
					class="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
					placeholder="User id"
					bind:value={userId}
					data-testid="identity-user-id"
				/>
				<input
					class="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
					placeholder="Display name"
					bind:value={displayName}
					data-testid="identity-display-name"
				/>
				<button
					type="button"
					class="rounded bg-cyan-600 px-2 py-1 text-xs text-white hover:bg-cyan-700 disabled:opacity-50"
					disabled={state === 'busy'}
					on:click={create}
					data-testid="identity-create">{state === 'busy' ? 'Working…' : 'Create'}</button
				>
			</div>
		{/if}
	{/if}
</section>
