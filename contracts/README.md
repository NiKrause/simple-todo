# ConfidentialTodoEscrow

The escrow half of [de2do](https://github.com/NiKrause/de2do), with the amount kept confidential by
Zama FHEVM ([#378](https://github.com/NiKrause/simple-todo/issues/378), part of the `escrow01`
chapter, [#382](https://github.com/NiKrause/simple-todo/issues/382)). Alice locks a budget for a
todo she delegated to Bob, and releases it when he is done, or takes it back after a deadline. The
budget is an ERC-7984 confidential token, such as Zama's cUSDT, and its amount stays encrypted:
Alice, Bob and an auditor can decrypt it, nobody else (with one token-side exception, see
[Who can decrypt](#who-can-decrypt)).

This directory is its own project with its own `package.json`. The app's `pnpm install` does not
see it (see [Why npm](#why-npm)), and nothing in the app's CI runs it.

```sh
cd contracts
npm ci          # Node 22 or later
npm test        # FHEVM mock mode, no network
npm run typecheck
```

Deploying, verifying and smoke-testing on Sepolia: see the [Sepolia runbook](#sepolia-runbook).

## The contract

[`src/ConfidentialTodoEscrow.sol`](src/ConfidentialTodoEscrow.sol) inherits `ZamaEthereumConfig`, so
it finds the FHEVM host contracts by chain id (Ethereum, Sepolia, local Hardhat).

| Function | Who | What |
| --- | --- | --- |
| `constructor(IERC7984 token, address auditor)` | deployer | Reverts unless `token` declares ERC-7984 through ERC-165. Both are immutable. |
| `lock(bytes32 todoRef, address beneficiary, externalEuint64 encAmount, bytes inputProof, uint64 deadline)` | creator | Pulls the amount from the caller with `confidentialTransferFrom` and stores the handle of what actually arrived. |
| `release(bytes32 todoRef)` | creator | Sends the locked amount to the beneficiary with `confidentialTransfer`. Any time while locked. |
| `refund(bytes32 todoRef)` | creator | Sends it back to the creator, from the first block after `deadline`. |
| `escrowOf(address creator, bytes32 todoRef)` | anyone | `(beneficiary, deadline, status, amount)`; `amount` is a handle. |

Events `Locked(creator, todoRef, beneficiary, deadline)`, `Released(creator, todoRef, beneficiary)`
and `Refunded(creator, todoRef)` carry no amounts and no amount handles. There is no owner and, for
now, no fee.

A lock, as a client does it:

1. Hold the budget in the confidential token already. Wrapping USDT into cUSDT, and unwrapping,
   reveals the amount at that boundary, so do not wrap right before locking.
2. `token.setOperator(escrow, now + 10 minutes)`. The escrow only ever pulls from `msg.sender`, so
   nobody else can spend this approval through it, but it should lapse soon anyway.
3. Encrypt the amount for the escrow and the creator, `createEncryptedInput(escrow, creator)`, and
   call `lock`. The escrow verifies the proof itself (`FHE.fromExternal`), grants the token a
   transient ACL allowance on the result and calls the token's `confidentialTransferFrom(from, to,
   euint64)`. Forwarding the external handle and proof to the token instead fails: the token checks
   the proof for (token, escrow), not for (escrow, creator). Encrypting for (token, escrow) to make
   that work drops the creator from the proof, so anyone could replay it. The tests show both.
4. Decrypt the stored amount. An ERC-7984 transfer from a balance that is too low does not revert;
   it moves an encrypted 0, and the escrow stores that 0. On-chain the two look the same.
5. `release(todoRef)` when the todo is done, or `refund(todoRef)` after the deadline. Both are
   one-shot: a closed escrow cannot be released, refunded or locked again.

With an empty `inputProof`, `FHE.fromExternal` takes `encAmount` as an existing handle, provided the
caller may use it; the escrow must be allowed on it too. In practice that lets a creator lock the
amount of an earlier escrow again without re-encrypting it. Nobody can lock with a handle they have
no access to.

### `todoRef`

Compute it off-chain as a salted hash, e.g. `keccak256(abi.encode(todoId, salt))` with 32 random
bytes of salt kept with the todo and shared with the beneficiary. A plain todo id would let anyone
who knows it find the escrow. Escrows are keyed by creator and `todoRef` together: that is what makes
`release` and `refund` creator-only, and why nobody can block a creator's reference by locking under
it first. Each reference is used once per creator; after a release or refund, lock under a new salt.

### Who can decrypt

The stored amount is allowed to the escrow itself, the creator, the beneficiary and the auditor. The
token keeps its own access to handles it returned (OpenZeppelin's `ERC7984` does that), which it
needs to compute with them. Nobody else can decrypt, and the amount stays decryptable by those
three after a release or refund, as the record of what was locked.

One exception depends on the token. Zama's cUSDTMock (`ConfidentialWrapper`) lets its owner add
observers, and grants each one a wildcard user-decryption delegation over the handles the token may
use, which includes every amount this escrow stores. `observers()` was empty on 2026-09-16; the
smoke test prints it.

Users are expected to read through Zama's delegated user decryption: the passkey account delegates
to a session key with `ACL.delegateForUserDecryption(delegate, contractAddress, expirationDate)`.
Delegations are per contract, and the numbers live under two: balances under the token, locked
amounts under the escrow. So a user delegates for both. Sepolia's ACL (v0.4.0) also accepts a
wildcard contract address, which would let the session key read the account's handles under every
contract, more than this needs. The mock ACL used in tests (v0.2.0) has no wildcard and still
requires an expiry at least one hour ahead; use at least an hour to keep one code path for both.
Each (delegator, delegate, contract) can be delegated or revoked once per block.

User operations bundled into one transaction (an ERC-4337 bundle, a batched call) share its state:

- ACL transient allowances survive from one operation to the next until someone calls
  `ACL.cleanTransientStorage()`, which anyone may, for instance a smart account at the end of each
  operation. The allowances stay bound to the account they were granted to, and the escrow never
  takes a handle its caller may not use, so leftovers from one user's lock do not help the next.
- The per-transaction HCU budget is shared, and `cleanTransientStorage()` does not reset it
  (`HCULimit` counts in its own transient storage). Sepolia allows 20,000,000 HCU per transaction
  and a depth of 5,000,000; a lock or a release uses about 586,000.

### What stays public

- Who locks, for whom, when, the deadline, which function was called and the todo reference.
- The amount at the boundary where USDT is wrapped into or unwrapped out of the confidential token.
- Nothing forces a release: it stays the creator's decision, and the beneficiary has no on-chain
  claim, as in de2do.
- Decryption trusts Zama's threshold KMS.

## Toolchain

| Package | Version |
| --- | --- |
| `hardhat` | 2.28.6 (solc 0.8.27, EVM `cancun`) |
| `@fhevm/hardhat-plugin`, `@fhevm/mock-utils` | 0.4.2 |
| `@fhevm/solidity` | 0.11.1 |
| `@openzeppelin/confidential-contracts` | 0.5.3 |
| `@openzeppelin/contracts` | 5.6.1 |
| `@zama-fhe/relayer-sdk` | 0.4.1, the exact peer the plugin and `@fhevm/mock-utils` require |
| `@zama-fhe/sdk` | 3.6.0 (on `@fhevm/sdk` 0.13.2), for the smoke test |
| `ethers` | 6.16.0 |

Checked on 2026-09-16. Sepolia runs the host contracts of FHEVM v0.13: `getVersion()` returns ACL
v0.4.0, FHEVMExecutor v0.4.0, KMSVerifier v0.3.0, InputVerifier v0.2.0 and HCULimit v0.3.0, the
versions tagged v0.13.x in `zama-ai/fhevm`. The matching library, `@fhevm/solidity` 0.13.3, is
what nothing else supports yet: the Hardhat plugin 0.4.2 wants `^0.11.1`, OpenZeppelin's
confidential contracts 0.5.3 want exactly 0.11.1, and forge-fhevm pins 0.11.1 as well. Zama's
`fhevm-hardhat-template` and OpenZeppelin's own CI both resolve the plugin, library, relayer SDK and
Hardhat versions above.

So the project uses 0.11.1, the version its tools and OpenZeppelin's contracts were built and tested
with, after checking that it works against what Sepolia runs today:

- `ZamaConfig.sol` has the same Sepolia (and mainnet and local) addresses in 0.11.1 and 0.13.3:
  ACL `0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D`, FHEVMExecutor
  `0x92C920834Ec8941d2C77D188936E1f7A6f49c127`, KMSVerifier
  `0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A`, as on docs.zama.org.
- From 0.11.1 to 0.13.3 the executor interface only gains `fheSum` and `fheIsIn` (`FHE.sum`,
  `FHE.isIn`), and the KMS verifier interface changes a signer lookup that 0.11.1 declares but never
  calls. Every host function 0.11.1 calls is still declared in 0.13.3. The escrow's bytecode calls
  `verifyInput`, `trivialEncrypt`, `allow`, `allowTransient` and `isAllowed`; all five selectors are
  in the implementations deployed on Sepolia.
- The mock prices the FHE operations of a lock and a release (in the token) exactly like Sepolia's
  HCULimit and enforces the same per-transaction limits, so the HCU figures from the tests carry over.

Forcing 0.13.3 would break the peer ranges of the plugin and of OpenZeppelin for what 0.13 adds
(`FHE.sum`, `FHE.isIn`, Polygon configurations, a context-aware KMS signature check), none of which
this contract uses, and the mock host contracts the plugin deploys could not run `sum` or `isIn`
anyway. Foundry through forge-fhevm pins 0.11.1 too, has no tagged release, and would move the
tests away from the TypeScript SDK the app will use. Move to 0.13 when the plugin
(`zama-ai/fhevm-mocks` has a `release/0.13.x` branch) and OpenZeppelin release against it, all
together.

### Why npm

Zama's template and the plugin's instructions use npm. And pnpm is a trap here: some checkouts of
this repository carry a local, untracked `pnpm-workspace.yaml` at the root for pnpm 10's settings
(the root `.gitignore` keeps it out of git). Where that file exists, `pnpm install` inside
`contracts/` treats the root as the workspace and installs the app instead. npm ignores it.

The app's install is unaffected: pnpm 10 installs only the root project with or without that file,
and pnpm 9, which CI uses without it, does the same. The root `.prettierignore` skips `contracts/`;
the root ESLint configuration matches no file in it.

### Why `@zama-fhe/sdk`

The smoke test reaches Sepolia's relayer through `@zama-fhe/sdk` 3.6.0 (released 2026-09-11) and its
Node transport. Zama's documentation calls it the default SDK and `@zama-fhe/relayer-sdk` the legacy
one, and the `@fhevm/sdk` 0.13.2 it builds on is the v0.13 line Sepolia runs. It installs next to the
plugin's `@zama-fhe/relayer-sdk` 0.4.1. The latest relayer SDK, 0.4.4, would replace that exact peer
(npm: `ERESOLVE overriding peer dependency`). Both encrypted an amount through Sepolia's relayer on
2026-09-16, `@zama-fhe/sdk` in 9 to 14 s and relayer-sdk 0.4.4 in 19 s, start-up included. The TFHE
worker threads `@fhevm/sdk` starts for encryption outlive `ZamaSDK.terminate()` and keep Node running,
so the script exits explicitly.

## Sepolia runbook

In this order, all in `contracts/`: [prerequisites](#prerequisites), [`.env`](#env),
[deploy](#deploy), [record the deployment](#record-the-deployment),
[verify the source](#verify-the-source), [smoke test](#smoke-test), and for the next deployment the
[redeploy checklist](#redeploy-checklist).

### Prerequisites

- Node 22 or later, and `npm ci` in `contracts/` (not pnpm, see [Why npm](#why-npm)).
- A Sepolia JSON-RPC endpoint.
- A throwaway key that holds Sepolia ETH and nothing else. The deployment used 950,017 gas, a full
  smoke run needs about 2 to 3.5 M gas. The dry smoke run and Sourcify need no key; Etherscan needs
  an API key.
- `npm test` and `npm run typecheck` pass on the commit you deploy.

### `.env`

Copy `.env.example` to `.env` in this directory (git ignores it) and fill it in, or export the same
variables in the shell, which wins. Because the key can live in that file, whoever holds it can fill
it in and someone else can run the scripts without seeing it. No script prints a key; the smoke test
also keeps the RPC URL out of its output.

| Variable | Read by | |
| --- | --- | --- |
| `SEPOLIA_RPC_URL` | every Sepolia script | Any Sepolia JSON-RPC endpoint. |
| `DEPLOYER_PRIVATE_KEY` | `deploy:sepolia`, `smoke:sepolia` | The deployer, and the creator in the full smoke run. |
| `ESCROW_AUDITOR` | `deploy:sepolia` | Required. May decrypt every amount locked in the escrow, for the contract's lifetime. |
| `ESCROW_TOKEN` | `deploy:sepolia` | Optional, defaults to cUSDTMock. |
| `ETHERSCAN_API_KEY` | `verify:etherscan` | |

Per run, on the command line: `ESCROW_ADDRESS` and `ESCROW_DEPLOY_TX` for the verify scripts, and
`ESCROW_ADDRESS`, `SMOKE_AMOUNT`, `SMOKE_REFUND` and `SMOKE_DEBUG` for the [smoke test](#smoke-test).

### Deploy

```sh
npm run deploy:sepolia
```

[`scripts/deploy-sepolia.ts`](scripts/deploy-sepolia.ts) refuses any other network, checks that the
token is a contract, estimates the deployment first so a non-ERC-7984 token or a zero auditor fails
before any gas is spent, waits for two confirmations, checks `confidentialProtocolId()`, and prints
the escrow's address and block and the two commands that verify its source. The default token is
Zama's cUSDTMock, `0x4E7B06D78965594eB5EF5414c357ca21E1554491` (6 decimals, rate 1, over USDTMock
`0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0`, whose `mint` anyone may call, up to 1,000,000 tokens a
call).

### Record the deployment

Copy what the deployment printed into this table, and the address into `DEFAULT_ESCROW` in
[`scripts/smoke-sepolia.ts`](scripts/smoke-sepolia.ts).

| | |
| --- | --- |
| Escrow | [`0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429`](https://sepolia.etherscan.io/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429) |
| Deployed | 2026-09-16, block 11716748, [transaction](https://sepolia.etherscan.io/tx/0xaa01bc53d37c2fdb970ce663c004f58bb5b9ae90571979c24acdfbf3d81cbd60), 950,017 gas |
| Token | cUSDTMock `0x4E7B06D78965594eB5EF5414c357ca21E1554491` |
| Auditor | `0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621`, the deployer's own address, for now. Another auditor means another deployment. |
| Source | Verified on [Etherscan](https://sepolia.etherscan.io/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429#code) and [Sourcify](https://repo.sourcify.dev/11155111/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429), and shown as verified on [Blockscout](https://eth-sepolia.blockscout.com/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429?tab=contract) (2026-09-16, see [Verify the source](#verify-the-source)) |

Its runtime code matches this directory's build (solc 0.8.27) byte for byte outside the seven
immutable slots, which hold the token (five) and the auditor (two). Sourcify reports `match` for
creation and runtime code. `exact_match` is out of reach, because the build sets
`bytecodeHash: "none"` and the bytecode therefore carries no metadata hash to compare. Blockscout
imported Sourcify's result without a separate submission.

### Verify the source

Both scripts publish the source of this directory's build, so compile the commit that was deployed.
Neither signs anything, and the deployment prints both commands with its address filled in.

- **Sourcify**, no key needed:
  `ESCROW_ADDRESS=0x... ESCROW_DEPLOY_TX=0x... npm run verify:sourcify`.
  [`scripts/verify-sourcify.ts`](scripts/verify-sourcify.ts) uses Sourcify's API v2. Blockscout picks
  up the result from Sourcify.
- **Etherscan**, with `ETHERSCAN_API_KEY` in `.env` (it is never printed):
  `ESCROW_ADDRESS=0x... npm run verify:etherscan`.
  [`scripts/verify-etherscan.ts`](scripts/verify-etherscan.ts) submits the full standard JSON input and
  reads the constructor arguments from the escrow.

`npx hardhat verify` works for neither here. hardhat-verify 2.1.3, its last release for Hardhat 2,
calls Sourcify endpoints that Sourcify has removed. On Etherscan it first submits a minimal input,
the escrow and its imports only. Etherscan refused that for this deployment ("Compiled contract
deployment bytecode does NOT match"), and hardhat-verify stopped there instead of retrying with the
full input, which also holds the two mocks compiled in the same build.

### Smoke test

[`scripts/smoke-sepolia.ts`](scripts/smoke-sepolia.ts) runs the deployment against Zama's live relayer
and KMS, through `@zama-fhe/sdk` (see [Why `@zama-fhe/sdk`](#why-zama-fhesdk)). It expects the
escrow's token to be cUSDTMock. Every relayer call, encryption or decryption, gets three attempts,
10 s and 30 s apart, and each failed attempt is logged with the SDK's own message; transactions are
not retried. Each step prints `ok`, `FAILED` or `skipped` as it runs. The run ends with a table of
step, result, time, relayer attempts and Etherscan link, and exits with 1 if any step failed.

Every step of both modes, explained simply and technically with the transactions of the full run of
2026-09-16, is in [docs/smoke-test.md](../docs/smoke-test.md). What the test does not cover, whom the
escrow trusts and what is still open is in [docs/security.md](../docs/security.md).

#### Dry run

```sh
npm run smoke:sepolia:dry
```

It needs only `SEPOLIA_RPC_URL`: it does not read the key, signs nothing and sends nothing. It

1. checks that the RPC serves chain 11155111;
2. reads the escrow's code, `token()`, `auditor()` and `confidentialProtocolId()`, and the token's
   metadata, `rate()`, `underlying()`, `paused()`, `observers()` and the USDTMock mint cap;
3. encrypts `SMOKE_AMOUNT` (default 1 cUSDTMock) for the escrow and a random address through the
   relayer;
4. simulates the lock with that input (`eth_call` from the random address). It must revert with
   `ERC7984UnauthorizedSpender(random address, escrow)`: the escrow verified the input proof and called
   the token, which only lacks the operator approval. `InvalidSigner(address)` would mean Sepolia's
   InputVerifier refused the proof;
5. public-decrypts the newest amount cUSDTMock published for an unwrap (from its `UnwrapRequested`
   events), which goes through the same relayer and KMS as a user decryption;
6. prints the plan of the full run with its estimated cost.

The end of a dry run on 2026-09-16:

```text
step                                                result      time  attempts  transaction
RPC serves Sepolia                                  ok         0.8 s
escrow and token                                    ok         0.2 s
encrypt 1.0 cUSDTMock for (escrow, random address)  ok        13.6 s  1/3
simulate the lock (eth_call)                        ok         0.3 s
public decrypt (relayer and KMS)                    ok         2.3 s  1/3

passed: 5 steps ok
```

In three dry runs on 2026-09-16 the encryption took 10.0 to 13.6 s, counting the SDK's start-up, the
proof it builds locally and the relayer round trip, and the public decryption took 2.3 s each time;
the whole command took about 25 s, compilation included. A dry run cannot time a user decryption: that needs
an account with an ACL grant on the handle, which only the full run creates.

#### Full run

```sh
npm run smoke:sepolia                  # SMOKE_AMOUNT=1 by default
SMOKE_REFUND=1 npm run smoke:sepolia   # also a refund, a few minutes longer
```

It needs `DEPLOYER_PRIVATE_KEY` with Sepolia ETH; that account is the creator, and in this deployment
also the auditor. The beneficiary is a wallet made in memory for the run. It only signs decryption
requests, needs no ETH, and its key is never printed.

| Step | What it does | Passes when |
| --- | --- | --- |
| 1. Fund | Decrypts the creator's cUSDTMock balance. Below `SMOKE_AMOUNT` (twice that with `SMOKE_REFUND`) it mints USDTMock, approves cUSDTMock (a non-zero allowance goes to 0 first, USDT's rule) and wraps. | The transactions are mined. |
| 2. Operator | `setOperator(escrow, now + 1 h)` | `isOperator(creator, escrow)` |
| 3. Lock | Encrypts `SMOKE_AMOUNT` for (escrow, creator) and locks it for the beneficiary under `keccak256(abi.encode("smoke-<timestamp>", salt))`, deadline in one day. | `Locked` is emitted. |
| 4. Check | `escrowOf`, then user decryption of the amount as creator and as beneficiary, each with its own EIP-712 permit. | Status `Locked`; both decrypt to `SMOKE_AMOUNT`. |
| 5. Shortfall | Locks 2^64 - 1, more than any balance, under a second `todoRef`. | The lock goes through, and its amount decrypts to 0. |
| 6. Release | Releases the first lock; `escrowOf`; the beneficiary decrypts its cUSDTMock balance. | Status `Released`; the balance decrypts to `SMOKE_AMOUNT`. |
| 7. Refund | Only with `SMOKE_REFUND=1`: locks with a 90 s deadline, decrypts the lock and the creator's balance, waits for a block past the deadline, refunds. | Status `Refunded`; the balance rose by `SMOKE_AMOUNT`. |

A transaction whose result is decrypted next waits for two confirmations first. A step whose input
failed is skipped. A good run ends with every step `ok`, relayer steps at `1/3` when the relayer
answered at once, then `spent ... ETH in N transactions; the creator went from ... to ... ETH` and
`passed: N steps ok, M skipped`. `ESCROW_ADDRESS` tests another deployment, `SMOKE_AMOUNT` takes
cUSDTMock with up to 6 decimals, and `SMOKE_DEBUG=1` adds the SDK's diagnostics and `@fhevm/sdk`'s
trace of every relayer request.

#### Full run of 2026-09-16

Creator and auditor `0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621`, beneficiary
`0x3e715fAc356AcB5b7A7383e6cbde865bCeF596BB` (made for the run), `SMOKE_AMOUNT` 1, no `SMOKE_REFUND`,
`@zama-fhe/sdk` 3.6.0 on `@fhevm/sdk` 0.13.2. The creator's cUSDTMock balance handle was still zero,
so the script read it as 0.0 (never funded) without a relayer request, and step 1 minted, approved and
wrapped. Times are the script's step times, including the wait for one confirmation, or two before a
decryption; gas is from the receipts.

| Step | Time | Transaction | Gas |
| --- | ---: | --- | ---: |
| mint 1.0 USDTMock | 8.4 s | [`0xe9e177db…`](https://sepolia.etherscan.io/tx/0xe9e177db627ff3d769af661b5724ac2777d57883803e1c7bcd3a1a2af2b1288c) | 51,760 |
| approve | 12.5 s | [`0x41630980…`](https://sepolia.etherscan.io/tx/0x416309800691580524f8d9a2bbe2130c31651e1939a1cb258b0f520c1ac15d79) | 46,600 |
| wrap into 1.0 cUSDTMock | 24.8 s | [`0x567d87cb…`](https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de) | 367,250 |
| `setOperator(escrow, now + 1 h)` | 24.9 s | [`0x79a1a622…`](https://sepolia.etherscan.io/tx/0x79a1a622a864129daa23d887d9c56fee578066222065dab6514c5cbe830c4b51) | 51,129 |
| encrypt 1.0 | 9.6 s | – | – |
| lock, 2 confirmations | 37.0 s | [`0x04259275…`](https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065), block 11717341 | 682,630 |
| decrypt the amount as creator | 2.8 s | – | – |
| decrypt the amount as beneficiary | 2.3 s | – | – |
| encrypt uint64 max | 4.5 s | – | – |
| lock uint64 max (underfunded) | | [`0xfbe2cd1e…`](https://sepolia.etherscan.io/tx/0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6), block 11717345 | 657,529 |
| release | | [`0xd9d123e6…`](https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c), block 11717348 | 412,902 |

Both decryptions returned 1.0 cUSDTMock, and every relayer step took less than the 10 s a retry waits,
so each succeeded on its first attempt. `escrowOf` showed `Locked` after both locks, with amount handle
`0x506d80703a79c87b91a050038fb7baf8bb1e70c1e4ff0000000000aa36a70500` for the first. The recorded output
ends after `escrowOf` of the underfunded lock; its decryption to 0 and the beneficiary's balance after the
release are not in it. On chain, `escrowOf` shows `Released` for the first `todoRef` and the
beneficiary's balance handle is non-zero. The seven transactions used 2,269,800 gas and cost
0.002420484746174163 ETH at 1.006 to 1.115 gwei: the creator went from 2.247756 to 2.245336 ETH.

#### Cost

- The dry run costs nothing.
- A full run sends 4 transactions when the creator already holds the amount in cUSDTMock
  (`setOperator`, two locks, the release) and 7 when it wraps first; `SMOKE_REFUND` adds a lock and a
  refund. That is about 1.9 M gas, 2.4 M with wrapping and 1.1 M more with the refund. A lock takes
  about 0.7 M (`eth_estimateGas` on Sepolia), a wrap 0.35 M, mint, approve and `setOperator` 35 to
  52 k each (as mined on Sepolia); release and refund take 0.35 and 0.33 M in the FHEVM mock, which
  prices a lock at 0.53 M. At the 1 to 2 gwei of 2026-09-16 a run costs 0.002 to 0.007 ETH, and prints
  what it paid.
- Measured in the full run of 2026-09-16, with wrapping: 2,269,800 gas and 0.00242 ETH for 7
  transactions. A lock used 682,630 gas (657,529 for the underfunded one), a release 412,902, a wrap
  367,250, and mint, approve and `setOperator` 46,600 to 51,760.
- The `SMOKE_AMOUNT` each run releases stays with a beneficiary whose key is gone, and the
  underfunded lock stays `Locked` over an encrypted 0.

#### Troubleshooting

- **`Relayer API error [internal_server_error]: Transaction simulation failed: Execution reverted`**
  (HTTP 500 from `/v2/user-decrypt`): in the incident of 2026-08-31 to 2026-09-01, handles created
  after it began would not decrypt, while older ones did. Zama's first analysis pointed to stale RPC
  data in part of the relayer ([community.zama.org/t/4643](https://community.zama.org/t/4643)). The
  script waits two confirmations and retries; when all attempts fail, rerun later before suspecting the
  escrow.
- **`Gao decoding failure: Allowed at most 0 errors ... n=13, deg=4, #shares=9`**: the client got the
  9-share quorum of the 13 KMS nodes, one share was inconsistent, and the value could not be
  reconstructed ([community.zama.org/t/4653](https://community.zama.org/t/4653), also in t/4643).
  fhevm v0.13.4 (2026-09-04) lets the relayer wait for extra shares, which tolerates a bad one;
  whether Sepolia's relayer runs it cannot be seen from outside. It is not the escrow: retry later.
- **`NotEntitledError`, `is not authorized to decrypt handle`**: the SDK reads the ACL through
  `SEPOLIA_RPC_URL` before it asks the relayer. Right after a transaction a lagging RPC can cause it;
  if it persists, the account lacks the grant.
- **`InvalidSigner(address)`** in the simulated lock or a real one: the input proof was made for
  another contract or user, or the SDK's Sepolia addresses no longer match the chain.
- **`ERC7984UnauthorizedSpender(creator, escrow)`** on a lock: the operator approval is missing or
  has lapsed.
- **A lock that decrypts to 0** where `SMOKE_AMOUNT` was expected: the creator's cUSDTMock balance was
  too low, so check step 1.
- **`no result within 240 s`**: an attempt hung, often in the SDK's start-up (the FHE key download
  and WASM). The next attempt starts from a new SDK instance.
- Rerun with `SMOKE_DEBUG=1` to see each relayer request, its job id and retries.

### Redeploy checklist

For another auditor or another token, both fixed at deployment, or when Sepolia moves to FHEVM v0.14
(new ACL, KMS context rotation, unified user decryption; released, not yet on Sepolia), which may
need a newer `@fhevm/solidity` and SDK:

1. For a protocol change, update the library and SDK first; `npm test` and `npm run typecheck` pass.
2. Set `ESCROW_AUDITOR`, and `ESCROW_TOKEN` if it changes, in `.env`, and check the deployer's ETH.
3. `npm run deploy:sepolia` from a committed tree.
4. Run the two verify commands the deployment printed.
5. [Record the deployment](#record-the-deployment), including `DEFAULT_ESCROW` in
   `scripts/smoke-sepolia.ts`.
6. `npm run smoke:sepolia:dry`, then `npm run smoke:sepolia`.
7. Point the app at the new address. Escrows in the old contract stay there: their creators release
   or refund them there, and the old auditor can still decrypt every amount ever locked in it.

### Before relying on a deployment

- cUSDTMock is a UUPS proxy whose owner, a contract, can replace the implementation. The escrow's
  balance depends on that implementation staying the ERC-7984 it is today.
- The auditor can decrypt every amount ever locked in the contract. A leaked auditor key cannot be
  rotated, only answered with a new deployment.
- A failed decryption on Sepolia is not necessarily this contract; see
  [Troubleshooting](#troubleshooting).
