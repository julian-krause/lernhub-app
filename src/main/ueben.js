// Üben („Wiederholen“ auf „Diese Woche“ und auf der Kursseite): Übungssitzung über alle erledigten Lektionen eines Kurses, nach dem
// Übungsmodus der LearnHarness-App (Protokoll aus learnharness-abo: src/agent/tools/practice.ts,
// prompts/practice/00-base.md; Doktrin ~/.claude/skills/learnharness/references/ueben.md).
//
//   - Jeder Zug ist ein `claude -p`-Aufruf. Der erste legt die Sitzung an (--session-id), alle weiteren setzen sie
//     fort (--resume). Statt der LearnHarness-Werkzeuge `problem` und `conclude` antwortet Claude im festen Schema
//     unten (--json-schema): art "aufgabe" (= problem), "abschluss" (= conclude), "text" (Hinweis, Urteil,
//     Antwort in der Pause, Rundenende). Die Musterlösung legt Claude mit der Aufgabe fest; die Oberfläche
//     zeigt sie erst beim Abschluss.
//   - Wie in LearnHarness gibt es nur ein Eingabefeld „Deine Gedanken“: Ob der Lernende eine Antwort abgibt,
//     liest Claude aus dem Text. In der Pause: Fragen als normale Nachricht, „Nächste Aufgabe“ als eigenes
//     Signal. Verwerfen (Esc) startet keinen Zug; Claude erfährt es mit der nächsten Nachricht.
//   - Claude darf nur lesen und ueben.py aufrufen (Übersicht, Stoff je Thema). Das Ergebnis jeder Aufgabe trägt
//     Lernhub selbst ein (ueben.py --log), damit Fälligkeit und Lücken nicht vom Modell abhängen.
//   - Eine Sitzung je Kurs; der Verlauf liegt in userData/ueben/<sitzung>.json, nach einem Neustart geht es weiter.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const P = require('./pfade');
const B = require('./bruecke');
const { KATALOG } = require('./bausteine');

const MODELL = process.env.LERNHUB_UEBEN_MODELL || 'opus';
const EFFORT = process.env.LERNHUB_UEBEN_EFFORT || 'medium';
const FRIST = 6 * 60000;                 // ein Zug
const DOKTRIN = path.join(P.HOME, '.claude/skills/learnharness/references/ueben.md');
const REGELN = path.join(P.SKILL, 'UEBEN.md');

const SCHEMA = {
  type: 'object',
  properties: {
    art: { type: 'string', enum: ['aufgabe', 'abschluss', 'text'] },
    text: { type: 'string', description: 'aufgabe: höchstens eine kurze Zeile Orientierung davor, sonst leer. abschluss: deine Schlussworte zu seiner Arbeit (kurz). text: Hinweis-Sprosse, Urteil zu einer beanspruchten Antwort, Antwort auf eine Frage oder Abschluss der Runde.' },
    aufgabe: { type: 'string', description: 'aufgabe: der Aufgabentext, den der Lernende sieht. Steht für sich, nennt nie das Ziel.' },
    modus: { type: 'string', enum: ['abruf', 'unterscheidung', 'verknuepfung'] },
    thema: { type: 'string', description: 'aufgabe: Thema-Schlüssel genau wie in der Übersicht von ueben.py (z. B. git-referenzen oder L3).' },
    musterloesung: { type: 'string', description: 'aufgabe: deine selbst ausgearbeitete Lösung, Züge in Reihenfolge. Bleibt bis zum Abschluss verborgen und wird dann wörtlich gezeigt.' },
    ergebnis: { type: 'string', enum: ['geloest', 'hinweise', 'weiter', 'aufgegeben'], description: 'abschluss: geloest = ohne Hinweis (höchstens R1), hinweise = mit Hinweisen gelöst, weiter = du bist weitergegangen, aufgegeben = der Lernende hat aufgegeben.' },
    urteil: { type: 'string', description: 'abschluss: was angerechnet wurde bzw. wo es brach (bei falsch verorten, nicht korrigieren).' },
    stufe: { type: 'string', enum: ['keine', 'R0', 'R1', 'R2', 'R3', 'R4', 'R5'], description: 'abschluss: höchste Hinweis-Sprosse, die nötig war. text: die Sprosse, falls der Text ein Hinweis ist.' },
    fehlerart: { type: 'string', enum: ['keine', 'Abruf', 'Verwechslung', 'Ausführung', 'Flüchtigkeit', 'strukturell'] },
    wiederholen: { type: 'boolean', description: 'abschluss: in dieser Runde in neuer Oberfläche erneut prüfen.' },
  },
  required: ['art', 'text'],
};

// Lernende Eingaben → Nachricht an Claude (Wortlaut wie in LearnHarness, auf Deutsch)
const NAECHSTE = '[NÄCHSTE AUFGABE] Das ausdrückliche Go des Lernenden: Stell jetzt die nächste Aufgabe nach den Auswahlregeln. Die Runde endet nie von dir aus, nur der Lernende beendet sie. Ist nichts mehr fällig, nimm aus der Übersicht (ueben.py, Abschnitt „Vorgriff“) das Thema, das als Nächstes fällig wird, und prüf es eine Stufe schwerer oder im nächsten Modus.';
const EINGABE = {
  denken: (t) => `Deine Gedanken:\n${t}`,          // „Your thinking“ – ob es eine Antwort ist, steht im Text
  text: (t) => t,                                     // Pause: Frage, Bitte, Steuerung
  weiter: () => NAECHSTE,
};
const VERWORFEN = '[SYSTEMHINWEIS] Der Lernende hat die offene Aufgabe verworfen, ohne die Lösung zu sehen. Sie ist damit abgeschlossen wie mit conclude(outcome "dismissed"): als volles Aufgeben werten und später in neuer Form erneut prüfen, falls sie wichtig war. Nicht weiter kommentieren; die Pause gilt.';

function lies(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }

function systemPrompt(s) {
  const regeln = lies(REGELN), doktrin = lies(DOKTRIN);
  return `Du bist der Agent einer Lernumgebung und führst in der Mac-App Lernhub eine Übungssitzung für den Kurs „${s.kursName}“. Dein Job: gehaltenes Wissen soll von selbst einfallen und laufen. Der Lernende übt alle bisherigen Inhalte des Kurses. Antworte auf Deutsch.

## Mechanik (statt der LearnHarness-Werkzeuge problem und conclude)

Du antwortest IMMER im JSON-Schema, eine Antwort je Zug.

- **art "aufgabe"** = das Werkzeug problem. Jede Aufgabe, von der ersten bis zur letzten, läuft so; eine Aufgabe als Fließtext in "text" ist ein Protokollbruch. Löse die Aufgabe vorher selbst und such Abkürzungen: musterloesung ist deine ausgearbeitete Lösung, keine Hoffnung. "aufgabe" ist der Aufgabentext, den der Lernende sieht; "text" höchstens eine kurze Zeile Orientierung, sonst leer. modus, thema und musterloesung sind Pflicht. Der Zug endet damit. Nur eine Aufgabe ist zur Zeit offen.
- Der Lernende arbeitet dann in einem Feld; jede Einsendung kommt als Nachricht „Deine Gedanken:“. Ob sie eine Antwort beansprucht, steht IM TEXT, nirgends sonst. Lies es:
  * Arbeitsstand (mittendrin, festgefahren, Bitte um Schubs): Hinweisleiter, eine Sprosse pro Bitte → art "text", stufe = die Sprosse.
  * Beanspruchte Antwort: Züge herauslesen, Urteil geben. Falsch → art "text" mit Urteil und erstem Bruch, ohne Korrektur; die Aufgabe bleibt offen. Richtig → art "abschluss".
- **art "abschluss"** = das Werkzeug conclude: ergebnis, urteil, stufe, fehlerart, wiederholen. Die Musterlösung, die du beim Stellen festgelegt hast, sieht der Lernende danach wörtlich; du schreibst sie nicht neu. "text" = deine Schlussworte zu seiner Arbeit. Danach keine neue Aufgabe im selben Zug.
- **Die Pause.** Nach jedem Abschluss: Fragen zur letzten Aufgabe beantwortest du gründlich, aber gezielt (art "text"), ohne neu zu unterrichten, und stellst am Ende nie eine Aufgabe. Die nächste Aufgabe kommt NUR auf „${NAECHSTE.slice(0, 18)}“ oder wenn er in eigenen Worten die nächste will; dann stellst du sie nach den Auswahlregeln. Du schließt die Runde nie von dir aus ab; ist nichts mehr fällig, ziehst du die Themen vor, die als Nächstes fällig werden. Eine Rückfrage ist nie das Go.
- **Verwerfen.** Ein [SYSTEMHINWEIS] meldet, dass der Lernende eine Aufgabe verworfen hat: wie ein Abschluss mit Aufgeben behandeln, nicht kommentieren, die Pause gilt.
- **Formatierung** in "text", "aufgabe", "urteil" und "musterloesung": schlichtes Markdown (**fett**, \`code\`, Codeblöcke mit \`\`\` nur für Programmcode, Befehle und Ausgaben, Rechnungen im Baustein rechnung, Listen mit "- "), keine Tabellen, keine Überschriften, keine LaTeX-Formeln (die App rendert sie nicht; Formeln als Text wie a² + b²). Bausteine (Abschnitt unten) nur in "text", "urteil" und "musterloesung", nie in "aufgabe": Die Aufgabe prüft, ob er die Struktur selbst findet. Einzige Ausnahme: Zahlen, mit denen er rechnen soll, darf die Aufgabe als rechnung zeigen (gesuchte Stellen mit „?“).
- **Material:** Bash nur für python3 ${P.SCRIPTS}/ueben.py "${s.ws}" (Übersicht, Reihenfolge) und python3 ${P.SCRIPTS}/ueben.py "${s.ws}" --thema <Thema> (Stoff aus den erledigten Lektionen). Lektionsdateien darfst du lesen (Read). Wenn dir eine Tatsache für Aufgabe oder Musterlösung unsicher ist, prüf sie im Stoff, bevor du stellst. Ergebnisse trägt die App selbst ein: --log rufst du nie auf.

${KATALOG}

${regeln ? '## Kursregeln (aus kurs-tutor UEBEN.md)\n\n' + regeln + '\n\n' : ''}## Doktrin (LearnHarness „Üben“)

${doktrin}`;
}

function startText(uebersicht) {
  return `[Uni-Übung] Sitzungskontext aus dem Lernhub (eingefügt, nicht vom Lernenden geschrieben).
Freies Üben über den bisher gelernten Stoff. Übersicht der Themen (ueben.py):

${uebersicht}

Lass uns üben: Stell mir Aufgaben zu dem, was ich in diesem Kurs schon gelernt habe.`;
}

class Ueben {
  constructor({ ordner, beiStand, beiEnde }) {
    this.ordner = ordner;               // userData/ueben
    this.beiStand = beiStand;           // (sitzung) → Oberfläche
    this.beiEnde = beiEnde || (() => {});
    this.sitzungen = new Map();         // ws → Sitzung
    this.kinder = new Map();            // id → Kindprozess
    this.laden();
  }

  datei(s) { return path.join(this.ordner, `${s.id}.json`); }
  speichern(s) {
    try { fs.mkdirSync(this.ordner, { recursive: true }); fs.writeFileSync(this.datei(s), JSON.stringify(s, null, 1)); } catch (e) { console.error(e); }
  }
  laden() {
    try {
      const grenze = Date.now() - 30 * 86400000;
      for (const f of fs.readdirSync(this.ordner)) {
        if (!f.endsWith('.json')) continue;
        const p = path.join(this.ordner, f);
        if (fs.statSync(p).mtimeMs < grenze) { fs.unlinkSync(p); continue; }
        const s = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (s.zustand === 'beendet') continue;
        if (s.zustand === 'denkt') { s.zustand = 'fehler'; s.fehler = 'Lernhub wurde beendet, während Claude antwortete.'; }
        const alt = this.sitzungen.get(s.ws);
        if (!alt || alt.start < s.start) this.sitzungen.set(s.ws, s);
      }
    } catch { }
  }

  // Übungszeit fürs Dashboard: je Aufgabe die Zeit seit der letzten Buchung, höchstens 10 Min. (Leerlauf zählt nicht)
  zeitSek(s, t = Date.now()) {
    const sek = Math.ceil(Math.min(t - (s.zeitAb || s.start), 600000) / 1000);
    s.zeitAb = t;
    return Math.max(0, sek);
  }
  async zeitBuchen(s) {
    const sek = this.zeitSek(s);
    if (sek < 1) return;
    try { await B.lauf(P.PYTHON, [B.skript('ueben.py'), s.ws, '--zeit', String(sek)], { timeout: 30000 }); } catch (e) { console.error(e); }
  }

  offeneAufgabe(s) { return [...s.verlauf].reverse().find((v) => v.art === 'aufgabe' && v.offen) || null; }

  // Für die Oberfläche: ohne Musterlösung und Thema der offenen Aufgabe
  sicht(s) {
    if (!s) return null;
    const { letzterAuftrag, vormerken, ...rest } = s;
    rest.verlauf = s.verlauf.map((e) => {
      if (e.art === 'aufgabe' && e.offen) { const { musterloesung, thema, ...r } = e; return r; }
      return e;
    });
    return rest;
  }
  melden(s) { this.speichern(s); this.beiStand(this.sicht(s)); }
  fuer(ws) { return this.sicht(this.sitzungen.get(P.nfc(ws))); }

  // c: { key, name, ws }
  async starten(c, sem) {
    if (!P.CLAUDE) return { ok: false, text: 'claude nicht gefunden (~/.local/bin/claude).' };
    if (process.env.LERNHUB_TEST && !process.env.LERNHUB_CLAUDE) return { ok: false, text: 'Im Test nur mit claude-Attrappe (LERNHUB_CLAUDE).' };
    if (!P.unterRoot(c.ws)) return { ok: false, text: 'Lernbereich liegt nicht im Studienordner.' };
    const ws = P.nfc(c.ws);
    const alt = this.sitzungen.get(ws);
    if (alt && alt.zustand === 'denkt') return { ok: false, text: 'Claude arbeitet gerade an dieser Runde.' };
    if (alt) this.beenden(ws);
    const s = {
      id: crypto.randomUUID(), sessionId: crypto.randomUUID(), gestartet: false,
      kurs: c.key, kursName: c.name || c.key, ws, sem, start: Date.now(),
      zustand: 'denkt', fehler: null, verlauf: [], vormerken: '',
      stat: { aufgaben: 0, geloest: 0, hinweise: 0, weiter: 0, aufgegeben: 0, verworfen: 0 },
    };
    this.sitzungen.set(ws, s);
    this.melden(s);
    let uebersicht = '';
    try { uebersicht = (await B.lauf(P.PYTHON, [B.skript('ueben.py'), ws], { timeout: 30000 })).trim(); }
    catch (e) { uebersicht = '(Übersicht nicht verfügbar: ' + e.message + ')'; }
    s.uebersicht = uebersicht.split('\n')[0];
    this.zug(s, startText(uebersicht));
    return { ok: true, id: s.id };
  }

  // art: denken (Feld „Deine Gedanken“ bei offener Aufgabe) | text (Pause) | weiter (Nächste Aufgabe)
  senden(ws, art, text = '') {
    const s = this.sitzungen.get(P.nfc(ws));
    if (!s) return { ok: false, text: 'Keine Übungsrunde offen.' };
    if (s.zustand === 'denkt') return { ok: false, text: 'Claude antwortet noch.' };
    if (!EINGABE[art]) return { ok: false, text: 'Unbekannte Eingabe.' };
    text = String(text || '').trim().slice(0, 6000);
    const offen = this.offeneAufgabe(s);
    if (art === 'denken' && !offen) art = 'text';
    if (art === 'weiter' && offen) return { ok: false, text: 'Erst die offene Aufgabe abschließen oder verwerfen.' };
    if (art !== 'weiter' && !text) return { ok: false, text: 'Erst etwas schreiben.' };
    s.verlauf.push({ von: 'ich', art, text, t: Date.now() });
    const vor = s.vormerken ? s.vormerken + '\n\n' : '';
    s.vormerken = '';
    this.zug(s, vor + EINGABE[art](text));
    return { ok: true };
  }

  // Esc: offene Aufgabe ohne Lösung verwerfen. Kein Zug; Claude erfährt es mit der nächsten Nachricht.
  verwerfen(ws) {
    const s = this.sitzungen.get(P.nfc(ws));
    const a = s && this.offeneAufgabe(s);
    if (!a || s.zustand === 'denkt') return { ok: false };
    a.offen = false;
    s.verlauf.push({ von: 'claude', art: 'abschluss', ergebnis: 'verworfen', t: Date.now(), nr: a.nr });
    s.stat.verworfen++;
    this.zeitBuchen(s);
    s.vormerken = VERWORFEN;
    this.melden(s);
    return { ok: true };
  }

  // Letzten Zug wiederholen, wenn er mit Fehler endete
  nochmal(ws) {
    const s = this.sitzungen.get(P.nfc(ws));
    if (!s || s.zustand !== 'fehler' || !s.letzterAuftrag) return { ok: false };
    this.zug(s, s.letzterAuftrag);
    return { ok: true };
  }

  beenden(ws) {
    const s = this.sitzungen.get(P.nfc(ws));
    if (!s) return { ok: false };
    const k = this.kinder.get(s.id);
    if (k) k.kill('SIGTERM');
    const rest = this.offeneAufgabe(s) ? this.zeitBuchen(s) : null;     // angefangene Aufgabe zählt mit
    s.zustand = 'beendet'; s.ende = Date.now();
    this.melden(s);
    this.sitzungen.delete(P.nfc(ws));
    if (s.stat.aufgaben) Promise.resolve(rest).then(() => this.beiEnde(s));
    return { ok: true };
  }

  zug(s, auftrag) {
    s.zustand = 'denkt'; s.fehler = null; s.letzterAuftrag = auftrag; s.seit = Date.now();
    this.melden(s);
    const args = ['-p', '--model', MODELL, '--effort', EFFORT, '--output-format', 'json',
      '--json-schema', JSON.stringify(SCHEMA), '--setting-sources', '', '--strict-mcp-config',
      '--permission-mode', 'dontAsk', '--add-dir', s.ws,
      '--allowedTools', 'Read', 'Glob', 'Grep', `Bash(python3 ${P.SCRIPTS}/ueben.py *)`, `Bash(/usr/bin/python3 ${P.SCRIPTS}/ueben.py *)`,
      '--disallowedTools', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'];
    if (s.gestartet) args.push('--resume', s.sessionId);
    else args.push('--session-id', s.sessionId, '--append-system-prompt', systemPrompt(s));
    const env = { ...process.env, PATH: [path.dirname(P.CLAUDE), '/usr/bin', '/bin', '/usr/sbin', '/sbin', '/opt/homebrew/bin'].join(':') };
    delete env.ANTHROPIC_API_KEY;                // über das Abo
    delete env.ELECTRON_RUN_AS_NODE;
    env.LERNHUB_HINTERGRUND = '1';
    const kind = spawn(P.CLAUDE, args, { cwd: s.sem, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.kinder.set(s.id, kind);
    kind.stdin.end(auftrag);
    let out = '', err = '';
    const timer = setTimeout(() => { s.zeitUm = true; kind.kill('SIGTERM'); }, FRIST);
    kind.stdout.on('data', (b) => { out += b; });
    kind.stderr.on('data', (b) => { err = (err + b).slice(-2000); });
    kind.on('error', (e) => { err = e.message; });
    kind.on('close', async (code) => {
      clearTimeout(timer);
      this.kinder.delete(s.id);
      if (s.zustand === 'beendet') return;
      let d = null, x = null;
      try { d = JSON.parse(out); x = d.structured_output || (typeof d.result === 'string' ? JSON.parse(d.result) : null); } catch { }
      if (d && d.session_id) s.gestartet = true;       // Sitzung existiert, auch wenn der Zug scheiterte
      if (!x || !x.art || (d && d.is_error)) {
        s.zustand = 'fehler';
        s.fehler = s.zeitUm ? 'Claude hat zu lange gebraucht.' : ((d && typeof d.result === 'string' && d.result) || err.trim().split('\n').slice(-2).join(' ') || `claude endete mit Code ${code}`).slice(0, 300);
        s.zeitUm = false;
        return this.melden(s);
      }
      try { await this.verarbeiten(s, x); } catch (e) { console.error(e); }
      s.zustand = 'bereit';
      this.melden(s);
    });
  }

  async verarbeiten(s, x) {
    const offen = this.offeneAufgabe(s);
    const t = Date.now();
    if (x.art === 'aufgabe' && String(x.aufgabe || '').trim()) {
      if (offen) offen.offen = false;            // sollte nicht vorkommen: Claude stellt erst nach dem Abschluss neu
      if (String(x.text || '').trim()) s.verlauf.push({ von: 'claude', art: 'text', text: x.text.trim(), t });
      s.stat.aufgaben++;
      s.verlauf.push({ von: 'claude', art: 'aufgabe', offen: true, nr: s.stat.aufgaben, aufgabe: x.aufgabe.trim(),
        modus: x.modus || '', thema: x.thema || '', musterloesung: String(x.musterloesung || '').trim(), t });
      return;
    }
    if (x.art === 'abschluss' && offen) {
      if (String(x.text || '').trim()) s.verlauf.push({ von: 'claude', art: 'text', text: x.text.trim(), t });
      let erg = x.ergebnis || 'geloest';
      const stufe = x.stufe && x.stufe !== 'keine' ? x.stufe : null;
      if (erg === 'geloest' && stufe && +stufe.slice(1) >= 2) erg = 'hinweise';     // ab R2 nicht mehr „ohne Hinweis“
      offen.offen = false;
      const e = { von: 'claude', art: 'abschluss', nr: offen.nr, ergebnis: erg, urteil: String(x.urteil || '').trim(),
        stufe, fehlerart: x.fehlerart && x.fehlerart !== 'keine' ? x.fehlerart : null, wiederholen: !!x.wiederholen,
        thema: offen.thema, modus: offen.modus, musterloesung: offen.musterloesung, t };
      s.stat[erg] = (s.stat[erg] || 0) + 1;
      if (offen.thema) {
        const log = erg === 'weiter' ? 'aufgegeben' : erg;
        const args = [B.skript('ueben.py'), s.ws, '--log', offen.thema, log, '--zeit', String(this.zeitSek(s, t))];
        if (stufe) args.push('--stufe', stufe);
        if (offen.modus) args.push('--modus', offen.modus);
        try { e.log = (await B.lauf(P.PYTHON, args, { timeout: 30000 })).trim(); } catch (err) { e.log = '⚠️ nicht eingetragen: ' + err.message; }
      }
      else await this.zeitBuchen(s);
      s.verlauf.push(e);
      return;
    }
    // Hinweis, Urteil, Antwort in der Pause, Rundenabschluss – oder ein Abschluss ohne offene Aufgabe
    const text = String(x.text || x.urteil || x.aufgabe || '').trim();
    if (text) s.verlauf.push({ von: 'claude', art: 'text', text, stufe: x.stufe && x.stufe !== 'keine' ? x.stufe : null, t });
  }
}

module.exports = { Ueben, SCHEMA, systemPrompt, EINGABE };
