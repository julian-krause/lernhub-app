// Ende-zu-Ende: Karte „Wiederholen“ auf der Kursseite und auf „Diese Woche“ → Übungsansicht (claude -p als Attrappe). Kopie des Semesters, echte Daten bleiben
// unberührt. Aufruf: node tests/ueben.test.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { bereiten, check, warte } from './umgebung.mjs';

const U = bereiten();
const LOG = path.join(U.T, 'attrappe.jsonl');
U.env.LERNHUB_CLAUDE = path.resolve('tests/ueben-attrappe.mjs');
U.env.UEBEN_ATTRAPPE_LOG = LOG;
const KURS = U.kurs, SLUG = U.slug, ws = path.join(U.sem, KURS, 'Lernbereich');
try { fs.unlinkSync(path.join(ws, 'uebung.json')); } catch { }
console.log('Testordner:', U.T);

const app = await electron.launch({ args: ['.'], env: U.env });
const fehler = [];
app.process().stderr.on('data', (d) => { const s = String(d); if (/error|Error/.test(s) && !/Autofill|DevTools|GPU/.test(s)) fehler.push(s.trim()); });
const win = await app.firstWindow();
win.on('pageerror', (e) => fehler.push('Seite: ' + e.message));
win.on('console', (m) => { if (m.type() === 'error') fehler.push('Konsole: ' + m.text()); });
const text = (sel) => win.$$eval(sel, (els) => els.map((e) => e.textContent).join('\n'));

try {
  await win.waitForSelector('.title', { timeout: 30000 });
  await win.click(`.side-item[data-nav="kurs:${SLUG}"]`);
  await win.waitForSelector('#modus-wiederholen');
  const knopf = await win.$(`#modus-wiederholen [data-ueben="kurs|${KURS}"]`);
  check(!!knopf && /fällig/.test(await text('#modus-wiederholen')), 'Kursseite: Karte „Wiederholen“ mit fälligen Themen und Start-Knopf');
  await knopf.click();
  await win.waitForSelector('.ueb-denkt', { timeout: 5000 });
  check(!(await win.$('[data-ueb="start"]')), '„Wiederholen“ beginnt sofort, ohne Zwischenseite');
  check(true, 'Während Claude arbeitet: „Claude … denkt“-Zeile');
  await win.waitForSelector('.ueb-dock .ueb-dock-kopf', { timeout: 15000 });
  const v1 = await text('.ueb-verlauf');
  check(/Aufgabe 1: Welche Datei/.test(v1), 'Aufgabenkarte im Verlauf');
  check(/Wir starten mit Mustern/.test(v1), 'Orientierungszeile vor der Aufgabe');
  check(!(await win.content()).includes('GEHEIM-1'), 'Musterlösung bleibt verborgen, solange die Aufgabe offen ist');
  check(/Deine Gedanken/i.test(await text('.ueb-dock')), 'Übungsfeld „Deine Gedanken“ mit der Aufgabe');

  await win.fill('#ueb-text', 'Ich hänge, Hinweis bitte');
  await win.press('#ueb-text', 'Enter');
  await warte(async () => /wo/.test(await text('.ueb-claude')), { text: 'Hinweis' });
  check(/Ich hänge/.test(await text('.ueb-gedanken')), 'Gedanken erscheinen im Verlauf');
  check(true, 'Hinweis von Claude erscheint');
  check(await win.$('.ueb-dock textarea') !== null, 'Aufgabe bleibt nach dem Hinweis offen');

  await win.fill('#ueb-text', 'Antwort: nur build/a.js');
  await win.click('[data-ueb="senden"]');
  await warte(async () => /Abgeschlossen/i.test(await text('.ueb-karte')), { text: 'Abschluss' });
  const k = await text('.ueb-karte');
  check(/Gelöst/.test(k) && /GEHEIM-1/.test(k) && /Musterlösung/i.test(k), 'Abschlusskarte: Ergebnis-Chip, Musterlösung wörtlich');
  const uj = JSON.parse(fs.readFileSync(path.join(ws, 'uebung.json'), 'utf8'));
  check(uj.themen.L5 && uj.themen.L5.fach === 1, 'Ergebnis in uebung.json eingetragen (L5 → Fach 1)');
  check(Object.values(uj.zeit || {})[0] >= 1, 'Übungszeit in uebung.json gebucht (' + JSON.stringify(uj.zeit) + ')');
  await win.waitForSelector('[data-ueb="weiter"]');
  check(true, 'Leeres Feld in der Pause: „Nächste Aufgabe →“');

  await win.fill('#ueb-text', 'Warum nicht src/build?');
  await warte(async () => !(await win.$('[data-ueb="weiter"]')), { text: 'Knopf wechselt zu Senden' });
  await win.press('#ueb-text', 'Enter');
  await warte(async () => /Gute Frage/.test(await text('.ueb-claude')), { text: 'Antwort in der Pause' });
  check(true, 'Frage in der Pause wird beantwortet, keine neue Aufgabe');
  check(!(await win.$('.ueb-dock .ueb-dock-kopf')), 'nach der Frage keine offene Aufgabe');

  await win.waitForSelector('[data-ueb="weiter"]');
  await win.keyboard.press('Enter');
  await warte(async () => /Aufgabe 2/.test(await text('.ueb-verlauf')), { text: 'Aufgabe 2' });
  check(/Nächste Aufgabe/i.test(await text('.ueb-weiter')), '„→ Nächste Aufgabe“ im Verlauf, dann Aufgabe 2');

  await win.click('.ueb-view');
  await win.keyboard.press('Escape');
  await win.waitForSelector('.sheet [data-v="1"]');
  await win.click('.sheet [data-v="1"]');
  await warte(async () => /Aufgabe verworfen/.test(await text('.ueb-leise')), { text: 'Verworfen' });
  check(true, 'Esc → „Aufgabe verwerfen?“ → verworfen, ohne Lösung');
  check(!(await win.content()).includes('GEHEIM-2'), 'verworfene Aufgabe zeigt keine Musterlösung');
  await win.fill('#ueb-text', 'ok, danke');
  await win.press('#ueb-text', 'Enter');
  await warte(() => fs.readFileSync(LOG, 'utf8').includes('SYSTEMHINWEIS'), { text: 'Hinweis aufs Verwerfen' });
  check(true, 'Claude erfährt das Verwerfen mit der nächsten Nachricht');
  const zuege = fs.readFileSync(LOG, 'utf8').trim().split('\n').map((z) => JSON.parse(z));
  check(zuege[0].args.includes('--session-id') && zuege.slice(1).every((z) => z.args.includes('--resume')), 'erster Zug legt die Sitzung an, alle weiteren setzen sie fort');
  check(zuege.every((z) => z.args.includes('--json-schema') && !z.args.includes('bypassPermissions')), 'jeder Zug mit Schema und ohne bypassPermissions');

  await warte(async () => !(await win.$('.ueb-denkt')), { text: 'Antwort' });
  await win.click('[data-ueb="ende"]');
  await win.waitForSelector('[data-ueb="start"]');
  check(true, 'Runde beenden → zurück zur Startseite');
  // Durchlauf über alle Kurse von „Diese Woche“ aus
  await win.click('.side-item[data-nav="woche"]');
  await win.waitForSelector('.lauf [data-lauf="start"]');
  const kurse = await win.$$eval('.lauf-kurse .chip', (x) => x.map((e) => e.textContent.trim()));
  check(kurse.length >= 2, 'Diese Woche: Karte „Wiederholen“ mit den Kursen (' + kurse.join(', ') + ')');
  check(!(await win.$('[data-lauf-min]')) && !/Min\./.test(await text('.lauf')), 'keine Minuten-Auswahl mehr, nur „Los“');
  await win.click('[data-lauf="start"]');
  await win.waitForSelector('.ueb-dock .ueb-dock-kopf', { timeout: 20000 });
  const kurs1 = await text('.head .crumb');
  const key1 = await win.evaluate(() => window.__lernhubTest.S.lauf.cur);
  check(/Endloslauf/.test(await text('.head')), '„Los“ startet sofort den ersten Kurs als Endloslauf');
  const ziel = await win.evaluate(() => window.__lernhubTest.S.lauf.ziel);
  check(ziel === 2 || ziel === 3, 'Serie nach Aufgaben (2 oder 3), nicht nach Zeit: ' + ziel);
  // Serie von 3: nach Aufgabe 1 und 2 bleibt es im Kurs („Nächste Aufgabe →“), erst nach der dritten sauberen wechselt es
  for (const n of [1, 2]) {
    await win.fill('#ueb-text', 'Antwort: nur build/a.js');
    await win.press('#ueb-text', 'Enter');
    await win.waitForSelector('[data-ueb="weiter"]', { timeout: 15000 });
    if (n === 1) check(!(await win.$('[data-ueb="kurswechsel"]')), 'nach einer einzelnen Aufgabe kein Kurswechsel');
    await win.keyboard.press('Enter');
    await warte(async () => (await win.$('.ueb-dock .ueb-dock-kopf')) !== null, { text: 'nächste Aufgabe im selben Kurs' });
  }
  check((await text('.head .crumb')) === kurs1, 'Aufgabe 2 und 3 im selben Kurs');
  await win.fill('#ueb-text', 'Antwort: nur build/a.js');
  await win.press('#ueb-text', 'Enter');
  await win.waitForSelector('[data-ueb="kurswechsel"]', { timeout: 15000 });
  check(/Nächste Aufgabe · .+ →/.test(await text('[data-ueb="kurswechsel"]')) && !(await win.$('[data-ueb="weiter"]')), 'Serie vorbei: ein einziger Knopf „Nächste Aufgabe · <Kurs> →“, keine Entscheidung');
  await win.keyboard.press('Enter');
  await warte(async () => (await text('.head .crumb')) !== kurs1, { text: 'Kurswechsel' });
  await win.waitForSelector('.ueb-dock .ueb-dock-kopf', { timeout: 20000 });
  check(/Aufgabe 1/.test(await text('.ueb-verlauf')) && /3 Aufgaben geschafft/.test(await text('.head')), '↵ wechselt den Kurs, der startet von selbst mit seiner ersten Aufgabe');
  // zurück zum ersten Kurs: dessen Runde lief weiter (kein Neustart) und bekommt „Nächste Aufgabe“
  await win.evaluate((k1) => { const S = window.__lernhubTest.S; S.lauf.ziel = 1; S.rc.forEach((c) => { if (c.key !== S.lauf.cur) S.lauf.n[c.key] = c.key === k1 ? 0 : 99; }); }, key1);
  await win.fill('#ueb-text', 'Antwort: nur build/a.js');
  await win.press('#ueb-text', 'Enter');
  await win.waitForSelector('[data-ueb="kurswechsel"]', { timeout: 15000 });
  const vorher = fs.readFileSync(LOG, 'utf8').trim().split('\n').length;
  await win.click('[data-ueb="kurswechsel"]');
  await warte(async () => (await text('.head .crumb')) === kurs1, { text: 'zurück zum ersten Kurs' });
  await warte(async () => (await win.$('.ueb-dock .ueb-dock-kopf')) !== null, { text: 'neue Aufgabe im ersten Kurs' });
  const neuZug = JSON.parse(fs.readFileSync(LOG, 'utf8').trim().split('\n')[vorher]);
  check(neuZug.args.includes('--resume') && /endet nie/.test(neuZug.ein), 'Rückkehr setzt die offene Runde fort; „Nächste Aufgabe“ sagt Claude, dass die Runde nie endet');
  await win.click('[data-ueb="ende"]');
  await win.waitForSelector('[data-ueb="start"]');
  check(await win.evaluate(() => window.__lernhubTest.S.lauf === null && Object.values(window.__lernhubTest.S.ueb).filter(Boolean).length === 0), '„Runde beenden“ beendet den Endloslauf und alle offenen Runden');
  const gemerkt = await win.evaluate(() => JSON.parse(localStorage.getItem('lauf.heute') || 'null'));
  check(gemerkt && Object.values(gemerkt.n).reduce((a, b) => a + b, 0) >= 3, 'heute Geübtes je Kurs gemerkt (' + JSON.stringify(gemerkt && gemerkt.n) + ')');
  await win.click('.side-item[data-nav="woche"]'); await win.waitForSelector('.lauf');
  check(/heute schon dran/.test(await text('.lauf')), 'Karte: nächster Start berücksichtigt, was heute schon dran war');
  check(fehler.length === 0, 'keine Fehler in Konsole und Hauptprozess' + (fehler.length ? ': ' + fehler.join(' | ').slice(0, 400) : ''));
} catch (e) {
  check(false, 'Abbruch: ' + e.message);
  try { await win.screenshot({ path: path.join(U.T, 'fehler.png') }); console.log('Bildschirmfoto:', path.join(U.T, 'fehler.png')); } catch { }
} finally {
  await app.close();
}
