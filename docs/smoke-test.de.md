# Der Smoke-Test auf Sepolia

[`contracts/scripts/smoke-sepolia.ts`](../contracts/scripts/smoke-sepolia.ts) testet den bereitgestellten
Treuhand-Vertrag gegen Zamas live laufenden Relayer, die Coprozessoren und das KMS auf Sepolia. Das
Skript hat zwei Modi:

| Modus              | Befehl                      | Benötigt                                          | Sendet                                         | Zeigt                                                                                                                                        |
| ------------------ | --------------------------- | ------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Probelauf          | `npm run smoke:sepolia:dry` | `SEPOLIA_RPC_URL`                                 | nichts, signiert nichts                        | Chain, Verträge, Verschlüsselung über den Relayer, dass der Treuhand-Vertrag diese Eingabe annimmt, öffentliche Entschlüsselung über das KMS |
| Vollständiger Lauf | `npm run smoke:sepolia`     | zusätzlich `DEPLOYER_PRIVATE_KEY` mit Sepolia-ETH | 4 bis 7 Transaktionen (9 mit `SMOKE_REFUND=1`) | eine echte Sperre, den von Ersteller und Begünstigtem zurückgelesenen Betrag, eine ungedeckte Sperre, eine Freigabe                          |

Beide laufen in `contracts/` (zu Einrichtung und Fehlerbehebung siehe
[contracts/README.md](../contracts/README.md#smoke-test)). Diese Seite erklärt jeden Schritt zweimal,
einfach und technisch, und nimmt den vollständigen Lauf vom 2026-09-16 als durchgearbeitetes
Beispiel: Seine Transaktionen wurden von der Chain und von Etherscan zurückgelesen. Wie die Teile des
Protokolls funktionieren, steht in
[zama-confidential-transactions.de.md](zama-confidential-transactions.de.md); die Regeln der
Treuhand stehen in [escrow.de.md](escrow.de.md).

- [Was Etherscan zeigt](#was-etherscan-zeigt)
- [Probelauf](#probelauf)
- [Vollständiger Lauf vom 2026-09-16](#vollständiger-lauf-vom-2026-09-16)
- [Kosten](#kosten)

## Was Etherscan zeigt

Für jede Transaktion des vollständigen Laufs zeigt Etherscan Absender, Vertrag, Methode, Gebühr,
Block und Zeit, die gegen die verifizierte ABI dekodierte Calldata und jedes Event in dekodierter
Form, einschließlich der Events von Zamas Host-Verträgen. Dadurch wird Folgendes sichtbar:

- die Handles: die verschlüsselte Eingabe in der Calldata, jedes Zwischen- und Ergebnis-Handle in den
  FHEVMExecutor-Events, das Betrags-Handle im `ConfidentialTransfer` des Tokens;
- der Input-Proof: in der Calldata und noch einmal im Event `VerifyInput`, mit seinen drei
  Coprozessor-Signaturen;
- wer entschlüsseln darf: jede dauerhafte ACL-Berechtigung als Event `Allowed(caller, account, handle)`;
- Beträge, wo der öffentliche ERC-20 beteiligt ist: Prägen, Genehmigen und Verpacken.

Einen Betrag innerhalb des vertraulichen Tokens zeigt Etherscan nie: nicht den gesperrten Betrag,
kein Guthaben und nicht, ob eine Sperre ungedeckt war. Verschlüsselung, Nutzer-Entschlüsselung und
öffentliche Entschlüsselung sind Relayer-Anfragen und hinterlassen auf Sepolia überhaupt keine
Transaktion. Anfragen zur Nutzer-Entschlüsselung werden allerdings zu Transaktionen auf Zamas
Gateway-Chain, gesendet vom Relayer, deren Events die Handles, den anfragenden Nutzer und den
öffentlichen Transport-Schlüssel nennen; für diese Chain betreibt Zama einen öffentlichen Explorer
(siehe [security.de.md](security.de.md#was-sichtbar-wird-technisch)).

## Probelauf

Am 2026-09-16 mehrmals ausgeführt. Das README verzeichnet drei Läufe mit 10,0 bis 13,6 s für die
Verschlüsselung und 2,3 s für die öffentliche Entschlüsselung; ein vierter Lauf gegen 14:55 UTC ergab
12,9 s und 2,4 s. Die Verschlüsselungszeiten enthalten den Start des SDK (Herunterladen des
öffentlichen FHE-Schlüssels und der CRS, Laden des WASM) und den lokalen Proof.

### Probelauf 1: RPC liefert Sepolia, einfach

Prüft, ob der konfigurierte Knoten wirklich Sepolia ist.

### Probelauf 1: RPC liefert Sepolia, technisch

`eth_chainId` muss 11155111 zurückgeben; der Schritt gibt den neuesten Block aus. Die RPC-URL wird nie
ausgegeben: Die gesamte Ausgabe läuft durch einen Filter, der sie ersetzt.

### Probelauf 2: Treuhand und Token, einfach

Prüft, ob der Treuhand-Vertrag existiert und den erwarteten Token verwendet und ob der Token nicht
pausiert ist.

### Probelauf 2: Treuhand und Token, technisch

Nur lesende Aufrufe: der Code des Treuhand-Vertrags, `token()`, `auditor()` und
`confidentialProtocolId()` (muss 10001 sein, Zamas ID für Sepolia); auf dem Token `name()`, `symbol()`,
`decimals()`, `rate()`, `underlying()`, `paused()`, `observers()` und `isBlocked(escrow)`; auf dem
zugrunde liegenden USDTMock `name()`, `symbol()`, `decimals()` und `MAX_MINT_AMOUNT_TOKENS()`. Am
2026-09-16: Prüfstelle `0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621`, Token Confidential USDT (Mock),
6 Dezimalstellen, Rate 1, nicht pausiert, keine Observer; USDTMock mit öffentlichem Prägen von bis zu
1.000.000 Token pro Aufruf. Gesendet wird nichts.

### Probelauf 3: Verschlüsseln, einfach

Verschlüsselt 1,0 cUSDTMock für den Treuhand-Vertrag und einen zufälligen, erfundenen Nutzer, über
Zamas Relayer.

### Probelauf 3: Verschlüsseln, technisch

`sdk.encrypt({ values: [{ type: "euint64", value: 1000000 }], contractAddress: escrow, userAddress:
<random> })` mit `@zama-fhe/sdk` 3.6.0 und dessen Node-Transport. Client: die Speicherorte von
Schlüssel und CRS von `/v2/keyurl` holen, in WASM den Ciphertext und einen ZK-Proof bauen, der an
(Treuhand, zufällige Adresse, ACL, Chain-ID) gebunden ist. Zama: `POST /v2/input-proof`; auf dem
Gateway prüfen die Coprozessoren den Proof und signieren `CiphertextVerification`; das SDK prüft die
zurückgegebenen Handles und Signaturen. Ergebnis am 2026-09-16, 14:55 UTC: Handle
`0x1c0568de85b63c3901682a6c01df1d2f5e9bec85a3000000000000aa36a70500`, Proof 230 Bytes. Etherscan:
nichts, das ist keine Transaktion.

### Probelauf 4: Sperre simulieren, einfach

Fragt einen Sepolia-Knoten, was geschähe, wenn der zufällige Nutzer diesen verschlüsselten Betrag
sperren würde, ohne etwas zu senden. Der Treuhand-Vertrag muss den verschlüsselten Betrag annehmen und
nur deshalb abbrechen, weil der Nutzer den Treuhand-Vertrag nie genehmigt hat.

### Probelauf 4: Sperre simulieren, technisch

`escrow.lock.staticCall(todoRef, <random beneficiary>, handle, inputProof, now + 1 day, { from:
<random> })`, ein `eth_call`. In der Simulation führt der Treuhand-Vertrag `FHE.fromExternal` aus, der
InputVerifier von Sepolia prüft die Coprozessor-Signaturen für (Treuhand, zufällige Adresse), und
`confidentialTransferFrom` des Tokens bricht mit `ERC7984UnauthorizedSpender(random, escrow)` ab, weil
keine Operator-Genehmigung existiert. Dieser Revert ist das erwartete Ergebnis: Er beweist, dass der
Proof angenommen wurde. `InvalidSigner(address)` hieße, dass der InputVerifier ihn abgelehnt hat.
0,2 s. Etherscan: nichts.

### Probelauf 5: Öffentliche Entschlüsselung, einfach

Entschlüsselt einen Betrag, der absichtlich bereits öffentlich ist (eine von jemandem beantragte
Auszahlung aus cUSDTMock), über denselben Relayer und dieselben Schlüsselhalter, die auch das normale
Lesen nutzt.

### Probelauf 5: Öffentliche Entschlüsselung, technisch

Das Skript durchsucht die letzten 5.000 Blöcke, ohne die neuesten 20, nach `UnwrapRequested`-Events
von cUSDTMock, deren Betrags-Handle der Wrapper öffentlich entschlüsselbar gemacht hat.
`sdk.decryption.decryptPublicValues([handle])` prüft `ACL.isAllowedForDecryption(handle)`, sendet
`POST /v2/public-decrypt` und verifiziert, dass mindestens der Schwellenwert des KMSVerifier an
bekannten KMS-Signierern, 7 von 13, `PublicDecryptVerification` signiert hat. Am 2026-09-16,
14:55 UTC: Handle `0x1f56e64dc6a3cc447f359657d67c88870ae70fd914ff0000000000aa36a70500` aus Block
11717436, Klartextwert 0,0 cUSDTMock, 2,4 s. Nur auf diesem Weg kann ein Probelauf das KMS testen:
Eine Nutzer-Entschlüsselung braucht ein Konto mit einer ACL-Berechtigung, und die erzeugt nur der
vollständige Lauf.

### Probelauf 6: Plan, einfach

Gibt aus, was der vollständige Lauf tun würde und was er ungefähr kosten würde.

### Probelauf 6: Plan, technisch

Gas pro Schritt aus `GAS` im Skript (Schätzungen aus Sepolia und dem Hardhat-Mock) mal dem aktuellen
Gaspreis. Am 2026-09-16 bei 1,18 gwei: 1,9 bis 2,4 M Gas, 0,0023 bis 0,0028 ETH.

## Vollständiger Lauf vom 2026-09-16

Aufbau:

|                          |                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ersteller und Prüfstelle | `0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621` (der Deployer-Schlüssel)                                                                                       |
| Begünstigter             | `0x3e715fAc356AcB5b7A7383e6cbde865bCeF596BB`, eine für diesen Lauf im Arbeitsspeicher erzeugte Wallet; sie hat keine Transaktion gesendet und hält kein ETH |
| Treuhand-Vertrag         | `0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429`, bereitgestellt in Block 11716748                                                                              |
| Token                    | cUSDTMock `0x4E7B06D78965594eB5EF5414c357ca21E1554491`, nicht pausiert, keine Observer                                                                      |
| Zugrunde liegender Token | USDTMock `0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0`                                                                                                       |
| SDK                      | `@zama-fhe/sdk` 3.6.0 auf `@fhevm/sdk` 0.13.2                                                                                                               |
| Betrag                   | `SMOKE_AMOUNT` 1 (1.000.000 Basiseinheiten); kein `SMOKE_REFUND`                                                                                            |

Ergebnisse. Die Zeiten sind die Schrittzeiten des Skripts, wie sie im Terminal ausgegeben wurden; sie
enthalten das Warten auf eine Bestätigung, oder auf zwei, wo das Ergebnis als Nächstes entschlüsselt
wird. Block, Gas und Gebühr stammen aus den Receipts. Jeder Relayer-Schritt dauerte weniger als die
10 s, die das Skript vor einem erneuten Versuch wartet, also gelang jeder beim ersten Versuch.

| Schritt                            |            Zeit | Transaktion                                                                                                         | Block (UTC)         | Verbrauchtes Gas | Gebühr (ETH) |
| ---------------------------------- | --------------: | ------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------: | -----------: |
| 1 1,0 USDTMock prägen              |           8,4 s | [`0xe9e177db…`](https://sepolia.etherscan.io/tx/0xe9e177db627ff3d769af661b5724ac2777d57883803e1c7bcd3a1a2af2b1288c) | 11717333 (14:30:00) |           51.760 | 0,0000540343 |
| 1 genehmigen                       |          12,5 s | [`0x41630980…`](https://sepolia.etherscan.io/tx/0x416309800691580524f8d9a2bbe2130c31651e1939a1cb258b0f520c1ac15d79) | 11717334 (14:30:12) |           46.600 | 0,0000468603 |
| 1 in 1,0 cUSDTMock verpacken       |          24,8 s | [`0x567d87cb…`](https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de) | 11717336 (14:30:36) |          367.250 | 0,0003831529 |
| 2 `setOperator(escrow, now + 1 h)` |          24,9 s | [`0x79a1a622…`](https://sepolia.etherscan.io/tx/0x79a1a622a864129daa23d887d9c56fee578066222065dab6514c5cbe830c4b51) | 11717338 (14:31:00) |           51.129 | 0,0000570340 |
| 3 1,0 verschlüsseln                |           9,6 s | –                                                                                                                   | –                   |                – |            – |
| 3 sperren, 2 Bestätigungen         |          37,0 s | [`0x04259275…`](https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065) | 11717341 (14:31:36) |          682.630 | 0,0007529838 |
| 4 als Ersteller entschlüsseln      |           2,8 s | –                                                                                                                   | –                   |                – |            – |
| 4 als Begünstigter entschlüsseln   |           2,3 s | –                                                                                                                   | –                   |                – |            – |
| 5 2^64 - 1 verschlüsseln           |           4,5 s | –                                                                                                                   | –                   |                – |            – |
| 5 sperren (ungedeckt)              | nicht im Auszug | [`0xfbe2cd1e…`](https://sepolia.etherscan.io/tx/0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6) | 11717345 (14:32:24) |          657.529 | 0,0006839568 |
| 6 freigeben                        | nicht im Auszug | [`0xd9d123e6…`](https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c) | 11717348 (14:33:00) |          412.902 | 0,0004424626 |

Die für diese Seite verfügbare Terminal-Ausgabe endet nach `escrowOf` der ungedeckten Sperre. Die
Freigabe und alles danach wurden stattdessen auf der Chain geprüft; die Entschlüsselung des
ungedeckten Betrags und die des Guthabens des Begünstigten sind nicht im Auszug, deshalb nennt diese
Seite deren Ergebnisse nicht.

### Schritt 0: Ersteller und Begünstigter, einfach

Stellt sicher, dass keines der beiden Konten vom Token blockiert ist und dass der Ersteller genug
Sepolia-ETH hat.

### Schritt 0: Ersteller und Begünstigter, technisch

`isBlocked(creator)` und `isBlocked(beneficiary)` auf cUSDTMock (dessen vom Eigentümer verwaltete
Blockliste), die aktuellen Gebührendaten und das ETH-Guthaben des Erstellers gegenüber dem teuersten
Plan. Der Begünstigte ist `Wallet.createRandom()`: ein Schlüssel im Arbeitsspeicher, der nur
Entschlüsselungs-Permits signiert. Etherscan: nichts.

### Schritt 1: Guthaben beschaffen, einfach

Der Ersteller hatte noch keine vertraulichen Dollar. Das Skript prägt Test-Dollar, erlaubt dem
vertraulichen Token, sie zu nehmen, und wandelt sie in vertrauliche Dollar um. All das ist öffentlich,
einschließlich des Betrags.

### Schritt 1: Guthaben beschaffen, technisch

**Guthaben des Erstellers lesen.** `confidentialBalanceOf(creator)` gab das Handle aus lauter Nullen
zurück: Das Konto hatte nie cUSDTMock gehalten, also wertet das Skript es ohne Anfrage an den Relayer
als 0,0.

**Prägen.** `USDTMock.mint(creator, 1000000)`, Calldata 68 Bytes. Event: ERC-20 `Transfer(0x0, creator,
1000000)`. Etherscan zeigt "Transfer 1 USDTMock to 0xd81Ad65e…" und führt es unter "ERC-20 Tokens
Transferred" auf. Öffentlich: Betrag, Empfänger, Zeit.

**Genehmigen.** `USDTMock.approve(cUSDTMock, 1000000)`. Event: `Approval(creator, cUSDTMock, 1000000)`.
Etherscan zeigt "Approve 1 ERC20 … for Trade on 0x4E7B06D7…". Öffentlich: Betrag und Spender.

**Verpacken.** `cUSDTMock.wrap(creator, 1000000)`, 16 Events:

1. USDTMock `Transfer(creator, cUSDTMock, 1000000)`;
2. FHEVMExecutor `TrivialEncrypt(pt = 1000000, toType = 5)`: Der verpackte Betrag wird von einem
   öffentlichen zu einem verschlüsselten Wert;
3. `FheAdd`, `FheGe`, `FheIfThenElse` und ein `Allowed`: die vertrauliche Gesamtmenge, die nur erhöht
   wird, wenn sie nicht überläuft;
4. `TrivialEncrypt(0)` und `FheIfThenElse`: der geprägte Betrag, `select(success, amount, 0)`, Handle
   `0x9a042cde…3fff0000000000aa36a70500`;
5. `TrivialEncrypt(0)` und `FheAdd`: das Guthaben des Erstellers, zuvor nicht initialisiert, jetzt
   Handle `0xc2918d87…56ff0000000000aa36a70500`;
6. vier `Allowed`-Events für das neue Guthaben und den geprägten Betrag (Ersteller und Token);
7. `ConfidentialTransfer(0x0, creator, 0x9a042cde…)` und `Wrap(creator, roundedAmount = 1000000,
encryptedWrappedAmount = 0x9a042cde…)`.

Etherscan zeigt den Betrag viermal: in der dekodierten Calldata, als "ERC-20 Tokens Transferred: 1
USDTMock", als `pt` von `TrivialEncrypt` und als `roundedAmount` von `Wrap`. Das daraus resultierende
vertrauliche Guthaben des Erstellers zeigt es nicht, nur dessen Handle. Bei Zama: keine
Relayer-Anfrage; die Coprozessoren berechnen die Operationen aus den Events.

### Schritt 2: Operator, einfach

Der Ersteller erlaubt dem Treuhand-Vertrag, in der nächsten Stunde Geld aus dem vertraulichen Guthaben
des Erstellers zu nehmen. Noch bewegt sich nichts.

### Schritt 2: Operator, technisch

`cUSDTMock.setOperator(escrow, 1789572636)`, also die Zeit des neuesten Blocks plus 3.600 s
(2026-09-16T15:30:36Z). Storage: Das Operator-Mapping des Tokens für (Ersteller, Treuhand) hält den
Zeitstempel. Event: `OperatorSet(creator, escrow, until)`. Danach liest das Skript
`isOperator(creator, escrow)` im Block des Receipts. Eine Operator-Genehmigung nach ERC-7984 hat
keinen Betrag: Der Operator darf bis `until` jeden beliebigen Betrag bewegen. Der Treuhand-Vertrag
zieht Beträge immer nur von seinem eigenen Aufrufer ein, deshalb ist diese Genehmigung nur über die
eigenen `lock`-Aufrufe des Erstellers nutzbar. Etherscan zeigt "Call Set Operator Function", Operator
und `until`. Keine FHE-Operation, kein Handle.

### Schritt 3: Sperren, einfach

Der Rechner des Erstellers verschlüsselt 1,0 und erhält von Zama eine signierte Bestätigung, dass die
Verschlüsselung für diesen Treuhand-Vertrag und diesen Ersteller gültig ist. Dann sperrt der Ersteller
den Betrag für den Begünstigten, mit einer Frist, die einen Tag später abläuft. Die Chain verzeichnet,
wer, für wen, wann, bis wann und eine Referenznummer, nicht wie viel.

### Schritt 3: Sperren, technisch

**Verschlüsseln (9,6 s, erster Versuch).** `sdk.encrypt` für (Treuhand, Ersteller), wie in Probelauf 3,
einschließlich des Starts des SDK. Ergebnis: Input-Handle
`0x4a47ae4fd5dd21a7962881ccabba2bc1be379cace6000000000000aa36a70500` und ein 230 Bytes langer
`inputProof`: `0x01` (ein Handle), `0x03` (drei Signaturen), das Handle, drei Coprozessor-Signaturen
zu je 65 Bytes, `extraData` `0x00`. Nichts auf Sepolia.

**Sperr-Transaktion (37,0 s mit zwei Bestätigungen).**
`lock(todoRef, beneficiary, encAmount, inputProof, deadline)` mit
`todoRef = 0x8d778cd7ad5924835e86549063984b88a5c37ac54832e7044a131de724056e8c`
(`keccak256(abi.encode("smoke-<unix time>", salt))`), Frist 1789655472 (2026-09-17T14:31:12Z).
Calldata 452 Bytes: Selektor `0x7f50daed`, fünf Head-Words, die Proof-Länge (230) und der auf
256 Bytes aufgefüllte Proof.

Events, in Reihenfolge (21):

| #     | Vertrag       | Event                                                        | Bedeutung                                                                              |
| ----- | ------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 35    | FHEVMExecutor | `VerifyInput(escrow, 0x4a47…, creator, <proof>, 5, 0x4a47…)` | Proof für (Treuhand, Ersteller) angenommen                                             |
| 36-38 | FHEVMExecutor | `FheGe`, `FheSub`, `FheIfThenElse`                           | Guthaben des Erstellers `0xc2918d…` ≥ Betrag?, neues Guthaben `0xb3cebb…`              |
| 39-40 | ACL           | `Allowed` ×2                                                 | neues Guthaben des Erstellers für Token und Ersteller                                  |
| 41-42 | FHEVMExecutor | `TrivialEncrypt(0)`, `FheIfThenElse`                         | `transferred = select(ok, 0x4a47…, 0)` = `0x506d80…`                                   |
| 43-44 | FHEVMExecutor | `TrivialEncrypt(0)`, `FheAdd`                                | erstes Guthaben des Treuhand-Vertrags `0x258ba0…`                                      |
| 45-49 | ACL           | `Allowed` ×5                                                 | Treuhand-Guthaben für Token und Treuhand; `transferred` für Ersteller, Treuhand, Token |
| 50    | cUSDTMock     | `ConfidentialTransfer(creator, escrow, 0x506d80…)`           | das Handle dessen, was angekommen ist                                                  |
| 51-54 | ACL           | `Allowed` ×4 durch den Treuhand-Vertrag                      | `0x506d80…` für Treuhand, Ersteller, Begünstigten, Prüfstelle                          |
| 55    | Treuhand      | `Locked(creator, todoRef, beneficiary, 1789655472)`          |                                                                                        |

Storage danach: Der Eintrag des Treuhand-Vertrags für (Ersteller, todoRef) hält Begünstigten, Frist,
Status `Locked` und Betrag `0x506d80703a79c87b91a050038fb7baf8bb1e70c1e4ff0000000000aa36a70500`; der
Token hält die neuen Guthaben-Handles; die ACL hält die obigen Berechtigungen. Transiente
Berechtigungen (die des Treuhand-Vertrags und die des Erstellers auf die Eingabe, die des Tokens auf
die Eingabe und die des Treuhand-Vertrags auf `transferred`) hinterlassen kein Event und keinen
Storage. Verbrauchtes Gas 682.630 bei einem Limit von 689.211, zu 1,103 gwei. Nach Zamas
HCU-Preistabelle kosten die Operationen des Tokens 586.064 HCU; HCULimit emittiert pro Operation
nichts, deshalb steht diese Zahl nicht auf Etherscan.

Bei Zama: keine Relayer-Anfrage. Die Coprozessoren greifen die Executor-Events auf, berechnen die
Ciphertexte und committen laut Zamas Coprozessor-Dokumentation Digests der Ciphertexte auf dem
Gateway, wenn sie die `Allowed`-Events verarbeiten.

Etherscan zeigt: "Call Lock Function by 0xd81Ad65e… on 0x6Ee3Fa9d…", die dekodierten Argumente
einschließlich des Handles und des vollständigen Proofs, 21 dekodierte Events mit jedem Handle und
jedem berechtigten Konto sowie `Locked` mit `todoRef` und Frist. Nicht angezeigt werden 1,0, die
Guthaben und ob das Guthaben des Erstellers ausreichte.

### Schritt 4: Prüfen, einfach

Das Skript liest die Treuhand zurück und entschlüsselt den gesperrten Betrag zweimal: einmal als
Ersteller, einmal als Begünstigter. Beide sehen 1,0. Keiner der beiden sendet eine Transaktion.

### Schritt 4: Prüfen, technisch

**`escrowOf(creator, todoRef)`**, ein `eth_call`: Status `Locked`, der erwartete Begünstigte,
Betrags-Handle `0x506d80703a79c87b91a050038fb7baf8bb1e70c1e4ff0000000000aa36a70500`.

**Als Ersteller entschlüsseln (2,8 s).** Eine Nutzer-Entschlüsselung mit `contractAddress = escrow`
über die SDK-Instanz des Erstellers: ML-KEM-512-Transport-Schlüsselpaar; EIP-712-Permit
`UserDecryptRequestVerification`, signiert mit dem Schlüssel des Erstellers für die Vertragsliste
[Treuhand]; `ACL.persistAllowed(handle, creator)` und `ACL.persistAllowed(handle, escrow)` vom Client
aus geprüft; `POST /v2/user-decrypt`; KMS-Anteile per Signcryption an den Transport-Schlüssel;
Rekonstruktion im TKMS-WASM. Ergebnis 1.000.000 Basiseinheiten, 1,0 cUSDTMock.

**Als Begünstigter entschlüsseln (2,3 s).** Dasselbe über die eigene SDK-Instanz des Begünstigten,
mit einem Permit, das der im Arbeitsspeicher gehaltene Schlüssel des Begünstigten signiert hat. Die
ACL-Berechtigung stammt aus `allow(transferred, beneficiary)` des Treuhand-Vertrags in Schritt 3.
Ergebnis 1,0 cUSDTMock.

Bei Zama, für jede Entschlüsselung: Der Relayer sendet `userDecryptionRequest` an den
`Decryption`-Vertrag des Gateways, der Signatur und Gültigkeit des Permits prüft; der Connector jedes
KMS-Knotens prüft `ACL.isAllowed(handle, user)` und `ACL.isAllowed(handle, escrow)` auf Sepolia und
antwortet mit seinem Anteil; der Relayer gibt die gesammelten Anteile zurück, sobald mindestens der
Schwellenwert von 9 eingetroffen ist.

Etherscan: nichts. Weder die Permits noch die Transport-Schlüssel erscheinen auf Sepolia. Die Anfrage
und die Anteile sind Events auf der Gateway-Chain.

### Schritt 5: Unterdeckung, einfach

Das Skript versucht nun, weit mehr zu sperren, als der Ersteller besitzt. Die Sperre geht trotzdem
durch und sieht auf der Chain gleich aus. Erst ihre Entschlüsselung würde zeigen, dass sie 0 enthält.

### Schritt 5: Unterdeckung, technisch

**2^64 - 1 verschlüsseln (4,5 s).** Dieselbe SDK-Instanz, diesmal also kein Start. Input-Handle
`0x453fa283db9c476debfa341aca977dac7c05f14023000000000000aa36a70500`, Proof 230 Bytes.

**Sperren.** Block 11717345, 657.529 Gas, 20 Events, ein zweiter `todoRef`, der mit `0x7dd61fc8`
beginnt, Frist 1789655520 (2026-09-17T14:32:00Z). Der Token berechnete `FheGe(0xb3cebb…, 0x453f…)`
(das Guthaben des Erstellers gegen 2^64 - 1, unter Verschlüsselung falsch), `FheSub`, `FheIfThenElse`
(Guthaben des Erstellers, neues Handle `0xda46e6…`, gleicher Wert), `TrivialEncrypt(0)`,
`FheIfThenElse` (`transferred` = `0xc05db6de11bd957b0b95e45ceedfe4c91040dbdfb8ff0000000000aa36a70500`),
`FheAdd` (Treuhand-Guthaben `0x258ba0…` + `transferred` = `0xd9a07c…`), dann dieselben Events
`Allowed`, `ConfidentialTransfer` und `Locked` wie in Schritt 3. Die Sperre hat ein Event weniger als
Schritt 3, weil das Guthaben des Treuhand-Vertrags schon existierte und kein `TrivialEncrypt(0)`
brauchte.

**`escrowOf`** zeigt `Locked` mit Betrag `0xc05db6…`. Hier endet der Auszug der Ausgabe. Der nächste
Schritt des Skripts entschlüsselt diesen Betrag und erwartet 0; dieses Ergebnis enthält der Auszug
nicht.

Etherscan zeigt dieselbe Art von Transaktion wie in Schritt 3, mit anderen Handles. Die Calldata
enthält nicht 2^64 - 1, und nichts zeigt, dass der Transfer 0 bewegt hat.

### Schritt 6: Freigabe, einfach

Der Ersteller zahlt die erste Sperre aus. Das vertrauliche Guthaben des Begünstigten steigt um den
gesperrten Betrag, und die Chain zeigt, dass eine Zahlung an den Begünstigten stattfand, nicht deren
Höhe.

### Schritt 6: Freigabe, technisch

`release(0x8d778cd7…)`, Calldata 36 Bytes, Block 11717348, 412.902 Gas, 16 Events, auf zwei
Bestätigungen gewartet. Der Treuhand-Vertrag setzt den Status `Released`, gewährt dem Token eine
transiente Berechtigung auf `0x506d80…` (kein Event) und ruft
`confidentialTransfer(beneficiary, 0x506d80…)` auf:

1. `FheGe(escrow balance 0xd9a07c…, 0x506d80…)`, `FheSub`, `FheIfThenElse`: neues Guthaben des
   Treuhand-Vertrags `0xe9321c…`, zwei `Allowed`;
2. `TrivialEncrypt(0)`, `FheIfThenElse`: `transferred` = `0xcdf4440d…5cff0000000000aa36a70500`;
3. `TrivialEncrypt(0)`, `FheAdd`: das erste Guthaben des Begünstigten,
   `0x00089ea45ceb93ca7589e2b385cc604977e31e81e0ff0000000000aa36a70500`;
4. fünf `Allowed`, `ConfidentialTransfer(escrow, beneficiary, 0xcdf4440d…)` und
   `Released(creator, todoRef, beneficiary)` des Treuhand-Vertrags.

Danach von der Chain zurückgelesen: `escrowOf(creator, 0x8d778cd7…)` liefert Status `Released`, und
`confidentialBalanceOf(beneficiary)` liefert das von null verschiedene Handle `0x00089ea4…`. Die
Entschlüsselung dieses Guthabens durch das Skript (erwartet 1,0) ist nicht im Auszug.

Etherscan zeigt "Call Release Function", den `todoRef`, den Transfer vom Treuhand-Vertrag an den
Begünstigten als `ConfidentialTransfer` mit einem Handle sowie `Released`. Den Betrag zeigt es nicht.
Das übertragene Handle `0xcdf4440d…` unterscheidet sich vom gespeicherten Betrags-Handle `0x506d80…`,
obwohl beide denselben Wert verschlüsseln.

### Schritt 7: Rückzahlung, einfach

Geld nach Ablauf der Frist zurückzuholen wird nur auf Anforderung getestet. Dieser Lauf hat das nicht
getan.

### Schritt 7: Rückzahlung, technisch

Nur mit `SMOKE_REFUND=1`: mit einer Frist von 90 s sperren, die Sperre und das Guthaben des Erstellers
entschlüsseln, auf einen Block nach Ablauf der Frist warten, `refund`, `Refunded` prüfen und prüfen,
dass das Guthaben um den Betrag gestiegen ist. Der Lauf vom 2026-09-16 hatte keine Rückzahlung: Die
Nonce des Erstellers blieb nach der Freigabe bei 12, und der Treuhand-Vertrag hat kein
`Refunded`-Event emittiert.

## Kosten

Die sieben Transaktionen verbrauchten 2.269.800 Gas zu effektiven Preisen zwischen 1,006 und
1,115 gwei und kosteten 0,002420484746174163 ETH. Das Guthaben des Erstellers ging von
2,247756121521986396 ETH (Block 11717332) auf 2,245335636775812233 ETH (Block 11717348) zurück,
genau um diese Differenz. Gemessenes Gas pro Transaktion: Prägen 51.760, Genehmigen 46.600,
Verpacken 367.250, `setOperator` 51.129, Sperren 682.630, ungedeckte Sperre 657.529, Freigabe 412.902.

Was der Lauf auf Sepolia hinterlässt: 1,0 cUSDTMock im Guthaben eines Begünstigten, dessen Schlüssel
nicht mehr existiert, und eine ungedeckte Treuhand, die unter dem zweiten `todoRef` auf `Locked`
bleibt.

## Quellen

Repository (Branch `escrow01`):

- [`contracts/scripts/smoke-sepolia.ts`](../contracts/scripts/smoke-sepolia.ts): Konstanten 61-102,
  Relayer-Wiederholungen 280-316, `transact` 319-350, SDK-Einrichtung 473-493, `encrypt` 504-512,
  `userDecrypt` 515-526, `decryptBalance` 528-532, `expectEscrow` 536-553, `lock` 573-601, `fund`
  604-659, `dryRun` 663-757, `findPublishedAmount` 760-796, `fullRun` 798-1011, `main` 1053-1155.
- [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol) 100-190.
- [`contracts/README.md`](../contracts/README.md), "Smoke test".

Chain, gelesen am 2026-09-16 über `https://ethereum-sepolia-rpc.publicnode.com` (Transaktionen,
Receipts, Logs, `escrowOf`, `confidentialBalanceOf`, `persistAllowed`, Guthaben, Nonces) und die
Transaktionsseiten von Etherscan:

- <https://sepolia.etherscan.io/tx/0xe9e177db627ff3d769af661b5724ac2777d57883803e1c7bcd3a1a2af2b1288c>
- <https://sepolia.etherscan.io/tx/0x416309800691580524f8d9a2bbe2130c31651e1939a1cb258b0f520c1ac15d79>
- <https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de>
- <https://sepolia.etherscan.io/tx/0x79a1a622a864129daa23d887d9c56fee578066222065dab6514c5cbe830c4b51>
- <https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065>
- <https://sepolia.etherscan.io/tx/0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6>
- <https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c>

Quellen zu Verträgen und SDK: siehe die Quellen von [escrow.de.md](escrow.de.md) und
[zama-confidential-transactions.de.md](zama-confidential-transactions.de.md). Die zum Dekodieren
verwendeten Event-Signaturen sind die aus `host-contracts/contracts/FHEEvents.sol` und `ACLEvents.sol`
in zama-ai/fhevm, Tag v0.13.5, und die der verifizierten Implementierung von cUSDTMock auf Sourcify.

Terminal-Ausgabe des vollständigen Laufs vom 2026-09-16 (Auszug, bereitgestellt von der Person, die den Lauf ausgeführt hat) und
eines Probelaufs gegen 14:55 UTC am selben Tag.
