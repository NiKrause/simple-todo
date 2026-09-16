/**
 * The technical explanations in English. Every section names the documents it
 * restates (`sources`, see `index.js`); keep the texts to what those sections
 * say, and keep `de.js` in step: the spec compares the two.
 */

/** @type {import('./index.js').Catalogue} */
export default {
	lock: {
		title: 'Locking a budget on Sepolia',
		sections: [
			{
				heading: 'Encrypted in the browser, with a proof',
				points: [
					'The client encrypts the amount for the pair (escrow, creator): `sdk.encrypt({ values: [{ type: "euint64", value }], contractAddress: escrow, userAddress: creator })`.',
					'The zero-knowledge proof built with the ciphertext carries contract, user, ACL address and chain id in its metadata, so it is bound to them.',
					'Through the relayer (`POST /v2/input-proof`) the coprocessors verify the proof and sign `CiphertextVerification`. The result is an input handle and an `inputProof`: 230 bytes with three signatures in the smoke test.'
				],
				sources: ['escrow.lock', 'zama.input', 'smoke.lock']
			},
			{
				heading: 'Operator approval',
				points: [
					'`token.setOperator(escrow, until)` makes the escrow an operator of the creator’s confidential balance; `isOperator` is true while `block.timestamp <= until`.',
					'The approval has no amount, only an expiry. The escrow pulls only from its own caller, so the approval works only through the creator’s own `lock` calls.',
					'The smoke test set one hour: event `OperatorSet(creator, escrow, until)`, no FHE operation, no handle.'
				],
				sources: ['escrow.lock', 'smoke.operator', 'security.properties'],
				links: [{ evidence: 'setOperator', label: 'setOperator of 2026-09-16 on Etherscan' }]
			},
			{
				heading: 'The lock transaction',
				points: [
					'`lock(todoRef, beneficiary, encAmount, inputProof, deadline)` checks its arguments first: a non-zero `todoRef`, a beneficiary that is neither `address(0)` nor the escrow, a deadline within 365 days, no escrow yet under (creator, `todoRef`).',
					'`FHE.fromExternal(encAmount, inputProof)`: the InputVerifier checks the coprocessor signatures for (escrow, creator), 3 of 5 on Sepolia. A proof made for another contract or user fails with `InvalidSigner`.',
					'`FHE.allowTransient(requested, token)` lets the token compute with the handle in this transaction only.',
					'`token.confidentialTransferFrom(creator, escrow, requested)` computes under encryption `transferred = select(balance >= amount, amount, 0)`.',
					'The escrow grants persistent ACL access to `transferred` for itself, the creator, the beneficiary and the auditor, stores it and emits `Locked(creator, todoRef, beneficiary, deadline)`: no amount, no handle.'
				],
				sources: ['escrow.lock', 'zama.input', 'security.properties']
			},
			{
				heading: 'What Etherscan shows',
				points: [
					'Sender, escrow, `todoRef`, beneficiary and deadline; the input handle and the full proof; all 21 events decoded, with every handle and every permitted account (`Allowed`).',
					'Not shown: the amount, the balances, or whether the creator’s balance was sufficient.',
					'The smoke test’s lock: block 11717341, 682,630 gas.'
				],
				sources: ['smoke.etherscan', 'smoke.lock', 'smoke.fullRun'],
				links: [{ evidence: 'lock', label: 'Lock of 2026-09-16 on Etherscan' }]
			}
		]
	},

	locked: {
		title: 'Reading a locked amount: user decryption',
		sections: [
			{
				heading: 'Handle, key pair and permit',
				points: [
					'The app reads the handle with `eth_call`: `escrowOf(creator, todoRef)` returns beneficiary, deadline, status and the amount handle to anyone.',
					'The browser generates an ML-KEM-512 transport key pair in the TKMS WASM.',
					'The reader’s wallet signs an EIP-712 permit, `UserDecryptRequestVerification`, over the transport public key, the contracts and a validity window (at most 365 days; `@zama-fhe/sdk` uses 30 days by default).',
					'Before any request the SDK checks `ACL.persistAllowed(handle, reader)` and `ACL.persistAllowed(handle, escrow)`.'
				],
				sources: ['zama.userDecryption', 'escrow.states', 'smoke.check']
			},
			{
				heading: 'Relayer and Gateway',
				points: [
					'`POST /v2/user-decrypt` goes to Zama’s relayer, which sends `userDecryptionRequest` to the Gateway’s `Decryption` contract in its own transaction.',
					'The Gateway checks the permit’s signature and validity window, not the ACL.',
					'The request itself is public: the Gateway chain’s `UserDecryptionRequest` event names the handles, the user address and the transport public key. The relayer also sees the client’s IP address.',
					'On Sepolia, reading leaves no transaction at all.'
				],
				sources: ['zama.userDecryption', 'security.leaks', 'smoke.etherscan']
			},
			{
				heading: 'KMS threshold',
				points: [
					'Each KMS node checks `ACL.isAllowed` for the reader and the escrow on Sepolia and answers with its share, signcrypted to the transport key.',
					'Once the user decryption threshold is met, the Gateway emits `UserDecryptionResponseThresholdReached` (Sepolia’s ProtocolConfig records 9 of 13); the relayer returns the shares.',
					'The relayer only passes on shares encrypted to the reader’s key: no single key holder, and not the relayer, sees the value.',
					'Zama’s whitepaper tolerates collusions of up to 4 of the 13 KMS operators; 5 or more colluding are outside that guarantee and could decrypt any ciphertext.'
				],
				sources: ['zama.userDecryption', 'zama.relayer', 'zama.trust', 'smoke.check']
			},
			{
				heading: 'Reconstruction in the browser',
				points: [
					'The SDK verifies every response signature against the KMS signers.',
					'The TKMS WASM decrypts the shares with the ML-KEM private key and reconstructs the value; it needs at least 5 matching responses (threshold 4 for 13 signers, plus one).',
					'Smoke test of 2026-09-16: 2.8 s for the creator and 2.3 s for the beneficiary, each with its own permit; both read 1.0 cUSDTMock.'
				],
				sources: ['zama.userDecryption', 'smoke.check']
			}
		]
	},

	underfunded: {
		title: 'The encrypted zero of an underfunded lock',
		sections: [
			{
				heading: 'Why nothing reverts',
				points: [
					'A contract cannot branch on an encrypted comparison, so ERC-7984’s `_update` never reverts on a low balance.',
					'It computes `transferred = select(balance >= amount, amount, 0)`, where 0 is a trivial encryption, and the escrow stores `transferred`.',
					'Full and empty locks run the same operations (`FheGe`, `FheSub`, `FheIfThenElse`, `TrivialEncrypt`, `FheIfThenElse`, `FheAdd`) and end in a fresh handle.'
				],
				sources: ['escrow.underfunded', 'zama.fhe']
			},
			{
				heading: 'On chain',
				points: [
					'The lock is mined and the gas is paid: in the smoke test block 11717345, 657,529 gas.',
					'Etherscan shows the same kind of transaction as a funded lock, with other handles. The calldata does not contain the requested amount, and nothing shows that 0 moved.',
					'The escrow stays `Locked` and occupies its `todoRef`; releasing it moves an encrypted 0.'
				],
				sources: ['escrow.underfunded', 'smoke.shortfall', 'smoke.fullRun', 'escrow.todoRef'],
				links: [
					{ evidence: 'underfundedLock', label: 'Underfunded lock of 2026-09-16 on Etherscan' }
				]
			},
			{
				heading: 'Only decryption shows it',
				points: [
					'The beneficiary should decrypt the locked amount before starting work; the app is meant to decrypt it after every lock.',
					'The budget service throws `insufficient-balance` with the mined `lockTx`. The todo’s budget goes to `failed`, and a retry creates a new `todoRef`.',
					'The smoke test’s terminal excerpt ends before this amount was decrypted, so the docs do not claim it decrypted to 0 on Sepolia. In the Hardhat mock it does.'
				],
				sources: ['security.properties', 'escrow.underfunded', 'escrow.todoRef']
			}
		]
	},

	release: {
		title: 'Release: the escrow pays out',
		sections: [
			{
				heading: 'The call',
				points: [
					'`release(todoRef)` looks the escrow up under `_escrows[msg.sender][todoRef]`: for anyone but the creator it does not exist (`EscrowNotFound`), and a closed one reverts with `EscrowClosed`.',
					'The status becomes `Released` before the transfer; the escrow grants the token a transient permission on the stored amount.',
					'`token.confidentialTransfer(beneficiary, amount)` runs the same encrypted `_update`. The escrow’s balance covers every stored amount, so the whole amount moves.'
				],
				sources: ['escrow.release']
			},
			{
				heading: 'Events and Etherscan',
				points: [
					'The token emits `ConfidentialTransfer(escrow, beneficiary, handle)`, the escrow `Released(creator, todoRef, beneficiary)`. Neither carries an amount.',
					'Smoke test: block 11717348, 412,902 gas, 16 events. Etherscan shows “Release”, the `todoRef` and the transfer with a handle, not the amount.',
					'The transferred handle differs from the stored one, although both encrypt the same value.'
				],
				sources: ['escrow.release', 'smoke.release', 'security.properties'],
				links: [{ evidence: 'release', label: 'Release of 2026-09-16 on Etherscan' }]
			},
			{
				heading: 'Who can decrypt afterwards',
				points: [
					'The stored amount stays decryptable by the creator, the beneficiary and the auditor, as a record of what was locked.',
					'The beneficiary’s balance becomes a new handle; the token grants persistent access to new balances for their holders and itself.',
					'Nothing forces a release: the beneficiary has no claim on chain. The `todoRef` cannot be locked again.'
				],
				sources: ['escrow.states', 'escrow.lock', 'escrow.release', 'smoke.release']
			}
		]
	},

	refund: {
		title: 'Refund after the deadline',
		sections: [
			{
				heading: 'The call',
				points: [
					'`refund(todoRef)` does the same lookup and status checks as `release`: only the creator, only while `Locked`.',
					'It also requires `block.timestamp > deadline`; a block stamped exactly at the deadline is still too early (`DeadlineNotReached`).',
					'The status becomes `Refunded`, `confidentialTransfer` sends the amount back to the creator, and the escrow emits `Refunded(creator, todoRef)`.'
				],
				sources: ['escrow.refund', 'escrow.roles']
			},
			{
				heading: 'Rules around it',
				points: [
					'`lock` accepts only a deadline within the next 365 days. The deadline is public: in the calldata and in `Locked`.',
					'Each escrow closes once: a second release, a release after a refund and a refund after a release all revert.',
					'The beneficiary has no claim on chain: a creator can withhold a release and refund after the deadline.'
				],
				sources: ['escrow.lock', 'escrow.public', 'security.properties']
			},
			{
				heading: 'State of this chapter',
				points: [
					'The app has no refund button yet.',
					'The Hardhat tests cover refunds; the Sepolia smoke test does one only with `SMOKE_REFUND=1`, which the run of 2026-09-16 did not use.'
				],
				sources: ['escrow.refund', 'smoke.refund']
			}
		]
	},

	balance: {
		title: 'Confidential balance: `confidentialBalanceOf`',
		sections: [
			{
				heading: 'A handle, not a number',
				points: [
					'ERC-7984 stores each balance as a `euint64` handle; `confidentialBalanceOf(holder)` returns it through `eth_call`.',
					'A handle is a public 32-byte reference. The ciphertext behind it is kept by the coprocessors, and nobody can read a value from the handle.',
					'A transfer computes the new balance under encryption, so the balance gets a new handle: after the smoke test’s release the beneficiary’s first balance was `0x00089ea4…`.',
					'The all-zero handle means never written; it counts as 0 without a request.'
				],
				sources: [
					'escrow.erc7984',
					'zama.handles',
					'zama.userDecryption',
					'smoke.fund',
					'smoke.release'
				]
			},
			{
				heading: 'Reading it',
				points: [
					'A balance is read like a locked amount: user decryption with a transport key pair, an EIP-712 permit, the relayer, KMS shares and reconstruction in the browser.',
					'Only accounts with an ACL permission can read it: on every transfer the token grants persistent access to the new balances for their holders and itself.',
					'Etherscan never shows a balance inside the confidential token, only its handle.'
				],
				sources: ['zama.userDecryption', 'escrow.lock', 'smoke.etherscan', 'smoke.fund']
			},
			{
				heading: 'What still leaks',
				points: [
					'Wrapping USDT into cUSDT and unwrapping are public, amount included: the smoke test’s wrap shows 1.0 in the calldata, as an ERC-20 transfer, in `TrivialEncrypt` and in `Wrap`.',
					'A wrap of X shortly before a lock by the same address suggests a locked amount of at most X.'
				],
				sources: ['escrow.wrap', 'security.leaks'],
				links: [{ evidence: 'wrap', label: 'Wrap of 2026-09-16 on Etherscan' }]
			}
		]
	},

	auditor: {
		title: 'The auditor’s read access',
		sections: [
			{
				heading: 'The grant',
				points: [
					'The auditor is fixed in the escrow’s constructor (`immutable`, non-zero). Every `lock` calls `FHE.allow(transferred, auditor)`.',
					'The permission is persistent and public: an ACL `Allowed` event in every lock, and `auditor()` on the escrow.',
					'The ACL has no function that removes a persistent permission, and rotation is impossible: a new auditor means a new escrow, and the old auditor keeps reading the old amounts.'
				],
				sources: ['security.auditor', 'escrow.roles'],
				links: [
					{ evidence: 'lock', label: 'Lock of 2026-09-16 on Etherscan, with its Allowed events' }
				]
			},
			{
				heading: 'What the auditor learns',
				points: [
					'The amount of every lock in this escrow, for as long as the ciphertexts exist. It cannot move funds.',
					'Creator, beneficiary, `todoRef`, deadline and status are public on chain anyway; the todo text is not on chain.',
					'Reading is a user decryption, and each user decryption request is public on the Gateway chain.'
				],
				sources: ['security.auditor', 'security.threatModel', 'escrow.public', 'security.leaks']
			},
			{
				heading: 'Who else can decrypt',
				points: [
					'cUSDTMock’s owner, the Protocol DAO, can add observers: `addObserver` delegates the token’s own user-decryption rights to them for every contract, without expiry.',
					'An observer can decrypt every amount this escrow stores and every balance and transfer in the token. Observers are public (`observers()`, `ObserverAdded`); on 2026-09-16 there were none.',
					'Creator, beneficiary and auditor can each make a locked amount publicly decryptable through the token (`requestDiscloseEncryptedAmount`).'
				],
				sources: ['security.token']
			},
			{
				heading: 'In this deployment',
				points: [
					'The Sepolia auditor `0xd81Ad65e…4621` is the deployer and the smoke test’s creator: a test account whose key the runbook keeps unencrypted in a configuration file on a development machine.',
					'The fake’s auditor view answers any identity; the real service is meant to answer only the registered auditor.'
				],
				sources: ['security.auditor', 'demo.scene7']
			}
		]
	},

	readExpired: {
		title: 'Read access with an expiry: delegated user decryption',
		sections: [
			{
				heading: 'Why a second key',
				points: [
					'Zama v0.13 accepts only ECDSA permits (65-byte signatures), so a passkey account cannot sign a decryption permit itself.',
					'The planned workaround is a secp256k1 session key that the account authorizes once per contract, for the token and for the escrow.'
				],
				sources: ['security.passkeyWallet', 'zama.versions']
			},
			{
				heading: 'The delegation',
				points: [
					'The account calls `ACL.delegateForUserDecryption(sessionKey, contract, expirationDate)` in a transaction; delegations are per contract.',
					'The session key signs a `DelegatedUserDecryptRequestVerification` permit, which the SDK sends to `POST /v2/delegated-user-decrypt`.',
					'Before the request `@fhevm/sdk` checks `isHandleDelegatedForUserDecryption`, and `@zama-fhe/sdk` reads the expiration date: it refuses one less than an hour ahead.'
				],
				sources: ['zama.delegated', 'security.passkeyWallet']
			},
			{
				heading: 'Expiry, and what is public',
				points: [
					'Until the expiry or a revocation, the session key can read everything the account may read in those contracts.',
					'The `DelegatedForUserDecryption` event makes the link between account and session key public.',
					'Each (delegator, delegate, contract) can be delegated or revoked once per block.'
				],
				sources: ['security.passkeyWallet', 'zama.acl']
			},
			{
				heading: 'State of this chapter',
				points: [
					'Not implemented yet. The fake only simulates the expiry: `simpleTodoBudgetDemo.expireReadKey()` in the console.'
				],
				sources: ['zama.delegated', 'demo.scene9']
			}
		]
	},

	cancelled: {
		title: 'Passkey cancelled: nothing signed, nothing sent',
		sections: [
			{
				heading: 'What was not sent',
				points: [
					'A lock is two calls on Sepolia: `setOperator` on the token and `lock` on the escrow. A release is `release(todoRef)`.',
					'Reading is planned through a delegation, `ACL.delegateForUserDecryption`, which is a transaction as well.',
					'Budget actions ask for the passkey first. A cancelled prompt leaves no signature, and nothing unsigned is sent.'
				],
				sources: ['escrow.lock', 'smoke.fullRun', 'zama.delegated', 'demo.scene1']
			},
			{
				heading: 'Reading needs a signature too',
				points: [
					'Every user decryption needs an EIP-712 permit signed by the reader’s key; the request to the relayer carries that signature.'
				],
				sources: ['zama.userDecryption']
			},
			{
				heading: 'What the chain does not check',
				points: [
					'In the planned passkey account (Calibur), user verification is not enforced on chain: PIN or biometrics are enforced only by the client code that requests the assertion.',
					'That wallet is planned, not integrated. The fake sends nothing in any case.'
				],
				sources: ['security.passkeyWallet', 'demo.real']
			}
		]
	},

	demo: {
		title: 'Demo without a chain: what the fake does',
		sections: [
			{
				heading: 'What runs here',
				points: [
					'The budget screens run against an in-memory fake in this tab: nothing is encrypted, nothing is sent, nothing reaches Sepolia.',
					'For a budget, the shared list stores only the `budget` field (status, token, escrow, `todoRef`, transaction hashes), never the amount.',
					'Escrows live only in this tab’s memory. After a reload, or in the delegate’s own browser, the todo keeps its budget but the amount cannot be read.'
				],
				sources: ['escrow.title', 'security.title', 'escrow.orbitdb', 'demo.real', 'demo.setup']
			},
			{
				heading: 'What it imitates',
				points: [
					'A lock from too low a balance goes through as a transfer of 0 and throws `insufficient-balance`, as the budget service interface specifies.',
					'Every account is credited 1,000.00 cUSDT at its first lock.',
					'The auditor view answers any identity and lists only this tab’s escrows.',
					'Console levers: `simpleTodoBudgetDemo.expireReadKey()` and `simpleTodoBudgetDemo.seedExamples()`.'
				],
				sources: ['escrow.underfunded', 'demo.setup', 'demo.scene7', 'demo.scene9']
			},
			{
				heading: 'The real flow on Sepolia',
				points: [
					'Escrow `0x6Ee3Fa9d…3429`, deployed in block 11716748, source verified on Etherscan, Sourcify and Blockscout.',
					'Smoke test of 2026-09-16: mint, approve and wrap test dollars, operator approval, lock, decryption as creator and as beneficiary, underfunded lock, release.',
					'Its seven transactions used 2,269,800 gas. Encryption and decryption left no transaction on Sepolia.'
				],
				sources: ['escrow.title', 'demo.real', 'smoke.fullRun', 'smoke.cost', 'smoke.etherscan'],
				links: [
					{ evidence: 'escrow', label: 'Escrow contract, verified source' },
					{ evidence: 'wrap', label: 'Wrap' },
					{ evidence: 'setOperator', label: 'Operator approval' },
					{ evidence: 'lock', label: 'Lock' },
					{ evidence: 'underfundedLock', label: 'Underfunded lock' },
					{ evidence: 'release', label: 'Release' }
				]
			}
		]
	}
};
