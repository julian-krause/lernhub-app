// Brücke zu den Skripten der kurs-tutor-Skill. Lernhub rechnet nichts selbst:
//   lesen:     hub.py data (dieselben Zahlen wie Lernhub.html), luecken.py
//   schreiben: kurstutor://-Adressen an die Kurs-Tutor-App (open -g). Dort liegen Kalender-Freigabe und Log.
//              Nur im Testmodus (LERNHUB_DIREKT=1) ruft Lernhub `tutor.py url` selbst auf.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const P = require('./pfade');

function lauf(cmd, args, { timeout = 60000, input, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024, env: env || P.pyEnv() },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout; err.stderr = stderr;
          return reject(err);
        }
        resolve(stdout);
      });
    if (input != null) { child.stdin.end(input); }
  });
}

function skript(name) { return path.join(P.SCRIPTS, name); }

function schreibeAtomar(datei, text) {
  const tmp = datei + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, datei);
}

// Lädt iCloud gerade ausgelagerte Dateien nach, braucht hub.py länger: großzügige Frist.
async function hubDaten() {
  const args = [skript('hub.py'), 'data'];
  if (process.env.LERNHUB_SEMESTER) args.push(process.env.LERNHUB_SEMESTER);
  if (process.env.LERNHUB_TEST_HUB_LANGSAM) await new Promise((r) => setTimeout(r, +process.env.LERNHUB_TEST_HUB_LANGSAM));   // Test: iCloud lädt
  const out = await lauf(P.PYTHON, args, { timeout: 180000 });
  return JSON.parse(out);
}

// ---------------------------------------------------------------- iCloud
// macOS lagert bei „Mac-Speicher optimieren“ selten genutzte Dateien aus (nur in der Cloud). Wer sie liest,
// wartet, bis iCloud sie geladen hat – Datei für Datei. icloud.py holt sie vorab parallel zurück.
const ICLOUD = path.join(__dirname, 'icloud.py');

// beiStand({ gesamt, fertig, ende, fehler }) für jede Fortschrittszeile
function icloudLaden(args, beiStand, { timeout = 600000 } = {}) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const child = spawn(P.PYTHON, [ICLOUD, ...args], { env: P.pyEnv() });
    let rest = '', letzter = { gesamt: 0, fertig: 0 };
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (b) => {
      rest += b.toString();
      const zeilen = rest.split('\n'); rest = zeilen.pop();
      for (const z of zeilen) {
        try { letzter = { ...letzter, ...JSON.parse(z) }; } catch { continue; }
        if (beiStand) beiStand(letzter);
      }
    });
    child.on('error', () => { clearTimeout(timer); resolve(letzter); });
    child.on('close', () => { clearTimeout(timer); resolve(letzter); });
  });
}

// Schnelltest ohne Kindprozess: Eine ausgelagerte Datei belegt keine Blöcke auf der Platte. (Sehr kleine,
// komprimierte Dateien auch – die werden dann eben einmal unnötig gelesen.) stat lädt nichts nach.
function vielleichtAusgelagert(p) {
  try { const st = fs.statSync(p); return st.isFile() && st.size > 0 && st.blocks === 0; } catch { return false; }
}

// Vor dem synchronen Lesen im Hauptprozess: Dateien zurückholen, damit das Fenster nicht einfriert.
async function bereit(dateien, timeout = 120000) {
  const fehlen = dateien.filter(vielleichtAusgelagert);
  if (!fehlen.length) return { gesamt: 0 };
  return icloudLaden(['--dateien', ...fehlen], null, { timeout });
}

async function luecken(ws) {
  if (!P.unterRoot(ws)) throw new Error('Lernbereich liegt nicht im Studienordner');
  return (await lauf(P.PYTHON, [skript('luecken.py'), ws], { timeout: 20000 })).trim();
}

// ---------------------------------------------------------------- kurstutor://-Aktionen
let letzteAktion = 0;
const kuerzlich = new Map();                // gleiche Adresse nicht doppelt (Doppelklick)

async function kurstutor(url) {
  if (!/^kurstutor:\/\//.test(url)) throw new Error('Keine kurstutor-Adresse');
  const jetzt = Date.now();
  for (const [u, t] of kuerzlich) if (jetzt - t > 3000) kuerzlich.delete(u);
  if (kuerzlich.has(url)) return { doppelt: true };
  kuerzlich.set(url, jetzt);
  letzteAktion = jetzt;
  if (P.DIREKT) {
    const out = await lauf(P.PYTHON, [skript('tutor.py'), 'url', url], { timeout: 180000 });
    return { meldung: out.trim(), direkt: true };
  }
  await lauf('/usr/bin/open', ['-g', url], { timeout: 20000 });
  return { gesendet: true };
}

function aktionLaeuft() { return Date.now() - letzteAktion < 180000; }

// ---------------------------------------------------------------- Beobachten
// .lernhub-stand.js schreibt hub.py nach jedem Neubau (Abschluss, Abgleich) → Daten neu laden.
function beobachteSemester(sem, beiAenderung) {
  let timer = null, w = null;
  try {
    w = fs.watch(sem, (ev, name) => {
      if (!name || !/^(\.lernhub-stand\.js|Lernhub\.html)$/.test(String(name))) return;
      clearTimeout(timer); timer = setTimeout(beiAenderung, 500);
    });
  } catch (e) { /* ohne Beobachtung lädt die App beim Fokussieren neu */ }
  return () => { clearTimeout(timer); if (w) w.close(); };
}

// Das Log der Kurs-Tutor-App enthält die Meldung zu jeder Aktion („<Kurs> 0010 erledigt … · Kalender: …“).
function beobachteLog(beiZeile) {
  let pos = 0;
  try { pos = fs.statSync(P.LOG).size; } catch { pos = 0; }
  const lies = () => {
    let st; try { st = fs.statSync(P.LOG); } catch { return; }
    if (st.size < pos) pos = 0;
    if (st.size === pos) return;
    const fd = fs.openSync(P.LOG, 'r');
    const buf = Buffer.alloc(st.size - pos);
    fs.readSync(fd, buf, 0, buf.length, pos); fs.closeSync(fd);
    pos = st.size;
    buf.toString('utf8').split('\n').filter(Boolean).forEach((z) => {
      const m = z.match(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d (.*)$/);
      beiZeile(m ? m[1] : z);
    });
  };
  let w = null;
  try { w = fs.watch(path.dirname(P.LOG), (ev, name) => { if (String(name) === path.basename(P.LOG)) lies(); }); } catch { }
  const iv = setInterval(lies, 3000);
  return () => { clearInterval(iv); if (w) w.close(); };
}

module.exports = { lauf, skript, schreibeAtomar, hubDaten, luecken, kurstutor, aktionLaeuft, beobachteSemester, beobachteLog, icloudLaden, bereit, vielleichtAusgelagert };
