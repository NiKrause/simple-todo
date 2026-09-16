<script>
	// The technical level of one budget step (escrow01), shown only while the
	// page's technical view is on. The simple level is the sentence the parent
	// already shows where the step happens; this sits next to it.
	//
	// Made for a projector: a titled block whose sections open one at a time,
	// short points instead of paragraphs, code set apart, and under each section
	// the documents it restates. Everything is rendered as text — a point marks
	// code with backticks and nothing else in it is interpreted — and links are
	// built only from the evidence table in `explanations/index.js`.
	import { _, locale } from '$lib/i18n/index.js';
	import { technicalView } from './technical-view.js';
	import { EVIDENCE, explanation, segments, shortHash, sourceLabel } from './explanations/index.js';

	/** @type {import('./explanations/index.js').StepId} */
	export let step;
	/**
	 * Folded to its title line until opened. For places that repeat, like a
	 * todo row; a single place shows its section headings straight away.
	 */
	export let collapsible = false;
	/** Every section open from the start. */
	export let expanded = false;
	/** Whether the budget on screen runs against the fake rather than a chain. */
	export let simulated = false;
	export let className = '';

	$: content = explanation(step, $locale);

	/**
	 * A source as one line of text: the document and its section heading.
	 *
	 * @param {import('./explanations/index.js').SourceId} id
	 * @param {string | null | undefined} language
	 */
	function sourceText(id, language) {
		const label = sourceLabel(id, language);
		return `${label.file} › ${label.heading.split('`').join('')}`;
	}
</script>

{#if $technicalView && content}
	<details
		class="group/technical rounded-lg border border-l-4 border-border border-l-infra bg-surface-2 text-left {className}"
		open={!collapsible}
		data-testid="technical-explanation"
		data-step={step}
	>
		<summary
			class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 sm:px-4 [&::-webkit-details-marker]:hidden"
		>
			<span
				class="shrink-0 rounded bg-infra-200 px-1.5 py-0.5 text-xs font-semibold text-infra-800 dark:bg-infra/15 dark:text-infra"
				>{$_('technical.tag')}</span
			>
			<span
				class="min-w-0 flex-1 text-sm font-semibold text-heading sm:text-base"
				data-testid="technical-title"
				>{#each segments(content.title) as part, index (index)}{#if part.code}<code
							class="font-mono text-[0.9em]">{part.text}</code
						>{:else}{part.text}{/if}{/each}</span
			>
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="shrink-0 text-faint transition-transform group-open/technical:rotate-90"
				aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg
			>
		</summary>

		<div class="px-3 pb-2 sm:px-4">
			{#if simulated && step !== 'demo'}
				<p class="pb-2 text-xs text-text/80" data-testid="technical-simulated">
					{$_('technical.simulated')}
				</p>
			{/if}
			{#each content.sections as section, sectionIndex (sectionIndex)}
				<details
					class="group/section border-t border-border"
					open={expanded}
					data-testid="technical-section"
				>
					<summary
						class="flex cursor-pointer list-none items-center gap-2 py-2 [&::-webkit-details-marker]:hidden"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="shrink-0 text-infra-800 transition-transform group-open/section:rotate-90 dark:text-infra"
							aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg
						>
						<span class="text-sm font-semibold text-heading sm:text-[0.95rem]"
							>{section.heading}</span
						>
					</summary>
					<div class="pb-3 sm:pl-5">
						<ul
							class="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-text sm:text-[0.95rem]"
						>
							{#each section.points as point, pointIndex (pointIndex)}
								<li data-testid="technical-point">
									{#each segments(point) as part, partIndex (partIndex)}{#if part.code}<code
												class="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] break-words text-heading"
												>{part.text}</code
											>{:else}{part.text}{/if}{/each}
								</li>
							{/each}
						</ul>
						{#if section.links?.length}
							<ul class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 pl-4 text-sm">
								{#each section.links as link (link.evidence)}
									<li>
										<a
											href={EVIDENCE[link.evidence].href}
											target="_blank"
											rel="noopener noreferrer"
											class="font-medium text-cyan-800 underline underline-offset-2 hover:text-cyan-700 dark:text-cyan dark:hover:text-cyan-300"
											data-testid="technical-evidence"
											data-evidence={link.evidence}
										>
											{link.label}
											<code class="font-mono text-[0.85em]"
												>{shortHash(EVIDENCE[link.evidence].hash)}</code
											>
											<span aria-hidden="true">↗</span>
											<span class="sr-only">({$_('technical.newTab')})</span>
										</a>
									</li>
								{/each}
							</ul>
						{/if}
						<p class="mt-2 pl-4 text-xs text-text/80" data-testid="technical-sources">
							{$_('technical.documentedIn')}:
							{#each section.sources as id (id)}
								<span class="after:content-[';_'] last:after:content-none"
									>{sourceText(id, $locale)}</span
								>
							{/each}
						</p>
					</div>
				</details>
			{/each}
		</div>
	</details>
{/if}
