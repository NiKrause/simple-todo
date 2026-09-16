<script>
	// The passkey prompt before a delegated write, made visible (delegation01).
	// Idle most of the time; shows "awaiting" while the authenticator is up,
	// then the outcome for a few seconds. Also what the E2E test watches.
	//
	// escrow01: locking and releasing a budget, and renewing read access, ask
	// the same passkey through the same prompt, so they show here as well —
	// with their own word for success, because nothing was "written" yet.
	import { _ } from '$lib/i18n/index.js';
	import { delegatedWriteAuthStore } from './delegated-write-auth.js';

	/** @param {string | null} action */
	function successKey(action) {
		switch (action) {
			case 'budget-lock':
				return 'auth.lockConfirmed';
			case 'budget-release':
				return 'auth.releaseConfirmed';
			case 'budget-read-key':
				return 'auth.readKeyRenewed';
			default:
				return 'auth.delegatedWriteSigned';
		}
	}

	$: auth = $delegatedWriteAuthStore;
	$: label =
		auth.state === 'awaiting'
			? $_('auth.awaiting')
			: auth.state === 'success'
				? $_(successKey(auth.action))
				: auth.state === 'error'
					? $_('auth.failed')
					: '';
	// The error keeps the authenticator's own message; the rest say it in the
	// language on screen.
	$: title =
		auth.state === 'error'
			? auth.message
			: auth.state === 'awaiting'
				? $_('auth.awaitingTitle')
				: label;
</script>

<span
	class="rounded-md border px-2 py-1 text-xs font-semibold {auth.state === 'awaiting'
		? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'
		: auth.state === 'success'
			? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
			: auth.state === 'error'
				? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300'
				: 'hidden'}"
	{title}
	data-testid="delegated-auth-state"
	data-state={auth.state}
	data-action={auth.action ?? ''}
>
	{label}
</span>
