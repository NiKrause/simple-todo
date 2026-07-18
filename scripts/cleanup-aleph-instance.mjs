import { createHash } from 'node:crypto';
import { eraseInstanceOnCrn, forgetAlephMessages } from '@le-space/core';
import { createPrivateKeyIdentity } from '@le-space/node';
import { waitForAlephInstanceDeletion } from '@le-space/playwright';

const instanceHash = process.env.ALEPH_PLAYWRIGHT_INSTANCE_HASH?.trim();
if (!/^[a-f0-9]{64}$/iu.test(instanceHash ?? '')) {
  throw new Error('Cleanup requires one exact INSTANCE hash from ALEPH_PLAYWRIGHT_INSTANCE_HASH');
}

const identity = await createPrivateKeyIdentity(process.env.ALEPH_VM_PRIVATE_KEY);
const apiHosts = ['https://api2.aleph.im', 'https://api.aleph.im'];
const fetchImpl = globalThis.fetch.bind(globalThis);

let erase;
for (const apiHost of apiHosts) {
  try {
    erase = await eraseInstanceOnCrn({
      sender: identity.address, signer: identity.signer,
      instanceHash, fetch: fetchImpl, apiHost,
    });
    break;
  } catch { /* try next api host */ }
}

let forget;
for (const apiHost of apiHosts) {
  try {
    forget = await forgetAlephMessages({
      sender: identity.address, hashes: [instanceHash],
      reason: `Ephemeral Playwright runner cleanup for ${instanceHash}`,
      signer: identity.signer,
      hasher: (content) => createHash('sha256').update(content).digest('hex'),
      fetch: fetchImpl, apiHost, sync: true,
    });
    if (forget.status === 'rejected') throw new Error('FORGET rejected');
    break;
  } catch { forget = null; }
}
if (!forget) throw new Error(`Owner-signed FORGET failed for ${instanceHash}`);

const verification = await waitForAlephInstanceDeletion({
  instanceHash, apiHosts, fetch: fetchImpl,
});

const result = { instanceHash, owner: identity.address, apiHosts, erase: erase?.status, forget: forget.itemHash, verification };
console.log(JSON.stringify(result, null, 2));
