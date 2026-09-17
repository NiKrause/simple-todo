# Security of the confidential escrow

For security and cryptography reviewers of the `escrow01` chapter. It states what the escrow
protects, what it leaks, whom it trusts, and what is not solved. Facts are as of 2026-09-16, those on
the passkey wallet as of 2026-09-17, and are sourced at the end; points that could not be verified say so. The mechanics are described in
[escrow.md](escrow.md) and [zama-confidential-transactions.md](zama-confidential-transactions.md);
the traced run is in [smoke-test.md](smoke-test.md).

Status: a testnet demonstration. `ConfidentialTodoEscrow` is deployed and verified on Sepolia and has
not been audited. Built with `VITE_BUDGET_SERVICE=zama`, the app locks, reads and releases budgets on
Sepolia from a passkey account, with gas sponsored by Openfort ([passkey-account.md](passkey-account.md));
without that setting its budget screens run against an in-memory fake that encrypts nothing.

- [Threat model](#threat-model-simple)
- [What leaks](#leaks-simple)
- [Trust assumptions](#trust-simple)
- [The token: cUSDTMock](#token-simple)
- [The auditor](#auditor-simple)
- [Input proofs and replay](#replay-simple)
- [Properties of the escrow itself](#escrow-properties-simple)
- [Limits](#limits-simple)
- [Passkey wallet](#passkey-wallet)
- [Open issues](#open-issues)

## Threat model

### Threat model: simple

The escrow is meant to keep one thing secret: how much money is locked and paid out. It is not meant
to hide who pays whom or when. It relies on Zama's key holders to keep the decryption key split and
on Zama's services to be available.

### Threat model: technical

Assets:

1. Confidentiality of amounts: locked amounts, the escrow's and the parties' token balances.
2. Integrity of funds: only the creator releases or refunds; a release pays the beneficiary the amount
   actually locked; nothing else moves a locked amount.
3. Availability: a creator can release or refund, and allowed parties can read amounts.
4. Metadata privacy: explicitly out of scope, see [What leaks](#leaks-technical).

Adversaries and what they can do:

| Adversary                         | Can                                                                                                      | Cannot                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Chain observer                    | read every transaction, calldata, event and storage slot on Sepolia, and the events of the Gateway chain | decrypt a handle; tell a full lock from an underfunded one                                                    |
| Front-runner                      | copy a pending `lock` (`todoRef`, handle, proof)                                                         | use the proof for another account or contract; occupy the creator's `todoRef` (escrows are keyed per creator) |
| Reader of the OrbitDB list        | read todo text, delegate DID and `budget` (`todoRef`, transaction hashes, status)                        | read amounts, which are not in OrbitDB                                                                        |
| Beneficiary                       | read the locked amount and its own balance; check before starting work that the lock is not empty        | force a release                                                                                               |
| Creator                           | withhold a release and refund after the deadline                                                         | release to anyone but the recorded beneficiary; take funds before the deadline without releasing              |
| Auditor                           | read every amount ever locked in this escrow                                                             | move funds                                                                                                    |
| Token owner (Protocol DAO)        | upgrade cUSDTMock, add observers who can decrypt, block addresses, appoint a pauser                      | nothing is excluded by code; see [The token](#token-technical)                                                |
| Zama operators                    | see section [Trust assumptions](#trust-technical)                                                        |                                                                                                               |
| Compromised browser or key        | read whatever that key may decrypt; sign as that account                                                 | read amounts it has no ACL permission for                                                                     |
| Holder of the page's Openfort key | have any Sepolia user operation sponsored under the project's rule                                       | sign for an account, move funds, read amounts                                                                 |

Creator, beneficiary and auditor can each also make a locked amount public through the token (see
[The token](#token-technical)).

## What leaks

### Leaks: simple

Everyone can see who locked money for whom, when, until when, which escrow reference was used and
when it was paid out. Everyone can see how much was converted between USDT and confidential USDT.
Nobody can see how much was locked or paid out. Zama's systems also record who asked to decrypt
which value, and when.

### Leaks: technical

Public on Sepolia (all confirmed in the transactions of the smoke run):

| Leak                                       | Where                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Sender (creator)                           | transaction `from`; `Locked` topic 1                                                                                             |
| Recipient (beneficiary)                    | `lock` calldata; `Locked` topic 3; ACL `Allowed` event; later `ConfidentialTransfer` topic 2                                     |
| Auditor address                            | `auditor()`; an ACL `Allowed` event in every lock                                                                                |
| Time                                       | block timestamps of `setOperator`, `lock`, `release`, `refund`                                                                   |
| Function                                   | method selector (Etherscan: "Lock", "Release")                                                                                   |
| `todoRef`                                  | calldata; topic 2 of `Locked`, `Released`, `Refunded`                                                                            |
| Deadline                                   | calldata; `Locked` data                                                                                                          |
| Operator window                            | `setOperator` calldata and `OperatorSet` event                                                                                   |
| Gas and fee                                | receipt                                                                                                                          |
| Handle identity                            | calldata, FHEVMExecutor events, `ConfidentialTransfer`, `Allowed`, `escrowOf`, `confidentialBalanceOf`                           |
| Computation graph                          | every FHE operation with its operand and result handles in FHEVMExecutor events                                                  |
| Input proof                                | calldata; `VerifyInput` event                                                                                                    |
| Amounts at wrap and unwrap                 | `wrap` calldata, ERC-20 `Transfer`, `TrivialEncrypt(pt)`, `Wrap(roundedAmount)`; `finalizeUnwrap` calldata and `UnwrapFinalized` |
| Number of escrows and releases per creator | count of `Locked` and `Released` events                                                                                          |

What handle identity reveals: equal handles denote equal values. A computed handle is a hash of public
data, and the executor events show which handles feed which operation. Reusing a handle, for example
locking the amount of an earlier escrow again with an empty proof, shows publicly that both
operations started from the same encrypted value. Trivial encryptions publish their clear value by
construction (`TrivialEncrypt(pt)`).

Correlation: a wrap of X shortly before a lock by the same address suggests a locked amount of at most
X. An unwrap by a beneficiary shortly after a release suggests the released amount.

Off Sepolia:

- **Gateway chain.** Each user decryption is a Gateway transaction by the relayer that emits
  `UserDecryptionRequest(decryptionId, ciphertext materials including the handles, userAddress,
publicKey, extraData)`, followed by one `UserDecryptionResponse` per KMS share. Who asked to read
  which handle, and when, is therefore public on the Gateway chain, for which Zama runs a public block
  explorer (`https://explorer.testnet.zama.org` for testnet); the shares themselves are encrypted to
  the requester's ML-KEM-512 key. Public decryption results are published there in clear.
- **Relayer.** Sees every request with addresses, handles and transport public keys, and the client's
  IP address.
- **OrbitDB.** The shared list is unencrypted: anyone with its address reads todo text, delegate DID,
  `todoRef` and status, and can thus link a todo to its escrow on chain.

Not public: amounts inside the token (locked, released, refunded, balances), and whether a transfer
moved the requested amount or 0.

## Trust assumptions

### Trust: simple

The secrecy of amounts depends on Zama's key holders not colluding; Zama's whitepaper tolerates
collusion of up to 4 of the 13. Being able to read amounts at all depends on Zama's relayer, Gateway
and key holders being online. The rules of the whole system can be
changed by Zama's protocol governance.

### Trust: technical

| Party                                                                 | Configuration on 2026-09-16                                                                                                                                                                                                                 | Trusted for                                                                          | Failure                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KMS operators                                                         | 13 signers; thresholds in ProtocolConfig: user decryption 9, public decryption 7, key generation 7, MPC 4 (Sepolia and mainnet). Zama's docs: nodes run by default in AWS Nitro Enclaves, protocol robust with at most one third malicious. | confidentiality of every ciphertext under the global key; correct decryption results | Zama's FHEVM whitepaper (June 2025) tolerates collusions of up to 4 of the 13 operators, so 5 or more colluding operators are outside that guarantee and could decrypt anything (see [zama-confidential-transactions.md](zama-confidential-transactions.md#trust-technical)); too few online operators stop all decryption |
| Coprocessors                                                          | input attestations: 3 of 5 signers on Sepolia, 1 of 1 on Ethereum mainnet                                                                                                                                                                   | accepting only well-formed inputs; correct FHE computation; storing ciphertexts      | per Zama's docs results are valid while more than half are honest; on mainnet a single signer key attests every encrypted input                                                                                                                                                                                            |
| Gateway                                                               | Arbitrum rollup, chain id 10901 (testnet)                                                                                                                                                                                                   | ordering and relaying requests, pinning the KMS context                              | halt: no input attestation, no decryption                                                                                                                                                                                                                                                                                  |
| Relayer                                                               | `relayer.testnet.zama.org`, no key; mainnet hosted relayer requires an API key; self-hosting is documented                                                                                                                                  | availability                                                                         | down: the SDK cannot encrypt or decrypt through it; on-chain state is unaffected                                                                                                                                                                                                                                           |
| Protocol DAO (owner of the ACL, and through it of all host contracts) | Sepolia `0x08e8a84c3c8c7cba165B1adcf67Ae4639eF84f52`, mainnet `0xB6D69D5F334d8B97B194617B53c6aB62f8681Ef3`                                                                                                                                  | not changing the rules                                                               | can upgrade ACL, executor and verifiers, change coprocessor and KMS signer sets and thresholds, HCU limits and the deny list                                                                                                                                                                                               |
| PauserSet members                                                     | no function lists them; by the `AddPauser` events and `isPauser`: 1 on Sepolia, 17 on mainnet                                                                                                                                               | not pausing                                                                          | a paused ACL rejects `allow` and `allowTransient`, so every FHE operation reverts; only the owner unpauses                                                                                                                                                                                                                 |
| Client code                                                           | `@zama-fhe/sdk` 3.6.0, `@fhevm/sdk` 0.13.2, WASM from npm                                                                                                                                                                                   | honest key generation, proofs and reconstruction                                     | a compromised page reads decrypted values and the transport private key                                                                                                                                                                                                                                                    |

No service level agreement for the Sepolia relayer, Gateway or KMS is mentioned in the documentation
cited here. The incidents of 2026-08-31 to 2026-09-01 and of 2026-09-03 made user decryption fail on
Sepolia while the chain was correct (see
[zama-confidential-transactions.md](zama-confidential-transactions.md#incidents-technical)).

## The token: cUSDTMock

### Token: simple

The escrow holds Zama's test dollar token. Its owner, Zama's protocol governance, can replace the
token's code, name observers who may read all amounts in the token, block addresses and appoint
someone who may pause it. On 2026-09-16 there were no observers and nobody was appointed to pause it.

### Token: technical

cUSDTMock `0x4E7B06D78965594eB5EF5414c357ca21E1554491` is an ERC-1967 proxy to `ConfidentialWrapper`
`0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04` (exact match on Sourcify). Owner:
`0x08e8a84c3c8c7cba165B1adcf67Ae4639eF84f52`, the Protocol DAO. Relevant powers in the verified source:

- **Upgrade.** UUPS; `_authorizeUpgrade` is `onlyOwner`. The escrow's funds depend on the
  implementation staying a correct ERC-7984. `renounceOwnership` is disabled.
- **Observers.** `addObserver(observer)` is `onlyOwner` and calls
  `FHE.delegateUserDecryptionWithoutExpiration(observer, WILDCARD_CONTRACT)`: the token delegates its
  own user-decryption rights to the observer for every contract, without expiry. The ACL grants a
  delegated decryption of a handle when the delegator (the token) and the named contract are both
  persistently allowed on it. The token keeps a persistent permission on every amount it returns, and
  the escrow allows itself on what it stores; on 2026-09-16 `persistAllowed(amount, cUSDTMock)` and
  `persistAllowed(amount, escrow)` were both true for the first locked amount. An observer can
  therefore decrypt every amount this escrow stores, as well as every balance and transfer in the
  token, which Zama's wrapper documentation states for balances, supply and transfers. Observers are
  public (`observers()`, `ObserverAdded` event); `observers()` returned an empty list on 2026-09-16.
- **Deny list.** `blockUser` is `onlyOwner`; the token's `_update` checks sender and recipient, and
  the caller when it is not the sender. The escrow is the caller or the sender in all three of its
  transfers, so blocking the escrow makes every `lock`, `release` and `refund` revert; a blocked
  creator makes `lock` and `refund` revert, a blocked beneficiary `release`, for as long as the block
  lasts. The owner can also make the token consult the underlying token's own deny list
  (`setUnderlyingDenyListSelector`); on cUSDTMock that check was off (`0x00000000`) on 2026-09-16.
  `isBlocked` was false for the escrow, the creator and the beneficiary during the run.
- **Pause.** `pause()` may be called only by `pauser()`, which the owner sets; `pauser()` returned
  `address(0)` on 2026-09-16, so nobody could pause without the owner appointing a pauser first. While
  paused, every transfer, and so every lock, release and refund, reverts.
- **Disclosure by a party.** `requestDiscloseEncryptedAmount(handle)` lets any account that is allowed
  on a handle make it publicly decryptable through the token, which is allowed too. The creator, the
  beneficiary and the auditor can each publish a locked amount this way; an observer cannot, because
  delegation is not an ACL permission.

## The auditor

### Auditor: simple

The escrow names one auditor forever. The auditor can read every amount ever locked in it. Today the
auditor is the developer's own test account, whose key the runbook keeps unencrypted in a
configuration file on a development machine.

### Auditor: technical

- `auditor` is `immutable`, set in the constructor, and non-zero. Every `lock` calls
  `FHE.allow(transferred, auditor)`. The ACL has no function that removes a persistent permission, so
  the auditor can decrypt every amount locked in this deployment for as long as the ciphertexts exist.
- Rotation is impossible. A new auditor means a new escrow. Escrows in the old contract stay there,
  and the old auditor keeps reading their amounts.
- The deployed auditor is `0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621`, the deployer, which is also the
  creator of the smoke test. Its private key is the `DEPLOYER_PRIVATE_KEY` of the Sepolia runbook,
  which the runbook keeps in `contracts/.env`: a plaintext file that git ignores. Whoever obtains that
  key can decrypt every locked amount, lock and release as the smoke-test creator, and spend its
  Sepolia ETH.
- The auditor is visible to everyone: `auditor()` and the `Allowed` event in each lock.
- Delegated reading for an auditor service would use `ACL.delegateForUserDecryption`, which is itself
  public and links the auditor to its delegate.

## Input proofs and replay

### Replay: simple

An encrypted amount is only accepted from the person it was made for, through the contract it was made
for. Copying it out of a pending transaction does not help anyone else.

### Replay: technical

- The coprocessors sign `CiphertextVerification(bytes32[] ctHandles, address userAddress, address
contractAddress, uint256 contractChainId, bytes extraData)`. On chain, FHEVMExecutor sets
  `contractAddress` to its caller and takes `userAddress` from the calling contract, which is the
  escrow's `msg.sender`. InputVerifier recovers the signers with ECDSA and requires the threshold (3 of
  5 on Sepolia, 1 of 1 on mainnet). A proof used by another account or through another contract
  recovers a non-signer: `InvalidSigner`. The client-side ZK proof is additionally bound to contract,
  user, ACL and chain id through its metadata.
- Tests: "rejects an encrypted amount made for someone else" (another account replays the creator's
  input) and "verifies the encrypted amount itself instead of forwarding it to the token" (forwarding
  fails; encrypting for (token, escrow) instead produces a proof anyone can replay).
- There is no nonce. The same user can submit the same proof again through the same contract in a
  later transaction and gets the same handle: a second lock of the same encrypted amount. That is
  harmless for funds but links the two locks publicly.
- Within one transaction a verified proof is cached in transient storage under (contract, user,
  proof). Transient ACL permissions also last until the end of the transaction; in a bundle of
  user operations they survive from one operation to the next unless someone calls
  `cleanTransientStorage()`, which anyone may. They stay bound to the account they were granted to.
- With an empty proof the escrow accepts an existing handle only if `ACL.isAllowed(handle,
msg.sender)`; test "takes an existing handle without a proof only from someone who may use it".

## Properties of the escrow itself

### Escrow properties: simple

Only the person who locked the money can pay it out or take it back, and taking it back only works
after the deadline. Each escrow can be closed once. The escrow has no owner who could change these
rules.

### Escrow properties: technical

From the contract source and its 16 Hardhat tests in `contracts/test/ConfidentialTodoEscrow.ts`
(FHEVM mock):

- `release` and `refund` look up `_escrows[msg.sender][todoRef]`: creator-only by construction.
- `refund` requires `block.timestamp > deadline`; `lock` bounds the deadline to 365 days.
- One-shot: a second release, a release after a refund, a refund after a release and a second lock
  under the same `todoRef` all revert.
- State is written before the token is called (`lock`, `release`, `refund`).
- Events carry no amounts and no handles.
- Constructor rejects a token without ERC-7984 in ERC-165 and a zero auditor.
- No owner, no upgrade, no fee, no function besides `release` and `refund` that moves funds.

By design, not by oversight:

- The beneficiary has no on-chain claim. A creator can withhold a release and refund after the
  deadline; the escrow protects the creator's funds, not the beneficiary's work.
- An underfunded lock succeeds with an encrypted 0. The beneficiary should decrypt the locked amount
  before starting work; the app is meant to decrypt it after every lock.
- The operator approval (`setOperator`) has no amount, only an expiry. The escrow pulls only from its
  own caller, so nobody else can use the approval through the escrow, but it should expire soon.

## Limits

### Limits: simple

This runs on a test network with test money and test infrastructure, on a protocol version that is
about to be replaced. It is a demonstration, not a product.

### Limits: technical

- **Protocol v0.14.** Released 2026-08-14, not deployed on Sepolia or mainnet on 2026-09-16. It
  changes user decryption (unified permits, `durationSeconds`, ERC-1271 accounts) and host contract
  versions. The escrow is compiled with `@fhevm/solidity` 0.11.1 against v0.13 host contracts; a move
  to v0.14 needs a compatibility check and may need a new deployment, which would also mean a new
  auditor decision and new escrows ([redeploy checklist](../contracts/README.md#redeploy-checklist)).
- **Sepolia reliability.** Two decryption incidents in early September 2026. The smoke test retries
  relayer calls and waits two confirmations before decrypting; it cannot fix an outage.
- **No SLA** is documented for the testnet services in the sources cited.
- **Test assets.** USDTMock can be minted by anyone (up to 1,000,000 tokens per call). Nothing here has
  monetary value.
- **Mainnet differs.** Mainnet's InputVerifier has a single coprocessor signer; the hosted relayer needs
  an API key and bills fees; mainnet cUSDT is a different contract. Nothing in this chapter was run on
  mainnet.
- **Mock versus Sepolia.** The Hardhat mock uses host contracts 0.10.0: a delegation must expire at
  least one hour ahead and cannot use the wildcard, and HCU limits compare with `>=` where Sepolia's
  HCULimit uses `>`.
- **The app** has no refund button. Its Sepolia service maps a DID to an account through an OrbitDB
  directory only that DID can write, plus a check that the DID's passkey is an admin of the account
  ([Account lookup](passkey-account.md#account-lookup-technical)).

## Passkey wallet

Integrated on 2026-09-17 behind `VITE_BUDGET_SERVICE=zama`
([`src/lib/budget-service-zama.js`](../src/lib/budget-service-zama.js),
[`src/lib/chain/`](../src/lib/chain)): Zama's token and the escrow, signed through a Calibur account that
the passkey controls. How it works, step by step, is in [passkey-account.md](passkey-account.md). The
facts below concern Calibur v1.0.0 (Uniswap, tag `v1.0.0`), Zama v0.13 and what the app does with
them.

### Passkey wallet: simple

One passkey on the device controls the account that holds the money. Two properties of the chosen
account contract matter: the ordinary key that created the account stays an all-powerful master key
forever, and the chain does not check that the person actually confirmed with a fingerprint or face.
Reading amounts also needs an extra, temporary key in the browser, because Zama's current version
cannot accept signatures from such accounts; the app keeps it unencrypted for up to 24 hours. Nobody
can restore an account whose passkey is lost, and the key that pays for gas is readable in the page.

### Passkey wallet: technical

- **The EOA setup key is root forever.** Calibur is an EIP-7702 delegation target. Its root key is the
  account's own secp256k1 key (`KeyLib.isRootKey`: a `Secp256k1` key whose address is the account
  itself; the placeholder key hash `bytes32(0)` stands for it). `register` and `update` refuse the root
  key, `revoke` cannot remove it because it is never in the key set, and `_isOwnerOrValidKey` always
  accepts it. `isValidSignature` accepts any raw 64- or 65-byte ECDSA signature from it. Calibur has no
  function to disable it. Independently of Calibur, under EIP-7702 that key can still send
  transactions and sign new delegation designations, so it keeps control of the account even when
  the delegation changes. Deleting the setup key after onboarding is the only protection, and it cannot
  be proven on chain. The app generates it in memory, uses it for one sponsored user operation, and
  drops every reference once the passkey is registered (`discard()`); the account holds nothing until
  the passkey signs its first lock.
- **User verification is not enforced on chain.** `KeyLib.verify` checks `WebAuthnP256` keys with
  `WebAuthn.verify({ ..., requireUV: false, ... })`. Whether the authenticator verified the user (PIN,
  biometrics) is enforced only by the client code that requests the assertion; the app requests
  `userVerification: 'required'`. The pinned webauthn-sol library requires the user-presence flag, and
  does not check the origin or the `rpIdHash` on chain.
- **Non-root keys sign ERC-1271 messages only in ERC-7739 form.** Calibur's `isValidSignature` routes
  raw signatures to the root key and expects the ERC-7739 TypedDataSign or NestedPersonalSign flow for
  every other key; the root key may use that flow too.
- **Zama v0.13 accepts only ECDSA permits.** `@fhevm/sdk` 0.13.2 requires 65-byte signatures and
  compares the recovered address; the Gateway's `Decryption` contract reverts with
  `InvalidUserSignature` unless the ECDSA signer is the user. A passkey account cannot sign a decryption
  permit. The app's workaround is a secp256k1 session key, the read key, that the account authorizes
  with `ACL.delegateForUserDecryption(sessionKey, contract, expiry)`, once per contract (token and
  escrow), for 24 hours: in the setup batch, and with a new key on every renewal. The key sits in plain
  text in the browser's `localStorage`. The `DelegatedForUserDecryption` event makes the link between
  account and session key public, and the session key can read everything the account may read in
  those contracts until the expiry or a revocation.
- **v0.14** adds ERC-1271 verification in the KMS connector for its new unified request (`ecrecover`
  for a 65-byte signature, otherwise a gas-capped `isValidSignature` call). Whether a Calibur passkey
  signature in ERC-7739 form passes that check was not verified.
- **Sponsorship.** The publishable Openfort key is part of the page. The Openfort rule behind it,
  `ply_1b76dd29-2f48-4835-ad5f-4cd8aa2db3d8`, accepts `sponsorEvmTransaction` on chain 11155111 with no
  restriction to contracts or functions. Anyone who reads the key out of the page can have arbitrary
  Sepolia user operations sponsored until the project's credits run out; the key cannot sign for any
  account. The app refuses a secret `sk_` key in its configuration (`readChainEndpoints`).
- **No recovery.** Besides the discarded root key the passkey is the account's only key. A synced
  passkey reaches further devices; a lost one takes the account with it.
- **Calibur v1.1.0.** Uniswap released v1.1.0 on 2026-07-02 at a new address and lists only that
  version since. Among other hardening it allows only admin keys to call the EntryPoint. The app uses
  v1.0.0, where its only non-root key is an admin
  ([What Calibur is](passkey-account.md#calibur-technical)).

## Open issues

1. Auditor: the deployed auditor is a development key in a plaintext file. Choose the real auditor
   and its key custody before relying on a deployment; a change requires a new escrow.
2. Token governance: observers, upgrade, deny list and pause of cUSDTMock lie with the Protocol DAO.
   Zama's wrapper documentation says wrapper ownership is to move to the underlying token's owner.
   On 2026-09-16 mainnet cUSDT `0xAe0207C757Aa2B4019Ad96edD0092ddc63EF0c50` was still owned by the
   Protocol DAO `0xB6D69D5F334d8B97B194617B53c6aB62f8681Ef3`, had no observers and no pauser, and
   consulted USDT's own blacklist (`getBlackListStatus`) as its underlying deny list.
3. Metadata: `todoRef`, delegate DID and budget status are readable in the unencrypted OrbitDB list,
   and decryption requests are public on the Gateway chain.
4. The app has no refund button, and its Sepolia mode depends on two unpublished packages vendored as
   tarballs.
5. Passkey wallet: permanent root key, no on-chain user verification, public link between account and
   session key, the session key in plain text in `localStorage`, no recovery, Calibur v1.0.0 rather
   than v1.1.0.
6. Mainnet readiness: a single coprocessor signer for input attestation on mainnet, relayer API key
   and fees, v0.14 migration, no audit.
7. Decryption availability: the relayer's share settings after #3481 on Sepolia are unknown; there is
   no documented SLA.
8. No audit of the escrow; the tests run against a mock whose host contracts are older than Sepolia's.
9. Sponsorship: the Openfort rule sponsors any Sepolia user operation for whoever holds the page's
   publishable key; restrict it to the demo's contracts and cap it.

## Sources

Repository (branch `escrow01`):

- [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol): auditor
  49-52, constructor 71-78, `lock` 100-136 (allow to auditor 132), `release` 143-148, `refund` 150-158.
- [`contracts/test/ConfidentialTodoEscrow.ts`](../contracts/test/ConfidentialTodoEscrow.ts): 16 tests,
  in particular 363-377, 379-419, 421-444.
- [`contracts/README.md`](../contracts/README.md): "Who can decrypt", "What stays public", "`.env`",
  "Before relying on a deployment".
- [`src/lib/budget-service.js`](../src/lib/budget-service.js) 1-18,
  [`src/lib/budget.js`](../src/lib/budget.js) 1-16, [`src/lib/i18n/en.json`](../src/lib/i18n/en.json)
  (`budget.notice.insufficient`).
- [`src/lib/budget-service-zama.js`](../src/lib/budget-service-zama.js) (`ensureAccount`, `accountOf`,
  `renewReadKey`), [`src/lib/chain/sepolia-chain.js`](../src/lib/chain/sepolia-chain.js)
  (`createAccount`, `isPasskeyAccount`), [`src/lib/chain/config.js`](../src/lib/chain/config.js)
  (`readChainEndpoints`), [`src/lib/chain/account-store.js`](../src/lib/chain/account-store.js); the
  passkey wallet with its sources in [passkey-account.md](passkey-account.md#sources). Openfort rule
  `ply_1b76dd29-2f48-4835-ad5f-4cd8aa2db3d8`, read through the Openfort CLI on 2026-09-17.

cUSDTMock implementation on Sourcify
(<https://sourcify.dev/server/v2/contract/11155111/0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04?fields=sources>):
`contracts/ConfidentialWrapper.sol` `WILDCARD_CONTRACT` 112, `blockUser` 229-231, `addObserver`
306-308, `observers` 336-338, `pauser` and `pause` 343-357, `renounceOwnership` 373-375,
`_addObserver` 391-403, `_requireNotBlocked` 420-425, `_update` 432-442, `_authorizeUpgrade` 497;
`contracts/token/ERC7984Upgradeable.sol` `requestDiscloseEncryptedAmount` 265-273, `_update` 343-378.

zama-ai/fhevm v0.13.5: `host-contracts/contracts/ACL.sol` (`allow` 206-216, `allowTransient` 253-272,
`delegateForUserDecryption` 283-334, `pause` 378-383, `isHandleDelegatedForUserDecryption` 478-491,
`cleanTransientStorage` 552-567, `_authorizeUpgrade` 591), `host-contracts/contracts/InputVerifier.sol`
(`verifyInput` 244-330, ECDSA-only recovery 517-525), `host-contracts/contracts/ACLEvents.sol`
(`DelegatedForUserDecryption`), `gateway-contracts/contracts/Decryption.sol` (`userDecryptionRequest`
441-526, `InvalidUserSignature` 916-927), `gateway-contracts/contracts/interfaces/IDecryption.sol`
(`UserDecryptionRequest` 96-102, `UserDecryptionResponse` 112-118),
`gateway-contracts/contracts/shared/Structs.sol` (`SnsCiphertextMaterial` 72-77). Pull requests
[#2393](https://github.com/zama-ai/fhevm/pull/2393) (ERC-1271 in the KMS connector) and
[#3481](https://github.com/zama-ai/fhevm/pull/3481).

`@fhevm/sdk` 0.13.2: `core/utils-p/runtime/recoverSigners.ts` 23,
`core/utils-p/decrypt/verifyKmsUserDecryptEip712V1.ts` 36-42, `core/modules/decrypt/module/api-p.ts`
236-242.

Calibur v1.0.0 (<https://github.com/Uniswap/calibur/tree/v1.0.0>): `src/libraries/KeyLib.sol` 26,
35-42, 58-77; `src/KeyManagement.sol` 21-46, 84-89; `src/Calibur.sol` 132-174. webauthn-sol at the
commit Calibur v1.0.0 pins (`619f20ab0f074fef41066ee4ab24849a913263b2`): `src/WebAuthn.sol` 77-88
(origin and `rpIdHash` not checked), 133 (user presence), 139 (user verification only on request).
EIP-7702: <https://eips.ethereum.org/EIPS/eip-7702>. Calibur v1.1.0: release of 2026-07-02 and
<https://github.com/Uniswap/calibur/compare/v1.0.0...v1.1.0> (`src/Calibur.sol`, `_process`).

Chain, read on 2026-09-16: cUSDTMock `owner()`, `observers()`, `pauser()`,
`getUnderlyingDenyListSelector()`, implementation slot; mainnet cUSDT `owner()`, `observers()`,
`pauser()`, `underlying()`, `getUnderlyingDenyListSelector()`; ACL `owner()`, `persistAllowed` on the
stored amount; InputVerifier, KMSVerifier and ProtocolConfig thresholds on Sepolia and mainnet;
PauserSet `AddPauser` events (Blockscout) and `isPauser` on Sepolia
(`0xc62392B4100a1bD45AbDBf91E70f1E4349402b46`) and mainnet
(`0xbBfE1680b4a63ED05f7F80CE330BED7C992A586C`).

Zama's FHEVM whitepaper, version 3.1 of 30 June 2025
(<https://github.com/zama-ai/fhevm/blob/main/fhevm-whitepaper.pdf>): KMS collusion bound, p. 12.

Zama documentation: confidential wrapper, observers
(<https://docs.zama.org/protocol/protocol-apps/confidential-tokens/confidential-wrapper>); KMS
(<https://docs.zama.org/protocol/protocol/overview/kms>); coprocessor
(<https://docs.zama.org/protocol/protocol/overview/coprocessor>); SDK security model
(<https://docs.zama.org/protocol/sdk/concepts/security-model>); relayer API keys
(<https://docs.zama.org/protocol/sdk/guides/relayer-api-keys>); Sepolia and Ethereum addresses
(<https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia>,
<https://docs.zama.org/protocol/protocol-apps/addresses/mainnet/ethereum>); chains and Gateway
explorers (<https://docs.zama.org/protocol/protocol-apps/chains>).
