// Punktkugel für die Sprechstunde: Punkte gleichmäßig auf einer Kugel (Fibonacci), je Punkt Linien zu den nächsten
// Nachbarn, langsame Drehung. Die Stimme bewegt sie weich: Der Pegel (Tutor und du) wird über viele Bilder geglättet,
// damit nichts flackert, auch wenn GPT-Live gleichzeitig hört und spricht.
//   starten(canvas, { pegel: () => 0..1, zustand: () => 'laeuft' | 'verbindet' | 'pause' | 'sucht' | 'still' })
//   Läuft, bis das Canvas aus dem DOM verschwindet.
const N = 170, NACHBARN = 3;

function punkte() {
  const p = [], gold = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = gold * i;
    p.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, phase: Math.random() * Math.PI * 2, f: 0.6 + Math.random() * 0.8 });
  }
  return p;
}
function kanten(p) {
  const k = new Set();
  p.forEach((a, i) => {
    p.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2]).filter(([j]) => j !== i)
      .sort((u, v) => u[1] - v[1]).slice(0, NACHBARN).forEach(([j]) => k.add(i < j ? i + ':' + j : j + ':' + i));
  });
  return [...k].map((s) => s.split(':').map(Number));
}
const P0 = punkte(), K0 = kanten(P0);

function farbe() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--kugel').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(v) || [0, '4f6ef7'];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function starten(canvas, { pegel = () => 0, zustand = () => 'laeuft' } = {}) {
  const ctx = canvas.getContext('2d');
  const ruhig = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
  let e = 0, winkel = 0, t0 = performance.now(), letzte = t0, rgb = farbe(), grau = [150, 150, 150], mix = 0;
  const dunkel = matchMedia('(prefers-color-scheme: dark)');
  const neuFarbe = () => { rgb = farbe(); };
  dunkel.addEventListener('change', neuFarbe);

  function bild(jetzt) {
    if (!canvas.isConnected) { dunkel.removeEventListener('change', neuFarbe); return; }
    const dt = Math.min(64, jetzt - letzte) / 16.7; letzte = jetzt;
    const t = (jetzt - t0) / 1000;
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const z = zustand();
    // Pegel weich: schnell hoch, langsam runter
    const ziel = z === 'pause' || z === 'still' ? 0 : Math.min(1, pegel());
    e += (ziel - e) * (ziel > e ? 0.18 : 0.05) * dt;
    mix += ((z === 'pause' || z === 'still' ? 1 : 0) - mix) * 0.06 * dt;
    const warte = z === 'verbindet' ? 0.5 + 0.5 * Math.sin(t * 2.2) : 0;
    const tempo = ruhig ? 0 : (z === 'sucht' ? 0.010 : 0.0035) + e * 0.012;
    winkel += tempo * dt;

    const R = Math.min(w, h) * 0.38 * (1 + e * 0.07 + warte * 0.02);
    const cx = w / 2, cy = h / 2, kipp = 0.35, ck = Math.cos(kipp), sk = Math.sin(kipp), cw = Math.cos(winkel), sw = Math.sin(winkel);
    const c = rgb.map((v, i) => Math.round(v + (grau[i] - v) * mix));
    const proj = P0.map((p) => {
      const wobble = 1 + (ruhig ? 0 : e * 0.14 * Math.sin(t * 4 * p.f + p.phase) + 0.012 * Math.sin(t * 1.3 + p.phase));
      const x1 = p.x * cw - p.z * sw, z1 = p.x * sw + p.z * cw;
      const y2 = p.y * ck - z1 * sk, z2 = p.y * sk + z1 * ck;
      const tiefe = (z2 + 1) / 2;                                    // 0 hinten … 1 vorn
      return { x: cx + x1 * R * wobble, y: cy + y2 * R * wobble, d: tiefe };
    });
    ctx.lineWidth = 1;
    for (const [a, b] of K0) {
      const pa = proj[a], pb = proj[b], d = (pa.d + pb.d) / 2;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.05 + d * 0.16) * (1 + e * 0.8)})`;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    for (const p of proj) {
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.25 + p.d * 0.75})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.1 + p.d * 2.3 + e * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(bild);
  }
  requestAnimationFrame(bild);
}
