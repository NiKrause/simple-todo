import { describe, expect, it } from 'vitest';
import { formatVersions } from './build-info.js';

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
