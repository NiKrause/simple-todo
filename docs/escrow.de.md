# Die vertrauliche Treuhand

Das Kapitel `escrow01` versieht eine delegierte Aufgabe mit einem Budget. Das Budget liegt in einem
Smart Contract, [`ConfidentialTodoEscrow`](../contracts/src/ConfidentialTodoEscrow.sol), und wird in
einem vertraulichen ERC-7984-Token bezahlt, dessen Beträge mit Zamas FHEVM verschlüsselt sind. Diese
Seite beschreibt, was die Treuhand tut. Wie Zamas Protokoll verschlüsselt, rechnet und entschlüsselt,
steht in [zama-confidential-transactions.de.md](zama-confidential-transactions.de.md), was nach außen
dringt und wem man vertraut, steht in [security.de.md](security.de.md), und ein echter Lauf auf
Sepolia, Transaktion für Transaktion, steht in [smoke-test.de.md](smoke-test.de.md).

Stand am 2026-09-16: Der Vertrag ist auf Sepolia unter
[`0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429`](https://sepolia.etherscan.io/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429)
(Block 11716748) bereitgestellt, und sein Quellcode ist auf Etherscan, Sourcify und Blockscout
verifiziert. Mit `VITE_BUDGET_SERVICE=zama` sperrt die App seit dem 2026-09-17 auf diesem Vertrag und
gibt dort frei, aus einem Passkey-Konto ([passkey-account.de.md](passkey-account.de.md)); ohne diese
Einstellung laufen die Budget-Ansichten gegen eine Attrappe im Arbeitsspeicher
([`src/lib/budget-service-fake.js`](../src/lib/budget-service-fake.js)).

Jeder Abschnitt hat eine einfache Erklärung und eine technische.

- [Rollen](#rollen)
- [Sperren](#sperren-einfach)
- [Freigabe](#freigabe-einfach)
- [Rückzahlung nach der Frist](#rückzahlung-einfach)
- [Zustände](#zustände)
- [`todoRef` und sein Salt](#todoref-einfach)
- [Warum nur vertrauliche ERC-7984-Token](#erc-7984-einfach)
- [Was Verpacken und Entpacken verraten](#verpacken-und-entpacken-einfach)
- [Die verschlüsselte Null einer ungedeckten Sperre](#ungedeckte-sperre-einfach)
- [Was die App in OrbitDB speichert](#orbitdb-einfach)
- [Was öffentlich ist und was verschlüsselt](#was-öffentlich-ist-und-was-verschlüsselt)

## Rollen

| Rolle        | Einfach                                                                           | Technisch                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ersteller    | Besitzt die Aufgabe, zahlt das Geld ein und entscheidet, wann es ausgezahlt wird. | Der `msg.sender` von `lock`, in der App das Passkey-Konto auf Calibur, einem Smart Contract von Uniswap Labs ([Was Calibur ist](passkey-account.de.md#calibur-einfach)). Treuhand-Vorgänge werden als `_escrows[creator][todoRef]` gespeichert, daher kann nur der Ersteller `release` oder `refund` ausführen (das Nachschlagen verwendet `msg.sender`).                                                                                   |
| Begünstigter | Die Person, an die die Aufgabe delegiert ist; erhält das Geld bei der Freigabe.   | Eine an `lock` übergebene Adresse. Sie darf weder `address(0)` noch die Treuhand selbst sein; der Vertrag verbietet die eigene Adresse des Erstellers nicht, die App schon. Der Begünstigte hat keine Funktion, die er aufrufen könnte, und keinen Anspruch on-chain.                                                                                                                                                                       |
| Prüfstelle   | Kann jeden in dieser Treuhand gesperrten Betrag lesen, aber kein Geld bewegen.    | Eine im Konstruktor festgelegte Adresse (`immutable`). `lock` gewährt ihr dauerhaften ACL-Zugriff auf jeden gespeicherten Betrag. Sie kann keine Mittel bewegen; wie Ersteller und Begünstigter kann sie einen gespeicherten Betrag über `requestDiscloseEncryptedAmount` des Tokens öffentlich machen. Sie zu ändern bedeutet, eine neue Treuhand bereitzustellen. In der Sepolia-Bereitstellung ist sie die eigene Adresse des Deployers. |
| Token        | Das vertrauliche Geld selbst.                                                     | Ein ERC-7984-Token, im Konstruktor festgelegt und über ERC-165 geprüft. Auf Sepolia: Zamas cUSDTMock `0x4E7B06D78965594eB5EF5414c357ca21E1554491`.                                                                                                                                                                                                                                                                                          |

Die Treuhand hat keinen Eigentümer, keine Gebühr, keinen Upgrade-Pfad und außer `release` und
`refund` keine Funktion, die einen gesperrten Betrag bewegt.

## Ablauf

### Sperren: einfach

Alice legt Geld für eine Aufgabe zurück, die sie Bob gegeben hat, und wählt eine Frist. Ihr Browser
verschlüsselt den Betrag, bevor er gesendet wird. Die Treuhand nimmt das Geld aus ihrem vertraulichen
Guthaben und vermerkt, dass es für Bob ist. Auf der Chain bleibt der Betrag verschlüsselt; Alice, Bob
und die Prüfstelle können ihn lesen.

### Sperren: technisch

Vor dem Aufruf, auf dem Client:

1. Der Ersteller hält den Betrag bereits im vertraulichen Token. Den öffentlichen Token unmittelbar
   vor dem Sperren zu verpacken, würde den Betrag verraten (siehe
   [Was Verpacken und Entpacken verraten](#verpacken-und-entpacken-technisch)). Die App verpackt bei
   der ersten Sperre 1.000,00 Test-cUSDT in derselben UserOperation; das verrät eine Obergrenze, nicht
   den Betrag ([Sperren aus dem Passkey-Konto](passkey-account.de.md#sperren-technisch)).
2. Der Ersteller macht die Treuhand zum Operator seines Guthabens: `token.setOperator(escrow, until)`.
   Der Token speichert `until` als Zeitstempel; `isOperator(holder, spender)` ist wahr, solange
   `block.timestamp <= until` gilt.
3. Der Client verschlüsselt den Betrag für das Paar (Treuhand, Ersteller), zum Beispiel mit
   `sdk.encrypt({ values: [{ type: "euint64", value }], contractAddress: escrow, userAddress: creator })`.
   Das Ergebnis ist ein Input-Handle und ein `inputProof`, der Coprozessor-Signaturen über das Handle,
   den Nutzer, den Vertrag und die Chain-ID trägt.

Der Aufruf lautet
`lock(bytes32 todoRef, address beneficiary, externalEuint64 encAmount, bytes inputProof, uint64 deadline)`:

1. Prüfung der Argumente: `todoRef != 0`, `beneficiary` ist weder `address(0)` noch die Treuhand,
   `block.timestamp < deadline <= block.timestamp + 365 days`, und unter `(msg.sender, todoRef)`
   existiert noch kein Treuhand-Vorgang. Andernfalls revertiert der Aufruf mit `ZeroTodoRef`,
   `InvalidBeneficiary`, `InvalidDeadline` oder `EscrowExists`.
2. Begünstigter, Frist und Status `Locked` werden vor jedem externen Aufruf in den Storage
   geschrieben.
3. `FHE.fromExternal(encAmount, inputProof)` ruft `FHEVMExecutor.verifyInput(handle, msg.sender,
inputProof, euint64)` auf. Der Executor übergibt die Treuhand als Vertrag und den Ersteller als
   Nutzer an `InputVerifier`, der die Coprozessor-Signaturen prüft. Ein Proof, der für einen anderen
   Vertrag oder einen anderen Nutzer erstellt wurde, scheitert mit `InvalidSigner`. Bei Erfolg
   erhalten die Treuhand und der Ersteller für diese Transaktion eine transiente ACL-Berechtigung auf
   das Handle.
4. `FHE.allowTransient(requested, token)` erlaubt dem Token, in dieser Transaktion mit dem Handle zu
   rechnen.
5. `token.confidentialTransferFrom(creator, escrow, requested)`, die `euint64`-Überladung. Der Token
   verlangt `isAllowed(requested, escrow)` und `isOperator(creator, escrow)`, andernfalls
   `ERC7984UnauthorizedUseOfEncryptedAmount` oder `ERC7984UnauthorizedSpender`. Sein `_update`
   berechnet, alles unter Verschlüsselung: `success = balance >= amount`,
   `newBalance = select(success, balance - amount, balance)`,
   `transferred = select(success, amount, 0)` und `escrowBalance + transferred`. Er gewährt
   dauerhaften ACL-Zugriff auf die neuen Guthaben und auf `transferred` (für den Ersteller, die
   Treuhand und den Token selbst), emittiert `ConfidentialTransfer(creator, escrow, transferred)` und
   gibt `transferred` mit einer transienten Berechtigung für die Treuhand zurück.
6. Die Treuhand gewährt sich selbst, dem Ersteller, dem Begünstigten und der Prüfstelle dauerhaften
   Zugriff auf `transferred`, speichert es als `amount` des Treuhand-Vorgangs und emittiert
   `Locked(creator, todoRef, beneficiary, deadline)`.

Jede FHE-Operation in den Schritten 3 bis 6 ist auf Ethereum symbolisch: Der FHEVMExecutor gibt ein
neues Handle zurück und emittiert ein Event, und Zamas Coprozessoren berechnen das Chiffrat
off-chain. Am 2026-09-16 verbrauchte die erste Sperre des Smoke-Tests auf Sepolia 682.630 Gas und
erzeugte 21 Event-Logs, aufgeführt in
[smoke-test.de.md](smoke-test.de.md#schritt-3-sperren-technisch).

### Freigabe: einfach

Wenn Bob fertig ist, gibt Alice das Budget frei. Die Treuhand zahlt den gesperrten Betrag in Bobs
vertrauliches Guthaben ein. Nur Alice kann das tun, jederzeit, solange das Geld gesperrt ist, auch
nach der Frist.

### Freigabe: technisch

`release(bytes32 todoRef)` schlägt den Treuhand-Vorgang unter `_escrows[msg.sender][todoRef]` nach. Für
alle außer dem Ersteller ist dieser Eintrag leer, und der Aufruf revertiert mit `EscrowNotFound`; ein
Treuhand-Vorgang, der nicht `Locked` ist, revertiert mit `EscrowClosed`. Der Status wird vor der
Überweisung zu `Released`. Danach gewährt die Treuhand dem Token eine transiente Berechtigung auf den
gespeicherten Betrag und ruft `token.confidentialTransfer(beneficiary, amount)` auf. Der Token
verlangt `isAllowed(amount, escrow)` (die Treuhand hält aus der Sperre eine dauerhafte Berechtigung)
und führt dasselbe `_update` wie oben von der Treuhand zum Begünstigten aus:
`transferred = select(escrowBalance >= amount, amount, 0)`. Das Guthaben der Treuhand ist die Summe
von allem, was gesperrt und noch nicht ausgezahlt ist, daher deckt es jeden gespeicherten Betrag, und
der ganze Betrag wird bewegt. Die Treuhand emittiert `Released(creator, todoRef, beneficiary)`; der
Token emittiert `ConfidentialTransfer(escrow, beneficiary, transferred)`.

Nichts erzwingt eine Freigabe. Der Begünstigte hat keinen Anspruch on-chain; die Auszahlung bleibt die
Entscheidung des Erstellers.

### Rückzahlung: einfach

Ist die Frist abgelaufen und das Geld noch gesperrt, kann Alice es zurücknehmen.

### Rückzahlung: technisch

`refund(bytes32 todoRef)` führt dasselbe Nachschlagen und dieselben Statusprüfungen aus wie `release`
und verlangt zusätzlich `block.timestamp > deadline`: Ein Block, dessen Zeitstempel genau auf der
Frist liegt, ist noch zu früh (`DeadlineNotReached`). Der Status wird zu `Refunded`, der Betrag geht
über `confidentialTransfer` an `msg.sender` zurück, und die Treuhand emittiert
`Refunded(creator, todoRef)`. Die App hat noch keine Schaltfläche für die Rückzahlung. Die
Hardhat-Tests decken Rückzahlungen ab; der Sepolia-Smoke-Test führt eine nur mit `SMOKE_REFUND=1`
aus, was der vollständige Lauf vom 2026-09-16 nicht verwendet hat.

### Zustände

| Status     | Erreicht durch                             | Danach erlaubt                          |
| ---------- | ------------------------------------------ | --------------------------------------- |
| `None`     | nichts unter `(creator, todoRef)` gesperrt | `lock`                                  |
| `Locked`   | `lock`                                     | `release`, oder `refund` nach der Frist |
| `Released` | `release`                                  | nichts                                  |
| `Refunded` | `refund`                                   | nichts                                  |

`escrowOf(creator, todoRef)` gibt jedem `(beneficiary, deadline, status, amount)` zurück; `amount`
ist ein Handle. Nach einer Freigabe oder Rückzahlung bleibt das Handle für den Ersteller, den
Begünstigten und die Prüfstelle entschlüsselbar, als Beleg dessen, was gesperrt war. Ein `todoRef`
kann unter demselben Ersteller nicht erneut gesperrt werden, auch nicht, nachdem er geschlossen ist.

## `todoRef` und sein Salt

### `todoRef`: einfach

Der Treuhand-Vorgang weiß nicht, zu welcher Aufgabe er gehört. Er kennt nur eine Referenznummer, die
die App aus der Aufgabe und einem Zufallswert berechnet, sodass die eigene ID der Aufgabe nicht zum
Treuhand-Vorgang führt.

### `todoRef`: technisch

`todoRef` ist ein beliebiger `bytes32`-Wert ungleich null; der Vertrag prüft nicht, wie er entstanden
ist. Die Dokumentation des Vertrags empfiehlt `keccak256(abi.encode(todoId, salt))` mit 32 zufälligen
Bytes Salt, die bei der Aufgabe aufbewahrt und mit dem Begünstigten geteilt werden. Implementierungen
in diesem Repository:

| Ort                                         | Berechnung                                                        | Salt aufbewahrt? |
| ------------------------------------------- | ----------------------------------------------------------------- | ---------------- |
| Hardhat-Tests                               | `keccak256(abi.encode(string todoId, bytes32 salt))`              | nein             |
| Smoke-Test                                  | `keccak256(abi.encode(string "smoke-<unix time>", bytes32 salt))` | nein             |
| App (`createTodoRef`, Attrappe und Sepolia) | `sha256("<todoKey>:<64 hex chars of random bytes>")`              | nein             |

Die App schreibt den `todoRef` selbst in das Feld `budget` der Aufgabe in OrbitDB, sodass der
Begünstigte den Treuhand-Vorgang über die Aufgabe findet, nicht über das Salt. Zwei Folgen:

- Wer die Liste lesen kann, liest den `todoRef` und kann den Treuhand-Vorgang on-chain finden, mit
  Ersteller, Begünstigtem, Frist und Status, aber nicht mit dem Betrag.
- Das Salt hindert nur jemanden, der den Schlüssel einer Aufgabe kennt, die Liste aber nicht lesen
  kann, daran, die Referenz zu berechnen.

Treuhand-Vorgänge werden über Ersteller und `todoRef` gemeinsam adressiert. Wer einen `todoRef` aus
einer ausstehenden Transaktion kopiert und als Erster darunter sperrt, legt seinen eigenen
Treuhand-Vorgang an und blockiert nicht den des Erstellers
(Test "keeps a creator's todoRef out of reach of someone who locks under it first"). Jeder `todoRef`
wird pro Ersteller einmal verwendet. Das schließt eine ungedeckte Sperre ein; sie wird in einen Block
aufgenommen und belegt ihre Referenz, daher beginnt ein erneuter Versuch in der App mit einem neuen
`todoRef` ([`prepareLock`](../src/lib/budget-flow.js) erzeugt ihn, und
[`startLock`](../src/lib/budget.js) weist den alten zurück, sobald seine Sperre auf der Chain war).

## Warum nur vertrauliche ERC-7984-Token

### ERC-7984: einfach

Bei gewöhnlichen Token, und bei ETH, kann jeder auf der Chain lesen, wie viel gesendet wurde und wie
viel jeder hält. Ein vertraulicher Token hält Guthaben und Überweisungsbeträge verschlüsselt. Das ist
der einzige Grund, warum diese Treuhand ein Budget privat halten kann.

### ERC-7984: technisch

Eine ERC-20-Überweisung emittiert `Transfer(from, to, value)` mit dem Wert im Klartext, und
`balanceOf` ist eine öffentliche View-Funktion. ERC-7984, wie es die Confidential Contracts von
OpenZeppelin implementieren, speichert jedes Guthaben als `euint64`-Handle, bewegt verschlüsselte
Beträge, emittiert `ConfidentialTransfer(from, to, euint64 amount)` nur mit dem Handle und steuert
über die FHEVM-ACL, wer entschlüsseln darf. Der Konstruktor revertiert mit `TokenNotERC7984`, sofern
der Token nicht über ERC-165 `type(IERC7984).interfaceId` deklariert.

Die Treuhand verwendet die `euint64`-Überladung von `confidentialTransferFrom` und prüft den
Input-Proof selbst. Zwei Alternativen scheitern, und die Tests zeigen beide:

- Das externe Handle und den Proof an `confidentialTransferFrom(from, to, externalEuint64, bytes)`
  des Tokens weiterzureichen: Der Token prüft den Proof so, als wäre der Token der Vertrag und die
  Treuhand der Nutzer, wofür der Ersteller nicht verschlüsselt hat, daher revertiert `InputVerifier`
  mit `InvalidSigner`.
- Für (Token, Treuhand) zu verschlüsseln, damit das Weiterreichen durchgeht: Der Proof nennt dann
  keinen Ersteller, und jeder kann ihn gegen sein eigenes Guthaben erneut einspielen und den Betrag
  entschlüsseln, den er erzeugt.

Ein vorhandenes Handle lässt sich ohne Proof sperren (`inputProof` leer). `FHE.fromExternal` verlangt
dann `isAllowed(handle, msg.sender)`, und auch die Treuhand muss darauf berechtigt sein, sodass
niemand ein Handle sperren kann, auf das er keinen Zugriff hat
(Test "takes an existing handle without a proof only from someone who may use it").

## Was Verpacken und Entpacken verraten

### Verpacken und Entpacken: einfach

Gewöhnliche USDT in vertrauliche cUSDT umzuwandeln, und zurück, geschieht offen, mit dem Betrag. Was
danach mit dem vertraulichen Guthaben geschieht, ist verborgen. Deshalb sollte das Verpacken lange
vor dem Sperren geschehen, und nicht genau mit dem Betrag, der gleich gesperrt werden soll.

### Verpacken und Entpacken: technisch

`wrap(to, amount)` auf cUSDTMock (Zamas `ConfidentialWrapper`) macht den Betrag an vier Stellen
öffentlich. Das Verpacken von 1,0 USDTMock in cUSDTMock im Smoke-Test am 2026-09-16
([`0x567d87cb…`](https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de))
zeigt sie alle:

- die Calldata, `amount = 1000000` (6 Dezimalstellen);
- das zugrunde liegende ERC-20-`Transfer(creator, cUSDTMock, 1000000)`, das Etherscan unter
  "ERC-20 Tokens Transferred" aufführt;
- `TrivialEncrypt(pt = 1000000, toType = 5)` des FHEVMExecutor: Der Wrapper erzeugt den
  verschlüsselten Betrag mit `FHE.asEuint64(amount)`, einer trivialen Verschlüsselung eines
  öffentlichen Werts;
- das eigene `Wrap(to, roundedAmount = 1000000, encryptedWrappedAmount)` des Wrappers.

Das Entpacken hat zwei Schritte. `unwrap` verbrennt einen verschlüsselten Betrag, markiert das
verbrannte Handle in der ACL als öffentlich entschlüsselbar (`FHE.makePubliclyDecryptable`) und
emittiert `UnwrapRequested(receiver, unwrapRequestId, amount)`. Von da an kann jeder Zamas KMS bitten,
dieses Handle zu entschlüsseln; der Probelauf des Smoke-Tests tut genau das mit dem neuesten.
`finalizeUnwrap(unwrapRequestId, cleartext, decryptionProof)` legt dann den Klartextbetrag in die
Calldata, prüft die KMS-Signaturen, überweist den zugrunde liegenden ERC-20-Token und emittiert
`UnwrapFinalized` mit dem Klartextbetrag.

Beträge können auch über Korrelation durchsickern: Ein Verpacken von X kurz vor einer Sperre durch
dieselbe Adresse legt einen gesperrten Betrag von höchstens X nahe.

## Die verschlüsselte Null einer ungedeckten Sperre

### Ungedeckte Sperre: einfach

Versucht Alice, mehr zu sperren, als sie hat, schlägt die Sperre nicht fehl. Sie geht durch und
sperrt nichts. Von außen kann das niemand sehen; erst das Entschlüsseln des gesperrten Betrags zeigt
es. Die App ist darauf ausgelegt, den Betrag nach einer Sperre zurückzulesen, bevor sie das Budget als
gedeckt behandelt.

### Ungedeckte Sperre: technisch

Das `_update` von ERC-7984 revertiert bei zu niedrigem Guthaben nie, weil der Vertrag nicht anhand
eines verschlüsselten Vergleichs verzweigen kann. Es berechnet
`transferred = select(balance >= amount, amount, 0)`, wobei `0` eine triviale Verschlüsselung ist.
Die Treuhand speichert `transferred`. Beide Fälle führen dieselben Operationen aus (`FheGe`,
`FheSub`, `FheIfThenElse`, `TrivialEncrypt`, `FheIfThenElse`, `FheAdd`) und enden in einem frischen
Ergebnis-Handle, sodass nichts Öffentliches eine volle Sperre von einer leeren unterscheidet. Die
beiden Sperren des Smoke-Laufs unterscheiden sich um ein Log (21 und 20), und das rührt vom Guthaben
der Treuhand her, das vor der ersten Sperre noch nicht initialisiert war und ein zusätzliches
`TrivialEncrypt` von 0 brauchte, nicht vom Fehlbetrag. Eine Freigabe eines ungedeckten
Treuhand-Vorgangs bewegt eine verschlüsselte 0
(Hardhat-Test "stores an encrypted 0 for an underfunded lock, and a release moves 0").

Der Smoke-Test sperrt 2^64 - 1 Basiseinheiten, um das herbeizuführen. Am 2026-09-16 wurde diese
Sperre in Block 11717345 mit 657.529 Gas aufgenommen, und `escrowOf` zeigt `Locked`, mit dem
gespeicherten Handle `0xc05db6de11bd957b0b95e45ceedfe4c91040dbdfb8ff0000000000aa36a70500`. Die für
diese Dokumentation verfügbare Terminalausgabe endet vor der Entschlüsselung dieses Betrags, daher
behauptet diese Seite nicht, dass er auf Sepolia zu 0 entschlüsselt wurde; im Hardhat-Mock ist das
der Fall.

In der App legt die Schnittstelle des Budget-Service fest, dass `lock` `insufficient-balance` mit
`details.lockTx` wirft, wenn die Überweisung als verschlüsselte 0 durchging. Die Attrappe tut das,
und der Sepolia-Dienst liest dafür nach jeder Sperre den Vorgang am Block der Quittung, wartet zwei
Blöcke und entschlüsselt den gespeicherten Betrag
([`budget-service-zama.js`](../src/lib/budget-service-zama.js)). Das Budget der Aufgabe wechselt dann
zu `failed` und behält die in einen Block aufgenommene `lockTx` ([`lockFailed`](../src/lib/budget.js)).

## Was die App in OrbitDB speichert

### OrbitDB: einfach

Die geteilte Aufgabenliste speichert den Status des Budgets und die Referenzen, die nötig sind, um es
auf der Chain zu finden, nie den Betrag. Beträge kommen von der Chain, entschlüsselt auf dem Gerät
von jemandem, der sie lesen darf.

### OrbitDB: technisch

Eine Aufgabe trägt ein Feld `budget` ([`src/lib/budget.js`](../src/lib/budget.js)):

<!-- prettier-ignore -->
```js
{ mode: 'zama-confidential', status, token, escrow, todoRef, lockTx, releaseTx, lastError }
```

`status` ist einer der Werte `none`, `locking`, `funded`, `releasing`, `released`, `failed`. Die App
lässt es nur vom Eigentümer der Aufgabe schreiben ([`setTodoBudget`](../src/lib/db-actions.js)), und
jeder Schritt einer Sperre oder Freigabe wird geschrieben, bevor der nächste beginnt
([`src/lib/budget-flow.js`](../src/lib/budget-flow.js)). Ein eingegebener Betrag bleibt im
Arbeitsspeicher (`pendingAmounts` in [`src/lib/budget-store.js`](../src/lib/budget-store.js)), bis die
Treuhand ihn hält; danach ist der angezeigte Betrag das Ergebnis von `decryptAmount`. Die Liste selbst
ist nicht verschlüsselt: Wer ihre Adresse hat, kann Aufgabentext, DID des Delegierten und `budget`
lesen.

Die Chain bleibt aus drei Gründen die maßgebliche Quelle:

- Ein OrbitDB-Eintrag enthält, was auch immer ein Mitglied der Schreibberechtigten geschrieben hat.
  Die App ignoriert ein fehlerhaft aufgebautes `budget` (`isWellFormedBudget`), aber ein korrekt
  aufgebautes kann trotzdem falsch sein.
- Der Status in OrbitDB kann der Chain hinterherhinken. Ein Neuladen mitten in einer Sperre
  hinterlässt `locking` mit einem `todoRef`, von dem aus sich der Stand abgleichen lässt.
- Nur `escrowOf(creator, todoRef)` und die Guthaben des Tokens sagen, was gesperrt ist und wer was
  hält, und nur die Entschlüsselung sagt, wie viel.

Die Attrappe zeigt, warum: Ihre Treuhand-Vorgänge leben im Arbeitsspeicher eines einzigen Tabs, daher
findet ein Neuladen, oder der eigene Browser des Delegierten, das `budget` der Aufgabe, aber keinen
Treuhand-Vorgang (`escrow-not-found`, der Betrag erscheint als nicht lesbar). Auf Sepolia liest jeder
Beteiligte den Vorgang von der Chain und entschlüsselt den Betrag im eigenen Browser.

## Was öffentlich ist und was verschlüsselt

| Element                                                     | Auf Sepolia    | Wo es sichtbar ist                                                                                |
| ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| Adresse des Erstellers                                      | öffentlich     | Absender der Transaktion; Topic 1 von `Locked`                                                    |
| Adresse des Begünstigten                                    | öffentlich     | Calldata von `lock`; Topic 3 von `Locked`; ACL-Event `Allowed`                                    |
| Adresse der Prüfstelle                                      | öffentlich     | `auditor()`; ACL-Event `Allowed` bei jeder Sperre                                                 |
| Zeitpunkt von Sperre, Freigabe, Rückzahlung                 | öffentlich     | Zeitstempel des Blocks                                                                            |
| Aufgerufene Funktion                                        | öffentlich     | Methodenselektor; Etherscan zeigt "Lock", "Release"                                               |
| `todoRef`                                                   | öffentlich     | Calldata; Topic 2 von `Locked`, `Released`, `Refunded`                                            |
| Frist                                                       | öffentlich     | Calldata; Daten von `Locked`                                                                      |
| Gas und Gebühr                                              | öffentlich     | Transaktionsbeleg                                                                                 |
| Betrags-Handles                                             | öffentlich     | Calldata (Input-Handle), `VerifyInput`, Topic 3 von `ConfidentialTransfer`, `Allowed`, `escrowOf` |
| Input-Proof (Coprozessor-Signaturen)                        | öffentlich     | Calldata; Daten von `VerifyInput`                                                                 |
| Wer ein Handle entschlüsseln darf                           | öffentlich     | ACL-Events `Allowed`                                                                              |
| Die Berechnung (welche FHE-Operationen auf welchen Handles) | öffentlich     | Events des FHEVMExecutor                                                                          |
| Gesperrter, freigegebener oder zurückgezahlter Betrag       | verschlüsselt  | on-chain steht nur sein Handle                                                                    |
| Guthaben                                                    | verschlüsselt  | on-chain stehen nur ihre Handles                                                                  |
| Ob eine Sperre ungedeckt war                                | verschlüsselt  | on-chain nicht unterscheidbar                                                                     |
| Beträge beim Verpacken und Entpacken                        | öffentlich     | Calldata, ERC-20-`Transfer`, `TrivialEncrypt`, `Wrap`, `UnwrapFinalized`                          |
| Aufgabentext, DID des Delegierten, `todoRef`, Budget-Status | nicht on-chain | OrbitDB, lesbar für jeden mit der Adresse der Liste                                               |

## Quellen

Repository (Branch `escrow01`):

- [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol): Rollen
  und Immutables Zeilen 44-54, Events 56-59, Konstruktor 71-78, `lock` 100-136, `release` 143-148,
  `refund` 150-158, `escrowOf` 168-175, `_send` 183-190.
- [`contracts/test/ConfidentialTodoEscrow.ts`](../contracts/test/ConfidentialTodoEscrow.ts):
  ungedeckte Sperre 167-185, Prüfstelle und Fremder 187-212, Freigabe nur durch den Ersteller
  214-229, Frist der Rückzahlung 231-263, Front-Running eines `todoRef` 322-338, erneut eingespielter
  Input 363-377, Weiterreichen gegenüber eigener Prüfung 379-419, vorhandenes Handle ohne Proof
  421-444, Prüfungen von Token und Prüfstelle 474-491, keine Beträge in Events 493-534.
- [`contracts/scripts/smoke-sepolia.ts`](../contracts/scripts/smoke-sepolia.ts): `todoRef` 406-410,
  Sperre 573-601.
- [`contracts/README.md`](../contracts/README.md): "Who can decrypt" und "What stays public".
- [`src/lib/budget.js`](../src/lib/budget.js): `Budget` 54-67, `isWellFormedBudget` 109-132,
  `startLock` 145-172, `lockFailed` 184-198.
- [`src/lib/budget-service.js`](../src/lib/budget-service.js) 1-85,
  [`src/lib/budget-service-fake.js`](../src/lib/budget-service-fake.js) 1-18 und 171-236,
  [`src/lib/budget-service-zama.js`](../src/lib/budget-service-zama.js) (`createTodoRef`, `lock`),
  [`src/lib/budget-flow.js`](../src/lib/budget-flow.js), [`src/lib/budget-store.js`](../src/lib/budget-store.js)
  1-10 und 97-115, [`src/lib/db-actions.js`](../src/lib/db-actions.js) 944-958.

Bibliotheken (`contracts/node_modules`):

- `@openzeppelin/confidential-contracts` 0.5.3: `token/ERC7984/ERC7984.sol` (`isOperator` 99,
  `confidentialTransfer` 121, `confidentialTransferFrom` 140, `_update` 290-323),
  `utils/FHESafeMath.sol` (`tryDecrease` 34-43), `interfaces/IERC7984.sol` (Events 14-25),
  `token/ERC7984/extensions/ERC7984ERC20Wrapper.sol` (`wrap` 82, `finalizeUnwrap` 114-135, `_unwrap`
  212-229).
- `@fhevm/solidity` 0.11.1: `lib/FHE.sol` (`fromExternal` für `euint64` 8598-8609, `allow`,
  `allowThis`, `allowTransient` 9081-9111), `lib/Impl.sol` (`verify` 670-674).

cUSDTMock auf Sepolia (Implementierung `0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04`, exakte
Übereinstimmung auf Sourcify): <https://sourcify.dev/server/v2/contract/11155111/0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04?fields=sources>

- `contracts/token/ERC7984Upgradeable.sol`: `confidentialTransferFrom` 175-184, `_update` 343-378.
- `contracts/extensions/ERC7984ERC20WrapperUpgradeable.sol`: Event `Wrap` 43, `wrap` 107-119,
  `_unwrap` 249-268.

Chain (gelesen über `https://ethereum-sepolia-rpc.publicnode.com` und Etherscan am 2026-09-16):

- Verpacken: <https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de>
- Sperre: <https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065>
- Ungedeckte Sperre: <https://sepolia.etherscan.io/tx/0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6>
- Freigabe: <https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c>

Zama-Dokumentation:

- Vertraulicher Wrapper: <https://docs.zama.org/protocol/protocol-apps/confidential-tokens/confidential-wrapper>
- Sicherheitsmodell des SDK, "What is visible": <https://docs.zama.org/protocol/sdk/concepts/security-model>
