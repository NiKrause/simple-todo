# Sicherheit der vertraulichen Treuhand

Für Sicherheits- und Kryptographie-Gutachter des Kapitels `escrow01`. Das Dokument legt dar, was die
Treuhand schützt, was sie offenlegt, wem sie vertraut und was nicht gelöst ist. Die Fakten haben den
Stand 2026-09-16 und sind am Ende belegt; Punkte, die sich nicht verifizieren ließen, sind als solche
gekennzeichnet. Die Mechanik beschreiben [escrow.de.md](escrow.de.md) und
[zama-confidential-transactions.de.md](zama-confidential-transactions.de.md); der nachverfolgte Lauf
steht in [smoke-test.de.md](smoke-test.de.md).

Status: eine Demonstration im Testnetz. `ConfidentialTodoEscrow` ist auf Sepolia deployt und
verifiziert und wurde nicht auditiert. Die Budget-Ansichten der App laufen gegen eine Attrappe im
Arbeitsspeicher, die nichts verschlüsselt. Die unten beschriebene Passkey-Wallet ist nicht integriert.

- [Bedrohungsmodell](#bedrohungsmodell-einfach)
- [Was sichtbar wird](#was-sichtbar-wird-einfach)
- [Vertrauensannahmen](#vertrauen-einfach)
- [Der Token: cUSDTMock](#token-einfach)
- [Die Prüfstelle](#prüfstelle-einfach)
- [Input-Proofs und Wiederverwendung](#wiederverwendung-einfach)
- [Eigenschaften der Treuhand selbst](#eigenschaften-der-treuhand-einfach)
- [Grenzen](#grenzen-einfach)
- [Passkey-Wallet (geplant, nicht integriert)](#passkey-wallet)
- [Offene Punkte](#offene-punkte)

## Bedrohungsmodell

### Bedrohungsmodell: einfach

Die Treuhand soll eine Sache geheim halten: wie viel Geld gesperrt und ausgezahlt wird. Sie soll nicht
verbergen, wer wem zahlt oder wann. Sie verlässt sich darauf, dass Zamas Schlüsselverwalter den
Entschlüsselungsschlüssel aufgeteilt halten und dass Zamas Dienste verfügbar sind.

### Bedrohungsmodell: technisch

Schutzgüter:

1. Vertraulichkeit der Beträge: gesperrte Beträge, die Token-Guthaben der Treuhand und der Beteiligten.
2. Integrität der Mittel: Nur der Ersteller gibt frei oder zahlt zurück; eine Freigabe zahlt dem
   Begünstigten den tatsächlich gesperrten Betrag aus; nichts anderes bewegt einen gesperrten Betrag.
3. Verfügbarkeit: Ein Ersteller kann freigeben oder zurückzahlen, und berechtigte Beteiligte können
   Beträge lesen.
4. Schutz der Metadaten: ausdrücklich außerhalb des Umfangs, siehe
   [Was sichtbar wird](#was-sichtbar-wird-technisch).

Angreifer und was sie können:

| Angreifer | Kann | Kann nicht |
| --- | --- | --- |
| Beobachter der Chain | jede Transaktion, alle Calldata, jedes Event und jeden Storage-Slot auf Sepolia sowie die Events der Gateway-Chain lesen | ein Handle entschlüsseln; eine vollständige Sperre von einer ungedeckten unterscheiden |
| Front-Runner | einen ausstehenden `lock`-Aufruf kopieren (`todoRef`, Handle, Proof) | den Proof für ein anderes Konto oder einen anderen Vertrag verwenden; die `todoRef` des Erstellers belegen (Treuhand-Vorgänge sind pro Ersteller indiziert) |
| Leser der OrbitDB-Liste | Todo-Text, DID des Delegierten und `budget` (`todoRef`, Transaktions-Hashes, Status) lesen | Beträge lesen; sie stehen nicht in OrbitDB |
| Begünstigter | den gesperrten Betrag und das eigene Guthaben lesen; vor Arbeitsbeginn prüfen, dass die Sperre nicht leer ist | eine Freigabe erzwingen |
| Ersteller | eine Freigabe zurückhalten und nach der Frist zurückzahlen | an jemand anderen als den eingetragenen Begünstigten freigeben; vor der Frist Mittel entnehmen, ohne freizugeben |
| Prüfstelle | jeden jemals in dieser Treuhand gesperrten Betrag lesen | Mittel bewegen |
| Owner (Eigentümer) des Tokens (Protocol DAO) | ein Upgrade von cUSDTMock durchführen, Observer hinzufügen, die entschlüsseln können, Adressen blockieren, einen Pauser ernennen | durch Code ist nichts ausgeschlossen; siehe [Der Token](#token-technisch) |
| Zama-Betreiber | siehe Abschnitt [Vertrauensannahmen](#vertrauen-technisch) | |
| Kompromittierter Browser oder Schlüssel | alles lesen, was dieser Schlüssel entschlüsseln darf; als dieses Konto signieren | Beträge lesen, für die er keine ACL-Berechtigung hat |

## Was sichtbar wird

### Was sichtbar wird: einfach

Alle können sehen, wer für wen Geld gesperrt hat, wann, bis wann, welche Treuhand-Referenz verwendet
wurde und wann es ausgezahlt wurde. Alle können sehen, wie viel zwischen USDT und vertraulichem USDT
umgewandelt wurde. Niemand kann sehen, wie viel gesperrt oder ausgezahlt wurde. Zamas Systeme
erfassen außerdem, wer die Entschlüsselung welches Werts angefordert hat, und wann.

### Was sichtbar wird: technisch

Öffentlich auf Sepolia (alles in den Transaktionen des Smoke-Test-Laufs bestätigt):

| Offenlegung | Wo |
| --- | --- |
| Absender (Ersteller) | `from` der Transaktion; Topic 1 von `Locked` |
| Empfänger (Begünstigter) | Calldata von `lock`; Topic 3 von `Locked`; ACL-Event `Allowed`; später Topic 2 von `ConfidentialTransfer` |
| Adresse der Prüfstelle | `auditor()`; ein ACL-Event `Allowed` in jeder Sperre |
| Zeitpunkt | Block-Zeitstempel von `setOperator`, `lock`, `release`, `refund` |
| Funktion | Methodenselektor (Etherscan: "Lock", "Release") |
| `todoRef` | Calldata; Topic 2 von `Locked`, `Released`, `Refunded` |
| Frist | Calldata; Datenteil von `Locked` |
| Operator-Zeitfenster | Calldata von `setOperator` und Event `OperatorSet` |
| Gas und Gebühr | Receipt |
| Identität der Handles | Calldata, FHEVMExecutor-Events, `ConfidentialTransfer`, `Allowed`, `escrowOf`, `confidentialBalanceOf` |
| Berechnungsgraph | jede FHE-Operation mit ihren Operanden- und Ergebnis-Handles in FHEVMExecutor-Events |
| Input-Proof | Calldata; Event `VerifyInput` |
| Beträge beim Verpacken und Entpacken | Calldata von `wrap`, ERC-20 `Transfer`, `TrivialEncrypt(pt)`, `Wrap(roundedAmount)`; Calldata von `finalizeUnwrap` und `UnwrapFinalized` |
| Anzahl der Treuhand-Vorgänge und Freigaben pro Ersteller | Anzahl der Events `Locked` und `Released` |

Was die Identität der Handles verrät: Gleiche Handles bezeichnen gleiche Werte. Ein berechnetes Handle
ist ein Hash öffentlicher Daten, und die Executor-Events zeigen, welche Handles in welche Operation
eingehen. Die Wiederverwendung eines Handles, etwa das erneute Sperren des Betrags eines früheren
Treuhand-Vorgangs mit leerem Proof, zeigt öffentlich, dass beide Operationen vom selben verschlüsselten
Wert ausgingen. Triviale Verschlüsselungen veröffentlichen ihren Klarwert konstruktionsbedingt
(`TrivialEncrypt(pt)`).

Korrelation: Ein Verpacken von X kurz vor einer Sperre durch dieselbe Adresse legt einen gesperrten
Betrag von höchstens X nahe. Ein Entpacken durch einen Begünstigten kurz nach einer Freigabe legt den
freigegebenen Betrag nahe.

Außerhalb von Sepolia:

- **Gateway-Chain.** Jede Nutzer-Entschlüsselung ist eine Gateway-Transaktion des Relayers, die
  `UserDecryptionRequest(decryptionId, ciphertext materials including the handles, userAddress,
  publicKey, extraData)` emittiert, gefolgt von einem `UserDecryptionResponse` pro KMS-Anteil. Wer
  welches Handle zu lesen angefragt hat, und wann, ist daher auf der Gateway-Chain öffentlich; die
  Anteile selbst sind für den ML-KEM-512-Schlüssel des Anfragenden verschlüsselt. Ergebnisse
  öffentlicher Entschlüsselungen werden dort im Klartext veröffentlicht.
- **Relayer.** Sieht jede Anfrage mit Adressen, Handles und öffentlichen Transportschlüsseln sowie die
  IP-Adresse des Clients.
- **OrbitDB.** Die geteilte Liste ist unverschlüsselt: Wer ihre Adresse hat, liest Todo-Text, DID des
  Delegierten, `todoRef` und Status und kann so ein Todo mit seinem Treuhand-Vorgang on-chain verknüpfen.

Nicht öffentlich: Beträge innerhalb des Tokens (gesperrt, freigegeben, zurückgezahlt, Guthaben) und ob
ein Transfer den angeforderten Betrag oder 0 bewegt hat.

## Vertrauensannahmen

### Vertrauen: einfach

Die Geheimhaltung der Beträge hängt davon ab, dass Zamas Schlüsselverwalter sich nicht absprechen. Ob
sich Beträge überhaupt lesen lassen, hängt davon ab, dass Zamas Relayer, Gateway und Schlüsselverwalter
online sind. Die Regeln des gesamten Systems können von Zamas Protokoll-Governance geändert werden.

### Vertrauen: technisch

| Partei | Konfiguration am 2026-09-16 | Wofür vertraut wird | Fehlerfall |
| --- | --- | --- | --- |
| KMS-Betreiber | 13 Signierer; Schwellenwerte in ProtocolConfig: Nutzer-Entschlüsselung 9, öffentliche Entschlüsselung 7, Schlüsselerzeugung 7, MPC 4 (Sepolia und Mainnet). Zamas Dokumentation: Knoten laufen standardmäßig in AWS Nitro Enclaves, Protokoll robust bei höchstens einem Drittel bösartiger Knoten. | Vertraulichkeit jedes Chiffrats unter dem globalen Schlüssel; korrekte Entschlüsselungsergebnisse | zusammenwirkende Betreiber oberhalb des Absprache-Schwellenwerts entschlüsseln alles (die Zahl nennen die zitierten Quellen nicht; siehe [zama-confidential-transactions.de.md](zama-confidential-transactions.de.md#vertrauen-technisch)); sind zu wenige Betreiber online, stoppt jede Entschlüsselung |
| Coprozessoren | Input-Attestierungen: 3 von 5 Signierern auf Sepolia, 1 von 1 im Ethereum-Mainnet | nur wohlgeformte Inputs akzeptieren; korrekte FHE-Berechnung; Chiffrate speichern | laut Zamas Dokumentation sind Ergebnisse gültig, solange mehr als die Hälfte ehrlich ist; im Mainnet attestiert ein einziger Signierschlüssel jeden verschlüsselten Input |
| Gateway | Arbitrum-Rollup, Chain-ID 10901 (Testnetz) | Anfragen ordnen und weiterleiten, den KMS-Kontext festschreiben | Stillstand: keine Input-Attestierung, keine Entschlüsselung |
| Relayer | `relayer.testnet.zama.org`, kein Schlüssel; der gehostete Mainnet-Relayer verlangt einen API-Schlüssel; Self-Hosting ist dokumentiert | Verfügbarkeit | ausgefallen: Das SDK kann über ihn weder verschlüsseln noch entschlüsseln; der Zustand on-chain bleibt unberührt |
| Protocol DAO (Owner der ACL und über sie aller Host-Verträge) | Sepolia `0x08e8a84c3c8c7cba165B1adcf67Ae4639eF84f52`, Mainnet `0xB6D69D5F334d8B97B194617B53c6aB62f8681Ef3` | die Regeln nicht ändern | kann Upgrades von ACL, Executor und Verifiern durchführen, Signierer-Sets und Schwellenwerte von Coprozessoren und KMS, HCU-Limits und die Blockliste ändern |
| Mitglieder von PauserSet | on-chain nicht aufzählbar | nicht pausieren | eine pausierte ACL weist `allow` und `allowTransient` zurück, sodass jede FHE-Operation revertiert; nur der Owner hebt die Pause auf |
| Client-Code | `@zama-fhe/sdk` 3.6.0, `@fhevm/sdk` 0.13.2, WASM von npm | ehrliche Schlüsselerzeugung, Proofs und Rekonstruktion | eine kompromittierte Seite liest entschlüsselte Werte und den privaten Transportschlüssel |

Kein Service Level Agreement für den Relayer, das Gateway oder das KMS von Sepolia wird in der hier
zitierten Dokumentation erwähnt. Die Vorfälle vom 2026-08-31 bis 2026-09-01 und vom 2026-09-03 ließen
die Nutzer-Entschlüsselung auf Sepolia fehlschlagen, während die Chain korrekt war (siehe
[zama-confidential-transactions.de.md](zama-confidential-transactions.de.md#vorfälle-technisch)).

## Der Token: cUSDTMock

### Token: einfach

Die Treuhand hält Zamas Test-Dollar-Token. Sein Owner, Zamas Protokoll-Governance, kann den Code des
Tokens ersetzen, Observer benennen, die alle Beträge im Token lesen dürfen, Adressen blockieren und
jemanden ernennen, der ihn pausieren darf. Am 2026-09-16 gab es keine Observer, und niemand konnte ihn
pausieren.

### Token: technisch

cUSDTMock `0x4E7B06D78965594eB5EF5414c357ca21E1554491` ist ein ERC-1967-Proxy auf `ConfidentialWrapper`
`0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04` (exakte Übereinstimmung auf Sourcify). Owner:
`0x08e8a84c3c8c7cba165B1adcf67Ae4639eF84f52`, die Protocol DAO. Relevante Befugnisse im verifizierten
Quellcode:

- **Upgrade.** UUPS; `_authorizeUpgrade` ist `onlyOwner`. Die Mittel der Treuhand hängen davon ab,
  dass die Implementierung ein korrektes ERC-7984 bleibt. `renounceOwnership` ist deaktiviert.
- **Observer.** `addObserver(observer)` ist `onlyOwner` und ruft
  `FHE.delegateUserDecryptionWithoutExpiration(observer, WILDCARD_CONTRACT)` auf: Der Token delegiert
  seine eigenen Rechte zur Nutzer-Entschlüsselung an den Observer, für jeden Vertrag, ohne
  Ablaufzeitpunkt. Die ACL gewährt eine delegierte Entschlüsselung eines Handles, wenn der Delegierende
  (der Token) und der benannte Vertrag beide dauerhaft für das Handle berechtigt sind. Der Token behält
  eine dauerhafte Berechtigung für jeden Betrag, den er zurückgibt, und die Treuhand berechtigt sich
  selbst für das, was sie speichert; am 2026-09-16 waren `persistAllowed(amount, cUSDTMock)` und
  `persistAllowed(amount, escrow)` für den ersten gesperrten Betrag beide true. Ein Observer kann daher
  jeden Betrag entschlüsseln, den diese Treuhand speichert, ebenso jedes Guthaben und jeden Transfer im
  Token, was Zamas Wrapper-Dokumentation für Guthaben, Gesamtmenge und Transfers angibt. Observer sind
  öffentlich (`observers()`, Event `ObserverAdded`); `observers()` lieferte am 2026-09-16 eine leere
  Liste.
- **Blockliste.** `blockUser` ist `onlyOwner`; `_update` des Tokens prüft Absender, Empfänger und
  Operator. Ein blockierter Ersteller oder Begünstigter lässt `lock`, `release` und `refund`
  revertieren, solange die Blockierung besteht. `isBlocked` war während des Laufs für die Treuhand,
  den Ersteller und den Begünstigten false.
- **Pause.** `pause()` darf nur von `pauser()` aufgerufen werden, den der Owner festlegt; `pauser()`
  lieferte am 2026-09-16 `address(0)`, also konnte niemand pausieren. Während der Pause revertiert
  jeder Transfer und damit jede Sperre, Freigabe und Rückzahlung.
- **Offenlegung durch einen Beteiligten.** `requestDiscloseEncryptedAmount(handle)` erlaubt jedem
  Konto, das für ein Handle berechtigt ist, es über den Token, der ebenfalls berechtigt ist, öffentlich
  entschlüsselbar zu machen. Der Ersteller, der Begünstigte und die Prüfstelle können auf diese Weise
  jeweils einen gesperrten Betrag veröffentlichen; ein Observer kann es nicht, weil eine Delegation
  keine ACL-Berechtigung ist.

## Die Prüfstelle

### Prüfstelle: einfach

Die Treuhand benennt eine Prüfstelle für immer. Die Prüfstelle kann jeden Betrag lesen, der jemals
darin gesperrt wurde. Derzeit ist die Prüfstelle das eigene Testkonto des Entwicklers, dessen
Schlüssel unverschlüsselt in einer Konfigurationsdatei auf einem Entwicklungsrechner liegt.

### Prüfstelle: technisch

- `auditor` ist `immutable`, wird im Konstruktor gesetzt und ist ungleich null. Jedes `lock` ruft
  `FHE.allow(transferred, auditor)` auf. Die ACL hat keine Funktion, die eine dauerhafte Berechtigung
  entfernt, daher kann die Prüfstelle jeden in diesem Deployment gesperrten Betrag entschlüsseln,
  solange die Chiffrate existieren.
- Eine Rotation ist unmöglich. Eine neue Prüfstelle bedeutet eine neue Treuhand. Treuhand-Vorgänge im
  alten Vertrag bleiben dort, und die alte Prüfstelle liest ihre Beträge weiterhin.
- Die Prüfstelle im Deployment ist `0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621`, der Deployer, der
  zugleich der Ersteller des Smoke-Tests ist. Dessen privater Schlüssel ist der `DEPLOYER_PRIVATE_KEY`
  des Sepolia-Runbooks, abgelegt in `contracts/.env`: eine Klartextdatei, die von git ignoriert wird.
  Wer diese Datei erlangt, kann jeden gesperrten Betrag entschlüsseln, als Ersteller des Smoke-Tests
  sperren und freigeben und dessen Sepolia-ETH ausgeben.
- Die Prüfstelle ist für alle sichtbar: `auditor()` und das Event `Allowed` in jeder Sperre.
- Delegiertes Lesen für einen Prüfstellen-Dienst würde `ACL.delegateForUserDecryption` verwenden, das
  selbst öffentlich ist und die Prüfstelle mit ihrem Delegierten verknüpft.

## Input-Proofs und Wiederverwendung

### Wiederverwendung: einfach

Ein verschlüsselter Betrag wird nur von der Person angenommen, für die er erstellt wurde, und nur über
den Vertrag, für den er erstellt wurde. Ihn aus einer ausstehenden Transaktion zu kopieren, hilft
niemand anderem.

### Wiederverwendung: technisch

- Die Coprozessoren signieren `CiphertextVerification(bytes32[] ctHandles, address userAddress, address
  contractAddress, uint256 contractChainId, bytes extraData)`. On-chain setzt FHEVMExecutor
  `contractAddress` auf seinen Aufrufer und übernimmt `userAddress` vom aufrufenden Vertrag; das ist
  der `msg.sender` der Treuhand. InputVerifier ermittelt die Signierer per ECDSA-Recovery und verlangt
  den Schwellenwert (3 von 5 auf Sepolia, 1 von 1 im Mainnet). Ein Proof, der von einem anderen Konto
  oder über einen anderen Vertrag verwendet wird, ergibt bei der Recovery einen Nicht-Signierer:
  `InvalidSigner`. Der clientseitige ZK-Proof ist über seine Metadaten zusätzlich an Vertrag, Nutzer,
  ACL und Chain-ID gebunden.
- Tests: "rejects an encrypted amount made for someone else" (ein anderes Konto verwendet den Input
  des Erstellers erneut) und "verifies the encrypted amount itself instead of forwarding it to the token"
  (Weiterleiten schlägt fehl; wird stattdessen für (Token, Treuhand) verschlüsselt, entsteht ein Proof,
  den jeder erneut verwenden kann).
- Es gibt keine Nonce. Derselbe Nutzer kann denselben Proof in einer späteren Transaktion über
  denselben Vertrag erneut einreichen und erhält dasselbe Handle: eine zweite Sperre desselben
  verschlüsselten Betrags. Das ist für die Mittel unschädlich, verknüpft die beiden Sperren aber
  öffentlich.
- Innerhalb einer Transaktion wird ein verifizierter Proof im transienten Speicher unter (Vertrag,
  Nutzer, Proof) zwischengespeichert. Transiente ACL-Berechtigungen gelten ebenfalls bis zum Ende der
  Transaktion; in einem Bündel von User Operations überdauern sie von einer Operation zur nächsten, es
  sei denn, jemand ruft `cleanTransientStorage()` auf, was jeder darf. Sie bleiben an das Konto
  gebunden, dem sie gewährt wurden.
- Mit leerem Proof nimmt die Treuhand ein bestehendes Handle nur an, wenn `ACL.isAllowed(handle,
  msg.sender)` gilt; Test "takes an existing handle without a proof only from someone who may use it".

## Eigenschaften der Treuhand selbst

### Eigenschaften der Treuhand: einfach

Nur die Person, die das Geld gesperrt hat, kann es auszahlen oder zurücknehmen, und das Zurücknehmen
funktioniert erst nach der Frist. Jeder Treuhand-Vorgang kann einmal abgeschlossen werden. Die Treuhand
hat keinen Owner, der diese Regeln ändern könnte.

### Eigenschaften der Treuhand: technisch

Aus dem Quelltext des Vertrags und seinen 16 Hardhat-Tests in `contracts/test/ConfidentialTodoEscrow.ts`
(FHEVM-Mock):

- `release` und `refund` schlagen `_escrows[msg.sender][todoRef]` nach: konstruktionsbedingt nur für
  den Ersteller.
- `refund` verlangt `block.timestamp > deadline`; `lock` begrenzt die Frist auf 365 Tage.
- Einmalig: Eine zweite Freigabe, eine Freigabe nach einer Rückzahlung, eine Rückzahlung nach einer
  Freigabe und eine zweite Sperre unter derselben `todoRef` revertieren allesamt.
- Der Zustand wird geschrieben, bevor der Token aufgerufen wird (`lock`, `release`, `refund`).
- Events enthalten keine Beträge und keine Handles.
- Der Konstruktor lehnt einen Token ohne ERC-7984 in ERC-165 und eine Prüfstelle mit Nulladresse ab.
- Kein Owner, kein Upgrade, keine Gebühr, keine Funktion außer `release` und `refund`, die Mittel
  bewegt.

Beabsichtigt, kein Versehen:

- Der Begünstigte hat keinen On-Chain-Anspruch. Ein Ersteller kann eine Freigabe zurückhalten und nach
  der Frist zurückzahlen; die Treuhand schützt die Mittel des Erstellers, nicht die Arbeit des
  Begünstigten.
- Eine ungedeckte Sperre gelingt mit einer verschlüsselten 0. Der Begünstigte sollte den
  gesperrten Betrag vor Arbeitsbeginn entschlüsseln; die App soll ihn nach jeder Sperre entschlüsseln.
- Die Operator-Genehmigung (`setOperator`) hat keinen Betrag, nur einen Ablaufzeitpunkt. Die Treuhand
  zieht nur von ihrem eigenen Aufrufer ein, daher kann niemand sonst die Genehmigung über die Treuhand
  nutzen, sie sollte aber bald ablaufen.

## Grenzen

### Grenzen: einfach

Das läuft in einem Testnetz mit Testgeld und Testinfrastruktur, auf einer Protokollversion, die
demnächst abgelöst wird. Es ist eine Demonstration, kein Produkt.

### Grenzen: technisch

- **Protokoll v0.14.** Veröffentlicht am 2026-08-14, am 2026-09-16 weder auf Sepolia noch im Mainnet
  deployt. Es ändert die Nutzer-Entschlüsselung (vereinheitlichte Permits, `durationSeconds`,
  ERC-1271-Konten) und die Versionen der Host-Verträge. Die Treuhand ist mit `@fhevm/solidity` 0.11.1
  gegen Host-Verträge v0.13 kompiliert; ein Wechsel auf v0.14 erfordert eine Kompatibilitätsprüfung
  und kann ein neues Deployment nötig machen, was auch eine neue Entscheidung über die Prüfstelle und
  neue Treuhand-Vorgänge bedeuten würde
  ([Checkliste für ein erneutes Deployment](../contracts/README.md#redeploy-checklist)).
- **Zuverlässigkeit von Sepolia.** Zwei Entschlüsselungsvorfälle Anfang September 2026. Der Smoke-Test
  wiederholt Relayer-Aufrufe und wartet vor dem Entschlüsseln zwei Bestätigungen ab; einen Ausfall
  kann er nicht beheben.
- **Kein SLA** ist in den zitierten Quellen für die Testnetz-Dienste dokumentiert.
- **Test-Assets.** USDTMock kann von jedem gemintet werden (bis zu 1.000.000 Token pro Aufruf). Nichts
  hier hat einen Geldwert.
- **Das Mainnet unterscheidet sich.** Der InputVerifier des Mainnets hat einen einzigen
  Coprozessor-Signierer; der gehostete Relayer braucht einen API-Schlüssel und berechnet Gebühren;
  cUSDT im Mainnet ist ein anderer Vertrag. Nichts in diesem Kapitel wurde im Mainnet ausgeführt.
- **Mock gegenüber Sepolia.** Der Hardhat-Mock verwendet Host-Verträge 0.10.0: Eine Delegation muss
  mindestens eine Stunde in der Zukunft ablaufen und kann die Wildcard nicht verwenden, und HCU-Limits
  vergleichen mit `>=`, wo HCULimit auf Sepolia `>` verwendet.
- **Die App** spricht noch nicht mit der Chain, hat keine Rückzahlung und keine Zuordnung von einer
  DID zu einem Konto.

## Passkey-Wallet

Nicht integriert. [`src/lib/budget-service.js`](../src/lib/budget-service.js) beschreibt die geplante
Implementierung: Zamas Token und die Treuhand, signiert über ein Calibur-Konto, das der Passkey
kontrolliert. Die folgenden Fakten betreffen Calibur v1.0.0 (Uniswap, Tag `v1.0.0`) und Zama v0.13,
nicht Code in diesem Repository.

### Passkey-Wallet: einfach

Der Plan ist, dass ein Passkey auf dem Gerät das Konto kontrolliert, das das Geld hält. Zwei
Eigenschaften des gewählten Kontovertrags sind von Bedeutung: Der gewöhnliche Schlüssel, der das Konto
erstellt hat, bleibt für immer ein allmächtiger Generalschlüssel, und die Chain prüft nicht, ob die
Person tatsächlich mit Fingerabdruck oder Gesicht bestätigt hat. Zum Lesen von Beträgen wird außerdem
ein zusätzlicher, temporärer Schlüssel nötig sein, weil Zamas aktuelle Version keine Signaturen
solcher Konten annehmen kann.

### Passkey-Wallet: technisch

- **Der EOA-Setup-Schlüssel ist für immer Root.** Calibur ist ein Delegationsziel nach EIP-7702. Sein
  Root-Key ist der eigene secp256k1-Schlüssel des Kontos (`KeyLib.isRootKey`: ein
  `Secp256k1`-Schlüssel, dessen Adresse das Konto selbst ist, Schlüssel-Hash `bytes32(0)`). `register`
  und `update` weisen den Root-Key zurück, `revoke` kann ihn nicht entfernen, weil er nie in der
  Schlüsselmenge liegt, und `_isOwnerOrValidKey` akzeptiert ihn immer. `isValidSignature` akzeptiert
  von ihm jede rohe, 64 oder 65 Byte lange ECDSA-Signatur. Unabhängig von Calibur kann dieser
  Schlüssel unter EIP-7702 weiterhin Transaktionen senden und neue Delegationszuweisungen signieren.
  Das Löschen des Setup-Schlüssels nach dem Onboarding ist der einzige Schutz, und es lässt sich
  on-chain nicht nachweisen.
- **Nutzerverifikation (UV) wird on-chain nicht erzwungen.** `KeyLib.verify` prüft
  `WebAuthnP256`-Schlüssel mit `WebAuthn.verify({ ..., requireUV: false, ... })`. Ob der Authenticator
  den Nutzer verifiziert hat (PIN, Biometrie), erzwingt nur der Client-Code, der die Assertion
  anfordert.
- **Andere Schlüssel als der Root-Key signieren ERC-1271-Nachrichten nur in ERC-7739-Form.** Caliburs
  `isValidSignature` leitet rohe Signaturen an den Root-Key weiter und erwartet für jeden anderen
  Schlüssel den ERC-7739-Ablauf TypedDataSign oder NestedPersonalSign.
- **Zama v0.13 akzeptiert nur ECDSA-Permits.** `@fhevm/sdk` 0.13.2 verlangt 65 Byte lange Signaturen
  und vergleicht die per Recovery ermittelte Adresse; der `Decryption`-Vertrag des Gateways revertiert
  mit `InvalidUserSignature`, es sei denn, der ECDSA-Signierer ist der Nutzer. Ein Passkey-Konto kann
  kein Entschlüsselungs-Permit signieren. Der geplante Workaround ist ein secp256k1-Sitzungsschlüssel,
  den das Konto mit `ACL.delegateForUserDecryption(sessionKey, contract, expiry)` autorisiert, einmal
  pro Vertrag (Token und Treuhand). Das Event `DelegatedForUserDecryption` macht die Verknüpfung
  zwischen Konto und Sitzungsschlüssel öffentlich, und der Sitzungsschlüssel kann bis zum Ablauf oder
  zu einem Widerruf alles lesen, was das Konto in diesen Verträgen lesen darf.
- **v0.14** ergänzt eine ERC-1271-Verifikation im KMS-Connector (`ecrecover`, danach ein
  gasbegrenzter Aufruf von `isValidSignature`). Ob eine Calibur-Passkey-Signatur in ERC-7739-Form
  diese Prüfung besteht, wurde nicht verifiziert.

## Offene Punkte

1. Prüfstelle: Die Prüfstelle im Deployment ist ein Entwicklungsschlüssel in einer Klartextdatei. Die
   echte Prüfstelle und die Verwahrung ihres Schlüssels sind zu wählen, bevor man sich auf ein
   Deployment verlässt; eine Änderung erfordert eine neue Treuhand.
2. Token-Governance: Observer, Upgrade, Blockliste und Pause von cUSDTMock liegen bei der Protocol DAO.
   Laut Zamas Wrapper-Dokumentation soll die Owner-Rolle des Wrappers an den Owner des zugrunde
   liegenden Tokens übergehen; für cUSDT im Mainnet wurde das nicht geprüft.
3. Metadaten: `todoRef`, DID des Delegierten und Budget-Status sind in der unverschlüsselten
   OrbitDB-Liste lesbar, und Entschlüsselungsanfragen sind auf der Gateway-Chain öffentlich.
4. Die App nutzt die Chain noch nicht: kein Zama-Budget-Service, keine Rückzahlung, keine Zuordnung
   von DID zu Konto. Ihr Hinweis bei einer ungedeckten Sperre sagt, es sei nichts überwiesen
   worden; on-chain wurde die Sperre in einen Block aufgenommen, Gas bezahlt und eine verschlüsselte 0
   überwiesen.
5. Passkey-Wallet: dauerhafter Root-Key, keine Nutzerverifikation on-chain, öffentliche Verknüpfung
   zwischen Konto und Sitzungsschlüssel.
6. Mainnet-Reife: ein einziger Coprozessor-Signierer für die Input-Attestierung im Mainnet,
   API-Schlüssel und Gebühren des Relayers, Migration auf v0.14, kein Audit.
7. Verfügbarkeit der Entschlüsselung: Die Anteils-Einstellungen des Relayers nach #3481 auf Sepolia
   sind unbekannt; es gibt kein dokumentiertes SLA.
8. Kein Audit der Treuhand; die Tests laufen gegen einen Mock, dessen Host-Verträge älter sind als die
   von Sepolia.

## Quellen

Repository (Branch `escrow01`):

- [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol): Prüfstelle
  49-52, Konstruktor 71-78, `lock` 100-136 (allow an die Prüfstelle 132), `release` 143-148, `refund`
  150-158.
- [`contracts/test/ConfidentialTodoEscrow.ts`](../contracts/test/ConfidentialTodoEscrow.ts): 16 Tests,
  insbesondere 363-377, 379-419, 421-444.
- [`contracts/README.md`](../contracts/README.md): "Who can decrypt", "What stays public", "`.env`",
  "Before relying on a deployment".
- [`src/lib/budget-service.js`](../src/lib/budget-service.js) 1-18,
  [`src/lib/budget.js`](../src/lib/budget.js) 1-16, [`src/lib/i18n/en.json`](../src/lib/i18n/en.json)
  (`budget.notice.insufficient`).

cUSDTMock-Implementierung auf Sourcify
(<https://sourcify.dev/server/v2/contract/11155111/0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04?fields=sources>):
`contracts/ConfidentialWrapper.sol` `WILDCARD_CONTRACT` 112, `blockUser` 229-231, `addObserver`
306-308, `observers` 336-338, `pauser` und `pause` 343-357, `renounceOwnership` 373-375,
`_addObserver` 391-403, `_update` 432-442, `_authorizeUpgrade` 497;
`contracts/token/ERC7984Upgradeable.sol` `requestDiscloseEncryptedAmount` 265-273, `_update` 343-378.

zama-ai/fhevm v0.13.5: `host-contracts/contracts/ACL.sol` (`allow` 206-216, `allowTransient` 253-272,
`delegateForUserDecryption` 283-334, `pause` 378-383, `isHandleDelegatedForUserDecryption` 478-491,
`cleanTransientStorage` 552-567, `_authorizeUpgrade` 591), `host-contracts/contracts/InputVerifier.sol`
(`verifyInput` 244-330, Recovery nur per ECDSA 517-525), `host-contracts/contracts/ACLEvents.sol`
(`DelegatedForUserDecryption`), `gateway-contracts/contracts/Decryption.sol` (`userDecryptionRequest`
441-526, `InvalidUserSignature` 916-927), `gateway-contracts/contracts/interfaces/IDecryption.sol`
(`UserDecryptionRequest` 96-102, `UserDecryptionResponse` 112-118),
`gateway-contracts/contracts/shared/Structs.sol` (`SnsCiphertextMaterial` 72-77). Pull Requests
[#2393](https://github.com/zama-ai/fhevm/pull/2393) (ERC-1271 im KMS-Connector) und
[#3481](https://github.com/zama-ai/fhevm/pull/3481).

`@fhevm/sdk` 0.13.2: `core/utils-p/runtime/recoverSigners.ts` 23,
`core/utils-p/decrypt/verifyKmsUserDecryptEip712V1.ts` 36-42, `core/modules/decrypt/module/api-p.ts`
236-242.

Calibur v1.0.0 (<https://github.com/Uniswap/calibur/tree/v1.0.0>): `src/libraries/KeyLib.sol` 26,
35-42, 58-77; `src/KeyManagement.sol` 21-46, 84-89; `src/Calibur.sol` 131-175. EIP-7702:
<https://eips.ethereum.org/EIPS/eip-7702>.

Chain, gelesen am 2026-09-16: cUSDTMock `owner()`, `observers()`, `pauser()`, Implementierungs-Slot;
ACL `owner()`, `persistAllowed` für den gespeicherten Betrag; Schwellenwerte von InputVerifier,
KMSVerifier und ProtocolConfig auf Sepolia und im Mainnet.

Zama-Dokumentation: vertraulicher Wrapper, Observer
(<https://docs.zama.org/protocol/protocol-apps/confidential-tokens/confidential-wrapper>); KMS
(<https://docs.zama.org/protocol/protocol/overview/kms>); Coprozessor
(<https://docs.zama.org/protocol/protocol/overview/coprocessor>); Sicherheitsmodell des SDK
(<https://docs.zama.org/protocol/sdk/concepts/security-model>); API-Schlüssel des Relayers
(<https://docs.zama.org/protocol/sdk/guides/relayer-api-keys>); Adressen für Sepolia und Ethereum
(<https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia>,
<https://docs.zama.org/protocol/protocol-apps/addresses/mainnet/ethereum>).
