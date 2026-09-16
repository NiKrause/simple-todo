# The smoke test on Sepolia

[`contracts/scripts/smoke-sepolia.ts`](../contracts/scripts/smoke-sepolia.ts) tests the deployed escrow
against Zama's live relayer, coprocessors and KMS on Sepolia. It has two modes:

| Mode     | Command                     | Needs                                        | Sends                                         | Shows                                                                                                                |
| -------- | --------------------------- | -------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Dry run  | `npm run smoke:sepolia:dry` | `SEPOLIA_RPC_URL`                            | nothing, signs nothing                        | chain, contracts, encryption through the relayer, the escrow accepting that input, public decryption through the KMS |
| Full run | `npm run smoke:sepolia`     | also `DEPLOYER_PRIVATE_KEY` with Sepolia ETH | 4 to 7 transactions (9 with `SMOKE_REFUND=1`) | a real lock, the amount read back by creator and beneficiary, an underfunded lock, a release                         |

Both run in `contracts/` (see [contracts/README.md](../contracts/README.md#smoke-test) for set-up and
troubleshooting). This page explains every step twice, simply and technically, and uses the full run
of 2026-09-16 as the worked example: its transactions were read back from the chain and from
Etherscan. How the protocol pieces work is in
[zama-confidential-transactions.md](zama-confidential-transactions.md); the escrow's rules are in
[escrow.md](escrow.md).

- [What Etherscan shows](#what-etherscan-shows)
- [Dry run](#dry-run)
- [Full run of 2026-09-16](#full-run-of-2026-09-16)
- [Cost](#cost)

## What Etherscan shows

For every transaction of the full run, Etherscan shows sender, contract, method, fee, block and
time, the calldata decoded against the verified ABI, and every event decoded, including the events
of Zama's host contracts. That makes these visible:

- the handles: the encrypted input in the calldata, every intermediate and result handle in the
  FHEVMExecutor events, the amount handle in the token's `ConfidentialTransfer`;
- the input proof: in the calldata and again in the `VerifyInput` event, with its three coprocessor
  signatures;
- who may decrypt: every persistent ACL permission as an `Allowed(caller, account, handle)` event;
- amounts where the public ERC-20 is involved: mint, approve and wrap.

Etherscan never shows an amount inside the confidential token: not the locked amount, not a balance,
not whether a lock was underfunded. Encryption, user decryption and public decryption are relayer
requests and leave no transaction on Sepolia at all. User decryption requests do become transactions
on Zama's Gateway chain, sent by the relayer, whose events name the handles, the requesting user and
the transport public key; Zama runs a public explorer for that chain (see
[security.md](security.md#leaks-technical)).

## Dry run

Run on 2026-09-16 several times. The README records three runs with 10.0 to 13.6 s for the
encryption and 2.3 s for the public decryption; a fourth run at about 14:55 UTC gave 12.9 s and 2.4 s.
Encryption times include the SDK's start-up (downloading the FHE public key and CRS, loading the
WASM) and the local proof.

### Dry run 1: RPC serves Sepolia, simple

Checks that the configured node really is Sepolia.

### Dry run 1: RPC serves Sepolia, technical

`eth_chainId` must return 11155111; the step prints the latest block. The RPC URL is never printed:
all output passes through a filter that replaces it.

### Dry run 2: Escrow and token, simple

Checks that the escrow exists and uses the expected token, and that the token is not paused.

### Dry run 2: Escrow and token, technical

Read-only calls: the escrow's code, `token()`, `auditor()` and `confidentialProtocolId()` (must be
10001, Zama's Sepolia id); on the token `name()`, `symbol()`, `decimals()`, `rate()`, `underlying()`,
`paused()`, `observers()` and `isBlocked(escrow)`; on the underlying USDTMock `name()`, `symbol()`,
`decimals()` and `MAX_MINT_AMOUNT_TOKENS()`. On 2026-09-16: auditor
`0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621`, token Confidential USDT (Mock), 6 decimals, rate 1, not
paused, no observers; USDTMock with a public mint of up to 1,000,000 tokens per call. Nothing is sent.

### Dry run 3: Encrypt, simple

Encrypts 1.0 cUSDTMock for the escrow and a random, made-up user, through Zama's relayer.

### Dry run 3: Encrypt, technical

`sdk.encrypt({ values: [{ type: "euint64", value: 1000000 }], contractAddress: escrow, userAddress:
<random> })` with `@zama-fhe/sdk` 3.6.0 and its Node transport. Client: fetch the key and CRS
locations from `/v2/keyurl`, build the ciphertext and a ZK proof bound to (escrow, random address,
ACL, chain id) in WASM. Zama: `POST /v2/input-proof`; on the Gateway the coprocessors verify the proof
and sign `CiphertextVerification`; the SDK checks the returned handles and signatures. Result on
2026-09-16, 14:55 UTC: handle `0x1c0568de85b63c3901682a6c01df1d2f5e9bec85a3000000000000aa36a70500`, proof
230 bytes. Etherscan: nothing, this is not a transaction.

### Dry run 4: Simulate the lock, simple

Asks a Sepolia node what would happen if the random user locked that encrypted amount, without sending
anything. The escrow must accept the encrypted amount and stop only because the user never approved
the escrow.

### Dry run 4: Simulate the lock, technical

`escrow.lock.staticCall(todoRef, <random beneficiary>, handle, inputProof, now + 1 day, { from:
<random> })`, an `eth_call`. Inside the simulation the escrow runs `FHE.fromExternal`, Sepolia's
InputVerifier checks the coprocessor signatures for (escrow, random address), and the token's
`confidentialTransferFrom` reverts with `ERC7984UnauthorizedSpender(random, escrow)` because no
operator approval exists. That revert is the expected result: it proves the proof was accepted.
`InvalidSigner(address)` would mean the InputVerifier refused it. 0.2 s. Etherscan: nothing.

### Dry run 5: Public decryption, simple

Decrypts an amount that is already public on purpose (a withdrawal from cUSDTMock someone requested)
through the same relayer and key holders that normal reading uses.

### Dry run 5: Public decryption, technical

The script searches the last 5,000 blocks, skipping the newest 20, for cUSDTMock's `UnwrapRequested`
events, whose amount handle the wrapper made publicly decryptable. `sdk.decryption.decryptPublicValues([handle])`
checks `ACL.isAllowedForDecryption(handle)`, sends `POST /v2/public-decrypt` and verifies that at least
the KMSVerifier's threshold of known KMS signers, 7 of 13, signed `PublicDecryptVerification`. On 2026-09-16,
14:55 UTC: handle `0x1f56e64dc6a3cc447f359657d67c88870ae70fd914ff0000000000aa36a70500` from block
11717436, clear value 0.0 cUSDTMock, 2.4 s. This is the only way a dry run can exercise the KMS: a user
decryption needs an account with an ACL permission, which only the full run creates.

### Dry run 6: Plan, simple

Prints what the full run would do and roughly what it would cost.

### Dry run 6: Plan, technical

Gas per step from `GAS` in the script (estimates from Sepolia and the Hardhat mock) times the current
gas price. On 2026-09-16 at 1.18 gwei: 1.9 to 2.4 M gas, 0.0023 to 0.0028 ETH.

## Full run of 2026-09-16

Set-up:

|                     |                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Creator and auditor | `0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621` (the deployer key)                                                             |
| Beneficiary         | `0x3e715fAc356AcB5b7A7383e6cbde865bCeF596BB`, a wallet made in memory for this run; it sent no transaction and holds no ETH |
| Escrow              | `0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429`, deployed in block 11716748                                                    |
| Token               | cUSDTMock `0x4E7B06D78965594eB5EF5414c357ca21E1554491`, not paused, no observers                                            |
| Underlying          | USDTMock `0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0`                                                                       |
| SDK                 | `@zama-fhe/sdk` 3.6.0 on `@fhevm/sdk` 0.13.2                                                                                |
| Amount              | `SMOKE_AMOUNT` 1 (1,000,000 base units); no `SMOKE_REFUND`                                                                  |

Results. Times are the script's step times as printed in the terminal; they include waiting for one
confirmation, or two where the result is decrypted next. Block, gas and fee are from the receipts.
Every relayer step took less than the 10 s the script waits before a retry, so each succeeded on its
first attempt.

| Step                               |               Time | Transaction                                                                                                         | Block (UTC)         | Gas used |    Fee (ETH) |
| ---------------------------------- | -----------------: | ------------------------------------------------------------------------------------------------------------------- | ------------------- | -------: | -----------: |
| 1 mint 1.0 USDTMock                |              8.4 s | [`0xe9e177db…`](https://sepolia.etherscan.io/tx/0xe9e177db627ff3d769af661b5724ac2777d57883803e1c7bcd3a1a2af2b1288c) | 11717333 (14:30:00) |   51,760 | 0.0000540343 |
| 1 approve                          |             12.5 s | [`0x41630980…`](https://sepolia.etherscan.io/tx/0x416309800691580524f8d9a2bbe2130c31651e1939a1cb258b0f520c1ac15d79) | 11717334 (14:30:12) |   46,600 | 0.0000468603 |
| 1 wrap into 1.0 cUSDTMock          |             24.8 s | [`0x567d87cb…`](https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de) | 11717336 (14:30:36) |  367,250 | 0.0003831529 |
| 2 `setOperator(escrow, now + 1 h)` |             24.9 s | [`0x79a1a622…`](https://sepolia.etherscan.io/tx/0x79a1a622a864129daa23d887d9c56fee578066222065dab6514c5cbe830c4b51) | 11717338 (14:31:00) |   51,129 | 0.0000570340 |
| 3 encrypt 1.0                      |              9.6 s | –                                                                                                                   | –                   |        – |            – |
| 3 lock, 2 confirmations            |             37.0 s | [`0x04259275…`](https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065) | 11717341 (14:31:36) |  682,630 | 0.0007529838 |
| 4 decrypt as creator               |              2.8 s | –                                                                                                                   | –                   |        – |            – |
| 4 decrypt as beneficiary           |              2.3 s | –                                                                                                                   | –                   |        – |            – |
| 5 encrypt 2^64 - 1                 |              4.5 s | –                                                                                                                   | –                   |        – |            – |
| 5 lock (underfunded)               | not in the excerpt | [`0xfbe2cd1e…`](https://sepolia.etherscan.io/tx/0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6) | 11717345 (14:32:24) |  657,529 | 0.0006839568 |
| 6 release                          | not in the excerpt | [`0xd9d123e6…`](https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c) | 11717348 (14:33:00) |  412,902 | 0.0004424626 |

The terminal output available for this page ends after `escrowOf` of the underfunded lock. The
release and everything after it were checked on the chain instead; the decryption of the underfunded
amount and of the beneficiary's balance are not in the excerpt, so this page does not report their
results.

### Step 0: Creator and beneficiary, simple

Makes sure neither account is blocked by the token and that the creator has enough Sepolia ETH.

### Step 0: Creator and beneficiary, technical

`isBlocked(creator)` and `isBlocked(beneficiary)` on cUSDTMock (its owner-managed deny list), the
current fee data, and the creator's ETH balance against the most expensive plan. The beneficiary is
`Wallet.createRandom()`: a key in memory that only signs decryption permits. Etherscan: nothing.

### Step 1: Fund, simple

The creator had no confidential dollars yet. The script mints test dollars, allows the confidential
token to take them, and converts them into confidential dollars. All of this is public, including
the amount.

### Step 1: Fund, technical

**Read the creator's balance.** `confidentialBalanceOf(creator)` returned the all-zero handle: the
account had never held cUSDTMock, so the script counts it as 0.0 without asking the relayer.

**Mint.** `USDTMock.mint(creator, 1000000)`, calldata 68 bytes. Event: ERC-20 `Transfer(0x0, creator,
1000000)`. Etherscan shows "Transfer 1 USDTMock to 0xd81Ad65e…" and lists it under "ERC-20 Tokens
Transferred". Public: amount, recipient, time.

**Approve.** `USDTMock.approve(cUSDTMock, 1000000)`. Event: `Approval(creator, cUSDTMock, 1000000)`.
Etherscan shows "Approve 1 ERC20 … for Trade on 0x4E7B06D7…". Public: amount and spender.

**Wrap.** `cUSDTMock.wrap(creator, 1000000)`, 16 events:

1. USDTMock `Transfer(creator, cUSDTMock, 1000000)`;
2. FHEVMExecutor `TrivialEncrypt(pt = 1000000, toType = 5)`: the wrapped amount becomes an encrypted
   value from a public one;
3. `FheAdd`, `FheGe`, `FheIfThenElse` and an `Allowed`: the confidential total supply, increased only
   if it does not overflow;
4. `TrivialEncrypt(0)` and `FheIfThenElse`: the minted amount, `select(success, amount, 0)`, handle
   `0x9a042cde…3fff0000000000aa36a70500`;
5. `TrivialEncrypt(0)` and `FheAdd`: the creator's balance, uninitialized before, now handle
   `0xc2918d87…56ff0000000000aa36a70500`;
6. four `Allowed` events for the new balance and the minted amount (creator and token);
7. `ConfidentialTransfer(0x0, creator, 0x9a042cde…)` and `Wrap(creator, roundedAmount = 1000000,
encryptedWrappedAmount = 0x9a042cde…)`.

Etherscan shows the amount four times: in the decoded calldata, as "ERC-20 Tokens Transferred: 1
USDTMock", as `pt` of `TrivialEncrypt` and as `roundedAmount` of `Wrap`. It does not show the
creator's resulting confidential balance, only its handle. At Zama: no relayer request; the
coprocessors compute the operations from the events.

### Step 2: Operator, simple

The creator allows the escrow to take money from her confidential balance for the next hour. Nothing
moves yet.

### Step 2: Operator, technical

`cUSDTMock.setOperator(escrow, 1789572636)`, that is the latest block time plus 3,600 s
(2026-09-16T15:30:36Z). Storage: the token's operator mapping for (creator, escrow) holds the
timestamp. Event: `OperatorSet(creator, escrow, until)`. The script then reads
`isOperator(creator, escrow)` at the receipt's block. An ERC-7984 operator approval has no amount: the
operator may move any amount until `until`. The escrow only ever pulls from its own caller, so this
approval is usable only through the creator's own `lock` calls. Etherscan shows "Call Set Operator
Function", operator and `until`. No FHE operation, no handle.

### Step 3: Lock, simple

The creator's computer encrypts 1.0 and gets a signed confirmation from Zama that the encryption is
valid for this escrow and this creator. Then she locks it for the beneficiary, with a deadline one day
later. The chain records who, for whom, when, until when and a reference number, not how much.

### Step 3: Lock, technical

**Encrypt (9.6 s, first attempt).** `sdk.encrypt` for (escrow, creator), as in dry run 3, including
the SDK's start-up. Result: input handle `0x4a47ae4fd5dd21a7962881ccabba2bc1be379cace6000000000000aa36a70500`
and a 230-byte `inputProof`: `0x01` (one handle), `0x03` (three signatures), the handle, three 65-byte
coprocessor signatures, `extraData` `0x00`. Nothing on Sepolia.

**Lock transaction (37.0 s with two confirmations).**
`lock(todoRef, beneficiary, encAmount, inputProof, deadline)` with
`todoRef = 0x8d778cd7ad5924835e86549063984b88a5c37ac54832e7044a131de724056e8c`
(`keccak256(abi.encode("smoke-<unix time>", salt))`), deadline 1789655472 (2026-09-17T14:31:12Z).
Calldata 452 bytes: selector `0x7f50daed`, five head words, the proof length (230) and the proof padded
to 256 bytes.

Events, in order (21):

| #     | Contract      | Event                                                        | Meaning                                                                       |
| ----- | ------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 35    | FHEVMExecutor | `VerifyInput(escrow, 0x4a47…, creator, <proof>, 5, 0x4a47…)` | proof accepted for (escrow, creator)                                          |
| 36-38 | FHEVMExecutor | `FheGe`, `FheSub`, `FheIfThenElse`                           | creator's balance `0xc2918d…` ≥ amount?, new balance `0xb3cebb…`              |
| 39-40 | ACL           | `Allowed` ×2                                                 | new creator balance for token and creator                                     |
| 41-42 | FHEVMExecutor | `TrivialEncrypt(0)`, `FheIfThenElse`                         | `transferred = select(ok, 0x4a47…, 0)` = `0x506d80…`                          |
| 43-44 | FHEVMExecutor | `TrivialEncrypt(0)`, `FheAdd`                                | escrow's first balance `0x258ba0…`                                            |
| 45-49 | ACL           | `Allowed` ×5                                                 | escrow balance for token and escrow; `transferred` for creator, escrow, token |
| 50    | cUSDTMock     | `ConfidentialTransfer(creator, escrow, 0x506d80…)`           | the handle of what arrived                                                    |
| 51-54 | ACL           | `Allowed` ×4 by the escrow                                   | `0x506d80…` for escrow, creator, beneficiary, auditor                         |
| 55    | escrow        | `Locked(creator, todoRef, beneficiary, 1789655472)`          |                                                                               |

Storage afterwards: the escrow's record for (creator, todoRef) holds beneficiary, deadline, status
`Locked` and amount `0x506d80703a79c87b91a050038fb7baf8bb1e70c1e4ff0000000000aa36a70500`; the token holds
the new balance handles; the ACL holds the permissions above. Transient permissions (the escrow's and
the creator's on the input, the token's on the input and the escrow's on `transferred`) leave no
event and no storage. Gas used 682,630 of a 689,211 limit at 1.103 gwei. By Zama's HCU price table the
token's operations cost 586,064 HCU; HCULimit emits nothing per operation, so that figure is not on
Etherscan.

At Zama: no relayer request. The coprocessors pick up the executor events, compute the ciphertexts
and, according to Zama's coprocessor documentation, commit ciphertext digests to the Gateway when
they process the `Allowed` events.

Etherscan shows: "Call Lock Function by 0xd81Ad65e… on 0x6Ee3Fa9d…", the decoded arguments including
the handle and the full proof, 21 decoded events with every handle and every permitted account, and
`Locked` with `todoRef` and deadline. It does not show 1.0, the balances, or whether the creator's
balance was sufficient.

### Step 4: Check, simple

The script reads the escrow back and decrypts the locked amount twice: once as the creator, once as
the beneficiary. Both see 1.0. Neither reader sends a transaction.

### Step 4: Check, technical

**`escrowOf(creator, todoRef)`**, an `eth_call`: status `Locked`, the expected beneficiary, amount
handle `0x506d80703a79c87b91a050038fb7baf8bb1e70c1e4ff0000000000aa36a70500`.

**Decrypt as creator (2.8 s).** A user decryption with `contractAddress = escrow` through the
creator's SDK instance: ML-KEM-512 transport key pair; EIP-712 permit
`UserDecryptRequestVerification` signed by the creator's key for the contract list [escrow];
`ACL.persistAllowed(handle, creator)` and `ACL.persistAllowed(handle, escrow)` checked from the client;
`POST /v2/user-decrypt`; KMS shares signcrypted to the transport key; reconstruction in the TKMS WASM.
Result 1,000,000 base units, 1.0 cUSDTMock.

**Decrypt as beneficiary (2.3 s).** The same through the beneficiary's own SDK instance, with a permit
signed by the in-memory beneficiary key. The ACL permission comes from the escrow's
`allow(transferred, beneficiary)` in step 3. Result 1.0 cUSDTMock.

At Zama, for each decryption: the relayer sends `userDecryptionRequest` to the Gateway's `Decryption`
contract, which checks the permit's signature and validity; each KMS node's connector checks
`ACL.isAllowed(handle, user)` and `ACL.isAllowed(handle, escrow)` on Sepolia and answers with its share;
the relayer returns the shares it has collected once at least the threshold of 9 has arrived.

Etherscan: nothing. Neither the permits nor the transport keys appear on Sepolia. The request and the
shares are events on the Gateway chain.

### Step 5: Shortfall, simple

The script now tries to lock far more than the creator owns. The lock still goes through and looks
the same on the chain. Only decrypting it would show that it holds 0.

### Step 5: Shortfall, technical

**Encrypt 2^64 - 1 (4.5 s).** Same SDK instance, so no start-up this time. Input handle
`0x453fa283db9c476debfa341aca977dac7c05f14023000000000000aa36a70500`, proof 230 bytes.

**Lock.** Block 11717345, 657,529 gas, 20 events, a second `todoRef` starting `0x7dd61fc8`, deadline
1789655520 (2026-09-17T14:32:00Z). The token computed `FheGe(0xb3cebb…, 0x453f…)` (the creator's
balance against 2^64 - 1, false under encryption), `FheSub`, `FheIfThenElse` (creator's balance, new
handle `0xda46e6…`, same value), `TrivialEncrypt(0)`, `FheIfThenElse` (`transferred` =
`0xc05db6de11bd957b0b95e45ceedfe4c91040dbdfb8ff0000000000aa36a70500`), `FheAdd` (escrow balance
`0x258ba0…` + `transferred` = `0xd9a07c…`), then the same `Allowed`, `ConfidentialTransfer` and `Locked`
events as in step 3. It has one event fewer than step 3 because the escrow's balance already existed
and needed no `TrivialEncrypt(0)`.

**`escrowOf`** shows `Locked` with amount `0xc05db6…`. This is where the excerpt of the output ends.
The script's next step decrypts this amount and expects 0; the excerpt does not contain that result.

Etherscan shows the same kind of transaction as step 3, with different handles. The calldata does not
contain 2^64 - 1, and nothing shows that the transfer moved 0.

### Step 6: Release, simple

The creator pays out the first lock. The beneficiary's confidential balance goes up by the locked
amount, and the chain shows that a payment to the beneficiary happened, not its size.

### Step 6: Release, technical

`release(0x8d778cd7…)`, calldata 36 bytes, block 11717348, 412,902 gas, 16 events, waited for two
confirmations. The escrow sets status `Released`, grants the token a transient permission on
`0x506d80…` (no event) and calls `confidentialTransfer(beneficiary, 0x506d80…)`:

1. `FheGe(escrow balance 0xd9a07c…, 0x506d80…)`, `FheSub`, `FheIfThenElse`: escrow's new balance
   `0xe9321c…`, two `Allowed`;
2. `TrivialEncrypt(0)`, `FheIfThenElse`: `transferred` = `0xcdf4440d…5cff0000000000aa36a70500`;
3. `TrivialEncrypt(0)`, `FheAdd`: the beneficiary's first balance,
   `0x00089ea45ceb93ca7589e2b385cc604977e31e81e0ff0000000000aa36a70500`;
4. five `Allowed`, `ConfidentialTransfer(escrow, beneficiary, 0xcdf4440d…)` and the escrow's
   `Released(creator, todoRef, beneficiary)`.

Read back from the chain afterwards: `escrowOf(creator, 0x8d778cd7…)` returns status `Released`, and
`confidentialBalanceOf(beneficiary)` returns the non-zero handle `0x00089ea4…`. The script's
decryption of that balance (expected 1.0) is not in the excerpt.

Etherscan shows "Call Release Function", the `todoRef`, the transfer from the escrow to the
beneficiary as a `ConfidentialTransfer` with a handle, and `Released`. It does not show the amount. The
transferred handle `0xcdf4440d…` differs from the stored amount handle `0x506d80…`, although both
encrypt the same value.

### Step 7: Refund, simple

Taking money back after the deadline is tested only on request. This run did not do it.

### Step 7: Refund, technical

Only with `SMOKE_REFUND=1`: lock with a 90 s deadline, decrypt it and the creator's balance, wait for
a block past the deadline, `refund`, check `Refunded` and that the balance rose by the amount. The run
of 2026-09-16 had no refund: the creator's nonce stayed at 12 after the release, and the escrow has
emitted no `Refunded` event.

## Cost

The seven transactions used 2,269,800 gas at effective prices between 1.006 and 1.115 gwei and cost
0.002420484746174163 ETH. The creator's balance went from 2.247756121521986396 ETH (block 11717332)
to 2.245335636775812233 ETH (block 11717348), exactly that difference. Measured gas per transaction:
mint 51,760, approve 46,600, wrap 367,250, `setOperator` 51,129, lock 682,630, underfunded lock
657,529, release 412,902.

What the run leaves behind on Sepolia: 1.0 cUSDTMock in the balance of a beneficiary whose key no
longer exists, and an underfunded escrow that stays `Locked` under the second `todoRef`.

## Sources

Repository (branch `escrow01`):

- [`contracts/scripts/smoke-sepolia.ts`](../contracts/scripts/smoke-sepolia.ts): constants 61-102,
  relayer retries 280-316, `transact` 319-350, SDK set-up 473-493, `encrypt` 504-512, `userDecrypt`
  515-526, `decryptBalance` 528-532, `expectEscrow` 536-553, `lock` 573-601, `fund` 604-659, `dryRun`
  663-757, `findPublishedAmount` 760-796, `fullRun` 798-1011, `main` 1053-1155.
- [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol) 100-190.
- [`contracts/README.md`](../contracts/README.md), "Smoke test".

Chain, read on 2026-09-16 through `https://ethereum-sepolia-rpc.publicnode.com` (transactions,
receipts, logs, `escrowOf`, `confidentialBalanceOf`, `persistAllowed`, balances, nonces) and
Etherscan's transaction pages:

- <https://sepolia.etherscan.io/tx/0xe9e177db627ff3d769af661b5724ac2777d57883803e1c7bcd3a1a2af2b1288c>
- <https://sepolia.etherscan.io/tx/0x416309800691580524f8d9a2bbe2130c31651e1939a1cb258b0f520c1ac15d79>
- <https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de>
- <https://sepolia.etherscan.io/tx/0x79a1a622a864129daa23d887d9c56fee578066222065dab6514c5cbe830c4b51>
- <https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065>
- <https://sepolia.etherscan.io/tx/0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6>
- <https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c>

Contracts and SDK sources: see the Sources of [escrow.md](escrow.md) and
[zama-confidential-transactions.md](zama-confidential-transactions.md). The event signatures used for
decoding are those of `host-contracts/contracts/FHEEvents.sol` and `ACLEvents.sol` at zama-ai/fhevm
tag v0.13.5 and of cUSDTMock's verified implementation on Sourcify.

Terminal output of the full run of 2026-09-16 (excerpt, provided by the person who ran it) and of a dry run at
about 14:55 UTC the same day.
