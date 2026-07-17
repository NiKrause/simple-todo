import { privateKeyToAccount } from 'viem/accounts';
import { sanitizeAlephApiHosts } from '../e2e/remote/aleph-provider-contract.mjs';

const rawKey = process.env.ALEPH_VM_PRIVATE_KEY?.trim();
if (!rawKey) throw new Error('ALEPH_VM_PRIVATE_KEY is required for the Aleph provider.');
const account = privateKeyToAccount(rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`);
const hosts = sanitizeAlephApiHosts(process.env.ALEPH_VM_API_HOSTS);
const minimumCredits = Number(process.env.ALEPH_PLAYWRIGHT_MINIMUM_CREDITS ?? 20_000);
let lastError;

for (const host of hosts) {
	try {
		const response = await fetch(`${host}/api/v0/addresses/${account.address}/balance`, {
			signal: AbortSignal.timeout(15_000)
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const balance = await response.json();
		const available = Number(balance.credit_balance ?? balance.balance ?? 0);
		if (!Number.isFinite(available) || available < minimumCredits) {
			throw new Error(
				`Aleph account has ${available} credits; at least ${minimumCredits} are required.`
			);
		}
		console.log(
			`Aleph preflight passed for ${account.address} through ${host}: ${available} credits.`
		);
		process.exit(0);
	} catch (error) {
		lastError = error;
	}
}
throw new Error(`Aleph credential/credit preflight failed on api2 and api: ${lastError?.message}`);
