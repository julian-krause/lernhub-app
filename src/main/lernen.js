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
//   - Unendlich-Modus (s.unendlich, docs/unendlich.md): Je Kurs kann zusätzlich eine Vorab-Sitzung bereitliegen
//     (this.vorab, s.vorab), deren erster Zug schon gelaufen ist, während die aktuelle Lektion noch läuft. „starten“
//     übernimmt sie ohne Wartezeit. Ein abschluss trägt die Lektion ohne Knopf ein, und die erste Antwort der
//     nächsten Lektion im selben Kurs trägt eine kurze Übergabe (Ergebnis, Kernaussage, Noch offen).
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const P = require('./pfade');
const B = require('./bruecke');
const { KATALOG } = require('./bausteine');

const MODELL = process.env.LERNHUB_LERNEN_MODELL || 'opus';
const EFFORT = process.env.LERNHUB_LERNEN_EFFORT || 'medium';
const FRIST = 8 * 60000;                 // ein Zug (der erste liest das Material und plant)
const REGELN = path.join(P.SKILL, 'LERNEN.md');
const PAUSE_MAX = 10 * 60000;            // längere Lücken zählen als 10 Min. (wie in LearnHarness)
const VORAB_MAX = 12 * 3600000;          // eine Vorab-Sitzung, die so lange nicht übernommen wurde, verfällt

// Lektionsuhr in ms: die Zeit zwischen den Zügen, je Lücke höchstens PAUSE_MAX. Zeit, in der die Lektion nicht offen
// war (s.weg: [von, bis], s.wegSeit: seitdem nicht offen), zählt nicht. s.korrekturMs: von Hand gestellt (+/-).
// Gleiche Rechnung in src/ui/js/lernen.js (lektionMs).
function lektionMs(s, bis = Date.now()) {
  const ende = s.ende || bis;
  const zeiten = [s.start, ...s.verlauf.map((v) => v.t).filter(Boolean)];
  if (!s.ende) zeiten.push(bis);
  const weg = [...(s.weg || []), ...(s.wegSeit ? [[s.wegSeit, ende]] : [])];
  let ms = 0;
  for (let i = 1; i < zeiten.length; i++) {
    const a = zeiten[i - 1], b = zeiten[i];
    let d = Math.max(0, b - a);
    for (const [x, y] of weg) d -= Math.max(0, Math.min(b, y) - Math.max(a, x));
    ms += Math.min(PAUSE_MAX, Math.max(0, d));
  }
  return Math.max(0, ms + (s.korrekturMs || 0));
}

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
const THEMA_MAX = 12;                     // Unendlich-Modus: Schritte je Lektion, nach Thema statt nach Zeit
const ROLLE = { pruefung: 'Prüffrage', abruf: 'Aufwärmfrage, zählt nicht', vorhersage: 'Vorhersage' };

// Fingerabdruck der Regeln (Bausteine und LERNEN.md). Claude speichert den System-Prompt mit der Sitzung; eine
// vorbereitete Lektion (Unendlich-Modus) mit älteren Regeln wird deshalb nicht übernommen, sondern neu angelegt.
function regelstand() { return crypto.createHash('sha1').update(KATALOG + '\n' + lies(REGELN)).digest('hex').slice(0, 12); }

function systemPrompt(s) {
  const regeln = lies(REGELN);
  return `Du bist der Lehrer einer Lernumgebung und unterrichtest in der Mac-App Lernhub eine Lektion des Kurses „${s.kursName}“ im Gespräch: Lektion ${s.lektion.id} „${s.lektion.title}“. Dein Job: Verständnis in den Kopf des Lernenden bringen, Schritt für Schritt, ${s.stromRegeln ? 'Thema für Thema ohne Zeitbudget (Unendlich-Modus, Abschnitt am Ende)' : `im Zeitbudget von ${s.budget} Minuten`}. Antworte auf Deutsch.

## Mechanik

Du antwortest IMMER im JSON-Schema, eine Antwort je Zug.

- **art "frage"** ist der normale Zug: "text" = erst die Auflösung seiner letzten Antwort, dann der Unterricht EINES Schritts; danach genau EINE Frage in den Feldern frage, rolle, optionen + richtig (Auswahl) oder loesung (frei), erklaerung, schritt. Der Zug endet damit. Eine Frage als Fließtext in "text" ist ein Protokollbruch: Die App zeigt nur die Felder als Fragekarte.
- Im ERSTEN Zug zusätzlich "plan": die Titel der Schritte (höchstens ${s.maxSchritte}). Du fragst nicht, ob der Plan passt, sondern unterrichtest sofort Schritt 1.
- **Auswahlfrage:** Die App bewertet sie selbst und zeigt dem Lernenden sofort Richtig oder Falsch, die richtige Option und deine erklaerung. Du bekommst seine Wahl, das Ergebnis, seine Sicherheit und seine Gedanken. Bei einer Vorhersage zeigt die App nichts davon: Du löst sie zu Beginn des nächsten Zugs auf.
- **Freie Frage:** Du bekommst seinen Text und setzt im nächsten Zug "bewertung" (richtig, teils, falsch). Erst dann sieht er loesung und erklaerung. War sein Text keine Antwort, sondern eine Rückfrage: bewertung "keine", art "text", die Frage bleibt offen.
- **art "text"**: Antwort auf eine Rückfrage, ohne neue Frage. Ist dabei noch eine Frage offen, bleibt sie offen. Ist keine offen, wartet die App auf sein Go („[WEITER]“) oder seine nächste Nachricht.
- **art "abschluss"**: wenn der Plan durch ist, die Uhr abgelaufen ist oder „[ABSCHLIESSEN]“ kommt. Felder: text, gelernt, offen, nachlesen, kernaussage, schritte. Danach trägt der Lernende die Lektion mit dem Knopf „Lektion abschließen“ ein; Rückfragen beantwortest du weiter mit art "text".
- **Lektionsuhr:** ${s.stromRegeln ? 'Im Unendlich-Modus endet jede seiner Nachrichten mit „[Unendlich-Modus]“ statt mit einer Uhr.' : `Jede seiner Nachrichten endet mit „[Lektionsuhr: x von ${s.budget} Min.]“.`}
- **Antwortzeit:** Zu jeder Antwort steht, wie lange er von der Frage bis zum Absenden gebraucht hat. Zusammen mit seinen Gedanken, der Sicherheit und dem Stand liest du daraus selbst, welche Hilfe er braucht (Regeln unten, „Selbst erkennen, was er braucht“). Es gibt keine Hilfe-Knöpfe, und du fragst nicht nach, ob er Hilfe will.
- **Stand:** Seine Nachrichten tragen „[Stand: x von y Prüffragen richtig]“. Richte die Schwierigkeit danach aus (Regeln unten).
- **Formatierung** in text, frage, optionen, loesung, erklaerung und kern: schlichtes Markdown (**fett**, \`code\`, Codeblöcke mit \`\`\` nur für Programmcode, Befehle und Ausgaben, Rechnungen im Baustein rechnung, Listen mit "- ", einfache Tabellen mit | und einer Trennzeile), keine Überschriften, keine LaTeX-Formeln (die App rendert sie nicht; Formeln als Text wie a² + b², x̄ = Σxᵢ / n). Bausteine (Abschnitt unten) nur in text und erklaerung, nie in optionen oder kern. Einzige Ausnahme: Die rechnung darf auch in frage und loesung stehen, etwa als Lückenrechnung mit „?“ an der gesuchten Stelle.
- **Material:** Der Sitzungskontext enthält den Text genau der Seiten dieser Lektion. Dateien im Kursordner darfst du lesen (Read, Glob, Grep), etwa eine Bild-Seite einer PDF. Du schreibst nichts und rufst keine Skripte auf: Eintragen, Merkblatt und Learning Record macht die App.

${KATALOG}

${regeln ? '## Regeln für den Unterricht (kurs-tutor LERNEN.md)\n\n' + regeln : ''}${s.stromRegeln ? '\n\n' + stromRegeln(s) : ''}`;
}

function startText(s, kontext) {
  const strom = !!s.unendlich;
  return `[Uni-Lektion] Sitzungskontext aus dem Lernhub (eingefügt, nicht vom Lernenden geschrieben).
${strom ? `Unendlich-Modus: kein Zeitbudget, höchstens ${s.maxSchritte} Schritte, so viele, wie die Themen brauchen.` : `Budget: ${s.budget} Minuten, höchstens ${s.maxSchritte} Schritte.`}

${kontext}

Fang an: Plan im Feld plan, dann sofort der erste Schritt mit seiner Frage. Der Lernende sieht diesen Kontext nicht: Alles, was er braucht, steht in deinen Nachrichten.${strom ? '\n' + stromEinstieg(s) : ''}
${strom ? '[Unendlich-Modus]' : `[Lektionsuhr: 0 von ${s.budget} Min.]`}`;
}

// Unendlich-Modus: Für den Lernenden gibt es keine Lektionen, nur ein durchgehendes Gespräch. Die Regeln stehen im
// Systemprompt der Sitzung (stromRegeln); wechselt eine einzeln begonnene Lektion in den Strom, kommen sie einmal
// mit seiner nächsten Nachricht (STROM_KURZ verweist darauf).
function stromRegeln(s) {
  return `## Unendlich-Modus: ein durchgehendes Gespräch, Thema für Thema

Für den Lernenden gibt es hier keine Lektionen. Er lernt in einem einzigen, durchgehenden Gespräch; nach dieser Lektion geht es ohne jeden Schnitt mit der nächsten weiter (die App bereitet sie vor und trägt diese hier im Hintergrund ein). Wo diese Regeln den Regeln oben widersprechen, gelten diese.

- **Kein Zeitbudget, keine Lektionsuhr.** Was oben zur Uhr steht (80 %, 100 %, „passt nicht mehr ins Budget“, „bei knapper Zeit“), gilt nicht. Du dosierst nach Verständnis, nicht nach Minuten.
- **Plan nach Thema:** ein Schritt je Gedanke, so viele, wie die Seiten brauchen (höchstens ${THEMA_MAX}). Kein Thema fällt weg und keins wird dichter gepackt, um schneller durch zu sein.
- **Weiter, sobald er es verstanden hat:** Den nächsten Schritt beginnst du, wenn er den aktuellen verstanden hat: die Prüffrage richtig und nicht geraten, oder nach einem Fehler die Nachfass-Frage richtig. Nicht strenger als sonst: Eine sichere richtige Antwort reicht, keine Extra-Runde. Bei falsch, geraten oder „Weiß ich nicht“ fasst du nach wie oben beschrieben, höchstens zweimal je Schritt. Sitzt es dann noch nicht, geht es weiter, und der Punkt steht später unter offen.
- **Keine Grenzen im Gespräch:** kein Gruß, keine Lektionsnummer, kein „In dieser Lektion“, „Zum Schluss“, „Geschafft“, kein Fazit, keine Vorschau, kein Abschied, und den Plan zählst du nie im Text auf. Das Wort „Lektion“ benutzt du ihm gegenüber nicht. Jede Nachricht ist einfach der nächste Schritt im selben Gespräch.
- **Keine Schlussrunde:** Was er falsch hatte, holt die App später selbst zurück.
- **abschluss** kommt direkt nach seiner Antwort auf die Frage des letzten Schritts (oder bei „[ABSCHLIESSEN]“). Der text ist nur die Auflösung dieser Antwort, wie am Anfang jedes normalen Zugs (bei einer freien Antwort mit bewertung), ein bis drei Sätze, ohne Rückblick und ohne Überleitung. Er sieht nur diesen text; direkt danach steht schon der erste Schritt des nächsten Themas. gelernt, offen, nachlesen, kernaussage und schritte füllst du wie sonst: Daraus macht die App im Hintergrund Merkblatt und Learning Record.
- Tragen seine Nachrichten statt „[Unendlich-Modus]“ wieder „[Lektionsuhr: …]“, lernt er diese Lektion einzeln weiter: Dann gelten Budget (${s.budget} Minuten), Uhr, Schlussrunde und Rückschau wie oben.`;
}
const STROM_KURZ = '[Unendlich-Modus]';
const STROM_WECHSEL = (s) => `\n[Ab jetzt Unendlich-Modus, Regeln für den Rest dieser Lektion:]\n${stromRegeln(s).split('\n').slice(2).join('\n')}\n${STROM_KURZ}`;

// Erster Zug im Strom: Er knüpft an das an, was der Lernende direkt davor gesehen hat
function stromEinstieg(s) {
  const v = s.vorher;
  if (!v) return '[Unendlich-Modus] Das ist der Anfang des Gesprächs: Steig direkt mit Schritt 1 ein, ohne Gruß und ohne den Plan aufzuzählen.';
  const kurs = v.kursName && v.kursName !== s.kursName;
  return `[Unendlich-Modus] Direkt davor ging es im selben Gespräch um „${v.title}“${v.letzter ? ` (zuletzt: ${v.letzter})` : ''}${kurs ? `, im Kurs ${v.kursName}` : ''}. Direkt über deiner Nachricht steht die Auflösung seiner letzten Antwort von dort. Dein erster Zug ist einfach der nächste Schritt dieses Gesprächs: keine Lektionsnummer, kein Gruß, keine Ankündigung; knüpf in einem Halbsatz an, wo es passt${kurs ? `, und lass den Wechsel zu ${s.kursName} beiläufig erkennen (ein Halbsatz)` : ''}.`;
}

// Erste Nachricht nach einer gerade eingetragenen Lektion desselben Kurses (Unendlich-Modus)
function uebergabeText(u) {
  return `\n\n[Übergabe aus dem Lernhub, nicht vom Lernenden geschrieben] Das Thema davor, ${u.id} „${u.title}“, ist durch${u.score != null ? ` (${u.score} % der Prüffragen beim ersten Versuch richtig)` : ''}.`
    + (u.kernaussage ? ` Kernaussage: ${u.kernaussage}` : '')
    + (u.offen && u.offen.length ? `\nNoch offen von dort: ${u.offen.join('; ')}` : '')
    + '\nGreif Offenes nur auf, wo es zu deinem Stoff passt, in einem Satz und ohne eigene Frage dazu. Er sieht keine Lektionsgrenze: nicht „in der letzten Lektion“, sondern „vorhin“.';
}

class Lernen {
  constructor({ ordner, beiStand, beiErledigt }) {
    this.ordner = ordner;               // userData/lernen
    this.beiStand = beiStand;           // (sitzung) → Oberfläche
    this.beiErledigt = beiErledigt || (() => {});
    this.sitzungen = new Map();         // ws → Sitzung
    this.kinder = new Map();            // id → Kindprozess
    this.fertig = new Map();            // ws → gerade eingetragene Lektionen (bis hub.py sie kennt)
    this.vorab = new Map();             // ws → vorbereitete nächste Lektion (Unendlich-Modus)
    this.uebergabe = new Map();         // ws → Ergebnis der eben eingetragenen Lektion (Unendlich-Modus)
    this.hinten = new Map();            // id → Lektion aus dem Strom, die im Hintergrund eingetragen wird
    this.stromLetzte = null;            // zuletzt fertige Lektion im Strom (für den Einstieg der nächsten)
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
        if (s.vorab) {
          if (Date.now() - s.start > VORAB_MAX) { fs.unlinkSync(p); continue; }
          if (s.zustand === 'denkt') { s.zustand = 'fehler'; s.fehler = 'Lernhub wurde beendet, während Claude die Lektion vorbereitete.'; }
          const v = this.vorab.get(s.ws);
          if (!v || v.start < s.start) this.vorab.set(s.ws, s);
          continue;
        }
        if (s.hinten) {
          if (s.zustand === 'erledigt') continue;
          s.zustand = 'bereit'; s.eintragFehler = s.eintragFehler || 'Lernhub wurde beim Eintragen beendet.';
          this.hinten.set(s.id, s);
          continue;
        }
        if (s.zustand === 'denkt') { s.zustand = 'fehler'; s.fehler = 'Lernhub wurde beendet, während Claude antwortete.'; }
        if (s.zustand === 'traegtEin') { s.zustand = 'bereit'; s.eintragFehler = 'Lernhub wurde beim Eintragen beendet. Bitte noch einmal abschließen.'; }
        if (!s.ende && !s.wegSeit) s.wegSeit = fs.statSync(p).mtimeMs;     // nach einem Absturz: seit dem letzten Speichern nicht offen
        const alt = this.sitzungen.get(s.ws);
        if (!alt || alt.start < s.start) this.sitzungen.set(s.ws, s);
      }
    } catch { }
  }

  // ---------------------------------------------------------------- Welche Lektion ist dran?
  // Die erste nicht erledigte Lektion der Roadmap, deren Material da ist. Gerade Eingetragenes zählt schon als
  // erledigt, auch wenn hub.py es noch nicht weiß (der Abschluss läuft über die Kurs-Tutor-App).
  ziel(c, { ohne = [] } = {}) {
    const weg = this.fertig.get(P.nfc(c.ws)) || new Map();       // id → Zeitpunkt; gilt höchstens 3 Min. (Rückgängig!)
    for (const [id, t] of [...weg]) { const l = c.lessons.find((x) => x.id === id); if ((l && l.done) || Date.now() - t > 180000) weg.delete(id); }
    const l = c.lessons.find((x) => !x.done && !weg.has(x.id) && !ohne.includes(x.id));
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

  // Aktive Minuten: nur solange die Lektion offen ist, Lücken über 10 Min. zählen als 10
  minuten(s, bis = Date.now()) { return Math.max(1, Math.round(lektionMs(s, bis) / 60000)); }

  // Die Oberfläche meldet, ob die Lektion gerade zu sehen ist (Ansicht „Lernen“ des Kurses, Fenster nicht versteckt).
  // Solange nicht, steht die Uhr. Gibt die Sitzung für die Oberfläche zurück.
  uhrStellen(ws, offen) {
    const s = this.sitzungen.get(P.nfc(ws));
    if (!s || s.ende) return this.sicht(s);
    const t = Date.now();
    if (!offen && !s.wegSeit) s.wegSeit = t;
    else if (offen && s.wegSeit) { s.weg = [...(s.weg || []), [s.wegSeit, t]]; s.wegSeit = null; }
    else return this.sicht(s);
    this.speichern(s);
    return this.sicht(s);
  }
  // Beim Beenden der App: Alle offenen Lektionen stehen, bis sie wieder geöffnet werden.
  alleAnhalten() { for (const [ws] of this.sitzungen) this.uhrStellen(ws, false); }
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
  vorabFuer(ws) { return this.sicht(this.vorab.get(P.nfc(ws))); }
  // Die Lektion nach der laufenden (für „Als Nächstes“)
  danach(c) { const s = this.sitzungen.get(P.nfc(c.ws)); return this.ziel(c, { ohne: s && s.zustand !== 'erledigt' ? [s.lektion.id] : [] }); }

  // ---------------------------------------------------------------- Start
  async starten(c, sem, { unendlich = false, fortsetzen = false } = {}) {
    if (!P.CLAUDE) return { ok: false, text: 'claude nicht gefunden (~/.local/bin/claude).' };
    if (process.env.LERNHUB_TEST && !process.env.LERNHUB_CLAUDE) return { ok: false, text: 'Im Test nur mit claude-Attrappe (LERNHUB_CLAUDE).' };
    if (!P.unterRoot(c.ws)) return { ok: false, text: 'Lernbereich liegt nicht im Studienordner.' };
    const ws = P.nfc(c.ws);
    const alt = this.sitzungen.get(ws);
    if (alt && alt.zustand === 'traegtEin') return { ok: false, text: 'Die Lektion wird gerade eingetragen.' };
    // Eine laufende Lektion wird nicht neu gestartet, sondern läuft im gewünschten Modus weiter: im Strom (unendlich)
    // oder wieder als einzelne Lektion mit „Lektion abschließen“ (fortsetzen ohne unendlich)
    if (alt && (unendlich || fortsetzen) && alt.zustand !== 'erledigt') {
      if (!!alt.unendlich !== unendlich) { alt.unendlich = unendlich; this.melden(alt); }
      return { ok: true, id: alt.id };
    }
    if (alt && alt.zustand === 'denkt') return { ok: false, text: 'Claude arbeitet gerade an dieser Lektion.' };
    const l = this.ziel(c);
    if (!l.id) return { ok: false, text: l.grund };
    if (alt) this.beenden(ws);
    const ueb = unendlich ? this.uebergabe.get(ws) : null;
    this.uebergabe.delete(ws);
    const v = this.vorab.get(ws);
    if (v && v.lektion.id === l.id && v.regelstand === regelstand()) return this.uebernehmen(ws, v, ueb, unendlich);
    if (v) this.vorabVerwerfen(ws);
    const s = this.neu(c, sem, l, { unendlich });
    if (ueb) s.uebergabe = ueb;
    if (unendlich) s.vorher = this.stromVorher();
    this.sitzungen.set(ws, s);
    this.melden(s);
    await this.erster(s);
    return { ok: true, id: s.id };
  }

  neu(c, sem, l, { unendlich = false, vorab = false } = {}) {
    const budget = Lernen.budget(l.estMin);
    return {
      id: crypto.randomUUID(), sessionId: crypto.randomUUID(), gestartet: false,
      kurs: c.key, kursName: c.name || c.key, ws: P.nfc(c.ws), sem, start: Date.now(),
      lektion: l, budget, maxSchritte: unendlich ? THEMA_MAX : schritteFuer(budget), unendlich, vorab, stromRegeln: unendlich, regelstand: regelstand(),
      zustand: 'denkt', fehler: null, verlauf: [], plan: [], schritt: 0, abschluss: null, ergebnis: null,
      stat: { fragen: 0, punkte: 0, vorhersagen: 0, gestellt: 0 },
    };
  }

  // Kontext der Lektion holen (lernen.py) und den ersten Zug starten
  async erster(s) {
    let kontext = '';
    try { kontext = (await B.lauf(P.PYTHON, [B.skript('lernen.py'), s.ws, s.lektion.id], { timeout: 240000 })).trim(); }
    catch (e) { kontext = `(Kontext nicht verfügbar: ${e.message}. Lektion ${s.lektion.id} „${s.lektion.title}“, Quellen: ${s.lektion.sources || '–'}. Such das Material im Kursordner ${path.dirname(s.ws)}.)`; }
    if (s.zustand === 'beendet') return;
    this.zug(s, startText(s, kontext));
  }

  // ---------------------------------------------------------------- Unendlich-Modus: die nächste Lektion vorbereiten
  // Legt für den Kurs die Lektion nach der laufenden an und lässt ihren ersten Zug (Material lesen, Plan, Schritt 1)
  // im Hintergrund laufen. Ihre Uhr läuft erst, wenn „starten“ sie übernimmt.
  async vorbereiten(c, sem) {
    if (!P.CLAUDE || (process.env.LERNHUB_TEST && !process.env.LERNHUB_CLAUDE)) return { ok: false, text: 'claude nicht verfügbar.' };
    if (!P.unterRoot(c.ws)) return { ok: false, text: 'Lernbereich liegt nicht im Studienordner.' };
    const ws = P.nfc(c.ws);
    const l = this.danach(c);
    if (!l.id) return { ok: false, text: l.grund };
    const v = this.vorab.get(ws);
    if (v && v.lektion.id === l.id && v.regelstand === regelstand()) return { ok: true, id: v.id, schon: true };
    if (v) this.vorabVerwerfen(ws);
    const s = this.neu(c, sem, l, { unendlich: true, vorab: true });
    s.vorher = this.stromVorher();
    this.vorab.set(ws, s);
    this.melden(s);
    this.erster(s);
    return { ok: true, id: s.id, lektion: l.id };
  }

  // Vorab-Sitzung wird zur laufenden Lektion, im Strom oder als einzelne Lektion (dann mit „Lektion abschließen“).
  // Die Vorbereitung zählt nicht zur Lektionsuhr.
  uebernehmen(ws, v, ueb, unendlich = true) {
    this.vorab.delete(ws);
    const t = Date.now();
    v.vorab = false; v.unendlich = unendlich; v.start = t; v.weg = []; v.wegSeit = null;
    for (const e of v.verlauf) e.t = t;
    if (ueb) v.uebergabe = ueb;
    this.sitzungen.set(ws, v);
    this.melden(v);
    return { ok: true, id: v.id, vorab: true };
  }

  // Was der Lernende im Strom direkt vor der nächsten Lektion lernt: die laufende Strom-Lektion, sonst die zuletzt fertige
  stromVorher() {
    const lauf = [...this.sitzungen.values()].filter((x) => x.unendlich && !x.vorab && x.zustand !== 'erledigt' && x.zustand !== 'beendet').sort((a, b) => b.start - a.start)[0];
    const v = lauf ? { kursName: lauf.kursName, id: lauf.lektion.id, title: lauf.lektion.title, letzter: (lauf.plan || []).slice(-1)[0] || '', t: Date.now() } : this.stromLetzte;
    return v && Date.now() - v.t < 3 * 3600000 ? v : null;
  }

  // Unendlich-Modus: Sobald der abschluss da ist, verlässt die Lektion ihren Platz (die nächste kann sofort übernehmen)
  // und trägt sich im Hintergrund ein. Ein Fehler hält den Strom nicht an: nachtragen(id) versucht es noch einmal.
  hintenEintragen(s) {
    this.sitzungen.delete(s.ws);
    s.hinten = true;
    this.hinten.set(s.id, s);
    const ende = s.ende || Date.now();
    this.stromLetzte = { kursName: s.kursName, id: s.lektion.id, title: s.lektion.title, letzter: (s.plan || []).slice(-1)[0] || '', t: ende };
    this.uebergabe.set(s.ws, { id: s.lektion.id, title: s.lektion.title, score: this.score(s), kernaussage: s.abschluss.kernaussage, offen: s.abschluss.offen });
    if (!this.fertig.has(s.ws)) this.fertig.set(s.ws, new Map());
    this.fertig.get(s.ws).set(s.lektion.id, Date.now());            // ziel() überspringt sie schon jetzt
    return this.nachtragen(s.id);
  }
  async nachtragen(id) {
    const s = this.hinten.get(id);
    if (!s) return { ok: false, text: 'Diese Lektion wartet nicht aufs Eintragen.' };
    const r = await this.eintragenS(s).catch((e) => ({ ok: false, text: e.message }));
    if (r.ok) this.hinten.delete(id);
    else { const w = this.fertig.get(s.ws); if (w) w.delete(s.lektion.id); }
    return r;
  }

  vorabVerwerfen(ws) {
    const v = this.vorab.get(P.nfc(ws));
    if (!v) return { ok: false };
    const k = this.kinder.get(v.id);
    if (k) k.kill('SIGTERM');
    v.zustand = 'beendet'; v.ende = Date.now();
    this.vorab.delete(P.nfc(ws));
    this.melden(v);
    return { ok: true };
  }

  uhr(s) {
    const st = s.stat.fragen ? `\n[Stand: ${Math.round(s.stat.punkte * 10) / 10} von ${s.stat.fragen} Prüffragen richtig]` : '';
    if (!s.unendlich) return `${st}\n[Lektionsuhr: ${this.minuten(s)} von ${s.budget} Min.]`;
    if (s.stromRegeln) return `${st}\n${STROM_KURZ}`;
    s.stromRegeln = true;                                          // einzeln begonnen, jetzt im Strom: Regeln einmal mitschicken
    return `${st}${STROM_WECHSEL(s)}`;
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
    if (s.uebergabe && !s.uebergabeGesendet) { auftrag += uebergabeText(s.uebergabe); s.uebergabeGesendet = true; }
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
      // Unendlich-Modus: Mit dem abschluss geht es sofort weiter, eingetragen wird im Hintergrund
      if (s.unendlich && !s.vorab && x.art === 'abschluss' && this.sitzungen.get(s.ws) === s) this.hintenEintragen(s).catch((e) => console.error(e));
      else this.melden(s);
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
  async eintragen(ws) { return this.eintragenS(this.sitzungen.get(P.nfc(ws))); }
  async eintragenS(s) {
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

module.exports = { Lernen, SCHEMA, systemPrompt, startText, schritteFuer, lektionMs };
