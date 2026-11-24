// Sprechstunde: Wiederholen freihändig per Sprache mit OpenAI GPT-Live-1.1 (Konzept: docs/sprechstunde.md,
// API-Doku: docs/gpt-live/). Ein freies Gespräch über den Kursstoff: Der Tutor fragt ab, hakt nach, erklärt.
//
//   - Kein Ablaufplan, keine Karten. Der Tutor bekommt einen Rahmen: alle gelernten Themen des Kurses (fällige und
//     Lücken markiert). Er wählt frei, bleibt bei einem Thema, solange es nötig ist, und wechselt auf Zuruf.
//   - Wissen kommt aus einer Suche im ganzen Kursstoff (src/main/suche.js, BM25, lokal, < 1 ms): Die Oberfläche
//     schickt jeden fertigen Satz (Tutor und Student) hierher, die App sucht passende Stellen aus den Lektionen und
//     dem Glossar und legt sie GPT-Live still hin (session.thinking.append), bevor er sie braucht. So muss er fast
//     nie „nachschauen“. Reicht das nicht, sucht das Backend gezielt (stoff_suchen).
//   - Ans Backend (Responses-Delegation, gpt-6-luna) geht nur: Thema eintragen (→ ueben.py --log, derselbe
//     Leitner-Stand wie „Wiederholen“), gezielte Stoffsuche und Sitzung beenden.
//   - Robust: abgelehnte Optionen → schlichter neuer Versuch, Abriss → neue Sitzung mit Bilanz und letzten Sätzen.
//     Fehler landen als ruhige Meldung in der Oberfläche, nie als Absturz.
//   - Ton (WebRTC) läuft in der Oberfläche. Der OpenAI-Schlüssel bleibt hier im Hauptprozess.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const P = require('./pfade');
const B = require('./bruecke');
const { Index, teilen, woerter } = require('./suche');

const LIVE_MODELL = process.env.LERNHUB_LIVE_MODELL || 'gpt-live-1.1';
const BACKEND_MODELL = process.env.LERNHUB_LIVE_BACKEND || 'gpt-6-luna';
const BASIS = process.env.LERNHUB_OPENAI_BASIS || 'https://api.openai.com';
const STIMMEN = ['juni', 'nuri', 'flitz'];            // deutsche GPT-Live-Stimmen
const MAX_NEU = 3;                                     // Neuverbindungen nach Abriss
const PAUSE_LANG = 15 * 60000;                         // so lange darf eine Pause die Sitzung offen halten
const STOFF_GUELTIG = 10 * 60000;                      // Kursstoff (Index) je Kurs so lange im Speicher
const KONTEXT_ABSTAND = +process.env.LERNHUB_SPRECH_KONTEXT_MS || 3500;   // höchstens alle 3,5 s Stoff nachschieben
const KONTEXT_WIEDER = 4 * 60000;                      // derselbe Abschnitt frühestens nach 4 Min. nochmal
const KONTEXT_MIN = 2.5;                               // Mindest-Score, sonst passt nichts wirklich
const KUERZLICH = 36 * 3600000;                        // in der Sprechstunde dran gewesen → so lange eher nicht vorschlagen
// „Mach was anderes“ und Ähnliches: Die App legt sofort ein neues Thema mit Stoff hin, statt auf den Tutor zu warten
const WECHSEL = /(was|etwas|mal) (anderes|neues)|ander(es|en|e) them|neues them|them(a|en) ?wechs|wechsel(n|) (wir|das|mal)|(keine|kein bock|keine lust) (mehr )?(auf|darauf)|nicht schon wieder|immer (das ?selbe|dasselbe|die (gleichen|selben))|(das|die) hatten wir (doch |schon )|frag mich (was|etwas) anderes|n(ä|ae)chstes thema/i;

const kuerzen = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + ' …' : s; };
// Spricht sich schlecht: Markdown, Code-Zeichen
const sprechbar = (s) => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/[`*_#>|]/g, '').replace(/\s+/g, ' ').trim();
const normThema = (x) => P.nfc(String(x || '')).toLowerCase().replace(/[^a-z0-9äöüß]+/g, '');

// ---------------------------------------------------------------- Texte für GPT-Live
const TEMPO = {
  normal: 'Sprich in normalem Gesprächstempo.',
  zuegig: 'Sprich zügig, wie im normalen Gespräch unter Studenten, eher etwas schneller als langsamer. Keine künstlichen Pausen zwischen den Sätzen.',
  schnell: 'Sprich schnell und knapp, ohne Pausen zwischen den Sätzen, aber deutlich.',
};
const TEMPO_STANDARD = 'zuegig';

// Rahmen: Vorschläge für diese Sitzung (wechseln jedes Mal) und alle gelernten Themen nach Lektion, fällige,
// Lücken und kürzlich besprochene markiert (natürlicher Text, kein JSON)
function rahmenText(themen, { lektionen = [], vorschlag = [] } = {}) {
  const jetzt = Date.now();
  const marke = (t) => [t.luecke ? 'Lücke offen' : t.faellig ? 'fällig' : 'gerade nicht fällig',
    t.dran && jetzt - t.dran < KUERZLICH ? 'kam gerade erst dran' : ''].filter(Boolean).join(', ');
  const name = (t) => t.titel;
  const titel = new Map(lektionen.map((l) => [l.id, l.titel]));
  const gruppen = new Map();
  for (const t of themen.slice(0, 150)) {
    const l = (t.lektionen && t.lektionen[0]) || '';
    if (!gruppen.has(l)) gruppen.set(l, []);
    gruppen.get(l).push(t);
  }
  const nr = (l) => +(/\d+/.exec(l) || [999])[0];
  const alle = [...gruppen.entries()].sort((a, b) => nr(a[0]) - nr(b[0])).map(([l, ts]) =>
    `${l ? `${l} ${titel.get(l) || ''}`.trim() : 'Weitere'}: ${ts.map((t) => `${/^L\d+$/.test(t.thema) && titel.get(t.thema) ? 'die Lektion als Ganzes' : name(t)} (${marke(t)})`).join('; ')}`);
  return [vorschlag.length ? 'Vorschläge für heute (wechseln jede Sitzung, fang mit einem davon an):\n'
      + vorschlag.map((t) => `- ${name(t)}${t.lektionen && t.lektionen[0] && titel.get(t.lektionen[0]) ? ` aus „${titel.get(t.lektionen[0])}“` : ''} (${marke(t)})`).join('\n') : '',
    alle.length ? 'Alle Themen nach Lektion:\n' + alle.join('\n') : ''].filter(Boolean).join('\n\n');
}
const stoffText = (treffer, anlass = '') => `Kursstoff${anlass ? ' zu ' + anlass : ''} (still, nur für dich, nicht vorlesen):\n`
  + treffer.map((t) => `[${t.quelle}] ${sprechbar(t.text)}`).join('\n');

function tutorPrompt({ kursName, tempo = TEMPO_STANDARD, themen = [], lektionen = [], vorschlag = [] }) {
  return `Du bist Tutor in einer Sprechstunde und gehst mit einem Studenten mündlich den Stoff im Kurs „${kursName}“ durch. Er hat gerade die Hände nicht frei und schaut nicht auf den Bildschirm. Ihr duzt euch. Sprich immer Deutsch.

So klingst du: ${TEMPO[tempo] || TEMPO[TEMPO_STANDARD]} Ganz normal und direkt, wie ein Kommilitone, der den Stoff gut kann. Keine beruhigenden oder pädagogischen Floskeln wie „ganz ruhig“, „kein Stress“, „lass dir Zeit“, „gute Frage“ oder „super“. Kurze Sätze, nie mehr als drei am Stück, dann ist er dran.

Dein Rahmen: Unten stehen alle Themen, die er in diesem Kurs schon gelernt hat, nach Lektion. Daraus wählst du frei. Es gibt keinen festen Ablauf und keine festen Fragen.
- Fang mit einem der Vorschläge für heute an. Themen, die gerade erst dran waren, nimmst du nur, wenn er sie will. Abwechslung ist wichtig: Er soll nicht jedes Mal dasselbe gefragt werden. Fragen formulierst du selbst, abwechslungsreich: Was ist das, wozu braucht man es, was ist der Unterschied zu etwas Ähnlichem, was passiert wenn, wie hängt das mit einem anderen Thema zusammen.
- Ein Thema ist ein Gespräch, keine Einzelfrage. Bleib dabei, solange er darüber redet oder es noch nicht sitzt: nachhaken, nach einem Beispiel fragen, nach dem Warum. Wechsle, wenn es sitzt oder er etwas anderes will.
- Will er ein anderes Thema oder andere Fragen, geh sofort darauf ein: Nimm etwas wirklich anderes, am besten aus einer anderen Lektion, nicht nur einen Nachbarbegriff. Alle Themen unten sind erlaubt, auch nicht fällige. Querverbindungen zwischen Lektionen sind gut. Schlägt die App dir ein neues Thema vor („Er will etwas anderes“), nimm das.
- Die Themennamen unten sind oft Kurzschlüssel ohne Umlaute und Großschreibung. Sprich sie als normale deutsche Fachbegriffe aus („komplexitaet innen aussen“ → „innere und äußere Komplexität“).
- Wenn du ein neues Thema anfängst, nenn es zuerst in einem kurzen Satz („Lass uns zu den Tag-Objekten gehen.“) und stell dann die Frage.
- Lass ihn ausreden. Füllwörter, kurze Pausen oder Geräusche heißen nicht, dass er fertig ist.
- Bewerte am Inhalt, nicht am Wortlaut. Das Transkript kann Hörfehler haben, bei ähnlich klingenden Fachbegriffen im Zweifel zu seinen Gunsten.
  * Sitzt es: kurz sagen, was gut war, gern eine weiterführende Nachfrage.
  * Teilweise: sagen, was stimmt, und mit einem Hinweis nach dem Rest fragen.
  * Falsch oder er weiß es nicht: die richtige Antwort sagen, kurz erklären und ihn das in eigenen Worten wiederholen lassen.
- Kein Code, keine Sonderzeichen, keine Listen vorlesen. Formeln und Befehle sprichst du aus.

Dein Wissen: Während ihr redet, legt dir die App laufend passende Stellen aus dem Kursstoff hin („Kursstoff … still, nur für dich“). Das ist die Grundlage für Fragen, Bewertung und Erklärungen, halte dich daran und erfinde nichts, was dem widerspricht. Lies diese Stellen nie vor. Sag nicht „ich prüfe kurz“ oder „ich schau nach“, außer du lässt wirklich über das Backend suchen.

Sprachbefehle, auch sinngemäß:
- „Pause“, „Warte“, „Stopp“: sofort aufhören und still sein, bis er weiterredet.
- „Nochmal“, „Wie bitte?“: das Letzte einfacher wiederholen.
- „Langsamer“ oder „Schneller“: dein Tempo anpassen.
- „Anderes Thema“, „Frag mich was anderes“, „Das hatten wir schon“: das aktuelle Thema eintragen, wie es stand, und sofort etwas aus einer anderen Lektion nehmen.
- „Erklär das genauer“: ausführlicher erklären.
- „Schluss“, „Das reicht“: in ein, zwei Sätzen sagen, was saß und was noch wackelt, verabschieden und die Sitzung beenden.

Backchannel policy: Selten. Ein kurzes „mhm“, wenn er länger erklärt. Neutral, es verrät nicht, ob es stimmt.

Interruption policy: Wenn er dich unterbricht, hör sofort auf und hör zu. Geh auf das ein, was er dann sagt, statt deinen alten Satz fortzusetzen. Unterbrich ihn nicht mitten im Gedanken.

Delegation policy:
Backend tools:
- Thema eintragen: speichert, wie gut ein Thema saß, für die Wiederholungsplanung.
- Stoff suchen: sucht gezielt im ganzen Kursstoff, wenn die Stellen, die du hast, nicht reichen.
- Sitzung beenden: beendet die Sprechstunde nach deinem Abschied.

Delegate to the backend when:
- ihr ein Thema verlasst: Thema eintragen, mit dem Thema und wie es lief. Einmal je Thema.
- er etwas wissen will, wozu du keine passende Stelle aus dem Kursstoff hast.
- er aufhören will, nach deinem Abschied.

Do not delegate when:
- ihr mitten in einem Thema seid und die Kursstoff-Stellen reichen: fragen, nachhaken, bewerten, erklären.
- er nur etwas wiederholt haben möchte.

Das Eintragen läuft im Hintergrund, sprich einfach weiter. Wenn du suchen lässt, rate nicht, sondern überbrücke kurz und warte auf das Ergebnis.

Themen, die er gelernt hat:
${rahmenText(themen, { lektionen, vorschlag }) || '(keine)'}`;
}

function backendPrompt({ kursName, themen = [] }) {
  return `Du hilfst einem deutschsprachigen Sprach-Tutor bei einer mündlichen Abfrage im Kurs „${kursName}“. Transkripte können Hörfehler enthalten.
- Verlässt der Tutor ein Thema, ruf thema_eintragen auf. thema: Schlüssel oder Titel aus der Liste unten. ergebnis: geloest = saß ohne Hilfe, hinweise = mit Hinweisen oder teilweise, aufgegeben = er wusste es nicht, hat übersprungen oder der Tutor hat es erklärt. stufe: R0 ohne Hinweis, R1 ein kleiner Hinweis, R2 mehrere Hinweise, R3 Teil der Lösung verraten, R4 erklärt. Danach antwortest du nur „Eingetragen.“
- Will er etwas wissen, wozu der Tutor nichts hat, ruf stoff_suchen mit einer guten Suchanfrage auf (Fachbegriffe, nicht seine wörtliche Frage) und antworte in höchstens drei kurzen, gesprochenen Sätzen auf Deutsch, ohne Listen, Code oder Formelzeichen. Steht es nicht im Stoff, sag das ehrlich.
- Will er aufhören, ruf sitzung_beenden auf und antworte nur „Bis bald.“
Antworte immer knapp.

Themen (Schlüssel: Titel):
${themen.slice(0, 80).map((t) => `- ${t.thema}: ${t.titel}`).join('\n')}`;
}

const WERKZEUGE = [
  { type: 'function', name: 'thema_eintragen', description: 'Speichert, wie gut ein Thema saß. Einmal je Thema, wenn ihr es verlasst.',
    parameters: { type: 'object', additionalProperties: false, required: ['thema', 'ergebnis', 'stufe'],
      properties: {
        thema: { type: 'string', description: 'Schlüssel oder Titel des Themas aus der Liste.' },
        ergebnis: { type: 'string', enum: ['geloest', 'hinweise', 'aufgegeben'] },
        stufe: { type: 'string', enum: ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'] },
      } } },
  { type: 'function', name: 'stoff_suchen', description: 'Sucht im ganzen Kursstoff (Lektionen, Glossar) und liefert die passendsten Stellen.',
    parameters: { type: 'object', additionalProperties: false, required: ['anfrage'],
      properties: { anfrage: { type: 'string', description: 'Suchbegriffe, am besten Fachbegriffe.' } } } },
  { type: 'function', name: 'sitzung_beenden', description: 'Beendet die Sprechstunde, nachdem sich der Tutor verabschiedet hat.',
    parameters: { type: 'object', additionalProperties: false, properties: {} } },
];

const ERG_TEXT = { geloest: 'saß', hinweise: 'mit Hinweisen', aufgegeben: 'erklärt bekommen' };

// ---------------------------------------------------------------- Sitzung
class Sprechstunde {
  // ordner: userData/sprechstunde · beiStand(sicht) · beiSenden(ereignis für den Datenkanal) · beiEnde(sitzung)
  // fetch: austauschbar (Tests) · schluessel(): OpenAI-Schlüssel oder null
  constructor({ ordner, beiStand, beiSenden, beiEnde, schluessel, fetch: f, wachHalten, zufall }) {
    this.ordner = ordner;
    this.zufall = zufall || Math.random;
    this.beiStand = beiStand || (() => {});
    this.beiSenden = beiSenden || (() => {});
    this.beiEnde = beiEnde || (() => {});
    this.schluessel = schluessel || (() => null);
    this.fetch = f || ((...a) => fetch(...a));
    this.wachHalten = wachHalten || (() => {});
    this.s = null;                         // eine Sitzung zur Zeit (ein Mikrofon)
    this.stoffe = new Map();               // ws → { t, laden: Promise<{ themen, index }> }
    this.einst = this.einstellungenLesen();
  }

  // ------------------------------------------------ Einstellungen (Stimme, Tempo)
  einstellungenDatei() { return path.join(this.ordner, 'einstellungen.json'); }
  einstellungenLesen() {
    let e = {};
    try { e = JSON.parse(fs.readFileSync(this.einstellungenDatei(), 'utf8')); } catch { }
    return { stimme: STIMMEN.includes(e.stimme) ? e.stimme : 'juni', tempo: TEMPO[e.tempo] ? e.tempo : TEMPO_STANDARD };
  }
  einstellungen(neu) {
    if (neu && typeof neu === 'object') {
      if (STIMMEN.includes(neu.stimme)) this.einst.stimme = neu.stimme;
      if (TEMPO[neu.tempo]) this.einst.tempo = neu.tempo;
      try { fs.mkdirSync(this.ordner, { recursive: true }); B.schreibeAtomar(this.einstellungenDatei(), JSON.stringify(this.einst)); } catch (e) { console.error(e); }
    }
    return { ...this.einst, stimmen: STIMMEN };
  }

  // ------------------------------------------------ Kursstoff (Themen + Suchindex), je Kurs kurz im Speicher
  kursstoff(ws, { frisch = false } = {}) {
    ws = P.nfc(ws);
    const alt = this.stoffe.get(ws);
    if (alt && !frisch && Date.now() - alt.t < STOFF_GUELTIG) return alt.laden;
    const laden = B.lauf(P.PYTHON, [path.join(__dirname, 'kursstoff.py'), P.SCRIPTS, ws], { timeout: 60000 }).then((out) => {
      const d = JSON.parse(out);
      const abschnitte = [
        ...d.lektionen.flatMap((l) => teilen(`${l.id} ${l.titel}`, l.text, { themen: l.themen })),
        ...d.referenz.flatMap((r) => teilen(r.titel, r.text)),
      ];
      return { themen: d.themen, lektionen: d.lektionen.map((l) => ({ id: l.id, titel: l.titel })), index: new Index(abschnitte) };
    });
    this.stoffe.set(ws, { t: Date.now(), laden });
    laden.catch(() => this.stoffe.delete(ws));
    return laden;
  }
  vorbereiten(c) { return this.kursstoff(c.ws); }

  // ------------------------------------------------ Für die Oberfläche
  sicht(s = this.s) {
    if (!s) return null;
    return {
      id: s.id, kurs: s.kurs, kursName: s.kursName, start: s.start, ende: s.ende || null,
      zustand: s.zustand, fehler: s.fehler, hinweis: s.hinweis || '', schautNach: !!s.offeneDelegation,
      themen: s.themen.map((t) => ({ thema: t.thema, titel: t.titel, faellig: t.faellig, luecke: t.luecke, ergebnis: t.ergebnis || null })),
      verlauf: s.verlauf, stat: s.stat, sekunden: s.sekunden || 0, pause: !!s.pause, neuVersuch: s.neuVersuch || 0,
    };
  }
  melden() { if (this.s) { this.speichern(this.s); this.beiStand(this.sicht()); } }
  fuer(key) { return this.s && this.s.kurs === key ? this.sicht() : null; }
  laeuft() { return !!(this.s && !['beendet', 'fehler'].includes(this.s.zustand)); }
  speichern(s) {
    try {
      fs.mkdirSync(path.join(this.ordner, 'sitzungen'), { recursive: true });
      B.schreibeAtomar(path.join(this.ordner, 'sitzungen', s.id + '.json'), JSON.stringify(s, (k, v) => (/[tT]imer$/.test(k) || ['anrufe', 'index', 'kontext'].includes(k) ? undefined : v), 1));
    } catch (e) { console.error(e); }
  }

  // ------------------------------------------------ Start
  // Erster Schritt: Sitzung anlegen und Kursstoff laden (ein Python-Lauf, ~1 s). Danach verbindet die Oberfläche.
  async starten(c) {
    if (!this.schluessel()) return { ok: false, text: 'Für die Sprechstunde fehlt der OpenAI-Schlüssel (Einstellungen).', schluessel: false };
    if (!P.unterRoot(c.ws)) return { ok: false, text: 'Lernbereich liegt nicht im Studienordner.' };
    if (this.s && this.laeuft()) {
      if (this.s.kurs === c.key) return { ok: true, id: this.s.id, laeuft: true };
      return { ok: false, text: `Es läuft schon eine Sprechstunde (${this.s.kursName}). Erst beenden.` };
    }
    const s = {
      id: crypto.randomUUID(), kurs: c.key, kursName: c.name || c.key, ws: P.nfc(c.ws), start: Date.now(),
      zustand: 'vorbereiten', fehler: null, hinweis: 'Lade den Kursstoff …', themen: [], verlauf: [],
      stat: { karten: 0, geloest: 0, hinweise: 0, aufgegeben: 0 }, sekunden: 0, zeitAb: Date.now(),
      anrufe: {}, neuVersuch: 0, pause: false, kontext: { saetze: [], gesendet: {}, zuletzt: 0 }, besprochen: [], lektionen: [],
    };
    this.s = s;
    this.melden();
    let st = null;
    try { st = await this.kursstoff(c.ws, { frisch: true }); } catch (e) { console.error('Sprechstunde: Kursstoff', e.message); }
    if (this.s !== s || s.zustand === 'beendet') return { ok: false, text: 'Abgebrochen.' };
    if (!st || !st.themen.length) {
      s.zustand = 'fehler'; s.fehler = st ? 'Gerade ist nichts zu wiederholen. Lern zuerst eine Lektion.' : 'Der Kursstoff ließ sich nicht laden.';
      this.melden();
      return { ok: false, text: s.fehler };
    }
    const dran = this.verlaufLesen()[c.key] || {};
    s.themen = st.themen.map((t) => ({ ...t, dran: dran[t.thema] || 0 }));
    s.lektionen = st.lektionen || [];
    s.index = st.index;
    s.vorschlag = this.themenWahl(s, 4).map((t) => t.thema);
    s.zustand = 'verbindet'; s.hinweis = 'Verbinde …';
    this.melden();
    return { ok: true, id: s.id };
  }

  // Sitzungskonfiguration: Rahmen in den Instructions (bleibt auch in langen Gesprächen), zum Einstieg Stoff zu den
  // ersten fälligen Themen. Nach einem Abriss: Bilanz, letzte Sätze und Stoff dazu.
  konfig(s = this.s, { schlicht = false, nachAbriss = false, zuletzt = '' } = {}) {
    let einstieg;
    if (nachAbriss) {
      const treffer = zuletzt && s.index ? s.index.suchen(zuletzt, 2) : [];
      einstieg = `Die Verbindung war kurz weg. Sag in einem kurzen Satz, dass es weitergeht, und mach da weiter, wo ihr wart. ${this.bilanz(s)}${zuletzt ? `\nZuletzt im Gespräch: ${kuerzen(zuletzt, 600)}` : ''}${treffer.length ? '\n\n' + kuerzen(stoffText(treffer), 2400) : ''}`;
    } else {
      const erste = this.vorschlagThemen(s).slice(0, 2);
      const treffer = s.index ? erste.flatMap((t) => this.stoffZu(s, t, 1)) : [];
      for (const t of treffer) s.kontext.gesendet[t.id] = Date.now();
      if (erste[0]) this.dranGewesen(s, erste[0]);
      einstieg = `Begrüße ihn jetzt kurz und normal in einem Satz und steig direkt mit „${erste[0] ? erste[0].titel : 'einem fälligen Thema'}“ ein.${treffer.length ? '\n\n' + kuerzen(stoffText(treffer, 'den ersten Vorschlägen'), 2400) : ''}`;
    }
    const responses = { model: BACKEND_MODELL, instructions: backendPrompt(s), tools: WERKZEUGE, tool_choice: 'auto' };
    if (!schlicht) { responses.reasoning = { effort: 'low' }; responses.service_tier = 'priority'; }
    return {
      model: LIVE_MODELL,
      instructions: tutorPrompt({ kursName: s.kursName, tempo: this.einst.tempo, themen: s.themen, lektionen: s.lektionen, vorschlag: this.vorschlagThemen(s) }),
      audio: { output: { voice: this.einst.stimme } },
      input: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: einstieg }] }],
      delegation: { type: 'responses', responses },
    };
  }
  // ------------------------------------------------ Abwechslung: Themen wählen, merken, was dran war
  verlaufDatei() { return path.join(this.ordner, 'themen-verlauf.json'); }
  verlaufLesen() { try { return JSON.parse(fs.readFileSync(this.verlaufDatei(), 'utf8')) || {}; } catch { return {}; } }
  // Thema kam in dieser Sitzung dran: merken (auch für die nächsten Sitzungen)
  dranGewesen(s, t) {
    if (!t || s.besprochen.includes(t.thema)) return;
    s.besprochen.push(t.thema);
    t.dran = Date.now();
    try {
      const v = this.verlaufLesen();
      (v[s.kurs] = v[s.kurs] || {})[t.thema] = t.dran;
      fs.mkdirSync(this.ordner, { recursive: true });
      B.schreibeAtomar(this.verlaufDatei(), JSON.stringify(v));
    } catch (e) { console.error(e); }
  }
  // n Themen, gewichtet: fällig und Lücke vorn, kürzlich besprochene weit hinten, Zufall dazu, möglichst aus
  // verschiedenen Lektionen (und nicht aus denen in „weg“, z. B. der gerade besprochenen)
  themenWahl(s, n = 2, { weg = [] } = {}) {
    const jetzt = Date.now();
    const kand = s.themen.filter((t) => !t.ergebnis && !s.besprochen.includes(t.thema));
    const wert = (t) => (t.faellig ? 3 : 0) + (t.luecke ? 0.8 : 0) - (t.dran && jetzt - t.dran < KUERZLICH ? 6 : 0)
      - ((t.lektionen || []).some((l) => weg.includes(l)) ? 4 : 0) + this.zufall() * 3;
    const sortiert = kand.map((t) => [wert(t), t]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    const out = [], lek = new Set();
    for (const t of sortiert) {
      if (out.length >= n) break;
      if ((t.lektionen || []).some((l) => lek.has(l))) continue;
      out.push(t); (t.lektionen || []).forEach((l) => lek.add(l));
    }
    for (const t of sortiert) if (out.length < n && !out.includes(t)) out.push(t);
    return out;
  }
  vorschlagThemen(s) { return (s.vorschlag || []).map((x) => s.themen.find((t) => t.thema === x)).filter(Boolean); }
  stoffZu(s, t, n = 2) { return s.index ? s.index.suchen(`${t.titel} ${t.thema.replace(/-/g, ' ')}`, n, { thema: t.thema }) : []; }
  // Welches Thema nennt dieser Satz? (alle Wörter des Titels kommen vor)
  themaImSatz(s, satz) {
    const w = new Set(woerter(satz));
    let best = null, bestN = 0;
    for (const t of s.themen) {
      const tw = [...new Set(woerter(t.titel.replace(/^(Prod|Mawi)\s*·\s*/, '')))];
      if (!tw.length || tw.length > 5) continue;
      if (tw.every((x) => w.has(x)) && tw.length > bestN) { best = t; bestN = tw.length; }
    }
    return best;
  }
  // Er will etwas anderes: neues Thema aus einer anderen Lektion vorschlagen, Stoff gleich dazu
  wechseln(s) {
    const zuletzt = s.besprochen.slice(-2).map((x) => s.themen.find((t) => t.thema === x)).filter(Boolean);
    const weg = zuletzt.flatMap((t) => t.lektionen || []);
    const [neu, alt] = this.themenWahl(s, 2, { weg });
    if (!neu) return 0;
    this.dranGewesen(s, neu);
    const treffer = this.stoffZu(s, neu, 2);
    for (const t of treffer) s.kontext.gesendet[t.id] = Date.now();
    const titel = new Map(s.lektionen.map((l) => [l.id, l.titel]));
    const aus = neu.lektionen && neu.lektionen[0] && titel.get(neu.lektionen[0]);
    this.anhaengen('thinking', kuerzen(`Er will etwas anderes. Trag das bisherige Thema ein, wie es stand, und nimm jetzt „${neu.titel}“${aus ? ` aus „${aus}“` : ''}${alt ? ` (oder „${alt.titel}“, wenn ihm das lieber ist)` : ''}. Nenn das neue Thema kurz und frag direkt.`
      + (treffer.length ? '\n\n' + stoffText(treffer) : ''), 1900));
    s.kontext.zuletzt = Date.now();
    return treffer.length + 1;
  }

  bilanz(s) {
    const fertig = s.themen.filter((k) => k.ergebnis).map((k) => `„${k.titel}“ ${ERG_TEXT[k.ergebnis]}`);
    return fertig.length ? 'Schon eingetragen: ' + fertig.join('; ') + '.' : '';
  }

  // ------------------------------------------------ Laufender Kontext: Sätze aus dem Gespräch → Stoff dazu
  // wer: 'tutor' | 'ich'. Sucht mit den letzten beiden Sätzen, schiebt bis zu 2 neue, wirklich passende Abschnitte nach.
  kontext(kurs, { wer, text } = {}) {
    const s = this.s;
    if (!s || s.kurs !== kurs || s.zustand !== 'laeuft' || !s.index) return { ok: false };
    const satz = String(text || '').trim().slice(0, 600);
    if (satz.length < 8) return { ok: true, n: 0 };
    const k = s.kontext;
    k.saetze.push({ wer: wer === 'tutor' ? 'tutor' : 'ich', satz });
    if (k.saetze.length > 4) k.saetze.shift();
    if (wer !== 'tutor' && WECHSEL.test(satz)) { clearTimeout(k.timer); return { ok: true, n: this.wechseln(s), wechsel: true }; }
    if (wer === 'tutor') this.dranGewesen(s, this.themaImSatz(s, satz));
    const jetzt = Date.now();
    if (jetzt - k.zuletzt < KONTEXT_ABSTAND) {               // gleich nochmal versuchen, mit dem dann neuesten Stand
      clearTimeout(k.timer);
      k.timer = setTimeout(() => { if (this.s === s) this.kontextSuchen(s); }, KONTEXT_ABSTAND - (jetzt - k.zuletzt) + 50);
      return { ok: true, n: 0, spaeter: true };
    }
    return { ok: true, n: this.kontextSuchen(s) };
  }
  kontextSuchen(s) {
    const k = s.kontext, jetzt = Date.now();
    const anfrage = k.saetze.slice(-2).map((x) => x.satz).join(' ');
    const alle = s.index.suchen(anfrage, 4), top = alle.length ? alle[0].score : 0;
    // nur wirklich passende (absolut und nah am besten Treffer), keine, die er schon hat
    const treffer = alle.filter((t) => t.score >= KONTEXT_MIN && t.score >= top * 0.6 && !(jetzt - (k.gesendet[t.id] || 0) < KONTEXT_WIEDER)).slice(0, 2);
    if (!treffer.length) return 0;
    k.zuletzt = jetzt;
    for (const t of treffer) k.gesendet[t.id] = jetzt;
    this.anhaengen('thinking', kuerzen(stoffText(treffer), 1700));
    return treffer.length;
  }

  // SDP-Angebot der Oberfläche → Live-Sitzung anlegen → SDP-Antwort. Lehnt OpenAI die Optionen ab (400),
  // einmal schlicht ohne reasoning/service_tier versuchen.
  async verbinden(key, sdp, { nachAbriss = false, zuletzt = '' } = {}) {
    const s = this.s;
    if (!s || s.kurs !== key || ['beendet', 'fehler'].includes(s.zustand)) return { ok: false, text: 'Keine Sprechstunde offen.' };
    const schl = this.schluessel();
    if (!schl) return this.fehlschlag(s, 'Der OpenAI-Schlüssel fehlt (Einstellungen).');
    if (typeof sdp !== 'string' || !sdp.trim() || sdp.length > 65536) return this.fehlschlag(s, 'Mikrofon-Verbindung konnte nicht vorbereitet werden.');
    s.zustand = 'verbindet'; s.hinweis = nachAbriss ? 'Verbinde neu …' : 'Verbinde …';
    this.melden();
    if (process.env.LERNHUB_LIVE_ATTRAPPE && process.env.LERNHUB_TEST) {   // Tests: Konfiguration ablegen statt OpenAI anrufen
      try { fs.writeFileSync(path.join(this.ordner, 'attrappe-konfig.json'), JSON.stringify(this.konfig(s, { nachAbriss, zuletzt }), null, 1)); } catch { }
      s.liveId = 'live_attrappe';
      return { ok: true, sdp: 'attrappe' };
    }
    let letzter = '';
    for (const schlicht of [false, true]) {
      try {
        const r = await this.fetch(BASIS + '/v1/live/sessions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${schl}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: this.konfig(s, { schlicht, nachAbriss, zuletzt: String(zuletzt || '').slice(0, 1200) }), transport: { type: 'webrtc', sdp } }),
          signal: AbortSignal.timeout(20000),
        });
        if (this.s !== s || s.zustand === 'beendet') return { ok: false, text: 'Abgebrochen.' };
        if (r.ok) {
          const d = await r.json();
          if (!d || !d.transport || !d.transport.sdp) { letzter = 'OpenAI hat keine SDP-Antwort geschickt.'; break; }
          s.liveId = d.session && d.session.id;
          return { ok: true, sdp: d.transport.sdp };
        }
        const t = await r.text().catch(() => '');
        let msg = ''; try { msg = (JSON.parse(t).error || {}).message || ''; } catch { }
        if (r.status === 401 || r.status === 403) { letzter = 'OpenAI lehnt den Schlüssel ab. In den Einstellungen prüfen.'; break; }
        if (r.status === 429) { letzter = 'OpenAI meldet zu viele Sitzungen oder kein Guthaben (429).' + (msg ? ' ' + msg : ''); break; }
        letzter = `OpenAI antwortet mit ${r.status}${msg ? ': ' + msg : ''}`;
        if (r.status !== 400) break;
      } catch (e) {
        letzter = e && e.name === 'TimeoutError' ? 'OpenAI hat nicht rechtzeitig geantwortet.' : 'OpenAI nicht erreichbar. Internet prüfen.';
        break;
      }
    }
    return this.fehlschlag(s, letzter.slice(0, 300));
  }
  fehlschlag(s, text) {
    if (s.verbundenUm) {                             // mitten in der Sitzung: Stand bleibt, „Weitermachen“ möglich
      s.zustand = 'getrennt'; s.fehler = text; s.hinweis = '';
    } else { s.zustand = 'fehler'; s.fehler = text; }
    this.melden();
    return { ok: false, text };
  }


  // ------------------------------------------------ Ereignisse vom Datenkanal
  // Gibt der Oberfläche zurück, was mit der Verbindung passieren soll: { aktion: 'neu', warte } | { aktion: 'aufraeumen' } | {}
  ereignis(kurs, ev) {
    const s = this.s;
    if (!s || s.kurs !== kurs || !ev || typeof ev !== 'object') return {};
    try { return this.verarbeiten(s, ev) || {}; } catch (e) { console.error('Sprechstunde:', e); return {}; }
  }

  senden(ev) { try { this.beiSenden({ kurs: this.s && this.s.kurs, ev }); } catch (e) { console.error(e); } }
  anhaengen(art, content) {          // art: thinking | instructions | commentary
    this.senden({ type: `session.${art}.append`, event_id: `${art}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, delegation_id: null, content });
  }

  verarbeiten(s, ev) {
    switch (ev.type) {
      case 'session.started':
        s.zustand = 'laeuft'; s.hinweis = ''; s.fehler = null; s.verbundenUm = Date.now();
        if (s.pause) { s.pause = false; s.pauseSeit = 0; }
        this.wachHalten(true);
        this.melden();
        return null;
      case 'session.usage.updated':
        if (ev.usage && typeof ev.usage.seconds === 'number') s.sekunden = (s.sekundenVor || 0) + ev.usage.seconds;
        return null;
      case 'session.delegation.created':
        s.offeneDelegation = (ev.delegation && ev.delegation.id) || true;
        this.melden();
        return null;
      case 'response.event':
        this.backend(s, ev.delegation_id, ev.event || {});
        return null;
      case 'session.closed': {
        if (ev.usage && typeof ev.usage.seconds === 'number') s.sekunden = (s.sekundenVor || 0) + ev.usage.seconds;
        if (s.endeGewuenscht || s.zustand === 'beendet') { this.abschliessen(s); return { aktion: 'aufraeumen' }; }
        const r = this.abriss(s.kurs, ev.reason === 'expired' ? 'Die Sitzung hat ihre Höchstdauer erreicht.' : ev.reason === 'content' ? 'Die Sitzung wurde von OpenAI beendet.' : '');
        return r.nochmal ? { aktion: 'neu', warte: r.warte } : { aktion: 'aufraeumen' };
      }
      case 'error': {
        const e = ev.error || {};
        console.error('GPT-Live:', e.code, e.message);
        if (e.code === 'function_call_outputs_required' || e.code === 'tool_outputs_required') this.ausstehendSenden(s);
        return null;
      }
      default:
        return null;
    }
  }

  // Nested Responses-Ereignisse je Delegation: Funktionsaufrufe ausführen, Ergebnisse zurückschicken und, wenn die
  // Antwort fertig ist und alle Ergebnisse raus sind, einmal response.create (Doku: delegation.md).
  backend(s, delegationId, e) {
    const rid = delegationId || (e.response && e.response.id) || 'r';
    const a = s.anrufe[rid] || (s.anrufe[rid] = { offen: 0, aufrufe: 0, fertig: false, weiter: false });
    if (e.type === 'response.output_item.done' && e.item && e.item.type === 'function_call') {
      if (a.weiter) { a.weiter = false; a.fertig = false; }        // neue Aufrufe nach der Fortsetzung
      a.offen++; a.aufrufe++;
      const id = e.item.call_id;
      Promise.resolve().then(() => this.werkzeug(s, e.item.name, e.item.arguments))
        .catch((err) => 'Fehler: ' + (err && err.message))
        .then((out) => {
          if (this.s !== s) return;
          this.senden({ type: 'response.item.create', event_id: 'werkzeug_' + String(id).slice(-24), item: { type: 'function_call_output', call_id: id, output: String(out == null ? '' : out) } });
          a.offen--;
          this.weiter(s, rid);
        });
      return;
    }
    if (['response.completed', 'response.done', 'response.failed', 'response.incomplete', 'response.cancelled'].includes(e.type)) {
      a.fertig = true;
      if (!Object.values(s.anrufe).some((x) => x.offen > 0 || (x.aufrufe && !x.weiter))) {
        const vorher = s.offeneDelegation; s.offeneDelegation = null; if (vorher) this.melden();
      }
      this.weiter(s, rid);
    }
  }
  weiter(s, rid) {
    const a = s.anrufe[rid];
    if (!a || a.weiter || a.offen > 0 || !a.aufrufe) return;
    if (!a.fertig) {               // Ergebnisse sind raus, die Antwort ist noch nicht fertig: kurz warten, dann trotzdem
      clearTimeout(a.timer);
      a.timer = setTimeout(() => { a.fertig = true; this.weiter(s, rid); }, 3000);
      return;
    }
    clearTimeout(a.timer);
    a.weiter = true;
    this.senden({ type: 'response.create', event_id: 'weiter_' + String(rid).slice(-16) + '_' + Date.now().toString(36) });
    if (!Object.values(s.anrufe).some((x) => x.offen > 0 || (x.aufrufe && !x.weiter))) { s.offeneDelegation = null; this.melden(); }
  }
  ausstehendSenden(s) {            // Backend vermisst Ergebnisse: wartende Antworten sofort anstoßen
    for (const [rid, a] of Object.entries(s.anrufe)) if (!a.weiter && a.offen === 0 && a.aufrufe) { a.fertig = true; this.weiter(s, rid); }
  }

  async werkzeug(s, name, argText) {
    let arg = {};
    try { arg = JSON.parse(argText || '{}') || {}; } catch { }
    if (name === 'thema_eintragen') return this.themaEintragen(s, arg);
    if (name === 'stoff_suchen' || name === 'stoff_nachschlagen') {
      const anfrage = String(arg.anfrage || arg.frage || arg.thema || '').slice(0, 300);
      const treffer = s.index ? s.index.suchen(anfrage, 3) : [];
      if (!treffer.length) return 'Dazu steht nichts im Kursstoff.';
      for (const t of treffer) s.kontext.gesendet[t.id] = Date.now();
      return kuerzen(treffer.map((t) => `[${t.quelle}] ${sprechbar(t.text)}`).join('\n'), 2400);
    }
    if (name === 'sitzung_beenden') {
      s.endeGewuenscht = true;
      setTimeout(() => { if (this.s === s && s.zustand !== 'beendet') this.beenden(s.kurs); }, 7000);   // Abschied ausklingen lassen
      return 'Die Sitzung endet gleich.';
    }
    return 'Unbekanntes Werkzeug.';
  }

  // Schlüssel oder Titel → Thema (Hörfehler, Schreibweisen)
  themaFinden(s, x) {
    const n = normThema(x);
    if (!n) return null;
    return s.themen.find((k) => normThema(k.thema) === n) || s.themen.find((k) => normThema(k.titel) === n)
      || s.themen.find((k) => n.length >= 4 && (normThema(k.titel).includes(n) || n.includes(normThema(k.thema)))) || null;
  }

  // Ein Thema ist durch: Leitner-Stand wie im Wiederholen (ueben.py --log). Jedes Thema nur einmal je Sitzung.
  async themaEintragen(s, arg) {
    const k = this.themaFinden(s, arg.thema);
    if (!k) return `Unbekanntes Thema. Schlüssel: ${s.themen.map((x) => x.thema).join(', ')}`;
    if (k.ergebnis) return 'Schon eingetragen.';
    let erg = ['geloest', 'hinweise', 'aufgegeben'].includes(arg.ergebnis) ? arg.ergebnis : 'hinweise';
    const stufe = /^R[0-5]$/.test(arg.stufe || '') ? arg.stufe : null;
    if (erg === 'geloest' && stufe && +stufe.slice(1) >= 2) erg = 'hinweise';
    const t = Date.now();
    k.ergebnis = erg;
    this.dranGewesen(s, k);
    s.stat.karten++; s.stat[erg]++;
    const e = { von: 'tutor', art: 'abschluss', nr: s.verlauf.filter((v) => v.art === 'abschluss').length + 1, ergebnis: erg, stufe, thema: k.thema, titel: k.titel, t };
    s.verlauf.push(e);
    const args = [B.skript('ueben.py'), s.ws, '--log', k.thema, erg, '--zeit', String(this.zeitSek(s, t))];
    if (stufe) args.push('--stufe', stufe);
    this.melden();
    try { e.log = (await B.lauf(P.PYTHON, args, { timeout: 30000 })).trim(); } catch (err) { e.log = '⚠️ nicht eingetragen: ' + err.message; }
    if (this.s === s) this.melden();
    return 'Eingetragen.';
  }

  zeitSek(s, t = Date.now()) {
    const sek = Math.ceil(Math.min(t - (s.zeitAb || s.start), 600000) / 1000);
    s.zeitAb = t;
    return Math.max(0, s.pauseSeit ? 0 : sek);
  }

  // ------------------------------------------------ Pause, Abriss, Ende
  pause(key, an) {
    const s = this.s;
    if (!s || s.kurs !== key || s.zustand !== 'laeuft') return { ok: false };
    if (an && !s.pause) {
      s.pause = true; s.pauseSeit = Date.now();
      this.senden({ type: 'session.input_audio.mute', event_id: 'mute_' + Date.now().toString(36) });
      this.anhaengen('instructions', 'Er hat Pause gedrückt. Hör sofort auf zu sprechen und sag nichts, bis die Pause endet.');
      clearTimeout(s.pauseTimer);
      s.pauseTimer = setTimeout(() => {         // lange Pause: Sitzung schließen, Stand bleibt, „Weitermachen“ verbindet neu
        if (this.s === s && s.pause) { s.langePause = true; this.senden({ type: 'session.close', event_id: 'close_pause' }); }
      }, PAUSE_LANG);
    } else if (!an && s.pause) {
      s.pause = false;
      s.zeitAb = Date.now(); s.pauseSeit = 0;
      clearTimeout(s.pauseTimer);
      this.senden({ type: 'session.input_audio.unmute', event_id: 'unmute_' + Date.now().toString(36) });
      this.anhaengen('instructions', 'Die Pause ist vorbei, er ist zurück. Sag kurz „Weiter geht’s“ und greif auf, wo ihr wart.');
    }
    this.melden();
    return { ok: true };
  }

  // Die Oberfläche meldet: Verbindung weg (ohne session.closed) oder Sitzung lange pausiert und geschlossen
  abriss(kurs, grund = '') {
    const s = this.s;
    if (!s || s.kurs !== kurs || ['beendet', 'getrennt', 'fehler'].includes(s.zustand)) return { ok: false, nochmal: false };
    if (s.endeGewuenscht) { this.abschliessen(s); return { ok: true, nochmal: false }; }
    this.wachHalten(false);
    s.sekundenVor = s.sekunden || 0;
    s.anrufe = {}; s.offeneDelegation = null;
    if (s.langePause) {
      s.zustand = 'getrennt'; s.pause = false; s.langePause = false; s.fehler = null;
      s.hinweis = 'Lange Pause: Ich habe aufgelegt, damit keine Kosten laufen. „Weitermachen“ verbindet neu.';
      this.melden();
      return { ok: true, nochmal: false };
    }
    if (s.neuVersuch >= MAX_NEU) {
      s.zustand = 'getrennt'; s.fehler = grund || 'Die Verbindung ist mehrmals abgerissen.'; s.hinweis = '';
      this.melden();
      return { ok: true, nochmal: false };
    }
    s.neuVersuch++;
    s.zustand = 'verbindet'; s.hinweis = 'Verbindung kurz weg, ich verbinde neu …';
    this.melden();
    return { ok: true, nochmal: true, warte: [1500, 4000, 9000][s.neuVersuch - 1] || 9000 };
  }
  // „Weitermachen“ nach Abriss oder langer Pause
  fortsetzen(kurs) {
    const s = this.s;
    if (!s || s.kurs !== kurs || s.zustand !== 'getrennt') return { ok: false };
    s.neuVersuch = Math.min(s.neuVersuch, MAX_NEU - 1);
    s.zustand = 'verbindet'; s.fehler = null; s.hinweis = 'Verbinde neu …'; s.zeitAb = Date.now(); s.pauseSeit = 0;
    this.melden();
    return { ok: true };
  }

  // Beenden: Live-Sitzung sauber schließen (die Oberfläche wartet auf session.closed, höchstens 15 s)
  beenden(kurs) {
    const s = this.s;
    if (!s || s.kurs !== kurs) return { ok: false };
    s.endeGewuenscht = true;
    if (['laeuft', 'verbindet'].includes(s.zustand) && s.liveId) {
      this.senden({ type: 'session.close', event_id: 'close_' + Date.now().toString(36) });
      s.hinweis = 'Ich lege auf …'; this.melden();
      clearTimeout(s.endeTimer);
      s.endeTimer = setTimeout(() => this.abschliessen(s), 16000);
      return { ok: true };
    }
    this.abschliessen(s);
    return { ok: true };
  }
  // Transport ist zu (nach session.closed, Zeitüberschreitung oder ohne Verbindung)
  abschliessen(s = this.s) {
    if (!s || s.zustand === 'beendet') return;
    clearTimeout(s.endeTimer); clearTimeout(s.pauseTimer);
    this.wachHalten(false);
    const offen = !!s.verbundenUm;
    s.zustand = 'beendet'; s.ende = Date.now(); s.hinweis = '';
    this.senden({ type: 'lernhub.aufraeumen' });         // Oberfläche: Mikrofon und Verbindung freigeben
    this.melden();
    const rest = offen && !s.pauseSeit
      ? B.lauf(P.PYTHON, [B.skript('ueben.py'), s.ws, '--zeit', String(this.zeitSek(s))], { timeout: 30000 }).catch(() => { })
      : null;
    Promise.resolve(rest).then(() => { if (s.stat.karten || offen) this.beiEnde(s); });
  }
  // Ergebnisansicht schließen
  verwerfen(kurs) {
    if (this.s && this.s.kurs === kurs && ['beendet', 'fehler'].includes(this.s.zustand)) { const id = this.s.kurs; this.s = null; this.beiStand({ kurs: id, weg: true }); }
    return { ok: true };
  }
  // App wird beendet
  aus() {
    const s = this.s;
    if (s && s.zustand !== 'beendet') { s.endeGewuenscht = true; this.senden({ type: 'session.close', event_id: 'close_quit' }); this.abschliessen(s); }
  }
}

module.exports = { Sprechstunde, tutorPrompt, backendPrompt, rahmenText, stoffText, sprechbar, WERKZEUGE, STIMMEN };
