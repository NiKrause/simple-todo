<script>
	// The session's confidential balance (escrow01), decrypted by the budget
	// service. Shown once a budget has been paid out to this session.
	import { onMount } from 'svelte';
	import { _, locale } from '$lib/i18n/index.js';
	import BudgetIcon from './BudgetIcon.svelte';
	import { formatAmount } from './budget.js';
	import { balanceStore, budgetInfo, refreshBalance } from './budget-store.js';

	onMount(() => {
		void refreshBalance();
	});

	$: balance = $balanceStore;
</script>

<section
	class="mb-6 flex flex-col gap-4 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
	data-testid="budget-balance"
	data-state={balance.state}
>
	<div>
		<h2 class="text-sm font-medium text-faint">{$_('budget.balance.heading')}</h2>
		{#if balance.state === 'ready' && balance.units !== null}
			<p
				class="mt-0.5 text-3xl font-bold text-heading tabular-nums"
				data-testid="budget-balance-value"
			>
				{formatAmount(balance.units, {
					decimals: budgetInfo.token.decimals,
					locale: $locale ?? 'en'
				})}
				{budgetInfo.token.symbol}
			</p>
		{:else if balance.state === 'expired'}
			<p class="mt-1 text-sm text-text">{$_('budget.notice.expiredTitle')}</p>
		{:else if balance.state === 'hidden'}
			<p class="mt-1 text-sm text-text">{$_('budget.balance.hidden')}</p>
		{:else}
			<p class="mt-1 flex items-center gap-2 text-sm text-text">
				<span
					class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-border border-t-cyan-700 dark:border-t-cyan"
					aria-hidden="true"
				></span>
				{$_('budget.notice.decrypting')}
			</p>
		{/if}
	</div>
	<p class="flex max-w-sm items-start gap-2 text-xs text-faint">
		<BudgetIcon name="shield" className="mt-px text-cyan-800 dark:text-cyan" />
		<span>
			{$_('budget.balance.note')}
			{#if !budgetInfo.confidential}
				<span class="mt-1 block">{$_('budget.demoNotice')}</span>
			{/if}
		</span>
	</p>
</section>
