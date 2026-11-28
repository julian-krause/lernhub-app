// Lernhub fürs iPhone (docs/handy.md). Eine zweite Oberfläche für dieselben Sitzungen wie am Mac: Claude läuft dort
// (claude -p über das Abo), das iPhone spricht über src/main/handy.js mit der Mac-App.
//
// Besonderheit: der Leise-Modus. Unterwegs kann man nicht diktieren und tippt ungern. Dann
//   - stellt Claude nur Auswahlfragen (Lernen) und Aufgaben mit vier Optionen (Wiederholen),
//   - antwortest du mit zwei Tippern: Option, dann „Wie sicher?“ (schickt ab),
//   - ersetzen Schnellknöpfe das Tippen („Einfacher erklären“, „Noch ein Beispiel“, „Hinweis bitte“ …),
//   - deckst du eine freie Frage auf und schätzt dich selbst ein, statt zu schreiben,
//   - bleibt alles stumm.
// Ohne Leise-Modus gibt es dazu das Textfeld (Diktieren über die iOS-Tastatur) und Töne.
import { md } from '/js/md.js';
import { esc, ico, flamme, n_ } from '/js/util.js';
import * as R from '/js/regeln.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};
// Schlüssel: aus dem Link (?t=) und der zuletzt bestätigte (localStorage). Antwortet der Mac mit 401, kommt der
// nächste dran: So repariert sich eine Home-Bildschirm-App, die mit einem alten oder kaputten Link angelegt wurde.
const SCHLUESSEL = (() => { const k = []; try { k.push(new URLSearchParams(location.search).get('t'), localStorage.getItem('lh-token')); } catch { } return [...new Set(k.filter((x) => x && x.length >= 20))]; })();
let TOKEN = SCHLUESSEL[0] || '';
const gruendlich = (t) => { try { localStorage.setItem('lh-token', t); } catch { } };
const BUCHSTABE = (i) => String.fromCharCode(65 + i);
const PAUSE_MAX = 10 * 60000;

// ---------------------------------------------------------------- Zustand
const Z = {
  d: LS.get('lh-daten', null), kurse: [], byKey: {}, spiel: null, mac: null,
  lern: {},                 // Kursschlüssel → { sitzung, ziel } (aus dem Hauptprozess)
  ueb: {},                  // Kursschlüssel → Sitzung
  route: LS.get('lh-route', { name: 'start' }),
  leise: LS.get('lh-leise', true),
  ton: LS.get('lh-ton', true),
  netz: 'ok',               // ok | weg | schluessel
  wahl: {}, sicher: {}, entwurf: {}, feld: {},     // je Kurs: gewählte Option, Text, Textfeld offen
  lernLauf: LS.get('lh-lernlauf', false),          // von der Startseite: nach jeder Lektion die nächste über alle Kurse
  lauf: LS.get('lh-lauf', null),                   // Wiederholen über alle Kurse: { tag, n: { kurs: Aufgaben } }
  neu: new Set(),           // frisch aufgedeckte Karten (einmal animieren)
  blatt: null,              // offenes Blatt (Menü, Feier, Merkblatt)
  sendet: false,
};
if (Z.d) setDaten(Z.d);

function setDaten(d) {
  Z.d = d; Z.kurse = d.courses || []; Z.byKey = {};
  for (const c of Z.kurse) { Z.byKey[c.key] = c; c.byId = {}; for (const l of c.lessons || []) c.byId[l.id] = l; }
}
const kursVon = (key) => Z.byKey[key] || null;
const cc = (c) => `--cc:var(--c${c && c.color ? c.color : 0})`;
function navi(route) {
  const alt = Z.route;
  if (alt.name === 'lernen' && !(route.name === 'lernen' && route.key === alt.key)) uhr(alt.key, false);
  Z.route = route; LS.set('lh-route', route);
  Z.blatt = null;
  if (route.name === 'lernen') uhr(route.key, true);
  zeichnen(true);
}

// ---------------------------------------------------------------- Verbindung zum Mac
async function api(name, body = {}) {
  let r;
  const mit = TOKEN;
  try {
    r = await fetch('/api/' + name, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Lernhub-Token': mit }, body: JSON.stringify(body) });
  } catch (e) { netz('weg'); throw new Error('Mac nicht erreichbar.'); }
  if (r.status === 401) {
    if (mit !== TOKEN) return api(name, body);          // gleichzeitige Anfrage hat schon auf den nächsten gewechselt
    const i = SCHLUESSEL.indexOf(TOKEN);
    if (i >= 0 && i + 1 < SCHLUESSEL.length) { TOKEN = SCHLUESSEL[i + 1]; if (es) { es.close(); es = null; } ereignisse(); return api(name, body); }
    netz('schluessel'); throw new Error('Nicht freigegeben.');
  }
  if (!r.ok) throw new Error('Fehler ' + r.status);
  gruendlich(TOKEN);
  netz('ok');
  return r.json();
}
function netz(z) { if (Z.netz !== z) { Z.netz = z; zeichnen(); } }
// Aktion mit Rückmeldung: { ok: false, text } wird zur Meldung
async function tu(name, body, { still = false } = {}) {
  Z.sendet = true;
  try {
    const r = await api(name, body);
    if (r && r.ok === false && r.text && !still) toast(r.text, 'fehler');
    return r;
  } catch (e) { if (!still) toast(e.message, 'fehler'); return null; } finally { Z.sendet = false; }
}

let es = null, esFehler = 0;
function ereignisse() {
  if (!TOKEN || (es && es.readyState !== 2)) return;
  es = new EventSource('/api/ereignisse?t=' + encodeURIComponent(TOKEN));
  const json = (e) => { try { return JSON.parse(e.data); } catch { return null; } };
  es.addEventListener('hallo', () => { esFehler = 0; netz('ok'); });
  es.addEventListener('lernen', (e) => lernStand(json(e)));
  es.addEventListener('ueben', (e) => uebStand(json(e)));
  es.addEventListener('daten:geaendert', () => datenBald());
  es.addEventListener('meldung', (e) => { const m = json(e); if (m && m.text) toast(m.text, m.art === 'fehler' ? 'fehler' : ''); });
  es.onerror = () => {
    if (es.readyState !== 2) return;                    // verbindet sich selbst neu
    esFehler++; if (esFehler > 1) netz('weg');
    setTimeout(ereignisse, Math.min(15000, 2000 * esFehler));
  };
}

async function datenLaden() {
  const r = await api('daten');
  if (r && r.daten) { setDaten(r.daten); Z.mac = r.mac; LS.set('lh-daten', r.daten); }
}
async function sitzungenLaden() {
  const [l, u] = await Promise.all([api('lernen:uebersicht'), api('ueben:uebersicht')]);
  if (l) Z.lern = l;
  if (u) Z.ueb = Object.fromEntries(Object.entries(u).filter(([, s]) => s));
}
async function spielLaden() { Z.spiel = await api('spiel'); }
let tDaten = null, tSpiel = null;
function datenBald() { clearTimeout(tDaten); tDaten = setTimeout(async () => { try { await datenLaden(); await sitzungenLaden(); } catch { } zeichnen(); }, 700); }
function spielBald() { clearTimeout(tSpiel); tSpiel = setTimeout(() => spielLaden().then(() => zeichnen()).catch(() => { }), 1000); }

async function allesLaden() {
  try { await Promise.all([datenLaden(), sitzungenLaden(), spielLaden()]); } catch { }
  zeichnen(true);
}

// ---------------------------------------------------------------- Töne (nur ohne Leise-Modus)
const KLANG = {};
let tonFrei = false;
function tonFreigeben() {           // iOS: Audio nur nach einer Berührung; danach darf es auch ohne
  if (tonFrei) return; tonFrei = true;
  for (const n of ['richtig', 'falsch', 'geschafft', 'auswahl']) { const a = new Audio('/klaenge/' + n + '.wav'); a.preload = 'auto'; a.volume = 0.7; KLANG[n] = a; }
}
function ton(n) {
  if (Z.leise || !Z.ton || !KLANG[n]) return;
  try { const a = KLANG[n]; a.currentTime = 0; a.play().catch(() => { }); } catch { }
}

// ---------------------------------------------------------------- Spielstand (gebucht wird am Mac)
function spielStand() {
  const G = Z.spiel || {};
  const tage = G.tage || {}, heute = R.tagVon();
  let lekXp = 0, heuteXp = (tage[heute] && tage[heute].xp) || 0;
  for (const c of Z.kurse) for (const l of c.lessons || []) if (l.done) { const x = R.xpLektion(l.score); lekXp += x; if (String(l.done).slice(0, 10) === heute) heuteXp += x; }
  const lv = R.levelVon(lekXp + Object.values(tage).reduce((a, t) => a + (t.xp || 0), 0));
  const serie = R.wochenserie(R.lerntage({ kurse: Z.kurse, tage }), heute, G.lerntageZiel || 3, (Z.d && Z.d.semester && Z.d.semester.breaks) || []);
  return { lv, serie, heuteXp, ziel: G.tagesziel || 200 };
}
const gebucht = (sid, art, nr) => (Z.spiel && Z.spiel.gebucht && Z.spiel.gebucht[`${sid}:${art}${nr}`]) || null;
const xpChip = (b) => (b ? `<span class="chip xp">${ico(b.glueck ? 'sparkles' : 'star')}+${b.xp} XP</span>` : '');

// ---------------------------------------------------------------- Lernen: was ist dran?
const aktivL = (c) => { const e = Z.lern[c.key]; const s = e && e.sitzung; return s && s.zustand !== 'erledigt' && s.zustand !== 'beendet' ? s : null; };
function lernDran(c) {
  const s = aktivL(c), z = (Z.lern[c.key] || {}).ziel || {};
  if (s) return { id: s.lektion.id, title: s.lektion.title, budget: s.budget, sitzung: s };
  return z.id ? { ...z, sitzung: null } : null;
}
// wie reihenfolge() in src/ui/js/lernen.js: erst, woran du sitzt; dann größtes offenes Wochenpensum; dann Vorlernen
function lernReihenfolge() {
  return Z.kurse.map((c, i) => {
    const d = lernDran(c); if (!d) return null;
    const e = Z.lern[c.key] || {}, s = e.sitzung, eingetragen = s && s.zustand === 'erledigt' && !(c.byId[s.lektion.id] || {}).done;
    const rest = Math.max(0, (c.quota || 0) - (c.doneThis || 0) - (eingetragen ? 1 : 0));
    return { c, d, rang: d.sitzung ? 0 : rest > 0 ? 2 : 3, rest, i };
  }).filter(Boolean).sort((a, b) => a.rang - b.rang || b.rest - a.rest || (b.c.alarm ? 1 : 0) - (a.c.alarm ? 1 : 0) || a.i - b.i);
}
const warum = (x) => (x.rang === 0 ? 'Du bist dort mittendrin.' : x.rang === 2 ? `Diese Woche ${x.rest === 1 ? 'ist' : 'sind'} dort noch ${n_(x.rest, 'Lektion', 'Lektionen')} offen.` : 'Zum Vorlernen, das Wochenpensum ist geschafft.');

function lektionMs(s, bis = Date.now()) {          // wie in src/main/lernen.js
  const ende = s.ende || bis;
  const zeiten = [s.start, ...s.verlauf.map((v) => v.t).filter(Boolean)];
  if (!s.ende) zeiten.push(bis);
  const weg = [...(s.weg || []), ...(s.wegSeit ? [[s.wegSeit, ende]] : [])];
  let ms = 0;
  for (let i = 1; i < zeiten.length; i++) {
    const a = zeiten[i - 1], b = zeiten[i];
    let d = Math.max(0, b - a);
    for (const [x, y] of weg) d -= Math.max(0, Math.min(b, y) - Math.max(a, x));
    ms += Math.min(PAUSE_MAX, Math.max(0, d));
  }
  return Math.max(0, ms + (s.korrekturMs || 0));
}
const minuten = (s) => (s.ergebnis ? s.ergebnis.min : Math.max(0, Math.round(lektionMs(s) / 60000)));
const offeneFrage = (s) => (s ? [...s.verlauf].reverse().find((v) => v.art === 'frage' && v.offen && !v.beantwortet) || null : null);
function combo(s) {
  let n = 0;
  for (const q of s.verlauf) { if (q.art !== 'frage' || q.rolle !== 'pruefung' || !q.aufgedeckt || q.ersetzt) continue; n = (q.urteil || (q.korrekt ? 'richtig' : 'falsch')) === 'richtig' ? n + 1 : 0; }
  return n;
}

// ---------------------------------------------------------------- Wiederholen: welcher Kurs?
function laufHeute() {
  const tag = R.tagVon();
  if (!Z.lauf || Z.lauf.tag !== tag) { Z.lauf = { tag, n: {} }; LS.set('lh-lauf', Z.lauf); }
  return Z.lauf;
}
const schon = (c) => Math.max(laufHeute().n[c.key] || 0, (c.practice || {}).heute || 0);
function bedarf(c) {               // wie bedarf() in src/ui/js/ueben.js
  const p = c.practice || {}, rest = Math.max(0, (p.faellig || 0) - schon(c));
  const tage = c.exam ? (Date.parse(c.exam) - Date.now()) / 864e5 : null;
  return 1 + rest + 3 * (p.luecken || 0) + Math.max(0, (c.targetPercent || 80) - (c.avgScore == null ? 80 : c.avgScore)) / 10
    + (tage != null && tage >= 0 && tage <= 28 ? (28 - tage) / 4 : 0);
}
const uebbar = (c) => (c.done || 0) > 0 && ((c.practice || {}).themen || 0) > 0;
function uebReihenfolge() {
  return Z.kurse.filter(uebbar).map((c) => ({ c, rang: bedarf(c) / (1 + schon(c)) })).sort((a, b) => (Z.ueb[b.c.key] ? 1 : 0) - (Z.ueb[a.c.key] ? 1 : 0) || b.rang - a.rang).map((x) => x.c);
}
const SERIE = 3;                   // Aufgaben je Kurs, dann schlägt Lernhub den Kurs mit dem höchsten Bedarf vor
function kursWechsel(c) {
  if ((laufHeute().n[c.key] || 0) % SERIE !== 0 || !(laufHeute().n[c.key] || 0)) return null;
  const n = Z.kurse.filter((x) => uebbar(x) && x.key !== c.key).map((x) => ({ x, r: bedarf(x) / (1 + schon(x)) })).sort((a, b) => b.r - a.r)[0];
  return n && n.r > bedarf(c) / (1 + schon(c)) ? n.x : null;
}

// ---------------------------------------------------------------- Ereignisse der Sitzungen
function lernStand(s) {
  if (!s || s.vorab) return;
  const e = Z.lern[s.kurs] || (Z.lern[s.kurs] = { sitzung: null, ziel: {} });
  const vorher = e.sitzung && e.sitzung.id === s.id ? e.sitzung : null;
  if (s.hinten) {                                   // Unendlich-Modus vom Mac: trägt sich im Hintergrund ein
    if (vorher) e.sitzung = { ...s, zustand: s.zustand === 'erledigt' ? 'erledigt' : 'traegtEin', ergebnis: s.ergebnis || { min: s.min, score: s.score } };
    zeichnen(); return;
  }
  if (s.zustand === 'beendet') { if (e.sitzung && e.sitzung.id === s.id) e.sitzung = null; }
  else e.sitzung = s;
  // frisch aufgedeckte Fragen: Ton und kurze Bewegung
  for (const q of s.verlauf) {
    if (q.art !== 'frage' || !q.aufgedeckt || q.ersetzt) continue;
    const alt = vorher && vorher.verlauf.find((v) => v.art === 'frage' && v.nr === q.nr);
    if (vorher && alt && !alt.aufgedeckt) {
      Z.neu.add(`${s.id}:f${q.nr}`);
      if (q.rolle !== 'vorhersage') ton(q.korrekt || q.urteil === 'richtig' ? 'richtig' : 'falsch');
    }
  }
  if (vorher && vorher.zustand !== 'erledigt' && s.zustand === 'erledigt') {
    ton('geschafft');
    api('lernen:uebersicht').then((l) => { if (l) { Z.lern = l; Z.lern[s.kurs] = { ...(l[s.kurs] || {}), sitzung: s }; } zeichnen(); }).catch(() => { });
    if (Z.route.name === 'lernen' && Z.route.key === s.kurs) Z.blatt = { art: 'feier', key: s.kurs };
  }
  if (s.verlauf.some((q) => q.aufgedeckt) || s.zustand === 'erledigt') spielBald();
  zeichnen();
}
function uebStand(s) {
  if (!s) return;
  const vorher = Z.ueb[s.kurs] && Z.ueb[s.kurs].id === s.id ? Z.ueb[s.kurs] : null;
  if (s.zustand === 'beendet') delete Z.ueb[s.kurs]; else Z.ueb[s.kurs] = s;
  if (vorher) {
    const alt = new Set(vorher.verlauf.filter((v) => v.art === 'abschluss').map((v) => v.nr));
    for (const e of s.verlauf) {
      if (e.art !== 'abschluss' || alt.has(e.nr)) continue;
      Z.neu.add(`${s.id}:a${e.nr}`);
      if (e.ergebnis !== 'verworfen') { const l = laufHeute(); l.n[s.kurs] = (l.n[s.kurs] || 0) + 1; LS.set('lh-lauf', l); }
      if (e.ergebnis === 'geloest' || e.ergebnis === 'hinweise') ton('richtig'); else if (e.ergebnis !== 'verworfen') ton('falsch');
    }
    spielBald();
  }
  zeichnen();
}

// ---------------------------------------------------------------- Aktionen: Lernen
async function lernenLos(c, { lauf = false } = {}) {
  Z.lernLauf = lauf; LS.set('lh-lernlauf', lauf);
  navi({ name: 'lernen', key: c.key });
  const s = aktivL(c);
  if (s && !s.unendlich) return;
  const r = await tu('lernen:starten', { key: c.key, leise: Z.leise });
  if (r && r.ok === false) navi({ name: 'start' });
  else uhr(c.key, true);
}
function lernenSenden(c, art, x = {}) {
  const s = aktivL(c);
  if (!s || s.zustand === 'denkt' || Z.sendet) return;
  delete Z.wahl[c.key]; delete Z.sicher[c.key];
  Z.entwurf[c.key] = ''; Z.feld[c.key] = false;
  // sofort zeigen, dass es losgeht (der Mac meldet gleich den neuen Stand)
  s.zustand = 'denkt'; s.seit = Date.now(); zeichnen();
  return tu('lernen:senden', { key: c.key, art, x, leise: Z.leise }).then((r) => { if (!r || r.ok === false) api('lernen:stand', { key: c.key }).then((x2) => { if (x2) Z.lern[c.key] = x2; zeichnen(); }).catch(() => { }); });
}
function uhr(key, offen) { if (key && Z.byKey[key] && aktivL(Z.byKey[key])) api('lernen:uhr', { key, offen }).catch(() => { }); }
function naechsteLektion(c) {
  if (Z.lernLauf) { const n = lernReihenfolge().find((x) => !(x.c.key === c.key && x.d.sitzung && x.d.sitzung.zustand === 'erledigt')); return n ? n.c : null; }
  return lernDran(c) ? c : null;
}

// ---------------------------------------------------------------- Aktionen: Wiederholen
async function uebenLos(c) {
  navi({ name: 'ueben', key: c.key });
  if (Z.ueb[c.key]) return;
  const r = await tu('ueben:starten', { key: c.key, leise: Z.leise });
  if (r && r.ok === false) navi({ name: 'start' });
}
function uebenSenden(c, art, text = '', extra = {}) {
  const s = Z.ueb[c.key];
  if (!s || s.zustand === 'denkt' || Z.sendet) return;
  Z.entwurf[c.key] = ''; Z.feld[c.key] = false; delete Z.wahl[c.key];
  s.zustand = 'denkt'; s.seit = Date.now(); zeichnen();
  return tu('ueben:senden', { key: c.key, art, text, leise: Z.leise, ...extra }).then((r) => {
    if (r && r.korrekt != null) ton(r.korrekt ? 'richtig' : 'falsch');
    if (!r || r.ok === false) api('ueben:stand', { key: c.key }).then((x) => { if (x) Z.ueb[c.key] = x; zeichnen(); }).catch(() => { });
  });
}
const offeneAufgabe = (s) => (s ? [...s.verlauf].reverse().find((v) => v.art === 'aufgabe' && v.offen) || null : null);

// ---------------------------------------------------------------- Zeichnen
let gezeichnet = { route: '', kopf: '', banner: '', inhalt: '', dock: '', blatt: '', n: -1 };
function zeichnen(neu = false) {
  const r = Z.route, c = r.key ? kursVon(r.key) : null;
  let teile;
  if (!TOKEN || Z.netz === 'schluessel') teile = ohneSchluessel();
  else if (!Z.d) teile = Z.netz === 'weg' ? ohneMac() : { kopf: '', inhalt: '<div class="laden"><div class="punkte"><i></i><i></i><i></i></div></div>', dock: '' };
  else if (r.name === 'lernen' && c) teile = lernenSeite(c);
  else if (r.name === 'ueben' && c) teile = uebenSeite(c);
  else if (r.name === 'einstellungen') teile = einstellungenSeite();
  else teile = startSeite();
  const banner = Z.netz === 'weg' && Z.d ? `<div class="banner">${ico('alert')}<span>Mac nicht erreichbar. Lernhub am Mac offen und Tailscale an?</span></div>` : '';
  const routeKey = JSON.stringify(r);
  if (neu || gezeichnet.route !== routeKey || !$('.inhalt')) {
    const blatt = blattHtml();
    app.innerHTML = `<header class="kopf">${teile.kopf || ''}</header><div id="ober">${teile.ober || ''}</div><div id="banner">${banner}</div><main class="inhalt">${teile.inhalt}</main><footer class="dock">${teile.dock || ''}</footer><div id="blatt">${blatt}</div>`;
    gezeichnet = { route: routeKey, kopf: teile.kopf, ober: teile.ober, banner, inhalt: teile.inhalt, dock: teile.dock, blatt, n: -1 };
    $('.inhalt').scrollTop = 0;
    $('.inhalt').addEventListener('scroll', () => $('.kopf').classList.toggle('linie', $('.inhalt').scrollTop > 4), { passive: true });
  } else {
    const setz = (sel, k, html) => { if (gezeichnet[k] !== html) { const el = $(sel); const fokus = document.activeElement && document.activeElement.id; el.innerHTML = html; gezeichnet[k] = html; if (fokus && el.querySelector('#' + fokus)) { const f = $('#' + fokus); f.focus(); f.setSelectionRange && f.setSelectionRange(f.value.length, f.value.length); } } };
    setz('.kopf', 'kopf', teile.kopf || '');
    setz('#ober', 'ober', teile.ober || '');
    setz('#banner', 'banner', banner);
    const inhaltNeu = gezeichnet.inhalt !== teile.inhalt;
    setz('.inhalt', 'inhalt', teile.inhalt);
    setz('.dock', 'dock', teile.dock || '');
    setz('#blatt', 'blatt', blattHtml());
    if (inhaltNeu) Z.neu.clear();
  }
  // Scrollen: Kommt etwas Neues, steht sein Anfang oben im Blick (lesen von oben), Warten rutscht nach unten
  const n = teile.n == null ? -1 : teile.n;
  if (n !== gezeichnet.n) {
    const alt = gezeichnet.n; gezeichnet.n = n;
    if (alt >= 0 && n > alt) {
      const el = document.querySelector(`[data-i="${alt}"]`) || document.querySelector('.warten');
      if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    } else if (alt < 0) requestAnimationFrame(() => { const m = $('.inhalt'); if (m && teile.unten) m.scrollTop = m.scrollHeight; });
  }
  if (teile.warten) { const w = $('.warten'); const m = $('.inhalt'); if (w && m && m.scrollHeight - m.scrollTop - m.clientHeight < 400) requestAnimationFrame(() => w.scrollIntoView({ block: 'end', behavior: 'smooth' })); }
  ticken();
}

const leiseKnopf = () => `<button class="leise${Z.leise ? ' an' : ''}" data-a="leise" aria-pressed="${Z.leise}">${ico(Z.leise ? 'moon' : 'volume')}${Z.leise ? 'Leise' : 'Normal'}</button>`;
const zurueck = (ziel = 'start') => `<button class="rund" data-nav="${ziel}" aria-label="Zurück">${ico('arrowLeft')}</button>`;

function ohneSchluessel() {
  const warum = TOKEN ? 'Der Schlüssel im Link passt nicht (alter Link oder unvollständig kopiert).' : 'Im Link fehlt der Schlüssel (der Teil ab „?t=“).';
  return { kopf: '<div class="titel"><h1>Lernhub</h1></div>', inhalt: `<div class="leer"><h2>Noch nicht verbunden</h2>
    <p>${warum} Am Mac: Lernhub → Einstellungen → <b>iPhone</b> → „Link kopieren“. Dann hier einfügen:</p>
    <div class="feld"><textarea id="link-ein" rows="2" placeholder="https://…ts.net:8443/?t=…" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea></div>
    <button class="btn los voll" data-a="link-verbinden">${ico('link')}Verbinden</button></div>` };
}
function ohneMac() {
  return { kopf: '<div class="titel"><h1>Lernhub</h1></div>', inhalt: `<div class="leer"><h2>Mac nicht erreichbar</h2>
    <p>Claude läuft auf deinem Mac. Ist Lernhub dort offen, der Mac wach und Tailscale auf beiden Geräten an?</p>
    <button class="btn los" data-a="neuladen">${ico('refresh')}Erneut versuchen</button></div>` };
}

// ---------------------------------------------------------------- Startseite
function startSeite() {
  const d = Z.d, sp = spielStand(), heute = new Date();
  const tag = heute.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const stunde = heute.getHours(), gruss = stunde < 11 ? 'Guten Morgen' : stunde < 18 ? 'Hallo' : 'Guten Abend';
  const ringP = Math.min(100, Math.round(sp.heuteXp / sp.ziel * 100));
  const spiel = `<div class="karte"><div class="spielkarte">
      <div class="serie">${flamme(sp.serie.geschafft ? 'froh' : 'muede', 40)}<span>${sp.serie.serie}</span><small>${sp.serie.serie === 1 ? 'Woche' : 'Wochen'}</small></div>
      <div class="lv"><b>Level ${sp.lv.level}</b> <span class="muted klein">· ${esc(sp.lv.rang)}</span>
        <div class="balken"><i style="width:${Math.round(sp.lv.anteil * 100)}%"></i></div>
        <div class="muted klein" style="margin-top:4px">${sp.serie.dieseWoche} von ${sp.serie.ziel} Lerntagen diese Woche</div></div>
      <div class="ring" style="--p:${ringP}" title="Tagesziel ${sp.ziel} XP"><span class="num">${sp.heuteXp}<small>XP</small></span></div></div></div>`;

  // Lernen
  const rf = lernReihenfolge(), erst = rf[0];
  const lernen = erst ? `<div class="karte modus" style="${cc(erst.c)}"><h3>${ico('grad')}Lernen</h3>
      <div class="gross">${esc(erst.c.emoji || '')} ${esc(erst.d.id)} · ${esc(erst.d.title)}</div>
      <p class="warum">${esc(erst.c.short)} · ${esc(erst.d.sitzung ? `Schritt ${Math.max(1, erst.d.sitzung.schritt || 1)}${erst.d.sitzung.plan && erst.d.sitzung.plan.length ? ' von ' + erst.d.sitzung.plan.length : ''} · ${minuten(erst.d.sitzung)} von ${erst.d.sitzung.budget} Min.` : `ca. ${erst.d.budget} Min.`)} · ${esc(warum(erst))}</p>
      <button class="btn los voll" data-lernen="lauf|${esc(erst.c.key)}">${ico('play')}${erst.d.sitzung ? 'Weiterlernen' : 'Los'}</button>
      ${rf.length > 1 ? `<div class="kurswahl">${rf.map((x) => `<button class="${x.d.sitzung ? 'laeuft' : ''}" style="${cc(x.c)}" data-lernen="kurs|${esc(x.c.key)}"><b>${esc(x.c.emoji || '')} ${esc(x.c.short)}</b><span>${esc(x.d.id)} · ${esc(x.d.title)}</span></button>`).join('')}</div>` : ''}</div>`
    : `<div class="karte"><h3>${ico('grad')}Lernen</h3><p class="muted">Gerade gibt es keine Lektion, die dran ist.</p></div>`;

  // Wiederholen
  const ur = uebReihenfolge(), u0 = ur[0];
  const faellig = Z.kurse.reduce((a, c) => a + ((c.practice || {}).faellig || 0), 0), luecken = Z.kurse.reduce((a, c) => a + ((c.practice || {}).luecken || 0), 0);
  const wiederholen = u0 ? `<div class="karte modus" style="${cc(u0)}"><h3>${ico('target')}Wiederholen</h3>
      <div class="gross">${n_(faellig, 'Thema', 'Themen')} fällig</div>
      <p class="warum">${luecken ? n_(luecken, 'offene Lücke', 'offene Lücken') + ' · ' : ''}Es geht los mit ${esc(u0.short)}${Z.ueb[u0.key] ? ' (Runde läuft)' : ''}, danach wechselt Lernhub zum Kurs mit dem größten Bedarf.</p>
      <button class="btn los voll" data-ueben="${esc(u0.key)}">${ico('play')}${Z.ueb[u0.key] ? 'Weiter wiederholen' : 'Los'}</button>
      <div class="kurswahl">${ur.map((c) => { const p = c.practice || {}; return `<button class="${Z.ueb[c.key] ? 'laeuft' : ''}" style="${cc(c)}" data-ueben="${esc(c.key)}"><b>${esc(c.emoji || '')} ${esc(c.short)}</b><span>${esc(`${p.faellig || 0} fällig${p.luecken ? ' · ' + p.luecken + ' Lücken' : ''}`)}</span></button>`; }).join('')}</div></div>`
    : '';

  // Leise-Modus
  const leise = `<div class="karte"><div class="leisekarte"><div style="flex:1"><b>${ico('moon')} Leise-Modus</b>
      <p>${Z.leise ? 'An: nur Antippen, keine Töne. Claude stellt nur Auswahlfragen, Rückfragen gehen über Knöpfe.' : 'Aus: Du kannst schreiben und über die Tastatur diktieren. Töne an.'}</p></div>
      <button class="schalter${Z.leise ? ' an' : ''}" data-a="leise" role="switch" aria-checked="${Z.leise}" aria-label="Leise-Modus"></button></div></div>`;

  // Heute und diese Woche
  const ag = d.agenda && d.agenda.date === R.tagVon() ? (d.agenda.events || []).filter((e) => e.kind === 'block') : [];
  const heuteK = ag.length ? `<div class="karte"><h3>${ico('calendar')}Heute im Kalender</h3><ul class="liste">${ag.map((e) => `<li><span class="zeit">${esc(e.start)}–${esc(e.end)}</span><span>${esc(e.title.replace(/^📚\s*/, ''))}</span></li>`).join('')}</ul></div>` : '';
  const woche = `<div class="karte"><h3>${ico('flag')}Diese Woche</h3><div class="pensum">${Z.kurse.filter((c) => c.quota).map((c) => `
      <span>${esc(c.emoji || '')} ${esc(c.short)}</span><div class="balken cc" style="${cc(c)}"><i style="width:${Math.min(100, Math.round((c.doneThis || 0) / c.quota * 100))}%"></i></div><span class="num muted klein">${c.doneThis || 0}/${c.quota}</span>`).join('')}</div>
      ${d.realismus && !d.realismus.ok ? d.realismus.hinweise.slice(0, 2).map((h) => `<div class="hinweis">${ico('alert')}<span><b>${esc(h.titel)}</b> ${esc(h.text)}</span></div>`).join('') : ''}</div>`;
  const heim = !navigator.standalone && !matchMedia('(display-mode: standalone)').matches && !LS.get('lh-heim-zu', false)
    ? `<div class="karte"><div class="leisekarte"><div style="flex:1"><b>Als App auf den Home-Bildschirm</b><p>In Safari unten auf Teilen tippen, dann „Zum Home-Bildschirm“. Danach startet Lernhub im Vollbild wie eine App.</p></div><button class="rund" data-a="heim-zu" aria-label="Schließen">${ico('x')}</button></div></div>` : '';
  const stand = d.generated ? new Date(d.generated).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
  return {
    kopf: `<div class="titel"><h1>Lernhub</h1><span class="unter">${esc(d.semester && d.semester.title || '')}</span></div>${leiseKnopf()}<button class="rund" data-nav="einstellungen" aria-label="Einstellungen">${ico('gear')}</button>`,
    inhalt: `<div class="gruss"><h2>${gruss}${d.name ? ', ' + esc(d.name) : ''}</h2><p>${esc(tag)}</p></div>${heim}${spiel}${lernen}${wiederholen}${leise}${heuteK}${woche}
      <div class="fuss">Stand ${esc(stand)}${d.alt ? ' · lädt' : ''} · <button class="klein" style="text-decoration:underline" data-a="neuladen">neu laden</button></div>`,
  };
}

// ---------------------------------------------------------------- Lernen
const SICHER = [['geraten', 'Geraten'], ['unsicher', 'Unsicher'], ['sicher', 'Sicher']];
const RUECK_OFFEN = [
  ['Frage unklar', 'Ich verstehe die Frage nicht. Was ist genau gemeint?'],
  ['Schritt nochmal', 'Erklär mir den Schritt bitte noch einmal anders, bevor ich antworte.'],
  ['Begriff?', 'Welcher Begriff aus der Frage ist wichtig, und was bedeutet er?'],
];
const RUECK_PAUSE = [
  ['Einfacher erklären', 'Erklär das bitte einfacher, mit einem Alltagsbeispiel.'],
  ['Noch ein Beispiel', 'Gib mir bitte noch ein Beispiel dazu.'],
  ['Warum ist das so?', 'Warum ist das so? Erklär mir den Grund dahinter.'],
  ['Wozu brauche ich das?', 'Wozu brauche ich das, und wie kommt es in der Klausur vor?'],
  ['Kurz zusammenfassen', 'Fass das bisher Gelernte in drei kurzen Sätzen zusammen.'],
];

function frageKarte(c, s, q, i) {
  const offen = q.offen && !q.beantwortet, a = q.antwort || {};
  const titel = q.rolle === 'vorhersage' ? 'Vorhersage' : q.rolle === 'abruf' ? 'Aufwärmen' : 'Prüffrage';
  let chip = '';
  if (q.ersetzt) chip = '<span class="chip">übersprungen</span>';
  else if (q.rolle === 'vorhersage') chip = q.aufgedeckt && q.korrekt != null ? `<span class="chip">${q.korrekt ? 'traf zu' : 'traf nicht zu'}</span>` : '<span class="chip">zählt nicht</span>';
  else if (q.aufgedeckt) chip = q.urteil === 'teils' ? '<span class="chip warn">Teils richtig</span>' : q.korrekt ? '<span class="chip ok">Richtig</span>' : '<span class="chip bad">Falsch</span>';
  else if (q.beantwortet) chip = '<span class="chip">wird bewertet …</span>';
  chip += q.aufgedeckt && !q.ersetzt ? xpChip(gebucht(s.id, 'f', q.nr)) : '';
  const jetzt = Z.neu.has(`${s.id}:f${q.nr}`);
  let rumpf = '';
  if (!q.frei) {
    const gew = offen ? Z.wahl[c.key] : a.wahl;
    rumpf = `<div class="optionen">${q.optionen.map((o, k) => {
      const kl = ['opt'];
      if (gew === k && !q.aufgedeckt) kl.push('gew');
      if (q.aufgedeckt && q.richtig === k) kl.push('richtig');
      if (q.aufgedeckt && a.wahl === k && q.richtig !== k) kl.push('falsch');
      if (q.aufgedeckt && a.wahl !== k && q.richtig !== k) kl.push('aus');
      if (!q.aufgedeckt && !offen && a.wahl !== k) kl.push('aus');
      if (jetzt && q.aufgedeckt && a.wahl === k) kl.push(q.richtig === k ? 'puls' : 'wackeln');
      const inhalt = `<span class="b">${BUCHSTABE(k)}</span><span class="t prose">${md(o).replace(/^<p>|<\/p>$/g, '')}</span>`;
      return offen ? `<button class="${kl.join(' ')}" data-opt="${k}">${inhalt}</button>` : `<div class="${kl.join(' ')}">${inhalt}</div>`;
    }).join('')}</div>`;
    if (a.weissNicht) rumpf += '<p class="leiser">Du hast „Weiß ich nicht“ gewählt.</p>';
    if (q.rolle === 'vorhersage' && q.beantwortet && !q.aufgedeckt) rumpf += '<p class="leiser">Claude löst deine Vorhersage im nächsten Schritt auf.</p>';
  } else {
    if (a.weissNicht) rumpf = '<p class="leiser">Du hast „Weiß ich nicht“ gewählt.</p>';
    else if (a.selbst) rumpf = `<p class="leiser">Selbst eingeschätzt: ${esc({ richtig: 'hatte ich', teils: 'teilweise', falsch: 'hatte ich nicht' }[a.selbst])}.</p>`;
    else if (a.text) rumpf = `<div class="trenner"></div><div class="eyebrow">Deine Antwort</div><div class="prose">${md(a.text)}</div>`;
    else if (offen && !q.gezeigt) rumpf = `<p class="leiser">${Z.leise && q.rolle !== 'vorhersage' ? 'Freie Frage: Denk die Antwort im Kopf durch, dann deck die Lösung auf und schätz dich selbst ein.' : 'Freie Frage: unten antworten.'}</p>`;
    if ((q.aufgedeckt || q.gezeigt) && q.loesung) rumpf += `<div class="loesung"><div class="eyebrow">Lösung</div><div class="prose">${md(q.loesung)}</div></div>`;
  }
  if (jetzt && q.aufgedeckt && q.rolle !== 'vorhersage') {
    const ok = q.korrekt || q.urteil === 'richtig';
    rumpf += `<p class="lob ${ok ? 'ok' : 'nein'}">${ok ? flamme(combo(s) >= 3 ? 'jubelnd' : 'froh', 22) : ico('sparkles')}<span>${esc(ok ? R.lob(combo(s), q.nr) : R.trost(q.nr))}</span></p>`;
  }
  const erkl = (q.aufgedeckt || q.gezeigt) && q.erklaerung ? `<div class="trenner"></div><div class="eyebrow">Erklärung</div><div class="prose">${md(q.erklaerung)}</div>` : '';
  return `<div class="fkarte${offen ? ' offen' : ''}" style="${cc(c)}" data-i="${i}"><div class="eyebrow">${titel} ${chip}</div><div class="frage prose">${md(q.frage)}</div>${rumpf}${erkl}</div>`;
}

function rueckschau(c, s, i) {
  const a = s.abschluss || {};
  const liste = (t, xs) => (xs && xs.length ? `<div class="eyebrow" style="margin-top:12px">${t}</div><ul>${xs.map((x) => `<li class="prose">${md(x).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul>` : '');
  const zahlen = [s.stat && s.stat.fragen ? `${String(Math.round(s.stat.punkte * 10) / 10).replace('.', ',')} von ${s.stat.fragen} richtig` : '', s.score != null ? s.score + ' %' : '', minuten(s) + ' Min.'].filter(Boolean).join(' · ');
  const unten = s.zustand === 'erledigt' ? `<div class="trenner"></div><p class="ok-zeile">${ico('check')}${esc(s.lektion.id)} ist in der Roadmap erledigt.</p>`
    : s.eintragFehler ? `<div class="trenner"></div><div class="fehler">${esc(s.eintragFehler)}</div>` : '';
  return `<div class="fkarte rueck" style="${cc(c)}" data-i="${i}"><div class="eyebrow">Rückschau <span class="chip acc">${esc(zahlen)}</span></div>
    ${a.text ? `<div class="prose">${md(a.text)}</div>` : ''}${liste('Das hast du gelernt', a.gelernt)}${liste('Noch offen', a.offen)}${liste('Zum Nachlesen', a.nachlesen)}${unten}</div>`;
}

function wartenHtml(s, was) {
  const zuege = []; let t0 = null;
  for (const v of s.verlauf) { if (v.von === 'ich') t0 = v.t; else if (t0 && v.t) { zuege.push(v.t - t0); t0 = null; } }
  const ms = s.verlauf.length ? (zuege.length ? zuege.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, zuege.length) : 12000) : 45000;
  return `<div class="warten" data-seit="${s.seit || Date.now()}" data-ms="${Math.round(ms)}"><span class="warten-flamme">${flamme('froh', 30)}</span>
    <div class="w-in"><div class="w-kopf"><span>Claude ${esc(was)}</span><span class="muted num" data-sek>0 s</span></div><div class="balken"><i style="width:0%"></i></div></div></div>`;
}

function lernenSeite(c) {
  const e = Z.lern[c.key] || {}, s = e.sitzung;
  const kopf = `${zurueck()}<div class="titel"><h1>${esc(c.emoji || '')} ${esc(s ? s.lektion.id + ' · ' + s.lektion.title : c.short)}</h1><span class="unter">${esc(c.short)} · Lernen</span></div>${leiseKnopf()}${s ? `<button class="rund" data-a="menue" aria-label="Mehr">${ico('grid')}</button>` : ''}`;
  if (!s) {
    const z = e.ziel || {};
    return { kopf, inhalt: `<div class="leer"><h2>${z.id ? esc(z.id + ' · ' + z.title) : 'Nichts zu lernen'}</h2><p>${esc(z.id ? 'Diese Lektion ist als Nächstes dran.' : z.grund || 'Alle Lektionen dieses Kurses sind erledigt.')}</p>
      ${z.id ? `<button class="btn los" data-lernen="kurs|${esc(c.key)}">${ico('play')}Lektion starten</button>` : ''}</div>`, dock: '' };
  }
  const n = s.plan && s.plan.length ? s.plan.length : 0, cb = combo(s);
  const ober = `<div class="fortschritt" style="${cc(c)}"><div class="seg">${n ? s.plan.map((t, k) => `<i class="${k + 1 < s.schritt ? 'done' : k + 1 === s.schritt ? 'jetzt' : ''}"></i>`).join('') : '<i></i>'}</div>
    ${cb >= 2 ? `<span class="combo">${ico('flame')}${cb}</span>` : ''}<span class="num" data-uhr>${minuten(s)} / ${s.budget} Min.</span></div>`;
  const teile = s.verlauf.map((v, i) => {
    if (v.von === 'ich') {
      if (v.art === 'weiter') return `<div class="weiter-marke" data-i="${i}">→ Weiter</div>`;
      if (v.art === 'ende') return `<div class="weiter-marke" data-i="${i}">→ Lektion beenden</div>`;
      if (v.art === 'antwort') { const q = s.verlauf.find((x) => x.art === 'frage' && x.nr === v.nr); return v.text && q && !q.frei ? `<div class="ich" data-i="${i}"><div class="blase">${md(v.text)}</div></div>` : `<i data-i="${i}" hidden></i>`; }
      return `<div class="ich" data-i="${i}"><div class="blase">${md(v.text)}</div></div>`;
    }
    if (v.art === 'frage') return frageKarte(c, s, v, i);
    if (v.art === 'abschluss') return rueckschau(c, s, i);
    return `<div class="claude prose" data-i="${i}">${md(v.text)}</div>`;
  });
  if (s.zustand === 'denkt') teile.push(wartenHtml(s, !s.verlauf.length ? 'liest das Material und plant die Lektion' : 'denkt'));
  if (s.zustand === 'traegtEin') teile.push(`<div class="warten" data-seit="${s.seit || Date.now()}" data-ms="8000"><span class="warten-flamme">${flamme('froh', 30)}</span><div class="w-in"><div class="w-kopf"><span>Wird eingetragen: Roadmap, Kalender und Lernhub</span><span class="muted num" data-sek></span></div><div class="balken"><i></i></div></div></div>`);
  if (s.zustand === 'fehler') teile.push(`<div class="fehler"><b>Claude:</b> ${esc(s.fehler || 'Fehler')}<button class="btn klein voll" data-a="lernen-nochmal">${ico('refresh')}Noch einmal versuchen</button></div>`);
  return { kopf, ober, inhalt: `<div class="verlauf">${teile.join('')}</div>`, dock: lernenDock(c, s), n: s.verlauf.length, warten: s.zustand === 'denkt', unten: true };
}

// senden: data-a des Sendeknopfs; null = Feld ohne eigenen Knopf (der Text geht mit der Antwort mit)
function feldHtml(c, ph, { senden = 'senden' } = {}) {
  return `<div class="feld"><textarea id="eingabe" rows="1" placeholder="${esc(ph)}" enterkeyhint="${senden ? 'send' : 'done'}" data-feld="${esc(c.key)}">${esc(Z.entwurf[c.key] || '')}</textarea>
    ${senden ? `<button class="senden" data-a="${senden}" aria-label="Senden" ${(Z.entwurf[c.key] || '').trim() ? '' : 'disabled'}>${ico('arrowLeft', 'hoch')}</button>` : ''}</div>`;
}
const chips = (liste, attr) => `<div class="chips">${liste.map(([l, t]) => `<button class="chip-k" ${attr}="${esc(t)}">${esc(l)}</button>`).join('')}</div>`;
const stiftKnopf = (c, text = 'Schreiben') => (Z.feld[c.key] ? '' : `<button class="chip-k" data-a="feld">${ico('pen')}${esc(text)}</button>`);
const mitFeld = (c) => !Z.leise || Z.feld[c.key];

function lernenDock(c, s) {
  const denkt = s.zustand === 'denkt' || s.zustand === 'traegtEin';
  if (s.zustand === 'erledigt') {
    const n = naechsteLektion(c), e = s.ergebnis || {};
    return `<div class="reihe" style="margin-bottom:8px"><b style="flex:1">${ico('check')} ${esc(s.lektion.id)} erledigt</b><span class="muted klein">${esc([e.score != null ? e.score + ' %' : '', e.min ? e.min + ' Min.' : ''].filter(Boolean).join(' · '))}</span></div>
      ${n ? `<button class="btn los voll" data-a="naechste">Nächste Lektion${n.key !== c.key ? ' · ' + esc(n.short) : ''} →</button>` : `<button class="btn los voll" data-nav="start">Zur Übersicht</button>`}
      <div class="zeile">${e.datei ? `<button class="btn leicht" data-a="merkblatt">${ico('book')}Merkblatt</button>` : ''}<button class="btn leicht" data-a="zurueck">${ico('undo')}Rückgängig</button>${n ? `<button class="btn leicht" data-nav="start">Übersicht</button>` : ''}</div>`;
  }
  if (s.zustand === 'traegtEin') return '<p class="frage-hilfe">Wird eingetragen …</p>';
  if (s.zustand === 'fehler') return '';
  const q = offeneFrage(s);
  if (s.abschluss) {
    return `${chips([['Nochmal zusammenfassen', 'Fass die Lektion bitte noch einmal in drei Sätzen zusammen.'], ['Was ist klausurrelevant?', 'Was davon ist für die Klausur am wichtigsten?']], 'data-rueck')}
      ${mitFeld(c) ? feldHtml(c, 'Noch eine Frage zur Lektion?') : ''}
      <button class="btn haupt voll" data-a="eintragen" ${denkt ? 'disabled' : ''}>${ico('check')}Lektion abschließen</button>`;
  }
  if (q) {
    const wahl = Z.wahl[c.key];
    if (!q.frei) {
      if (wahl == null) return `<p class="frage-hilfe">${denkt ? 'Claude denkt …' : 'Tipp die Antwort an, die stimmt.'}</p>
        ${chips(RUECK_OFFEN, 'data-rueck')}
        ${mitFeld(c) ? feldHtml(c, 'Rückfrage zur Frage …') : ''}
        <div class="zeile"><button class="btn leicht" data-a="weissnicht" ${denkt ? 'disabled' : ''}>Weiß ich nicht</button>${Z.leise ? stiftKnopf(c, 'Rückfrage schreiben') : ''}</div>`;
      return `<p class="frage-hilfe">${BUCHSTABE(wahl)} gewählt. Wie sicher bist du? (schickt ab)</p>
        ${mitFeld(c) ? feldHtml(c, 'Optional: deine Gedanken dazu', { senden: null }) : ''}
        <div class="sicher">${SICHER.map(([w, l]) => `<button class="btn s-${w}" data-sicher="${w}" ${denkt ? 'disabled' : ''}>${l}</button>`).join('')}</div>
        <div class="zeile"><button class="btn leicht" data-a="abwaehlen">Andere Antwort</button>${Z.leise ? stiftKnopf(c, 'Gedanken') : ''}</div>`;
    }
    // freie Frage
    if (q.gezeigt) return `<p class="frage-hilfe">Hattest du es? Sei ehrlich, das steuert, was Claude als Nächstes macht.</p>
      <div class="sicher selbst">${[['falsch', 'Nein'], ['teils', 'Teilweise'], ['richtig', 'Ja']].map(([w, l]) => `<button class="btn s-${w}" data-selbst="${w}" ${denkt ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
    const aufdecken = q.rolle !== 'vorhersage' ? `<button class="btn ${Z.leise ? 'los' : 'leicht'}${Z.leise ? ' voll' : ''}" data-a="aufdecken" ${denkt ? 'disabled' : ''}>${ico('sparkles')}Lösung aufdecken</button>` : '';
    if (Z.leise && !Z.feld[c.key]) return `${chips(RUECK_OFFEN, 'data-rueck')}${aufdecken}
      <div class="zeile"><button class="btn leicht" data-a="weissnicht" ${denkt ? 'disabled' : ''}>Weiß ich nicht</button>${stiftKnopf(c, 'Doch schreiben')}</div>`;
    return `${feldHtml(c, q.rolle === 'vorhersage' ? 'Deine Vermutung …' : 'Deine Antwort (Mikrofon der Tastatur zum Diktieren)', { senden: 'antwort-frei' })}
      <div class="zeile"><button class="btn leicht" data-a="weissnicht" ${denkt ? 'disabled' : ''}>Weiß ich nicht</button>${q.rolle !== 'vorhersage' ? `<button class="btn leicht" data-a="aufdecken" ${denkt ? 'disabled' : ''}>Aufdecken</button>` : ''}</div>`;
  }
  // keine offene Frage: weiter oder nachfragen
  return `${chips(RUECK_PAUSE, 'data-rueck')}
    ${mitFeld(c) ? feldHtml(c, 'Frage stellen oder lenken …') : ''}
    ${s.stat && s.stat.gestellt > 0 ? `<button class="btn los voll" data-a="weiter" ${denkt ? 'disabled' : ''}>Weiter →</button>` : ''}
    ${Z.leise && !Z.feld[c.key] ? `<div class="zeile" style="justify-content:center">${stiftKnopf(c, 'Eigene Frage schreiben')}</div>` : ''}`;
}

// ---------------------------------------------------------------- Wiederholen
const ERG = { geloest: ['Gelöst', 'ok'], hinweise: ['Mit Hinweisen gelöst', 'warn'], weiter: ['Weitergegangen', 'bad'], aufgegeben: ['Aufgegeben', 'bad'] };
const UEB_OFFEN = [['Hinweis bitte', 'Ich komme nicht weiter. Gib mir bitte einen Hinweis, nur die nächste Sprosse.'], ['Ich gebe auf', 'Ich gebe auf. Zeig mir bitte die Lösung.']];
const UEB_PAUSE = [['Warum ist das so?', 'Warum ist das so? Erklär mir den Grund hinter der Lösung.'], ['Lösung genauer', 'Erklär mir die Musterlösung bitte Schritt für Schritt.'], ['Noch ein Beispiel', 'Gib mir bitte ein ähnliches Beispiel, ohne Aufgabe.']];
const ALS_AUSWAHL = 'Ich kann gerade nicht schreiben. Stell mir genau diese Aufgabe bitte als Auswahl mit 4 Optionen (art "aufgabe" mit optionen und richtig).';

function aufgabeKarte(c, s, a, i) {
  const offen = a.offen, wahlen = s.verlauf.filter((v) => v.art === 'wahl' && v.nr === a.nr);
  const ab = s.verlauf.find((v) => v.art === 'abschluss' && v.nr === a.nr);
  const richtig = ab && ab.richtig != null ? ab.richtig : a.richtig;
  let opts = '';
  if (a.optionen && a.optionen.length) {
    const gew = Z.wahl[c.key];
    opts = `<div class="optionen">${a.optionen.map((o, k) => {
      const w = wahlen.find((x) => x.wahl === k), kl = ['opt'];
      if (w) kl.push(w.korrekt ? 'richtig' : 'falsch');
      else if (!offen && richtig === k) kl.push('richtig');
      else if (offen && gew === k) kl.push('gew');
      else if (!offen) kl.push('aus');
      const neu = w && Z.neu.has(`${s.id}:w${a.nr}:${k}`);
      if (neu) kl.push(w.korrekt ? 'puls' : 'wackeln');
      const inhalt = `<span class="b">${BUCHSTABE(k)}</span><span class="t prose">${md(o).replace(/^<p>|<\/p>$/g, '')}</span>`;
      return offen && !w ? `<button class="${kl.join(' ')}" data-uopt="${k}">${inhalt}</button>` : `<div class="${kl.join(' ')}">${inhalt}</div>`;
    }).join('')}</div>`;
    const letzte = wahlen[wahlen.length - 1];
    if (offen && letzte && !letzte.korrekt) opts += `<p class="lob nein">${ico('sparkles')}<span>Noch nicht. ${s.zustand === 'denkt' ? 'Claude schaut, wo es hakt …' : 'Lies den Hinweis und wähl noch einmal.'}</span></p>`;
  }
  return `<div class="fkarte${offen ? ' offen' : ''}" style="${cc(c)}" data-i="${i}"><div class="eyebrow">Aufgabe ${a.nr || ''}${a.modus ? ` <span class="chip">${esc({ abruf: 'Abruf', unterscheidung: 'Unterscheiden', verknuepfung: 'Verknüpfen' }[a.modus] || a.modus)}</span>` : ''}</div>
    <div class="frage prose">${md(a.aufgabe)}</div>${opts}</div>`;
}
function abschlussKarte(c, s, e, i) {
  if (e.ergebnis === 'verworfen') return `<div class="weiter-marke" data-i="${i}">Aufgabe verworfen</div>`;
  const [lbl, art] = ERG[e.ergebnis] || ERG.weiter, jetzt = Z.neu.has(`${s.id}:a${e.nr}`);
  return `<div class="fkarte" style="${cc(c)}" data-i="${i}"><div class="eyebrow">Abgeschlossen <span class="chip ${art}${jetzt ? (art === 'ok' ? ' puls' : ' wackeln') : ''}">${lbl}</span>${xpChip(gebucht(s.id, 'a', e.nr))}</div>
    ${e.urteil ? `<div class="prose">${md(e.urteil)}</div>` : ''}
    ${e.musterloesung ? `<div class="trenner"></div><div class="eyebrow">Musterlösung</div><div class="prose">${md(e.musterloesung)}</div>` : ''}</div>`;
}
function uebStat(s) {
  const st = s.stat || {}, bew = (st.geloest || 0) + (st.hinweise || 0) + (st.weiter || 0) + (st.aufgegeben || 0);
  const t = [n_(st.aufgaben || 0, 'Aufgabe', 'Aufgaben')];
  if (st.geloest) t.push(`${st.geloest} gelöst`);
  if (st.hinweise) t.push(`${st.hinweise} mit Hinweisen`);
  if (bew) t.push(Math.round(((st.geloest || 0) + 0.5 * (st.hinweise || 0)) / bew * 100) + ' %');
  return t.join(' · ');
}
function uebenSeite(c) {
  const s = Z.ueb[c.key];
  const kopf = `${zurueck()}<div class="titel"><h1>${esc(c.emoji || '')} ${esc(c.short)}</h1><span class="unter">Wiederholen${s && s.stat && s.stat.aufgaben ? ' · ' + esc(uebStat(s)) : ''}</span></div>${leiseKnopf()}${s ? `<button class="rund" data-a="menue" aria-label="Mehr">${ico('grid')}</button>` : ''}`;
  if (!s) return { kopf, inhalt: `<div class="leer"><h2>Keine Runde offen</h2><p>Übe alles, was du in ${esc(c.short)} schon gelernt hast.</p><button class="btn los" data-ueben="${esc(c.key)}">${ico('play')}Runde starten</button></div>` };
  const teile = s.verlauf.map((v, i) => {
    if (v.von === 'ich') {
      if (v.art === 'weiter') return `<div class="weiter-marke" data-i="${i}">→ Nächste Aufgabe</div>`;
      if (v.art === 'wahl') return v.text ? `<div class="ich" data-i="${i}"><div class="blase">${md(v.text)}</div></div>` : `<i data-i="${i}" hidden></i>`;
      return `<div class="ich" data-i="${i}"><div class="blase">${md(v.text)}</div></div>`;
    }
    if (v.art === 'aufgabe') return aufgabeKarte(c, s, v, i);
    if (v.art === 'abschluss') return abschlussKarte(c, s, v, i);
    return `<div class="claude prose" data-i="${i}">${md(v.text)}</div>`;
  });
  if (s.zustand === 'denkt') teile.push(wartenHtml(s, !s.verlauf.length ? 'sucht die passenden Aufgaben aus' : 'denkt'));
  if (s.zustand === 'fehler') teile.push(`<div class="fehler"><b>Claude:</b> ${esc(s.fehler || 'Fehler')}<button class="btn klein voll" data-a="ueben-nochmal">${ico('refresh')}Noch einmal versuchen</button></div>`);
  return { kopf, inhalt: `<div class="verlauf">${teile.join('')}</div>`, dock: uebenDock(c, s), n: s.verlauf.length, warten: s.zustand === 'denkt', unten: true };
}
function uebenDock(c, s) {
  const denkt = s.zustand === 'denkt';
  if (s.zustand === 'fehler') return '';
  const a = offeneAufgabe(s);
  if (a) {
    const verw = `<button class="btn leicht" data-a="verwerfen" ${denkt ? 'disabled' : ''}>Verwerfen</button>`;
    if (a.optionen && a.optionen.length) {
      const w = Z.wahl[c.key];
      if (w != null) return `${mitFeld(c) ? feldHtml(c, 'Optional: wie du darauf kommst', { senden: 'uwahl' }) : ''}<button class="btn los voll" data-a="uwahl" ${denkt ? 'disabled' : ''}>${BUCHSTABE(w)} antworten</button>
        <div class="zeile"><button class="btn leicht" data-a="abwaehlen">Andere Antwort</button>${Z.leise ? stiftKnopf(c, 'Gedanken') : ''}</div>`;
      return `<p class="frage-hilfe">${denkt ? 'Claude denkt …' : 'Erst im Kopf lösen, dann antippen.'}</p>${chips(UEB_OFFEN, 'data-ueb')}
        ${mitFeld(c) ? feldHtml(c, 'Gedanken oder Rückfrage …', { senden: 'udenken' }) : ''}<div class="zeile">${verw}${Z.leise ? stiftKnopf(c) : ''}</div>`;
    }
    const liste = Z.leise ? [['Als Auswahl stellen', ALS_AUSWAHL], ...UEB_OFFEN] : UEB_OFFEN;
    return `${chips(liste, 'data-ueb')}${mitFeld(c) ? feldHtml(c, 'Deine Gedanken oder Antwort (Mikrofon der Tastatur zum Diktieren)', { senden: 'udenken' }) : ''}
      <div class="zeile">${verw}${Z.leise ? stiftKnopf(c, 'Antwort schreiben') : ''}</div>`;
  }
  const w = kursWechsel(c);
  return `${s.stat && s.stat.aufgaben ? chips(UEB_PAUSE, 'data-ueb') : ''}
    ${mitFeld(c) ? feldHtml(c, 'Frage zur letzten Aufgabe …', { senden: 'utext' }) : ''}
    ${w ? `<button class="btn los voll" data-ueben-wechsel="${esc(w.key)}" ${denkt ? 'disabled' : ''}>Nächste Aufgabe · ${esc(w.short)} →</button>
      <div class="zeile"><button class="btn leicht" data-a="unaechste" ${denkt ? 'disabled' : ''}>Lieber weiter in ${esc(c.short)}</button></div>`
    : `<button class="btn los voll" data-a="unaechste" ${denkt ? 'disabled' : ''}>Nächste Aufgabe →</button>`}
    ${Z.leise && !Z.feld[c.key] && s.stat && s.stat.aufgaben ? `<div class="zeile" style="justify-content:center">${stiftKnopf(c, 'Eigene Frage schreiben')}</div>` : ''}`;
}

// ---------------------------------------------------------------- Einstellungen
function einstellungenSeite() {
  return {
    kopf: `${zurueck()}<div class="titel"><h1>Einstellungen</h1></div>`,
    inhalt: `<div class="karte"><div class="leisekarte"><div style="flex:1"><b>Leise-Modus</b><p>Für unterwegs, wenn du nicht diktieren kannst: Claude stellt nur Auswahlfragen und Aufgaben mit vier Optionen, Rückfragen gehen über Knöpfe, freie Fragen deckst du auf und schätzt dich selbst ein. Keine Töne. Gilt ab deiner nächsten Antwort, auch mitten in der Lektion.</p></div>
        <button class="schalter${Z.leise ? ' an' : ''}" data-a="leise" role="switch" aria-checked="${Z.leise}" aria-label="Leise-Modus"></button></div></div>
      <div class="karte"><div class="leisekarte"><div style="flex:1"><b>Töne</b><p>Klänge bei richtig, falsch und geschafft (nur ohne Leise-Modus).</p></div>
        <button class="schalter${Z.ton ? ' an' : ''}" data-a="ton" role="switch" aria-checked="${Z.ton}" aria-label="Töne"></button></div></div>
      <div class="karte"><h3>${ico('link')}Verbindung</h3><p class="klein">${Z.netz === 'ok' ? `Verbunden mit Lernhub ${esc((Z.mac && Z.mac.version) || '')} auf deinem Mac.` : 'Gerade keine Verbindung zum Mac.'} Claude läuft dort über dein Abo; das iPhone zeigt dieselben Lektionen und Runden wie der Mac. XP, Serie und Quests bucht der Mac.</p>
        <button class="btn klein voll" style="margin-top:12px" data-a="neuladen">${ico('refresh')}Alles neu laden</button></div>
      <div class="karte"><h3>${ico('sparkles')}So geht's</h3><ul class="liste klein">
        <li>Auswahlfrage: Antwort antippen, dann „Wie sicher?“. Der zweite Tipp schickt ab.</li>
        <li>Rückfragen ohne Tippen: die Knöpfe über dem Dock.</li>
        <li>Ohne Leise-Modus: Mikrofon der Tastatur zum Diktieren.</li>
        <li>Mitten in der Lektion zum Mac wechseln geht jederzeit: Es ist dieselbe Sitzung.</li></ul></div>`,
  };
}

// ---------------------------------------------------------------- Blätter: Menü, Feier, Merkblatt
// Ein Blatt blendet sich nur beim Öffnen ein; zeichnet es sich neu (etwa wenn die XP nachkommen), steht es ruhig
let blattLetzt = null;
function blattHtml() {
  const b = Z.blatt;
  const k = b ? b.art + '|' + (b.key || '') : null, ruhig = k && k === blattLetzt;
  blattLetzt = k;
  const html = blattRoh(b);
  return ruhig ? html.replace('class="blatt-grund', 'class="blatt-grund ruhig') : html;
}
function blattRoh(b) {
  if (!b) return '';
  const c = kursVon(b.key || Z.route.key);
  if (b.art === 'menue' && c && Z.route.name === 'lernen') {
    const s = (Z.lern[c.key] || {}).sitzung;
    if (!s) return '';
    return `<div class="blatt-grund"><div class="blatt" data-blatt><div class="griff"></div><h3>${esc(s.lektion.id)} · ${esc(s.lektion.title)}</h3><p>${esc(minuten(s) + ' von ' + s.budget + ' Min.')}</p>
      ${!s.abschluss && s.zustand !== 'erledigt' ? `<button class="btn haupt" data-a="ende" ${s.zustand === 'denkt' ? 'disabled' : ''}>Lektion jetzt beenden (Rückschau)</button>` : ''}
      <button class="btn" data-a="ton">${ico('volume')}Töne ${Z.ton ? 'aus' : 'an'}</button>
      ${s.zustand !== 'erledigt' ? `<button class="btn gefahr" data-a="abbrechen">Abbrechen, nichts eintragen</button>` : ''}
      <button class="btn leicht" data-a="blatt-zu">Schließen</button></div></div>`;
  }
  if (b.art === 'menue' && c && Z.route.name === 'ueben') {
    const s = Z.ueb[c.key];
    return `<div class="blatt-grund"><div class="blatt" data-blatt><div class="griff"></div><h3>Wiederholen · ${esc(c.short)}</h3><p>${esc(s ? uebStat(s) : '')}</p>
      <button class="btn" data-a="ton">${ico('volume')}Töne ${Z.ton ? 'aus' : 'an'}</button>
      <button class="btn gefahr" data-a="runde-ende">Runde beenden</button>
      <button class="btn leicht" data-a="blatt-zu">Schließen</button></div></div>`;
  }
  if (b.art === 'feier' && c) {
    const s = (Z.lern[c.key] || {}).sitzung; if (!s || !s.ergebnis) return '';
    const e = s.ergebnis, st = R.sterne(e.score), xp = R.xpLektion(e.score) + Object.entries((Z.spiel && Z.spiel.gebucht) || {}).filter(([k]) => k.startsWith(s.id + ':')).reduce((a, [, x]) => a + (x.xp || 0), 0);
    const n = naechsteLektion(c);
    return `<div class="blatt-grund"><div class="blatt feier" data-blatt><div class="griff"></div>${flamme('jubelnd', 64)}<h3 style="margin-top:6px">Geschafft!</h3><p>${esc(s.lektion.id)} · ${esc(s.lektion.title)}</p>
      <div class="sterne">${[1, 2, 3].map((k) => `<span class="${k <= st ? 'an' : ''}" style="--i:${k}">${ico('star')}</span>`).join('')}</div>
      <div class="zahlen"><div><b>${e.score != null ? e.score + ' %' : '–'}</b><span>Genauigkeit</span></div><div><b>${e.min || minuten(s)}</b><span>Minuten</span></div><div><b>+${xp}</b><span>XP</span></div></div>
      ${n ? `<button class="btn los" data-a="naechste">Nächste Lektion${n.key !== c.key ? ' · ' + esc(n.short) : ''} →</button>` : ''}
      <button class="btn leicht" data-a="blatt-zu">Fertig</button></div></div>`;
  }
  if (b.art === 'merkblatt') {
    return `<div class="blatt-grund" style="align-items:stretch"><div class="blatt" data-blatt style="height:100%;border-radius:0;display:flex;flex-direction:column;padding-top:calc(env(safe-area-inset-top) + 8px)">
      <div class="reihe" style="margin-bottom:8px"><b style="flex:1">Merkblatt</b><button class="btn klein" data-a="blatt-zu">Schließen</button></div>
      <iframe src="${esc(b.url)}" style="flex:1;border:0;width:100%;border-radius:12px;background:#fff"></iframe></div></div>`;
  }
  if (b.art === 'frage') {
    return `<div class="blatt-grund"><div class="blatt" data-blatt><div class="griff"></div><h3>${esc(b.titel)}</h3><p>${esc(b.text)}</p>
      <button class="btn ${b.gefahr ? 'haupt' : 'los'}" data-a="bestaetigt">${esc(b.ja)}</button><button class="btn leicht" data-a="blatt-zu">Abbrechen</button></div></div>`;
  }
  return '';
}
function fragen(titel, text, ja, dann, gefahr = true) { Z.blatt = { art: 'frage', titel, text, ja, dann, gefahr, key: Z.route.key }; zeichnen(); }

// ---------------------------------------------------------------- Uhr, Warten, Meldungen
let tickTimer = null;
function ticken() {
  clearInterval(tickTimer);
  const lauf = () => {
    document.querySelectorAll('[data-seit]').forEach((el) => {
      const weg = Date.now() - +el.dataset.seit, ms = +el.dataset.ms || 12000;
      const s = el.querySelector('[data-sek]'); if (s) s.textContent = Math.round(weg / 1000) + ' s';
      const i = el.querySelector('.balken i');
      if (i) i.style.width = (weg <= ms ? 90 * weg / ms : 90 + 8 * (1 - Math.exp(-(weg - ms) / ms))).toFixed(1) + '%';
    });
    const u = $('[data-uhr]'), c = Z.route.name === 'lernen' && kursVon(Z.route.key), s = c && (Z.lern[c.key] || {}).sitzung;
    if (u && s) u.textContent = `${minuten(s)} / ${s.budget} Min.`;
  };
  lauf();
  if (document.querySelector('[data-seit], [data-uhr]')) tickTimer = setInterval(lauf, 1000);
}
let toastTimer = null;
function toast(text, art = '') {
  const el = $('#toast');
  el.innerHTML = `<div class="${art}">${esc(text)}</div>`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.innerHTML = ''; }, art === 'fehler' ? 5000 : 3000);
}

// ---------------------------------------------------------------- Eingaben
app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id !== 'eingabe') return;
  Z.entwurf[t.dataset.feld] = t.value;
  t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 160) + 'px';
  const b = t.parentElement.querySelector('.senden'); if (b) b.disabled = !t.value.trim();
});
app.addEventListener('keydown', (e) => {
  if (e.target.id === 'eingabe' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault(); const b = e.target.parentElement.querySelector('.senden'); if (b && !b.disabled) b.click();
  }
});
document.addEventListener('touchend', tonFreigeben, { once: true, passive: true });
document.addEventListener('click', tonFreigeben, { once: true });

app.addEventListener('click', async (e) => {
  const el = e.target.closest('button, [data-a], [data-nav]');
  if (!el || el.disabled) return;
  const d = el.dataset, r = Z.route, c = r.key ? kursVon(r.key) : null;
  if (d.nav) return navi({ name: d.nav });
  if (d.lernen) { const [art, key] = d.lernen.split('|'); const k = kursVon(key); if (k) lernenLos(k, { lauf: art === 'lauf' }); return; }
  if (d.ueben) { const k = kursVon(d.ueben); if (k) uebenLos(k); return; }
  if (d.uebenWechsel) { const k = kursVon(d.uebenWechsel); if (!k) return; navi({ name: 'ueben', key: k.key }); if (!Z.ueb[k.key]) await tu('ueben:starten', { key: k.key, leise: Z.leise }); else if (!offeneAufgabe(Z.ueb[k.key]) && Z.ueb[k.key].zustand !== 'denkt') uebenSenden(k, 'weiter'); return; }
  // Lernen: Option, Sicherheit, Selbsteinschätzung, Schnellknöpfe
  if (d.opt != null && c) { const i = +d.opt; Z.wahl[c.key] = Z.wahl[c.key] === i ? undefined : i; if (Z.wahl[c.key] === undefined) delete Z.wahl[c.key]; ton('auswahl'); zeichnen(); return; }
  if (d.sicher && c) return lernenSenden(c, 'antwort', { wahl: Z.wahl[c.key], sicherheit: d.sicher, text: (Z.entwurf[c.key] || '').trim() });
  if (d.selbst && c) return lernenSenden(c, 'antwort', { selbst: d.selbst, text: (Z.entwurf[c.key] || '').trim() });
  if (d.rueck && c) return lernenSenden(c, 'text', { text: d.rueck });
  // Wiederholen
  if (d.uopt != null && c) { const i = +d.uopt; Z.wahl[c.key] = Z.wahl[c.key] === i ? undefined : i; if (Z.wahl[c.key] === undefined) delete Z.wahl[c.key]; ton('auswahl'); zeichnen(); return; }
  if (d.ueb && c) { const s = Z.ueb[c.key]; return uebenSenden(c, offeneAufgabe(s) ? 'denken' : 'text', d.ueb); }
  const a = d.a;
  if (!a) return;
  if (a === 'leise') { Z.leise = !Z.leise; LS.set('lh-leise', Z.leise); toast(Z.leise ? 'Leise-Modus an: nur Antippen, Claude stellt Auswahlfragen.' : 'Leise-Modus aus: Schreiben und Diktieren, Töne an.'); return zeichnen(); }
  if (a === 'ton') { Z.ton = !Z.ton; LS.set('lh-ton', Z.ton); Z.blatt = null; return zeichnen(); }
  if (a === 'neuladen') { await tu('neuLaden', {}, { still: true }); ereignisse(); return allesLaden(); }
  if (a === 'link-verbinden') {
    const roh = ($('#link-ein') || {}).value || '';
    const t = (roh.match(/[?&]t=([^&\s#]+)/) || [])[1] || roh.trim();
    if (!t || t.length < 20 || /•/.test(t)) return toast('Das ist nicht der ganze Link. Am Mac auf „Link kopieren“ tippen und hier einfügen.', 'fehler');
    gruendlich(decodeURIComponent(t));
    location.replace('/?t=' + encodeURIComponent(decodeURIComponent(t)));
    return;
  }
  if (a === 'heim-zu') { LS.set('lh-heim-zu', true); return zeichnen(); }
  if (a === 'feld' && c) { Z.feld[c.key] = true; zeichnen(); const t = $('#eingabe'); if (t) t.focus(); return; }
  if (a === 'abwaehlen' && c) { delete Z.wahl[c.key]; return zeichnen(); }
  if (a === 'menue') { Z.blatt = { art: 'menue', key: r.key }; return zeichnen(); }
  if (a === 'blatt-zu') { Z.blatt = null; return zeichnen(); }
  if (a === 'bestaetigt') { const f = Z.blatt && Z.blatt.dann; Z.blatt = null; zeichnen(); if (f) f(); return; }
  if (!c) return;
  const text = (Z.entwurf[c.key] || '').trim();
  // Lernen
  if (r.name === 'lernen') {
    const s = (Z.lern[c.key] || {}).sitzung;
    if (a === 'senden' && text) return lernenSenden(c, 'text', { text });
    if (a === 'antwort-frei' && text) return lernenSenden(c, 'antwort', { text });
    if (a === 'weissnicht') return lernenSenden(c, 'antwort', { weissNicht: true, text });
    if (a === 'weiter') return lernenSenden(c, 'weiter');
    if (a === 'ende') { Z.blatt = null; return lernenSenden(c, 'ende'); }
    if (a === 'aufdecken') { const x = await tu('lernen:aufdecken', { key: c.key }); if (x && x.ok) { const q = offeneFrage(s); if (q) q.gezeigt = true; zeichnen(); } return; }
    if (a === 'lernen-nochmal') return tu('lernen:nochmal', { key: c.key });
    if (a === 'eintragen') { if (s) { s.zustand = 'traegtEin'; s.seit = Date.now(); zeichnen(); } const x = await tu('lernen:eintragen', { key: c.key }); if (!x || !x.ok) api('lernen:stand', { key: c.key }).then((y) => { if (y) Z.lern[c.key] = y; zeichnen(); }).catch(() => { }); return; }
    if (a === 'abbrechen') return fragen('Lektion abbrechen?', 'Nichts wird eingetragen. Die Lektion bleibt offen und beginnt beim nächsten Mal von vorn.', 'Abbrechen', async () => { await tu('lernen:beenden', { key: c.key }); navi({ name: 'start' }); });
    if (a === 'zurueck') return fragen('Abschluss zurücknehmen?', `${s.lektion.id} ist danach wieder offen. Das Merkblatt bleibt liegen.`, 'Zurücknehmen', async () => { await tu('lernen:zurueck', { key: c.key }); await sitzungenLaden().catch(() => { }); navi({ name: 'start' }); });
    if (a === 'merkblatt' && s && s.ergebnis && s.ergebnis.datei) { Z.blatt = { art: 'merkblatt', url: '/datei' + s.ergebnis.datei.split('/').map(encodeURIComponent).join('/') }; return zeichnen(); }
    if (a === 'naechste') { const n = naechsteLektion(c); Z.blatt = null; if (n) return lernenLos(n, { lauf: Z.lernLauf }); return navi({ name: 'start' }); }
  }
  // Wiederholen
  if (r.name === 'ueben') {
    if (a === 'uwahl') return uebenSenden(c, 'wahl', text, { wahl: Z.wahl[c.key] });
    if (a === 'udenken' && text) return uebenSenden(c, 'denken', text);
    if (a === 'utext' && text) return uebenSenden(c, 'text', text);
    if (a === 'unaechste') return uebenSenden(c, 'weiter');
    if (a === 'verwerfen') return fragen('Aufgabe verwerfen?', 'Sie zählt als nicht gelöst und kommt später in neuer Form wieder.', 'Verwerfen', () => tu('ueben:verwerfen', { key: c.key }));
    if (a === 'ueben-nochmal') return tu('ueben:nochmal', { key: c.key });
    if (a === 'runde-ende') return fragen('Runde beenden?', 'Alle Übungsrunden von heute werden geschlossen. Was du gelöst hast, ist schon eingetragen.', 'Beenden', async () => {
      const keys = new Set([c.key, ...Object.keys(laufHeute().n)]);
      for (const k of keys) if (Z.ueb[k]) await tu('ueben:beenden', { key: k }, { still: true });
      navi({ name: 'start' });
    });
  }
});
// Ein Tipp auf den dunklen Grund schließt ein Blatt (nicht beim Merkblatt, das füllt den Bildschirm)
app.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('blatt-grund') && Z.blatt && Z.blatt.art !== 'merkblatt') { e.stopPropagation(); Z.blatt = null; zeichnen(); }
}, true);

// Uhr der Lektion: läuft nur, solange sie auf dem iPhone zu sehen ist. Zurück im Vordergrund: alles nachladen.
document.addEventListener('visibilitychange', () => {
  const key = Z.route.name === 'lernen' ? Z.route.key : null;
  if (document.hidden) { if (key) uhr(key, false); return; }
  if (key) uhr(key, true);
  ereignisse();
  Promise.all([sitzungenLaden(), spielLaden()]).then(() => zeichnen()).catch(() => { });
  datenBald();
});
// Tastatur: Die App ist so hoch wie der sichtbare Bereich, das Dock bleibt über der Tastatur
if (window.visualViewport) {
  const hoehe = () => { document.documentElement.style.setProperty('--hoehe', window.visualViewport.height + 'px'); window.scrollTo(0, 0); };
  visualViewport.addEventListener('resize', hoehe); hoehe();
}
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => { });

// ---------------------------------------------------------------- Start
window.__lernhub = { Z, zeichnen, api };          // für tests/handy.test.mjs
zeichnen(true);
if (TOKEN) {
  ereignisse();
  allesLaden().then(() => { if (Z.route.name === 'lernen') uhr(Z.route.key, true); });
}
