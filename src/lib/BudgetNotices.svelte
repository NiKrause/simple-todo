<script>
	// What a budget action is waiting for, or why it did not happen (escrow01),
	// each in one plain sentence: the passkey prompt for a lock, a balance that
	// was too low, a decryption under way, read access that ran out, a passkey
	// prompt that was cancelled.
	import { onDestroy, onMount } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import BudgetIcon from './BudgetIcon.svelte';
	import ErrorAlert from './ErrorAlert.svelte';
	import { delegatedWriteAuthStore } from './delegated-write-auth.js';
	import {
		budgetNoticeRetryable,
		budgetNoticeStore,
		decryptingCount,
		dismissBudgetNotice,
		readKeyStore,
		refreshReadKey,
		renewReadAccess,
		retryBudgetNotice
	} from './budget-store.js';

	/** Whether any budget is in play here; read access only matters then. */
	export let active = false;

	/** Decryptions shorter than this finish before a notice would be read. */
	const DECRYPT_NOTICE_DELAY_MS = 400;

	let renewing = false;
	let showDecrypting = false;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let decryptTimer = null;

	$: auth = $delegatedWriteAuthStore;
	$: notice = $budgetNoticeStore;
	$: awaitingLock = auth.state === 'awaiting' && auth.action === 'budget-lock';
	$: expired = active && $readKeyStore?.state !== undefined && $readKeyStore.state !== 'valid';
	$: scheduleDecryptNotice($decryptingCount > 0);

	/** @param {boolean} decrypting */
	function scheduleDecryptNotice(decrypting) {
		if (!decrypting) {
			if (decryptTimer) clearTimeout(decryptTimer);
			decryptTimer = null;
			showDecrypting = false;
			return;
		}
		if (decryptTimer || showDecrypting) return;
		decryptTimer = setTimeout(() => {
			decryptTimer = null;
			showDecrypting = true;
		}, DECRYPT_NOTICE_DELAY_MS);
	}

	async function renew() {
		renewing = true;
		try {
			await renewReadAccess();
		} finally {
			renewing = false;
		}
	}

	onMount(() => {
		void refreshReadKey();
	});

	onDestroy(() => {
		if (decryptTimer) clearTimeout(decryptTimer);
	});
</script>

<div data-testid="budget-notices">
	{#if awaitingLock}
		<ErrorAlert type="info" error={$_('budget.notice.confirmLock')}>
			<BudgetIcon slot="icon" name="key" className="mt-0.5 mr-2.5" />
		</ErrorAlert>
	{/if}

	{#if notice?.code === 'passkey-cancelled'}
		<div data-testid="budget-notice" data-kind="cancelled" data-action={notice.action}>
			<ErrorAlert
				type="warning"
				inlineTitle
				title={$_('budget.notice.cancelledTitle')}
				error={$_('budget.notice.cancelled')}
				dismissible
				on:dismiss={dismissBudgetNotice}
			>
				<svelte:fragment slot="actions">
					{#if $budgetNoticeRetryable}
						<button
							type="button"
							on:click={() => void retryBudgetNotice()}
							class="rounded-md bg-coral-700 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-white hover:bg-coral-800"
							data-testid="budget-notice-retry">{$_('budget.notice.retry')}</button
						>
					{/if}
				</svelte:fragment>
			</ErrorAlert>
		</div>
	{:else if notice}
		<div data-testid="budget-notice" data-kind={notice.code} data-action={notice.action}>
			<ErrorAlert
				type="error"
				inlineTitle
				title={notice.action === 'lock'
					? $_('budget.notice.lockFailedTitle')
					: $_('budget.notice.releaseFailedTitle')}
				error={notice.action === 'release'
					? $_('budget.notice.releaseFailed')
					: notice.code === 'insufficient-balance'
						? $_('budget.notice.insufficient')
						: $_('budget.notice.lockFailed')}
				dismissible
				on:dismiss={dismissBudgetNotice}
			/>
		</div>
	{/if}

	{#if showDecrypting}
		<p
			class="mb-4 flex items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text"
			data-testid="budget-decrypting"
		>
			<span
				class="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-border border-t-cyan-700 dark:border-t-cyan"
				aria-hidden="true"
			></span>
			{$_('budget.notice.decrypting')}
		</p>
	{/if}

	{#if expired}
		<div data-testid="budget-read-expired">
			<ErrorAlert
				type="info"
				inlineTitle
				title={$_('budget.notice.expiredTitle')}
				error={$_('budget.notice.expired')}
			>
				<svelte:fragment slot="actions">
					<button
						type="button"
						on:click={renew}
						disabled={renewing}
						class="rounded-md bg-coral-700 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-white hover:bg-coral-800 disabled:opacity-50"
						data-testid="budget-renew-read">{$_('budget.notice.renew')}</button
					>
				</svelte:fragment>
			</ErrorAlert>
		</div>
	{/if}
</div>
