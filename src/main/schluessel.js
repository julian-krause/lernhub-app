// API-Schlüssel (Deepgram fürs Diktieren, OpenAI für die Sprechstunde): verschlüsselt mit Electron safeStorage
// (der Schlüssel dafür liegt im macOS-Schlüsselbund). Der Klartext verlässt nie den Hauptprozess: nicht ins Log,
// nicht in die Oberfläche, nicht in Dateien. Entschlüsselt wird einmal je App-Start (jeder Zugriff auf den
// Schlüsselbund kann nach einem Neubau einen macOS-Dialog auslösen).
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function verfuegbar() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function tresor({ dateiname, name, pruefen }) {
  const datei = () => path.join(app.getPath('userData'), dateiname);
  let klar = null;
  const gesetzt = () => fs.existsSync(datei());
  function setzen(wert) {
    const v = String(wert || '').trim();
    if (v.length < 20 || /\s/.test(v)) throw new Error(`Das sieht nicht nach einem ${name}-Schlüssel aus (zu kurz oder mit Leerzeichen).`);
    if (!verfuegbar()) throw new Error('Verschlüsselung über den Schlüsselbund ist nicht verfügbar.');
    fs.mkdirSync(path.dirname(datei()), { recursive: true });
    fs.writeFileSync(datei(), safeStorage.encryptString(v), { mode: 0o600 });
    klar = v;
  }
  function lesen() {
    if (!gesetzt()) { klar = null; return null; }
    if (klar) return klar;
    try { klar = safeStorage.decryptString(fs.readFileSync(datei())); } catch { klar = null; }
    return klar;
  }
  function loeschen() { klar = null; try { fs.unlinkSync(datei()); } catch { } }
  async function testen() {
    const k = lesen();
    if (!k) return { ok: false, text: 'Kein Schlüssel gespeichert.' };
    try {
      const r = await pruefen(k);
      if (r.ok) return { ok: true, text: 'Schlüssel funktioniert.' };
      if (r.status === 401 || r.status === 403) return { ok: false, text: `${name} lehnt den Schlüssel ab (${r.status}).` };
      return { ok: false, text: `${name} antwortet mit ${r.status}.` };
    } catch (e) {
      return { ok: false, text: `${name} nicht erreichbar.` };
    }
  }
  return { verfuegbar, gesetzt, setzen, lesen, loeschen, testen };
}

const deepgram = tresor({ dateiname: 'deepgram.schluessel', name: 'Deepgram',
  pruefen: (k) => fetch('https://api.deepgram.com/v1/projects', { headers: { Authorization: `Token ${k}` }, signal: AbortSignal.timeout(15000) }) });
const openai = tresor({ dateiname: 'openai.schluessel', name: 'OpenAI',
  pruefen: (k) => fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15000) }) });

module.exports = { ...deepgram, openai };
