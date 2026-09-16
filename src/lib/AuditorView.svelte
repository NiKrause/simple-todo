<script>
	// The auditor's view of the escrow (escrow01): every lock with its parties
	// and amount, read through the escrow's access list, and none of the todos.
	import { onMount } from 'svelte';
	import { _, locale } from '$lib/i18n/index.js';
	import BudgetIcon from './BudgetIcon.svelte';
	import ErrorAlert from './ErrorAlert.svelte';
	import { budgetErrorCode, formatAmount } from './budget.js';
	import {
		budgetInfo,
		budgetService,
		readKeyStore,
		refreshReadKey,
		renewReadAccess
	} from './budget-store.js';
	import { shortId } from './utils.js';

	/** @type {import('./budget-service.js').AuditorEscrow[]} */
	let rows = [];
	/** @type {'loading' | 'ready' | 'expired' | 'error'} */
	let state = 'loading';
	let renewing = false;

	async function load() {
		state = 'loading';
		try {
			rows = await budgetService.listEscrowsForAuditor();
			state = 'ready';
		} catch (error) {
			state = budgetErrorCode(error) === 'read-access-expired' ? 'expired' : 'error';
			// So a renewal from anywhere on the page is noticed here.
			if (state === 'expired') void refreshReadKey();
		}
	}

	async function renew() {
		renewing = true;
		try {
			if ((await renewReadAccess()).ok) await load();
		} finally {
			renewing = false;
		}
	}

	// Read access renewed elsewhere on the page counts here too.
	$: readKeyValid = $readKeyStore?.state === 'valid';
	$: if (readKeyValid) reloadIfExpired();

	function reloadIfExpired() {
		if (state === 'expired') void load();
	}

	/** @param {import('./budget-service.js').BudgetParty} party */
	const partyName = (party) => party.label ?? shortId(party.did ?? party.account ?? '');

	onMount(() => {
		void load();
	});
</script>

<div
	class="mb-6 flex items-start gap-2.5 rounded border border-cyan-400 bg-cyan-100 px-4 py-3 text-sm text-cyan-800 dark:border-cyan/40 dark:bg-cyan/10 dark:text-cyan"
	data-testid="auditor-banner"
>
	<BudgetIcon name="shield" className="mt-0.5" />
	<span>
		{$_('budget.auditor.banner')}
		{#if !budgetInfo.confidential}
			<span class="mt-1 block">{$_('budget.demoNotice')}</span>
		{/if}
	</span>
</div>

{#if state === 'expired'}
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
				data-testid="auditor-renew-read">{$_('budget.notice.renew')}</button
			>
		</svelte:fragment>
	</ErrorAlert>
{:else if state === 'error'}
	<ErrorAlert error={$_('budget.auditor.error')} />
{/if}

<section class="mb-6 rounded-lg bg-surface p-6 shadow-md" data-testid="auditor-view">
	<h2 class="mb-4 text-xl font-semibold">{$_('budget.auditor.heading')}</h2>

	{#if state === 'loading'}
		<p class="flex items-center gap-2.5 text-sm text-text" data-testid="auditor-loading">
			<span
				class="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-border border-t-cyan-700 dark:border-t-cyan"
				aria-hidden="true"
			></span>
			{$_('budget.notice.decrypting')}
		</p>
	{:else if state === 'ready' && rows.length === 0}
		<p class="py-6 text-center text-faint">{$_('budget.auditor.empty')}</p>
	{:else if state === 'ready'}
		<div class="overflow-x-auto">
			<table class="w-full min-w-[36rem] text-left text-sm text-text">
				<thead>
					<tr
						class="border-b border-border text-xs font-semibold tracking-wide text-faint uppercase"
					>
						<th scope="col" class="pr-2 pb-2 font-semibold">{$_('budget.auditor.reference')}</th>
						<th scope="col" class="pr-2 pb-2 font-semibold">{$_('budget.auditor.from')}</th>
						<th scope="col" class="pr-2 pb-2 font-semibold">{$_('budget.auditor.to')}</th>
						<th scope="col" class="pr-2 pb-2 text-right font-semibold"
							>{$_('budget.auditor.amount')}</th
						>
						<th scope="col" class="pb-2 pl-4 font-semibold">{$_('budget.auditor.status')}</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (`${row.creator.did ?? row.creator.account}:${row.todoRef}`)}
						<tr class="border-b border-border/60 last:border-b-0" data-testid="auditor-row">
							<td class="py-3 pr-2"
								><code class="font-mono text-xs" title={row.todoRef}>{shortId(row.todoRef)}</code
								></td
							>
							<td class="py-3 pr-2" title={row.creator.did ?? row.creator.account ?? ''}
								>{partyName(row.creator)}</td
							>
							<td class="py-3 pr-2" title={row.beneficiary.did ?? row.beneficiary.account ?? ''}
								>{partyName(row.beneficiary)}</td
							>
							<td class="py-3 pr-2 text-right font-semibold text-heading tabular-nums"
								>{formatAmount(row.amount, {
									decimals: budgetInfo.token.decimals,
									locale: $locale ?? 'en'
								})}
								{budgetInfo.token.symbol}</td
							>
							<td
								class="py-3 pl-4 {row.status === 'released'
									? 'text-emerald-700 dark:text-emerald-400'
									: row.status === 'locked'
										? 'text-cyan-800 dark:text-cyan'
										: 'text-faint'}">{$_(`budget.auditor.${row.status}`)}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="mt-4 text-xs text-faint">{$_('budget.auditor.footnote')}</p>
	{/if}
</section>
