// Effekte fürs Spiel: Klänge (echte Aufnahmen, WebAudio), Konfetti auf einem eigenen <canvas>, hochzählende Zahlen.
// Alles leise und kurz. Unter „Bewegung reduzieren“ (prefers-reduced-motion) gibt es kein Konfetti und kein Hochzählen.
// Der AudioContext entsteht erst bei der ersten Eingabe (Autoplay-Regeln), dann werden die Klänge einmal geladen;
// jeder Aufruf steht in try/catch. Klänge: ui/klaenge/*.wav, Quellen und Bauplan in ui/klaenge/QUELLEN.md.
let ctx = null;
let tonErlaubt = () => true;
export function tonSchalter(fn) { tonErlaubt = fn; }
export const ruhig = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// Name → Lautstärke (0–1). Alle Dateien sind auf −1 dBFS normalisiert, die Mischung passiert hier.
const KLAENGE = { auswahl: 0.22, richtig: 0.42, serie: 0.42, falsch: 0.38, geschafft: 0.4, feier: 0.36 };
const puffer = {};
function laden() {
  for (const name of Object.keys(KLAENGE)) {
    fetch(`klaenge/${name}.wav`).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b))
      .then((p) => { puffer[name] = p; }).catch(() => { });
  }
}
function anlegen() {
  if (ctx) return;
  try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { ctx = new AC(); laden(); } } catch { ctx = null; }
}
window.addEventListener('pointerdown', anlegen, { capture: true });
window.addEventListener('keydown', anlegen, { capture: true });

function spielen(name) {
  if (!ctx || !tonErlaubt() || !puffer[name]) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const q = ctx.createBufferSource(), g = ctx.createGain();
    q.buffer = puffer[name]; g.gain.value = KLAENGE[name];
    q.connect(g); g.connect(ctx.destination);
    q.start(ctx.currentTime + 0.005);
  } catch { }
}
export const ton = {
  auswahl: () => spielen('auswahl'),     // Option angetippt: kurzer Bubble-Pop
  richtig: () => spielen('richtig'),     // Kalimba G4 → D5
  serie: () => spielen('serie'),         // ab 3 richtig in Folge: Kalimba G4 H4 D5 G5
  falsch: () => spielen('falsch'),       // Kalimba D4 → H3, gedämpft
  geschafft: () => spielen('geschafft'), // Quest, Tagesziel, Lektion: Kalimba-Kaskade über zwei Oktaven
  feier: () => spielen('feier'),         // Lektions-Feier: Harfen-Glissando
  klick: () => spielen('auswahl'),
};

// ---------------------------------------------------------------- Konfetti
const FARBEN = ['--gold', '--flamme', '--los', '--c1', '--c5', '--accent'];
let leinwand = null, teile = [], laeuft = false;
function farben() {
  const st = getComputedStyle(document.documentElement);
  return FARBEN.map((v) => st.getPropertyValue(v).trim() || '#f2a900');
}
// menge: Zahl der Schnipsel; x, y: Ursprung in Pixeln (Standard: oben Mitte, fällt über die ganze Breite)
export function konfetti({ menge = 120, x = null, y = null, streuung = 1 } = {}) {
  if (ruhig()) return;
  try {
    if (!leinwand) {
      leinwand = document.createElement('canvas');
      leinwand.className = 'konfetti';
      document.body.appendChild(leinwand);
    }
    const dpr = window.devicePixelRatio || 1;
    leinwand.width = innerWidth * dpr; leinwand.height = innerHeight * dpr;
    const f = farben();
    for (let i = 0; i < menge; i++) {
      const vonOben = x == null;
      const w = vonOben ? Math.PI / 2 + (Math.random() - 0.5) * 0.6 : -Math.PI / 2 + (Math.random() - 0.5) * 1.6 * streuung;
      const v = vonOben ? 2 + Math.random() * 4 : 5 + Math.random() * 7;
      teile.push({
        x: vonOben ? Math.random() * innerWidth : x, y: vonOben ? -10 - Math.random() * innerHeight * 0.3 : y,
        vx: Math.cos(w) * v + (vonOben ? (Math.random() - 0.5) * 2 : 0), vy: Math.sin(w) * v,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, b: 6 + Math.random() * 6, h: 4 + Math.random() * 4,
        farbe: f[i % f.length], leben: 0,
      });
    }
    if (!laeuft) { laeuft = true; requestAnimationFrame(schritt); }
  } catch { }
}
function schritt() {
  try {
    const g = leinwand.getContext('2d'), dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    teile = teile.filter((p) => p.y < innerHeight + 30 && p.leben < 300);
    for (const p of teile) {
      p.leben++; p.vy += 0.12; p.vx *= 0.99; p.vy *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.farbe;
      g.globalAlpha = Math.max(0, Math.min(1, (300 - p.leben) / 50));
      g.fillRect(-p.b / 2, -p.h / 2, p.b, p.h * Math.abs(Math.cos(p.r * 2)) + 1); g.restore();
    }
    if (teile.length) requestAnimationFrame(schritt);
    else { laeuft = false; g.clearRect(0, 0, innerWidth, innerHeight); }
  } catch { laeuft = false; teile = []; }
}
// kleiner Stoß aus einem Element heraus (z. B. dem Ergebnis-Chip)
export function stoss(el, menge = 36) {
  if (!el) return konfetti({ menge });
  const r = el.getBoundingClientRect();
  konfetti({ menge, x: r.left + r.width / 2, y: r.top + r.height / 2, streuung: 0.8 });
}

// ---------------------------------------------------------------- Zahl hochzählen
export function hochzaehlen(el, bis, { von = 0, ms = 900, vor = '', nach = '' } = {}) {
  if (!el) return;
  if (ruhig() || bis === von) { el.textContent = vor + bis + nach; return; }
  const t0 = performance.now();
  const lauf = (t) => {
    const a = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - a, 3);
    el.textContent = vor + Math.round(von + (bis - von) * e) + nach;
    if (a < 1 && el.isConnected) requestAnimationFrame(lauf);
  };
  requestAnimationFrame(lauf);
}
