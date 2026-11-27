// Ende-zu-Ende: Unendlich-Modus. „∞ Unendlich“ auf der Kursseite → Lektion im Gespräch (claude -p als Attrappe), ohne
// Uhr → beim letzten Schritt wird die nächste Lektion vorbereitet → der Abschluss trägt im Hintergrund ein, ohne
// Rückschau und ohne Grenze im Verlauf → Comeback-Frage mitten im Verlauf → die nächste Lektion läuft ohne neuen Start
// im selben Verlauf weiter, mit Übergabe → „Schluss für heute“ → dieselbe Lektion einzeln zu Ende.
// Kopie des Semesters, echte Daten bleiben unberührt. Aufruf: node tests/unendlich.test.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { bereiten, check, warte, willkommenZu } from './umgebung.mjs';
const require = createRequire(import.meta.url);

const U = bereiten();
const LOG = path.join(U.T, 'attrappe.jsonl');
U.env.LERNHUB_CLAUDE = path.resolve('tests/lernen-attrappe.mjs');
U.env.LERNEN_ATTRAPPE_LOG = LOG;
const KURS = U.kurs, SLUG = U.slug, ws = path.join(U.sem, KURS, 'Lernbereich');
const rmLesen = () => JSON.parse(fs.readFileSync(path.join(ws, 'roadmap.json'), 'utf8'));
const offene = rmLesen().lessons.filter((l) => !l.done && !l.placeholder);
const ID = offene[0].id, ID2 = offene[1].id;
for (const f of fs.readdirSync(path.join(ws, 'lessons'))) if (f.startsWith(ID + '-') || f.startsWith(ID2 + '-')) fs.unlinkSync(path.join(ws, 'lessons', f));
console.log('Testordner:', U.T, '· Lektionen', ID, ID2);

const app = await electron.launch({ args: ['.'], env: U.env });
const fehler = [];
app.process().stderr.on('data', (d) => { const s = String(d); if (/error|Error/.test(s) && !/Autofill|DevTools|GPU/.test(s)) fehler.push(s.trim()); });
const win = await app.firstWindow();
win.on('pageerror', (e) => fehler.push('Seite: ' + e.message));
win.on('console', (m) => { if (m.type() === 'error') fehler.push('Konsole: ' + m.text()); });
const text = (sel) => win.$$eval(sel, (els) => els.map((e) => e.textContent).join('\n'));
const zuege = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').map((z) => JSON.parse(z)); } catch { return []; } };
const starts = () => zuege().filter((z) => /\[Uni-Lektion\]/.test(z.ein));
const BILDER = process.env.E2E_BILDER;
if (BILDER) fs.mkdirSync(BILDER, { recursive: true });
const bild = async (name) => { if (BILDER) await win.screenshot({ path: path.join(BILDER, 'u-' + name + '.png') }); };

try {
  await win.waitForSelector('.title', { timeout: 30000 });
  await willkommenZu(win);
  check((await win.$('.sec-h [data-lernen="unendlich"]')) !== null, 'Diese Woche: Knopf „∞ Unendlich lernen“ über den Kursen');
  await win.click(`.side-item[data-nav="kurs:${SLUG}"]`);
  await win.waitForSelector(`#modus-lernen [data-lernen="unendlich|${KURS}"]`);
  check(true, 'Kursseite: Karte „Lernen“ hat „∞ Unendlich“');
  await win.click(`#modus-lernen [data-lernen="unendlich|${KURS}"]`);
  await win.waitForSelector('.lrn-frage.offen', { timeout: 20000 });
  const kopf = await text('.head');
  check(/∞ \d+ Min\./.test(await text('.head .strom-chip')) && (await win.$('.head [data-lrn="schluss"]')) !== null && !/Lektion \d/.test(kopf) && !(await win.$('.head [data-lrn="ende"]')), 'Kopf: „∞ … Min.“ und „Schluss für heute“, kein Lektions-Chip, kein „Lektion beenden“');
  const s0 = starts()[0];
  check(/\[Unendlich-Modus\]/.test(s0.ein) && s0.ein.includes(`Lektion ${ID}`) && !/Lektionsuhr|Budget:/.test(s0.ein) && /Anfang des Gesprächs/.test(s0.ein), 'Startauftrag: Unendlich-Modus, ohne Uhr und Budget');
  const sp = require('../src/main/lernen.js').systemPrompt({ stromRegeln: true, kursName: 'K', lektion: { id: ID, title: 'T' }, budget: 20, maxSchritte: 12 });
  check(/Kein Zeitbudget, keine Lektionsuhr/.test(sp) && /Weiter, sobald er es verstanden hat/.test(sp) && /Keine Grenzen im Gespräch/.test(sp) && !/im Zeitbudget von/.test(sp), 'Systemprompt: nach Thema statt nach Zeit, keine Grenzen im Gespräch');

  // Frage 1 falsch (A), Vorhersage, freie Frage
  await win.click('.lrn-frage[data-frage="1"] [data-lrn-opt="0"]');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.lrn-frage[data-frage="2"].offen', { timeout: 15000 });
  await win.click('.lrn-frage[data-frage="2"] [data-lrn-opt="0"]');
  await win.click('[data-lrn="senden"]');
  await win.waitForSelector('.lrn-frage[data-frage="3"].offen', { timeout: 15000 });
  check(starts().length === 1, 'vor dem letzten Schritt wird noch nichts vorbereitet');
  await win.fill('#lrn-text', '42, weil zwei Blobs');
  await win.press('#lrn-text', 'Enter');
  await win.waitForSelector('.lrn-frage[data-frage="4"].offen', { timeout: 15000 });

  // Letzter Plan-Schritt: die nächste Lektion wird im Hintergrund vorbereitet
  await warte(() => starts().length === 2, { text: 'Vorab-Sitzung gestartet', timeout: 15000 });
  const vorab = starts()[1];
  check(vorab.ein.includes(`Lektion ${ID2}`) && vorab.args.includes('--session-id'), `beim letzten Schritt startet im Hintergrund schon ${ID2} (eigene Sitzung)`);
  check(/Direkt davor ging es im selben Gespräch um/.test(vorab.ein), 'die vorbereitete Lektion weiß, worum es direkt davor ging');
  check(/\[Unendlich-Modus\]$/.test(zuege().filter((x) => /^Antwort auf Frage 3 /.test(x.ein)).pop().ein.trim()), 'Antworten tragen „[Unendlich-Modus]“ statt der Lektionsuhr');
  await warte(async () => /bereit/.test(await win.evaluate(() => { const v = Object.values(window.__lernhubTest.S.lern).map((e) => e && e.vorab).find(Boolean); return v ? (v.zustand === 'bereit' ? 'bereit' : v.zustand) : ''; })), { text: 'Vorab-Sitzung bereit' });
  check(true, 'Vorab-Sitzung ist bereit, bevor die Lektion endet');

  // Letzte Frage → Rückschau → trägt sich selbst ein
  await win.click('.lrn-frage[data-frage="4"] [data-lrn-opt="2"]');
  await win.keyboard.press('Enter');
  await warte(() => !!(rmLesen().lessons.find((l) => l.id === ID) || {}).done, { text: `${ID} eingetragen`, timeout: 60000 });
  check(true, `${ID} ist ohne „Lektion abschließen“ in der Roadmap eingetragen`);
  check(!(await win.$('.feier:not(.strom-ende)')), 'keine Feier zwischen den Lektionen');

  // Comeback-Frage: Frage 1 kommt mitten im Verlauf mit neu gemischten Optionen zurück
  await win.waitForSelector('.strom-cb', { timeout: 15000 });
  await bild('1-comeback');
  check(/Worauf zeigt/.test(await text('.strom-cb')) && /kam vorhin falsch/.test(await text('.strom-cb .ueb-eyebrow')), 'Comeback-Frage: die falsch beantwortete Frage 1 kommt zurück');
  check((await win.$$('.strom-vorher .lrn-frage')).length >= 4 && /Das steht jetzt/.test(await text('.strom-vorher')) && !(await win.$('.lrn-rueck, .strom-ms, [data-lrn="eintragen"]')), 'der Verlauf davor bleibt stehen, der Abschluss ist eine normale Nachricht: keine Rückschau, keine Karte, kein Knopf');
  const richtig = await win.$$eval('.strom-cb [data-cb-opt]', (bs) => bs.findIndex((b) => b.textContent.includes('refs/heads/dev')));
  const reihe = await win.$$eval('.strom-cb [data-cb-opt] .ueb-prose', (xs) => xs.map((x) => x.textContent.trim()).join('|'));
  check(richtig >= 0 && reihe !== 'auf den Commit|auf refs/heads/dev|auf den Tree|auf den Index', 'Optionen sind neu gemischt: ' + reihe);
  await win.keyboard.press(String(richtig + 1));
  await win.keyboard.press('Enter');
  await warte(async () => /Richtig/.test(await text('.strom-cb .chip')), { text: 'Comeback bewertet' });
  check(/\+10 XP/.test(await text('.strom-cb .chip.xp')) && /GEHEIM-ERKL-1/.test(await text('.strom-cb')), 'Comeback bewertet die App selbst: Richtig, +10 XP, Erklärung');
  await win.keyboard.press('Enter');

  // Nächste Lektion: die vorbereitete Sitzung läuft weiter, ohne neuen Start
  const laeuft = () => win.evaluate((k) => { const e = window.__lernhubTest.S.lern[k]; return e && e.sitzung ? e.sitzung.lektion.id : ''; }, KURS);
  await warte(async () => (await laeuft()) === ID2, { text: `${ID2} läuft` });
  await win.waitForSelector('.lrn-frage.offen:not(.strom-cb)', { timeout: 15000 });
  check(starts().length === 2, `${ID2} übernimmt die vorbereitete Sitzung (kein dritter Start)`);
  check((await win.$$('.strom-vorher .lrn-frage')).length >= 4 && !(await win.$('.strom-cb')) && !/Lektion \d/.test(await text('.head')), 'derselbe Verlauf läuft weiter: oben das Thema davor, darunter das neue, keine Lektionsgrenze');
  await bild('2-naechste');
  await win.click('.lrn-frage[data-frage="1"] [data-lrn-opt="1"]');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.lrn-frage[data-frage="2"].offen', { timeout: 15000 });
  const z = zuege().filter((x) => /^Antwort auf Frage 1 /.test(x.ein)).pop();
  check(z.args.includes('--resume') && /\[Übergabe aus dem Lernhub/.test(z.ein) && z.ein.includes(ID) && /Tags/.test(z.ein), 'erste Antwort der neuen Lektion trägt die Übergabe (Ergebnis, Kernaussage, Noch offen)');
  check(await win.evaluate((k) => window.__lernhubTest.S.lern[k].sitzung.min <= 1, KURS) && !/\//.test(await text('.fokus-leiste')), 'keine Lektionsuhr zu sehen; die Zeit der neuen Lektion zählt ab der Übernahme');

  // Schluss für heute (das Eintragen im Hintergrund ist inzwischen durch)
  await warte(() => win.evaluate(() => !!(window.__lernhubTest.S.strom.abschnitte[0] || {}).erledigt), { text: 'im Hintergrund eingetragen' });
  await win.click('.head [data-lrn="schluss"]');
  await win.waitForSelector('.strom-ende');
  await bild('3-rueckblick');
  const re = await text('.strom-ende');
  check(/1\s*Thema/.test(re) && re.includes(ID) && re.includes(`${ID2} bleibt offen`) && (await win.$('.strom-ende [data-strom-merkblatt]')) !== null, 'Rückblick: 1 Thema mit Merkblatt, die halbe Lektion bleibt offen');
  await win.keyboard.press('Enter');
  await warte(async () => (await win.evaluate(() => window.__lernhubTest.S.route.name)) === 'woche' && !(await win.$('.strom-ende')), { text: 'zurück zur Woche' });
  check(await win.evaluate(() => window.__lernhubTest.S.strom === null), 'Strom beendet');
  check(!rmLesen().lessons.find((l) => l.id === ID2).done, `${ID2} ist nicht eingetragen und läuft später weiter`);

  // Dieselbe Lektion als normale Lektion weiterlernen: gleiche Sitzung, am Ende wieder mit „Lektion abschließen“
  const modus = () => win.evaluate((k) => { const e = window.__lernhubTest.S.lern[k]; return e && e.sitzung ? !!e.sitzung.unendlich : null; }, KURS);
  await win.click(`.side-item[data-nav="kurs:${SLUG}"]`);
  await win.click(`#modus-lernen [data-lernen="kurs|${KURS}"]`);
  await warte(async () => (await modus()) === false, { text: 'normaler Modus' });
  await win.waitForSelector('.lrn-frage[data-frage="2"].offen', { timeout: 15000 });
  check(starts().length === 2 && (await text('.head .chip')).includes(ID2) && !(await win.$('.head .strom-chip')), `normal weiter: ${ID2} läuft in derselben Sitzung, ohne Strom-Chip`);
  await win.click('.lrn-frage[data-frage="2"] [data-lrn-opt="0"]');
  await win.click('[data-lrn="senden"]');
  await win.waitForSelector('.lrn-frage[data-frage="3"].offen', { timeout: 15000 });
  await win.fill('#lrn-text', '42');
  await win.press('#lrn-text', 'Enter');
  await win.waitForSelector('.lrn-frage[data-frage="4"].offen', { timeout: 15000 });
  await win.click('.lrn-frage[data-frage="4"] [data-lrn-opt="2"]');
  await win.keyboard.press('Enter');
  await win.waitForSelector('[data-lrn="eintragen"]', { timeout: 30000 });
  check(/\[Lektionsuhr: \d+ von \d+ Min\.\]$/.test(zuege().filter((x) => /^Antwort auf Frage 4 /.test(x.ein)).pop().ein.trim()), 'normal: die Antworten tragen wieder die Lektionsuhr');
  check((await win.$('.lrn-rueck')) !== null, 'normal: Rückschau-Karte wie sonst');
  await new Promise((r) => setTimeout(r, 1500));
  check(!rmLesen().lessons.find((l) => l.id === ID2).done, `normal: ${ID2} trägt sich nicht selbst ein, „Lektion abschließen“ ist da`);
  await win.click('[data-lrn="eintragen"]');
  await warte(() => !!rmLesen().lessons.find((l) => l.id === ID2).done, { text: `${ID2} eingetragen`, timeout: 60000 });
  check(true, `normal: ${ID2} ist nach „Lektion abschließen“ eingetragen`);
  check(fehler.length === 0, 'keine Fehler in Konsole und Hauptprozess' + (fehler.length ? ': ' + fehler.join(' | ').slice(0, 400) : ''));
} catch (e) {
  check(false, 'Abbruch: ' + e.message);
  try { await win.screenshot({ path: path.join(U.T, 'fehler.png') }); console.log('Bildschirmfoto:', path.join(U.T, 'fehler.png')); } catch { }
} finally {
  await app.close();
}
