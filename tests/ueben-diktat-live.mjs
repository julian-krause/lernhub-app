// Diktieren in der Übungsansicht, live: gebaute App, Mikrofon aus tests/audio/diktat.wav, echtes Deepgram,
// Claude als Attrappe. Prüft das Diktieren direkt nach dem App-Start.
// Braucht den in Lernhub.app gespeicherten Deepgram-Schlüssel. Aufruf: LERNHUB_APP=build/Lernhub.app/Contents/MacOS/Electron node tests/ueben-diktat-live.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { bereiten, check, warte } from './umgebung.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const SCHLUESSEL = path.join(os.homedir(), 'Library/Application Support/Lernhub/deepgram.schluessel');
if (!fs.existsSync(SCHLUESSEL)) { console.log('Übersprungen: In Lernhub.app ist noch kein Deepgram-Schlüssel gespeichert.'); process.exit(0); }
if (!fs.existsSync(path.join(HIER, 'audio/diktat.wav'))) { console.log('Übersprungen: tests/audio/diktat.wav fehlt (eigene Sprachaufnahme, liegt nicht im Repo).'); process.exit(0); }
const U = bereiten();
fs.copyFileSync(SCHLUESSEL, path.join(U.daten, 'deepgram.schluessel'));
const env = { ...U.env, LERNHUB_FAKE_AUDIO: path.join(HIER, 'audio/diktat.wav') + '%noloop', LERNHUB_CLAUDE: path.join(HIER, 'ueben-attrappe.mjs') };
const exe = process.env.LERNHUB_APP || path.join(os.homedir(), 'Applications/Lernhub.app/Contents/MacOS/Electron');
const app = await electron.launch({ executablePath: exe, args: [], env });
const win = await app.firstWindow();
const fehler = [];
win.on('pageerror', (e) => fehler.push('Seite: ' + e.message));

try {
  await win.waitForSelector('.title', { timeout: 30000 });
  await win.click(`.side-item[data-nav="kurs:${U.slug}"]`);
  await win.click('#modus-wiederholen [data-ueben]');
  await win.waitForSelector('.ueb-dock .ueb-dock-kopf', { timeout: 20000 });
  await win.click('.ueb-dock [data-ueb="diktat"]');
  await warte(async () => (await win.$('.ueb-dock .mic.an')) !== null, { timeout: 20000, text: 'Deepgram verbunden' });
  check(true, 'Diktieren startet in der Übung („Hört zu“)');
  let zwischen = false;
  await warte(async () => {
    if (await win.$eval('#ueb-zwischen', (e) => e.textContent.trim().length > 0).catch(() => false)) zwischen = true;
    return (await win.$eval('#ueb-text', (e) => e.value.trim().length)) > 10;
  }, { timeout: 45000, schritt: 150, text: 'Text im Feld' });
  const txt = await win.$eval('#ueb-text', (e) => e.value);
  check(true, `Gesprochenes landet im Feld „Deine Gedanken“: „${txt.slice(0, 80)}…“`);
  check(zwischen, 'Zwischentext erscheint, während gesprochen wird');
  check(await win.$eval('.ueb-dock [data-ueb="senden"]', (b) => !b.disabled), '„Gedanken senden“ wird aktiv');
  await win.keyboard.press('Escape');
  await warte(async () => (await win.$('.ueb-dock .mic.an')) === null, { timeout: 10000, text: 'Diktat aus' });
  check(!(await win.$('.sheet')), 'Esc beendet zuerst das Diktieren, nicht die Aufgabe');
  check((await win.$eval('#ueb-text', (e) => e.value)).trim().length >= txt.trim().length, 'Text bleibt nach dem Beenden im Feld');
  check(fehler.length === 0, 'keine Fehler auf der Seite' + (fehler.length ? ': ' + fehler.join(' | ') : ''));
} catch (e) {
  check(false, 'Abbruch: ' + e.message);
  try { await win.screenshot({ path: path.join(U.T, 'fehler.png') }); console.log('Bildschirmfoto:', path.join(U.T, 'fehler.png')); } catch { }
} finally { await app.close(); }
