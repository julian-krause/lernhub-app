// Bausteine live: Kommen sie nur, wenn sie logisch passen? Echter `claude -p` mit genau dem System-Prompt und
// Schema von „Lernen“ (src/main/lernen.js), drei kleine Lektionen mit eigenem Material. Nach dem ersten Zug kommen
// Rückfragen, bei denen feststeht, ob eine Grafik hingehört (Zielkonflikt, Reihenfolge, Kostenverlauf) oder nicht
// (Definition, Dank, Code). Kostet Abo-Zeit (je Lauf vierzehn Züge), deshalb nicht in `npm test`.
// Aufruf: npm run test:bilder-live   (LIVE_LOG=datei.json schreibt alle Antworten mit)
import { createRequire } from 'module';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { baustein, BAUSTEINE } from '../src/ui/js/bilder.js';

process.env.KURSTUTOR_ROOT ||= os.tmpdir();          // pfade.js soll nicht nach dem Studienordner suchen
const require = createRequire(import.meta.url);
const { SCHEMA, systemPrompt, startText } = require('../src/main/lernen.js');
const CLAUDE = [process.env.LERNHUB_CLAUDE, path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude'].find((p) => p && fs.existsSync(p));
if (!CLAUDE) { console.log('Übersprungen: claude nicht gefunden.'); process.exit(0); }
const MODELL = process.env.LERNHUB_LERNEN_MODELL || 'opus', EFFORT = process.env.LERNHUB_LERNEN_EFFORT || 'medium';

let fehler = 0;
const check = (ok, text) => { console.log((ok ? '✓ ' : '✗ ') + text); if (!ok) { fehler++; process.exitCode = 1; } };

// ---------------------------------------------------------------- Lektionen und Rückfragen
// soll: erlaubte Bausteine; 'keiner' = gar kein Baustein. code: Antwort muss Code mit Sprache zeigen.
const LEKTIONEN = [
  {
    kurs: 'BWL III', id: 'K.1', titel: 'Ziele der Materialwirtschaft und Zielkonflikte',
    material: `Seite 10–11 (K.1): Die Materialwirtschaft verfolgt drei Zielbereiche. Kosten: niedrige Einstandspreise, geringe Kapitalbindung, niedrige Lager- und Bestellkosten. Qualität: Qualitätssicherung des Materials, Verhinderung qualitätsmindernder Liegezeiten, zuverlässige Lieferanten. Zeit/Service: hohe Lieferbereitschaft (Servicegrad), kurze Lieferzeiten, Termintreue.
Die Ziele stehen in Konflikt. Beispiel Fahrradhersteller: Erhöht er den Sicherheitsbestand an Bremsen, steigt die Lieferbereitschaft, aber auch Kapitalbindung und Lagerkosten. Kauft er Rahmen beim billigsten Anbieter in großen Mengen, sinkt der Einstandspreis, aber Qualitäts- und Terminrisiko sowie Kapitalbindung steigen. Setzt er auf geprüfte Premiumlieferanten mit Eingangsprüfung, steigt die Qualität, aber Preise und Durchlaufzeit steigen.
Klausurhinweis: „Kritisch diskutieren“ heißt, die Wirkungskette zu nennen: Maßnahme → was steigt → was leidet.`,
    fragen: [
      { text: 'Kannst du mir für die drei Maßnahmen beim Fahrradhersteller noch mal nebeneinander zeigen, was jeweils gewinnt und was verliert?', soll: ['zielkonflikt', 'vergleich'] },
      { text: 'Was heißt eigentlich Kapitalbindung genau?', soll: ['keiner', 'rechnung'] },   // Definition: keine Grafik, ein Rechenbeispiel ist in Ordnung
    ],
  },
  {
    kurs: 'BWL III', id: 'K.2', titel: 'Optimale Bestellmenge (Andler)',
    material: `Seite 18–20 (K.2): Die optimale Bestellmenge minimiert die Summe aus Bestellkosten und Lagerhaltungskosten pro Jahr. Bestellkosten pro Jahr = M / x · K_B (M Jahresbedarf, x Bestellmenge, K_B fixe Kosten je Bestellung): Sie sinken mit größerer Bestellmenge. Lagerhaltungskosten pro Jahr = x / 2 · p · q (p Einstandspreis, q Lagerhaltungskostensatz): Sie steigen linear mit der Bestellmenge. Andler-Formel: x_opt = √(2 · M · K_B / (p · q)).
Beispiel: M = 12 000 Stück, K_B = 50 €, p = 10 €, q = 20 %. Annahmen: konstanter Bedarf, keine Mengenrabatte, keine Fehlmengen.`,
    fragen: [
      { text: 'Ich versteh nicht, warum es überhaupt ein Optimum gibt. Wie verhalten sich die beiden Kostenarten, wenn ich die Bestellmenge von 200 bis 1500 Stück verändere?', soll: ['kurve', 'kette'] },
      { text: 'Danke, das hab ich jetzt verstanden.', soll: ['keiner'] },
      { text: 'Rechne mir bitte die optimale Bestellmenge mit den Zahlen aus dem Beispiel einmal Schritt für Schritt vor.', soll: ['formel', 'rechnung'] },
    ],
  },
  {
    kurs: 'BPL', id: 'P.3', titel: 'Wettbewerbsstrategien und vertikale Integration',
    material: `Seite 30–34 (P.3): Porter unterscheidet Wettbewerbsstrategien nach zwei Merkmalen: dem Wettbewerbsvorteil (niedrige Kosten oder hoher Kundennutzen) und dem Wettbewerbsfeld (breit, also Gesamtmarkt, oder eng, also Teilmarkt). Daraus ergeben sich Kostenführerschaft, Differenzierung, Nische mit Kostenschwerpunkt und Nische mit Differenzierungsschwerpunkt.
Vertikale Integration: Ein Unternehmen übernimmt vor- oder nachgelagerte Stufen der Wertschöpfungskette. Nach dem Integrationsgrad geordnet: volle Integration (eigene Stufe), partielle Integration (teils selbst, teils zugekauft), Quasi-Integration (Beteiligungen, enge Bindung), langfristige Verträge (niedrigster Grad).
Wertschöpfungsquote = (Umsatz − fremdbezogene Leistungen) / Umsatz. Beispiel: Ein Betrieb setzt 1.000 Stück zu 20 € ab. Bisher kauft er Vorleistungen für 10 € je Stück zu, künftig für 12 € je Stück.`,
    fragen: [
      { text: 'Wie hängen die vier Strategien von Porter zusammen? Ich bring die immer durcheinander.', soll: ['matrix', 'vergleich'] },
      { text: 'Wie ordne ich die Integrationsformen ein, von stark bis schwach?', soll: ['skala', 'ablauf'] },
      { text: 'Wie verändert sich die Wertschöpfungsquote im Beispiel, wenn er künftig mehr zukauft? Rechne es mir vor.', soll: ['rechnung', 'formel'] },
    ],
  },
  {
    kurs: 'SWE II', id: 'L11', titel: 'Sockets: Client und Server in Java', programmcode: true,
    material: `Folie 12–18 (L11): Ein Server erzeugt ein ServerSocket auf einem Port und wartet mit accept() auf einen Client. accept() blockiert und liefert für jede Verbindung ein eigenes Socket-Objekt. Der Client erzeugt new Socket(host, port); damit wird die TCP-Verbindung aufgebaut. Beide Seiten lesen und schreiben über getInputStream() und getOutputStream(), meist eingepackt in BufferedReader und PrintWriter. Am Ende werden die Ströme und der Socket mit close() geschlossen, am besten mit try-with-resources.`,
    fragen: [
      { text: 'Zeig mir mal den Code für einen ganz einfachen Client, der eine Zeile an den Server schickt.', soll: ['keiner'], code: true },
      { text: 'In welcher Reihenfolge passiert das beim Verbindungsaufbau, von new ServerSocket bis zum ersten gelesenen Text?', soll: ['ablauf', 'kette'] },
    ],
  },
];

// ---------------------------------------------------------------- ein Zug wie in Lernen.zug
function zug(s, auftrag) {
  const args = ['-p', '--model', MODELL, '--effort', EFFORT, '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA),
    '--setting-sources', '', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--allowedTools', 'Read',
    '--disallowedTools', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'];
  if (s.gestartet) args.push('--resume', s.sessionId); else args.push('--session-id', s.sessionId, '--append-system-prompt', systemPrompt(s));
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;
  return new Promise((ok, nein) => {
    const k = spawn(CLAUDE, args, { cwd: s.ordner, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => k.kill('SIGTERM'), 8 * 60000);
    k.stdout.on('data', (b) => { out += b; }); k.stderr.on('data', (b) => { err += b; });
    k.on('close', () => {
      clearTimeout(t);
      try { const d = JSON.parse(out); s.gestartet = true; const x = d.structured_output || JSON.parse(d.result); if (!x || !x.art) throw new Error('ohne art'); ok(x); }
      catch (e) { nein(new Error(`Zug gescheitert: ${e.message} ${err.slice(-300)} ${out.slice(0, 300)}`)); }
    });
    k.stdin.end(auftrag);
  });
}

// ---------------------------------------------------------------- Auswertung
const BLOCK = /```[ \t]*([\w+-]*)[ \t]*\n([\s\S]*?)```/g;
const bloecke = (t) => [...String(t || '').matchAll(BLOCK)].map((m) => ({ sprache: m[1].toLowerCase(), inhalt: m[2] }));
const istBaustein = (b) => Object.hasOwn(BAUSTEINE, b.sprache);
// Skizze aus Zeichen: Rahmenzeichen, Pfeile oder Spalten aus Leerzeichen in einem Block ohne Sprache. Ausgerichtete
// Rechenzeilen (mit „=“) sind eine Rechnung und erlaubt.
const skizze = (b) => (!b.sprache || b.sprache === 'text') && (/[┌┐└┘│─├┤]|-->|<--|==>/.test(b.inhalt) || b.inhalt.split('\n').filter((z) => /\S {3,}\S/.test(z) && !z.includes('=')).length >= 2);
function pruefen(x, wo, programmcode) {
  const frei = ['text', 'erklaerung'].flatMap((f) => bloecke(x[f]));
  // in frage und loesung ist nur die rechnung erlaubt (Lückenrechnung), in den Optionen gar nichts
  const verboten = [...['frage', 'loesung'].flatMap((f) => bloecke(x[f]).filter((b) => istBaustein(b) && b.sprache !== 'rechnung')),
    ...(x.optionen || []).flatMap((o) => bloecke(o).filter(istBaustein))];
  const ueberall = ['text', 'erklaerung', 'frage', 'loesung'].flatMap((f) => bloecke(x[f])).concat((x.optionen || []).flatMap(bloecke));
  const bs = frei.filter(istBaustein), grafik = bs.filter((b) => b.sprache !== 'rechnung');
  check(grafik.length <= 1 && bs.length - grafik.length <= 2, `${wo}: höchstens eine Grafik und zwei Rechnungen (${bs.map((b) => b.sprache).join(', ') || 'keiner'})`);
  check(ueberall.filter(istBaustein).every((b) => baustein(b.sprache, b.inhalt)), `${wo}: jeder Baustein ist lesbar und wird gezeichnet`);
  check(!verboten.length, `${wo}: kein Baustein in Optionen, in Frage und Lösung höchstens eine rechnung`);
  check(!ueberall.some(skizze), `${wo}: keine Skizze aus Leerzeichen, Kästen oder Pfeilen im Codeblock`);
  if (!programmcode) check(!ueberall.some((b) => !istBaustein(b)), `${wo}: kein grauer Codeblock (Kurs ohne Programmcode)`);
  return { bs, grafik, alle: frei };
}

// ---------------------------------------------------------------- Lauf
const protokoll = [];
async function lektion(L) {
  const s = { kursName: L.kurs, lektion: { id: L.id, title: L.titel }, budget: 20, maxSchritte: 6, sessionId: crypto.randomUUID(), gestartet: false,
    ordner: fs.mkdtempSync(path.join(os.tmpdir(), 'bilder-live-')) };
  const kontext = `## Material dieser Lektion\n\n${L.material}`;
  const erg = [];
  const x0 = await zug(s, startText(s, kontext));
  erg.push({ wo: `${L.id} erster Zug`, x: x0, programmcode: L.programmcode });
  let uhr = 3;
  for (const f of L.fragen) {
    const auftrag = (x0.art === 'frage' ? 'Rückfrage, während Frage 1 offen ist (noch keine Antwort; antworte mit art "text", die Frage bleibt offen):\n' : '') + f.text + `\n[Lektionsuhr: ${uhr} von 20 Min.]`;
    uhr += 2;
    erg.push({ wo: `${L.id} „${f.text.slice(0, 48)}…“`, f, programmcode: L.programmcode, x: await zug(s, auftrag) });
  }
  return erg;
}

const t0 = Date.now();
console.log(`Bausteine live: ${LEKTIONEN.length} Lektionen, Modell ${MODELL}/${EFFORT}. Dauert ein paar Minuten …`);
const alle = (await Promise.all(LEKTIONEN.map((L) => lektion(L).catch((e) => [{ wo: L.id, fehler: e.message }])))).flat();
let treffer = 0, erwartet = 0;
for (const e of alle) {
  if (e.fehler) { check(false, `${e.wo}: ${e.fehler}`); continue; }
  const { grafik, bs, alle: bl } = pruefen(e.x, e.wo, e.programmcode);
  if (e.f) {
    erwartet++;
    const typ = grafik.length ? grafik[0].sprache : bs.length ? bs[0].sprache : 'keiner';
    const ok = e.f.soll.includes(typ);
    if (ok) treffer++;
    check(ok, `${e.wo}: ${typ} (passend: ${e.f.soll.join(' oder ')})`);
    if (e.f.code) check(bl.some((b) => b.sprache && !istBaustein(b)), `${e.wo}: Code als Codeblock mit Sprache`);
  }
  protokoll.push({ wo: e.wo, bausteine: bs.map((b) => b.sprache), antwort: e.x });
}
console.log(`\nRückfragen mit passender Wahl: ${treffer} von ${erwartet} · ${Math.round((Date.now() - t0) / 1000)} s`);
if (process.env.LIVE_LOG) fs.writeFileSync(process.env.LIVE_LOG, JSON.stringify(protokoll, null, 1));
console.log(fehler ? `${fehler} Fehler` : 'Bausteine live: alles in Ordnung');
