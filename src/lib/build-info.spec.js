import { describe, expect, it } from 'vitest';
import { formatVersions, formatCommitSha } from './build-info.js';

describe('formatVersions', () => {
	it('puts the app name in front of the app version', () => {
		const [app] = formatVersions({ appName: 'Simple-Todo' }).split(' · ');

		expect(app).toBe(`Simple-Todo v${__APP_VERSION__}`);
	});

	it('drops the app name where a heading already carries it', () => {
		const [app] = formatVersions().split(' · ');

		expect(app).toBe(`v${__APP_VERSION__}`);
	});

	it('states each dependency with the version that shipped with it', () => {
		// The regression this guards: the header read "IPFS + OrbitDB v0.3.1",
		// putting the app's own version where a reader reads an OrbitDB version.
		const stack = formatVersions().split(' · ').slice(1);

		expect(stack).toContain(`OrbitDB ${__ORBITDB_VERSION__}`);
		expect(stack).not.toContain(`OrbitDB ${__APP_VERSION__}`);
	});

	it('never names a dependency without a version behind it', () => {
		// The app's own segment is exempt: it is either "v0.3.1" under a heading
		// that names the app, or "Simple-Todo v0.3.1" where no heading does.
		for (const entry of formatVersions().split(' · ').slice(1)) {
			expect(entry).toMatch(/^\S.* \d+\.\d+\.\d+/);
		}
	});
});

describe('formatCommitSha', () => {
	it('shortens to the seven characters git log prints', () => {
		expect(formatCommitSha('9f3c1ab7d4e5f60718293a4b5c6d7e8f90a1b2c3')).toBe('9f3c1ab');
	});

	it('lowercases, so a value from CI matches one from git', () => {
		expect(formatCommitSha('9F3C1AB7D4E5F6')).toBe('9f3c1ab');
	});

	it('accepts an already-short sha', () => {
		expect(formatCommitSha('abc1234')).toBe('abc1234');
	});

	it('returns nothing for a build with no commit, so the header omits it', () => {
		// A placeholder would look like an answer. Empty means the caller drops
		// the segment entirely.
		for (const value of ['', '   ', undefined, null, 'not-a-sha', 'abc123']) {
			expect(formatCommitSha(/** @type {any} */ (value))).toBe('');
		}
	});
});
