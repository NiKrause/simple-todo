import { describe, expect, it } from 'vitest';

import { buildInviteLink, readInviteLink } from './invite-link.js';

// Shaped like a real payload: base64-ish with characters that must survive a
// round trip through a URL (`+` would otherwise decode back as a space).
const PAYLOAD = 'eyJ0eXAiOiJvZmZlciJ9.aGVsbG8+d29ybGQ/Zm9v=';

describe('buildInviteLink', () => {
	it('puts the payload in the fragment, never the query', () => {
		const link = buildInviteLink(PAYLOAD, 'https://simple-todo.le-space.de/');
		const url = new URL(link);

		// A fragment is not sent to the server. This app is also served from
		// public IPFS gateways, so a query string would hand a signed connection
		// offer to every operator on the way and into their logs.
		expect(url.search).toBe('');
		expect(url.hash.startsWith('#invite=')).toBe(true);
		expect(link).not.toContain('?invite=');
	});

	it('round-trips a payload containing URL-significant characters', () => {
		const link = buildInviteLink(PAYLOAD, 'https://simple-todo.le-space.de/');

		expect(readInviteLink(link)).toBe(PAYLOAD);
	});

	it('keeps the query string, so ?transport=qr survives being shared', () => {
		const link = buildInviteLink(PAYLOAD, 'https://simple-todo.le-space.de/?transport=qr');

		expect(new URL(link).search).toBe('?transport=qr');
		expect(readInviteLink(link)).toBe(PAYLOAD);
	});

	it('replaces an existing invite instead of stacking a second one', () => {
		const first = buildInviteLink('older', 'https://simple-todo.le-space.de/');
		const second = buildInviteLink(PAYLOAD, first);

		expect(readInviteLink(second)).toBe(PAYLOAD);
		expect(second.match(/invite=/gu)).toHaveLength(1);
	});
});

describe('readInviteLink', () => {
	it('returns null when the URL carries no invite', () => {
		expect(readInviteLink('https://simple-todo.le-space.de/')).toBe(null);
		expect(readInviteLink('https://simple-todo.le-space.de/#other=1')).toBe(null);
		expect(readInviteLink('https://simple-todo.le-space.de/?invite=wrong-place')).toBe(null);
	});

	it('treats an empty or blank invite as absent', () => {
		expect(readInviteLink('https://simple-todo.le-space.de/#invite=')).toBe(null);
		expect(readInviteLink('https://simple-todo.le-space.de/#invite=%20%20')).toBe(null);
	});

	it('does not throw on a malformed URL', () => {
		expect(readInviteLink('not a url')).toBe(null);
		expect(readInviteLink('')).toBe(null);
	});
});
