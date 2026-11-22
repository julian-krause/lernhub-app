// Ende-zu-Ende: Karte „Wiederholen“ auf der Kursseite und auf „Diese Woche“ → Übungsansicht (claude -p als Attrappe). Kopie des Semesters, echte Daten bleiben
// unberührt. Aufruf: node tests/ueben.test.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { bereiten, check, warte, willkommenZu, fokusAus } from './umgebung.mjs';

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
const BILDER = process.env.E2E_BILDER;          // Bildschirmfotos zum Ansehen (wie in tests/e2e.mjs)
if (BILDER) fs.mkdirSync(BILDER, { recursive: true });
const bild = async (name) => { if (BILDER) await win.screenshot({ path: path.join(BILDER, 'u-' + name + '.png') }); };

try {
  await win.waitForSelector('.title', { timeout: 30000 });
  await willkommenZu(win);
  await win.click(`.side-item[data-nav="kurs:${SLUG}"]`);
  await win.waitForSelector('#modus-wiederholen');
  const knopf = await win.$(`#modus-wiederholen [data-ueben="kurs|${KURS}"]`);
  check(!!knopf && /fällig/.test(await text('#modus-wiederholen')), 'Kursseite: Karte „Wiederholen“ mit fälligen Themen und Start-Knopf');
  await knopf.click();
  await win.waitForSelector('.ueb-denkt', { timeout: 5000 });
  await bild('0-warten');
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
  await bild('1-geloest');
  check(/\+20 XP/.test(await text('.ueb-abschluss .chip.xp')) && (await win.$('.ueb-abschluss .lrn-lob.ok')) !== null, 'Spiel: „Gelöst“ bringt 20 XP (Chip auf der Abschlusskarte) und eine Zeile Lob');
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
  check(await fokusAus(win), 'Wiederholen im Fokus-Modus: Seitenleiste ausgeblendet, [data-fokus] holt sie zurück');
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
  // „Nur 5 Minuten“: Endloslauf mit Ring; ist die Zeit um, endet die Aufgabe in Ruhe, dann Ergebnis und „Noch 5?“
  await win.click('.lauf [data-lauf="kurz"]');
  await win.waitForSelector('.head .kurz-ring', { timeout: 20000 });
  await win.waitForSelector('.ueb-dock .ueb-dock-kopf', { timeout: 20000 });
  check(/^[45]:\d\d$/.test((await text('[data-kurz-rest]')).trim()) && /Endloslauf/.test(await text('.head')), '„Nur 5 Minuten“ startet den Endloslauf mit einem Ring über 5 Minuten');
  await win.evaluate(() => { window.__lernhubTest.S.lauf.kurz.ab = Date.now() - 301000; });
  await new Promise((r) => setTimeout(r, 1500));
  check(!(await win.$('.kurz-ende')), 'Zeit um, aber die Aufgabe ist offen: kein Abbruch mittendrin');
  await win.fill('#ueb-text', 'Antwort: nur build/a.js');
  await win.press('#ueb-text', 'Enter');
  await win.waitForSelector('.kurz-ende', { timeout: 20000 });
  const ke = await text('.kurz-ende');
  check(/5 Minuten geschafft/.test(ke) && /1\s*Aufgabe/.test(ke) && /\+\d+/.test(ke) && /Noch 5\?/.test(ke), 'danach Ergebnis (1 Aufgabe, XP) und die Frage „Noch 5?“');
  await win.click('.kurz-ende [data-kurz="noch"]');
  await warte(async () => !(await win.$('.kurz-ende')) && /^[45]:\d\d$/.test((await text('[data-kurz-rest]')).trim()), { text: 'Noch 5: Ring beginnt neu' });
  check(true, '„Noch 5?“ startet den Ring neu');
  await win.evaluate(() => { window.__lernhubTest.S.lauf.kurz.ab = Date.now() - 301000; });
  await win.waitForSelector('.kurz-ende', { timeout: 5000 });
  await win.click('.kurz-ende [data-kurz="fertig"]');
  await win.waitForSelector('[data-ueb="start"]');
  check(await win.evaluate(() => window.__lernhubTest.S.lauf === null), '„Fertig für jetzt“ beendet den Lauf');
  const sj = JSON.parse(fs.readFileSync(path.join(U.daten, 'spiel.json'), 'utf8'));
  check(Object.keys(sj.gebucht).filter((k) => /:a\d+$/.test(k)).length >= 7 && (sj.tage[Object.keys(sj.tage).sort().pop()] || {}).geloest >= 6, 'Spielstand: jede abgeschlossene Aufgabe genau einmal gebucht');
  check(fehler.length === 0, 'keine Fehler in Konsole und Hauptprozess' + (fehler.length ? ': ' + fehler.join(' | ').slice(0, 400) : ''));
  await bild('2-ende');
} catch (e) {
  check(false, 'Abbruch: ' + e.message);
  try { await win.screenshot({ path: path.join(U.T, 'fehler.png') }); console.log('Bildschirmfoto:', path.join(U.T, 'fehler.png')); } catch { }
} finally {
  await app.close();
}
