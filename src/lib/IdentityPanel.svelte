<script>
	import { _ } from '$lib/i18n/index.js';
	// Identity, chosen inside the running app instead of in front of it.
	//
	// The other chapters put this in the consent modal, which had one property
	// that mattered and was easy to miss: WebAuthn refuses to run outside a user
	// gesture, and the modal's "proceed" click was that gesture. Deleting the
	// modal without replacing it would not have removed a screen — it would have
	// removed the only way to ever create or recover a passkey, on the very
	// chapter whose unguessable list addresses depend on having an identity.
	//
	// So the app starts anonymously with no interaction at all, and every
	// WebAuthn call below sits behind a button, which is the gesture.
	//
	// It lives at the top of the status panel rather than further down the page:
	// who a list belongs to is the first thing to settle, and the DID it
	// produces belongs next to the control that made it rather than in the page
	// header, far away from it.
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
	let copied = false;

	const hasStoredPasskey = hasStoredPasskeyCredential();

	$: usingPasskey = $ownDidStore?.startsWith('did:') ?? false;

	/** @param {string} value */
	function shortDid(value) {
		if (value.length <= 24) return value;
		return `${value.slice(0, 14)}…${value.slice(-6)}`;
	}

	async function copyDid() {
		try {
			await navigator.clipboard.writeText($ownDidStore ?? '');
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (err) {
			console.warn('Clipboard unavailable:', err);
		}
	}

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

<section class="mt-3 border-t border-border pt-2" data-testid="identity-panel">
	{#if usingPasskey}
		<!-- Settled: the DID and nothing else, in the colour it carried in the
		     header, now beside the control that produced it. -->
		<div
			class="flex items-center gap-2 px-1 py-1 text-xs"
			data-testid="own-did-badge"
			title={$ownDidStore}
		>
			<span class="font-semibold text-emerald-700 dark:text-emerald-300">Passkey DID</span>
			<code
				class="min-w-0 truncate font-mono text-faint"
				data-testid="own-did-value"
				data-did={$ownDidStore}>{shortDid($ownDidStore ?? '')}</code
			>
			<button
				type="button"
				on:click={copyDid}
				class="shrink-0 rounded border border-emerald-300 px-1.5 py-0.5 hover:bg-emerald-100 dark:border-emerald-700 dark:hover:bg-emerald-900"
				data-testid="own-did-copy">{copied ? 'Copied ✓' : 'Copy'}</button
			>
		</div>
	{:else}
		<!-- Unsettled: open, not folded away. Anything a person has to decide
		     before the rest of the page makes sense should not need a click to
		     be discovered. -->
		<div class="px-1 py-1">
			<div class="flex items-center gap-2 text-xs font-medium text-text">
				<span>{$_('identity.heading')}</span>
				<span class="font-normal text-faint">· {$_('identity.anonymous')}</span>
			</div>
			<p class="mt-1 text-xs text-faint">
				{#if hasStoredPasskey}
					<!-- Every reload lands here, and silently: WebAuthn cannot be
					     prompted from `onMount`, so a passkey session always restarts
					     anonymous. The registry is keyed to a signing identity, so
					     lists made with the passkey are not gone but not visible
					     either — say so, because an empty switcher reads as data loss. -->
					{$_('identity.passkeyHidden')}
				{:else}
					{$_('identity.explain')}
				{/if}
			</p>

			{#if error}
				<p class="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="identity-error">
					{error}
				</p>
			{/if}

			<div class="mt-2 flex flex-wrap gap-2">
				<button
					type="button"
					class="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
					disabled={state === 'busy'}
					on:click={() => (showCreateForm = !showCreateForm)}
					data-testid="identity-create-toggle">{$_('identity.create')}</button
				>
				<button
					type="button"
					class="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
					disabled={state === 'busy'}
					on:click={recover}
					data-testid="identity-recover"
				>
					{hasStoredPasskey ? $_('identity.useOnDevice') : $_('identity.use')}
				</button>
			</div>

			{#if showCreateForm}
				<div class="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
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
		</div>
	{/if}
</section>
