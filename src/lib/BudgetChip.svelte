<script>
	// One todo's budget in one chip (escrow01): amount and status. The amount is
	// what the budget service decrypts, never a number stored with the todo.
	import { _, locale } from '$lib/i18n/index.js';
	import BudgetIcon from './BudgetIcon.svelte';
	import { formatAmount } from './budget.js';
	import { amountFor, budgetInfo } from './budget-store.js';

	/** @type {import('./budget.js').Budget} */
	export let budget;
	export let todoKey = '';
	/** Whose escrow it is: escrows are keyed by creator and `todoRef`. */
	/** @type {string | null} */
	export let creatorDid = null;

	$: amount = amountFor({ todoKey, creatorDid, budget });
	$: status = budget.status;
	// An underfunded lock went through and holds an encrypted 0: "not locked"
	// would say the opposite of what the chain did.
	$: statusLabel =
		status === 'failed' && budget.lastError === 'insufficient-balance'
			? 'budget.status.underfunded'
			: `budget.status.${status}`;
	$: busy = status === 'locking' || status === 'releasing' || $amount.state === 'decrypting';
	$: known = $amount.state === 'ready' && $amount.units !== null;
	$: amountText =
		known && $amount.units !== null
			? formatAmount($amount.units, {
					decimals: budgetInfo.token.decimals,
					locale: $locale ?? 'en'
				})
			: '•••';
	$: explanation =
		$amount.state === 'decrypting'
			? $_('budget.chip.decrypting')
			: $amount.state === 'expired'
				? $_('budget.chip.expired')
				: $amount.state === 'hidden'
					? $_('budget.chip.hidden')
					: '';
</script>

{#if status !== 'none'}
	<span
		class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap {status ===
		'released'
			? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
			: status === 'failed'
				? 'border-danger-400 bg-danger-100 text-danger-700 dark:border-danger/40 dark:bg-danger/10 dark:text-danger'
				: 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan/40 dark:bg-cyan/10 dark:text-cyan'}"
		title={explanation || undefined}
		data-testid="todo-budget"
		data-status={status}
		data-amount-state={$amount.state}
	>
		{#if busy}
			<span
				class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
				aria-hidden="true"
			></span>
		{:else if status === 'funded'}
			<BudgetIcon name="lock" size={12} />
		{:else if status === 'released'}
			<BudgetIcon name="check" size={12} strokeWidth={3} />
		{/if}
		<span class="tabular-nums">
			{#if known}{amountText}{:else}<span aria-hidden="true">{amountText}</span><span
					class="sr-only">{explanation}</span
				>{/if}
			{budgetInfo.token.symbol}
		</span>
		<span aria-hidden="true">·</span>
		<span>{$_(statusLabel)}</span>
	</span>
{/if}
