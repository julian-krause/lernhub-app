// Spiel: XP, Level, Serie, Quests, Abzeichen und alles, was davon auf dem Bildschirm steht.
// Die Regeln selbst sind reine Funktionen in js/regeln.js (Test: tests/spiel.test.mjs); hier liegt der Spielstand
// (spiel.json in den App-Daten, Kanäle spiel:laden und spiel:speichern) und wer wann bucht.
//   - Lektionen buchen nie: Ihre XP rechnet gesamtXp() aus der Roadmap (xpLektion je erledigter Lektion). Was gerade
//     eingetragen wurde, aber hub.py noch nicht kennt, steht bis zu 3 Min. in frisch.
//   - Prüffragen und Aufgaben werden genau einmal gebucht (Schlüssel <Sitzungs-ID>:f<nr> bzw. :a<nr> in gebucht),
//     auf den Tag ihres Zeitstempels. Nach jeder Buchung: Quests, Truhe, Tagesziel, Abzeichen, Level prüfen.
//   - Still nachgebucht wird beim Start und beim ersten Laden einer Sitzung. Ton, Konfetti und Feier gibt es nur,
//     wenn sich der Zustand live ändert, während die Ansicht offen ist (live = true).
import { S } from './state.js';
import * as R from './regeln.js';
import { esc, ico, cc, flamme, n_ } from './util.js';
import { ton, tonSchalter, konfetti, hochzaehlen, ruhig } from './effekte.js';

const L = window.lernhub;
const NEU = () => ({
  v: 1, tagesziel: 200, lerntageZiel: 3, ton: true, fokus: true, willkommen: false, erinnern: true,
  tage: {}, gebucht: {}, frisch: {}, abzeichen: {}, rekorde: { combo: 0, tagXp: 0 },
});
let G = NEU(), geladen = false;
let hooks = { toast: () => {}, zeichnen: () => {}, nav: () => {}, seitenleiste: () => {} };
export function init(h) { hooks = { ...hooks, ...h }; }
tonSchalter(() => G.ton !== false);
export const stand = () => G;

// ---------------------------------------------------------------- Laden und Speichern
export async function laden() {
  let x = null;
  try { x = await L.spielLaden(); } catch { }
  G = { ...NEU(), ...(x && typeof x === 'object' ? x : {}) };
  for (const k of ['tage', 'gebucht', 'frisch', 'abzeichen']) if (!G[k] || typeof G[k] !== 'object') G[k] = {};
  G.rekorde = { combo: 0, tagXp: 0, ...(G.rekorde || {}) };
  geladen = true;
  const grenze = R.plusTage(R.tagVon(), -45);                  // gebucht: nur die letzten 45 Tage
  for (const [k, b] of Object.entries(G.gebucht)) if (!b || !b.tag || b.tag < grenze) delete G.gebucht[k];
  if (!x) speichern();
}
let schreibt = null;
export function speichern() {
  if (!geladen) return;
  clearTimeout(schreibt);
  schreibt = setTimeout(() => { try { L.spielSpeichern(G).catch(() => { }); } catch { } }, 120);
}
export function setzen(feld, wert) { G[feld] = wert; speichern(); }

// ---------------------------------------------------------------- Abgeleitete Werte
const LEER = () => ({ xp: 0, richtig: 0, fragen: 0, vorhersagen: 0, comboMax: 0, geloest: 0, aufgaben: 0, kurse: [], quests: {}, truhe: 0, zielBonus: 0 });
function tag(t) { const k = R.tagVon(t ? new Date(t) : new Date()); return G.tage[k] || (G.tage[k] = LEER()); }
const kursDazu = (d, k) => { if (k && !d.kurse.includes(k)) d.kurse.push(k); };
const zeitMarke = (d, t) => { const h = new Date(t).getHours(); if (h < 8) d.frueh = 1; if (h >= 22) d.spaet = 1; };

// Gerade eingetragene Lektionen, die hub.py noch nicht kennt: höchstens 3 Min., solange sie in S.rc nicht erledigt sind
function frischListe() {
  const out = [];
  for (const [k, f] of Object.entries(G.frisch)) {
    const i = k.indexOf('|'), kurs = k.slice(0, i), id = k.slice(i + 1);
    const c = S.byKey[kurs], l = c && c.byId && c.byId[id];
    if (!f || Date.now() - f.t > 180000 || (l && l.done)) { delete G.frisch[k]; continue; }
    out.push({ kurs, id, score: f.score, tag: R.tagVon(new Date(f.t)) });
  }
  return out;
}
// alle erledigten Lektionen: { kurs, id, score, tag }
function lektionen() {
  const out = [];
  for (const c of S.rc) for (const l of c.lessons) if (l.done) out.push({ kurs: c.key, id: l.id, score: l.score, tag: String(l.done).slice(0, 10) });
  return out.concat(frischListe());
}
export const gesamtXp = () => lektionen().reduce((a, l) => a + R.xpLektion(l.score), 0) + Object.values(G.tage).reduce((a, t) => a + (t.xp || 0), 0);
export const tagesXp = (k = R.tagVon()) => ((G.tage[k] || {}).xp || 0) + lektionen().filter((l) => l.tag === k).reduce((a, l) => a + R.xpLektion(l.score), 0);
export const level = () => R.levelVon(gesamtXp());
function aktiveTage() {
  const s = R.lerntage({ kurse: S.rc, tage: G.tage });
  for (const f of frischListe()) s.add(f.tag);
  return s;
}
export const lerntage = aktiveTage;
export const serie = () => R.wochenserie(aktiveTage(), R.tagVon(), G.lerntageZiel || 3, (S.d && S.d.semester && S.d.semester.breaks) || []);

function questStand(k = R.tagVon()) {
  const t = G.tage[k] || {}, ls = lektionen().filter((l) => l.tag === k);
  return { lektionen: ls.length, stark: ls.filter((l) => (l.score || 0) >= 80).length, richtig: t.richtig || 0, comboMax: t.comboMax || 0,
    geloest: t.geloest || 0, kurse: [...new Set([...(t.kurse || []), ...ls.map((l) => l.kurs)])], vorhersagen: t.vorhersagen || 0, xp: tagesXp(k) };
}
export const questsHeute = () => R.quests(R.tagVon(), questStand());
export const truheOffen = () => !!(G.tage[R.tagVon()] || {}).truhe;

function fakten() {
  const ls = lektionen(), tage = Object.values(G.tage), st = S.d && S.d.stats;
  return {
    lektionen: ls.length, perfekt: ls.filter((l) => (l.score || 0) >= 100).length, serie: serie().rekord, combo: G.rekorde.combo || 0,
    geloest: tage.reduce((a, t) => a + (t.geloest || 0), 0), zieltage: tage.filter((t) => t.zielBonus).length, truhen: tage.filter((t) => t.truhe).length,
    level: level().level, kursAnteil: Math.max(0, ...S.rc.map((c) => (c.total ? c.done / c.total * 100 : 0))),
    wochenpensum: st && st.weekQuota && st.weekDone >= st.weekQuota ? 1 : 0, frueh: tage.some((t) => t.frueh) ? 1 : 0, spaet: tage.some((t) => t.spaet) ? 1 : 0,
  };
}
// Stufen zeigen römische Ziffern (regeln.js zählt Striche: I, II, III, IIII …)
const ROEM = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
export const abzeichen = () => R.abzeichen(fakten()).map((a) => ({ ...a, name: a.name.replace(/ (I{2,})$/, (m, i) => ' ' + (ROEM[i.length] || i)), am: G.abzeichen[a.id] || null }));

// ---------------------------------------------------------------- Prüfen nach jeder Buchung
// Quest erfüllt → ihre XP einmal; alle drei → Truhe einmal; Tagesziel → Bonus einmal; neues Level oder Abzeichen → Meldung
function pruefen(live, { ohneLevel = false } = {}) {
  if (!S.d) return;
  const k = R.tagVon(), t = tag(), meld = [];
  for (let runde = 0; runde < 4; runde++) {
    let neu = false;
    const qs = R.quests(k, questStand(k));
    for (const q of qs) if (q.fertig && !t.quests[q.id]) { t.quests[q.id] = q.xp; t.xp += q.xp; neu = true; meld.push({ icon: q.icon, text: `Quest geschafft: ${q.text}. +${q.xp} XP` }); }
    if (qs.every((q) => q.fertig) && !t.truhe) { t.truhe = R.XP_TRUHE; t.xp += R.XP_TRUHE; neu = true; meld.push({ icon: 'chestOpen', text: `Alle drei Quests! Die Truhe ist offen: +${R.XP_TRUHE} XP`, gross: true }); }
    if (tagesXp(k) >= G.tagesziel && !t.zielBonus) { t.zielBonus = R.XP_TAGESZIEL; t.xp += R.XP_TAGESZIEL; neu = true; meld.push({ icon: 'ring', text: `Tagesziel geschafft! +${R.XP_TAGESZIEL} XP`, gross: true }); }
    if (!neu) break;
  }
  G.rekorde.tagXp = Math.max(G.rekorde.tagXp || 0, tagesXp(k));
  for (const a of R.abzeichen(fakten())) if (a.fertig && !G.abzeichen[a.id]) { G.abzeichen[a.id] = k; meld.push({ icon: a.icon, text: `Abzeichen freigeschaltet: ${a.name}`, gross: true }); }
  const lv = level();
  if (G.level && lv.level > G.level && !ohneLevel) meld.push({ icon: 'crown', text: `Level ${lv.level}! Du bist jetzt ${lv.rang}.`, gross: true });
  G.level = lv.level;
  speichern();
  if (live && meld.length) {
    meld.forEach((m, i) => setTimeout(() => hooks.toast(m.text, 'spiel', m.icon), 500 + i * 700));
    if (meld.some((m) => m.gross)) setTimeout(() => { ton.geschafft(); konfetti({ menge: 90 }); }, 500);
  }
  hooks.seitenleiste();
}

// ---------------------------------------------------------------- Buchen: Lernen
const urteilVon = (q) => q.urteil || (q.antwort && q.antwort.weissNicht ? 'weissnicht' : q.korrekt === true ? 'richtig' : q.korrekt === false ? 'falsch' : null);
// richtige Prüffragen in Folge in dieser Sitzung (aus dem Verlauf gezählt), bis einschließlich Frage bis
export function comboLernen(s, bis = Infinity) {
  let n = 0;
  for (const q of (s && s.verlauf) || []) {
    if (q.art !== 'frage' || q.rolle !== 'pruefung' || !q.aufgedeckt || q.ersetzt || q.nr > bis) continue;
    n = urteilVon(q) === 'richtig' ? n + 1 : 0;
  }
  return n;
}
export const gebuchtVon = (sid, art, nr) => G.gebucht[`${sid}:${art}${nr}`] || null;
export const sitzungXp = (sid) => Object.entries(G.gebucht).filter(([k]) => k.startsWith(sid + ':')).reduce((a, [, b]) => a + (b.xp || 0), 0);

// Gibt zurück, was neu gebucht wurde: { fragen: [{ nr, xp, glueck, urteil, combo, rolle }], lektion: bool }
export function lernen(s, live = false, opt = {}) {
  const neu = { fragen: [], lektion: false };
  if (!geladen || !s || !s.id || !s.verlauf) return neu;
  for (const q of s.verlauf) {
    if (q.art !== 'frage' || !q.aufgedeckt || q.ersetzt) continue;
    const key = `${s.id}:f${q.nr}`;
    if (G.gebucht[key]) continue;
    const urteil = urteilVon(q), pruef = q.rolle === 'pruefung', richtig = pruef && urteil === 'richtig';
    const combo = pruef ? comboLernen(s, q.nr) : 0;
    const glueck = richtig && Math.random() < 1 / 8;
    const xp = R.xpFrage({ rolle: q.rolle, urteil: urteil || undefined, combo, glueck });
    const t = q.t || Date.now(), d = tag(t);
    G.gebucht[key] = { tag: R.tagVon(new Date(t)), xp, glueck };
    d.xp += xp;
    if (pruef) { d.fragen++; if (richtig) d.richtig++; }
    if (q.rolle === 'vorhersage') d.vorhersagen++;
    d.comboMax = Math.max(d.comboMax || 0, combo);
    if (pruef) G.rekorde.combo = Math.max(G.rekorde.combo || 0, combo);
    kursDazu(d, s.kurs); zeitMarke(d, t);
    neu.fragen.push({ nr: q.nr, xp, glueck, urteil, combo, rolle: q.rolle });
  }
  if (s.zustand === 'erledigt' && s.ergebnis && s.lektion) {
    const k = `${s.kurs}|${s.lektion.id}`, c = S.byKey[s.kurs], l = c && c.byId && c.byId[s.lektion.id];
    const t = s.ende || Date.now();
    if (!G.frisch[k] && !(l && l.done) && Date.now() - t < 180000) { G.frisch[k] = { score: s.ergebnis.score, t }; neu.lektion = true; zeitMarke(tag(t), t); }
  }
  if (neu.fragen.length || neu.lektion) pruefen(live, opt);
  return neu;
}

// ---------------------------------------------------------------- Buchen: Wiederholen
// sauber gelöste Aufgaben in Folge in dieser Runde (verworfene zählen nicht und unterbrechen nicht)
export function comboUeben(s, bis = Infinity) {
  let n = 0;
  for (const e of (s && s.verlauf) || []) {
    if (e.art !== 'abschluss' || e.ergebnis === 'verworfen' || e.nr > bis) continue;
    n = e.ergebnis === 'geloest' ? n + 1 : 0;
  }
  return n;
}
export function ueben(s, live = false) {
  const neu = [];
  if (!geladen || !s || !s.id || !s.verlauf) return neu;
  for (const e of s.verlauf) {
    if (e.art !== 'abschluss' || e.nr == null) continue;
    const key = `${s.id}:a${e.nr}`;
    if (G.gebucht[key]) continue;
    const combo = e.ergebnis === 'geloest' ? comboUeben(s, e.nr) : 0;
    const xp = R.xpAufgabe(e.ergebnis, combo);
    const t = e.t || Date.now(), d = tag(t);
    G.gebucht[key] = { tag: R.tagVon(new Date(t)), xp, glueck: false };
    d.xp += xp;
    if (e.ergebnis !== 'verworfen') { d.aufgaben++; kursDazu(d, s.kurs); zeitMarke(d, t); }
    if (e.ergebnis === 'geloest') d.geloest++;
    d.comboMax = Math.max(d.comboMax || 0, combo);
    neu.push({ nr: e.nr, xp, ergebnis: e.ergebnis, combo });
  }
  if (neu.length) pruefen(live);
  return neu;
}

// Beim Start (nach dem Laden der Daten und Sitzungen): still nachbuchen, Abzeichen still freischalten
export function nachbuchen() {
  if (!geladen || !S.d) return;
  for (const e of Object.values(S.lern || {})) if (e && e.sitzung) lernen(e.sitzung, false);
  for (const s of Object.values(S.ueb || {})) if (s) ueben(s, false);
  pruefen(false);
}

// ---------------------------------------------------------------- Rückmeldung nach einer Antwort
export const lobText = (combo, n) => R.lob(combo, n);
export const trostText = (n) => R.trost(n);
export const xpChip = (b) => (b ? `<span class="chip xp${b.glueck ? ' glueck' : ''}" title="${b.glueck ? 'Glückstreffer: doppelte XP' : 'XP für diese Antwort'}">${ico(b.glueck ? 'sparkles' : 'star')}+${b.xp} XP${b.glueck ? ' · ×2' : ''}</span>` : '');
export const comboChip = (n) => (n >= 2 ? `<span class="combo" title="${n} in Folge richtig">${ico('flame')}<span>${n}er-Combo</span></span>` : '');

// ---------------------------------------------------------------- Warten auf Claude: Balken über die erwartete Dauer
// Erwartet: Mittel der bisherigen Züge dieser Sitzung (von deiner Eingabe bis zu Claudes Antwort), sonst 12 s,
// im ersten Zug 45 s. Im ersten Zug wechseln Tipps zur Bedienung.
const TIPPS = {
  lernen: ['Mit den Tasten 1 bis 4 wählst du eine Antwort, ↵ schickt sie ab.', 'Unter „Deine Gedanken“ kannst du laut denken. Claude passt Tempo und Beispiele daran an.',
    '„Weiß ich nicht“ ist ehrlich und bringt trotzdem XP. Raten bringt mehr, wenn du eine Idee hast.', 'Richtige Prüffragen in Folge geben eine Combo und mehr XP.',
    'Mit ⌘⇧F schaltest du den Fokus-Modus um.', 'Mit ⌘⇧L diktierst du deine Antwort.'],
  ueben: ['Schreib einfach los, wie du denkst. Claude gibt dir Hinweise statt der Lösung.', 'Sauber gelöste Aufgaben in Folge geben eine Combo.',
    'Esc verwirft eine Aufgabe, wenn sie nicht passt.', '↵ auf leerem Feld holt die nächste Aufgabe.', 'Mit ⌘⇧L diktierst du deine Gedanken.'],
};
export function erwartet(s) {
  if (!s.verlauf || !s.verlauf.length) return 45000;
  const d = [];
  for (let i = 1; i < s.verlauf.length; i++) {
    const a = s.verlauf[i - 1], b = s.verlauf[i];
    if (a.von === 'ich' && b.von === 'claude' && a.t && b.t && b.t > a.t) d.push(b.t - a.t);
  }
  return d.length ? d.reduce((x, y) => x + y, 0) / d.length : 12000;
}
// was: „denkt“ oder ein längerer Satz; sek: Attribut für die Sekunden (data-lrn-sek, data-ueb-uhr)
export function warten(s, { art, was, sek }) {
  const seit = s.seit || Date.now(), ms = erwartet(s), weg = Math.max(0, Date.now() - seit);
  const tipps = !s.verlauf.length ? TIPPS[art] || [] : [];
  return `<div class="ueb-denkt warten" data-warten-seit="${seit}" data-warten-ms="${Math.round(ms)}" data-warten-art="${tipps.length ? art : ''}">
    <span class="warten-flamme">${flamme('froh', 30)}</span>
    <div class="warten-in"><div class="warten-kopf"><span>Claude ${esc(was)}</span><span class="muted num" ${sek}>${Math.round(weg / 1000)} s</span></div>
      <div class="warten-balken"><i style="width:${anteilWarten(weg, ms)}%"></i></div>
      ${tipps.length ? `<div class="warten-tipp">${ico('sparkles')}<span>${esc(tipps[Math.floor(weg / 7000) % tipps.length])}</span></div>` : ''}</div></div>`;
}
// Bis zur erwarteten Dauer füllt der Balken 90 %, danach kriecht er langsam gegen 98 %
const anteilWarten = (weg, ms) => Math.round((weg <= ms ? 90 * weg / ms : 90 + 8 * (1 - Math.exp(-(weg - ms) / ms))) * 10) / 10;
export function wartenTick() {
  document.querySelectorAll('.warten[data-warten-seit]').forEach((el) => {
    const weg = Date.now() - +el.dataset.wartenSeit, ms = +el.dataset.wartenMs || 12000;
    const i = el.querySelector('.warten-balken i'); if (i) i.style.width = anteilWarten(weg, ms) + '%';
    const t = el.dataset.wartenArt && el.querySelector('.warten-tipp span'), tipps = TIPPS[el.dataset.wartenArt];
    if (t && tipps) { const neu = tipps[Math.floor(weg / 7000) % tipps.length]; if (t.textContent !== neu) t.textContent = neu; }
  });
}

// ---------------------------------------------------------------- Fokus-Modus (Lernen und Wiederholen)
export const fokusAn = () => G.fokus !== false;
export function fokusUmschalten() { G.fokus = !fokusAn(); speichern(); }
export const fokusKnopf = () => `<button class="btn sm ghost fokus-knopf${fokusAn() ? ' an' : ''}" data-fokus title="${fokusAn() ? 'Fokus-Modus aus: Seitenleiste und Spalte zeigen' : 'Fokus-Modus: nur die Lektion'} (⌘⇧F)">${ico('focus')}Fokus</button>`;

// ---------------------------------------------------------------- Feier nach einer Lektion
// Live nach „Lektion abschließen“: Sterne, Genauigkeit, Zeit, XP zählen hoch, der Level-Balken wächst, Konfetti,
// Vorschau der nächsten Lektion. ↵ = „Nächste Lektion →“, Esc = schließen.
let feierZu = null;
export function feier({ s, naechste, beiNaechste }) {
  schliesseFeier();
  const e = s.ergebnis || {}, score = e.score, st = s.stat || {};
  const lekXp = R.xpLektion(score), frageXp = sitzungXp(s.id), xp = lekXp + frageXp;
  const nach = level(), vor = R.levelVon(Math.max(0, nach.xp - xp)), auf = nach.level > vor.level;
  const n = R.sterne(score);
  const sterneHtml = [1, 2, 3].map((i) => `<span class="feier-stern${i <= n ? ' an' : ''}" style="--i:${i}">${ico('star')}</span>`).join('');
  const genau = score != null ? `${score} %` : '–';
  const el = document.createElement('div');
  el.className = 'feier';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Lektion geschafft');
  el.innerHTML = `<div class="feier-karte" style="${cc(S.byKey[s.kurs])}">
    <div class="feier-flamme">${flamme('jubelnd', 84)}</div>
    <h2 class="feier-t">${score >= 100 ? 'Fehlerfrei!' : n === 3 ? 'Stark gemacht!' : 'Lektion geschafft!'}</h2>
    <p class="muted feier-l">${esc(s.lektion.id)} · ${esc(s.lektion.title)}</p>
    <div class="feier-sterne">${sterneHtml}</div>
    <div class="feier-zahlen">
      <div><b class="num">${genau}</b><span>Genauigkeit${st.fragen ? ` · ${String(Math.round(st.punkte * 10) / 10).replace('.', ',')} von ${st.fragen}` : ''}</span></div>
      <div><b class="num">${e.min || 0} Min.</b><span>Zeit</span></div>
      <div class="gold"><b class="num" data-feier-xp>+0</b><span>XP</span></div>
    </div>
    <div class="feier-level"><div class="feier-lv"><span data-feier-lv>Level ${vor.level} · ${esc(vor.rang)}</span>${auf ? `<span class="chip lvup" data-feier-auf hidden>${ico('crown')}Level ${nach.level}!</span>` : ''}<span class="sp"></span><span class="muted num" data-feier-rest>${auf ? '' : `noch ${nach.rest} XP bis Level ${nach.level + 1}`}</span></div>
      <div class="xp-balken"><i data-feier-balken style="width:${Math.round(vor.anteil * 100)}%"></i></div></div>
    <div class="feier-weiter">${naechste ? `<span class="muted">Als Nächstes</span><span class="feier-n" style="${cc(naechste.c)}"><span class="dot"></span>${esc(naechste.c.short)} · ${esc(naechste.d.id)} ${esc(naechste.d.title)}</span>` : '<span class="muted">Für heute ist hier nichts mehr offen. Zeit für eine Pause oder fürs Wiederholen.</span>'}</div>
    <div class="feier-acts"><button class="btn" data-feier="zu">Fertig für jetzt</button>
      ${naechste ? `<button class="btn los haupt" data-feier="naechste">Nächste Lektion →</button>` : ''}</div></div>`;
  document.body.appendChild(el);
  const zu = () => { schliesseFeier(); hooks.seitenleiste(); };
  const weiter = () => { schliesseFeier(); if (beiNaechste) beiNaechste(); };
  const tasten = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); zu(); }
    else if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); ev.stopImmediatePropagation(); naechste ? weiter() : zu(); }
  };
  document.addEventListener('keydown', tasten, true);
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-feier]');
    if (b) { ev.stopPropagation(); b.dataset.feier === 'naechste' ? weiter() : zu(); }
  });
  feierZu = () => { document.removeEventListener('keydown', tasten, true); el.remove(); feierZu = null; };
  const knopf = el.querySelector('[data-feier="naechste"]') || el.querySelector('[data-feier="zu"]');
  if (knopf) knopf.focus({ preventScroll: true });
  ton.geschafft();
  konfetti({ menge: 160 });
  hochzaehlen(el.querySelector('[data-feier-xp]'), xp, { vor: '+', ms: 1100 });
  const balken = el.querySelector('[data-feier-balken]');
  const ende = () => {
    if (!balken.isConnected) return;
    if (auf) {
      el.querySelector('[data-feier-lv]').textContent = `Level ${nach.level} · ${nach.rang}`;
      el.querySelector('[data-feier-auf]').hidden = false;
      el.querySelector('[data-feier-rest]').textContent = `noch ${nach.rest} XP bis Level ${nach.level + 1}`;
      balken.style.transition = 'none'; balken.style.width = '0%';
      requestAnimationFrame(() => { balken.style.transition = ''; balken.style.width = Math.round(nach.anteil * 100) + '%'; });
      if (!ruhig()) konfetti({ menge: 60 });
    }
  };
  if (ruhig()) { balken.style.width = Math.round((auf ? nach.anteil : nach.anteil) * 100) + '%'; ende(); return; }
  setTimeout(() => { balken.style.width = (auf ? 100 : Math.round(nach.anteil * 100)) + '%'; setTimeout(ende, auf ? 900 : 0); }, 350);
}
export function schliesseFeier() { if (feierZu) feierZu(); }

// ================================================================ Wiederkommen: Seitenleiste, Startseite, Profil
const WT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
// Ring aus einem Kegel-Verlauf wie .ring der Kurse, hier in Gold
const ring = (p, inhalt = '', kl = '') => `<span class="zring ${kl}${p >= 100 ? ' voll' : ''}" style="--p:${Math.max(0, Math.min(100, Math.round(p)))}"><span>${inhalt}</span></span>`;
export function stimmung() {
  const s = serie(), xp = tagesXp();
  if (xp >= G.tagesziel) return 'jubelnd';
  if (!xp && (s.knapp || new Date().getHours() >= 20)) return 'muede';
  return 'froh';
}
const serieText = (s) => `${s.serie} ${s.serie === 1 ? 'Woche' : 'Wochen'}`;
const serieHinweis = (s) => (s.geschafft ? 'Diese Woche geschafft' : s.knapp ? `Knapp: heute noch lernen` : s.moeglich ? `noch ${n_(s.offen, 'Lerntag', 'Lerntage')} diese Woche` : 'diese Woche nicht mehr zu schaffen');

// Karte oben in der Seitenleiste: Level mit Rang, XP-Balken, Wochenserie, Tagesziel-Ring. Klick → Profil.
export function seitenKarte(an = false) {
  if (!geladen || !S.d) return '';
  const lv = level(), s = serie(), xp = tagesXp();
  return `<button class="side-spiel${an ? ' on' : ''}" data-nav="profil" title="Profil: Level, Serie, Abzeichen, Einstellungen fürs Spiel">
    <span class="sk-oben">${flamme(stimmung(), 34)}<span class="sk-lv"><b>Level ${lv.level}</b><span>${esc(lv.rang)}</span></span>
      ${ring(xp / G.tagesziel * 100, `<b class="num">${Math.min(999, xp)}</b>`, 'klein')}</span>
    <span class="xp-balken"><i style="width:${Math.round(lv.anteil * 100)}%"></i></span>
    <span class="sk-unten"><span class="sk-serie${s.knapp ? ' knapp' : ''}">${ico('flame')}${serieText(s)}</span><span class="muted num">${lv.im} / ${lv.braucht} XP</span></span></button>`;
}

// Startseite oben: Tagesziel-Ring, Wochenpunkte Mo–So, Serie und Level
export function leiste() {
  if (!geladen || !S.d) return '';
  const lv = level(), s = serie(), xp = tagesXp(), ziel = G.tagesziel;
  const punkte = s.tage.map((t, i) => `<span class="wp${t.aktiv ? ' an' : ''}${t.heute ? ' heute' : ''}${t.zukunft ? ' spaeter' : ''}" title="${WT[i]} ${t.tag.slice(8)}.${t.tag.slice(5, 7)}.${t.aktiv ? ': Lerntag' : ''}"><i>${t.aktiv ? ico('flame') : ''}</i><small>${WT[i]}</small></span>`).join('');
  return `<div class="spiel-leiste">
    <button class="sl-ziel" data-nav="profil" title="Tagesziel: ${ziel} XP (im Profil einstellbar)">${ring(xp / ziel * 100, `<b class="num">${xp}</b><small>/ ${ziel}</small>`, 'gross')}
      <span class="sl-t"><b>${xp >= ziel ? 'Tagesziel geschafft!' : 'Tagesziel'}</b><span class="muted">${xp >= ziel ? `+${R.XP_TAGESZIEL} XP Bonus` : `noch ${ziel - xp} XP heute`}</span></span></button>
    <div class="sl-woche"><div class="sl-punkte">${punkte}</div>
      <span class="sl-serie${s.knapp ? ' knapp' : ''}">${flamme(s.serie ? (s.knapp ? 'muede' : 'froh') : 'muede', 26)}<span><b>${serieText(s)} Serie</b><span class="muted">${esc(serieHinweis(s))} · Ziel ${G.lerntageZiel} Lerntage</span></span></span></div>
    <button class="sl-level" data-nav="profil" title="Profil öffnen"><span class="sl-lv"><b>Level ${lv.level}</b><span class="muted">${esc(lv.rang)}</span></span>
      <span class="xp-balken"><i style="width:${Math.round(lv.anteil * 100)}%"></i></span><span class="muted num klein">noch ${lv.rest} XP bis Level ${lv.level + 1}</span></button>
  </div>`;
}

// Karte „Tagesquests“: drei Quests und die Truhe
export function questKarte() {
  if (!geladen || !S.d) return '';
  const qs = questsHeute(), offen = truheOffen(), fertig = qs.filter((q) => q.fertig).length;
  return `<div class="card quests"><h3>${ico('sparkles')}Tagesquests<span class="sp"></span><span class="muted mini">neu jeden Tag · ${fertig} von 3</span></h3>
    <div class="quest-reihe">${qs.map((q) => `<div class="quest${q.fertig ? ' fertig' : ''}"><span class="q-ic">${ico(q.fertig ? 'check' : q.icon)}</span>
      <span class="q-t"><b>${esc(q.text)}</b><span class="q-bar"><i style="width:${Math.round(q.ist / q.ziel * 100)}%"></i></span><span class="muted num klein">${q.ist} / ${q.ziel}</span></span>
      <span class="q-xp num">+${q.xp}</span></div>`).join('')}
      <div class="truhe${offen ? ' offen' : ''}" title="${offen ? 'Heute geöffnet' : 'Öffnet sich, wenn alle drei Quests geschafft sind'}">${ico(offen ? 'chestOpen' : 'chest')}<b class="num">+${R.XP_TRUHE}</b><small>${offen ? 'offen' : `${fertig}/3`}</small></div></div></div>`;
}

// ---------------------------------------------------------------- Profil (Route „profil“)
function kalender() {
  const aktiv = aktiveTage(), heute = R.tagVon(), mo = R.montag(heute), start = R.plusTage(mo, -7 * 11);
  let spalten = '';
  for (let w = 0; w < 12; w++) {
    const m = R.plusTage(start, 7 * w);
    const zellen = Array.from({ length: 7 }, (_, i) => {
      const t = R.plusTage(m, i), xp = tagesXp(t), an = aktiv.has(t);
      const stufe = !an ? 0 : xp >= G.tagesziel ? 3 : xp >= G.tagesziel / 2 ? 2 : 1;
      return `<i class="k${stufe}${t === heute ? ' heute' : ''}${t > heute ? ' spaeter' : ''}" title="${t.slice(8)}.${t.slice(5, 7)}.${an ? ` · Lerntag${xp ? ', ' + xp + ' XP' : ''}` : ''}"></i>`;
    }).join('');
    spalten += `<div class="kal-w"><small>${m.slice(5, 7) !== R.plusTage(m, -7).slice(5, 7) || w === 0 ? ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][+m.slice(5, 7) - 1] : ''}</small>${zellen}</div>`;
  }
  return `<div class="kal"><div class="kal-w kal-tage"><small></small>${WT.map((t, i) => `<b>${i % 2 ? '' : t}</b>`).join('')}</div>${spalten}</div>`;
}
const wahl = (feld, werte, fmt = (x) => x) => `<span class="segmente">${werte.map((w) => `<button class="${G[feld] === w ? 'on' : ''}" data-spiel-set="${feld}|${w}">${fmt(w)}</button>`).join('')}</span>`;
const schalter = (feld, titel, text) => `<label class="schalter-zeile"><span><b>${titel}</b><span class="muted">${text}</span></span>
  <button class="schalter${G[feld] !== false ? ' an' : ''}" data-spiel-set="${feld}|${G[feld] !== false ? 'aus' : 'an'}" role="switch" aria-checked="${G[feld] !== false}"><i></i></button></label>`;
export function profil() {
  const lv = level(), s = serie(), ab = abzeichen(), tage = Object.values(G.tage);
  const frei = ab.filter((a) => a.fertig).length;
  const rekorde = [
    ['flame', `${s.rekord} ${s.rekord === 1 ? 'Woche' : 'Wochen'}`, 'längste Wochenserie'], ['bolt', `${G.rekorde.combo || 0}`, 'längste Combo (Prüffragen)'],
    ['star', `${G.rekorde.tagXp || 0} XP`, 'bester Tag'], ['grad', `${lektionen().length}`, 'Lektionen abgeschlossen'],
    ['target', `${tage.reduce((a, t) => a + (t.geloest || 0), 0)}`, 'Aufgaben gelöst'], ['chest', `${tage.filter((t) => t.truhe).length}`, 'Truhen geöffnet'],
  ];
  return `<header class="head drag"><span class="crumb">Profil</span><span class="sp"></span></header>
  <div class="view"><div class="wrap stack">
    <div class="card profil-kopf">${flamme(stimmung(), 88)}<div class="pk-in"><div class="pk-lv">Level ${lv.level} <span>${esc(lv.rang)}</span></div>
      <span class="xp-balken gross"><i style="width:${Math.round(lv.anteil * 100)}%"></i></span>
      <p class="muted"><b class="num">${lv.xp} XP</b> gesamt · noch ${lv.rest} XP bis Level ${lv.level + 1}${lv.naechsterRang ? ` · ab Level ${lv.naechsterRang.level} bist du ${esc(lv.naechsterRang.name)}` : ''}</p></div>
      <div class="pk-serie">${ico('flame')}<b class="num">${s.serie}</b><span>${s.serie === 1 ? 'Woche' : 'Wochen'} Serie</span></div></div>
    <div class="card"><h3>${ico('calendar')}Lerntage der letzten 12 Wochen<span class="sp"></span><span class="muted mini">ein Lerntag: eine Lektion, 5 Min. Wiederholen oder ${R.LERNTAG_XP} XP</span></h3>${kalender()}
      <div class="kal-leg muted mini"><i class="k0"></i>kein Lerntag<i class="k1"></i>Lerntag<i class="k2"></i>halbes Tagesziel<i class="k3"></i>Tagesziel</div></div>
    <h2 class="sec-h">Abzeichen <span class="muted">${frei} von ${ab.length}</span></h2>
    <div class="abz-raster">${ab.map((a) => `<div class="abz${a.fertig ? ' frei' : ''}" title="${esc(a.text)}"><span class="abz-ic">${ico(a.fertig ? a.icon : 'lock')}</span>
      <b>${esc(a.name)}</b><span class="muted">${esc(a.text)}</span>${a.fertig ? `<small class="muted">${a.am ? 'seit ' + a.am.slice(8) + '.' + a.am.slice(5, 7) + '.' : ''}</small>` : `<span class="q-bar"><i style="width:${Math.round(a.ist / a.ziel * 100)}%"></i></span><small class="muted num">${a.ist} / ${a.ziel}</small>`}</div>`).join('')}</div>
    <h2 class="sec-h">Rekorde</h2>
    <div class="rekorde">${rekorde.map(([i, w, t]) => `<div>${ico(i)}<b class="num">${esc(w)}</b><span class="muted">${t}</span></div>`).join('')}</div>
    <h2 class="sec-h">Einstellungen fürs Spiel</h2>
    <div class="card spiel-einst">
      <div class="schalter-zeile"><span><b>Tagesziel</b><span class="muted">XP pro Tag. Eine Lektion bringt 40 bis 120.</span></span>${wahl('tagesziel', [100, 200, 400, 700], (x) => x + ' XP')}</div>
      <div class="schalter-zeile"><span><b>Lerntage je Woche</b><span class="muted">So viele brauchst du, damit die Wochenserie weiterläuft.</span></span>${wahl('lerntageZiel', [3, 4, 5, 6])}</div>
      ${schalter('ton', 'Töne', 'Leise Töne bei Antworten und am Ende einer Lektion')}
      ${schalter('fokus', 'Fokus-Modus', 'In Lernen und Wiederholen nur die Lektion zeigen (⌘⇧F)')}
      ${schalter('erinnern', 'Erinnerungen', 'Mitteilung, wenn ein Lernblock beginnt, und abends, wenn die Serie knapp wird')}
    </div>
  </div></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-spiel-set]');
  if (!b) return;
  const [feld, w] = b.dataset.spielSet.split('|');
  G[feld] = w === 'an' ? true : w === 'aus' ? false : +w;
  speichern(); pruefen(true);
  hooks.zeichnen();
});

// ---------------------------------------------------------------- Begrüßung: einmal, mit dem Stand aus dem bisherigen Verlauf
export function willkommen() {
  if (!geladen || !S.d || G.willkommen || document.querySelector('.willkommen')) return;
  const lv = level(), s = serie(), ab = abzeichen().filter((a) => a.fertig);
  const el = document.createElement('div');
  el.className = 'feier willkommen';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Willkommen');
  el.innerHTML = `<div class="feier-karte">
    <div class="feier-flamme">${flamme('jubelnd', 84)}</div>
    <h2 class="feier-t">Lernhub spielt jetzt mit!</h2>
    <p class="muted feier-l" style="white-space:normal">Für jede Antwort, jede Aufgabe und jede Lektion gibt es XP. Das hast du dir schon erarbeitet:</p>
    <div class="feier-zahlen" style="margin-top:14px">
      <div class="gold"><b class="num">Level ${lv.level}</b><span>${esc(lv.rang)} · ${lv.xp} XP</span></div>
      <div><b class="num">${s.serie}</b><span>${s.serie === 1 ? 'Woche' : 'Wochen'} Serie</span></div>
      <div><b class="num">${ab.length}</b><span>Abzeichen</span></div></div>
    ${ab.length ? `<div class="wk-abz">${ab.slice(0, 10).map((a) => `<span title="${esc(a.name + ': ' + a.text)}">${ico(a.icon)}</span>`).join('')}</div>` : ''}
    <ul class="wk-liste"><li>${ico('sparkles')}<span>Jeden Tag drei <b>Tagesquests</b> und eine Truhe</span></li>
      <li>${ico('flame')}<span><b>Wochenserie</b>: an ${G.lerntageZiel} Tagen pro Woche lernen, Ferien zählen nicht</span></li>
      <li>${ico('focus')}<span><b>Fokus-Modus</b> beim Lernen: nur die Lektion, sonst nichts</span></li></ul>
    <div class="feier-acts"><button class="btn los haupt" data-willkommen>Los geht's</button></div></div>`;
  document.body.appendChild(el);
  const zu = () => { document.removeEventListener('keydown', tasten, true); el.remove(); G.willkommen = true; speichern(); };
  const tasten = (ev) => { if (ev.key === 'Escape' || ev.key === 'Enter') { ev.preventDefault(); ev.stopImmediatePropagation(); zu(); } };
  document.addEventListener('keydown', tasten, true);
  el.querySelector('[data-willkommen]').addEventListener('click', (ev) => { ev.stopPropagation(); zu(); });
  el.querySelector('[data-willkommen]').focus({ preventScroll: true });
  if (ab.length || lv.level > 1) setTimeout(() => konfetti({ menge: 120 }), 150);
}

// ================================================================ Erinnerungen (im Profil abschaltbar)
// Mitteilung über den Hauptprozess (Kanal mitteilung, wie beim ILIAS-Sync): wenn heute ein Lernblock aus dem Kalender
// beginnt (S.d.agenda) und abends ab 19 Uhr, wenn die Wochenserie knapp wird. Jede höchstens einmal (G.erinnert).
let erinnerTakt = null;
export function erinnern() {
  clearInterval(erinnerTakt);
  erinnerTakt = setInterval(erinnernPruefen, 60000);
  setTimeout(erinnernPruefen, 5000);
}
function erinnernPruefen() {
  if (!geladen || !S.d || G.erinnern === false) return;
  const heute = R.tagVon(), jetzt = Date.now();
  G.erinnert = G.erinnert || {};
  for (const [k, t] of Object.entries(G.erinnert)) if (t < R.plusTage(heute, -7)) delete G.erinnert[k];
  const melde = (key, titel, text, nav) => {
    if (G.erinnert[key]) return;
    G.erinnert[key] = heute; speichern();
    try { L.mitteilung({ titel, text, nav }).catch(() => { }); } catch { }
  };
  const ag = S.d.agenda;
  if (ag && ag.date === heute) {
    for (const e of ag.events || []) {
      if (e.kind !== 'block' || !e.startTs) continue;
      const ab = e.startTs * 1000;
      if (jetzt >= ab - 60000 && jetzt < ab + 10 * 60000) {
        const c = S.byKey[e.course];
        melde(`block:${heute}:${e.start}`, 'Dein Lernblock beginnt', `${c ? c.short : e.course || 'Lernen'}: ${n_((e.lessons || []).length, 'Lektion', 'Lektionen')} bis ${e.end} Uhr. Die Flamme wartet schon.`, { name: 'woche' });
      }
    }
  }
  const s = serie(), h = new Date().getHours();
  if (h >= 19 && h < 23 && s.knapp && !s.heuteAktiv && s.serie > 0) {
    melde(`serie:${heute}`, `Deine Serie von ${serieText(s)} wird knapp`, `Diese Woche fehlt noch ${n_(s.offen, 'Lerntag', 'Lerntage')}. Schon 5 Minuten Wiederholen zählen.`, { name: 'woche' });
  }
}
