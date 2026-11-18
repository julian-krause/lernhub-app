// Deepgram-Schlüssel: verschlüsselt mit Electron safeStorage (Schlüssel dafür liegt im macOS-Schlüsselbund).
// Der Klartext verlässt nie den Hauptprozess: nicht ins Log, nicht in die Oberfläche, nicht in Dateien.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const datei = () => path.join(app.getPath('userData'), 'deepgram.schluessel');

function verfuegbar() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function gesetzt() { return fs.existsSync(datei()); }

function setzen(wert) {
  const v = String(wert || '').trim();
  if (v.length < 20 || /\s/.test(v)) throw new Error('Das sieht nicht nach einem Deepgram-Schlüssel aus (zu kurz oder mit Leerzeichen).');
  if (!verfuegbar()) throw new Error('Verschlüsselung über den Schlüsselbund ist nicht verfügbar.');
  fs.mkdirSync(path.dirname(datei()), { recursive: true });
  fs.writeFileSync(datei(), safeStorage.encryptString(v), { mode: 0o600 });
}

function lesen() {
  if (!gesetzt()) return null;
  try { return safeStorage.decryptString(fs.readFileSync(datei())); } catch { return null; }
}

function loeschen() { try { fs.unlinkSync(datei()); } catch { } }

async function testen() {
  const k = lesen();
  if (!k) return { ok: false, text: 'Kein Schlüssel gespeichert.' };
  try {
    const r = await fetch('https://api.deepgram.com/v1/projects', { headers: { Authorization: `Token ${k}` } });
    if (r.ok) return { ok: true, text: 'Schlüssel funktioniert.' };
    if (r.status === 401 || r.status === 403) return { ok: false, text: `Deepgram lehnt den Schlüssel ab (${r.status}).` };
    return { ok: false, text: `Deepgram antwortet mit ${r.status}.` };
  } catch (e) {
    return { ok: false, text: 'Deepgram nicht erreichbar.' };
  }
}

module.exports = { verfuegbar, gesetzt, setzen, lesen, loeschen, testen };
