# Unendlich-Modus: Lernen ohne Lektionsgrenzen

Stand 22.11.2026. Konzept, umgesetzt am selben Tag (Code: `src/main/lernen.js`, `src/ui/js/lernen.js`; Test: `tests/unendlich.test.mjs`).

## Idee

Heute ist jede Lektion eine Insel: Plan, Uhr (20–25 Min.), „Lektion beenden“, Rückschau, „Lektion abschließen“, Feier, „Nächste Lektion →“, dann rund 45 s Warten, bis Claude das neue Material gelesen hat.
Im Unendlich-Modus gibt es nur noch **einen durchgehenden Strom**. Julian beantwortet Frage um Frage, der Stoff geht einfach weiter.
Die Lektionen bleiben unter der Haube bestehen, weil Roadmap, Merkblatt, Learning Record, Wiederholen und XP an ihnen hängen. Im Strom sieht er sie aber nur noch als **Meilenstein-Karten** („✓ 0012 Sockets · 85 % · +90 XP“), nicht mehr als Anfang und Ende.

Der Modus endet nie von selbst. Ist kein neuer Stoff mehr da, geht er nahtlos ins Wiederholen über.

## Was „schlau“ daran ist: fünf Bausteine

### 1. Je Lektion eine frische Claude-Sitzung, für ihn unsichtbar

Eine einzige `claude -p`-Sitzung über viele Lektionen würde den Kontext sprengen, langsamer und teurer werden und die Regeln je Lektion (Budget, Plan, Material genau dieser Seiten) verwässern.
Deshalb bleibt es bei **einer Sitzung je Lektion**. Neu ist nur, dass die Oberfläche die Sitzungen hintereinander als einen Verlauf zeigt.

### 2. Vorausdenken: Die nächste Lektion startet, bevor die alte endet

Der teure erste Zug (Material lesen, Plan, Schritt 1, rund 45 s) läuft im Hintergrund, **sobald die laufende Lektion 75 % ihres Budgets erreicht oder Claude den letzten Plan-Schritt beginnt**.
Bis zur Schlussrunde und Auflösung vergehen meist noch 3–5 Minuten, also ist die nächste Lektion fertig, wenn er dort ankommt. Wartezeit an der Grenze: praktisch null.

- Im Hauptprozess bekommt `Lernen` neben `sitzungen` (ws → laufende Sitzung) einen zweiten Platz `vorab` (Schlüssel `ws` des Zielkurses → vorbereitete Sitzung).
- `ziel(c, { ohne })` muss die gerade laufende Lektion überspringen können, damit „die nächste“ wirklich die übernächste ist.
- Die Vorab-Sitzung führt nur ihren ersten Zug aus und wartet dann (Zustand `vorab`). Ihre Lektionsuhr startet erst, wenn sie in den Strom rückt (Start = Zeitpunkt des Wechsels, nicht des Vorabzugs).

### 3. Übergabe statt Neuanfang

Die Vorab-Sitzung kennt das Ergebnis der Lektion davor noch nicht. Deshalb trägt Julians **erste Antwort** in der neuen Lektion einen Systemblock:
`[Übergabe] Vorige Lektion 0012 „…“: 85 %. Kernaussage: … Noch offen: …`
Claude darf das in Schritt 2 aufgreifen. Gleichzeitig stellt die neue Lektion keine Aufwärmfrage zu Altem (Regel aus LERNEN.md bleibt).

### 4. Comeback-Fragen an der Lektionsgrenze

Was er falsch hatte, kommt wieder, und zwar ohne Modell und ohne Wartezeit:
An jeder Grenze stellt die App **1–2 Prüffragen erneut, die er in diesem Strom falsch oder mit „Weiß ich nicht“ beantwortet hat**, frühestens 8 Minuten später und mit neu gemischten Optionen.
Das geht, weil jede Frage laut LERNEN.md für sich steht und Optionen, Lösung und Erklärung schon vorliegen. Die App bewertet selbst. Comeback-Fragen zählen nicht zum Score der Lektion, bringen aber XP (wie eine Prüffrage). Freie Fragen kommen nicht wieder, weil sie ein Urteil von Claude brauchen.
Die Comeback-Fragen überbrücken außerdem den Fall, dass die Vorab-Sitzung doch noch nicht fertig ist.

### 5. Eintragen läuft nebenher

Sobald Claude `abschluss` schickt (Plan durch oder Uhr bei 100 %), trägt die App die Lektion **ohne Knopf** ein (`eintragen`, wie heute: Merkblatt → `kurstutor://done` → Record → `roadmap.py recorded`).
Im Strom erscheint die Meilenstein-Karte: Lektion, Genauigkeit, Zeit, XP, darunter eingeklappt „Gelernt · Noch offen · Zum Nachlesen“, dazu „Merkblatt“ und „Rückgängig“.
Ein Fehler beim Eintragen hält den Strom nicht an: Die Karte zeigt „Nicht eingetragen · Nochmal“.
Statt der großen Feier gibt es je Lektion einen kurzen Konfetti-Stoß und den Ton. Die große Feier kommt erst, wenn er den Strom beendet, als **Rückblick über den ganzen Strom** (Lektionen, Fragen, Genauigkeit, Zeit, XP, Level-Balken).

## Welche Lektion als Nächstes kommt

| Start | Regel |
|---|---|
| Kursseite | Nur dieser Kurs, Lektion für Lektion. Ist dort nichts mehr dran (alles erledigt, Material folgt, Probeklausur), weiter wie von „Diese Woche“. |
| „Diese Woche“ | Erst `reihenfolge()[0]`. Danach **im Kurs bleiben**, solange dort noch Wochenpensum offen ist; ist es geschafft, wechselt der Strom nach `reihenfolge()`. Beim Vorlernen höchstens 3 Lektionen am Stück je Kurs, dann der nächste. Ein Kurswechsel steht als Trennkarte im Strom („Weiter mit Rechnernetze, weil dort noch 2 Lektionen offen sind“, Text aus `warum()`). |
| Nichts mehr zu lernen | Trennkarte „Neuer Stoff ist für heute durch, ab hier wiederholst du“, dann startet der Endloslauf von Wiederholen (`laufStart()`), ohne dass er etwas klicken muss. |

## Was sich am Unterricht ändert und was nicht

- Systemprompt, Schema, Bewertung, Merkblatt und Eintragen bleiben gleich. Claude unterrichtet jede Lektion wie bisher mit Budget, Plan und Schlussrunde. Die Uhr je Lektion braucht Claude zum Dosieren, sie bleibt also, nur sieht Julian sie nicht mehr groß.
- Ein Satz im Startauftrag: `Unendlich-Modus: Nach deinem abschluss geht es ohne Pause mit der nächsten Lektion weiter. Der abschluss-Text ist deshalb ein bis zwei Sätze, keine Verabschiedung.`
- „Lektion beenden“ fällt im Modus weg. Stattdessen gibt es **„Pause“** (Ansicht verlassen, die Lektion bleibt offen und läuft nach Neustart weiter, wie heute) und **„Schluss für heute“**: Ist eine Lektion halb, fragt die App „Lektion jetzt abschließen (mit dem, was durch ist) oder offen lassen?“. Danach der Rückblick.

## Oberfläche

- **Einstieg:** Auf der Karte „Lernen“ (Diese Woche und Kursseite) neben „Los“ ein zweiter Knopf **„∞ Unendlich“**. Menü „Unendlich lernen“ mit ⌘⇧U, Eintrag in der Suche (⌘K). Im Profil eine Einstellung „Lernen startet unendlich“ (Standard aus).
- **Kopf:** statt „Lektion 0012“ der Chip „∞“, die Strom-Uhr (Minuten im Strom), Lektionen im Strom, Combo.
- **Fokus-Leiste:** Die Segmente je Schritt bleiben, links davon kleine Punkte für die schon geschafften Lektionen.
- **Verlauf:** Abgeschlossene Lektionen klappen zu ihrer Meilenstein-Karte zusammen (ein Klick klappt sie auf), damit das DOM klein bleibt. Nur die laufende Lektion ist offen.
- **Rechte Spalte** (außerhalb des Fokus-Modus): „Als Nächstes“ mit der Vorab-Lektion und ihrem Zustand („bereit“ / „wird vorbereitet“).

## Daten

Im Renderer `S.strom = { id, start, kursFest: key|null, abschnitte: [{ kurs, sitzungId, lektion, ergebnis }], falsch: [{ kurs, sitzungId, nr, t, frage, optionen, richtig, erklaerung, wieder: 0 }], vorLernen: { key: n } }`, gespiegelt in `localStorage` (`strom.heute`), damit ein Neuladen den Strom nicht verliert. Die Sitzungen selbst bleiben wie heute in `userData/lernen/<id>.json`. Die Vorab-Sitzung liegt dort auch, mit `zustand: 'vorab'`, und wird nach 12 Stunden ohne Wechsel verworfen.

## Optionen, die ich verworfen oder verschoben habe

- **Eine einzige Claude-Sitzung für alles:** verworfen (Kontext, Kosten, Dosierregeln).
- **Lektionen ganz abschaffen, Claude plant frei über den Stoff:** verworfen. Roadmap, Pensum, Kalender, Merkblätter und Wiederholen hängen an Lektionen.
- **Wiederholen-Aufgaben (ueben.js) zwischen die Lektionen mischen:** verschoben. Bringt viel, braucht aber eine zweite Claude-Sitzung mit eigener Oberfläche im selben Strom. Die Comeback-Fragen leisten den größten Teil davon ohne Modell. Später möglich: alle 2 Lektionen eine Wiederholen-Aufgabe aus dem Kurs, die schon vorab erzeugt wurde.

## Tests

- `tests/lernen.test.mjs` um einen Fall erweitern (Claude-Attrappe `tests/lernen-attrappe.mjs`): Unendlich starten → Lektion A bis 75 % → Vorab-Sitzung B entsteht (zweiter Attrappen-Aufruf mit `--session-id`) → Attrappe schickt `abschluss` → A wird ohne Knopf eingetragen, Meilenstein-Karte da → B rückt ohne Warten in den Strom → erste Antwort in B trägt `[Übergabe]` → eine falsch beantwortete Frage aus A kommt als Comeback-Frage zurück → keine Lektion mehr: Trennkarte und Wechsel in den Endloslauf von Wiederholen.
- `tests/e2e.mjs`: Knopf „∞ Unendlich“ auf beiden Karten, ⌘⇧U.

## Abweichungen bei der Umsetzung

- Keine Profil-Einstellung „Lernen startet unendlich“: Der Modus hat eigene Einstiege (Knopf, ⌘⇧U, Suche).
- Den Kurs der nächsten Lektion wählt die Oberfläche (`kandidaten`), der Hauptprozess wählt nur die Lektion im Kurs (`ziel(c, { ohne })`).
- Kurswechsel stehen als Meldung („Weiter mit …“), nicht als Trennkarte im Verlauf. Die Meilensteine zeigen den Kurs.
- Comeback-Fragen nur für Auswahlfragen; freie Fragen bräuchten ein Urteil von Claude.
- Im Test ist die Wartezeit für Comeback-Fragen 0 (statt 8 Min.).
- Beide Modi teilen sich dieselbe Sitzung je Kurs. Eine halbe Lektion aus dem Strom läuft über „Weiterlernen“ als normale Lektion weiter (wieder mit „Lektion abschließen“), eine normale über „∞ Unendlich“ im Strom. Eine bereitliegende Vorab-Sitzung übernimmt auch der normale Start.

## Nachtrag 22.11.2026: keine Grenzen, keine Uhr

Wunsch von Julian nach der ersten Fassung: Im Strom soll es die Übergänge gar nicht geben, nicht nur ohne Floskeln. Und Claude soll nach Thema weitergehen, wenn er es verstanden hat, nicht nach der Uhr; keine Themen überspringen, um auf die Zeit zu kommen. Umgesetzt:

- **Keine Uhr:** Strom-Lektionen haben kein Budget (`stromRegeln` im Systemprompt, `[Unendlich-Modus]` statt `[Lektionsuhr]`), höchstens 12 Schritte, weiter nach Verständnis, keine Schlussrunde. Vorausgedacht wird nur noch beim letzten Plan-Schritt.
- **Keine Grenze:** Der `abschluss` ist nur die Auflösung der letzten Antwort. Die Lektion verlässt sofort ihren Platz und trägt sich im Hintergrund ein (`hintenEintragen`, `nachtragen`); der Verlauf davor bleibt eingefroren stehen, die nächste Lektion schreibt darunter weiter. Ihr Startauftrag nennt das Thema davor, ohne Gruß, Lektionsnummer oder Ankündigung.
- **Weggefallen:** Meilenstein-Karten, Trennkarte und Kurswechsel-Meldung, Konfetti und Meldung je Lektion, Lektions-Chip, Lektionsuhr, „Als Nächstes“, Comeback als eigene Seite (jetzt eine Fragekarte im Verlauf). Merkblatt und Rückgängig stehen im Rückblick.

