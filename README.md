# Lernhub (Mac-App)

Der Lernhub als Desktop-App. Gelernt wird in zwei Modi, beide mit eigener Ansicht und Claude über `claude -p`:

- **Lernen:** die nächste Lektion der Roadmap im Gespräch (ein Schritt, eine Frage, deine Antwort).
- **Wiederholen:** alles bisher Gelernte üben, Aufgabe für Aufgabe, mit Hinweisen.

Dazu Wochenpensum, Fortschritt, Lernzeit, nächster Lerntag mit Kalender-Abgleich und der ILIAS-Sync per Knopf. Diktieren läuft über Deepgram.

Seit v2.0 (18.11.2026) gibt es in der App keine HTML-Lektionen mehr: kein Lektions-Fenster, kein „Erstellen“, kein „Weitermachen“, kein „Wochenstart“, keine Lernanalyse (Laut denken).

**Voraussetzungen:** macOS, Node, Claude Code (`claude`, läuft über das Abo) und die Skills `kurs-tutor` (Roadmaps, `hub.py`, `lernen.py`, `ueben.py`; liegt nicht in diesem Repo) und [`ilias-sync`](https://github.com/julian-krause/ilias-sync) unter `~/.claude/skills/`. Ohne `kurs-tutor` und einen Semesterordner mit Lernbereichen zeigt die App nichts an; auch die Tests arbeiten auf einer Kopie dieses Ordners.

Installiert: `~/Applications/Lernhub.app`. Neu bauen: `npm run app` (= `scripts/build-app.sh`; mit `-- --wenn-beendet` installiert er erst, wenn die laufende App beendet ist).

## Aufbau des Fensters

| Bereich | Inhalt |
|---|---|
| Seitenleiste | Spielkarte (Level, Serie, Tagesziel → Profil), Suche (⌘K), „Diese Woche“, „Nächster Lerntag“, **Läuft** (offene Lektionen und Übungsrunden, ein Klick setzt sie fort), Kurse mit Wochenring (⌘1–6), Kurse ohne Roadmap, Einstellungen, Stand der Daten |
| Diese Woche | Karten **Lernen** und **Wiederholen** (je ein „Los“), Wochenpensum, nächster Lerntag, Fortschritt im Semester, Lernzeit, ILIAS-Sync, neue ILIAS-Dateien, übrige Claude-Aktionen (`claude-cli://`) |
| Nächster Lerntag | Kalenderblöcke mit ihren Lektionen und „Lernen“ je Block, Pensum-Diagramm bis zur Klausur, Abgleich |
| Kurs | Klausur, Zielnote, Fortschritt, Karten **Lernen** und **Wiederholen** für diesen Kurs, Tabs **Pfad · Liste · Material · Lücken · Notizen** |
| Lernen | Unterricht im Gespräch, rechts der Plan der Lektion mit Uhr und die Roadmap des Kurses |
| Wiederholen | Übungsrunde über alle erledigten Lektionen, nach LearnHarness „Üben“ |
| Profil | Level, Lerntage-Kalender, Abzeichen, Rekorde, Einstellungen fürs Spiel (siehe „Spiel“) |

Tastenkürzel: ⌘L Lernen · ⌘⇧U Unendlich lernen · ⌘⇧W Wiederholen · ⌘K Suchen · ⌘0 Woche · ⌘1–6 Kurse · ⌘⇧T Lerntag · ⌘⇧L Diktieren · ⌘⇧F Fokus-Modus · ⌘⇧S Plan & Kalender abgleichen · ⌘R neu laden · ⌘, Einstellungen.

Auf der Kursseite klappen frühere, ganz erledigte Wochen ein („Frühere Wochen“): Die Seite beginnt mit den beiden Karten und der laufenden Woche. Eine erledigte Lektion hat „Merkblatt“; die Datei öffnet sich im Browser.

## Lernen (Lektion im Gespräch)

Claude unterrichtet die nächste Lektion der Roadmap nach dem Lehrmodus der LearnHarness-App in der Kompakt-Fassung.

- **Einstieg, ohne Zwischenseite:**
  - Karte „Lernen“ auf „Diese Woche“: „Los“ (auch ⌘L) nimmt die Lektion, die nach dem Plan dran ist, über alle Kurse. Reihenfolge (`reihenfolge` in `src/ui/js/lernen.js`): erst eine offene Sitzung, dann der Lernblock von heute im Kalender, dann der Kurs mit dem größten offenen Wochenpensum (Rückstand zuerst), zuletzt Vorlernen. Die Karte sagt, warum sie mit diesem Kurs beginnt. Ein Klick auf einen Kurs-Chip lernt dort.
  - Karte „Lernen“ auf der Kursseite, die Lektion im Pfad und in der Liste, „Lernen“ im Lerntag: lernt in diesem Kurs.
  - Einzustellen gibt es nichts. Dran ist immer die erste nicht erledigte Lektion, deren Material da ist. Probeklausuren laufen nicht im Gespräch.
- **Ablauf:** Jede Nachricht von Claude löst deine letzte Antwort auf, erklärt einen Schritt und endet mit genau einer Frage. Meist ist das eine Auswahlfrage (Klick oder Tasten 1–4, dazu „Wie sicher?“ und das Feld „Deine Gedanken“), selten eine kurze freie Frage. Text ohne Auswahl geht als Rückfrage an Claude, die Frage bleibt offen. „Weiß ich nicht“ zählt als nicht gewusst.
- **Hilfe ohne Knöpfe:** Claude erkennt selbst, was du brauchst (einfacher, ein weiteres Beispiel, fehlendes Vorwissen, mehr Tempo), aus Antwort, Sicherheit, Gedanken, Antwortzeit und dem Stand („x von y Prüffragen richtig“), die mit jeder Nachricht mitgehen. Regeln: `kurs-tutor/LERNEN.md`.
- **Bewertung:** Auswahlfragen bewertet die App selbst und zeigt sofort die richtige Option und die Erklärung. Freie Antworten bewertet Claude im nächsten Zug. Vorhersagen (vor einem Schritt) zählen nicht und werden erst mit Claudes Auflösung aufgedeckt. Score = Anteil der Prüffragen, die beim ersten Versuch richtig waren („teils“ zählt halb).
- **Zeitbudget:** die Schätzung der Roadmap plus 10 Min. (20 bis 25 Min.), etwa ein Schritt je 3 Min. Jede deiner Nachrichten trägt die Lektionsuhr; ab 80 % fasst Claude zusammen, bei 100 % kommt die Rückschau. Lücken über 10 Min. zählen als 10.
- **Abschließen:** „Lektion beenden“ (oder das Ende des Plans) bringt die Rückschau. Erst „Lektion abschließen“ trägt ein: `lernen.py --merkblatt` legt `lessons/<ID>-<slug>.html` an, falls die Lektion noch keine Datei hat (Kern je Schritt mit `data-topic`, daraus übt „Wiederholen“), dann `kurstutor://done?lesson=…&min=…&score=…`, dann Learning Record und `roadmap.py recorded`. Pensum, Fortschritt, Lernzeit und Kalender ziehen nach.
- **Danach:** „Nächste Lektion →“ lernt gleich weiter: von „Diese Woche“ aus die nächste nach dem Plan (auch in einem anderen Kurs, der Knopf nennt ihn), von der Kursseite aus die nächste dieses Kurses. „Rückgängig“ nimmt den Abschluss zurück, „Merkblatt“ öffnet es im Browser, „Abbrechen“ verwirft die Sitzung, ohne etwas einzutragen.
- **Code:** `src/main/lernen.js` (Sitzung, Schema, Systemprompt, Eintragen), `src/ui/js/lernen.js` (Karten, Reihenfolge, Ansicht). Claude darf nur lesen. Modell und Effort: `LERNHUB_LERNEN_MODELL`, `LERNHUB_LERNEN_EFFORT` (Standard opus, medium; 11–14 s je Zug). Sitzungen liegen in `userData/lernen/<id>.json` und laufen nach einem Neustart weiter.
- **Test:** `node tests/lernen.test.mjs` (Claude-Attrappe `tests/lernen-attrappe.mjs`).

## Unendlich lernen

Ein einziges Gespräch, Thema für Thema, bis du aufhörst. Für dich gibt es keine Lektionen: keine Uhr, keine Rückschau, keine Grenze im Verlauf. Unter der Haube bleibt jede Roadmap-Lektion eine eigene Claude-Sitzung mit Merkblatt, Record und XP. Konzept: `docs/unendlich.md`.

- **Einstieg:** „∞ Unendlich lernen“ über den Kursen auf „Diese Woche“ (nach dem Plan über alle Kurse), „∞ Unendlich“ auf der Karte „Lernen“ der Kursseite (erst dieser Kurs), ⌘⇧U, Suche.
- **Nach Thema statt nach Zeit:** Im Strom hat Claude kein Budget und keine Lektionsuhr (`stromRegeln` im Systemprompt, `[Unendlich-Modus]` statt `[Lektionsuhr]` in jeder Nachricht). Ein Schritt je Gedanke, höchstens 12; weiter, sobald du den Schritt verstanden hast (richtig und nicht geraten, sonst bis zu zweimal nachfassen). Kein Thema fällt weg, um schneller fertig zu werden. Keine Schlussrunde, kein Fazit, kein Gruß, das Wort „Lektion“ fällt nicht.
- **Vorausdenken:** Beim letzten Plan-Schritt startet Lernhub die nächste Lektion im Hintergrund (`Lernen.vorbereiten`, eigene Claude-Sitzung, Zustand `vorab`). Ihr Startauftrag nennt das Thema davor, damit ihr erster Zug einfach der nächste Schritt ist. Die Übernahme braucht keine Wartezeit.
- **Eintragen im Hintergrund:** Der `abschluss` ist im Strom nur die Auflösung deiner letzten Antwort und steht als normale Nachricht im Verlauf. Der Hauptprozess nimmt die Lektion sofort von ihrem Platz (`hintenEintragen`) und trägt sie im Hintergrund ein (Merkblatt, `kurstutor://done`, Record); die nächste übernimmt gleichzeitig. Ein Fehler hält den Strom nicht an: Meldung, im Rückblick „Nochmal“ (`lernen:nachtragen`).
- **Ein Verlauf:** Der Verlauf der Lektionen davor bleibt eingefroren darüber stehen (die letzten drei, ohne Knöpfe), darunter geht es weiter. Keine Trennlinie, keine Meilenstein-Karte, kein Konfetti.
- **Übergabe:** Deine erste Antwort in der nächsten Lektion desselben Kurses trägt Ergebnis, Kernaussage und „Noch offen“ der vorigen.
- **Comeback-Fragen:** Zwischen zwei Themen kommen bis zu zwei Auswahl-Prüffragen zurück, die du in diesem Strom falsch hattest (frühestens nach 8 Min., Optionen neu gemischt, jede einmal), als Fragekarte mitten im Verlauf. Die App bewertet sie selbst; sie bringen XP wie eine Prüffrage (`<Sitzung>:c<nr>` in `gebucht`), zählen aber nicht zum Score.
- **Welcher Kurs:** im Kurs bleiben, solange dort Wochenpensum offen ist, sonst höchstens 3 Lektionen am Stück, dann nach `reihenfolge()`. Ist nirgends mehr neuer Stoff, geht es von selbst in den Endloslauf von Wiederholen.
- **Wechsel zwischen den Modi:** Beide teilen sich dieselbe Sitzung je Kurs. „Weiterlernen“ macht eine halbe Strom-Lektion wieder zur normalen Lektion (Uhr, Rückschau, „Lektion abschließen“), „∞ Unendlich“ eine normale zur Strom-Lektion.
- **Aufhören:** „Schluss für heute“ zeigt den Rückblick (Themen mit Merkblatt und Rückgängig, Ø Genauigkeit, Zeit, XP). Was gerade halb ist, bleibt offen und läuft später weiter. Den Strom hält `S.strom` (localStorage `strom`, gilt bis Mitternacht); eine einzelne Lektion außerhalb des Stroms beendet ihn.
- **Test:** `node tests/unendlich.test.mjs` (Claude-Attrappe `tests/lernen-attrappe.mjs`).

## Wiederholen (Üben)

Geübt werden **alle bisherigen Inhalte**, nach dem Übungsmodus der LearnHarness-App (`~/Projekte/learnharness-abo`: `src/agent/tools/practice.ts`, `components/practice-dock.tsx`, `practice-cards.tsx`).

- **Einstieg, ohne Zwischenseite:** Karte „Wiederholen“ auf „Diese Woche“ („Los“ oder ⌘⇧W startet den Endloslauf über alle Kurse; ein Kurs-Chip übt nur dort) und auf der Kursseite (auch im Tab „Lücken“).
- **Oberfläche** (`src/ui/js/ueben.js`):
  - Im Verlauf stehen die Aufgabenkarte, „Deine Gedanken“, Claudes Text (Hinweis, Urteil, Antwort) und die Abschlusskarte mit Ergebnis-Chip (Gelöst, Mit Hinweisen gelöst, Weitergegangen, Aufgegeben), Urteil, Musterlösung und „Details“.
  - Ist eine Aufgabe offen, steht sie unten im Übungsfeld (einklappbar), darunter das Feld „Deine Gedanken“. ↵ sendet. Ob eine Einsendung eine Antwort ist, liest Claude aus dem Text. Esc fragt „Aufgabe verwerfen?“ und verwirft die Aufgabe ohne Lösung.
  - In der Pause gibt es das normale Feld für Fragen. Ist es leer, wird der Knopf zu „Nächste Aufgabe →“ (auch ↵).
  - Kopfzeile: Zähler (Aufgaben, gelöst, mit Hinweisen, aufgegeben, Quote: gelöst 1, mit Hinweisen 0,5), „Runde beenden“, „Zum Kurs“.
- **Hauptprozess** (`src/main/ueben.js`):
  - Jeder Zug ist ein Aufruf `claude -p --model opus --effort medium --output-format json --json-schema … --setting-sources '' --permission-mode dontAsk`. Der erste Zug läuft mit `--session-id` und `--append-system-prompt`, alle weiteren mit `--resume`. Claude antwortet im Schema mit `art` gleich `aufgabe`, `abschluss` oder `text`.
  - Die Musterlösung bleibt im Hauptprozess, bis die Aufgabe abgeschlossen ist. Verwerfen startet keinen Zug; die nächste Nachricht bekommt einen Systemhinweis vorangestellt.
  - Claude darf nur lesen und `ueben.py` aufrufen (Übersicht und `--thema`). Das Ergebnis trägt Lernhub selbst ein (`ueben.py --log` → `<Lernbereich>/uebung.json`: Fälligkeit 1, 3, 7, 14, 30 Tage, sauber gelöste Themen schließen Lücken).
  - Systemprompt: Mechanik, Kursregeln aus `kurs-tutor/UEBEN.md` und die Doktrin `~/.claude/skills/learnharness/references/ueben.md`. Modell und Effort: `LERNHUB_UEBEN_MODELL`, `LERNHUB_UEBEN_EFFORT`.
  - Je Kurs gibt es eine Runde. Sie liegt in `userData/ueben/<id>.json` und läuft nach einem Neustart weiter; nach 30 Tagen wird sie gelöscht.
- **Endloslauf über alle Kurse:** Lernhub übt Serien von 3 bis 6 Aufgaben je Kurs (mindestens 2, wenn dort kaum etwas fällig ist; die Serie endet erst auf einer sauber gelösten Aufgabe, `serieUm`); danach wechselt „Nächste Aufgabe · <Kurs> →“ (↵) von selbst zum Kurs mit dem höchsten Bedarf (fällige Themen + 3 × offene Lücken + Abstand zum Zielschnitt / 10 + Klausurnähe, geteilt durch 1 + Aufgaben in diesem Lauf). Die Runde eines Kurses bleibt beim Wechsel offen, nach 12 Aufgaben beginnt sie neu. Die Runde endet nie von selbst. „Runde beenden“ schließt alle Runden des Laufs. Regeln: `kurs-tutor/UEBEN.md`.
- **Test:** `node tests/ueben.test.mjs` (Claude-Attrappe `tests/ueben-attrappe.mjs`).

## Spiel

Lernhub macht aus Lernen und Wiederholen ein Spiel, ohne am Unterricht etwas zu ändern: Systemprompts, Schema, Bewertung und Eintragen in `src/main/lernen.js` und `src/main/ueben.js` bleiben, wie sie sind. Die Regeln sind reine Funktionen in `src/ui/js/regeln.js` (Test: `tests/spiel.test.mjs`), den Spielstand hält `src/ui/js/spiel.js`, Töne und Konfetti stehen in `src/ui/js/effekte.js`.

- **XP:** Eine Lektion bringt 40 bis 100 XP nach Genauigkeit, fehlerfrei 120. Eine Prüffrage bringt 10 XP plus bis zu 10 für die Combo, teils richtig 5, falsch 2, „Weiß ich nicht“ 1; Vorhersagen bringen 3 XP fürs Mitmachen. Jede richtige Prüffrage ist mit 1/8 ein Glückstreffer (doppelte XP). Beim Wiederholen: gelöst 20 (+ Combo), mit Hinweisen 12, aufgegeben 5. Für „Sicher“ gibt es keine XP, Leben oder Herzen gibt es nicht.
- **Level und Rang:** Level L ab 50·L·(L−1) XP, Ränge von Funke bis Supernova.
- **Wochenserie statt Tagesserie:** Lerntage je Woche (3 bis 6, im Profil). Ein Lerntag ist eine abgeschlossene Lektion, 5 Min. Wiederholen oder 40 XP. Ferienwochen (`semester.breaks`) unterbrechen die Serie nicht.
- **Tagesziel und Tagesquests:** Tagesziel 100, 200, 400 oder 700 XP (+20 XP Bonus). Jeden Tag drei Quests (Lernen, Wiederholen, Können); sind alle drei geschafft, öffnet sich die Truhe (+30 XP).
- **Abzeichen:** 28 Stück, aus Fakten berechnet (Lektionen, Serie, Combo, gelöste Aufgaben, Tagesziele, Level, Kursanteil, früh und spät). Was der bisherige Verlauf schon hergibt, wird beim ersten Start still freigeschaltet.

**Spielstand:** `spiel.json` in den App-Daten (Kanäle `spiel:laden`, `spiel:speichern`; geschrieben mit `B.schreibeAtomar`). Lektions-XP werden nie gebucht, sondern aus der Roadmap gerechnet, so nimmt „Rückgängig“ sie von selbst weg. Eine gerade eingetragene Lektion zählt bis zu 3 Min. aus `frisch` mit, bis `hub.py` sie kennt. Prüffragen und Aufgaben stehen genau einmal in `gebucht` (`<Sitzung>:f<nr>`, `<Sitzung>:a<nr>`, 45 Tage), auf dem Tag ihres Zeitstempels. Beim Start und beim ersten Laden einer Sitzung wird still nachgebucht; Ton, Konfetti und Feier gibt es nur, wenn sich etwas ändert, während die Ansicht offen ist.

**Auf dem Bildschirm:**
- *Lernen:* Nach einer Antwort Ton, grüner Puls oder Wackeln, „+n XP“, eine Zeile Lob oder Trost; jede aufgedeckte Fragekarte behält ihren XP-Chip, die Combo steht im Kopf. Beim Warten füllt sich ein Balken über die erwartete Dauer (Mittel der bisherigen Züge, sonst 12 s, im ersten Zug 45 s mit Tipps). Nach „Lektion abschließen“ kommt die **Feier**: Sterne, Genauigkeit, Zeit, XP, Level-Balken, Konfetti, Vorschau; ↵ = „Nächste Lektion →“, Esc schließt.
- *Fokus-Modus* (Standard in Lernen und Wiederholen, ⌘⇧F oder „Fokus“ im Kopf): Seitenleiste und rechte Spalte verschwinden, unter dem Kopf ein Balken mit einem Segment je Schritt des Plans.
- *Wiederholen:* dasselbe Feedback auf der Abschlusskarte, Konfetti-Stoß bei „Gelöst“. **Nur 5 Minuten** auf der Startseite startet den Endloslauf mit einem Ring über 5 Minuten; ist die Zeit um, endet die laufende Aufgabe in Ruhe, dann kommen Ergebnis und „Noch 5?“.
- *Seitenleiste:* Karte mit Flamme, Level, Rang, XP-Balken, Serie und Tagesziel-Ring; ein Klick öffnet das **Profil** (Kalender der letzten 12 Wochen, Abzeichen, Rekorde, Einstellungen: Tagesziel, Lerntage, Töne, Fokus-Modus, Erinnerungen).
- *Diese Woche:* Leiste mit Tagesziel, Wochenpunkten Mo–So, Serie und Level, darunter die Tagesquests mit Truhe. Die Karte „Wiederholen“ nennt die Portion für heute (fällig plus offene Lücken, höchstens 8, minus heute Geübtes).
- *Pfad der Kursseite:* Sterne unter erledigten Lektionen, eine hüpfende Blase „START“ über der, die dran ist, Klausurtraining als Boss-Knoten, eine Truhe am Wochenziel.
- *Erinnerungen:* Mitteilung, wenn heute ein Lernblock aus dem Kalender beginnt, und abends ab 19 Uhr, wenn die Wochenserie knapp wird (im Test aus).
- Einmal zur Begrüßung zeigt Lernhub den Stand aus dem bisherigen Verlauf. Maskottchen ist eine Flamme mit Gesicht (froh, müde, jubelnd). Töne sind leise WebAudio-Oszillatoren; unter „Bewegung reduzieren“ bewegt sich nichts.

## Diktieren

Der Knopf „Diktieren“ im Feld von Lernen und Wiederholen oder ⌘⇧L startet Deepgram (Kanal `diktat:start/stopp/ton`, `diktat:status/text`). Fertige Sätze gehen ins Feld, der Zwischentext steht kursiv darunter. Esc beendet zuerst das Diktieren. Verlässt du die Ansicht, endet es.

**Schlüssel:** in den Einstellungen eintragen. Verschlüsselt mit Electron `safeStorage` (Schlüsselbund-Eintrag „Lernhub Safe Storage“), Datei `deepgram.schluessel` in den App-Daten. Nach einem Neubau (neue ad-hoc-Signatur) fragt macOS einmal nach dem Schlüsselbund: „Immer erlauben“. Test: `npm run test:live` (gebaute App, echtes Deepgram; löst nach einem Neubau Abfragen für Schlüsselbund und Mikrofon aus).

## ILIAS-Sync (per Knopf, über `claude -p`)

Die Karte „ILIAS-Sync“ auf „Diese Woche“ (und der Hinweis „ILIAS-Sync ist fällig“) startet den Sync in der App. Es öffnet sich kein Terminal und kein Browserfenster.

- **Aufruf** (`src/main/sync.js`): `claude -p --model opus --effort medium --output-format stream-json --permission-mode dontAsk --strict-mcp-config`, Arbeitsordner = Semester, Auftrag `/ilias-sync Routine-Lauf fürs <Semester> …`. Die Skill `~/.claude/skills/ilias-sync` meldet sich mit `login.py` über agent-browser an (eigener Chrome ohne Fenster, Zugangsdaten in der `.env` der Skill).
- **Regeln im Auftrag:** keine Rückfragen; Login nur ohne Fenster, bei fehlenden oder abgelehnten Zugangsdaten bricht der Lauf mit „Sync abgebrochen: …“ ab; neue Kurse und Beitritte werden nicht ausgeführt, sondern unter „Offen“ gemeldet; Duplikate werden nie gelöscht; nach `fail: 0` folgt `roadmap.py sync-done`. Neues Material arbeitet der Lauf nicht in die Roadmaps ein (dafür gibt es je Kurs „Neues Material einarbeiten“ in Claude Code).
- **Freigaben, eng:** lesen überall; Bash nur die Skripte von ilias-sync, `roadmap.py sync-*` und einfache Lesebefehle; schreiben nur `Links.md` im Semesterordner. Gesperrt: `login.py --manual`/`--keep`, `agent-browser` direkt, `ilias.py select`/`setup`, `tutor.py`, `open`, `osascript`, `rm`, Web. Alles andere lehnt `dontAsk` ab, ohne zu fragen. `ANTHROPIC_API_KEY` wird nicht weitergegeben (läuft über das Abo).
- **Auf der Seite:** jeder Schritt in Klartext („meldet sich bei ILIAS an“, „lädt neue Dateien herunter“ …) mit Uhr und „Abbrechen“, am Ende Claudes Zusammenfassung (neue Dateien je Kurs, „Offen“). Danach gleicht Lernhub über die Kurs-Tutor-App ab (`kurstutor://sync?quiet=1`). Ist das Fenster im Hintergrund, kommt eine Mitteilung.
- **Für alles mit Rückfragen** (Ersteinrichtung, neue Kurse aufnehmen, beitreten, Duplikate löschen): Knopf „In Claude Code“ in der Karte.
- Das Ergebnis des letzten Laufs liegt in `userData/sync/letzter.json`, die Protokolle (stream-json) 30 Tage daneben. Modell und Effort: `LERNHUB_SYNC_MODELL`, `LERNHUB_SYNC_EFFORT`.
- **Test:** `node tests/sync.test.mjs` (Claude-Attrappe `tests/sync-attrappe.mjs`; kein echter Login, kein Download).

## iCloud: ausgelagerte Dateien

Mit „Mac-Speicher optimieren“ legt macOS selten genutzte Dateien nur noch in iCloud ab. Wer sie liest, wartet, bis iCloud sie geladen hat, Datei für Datei. Deshalb:
- `src/main/icloud.py` holt ausgelagerte Dateien der Lernbereiche parallel zurück (beim Start, alle 15 Minuten, beim Fokussieren); die Seitenleiste zeigt „iCloud lädt n/m Dateien“.
- Der letzte gute Stand liegt in `letzte-daten.json` (App-Daten). Braucht `hub.py` länger als 5 s, zeigt die App ihn sofort („Stand … · lädt“) und tauscht ihn aus, sobald `hub.py` fertig ist. Ohne Daten gibt es eine Fehlerseite mit „Erneut versuchen“ statt eines Endlos-„Lade …“.
- Nur ein `hub.py`-Lauf zur Zeit; kommt währenddessen eine Änderung, rechnet er einmal nach.
- Dauerhaft vermeiden: im Finder auf den Semesterordner rechts klicken → „Geladen behalten“ (falls angeboten).

## Wie die App mit kurs-tutor spricht

Lernhub rechnet nichts selbst. Quelle bleibt `roadmap.json` je Kurs. Den Studienordner (darunter liegen die Semester) kennt die Skill: Die App fragt beim Start `tutor.ROOT` ab (oder nimmt `KURSTUTOR_ROOT`) und liest, öffnet und schreibt nur dort.

- **Lesen:** `hub.py data` (dieselben Zahlen wie `Lernhub.html`), `luecken.py <WS>`. Neu geladen wird, wenn `hub.py` den Hub neu baut (`.lernhub-stand.js` ändert sich), beim Fokussieren nach 30 s und mit ⌘R.
- **Schreiben:** Abschließen, Rückgängig, Abgleich, Ordner und Kalender öffnen gehen als `kurstutor://…` per `open -g` an die **Kurs-Tutor-App**. Dadurch bleiben Kalender-Freigabe, Log und Mitteilungen dort. Die Meldung zeigt Lernhub aus `~/Library/Logs/kurs-tutor.log`.
- `claude-cli://`, Web- und Obsidian-Links öffnen extern, PDFs, Material und Merkblätter mit der Standard-App.

## Code

| Datei | Aufgabe |
|---|---|
| `src/main/main.js` | Fenster, Menü, Zustellen von Adressen, IPC, Diktieren |
| `src/main/bruecke.js` | Skripte aufrufen, `kurstutor://` an die Kurs-Tutor-App, Semester und Log beobachten |
| `src/main/lernen.js`, `src/main/ueben.js` | Lernen und Wiederholen: Sitzungen über `claude -p` mit festem Antwortschema |
| `src/main/sync.js` | ILIAS-Sync über `claude -p` (Auftrag, Freigaben, Fortschritt) |
| `src/main/deepgram.js`, `src/main/schluessel.js` | WebSocket-Strom zu Deepgram, Schlüssel mit safeStorage |
| `src/main/icloud.py` | ausgelagerte iCloud-Dateien parallel zurückholen |
| `src/ui/app.js` | Seitenleiste, Navigation, Suche, Meldungen |
| `src/ui/js/ansichten.js` | Diese Woche, Lerntag, Kurs, Einstellungen |
| `src/ui/js/lernen.js`, `ueben.js`, `sync.js` | Karten und Ansichten der beiden Modi, Sync-Karte |
| `src/ui/js/aufnahme.js` | Mikrofon → Hauptprozess (Diktieren) |
| `src/ui/js/regeln.js`, `spiel.js`, `effekte.js` | Spielregeln (rein), Spielstand und Spiel-Oberfläche, Töne und Konfetti |

## Tests

Alle Tests laufen auf einer Kopie des Semesters (nur Lernbereiche und Einstellungen), mit einer Kalender-Attrappe, eigenem Log und einer Claude-Attrappe. Echte Roadmaps, Kalender, Logs und ILIAS bleiben unberührt.

Welches Semester und welchen Kurs die Tests kopieren, steht in `tests/lokal.json` (nicht im Repo): `{ "root": "<Studienordner>", "semester": "<Ordner des Semesters>", "kurs": "<Kursordner>" }`, oder in `LERNHUB_TEST_ROOT`, `LERNHUB_TEST_SEMESTER`, `LERNHUB_TEST_KURS`. Ohne Angabe nehmen sie den Studienordner der Skill, das höchste Semester mit Roadmaps und den ersten Kurs mit mindestens fünf erledigten und zwei offenen Lektionen.

```bash
npm test                         # alle:
node tests/spiel.test.mjs        #   Spielregeln: XP, Level, Lerntage, Wochenserie, Quests, Abzeichen (ohne Electron)
node tests/e2e.mjs               #   Übersicht: Begrüßung, Spielkarte, Leiste, Quests, Karten, Kursseite, Pfad, Liste, Lücken, Lerntag, Profil, Einstellungen, Suche, „Los“, Fokus-Modus
node tests/lernen.test.mjs       #   Lernen: Gespräch, Bewertung, XP und Combo, Rückschau, Eintragen, Feier, spiel.json, Merkblatt, Record, nächste Lektion
node tests/unendlich.test.mjs    #   Unendlich: ohne Uhr, Vorausdenken, Eintragen im Hintergrund, ein Verlauf, Comeback-Frage, Übergabe, Rückblick, Moduswechsel
node tests/ueben.test.mjs        #   Wiederholen: Runde, Hinweis, Abschluss mit XP, Verwerfen, Endloslauf über alle Kurse, „Nur 5 Minuten“
node tests/sync.test.mjs         #   ILIAS-Sync: Freigaben, Fortschritt, Ergebnis, fehlende Zugangsdaten, Abbrechen
E2E_BILDER=<Ordner> npm test    # legt dazu Bildschirmfotos ab (Übersicht, Lernen mit Feier, Wiederholen)
npm run test:live                # Diktieren mit gebauter App und echtem Deepgram (braucht gespeicherten Schlüssel und eine eigene Aufnahme tests/audio/diktat.wav, die nicht im Repo liegt)
LERNHUB_APP=~/Applications/Lernhub.app/Contents/MacOS/Electron node tests/e2e.mjs   # Übersicht gegen die gebaute App
```

Umgebung: `KURSTUTOR_ROOT`, `LERNHUB_KURSTUTOR_DIR`, `LERNHUB_ILIAS_DIR`, `LERNHUB_SEMESTER`, `LERNHUB_DATEN` (App-Daten), `LERNHUB_DIREKT=1` (tutor.py selbst statt Kurs-Tutor-App), `LERNHUB_PY_HOME` (HOME der Skripte), `LERNHUB_FAKE_AUDIO` (WAV als Mikrofon), `LERNHUB_CLAUDE` (claude-Pfad, im Test die Attrappe), `LERNHUB_TEST_HUB_LANGSAM` (ms, simuliert langsames hub.py).

## Sprechstunde (Wiederholen per Sprache)

Freihändig wiederholen, etwa beim Kochen: Ein Tutor (OpenAI GPT-Live-1.1) fragt mündlich ab, hört zu, erklärt, was nicht saß, und fragt nach. Ergebnisse landen wie beim Wiederholen in `uebung.json` (Leitner), XP und Serie zählen mit.

- Start: Knopf „Sprechstunde“ auf der Kursseite und unter den Kurskarten, ⌘⇧E oder Suche (⌘K).
- Einmal einrichten: Einstellungen → „OpenAI für die Sprechstunde“: Schlüssel eintragen (verschlüsselt im Schlüsselbund), Stimme (Juni, Nuri, Flitz) und Tempo (ruhig/normal).
- Im Gespräch: „Pause“, „Nochmal“, „Langsamer“, „Erklär das genauer“, „Überspringen“, „Schluss“. Leertaste = Pause.
- Kosten: etwa 0,05 $ pro Minute. Lange Pausen (15 Min.) legen auf, „Weitermachen“ verbindet neu.
- Technik: Keine festen Karten. Der Tutor bekommt alle gelernten Themen als Rahmen (fällige markiert) und führt frei durchs Gespräch. Jeder fertige Satz (Tutor und du) geht an eine lokale Suche über alle erledigten Lektionen und das Glossar (BM25, `src/main/suche.js`, unter 1 ms); passende Stellen legt die App GPT-Live still hin, bevor er sie braucht. Das Backend braucht es nur zum Eintragen, für gezielte Suchen und zum Beenden. Details: `src/main/sprechstunde.js`, Tests: `npm run test:sprechstunde`.
