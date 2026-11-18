// Mikrofon → WebM/Opus-Stücke (250 ms) → Hauptprozess → Deepgram. Dazu ein Pegel für die Anzeige.
let rec = null, strom = null, ctx = null, analyser = null, raf = 0;

export async function starten(beiPegel) {
  strom = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  rec = new MediaRecorder(strom, { mimeType: mime, audioBitsPerSecond: 32000 });
  rec.ondataavailable = async (e) => {
    if (!e.data || !e.data.size) return;
    const b = new Uint8Array(await e.data.arrayBuffer());
    window.lernhub.diktatTon(b);
  };
  try {
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(strom);
    analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
      beiPegel(Math.min(1, Math.sqrt(s / buf.length) * 4));
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch { }
  return rec;
}

// Aufnahme beginnen (erst nachdem der Hauptprozess den Deepgram-Strom geöffnet hat)
export function los() { if (rec && rec.state === 'inactive') rec.start(250); }

export function stoppen() {
  return new Promise((resolve) => {
    cancelAnimationFrame(raf);
    const ende = () => {
      if (strom) strom.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close().catch(() => { });
      rec = null; strom = null; ctx = null; analyser = null;
      resolve();
    };
    if (rec && rec.state !== 'inactive') { rec.onstop = () => setTimeout(ende, 50); rec.stop(); } else ende();
  });
}

export const laeuft = () => !!(rec && rec.state === 'recording');
