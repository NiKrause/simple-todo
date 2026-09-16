# ConfidentialTodoEscrow

The escrow half of [de2do](https://github.com/NiKrause/de2do), with the amount kept confidential by
Zama FHEVM ([#378](https://github.com/NiKrause/simple-todo/issues/378), part of the `escrow01`
chapter, [#382](https://github.com/NiKrause/simple-todo/issues/382)). Alice locks a budget for a
todo she delegated to Bob, and releases it when he is done, or takes it back after a deadline. The
budget is an ERC-7984 confidential token, such as Zama's cUSDT, and its amount stays encrypted:
Alice, Bob and an auditor can decrypt it, nobody else.

This directory is its own project with its own `package.json`. The app's `pnpm install` does not
see it (see [Why npm](#why-npm)), and nothing in the app's CI runs it.

```sh
cd contracts
npm ci          # Node 22 or later
npm test        # FHEVM mock mode, no network
npm run typecheck
```

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
| `@zama-fhe/relayer-sdk` | 0.4.1 |
| `ethers` | 6.16.0 |

Checked on 2026-09-16. Sepolia runs the host contracts of FHEVM v0.13: `getVersion()` returns ACL
v0.4.0, FHEVMExecutor v0.4.0, KMSVerifier v0.3.0, InputVerifier v0.2.0 and HCULimit v0.3.0, the
versions tagged v0.13.x in `zama-ai/fhevm`. The matching library, `@fhevm/solidity` 0.13.3, is
what nothing else supports yet: the Hardhat plugin 0.4.2 wants `^0.11.1`, OpenZeppelin's
confidential contracts 0.5.3 want exactly 0.11.1, and forge-fhevm pins 0.11.1 as well. Zama's
`fhevm-hardhat-template` and OpenZeppelin's own CI both resolve the plugin, library, SDK and
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

## Deploy to Sepolia

```sh
export SEPOLIA_RPC_URL=https://...
export DEPLOYER_PRIVATE_KEY=0x...     # a throwaway key with a little Sepolia ETH
export ESCROW_AUDITOR=0x...           # required, fixed for the contract's lifetime
export ESCROW_TOKEN=0x...             # optional, defaults to cUSDTMock
npm run deploy:sepolia
```

[`scripts/deploy-sepolia.ts`](scripts/deploy-sepolia.ts) refuses any other network, checks that the
token is a contract, estimates the deployment first so a non-ERC-7984 token or a zero auditor fails
before any gas is spent, and prints the `hardhat verify` command. The default token is Zama's
cUSDTMock, `0x4E7B06D78965594eB5EF5414c357ca21E1554491` (6 decimals, rate 1, over USDTMock
`0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0`, whose `mint` anyone may call). It has not been run yet.

Before relying on a deployment:

- cUSDTMock is a UUPS proxy whose owner, a contract, can replace the implementation. The escrow's
  balance depends on that implementation staying the ERC-7984 it is today.
- The auditor can decrypt every amount ever locked in the contract. A leaked auditor key cannot be
  rotated, only answered with a new deployment.
- FHEVM v0.14 (new ACL, KMS context rotation, unified user decryption) is released but not yet on
  Sepolia. An upgrade there may need a new library version and a redeploy.
- Sepolia's decryption has had incidents in September 2026 (handles that would not decrypt for a
  few days, a KMS share-decoding failure); a failed decrypt is not necessarily this contract.
- The plugin pins `@zama-fhe/relayer-sdk` 0.4.1 for its Sepolia tasks, while 0.4.4 and Zama's newer
  SDKs are current; the app should pick its own SDK against the live relayer.
