# Bank demo: confidential escrow (`escrow01`)

Script for the presentation to a bank's experts. It shows a delegated todo with a budget whose amount
stays confidential. Every scene has a simple sentence for everyone and a point for experts. State:
2026-09-17. The German version, [demo.de.md](demo.de.md), is the one used in the meeting. Technical
details are in [escrow.md](escrow.md), [passkey-account.md](passkey-account.md),
[zama-confidential-transactions.md](zama-confidential-transactions.md), [smoke-test.md](smoke-test.md)
and [security.md](security.md).

This document gives no legal or regulatory advice. Regulatory topics appear at the end as open
questions for the bank's own experts.

## What is real today and what is not

| Part                                              | State on 2026-09-17                                                                                                                                                                                                                                                                                                                                  | What can be shown                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Escrow contract                                   | deployed and verified on Sepolia: `0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429`                                                                                                                                                                                                                                                                       | source and transactions on Etherscan                                                                       |
| Real confidential transactions                    | smoke test of 2026-09-16: lock, decryption as creator and as beneficiary, underfunded lock, release. App run of 2026-09-17: two accounts, lock, reading, release, balance                                                                                                                                                                            | the Etherscan pages in [scene 8](#scene-8--what-the-chain-shows)                                           |
| Budget in the app                                 | two modes. Sepolia mode (`VITE_BUDGET_SERVICE=zama` with Openfort access): amounts encrypted and decrypted in the browser, lock and release as transactions; the "Konto" ("Account") tab shows "Sepolia-Testnetz". The fake (without that setting): nothing is encrypted, nothing is sent; the tab shows "Demo ohne Chain" ("Demo without a chain"). | in Sepolia mode the whole flow with real transactions, with the fake flow, wording, states and error cases |
| Passkey wallet                                    | built into Sepolia mode: one account per passkey on Calibur, a non-upgradeable smart contract by Uniswap Labs, gas sponsored by Openfort ([passkey-account.md](passkey-account.md))                                                                                                                                                                  | the account address with an Etherscan link in the "Konto" tab                                              |
| Scene 8 of the storyboard ("Was die Chain zeigt") | not in the app                                                                                                                                                                                                                                                                                                                                       | Etherscan instead of the app                                                                               |

Statements that would not be true today:

- "The app locks the budget on Sepolia." True only in Sepolia mode, not with the fake.
- "Apart from Alice, Bob and the auditor, nobody can read the amount." That holds only under the
  trust assumptions in [Who can read the amounts?](#who-can-read-the-amounts).
- "A passkey already pays." True only in Sepolia mode and only on the testnet: the passkey signs,
  Openfort pays the gas.
- "The account can be recovered." No: it has no key the app knows besides the passkey, and the
  discarded setup key technically remains a master key ([Limits](passkey-account.md#limits-technical)).
- "The read key is protected." No: it sits in the browser in plain text for up to 24 hours.

## Checks the day before

All commands in the `contracts/` directory.

1. **Dry run.** `npm run smoke:sepolia:dry`. Expected: `passed: 5 steps ok`. It sends nothing and needs
   no key. On 2026-09-16 encryption took 10 to 14 s and public decryption 2.3 to 2.4 s. If a relayer
   step fails after three attempts, the cause is usually Sepolia or the relayer; see "Troubleshooting"
   in [contracts/README.md](../contracts/README.md#troubleshooting).
2. **Full run.** `npm run smoke:sepolia`, started by whoever manages the key in `contracts/.env`.
   Expected: every step `ok` and `passed` at the end. After the run of 2026-09-16 the creator holds no
   USDTMock and no allowance, and its cUSDTMock balance is empty after the lock of 1.0, so the run mints,
   approves and wraps again: 7 transactions, 0.00242 ETH at about 1 gwei on 2026-09-16. Note the new
   transaction links from the result table; they can replace the links in scene 8.
3. **ETH balance.** Open address `0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621` on
   [Etherscan](https://sepolia.etherscan.io/address/0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621). After
   the run of 2026-09-16 it held 2.245336 Sepolia ETH; according to the runbook a full run costs 0.002
   to 0.007 ETH.
4. **Relayer.** `curl -sS https://relayer.testnet.zama.org/v2/keyurl` must return HTTP 200 with JSON
   containing `fheKeyInfo` and `crs` (as on 2026-09-16). That only shows the relayer answers; whether
   Gateway and KMS work is shown by checks 1 and 2.
5. **Read the forum and the releases.** Check the two threads about the Sepolia incidents for new
   posts:
   [4643](https://community.zama.org/t/sepolia-handles-created-after-2026-08-31-will-not-decrypt-while-older-handles-on-the-same-contract-still-do/4643)
   and
   [4653](https://community.zama.org/t/sepolia-user-decrypt-fails-in-kms-share-reconstruction-9-13-gao-decoding-failure/4653).
   Check <https://github.com/zama-ai/fhevm/releases> for a switch of Sepolia to v0.14 or a new v0.13
   release.
6. **App.** Start `pnpm dev` on branch `escrow01`. Create a passkey in both browser profiles, set the
   language to DE and check that the profiles connect through the relay (relay set-up: README, section
   "Local Relay"). Play all scenes through once.
7. **Sepolia mode.** `.env.local` with the settings from
   [Configuration](passkey-account.md#configuration). After the passkeys are created, both profiles'
   "Konto" tabs must show "Konto auf Sepolia" ("Account on Sepolia") with an address within about 20
   seconds. Run one lock through: about a minute until "gesperrt". The read key holds for 24 hours
   ([why](passkey-account.md#read-key-simple));
   whoever rehearses the day before renews it once per profile at the meeting with "Mit Passkey
   verlängern", or creates the passkeys only that morning. Passkeys only work at the address they were
   created at (README, "Passkeys are bound to the origin"). Check in the Openfort dashboard that the
   sponsorship `escrow01 Sepolia` is active. Use the built app for the presentation (`pnpm build`, then
   `pnpm preview`): under `pnpm dev` the SDK encrypts on the page's thread, and the page freezes for
   about 10 seconds while locking. The preview runs at another address than `pnpm dev`, so with its own
   passkeys.
8. **Etherscan tabs** from scene 8 opened in advance, and the [fallback recording](#fallback-recording)
   played once.

## Setup

- Laptop at the projector. One browser with two profiles side by side: on the left "Alice" (creates
  the todo and locks the budget), on the right "Bob" (the delegate). Each profile has its own passkey.
- The app opens on the open list's todos. Lists, account and network are tabs: under the header on
  the laptop, at the bottom of the screen on a phone. The header keeps the flags, "Technisch"
  ("Technical") and a dot with the connection state that leads to the "Netzwerk" ("Network") tab.
- In Alice's profile, also the Etherscan tabs, and with the fake the developer console for its levers
  (scenes 7 and 9).
- With the fake, do not reload either profile: it keeps its escrows only in the tab's memory. After a
  reload the budget is still on the todo, but the amount can no longer be read. In Sepolia mode a
  reload does no harm: account and read key live in the browser, the escrows on the chain.
- In Sepolia mode, announce beforehand: a lock takes about a minute (encrypt, have the proof checked,
  passkey, confirmation on chain, read the amount back), a release about 25 seconds.
- Limits of the fake worth announcing before a demo with it: Bob's profile cannot read amounts (it shows "•••"
  with the note "Diesen Betrag kann dieser Browser nicht lesen." / "This browser cannot read the
  amount."), and the auditor view only shows the escrows of the tab it is opened in.

## Storyline

The scenes follow the storyboard "Treuhand-Demo Drehbuch" (scenes 1 to 9). Names and amounts are
example values.

### Scene 1 · One passkey

**Show.** Alice opens the app. The consent dialog at start contains the section "Ein Passkey für
alles" ("One passkey for everything"); under "Was gespeichert wird" ("What is stored") it says
"Budgets verschlüsselt im Sepolia-Testnetz" ("Budgets encrypted on the Sepolia testnet") in Sepolia
mode, and with the fake that budgets live only in memory for the demonstration. Then Alice creates her
passkey. In Sepolia mode the "Konto" tab first says "Wird eingerichtet. Openfort zahlt die Gebühr, eine
Passkey-Bestätigung ist dafür nicht nötig." ("Being set up. Openfort pays the fee, no passkey
confirmation needed.") and after about 20 seconds shows "Konto auf Sepolia" with the address and "Auf
Etherscan ansehen" ("View on Etherscan").

**Simple.** "Alice signs in with Touch ID. No password, no seed phrase."

**For experts.** Today the passkey creates the identity: the DID comes from the passkey's P-256 key,
OrbitDB entries are signed, and delegated changes and budget actions ask for the passkey again. In
Sepolia mode the same passkey controls an account on the chain: a throwaway key switches a new address
to Calibur with EIP-7702, registers the passkey as admin key and is discarded; Openfort pays the gas,
and the app publishes the address under the DID
([Setting up the account](passkey-account.md#setup-technical)). The account's limitations are in
[security.md](security.md#passkey-wallet).

### Scene 2 · Todo with a budget

**Show.** Alice creates a private list ("Prüfbericht Q3") in the "Listen" ("Lists") tab and goes
back to "Aufgaben" ("Todos"). She types the todo "Datenschutz-Audit der Kontoeröffnung" into the line,
unfolds the other fields with "An eine andere DID delegieren" ("Delegate this todo to another DID")
and delegates it to Bob's DID (copied in Bob's profile, "Konto" tab). She optionally sets a deadline
and enters a budget of 500,00 cUSDT. Below the budget field is the note about encryption, and with the
fake under it the notice that the demo runs without a chain. Once the todo is added, the form folds up
again and the todo is below it. In Sepolia mode Bob's account must be set up already (an address in his
"Konto" tab); otherwise the app reports that the delegate has no account for budgets yet.

**Simple.** "Alice gives Bob a task and sets 500 confidential dollars aside for it."

**For experts.** The shared list (OrbitDB) receives only the `budget` field: status, token, escrow,
`todoRef` and transaction hashes, never the amount. In Sepolia mode the browser encrypts the amount for
the pair (escrow, Alice's account) and creates a zero-knowledge proof; the coprocessors check it and
sign, 3 of 5 on Sepolia ([Locking a budget](passkey-account.md#locking-technical)).

### Scene 3 · Lock the budget

**Show.** Alice confirms with her passkey. The status changes from "wird gesperrt" ("being locked")
to "gesperrt" ("locked"), in Sepolia mode after about a minute.

**Simple.** "The money now sits with the escrow. Anyone can see that Alice locked something for Bob,
but not how much."

**For experts.** In Sepolia mode this is one user operation from Alice's Calibur account with one
passkey step: on the first lock, mint, approve and wrap 1,000.00 test cUSDT, then
`setOperator(escrow, expiry)` on the token and `lock(todoRef, beneficiary, handle, inputProof,
deadline)` on the escrow; Openfort pays the gas. The escrow checks the input proof itself, the token
pulls the amount encrypted, and the escrow gives Alice, Bob and the auditor a persistent ACL permission
on the locked amount. Afterwards Alice's browser reads the amount back to catch an underfunded lock.
App run of 2026-09-17: 54 s, 1,164,214 gas, 42 events
([Etherscan](https://sepolia.etherscan.io/tx/0x6696ea38abed7ca22f45f806acd46d3abd4dd7f14e7d09c3abd8a7a1926c111f)).
Example from the smoke test, without a passkey account: lock in block 11717341, 682,630 gas, 21
events, no amount
([Etherscan](https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065)).

### Scene 4 · Bob is done

**Show.** Bob opens the list by its address in the "Listen" tab (Alice copies it from the same tab),
goes to "Aufgaben", sees the todo as "Von … an Sie delegiert" ("delegated to you by …", with Alice's
shortened DID) and ticks it. His passkey asks, the header reports "Änderung
unterschrieben" ("Delegated write signed"). In Alice's profile the todo appears as completed.

**Simple.** "Bob sees that money is locked for him and reports the task as done. He reads the amount
on his own device."

**For experts.** Bob reads the amount by user decryption: his browser creates an ML-KEM-512 transport
key pair, an EIP-712 permit is signed, the relayer passes the request to Zama's Gateway, every KMS node
checks the ACL on Sepolia and returns a share encrypted for Bob's key, the relayer collects the shares
until at least 9 of 13 have arrived, and the browser reconstructs the value from them. In Sepolia mode
Bob's read key signs the permit, which his account enabled for it; the passkey is not asked
([Reading an amount](passkey-account.md#reading-technical)). On 2026-09-17 Bob saw the amount 4 s after
Alice's display; in the smoke test reading took 2.3 s for the beneficiary. With the fake, Bob's profile
shows "•••", because the amount exists only in Alice's tab.

### Scene 5 · Alice releases

**Show.** Alice's row shows "wartet auf Freigabe" ("awaiting release") with the buttons "Budget
freigeben" ("Release budget") and "Wieder öffnen" ("Reopen"). Alice releases and confirms with her
passkey; the status becomes "ausgezahlt" ("paid out").

**Simple.** "Alice pays out. Only she can, and only once."

**For experts.** `release(todoRef)` looks the escrow up under `msg.sender`; for any other address it
does not exist. The token transfers the locked amount to Bob, encrypted. Bob has no claim on the
chain: releasing stays Alice's decision, and after the deadline she can take the money back. Example
from the smoke test: release in block 11717348, 412,902 gas
([Etherscan](https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c)).
In Sepolia mode the release is a user operation from Alice's account; on 2026-09-17 it took 24 s and
550,093 gas
([Etherscan](https://sepolia.etherscan.io/tx/0x58c317864ed43f81b7ef2b4b46ba11e7829edd1b5e5224ab7dc2b28ed537d7e1)).

### Scene 6 · Bob receives the payout

**Show.** Bob gets a notification about the payout, and in the "Konto" tab the card "Vertrauliches
Guthaben" ("Confidential balance") shows the new balance. In Sepolia mode the card is there as soon as
the account is set up, for Bob at 0,00 cUSDT at first; the notification names the amount, and on
2026-09-17 the card then showed 5,00 cUSDT. With the fake the card appears only after a payout, the
notification reads "Budget von … ausgezahlt" ("Budget from … paid out") without an amount, and the card
says that this browser cannot read the balance.

**Simple.** "Bob has the money. His balance is encrypted on the chain; it is decrypted on his device."

**For experts.** After the release Bob's balance is a new handle; in the smoke test
`0x00089ea45ceb93ca7589e2b385cc604977e31e81e0ff0000000000aa36a70500`. Bob and the token contract hold
persistent permissions on it.

### Scene 7 · Auditor

**Show.** In the "Konto" tab, under "Prüfstelle" ("Auditor"), tap "Prüfansicht öffnen" ("Open the
auditor view"), or open the page with `#pruefstelle`; "Zurück zu den Aufgaben" in the header leads
back. With the fake, for more rows, first run `simpleTodoBudgetDemo.seedExamples()` in the console of
Alice's profile; it adds example escrows (Alice to Bob 500,00 paid out, Alice to Carol 1.200,00 locked,
Dave to Bob 80,00 locked). In Sepolia mode the view lists the latest 50 locks of this escrow on
chain, other people's included.

**Simple.** "The bank, as auditor, sees every amount in this escrow, but not the todos themselves."

**For experts.** The auditor is fixed in the contract (`immutable`). Every lock gives it a persistent
ACL permission, visible as a public `Allowed` event; it cannot be withdrawn, and a change means a new
escrow. The auditor can read but cannot move money; like Alice and Bob, it can make an amount public
through the token. The auditor registered today is the development key. In Sepolia mode the auditor
view lists the escrows from the `Locked` events for any identity but decrypts amounts only for the
registered auditor; since that is a development key without a passkey, the app shows "•••" there. In
the fake the auditor view answers any identity with amounts.

### Scene 8 · What the chain shows

**Show.** The app does not have this scene; use the Etherscan pages of the smoke test instead, and in
Sepolia mode also those of your own run (the Etherscan link at the account in the "Konto" tab):

| Transaction          | Link                                                                                                              | What it shows                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Wrap of 1.0 USDTMock | [0x567d87cb…](https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de) | the amount: under "ERC-20 Tokens Transferred", in `TrivialEncrypt` (`pt`) and in `Wrap` (`roundedAmount`) |
| Lock                 | [0x04259275…](https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065) | sender, escrow, `todoRef`, beneficiary, deadline, handles, input proof, permitted accounts; no amount     |
| Underfunded lock     | [0xfbe2cd1e…](https://sepolia.etherscan.io/tx/0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6) | the same picture as the funded lock                                                                       |
| Release              | [0xd9d123e6…](https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c) | `ConfidentialTransfer` from the escrow to the beneficiary with a handle; no amount                        |
| Escrow contract      | [0x6Ee3Fa9d…](https://sepolia.etherscan.io/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429#code)               | verified source                                                                                           |

From the app run of 2026-09-17, each a transaction from Openfort's bundler to the EntryPoint:

| Transaction                      | Link                                                                                                              | What is in it                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Setup of two accounts            | [0xe66c286f…](https://sepolia.etherscan.io/tx/0xe66c286f10f4715cc4eebfc0b3cc42700a402ec2718a84638e7707aaedd9a165) | type 4 with two EIP-7702 authorizations; per account `Registered`, `KeySettingsUpdated` and two `DelegatedForUserDecryption`      |
| Lock from the passkey account    | [0x6696ea38…](https://sepolia.etherscan.io/tx/0x6696ea38abed7ca22f45f806acd46d3abd4dd7f14e7d09c3abd8a7a1926c111f) | the starting funds of 1,000.00 in plain (`Transfer`, `Approval`, `Wrap`), `OperatorSet`, `Locked`, 16 `Allowed`; no locked amount |
| Release from the passkey account | [0x58c31786…](https://sepolia.etherscan.io/tx/0x58c317864ed43f81b7ef2b4b46ba11e7829edd1b5e5224ab7dc2b28ed537d7e1) | `ConfidentialTransfer` to Bob's account with a handle, `Released`; no amount                                                      |

**Simple.** "This is the public view. Who, when, to whom: yes. How much: no. Only when USDT is
exchanged into confidential dollars and back is the amount visible."

**For experts.** Also public are the handles, the input proof with three coprocessor signatures, every
ACL permission and every computation step as an event. A funded and an underfunded lock cannot be told
apart. User decryption requests are transactions on Zama's Gateway chain, which has a public explorer,
and name the handle, the user address and the transport key there.

### Scene 9 · Error cases (optional)

**Show.** With the fake (for Sepolia mode see below):

- **Balance too low.** The fake credits every account 1.000,00 cUSDT at its first lock. After the
  500,00 from scene 2, lock a budget of 600,00: "Budget nicht gedeckt. Ihr vertrauliches Guthaben
  reichte nicht. Die Sperre ging trotzdem durch: Die Gebühr ist bezahlt, und überwiesen wurde eine
  verschlüsselte 0." ("Budget not funded. Your confidential balance was not enough. The lock still
  went through: the fee was paid, and an encrypted 0 was transferred.") The todo's row shows
  "ungedeckt" ("not funded").
- **Read access expired.** Run `simpleTodoBudgetDemo.expireReadKey()` in the console: "Lesezugriff
  abgelaufen." ("Read access expired.") with "Mit Passkey verlängern" ("Renew with passkey").
- **Passkey cancelled.** Cancel the passkey prompt: "Passkey-Bestätigung abgebrochen. Es wurde nichts
  signiert und nichts gesendet." ("Passkey confirmation cancelled. Nothing was signed and nothing was
  sent.")

In Sepolia mode "passkey cancelled" can be shown the same way. "Balance too low" should show with a
second lock over more than the remaining balance, but costs a real lock and about a minute; that was
not tried live, only in the unit tests. "Read access expired" happens only after 24 hours.

**Simple.** "When something goes wrong, the app says in one sentence what happened and what to do."

**For experts.** On the chain an underfunded lock goes through and holds an encrypted 0; in the smoke
test, block 11717345. The app's message says exactly that: the transaction was executed, gas was paid,
and an encrypted 0 was transferred. From outside, an underfunded lock cannot be told from a funded
one. That is why the app in Sepolia mode reads the locked amount back after every lock.

## Questions from experts

### Who can read the amounts?

Creator, beneficiary and auditor, because the escrow gives them a persistent ACL permission at every
lock; this can be checked publicly. Beyond that:

- The escrow and token contracts are permitted too, so that they can compute. The escrow has no
  function that publishes an amount. Through the token, each permitted person (creator, beneficiary,
  auditor) can make an amount publicly decryptable.
- The owner of the token cUSDTMock, Zama's Protocol DAO, can register observers. An observer can
  decrypt every amount the token is permitted on, including the amounts of this escrow. On 2026-09-16
  no observer was registered; observers are public.
- Zama's KMS: 13 operators hold the decryption key only as shares. Zama's FHEVM whitepaper (June 2025)
  tolerates collusion of up to 4 of the 13 operators; from 5 colluding operators on, that guarantee no
  longer holds. Registered on chain are thresholds of 9 (user decryption), 7 (public decryption) and 4
  (MPC).
- Zama's Protocol DAO owns the ACL and the other host contracts and can upgrade them, so the permission
  rules themselves depend on that governance.
- In a user decryption, the relayer only sees shares encrypted for the reader's key.

### What is public?

Sender, beneficiary, auditor, times, functions called, `todoRef`, deadline, gas, all handles and input
proofs, all permissions and computation steps, the amounts at wrap and unwrap, and, on the Gateway
chain, who has which handle decrypted and when. The unencrypted OrbitDB list holds the todo text, the
delegate's DID and `todoRef`. Not public are the amounts in the escrow, the balances, and whether a lock
was funded.

### What happens if Zama's relayer is down?

Then nothing can be encrypted or decrypted through it: no new lock with a new amount, no reading of
amounts. The chain stays as it is; release and refund are ordinary transactions without a relayer
request. On mainnet Zama's hosted relayer requires an API key, and Zama also documents running one's
own relayer; the Gateway and the KMS remain dependencies either way. The sources consulted mention no
service level agreement. On Sepolia, user decryption failed for a time twice in early September 2026.

### Who holds which keys?

- **FHE key:** the 13 KMS operators, only as shares; according to Zama's documentation by default in
  AWS Nitro Enclaves.
- **Transport key for reading:** in the reader's browser. According to Zama's documentation the SDK
  stores it unencrypted in IndexedDB by default in browsers; the app gives it in-memory storage
  instead, where it lasts only while the page is open.
- **Account keys in the smoke test:** creator and auditor are the same development key, in plain text
  in `contracts/.env`; the beneficiary of the smoke test was a throwaway key in memory.
- **Passkey account (the app's Sepolia mode):** the passkey stays in the authenticator and is the admin
  key of a Calibur account. The original setup key can never be removed (Calibur always accepts it as
  root key, and under EIP-7702 it can re-delegate the account anyway); the app discards it after
  setup. The passkey's user verification is not enforced on chain. For reading, the browser keeps a
  session key in plain text for up to 24 hours, because Zama's current version accepts only ECDSA
  signatures. There is no recovery without the passkey.
- **Openfort key:** a publishable key in the shipped page. Whoever reads it out can have operations on
  Sepolia sponsored at the Openfort project's expense, but cannot sign for any account.

### What is Calibur, and who controls it?

A smart contract, not a company, a service or a standard. Uniswap Labs wrote it and published it under
the MIT license. It sits fixed on the chain, cannot be changed, and Uniswap runs no server for it.
Alice's and Bob's accounts follow its rules through EIP-7702: the passkey is registered there as admin
key, and only it releases payments. Uniswap can publish new versions at new addresses but cannot move
existing accounts to them. The repository's README links audits by Cantina (04/2025) and OpenZeppelin
(05/2025); v1.0.0, the app's version, is the state after their fixes. Since July 2026 Uniswap lists
v1.1.0 ([What Calibur is](passkey-account.md#calibur-simple)).

### What is central, what is decentralized?

On the chain are the account, Calibur, the escrow, the token and the EntryPoint. Central, run by
companies but replaceable, are Openfort (submits payments, pays the gas), Zama's relayer, the public RPC
access points and Le Space's relay. Distributed but coordinated by Zama are the gateway, the
coprocessors (5 operators on Sepolia) and the KMS (13 operators). Two caveats: Sepolia's blocks come
from a closed circle of client and testing teams, and Zama's Protocol DAO can change the token and
Zama's rule contracts. If a central service fails, the money stays on the chain, but the app cannot
lock, release or read ([Who runs what](passkey-account.md#who-runs-what-central-or-decentralized)).

### What is the read key, and why does it hold for only 24 hours?

A time-limited power of attorney for account statements: an extra key in the browser that the passkey
account allows to have its amounts decrypted by Zama. It is needed because Zama's current version
accepts no passkey signatures. It can only read, not move anything. Because it sits unencrypted in the
browser, the app grants it for 24 hours and renews it afterwards with one passkey step. The term is an
app setting, not a Zama requirement, and it is enforced through the chain
([The read key](passkey-account.md#read-key-simple)).

### Is this ready for mainnet?

No, it is a testnet demonstration. Zama's host contracts on Ethereum mainnet have the same version
v0.13 and the same verified source as on Sepolia. Open points: the app knows only Sepolia and depends
on unpublished packages, the escrow is not audited, the auditor is a development key, the passkey
account has no recovery and uses Calibur v1.0.0 instead of the newer v1.1.0, the sponsorship is not
restricted to the demo's contracts, the read key sits in the browser in plain text, version v0.14 is
released but not yet deployed, and mainnet's InputVerifier accepts an encrypted input with the
signature of a single registered coprocessor key (3 of 5 on Sepolia); how Zama operates that key is not
visible from outside. Nothing from this chapter ran on mainnet.

### What happens if Alice does not release?

Bob has no claim on the chain. After the deadline Alice can take the money back. The escrow protects
Alice's money, not Bob's work. Before starting work, Bob can decrypt the locked amount and so check
that the lock is funded.

### What does it cost, and how fast is it?

In the smoke test of 2026-09-16, 7 transactions cost 2,269,800 gas in total, or 0.00242 Sepolia ETH at
about 1 gwei; a lock 682,630 gas, a release 412,902 gas. Encryption took 9.6 s the first time
(including the SDK's start-up) and 4.5 s the second time, reading an amount 2.3 to 2.8 s, and the lock
with two confirmations 37.0 s. In the app run of 2026-09-17 (Sepolia mode) setting up an account took
17 to 18 s (799,333 gas for two accounts in one transaction), a lock with funding and reading back 54 s
(1,164,214 gas), and the release 24 s (550,093 gas); Openfort's paymaster paid the gas, and the
accounts needed no ETH. Mainnet has other gas prices, and Zama's hosted relayer bills fees monthly; the
sources consulted give no amounts for that.

### Open questions for the bank's experts

Not answers, but questions this chapter cannot settle:

- How is an immutable auditor with permanent read access to all amounts to be assessed, including with
  regard to retention and deletion?
- What requirements apply to the custody of the auditor's and the users' keys?
- How are the token owner's powers to be assessed: observers, deny list, pause, upgrade?
- What role do the KMS and coprocessor operators play, and is a trust assumption based on thresholds
  sufficient?
- Which metadata may be public: addresses, times, references, decryption requests?
- What availability requirements apply when reading amounts depends on third-party services?

## Fallback recording

- **Record** the day before, after the checks: scenes 1 to 9 in both profiles and the Etherscan pages
  from scene 8, as a video file stored locally on the laptop so that it plays without a network.
- **Switch to it** if the dry run fails on the morning, the network in the room fails, the two profiles
  do not connect, Zama's relayer or Openfort do not answer in Sepolia mode, or with the fake a profile
  had to be reloaded (it then loses its amounts).
- **Carry on with the fake:** `VITE_BUDGET_SERVICE=fake pnpm build` and then `pnpm preview` (or
  `VITE_BUDGET_SERVICE=fake pnpm dev`) starts the same app without a chain; the environment variable
  takes precedence over `.env.local`. At the same address the same passkeys work.
- **Without the video:** the Etherscan links from scene 8 show the real transactions independently of
  the relayer; the steps behind them are in [smoke-test.md](smoke-test.md).

## Sources

Repository (branch `escrow01`):

- [`src/lib/budget-service-fake.js`](../src/lib/budget-service-fake.js): starting balance 64-70, lock
  175-236, auditor list 287-307, levers `expireReadKey` and `seedExamples` 324-355.
- [`src/lib/budget-store.js`](../src/lib/budget-store.js) 433-446 (`simpleTodoBudgetDemo` in the
  console), [`src/routes/+page.svelte`](../src/routes/+page.svelte) 388-396 (`#pruefstelle`), 521-538
  (consent dialog) and 790-802 (auditor card in the "Konto" tab),
  [`src/lib/sections.js`](../src/lib/sections.js) 23-41 (tabs and the URL fragment),
  [`src/lib/AddTodoForm.svelte`](../src/lib/AddTodoForm.svelte) 218-223 (note below the budget field), [`src/lib/OnePasskeyIntro.svelte`](../src/lib/OnePasskeyIntro.svelte) 18-33 ("Ein
  Passkey für alles", "Was gespeichert wird").
- [`src/lib/i18n/de.json`](../src/lib/i18n/de.json) and [`src/lib/i18n/en.json`](../src/lib/i18n/en.json):
  keys `onboarding.storedBudgetsDemo`, `onboarding.storedBudgetsChain`, `budget.network.demo`,
  `budget.demoNotice`, `budget.form.hint`, `budget.chip.hidden`, `budget.notice.*`, `budget.auditor.*`,
  `budget.toast.receivedHidden`, `budget.toast.received`, `sections.account.auditorOpen`,
  `sections.account.chainAccount`, `sections.account.accountCreating`.
- [`src/lib/budget-service-zama.js`](../src/lib/budget-service-zama.js) and
  [`src/lib/chain/`](../src/lib/chain) (Sepolia mode), with the sources in
  [passkey-account.md](passkey-account.md#sources); the app run of 2026-09-17 in
  [Measured on 2026-09-17](passkey-account.md#measured-on-2026-09-17).
- [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol),
  [`contracts/README.md`](../contracts/README.md) (runbook, smoke test, cost, troubleshooting).
- Storyboard "Treuhand-Demo Drehbuch", state 2026-09-16, scenes 1 to 9.

Further evidence for every technical statement: the Sources sections of [escrow.md](escrow.md),
[zama-confidential-transactions.md](zama-confidential-transactions.md), [smoke-test.md](smoke-test.md)
and [security.md](security.md).

Chain and services, queried on 2026-09-16: the transactions and addresses above on Etherscan;
`https://relayer.testnet.zama.org/v2/keyurl`; forum threads 4643 and 4653; Zama's documentation on
relayer API keys (<https://docs.zama.org/protocol/sdk/guides/relayer-api-keys>), the SDK security model
(<https://docs.zama.org/protocol/sdk/concepts/security-model>), the KMS
(<https://docs.zama.org/protocol/protocol/overview/kms>) and chains with the Gateway explorer
(<https://docs.zama.org/protocol/protocol-apps/chains>); Zama's FHEVM whitepaper, version 3.1
(<https://github.com/zama-ai/fhevm/blob/main/fhevm-whitepaper.pdf>), p. 12; the creator's USDTMock
balance and allowance (`balanceOf`, `allowance`).
