// Lernen: die nächste Lektion der Roadmap im Gespräch lernen (Karte „Lernen“ auf „Diese Woche“ und auf der Kursseite), nach dem
// Lehrmodus der LearnHarness-App in der Kompakt-Fassung für Uni-Lektionen (learnharness-abo: src/agent/uni-budget.ts,
// prompts/teacher/*). Regeln: kurs-tutor LERNEN.md, Stoff und Ablage: scripts/lernen.py.
//
//   - Jeder Zug ist ein `claude -p`-Aufruf (erster mit --session-id, danach --resume), Antwort im festen Schema:
//     art "frage" (Auflösung + ein Schritt Unterricht + genau eine Frage), "text" (Antwort auf eine Rückfrage),
//     "abschluss" (Rückschau und Kern je Schritt fürs Merkblatt).
//   - Auswahlfragen bewertet Lernhub selbst und zeigt Lösung und Erklärung sofort; freie Antworten bewertet Claude
//     im nächsten Zug (Feld bewertung). Vorhersagen zählen nicht zum Score und werden erst mit Claudes Auflösung
//     aufgedeckt.
//   - Jede Nachricht des Lernenden trägt die Lektionsuhr („[Lektionsuhr: x von B Min.]“): Das Budget ist die
//     Schätzung der Roadmap.
//   - „Lektion abschließen“ trägt die Lektion in der Roadmap ein: Merkblatt (lessons/<ID>-….html, daraus übt
//     „Wiederholen“) → kurstutor://done → Learning Record → roadmap.py recorded. Claude schreibt nichts.
//   - Eine Sitzung je Kurs; der Verlauf liegt in userData/lernen/<sitzung>.json, nach einem Neustart geht es weiter.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const P = require('./pfade');
const B = require('./bruecke');

const MODELL = process.env.LERNHUB_LERNEN_MODELL || 'opus';
const EFFORT = process.env.LERNHUB_LERNEN_EFFORT || 'medium';
const FRIST = 8 * 60000;                 // ein Zug (der erste liest das Material und plant)
const REGELN = path.join(P.SKILL, 'LERNEN.md');
const PAUSE_MAX = 10 * 60000;            // längere Lücken zählen als 10 Min. (wie in LearnHarness)

const SCHEMA = {
  type: 'object',
  properties: {
    art: { type: 'string', enum: ['frage', 'text', 'abschluss'] },
    text: { type: 'string', description: 'frage: erst die Auflösung seiner letzten Antwort, dann der Unterricht dieses Schritts. text: Antwort auf eine Rückfrage. abschluss: zwei, drei Sätze, was jetzt steht.' },
    plan: { type: 'array', items: { type: 'string' }, description: 'Nur im ersten Zug: die Titel der Schritte dieser Lektion in Reihenfolge, kurz (2–6 Wörter).' },
    schritt: { type: 'integer', description: 'frage: Nummer des Plan-Schritts (ab 1), zu dem Unterricht und Frage gehören.' },
    rolle: { type: 'string', enum: ['pruefung', 'abruf', 'vorhersage'], description: 'frage: pruefung (nach der Erklärung, zählt) oder vorhersage (vor dem Schritt, zählt nicht). abruf nicht benutzen.' },
    frage: { type: 'string', description: 'frage: der Fragetext. Steht für sich: Fall, Zahlen und der Code, um den es geht, stehen hier. Kein Verweis auf frühere Lektionen, die Vorlesung oder Folien.' },
    optionen: { type: 'array', items: { type: 'string' }, description: 'frage: 2–4 Optionen für eine Auswahlfrage, ohne Buchstaben davor. Leer = freie Antwort.' },
    richtig: { type: 'integer', description: 'frage mit Optionen: Index der richtigen Option, ab 0.' },
    loesung: { type: 'string', description: 'frage ohne Optionen: die festgelegte richtige Antwort, kurz.' },
    erklaerung: { type: 'string', description: 'frage: warum die richtige Antwort richtig ist. Erst begründen, dann richtig/loesung festlegen. Der Lernende sieht sie nach seiner Antwort.' },
    bewertung: { type: 'string', enum: ['keine', 'richtig', 'teils', 'falsch'], description: 'Dein Urteil über seine letzte FREIE Antwort. keine = es war keine Antwort (Rückfrage) oder es gab keine freie Frage.' },
    gelernt: { type: 'array', items: { type: 'string' }, description: 'abschluss: drei Punkte, was er jetzt kann.' },
    offen: { type: 'array', items: { type: 'string' }, description: 'abschluss: benannte Lücken, sonst leer.' },
    nachlesen: { type: 'array', items: { type: 'string' }, description: 'abschluss: Nebenthemen mit Seitenzahl, sonst leer.' },
    kernaussage: { type: 'string', description: 'abschluss: ein Satz zum Lernstand, für den Learning Record.' },
    schritte: {
      type: 'array', description: 'abschluss: je unterrichtetem Schritt ein Eintrag fürs Merkblatt.',
      items: { type: 'object', properties: { titel: { type: 'string' }, thema: { type: 'string', description: 'Themen-Schlüssel (kebab-case), bestehende wiederverwenden.' }, kern: { type: 'string', description: 'Was gilt und warum, 2–4 Sätze.' } }, required: ['titel', 'thema', 'kern'] },
    },
  },
  required: ['art', 'text'],
};

const WEITER = '[WEITER] Das Go des Lernenden: Mach mit dem nächsten Schritt weiter (art "frage"), oder schließ ab, wenn der Plan durch ist.';
const ENDE = '[ABSCHLIESSEN] Der Lernende will die Lektion jetzt abschließen. Antworte mit art "abschluss": Rückschau, gelernt, offen, nachlesen, kernaussage und schritte (nur was du wirklich unterrichtet hast).';
const SICHER = { sicher: 'sicher', unsicher: 'unsicher', geraten: 'geraten' };
const BUCHSTABE = (i) => String.fromCharCode(65 + i);

function lies(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }
// Etwa ein Schritt je 3 Min. (seit 13.11.2026; vorher je 4 Min.: Schritte wurden zu dicht)
const schritteFuer = (min) => Math.max(3, Math.min(8, Math.round(min / 3)));
const ROLLE = { pruefung: 'Prüffrage', abruf: 'Aufwärmfrage, zählt nicht', vorhersage: 'Vorhersage' };

function systemPrompt(s) {
  const regeln = lies(REGELN);
  return `Du bist der Lehrer einer Lernumgebung und unterrichtest in der Mac-App Lernhub eine Lektion des Kurses „${s.kursName}“ im Gespräch: Lektion ${s.lektion.id} „${s.lektion.title}“. Dein Job: Verständnis in den Kopf des Lernenden bringen, Schritt für Schritt, im Zeitbudget von ${s.budget} Minuten. Antworte auf Deutsch.

## Mechanik

Du antwortest IMMER im JSON-Schema, eine Antwort je Zug.

- **art "frage"** ist der normale Zug: "text" = erst die Auflösung seiner letzten Antwort, dann der Unterricht EINES Schritts; danach genau EINE Frage in den Feldern frage, rolle, optionen + richtig (Auswahl) oder loesung (frei), erklaerung, schritt. Der Zug endet damit. Eine Frage als Fließtext in "text" ist ein Protokollbruch: Die App zeigt nur die Felder als Fragekarte.
- Im ERSTEN Zug zusätzlich "plan": die Titel der Schritte (höchstens ${s.maxSchritte}). Du fragst nicht, ob der Plan passt, sondern unterrichtest sofort Schritt 1.
- **Auswahlfrage:** Die App bewertet sie selbst und zeigt dem Lernenden sofort Richtig oder Falsch, die richtige Option und deine erklaerung. Du bekommst seine Wahl, das Ergebnis, seine Sicherheit und seine Gedanken. Bei einer Vorhersage zeigt die App nichts davon: Du löst sie zu Beginn des nächsten Zugs auf.
- **Freie Frage:** Du bekommst seinen Text und setzt im nächsten Zug "bewertung" (richtig, teils, falsch). Erst dann sieht er loesung und erklaerung. War sein Text keine Antwort, sondern eine Rückfrage: bewertung "keine", art "text", die Frage bleibt offen.
- **art "text"**: Antwort auf eine Rückfrage, ohne neue Frage. Ist dabei noch eine Frage offen, bleibt sie offen. Ist keine offen, wartet die App auf sein Go („[WEITER]“) oder seine nächste Nachricht.
- **art "abschluss"**: wenn der Plan durch ist, die Uhr abgelaufen ist oder „[ABSCHLIESSEN]“ kommt. Felder: text, gelernt, offen, nachlesen, kernaussage, schritte. Danach trägt der Lernende die Lektion mit dem Knopf „Lektion abschließen“ ein; Rückfragen beantwortest du weiter mit art "text".
- **Lektionsuhr:** Jede seiner Nachrichten endet mit „[Lektionsuhr: x von ${s.budget} Min.]“.
- **Antwortzeit:** Zu jeder Antwort steht, wie lange er von der Frage bis zum Absenden gebraucht hat. Zusammen mit seinen Gedanken, der Sicherheit und dem Stand liest du daraus selbst, welche Hilfe er braucht (Regeln unten, „Selbst erkennen, was er braucht“). Es gibt keine Hilfe-Knöpfe, und du fragst nicht nach, ob er Hilfe will.
- **Stand:** Seine Nachrichten tragen „[Stand: x von y Prüffragen richtig]“. Richte die Schwierigkeit danach aus (Regeln unten).
- **Formatierung** in text, frage, optionen, loesung, erklaerung und kern: schlichtes Markdown (**fett**, \`code\`, Codeblöcke mit \`\`\` auch für kleine Skizzen, Listen mit "- ", einfache Tabellen mit | und einer Trennzeile), keine Überschriften, keine LaTeX-Formeln (die App rendert sie nicht; Formeln als Text wie a² + b², x̄ = Σxᵢ / n).
- **Material:** Der Sitzungskontext enthält den Text genau der Seiten dieser Lektion. Dateien im Kursordner darfst du lesen (Read, Glob, Grep), etwa eine Bild-Seite einer PDF. Du schreibst nichts und rufst keine Skripte auf: Eintragen, Merkblatt und Learning Record macht die App.

${regeln ? '## Regeln für den Unterricht (kurs-tutor LERNEN.md)\n\n' + regeln : ''}`;
}

function startText(s, kontext) {
  return `[Uni-Lektion] Sitzungskontext aus dem Lernhub (eingefügt, nicht vom Lernenden geschrieben).
Budget: ${s.budget} Minuten, höchstens ${s.maxSchritte} Schritte.

${kontext}

Fang an: Plan im Feld plan, dann sofort der erste Schritt mit seiner Frage. Der Lernende sieht diesen Kontext nicht: Alles, was er braucht, steht in deinen Nachrichten.
[Lektionsuhr: 0 von ${s.budget} Min.]`;
}

class Lernen {
  constructor({ ordner, beiStand, beiErledigt }) {
    this.ordner = ordner;               // userData/lernen
    this.beiStand = beiStand;           // (sitzung) → Oberfläche
    this.beiErledigt = beiErledigt || (() => {});
    this.sitzungen = new Map();         // ws → Sitzung
    this.kinder = new Map();            // id → Kindprozess
    this.fertig = new Map();            // ws → gerade eingetragene Lektionen (bis hub.py sie kennt)
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
        if (s.zustand === 'traegtEin') { s.zustand = 'bereit'; s.eintragFehler = 'Lernhub wurde beim Eintragen beendet. Bitte noch einmal abschließen.'; }
        const alt = this.sitzungen.get(s.ws);
        if (!alt || alt.start < s.start) this.sitzungen.set(s.ws, s);
      }
    } catch { }
  }

  // ---------------------------------------------------------------- Welche Lektion ist dran?
  // Die erste nicht erledigte Lektion der Roadmap, deren Material da ist. Gerade Eingetragenes zählt schon als
  // erledigt, auch wenn hub.py es noch nicht weiß (der Abschluss läuft über die Kurs-Tutor-App).
  ziel(c) {
    const weg = this.fertig.get(P.nfc(c.ws)) || new Map();       // id → Zeitpunkt; gilt höchstens 3 Min. (Rückgängig!)
    for (const [id, t] of [...weg]) { const l = c.lessons.find((x) => x.id === id); if ((l && l.done) || Date.now() - t > 180000) weg.delete(id); }
    const l = c.lessons.find((x) => !x.done && !weg.has(x.id));
    if (!l) return { grund: 'Alle Lektionen dieses Kurses sind erledigt.' };
    if (l.placeholder || l.state === 'Material folgt') return { grund: `Die nächste Lektion ${l.id} wartet auf Material${l.availableFrom ? ' (ab ' + l.availableFrom.split('-').reverse().join('.') + ')' : ''}.` };
    if (/probeklausur/i.test(l.title)) return { grund: `Die nächste Lektion ${l.id} ist eine Probeklausur. Sie läuft nicht im Gespräch: in Claude Code mit /kurs-tutor erstellen und im Browser schreiben.` };
    return { id: l.id, title: l.title, chapter: l.chapter, sources: l.sources, estMin: l.estMin, budget: Lernen.budget(l.estMin), training: !!l.training };
  }

  // Schätzung der Roadmap plus 10 Min. fürs Gespräch (Wartezeit je Zug, mehr kleine Schritte), 20 bis 25 Min.
  static budget(estMin) { return Math.max(20, Math.min(25, (estMin || 15) + 10)); }

  offeneFrage(s) { return [...s.verlauf].reverse().find((v) => v.art === 'frage' && v.offen) || null; }
  // freie Frage, die beantwortet ist, aber noch auf Claudes Urteil wartet
  wartetAufUrteil(s) { return [...s.verlauf].reverse().find((v) => v.art === 'frage' && v.offen && v.frei && v.beantwortet) || null; }

  // Aktive Minuten: Lücken über 10 Min. zählen als 10
  minuten(s, bis = Date.now()) {
    const zeiten = [s.start, ...s.verlauf.map((v) => v.t).filter(Boolean)];
    if (!s.ende) zeiten.push(bis);
    let ms = 0;
    for (let i = 1; i < zeiten.length; i++) ms += Math.min(PAUSE_MAX, Math.max(0, zeiten[i] - zeiten[i - 1]));
    return Math.max(1, Math.round(ms / 60000));
  }
  score(s) { return s.stat.fragen ? Math.round(s.stat.punkte / s.stat.fragen * 100) : null; }

  // Für die Oberfläche: ohne Lösung und Erklärung, solange eine Frage nicht aufgedeckt ist
  sicht(s) {
    if (!s) return null;
    const { letzterAuftrag, sessionId, ...rest } = s;
    rest.verlauf = s.verlauf.map((e) => {
      if (e.art === 'frage' && !e.aufgedeckt) { const { richtig, loesung, erklaerung, korrekt, ...r } = e; return r; }
      return e;
    });
    rest.min = s.ergebnis ? s.ergebnis.min : this.minuten(s);
    rest.score = this.score(s);
    return rest;
  }
  melden(s) { this.speichern(s); this.beiStand(this.sicht(s)); }
  fuer(ws) { return this.sicht(this.sitzungen.get(P.nfc(ws))); }

  // ---------------------------------------------------------------- Start
  async starten(c, sem) {
    if (!P.CLAUDE) return { ok: false, text: 'claude nicht gefunden (~/.local/bin/claude).' };
    if (process.env.LERNHUB_TEST && !process.env.LERNHUB_CLAUDE) return { ok: false, text: 'Im Test nur mit claude-Attrappe (LERNHUB_CLAUDE).' };
    if (!P.unterRoot(c.ws)) return { ok: false, text: 'Lernbereich liegt nicht im Studienordner.' };
    const ws = P.nfc(c.ws);
    const alt = this.sitzungen.get(ws);
    if (alt && alt.zustand === 'denkt') return { ok: false, text: 'Claude arbeitet gerade an dieser Lektion.' };
    if (alt && alt.zustand === 'traegtEin') return { ok: false, text: 'Die Lektion wird gerade eingetragen.' };
    const l = this.ziel(c);
    if (!l.id) return { ok: false, text: l.grund };
    if (alt) this.beenden(ws);
    const budget = Lernen.budget(l.estMin);
    const s = {
      id: crypto.randomUUID(), sessionId: crypto.randomUUID(), gestartet: false,
      kurs: c.key, kursName: c.name || c.key, ws, sem, start: Date.now(),
      lektion: l, budget, maxSchritte: schritteFuer(budget),
      zustand: 'denkt', fehler: null, verlauf: [], plan: [], schritt: 0, abschluss: null, ergebnis: null,
      stat: { fragen: 0, punkte: 0, vorhersagen: 0, gestellt: 0 },
    };
    this.sitzungen.set(ws, s);
    this.melden(s);
    let kontext = '';
    try { kontext = (await B.lauf(P.PYTHON, [B.skript('lernen.py'), ws, l.id], { timeout: 240000 })).trim(); }
    catch (e) { kontext = `(Kontext nicht verfügbar: ${e.message}. Lektion ${l.id} „${l.title}“, Quellen: ${l.sources || '–'}. Such das Material im Kursordner ${path.dirname(ws)}.)`; }
    if (s.zustand === 'beendet') return { ok: true, id: s.id };
    this.zug(s, startText(s, kontext));
    return { ok: true, id: s.id };
  }

  uhr(s) {
    const st = s.stat.fragen ? `\n[Stand: ${Math.round(s.stat.punkte * 10) / 10} von ${s.stat.fragen} Prüffragen richtig]` : '';
    return `${st}\n[Lektionsuhr: ${this.minuten(s)} von ${s.budget} Min.]`;
  }

  // art: antwort ({ wahl, sicherheit, text, weissNicht }) | text (Rückfrage, Nachricht) | weiter | ende
  senden(ws, art, x = {}) {
    const s = this.sitzungen.get(P.nfc(ws));
    if (!s) return { ok: false, text: 'Keine Lektion offen.' };
    if (s.zustand === 'denkt') return { ok: false, text: 'Claude antwortet noch.' };
    if (s.zustand === 'traegtEin' || s.zustand === 'erledigt') return { ok: false, text: 'Die Lektion ist schon abgeschlossen.' };
    const text = String(x.text || '').trim().slice(0, 6000);
    const q = this.offeneFrage(s);
    const t = Date.now();
    let auftrag = '';
    if (art === 'antwort') {
      if (!q || q.beantwortet) return { ok: false, text: 'Keine offene Frage.' };
      const sicher = SICHER[x.sicherheit] || null;
      const kopf = `Antwort auf Frage ${q.nr} (${ROLLE[q.rolle]})`;
      const zeit = `\nAntwortzeit: ${Math.max(1, Math.round((t - (q.t || t)) / 1000))} s`;
      const zusatz = `\nSicherheit: ${sicher || 'nicht angegeben'}` + (text && !q.frei ? `\nGedanken: ${text}` : '') + zeit;
      if (x.weissNicht) {
        q.antwort = { weissNicht: true, text }; q.beantwortet = true;
        if (q.rolle === 'pruefung') { s.stat.fragen++; q.korrekt = false; }
        q.offen = false; q.aufgedeckt = q.rolle !== 'vorhersage';
        auftrag = `${kopf}: „Weiß ich nicht“ (kein Rateversuch, eine echte Lücke).${text ? '\nGedanken: ' + text : ''}${zeit}`
          + (q.rolle !== 'vorhersage' ? '\n[Die App hat ihm die richtige Antwort und deine Erklärung gezeigt.]' : '');
      } else if (!q.frei) {
        const i = Number(x.wahl);
        if (!Number.isInteger(i) || i < 0 || i >= q.optionen.length) return { ok: false, text: 'Erst eine Option wählen.' };
        const ok = i === q.richtig;
        q.antwort = { wahl: i, sicherheit: sicher, text }; q.beantwortet = true; q.offen = false; q.korrekt = ok;
        if (q.rolle !== 'vorhersage') {
          if (q.rolle === 'pruefung') { s.stat.fragen++; if (ok) s.stat.punkte++; }
          q.aufgedeckt = true;
          auftrag = `${kopf}: gewählt ${BUCHSTABE(i)}) „${q.optionen[i]}“ → ${ok ? 'RICHTIG' : `FALSCH, richtig ist ${BUCHSTABE(q.richtig)}) „${q.optionen[q.richtig]}“`}.${zusatz}\n[Die App hat ihm ${ok ? 'Richtig' : 'Falsch'}, die richtige Option und deine Erklärung schon gezeigt.]`;
        } else {
          auftrag = `${kopf}: gewählt ${BUCHSTABE(i)}) „${q.optionen[i]}“ (${ok ? 'trifft zu' : `trifft nicht zu, es wäre ${BUCHSTABE(q.richtig)})`}; er sieht das noch nicht, lös es auf).${zusatz}`;
        }
      } else {
        if (!text) return { ok: false, text: 'Erst eine Antwort schreiben.' };
        q.antwort = { text, sicherheit: sicher }; q.beantwortet = true;
        if (q.rolle === 'vorhersage') { q.offen = false; auftrag = `${kopf}, frei:\n${text}\nSicherheit: ${sicher || 'nicht angegeben'}`; }
        else auftrag = `${kopf}, freie Antwort (von dir zu bewerten, Feld bewertung; bei einer Rückfrage statt Antwort: bewertung "keine"):\n${text}\nSicherheit: ${sicher || 'nicht angegeben'}${zeit}`;
      }
      s.verlauf.push({ von: 'ich', art: 'antwort', nr: q.nr, text, t });
    } else if (art === 'text') {
      if (!text) return { ok: false, text: 'Erst etwas schreiben.' };
      auftrag = q && !q.beantwortet ? `Rückfrage, während Frage ${q.nr} offen ist (noch keine Antwort; antworte mit art "text", die Frage bleibt offen):\n${text}` : text;
      s.verlauf.push({ von: 'ich', art: 'text', text, t });
    } else if (art === 'weiter') {
      if (q) return { ok: false, text: 'Erst die offene Frage beantworten.' };
      auftrag = WEITER;
      s.verlauf.push({ von: 'ich', art: 'weiter', t });
    } else if (art === 'ende') {
      if (s.abschluss) return { ok: false, text: 'Die Rückschau ist schon da.' };
      auftrag = ENDE;
      s.verlauf.push({ von: 'ich', art: 'ende', t });
    } else return { ok: false, text: 'Unbekannte Eingabe.' };
    this.zug(s, auftrag + this.uhr(s));
    return { ok: true };
  }

  nochmal(ws) {
    const s = this.sitzungen.get(P.nfc(ws));
    if (!s || s.zustand !== 'fehler' || !s.letzterAuftrag) return { ok: false };
    this.zug(s, s.letzterAuftrag);
    return { ok: true };
  }

  // Sitzung verwerfen (nichts wird eingetragen) bzw. nach dem Eintragen schließen
  beenden(ws) {
    const s = this.sitzungen.get(P.nfc(ws));
    if (!s) return { ok: false };
    if (s.zustand === 'traegtEin') return { ok: false, text: 'Die Lektion wird gerade eingetragen.' };
    const k = this.kinder.get(s.id);
    if (k) k.kill('SIGTERM');
    s.zustand = 'beendet'; s.ende = s.ende || Date.now();
    this.melden(s);
    this.sitzungen.delete(P.nfc(ws));
    return { ok: true };
  }

  // ---------------------------------------------------------------- Ein Zug
  zug(s, auftrag) {
    s.zustand = 'denkt'; s.fehler = null; s.letzterAuftrag = auftrag; s.seit = Date.now();
    this.melden(s);
    const args = ['-p', '--model', MODELL, '--effort', EFFORT, '--output-format', 'json',
      '--json-schema', JSON.stringify(SCHEMA), '--setting-sources', '', '--strict-mcp-config',
      '--permission-mode', 'dontAsk', '--add-dir', path.dirname(s.ws),
      '--allowedTools', 'Read', 'Glob', 'Grep',
      '--disallowedTools', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'];
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
    kind.on('close', (code) => {
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
      try { this.verarbeiten(s, x); } catch (e) { console.error(e); }
      s.zustand = 'bereit';
      this.melden(s);
    });
  }

  verarbeiten(s, x) {
    const t = Date.now();
    const text = String(x.text || '').trim();
    // 1. Urteil über die letzte freie Antwort
    const frei = this.wartetAufUrteil(s);
    const urteil = ['richtig', 'teils', 'falsch'].includes(x.bewertung) ? x.bewertung : null;
    if (frei && (urteil || x.art !== 'text')) {
      // ohne Urteil, aber Claude geht weiter: nicht zählen
      if (urteil && frei.rolle === 'pruefung') { s.stat.fragen++; s.stat.punkte += urteil === 'richtig' ? 1 : urteil === 'teils' ? 0.5 : 0; }
      if (urteil) { frei.korrekt = urteil === 'richtig'; frei.urteil = urteil; }
      frei.offen = false; frei.aufgedeckt = true;
    } else if (frei && x.art === 'text') {
      frei.beantwortet = false; frei.antwort = null;      // war eine Rückfrage: Frage bleibt offen
    }
    // 2. Vorhersagen werden mit Claudes Auflösung aufgedeckt
    for (const v of s.verlauf) if (v.art === 'frage' && v.rolle === 'vorhersage' && v.beantwortet && !v.aufgedeckt) v.aufgedeckt = true;

    if (Array.isArray(x.plan) && x.plan.length && !s.plan.length) s.plan = x.plan.map((p) => String(p).trim()).filter(Boolean).slice(0, s.maxSchritte + 1);

    if (x.art === 'frage' && String(x.frage || '').trim()) {
      const alt = this.offeneFrage(s);
      if (alt) { alt.offen = false; alt.ersetzt = true; }          // sollte nicht vorkommen: neue Frage trotz offener
      const schritt = Number.isInteger(x.schritt) && x.schritt > 0 ? x.schritt : Math.max(1, s.schritt);
      s.schritt = schritt;
      if (text) s.verlauf.push({ von: 'claude', art: 'text', text, schritt, t });
      const optionen = (Array.isArray(x.optionen) ? x.optionen : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 5);
      const mitWahl = optionen.length >= 2 && Number.isInteger(x.richtig) && x.richtig >= 0 && x.richtig < optionen.length;
      const rolle = ['vorhersage', 'abruf'].includes(x.rolle) ? x.rolle : 'pruefung';
      s.stat.gestellt++; if (rolle === 'vorhersage') s.stat.vorhersagen++;
      s.verlauf.push({ von: 'claude', art: 'frage', nr: s.stat.gestellt, rolle, schritt, frage: String(x.frage).trim(),
        optionen: mitWahl ? optionen : [], frei: !mitWahl, richtig: mitWahl ? x.richtig : null,
        loesung: String(x.loesung || (!mitWahl && optionen[x.richtig]) || '').trim(), erklaerung: String(x.erklaerung || '').trim(),
        offen: true, beantwortet: false, aufgedeckt: false, antwort: null, korrekt: null, t });
      return;
    }
    if (x.art === 'abschluss') {
      const alt = this.offeneFrage(s);
      if (alt) { alt.offen = false; alt.ersetzt = true; }
      const liste = (a) => (Array.isArray(a) ? a.map((p) => String(p).trim()).filter(Boolean) : []);
      s.abschluss = {
        text, gelernt: liste(x.gelernt), offen: liste(x.offen), nachlesen: liste(x.nachlesen),
        kernaussage: String(x.kernaussage || '').trim(),
        schritte: (Array.isArray(x.schritte) ? x.schritte : []).filter((p) => p && p.titel && p.kern)
          .map((p) => ({ titel: String(p.titel).trim(), thema: String(p.thema || '').trim(), kern: String(p.kern).trim() })),
      };
      if (s.plan.length) s.schritt = s.plan.length + 1;              // alle Schritte abgehakt
      s.verlauf.push({ von: 'claude', art: 'abschluss', t });
      return;
    }
    // Antwort auf eine Rückfrage – oder eine „frage“ ohne Fragetext
    if (text) s.verlauf.push({ von: 'claude', art: 'text', text, t });
  }

  // ---------------------------------------------------------------- Lektion abschließen (eintragen)
  async eintragen(ws) {
    const s = this.sitzungen.get(P.nfc(ws));
    if (!s) return { ok: false, text: 'Keine Lektion offen.' };
    if (!s.abschluss) return { ok: false, text: 'Erst die Rückschau abwarten („Lektion beenden“).' };
    if (s.zustand === 'denkt' || s.zustand === 'traegtEin') return { ok: false, text: 'Einen Moment, es läuft noch etwas.' };
    if (s.zustand === 'erledigt') return { ok: true };
    s.zustand = 'traegtEin'; s.eintragFehler = null; s.ende = s.ende || Date.now();
    const min = this.minuten(s, s.ende), score = this.score(s);
    this.melden(s);
    try {
      const fragen = s.verlauf.filter((v) => v.art === 'frage' && v.beantwortet && !v.ersetzt).map((q) => ({
        rolle: q.rolle, schritt: q.schritt, frage: q.frage, korrekt: q.korrekt,
        richtig: q.frei ? q.loesung : `${BUCHSTABE(q.richtig)}) ${q.optionen[q.richtig]}`,
        antwort: q.antwort && (q.antwort.weissNicht ? 'weiß nicht' : q.frei ? q.antwort.text : `${BUCHSTABE(q.antwort.wahl)}) ${q.optionen[q.antwort.wahl]}`),
        sicherheit: q.antwort && q.antwort.sicherheit, erklaerung: q.erklaerung,
      }));
      const heute = new Date(); const datum = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
      const daten = { datum, min, score, ...s.abschluss, fragen };
      const py = (flag) => B.lauf(P.PYTHON, [B.skript('lernen.py'), s.ws, s.lektion.id, flag], { timeout: 60000, input: JSON.stringify(daten) });
      const datei = (await py('--merkblatt')).trim();
      if (!datei) throw new Error('Lektionsdatei nicht angelegt.');
      const url = `kurstutor://done?lesson=${encodeURIComponent(datei)}&min=${min}` + (score != null ? `&score=${score}` : '');
      const r = await B.kurstutor(url);
      await this.wartenAufDone(s);                                   // über die Kurs-Tutor-App dauert das ein paar Sekunden
      let record = '';
      try {
        record = (await py('--record')).trim();
        await B.lauf(P.PYTHON, [B.skript('roadmap.py'), 'recorded', s.ws, s.lektion.id], { timeout: 30000 });
      } catch (e) { console.error('Learning Record:', e.message); }
      s.ergebnis = { min, score, datei, record, meldung: (r && r.meldung) || '' };
      s.zustand = 'erledigt';
      if (!this.fertig.has(s.ws)) this.fertig.set(s.ws, new Map());
      this.fertig.get(s.ws).set(s.lektion.id, Date.now());
      this.melden(s);
      this.beiErledigt(s);
      return { ok: true };
    } catch (e) {
      s.zustand = 'bereit';
      s.eintragFehler = String((e && (e.stderr || e.message)) || e).trim().split('\n').pop().slice(0, 300);
      this.melden(s);
      return { ok: false, text: 'Nicht eingetragen: ' + s.eintragFehler };
    }
  }

  async wartenAufDone(s, frist = 90000) {
    const f = path.join(s.ws, 'roadmap.json');
    const t0 = Date.now();
    for (;;) {
      try {
        const l = JSON.parse(fs.readFileSync(f, 'utf8')).lessons.find((x) => x.id === s.lektion.id);
        if (l && l.done) return;
      } catch { }
      if (Date.now() - t0 > frist) throw new Error('Die Kurs-Tutor-App hat den Abschluss nicht bestätigt (roadmap.json unverändert).');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

module.exports = { Lernen, SCHEMA, systemPrompt, schritteFuer };
