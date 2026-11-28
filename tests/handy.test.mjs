// Ende-zu-Ende: Lernhub fürs iPhone (src/main/handy.js, src/mobil). Die Mac-App läuft mit Claude-Attrappe auf einer
// Kopie des Semesters, die iPhone-App in einem Fenster in iPhone-Größe, verbunden über den lokalen Server.
// Geprüft: Schlüssel und Freigaben des Servers, Lernen und Wiederholen im Leise-Modus (Regeln an Claude, Antippen
// statt Tippen, Lösung aufdecken und selbst einschätzen, Schnellknöpfe), Eintragen, XP am Mac, Leise-Modus aus.
// Stumm: Beide Fenster sind ohne Ton. Aufruf: node tests/handy.test.mjs (Bildschirmfotos: E2E_BILDER=<Ordner>)
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { bereiten, check, warte, willkommenZu } from './umgebung.mjs';

const U = bereiten();
const LOG = path.join(U.T, 'attrappe.jsonl');
const PORT = 47000 + Math.floor(Math.random() * 900);
U.env.LERNHUB_CLAUDE = path.resolve('tests/handy-attrappe.mjs');
U.env.HANDY_ATTRAPPE_LOG = LOG;
U.env.LERNHUB_HANDY_PORT = String(PORT);
const KURS = U.kurs, ws = path.join(U.sem, KURS, 'Lernbereich');
const rmLesen = () => JSON.parse(fs.readFileSync(path.join(ws, 'roadmap.json'), 'utf8'));
const ID = rmLesen().lessons.find((l) => !l.done && !l.placeholder).id;
const zuege = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((z) => JSON.parse(z)); } catch { return []; } };
const BILDER = process.env.E2E_BILDER;
if (BILDER) fs.mkdirSync(BILDER, { recursive: true });
console.log('Testordner:', U.T, '· Kurs', KURS, '· Lektion', ID, '· Port', PORT);

const app = await electron.launch({ args: ['.'], env: U.env });
const fehler = [];
app.process().stderr.on('data', (d) => { const s = String(d); if (/error|Error/.test(s) && !/Autofill|DevTools|GPU/.test(s)) fehler.push(s.trim()); });
const mac = await app.firstWindow();
mac.on('pageerror', (e) => fehler.push('Mac: ' + e.message));
const B = `http://127.0.0.1:${PORT}`;
let handy = null;

try {
  await mac.waitForSelector('.title', { timeout: 30000 });
  await willkommenZu(mac);
  const token = JSON.parse(fs.readFileSync(path.join(U.daten, 'handy.json'), 'utf8')).token;
  check(token && token.length >= 32, 'Schlüssel fürs iPhone liegt in den App-Daten (handy.json)');

  // ---------------------------------------------------------------- Server: Schlüssel und Freigaben
  const post = (name, body, t = token) => fetch(`${B}/api/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { 'X-Lernhub-Token': t } : {}) }, body: JSON.stringify(body || {}) });
  check((await post('daten', {}, null)).status === 401 && (await post('daten', {}, 'falsch' + token.slice(6))).status === 401, 'API ohne oder mit falschem Schlüssel: 401');
  const rd = await post('daten');
  const d = await rd.json();
  check(rd.status === 200 && d.daten && d.daten.courses.some((c) => c.key === KURS) && /lh=/.test(rd.headers.get('set-cookie') || ''), 'API mit Schlüssel: schlanke Daten, Cookie für Merkblätter');
  check(JSON.stringify(d.daten).length < 200000 && !('actions' in d.daten), 'Daten fürs iPhone sind schlank (ohne Aktionen, Pfade nur für Merkblätter)');
  const seite = await (await fetch(B + '/')).text();
  check(/manifest/.test(seite) && /apple-mobile-web-app-capable/.test(seite), 'Startseite: Web-App mit Manifest und Vollbild am iPhone');
  check(/\.bs-kette/.test(await (await fetch(B + '/bs.css')).text()), 'Baustein-Styles aus app.css (/bs.css)');
  check((await fetch(B + '/js/md.js')).status === 200 && (await fetch(B + '/js/spiel.js')).status === 404 && (await fetch(B + '/m/../main/main.js')).status === 404, 'Geteilte Module ja, alles andere aus src nicht');
  check((await fetch(`${B}/datei/etc/hosts?t=${token}`)).status === 403 && (await fetch(`${B}/datei/etc/hosts`)).status === 401, 'Dateien nur aus dem Studienordner und nur mit Schlüssel');
  const man = await (await fetch(`${B}/manifest.webmanifest?t=${token}`)).json(), man2 = await (await fetch(`${B}/manifest.webmanifest?t=falsch`)).json();
  check(man.start_url.includes(token) && man2.start_url === '/' && man.display === 'standalone', 'Manifest: Schlüssel in start_url nur, wenn er stimmt');
  const info = await mac.evaluate(() => window.lernhub.handyInfo(false));
  check(info && info.laeuft && info.port === PORT, 'Mac: handyInfo meldet den laufenden Server');

  // ---------------------------------------------------------------- iPhone-Fenster
  await app.evaluate(({ BrowserWindow }, url) => {
    const w = new BrowserWindow({ width: 390, height: 844, show: true, title: 'iPhone' });
    w.webContents.setAudioMuted(true);
    w.loadURL(url);
  }, `${B}/`);
  handy = await warte(async () => app.windows().find((w) => w.url().startsWith(B)), { text: 'iPhone-Fenster' });
  handy.on('pageerror', (e) => fehler.push('iPhone: ' + e.message));
  handy.on('console', (m) => { if (m.type() === 'error' && !/favicon|serviceWorker|ERR_|status of 401/.test(m.text())) fehler.push('iPhone-Konsole: ' + m.text()); });
  const bild = async (n) => { if (BILDER) { await handy.waitForTimeout(450); await handy.screenshot({ path: path.join(BILDER, 'handy-' + n + '.png') }); } };   // nach den Einblendungen
  const text = (sel) => handy.$$eval(sel, (els) => els.map((e) => e.textContent).join('\n'));
  // ohne Schlüssel im Link: Hinweis und Feld zum Einfügen; ein unvollständiger Link wird abgelehnt, der ganze verbindet
  await handy.waitForSelector('#link-ein', { timeout: 15000 });
  check(/Noch nicht verbunden/.test(await text('.leer h2')) && /fehlt der Schlüssel/.test(await text('.leer')), 'Ohne Schlüssel: „Noch nicht verbunden“ mit Grund und Feld zum Einfügen');
  await handy.fill('#link-ein', `${B}/?t=••••••`);
  await handy.click('[data-a="link-verbinden"]');
  check(/nicht der ganze Link/.test(await text('#toast')), 'Unvollständiger Link (Punkte statt Schlüssel) wird abgelehnt');
  await handy.fill('#link-ein', `https://irgendwo.ts.net:8443/?t=${token}`);
  await handy.click('[data-a="link-verbinden"]');
  await handy.waitForSelector('.gruss', { timeout: 30000 });
  check(await handy.evaluate(() => localStorage.getItem('lh-token')) === token, 'Eingefügter Link verbindet, der Schlüssel ist gespeichert');
  // Home-Bildschirm-App mit altem Schlüssel im Link: Sie nimmt den gespeicherten, der passt
  await handy.goto(`${B}/?t=${'x'.repeat(32)}`);
  await handy.waitForSelector('.gruss', { timeout: 30000 });
  check(true, 'Alter Schlüssel im Link: Die App fällt auf den bestätigten zurück');
  check(await handy.$('.leise.an') !== null, 'Leise-Modus ist am iPhone von Anfang an an');
  check(/Lernen/.test(await text('.karte.modus h3')) && /Wiederholen/.test(await text('.karte.modus h3')), 'Startseite: Karten Lernen und Wiederholen');
  check(/Level \d+/.test(await text('.spielkarte')), 'Spielkarte mit Level und Serie (aus spiel.json und Roadmaps)');
  await bild('1-start');

  // ---------------------------------------------------------------- Lernen im Leise-Modus
  await handy.click(`[data-lernen$="|${KURS}"]`);
  await handy.waitForSelector('.warten', { timeout: 10000 });
  await handy.waitForSelector('.fkarte.offen [data-opt]', { timeout: 30000 });
  const start = zuege().find((z) => /\[Uni-Lektion\]/.test(z.ein));
  check(start && /\[Leise-Modus, Regeln/.test(start.ein) && /Nur Auswahlfragen/.test(start.ein), 'Lektion am iPhone im Leise-Modus: Claude bekommt die Leise-Regeln im ersten Zug');
  check(/Schritt-1-Unterricht/.test(await text('.claude')) && !(await handy.$('#eingabe')), 'Unterricht steht da, kein Textfeld im Leise-Modus');
  check((await handy.$$('.seg i')).length === 2 && /\d+ \/ \d+ Min\./.test(await text('[data-uhr]')), 'Fortschritt: ein Segment je Schritt, Lektionsuhr');
  check(await mac.evaluate(async (k) => { const x = await window.lernhub.lernenStand(k); return !!(x && x.sitzung); }, KURS), 'Dieselbe Sitzung ist am Mac sichtbar');
  await bild('2-frage');
  await handy.click('[data-opt="1"]');
  await handy.waitForSelector('.sicher [data-sicher="sicher"]');
  check(/B gewählt/.test(await text('.frage-hilfe')), 'Antippen wählt, das Dock fragt „Wie sicher?“');
  await bild('3-sicher');
  await handy.click('[data-sicher="sicher"]');
  await handy.waitForSelector('.fkarte .opt.richtig', { timeout: 10000 });
  check(/Richtig/.test(await text('.fkarte .chip.ok')) && /ERKL-1/.test(await text('.fkarte')), 'Zweiter Tipp schickt ab: Richtig und Erklärung sofort');
  await warte(() => zuege().some((z) => /^Antwort auf Frage 1 /.test(z.ein)), { text: 'Zug 2' });
  const z2 = zuege().find((z) => /^Antwort auf Frage 1 /.test(z.ein)).ein;
  check(/RICHTIG/.test(z2) && /Sicherheit: sicher/.test(z2) && /\[Leise-Modus\]$/.test(z2.trim()) && !/Regeln bis auf Widerruf/.test(z2), 'Claude bekommt Wahl und Sicherheit, danach nur noch die Marke [Leise-Modus]');

  // freie Frage: aufdecken und selbst einschätzen
  await handy.waitForSelector('[data-a="aufdecken"]', { timeout: 20000 });
  check(!(await text('.inhalt')).includes('LSG-2'), 'Freie Frage: Lösung bleibt verborgen');
  await handy.click('[data-a="aufdecken"]');
  await handy.waitForSelector('[data-selbst="teils"]', { timeout: 10000 });
  check(/LSG-2/.test(await text('.loesung')) && /ERKL-2/.test(await text('.fkarte.offen')), 'Aufdecken zeigt Lösung und Erklärung, ohne zu schreiben');
  await bild('4-selbst');
  await handy.click('[data-selbst="teils"]');
  await warte(() => zuege().some((z) => /^Antwort auf Frage 2 /.test(z.ein)), { text: 'Zug 3' });
  check(/selbst eingeschätzt: TEILS/.test(zuege().find((z) => /^Antwort auf Frage 2 /.test(z.ein)).ein), 'Selbsteinschätzung geht an Claude (TEILS)');
  await handy.waitForSelector('.chip.warn', { timeout: 10000 });
  check(/Teils richtig/.test(await text('.fkarte .chip.warn')), 'Karte zeigt „Teils richtig“');
  const stand = await (await post('lernen:stand', { key: KURS })).json();
  check(stand.sitzung.stat.fragen === 2 && stand.sitzung.stat.punkte === 1.5, 'Score zählt die Selbsteinschätzung halb (1,5 von 2)');

  // Schnellknopf statt Rückfrage tippen
  await handy.waitForSelector('[data-rueck]', { timeout: 15000 });
  await handy.waitForFunction(() => !document.querySelector('.warten'));
  await handy.click('[data-rueck*="noch ein Beispiel"]');
  await handy.waitForFunction(() => /BEISPIEL-ANTWORT/.test(document.querySelector('.inhalt').textContent), null, { timeout: 15000 });
  check(true, 'Schnellknopf „Noch ein Beispiel“ geht als Rückfrage an Claude');
  await handy.click('[data-a="weiter"]');
  await handy.waitForSelector('[data-a="eintragen"]:not([disabled])', { timeout: 15000 });
  await bild('5-rueckschau');
  await handy.click('[data-a="eintragen"]');
  await handy.waitForSelector('.feier', { timeout: 60000 });
  check(rmLesen().lessons.find((l) => l.id === ID).done, `„Lektion abschließen“ am iPhone trägt ${ID} in der Roadmap ein`);
  check(/Geschafft/.test(await text('.feier')), 'Feier am iPhone nach dem Abschluss');
  await bild('6-feier');
  const sid = stand.sitzung.id;
  const xp = await warte(() => { try { const g = JSON.parse(fs.readFileSync(path.join(U.daten, 'spiel.json'), 'utf8')); return Object.keys(g.gebucht || {}).filter((k) => k.startsWith(sid + ':')).length; } catch { return 0; } }, { text: 'XP gebucht', timeout: 15000 }).catch(() => 0);
  check(xp >= 2, 'XP der Prüffragen bucht die Mac-App mit (spiel.json)');
  await handy.click('.feier [data-a="blatt-zu"]');

  // ---------------------------------------------------------------- Wiederholen im Leise-Modus
  await handy.click('[data-nav="start"]');
  await handy.waitForSelector(`[data-ueben="${KURS}"]`);
  await handy.click(`.kurswahl [data-ueben="${KURS}"]`);
  await handy.waitForSelector('[data-uopt]', { timeout: 30000 });
  const ustart = zuege().find((z) => /\[Uni-Übung\]/.test(z.ein));
  check(ustart && /Jede Aufgabe mit Auswahl/.test(ustart.ein), 'Runde am iPhone: Claude bekommt die Leise-Regeln fürs Wiederholen');
  check((await handy.$$('[data-uopt]')).length === 4 && !(await text('.inhalt')).includes('MUSTER-1'), 'Aufgabe mit vier Optionen, Musterlösung verborgen');
  const offen = await (await post('ueben:stand', { key: KURS })).json();
  check(offen.verlauf.find((v) => v.art === 'aufgabe').richtig === undefined, 'Die richtige Option verlässt den Mac nicht, solange die Aufgabe offen ist');
  await bild('7-aufgabe');
  await handy.click('[data-uopt="0"]');
  await handy.click('[data-a="uwahl"]');
  await handy.waitForSelector('.fkarte .opt.falsch', { timeout: 10000 });
  await handy.waitForFunction(() => /HINWEIS-R1/.test(document.querySelector('.inhalt').textContent), null, { timeout: 15000 });
  check(/FALSCH \(richtig wäre C\)/.test(zuege().find((z) => /^Gewählt \(Versuch 1\)/.test(z.ein)).ein), 'Falsche Wahl: sofort „Falsch“, Claude gibt einen Hinweis');
  await handy.click('[data-uopt="2"]');
  await handy.click('[data-a="uwahl"]');
  await handy.waitForFunction(() => /Mit Hinweisen gelöst/.test(document.querySelector('.inhalt').textContent), null, { timeout: 15000 });
  check(/MUSTER-1/.test(await text('.inhalt')) && /URTEIL/.test(await text('.inhalt')), 'Zweiter Versuch richtig: Abschluss mit Musterlösung');
  await bild('8-abschluss');
  check(await mac.evaluate(async (k) => { const s = await window.lernhub.uebenStand(k); return !!(s && s.verlauf.some((v) => v.art === 'wahl')); }, KURS), 'Die Wahl vom iPhone steht auch am Mac im Verlauf');

  // Leise-Modus aus: Textfeld da, Claude erfährt es
  await handy.click('.kopf .leise');
  await handy.waitForSelector('#eingabe');
  check(!(await handy.$('.kopf .leise.an')), 'Leise-Modus aus: Textfeld zum Schreiben und Diktieren');
  await handy.fill('#eingabe', 'Warum bindet der Schrägstrich?');
  await handy.click('.feld .senden');
  await warte(() => zuege().some((z) => /Warum bindet der Schrägstrich\?/.test(z.ein)), { text: 'Text gesendet' });
  check(/\[Leise-Modus aus/.test(zuege().find((z) => /Warum bindet der Schrägstrich\?/.test(z.ein)).ein), 'Claude erfährt, dass der Leise-Modus aus ist');
  await handy.waitForFunction(() => /PAUSE-ANTWORT/.test(document.querySelector('.inhalt').textContent), null, { timeout: 15000 });
  await bild('9-normal');

  // Nächste Aufgabe kommt mit Optionen, wird richtig gelöst
  await handy.click('[data-a="unaechste"], [data-ueben-wechsel]');
  await handy.waitForSelector('[data-uopt]', { timeout: 20000 });
  check(/AUFGABE-2/.test(await text('.fkarte.offen')), 'Nächste Aufgabe per Knopf');
  check(!fehler.length, 'keine Fehler in Konsole oder Hauptprozess' + (fehler.length ? ':\n  ' + fehler.join('\n  ') : ''));
} catch (e) {
  console.error(e);
  if (handy) {
    console.error('iPhone zeigt:', (await handy.$eval('#app', (el) => el.innerText).catch(() => '')).slice(0, 1500));
    if (BILDER) await handy.screenshot({ path: path.join(BILDER, 'handy-fehler.png') }).catch(() => { });
  }
  console.error('Letzte Züge:', zuege().slice(-3).map((z) => z.ein.slice(0, 300)));
  if (fehler.length) console.error('Fehler:\n' + fehler.join('\n'));
  process.exitCode = 1;
} finally {
  await app.close();
}
