<script>
	// The passkey prompt before a delegated write, made visible (delegation01).
	// Idle most of the time; shows "awaiting" while the authenticator is up,
	// then the outcome for a few seconds. Also what the E2E test watches.
	import { delegatedWriteAuthStore } from './delegated-write-auth.js';

	$: auth = $delegatedWriteAuthStore;
	$: label =
		auth.state === 'awaiting'
			? 'Confirm passkey…'
			: auth.state === 'success'
				? 'Delegated write signed'
				: auth.state === 'error'
					? 'Passkey confirmation failed'
					: '';
</script>

<span
	class="rounded-md border px-2 py-1 text-xs font-semibold {auth.state === 'awaiting'
		? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'
		: auth.state === 'success'
			? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
			: auth.state === 'error'
				? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300'
				: 'hidden'}"
	title={auth.message}
	data-testid="delegated-auth-state"
	data-state={auth.state}
	data-action={auth.action ?? ''}
>
	{label}
</span>
