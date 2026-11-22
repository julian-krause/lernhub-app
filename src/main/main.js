// Lernhub · Hauptprozess
//   Fenster mit Seitenleiste (app://ui/…), Brücke zu den kurs-tutor-Skripten, die beiden Lernmodi „Lernen“ und
//   „Wiederholen“ (Sitzungen über claude -p), der ILIAS-Sync (claude -p) und das Diktieren (Deepgram).
const { app, BrowserWindow, Menu, ipcMain, protocol, session, shell, systemPreferences, net, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');

if (process.env.LERNHUB_DATEN) app.setPath('userData', process.env.LERNHUB_DATEN);
if (process.env.LERNHUB_FAKE_AUDIO) {                  // Tests: Mikrofon aus einer WAV-Datei
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.LERNHUB_FAKE_AUDIO);
}

const P = require('./pfade');
const B = require('./bruecke');
const S = require('./schluessel');
const { DeepgramStrom } = require('./deepgram');
const { Ueben } = require('./ueben');
const { Lernen } = require('./lernen');
const { Sync } = require('./sync');

const UI = path.join(__dirname, '..', 'ui');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

let win = null;
let daten = null;                 // letzte hub.py-Daten
let stopSem = null;

const an = (kanal, wert) => { if (win && !win.isDestroyed()) win.webContents.send(kanal, wert); };

// ---------------------------------------------------------------- Daten
// hub.py kann dauern (iCloud lädt ausgelagerte Dateien nach). Damit das Fenster nie bei „Lade …“ hängt:
//   - immer nur ein hub.py-Lauf gleichzeitig, alle Anfragen warten auf denselben,
//   - der letzte gute Stand liegt in den App-Daten und wird sofort gezeigt, wenn hub.py länger als 5 s braucht,
//   - icloud.py holt ausgelagerte Dateien der Lernbereiche parallel zurück (beim Start, alle 15 Min.).
const cacheDatei = () => path.join(app.getPath('userData'), 'letzte-daten.json');
let holen = null;                 // laufender hub.py-Lauf
let nochmal = false;              // während des Laufs kam eine Anfrage: danach noch einmal rechnen
let startUm = 0, fertigUm = 0, geaendertUm = 0;   // letzter fertiger hub.py-Lauf: Beginn, Ende; letzte Änderung

// Änderung im Semester (Hub neu gebaut, Aktion der Kurs-Tutor-App): Oberfläche lädt neu
function geaendert() { geaendertUm = Date.now(); an('daten:geaendert'); }

function semesterBeobachten(d) {
  const sem = d.semester && d.semester.path;
  if (sem && (!stopSem || stopSem.sem !== sem)) {
    if (stopSem) stopSem();
    stopSem = B.beobachteSemester(sem, geaendert);
    stopSem.sem = sem;
  }
}

// Ein laufender hub.py-Lauf hat evtl. vor einer Änderung begonnen. Wer währenddessen fragt, bekommt sein
// Ergebnis, und danach rechnet hub.py einmal nach (meldet sich per daten:geaendert, falls nötig).
function datenHolen() {
  if (holen) { nochmal = true; return holen; }
  const start = Date.now();
  holen = B.hubDaten().then((d) => {
    daten = d; startUm = start; fertigUm = Date.now();
    semesterBeobachten(d);
    try { B.schreibeAtomar(cacheDatei(), JSON.stringify(d)); } catch { }
    return d;
  }).finally(() => {
    holen = null;
    if (nochmal) { nochmal = false; datenHolen().then(() => an('daten:geaendert'), () => { }); }
  });
  return holen;
}

function cacheLesen() {
  try { return JSON.parse(fs.readFileSync(cacheDatei(), 'utf8')); } catch { return null; }
}

async function datenLaden() {
  // gerade fertig geworden und seit seinem Beginn nichts geändert: kein neuer Lauf
  if (daten && fertigUm && startUm > geaendertUm && Date.now() - fertigUm < 2500) return daten;
  const p = datenHolen();
  if (!daten) daten = cacheLesen();
  if (!daten) return p;                                               // allererster Start: warten
  const r = await Promise.race([p, new Promise((ok) => setTimeout(ok, 5000, null))]);
  if (r) return r;
  if (!p.gemeldet) {                                                  // Neues kommt per daten:geaendert nach
    p.gemeldet = true;
    p.then(() => an('daten:geaendert'), (e) => an('meldung', { text: 'Daten nicht aktualisiert: ' + kurz(e), art: 'fehler' }));
  }
  return { ...daten, _alt: true };
}
const kurz = (e) => String((e && (e.stderr || e.message)) || e).trim().split('\n').pop().slice(0, 200);

// Semester für icloud.py: aus den Daten, sonst das höchste „N. Semester“ im Studienordner
function semesterPfad() {
  if (process.env.LERNHUB_SEMESTER) return process.env.LERNHUB_SEMESTER;
  if (daten && daten.semester && daten.semester.path) return daten.semester.path;
  try {
    const s = fs.readdirSync(P.ROOT).filter((n) => /^\d+\. Semester$/.test(P.nfc(n)))
      .sort((a, b) => parseInt(b, 10) - parseInt(a, 10))[0];
    return s ? path.join(P.ROOT, s) : null;
  } catch { return null; }
}

let icloud = { laeuft: false, um: 0 };
async function icloudVorrat() {
  const sem = semesterPfad();
  if (!sem || icloud.laeuft) return;
  icloud = { laeuft: true, um: Date.now() };
  const r = await B.icloudLaden([sem], (st) => { if (st.gesamt) an('icloud', { zustand: st.ende ? 'fertig' : 'laeuft', ...st }); });
  icloud = { laeuft: false, um: Date.now(), letzte: r };
  if (r.gesamt) { an('icloud', { zustand: 'fertig', ...r }); geaendert(); }
}

// ---------------------------------------------------------------- Adressen aus der Oberfläche
// Abgleich, Rückgängig, Ordner und Kalender gehen an die Kurs-Tutor-App (im Test direkt an tutor.py)
async function kurstutor(url) {
  try {
    const r = await B.kurstutor(url);
    if (r.meldung) an('meldung', { text: r.meldung, art: r.meldung.startsWith('⚠') ? 'fehler' : 'ok' });
    if (r.direkt) geaendert();
    return r;
  } catch (e) {
    an('meldung', { text: 'Aktion fehlgeschlagen: ' + (e.stderr || e.message).toString().slice(-300), art: 'fehler' });
    throw e;
  }
}

// Das Fenster navigiert nie selbst: jede Adresse wird hier zugestellt.
function leiteUm(url) {
  if (/^kurstutor:/i.test(url)) { kurstutor(url).catch(() => { }); return; }
  if (/^(claude-cli|https?|mailto|obsidian):/i.test(url)) { shell.openExternal(url); return; }
  if (!/^file:/i.test(url)) return;
  let p; try { p = fileURLToPath(url.split('#')[0].split('?')[0]); } catch { return; }
  if (/\/Lernbereich\/roadmap\.html$/.test(P.nfc(p))) { an('nav:roadmap', { ws: path.dirname(p) }); return; }
  if (P.unterRoot(p) || p.startsWith(P.HOME + '/Obsidian/')) shell.openPath(p);       // Material, Merkblätter: Standard-App
}

// ---------------------------------------------------------------- Diktieren (Deepgram)
// Im Feld von „Lernen“ und „Wiederholen“: Der Ton kommt aus der Oberfläche, der Text geht dorthin zurück.
let diktat = null;
async function mikrofonPruefen() {
  const key = S.lesen();
  if (!key) throw new Error('Kein Deepgram-Schlüssel. In den Einstellungen eintragen.');
  if (process.platform === 'darwin' && !process.env.LERNHUB_FAKE_AUDIO) {
    const st = systemPreferences.getMediaAccessStatus('microphone');
    if (st !== 'granted') {
      const ok = await systemPreferences.askForMediaAccess('microphone');
      if (!ok) throw new Error('Kein Zugriff aufs Mikrofon. Systemeinstellungen → Datenschutz → Mikrofon → Lernhub.');
    }
  }
  return key;
}
async function diktatStart() {
  const key = await mikrofonPruefen();
  if (diktat) await diktatStopp();
  diktat = new DeepgramStrom({
    schluessel: key,
    beiStatus: (x) => an('diktat:status', x),
    beiText: (r) => an('diktat:text', r),
  });
  diktat.start();
  return { ok: true };
}
async function diktatStopp() {
  const d = diktat; diktat = null;
  if (d) await d.stoppen();
  an('diktat:status', { zustand: 'aus' });
}

// ---------------------------------------------------------------- Wiederholen, Lernen, ILIAS-Sync (claude -p)
let ueb = null, lern = null, sync = null;
function modiBereit() {
  const ordner = (n) => path.join(app.getPath('userData'), n);
  // beiEnde: ueben.py hat Fälligkeiten geändert → Kursdaten neu laden
  ueb = new Ueben({ ordner: ordner('ueben'), beiStand: (s) => an('ueben', s), beiEnde: () => geaendert() });
  // beiErledigt: Lektion ist in der Roadmap eingetragen → Kursdaten neu laden
  lern = new Lernen({ ordner: ordner('lernen'), beiStand: (s) => an('lernen', s), beiErledigt: () => geaendert() });
  sync = new Sync({
    ordner: ordner('sync'),
    beiStand: (s) => an('sync', s),
    beiFertig: async (s) => {
      // neue Dateien: Roadmaps, Lernhub und Kalender nachziehen – über die Kurs-Tutor-App
      if (s.zustand === 'fertig') { try { await kurstutor('kurstutor://sync?quiet=1'); } catch { } }
      geaendert();
      if (s.zustand === 'abgebrochen' || !win || win.isFocused() || !Notification.isSupported()) return;
      const n = new Notification({ title: s.zustand === 'fertig' ? 'ILIAS-Sync fertig' : 'ILIAS-Sync abgebrochen', body: s.text.split('\n')[0].slice(0, 220), silent: false });
      n.on('click', () => { win.show(); win.focus(); });
      n.show();
    },
  });
}

const kurse = () => (daten ? daten.courses.filter((c) => c.hasRoadmap) : []);
const kursVon = (key) => kurse().find((c) => c.key === key);

// ---------------------------------------------------------------- IPC
function ipc() {
  const mitKurs = (fn, leer = { ok: false, text: 'Kurs nicht gefunden.' }) => (e, x) => {
    const c = kursVon(x && typeof x === 'object' ? x.key : x);
    return c ? fn(c, x) : leer;
  };
  ipcMain.handle('ueben:uebersicht', () => Object.fromEntries(kurse().map((c) => [c.key, ueb.fuer(c.ws)])));
  ipcMain.handle('ueben:stand', mitKurs((c) => ueb.fuer(c.ws), null));
  ipcMain.handle('ueben:starten', mitKurs((c) => ueb.starten(c, daten.semester.path)));
  ipcMain.handle('ueben:senden', mitKurs((c, x) => ueb.senden(c.ws, x.art, x.text)));
  ipcMain.handle('ueben:verwerfen', mitKurs((c) => ueb.verwerfen(c.ws)));
  ipcMain.handle('ueben:nochmal', mitKurs((c) => ueb.nochmal(c.ws)));
  ipcMain.handle('ueben:beenden', mitKurs((c) => ueb.beenden(c.ws)));

  const lernStand = (c) => ({ sitzung: lern.fuer(c.ws), ziel: lern.ziel(c) });
  ipcMain.handle('lernen:uebersicht', () => Object.fromEntries(kurse().map((c) => [c.key, lernStand(c)])));
  ipcMain.handle('lernen:stand', mitKurs(lernStand, null));
  ipcMain.handle('lernen:starten', mitKurs((c) => lern.starten(c, daten.semester.path)));
  ipcMain.handle('lernen:senden', mitKurs((c, x) => lern.senden(c.ws, x.art, x.x || {})));
  ipcMain.handle('lernen:nochmal', mitKurs((c) => lern.nochmal(c.ws)));
  ipcMain.handle('lernen:beenden', mitKurs((c) => lern.beenden(c.ws)));
  ipcMain.handle('lernen:eintragen', mitKurs((c) => lern.eintragen(c.ws)));

  ipcMain.handle('sync:stand', () => sync.stand());
  ipcMain.handle('sync:starten', () => {
    if (!daten) return { ok: false, text: 'Daten noch nicht geladen.' };
    return sync.starten({ sem: daten.semester.path, kategorie: (daten.sync && daten.sync.category) || '' });
  });
  ipcMain.handle('sync:abbrechen', () => sync.abbrechen());
  ipcMain.handle('sync:leeren', () => sync.leeren());

  ipcMain.handle('daten:laden', () => datenLaden());
  ipcMain.handle('kurs:luecken', (e, ws) => B.luecken(ws).catch((err) => '⚠️ ' + err.message));
  ipcMain.handle('aktion', (e, url) => { leiteUm(String(url)); return true; });
  ipcMain.handle('datei:oeffnen', (e, p) => { if (P.unterRoot(p)) shell.openPath(p); return true; });
  ipcMain.handle('info', () => ({
    version: app.getVersion(), skill: P.SKILL, ilias: P.ILIAS, root: P.ROOT, direkt: P.DIREKT, claude: !!P.CLAUDE,
    test: !!process.env.LERNHUB_TEST,
  }));
  // safeStorage nur auf Wunsch abfragen: jeder Zugriff auf den Schlüsselbund kann nach einem Neubau
  // (neue ad-hoc-Signatur) einen macOS-Dialog auslösen. Beim Start reicht „gibt es die Schlüsseldatei?“.
  ipcMain.handle('einstellungen', (e, mitSicher) => ({ schluessel: S.gesetzt(), sicher: mitSicher ? S.verfuegbar() : true }));
  ipcMain.handle('schluessel:setzen', async (e, wert) => {
    try { S.setzen(wert); return { ok: true, ...(await S.testen()) }; } catch (err) { return { ok: false, text: err.message }; }
  });
  ipcMain.handle('schluessel:testen', () => S.testen());
  ipcMain.handle('schluessel:loeschen', () => { S.loeschen(); return true; });

  ipcMain.on('diktat:ton', (e, buf) => { if (diktat) diktat.senden(Buffer.from(buf)); });
  ipcMain.handle('diktat:start', async () => {
    try { return await diktatStart(); } catch (err) { an('diktat:status', { zustand: 'fehler', text: err.message }); return { ok: false, text: err.message }; }
  });
  ipcMain.handle('diktat:stopp', () => diktatStopp());

  // Spielstand (XP, Serie, Quests, Abzeichen, Einstellungen des Spiels): spiel.json in den App-Daten
  const spielDatei = () => path.join(app.getPath('userData'), 'spiel.json');
  ipcMain.handle('spiel:laden', () => { try { return JSON.parse(fs.readFileSync(spielDatei(), 'utf8')); } catch { return null; } });
  ipcMain.handle('spiel:speichern', (e, stand) => {
    if (!stand || typeof stand !== 'object' || stand.v !== 1) return false;
    try { B.schreibeAtomar(spielDatei(), JSON.stringify(stand)); return true; } catch (err) { console.error('spiel.json:', err.message); return false; }
  });
  // Erinnerungen (Lernblock beginnt, Serie wird knapp): Mitteilung wie beim ILIAS-Sync
  ipcMain.handle('mitteilung', (e, x) => {
    if (process.env.LERNHUB_TEST || !x || !Notification.isSupported()) return false;
    const n = new Notification({ title: String(x.titel || 'Lernhub').slice(0, 80), body: String(x.text || '').slice(0, 220), silent: false });
    n.on('click', () => { if (win) { win.show(); win.focus(); if (x.nav) an('nav', x.nav); } });
    n.show();
    return true;
  });
}

// ---------------------------------------------------------------- Fenster
function fenster() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 980, minHeight: 620, show: false,
    title: 'Lernhub', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, spellcheck: false,
    },
  });
  win.loadURL('app://ui/index.html');
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => { an('fenster:fokus'); if (Date.now() - icloud.um > 15 * 60000) icloudVorrat(); });
  win.webContents.setWindowOpenHandler(({ url }) => { leiteUm(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); leiteUm(url); } });
}

// ---------------------------------------------------------------- Menü
function menue() {
  const sende = (k, w) => () => an(k, w);
  const kursMenue = Array.from({ length: 9 }, (_, i) => ({ label: `Kurs ${i + 1}`, accelerator: `CmdOrCtrl+${i + 1}`, click: sende('nav:kursNr', i), visible: false }));
  const vorlage = [
    { label: 'Lernhub', submenu: [
      { role: 'about', label: 'Über Lernhub' }, { type: 'separator' },
      { label: 'Einstellungen …', accelerator: 'CmdOrCtrl+,', click: sende('nav', { name: 'einstellungen' }) },
      { type: 'separator' }, { role: 'hide', label: 'Lernhub ausblenden' }, { role: 'hideOthers', label: 'Andere ausblenden' },
      { role: 'unhide', label: 'Alle einblenden' }, { type: 'separator' }, { role: 'quit', label: 'Lernhub beenden' }] },
    { label: 'Bearbeiten', submenu: [
      { role: 'undo', label: 'Widerrufen' }, { role: 'redo', label: 'Wiederholen' }, { type: 'separator' },
      { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einsetzen' },
      { role: 'selectAll', label: 'Alles auswählen' }] },
    { label: 'Lernen', submenu: [
      { label: 'Diese Woche', accelerator: 'CmdOrCtrl+0', click: sende('nav', { name: 'woche' }) },
      { label: 'Nächster Lerntag', accelerator: 'CmdOrCtrl+Shift+T', click: sende('nav', { name: 'lerntag' }) },
      { label: 'Suchen …', accelerator: 'CmdOrCtrl+K', click: sende('suche') },
      { type: 'separator' },
      { label: 'Lernen starten', accelerator: 'CmdOrCtrl+L', click: sende('befehl', 'lernen') },
      { label: 'Wiederholen starten', accelerator: 'CmdOrCtrl+Shift+W', click: sende('befehl', 'wiederholen') },
      { label: 'Diktieren an/aus', accelerator: 'CmdOrCtrl+Shift+L', click: sende('befehl', 'diktat') },
      { label: 'Fokus-Modus an/aus', accelerator: 'CmdOrCtrl+Shift+F', click: sende('befehl', 'fokus') },
      { label: 'Profil', click: sende('nav', { name: 'profil' }) },
      { type: 'separator' },
      { label: 'Plan & Kalender abgleichen', accelerator: 'CmdOrCtrl+Shift+S', click: () => kurstutor('kurstutor://sync').catch(() => { }) },
      { label: 'Lernkalender öffnen', click: () => kurstutor('kurstutor://kalender' + (daten && daten.agenda ? '?date=' + daten.agenda.date : '')).catch(() => { }) },
      { label: 'Daten neu laden', accelerator: 'CmdOrCtrl+R', click: () => geaendert() },
      ...kursMenue] },
    { label: 'Darstellung', submenu: [
      { role: 'resetZoom', label: 'Originalgröße' }, { role: 'zoomIn', label: 'Vergrößern' }, { role: 'zoomOut', label: 'Verkleinern' },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'Vollbild' },
      { label: 'Entwicklerwerkzeuge', accelerator: 'CmdOrCtrl+Alt+I', click: () => win && win.webContents.toggleDevTools() }] },
    { role: 'windowMenu', label: 'Fenster' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(vorlage));
}

// ---------------------------------------------------------------- Start
app.setName('Lernhub');
app.whenReady().then(async () => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const p = path.normalize(path.join(UI, decodeURIComponent(u.pathname)));
    if (u.hostname !== 'ui' || !p.startsWith(UI + path.sep)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(p).href);
  });

  // Mikrofon nur für die Oberfläche
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, det) => {
    cb(perm === 'media' && String(det.requestingUrl || '').startsWith('app://ui/'));
  });
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => perm === 'media' && String(origin).startsWith('app://ui'));

  modiBereit();
  ipc();
  menue();
  fenster();
  icloudVorrat();
  setInterval(() => { if (Date.now() - icloud.um > 15 * 60000) icloudVorrat(); }, 5 * 60000);

  B.beobachteLog((zeile) => {
    if (B.aktionLaeuft()) an('meldung', { text: zeile, art: zeile.startsWith('⚠') || /Fehler|nicht aktualisiert/.test(zeile) ? 'fehler' : 'ok' });
    geaendert();
  });

  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) fenster(); });
});

app.on('before-quit', () => {
  if (sync) sync.abbrechen();                 // schon geladene Dateien bleiben, der nächste Lauf macht weiter
  if (diktat) diktatStopp().catch(() => { });
});
app.on('window-all-closed', () => { app.quit(); });
