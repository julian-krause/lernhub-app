// Sprechstunde (Wiederholen per Sprache, GPT-Live): erst die Logik im Hauptprozess (Rahmen, Kursstoff-Suche,
// laufender Kontext, Werkzeuge, Abriss, Ende) gegen eine OpenAI-Attrappe, dann Ende-zu-Ende in der App mit einem
// simulierten Datenkanal (LERNHUB_LIVE_ATTRAPPE). Nie Netz, nie der echte Schlüsselbund. Aufruf: node tests/sprechstunde.test.mjs
import { createRequire } from 'module';
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { bereiten, check, warte, willkommenZu } from './umgebung.mjs';

const U = bereiten();
const KURS = U.kurs, SLUG = U.slug, ws = path.join(U.sem, KURS, 'Lernbereich');
try { fs.unlinkSync(path.join(ws, 'uebung.json')); } catch { }
console.log('Testordner:', U.T);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 1. Hauptprozess-Logik
Object.assign(process.env, U.env, { LERNHUB_SPRECH_KONTEXT_MS: '200' });
const require = createRequire(import.meta.url);
const M = require('../src/main/sprechstunde.js');
const { Index, teilen } = require('../src/main/suche.js');

// Suche
const ix = new Index([
  ...teilen('L8 Branches & Fast-Forward-Merge', 'Beim Fast-Forward-Merge wird main einfach vorgespult.\nDer Branch feature bleibt unberührt.', { themen: ['ff-merge'] }),
  ...teilen('L7 Tag-Objekte', 'Ein annotierter Tag legt ein Tag-Objekt an. Es enthält object, type, tag und tagger.', { themen: ['tag-objekt'] }),
  ...teilen('glossar', 'Blob-Objekt: der reine Inhalt einer Datei ohne Namen.'),
]);
check(ix.suchen('Was passiert beim Fast-Forward mit main?', 1)[0].quelle.startsWith('L8'), 'Suche: Fast-Forward → L8');
check(ix.suchen('lass uns über Tag-Objekte reden', 1)[0].quelle.startsWith('L7'), 'Suche: Tag-Objekte → L7 (Füllwörter egal)');
check(ix.suchen('äh ja also', 3).length === 0, 'Suche: nur Füllwörter → nichts');
const t0 = performance.now(); for (let i = 0; i < 200; i++) ix.suchen('Blob Inhalt Datei Namen'); check((performance.now() - t0) / 200 < 2, 'Suche schneller als 2 ms');

const tp = M.tutorPrompt({ kursName: 'Testkurs', tempo: 'zuegig', themen: [{ thema: 'x-y', titel: 'x y', faellig: true, luecke: true, lektionen: ['L2'] }, { thema: 'L1', titel: 'Drei Bereiche', faellig: false, lektionen: ['L1'] }] });
check(/Backchannel policy:/.test(tp) && /Interruption policy:/.test(tp) && /Delegation policy:/.test(tp) && /Delegate to the backend when:/.test(tp), 'Tutor-Prompt mit den drei Policy-Abschnitten aus der GPT-Live-Doku');
check(/zügig/.test(tp) && /Keine beruhigenden/.test(tp), 'Tutor-Prompt: normaler Ton, zügiges Tempo');
check(/keinen festen Ablauf und keine festen Fragen/.test(tp) && /Will er ein anderes Thema/.test(tp) && /Lücke offen/.test(tp) && /gerade nicht fällig/.test(tp), 'Tutor-Prompt: Rahmen aus allen Themen, frei wählbar, anderes Thema auf Zuruf');
check(/Sag nicht „ich prüfe kurz“/.test(tp), 'Tutor-Prompt: kein „ich prüfe kurz“ ohne echten Grund');

const gesendet = [];
let anfragen = [], antworten = [];
const fakeFetch = async (url, opt) => {
  anfragen.push({ url, opt, body: JSON.parse(opt.body) });
  const a = antworten.shift() || { status: 201, json: { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'ANTWORT-SDP' } } };
  return { ok: a.status < 300, status: a.status, json: async () => a.json, text: async () => JSON.stringify(a.json || {}) };
};
let wach = null, enden = 0;
const ordner = path.join(U.T, 'sprech-unit');
const sp = new M.Sprechstunde({ ordner, fetch: fakeFetch, schluessel: () => 'sk-test-1234567890abcdef', beiSenden: (x) => gesendet.push(x.ev), beiEnde: () => { enden++; }, wachHalten: (a) => { wach = a; } });
const c = { key: KURS, name: KURS, ws };

const t1 = Date.now();
const r1 = await sp.starten(c);
check(r1.ok && sp.s.themen.length > 0 && sp.s.index && sp.s.zustand === 'verbindet', `Start ohne Kartenbau: ${sp.s.themen.length} Themen, Suchindex in ${Date.now() - t1} ms`);
antworten = [{ status: 400, json: { error: { message: 'Unsupported parameter: service_tier' } } }];
const v1 = await sp.verbinden(KURS, 'v=0 ANGEBOT');
check(v1.ok && v1.sdp === 'ANTWORT-SDP', 'SDP-Angebot → SDP-Antwort');
check(anfragen.length === 2 && anfragen[0].body.session.delegation.responses.service_tier && !anfragen[1].body.session.delegation.responses.service_tier,
  'Abgelehnte Optionen (400): zweiter Versuch ohne service_tier/reasoning');
const b = anfragen[1].body, a0 = anfragen[1];
check(a0.url.endsWith('/v1/live/sessions') && a0.opt.headers.Authorization === 'Bearer sk-test-1234567890abcdef', 'POST /v1/live/sessions mit Bearer-Schlüssel (nur im Hauptprozess)');
check(b.session.model === 'gpt-live-1.1' && b.session.audio.output.voice === 'juni' && b.transport.type === 'webrtc', 'Modell gpt-live-1.1, deutsche Stimme, WebRTC');
check(b.session.delegation.responses.tools.map((t) => t.name).join() === 'thema_eintragen,stoff_suchen,sitzung_beenden', 'Responses-Delegation mit den drei Werkzeugen');
check(sp.s.themen.every((t) => b.session.instructions.includes(t.titel)), 'Rahmen: alle gelernten Themen in den Instructions');
const einstieg = b.session.input[0].content[0].text;
check(/Begrüße/.test(einstieg) && /Kursstoff/.test(einstieg) && /nicht vorlesen/.test(einstieg), 'Einstieg mit Kursstoff zu den ersten fälligen Themen');

sp.ereignis(KURS, { type: 'session.started' });
check(sp.s.zustand === 'laeuft' && wach === true, 'session.started: läuft, Bildschirm bleibt wach');

// Laufender Kontext: Satz des Tutors → passender Stoff still nachgeschoben, nicht doppelt, nicht bei Füllwörtern
const fremd = sp.s.themen.find((t) => !t.faellig) || sp.s.themen[sp.s.themen.length - 1];
gesendet.length = 0;
const k1 = sp.kontext(KURS, { wer: 'tutor', text: `Lass uns zu ${fremd.titel} gehen. Was weißt du darüber?` });
const stoff1 = gesendet.find((e) => e.type === 'session.thinking.append');
check(k1.n > 0 && stoff1 && stoff1.delegation_id === null && /Kursstoff/.test(stoff1.content) && stoff1.content.length < 2000, `Satz des Tutors → Kursstoff still nachgeschoben (${fremd.titel})`);
await pause(250);
gesendet.length = 0;
sp.kontext(KURS, { wer: 'tutor', text: `Lass uns zu ${fremd.titel} gehen. Was weißt du darüber?` });
const abschnitte = (e) => (e ? e.content.split('\n').filter((z) => z.startsWith('[')) : []);
const zweit = gesendet.find((e) => e.type === 'session.thinking.append');
check(!abschnitte(zweit).some((z) => abschnitte(stoff1).includes(z)), 'Derselbe Abschnitt wird nicht nochmal geschickt');
check(sp.kontext(KURS, { wer: 'ich', text: 'äh' }).n === 0, 'Füllwörter lösen nichts aus');

// Abwechslung: „Mach was anderes“ → sofort neues Thema aus einer anderen Lektion, mit Stoff; gemerkt über Sitzungen
check(/Vorschläge für heute/.test(b.session.instructions) && /Alle Themen nach Lektion/.test(b.session.instructions), 'Rahmen: Vorschläge für heute und alle Themen nach Lektion');
check(sp.s.besprochen.length >= 1, `Einstiegsthema und genannte Themen gemerkt (${sp.s.besprochen.join(', ')})`);
await pause(250);
gesendet.length = 0;
const vorher = [...sp.s.besprochen];
const w1 = sp.kontext(KURS, { wer: 'ich', text: 'Ey, mach mal was anderes, das hatten wir schon.' });
const wh = gesendet.find((e) => e.type === 'session.thinking.append');
const neuT = sp.s.besprochen.find((x) => !vorher.includes(x));
check(w1.wechsel && wh && /Er will etwas anderes/.test(wh.content) && neuT, `„Mach was anderes“: sofort neues Thema vorgeschlagen (${neuT})`);
check(!vorher.includes(neuT), 'Das neue Thema war in dieser Sitzung noch nicht dran');
const verl = JSON.parse(fs.readFileSync(path.join(ordner, 'themen-verlauf.json'), 'utf8'))[KURS] || {};
check(verl[neuT] > 0, 'Besprochene Themen für die nächsten Sitzungen gemerkt');
check(sp.kontext(KURS, { wer: 'tutor', text: 'Okay, dann machen wir etwas anderes.' }).wechsel !== true, 'Nur seine Sätze lösen den Wechsel aus');
{
  const sx = { themen: sp.s.themen.map((t) => ({ ...t, ergebnis: null, dran: verl[t.thema] || 0 })), besprochen: [] };
  const oft = new Map();
  for (let i = 0; i < 30; i++) for (const t of sp.themenWahl(sx, 2)) oft.set(t.thema, (oft.get(t.thema) || 0) + 1);
  check(oft.size >= Math.min(3, sx.themen.length), `Einstieg wechselt zwischen Sitzungen (${oft.size} verschiedene Themen in 30 Läufen)`);
  check(!(oft.get(neuT) > 0) || sx.themen.filter((t) => !t.dran).length < 2, 'Kürzlich besprochene Themen kommen nicht wieder zum Einstieg');
}
const st = await sp.werkzeug(sp.s, 'stoff_suchen', JSON.stringify({ anfrage: fremd.titel }));
check(/\[L\d+|\[/.test(st) && !/```/.test(st), 'stoff_suchen: Treffer aus dem ganzen Kurs, sprechbar');

// Werkzeug: Thema eintragen (beliebiges Thema des Kurses) → ueben.py --log, Ergebnis zurück, response.create
gesendet.length = 0;
const thema1 = sp.s.themen[2].thema;
sp.ereignis(KURS, { type: 'session.delegation.created', delegation: { id: 'item_d1', target: 'responses' } });
sp.ereignis(KURS, { type: 'response.event', delegation_id: 'item_d1', event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call_1', name: 'thema_eintragen', arguments: JSON.stringify({ thema: thema1, ergebnis: 'geloest', stufe: 'R0' }) } } });
await warte(async () => gesendet.some((e) => e.type === 'response.item.create'), { text: 'Werkzeugergebnis' });
const out = gesendet.find((e) => e.type === 'response.item.create');
check(out.item.type === 'function_call_output' && out.item.call_id === 'call_1' && /Eingetragen/.test(out.item.output), 'function_call_output mit call_id zurück');
check(!gesendet.some((e) => e.type === 'response.create'), 'response.create erst, wenn die Antwort fertig ist');
sp.ereignis(KURS, { type: 'response.event', delegation_id: 'item_d1', event: { type: 'response.completed', response: { id: 'resp_1', output: [] } } });
check(gesendet.filter((e) => e.type === 'response.create').length === 1 && !sp.s.offeneDelegation, 'Danach genau ein response.create');
const uj = JSON.parse(fs.readFileSync(path.join(ws, 'uebung.json'), 'utf8'));
check(uj.themen[thema1] && uj.themen[thema1].fach >= 1, `Ergebnis in uebung.json (${thema1} → Fach ${uj.themen[thema1] && uj.themen[thema1].fach}), derselbe Stand wie „Wiederholen“`);
check(sp.s.verlauf[0].art === 'abschluss' && sp.s.verlauf[0].nr === 1 && sp.s.stat.geloest === 1, 'Verlauf im Format von „Wiederholen“ (XP, Serie)');
check(/Schon eingetragen/.test(await sp.werkzeug(sp.s, 'thema_eintragen', JSON.stringify({ thema: thema1, ergebnis: 'aufgegeben', stufe: 'R4' }))) && sp.s.stat.karten === 1, 'Dasselbe Thema zweimal: nur einmal eingetragen');
check(/Eingetragen/.test(await sp.werkzeug(sp.s, 'thema_eintragen', JSON.stringify({ thema: sp.s.themen[0].titel, ergebnis: 'geloest', stufe: 'R3' }))) && sp.s.themen[0].ergebnis === 'hinweise', 'Thema über den Titel gefunden; ab R2 „mit Hinweisen“');
check(/Unbekanntes Thema/.test(await sp.werkzeug(sp.s, 'thema_eintragen', '{"thema":"gibts-nicht","ergebnis":"geloest","stufe":"R0"}')), 'Unbekanntes Thema: Hinweis statt Falscheintrag');
check(typeof (await sp.werkzeug(sp.s, 'thema_eintragen', 'kein json')) === 'string', 'Kaputte Argumente: Antwort statt Absturz');
sp.ereignis(KURS, null); sp.ereignis(KURS, { type: 'irgendwas' }); sp.ereignis('anderer-kurs', { type: 'session.started' });
check(sp.s.zustand === 'laeuft', 'Unbekannte oder fremde Ereignisse ändern nichts');

// Pause
gesendet.length = 0;
sp.pause(KURS, true);
check(sp.s.pause && gesendet.some((e) => e.type === 'session.input_audio.mute') && gesendet.some((e) => e.type === 'session.instructions.append'), 'Pause: Mikrofon stumm, Tutor schweigt');
sp.pause(KURS, false);
check(!sp.s.pause && gesendet.some((e) => e.type === 'session.input_audio.unmute'), 'Pause vorbei: weiter');

// Abriss → neu verbinden mit Bilanz, letzten Sätzen und Stoff dazu
const ab = sp.ereignis(KURS, { type: 'session.closed', reason: 'connection_lost', usage: { seconds: 42 } });
check(ab.aktion === 'neu' && ab.warte > 0 && sp.s.zustand === 'verbindet' && wach === false, 'Verbindung weg: neu verbinden nach kurzer Wartezeit');
anfragen = [];
const v2 = await sp.verbinden(KURS, 'v=0 NEU', { nachAbriss: true, zuletzt: `Tutor zuletzt: Was ist bei ${fremd.titel} wichtig?` });
const e2 = anfragen[0].body.session.input[0].content[0].text;
check(v2.ok && /Verbindung war kurz weg/.test(e2) && /Schon eingetragen/.test(e2) && e2.includes(fremd.titel) && /Kursstoff/.test(e2), 'Neue Sitzung mit Bilanz, letzten Sätzen und Stoff dazu');
sp.ereignis(KURS, { type: 'session.started' });
sp.ereignis(KURS, { type: 'session.usage.updated', usage: { seconds: 5 } });
check(sp.s.sekunden === 47, 'Gesprächssekunden über Neuverbindungen addiert');
for (let i = 0; i < 3; i++) sp.abriss(KURS, 'weg');
check(sp.s.zustand === 'getrennt', 'Nach mehreren Abrissen: „getrennt“ mit Stand, kein Endlosversuch');
check(sp.fortsetzen(KURS).ok && sp.s.zustand === 'verbindet', '„Weitermachen“ verbindet neu');
antworten = [{ status: 401, json: { error: { message: 'bad key' } } }];
const v3 = await sp.verbinden(KURS, 'v=0 X');
check(!v3.ok && /Schlüssel/.test(v3.text) && sp.s.zustand === 'getrennt', 'Abgelehnter Schlüssel: klare Meldung, Stand bleibt');
sp.fortsetzen(KURS); await sp.verbinden(KURS, 'v=0 Y'); sp.ereignis(KURS, { type: 'session.started' });

// Ende
gesendet.length = 0;
sp.beenden(KURS);
check(gesendet.some((e) => e.type === 'session.close'), 'Beenden: session.close');
const zu = sp.ereignis(KURS, { type: 'session.closed', reason: 'close_requested', usage: { seconds: 9 } });
await pause(300);
check(zu.aktion === 'aufraeumen' && sp.s.zustand === 'beendet' && wach === false && enden === 1, 'session.closed: beendet, Daten neu laden');
check(!fs.readFileSync(path.join(ordner, 'sitzungen', sp.s.id + '.json'), 'utf8').includes('"tf"'), 'Gespeicherte Sitzung ohne Suchindex');
sp.verwerfen(KURS);
check(sp.s === null, 'Ergebnis verworfen');
const ohne = new M.Sprechstunde({ ordner, schluessel: () => null });
check(!(await ohne.starten(c)).ok, 'Ohne Schlüssel kein Start');

// ---------------------------------------------------------------- 2. Ende-zu-Ende in der App
U.env.LERNHUB_LIVE_ATTRAPPE = '1';
U.env.LERNHUB_FAKE_AUDIO = path.resolve('tests/audio/diktat.wav');
try { fs.unlinkSync(path.join(ws, 'uebung.json')); } catch { }
const app = await electron.launch({ args: ['.'], env: U.env });
const fehler = [];
app.process().stderr.on('data', (d) => { const s = String(d); if (/error|Error/.test(s) && !/Autofill|DevTools|GPU|GPT-Live/.test(s)) fehler.push(s.trim()); });
const win = await app.firstWindow();
win.on('pageerror', (e) => fehler.push('Seite: ' + e.message));
win.on('console', (m) => { if (m.type() === 'error') fehler.push('Konsole: ' + m.text()); });
const text = (sel) => win.$$eval(sel, (els) => els.map((e) => e.textContent).join('\n'));
const BILDER = process.env.E2E_BILDER;
if (BILDER) fs.mkdirSync(BILDER, { recursive: true });
const bild = async (name) => { if (BILDER) await win.screenshot({ path: path.join(BILDER, 'sp-' + name + '.png') }); };
const ein = (ev) => win.evaluate((x) => window.__sprechTest.empfangen(x), ev);
const raus = () => win.evaluate(() => (window.__sprechTest ? window.__sprechTest.gesendet.map((e) => e.type) : []));

try {
  await win.waitForSelector('.title', { timeout: 30000 });
  await willkommenZu(win);
  check(await win.$(`.kk-sprech[data-sprech="kurs|${KURS}"]`) !== null, '„Diese Woche“: Knopf „Sprechstunde“ unter den Kacheln');
  await win.click(`.side-item[data-nav="kurs:${SLUG}"]`);
  await win.waitForSelector('#modus-wiederholen');
  const kn = await win.$(`#modus-wiederholen [data-sprech="kurs|${KURS}"]`);
  check(!!kn, 'Kursseite: Knopf „Sprechstunde“ neben „Wiederholen“');
  await kn.click();
  await win.waitForSelector('.sp-view', { timeout: 5000 });
  await warte(() => win.evaluate(() => !!window.__sprechTest), { timeout: 60000, text: 'Verbindung (Attrappe)' });
  await bild('0-verbindet');
  const konfig = JSON.parse(fs.readFileSync(path.join(U.daten, 'sprechstunde', 'attrappe-konfig.json'), 'utf8'));
  check(konfig.model === 'gpt-live-1.1' && /Themen, die er gelernt hat/.test(konfig.instructions) && /Kursstoff/.test(konfig.input[0].content[0].text), 'Sitzungskonfiguration: Themenrahmen und Kursstoff zum Einstieg');

  await ein({ type: 'session.started' });
  await win.waitForSelector('.sp-view[data-zustand="laeuft"] #sp-leiste');
  check((await win.$$('#sp-leiste .sp-th')).length > 0, 'Läuft: fällige Themen als Übersicht');
  await ein({ type: 'session.output_transcript.delta', delta: 'Hallo, wir starten', start_ms: 100, end_ms: 900 });
  await ein({ type: 'session.input_transcript.delta', delta: 'Okay, los', start_ms: 1200, end_ms: 1600 });
  await warte(async () => /Hallo, wir starten/.test(await text('#sp-tutor')), { text: 'Untertitel' });
  check(!/Okay, los/.test(await text('.sp-buehne')), 'Untertitel: nur der Tutor, dein ungenaues Mitschreiben nicht');
  check(await win.$('canvas#sp-kugel') !== null, 'Punktkugel statt Status-Wechsel');
  await bild('1-laeuft');

  // Satz des Tutors → Kursstoff still nachgeschoben (Suche im Hauptprozess)
  const t1 = /Vorschläge für heute[^\n]*\n- (.+?)(?: aus „| \()/.exec(konfig.instructions)[1];
  await ein({ type: 'session.output_transcript.delta', delta: ` Lass uns über ${t1} reden. Was weißt du darüber?`, start_ms: 1000, end_ms: 2600 });
  await warte(async () => (await raus()).includes('session.thinking.append'), { text: 'Kursstoff zum Satz' });
  check(true, 'Satz des Tutors → passender Kursstoff still an GPT-Live');
  await ein({ type: 'session.delegation.created', delegation: { id: 'item_e1', target: 'responses' } });
  await ein({ type: 'response.event', delegation_id: 'item_e1', event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call_e1', name: 'thema_eintragen', arguments: JSON.stringify({ thema: t1, ergebnis: 'geloest', stufe: 'R0' }) } } });
  await warte(async () => (await raus()).includes('response.item.create'), { text: 'Werkzeugergebnis an den Kanal' });
  await ein({ type: 'response.event', delegation_id: 'item_e1', event: { type: 'response.completed', response: { id: 'r', output: [] } } });
  await warte(async () => (await raus()).includes('response.create'), { text: 'response.create' });
  await warte(async () => (await win.$('#sp-leiste .sp-th.ok')) !== null, { text: 'Thema als „saß“ markiert' });
  check(true, 'Thema eingetragen: Ergebnis zurück, Übersicht zeigt „saß“');

  await win.keyboard.press('Space');
  await warte(async () => (await raus()).includes('session.input_audio.mute'), { text: 'Pause' });
  await win.waitForSelector('.sp-view.pausiert');
  check(true, 'Leertaste: Pause (Mikrofon stumm)');
  await win.keyboard.press('Space');
  await warte(async () => (await raus()).includes('session.input_audio.unmute'), { text: 'Weiter' });
  check(true, 'Leertaste nochmal: weiter');

  // Abriss: Kanal weg → neu verbinden, Stand bleibt
  await win.evaluate(() => { window.__alt = window.__sprechTest; window.__sprechTest.abriss(); });
  await warte(() => win.evaluate(() => window.__sprechTest !== window.__alt && !!window.__sprechTest), { timeout: 15000, text: 'Neuverbindung' });
  const k2e = JSON.parse(fs.readFileSync(path.join(U.daten, 'sprechstunde', 'attrappe-konfig.json'), 'utf8'));
  check(/Verbindung war kurz weg/.test(k2e.input[0].content[0].text) && /Hallo, wir starten/.test(k2e.input[0].content[0].text), 'Abriss: neue Verbindung mit Bilanz und den letzten Sätzen');
  await ein({ type: 'session.started' });
  await win.waitForSelector('.sp-view[data-zustand="laeuft"]');

  await win.click('[data-sp="ende"]');
  await warte(async () => (await raus()).includes('session.close'), { text: 'session.close' });
  await ein({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 30 } });
  await win.waitForSelector('.sp-ende', { timeout: 5000 });
  const ende = await text('.sp-ende');
  check(/Gut gemacht/.test(ende) && /1 Thema/.test(ende) && /saß/.test(ende) && /XP/.test(ende), 'Ergebnis: Themen, Bilanz, XP');
  await bild('2-ende');
  const uj2 = JSON.parse(fs.readFileSync(path.join(ws, 'uebung.json'), 'utf8'));
  check(Object.keys(uj2.themen || {}).length >= 1, 'uebung.json fortgeschrieben');
  await win.click('[data-sp="fertig"]');
  await win.waitForSelector('#modus-wiederholen');
  check(true, '„Fertig“ führt zurück zum Kurs');

  // Einstellungen: OpenAI-Karte mit Stimme und Tempo
  await win.evaluate(() => window.__lernhubTest.nav('einstellungen'));
  await win.waitForSelector('#oa-stimme');
  await win.selectOption('#oa-tempo', 'normal');
  await warte(async () => { try { return JSON.parse(fs.readFileSync(path.join(U.daten, 'sprechstunde', 'einstellungen.json'), 'utf8')).tempo === 'normal'; } catch { return false; } }, { text: 'Tempo gespeichert' });
  check(true, 'Einstellungen: Stimme und Tempo werden gespeichert');
  check(fehler.length === 0, 'Keine Fehler in Konsole und Seite' + (fehler.length ? ':\n  ' + fehler.join('\n  ') : ''));
} catch (e) {
  check(false, 'Ablauf: ' + e.message);
  await bild('x-fehler');
  if (fehler.length) console.log(fehler.join('\n'));
} finally {
  await app.close();
}
