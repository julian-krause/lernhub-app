// Live-Transkription mit Deepgram fürs Diktieren (WebSocket, Deutsch). Ton kommt als WebM/Opus-Stücke aus der Oberfläche,
// der Schlüssel bleibt im Hauptprozess (Anmeldung per Subprotokoll „token“).
const MODELLE = ['nova-3', 'nova-2'];

function adresse(modell) {
  const q = new URLSearchParams({
    model: modell, language: 'de', punctuate: 'true', smart_format: 'true',
    interim_results: 'true', endpointing: '400', utterance_end_ms: '1500', vad_events: 'true',
  });
  return 'wss://api.deepgram.com/v1/listen?' + q.toString();
}

class DeepgramStrom {
  constructor({ schluessel, beiText, beiStatus }) {
    this.schluessel = schluessel;
    this.beiText = beiText;
    this.beiStatus = beiStatus;
    this.ws = null;
    this.warte = [];          // Ton, der vor dem Öffnen ankommt (z. B. WebM-Kopf)
    this.modellIdx = 0;
    this.ende = false;
    this.offen = false;
  }

  start() {
    const modell = MODELLE[this.modellIdx];
    this.beiStatus({ zustand: 'verbindet', modell });
    let ws;
    try {
      ws = new WebSocket(adresse(modell), ['token', this.schluessel]);
    } catch (e) {
      this.beiStatus({ zustand: 'fehler', text: 'Deepgram-Verbindung nicht möglich.' });
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.offen = true;
      this.beiStatus({ zustand: 'laeuft', modell });
      for (const b of this.warte) ws.send(b);
      this.warte = [];
      this.keep = setInterval(() => { try { if (this.offen) ws.send(JSON.stringify({ type: 'KeepAlive' })); } catch { } }, 8000);
    });
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
      if (m.type === 'Results') {
        const alt = m.channel && m.channel.alternatives && m.channel.alternatives[0];
        this.beiText({ final: !!m.is_final, text: alt ? (alt.transcript || '').trim() : '' });
      }
    });
    ws.addEventListener('close', (ev) => {
      clearInterval(this.keep);
      const warOffen = this.offen;
      this.offen = false;
      if (!warOffen && !this.ende && this.modellIdx < MODELLE.length - 1) {
        this.modellIdx++;            // nova-3 nicht verfügbar? einmal mit nova-2 versuchen
        return this.start();
      }
      if (!warOffen && !this.ende) {
        this.beiStatus({ zustand: 'fehler', text: 'Deepgram lehnt die Verbindung ab. Schlüssel in den Einstellungen prüfen.' });
      } else if (!this.ende && ev.code !== 1000) {
        this.beiStatus({ zustand: 'fehler', text: `Verbindung zu Deepgram abgebrochen (${ev.code}${ev.reason ? ': ' + ev.reason : ''}).` });
      } else {
        this.beiStatus({ zustand: 'aus' });
      }
      if (this.beimSchliessen) this.beimSchliessen();
    });
    ws.addEventListener('error', () => { /* close folgt */ });
  }

  senden(buf) {
    if (this.ende) return;
    if (this.offen) { try { this.ws.send(buf); } catch { } }
    else if (this.warte.length < 200) this.warte.push(buf);
  }

  // Beendet den Strom und wartet auf die letzten Ergebnisse (höchstens 6 s).
  stoppen() {
    return new Promise((resolve) => {
      this.ende = true;
      if (!this.ws || (!this.offen && this.ws.readyState !== 0)) return resolve();
      const t = setTimeout(() => { try { this.ws.close(); } catch { } resolve(); }, 6000);
      this.beimSchliessen = () => { clearTimeout(t); resolve(); };
      try {
        if (this.offen) this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        else this.ws.close();
      } catch { clearTimeout(t); resolve(); }
    });
  }
}

module.exports = { DeepgramStrom };
