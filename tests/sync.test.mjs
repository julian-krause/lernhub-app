// Ende-zu-Ende: ILIAS-Sync per Knopf auf „Diese Woche“ (claude -p als Attrappe, kein echter Login, kein Download).
// Prüft Fortschritt, Ergebnis, Abbruch, den Lauf ohne Zugangsdaten und die Freigaben: nie ein Fenster, keine
// Rückfragen. Kopie des Semesters, echte Daten bleiben unberührt. Aufruf: node tests/sync.test.mjs
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bereiten, check, warte, willkommenZu } from './umgebung.mjs';

const U = bereiten();
const LOG = path.join(U.T, 'attrappe.jsonl'), MODUS = path.join(U.T, 'modus');
U.env.LERNHUB_CLAUDE = path.resolve('tests/sync-attrappe.mjs');
U.env.SYNC_ATTRAPPE_LOG = LOG;
U.env.SYNC_ATTRAPPE_MODUS = MODUS;
console.log('Testordner:', U.T);

// ---- Freigaben und Auftrag (ohne App)
const { freigaben, auftrag, schrittText } = createRequire(import.meta.url)('../src/main/sync.js');
const sem = path.join(os.homedir(), 'Studium/Hochschule Überall/1. Semester');          // erfundener Pfad mit Umlaut
const F = freigaben(sem), il = path.join(os.homedir(), '.claude/skills/ilias-sync/scripts');
check(F.erlaubt.includes(`Bash(${il}/*)`) && F.erlaubt.some((x) => /roadmap\.py sync-\*\)$/.test(x)), 'erlaubt: die Skripte von ilias-sync und roadmap.py sync-*');
check(F.verboten.includes(`Bash(${il}/login.py --manual*)`) && F.verboten.includes(`Bash(${il}/login.py --keep*)`) && F.verboten.includes('Bash(agent-browser:*)'), 'gesperrt: Login mit Fenster, offener Browser, agent-browser direkt');
check(F.verboten.some((x) => /tutor\.py\*\)$/.test(x)) && F.verboten.includes(`Bash(${il}/ilias.py select*)`) && !F.erlaubt.some((x) => /^(Write|Edit)$/.test(x)), 'gesperrt: tutor.py und die Kursauswahl; schreiben nur Links.md');
check(F.erlaubt.some((x) => /^Edit\(\/.*Hochschule \*berall\/1\. Semester\/\*\*\/Links\.md\)$/.test(x)), 'Pfadregel: Umlaut als Platzhalter (NFC und NFD passen)');
const A = auftrag({ sem, kategorie: 'Wintersemester 2026' });
check(/^\/ilias-sync Routine-Lauf fürs 1\. Semester \(ILIAS-Kategorie „Wintersemester 2026“\)/.test(A) && A.includes('SEMDIR=' + sem) && /kein Fenster/.test(A) && /Keine Rückfragen/.test(A), 'Auftrag: /ilias-sync als Routine-Lauf, ohne Fenster, ohne Rückfragen');
check(schrittText({ name: 'Bash', input: { command: `${il}/login.py` } }) === 'meldet sich bei ILIAS an' && schrittText({ name: 'Bash', input: { command: `${il}/ilias.py download "x"` } }) === 'lädt neue Dateien herunter', 'Schritte werden in Klartext übersetzt');

// ---- In der App
const app = await electron.launch({ args: ['.'], env: U.env });
const fehler = [];
app.process().stderr.on('data', (d) => { const s = String(d); if (/error|Error/.test(s) && !/Autofill|DevTools|GPU/.test(s)) fehler.push(s.trim()); });
const win = await app.firstWindow();
win.on('pageerror', (e) => fehler.push('Seite: ' + e.message));
win.on('console', (m) => { if (m.type() === 'error') fehler.push('Konsole: ' + m.text()); });
const text = (sel) => win.$$eval(sel, (els) => els.map((e) => e.textContent).join('\n'));
const zuege = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').map((z) => JSON.parse(z));

try {
  await win.waitForSelector('#sync', { timeout: 40000 });
  await willkommenZu(win);
  check(/ILIAS-Sync/.test(await text('#sync h3')) && (await win.$('#sync [data-sync="start"]')) !== null, 'Diese Woche: Karte „ILIAS-Sync“ mit „Sync starten“');
  check((await win.$('#sync [data-url^="claude-cli:"]')) !== null, 'Ausweg für Rückfragen bleibt: „In Claude Code“');
  const kalVorher = U.kalenderAufrufe().length;

  // 1. Lauf, der durchgeht
  fs.writeFileSync(MODUS, 'ok');
  await win.click('#sync [data-sync="start"]');
  await win.waitForSelector('#sync .sync-schritte', { timeout: 5000 });
  check(/läuft/.test(await text('#sync h3')) && (await win.$('#sync [data-sync="abbrechen"]')) !== null, 'läuft: Chip „läuft“, Uhr und „Abbrechen“ statt „Sync starten“');
  await warte(async () => /meldet sich bei ILIAS an/.test(await text('#sync .sync-schritte')), { text: 'Schritt Login' });
  await warte(async () => /lädt neue Dateien herunter/.test(await text('#sync .sync-schritte li.jetzt')), { text: 'Schritt Download' });
  check((await win.$$('#sync .sync-schritte li.done')).length >= 3, 'Fortschritt auf der Seite: erledigte Schritte abgehakt, der laufende hervorgehoben');
  check(/ILIAS-Sync/.test(await text('#sidebar .side-icloud')), 'Seitenleiste zeigt, dass der Sync läuft');
  await win.waitForSelector('#sync .sync-ergebnis.fertig', { timeout: 15000 });
  const erg = await text('#sync .sync-ergebnis');
  check(/Fertig/.test(erg) && /Sync fertig: 3 neue Dateien/.test(erg) && /Tutorium/.test(erg), 'fertig: Zusammenfassung mit neuen Dateien je Kurs und „Offen“');
  check((await win.$('#sync .sync-ergebnis b')) !== null && (await win.$$('#sync .sync-ergebnis li')).length >= 3, 'Zusammenfassung ist als Text mit Liste gesetzt');
  await warte(() => U.kalenderAufrufe().length > kalVorher, { text: 'Abgleich nach dem Sync', timeout: 60000 });
  check(true, 'danach gleicht die App Roadmaps, Lernhub und Kalender ab (kurstutor://sync)');
  const z = zuege()[0];
  check(z.args.includes('dontAsk') && !z.args.includes('bypassPermissions') && z.args.includes('stream-json') && z.args.includes('--strict-mcp-config'), 'claude -p mit dontAsk, nie bypassPermissions');
  check(z.args.some((a) => /login\.py --manual\*\)$/.test(a)) && z.args.indexOf('Bash(agent-browser:*)') > z.args.indexOf('--disallowedTools'), 'Login mit Fenster und agent-browser stehen in den gesperrten Werkzeugen');
  check(/^\/ilias-sync Routine-Lauf/.test(z.ein) && fs.realpathSync((z.ein.match(/^SEMDIR=(.+)$/m) || [])[1] || '/') === fs.realpathSync(U.sem) && fs.realpathSync(z.cwd) === fs.realpathSync(U.sem), 'Auftrag /ilias-sync, Arbeitsordner ist das Semester');
  check(JSON.parse(fs.readFileSync(path.join(U.daten, 'sync/letzter.json'), 'utf8')).neu === 3, 'Ergebnis des letzten Laufs bleibt gespeichert (3 neue Dateien)');
  await win.click('#sync [data-sync="leeren"]');
  await warte(async () => !(await win.$('#sync .sync-ergebnis')), { text: 'Ergebnis ausgeblendet' });
  check(!fs.existsSync(path.join(U.daten, 'sync/letzter.json')), '„Ausblenden“ räumt das Ergebnis weg');

  // 2. Zugangsdaten fehlen: kein Fenster, klare Meldung
  fs.writeFileSync(MODUS, 'login');
  await win.click('#sync [data-sync="start"]');
  await win.waitForSelector('#sync .sync-ergebnis.fehler', { timeout: 15000 });
  check(/Nicht durchgelaufen/.test(await text('#sync .sync-ergebnis')) && /\.env/.test(await text('#sync .sync-ergebnis')), 'ohne Zugangsdaten: „Nicht durchgelaufen“ mit dem Hinweis auf die .env, kein Fenster');
  check(/Sync abgebrochen/.test(await text('.toast.fehler')), 'Meldung unten rechts');

  // 3. Abbrechen
  fs.writeFileSync(MODUS, 'lang');
  await win.click('#sync [data-sync="start"]');
  await warte(async () => /lädt neue Dateien herunter/.test(await text('#sync .sync-schritte')), { text: 'Download läuft' });
  check(!(await win.evaluate(() => window.lernhub.syncStarten())).ok, 'ein zweiter Start während des Laufs wird abgelehnt');
  await win.click('#sync [data-sync="abbrechen"]');
  await win.waitForSelector('#sync .sync-ergebnis.abgebrochen', { timeout: 10000 });
  check(/Abgebrochen/.test(await text('#sync .sync-ergebnis')), '„Abbrechen“ beendet claude');
  check(fehler.length === 0, 'keine Fehler in Konsole und Hauptprozess' + (fehler.length ? ': ' + fehler.join(' | ').slice(0, 400) : ''));
} catch (e) {
  check(false, 'Abbruch: ' + e.message + (fehler.length ? ' · ' + fehler.join(' | ').slice(0, 400) : ''));
  try { await win.screenshot({ path: path.join(U.T, 'fehler.png') }); console.log('Bildschirmfoto:', path.join(U.T, 'fehler.png')); } catch { }
} finally {
  if (process.env.SYNC_BILD) { try { await win.screenshot({ path: process.env.SYNC_BILD }); } catch { } }
  await app.close();
}
