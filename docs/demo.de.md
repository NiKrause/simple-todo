# Bankdemo: vertrauliche Treuhand (`escrow01`)

Ablauf für die Vorführung vor Fachleuten einer Bank. Gezeigt wird eine delegierte Aufgabe mit einem
Budget, dessen Betrag vertraulich bleibt. Jede Szene hat einen einfachen Satz für alle und einen
Punkt für Fachleute. Stand: 2026-09-16. Für den Termin gilt diese deutsche Fassung; eine englische
steht in [demo.md](demo.md). Die technischen Einzelheiten stehen in
[escrow.de.md](escrow.de.md), [zama-confidential-transactions.de.md](zama-confidential-transactions.de.md),
[smoke-test.de.md](smoke-test.de.md) und [security.de.md](security.de.md).

Dieses Dokument enthält keine Rechts- oder Regulierungsberatung. Regulatorische Themen stehen am Ende
als offene Fragen an die Fachleute der Bank.

## Was heute echt ist und was nicht

| Teil                                          | Stand am 2026-09-16                                                                                                       | Was sich zeigen lässt                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Treuhand-Vertrag                              | auf Sepolia bereitgestellt und verifiziert: `0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429`                                  | Quelltext und Transaktionen auf Etherscan                        |
| Echte vertrauliche Transaktionen              | Smoke-Test vom 2026-09-16: Sperre, Entschlüsselung als Ersteller und als Begünstigter, ungedeckte Sperre, Freigabe        | die Etherscan-Seiten in [Szene 8](#szene-8--was-die-chain-zeigt) |
| Budget in der App                             | Attrappe im Arbeitsspeicher des Browsers; nichts wird verschlüsselt, nichts gesendet. Der Header zeigt „Demo ohne Chain“. | Ablauf, Texte, Zustände und Fehlerfälle des Drehbuchs            |
| Passkey-Wallet                                | nicht integriert                                                                                                          | nur das Konzept                                                  |
| Szene 8 des Drehbuchs („Was die Chain zeigt“) | nicht in der App                                                                                                          | Etherscan statt der App                                          |

Aussagen, die heute nicht stimmen würden:

- „Die App sperrt das Budget auf Sepolia.“ Sie arbeitet mit der Attrappe.
- „Außer Alice, Bob und der Prüfstelle kann niemand den Betrag lesen.“ Das gilt nur unter den
  Vertrauensannahmen in [Wer kann die Beträge lesen?](#wer-kann-die-beträge-lesen).
- „Ein Passkey bezahlt bereits.“ Die Wallet ist geplant, nicht eingebaut.

## Am Tag vorher prüfen

Alle Befehle im Verzeichnis `contracts/`.

1. **Probelauf.** `npm run smoke:sepolia:dry`. Erwartet: `passed: 5 steps ok`. Er sendet nichts und
   braucht keinen Schlüssel. Am 2026-09-16 dauerte das Verschlüsseln 10 bis 14 s und die öffentliche
   Entschlüsselung 2,3 bis 2,4 s. Schlägt ein Relayer-Schritt nach drei Versuchen fehl, liegt es
   meist an Sepolia oder am Relayer; Hinweise stehen unter „Troubleshooting“ in
   [contracts/README.md](../contracts/README.md#troubleshooting).
2. **Vollständiger Lauf.** `npm run smoke:sepolia`, gestartet von der Person, die den Schlüssel in
   `contracts/.env` verwaltet. Erwartet: jeder Schritt `ok` und am Ende `passed`. Nach dem Lauf vom
   2026-09-16 hält der Ersteller kein USDTMock und keine Genehmigung mehr, und sein cUSDTMock-Guthaben
   ist nach der Sperre von 1,0 leer; also wird wieder geprägt, genehmigt und verpackt: 7 Transaktionen,
   am 2026-09-16 bei rund 1 gwei 0,00242 ETH. Die neuen Transaktions-Links aus der Ergebnistabelle
   notieren; sie können die Links in Szene 8 ersetzen.
3. **ETH-Guthaben.** Adresse `0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621` auf
   [Etherscan](https://sepolia.etherscan.io/address/0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621) öffnen.
   Nach dem Lauf vom 2026-09-16 waren es 2,245336 Sepolia-ETH; ein vollständiger Lauf kostet laut
   Runbook 0,002 bis 0,007 ETH.
4. **Relayer.** `curl -sS https://relayer.testnet.zama.org/v2/keyurl` muss HTTP 200 mit JSON liefern,
   das `fheKeyInfo` und `crs` enthält (so am 2026-09-16). Das zeigt nur, dass der Relayer antwortet;
   ob Gateway und KMS arbeiten, zeigen die Schritte 1 und 2.
5. **Forum und Releases lesen.** Die beiden Threads zu den Sepolia-Vorfällen auf neue Beiträge prüfen:
   [4643](https://community.zama.org/t/sepolia-handles-created-after-2026-08-31-will-not-decrypt-while-older-handles-on-the-same-contract-still-do/4643)
   und
   [4653](https://community.zama.org/t/sepolia-user-decrypt-fails-in-kms-share-reconstruction-9-13-gao-decoding-failure/4653).
   Auf <https://github.com/zama-ai/fhevm/releases> nachsehen, ob Sepolia auf v0.14 umgestellt wurde
   oder ein neues v0.13-Release erschienen ist.
6. **App.** Auf dem Branch `escrow01` `pnpm dev` starten. In beiden Browserprofilen einen Passkey
   anlegen, die Sprache auf DE stellen und prüfen, dass sich die Profile über das Relay verbinden
   (Relay-Einrichtung: README, Abschnitt „Local Relay“). Die Szenen einmal komplett durchspielen.
7. **Etherscan-Tabs** aus Szene 8 vorab öffnen und die
   [Fallback-Aufzeichnung](#fallback-aufzeichnung) einmal abspielen.

## Aufbau

- Laptop am Beamer. Ein Browser mit zwei Profilen nebeneinander: links „Alice“ (legt die Aufgabe an
  und sperrt das Budget), rechts „Bob“ (Delegierter). Jedes Profil hat seinen eigenen Passkey.
- Im Profil „Alice“ zusätzlich die Etherscan-Tabs und die Entwicklerkonsole für die Hebel der
  Attrappe (Szene 7 und 9).
- Während der Vorführung keines der Profile neu laden: Die Attrappe hält ihre Treuhand-Vorgänge nur
  im Arbeitsspeicher des Tabs. Nach einem Neuladen steht das Budget noch an der Aufgabe, der Betrag
  ist aber nicht mehr lesbar.
- Grenzen der Attrappe, die man vorab ansagen sollte: Bobs Profil kann Beträge nicht lesen (es zeigt
  „•••“ mit dem Hinweis „Diesen Betrag kann dieser Browser nicht lesen.“), und die Prüfansicht zeigt
  nur die Vorgänge des Tabs, in dem sie geöffnet ist.

## Ablauf

Die Szenen folgen dem Drehbuch „Treuhand-Demo Drehbuch“ (Szenen 1 bis 9). Namen und Beträge sind
Beispielwerte.

### Szene 1 · Ein Passkey

**Zeigen.** Alice öffnet die App. Der Einwilligungsdialog beim Start enthält den Abschnitt „Ein
Passkey für alles“; unter „Was gespeichert wird“ steht bei der Attrappe, dass Budgets nur zur
Vorführung im Arbeitsspeicher liegen. Danach legt Alice ihren Passkey an.

**Einfach.** „Alice meldet sich mit Touch ID an. Kein Passwort, keine Seed-Phrase.“

**Für Fachleute.** Heute erzeugt der Passkey die Identität: Die DID stammt vom P-256-Schlüssel des
Passkeys, OrbitDB-Einträge werden signiert, delegierte Änderungen und Budget-Aktionen fragen den
Passkey erneut ab. Dass derselbe Passkey auch ein Konto auf der Chain steuert, ist geplant und nicht
eingebaut. Die Einschränkungen des geplanten Kontos stehen in
[security.de.md](security.de.md#passkey-wallet).

### Szene 2 · Aufgabe mit Budget

**Zeigen.** Alice legt eine private Liste an („Prüfbericht Q3“), fügt die Aufgabe
„Datenschutz-Audit der Kontoeröffnung“ hinzu, delegiert sie an Bobs DID (aus dem Header von Bobs
Profil kopiert), setzt optional eine Frist und trägt als Budget 500,00 cUSDT ein. Unter dem Budget-Feld
steht der Hinweis zur Verschlüsselung und darunter, dass die Vorführung ohne Chain läuft.

**Einfach.** „Alice gibt Bob eine Aufgabe und legt 500 vertrauliche Dollar dafür zurück.“

**Für Fachleute.** In der gemeinsamen Liste (OrbitDB) landet nur das Feld `budget`: Status, Token,
Treuhand, `todoRef` und Transaktions-Hashes, nie der Betrag. Im Zielsystem verschlüsselt der Browser
den Betrag für das Paar (Treuhand, Alice) und erzeugt einen Zero-Knowledge-Proof; die Coprozessoren
prüfen ihn und signieren, auf Sepolia 3 von 5.

### Szene 3 · Budget sperren

**Zeigen.** Alice bestätigt mit dem Passkey. Der Status wechselt von „wird gesperrt“ zu „gesperrt“.

**Einfach.** „Das Geld liegt jetzt bei der Treuhand. Jeder kann sehen, dass Alice für Bob etwas
gesperrt hat, aber nicht, wie viel.“

**Für Fachleute.** Im Zielsystem sind das zwei Aufrufe auf Sepolia: `setOperator(Treuhand, Ablauf)`
am Token und `lock(todoRef, Begünstigter, Handle, Input-Proof, Frist)` an der Treuhand. Die Treuhand
prüft den Input-Proof selbst, der Token zieht den Betrag verschlüsselt ein, und die Treuhand gibt
Alice, Bob und der Prüfstelle eine dauerhafte ACL-Berechtigung auf den gesperrten Betrag. Beispiel aus
dem Smoke-Test: Sperre in Block 11717341, 682.630 Gas, 21 Events, kein Betrag
([Etherscan](https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065)).
Dass die Freigabe des Operators und die Sperre in einem einzigen Passkey-Schritt hinausgehen, wie der
App-Text sagt, gehört zur geplanten Wallet.

### Szene 4 · Bob erledigt

**Zeigen.** Bob öffnet die Liste über ihre Adresse, sieht die Aufgabe als „Von … an Sie delegiert“
(mit Alices gekürzter DID) und hakt sie ab. Sein Passkey fragt nach, der Header meldet „Änderung
unterschrieben“. Bei Alice erscheint die Aufgabe als erledigt.

**Einfach.** „Bob sieht, dass Geld für ihn gesperrt ist, und meldet die Aufgabe als erledigt. Den
Betrag liest er auf seinem eigenen Gerät.“

**Für Fachleute.** Bob liest den Betrag per Nutzer-Entschlüsselung: Sein Browser erzeugt ein
ML-KEM-512-Transport-Schlüsselpaar, Bob signiert ein EIP-712-Permit, der Relayer reicht die Anfrage an
Zamas Gateway weiter, jeder KMS-Knoten prüft die ACL auf Sepolia und liefert einen für Bobs Schlüssel
verschlüsselten Anteil, der Relayer sammelt die Anteile, bis mindestens 9 von 13 vorliegen, und der
Browser setzt daraus den Wert zusammen. Im Smoke-Test dauerte
das für den Begünstigten 2,3 s. Mit der Attrappe zeigt Bobs Profil „•••“, weil der Betrag nur in Alices
Tab existiert.

### Szene 5 · Alice gibt frei

**Zeigen.** Bei Alice steht „wartet auf Freigabe“ mit den Knöpfen „Budget freigeben“ und „Wieder
öffnen“. Alice gibt frei und bestätigt mit dem Passkey; der Status wird „ausgezahlt“.

**Einfach.** „Alice zahlt aus. Nur sie kann das, und nur einmal.“

**Für Fachleute.** `release(todoRef)` sucht den Vorgang unter `msg.sender`; für jede andere Adresse
existiert er nicht. Der Token überweist den gesperrten Betrag verschlüsselt an Bob. Bob hat keinen
Anspruch auf der Chain: Freigeben bleibt Alices Entscheidung, nach Ablauf der Frist kann sie das Geld
zurückholen. Beispiel aus dem Smoke-Test: Freigabe in Block 11717348, 412.902 Gas
([Etherscan](https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c)).

### Szene 6 · Eingang bei Bob

**Zeigen.** Bob erhält eine Meldung über die Auszahlung, und die Karte „Vertrauliches Guthaben“
erscheint. Mit der Attrappe lautet die Meldung „Budget von … ausgezahlt“ ohne Betrag, und die Karte
meldet, dass dieser Browser das Guthaben nicht lesen kann.

**Einfach.** „Bob hat das Geld. Sein Kontostand ist auf der Chain verschlüsselt; entschlüsselt wird er
auf seinem Gerät.“

**Für Fachleute.** Bobs Guthaben ist nach der Freigabe ein neuer Handle; im Smoke-Test
`0x00089ea45ceb93ca7589e2b385cc604977e31e81e0ff0000000000aa36a70500`. Dauerhaft berechtigt sind darauf Bob
und der Token-Vertrag.

### Szene 7 · Prüfstelle

**Zeigen.** Im Header „Prüfansicht“ wählen (oder die Seite mit `#pruefstelle` öffnen). Für mehr
Zeilen vorher in der Konsole von Alices Profil `simpleTodoBudgetDemo.seedExamples()` ausführen; das
fügt Beispielvorgänge hinzu (Alice an Bob 500,00 ausgezahlt, Alice an Carol 1.200,00 gesperrt, Dave an
Bob 80,00 gesperrt).

**Einfach.** „Die Bank als Prüfstelle sieht alle Beträge dieser Treuhand, aber nicht die Aufgaben
selbst.“

**Für Fachleute.** Die Prüfstelle ist im Vertrag unveränderlich festgelegt (`immutable`). Jede Sperre
gibt ihr eine dauerhafte ACL-Berechtigung, sichtbar als öffentliches `Allowed`-Event; entzogen werden
kann sie nicht, ein Wechsel bedeutet eine neue Treuhand. Die Prüfstelle kann lesen, aber kein Geld
bewegen; wie Alice und Bob kann sie einen Betrag über den Token öffentlich machen. Die heute
eingetragene Prüfstelle ist der Entwicklerschlüssel. In der Attrappe beantwortet die
Prüfansicht jede Identität; der echte Dienst soll nur der eingetragenen Prüfstelle antworten.

### Szene 8 · Was die Chain zeigt

**Zeigen.** Die App hat diese Szene nicht; stattdessen die Etherscan-Seiten des Smoke-Tests:

| Transaktion                | Link                                                                                                              | Was man sieht                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Verpacken von 1,0 USDTMock | [0x567d87cb…](https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de) | den Betrag: unter „ERC-20 Tokens Transferred“, in `TrivialEncrypt` (`pt`) und in `Wrap` (`roundedAmount`) |
| Sperre                     | [0x04259275…](https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065) | Absender, Treuhand, `todoRef`, Begünstigten, Frist, Handles, Input-Proof, Berechtigte; keinen Betrag      |
| Ungedeckte Sperre          | [0xfbe2cd1e…](https://sepolia.etherscan.io/tx/0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6) | dasselbe Bild wie bei der gedeckten Sperre                                                                |
| Freigabe                   | [0xd9d123e6…](https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c) | `ConfidentialTransfer` von der Treuhand an den Begünstigten mit Handle; keinen Betrag                     |
| Treuhand-Vertrag           | [0x6Ee3Fa9d…](https://sepolia.etherscan.io/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429#code)               | verifizierter Quelltext                                                                                   |

**Einfach.** „Das ist die öffentliche Sicht. Wer, wann, an wen: ja. Wie viel: nein. Nur beim Umtausch
von USDT in vertrauliche Dollar und zurück ist der Betrag sichtbar.“

**Für Fachleute.** Öffentlich sind außerdem die Handles, der Input-Proof mit drei
Coprozessor-Signaturen, jede ACL-Berechtigung und jeder Rechenschritt als Event. Eine gedeckte und
eine ungedeckte Sperre sind nicht zu unterscheiden. Anfragen zur Nutzer-Entschlüsselung sind
Transaktionen auf Zamas Gateway-Chain, für die es einen öffentlichen Explorer gibt, und nennen dort
Handle, Nutzeradresse und Transport-Schlüssel.

### Szene 9 · Fehlerfälle (optional)

**Zeigen.** Mit der Attrappe:

- **Zu wenig Guthaben.** Die Attrappe schreibt jedem Konto bei der ersten Sperre 1.000,00 cUSDT gut.
  Nach 500,00 aus Szene 2 ein Budget über 600,00 sperren: „Budget nicht gesperrt. Ihr vertrauliches
  Guthaben reichte nicht. Es wurde nichts überwiesen.“
- **Lesezugriff abgelaufen.** In der Konsole `simpleTodoBudgetDemo.expireReadKey()` ausführen:
  „Lesezugriff abgelaufen.“ mit „Mit Passkey verlängern“.
- **Passkey abgebrochen.** Die Passkey-Abfrage abbrechen: „Passkey-Bestätigung abgebrochen. Es wurde
  nichts gesendet.“

**Einfach.** „Wenn etwas schiefgeht, sagt die App in einem Satz, was passiert ist und was zu tun ist.“

**Für Fachleute.** Auf der Chain geht eine ungedeckte Sperre durch und hält eine verschlüsselte 0; im
Smoke-Test Block 11717345. Die App-Meldung „Es wurde nichts überwiesen“ vereinfacht: Die Transaktion
wurde ausgeführt, Gas wurde bezahlt und überwiesen wurde eine verschlüsselte 0. Deshalb liest der
geplante Dienst den gesperrten Betrag nach jeder Sperre zurück.

## Fragen von Fachleuten

### Wer kann die Beträge lesen?

Ersteller, Begünstigter und Prüfstelle, weil die Treuhand ihnen bei jeder Sperre eine dauerhafte
ACL-Berechtigung gibt; das ist öffentlich nachprüfbar. Darüber hinaus:

- Die Verträge der Treuhand und des Tokens sind ebenfalls berechtigt, damit sie rechnen können. Die
  Treuhand hat keine Funktion, die einen Betrag veröffentlicht. Über den Token kann jede berechtigte
  Person (Ersteller, Begünstigter, Prüfstelle) einen Betrag öffentlich entschlüsselbar machen.
- Der Owner des Tokens cUSDTMock, Zamas Protocol DAO, kann Observer eintragen. Ein Observer kann jeden
  Betrag entschlüsseln, auf den der Token berechtigt ist, also auch die Beträge dieser Treuhand. Am
  2026-09-16 war kein Observer eingetragen; Observer sind öffentlich.
- Zamas KMS: 13 Betreiber halten den Entschlüsselungsschlüssel nur in Anteilen. Zamas
  FHEVM-Whitepaper (Juni 2025) toleriert Absprachen von bis zu 4 der 13 Betreiber; ab 5
  zusammenwirkenden Betreibern gilt diese Zusage nicht mehr. On-chain eingetragen sind Schwellenwerte
  von 9 (Nutzer-Entschlüsselung), 7 (öffentliche Entschlüsselung) und 4 (MPC).
- Zamas Protocol DAO ist Owner der ACL und der übrigen Host-Verträge und kann sie upgraden; die
  Berechtigungsregeln selbst hängen also an dieser Governance.
- Der Relayer sieht bei der Nutzer-Entschlüsselung nur Anteile, die für den Schlüssel der lesenden
  Person verschlüsselt sind.

### Was ist öffentlich?

Absender, Begünstigter, Prüfstelle, Zeitpunkte, aufgerufene Funktionen, `todoRef`, Frist, Gas, alle
Handles und Input-Proofs, alle Berechtigungen und Rechenschritte, die Beträge beim Verpacken und
Entpacken, und auf der Gateway-Chain, wer wann welchen Handle entschlüsseln lässt. In der
unverschlüsselten OrbitDB-Liste stehen Aufgabentext, DID des Delegierten und `todoRef`. Nicht
öffentlich sind die Beträge in der Treuhand, die Guthaben und die Frage, ob eine Sperre gedeckt war.

### Was passiert, wenn Zamas Relayer ausfällt?

Dann lässt sich über ihn nichts verschlüsseln und nichts entschlüsseln: keine neue Sperre mit neuem
Betrag, kein Lesen von Beträgen. Die Chain bleibt unverändert; Freigabe und Rückzahlung sind normale
Transaktionen ohne Relayer-Anfrage. Auf Mainnet braucht Zamas gehosteter Relayer einen API-Schlüssel,
und Zama dokumentiert auch den Betrieb eines eigenen Relayers; Gateway und KMS bleiben dabei
Abhängigkeiten. Eine Service-Level-Vereinbarung nennen die herangezogenen Quellen nicht. Auf Sepolia
schlug die Nutzer-Entschlüsselung Anfang September 2026 zweimal zeitweise fehl.

### Wer verwahrt welche Schlüssel?

- **FHE-Schlüssel:** die 13 KMS-Betreiber, nur als Anteile; laut Zamas Dokumentation standardmäßig in
  AWS Nitro Enclaves.
- **Transport-Schlüssel zum Lesen:** im Browser der lesenden Person; das SDK speichert ihn laut Zamas
  Dokumentation im Browser standardmäßig unverschlüsselt in der IndexedDB.
- **Konto-Schlüssel:** in dieser Demo sind Ersteller und Prüfstelle derselbe Entwicklerschlüssel, im
  Klartext in `contracts/.env`; der Begünstigte des Smoke-Tests war ein Wegwerf-Schlüssel im Speicher.
- **Geplant:** ein Passkey-Konto (Calibur). Dort lässt sich der ursprüngliche Einrichtungsschlüssel
  nie entfernen (Calibur akzeptiert ihn immer als Root-Key, und nach EIP-7702 kann er das Konto
  ohnehin neu delegieren), die Nutzerverifikation des Passkeys wird on-chain nicht erzwungen, und
  fürs Lesen ist ein zusätzlicher Sitzungsschlüssel nötig, weil Zamas aktuelle Version nur
  ECDSA-Signaturen annimmt. Nicht eingebaut.

### Ist das reif für Mainnet?

Nein, es ist eine Testnetz-Vorführung. Zamas Host-Verträge auf Ethereum Mainnet haben dieselbe
Version v0.13 und denselben verifizierten Quellcode wie auf Sepolia. Offen sind: Die App ist nicht an
die Chain angebunden, die Treuhand ist nicht auditiert, die Prüfstelle ist ein Entwicklerschlüssel,
die Passkey-Wallet fehlt, Version v0.14 ist veröffentlicht, aber noch nicht bereitgestellt, und der
InputVerifier auf Mainnet nimmt eine verschlüsselte Eingabe mit der Signatur eines einzigen
registrierten Coprozessor-Schlüssels an (auf Sepolia 3 von 5); wie Zama diesen Schlüssel betreibt, ist
von außen nicht sichtbar. Nichts aus diesem Kapitel lief auf Mainnet.

### Was passiert, wenn Alice nicht freigibt?

Bob hat keinen Anspruch auf der Chain. Nach Ablauf der Frist kann Alice das Geld zurückholen. Die
Treuhand schützt Alices Geld, nicht Bobs Arbeit. Bob kann vor Arbeitsbeginn den gesperrten Betrag
entschlüsseln und so prüfen, dass die Sperre gedeckt ist.

### Was kostet es, und wie schnell ist es?

Im Smoke-Test vom 2026-09-16 kosteten 7 Transaktionen zusammen 2.269.800 Gas oder 0,00242 Sepolia-ETH
bei rund 1 gwei; eine Sperre 682.630 Gas, eine Freigabe 412.902 Gas. Das Verschlüsseln dauerte 9,6 s
beim ersten Mal (mit dem Start des SDK) und 4,5 s beim zweiten, das Lesen eines Betrags 2,3 bis 2,8 s,
die Sperre mit zwei Bestätigungen 37,0 s. Auf Mainnet gelten andere Gaspreise, und Zamas gehosteter
Relayer rechnet Gebühren monatlich ab; Beträge dafür nennen die herangezogenen Quellen nicht.

### Offene Fragen an die Fachleute der Bank

Keine Antworten, sondern Fragen, die dieses Kapitel nicht klären kann:

- Wie ist eine unveränderliche Prüfstelle mit dauerhaftem Lesezugriff auf alle Beträge einzuordnen,
  auch mit Blick auf Aufbewahrung und Löschung?
- Welche Anforderungen gelten für die Verwahrung der Schlüssel von Prüfstelle und Nutzern?
- Wie sind die Rechte des Token-Owners zu bewerten: Observer, Blockliste, Pause, Upgrade?
- Welche Rolle haben die KMS- und Coprozessor-Betreiber, und genügt eine Vertrauensannahme über
  Schwellenwerte?
- Welche Metadaten dürfen öffentlich sein: Adressen, Zeitpunkte, Referenzen, Entschlüsselungsanfragen?
- Welche Anforderungen an Verfügbarkeit gelten, wenn das Lesen von Beträgen von Diensten Dritter
  abhängt?

## Fallback-Aufzeichnung

- **Aufnehmen** am Vortag, nach den Prüfungen: die Szenen 1 bis 9 in beiden Profilen und die
  Etherscan-Seiten aus Szene 8, als Videodatei lokal auf dem Laptop, damit sie ohne Netz abspielbar
  ist.
- **Umschalten**, wenn der Probelauf am Morgen fehlschlägt, das Netz im Raum ausfällt, sich die beiden
  Profile nicht verbinden oder ein Profil neu geladen werden musste (die Attrappe verliert dann ihre
  Beträge).
- **Ohne Video:** Die Etherscan-Links aus Szene 8 zeigen die echten Transaktionen unabhängig vom
  Relayer; die Schritte dazu stehen in [smoke-test.de.md](smoke-test.de.md).

## Quellen

Repository (Branch `escrow01`):

- [`src/lib/budget-service-fake.js`](../src/lib/budget-service-fake.js): Startguthaben 64-70, Sperre
  175-236, Prüfansicht 287-307, Hebel `expireReadKey` und `seedExamples` 324-355.
- [`src/lib/budget-store.js`](../src/lib/budget-store.js) 386-400 (`simpleTodoBudgetDemo` in der
  Konsole), [`src/routes/+page.svelte`](../src/routes/+page.svelte) 352-362 (`#pruefstelle`) und 466-484
  (Einwilligungsdialog),
  [`src/lib/AddTodoForm.svelte`](../src/lib/AddTodoForm.svelte) 196-200 (Hinweis unter dem Budget-Feld),
  [`src/lib/OnePasskeyIntro.svelte`](../src/lib/OnePasskeyIntro.svelte) 18-33 („Ein Passkey für alles“,
  „Was gespeichert wird“).
- [`src/lib/i18n/de.json`](../src/lib/i18n/de.json) und [`src/lib/i18n/en.json`](../src/lib/i18n/en.json):
  Schlüssel `onboarding.storedBudgetsDemo`,
  `budget.network.demo`, `budget.demoNotice`, `budget.form.hint`, `budget.chip.hidden`,
  `budget.notice.*`, `budget.auditor.*`, `budget.toast.receivedHidden`, `header.auditorView`.
- [`contracts/src/ConfidentialTodoEscrow.sol`](../contracts/src/ConfidentialTodoEscrow.sol),
  [`contracts/README.md`](../contracts/README.md) (Runbook, Smoke-Test, Kosten, Troubleshooting).
- Drehbuch „Treuhand-Demo Drehbuch“, Stand 2026-09-16, Szenen 1 bis 9.

Weitere Belege zu allen technischen Aussagen: die Quellenabschnitte von [escrow.de.md](escrow.de.md),
[zama-confidential-transactions.de.md](zama-confidential-transactions.de.md),
[smoke-test.de.md](smoke-test.de.md) und [security.de.md](security.de.md).

Chain und Dienste, abgefragt am 2026-09-16: die Transaktionen und Adressen oben auf Etherscan;
`https://relayer.testnet.zama.org/v2/keyurl`; Forum-Threads 4643 und 4653; Zama-Dokumentation zu
Relayer-API-Schlüsseln (<https://docs.zama.org/protocol/sdk/guides/relayer-api-keys>), SDK-Sicherheitsmodell
(<https://docs.zama.org/protocol/sdk/concepts/security-model>), KMS
(<https://docs.zama.org/protocol/protocol/overview/kms>) und Chains mit Gateway-Explorer
(<https://docs.zama.org/protocol/protocol-apps/chains>); Zamas FHEVM-Whitepaper, Version 3.1
(<https://github.com/zama-ai/fhevm/blob/main/fhevm-whitepaper.pdf>), S. 12; Guthaben und Genehmigung
des Erstellers bei USDTMock (`balanceOf`, `allowance`).
