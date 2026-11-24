// Bausteine: Claude schreibt einen Codeblock, dessen Sprache ein Bausteinname ist (```kette …```), und beschreibt
// darin nur den Inhalt. Gezeichnet wird hier, im Lernhub-Stil, hell und dunkel über die App-Farben. Von Claude kommt
// weder HTML noch Code, der ausgeführt wird: Jeder Typ hat einen kleinen Parser, Formeln (kurve) rechnet ein eigener
// Ausdrucks-Parser ohne eval. Passt ein Block nicht, gibt baustein() null zurück und md() zeigt ihn als schlichte
// Liste (rueckfall), nie als grauen Monospace-Kasten.
// Der Katalog für die Prompts steht in src/main/bausteine.js; Syntax dort und Parser hier gehören zusammen.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const zeilenVon = (t) => String(t || '').replace(/\r/g, '').split('\n').map((z) => z.replace(/\s+$/, '')).filter((z) => z.trim() !== '');
const zellen = (z) => z.split('|').map((x) => x.trim());
const FARBEN = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c0)'];
const zahlDE = (n, st = 3) => {
  if (!Number.isFinite(n)) return '–';
  const a = Math.abs(n), d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? Math.max(0, st - 1) : st;
  return n.toLocaleString('de-DE', { maximumFractionDigits: d });
};
// „1 500“, „1.500“, „0,2“, „12000“ → Zahl
function zahl(s) {
  let t = String(s).trim().replace(/\s+/g, '').replace(/[−–]/g, '-');
  if (/,/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

// ---------------------------------------------------------------- kette: Ursache → Folge
// Zeile = Glied „Name ↑ | gut: Notiz“ (↑/↓ optional, „gut:“/„schlecht:“ färbt die Notiz)
function kette(z, inl) {
  if (z.length < 2 || z.length > 8) return null;
  const glieder = z.map((zeile, i) => {
    const [kopf, ...rest] = zellen(zeile.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''));
    const m = kopf.match(/^(.*?)\s*([↑↓])\s*$/);
    const name = (m ? m[1] : kopf).trim(), pfeil = m ? m[2] : '';
    if (!name) return null;
    const notiz = rest.join(' · ');
    const n = notiz.match(/^(gut|schlecht)\b\s*:?\s*(.*)$/i);
    const ton = n ? n[1].toLowerCase() : '', wert = n ? (n[2] || n[1]) : notiz;
    return `<div class="bs-glied${i === 0 ? ' bs-start' : ''}" role="listitem"><span class="bs-n">${inl(name)}${pfeil ? `<i>${pfeil}</i>` : ''}</span>`
      + `${wert ? `<span class="bs-t${ton ? ' bs-' + ton : ''}">${inl(wert)}</span>` : ''}</div>`;
  });
  if (glieder.includes(null)) return null;
  return `<div class="bs bs-kette" role="list">${glieder.join('<span class="bs-pfeil" aria-hidden="true">→</span>')}</div>`;
}

// ---------------------------------------------------------------- zielkonflikt: Maßnahme, gewinnt, verliert
// Zeile ohne Zeichen = Maßnahme, „+ Ziel: Detail“ = gewinnt, „- Ziel: Detail“ = verliert
function zielkonflikt(z, inl) {
  const gruppen = [];
  for (const zeile of z) {
    const m = zeile.trim().match(/^([+\-−–])\s*(.+)$/);
    if (m) { const g = gruppen[gruppen.length - 1]; if (!g) return null; (m[1] === '+' ? g.plus : g.minus).push(m[2].trim()); }
    else gruppen.push({ mass: zeile.trim(), plus: [], minus: [] });
  }
  if (!gruppen.length || gruppen.length > 6 || gruppen.some((g) => !g.plus.length || !g.minus.length)) return null;
  const chip = (x, art) => {
    const i = x.indexOf(':');
    const inhalt = i > 0 ? `<b>${inl(x.slice(0, i).trim())}</b>${x.slice(i + 1).trim() ? ' · ' + inl(x.slice(i + 1).trim()) : ''}` : `<b>${inl(x)}</b>`;
    return `<span class="bs-chip bs-${art}"><i aria-hidden="true">${art === 'plus' ? '↑' : '↓'}</i><span>${inhalt}</span></span>`;
  };
  return `<div class="bs bs-zk" role="table"><div class="bs-zk-kopf" role="row"><span>Maßnahme</span><span>gewinnt</span><span>verliert</span></div>`
    + gruppen.map((g) => `<div class="bs-zk-zeile" role="row"><span class="bs-zk-mass">${inl(g.mass)}</span>`
      + `<span class="bs-chips">${g.plus.map((x) => chip(x, 'plus')).join('')}</span>`
      + `<span class="bs-chips">${g.minus.map((x) => chip(x, 'minus')).join('')}</span></div>`).join('') + '</div>';
}

// ---------------------------------------------------------------- vergleich: zwei bis vier Konzepte gegenüber
// Kopf „| A | B“ (oder „Merkmal | A | B“), dann je Zeile „Merkmal | Wert A | Wert B“
function vergleich(z, inl) {
  if (!z[0].includes('|') || z.length < 2 || z.length > 11) return null;
  const kopf = zellen(z[0].replace(/\|\s*$/, ''));
  const ecke = kopf[0], spalten = kopf.slice(1).filter(Boolean);
  if (spalten.length < 2 || spalten.length > 4) return null;
  const zeilen = [];
  for (const zeile of z.slice(1)) {
    if (/^[\s|:-]+$/.test(zeile)) continue;                          // Markdown-Trennzeile
    const c = zellen(zeile.replace(/^\|/, '').replace(/\|\s*$/, ''));
    if (c.length < 2 || c.length - 1 > spalten.length) return null;
    while (c.length - 1 < spalten.length) c.push('');
    zeilen.push(c);
  }
  if (!zeilen.length) return null;
  const n = spalten.length;
  return `<div class="bs bs-vgl" role="table" style="grid-template-columns:minmax(0,.8fr) repeat(${n},minmax(0,1fr))">`
    + `<div class="bs-vgl-h bs-vgl-l" role="columnheader">${inl(ecke)}</div>`
    + spalten.map((s, i) => `<div class="bs-vgl-h" role="columnheader" style="--bc:${FARBEN[i]}">${inl(s)}</div>`).join('')
    + zeilen.map((c) => `<div class="bs-vgl-l" role="rowheader">${inl(c[0])}</div>${c.slice(1).map((x) => `<div role="cell">${inl(x)}</div>`).join('')}`).join('')
    + '</div>';
}

// ---------------------------------------------------------------- ablauf: feste Reihenfolge
// „Schritt | Detail“, „* “ davor hebt den Schritt hervor
function ablauf(z, inl) {
  if (z.length < 2 || z.length > 8) return null;
  const li = z.map((zeile) => {
    let t = zeile.trim().replace(/^(?:\d+[.)]|[-•])\s+/, '');
    const akt = /^\*\s+/.test(t); if (akt) t = t.replace(/^\*\s+/, '');
    const [titel, ...rest] = zellen(t);
    if (!titel) return null;
    return `<li${akt ? ' class="bs-akt"' : ''}><b>${inl(titel)}</b>${rest.length ? `<span>${inl(rest.join(' · '))}</span>` : ''}</li>`;
  });
  if (li.includes(null)) return null;
  return `<ol class="bs bs-ablauf">${li.join('')}</ol>`;
}

// ---------------------------------------------------------------- baum: Ober- und Unterbegriffe
// erste Zeile Wurzel, „- Ast“, „  - Blatt“ (eingerückt); „*“ nach dem Strich markiert
function baum(z, inl) {
  const wurzel = z[0].trim().replace(/^[-*]\s+/, '');
  const aeste = [];
  for (const zeile of z.slice(1)) {
    const m = zeile.match(/^(\s*)[-*•]\s+(\*\s+)?(.+)$/);
    if (!m) return null;
    const tief = m[1].replace(/\t/g, '  ').length >= 2;
    const e = { text: m[3].trim(), mark: !!m[2] };
    if (!tief) aeste.push({ ...e, blaetter: [] });
    else { const a = aeste[aeste.length - 1]; if (!a) return null; a.blaetter.push(e); }
  }
  if (!wurzel || aeste.length < 2 || aeste.length > 5 || aeste.some((a) => a.blaetter.length > 6)) return null;
  return `<div class="bs bs-baum"><div class="bs-wurzel">${inl(wurzel)}</div><div class="bs-aeste" style="grid-template-columns:repeat(${aeste.length},minmax(0,1fr))">`
    + aeste.map((a, i) => `<div class="bs-ast" style="--bc:${FARBEN[i]}"><div class="bs-ast-k${a.mark ? ' bs-mark' : ''}">${inl(a.text)}</div>`
      + a.blaetter.map((b) => `<div class="bs-blatt${b.mark ? ' bs-mark' : ''}">${inl(b.text)}</div>`).join('') + '</div>').join('')
    + '</div></div>';
}

// ---------------------------------------------------------------- falle: typischer Denkfehler
// „Falle: …“, „Richtig: …“, optional „Regel: …“ (auch „Merke:“, „Warum:“)
const FALLE = { falle: ['Falle', 'f1'], richtig: ['Richtig', 'f2'], regel: ['Regel', 'f3'], merke: ['Merke', 'f3'], warum: ['Warum', 'f3'] };
function falle(z, inl) {
  const teile = [];
  for (const zeile of z) {
    const m = zeile.trim().match(/^(falle|richtig|regel|merke|warum)\s*:\s*(.*)$/i);
    if (m) teile.push({ art: m[1].toLowerCase(), text: m[2] });
    else if (teile.length) teile[teile.length - 1].text += ' ' + zeile.trim();
    else return null;
  }
  if (!teile.some((t) => t.art === 'falle') || !teile.some((t) => t.art === 'richtig') || teile.length > 5) return null;
  return `<div class="bs bs-falle">${teile.map((t) => `<div class="bs-${FALLE[t.art][1]}"><span class="bs-lbl">${FALLE[t.art][0]}</span><span>${inl(t.text.trim())}</span></div>`).join('')}</div>`;
}

// ---------------------------------------------------------------- spannung: drei Ziele, die sich behindern
// „A | B | C“, dann „A–B: Konflikt“ (– - — / als Trenner)
function spannung(z, inl) {
  const pole = zellen(z[0]).filter(Boolean);
  if (pole.length !== 3) return null;
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const kanten = [];
  for (const zeile of z.slice(1)) {
    const d = zeile.indexOf(':');
    if (d < 0) return null;
    const vor = zeile.slice(0, d).trim(), text = zeile.slice(d + 1).trim();
    let paar = null;
    for (let i = 0; i < 3 && !paar; i++) for (let j = 0; j < 3 && !paar; j++) {
      if (i !== j && new RegExp(`^${reEsc(pole[i])}\\s*[–—\\-/]\\s*${reEsc(pole[j])}$`, 'i').test(vor)) paar = [i, j];
    }
    if (!paar || !text) return null;
    kanten.push({ paar, text });
  }
  if (!kanten.length || kanten.length > 3) return null;
  const P = [[180, 30], [72, 178], [288, 178]];
  const linie = (a, b) => `<line x1="${P[a][0]}" y1="${P[a][1]}" x2="${P[b][0]}" y2="${P[b][1]}" stroke="var(--bad)" stroke-width="2" stroke-dasharray="5 4"/>`;
  const knoten = pole.map((p, i) => {
    const w = Math.min(150, 26 + p.length * 8);
    return `<rect x="${P[i][0] - w / 2}" y="${P[i][1] - 15}" width="${w}" height="30" rx="8" fill="${FARBEN[[0, 2, 1][i]]}"/>`
      + `<text x="${P[i][0]}" y="${P[i][1] + 5}" text-anchor="middle" class="bs-sp-pol">${esc(p.length > 17 ? p.slice(0, 16) + '…' : p)}</text>`;
  }).join('');
  const marken = kanten.map((k, n) => {
    const [a, b] = k.paar, x = (P[a][0] + P[b][0]) / 2, y = (P[a][1] + P[b][1]) / 2;
    return `<circle cx="${x}" cy="${y}" r="11" fill="var(--accent-soft)"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="bs-sp-nr">${n + 1}</text>`;
  }).join('');
  return `<div class="bs bs-spannung"><svg viewBox="0 0 360 200" role="img" aria-label="${esc(pole.join(', '))}">`
    + `${[[0, 1], [0, 2], [1, 2]].map(([a, b]) => linie(a, b)).join('')}${marken}${knoten}</svg>`
    + `<ol class="bs-legende">${kanten.map((k, n) => `<li><span class="bs-nr">${n + 1}</span><span><b>${inl(pole[k.paar[0]])} – ${inl(pole[k.paar[1]])}:</b> ${inl(k.text)}</span></li>`).join('')}</ol></div>`;
}

// ---------------------------------------------------------------- anteil: Anteile als Balken
// „Zeile | A 15 | B 35 | C 50“, danach optional freie Sätze als Notiz
function anteil(z, inl) {
  const zeilen = [], notiz = [], namen = [];
  for (const zeile of z) {
    if (!zeile.includes('|')) { if (!zeilen.length) return null; notiz.push(zeile.trim()); continue; }
    if (notiz.length) return null;
    const [label, ...segs] = zellen(zeile);
    const teile = segs.filter(Boolean).map((s) => { const m = s.match(/^(.*?)\s*(-?\d[\d.,\s]*)\s*%?$/); return m ? { name: m[1].trim(), wert: zahl(m[2]) } : null; });
    if (teile.length < 2 || teile.some((t) => !t || !Number.isFinite(t.wert) || t.wert < 0)) return null;
    const summe = teile.reduce((a, t) => a + t.wert, 0);
    if (!(summe > 0)) return null;
    for (const t of teile) if (!namen.includes(t.name)) namen.push(t.name);
    zeilen.push({ label, teile, summe });
  }
  if (!zeilen.length || zeilen.length > 6 || namen.length > 6) return null;
  const prozent = zeilen.every((r) => Math.abs(r.summe - 100) < 1.5);
  return `<div class="bs bs-anteil">${zeilen.map((r) => `<div class="bs-a-zeile"><span>${inl(r.label)}</span><div class="bs-a-balken">`
    + r.teile.map((t) => {
      const q = t.wert / r.summe, farbe = FARBEN[namen.indexOf(t.name)];
      const lbl = `${t.name ? t.name + ' ' : ''}${zahlDE(t.wert)}${prozent ? ' %' : ''}`;
      return `<div style="flex:${t.wert};background:${farbe}" title="${esc(lbl)}">${q >= 0.09 ? esc(lbl) : ''}</div>`;
    }).join('') + '</div></div>').join('')}`
    + (notiz.length ? `<p class="bs-a-notiz">${inl(notiz.join(' '))}</p>` : '') + '</div>';
}

// ---------------------------------------------------------------- kurve: Funktionsverläufe, maßstabsgetreu
// „x: Beschriftung | von bis bis“, „y: Beschriftung“, je Kurve „Name = Ausdruck“ (optional „| Minimum“/„| Maximum“)
const FUNKTIONEN = { sqrt: Math.sqrt, wurzel: Math.sqrt, ln: Math.log, log: Math.log10, exp: Math.exp, abs: Math.abs };
const KONSTANTEN = { e: Math.E, pi: Math.PI, 'π': Math.PI };
export function ausdruck(quelle) {
  const src = String(quelle).replace(/[·×]/g, '*').replace(/[−–]/g, '-').replace(/÷/g, '/').replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/√/g, ' sqrt ').replace(/(\d)\s+(?=\d)/g, '$1').replace(/(\d),(\d)/g, '$1.$2');
  if (src.length > 200) throw new Error('zu lang');
  const tok = src.match(/\d+(?:\.\d+)?|[A-Za-zπ]+|[-+*/^()]|\S/g) || [];
  let i = 0;
  const sieh = () => tok[i], nimm = () => tok[i++];
  const primaer = () => {
    const t = nimm();
    if (t === undefined) throw new Error('Ende');
    if (/^\d/.test(t)) { const v = Number(t); return () => v; }
    if (t === '(') { const e = summe(); if (nimm() !== ')') throw new Error(') fehlt'); return e; }
    if (t === 'x') return (x) => x;
    if (Object.hasOwn(KONSTANTEN, t)) { const v = KONSTANTEN[t]; return () => v; }
    if (Object.hasOwn(FUNKTIONEN, t)) { const f = FUNKTIONEN[t], a = potenz(); return (x) => f(a(x)); }
    throw new Error('unbekannt: ' + t);
  };
  const potenz = () => { const b = primaer(); if (sieh() === '^') { nimm(); const e = vorzeichen(); return (x) => b(x) ** e(x); } return b; };
  const vorzeichen = () => { if (sieh() === '-') { nimm(); const a = vorzeichen(); return (x) => -a(x); } if (sieh() === '+') { nimm(); return vorzeichen(); } return potenz(); };
  const produkt = () => {
    let a = vorzeichen();
    for (;;) {
      const t = sieh();
      if (t === '*' || t === '/') { nimm(); const b = vorzeichen(), l = a; a = t === '*' ? (x) => l(x) * b(x) : (x) => l(x) / b(x); }
      else if (t !== undefined && (t === '(' || /^[\dA-Za-zπ]/.test(t))) { const b = vorzeichen(), l = a; a = (x) => l(x) * b(x); }   // 2x, 3(x+1)
      else return a;
    }
  };
  const summe = () => {
    let a = produkt();
    while (sieh() === '+' || sieh() === '-') { const t = nimm(), b = produkt(), l = a; a = t === '+' ? (x) => l(x) + b(x) : (x) => l(x) - b(x); }
    return a;
  };
  const f = summe();
  if (i < tok.length) throw new Error('Rest: ' + tok.slice(i).join(' '));
  return f;
}
function schrittweite(spanne, ziel = 5) {
  const roh = spanne / ziel, p = 10 ** Math.floor(Math.log10(roh)), r = roh / p;
  return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * p;
}
let kurveNr = 0;
function kurve(z, inl) {
  let xl = '', yl = '', x0 = NaN, x1 = NaN;
  const reihen = [];
  for (const zeile of z) {
    const t = zeile.trim();
    let m;
    if ((m = t.match(/^x\s*:\s*(.*?)\s*\|\s*(.+?)\s*(?:bis|\.\.|…|–|—)\s*(.+)$/i))) { xl = m[1]; x0 = zahl(m[2]); x1 = zahl(m[3]); }
    else if ((m = t.match(/^y\s*:\s*(.*)$/i))) yl = m[1];
    else if ((m = t.match(/^([^=|]+?)\s*=\s*([^|]+?)\s*(?:\|\s*(.*))?$/))) {
      const mark = /minimum/i.test(m[3] || '') ? 'min' : /maximum/i.test(m[3] || '') ? 'max' : '';
      reihen.push({ name: m[1].trim(), f: ausdruck(m[2]), mark });
    } else return null;
  }
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0 || !reihen.length || reihen.length > 4) return null;
  const N = 160, xs = Array.from({ length: N + 1 }, (_, k) => x0 + (x1 - x0) * k / N);
  for (const r of reihen) r.ys = xs.map((x) => { const y = r.f(x); return Number.isFinite(y) ? y : NaN; });
  const alle = reihen.flatMap((r) => r.ys).filter(Number.isFinite).sort((a, b) => a - b);
  if (alle.length < N / 2) return null;
  const q = (p) => alle[Math.min(alle.length - 1, Math.floor(p * (alle.length - 1)))];
  let lo = Math.min(0, q(0.03)), hi = Math.max(0, q(0.97));
  if (hi - lo <= 0) { hi = lo + 1; }
  const ys = schrittweite(hi - lo); hi = Math.ceil(hi * 1.04 / ys) * ys; lo = Math.floor(lo / ys) * ys;
  const W = 560, H = 270, L = 58, R = 18, T = 26, B = 42;
  const sx = (x) => L + (x - x0) / (x1 - x0) * (W - L - R), sy = (y) => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);
  const id = 'bs-k' + (++kurveNr);
  let svg = `<defs><clipPath id="${id}"><rect x="${L}" y="${T - 2}" width="${W - L - R}" height="${H - T - B + 4}"/></clipPath></defs>`;
  for (let y = lo; y <= hi + ys / 2; y += ys) svg += `<line x1="${L}" x2="${W - R}" y1="${sy(y)}" y2="${sy(y)}" class="bs-k-gitter"/><text x="${L - 7}" y="${sy(y) + 4}" text-anchor="end">${zahlDE(y)}</text>`;
  const xst = schrittweite(x1 - x0, 6);
  for (let x = Math.ceil(x0 / xst) * xst; x <= x1 + 1e-9; x += xst) svg += `<text x="${sx(x)}" y="${H - B + 17}" text-anchor="middle">${zahlDE(x)}</text>`;
  svg += `<line x1="${L}" x2="${W - R}" y1="${sy(Math.max(lo, Math.min(hi, 0)))}" y2="${sy(Math.max(lo, Math.min(hi, 0)))}" class="bs-k-achse"/>`;
  if (xl) svg += `<text x="${W - R}" y="${H - 6}" text-anchor="end">${esc(xl)}</text>`;
  if (yl) svg += `<text x="4" y="${T - 12}" text-anchor="start">${esc(yl)}</text>`;
  const markiert = reihen.some((r) => r.mark);
  reihen.forEach((r, n) => {
    r.farbe = r.mark || (!markiert && n === reihen.length - 1 && reihen.length > 2) ? 'var(--fg)' : FARBEN[n];
    let d = '', auf = false;
    r.ys.forEach((y, k) => {
      if (!Number.isFinite(y)) { auf = false; return; }
      const yc = Math.max(lo - (hi - lo), Math.min(hi + (hi - lo), y));
      d += `${auf ? 'L' : 'M'}${sx(xs[k]).toFixed(1)} ${sy(yc).toFixed(1)}`; auf = true;
    });
    svg += `<path d="${d}" fill="none" stroke="${r.farbe}" stroke-width="${r.mark ? 2.6 : 2}" stroke-linejoin="round" stroke-linecap="round" clip-path="url(#${id})"/>`;
  });
  for (const r of reihen.filter((x) => x.mark)) {
    let best = -1;
    r.ys.forEach((y, k) => { if (Number.isFinite(y) && y >= lo && y <= hi && (best < 0 || (r.mark === 'min' ? y < r.ys[best] : y > r.ys[best]))) best = k; });
    if (best <= 0 || best >= N) continue;                               // Rand ist kein echtes Extremum
    // genauer als das Raster: Goldener Schnitt zwischen den Nachbarpunkten
    let a = xs[best - 1], b = xs[best + 1];
    const g = (x) => (r.mark === 'min' ? r.f(x) : -r.f(x)), k = (Math.sqrt(5) - 1) / 2;
    for (let n = 0; n < 40; n++) { const c = b - k * (b - a), d = a + k * (b - a); if (g(c) < g(d)) b = d; else a = c; }
    const xe = (a + b) / 2, ye = r.f(xe);
    const px = sx(xe), py = sy(Number.isFinite(ye) ? ye : r.ys[best]);
    const tx = Math.max(L + 70, Math.min(W - R - 70, px));
    svg += `<line x1="${px}" x2="${px}" y1="${py}" y2="${sy(Math.max(lo, 0))}" class="bs-k-mark"/><circle cx="${px}" cy="${py}" r="5" class="bs-k-punkt"/>`
      + `<text x="${tx}" y="${py - 11}" text-anchor="middle" class="bs-k-marktext">${r.mark === 'min' ? 'Minimum' : 'Maximum'} bei ${zahlDE(xe)}</text>`;
  }
  return `<figure class="bs bs-kurve"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(reihen.map((r) => r.name).join(', '))}">${svg}</svg>`
    + `<figcaption class="bs-k-leg">${reihen.map((r) => `<span><i style="background:${r.farbe}"></i>${inl(r.name)}</span>`).join('')}</figcaption></figure>`;
}

// ---------------------------------------------------------------- formel: Formel mit Legende und Rechenweg
// erste Zeile die Formel (Index mit _, Potenz mit ^), „Sym = Bedeutung | Wert“, „→ Rechenschritt“, „= Ergebnis | Wert“
function formelHtml(t, farbe) {
  const s = String(t).replace(/sqrt\s*/g, '√').replace(/\*/g, '·');
  return s.replace(/([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9]*)(_(\{[^}]*\}|[A-Za-z0-9]+))?|\^(\{[^}]*\}|[-A-Za-z0-9]+)|([^A-Za-zÄÖÜäöüß^]+)/g,
    (all, name, _u, sub, sup, rest) => {
      if (rest != null) return esc(rest);
      if (sup != null) return `<sup>${esc(sup.replace(/^\{|\}$/g, ''))}</sup>`;
      const key = name + (sub ? '_' + sub.replace(/^\{|\}$/g, '') : '');
      const html = `${name.length === 1 ? `<i>${esc(name)}</i>` : esc(name)}${sub ? `<sub>${esc(sub.replace(/^\{|\}$/g, ''))}</sub>` : ''}`;
      const f = farbe(key);
      return f ? `<span class="bs-var" style="color:${f}">${html}</span>` : html;
    });
}
function formel(z, inl) {
  const kopf = z[0].trim();
  const legende = [], weg = [];
  let ergebnis = null;
  for (const zeile of z.slice(1)) {
    const t = zeile.trim();
    let m;
    if ((m = t.match(/^(?:→|->)\s*(.+)$/))) weg.push(m[1]);
    else if ((m = t.match(/^=\s*(.+?)\s*(?:\|\s*(.+))?$/))) ergebnis = { label: m[1], wert: m[2] || '' };
    else if ((m = t.match(/^([^=|]{1,14}?)\s*=\s*([^|]+?)\s*(?:\|\s*(.+))?$/))) legende.push({ sym: m[1].trim(), was: m[2], wert: m[3] || '' });
    else return null;
  }
  if (!kopf || !legende.length || legende.length > 8 || weg.length > 6) return null;
  const syms = legende.map((l) => l.sym.replace(/[{}]/g, ''));
  const farbe = (key) => { const i = syms.indexOf(key); return i >= 0 ? FARBEN[i % 5] : ''; };
  return `<div class="bs bs-formel"><div class="bs-f-zeile">${formelHtml(kopf, farbe)}</div>`
    + `<div class="bs-f-leg">${legende.map((l) => `<span class="bs-f-s">${formelHtml(l.sym, farbe)}</span><span>${inl(l.was)}</span><span class="bs-f-w">${inl(l.wert)}</span>`).join('')}</div>`
    + (weg.length ? `<ol class="bs-f-weg">${weg.map((w) => `<li>${formelHtml(w, farbe)}</li>`).join('')}</ol>` : '')
    + (ergebnis ? `<div class="bs-f-erg"><span>${inl(ergebnis.label)}</span><b>${inl(ergebnis.wert)}</b></div>` : '') + '</div>';
}

// ---------------------------------------------------------------- rechnung: Rechenweg statt Leerzeichen-Spalten
// optional Kopf „| alt | neu“, dann „Bezeichnung | Rechnung | Rechnung“, Zeile ohne | = ganze Breite,
// „= Bezeichnung | Ergebnis“ hebt das Ergebnis hervor. Der Teil nach dem letzten „=“ einer Zelle wird fett.
function rechnung(z, inl) {
  let kopf = null;
  const zeilen = [];
  for (const zeile of z) {
    const t = zeile.trim();
    if (/^\|/.test(t) && !kopf && !zeilen.length) { kopf = zellen(t.replace(/^\|/, '').replace(/\|\s*$/, '')); continue; }
    if (/^[\s|:-]+$/.test(t)) continue;
    const erg = /^=\s*/.test(t);
    const c = zellen(t.replace(/^=\s*/, '').replace(/\|\s*$/, ''));
    zeilen.push(c.length === 1 ? { label: '', werte: c, erg } : { label: c[0], werte: c.slice(1), erg });
  }
  const n = kopf ? kopf.length : Math.max(...zeilen.map((r) => r.werte.length));
  if (!zeilen.length || zeilen.length > 14 || n < 1 || n > 6 || zeilen.some((r) => r.werte.length > n)) return null;
  const zelle = (x) => {
    const i = x.lastIndexOf(' = ');
    return i > 0 ? `${inl(x.slice(0, i))} = <b>${inl(x.slice(i + 3))}</b>` : inl(x);
  };
  const breit = n > 1 ? `style="grid-column:span ${n}"` : '';
  return `<div class="bs bs-rechnung" style="grid-template-columns:minmax(0,auto) repeat(${n},minmax(0,1fr))">`
    + (kopf ? `<span></span>${kopf.map((k, i) => `<span class="bs-r-kopf" style="--bc:${FARBEN[i]}">${inl(k)}</span>`).join('')}` : '')
    + zeilen.map((r) => {
      const cls = r.erg ? ' bs-r-erg' : '';
      const werte = r.werte.length === 1 && n > 1 ? `<span class="bs-r-w${cls}" ${breit}>${zelle(r.werte[0])}</span>`
        : r.werte.map((w) => `<span class="bs-r-w${cls}">${zelle(w)}</span>`).join('') + '<span></span>'.repeat(n - r.werte.length);
      return `<span class="bs-r-l${cls}">${inl(r.label)}</span>${werte}`;
    }).join('') + '</div>';
}

// ---------------------------------------------------------------- matrix: Vierfelder und andere Raster
// „y: Achse | Zeile 1 | Zeile 2“, „x: Achse | Spalte 1 | Spalte 2“, dann je Zeile die Felder „A | B“; „*“ markiert
function matrix(z, inl) {
  let x = null, y = null;
  const felder = [];
  for (const zeile of z) {
    const t = zeile.trim();
    let m;
    if ((m = t.match(/^([xy])\s*:\s*(.*)$/i))) { const c = zellen(m[2]); (m[1].toLowerCase() === 'x' ? (x = c) : (y = c)); }
    else felder.push(zellen(t).map((f) => ({ text: f.replace(/^\*\s*/, ''), mark: /^\*\s/.test(f) })));
  }
  if (!x || !y || x.length < 3 || y.length < 3) return null;
  const sp = x.slice(1), ze = y.slice(1);
  if (sp.length > 4 || ze.length > 4 || felder.length !== ze.length || felder.some((r) => r.length !== sp.length || r.some((f) => !f.text))) return null;
  const n = sp.length;
  return `<div class="bs bs-matrix"><div class="bs-m-x">${inl(x[0])} →</div><div class="bs-m-rumpf"><div class="bs-m-y">${inl(y[0])} →</div>`
    + `<div class="bs-m-gitter" style="grid-template-columns:minmax(0,.7fr) repeat(${n},minmax(0,1fr))"><span></span>`
    + sp.map((s) => `<span class="bs-m-kopf">${inl(s)}</span>`).join('')
    + felder.map((r, i) => `<span class="bs-m-kopf bs-m-zk">${inl(ze[i])}</span>`
      + r.map((f, j) => `<span class="bs-m-feld${f.mark ? ' bs-mark' : ''}" style="--bc:${FARBEN[(i * n + j) % 4]}">${inl(f.text)}</span>`).join('')).join('')
    + '</div></div></div>';
}

// ---------------------------------------------------------------- skala: Einordnung zwischen zwei Polen
// „links | rechts“, dann „Eintrag | Position 0–100“
function skala(z, inl) {
  const pole = zellen(z[0]);
  if (pole.length !== 2 || !pole[0] || !pole[1]) return null;
  const punkte = z.slice(1).map((zeile) => { const c = zellen(zeile); const p = zahl(c[1] || ''); return c.length === 2 && c[0] && p >= 0 && p <= 100 ? { text: c[0], p } : null; });
  if (punkte.length < 2 || punkte.length > 7 || punkte.includes(null)) return null;
  punkte.sort((a, b) => a.p - b.p);
  const pos = (p) => (p < 12 ? 'links' : p > 88 ? 'rechts' : 'mitte');
  return `<div class="bs bs-skala"><div class="bs-s-spur">`
    + punkte.map((t, i) => `<div class="bs-s-punkt bs-s-${i % 2 ? 'unten' : 'oben'} bs-s-${pos(t.p)}" style="left:${t.p}%"><i></i><span>${inl(t.text)}</span></div>`).join('')
    + `</div><div class="bs-s-pole"><span>${inl(pole[0])}</span><span>${inl(pole[1])}</span></div></div>`;
}

export const BAUSTEINE = { kette, zielkonflikt, vergleich, ablauf, baum, falle, spannung, anteil, kurve, formel, rechnung, matrix, skala };

// HTML des Bausteins; null = Block passt nicht (dann rueckfall), undefined = kein Bausteinname
export function baustein(typ, inhalt, inl = esc) {
  const f = BAUSTEINE[String(typ || '').toLowerCase()];
  if (!f) return undefined;
  const z = zeilenVon(inhalt);
  if (!z.length || z.length > 40) return null;
  try { return f(z, inl) || null; } catch { return null; }
}

// Ein Block, der nicht gelesen werden kann: als schlichte Liste in normaler Schrift
export function rueckfall(inhalt, inl = esc) {
  const z = zeilenVon(inhalt).map((x) => x.trim().replace(/^(?:[-+*•→]|\d+[.)])\s+/, '').replace(/\s*\|\s*/g, ' · ')).filter((x) => x && !/^[\s·:-]+$/.test(x));
  return z.length ? `<ul class="ueb-liste bs-rueck">${z.map((x) => `<li>${inl(x)}</li>`).join('')}</ul>` : '';
}
