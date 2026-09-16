# The confidential escrow

The `escrow01` chapter puts a budget on a delegated todo. The budget sits in a smart contract,
[`ConfidentialTodoEscrow`](../contracts/src/ConfidentialTodoEscrow.sol), and is paid in an ERC-7984
confidential token whose amounts are encrypted with Zama's FHEVM. This page describes what the escrow
does. How Zama's protocol encrypts, computes and decrypts is in
[zama-confidential-transactions.md](zama-confidential-transactions.md), what leaks and whom you trust
is in [security.md](security.md), and a real run on Sepolia, transaction by transaction, is in
[smoke-test.md](smoke-test.md).

State on 2026-09-16: the contract is deployed on Sepolia at
[`0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429`](https://sepolia.etherscan.io/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429)
(block 11716748) and its source is verified on Etherscan, Sourcify and Blockscout. The app's budget
screens do not use it yet: they run against an in-memory fake
([`src/lib/budget-service-fake.js`](../src/lib/budget-service-fake.js)).

Every section has a simple explanation and a technical one.

- [Roles](#roles)
- [Lock](#lock-simple)
- [Release](#release-simple)
- [Refund after the deadline](#refund-simple)
- [States](#states)
- [`todoRef` and its salt](#todoref-simple)
- [Why only ERC-7984 confidential tokens](#erc-7984-simple)
- [What wrap and unwrap reveal](#wrap-and-unwrap-simple)
- [The encrypted zero of an underfunded lock](#underfunded-lock-simple)
- [What the app stores in OrbitDB](#orbitdb-simple)
- [What is public and what is encrypted](#what-is-public-and-what-is-encrypted)

## Roles

| Role | Simple | Technical |
| --- | --- | --- |
| Creator | Owns the todo, puts the money in, decides when it is paid out. | The `msg.sender` of `lock`. Escrows are stored as `_escrows[creator][todoRef]`, so only the creator can `release` or `refund` (the lookup uses `msg.sender`). |
| Beneficiary | The person the todo is delegated to; receives the money on release. | An address passed to `lock`. It must not be `address(0)` or the escrow itself; the contract does not forbid the creator's own address, the app does. The beneficiary has no function to call and no on-chain claim. |
| Auditor | Can read every amount locked in this escrow, and nothing else. | An address fixed in the constructor (`immutable`). `lock` grants it persistent ACL access to each stored amount. It cannot move funds. Changing it means deploying a new escrow. In the Sepolia deployment it is the deployer's own address. |
| Token | The confidential money itself. | One ERC-7984 token, fixed in the constructor and checked through ERC-165. On Sepolia: Zama's cUSDTMock `0x4E7B06D78965594eB5EF5414c357ca21E1554491`. |

The escrow has no owner, no fee, no upgrade path and no function that moves a locked amount other
than `release` and `refund`.

## Lifecycle

### Lock: simple

Alice sets money aside for a todo she gave to Bob, and picks a deadline. Her browser encrypts the
amount before it is sent. The escrow takes the money from her confidential balance and notes that it
is for Bob. On the chain the amount stays encrypted; Alice, Bob and the auditor can read it.

### Lock: technical

Before the call, on the client:

1. The creator already holds the amount in the confidential token. Wrapping the public token right
   before locking would reveal the amount (see [What wrap and unwrap reveal](#wrap-and-unwrap-technical)).
2. The creator makes the escrow an operator of their balance: `token.setOperator(escrow, until)`. The
   token stores `until` as a timestamp; `isOperator(holder, spender)` is true while
   `block.timestamp <= until`.
3. The client encrypts the amount for the pair (escrow, creator), for example with
   `sdk.encrypt({ values: [{ type: "euint64", value }], contractAddress: escrow, userAddress: creator })`.
   The result is an input handle and an `inputProof` carrying coprocessor signatures over the handle,
   the user, the contract and the chain id.

The call is
`lock(bytes32 todoRef, address beneficiary, externalEuint64 encAmount, bytes inputProof, uint64 deadline)`:

1. Argument checks: `todoRef != 0`, `beneficiary` is neither `address(0)` nor the escrow,
   `block.timestamp < deadline <= block.timestamp + 365 days`, and no escrow exists yet under
   `(msg.sender, todoRef)`. Otherwise it reverts with `ZeroTodoRef`, `InvalidBeneficiary`,
   `InvalidDeadline` or `EscrowExists`.
2. Beneficiary, deadline and status `Locked` are written to storage before any external call.
3. `FHE.fromExternal(encAmount, inputProof)` calls `FHEVMExecutor.verifyInput(handle, msg.sender,
   inputProof, euint64)`. The executor passes the escrow as the contract and the creator as the user
   to `InputVerifier`, which checks the coprocessor signatures. A proof made for another contract or
   another user fails with `InvalidSigner`. On success the escrow and the creator get a transient ACL
   allowance on the handle for this transaction.
4. `FHE.allowTransient(requested, token)` lets the token compute with the handle in this
   transaction.
5. `token.confidentialTransferFrom(creator, escrow, requested)`, the `euint64` overload. The token
   requires `isAllowed(requested, escrow)` and `isOperator(creator, escrow)`, otherwise
   `ERC7984UnauthorizedUseOfEncryptedAmount` or `ERC7984UnauthorizedSpender`. Its `_update` computes,
   all under encryption: `success = balance >= amount`, `newBalance = select(success, balance - amount,
   balance)`, `transferred = select(success, amount, 0)` and `escrowBalance + transferred`. It grants
   persistent ACL access to the new balances and to `transferred` (for the creator, the escrow and
   the token itself), emits `ConfidentialTransfer(creator, escrow, transferred)` and returns
   `transferred` with a transient allowance for the escrow.
6. The escrow grants persistent access to `transferred` for itself, the creator, the beneficiary and
   the auditor, stores it as the escrow's `amount` and emits `Locked(creator, todoRef, beneficiary,
   deadline)`.

Every FHE operation in steps 3 to 6 is symbolic on Ethereum: the FHEVMExecutor returns a new handle
and emits an event, and Zama's coprocessors compute the ciphertext off-chain. On Sepolia on
2026-09-16 the first lock of the smoke test used 682,630 gas and produced 21 event logs, listed in
[smoke-test.md](smoke-test.md#step-3-lock-technical).

### Release: simple

When Bob is done, Alice releases the budget. The escrow pays the locked amount into Bob's
confidential balance. Only Alice can do this, at any time while the money is locked, even after the
deadline.

### Release: technical

`release(bytes32 todoRef)` looks the escrow up under `_escrows[msg.sender][todoRef]`. For anyone but
the creator that entry is empty and the call reverts with `EscrowNotFound`; an escrow that is not
`Locked` reverts with `EscrowClosed`. The status becomes `Released` before the transfer. The escrow
then grants the token a transient allowance on the stored amount and calls
`token.confidentialTransfer(beneficiary, amount)`. The token requires `isAllowed(amount, escrow)`
(the escrow holds a persistent allowance from the lock) and runs the same `_update` as above from the
escrow to the beneficiary: `transferred = select(escrowBalance >= amount, amount, 0)`. The escrow's
balance is the sum of everything locked and not yet paid out, so it covers each stored amount and
the whole amount moves. The escrow emits `Released(creator, todoRef, beneficiary)`; the token emits
`ConfidentialTransfer(escrow, beneficiary, transferred)`.

Nothing forces a release. The beneficiary has no on-chain claim; paying out stays the creator's
decision.

### Refund: simple

If the deadline has passed and the money is still locked, Alice can take it back.

### Refund: technical

`refund(bytes32 todoRef)` performs the same lookup and status checks as `release`, and additionally
requires `block.timestamp > deadline`: a block stamped exactly at the deadline is still too early
(`DeadlineNotReached`). The status becomes `Refunded`, the amount goes back to `msg.sender` through
`confidentialTransfer`, and the escrow emits `Refunded(creator, todoRef)`. The app has no refund
button yet. The Hardhat tests cover refunds; the Sepolia smoke test does one only with
`SMOKE_REFUND=1`, which the full run of 2026-09-16 did not use.

### States

| Status | Reached by | Allowed next |
| --- | --- | --- |
| `None` | nothing locked under `(creator, todoRef)` | `lock` |
| `Locked` | `lock` | `release`, or `refund` after the deadline |
| `Released` | `release` | nothing |
| `Refunded` | `refund` | nothing |

`escrowOf(creator, todoRef)` returns `(beneficiary, deadline, status, amount)` to anyone; `amount` is
a handle. After a release or refund the handle stays decryptable by the creator, the beneficiary and
the auditor, as a record of what was locked. A `todoRef` cannot be locked again under the same
creator, even after it is closed.

## `todoRef` and its salt

### `todoRef`: simple

The escrow does not know which todo it belongs to. It only knows a reference number that the app
computes from the todo and a random value, so the todo's own ID does not lead to the escrow.

### `todoRef`: technical

`todoRef` is any non-zero `bytes32`; the contract does not check how it was made. The contract's
documentation recommends `keccak256(abi.encode(todoId, salt))` with 32 random bytes of salt kept with
the todo and shared with the beneficiary. Implementations in this repository:

| Where | Computation | Salt kept? |
| --- | --- | --- |
| Hardhat tests | `keccak256(abi.encode(string todoId, bytes32 salt))` | no |
| Smoke test | `keccak256(abi.encode(string "smoke-<unix time>", bytes32 salt))` | no |
| App fake (`createTodoRef`) | `sha256("<todoKey>:<64 hex chars of random bytes>")` | no |

The app writes the `todoRef` itself into the todo's `budget` field in OrbitDB, so the beneficiary
finds the escrow through the todo, not through the salt. Two consequences:

- Anyone who can read the list reads the `todoRef` and can find the escrow on chain, with creator,
  beneficiary, deadline and status, but not the amount.
- The salt only stops someone who knows a todo's key but cannot read the list from computing the
  reference.

Escrows are keyed by creator and `todoRef` together. Somebody who copies a `todoRef` from a pending
transaction and locks under it first creates their own escrow and does not block the creator's
(test "keeps a creator's todoRef out of reach of someone who locks under it first"). Each `todoRef`
is used once per creator. That includes an underfunded lock: it is mined and occupies its reference,
so the app's retry creates a new `todoRef` ([`startLock`](../src/lib/budget.js)).

## Why only ERC-7984 confidential tokens

### ERC-7984: simple

With ordinary tokens, and with ETH, everyone can read on the chain how much was sent and how much
everyone holds. A confidential token keeps balances and transfer amounts encrypted. That is the
only reason this escrow can keep a budget private.

### ERC-7984: technical

An ERC-20 transfer emits `Transfer(from, to, value)` with the value in clear, and `balanceOf` is a
public view. ERC-7984, as implemented by OpenZeppelin's confidential contracts, stores each balance
as a `euint64` handle, moves encrypted amounts, emits
`ConfidentialTransfer(from, to, euint64 amount)` with only the handle, and controls who may decrypt
through the FHEVM ACL. The constructor reverts with `TokenNotERC7984` unless the token declares
`type(IERC7984).interfaceId` through ERC-165.

The escrow uses the `euint64` overload of `confidentialTransferFrom` and verifies the input proof
itself. Two alternatives fail, and the tests show both:

- Forwarding the external handle and proof to the token's `confidentialTransferFrom(from, to,
  externalEuint64, bytes)`: the token verifies the proof as if the token were the contract and the
  escrow the user, which is not what the creator encrypted for, so `InputVerifier` reverts with
  `InvalidSigner`.
- Encrypting for (token, escrow) so that forwarding passes: the proof then names no creator, and
  anyone can replay it against their own balance and decrypt the amount it produces.

An existing handle can be locked without a proof (`inputProof` empty). `FHE.fromExternal` then
requires `isAllowed(handle, msg.sender)`, and the escrow must be allowed on it too, so nobody can
lock a handle they have no access to (test "takes an existing handle without a proof only from
someone who may use it").

## What wrap and unwrap reveal

### Wrap and unwrap: simple

Turning ordinary USDT into confidential cUSDT, and back, happens in the open, with the amount. What
happens with the confidential balance after that is hidden. So wrap well before locking, and not
exactly the amount you are about to lock.

### Wrap and unwrap: technical

`wrap(to, amount)` on cUSDTMock (Zama's `ConfidentialWrapper`) makes the amount public in four places.
The smoke test's wrap of 1.0 cUSDTMock on 2026-09-16
([`0x567d87cb…`](https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de))
shows all of them:

- the calldata, `amount = 1000000` (6 decimals);
- the underlying ERC-20 `Transfer(creator, cUSDTMock, 1000000)`, which Etherscan lists under
  "ERC-20 Tokens Transferred";
- the FHEVMExecutor's `TrivialEncrypt(pt = 1000000, toType = 5)`: the wrapper creates the encrypted
  amount with `FHE.asEuint64(amount)`, a trivial encryption of a public value;
- the wrapper's own `Wrap(to, roundedAmount = 1000000, encryptedWrappedAmount)`.

Unwrapping has two steps. `unwrap` burns an encrypted amount, marks the burnt handle as publicly
decryptable in the ACL (`FHE.makePubliclyDecryptable`) and emits `UnwrapRequested(receiver,
unwrapRequestId, amount)`. From then on anyone can ask Zama's KMS to decrypt that handle; the dry
run of the smoke test does exactly that with the newest one. `finalizeUnwrap(unwrapRequestId,
cleartext, decryptionProof)` then puts the clear amount in calldata, checks the KMS signatures,
transfers the underlying ERC-20 and emits `UnwrapFinalized` with the clear amount.

Amounts can also leak by correlation: a wrap of X shortly before a lock by the same address suggests
a locked amount of at most X.

## The encrypted zero of an underfunded lock

### Underfunded lock: simple

If Alice tries to lock more than she has, the lock does not fail. It goes through and locks nothing.
Nobody can see that from the outside; only decrypting the locked amount shows it. The app is built to
read the amount back after a lock before it treats the budget as funded.

### Underfunded lock: technical

ERC-7984's `_update` never reverts on a low balance, because the contract cannot branch on an
encrypted comparison. It computes `transferred = select(balance >= amount, amount, 0)`, where `0` is
a trivial encryption. The escrow stores `transferred`. Both cases run the same operations (`FheGe`,
`FheSub`, `FheIfThenElse`, `TrivialEncrypt`, `FheIfThenElse`, `FheAdd`) and end in a fresh result
handle, so nothing public distinguishes a full lock from an empty one. The two locks of the smoke run
differ by one log (21 and 20), and that comes from the escrow's balance, which was still
uninitialized before the first lock and needed an extra `TrivialEncrypt` of 0, not from the shortfall.
A release of an underfunded escrow moves an encrypted 0 (Hardhat test "stores an encrypted 0 for an
underfunded lock, and a release moves 0").

The smoke test locks 2^64 - 1 base units to provoke this. On 2026-09-16 that lock was mined in block
11717345 with 657,529 gas and `escrowOf` shows `Locked`, with stored handle
`0xc05db6de11bd957b0b95e45ceedfe4c91040dbdfb8ff0000000000aa36a70500`. The terminal output available
for this documentation ends before the decryption of that amount, so this page does not claim that it
decrypted to 0 on Sepolia; in the Hardhat mock it does.

In the app, the budget service interface specifies that `lock` throws `insufficient-balance` with
`details.lockTx` when the transfer went through as an encrypted 0, and the fake does so. The todo's
budget then goes to `failed` and keeps the mined `lockTx` ([`lockFailed`](../src/lib/budget.js)).

## What the app stores in OrbitDB

### OrbitDB: simple

The shared todo list stores the budget's status and the references needed to find it on the chain,
never the amount. Amounts come from the chain, decrypted on the device of someone allowed to read
them.

### OrbitDB: technical

A todo carries a `budget` field ([`src/lib/budget.js`](../src/lib/budget.js)):

```js
{ mode: 'zama-confidential', status, token, escrow, todoRef, lockTx, releaseTx, lastError }
```

`status` is one of `none`, `locking`, `funded`, `releasing`, `released`, `failed`. The app lets only
the todo's owner write it ([`setTodoBudget`](../src/lib/db-actions.js)), and each step of a lock or release
is written before the next one starts ([`src/lib/budget-flow.js`](../src/lib/budget-flow.js)). A
typed amount stays in memory (`pendingAmounts` in
[`src/lib/budget-store.js`](../src/lib/budget-store.js)) until the escrow holds it; afterwards the
displayed amount is the result of `decryptAmount`. The list itself is not encrypted: anyone with its
address can read todo text, delegate DID and `budget`.

The chain stays the source of truth for three reasons:

- An OrbitDB entry holds whatever a member of the write set wrote. The app ignores a malformed
  `budget` (`isWellFormedBudget`), but a well-formed one can still be wrong.
- The status in OrbitDB can lag behind the chain. A reload in the middle of a lock leaves
  `locking` with a `todoRef` to reconcile from.
- Only `escrowOf(creator, todoRef)` and the token's balances say what is locked and who holds what,
  and only decryption says how much.

The fake shows the limits of the current build: its escrows live in one tab's memory, so a reload,
or the delegate's own browser, finds the todo's `budget` but no escrow (`escrow-not-found`, the
amount shows as unreadable).

## What is public and what is encrypted

| Item | On Sepolia | Where it shows |
| --- | --- | --- |
| Creator address | public | transaction sender; `Locked` topic 1 |
| Beneficiary address | public | `lock` calldata; `Locked` topic 3; ACL `Allowed` event |
| Auditor address | public | `auditor()`; ACL `Allowed` event in every lock |
| Time of lock, release, refund | public | block timestamp |
| Function called | public | method selector; Etherscan shows "Lock", "Release" |
| `todoRef` | public | calldata; `Locked`, `Released`, `Refunded` topic 2 |
| Deadline | public | calldata; `Locked` data |
| Gas and fee | public | receipt |
| Amount handles | public | calldata (input handle), `VerifyInput`, `ConfidentialTransfer` topic 3, `Allowed`, `escrowOf` |
| Input proof (coprocessor signatures) | public | calldata; `VerifyInput` data |
| Who may decrypt a handle | public | ACL `Allowed` events |
| The computation (which FHE operations on which handles) | public | FHEVMExecutor events |
| Amount locked, released or refunded | encrypted | only its handle is on chain |
| Balances | encrypted | only their handles are on chain |
| Whether a lock was underfunded | encrypted | indistinguishable on chain |
| Wrap and unwrap amounts | public | calldata, ERC-20 `Transfer`, `TrivialEncrypt`, `Wrap`, `UnwrapFinalized` |
| Todo text, delegate DID, `todoRef`, budget status | not on chain | OrbitDB, readable by anyone with the list's address |

## Sources

Repository (branch `escrow01`):

- [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol): roles
  and immutables lines 44-54, events 56-59, constructor 71-78, `lock` 100-136, `release` 143-148,
  `refund` 150-158, `escrowOf` 168-175, `_send` 183-190.
- [`contracts/test/ConfidentialTodoEscrow.ts`](../contracts/test/ConfidentialTodoEscrow.ts):
  underfunded lock 167-185, auditor and stranger 187-212, creator-only release 214-229, refund
  deadline 231-263, front-running a `todoRef` 322-338, replayed input 363-377, forwarding versus own
  verification 379-419, existing handle without proof 421-444, token and auditor checks 474-491, no
  amounts in events 493-534.
- [`contracts/scripts/smoke-sepolia.ts`](../contracts/scripts/smoke-sepolia.ts): `todoRef` 406-410,
  lock 573-601.
- [`contracts/README.md`](../contracts/README.md): "Who can decrypt" and "What stays public".
- [`src/lib/budget.js`](../src/lib/budget.js): `Budget` 52-65, `isWellFormedBudget` 107-130,
  `startLock` 143-170, `lockFailed` 182-196.
- [`src/lib/budget-service.js`](../src/lib/budget-service.js) 1-84,
  [`src/lib/budget-service-fake.js`](../src/lib/budget-service-fake.js) 1-18 and 171-236,
  [`src/lib/budget-flow.js`](../src/lib/budget-flow.js), [`src/lib/budget-store.js`](../src/lib/budget-store.js)
  1-10 and 57-75, [`src/lib/db-actions.js`](../src/lib/db-actions.js) 944-958.

Libraries (`contracts/node_modules`):

- `@openzeppelin/confidential-contracts` 0.5.3: `token/ERC7984/ERC7984.sol` (`isOperator` 99,
  `confidentialTransfer` 121, `confidentialTransferFrom` 140, `_update` 290-323),
  `utils/FHESafeMath.sol` (`tryDecrease` 34-43), `interfaces/IERC7984.sol` (events 14-25),
  `token/ERC7984/extensions/ERC7984ERC20Wrapper.sol` (`wrap` 82, `finalizeUnwrap` 114-135, `_unwrap`
  212-229).
- `@fhevm/solidity` 0.11.1: `lib/FHE.sol` (`fromExternal` for `euint64` 8598-8609, `allow`,
  `allowThis`, `allowTransient` 9081-9111), `lib/Impl.sol` (`verify` 670-674).

cUSDTMock on Sepolia (implementation `0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04`, exact match on
Sourcify): <https://sourcify.dev/server/v2/contract/11155111/0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04?fields=sources>

- `contracts/token/ERC7984Upgradeable.sol`: `confidentialTransferFrom` 175-184, `_update` 343-378.
- `contracts/extensions/ERC7984ERC20WrapperUpgradeable.sol`: `Wrap` event 43, `wrap` 107-119,
  `_unwrap` 249-268.

Chain (read through `https://ethereum-sepolia-rpc.publicnode.com` and Etherscan on 2026-09-16):

- Wrap: <https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de>
- Lock: <https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065>
- Underfunded lock: <https://sepolia.etherscan.io/tx/0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6>
- Release: <https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c>

Zama documentation:

- Confidential wrapper: <https://docs.zama.org/protocol/protocol-apps/confidential-tokens/confidential-wrapper>
- SDK security model, "What is visible": <https://docs.zama.org/protocol/sdk/concepts/security-model>
