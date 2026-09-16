<script>
	import { createEventDispatcher } from 'svelte';
	import { _, locale } from '$lib/i18n/index.js';
	import BudgetIcon from './BudgetIcon.svelte';
	import { numberSeparators, parseAmount } from './budget.js';

	/** @type {string | null} */
	export let placeholder = null;
	/** @type {string | null} */
	export let buttonText = null;
	export let disabled = false;
	/**
	 * delegation01: whether the active list's access controller accepts
	 * delegation actions. The shared mnemonic list (IPFS controller,
	 * `write: ['*']`) does not — everyone may write there anyway.
	 */
	export let delegationEnabled = false;
	/**
	 * escrow01: whether this session can lock a budget for a delegated todo.
	 * The budget is paid to the delegate, so it only exists alongside one.
	 */
	export let budgetEnabled = false;
	export let budgetToken = 'cUSDT';
	export let budgetDecimals = 6;
	/** Whether the budget service really encrypts. The fake does not, and says so. */
	export let budgetConfidential = false;

	let inputText = '';
	let showDelegation = false;
	let delegateDid = '';
	let delegationExpiresAt = '';
	let budgetInput = '';
	/** @type {string | null} */
	let budgetError = null;
	const dispatch = createEventDispatcher();

	$: offerBudget = budgetEnabled && delegationEnabled && showDelegation;
	$: withBudget = offerBudget && budgetInput.trim() !== '';
	$: budgetUnits = parseAmount(budgetInput, { decimals: budgetDecimals, locale: $locale ?? 'en' });
	$: if (!withBudget) budgetError = null;

	function handleSubmit() {
		if (!inputText || inputText.trim() === '') return;

		if (withBudget) {
			// Nothing is written until the budget is something that can be locked:
			// a todo whose budget cannot even start would only have to be cleaned up.
			if (budgetUnits === null) {
				budgetError = $_('budget.form.invalidAmount', { values: { decimals: budgetDecimals } });
				return;
			}
			if (!delegateDid.trim()) {
				budgetError = $_('budget.form.needsDelegate');
				return;
			}
		}
		budgetError = null;

		dispatch('add', {
			text: inputText.trim(),
			delegateDid: delegationEnabled && showDelegation ? delegateDid.trim() || null : null,
			// datetime-local gives a local wall-clock string; store it as an instant.
			delegationExpiresAt:
				delegationEnabled && showDelegation && delegationExpiresAt
					? new Date(delegationExpiresAt).toISOString()
					: null,
			// escrow01: base units of the token, or null. Never written to the todo.
			budgetAmount: withBudget ? budgetUnits : null
		});

		inputText = '';
		delegateDid = '';
		delegationExpiresAt = '';
		budgetInput = '';
	}

	/**
	 * @param {KeyboardEvent} event
	 */
	function handleKeydown(event) {
		if (event.key === 'Enter') {
			handleSubmit();
		}
	}
</script>

<div class="mb-6 rounded-lg bg-surface p-6 shadow-md">
	<h2 class="mb-4 text-xl font-semibold">{$_('todo.form.heading')}</h2>
	<div class="space-y-4">
		<input
			type="text"
			bind:value={inputText}
			placeholder={placeholder ?? $_('todo.form.placeholder')}
			{disabled}
			class="w-full rounded-md border border-border px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:bg-surface-2"
			on:keydown={handleKeydown}
		/>

		{#if delegationEnabled}
			<label class="flex items-center gap-2 text-sm text-faint">
				<input
					type="checkbox"
					bind:checked={showDelegation}
					{disabled}
					class="h-4 w-4 rounded text-cyan-600 focus:ring-cyan-500"
					data-testid="add-todo-delegate-toggle"
				/>
				{$_('todo.form.delegateToggle')}
			</label>
		{/if}

		{#if delegationEnabled && showDelegation}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="add-todo-delegation">
				<div>
					<label for="add-todo-delegate-did" class="mb-1 block text-sm font-medium text-heading">
						{$_('todo.form.delegateDid')}
					</label>
					<input
						id="add-todo-delegate-did"
						type="text"
						bind:value={delegateDid}
						{disabled}
						placeholder={$_('todo.form.delegateDidPlaceholder')}
						data-testid="add-todo-delegate-did"
						class="w-full rounded-md border border-border px-4 py-2 font-mono text-xs focus:border-transparent focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:bg-surface-2"
					/>
				</div>
				<div>
					<label
						for="add-todo-delegation-expiry"
						class="mb-1 block text-sm font-medium text-heading"
					>
						{$_('todo.form.expiry')}
						<span class="font-normal text-faint">{$_('todo.form.optional')}</span>
					</label>
					<input
						id="add-todo-delegation-expiry"
						type="datetime-local"
						bind:value={delegationExpiresAt}
						{disabled}
						data-testid="add-todo-delegation-expiry"
						class="w-full rounded-md border border-border px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:bg-surface-2"
					/>
				</div>
				{#if offerBudget}
					<div class="sm:col-span-2">
						<label for="add-todo-budget" class="mb-1 block text-sm font-medium text-heading">
							{$_('budget.form.label')}
							<span class="font-normal text-faint">{$_('budget.form.confidential')}</span>
						</label>
						<div class="flex w-full max-w-80 items-stretch">
							<input
								id="add-todo-budget"
								type="text"
								inputmode="decimal"
								autocomplete="off"
								bind:value={budgetInput}
								{disabled}
								placeholder={`0${numberSeparators($locale ?? 'en').decimal}00`}
								aria-invalid={budgetError ? 'true' : undefined}
								aria-describedby={budgetError ? 'add-todo-budget-error' : 'add-todo-budget-hint'}
								data-testid="add-todo-budget"
								class="min-w-0 flex-1 rounded-l-md rounded-r-none border border-border px-4 py-2 text-right tabular-nums focus:border-transparent focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:bg-surface-2"
							/>
							<span
								class="flex items-center gap-1.5 rounded-r-md border border-l-0 border-border bg-surface px-3 text-sm font-medium text-heading"
							>
								<BudgetIcon name="lock" size={14} className="text-cyan-800 dark:text-cyan" />
								{budgetToken}
							</span>
						</div>
						{#if budgetError}
							<p
								id="add-todo-budget-error"
								role="alert"
								class="mt-1 text-sm text-danger-700 dark:text-danger"
								data-testid="add-todo-budget-error"
							>
								{budgetError}
							</p>
						{/if}
					</div>
				{/if}
				<p class="text-xs text-faint sm:col-span-2">
					{$_('todo.form.delegateHint')}
				</p>
			</div>

			{#if offerBudget}
				<div
					id="add-todo-budget-hint"
					class="flex items-start gap-2.5 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800 dark:border-cyan/30 dark:bg-cyan/10 dark:text-cyan"
					data-testid="add-todo-budget-hint"
				>
					<BudgetIcon name="shield" className="mt-0.5" />
					<span>
						{$_('budget.form.hint')}
						{#if !budgetConfidential}
							<span class="mt-1 block text-xs">{$_('budget.demoNotice')}</span>
						{/if}
					</span>
				</div>
			{/if}
		{/if}

		<div class="flex gap-2">
			<button
				on:click={handleSubmit}
				{disabled}
				class="rounded-md bg-coral-500 px-6 py-2 font-medium text-white transition-colors hover:bg-coral-600 disabled:cursor-not-allowed disabled:bg-faint"
			>
				{withBudget ? $_('todo.form.submitWithBudget') : (buttonText ?? $_('todo.form.submit'))}
			</button>
		</div>
	</div>
</div>
