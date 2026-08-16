<script>
	/**
	 * Le-Space logo mark — "Der erste Knoten" (the first node):
	 * a solid coral local node, cyan peer rings and dashed sync links.
	 * Theme-aware: uses the --coral / --cyan CSS variables so it adapts to
	 * light and dark mode. Source: le-space/landing docs/le-space-brand.
	 */
	let { size = 52 } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 96 96"
	xmlns="http://www.w3.org/2000/svg"
	role="img"
	aria-label="Le-Space"
	class="shrink-0"
>
	<line
		x1="42.7"
		y1="49.96"
		x2="58.56"
		y2="34.94"
		stroke="var(--cyan)"
		stroke-width="4"
		stroke-linecap="round"
	/>
	<line
		x1="47.43"
		y1="63.58"
		x2="62.8"
		y2="64.98"
		stroke="var(--cyan)"
		stroke-width="4"
		stroke-linecap="round"
		stroke-dasharray="0.1 8"
	/>
	<line
		x1="69.85"
		y1="38.36"
		x2="72.41"
		y2="55.37"
		stroke="var(--cyan)"
		stroke-width="2.5"
		stroke-linecap="round"
		stroke-dasharray="0.1 6"
		opacity="0.65"
	/>
	<circle cx="30" cy="62" r="15" fill="var(--coral)" />
	<circle cx="68" cy="26" r="8" fill="none" stroke="var(--cyan)" stroke-width="5" />
	<circle cx="74" cy="66" r="6.5" fill="none" stroke="var(--cyan)" stroke-width="4.5" />
	<circle cx="17" cy="21" r="2.6" fill="var(--cyan)" opacity="0.55" />
</svg>
