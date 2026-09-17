/**
 * Die technischen Erklärungen auf Deutsch. Jeder Abschnitt nennt die
 * Dokumente, die er wiedergibt (`sources`, siehe `index.js`); die Texte folgen
 * den `.de.md`-Fassungen und bleiben im Gleichschritt mit `en.js`: Der Spec
 * vergleicht beide.
 */

/** @type {import('./index.js').Catalogue} */
export default {
	lock: {
		title: 'Ein Budget auf Sepolia sperren',
		sections: [
			{
				heading: 'Im Browser verschlüsselt, mit Proof',
				points: [
					'Der Client verschlüsselt den Betrag für das Paar (Treuhand, Ersteller): `sdk.encrypt({ values: [{ type: "euint64", value }], contractAddress: escrow, userAddress: creator })`.',
					'Der Zero-Knowledge-Proof zum Chiffrat trägt Vertrag, Nutzer, ACL-Adresse und Chain-ID in seinen Metadaten und ist dadurch an sie gebunden.',
					'Über den Relayer (`POST /v2/input-proof`) prüfen die Coprozessoren den Proof und signieren `CiphertextVerification`. Ergebnis sind ein Input-Handle und ein `inputProof`: im Smoke-Test 230 Bytes mit drei Signaturen.'
				],
				sources: ['escrow.lock', 'zama.input', 'smoke.lock']
			},
			{
				heading: 'Operator-Genehmigung',
				points: [
					'`token.setOperator(escrow, until)` macht die Treuhand zum Operator des vertraulichen Guthabens des Erstellers; `isOperator` ist wahr, solange `block.timestamp <= until` gilt.',
					'Die Genehmigung hat keinen Betrag, nur einen Ablaufzeitpunkt. Die Treuhand zieht nur von ihrem eigenen Aufrufer ein, deshalb wirkt die Genehmigung nur über die eigenen `lock`-Aufrufe des Erstellers.',
					'Der Smoke-Test setzte eine Stunde: Event `OperatorSet(creator, escrow, until)`, keine FHE-Operation, kein Handle.'
				],
				sources: ['escrow.lock', 'smoke.operator', 'security.properties'],
				links: [{ evidence: 'setOperator', label: 'setOperator vom 2026-09-16 auf Etherscan' }]
			},
			{
				heading: 'Die Sperr-Transaktion',
				points: [
					'`lock(todoRef, beneficiary, encAmount, inputProof, deadline)` prüft zuerst die Argumente: `todoRef` ungleich null, ein Begünstigter, der weder `address(0)` noch die Treuhand ist, eine Frist innerhalb von 365 Tagen, noch kein Vorgang unter (Ersteller, `todoRef`).',
					'`FHE.fromExternal(encAmount, inputProof)`: Der InputVerifier prüft die Coprozessor-Signaturen für (Treuhand, Ersteller), auf Sepolia 3 von 5. Ein Proof für einen anderen Vertrag oder Nutzer scheitert mit `InvalidSigner`.',
					'`FHE.allowTransient(requested, token)` erlaubt dem Token, nur in dieser Transaktion mit dem Handle zu rechnen.',
					'`token.confidentialTransferFrom(creator, escrow, requested)` berechnet unter Verschlüsselung `transferred = select(balance >= amount, amount, 0)`.',
					'Die Treuhand gewährt sich selbst, dem Ersteller, dem Begünstigten und der Prüfstelle dauerhaften ACL-Zugriff auf `transferred`, speichert es und emittiert `Locked(creator, todoRef, beneficiary, deadline)`: kein Betrag, kein Handle.'
				],
				sources: ['escrow.lock', 'zama.input', 'security.properties']
			},
			{
				heading: 'Aus dem Passkey-Konto',
				points: [
					'In der App ist die Sperre eine UserOperation: Der Passkey signiert ihren Hash, Openfort reicht sie beim EntryPoint v0.8 ein und bezahlt das Gas, Calibur prüft die P-256-Signatur und führt die Aufrufe als ein Stapel aus.',
					'Der Stapel ist `setOperator` und `lock`; bei der ersten Sperre kommen davor `mint`, `approve` und `wrap` von 1.000,00 Test-cUSDT. Scheitert ein Aufruf, nimmt `revertOnFailure` alle zurück.',
					'Ersteller und Nutzer des Proofs ist das Calibur-Konto, denn es ist `msg.sender` von `lock`. Danach liest die App den Vorgang am Block der Quittung und entschlüsselt den Betrag, um eine ungedeckte Sperre zu erkennen.',
					'Gemessen am 2026-09-17: 54 s vom Klick bis „gesperrt“, 1.164.214 Gas, 42 Events.'
				],
				sources: ['account.locking', 'account.signing', 'account.measured']
			},
			{
				heading: 'Was Etherscan zeigt',
				points: [
					'Absender, Treuhand, `todoRef`, Begünstigten und Frist; das Input-Handle und den vollständigen Proof; alle 21 Events dekodiert, mit jedem Handle und jedem berechtigten Konto (`Allowed`).',
					'Nicht angezeigt werden der Betrag, die Guthaben und ob das Guthaben des Erstellers ausreichte.',
					'Die Sperre im Smoke-Test: Block 11717341, 682.630 Gas.'
				],
				sources: ['smoke.etherscan', 'smoke.lock', 'smoke.fullRun'],
				links: [{ evidence: 'lock', label: 'Sperre vom 2026-09-16 auf Etherscan' }]
			}
		]
	},

	locked: {
		title: 'Einen gesperrten Betrag lesen: delegierte Nutzer-Entschlüsselung',
		sections: [
			{
				heading: 'Handle, Schlüsselpaar und Permit',
				points: [
					'Die App liest das Handle per `eth_call`: `escrowOf(creator, todoRef)` gibt jedem, der fragt, Begünstigten, Frist, Status und das Betrags-Handle zurück.',
					'Der Browser erzeugt im TKMS-WASM ein ML-KEM-512-Transport-Schlüsselpaar.',
					'Der Leseschlüssel des Browsers signiert ein EIP-712-Permit, `DelegatedUserDecryptRequestVerification`, über den öffentlichen Transport-Schlüssel, die Verträge, das Konto als Delegierenden und ein Gültigkeitsfenster. Den Passkey fragt das Lesen nicht.',
					'Vor der Anfrage prüft das SDK `ACL.isHandleDelegatedForUserDecryption(account, readKey, escrow, handle)`: Konto und Treuhand brauchen dauerhaften Zugriff auf das Handle, und die Delegation an den Leseschlüssel muss aktiv sein.'
				],
				sources: ['zama.delegated', 'zama.acl', 'account.reading', 'escrow.states']
			},
			{
				heading: 'Relayer und Gateway',
				points: [
					'`POST /v2/delegated-user-decrypt` geht an Zamas Relayer. Der ruft `delegatedUserDecryptionRequest` am Vertrag `Decryption` des Gateways auf, und dieser prüft die Signatur des Leseschlüssels.',
					'Die ACL prüft das Gateway nicht; das tun die KMS-Connectoren auf Sepolia.',
					'Die Anfrage ist öffentlich: Das Event `UserDecryptionRequest` auf der Gateway-Chain nennt die Handles, die Adresse des Leseschlüssels und den öffentlichen Transport-Schlüssel, die Calldata auch das Konto. Der Relayer sieht außerdem die IP-Adresse des Clients.',
					'Auf Sepolia hinterlässt das Lesen keine Transaktion; die Delegation an den Leseschlüssel war eine, bei der Einrichtung.'
				],
				sources: ['account.reading', 'zama.relayer', 'security.leaks']
			},
			{
				heading: 'KMS-Schwellenwert',
				points: [
					'Jeder KMS-Connector liest den Delegierenden aus der Calldata der Anfrage und prüft auf Sepolia `isHandleDelegatedForUserDecryption`; der Knoten antwortet mit seinem Anteil, per Signcryption an den Transport-Schlüssel verschlüsselt.',
					'Die Antworten laufen wie bei jeder Nutzer-Entschlüsselung über `userDecryptionResponse`; ProtocolConfig auf Sepolia verzeichnet dafür 9 von 13, und der Relayer gibt die Anteile zurück.',
					'Der Relayer reicht nur Anteile weiter, die für den Transport-Schlüssel verschlüsselt sind: Kein einzelner Schlüsselverwalter und auch nicht der Relayer sieht den Wert.',
					'Zamas Whitepaper toleriert Kollusionen von bis zu 4 der 13 KMS-Betreiber; 5 oder mehr kolludierende liegen außerhalb dieser Zusage und könnten jedes Chiffrat entschlüsseln.'
				],
				sources: ['zama.userDecryption', 'zama.acl', 'zama.relayer', 'zama.trust']
			},
			{
				heading: 'Rekonstruktion im Browser',
				points: [
					'Das SDK prüft jede Antwortsignatur gegen die KMS-Signierer.',
					'Das TKMS-WASM entschlüsselt die Anteile mit dem privaten ML-KEM-Schlüssel und setzt den Wert zusammen; es braucht mindestens 5 übereinstimmende Antworten (Schwellenwert 4 bei 13 Signierern, plus eine).',
					'Am 2026-09-17 sah Bob den gesperrten Betrag in der App 4 s, nachdem Alices Sperre angezeigt wurde; im Smoke-Test vom 2026-09-16, ohne Delegation, dauerte das Lesen 2,3 s und 2,8 s.'
				],
				sources: ['zama.userDecryption', 'account.measured', 'smoke.check']
			}
		]
	},

	underfunded: {
		title: 'Die verschlüsselte Null einer ungedeckten Sperre',
		sections: [
			{
				heading: 'Warum nichts revertiert',
				points: [
					'Ein Vertrag kann nicht anhand eines verschlüsselten Vergleichs verzweigen, deshalb revertiert das `_update` von ERC-7984 bei zu niedrigem Guthaben nie.',
					'Es berechnet `transferred = select(balance >= amount, amount, 0)`, wobei 0 eine triviale Verschlüsselung ist, und die Treuhand speichert `transferred`.',
					'Volle und leere Sperren führen dieselben Operationen aus (`FheGe`, `FheSub`, `FheIfThenElse`, `TrivialEncrypt`, `FheIfThenElse`, `FheAdd`) und enden in einem frischen Handle.'
				],
				sources: ['escrow.underfunded', 'zama.fhe']
			},
			{
				heading: 'On-chain',
				points: [
					'Die Sperre wird in einen Block aufgenommen, und das Gas ist bezahlt: im Smoke-Test Block 11717345, 657.529 Gas.',
					'Etherscan zeigt dieselbe Art von Transaktion wie bei einer gedeckten Sperre, mit anderen Handles. Die Calldata enthält den angeforderten Betrag nicht, und nichts zeigt, dass 0 bewegt wurde.',
					'Der Vorgang bleibt `Locked` und belegt seinen `todoRef`; eine Freigabe davon bewegt eine verschlüsselte 0.'
				],
				sources: ['escrow.underfunded', 'smoke.shortfall', 'smoke.fullRun', 'escrow.todoRef'],
				links: [
					{ evidence: 'underfundedLock', label: 'Ungedeckte Sperre vom 2026-09-16 auf Etherscan' }
				]
			},
			{
				heading: 'Nur die Entschlüsselung zeigt es',
				points: [
					'Der Begünstigte sollte den gesperrten Betrag vor Arbeitsbeginn entschlüsseln; die App soll ihn nach jeder Sperre entschlüsseln.',
					'Der Budget-Service wirft `insufficient-balance` mit der aufgenommenen `lockTx`. Das Budget der Aufgabe wechselt zu `failed`, und ein erneuter Versuch erzeugt einen neuen `todoRef`.',
					'Die Terminal-Ausgabe des Smoke-Tests endet vor der Entschlüsselung dieses Betrags; die Dokumentation behauptet daher nicht, dass er auf Sepolia zu 0 entschlüsselt wurde. Im Hardhat-Mock ist das der Fall.'
				],
				sources: ['security.properties', 'escrow.underfunded', 'escrow.todoRef']
			}
		]
	},

	release: {
		title: 'Freigabe: Die Treuhand zahlt aus',
		sections: [
			{
				heading: 'Der Aufruf',
				points: [
					'`release(todoRef)` schlägt den Vorgang unter `_escrows[msg.sender][todoRef]` nach: Für alle außer dem Ersteller existiert er nicht (`EscrowNotFound`), und ein geschlossener revertiert mit `EscrowClosed`.',
					'Der Status wird vor der Überweisung zu `Released`; die Treuhand gewährt dem Token eine transiente Berechtigung auf den gespeicherten Betrag.',
					'`token.confidentialTransfer(beneficiary, amount)` führt dasselbe verschlüsselte `_update` aus. Das Guthaben der Treuhand deckt jeden gespeicherten Betrag, also wird der ganze Betrag bewegt.'
				],
				sources: ['escrow.release']
			},
			{
				heading: 'Events und Etherscan',
				points: [
					'Der Token emittiert `ConfidentialTransfer(escrow, beneficiary, handle)`, die Treuhand `Released(creator, todoRef, beneficiary)`. Keines davon enthält einen Betrag.',
					'Smoke-Test: Block 11717348, 412.902 Gas, 16 Events. Etherscan zeigt „Release“, den `todoRef` und den Transfer mit Handle, nicht den Betrag.',
					'Das übertragene Handle unterscheidet sich vom gespeicherten, obwohl beide denselben Wert verschlüsseln.'
				],
				sources: ['escrow.release', 'smoke.release', 'security.properties'],
				links: [{ evidence: 'release', label: 'Freigabe vom 2026-09-16 auf Etherscan' }]
			},
			{
				heading: 'Wer danach entschlüsseln kann',
				points: [
					'Der gespeicherte Betrag bleibt für Ersteller, Begünstigten und Prüfstelle entschlüsselbar, als Beleg dessen, was gesperrt war.',
					'Das Guthaben des Begünstigten bekommt ein neues Handle; der Token gewährt auf neue Guthaben dauerhaften Zugriff für ihre Inhaber und sich selbst.',
					'Nichts erzwingt eine Freigabe: Der Begünstigte hat keinen Anspruch on-chain. Der `todoRef` lässt sich nicht erneut sperren.'
				],
				sources: ['escrow.states', 'escrow.lock', 'escrow.release', 'smoke.release']
			}
		]
	},

	refund: {
		title: 'Rückzahlung nach der Frist',
		sections: [
			{
				heading: 'Der Aufruf',
				points: [
					'`refund(todoRef)` führt dasselbe Nachschlagen und dieselben Statusprüfungen aus wie `release`: nur der Ersteller, nur solange `Locked`.',
					'Zusätzlich gilt `block.timestamp > deadline`; ein Block, dessen Zeitstempel genau auf der Frist liegt, ist noch zu früh (`DeadlineNotReached`).',
					'Der Status wird zu `Refunded`, `confidentialTransfer` schickt den Betrag an den Ersteller zurück, und die Treuhand emittiert `Refunded(creator, todoRef)`.'
				],
				sources: ['escrow.refund', 'escrow.roles']
			},
			{
				heading: 'Regeln drumherum',
				points: [
					'`lock` nimmt nur eine Frist innerhalb der nächsten 365 Tage an. Die Frist ist öffentlich: in der Calldata und in `Locked`.',
					'Jeder Vorgang schließt einmal: Eine zweite Freigabe, eine Freigabe nach einer Rückzahlung und eine Rückzahlung nach einer Freigabe revertieren allesamt.',
					'Der Begünstigte hat keinen Anspruch on-chain: Ein Ersteller kann eine Freigabe zurückhalten und nach der Frist zurückzahlen.'
				],
				sources: ['escrow.lock', 'escrow.public', 'security.properties']
			},
			{
				heading: 'Stand dieses Kapitels',
				points: [
					'Die App hat noch keine Schaltfläche für die Rückzahlung.',
					'Die Hardhat-Tests decken Rückzahlungen ab; der Sepolia-Smoke-Test führt eine nur mit `SMOKE_REFUND=1` aus, was der Lauf vom 2026-09-16 nicht verwendet hat.'
				],
				sources: ['escrow.refund', 'smoke.refund']
			}
		]
	},

	balance: {
		title: 'Vertrauliches Guthaben: `confidentialBalanceOf`',
		sections: [
			{
				heading: 'Ein Handle, keine Zahl',
				points: [
					'ERC-7984 speichert jedes Guthaben als `euint64`-Handle; `confidentialBalanceOf(holder)` liefert es per `eth_call`.',
					'Ein Handle ist ein öffentlicher Verweis von 32 Bytes. Das Chiffrat dahinter verwahren die Coprozessoren, und aus dem Handle kann niemand einen Wert lesen.',
					'Ein Transfer berechnet das neue Guthaben unter Verschlüsselung, das Guthaben bekommt also ein neues Handle: Nach der Freigabe im Smoke-Test war das erste Guthaben des Begünstigten `0x00089ea4…`.',
					'Das Handle aus lauter Nullen heißt: nie geschrieben. Es zählt ohne Anfrage als 0.'
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
				heading: 'Lesen',
				points: [
					'Ein Guthaben wird gelesen wie ein gesperrter Betrag: Nutzer-Entschlüsselung mit Transport-Schlüsselpaar, EIP-712-Permit, Relayer, KMS-Anteilen und Rekonstruktion im Browser.',
					'Lesen kann es nur, wer eine ACL-Berechtigung hat: Bei jedem Transfer gewährt der Token auf die neuen Guthaben dauerhaften Zugriff für ihre Inhaber und sich selbst.',
					'Etherscan zeigt nie ein Guthaben innerhalb des vertraulichen Tokens, nur dessen Handle.'
				],
				sources: ['zama.userDecryption', 'escrow.lock', 'smoke.etherscan', 'smoke.fund']
			},
			{
				heading: 'Was trotzdem sichtbar wird',
				points: [
					'Das Verpacken von USDT in cUSDT und das Entpacken sind öffentlich, mit Betrag: Das Verpacken im Smoke-Test zeigt 1,0 in der Calldata, als ERC-20-Transfer, in `TrivialEncrypt` und in `Wrap`.',
					'Ein Verpacken von X kurz vor einer Sperre durch dieselbe Adresse legt einen gesperrten Betrag von höchstens X nahe.',
					'In der App verpackt die erste Sperre 1.000,00 in derselben UserOperation: Öffentlich erkennbar ist damit, dass der gesperrte Betrag höchstens 1.000,00 ist.'
				],
				sources: ['escrow.wrap', 'security.leaks', 'account.locking'],
				links: [{ evidence: 'wrap', label: 'Verpacken vom 2026-09-16 auf Etherscan' }]
			}
		]
	},

	auditor: {
		title: 'Der Lesezugriff der Prüfstelle',
		sections: [
			{
				heading: 'Die Berechtigung',
				points: [
					'Die Prüfstelle steht fest im Konstruktor der Treuhand (`immutable`, ungleich null). Jedes `lock` ruft `FHE.allow(transferred, auditor)` auf.',
					'Die Berechtigung ist dauerhaft und öffentlich: ein ACL-Event `Allowed` in jeder Sperre und `auditor()` an der Treuhand.',
					'Die ACL hat keine Funktion, die eine dauerhafte Berechtigung entfernt, und eine Rotation ist unmöglich: Eine neue Prüfstelle bedeutet eine neue Treuhand, und die alte Prüfstelle liest die alten Beträge weiter.'
				],
				sources: ['security.auditor', 'escrow.roles'],
				links: [
					{
						evidence: 'lock',
						label: 'Sperre vom 2026-09-16 auf Etherscan, mit ihren Allowed-Events'
					}
				]
			},
			{
				heading: 'Was die Prüfstelle erfährt',
				points: [
					'Den Betrag jeder Sperre in dieser Treuhand, solange die Chiffrate existieren. Mittel bewegen kann sie nicht.',
					'Ersteller, Begünstigter, `todoRef`, Frist und Status sind on-chain ohnehin öffentlich; der Aufgabentext steht nicht auf der Chain.',
					'Lesen ist eine Nutzer-Entschlüsselung, und jede Anfrage dafür ist auf der Gateway-Chain öffentlich.'
				],
				sources: ['security.auditor', 'security.threatModel', 'escrow.public', 'security.leaks']
			},
			{
				heading: 'Wer sonst entschlüsseln kann',
				points: [
					'Der Owner von cUSDTMock, die Protocol DAO, kann Observer eintragen: `addObserver` delegiert die eigenen Rechte des Tokens zur Nutzer-Entschlüsselung an sie, für jeden Vertrag, ohne Ablauf.',
					'Ein Observer kann jeden Betrag entschlüsseln, den diese Treuhand speichert, und jedes Guthaben und jeden Transfer im Token. Observer sind öffentlich (`observers()`, `ObserverAdded`); am 2026-09-16 gab es keine.',
					'Ersteller, Begünstigter und Prüfstelle können einen gesperrten Betrag jeweils über den Token öffentlich entschlüsselbar machen (`requestDiscloseEncryptedAmount`).'
				],
				sources: ['security.token']
			},
			{
				heading: 'In diesem Deployment',
				points: [
					'Die Prüfstelle auf Sepolia, `0xd81Ad65e…4621`, ist der Deployer und zugleich der Ersteller des Smoke-Tests: ein Testkonto, dessen Schlüssel laut Runbook unverschlüsselt in einer Konfigurationsdatei auf einem Entwicklungsrechner liegt.',
					'Auf Sepolia listet die Prüfansicht für jede Identität die `Locked`-Events; Beträge entschlüsselt sie nur, wenn das eigene Konto die eingetragene Prüfstelle ist, sonst zeigt sie „•••“. Die Attrappe zeigt jeder Identität die Beträge ihres Tabs.'
				],
				sources: ['security.auditor', 'demo.scene7', 'account.reading']
			}
		]
	},

	readExpired: {
		title: 'Lesezugriff mit Ablauf: delegierte Nutzer-Entschlüsselung',
		sections: [
			{
				heading: 'Warum ein zweiter Schlüssel',
				points: [
					'Zama v0.13 akzeptiert nur ECDSA-Permits (Signaturen mit 65 Bytes), deshalb kann ein Passkey-Konto kein Entschlüsselungs-Permit selbst signieren.',
					'Deshalb hält der Browser einen secp256k1-Leseschlüssel, den das Konto einmal pro Vertrag autorisiert, für den Token und für die Treuhand; er liegt im Klartext in `localStorage`.'
				],
				sources: ['security.passkeyWallet', 'zama.versions', 'account.reading']
			},
			{
				heading: 'Die Delegation',
				points: [
					'Das Konto ruft `ACL.delegateForUserDecryption(readKey, contract, expirationDate)` auf, bei der Einrichtung im selben Stapel wie `register`; Delegationen gelten pro Vertrag.',
					'Der Leseschlüssel signiert ein Permit vom Typ `DelegatedUserDecryptRequestVerification`, das das SDK an `POST /v2/delegated-user-decrypt` sendet.',
					'Vor der Anfrage prüft `@fhevm/sdk` `isHandleDelegatedForUserDecryption`, und `@zama-fhe/sdk` liest das Ablaufdatum und bricht bei einer abgelaufenen Delegation ab; eine neue, die weniger als eine Stunde gilt, legt es nicht an.'
				],
				sources: ['zama.delegated', 'account.setup', 'security.passkeyWallet']
			},
			{
				heading: 'Ablauf, und was öffentlich ist',
				points: [
					'Bis zum Ablauf oder zu einem Widerruf kann der Leseschlüssel alles lesen, was das Konto in diesen Verträgen lesen darf.',
					'Das Event `DelegatedForUserDecryption` macht die Verknüpfung zwischen Konto und Leseschlüssel öffentlich.',
					'Jede Kombination (Delegierender, Delegierter, Vertrag) kann einmal pro Block delegiert oder widerrufen werden; die App nimmt deshalb für jede Erneuerung einen neuen Leseschlüssel.'
				],
				sources: ['security.passkeyWallet', 'zama.acl', 'account.reading']
			},
			{
				heading: 'In dieser App',
				points: [
					'Auf Sepolia gilt der Leseschlüssel 24 Stunden. „Mit Passkey verlängern“ sendet eine UserOperation mit zwei neuen Delegationen an einen neuen Leseschlüssel: ein Passkey-Schritt.',
					'Die Attrappe simuliert den Ablauf: `simpleTodoBudgetDemo.expireReadKey()` in der Konsole.'
				],
				sources: ['account.reading', 'demo.scene9']
			}
		]
	},

	cancelled: {
		title: 'Passkey abgebrochen: nichts signiert, nichts gesendet',
		sections: [
			{
				heading: 'Was nicht gesendet wurde',
				points: [
					'Eine Sperre ist eine UserOperation mit `setOperator` am Token und `lock` an der Treuhand, bei der ersten Sperre davor `mint`, `approve` und `wrap`. Eine Freigabe ist eine UserOperation mit `release(todoRef)`.',
					'Den verschlüsselten Betrag und seinen Proof hat der Browser zu diesem Zeitpunkt schon über Zamas Relayer prüfen lassen; an Sepolia geht ohne Signatur nichts.',
					'Die App bereitet die UserOperation bei Openfort vor (Gaswerte, Paymaster-Daten) und fragt dann den Passkey. Eine abgebrochene Abfrage hinterlässt keine Signatur, und ohne Signatur sendet die App die Operation nicht.'
				],
				sources: ['account.locking', 'account.signing', 'escrow.lock']
			},
			{
				heading: 'Lesen braucht keinen Passkey',
				points: [
					'Jede Nutzer-Entschlüsselung braucht ein EIP-712-Permit. In der App signiert es der Leseschlüssel, den das Konto bei der Einrichtung für 24 Stunden freigeschaltet hat; ein abgebrochener Passkey ändert daran nichts.'
				],
				sources: ['zama.userDecryption', 'account.reading']
			},
			{
				heading: 'Was die Chain nicht prüft',
				points: [
					'Calibur v1.0.0 prüft Passkey-Signaturen mit `requireUV: false`: Ob PIN oder Biometrie abgefragt wurden, verlangt nur die App (`userVerification: "required"`).',
					'Die Attrappe sendet ohnehin nichts.'
				],
				sources: ['account.signing', 'security.passkeyWallet', 'demo.real']
			}
		]
	},

	demo: {
		title: 'Demo ohne Chain: was die Attrappe tut',
		sections: [
			{
				heading: 'Was hier läuft',
				points: [
					'Die Budget-Ansichten laufen gegen eine Attrappe im Arbeitsspeicher dieses Tabs: Nichts wird verschlüsselt, nichts gesendet, nichts erreicht Sepolia.',
					'Für ein Budget speichert die geteilte Liste nur das Feld `budget` (Status, Token, Treuhand, `todoRef`, Transaktions-Hashes), nie den Betrag.',
					'Treuhand-Vorgänge leben nur im Arbeitsspeicher dieses Tabs. Nach einem Neuladen oder im Browser des Delegierten behält die Aufgabe ihr Budget, der Betrag ist aber nicht lesbar.'
				],
				sources: ['escrow.title', 'security.title', 'escrow.orbitdb', 'demo.real', 'demo.setup']
			},
			{
				heading: 'Was sie nachbildet',
				points: [
					'Eine Sperre von zu niedrigem Guthaben geht als Transfer von 0 durch und wirft `insufficient-balance`, wie es die Schnittstelle des Budget-Service festlegt.',
					'Jedes Konto bekommt bei seiner ersten Sperre 1.000,00 cUSDT gutgeschrieben.',
					'Die Prüfansicht antwortet jeder Identität und zeigt nur die Vorgänge dieses Tabs.',
					'Hebel in der Konsole: `simpleTodoBudgetDemo.expireReadKey()` und `simpleTodoBudgetDemo.seedExamples()`.'
				],
				sources: ['escrow.underfunded', 'demo.setup', 'demo.scene7', 'demo.scene9']
			},
			{
				heading: 'Der echte Ablauf auf Sepolia',
				points: [
					'Treuhand `0x6Ee3Fa9d…3429`, bereitgestellt in Block 11716748, Quellcode verifiziert auf Etherscan, Sourcify und Blockscout.',
					'Smoke-Test vom 2026-09-16: Test-Dollar prägen, genehmigen und verpacken, Operator-Genehmigung, Sperre, Entschlüsselung als Ersteller und als Begünstigter, ungedeckte Sperre, Freigabe.',
					'Seine sieben Transaktionen verbrauchten 2.269.800 Gas. Verschlüsseln und Entschlüsseln hinterließen auf Sepolia keine Transaktion.',
					'Mit `VITE_BUDGET_SERVICE=zama` und einem Openfort-Zugang läuft dieser Ablauf in der App selbst: ein Calibur-Konto je Passkey, Sperre und Freigabe als gesponserte UserOperation, Lesen über einen Leseschlüssel.'
				],
				sources: [
					'escrow.title',
					'demo.real',
					'smoke.fullRun',
					'smoke.cost',
					'smoke.etherscan',
					'account.setup'
				],
				links: [
					{ evidence: 'escrow', label: 'Treuhand-Vertrag, verifizierter Quelltext' },
					{ evidence: 'wrap', label: 'Verpacken' },
					{ evidence: 'setOperator', label: 'Operator-Genehmigung' },
					{ evidence: 'lock', label: 'Sperre' },
					{ evidence: 'underfundedLock', label: 'Ungedeckte Sperre' },
					{ evidence: 'release', label: 'Freigabe' }
				]
			}
		]
	}
};
