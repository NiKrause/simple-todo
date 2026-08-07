/**
 * Rendering the baked build timestamp for a reader.
 *
 * `__BUILD_DATE__` is an ISO 8601 UTC string, so the moment is unambiguous no
 * matter where the build ran. Turning it into text is left until here, in the
 * browser, because only the browser knows the reader's locale and whether they
 * expect a 12- or 24-hour clock.
 */

/**
 * @param {string} [iso] the baked ISO timestamp
 * @param {string | string[]} [locales] defaults to the browser's own
 * @returns {string}
 */
export function formatBuildDate(iso, locales = undefined) {
	if (typeof iso !== 'string' || iso.length === 0) {
		return 'dev';
	}

	const parsed = new Date(iso);

	// Anything unparseable is shown as-is rather than swallowed: a build stamped
	// by an older toolchain is still more useful on screen than "Invalid Date",
	// and silently blanking it would hide which build someone is looking at.
	if (Number.isNaN(parsed.getTime())) {
		return iso;
	}

	return parsed.toLocaleString(locales, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}
