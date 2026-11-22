// Ende-zu-Ende: Übersicht der App ohne Lektions-Fenster. „Diese Woche“ mit den Karten Lernen und Wiederholen,
// Wochenpensum, Fortschritt, Lernzeit; Kursseite (Karten, Pfad, Liste, Lücken); Lerntag; Einstellungen; Suche;
// „Los“ startet das Lernen sofort (claude -p als Attrappe). Kopie des Semesters, echte Daten bleiben unberührt.
// Aufruf: node tests/e2e.mjs   (E2E_BILDER=<Ordner> legt Bildschirmfotos ab)
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { bereiten, check, warte, fokusAus, willkommenZu } from './umgebung.mjs';

const U = bereiten();
U.env.LERNHUB_CLAUDE = path.resolve('tests/lernen-attrappe.mjs');
const BILDER = process.env.E2E_BILDER;
if (BILDER) fs.mkdirSync(BILDER, { recursive: true });
console.log('Testordner:', U.T);

const exe = process.env.LERNHUB_APP;
const app = await electron.launch(exe ? { executablePath: exe, args: [], env: U.env } : { args: ['.'], env: U.env });
const fehler = [];
app.process().stderr.on('data', (d) => { const s = String(d); if (/error|Error/.test(s) && !/Autofill|DevTools|GPU/.test(s)) fehler.push(s.trim()); });
const win = await app.firstWindow();
win.on('pageerror', (e) => fehler.push('Seite: ' + e.message));
win.on('console', (m) => { if (m.type() === 'error') fehler.push('Konsole: ' + m.text()); });
const text = (sel) => win.$$eval(sel, (els) => els.map((e) => e.textContent).join('\n'));
const bild = async (name) => { if (BILDER) await win.screenshot({ path: path.join(BILDER, name + '.png') }); };
const S = (e) => win.evaluate(new Function('return (' + e + ')'));

try {
  await win.waitForSelector('#modus-lernen', { timeout: 40000 });
  await bild('0-willkommen');
  const hallo = await willkommenZu(win);
  check(/Level \d+/.test(hallo) && /Serie/.test(hallo) && /Abzeichen/.test(hallo), 'Begrüßung beim ersten Start: Level, Serie und Abzeichen aus dem bisherigen Verlauf');
  const kurse = await S('window.__lernhubTest.S.rc.map((c) => ({ key: c.key, slug: c.slug, short: c.short, offen: (c.lessons.find((l) => !l.done) || {}).id, done: c.done }))');
  check(kurse.length >= 2, `Diese Woche geladen, ${kurse.length} Kurse mit Roadmap`);

  // ---- Diese Woche
  const ganz = await text('#ansicht');
  check((await win.$('#modus-lernen')) && (await win.$('#modus-wiederholen')), 'Diese Woche: Karten „Lernen“ und „Wiederholen“ nebeneinander');
  const lernKarte = await text('#modus-lernen');
  check(kurse.some((k) => k.offen && lernKarte.includes(k.offen + ' · ')) && /Los|Weiterlernen/.test(lernKarte), 'Karte „Lernen“ nennt Kurs und Lektion, die dran ist, mit „Los“');
  check((await win.$$('#modus-lernen .kurs-chip')).length === kurse.length, 'Karte „Lernen“: ein Klick auf einen Kurs lernt dort (Chip je Kurs)');
  check(/Start mit .+, (weil|zum Vorlernen)/.test(lernKarte), 'Karte sagt, warum sie mit diesem Kurs beginnt');
  for (const t of ['Wochenpensum', 'Nächster Lerntag', 'Fortschritt im Semester', 'Lernzeit', 'ILIAS-Sync']) check((await text('.card h3')).includes(t), `Karte „${t}“ ist da`);
  check(!/Weitermachen|Wochenstart|Bereit zum Lernen|Erstellen|wird erstellt/.test(ganz), 'kein Weitermachen, kein Wochenstart, kein Erstellen, keine „bereiten Lektionen“');
  check(!(await win.$('webview')) && !(await win.$('#lektion')) && !(await win.$('.auftraege')), 'kein Lektions-Fenster und keine Auftragskarten im Dokument');
  check(!/GEÖFFNET/.test(await text('#sidebar')), 'Seitenleiste ohne „GEÖFFNET“');
  check(/Level \d+/.test(await text('#sidebar .side-spiel')) && /Woche/.test(await text('#sidebar .side-spiel')) && (await win.$('#sidebar .side-spiel .zring')) !== null, 'Seitenleiste: Karte mit Level, Rang, XP-Balken, Wochenserie und Tagesziel-Ring');
  check((await win.$$('.spiel-leiste .wp')).length === 7 && /Tagesziel/.test(await text('.spiel-leiste')) && /Serie/.test(await text('.spiel-leiste')), 'Startseite: Leiste mit Tagesziel, Wochenpunkten Mo–So, Serie und Level');
  check((await win.$$('.quests .quest')).length === 3 && (await win.$('.quests .truhe')) !== null, 'Startseite: Karte „Tagesquests“ mit drei Quests und Truhe');
  check((await win.$$('#ansicht .btn.haupt')).length === 1 && (await win.$('#modus-lernen .btn.haupt')) !== null, 'Startseite: die einzige große Hauptaktion trägt die Karte „Lernen“');
  check(/^Heute dran: /.test((await text('.lauf .modus-t')).trim()) && /fällig/.test(await text('.lauf .modus-m')), 'Karte „Wiederholen“: Überschrift nennt die Portion für heute, die Gesamtzahl steht klein darunter');
  check((await text('.acts-grid')).includes('Karteikarten') && !(await text('.acts-grid')).includes('ILIAS-Sync'), '„Mit Claude Code“: übrige Aktionen, der ILIAS-Sync hat seine eigene Karte');
  await bild('1-woche');

  // ---- Kursseite
  const k = kurse.find((x) => x.offen && x.done) || kurse[0];
  await win.click(`.side-item[data-nav="kurs:${k.slug}"]`);
  await win.waitForSelector('.khead');
  check((await text('#modus-lernen')).includes(k.offen) && (await win.$(`#modus-lernen [data-lernen="kurs|${k.key}"]`)) !== null, `Kursseite: Karte „Lernen“ mit ${k.offen} und Start-Knopf`);
  check((await win.$(`#modus-wiederholen [data-ueben="kurs|${k.key}"]`)) !== null && /fällig/.test(await text('#modus-wiederholen')), 'Kursseite: Karte „Wiederholen“ mit fälligen Themen und Start-Knopf');
  const tabs = await win.$$eval('.tabs .tab', (x) => x.map((e) => e.textContent.trim()));
  check(tabs.join(',') === 'Pfad,Liste,Material,Lücken,Notizen', 'Tabs: ' + tabs.join(' · ') + ' (keine Lernanalyse)');
  check(!(await text('.kacts')).includes('Nächste Lektion erstellen') && !(await win.$('.head [data-url$="roadmap.html"]')), 'keine Kurs-Aktion „Nächste Lektion erstellen“');
  check((await win.$('.frueher')) !== null && !(await win.$eval('.frueher', (d) => d.open)) && (await win.$eval('.view', (v) => v.scrollTop)) === 0, 'frühere, erledigte Wochen sind eingeklappt: Die Seite beginnt oben mit den beiden Karten');
  await bild('2-kurs');
  check((await win.$$('#ansicht .btn.haupt')).length === 1, 'Kursseite: genau eine große Hauptaktion');
  check((await win.$$('.pnode.jetzt')).length === 1 && (await text('.pnode.jetzt .plab')).includes(k.offen), 'Pfad: genau eine Lektion ist als Nächstes markiert');
  check((await win.$$('.pstart')).length === 1 && (await win.$('.pnode.jetzt .pstart')) !== null && (await win.$$('.pnode.erledigt .psterne')).length > 0 && (await win.$$('.ptruhe')).length > 0,
    'Pfad: Blase „START“ über der Lektion, die dran ist, Sterne unter erledigten, Truhe am Wochenziel');
  check(await win.$$eval('.pnode.boss', (b) => b.every((x) => x.querySelector('.ball'))) && (await win.$$('.pnode.boss')).length === (await S(`window.__lernhubTest.S.bySlug['${k.slug}'].lessons.filter((l) => l.training).length`)), 'Pfad: Lektionen mit Klausurtraining sind Boss-Knoten');
  await win.click('.pnode.jetzt .ball');
  await win.waitForSelector('.pop');
  check(/Lernen/.test(await text('.pop .acts')) && (await win.$('.pop [data-lernen]')) !== null, 'Karte am Pfad: „Lernen“ für die Lektion, die dran ist');
  await win.keyboard.press('Escape');
  await win.click('.frueher > summary');
  if (await win.$('.frueher .pnode.erledigt .ball')) {
    await win.click('.frueher .pnode.erledigt .ball'); await win.waitForSelector('.pop');
    check(!/Lernen|Erstellen/.test(await text('.pop .acts')), 'erledigte Lektion: kein „Lernen“ (höchstens „Merkblatt“)');
    await win.keyboard.press('Escape');
  }
  await win.click(`.tab[data-nav="kurs:${k.slug}:liste"]`);
  await win.waitForSelector('.lrows');
  check((await win.$$('.lrow.dran')).length === 1 && /Lernen/.test(await text('.lrow.dran .ac')), 'Liste: die Lektion, die dran ist, hat „Lernen“; spätere zeigen „nach …“');
  check(!/Erstellen|Ansehen/.test(await text('.lrows')), 'Liste ohne „Erstellen“ und ohne Lektions-Fenster');
  await win.click(`.tab[data-nav="kurs:${k.slug}:luecken"]`);
  await win.waitForSelector('#luecken .pre', { timeout: 20000 });
  check(/fällig/.test(await text('#luecken')), 'Tab „Lücken“: offene Lücken und was zum Wiederholen fällig ist');
  await bild('3-luecken');

  // ---- Nächster Lerntag
  await win.click('.side-item[data-nav="lerntag"]');
  await win.waitForSelector('.agenda, .empty');
  if (await win.$('.agenda .ev.block')) {
    check((await win.$$('.ev.block .lchip')).length > 0, 'Lerntag: Blöcke mit ihren Lektionen');
    check(!(await win.$('.agenda [data-lesson], .agenda [data-erstellen]')), 'Lerntag: Lektionen öffnen kein Lektions-Fenster, „Lernen“ startet den Kurs');
  }
  check((await text('.acts-grid')).includes('Plan & Kalender abgleichen'), 'Lerntag: Abgleich-Aktionen');
  await bild('4-lerntag');

  // ---- Einstellungen
  await win.click('[data-nav="einstellungen"]');
  await win.waitForSelector('#dg-key');
  const ein = await text('#ansicht');
  check(/Deepgram fürs Diktieren/.test(ein) && /Skill ilias-sync/.test(ein) && !/Lernanalyse|Laut denken|automatisch erstellen/.test(ein), 'Einstellungen: Diktieren und Verbindung, keine Lernanalyse');
  await bild('5-einstellungen');

  // ---- Profil
  await win.click('#sidebar .side-spiel');
  await win.waitForSelector('.profil-kopf');
  check((await win.$$('.kal .kal-w:not(.kal-tage) i')).length === 84 && (await win.$$('.abz')).length >= 20 && /Rekorde/.test(await text('#ansicht')), 'Profil: Level, Kalender der letzten 12 Wochen, Abzeichen mit Fortschritt, Rekorde');
  await bild('5b-profil');
  await win.click('[data-spiel-set="tagesziel|400"]');
  await warte(() => { try { return JSON.parse(fs.readFileSync(path.join(U.daten, 'spiel.json'), 'utf8')).tagesziel === 400; } catch { return false; } }, { text: 'Tagesziel gespeichert' });
  check(/\/ 400/.test(await text('#sidebar .side-spiel')) || (await win.$('[data-spiel-set="tagesziel|400"].on')) !== null, 'Profil: Tagesziel 400 gewählt und in spiel.json gespeichert');
  const sp = JSON.parse(fs.readFileSync(path.join(U.daten, 'spiel.json'), 'utf8'));
  check(sp.v === 1 && sp.willkommen === true && Object.keys(sp.abzeichen).length > 0, 'spiel.json: Begrüßung gesehen, Abzeichen aus dem Verlauf still freigeschaltet (' + Object.keys(sp.abzeichen).length + ')');

  // ---- Suche
  await win.evaluate(() => window.__lernhubTest.suche());
  await win.waitForSelector('.palette');
  const alle = await text('.palette li');
  check(/Lernen\n?die Lektion/.test(alle) && /ILIAS-Sync starten/.test(alle) && !/Weitermachen|Wochenstart/.test(alle), 'Suche: Lernen, Wiederholen, ILIAS-Sync; kein Weitermachen, kein Wochenstart');
  await win.keyboard.press('Escape');

  // ---- „Los“ lernt sofort
  await win.click('.side-item[data-nav="woche"]');
  await win.waitForSelector('#modus-lernen [data-lernen="lauf"]');
  const zuerst = await S('(() => { const S = window.__lernhubTest.S; return S.rc.map((c) => c.key); })()');
  await win.click('#modus-lernen [data-lernen="lauf"]');
  await win.waitForSelector('.lrn-frage.offen', { timeout: 30000 });
  check(/nach Plan/.test(await text('.head')), '„Los“ startet die Lektion sofort, ohne Zwischenseite');
  const lf = await text('#sidebar .side-open');
  check(/lernen/.test(lf), 'Seitenleiste „LÄUFT“: die offene Lektion (' + lf.trim() + ')');
  await bild('6-lernen');
  check(await fokusAus(win), 'Lernen startet im Fokus-Modus: Seitenleiste ausgeblendet, [data-fokus] holt sie zurück');
  await bild('6b-lernen-ohne-fokus');
  await win.click('.side-item[data-nav="woche"]');
  await win.waitForSelector('#modus-lernen');
  check(/Weiterlernen/.test(await text('#modus-lernen')) && /mittendrin/.test(await text('#modus-lernen')), 'zurück auf „Diese Woche“: Karte bietet „Weiterlernen“ an');
  await bild('7-woche-laeuft');
  await win.click('#sidebar .side-open');
  await win.waitForSelector('.lrn-frage.offen');
  check(true, 'Klick auf „LÄUFT“ setzt die Lektion fort');
  check(zuerst.length === kurse.length && fehler.length === 0, 'keine Fehler in Konsole und Hauptprozess' + (fehler.length ? ': ' + fehler.join(' | ').slice(0, 600) : ''));
} catch (e) {
  check(false, 'Abbruch: ' + e.message + (fehler.length ? ' · ' + fehler.join(' | ').slice(0, 600) : ''));
  try { await win.screenshot({ path: path.join(U.T, 'fehler.png') }); console.log('Bildschirmfoto:', path.join(U.T, 'fehler.png')); } catch { }
} finally {
  await app.close();
}
