# Sprechstunde: Wiederholen freihändig mit GPT-Live-1.1

Stand 22.11.2026. Konzept und Übergabe-Prompt für ein günstigeres Modell.

## Idee

Ein dritter Weg neben „Lernen“ und „Wiederholen“: Julian redet mit einem Tutor, ohne auf den Bildschirm zu schauen, etwa beim Kochen.
Der Tutor stellt kurze Fragen, hört zu, sagt, was gestimmt hat, erklärt Fehler in zwei, drei Sätzen und fragt dann nach.
Es gilt derselbe Leitner-Stand wie beim Wiederholen (`ueben.py --log`). Was in der Sprechstunde sitzt, ist danach nicht mehr fällig.

## Warum ein RAG nicht nötig ist

Der Stoff je Kurs ist klein und durch `ueben.py` schon nach Themen geordnet (Übersicht + `--thema SLUG`).
Eine Vektorsuche brächte keine Geschwindigkeit, sondern einen zusätzlichen Schritt. Schnell wird das Ganze durch drei Dinge:

1. **Vorbereiten statt live nachschlagen.** Bevor die Sitzung beginnt (am besten schon im Hintergrund, sobald die Kursseite offen ist), baut Lernhub einen **Fragenstapel**:
   Es nimmt die 6–8 fälligen Themen aus der Übersicht, holt deren Stoff mit `--thema` und lässt ein Modell daraus Sprechkarten schreiben.
   Der Stapel liegt dann je Kurs und Tag zwischengespeichert in `userData/sprechstunde/`. Das darf 30–60 s dauern, weil niemand darauf wartet.
2. **Der Stoff steht schon im Kontext.** Während der Sitzung schiebt die App die aktuelle und die nächste Karte still per `session.thinking.append` in das Live-Modell.
   Damit kann GPT-Live fragen, bewerten und erklären, ohne den Backend-Umweg zu nehmen. Laut OpenAI liegt die Antwortzeit dann bei etwa 0,8 s.
3. **Delegation nur für Nebensachen und Tiefgang.** Das Ergebnis eintragen und die nächste Karte holen sind lokale Funktionen, die in Millisekunden laufen.
   Nur wenn Julian über die Karte hinaus fragt („Erklär mir das genauer“), schlägt ein schnelles Backend-Modell (`gpt-6-luna`, wenig Reasoning, `service_tier: "priority"`) im Stoff des Themas nach.
   GPT-Live überbrückt diese Zeit mit einem kurzen „Moment“.

## Architektur

```
Oberfläche (Renderer)                 Hauptprozess (main)                     OpenAI
  Mikro + Lautsprecher (WebRTC)  ──SDP──▶ POST /v1/live/sessions (API-Key) ──▶ gpt-live-1.1
  Datenkanal „oai-events“  ◀────────── Events ──────────────────────────────── (Delegation: gpt-6-luna)
  zeigt: hört zu / spricht /            Fragenstapel (claude -p, Cache)
         Thema / Untertitel             Funktionen: karte_abschliessen,
                                        naechste_karte, stoff_nachschlagen
                                        → ueben.py --log / --thema
```

- Der OpenAI-Schlüssel liegt wie der Deepgram-Schlüssel nur im Hauptprozess (safeStorage, `schluessel.js` verallgemeinern).
- WebRTC läuft im Renderer (Electron kann `getUserMedia` und `RTCPeerConnection`). Mit `echoCancellation: true`, damit der Tutor sich nicht selbst hört, wenn der Mac über Lautsprecher spielt.
- Die Funktionsaufrufe kommen über den Datenkanal. Der Renderer reicht sie per IPC an `main` weiter, `main` führt sie aus und gibt das Ergebnis zurück.

## Wie der Tutor spricht (anders als der Text im Wiederholen)

- Immer nur eine Frage, höchstens zwei Sätze. Nie Listen, Tabellen, Code oder Formeln vorlesen. Formeln werden ausgesprochen, Code wird beschrieben („die Funktion, die …“).
- Er lässt Denkpausen und Küchengeräusche stehen und fällt nicht ins Wort.
- Richtig: kurz bestätigen und das Entscheidende nennen, dann die nächste Frage. Kein Dauerlob.
- Teilweise richtig: sagen, was stimmte, und mit einem Hinweis nachfragen (Hinweisleiter R1–R3 gesprochen).
- Falsch oder „weiß ich nicht“: die richtige Antwort plus 2–3 Sätze Erklärung, dann eine Nachfrage in eigenen Worten („Sag’s mir nochmal in einem Satz“). Danach gilt die Karte als `hinweise` oder `aufgegeben`.
- Sprachbefehle: „Pause“, „Nochmal“, „Weiß ich nicht“, „Erklär genauer“, „Weiter“, „Schluss für heute“. Am Ende sagt er in einem Satz, was saß und was morgen wiederkommt.

## Kosten

$0,05 pro Minute aktive Sitzung (Standby $0,02), dazu ein wenig Backend. 30 Minuten Kochen kosten also rund 1,50 $.
Die Karten erstellt `claude -p` über das Abo, das kostet nichts extra.

## Was Julian vorher braucht

- Einen OpenAI-API-Schlüssel mit Zugriff auf GPT-Live (platform.openai.com). Er wird in den Einstellungen eingetragen wie der Deepgram-Schlüssel.

---

## Übergabe-Prompt

> Kopieren und dem umsetzenden Modell geben (im Ordner `~/Projekte/lernhub-app`).

```
Du arbeitest in ~/Projekte/lernhub-app (Electron-App „Lernhub“, Deutsch, kein Framework, Node-Tests unter tests/).
Baue einen neuen Modus „Sprechstunde“: freihändiges Wiederholen per Sprache mit OpenAI GPT-Live-1.1.
Konzept: docs/sprechstunde.md (zuerst lesen). API-Doku: docs/gpt-live/delegation.md, dazu online
https://developers.openai.com/api/docs/guides/live.md, .../voice-webrtc.md?api=live, .../live-prompting.md,
.../live-conversations.md (Events, Transkripte, Standby, session.close). Halte dich an Eventnamen und Felder aus der Doku, rate keine.

Lies vorher, wie es heute läuft, und übernimm Stil und Muster:
- src/main/ueben.js (Wiederholen: Sitzung je Kurs, Verlauf in userData, ueben.py --log trägt Ergebnisse ein, zeitBuchen)
- src/main/schluessel.js + src/main/deepgram.js (Schlüssel nur im Hauptprozess, safeStorage)
- src/main/main.js + src/main/preload.js (IPC), src/ui/js/ueben.js + src/ui/js/ansichten.js (wo „Wiederholen“ als Knopf sitzt)
- ~/.claude/skills/kurs-tutor/scripts/ueben.py --help (Übersicht, --thema, --log, --zeit)
Achtung: Im Arbeitsbaum liegen noch nicht committete Änderungen aus einer anderen Sitzung. Nicht zurücksetzen, nur ergänzen.

Umsetzen:
1. Schlüssel: schluessel.js so verallgemeinern, dass es einen zweiten Schlüssel „openai“ gibt (eigene Datei, gleiches Verfahren,
   testen() gegen GET https://api.openai.com/v1/models). Eintrag in den Einstellungen neben Deepgram.
2. src/main/sprechstunde.js:
   a) Fragenstapel bauen: ueben.py <WS> (Übersicht) → die ersten 6–8 fälligen Themen → je Thema ueben.py <WS> --thema SLUG →
      EIN claude -p-Aufruf (Muster wie ueben.js, --json-schema, Modell sonnet, effort low) erzeugt Karten:
      { thema, frage (gesprochen, ≤ 2 Sätze), kernpunkte [2–4 kurze Punkte], typischer_fehler, erklaerung (≤ 3 Sätze, sprechbar,
      ohne Code/Formelzeichen), nachfrage }. Cache: userData/sprechstunde/<kurs>-<datum>.json. Vorbereiten startet im Hintergrund,
      sobald die Kursseite oder „Diese Woche“ offen ist; der Start der Sitzung wartet nur, wenn noch kein Stapel da ist.
   b) Sitzung anlegen: IPC „sprechstunde:verbinden“ nimmt das SDP-Angebot des Renderers, ruft POST https://api.openai.com/v1/live/sessions
      mit fetch auf (kein SDK nötig) und gibt die SDP-Antwort zurück. session: model "gpt-live-1.1", instructions = Tutor-Prompt (unten),
      Sprache Deutsch, delegation type "responses" mit model "gpt-6-luna", reasoning effort niedrig, service_tier "priority",
      backend-instructions (kurz: „Du hilfst einem Sprach-Tutor. Schlag im Stoff nach und antworte in höchstens drei gesprochenen Sätzen.“),
      tools = drei Funktionen:
        - karte_abschliessen(thema, ergebnis: geloest|hinweise|aufgegeben, stufe: R0–R5) → ueben.py --log; gibt die nächste Karte als Text zurück
        - naechste_karte() → nächste Karte aus dem Stapel (ist er leer: „Vorgriff“ aus der Übersicht nachladen oder Schluss melden)
        - stoff_nachschlagen(thema, frage) → Auszug aus ueben.py --thema (gekürzt auf ~1500 Zeichen)
      Funktionsaufrufe so beantworten, wie delegation.md es beschreibt (response.output_item.done lesen, function_call_output per
      response.item.create, dann response.create).
   c) Kontext: Nach session.started die erste und zweite Karte per session.thinking.append schicken (natürliche Sprache, kein JSON,
      je Append < 500 Tokens). Nach jedem karte_abschliessen die übernächste nachschieben, damit immer eine Karte vorrätig ist.
   d) Verlauf je Sitzung in userData/sprechstunde/<id>.json (Karten, Ergebnisse, Transkript aus session.input_transcript.delta /
      session.output_transcript.delta), Lernzeit wie in ueben.js über ueben.py --zeit buchen. Bei session.close sauber auf session.closed warten.
3. Oberfläche src/ui/js/sprechstunde.js + Knopf „Sprechstunde“ neben „Wiederholen“ (Kursseite und „Diese Woche“):
   Vollbild-Ansicht mit großem Zustandskreis (verbindet / hört zu / spricht / sucht nach), aktuellem Thema, Zähler (3 von 8),
   ein-/ausblendbaren Untertiteln, großen Knöpfen „Pause“ und „Beenden“. Leertaste = Pause. Während der Sitzung
   powerSaveBlocker („prevent-display-sleep“) im Hauptprozess. getUserMedia mit echoCancellation, noiseSuppression, autoGainControl.
   Pause = Mikrofon stummschalten und Standby nutzen, falls die Doku das für WebRTC hergibt (live-conversations.md, „configure standby“).
   Am Ende Karte mit Ergebnis je Thema; Ergebnisse fließen in XP/Serie wie beim Wiederholen (src/ui/js/spiel.js ansehen).
4. Tutor-Prompt (session.instructions, auf Deutsch, Struktur aus live-prompting.md mit den Überschriften Backchannel policy,
   Interruption policy, Delegation policy beibehalten):
   - Rolle: ruhiger, freundlicher Privatlehrer für den Kurs „<Kurs>“, duzt, spricht natürlich und unaufgeregt.
   - Ablauf: Frage aus der aktuellen Karte stellen (in eigenen Worten, kurz). Antwort mit den Kernpunkten vergleichen.
     Richtig → ein Satz Bestätigung mit dem Entscheidenden, dann karte_abschliessen(geloest).
     Teilweise → sagen, was stimmte, einen Hinweis geben, nochmal fragen (höchstens zwei Hinweise).
     Falsch/„weiß ich nicht“ → richtige Antwort und Erklärung aus der Karte, dann die Nachfrage; danach karte_abschliessen(hinweise oder aufgegeben).
   - Nie Listen, Code, Tabellen oder Formelzeichen vorlesen. Immer nur eine Frage.
   - Geduld: Denkpausen und Hintergrundgeräusche (Kochen, Wasser, Musik) abwarten, nicht als neue Frage werten.
   - Backchannel policy: selten, ein leises „mhm“ an natürlichen Pausen, neutral zur Richtigkeit.
   - Interruption policy: bei Unterbrechung sofort aufhören und zuhören; „Stopp“, „Warte“, „Pause“ sofort befolgen.
   - Delegation policy: an das Backend geben, wenn eine Karte abgeschlossen wird, die nächste fehlt oder eine Frage über die Karte hinausgeht.
     Nicht delegieren für Fragen, Bewertung und Erklärung, die die Karte abdeckt. Ergebnis nie raten, solange das Backend sucht.
   - Sprachbefehle: Pause, Nochmal, Weiß ich nicht, Erklär genauer, Weiter, Schluss. Bei Schluss ein Satz Bilanz, dann aufhören.
5. Tests (npm test muss grün bleiben): tests/sprechstunde.test.mjs für Kartenbau (mit claude-Attrappe über LERNHUB_CLAUDE wie in
   tests/ueben.test.mjs), Session-Konfiguration (Modell, Tools, Prompt enthält die drei Policy-Überschriften), Funktions-Dispatch
   (karte_abschliessen ruft ueben.py --log mit den richtigen Argumenten) und das Nachschieben der Karten. Im Test nie das Netz rufen:
   fetch für api.openai.com per Umgebungsvariable auf eine Attrappe umleiten. In package.json "test" ergänzen.
6. README: kurzer Abschnitt „Sprechstunde“ (Schlüssel eintragen, Kosten ~0,05 $/min).

Schreib keinen Schlüssel in Logs, Dateien oder die Oberfläche. Wenn ein Detail der Live-API in der Doku anders steht als hier,
gilt die Doku; vermerke die Abweichung am Ende. Nicht committen. Zum Schluss: was gebaut ist, was getestet ist, was Julian
mit echtem Schlüssel selbst ausprobieren muss.
```
