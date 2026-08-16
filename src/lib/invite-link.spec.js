import { describe, expect, it } from 'vitest';
import { buildInviteLink, readInviteLink } from './invite-link.js';

describe('invite links', () => {
	it('carries the payload in the fragment, never the query', () => {
		const link = buildInviteLink('offer-payload', 'https://qr01.le-space.de/?ice=stun');
		const url = new URL(link);

		// The reason this module exists: this app is served from public IPFS
		// gateways, so a signed connection offer in the query string would land
		// in every gateway operator's access log. A fragment is never sent.
		expect(url.search).toBe('?ice=stun');
		expect(url.hash).toContain('invite=');
		expect(url.href).not.toContain('?invite');
	});

	it('keeps the query string the sender was using', () => {
		// `?ice=stun` is not decoration: without it the receiver gathers
		// host-only candidates and two people on different networks never meet.
		const link = buildInviteLink('p', 'https://qr01.le-space.de/?ice=stun');

		expect(new URL(link).searchParams.get('ice')).toBe('stun');
	});

	it('does not stack a second invite onto a link that already carries one', () => {
		const first = buildInviteLink('one', 'https://qr01.le-space.de/');
		const second = buildInviteLink('two', first);

		expect(readInviteLink(second)).toBe('two');
		expect(second).not.toContain('one');
	});

	it('round-trips a payload with characters that need encoding', () => {
		const payload = 'a+b/c=d&e#f';
		const link = buildInviteLink(payload, 'https://qr01.le-space.de/');

		expect(readInviteLink(link)).toBe(payload);
	});

	it('reads nothing from a URL without an invite', () => {
		expect(readInviteLink('https://qr01.le-space.de/')).toBeNull();
		expect(readInviteLink('https://qr01.le-space.de/#other=1')).toBeNull();
		expect(readInviteLink('https://qr01.le-space.de/#invite=')).toBeNull();
		expect(readInviteLink('not a url')).toBeNull();
		expect(readInviteLink('')).toBeNull();
	});
});
