# Lernhub fürs iPhone

Lernen und Wiederholen auch am iPhone. Besonderheit ist der **Leise-Modus** für unterwegs, etwa in Bahn oder Bibliothek. Dort kannst du nicht diktieren und willst nicht viel tippen, also läuft alles über Antippen.

## Wie es zusammenhängt

```
iPhone (Safari-Web-App, src/mobil)
   │  HTTPS im Tailnet: https://<mac>.<tailnet>.ts.net:8443
   ▼
tailscale serve  ──►  http://127.0.0.1:4791  (src/main/handy.js im Hauptprozess der Mac-App)
                                │
                                ├─ dieselben Sitzungen wie am Mac (src/main/lernen.js, ueben.js)
                                └─ claude -p über dein Abo, Skripte von kurs-tutor, iCloud-Ordner
```

- Claude, die Roadmaps und das Material liegen auf dem Mac. Das iPhone ist eine zweite Oberfläche für **dieselben Sitzungen**: Eine Lektion, die du am iPhone anfängst, steht auch am Mac, und umgekehrt.
- Lernhub muss am Mac offen und der Mac wach sein. Auf beiden Geräten muss Tailscale laufen.
- XP, Serie, Quests und Abzeichen bucht weiter die Mac-Oberfläche, sobald eine Sitzung sich meldet. Das iPhone liest `spiel.json` nur.
- Eine native App (Xcode, App Store) gibt es bewusst nicht. Die Web-App vom Home-Bildschirm startet im Vollbild wie eine App und braucht weder Xcode noch ein Entwicklerkonto. Sie ist sofort auf dem Stand des Macs, ohne neu installiert zu werden.

## Einrichten (einmal)

1. Am Mac: Lernhub → Einstellungen → **iPhone** → „Im Tailnet freigeben“. Das führt `tailscale serve --bg --https=8443 http://127.0.0.1:4791` aus und bleibt über Neustarts bestehen. Schlägt es mit einer Meldung zu HTTPS fehl: in der Tailscale-Verwaltung unter DNS „HTTPS Certificates“ einschalten.
2. Am iPhone die Tailscale-App öffnen und verbinden (dasselbe Konto).
3. Am Mac „Link kopieren“. Über Handoff landet er in der Zwischenablage des iPhones. Dort in Safari einsetzen und öffnen.
4. In Safari Teilen → „Zum Home-Bildschirm“.

Der Link enthält einen Schlüssel (`userData/handy.json`). „Neuer Schlüssel“ in den Einstellungen macht alte Links ungültig.

## Leise-Modus

Standardmäßig an. Umschalten oben rechts („Leise“ / „Normal“) oder auf der Startseite. Der Wechsel gilt ab der nächsten Antwort, auch mitten in der Lektion.

| | Leise | Normal |
|---|---|---|
| Fragen beim Lernen | nur Auswahlfragen mit 4 Optionen | Auswahl und freie Fragen |
| Antworten | Option antippen, dann „Wie sicher?“ (der zweite Tipp schickt ab) | wie leise, dazu das Textfeld |
| Freie Frage (falls doch eine kommt) | „Lösung aufdecken“, dann selbst einschätzen: Nein, Teilweise, Ja | Textfeld (Diktieren über die iOS-Tastatur) |
| Rückfragen | Schnellknöpfe: „Einfacher erklären“, „Noch ein Beispiel“, „Warum ist das so?“, „Frage unklar“ … | Knöpfe und Textfeld |
| Wiederholen | Aufgaben mit 4 Optionen; falsch → Hinweis, zweiter Versuch | Feld „Deine Gedanken“ wie am Mac |
| Töne | aus | an (abschaltbar) |

Was Claude bekommt:
- Die Regeln stehen einmal je Sitzung in der ersten Nachricht im Leise-Modus (`LEISE_REGELN` in `src/main/lernen.js` und `src/main/ueben.js`), danach trägt jede Nachricht nur die Marke `[Leise-Modus]`. Beim Ausschalten kommt einmal `[Leise-Modus aus: …]`. Der Systemprompt bleibt unverändert, deshalb geht das Umschalten mitten in einer Sitzung.
- Am Mac geschriebene Nachrichten schalten den Leise-Modus der Sitzung aus: Dort kann man schreiben und diktieren.
- **Selbsteinschätzung** (Lernen, freie Frage): `lernen:aufdecken` zeigt Lösung und Erklärung ohne Zug. Die Antwort `{ selbst: richtig | teils | falsch }` wertet die App wie Claudes Urteil (teils = halber Punkt). Claude erfährt es mit dem nächsten Zug.
- **Wahl beim Wiederholen** (`art: 'wahl'`): Die App bewertet sofort (Richtig/Falsch im Verlauf). Die richtige Option bleibt bis zum Abschluss auf dem Mac. Claude bekommt „Gewählt (Versuch n): B) … → RICHTIG/FALSCH“. Richtig im ersten Versuch → gelöst, falsch → Hinweis, richtig im zweiten Versuch → mit Hinweisen, falsch im zweiten → weiter.

## Was die iPhone-App kann

- **Start:** Spielkarte (Level, Wochenserie, Tages-XP), Karte „Lernen“ mit der Lektion, die nach dem Plan dran ist (gleiche Reihenfolge wie am Mac), Karte „Wiederholen“ (Kurs mit dem höchsten Bedarf), Leise-Schalter, Lernblöcke von heute, Wochenpensum, Realismus-Hinweise.
- **Lernen:** Gespräch mit Plan-Segmenten, Lektionsuhr (läuft nur, solange die Lektion am iPhone zu sehen ist), Combo, Rückschau, „Lektion abschließen“, Feier, „Nächste Lektion →“, Merkblatt im Vollbild, Rückgängig. Menü: Lektion beenden (Rückschau), Abbrechen ohne Eintragen.
- **Wiederholen:** Aufgabe, Hinweise, Abschluss mit Musterlösung. Nach 3 Aufgaben schlägt Lernhub den Kurs mit dem höchsten Bedarf vor. Menü: Runde beenden.
- Lektionen aus dem Unendlich-Modus des Macs laufen am iPhone als einzelne Lektion weiter.
- Ohne Verbindung startet die App trotzdem (Service Worker) und sagt, was fehlt.

## Technik

| Datei | Aufgabe |
|---|---|
| `src/main/handy.js` | HTTP-Server (nur 127.0.0.1), Schlüssel, API, Server-Sent Events, Tailscale-Status und -Freigabe |
| `src/main/main.js` | `handyApi()`: dieselben Funktionen wie die IPC-Kanäle; `an()` schickt `lernen`, `ueben`, `daten:geaendert` und `meldung` auch ans iPhone |
| `src/mobil/` | die App: `index.html`, `app.js`, `mobil.css`, `sw.js`, Symbole |
| `src/ui/js/handy.js` | Karte „iPhone“ in den Einstellungen am Mac |

- **API:** `POST /api/<name>` mit Header `X-Lernhub-Token`: `daten`, `spiel`, `lernen:*` (uebersicht, stand, starten, senden, aufdecken, nochmal, beenden, eintragen, uhr, zurueck), `ueben:*` (uebersicht, stand, starten, senden, verwerfen, nochmal, beenden), `neuLaden`. `GET /api/ereignisse?t=…` ist der Ereignisstrom.
- **Statisch:** `/` und `/m/*` (src/mobil), `/js/{md,bilder,util,regeln}.js` aus der Mac-Oberfläche, `/bs.css` (Farben und Baustein-Styles aus `app.css`), `/klaenge/*.wav`, `/datei/<Pfad>` (Merkblätter, nur im Studienordner, mit Cookie oder `?t=`).
- **Port:** 4791 (`LERNHUB_HANDY_PORT`), im Tailnet 8443. `LERNHUB_HANDY=0` schaltet den Server ab. Im Test läuft er nur mit eigenem Port.
- **Test:** `node tests/handy.test.mjs` (Claude-Attrappe `tests/handy-attrappe.mjs`, stumm). Bildschirmfotos aus iPhone-Sicht mit `E2E_BILDER=<Ordner>`.
