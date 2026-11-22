// Ende-zu-Ende: Karte „Lernen“ auf der Kursseite → Lektion im Gespräch (claude -p als Attrappe) → „Lektion
// abschließen“ trägt sie in der Roadmap ein → „Nächste Lektion“. Kopie des Semesters, echte Daten bleiben unberührt. Aufruf: node tests/lernen.test.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { bereiten, check, warte, willkommenZu, fokusAus } from './umgebung.mjs';
import { tagVon } from '../src/ui/js/regeln.js';

const U = bereiten();
const LOG = path.join(U.T, 'attrappe.jsonl');
U.env.LERNHUB_CLAUDE = path.resolve('tests/lernen-attrappe.mjs');
U.env.LERNEN_ATTRAPPE_LOG = LOG;
const KURS = U.kurs, SLUG = U.slug, ws = path.join(U.sem, KURS, 'Lernbereich');
const rmLesen = () => JSON.parse(fs.readFileSync(path.join(ws, 'roadmap.json'), 'utf8'));
const offene = rmLesen().lessons.filter((l) => !l.done && !l.placeholder);
const ID = offene[0].id, ID2 = offene[1].id;
// Die Lektionen sollen noch keine Datei haben: dann legt der Abschluss das Merkblatt an
for (const f of fs.readdirSync(path.join(ws, 'lessons'))) if (f.startsWith(ID + '-') || f.startsWith(ID2 + '-')) fs.unlinkSync(path.join(ws, 'lessons', f));
const recordsVorher = fs.readdirSync(path.join(ws, 'learning-records')).length;
console.log('Testordner:', U.T, '· Lektion', ID);

const app = await electron.launch({ args: ['.'], env: U.env });
const fehler = [];
app.process().stderr.on('data', (d) => { const s = String(d); if (/error|Error/.test(s) && !/Autofill|DevTools|GPU/.test(s)) fehler.push(s.trim()); });
const win = await app.firstWindow();
win.on('pageerror', (e) => fehler.push('Seite: ' + e.message));
win.on('console', (m) => { if (m.type() === 'error') fehler.push('Konsole: ' + m.text()); });
const text = (sel) => win.$$eval(sel, (els) => els.map((e) => e.textContent).join('\n'));
const BILDER = process.env.E2E_BILDER;          // Bildschirmfotos zum Ansehen (wie in tests/e2e.mjs)
if (BILDER) fs.mkdirSync(BILDER, { recursive: true });
const bild = async (name) => { if (BILDER) await win.screenshot({ path: path.join(BILDER, 'l-' + name + '.png') }); };
const zuege = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').map((z) => JSON.parse(z));

try {
  await win.waitForSelector('.title', { timeout: 30000 });
  await willkommenZu(win);
  await win.click(`.side-item[data-nav="kurs:${SLUG}"]`);
  await win.waitForSelector('.modi');
  const karten = await win.$$eval('.modi .modus h3', (hs) => hs.map((h) => h.textContent.trim()));
  check(/^Lernen/.test(karten[0]) && /^Wiederholen/.test(karten[1]), 'Kursseite: Karten „Lernen“ und „Wiederholen“ nebeneinander');
  check((await text('#modus-lernen .modus-t')).includes(ID), 'Karte „Lernen“ nennt die nächste Lektion der Roadmap (' + ID + ')');
  await win.click(`#modus-lernen [data-lernen="kurs|${KURS}"]`);
  await win.waitForSelector('.ueb-denkt', { timeout: 5000 });
  check(!(await win.$('[data-lrn="start"]')), '„Lernen starten“ beginnt sofort, ohne Zwischenseite');
  await win.waitForSelector('.lrn-frage.offen', { timeout: 20000 });
  check((await text('.lrn-roadmap .lrn-rm.jetzt')).includes(ID), 'Roadmap rechts sichtbar, die Lektion ist markiert');
  check((await win.$$('.lrn-roadmap .lrn-rm')).length === rmLesen().lessons.length, 'Roadmap zeigt alle Lektionen des Kurses');
  check(await win.$eval('.app', (a) => a.classList.contains('fokus')) && await win.$eval('.lrn-seite', (x) => getComputedStyle(x).display === 'none')
    && (await win.$$('.fokus-leiste .fokus-seg i')).length === 3 && /\d+ \/ \d+ Min\./.test(await text('.fokus-uhr')), 'Fokus-Modus: rechte Spalte ausgeblendet, Balken mit einem Segment je Schritt und die Uhr unter dem Kopf');
  check(/Schritt-1-Unterricht/.test(await text('.lrn-text')), 'Claudes Unterricht zu Schritt 1 im Verlauf');
  check((await win.$$('.lrn-plan li')).length === 3 && /Schritt A/.test(await text('.lrn-plan li.jetzt')), 'Plan der Lektion rechts, Schritt 1 ist „jetzt“');
  check(/0 \/ \d+ Min\.|1 \/ \d+ Min\./.test(await text('.lrn-uhr')), 'Lektionsuhr läuft gegen das Budget');
  check(!(await win.content()).includes('GEHEIM-ERKL-1'), 'Erklärung bleibt verborgen, solange die Frage offen ist');
  check(/\[Uni-Lektion\]/.test(zuege()[0].ein) && zuege()[0].ein.includes(`Lektion ${ID}`) && /Material dieser Lektion/.test(zuege()[0].ein), 'erster Zug bringt den Kontext der Lektion mit (lernen.py)');

  await win.fill('#lrn-text', 'Was heißt symbolisch?');
  check(/Rückfrage senden/.test(await text('[data-lrn="senden"]')), 'Text ohne Auswahl: Knopf heißt „Rückfrage senden“');
  await win.press('#lrn-text', 'Enter');
  await warte(async () => /Kurze Antwort auf die Rückfrage/.test(await text('.lrn-text')), { text: 'Antwort auf Rückfrage' });
  check(await win.$('.lrn-frage.offen') !== null, 'nach der Rückfrage bleibt die Frage offen');

  await win.click('.ueb-eyebrow');                       // Fokus aus dem Feld
  await win.keyboard.press('1');
  await win.waitForSelector('.lrn-frage.offen .lrn-opt.gew');
  check(true, 'Taste 1 wählt Option A');
  await win.click('[data-lrn-sicher="sicher"]');
  await win.keyboard.press('Enter');
  await warte(async () => /Falsch/.test(await text('.lrn-frage[data-frage="1"] .chip')), { text: 'Bewertung Frage 1' });
  check(/GEHEIM-ERKL-1/.test(await text('.lrn-frage[data-frage="1"]')), 'falsche Antwort: Chip „Falsch“, Erklärung erscheint sofort');
  check(/refs\/heads\/dev/.test(await text('.lrn-frage[data-frage="1"] .lrn-opt.richtig')) && (await win.$('.lrn-frage[data-frage="1"] .lrn-opt.falsch')) !== null, 'richtige Option grün, gewählte rot');
  await bild('1-falsch');
  check(/\+2 XP/.test(await text('.lrn-frage[data-frage="1"] .chip.xp')) && /Noch nicht|Knapp daneben|Fast|Daraus lernst/.test(await text('.lrn-frage[data-frage="1"] .lrn-lob')), 'Spiel: XP-Chip „+2 XP“ auf der Fragekarte und eine Zeile Trost');
  await win.waitForSelector('.lrn-frage[data-frage="2"].offen', { timeout: 15000 });
  const z2 = zuege().find((z) => /^Antwort auf Frage 1 /.test(z.ein)).ein;
  check(/FALSCH, richtig ist B\)/.test(z2) && /Sicherheit: sicher/.test(z2) && /\[Lektionsuhr: \d+ von \d+ Min\.\]/.test(z2), 'Claude bekommt Wahl, Ergebnis, Sicherheit und die Lektionsuhr');

  check(/\[Stand: 0 von 1 Prüffragen richtig\]/.test(z2), 'Claude bekommt den laufenden Stand (für die Schwierigkeit)');
  check(/Vorhersage/.test(await text('.lrn-frage[data-frage="2"] .ueb-eyebrow')), 'zweite Frage ist eine Vorhersage');
  check(/Antwortzeit: \d+ s/.test(z2) && !(await win.$('[data-lrn="einfacher"]')), 'Claude bekommt die Antwortzeit, Hilfe-Knöpfe gibt es nicht');
  await win.click('.lrn-frage[data-frage="2"] [data-lrn-opt="0"]');
  await win.click('[data-lrn="senden"]');
  await win.waitForSelector('.lrn-frage[data-frage="3"].offen', { timeout: 15000 });
  check(/traf zu/.test(await text('.lrn-frage[data-frage="2"] .chip')), 'Vorhersage wird erst mit Claudes Auflösung aufgedeckt');

  check(!(await win.content()).includes('GEHEIM-LSG'), 'freie Frage: Lösung verborgen');
  await win.fill('#lrn-text', '42, weil zwei Blobs');
  await win.press('#lrn-text', 'Enter');
  await win.waitForSelector('.lrn-frage[data-frage="4"].offen', { timeout: 15000 });
  const k3 = await text('.lrn-frage[data-frage="3"]');
  check(/Richtig/.test(k3) && /GEHEIM-LSG/.test(k3), 'freie Antwort: Claude bewertet, dann erscheinen Chip und Lösung');
  check(/\+(10|20) XP/.test(await text('.lrn-frage[data-frage="3"] .chip.xp')) && /\+3 XP/.test(await text('.lrn-frage[data-frage="2"] .chip.xp')), 'Spiel: richtige Prüffrage 10 XP (Glückstreffer 20), Vorhersage 3 XP');
  check(/Schritt C/.test(await text('.lrn-plan li.jetzt')) && (await win.$$('.lrn-plan li.done')).length === 2, 'Plan rückt mit: Schritt 3 ist „jetzt“');

  await win.click('.lrn-frage[data-frage="4"] [data-lrn-opt="2"]');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.lrn-rueck', { timeout: 15000 });
  const rs = await text('.lrn-rueck');
  check(/Punkt eins/.test(rs) && /Noch offen/.test(rs) && /67 %/.test(rs), 'Rückschau mit Gelerntem, „Noch offen“ und Score 67 % (2 von 3 Prüffragen, Vorhersage zählt nicht)');
  check(!rmLesen().lessons.find((l) => l.id === ID).done, 'vor „Lektion abschließen“ ist in der Roadmap nichts eingetragen');
  await bild('2-rueckschau');
  check(/2er-Combo/.test(await text('.head .combo')) && /\+(12|24) XP/.test(await text('.lrn-frage[data-frage="4"] .chip.xp')), 'Spiel: zwei richtige Prüffragen in Folge = 2er-Combo im Kopf, 12 XP');

  await win.click('[data-lrn="eintragen"]');
  await win.waitForSelector('.lrn-ok', { timeout: 60000 });
  await win.waitForSelector('.feier', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1600));
  await bild('3-feier');
  const fe = await text('.feier');
  check((await win.$$('.feier-stern.an')).length === 2 && /67 %/.test(fe) && /Min\./.test(fe) && /Nächste Lektion →/.test(await text('.feier [data-feier="naechste"]'))
    && /Fertig für jetzt/.test(fe) && new RegExp(ID2).test(fe), 'Feier: zwei Sterne, Genauigkeit 67 %, Zeit, XP, Vorschau auf ' + ID2 + ', „Nächste Lektion →“');
  await warte(async () => /^\+\d+$/.test(await text('[data-feier-xp]')) && +(await text('[data-feier-xp]')).slice(1) >= 27 + 80, { text: 'XP zählen hoch', timeout: 5000 });
  check(true, 'Feier: XP zählen hoch (' + await text('[data-feier-xp]') + ')');
  await win.keyboard.press('Escape');
  await warte(async () => !(await win.$('.feier')), { text: 'Feier schließt mit Esc' });
  check((await win.$('.lrn-ok')) !== null, 'Esc schließt die Feier, darunter steht „Eingetragen“');
  const spiel = await warte(() => { try { const x = JSON.parse(fs.readFileSync(path.join(U.daten, 'spiel.json'), 'utf8')); return Object.keys(x.gebucht).length >= 4 && x; } catch { return false; } }, { text: 'spiel.json' });
  const heute = spiel.tage[tagVon()] || {};
  check(Object.keys(spiel.gebucht).filter((k) => /:f\d+$/.test(k)).length === 4 && heute.fragen === 3 && heute.richtig === 2 && heute.vorhersagen === 1 && heute.xp >= 27,
    `Spielstand in spiel.json: vier Fragen genau einmal gebucht, heute ${heute.xp} XP, 2 von 3 Prüffragen richtig`);
  const l = rmLesen().lessons.find((x) => x.id === ID);
  check(!!l.done && l.score === 67 && l.minutes >= 1, `Roadmap: ${ID} erledigt mit Score ${l.score} % und ${l.minutes} Min.`);
  check(!l.needs_record, 'Learning Record ist abgehakt (kein „Lernstand nachtragen“)');
  const datei = fs.readdirSync(path.join(ws, 'lessons')).find((f) => f.startsWith(ID + '-'));
  const html = datei ? fs.readFileSync(path.join(ws, 'lessons', datei), 'utf8') : '';
  check(/data-topic="test-thema-a"/.test(html) && /Kern A/.test(html) && /GEHEIM-ERKL-1/.test(html) && /abschluss\.js/.test(html), 'Merkblatt liegt bei den Lektionen: Kern je Schritt mit data-topic, Prüffragen, Abschlussleiste');
  const recs = fs.readdirSync(path.join(ws, 'learning-records'));
  const rec = recs.find((f) => f.includes(`-lektion-${ID}-`));
  check(recs.length === recordsVorher + 1 && !!rec && /Kette sitzt/.test(fs.readFileSync(path.join(ws, 'learning-records', rec), 'utf8')), 'Learning Record geschrieben: ' + rec);
  check(U.kalenderAufrufe().length > 0, 'Kalender wurde abgeglichen');
  const zz = zuege();
  check(zz[0].args.includes('--session-id') && zz.slice(1).every((z) => z.args.includes('--resume')), 'erster Zug legt die Sitzung an, alle weiteren setzen sie fort');
  check(zz.every((z) => z.args.includes('--json-schema') && !z.args.includes('bypassPermissions') && z.args.indexOf('Bash') > z.args.indexOf('--disallowedTools')), 'jeder Zug mit Schema, ohne bypassPermissions, Bash und Schreiben gesperrt');

  check(await fokusAus(win), 'Fokus-Modus: Seitenleiste war ausgeblendet, [data-fokus] holt sie zurück');
  await warte(() => { try { return JSON.parse(fs.readFileSync(path.join(U.daten, 'spiel.json'), 'utf8')).fokus === false; } catch { return false; } }, { text: 'Fokus-Wahl gespeichert' });
  check(true, 'Die Wahl „Fokus aus“ steht in spiel.json');
  await win.click(`.side-item[data-nav="kurs:${SLUG}"]`);
  await warte(async () => (await win.$(`.pnode.erledigt [data-pop$="|${ID}"]`)) !== null, { text: 'Pfad zeigt die Lektion als erledigt', timeout: 30000 });
  check(true, 'Kursseite (Pfad) zeigt die Lektion als erledigt: Roadmap läuft synchron');
  check((await text('#modus-lernen .modus-t')).includes(ID2) && (await text('.pnode.jetzt .plab')).includes(ID2), `Karte und Pfad rücken weiter: ${ID2} ist dran`);
  await win.evaluate((s) => window.__lernhubTest.nav({ name: 'lernen', slug: s }), SLUG);
  await win.waitForSelector('[data-lrn="naechste"]');
  check(/Nächste Lektion →/.test(await text('[data-lrn="naechste"]')) && (await win.$('[data-lrn="ansehen"]')) !== null, 'nach dem Eintragen: „Rückgängig“, „Merkblatt“ und „Nächste Lektion →“');
  await win.click('[data-lrn="naechste"]');
  await warte(async () => (await text('.head .chip')).includes(ID2), { text: 'nächste Lektion gestartet' });
  check(true, `„Nächste Lektion →“ startet ${ID2}`);
  await win.waitForSelector('.lrn-frage.offen', { timeout: 20000 });
  await win.click('[data-lrn="verwerfen"]');
  await win.click('.sheet [data-v="1"]');
  await win.waitForSelector('[data-lrn="start"]');
  check((await text('.ueb-start .title')).includes(ID2) && !rmLesen().lessons.find((x) => x.id === ID2).done, 'Abbrechen verwirft die Sitzung, die Lektion bleibt offen');
  check(fehler.length === 0, 'keine Fehler in Konsole und Hauptprozess' + (fehler.length ? ': ' + fehler.join(' | ').slice(0, 400) : ''));
} catch (e) {
  check(false, 'Abbruch: ' + e.message);
  try { await win.screenshot({ path: path.join(U.T, 'fehler.png') }); console.log('Bildschirmfoto:', path.join(U.T, 'fehler.png')); } catch { }
} finally {
  if (process.env.LERNEN_BILD) { try { await win.screenshot({ path: process.env.LERNEN_BILD }); } catch { } }
  await app.close();
}
