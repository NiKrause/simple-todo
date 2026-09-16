<script>
	// "One passkey for everything" (escrow01): the first block of the consent
	// dialog. Signing in, signing entries and paying are the same passkey, and
	// the list beside it says what is kept where.
	//
	// The budget line depends on the budget service actually in use. The fake
	// keeps amounts unencrypted in memory, and a consent screen that promised
	// encryption on a testnet it never talks to would be the one sentence here
	// that is false.
	import { _ } from '$lib/i18n/index.js';
	import BudgetIcon from './BudgetIcon.svelte';

	/** Whether budgets are really encrypted on a chain (not the in-memory fake). */
	export let confidential = false;
	/** @type {'memory' | 'indexeddb'} */
	export let storage = 'memory';

	/** @type {Array<{ icon: 'key' | 'pen' | 'lock', title: string, text: string }>} */
	const STEPS = [
		{ icon: 'key', title: 'onboarding.signInTitle', text: 'onboarding.signInText' },
		{ icon: 'pen', title: 'onboarding.signTitle', text: 'onboarding.signText' },
		{ icon: 'lock', title: 'onboarding.payTitle', text: 'onboarding.payText' }
	];

	$: stored = [
		$_('onboarding.storedDid'),
		storage === 'indexeddb'
			? $_('onboarding.storedListsPersistent')
			: $_('onboarding.storedListsMemory'),
		confidential ? $_('onboarding.storedBudgetsChain') : $_('onboarding.storedBudgetsDemo'),
		$_('onboarding.storedKeys'),
		$_('onboarding.storedPasskey')
	];
</script>

<section class="@container mb-4" data-testid="one-passkey-intro">
	<h3 class="mb-3 text-base font-bold text-heading">{$_('onboarding.heading')}</h3>
	<div class="grid grid-cols-1 gap-4 @2xl:grid-cols-[minmax(0,1fr)_17rem]">
		<div class="flex flex-col gap-4">
			<p class="text-sm leading-relaxed text-text">{$_('onboarding.intro')}</p>
			<ul class="flex flex-col gap-3 rounded-lg border border-border p-3">
				{#each STEPS as step (step.icon)}
					<li class="flex items-start gap-3">
						<span
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cyan-50 text-cyan-800 dark:bg-cyan/10 dark:text-cyan"
						>
							<BudgetIcon name={step.icon} size={20} />
						</span>
						<span>
							<span class="block text-sm font-semibold text-heading">{$_(step.title)}</span>
							<span class="block text-xs text-faint">{$_(step.text)}</span>
						</span>
					</li>
				{/each}
			</ul>
		</div>
		<div
			class="rounded-lg border border-border bg-surface-2 px-3.5 py-3 text-sm text-text"
			data-testid="one-passkey-stored"
		>
			<h4 class="text-xs font-semibold tracking-wide text-faint uppercase">
				{$_('onboarding.storedHeading')}
			</h4>
			<ul class="mt-2 flex list-disc flex-col gap-1.5 pl-4">
				{#each stored as line (line)}
					<li>{line}</li>
				{/each}
			</ul>
		</div>
	</div>
</section>
