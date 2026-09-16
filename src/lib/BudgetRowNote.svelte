<script>
	// What a todo's budget means right now, under its row (escrow01): one plain
	// sentence always, and in the technical view the step behind it — reading a
	// locked amount, the release, the encrypted zero of an underfunded lock.
	import { _ } from '$lib/i18n/index.js';
	import BudgetIcon from './BudgetIcon.svelte';
	import TechnicalExplanation from './TechnicalExplanation.svelte';
	import { budgetNote } from './explanations/index.js';
	import { budgetInfo, budgetNoticeStore } from './budget-store.js';

	/** @type {import('./budget.js').Budget} */
	export let budget;
	export let todoKey = '';
	/** @type {'owner' | 'beneficiary' | 'other'} */
	export let perspective = 'other';
	export let completed = false;
	/** The other party, as the row writes it: the delegate for the owner, the owner for the delegate. */
	export let party = '';

	$: note = budgetNote({
		status: budget.status,
		lastError: budget.lastError,
		perspective,
		completed
	});
	// A failure the notice above the list is explaining right now is explained
	// there, not a second time in the row.
	$: explainedAbove =
		budget.status === 'failed' &&
		$budgetNoticeStore !== null &&
		$budgetNoticeStore.todoKey === todoKey;
</script>

{#if note.message}
	<div class="mt-1.5" data-testid="todo-budget-note" data-note={note.message} data-step={note.step}>
		<!-- pl-12 lines the sentence up with the row's text, past the status dot and checkbox. -->
		<p class="flex items-start gap-1.5 pl-12 text-xs text-text sm:text-sm">
			<BudgetIcon name={note.icon} size={14} className="mt-0.5 text-faint sm:mt-[3px]" />
			<span>{$_(note.message, { values: { party } })}</span>
		</p>
		{#if note.step && !explainedAbove}
			<TechnicalExplanation
				step={note.step}
				collapsible
				simulated={!budgetInfo.confidential}
				className="mt-2 sm:ml-12"
			/>
		{/if}
	</div>
{/if}
