// Üben („Wiederholen“): eigene Ansicht nach dem Vorbild der LearnHarness-App (practice-dock, practice-cards).
//   - Einstieg: Karte „Wiederholen“ auf „Diese Woche“ (Endloslauf über alle Kurse, laufKarte) und auf jeder
//     Kursseite (kursKarte). Ein Klick startet sofort.
//   - Verlauf: Aufgabenkarte, „Deine Gedanken“, Claudes Text (Hinweis, Urteil, Antwort), Abschlusskarte mit
//     Ergebnis-Chip, Urteil, Musterlösung und Details, „→ Nächste Aufgabe“.
//   - Unten bei offener Aufgabe das Übungsfeld: Aufgabe (einklappbar) + Feld „Deine Gedanken“, ↵ sendet.
//     Ob eine Einsendung eine Antwort ist, liest Claude aus dem Text (wie in LearnHarness). Esc verwirft die Aufgabe.
//   - In der Pause das normale Eingabefeld für Fragen; leer wird der Knopf zu „Nächste Aufgabe →“.
//   - Diktieren: Mikrofon im Feld oder ⌘⇧L (Deepgram, eigener Kanal diktat:*), Esc beendet es zuerst.
// Die Sitzung läuft im Hauptprozess (src/main/ueben.js, claude -p); hier nur Anzeige und Eingaben.
import { esc, ico, cc, n_, $ } from './util.js';
import { S } from './state.js';
import * as A from './aufnahme.js';

const L = window.lernhub;
let hooks = { toast: () => {}, zeichnen: () => {}, nav: () => {}, geaendert: () => {} };
const entwurf = {};            // Kursschlüssel → Text im Feld (überlebt das Neuzeichnen)
const eingeklappt = {};        // Kursschlüssel → Aufgabe im Feld eingeklappt
let uhr = null;
// Diktieren (Deepgram): fertige Sätze gehen ins Feld, Zwischentext darunter
const D = { zustand: 'aus', interim: '', kurs: null, text: '' };

export function init(h) { hooks = { ...hooks, ...h }; }

// ---------------------------------------------------------------- Endloslauf über alle Kurse („Wiederholen“ auf „Diese Woche“)
// Ein Klick, nichts einzustellen, kein Ende: Lernhub wählt nach jeder kleinen Serie selbst den nächsten Kurs.
//   - Serien nach Aufgaben statt nach Minuten: 3 bis 6 Aufgaben je Kurs, je nachdem, wie es läuft (serieUm).
//     Kurz genug, dass die Kurse durchmischt bleiben (Abruf aus dem Inaktiven), lang genug, dass der Wechsel nicht
//     mehr kostet als bringt. Nie eine einzelne Aufgabe und dann der nächste Kurs.
//   - Nächster Kurs = höchster Bedarf, geteilt durch das, was er in diesem Lauf schon bekommen hat. Bedarf: fällige
//     Themen, offene Lücken (× 3), Abstand zum Zielschnitt, nahe Klausur (letzte 4 Wochen). Schwache Kurse kommen
//     so öfter dran, aber keiner fällt ganz heraus.
//   - Die Runde eines Kurses bleibt beim Wechsel offen und geht bei der Rückkehr weiter (kein Neustart); nach
//     FRISCH Aufgaben beginnt sie neu, damit Claude die aktuelle Fälligkeit sieht und der Verlauf klein bleibt.
//   - Ist nichts mehr fällig, zieht Claude die Themen vor, die als Nächstes fällig würden (NAECHSTE in main/ueben.js).
// S.lauf = { cur: Kursschlüssel, n: { Kursschlüssel: erledigte Aufgaben in diesem Lauf }, ab, ziel }
// Was heute schon im Lauf geübt wurde, bleibt über „Runde beenden“ und App-Neustart hinweg gemerkt (localStorage):
// Sonst begänne jeder neue Start wieder beim selben Kurs.
const FRISCH = 12;
const tagHeute = () => new Date().toLocaleDateString('sv');
function heuteN() {
  try { const x = JSON.parse(localStorage.getItem('lauf.heute') || 'null'); return x && x.tag === tagHeute() ? x.n || {} : {}; } catch { return {}; }
}
function merken() {
  if (!S.lauf) return;
  const n = { ...S.lauf.n }, c = S.lauf.cur && S.byKey[S.lauf.cur];
  if (c) n[c.key] = (n[c.key] || 0) + hier(c);
  try { localStorage.setItem('lauf.heute', JSON.stringify({ tag: tagHeute(), n })); } catch { }
}
// practice.heute (aus uebung.json) zählt auch, was auf der Kursseite oder vor einem Neustart geübt wurde
const heuteAlle = () => { const n = heuteN(); for (const c of S.rc) n[c.key] = Math.max(n[c.key] || 0, (c.practice || {}).heute || 0); return n; };
const schon = (c) => (S.lauf ? S.lauf.n : heuteAlle())[c.key] || 0;
const abschluesse = (s) => (s ? s.verlauf.filter((v) => v.art === 'abschluss').length : 0);
function bedarf(c) {
  const p = c.practice || {};
  const rest = Math.max(0, (p.faellig || 0) - schon(c));
  const tage = c.exam ? (Date.parse(c.exam) - Date.now()) / 864e5 : null;
  return 1 + rest + 3 * (p.luecken || 0) + Math.max(0, (c.targetPercent || 80) - (c.avgScore == null ? 80 : c.avgScore)) / 10
    + (tage != null && tage >= 0 && tage <= 28 ? (28 - tage) / 4 : 0);
}
const rang = (c) => bedarf(c) / (1 + schon(c));
const serie = (c) => (Math.max(0, ((c.practice || {}).faellig || 0) - schon(c)) >= 3 ? 3 : 2);
export function reihenfolge() {
  return S.rc.filter((c) => c.done && c.practice).sort((a, b) => rang(b) - rang(a));
}
const zahlText = (p) => [n_(p.faellig || 0, 'Thema', 'Themen') + ' fällig', p.luecken ? n_(p.luecken, 'offene Lücke', 'offene Lücken') : ''].filter(Boolean).join(' · ');
// Karte „Wiederholen“ auf „Diese Woche“: Endloslauf über alle Kurse
export function laufKarte() {
  const r = reihenfolge();
  const kopf = `<h3>${ico('target')}Wiederholen<span class="sp"></span><span class="muted mini">alle Kurse gemischt, ohne Ende</span></h3>`;
  if (!r.length) return `<div class="card modus lauf" id="modus-wiederholen" style="--cc:var(--accent)">${kopf}<div class="modus-t">Noch nichts zu wiederholen</div>
    <p class="modus-m">Wiederholen übt, was du schon gelernt hast. Nach der ersten erledigten Lektion geht es hier los.</p></div>`;
  const war = r.filter((c) => schon(c)).map((c) => c.short);
  const ges = r.reduce((a, c) => ({ faellig: a.faellig + ((c.practice || {}).faellig || 0), luecken: a.luecken + ((c.practice || {}).luecken || 0) }), { faellig: 0, luecken: 0 });
  const chips = r.map((c) => `<button class="chip kurs-chip" style="${cc(c)}" data-ueben="kurs|${esc(c.key)}" title="${esc(c.name)}: ${esc(zahlText(c.practice || {}))}${c.avgScore != null ? ', Ø ' + c.avgScore + ' %' : ''}${sitzung(c) ? ' · Runde läuft' : ''}"><span class="dot"></span>${esc(c.short)}</button>`).join('');
  return `<div class="card modus lauf" id="modus-wiederholen" style="${cc(r[0])}">${kopf}
    <div class="modus-k"><span class="dot"></span>${esc(r[0].name)} zuerst</div>
    <div class="modus-t">${n_(ges.faellig, 'Thema', 'Themen')} fällig</div>
    <div class="modus-m">${esc([`in ${n_(r.length, 'Kurs', 'Kursen')}`, ges.luecken ? n_(ges.luecken, 'offene Lücke', 'offene Lücken') : ''].filter(Boolean).join(' · '))}</div>
    <div class="lauf-in"><div class="lauf-kurse">${chips}</div><span class="sp"></span><button class="btn primary" data-lauf="start">${ico('play')}Los</button></div>
    <p class="muted mini">Start mit ${esc(r[0].short)}${war.length ? `; heute schon dran: ${esc(war.join(', '))}` : ', weil dort am meisten offen ist'}. Nach ein paar Aufgaben wechselt Lernhub von selbst den Kurs: Was fällig oder wacklig ist, kommt öfter. Es läuft, bis du aufhörst.</p></div>`;
}
// Karte „Wiederholen“ auf der Kursseite
export function kursKarte(c) {
  const p = c.practice, s = sitzung(c);
  const kopf = `<h3>${ico('target')}Wiederholen<span class="sp"></span><span class="muted mini">${s ? 'Runde läuft' : 'alles Bisherige, Aufgabe für Aufgabe'}</span></h3>`;
  if (!c.done || !p) return `<div class="card modus" id="modus-wiederholen" style="${cc(c)}">${kopf}<div class="modus-t">Noch nichts zu wiederholen</div>
    <p class="modus-m">Geübt wird, was du schon gelernt hast: nach der ersten erledigten Lektion.</p></div>`;
  return `<div class="card modus" id="modus-wiederholen" style="${cc(c)}">${kopf}
    <div class="modus-t">${n_(p.faellig || 0, 'Thema', 'Themen')} fällig</div>
    <div class="modus-m">${esc([`von ${n_(p.themen || 0, 'Thema', 'Themen')}`, p.luecken ? n_(p.luecken, 'offene Lücke', 'offene Lücken') : 'keine offene Lücke', p.heute ? `heute ${n_(p.heute, 'Aufgabe', 'Aufgaben')}` : ''].filter(Boolean).join(' · '))}</div>
    <div class="acts"><button class="btn primary" data-ueben="kurs|${esc(c.key)}">${ico('play')}${s ? 'Runde fortsetzen' : 'Wiederholen'}</button></div></div>`;
}
// Ein Klick übt: zur Ansicht wechseln, eine offene Runde fortsetzen, sonst eine neue starten (ohne Endloslauf).
export async function direkt(c) {
  if (S.lauf) { merken(); S.lauf = null; }
  hooks.nav({ name: 'ueben', slug: c.slug });
  await laden(c);
  if (!sitzung(c)) { const r = await L.uebenStarten(c.key); if (r && !r.ok) hooks.toast(r.text || 'Runde nicht gestartet.', 'fehler'); }
  hooks.zeichnen();
}
// Alle Kurse: offene Runden (für die Karten und die Seitenleiste)
export async function ladenAlle() {
  try { S.ueb = (await L.uebenUebersicht()) || {}; } catch { }
}
const imLauf = (c) => !!(S.lauf && S.lauf.cur === c.key);
const hier = (c) => Math.max(0, abschluesse(sitzung(c)) - S.lauf.ab);
const laufGesamt = (c) => Object.values(S.lauf.n).reduce((x, y) => x + y, 0) - (S.lauf.vor || 0) + hier(c);   // nur dieser Lauf, ohne das früher am Tag Geübte
function naechsterKurs(c) {
  if (!S.lauf) return null;
  const n = { ...S.lauf.n, [c.key]: (S.lauf.n[c.key] || 0) + hier(c) };       // so rechnen, als wäre die Serie schon gebucht
  const alt = S.lauf.n; S.lauf.n = n;
  const r = reihenfolge().filter((x) => x.key !== c.key);
  S.lauf.n = alt;
  return r[0] || null;
}
// Wann ist eine Serie vorbei? Nicht nach Zeit und nicht nach einer festen Zahl:
//   - mindestens S.lauf.ziel Aufgaben (3; 2, wenn dort kaum etwas fällig ist), damit sich das Eindenken lohnt;
//   - nie nach einem Fehlschlag gehen: Was mit Hinweisen, gar nicht oder mit „erneut prüfen“ endete, kommt erst in
//     neuer Form noch einmal dran (Abruf mit etwas Abstand), und die Serie endet auf einer sauber gelösten Aufgabe;
//   - spätestens nach SERIE_MAX Aufgaben geht es trotzdem weiter. Der Kurs kommt dann früher wieder (Bedarf).
const SERIE_MAX = 6;
function serieUm(c) {
  if (!imLauf(c)) return false;
  const k = hier(c);
  if (k < S.lauf.ziel) return false;
  if (k >= SERIE_MAX) return true;
  const a = sitzung(c).verlauf.filter((v) => v.art === 'abschluss').slice(S.lauf.ab).filter((v) => v.ergebnis !== 'verworfen');
  if (!a.length) return true;
  if (a[a.length - 1].ergebnis !== 'geloest') return false;
  const offen = new Set();                                  // Themen, die in dieser Serie noch eine saubere Lösung schulden
  for (const v of a) { if (v.ergebnis === 'geloest' && !v.wiederholen) offen.delete(v.thema); else offen.add(v.thema); }
  return offen.size === 0;
}
async function kursStart(c) {
  hooks.nav({ name: 'ueben', slug: c.slug });
  await laden(c);
  let s = sitzung(c);
  if (s && s.zustand !== 'denkt' && !offeneAufgabe(s) && (s.stat || {}).aufgaben >= FRISCH) { await L.uebenBeenden(c.key); delete S.ueb[c.key]; s = null; }
  if (!s) { const r = await L.uebenStarten(c.key); if (!r.ok) hooks.toast(r.text || 'Runde nicht gestartet.', 'fehler'); s = null; }
  if (S.lauf) { S.lauf.cur = c.key; S.lauf.ab = abschluesse(s); S.lauf.ziel = serie(c); }
  if (s && s.zustand === 'bereit' && !offeneAufgabe(s)) { const r = await L.uebenSenden(c.key, 'weiter', ''); if (!r.ok) hooks.toast(r.text, 'fehler'); }
  hooks.zeichnen();
}
export async function laufStart() {
  S.lauf = { cur: null, n: heuteAlle(), ab: 0, ziel: 3 };
  S.lauf.vor = Object.values(S.lauf.n).reduce((x, y) => x + y, 0);
  const r = reihenfolge(); if (!r.length) { S.lauf = null; return; }
  await kursStart(r[0]);
}
async function kursWechsel() {
  const alt = aktuell(); if (!S.lauf || !alt) return;
  const neu = naechsterKurs(alt); if (!neu) return;
  verlassen();
  entwurf[alt.key] = '';
  S.lauf.n[alt.key] = (S.lauf.n[alt.key] || 0) + hier(alt);                   // die Runde dort bleibt offen
  await kursStart(neu);
  merken();
}
async function laufEnde(c) {
  const andere = Object.keys(S.lauf.n).filter((k) => k !== c.key);
  merken();
  S.lauf = null;
  for (const k of andere) { await L.uebenBeenden(k); delete S.ueb[k]; }
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-lauf="start"]')) return laufStart();
  const b = e.target.closest('[data-ueben]');
  if (b) { const c = S.byKey[b.dataset.ueben.split('|')[1]]; if (c) direkt(c); }
});
window.addEventListener('pagehide', merken);

const sitzung = (c) => S.ueb[c.key] || null;
const offeneAufgabe = (s) => (s ? [...s.verlauf].reverse().find((v) => v.art === 'aufgabe' && v.offen) : null);

// ---------------------------------------------------------------- Markdown (klein: Absätze, Listen, Code, fett)
export function md(t) {
  const teile = String(t || '').replace(/\r/g, '').split(/```/);
  return teile.map((p, i) => {
    if (i % 2) { const code = p.replace(/^[\w+-]*\n/, '').replace(/\n$/, ''); return `<pre class="ueb-code">${esc(code)}</pre>`; }
    return p.split(/\n{2,}/).map((block) => {
      const zeilen = block.split('\n').filter((z) => z.trim() !== '');
      if (!zeilen.length) return '';
      // Code-Spans zuerst herauslösen, damit Sternchen darin (*.md) unangetastet bleiben; nur **fett**, keine Kursivschrift
      const inline = (z) => z.split(/(`[^`]+`)/).map((x, j) => (j % 2 ? `<code>${esc(x.slice(1, -1))}</code>`
        : esc(x).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'))).join('');
      // einfache Tabelle: Zeilen mit |, zweite Zeile ist die Trennzeile
      if (zeilen.length >= 2 && zeilen.every((z) => z.includes('|')) && /^[\s|:-]+$/.test(zeilen[1]) && zeilen[1].includes('-')) {
        const zellen = (z) => z.trim().replace(/^\||\|$/g, '').split('|').map((x) => inline(x.trim()));
        return `<table class="ueb-tab"><tr>${zellen(zeilen[0]).map((x) => `<th>${x}</th>`).join('')}</tr>${zeilen.slice(2).map((z) => `<tr>${zellen(z).map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</table>`;
      }
      // aufeinanderfolgende Listenzeilen werden eine Liste, alles andere Absätze (auch „Satz, direkt darunter die Liste“)
      const LI = /^\s*([-*]|\d+[.)])\s+/, teile = [];
      for (const z of zeilen) {
        const art = LI.test(z) ? (/^\s*\d/.test(z) ? 'ol' : 'ul') : 'p', letzter = teile[teile.length - 1];
        if (letzter && letzter.art === art) letzter.z.push(z); else teile.push({ art, z: [z] });
      }
      return teile.map((t) => (t.art === 'p' ? `<p>${t.z.map(inline).join('<br>')}</p>`
        : `<${t.art} class="ueb-liste">${t.z.map((z) => `<li>${inline(z.replace(LI, ''))}</li>`).join('')}</${t.art}>`)).join('');
    }).join('');
  }).join('');
}

// ---------------------------------------------------------------- Bausteine
const ERG = {
  geloest: ['Gelöst', 'ok'], hinweise: ['Mit Hinweisen gelöst', 'warn'], weiter: ['Weitergegangen', ''],
  aufgegeben: ['Aufgegeben', 'bad'], verworfen: ['Verworfen', ''],
};
const MODUS = { abruf: 'Abruf', unterscheidung: 'Unterscheidung', verknuepfung: 'Verknüpfung' };

function eintrag(e) {
  if (e.von === 'ich') {
    if (e.art === 'weiter') return `<div class="ueb-weiter">→ Nächste Aufgabe</div>`;
    if (e.art === 'denken') return `<div class="ueb-ich"><div class="ueb-gedanken"><div class="ueb-eyebrow">Deine Gedanken</div><div class="ueb-prose sel">${md(e.text)}</div></div></div>`;
    return `<div class="ueb-ich"><div class="ueb-blase sel">${md(e.text)}</div></div>`;
  }
  if (e.art === 'aufgabe') {
    return `<div class="ueb-karte"><div class="ueb-eyebrow">Aufgabe ${e.nr || ''}</div><div class="ueb-prose ueb-gross sel">${md(e.aufgabe)}</div></div>`;
  }
  if (e.art === 'abschluss') {
    if (e.ergebnis === 'verworfen') return `<div class="ueb-leise">Aufgabe verworfen.</div>`;
    const [lbl, art] = ERG[e.ergebnis] || ERG.weiter;
    const details = [
      e.modus && ['Modus', MODUS[e.modus] || e.modus], e.thema && ['Thema', e.thema],
      ['Hinweisstufe', e.stufe || 'keine'], e.fehlerart && ['Fehlerart', e.fehlerart],
      ['Erneut prüfen', e.wiederholen ? 'ja' : 'nein'], e.log && ['Eingetragen', e.log],
    ].filter(Boolean);
    return `<div class="ueb-karte"><div class="ueb-eyebrow">Abgeschlossen <span class="chip ${art}">${lbl}</span></div>
      ${e.urteil ? `<div class="ueb-urteil ueb-prose sel">${md(e.urteil)}</div>` : ''}
      ${e.musterloesung ? `<div class="ueb-trenner"></div><div class="ueb-eyebrow">Musterlösung</div><div class="ueb-prose ueb-gross sel">${md(e.musterloesung)}</div>` : ''}
      <details class="ueb-meta"><summary>Details</summary><dl>${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details></div>`;
  }
  return `<div class="ueb-claude ueb-prose sel">${md(e.text)}</div>`;
}

function statZeile(s) {
  const st = s.stat || {};
  const bewertet = (st.geloest || 0) + (st.hinweise || 0) + (st.weiter || 0) + (st.aufgegeben || 0);
  const quote = bewertet ? Math.round(((st.geloest || 0) + 0.5 * (st.hinweise || 0)) / bewertet * 100) : null;
  const t = [n_(st.aufgaben || 0, 'Aufgabe', 'Aufgaben')];
  if (st.geloest) t.push(`${st.geloest} gelöst`);
  if (st.hinweise) t.push(`${st.hinweise} mit Hinweisen`);
  if (st.aufgegeben || st.weiter) t.push(`${(st.aufgegeben || 0) + (st.weiter || 0)} aufgegeben`);
  if (quote != null) t.push(`${quote} %`);
  return t.join(' · ');
}

function denktZeile(s) {
  const sek = Math.max(0, Math.round((Date.now() - (s.seit || Date.now())) / 1000));
  const was = !s.verlauf.length ? 'sucht das erste Thema aus und stellt eine Aufgabe' : 'denkt';
  return `<div class="ueb-denkt"><span class="ueb-punkte"><i></i><i></i><i></i></span>Claude ${was} <span class="muted num" data-ueb-uhr>${sek} s</span></div>`;
}

// ---------------------------------------------------------------- Ansicht
export function ansicht(c) {
  const s = sitzung(c);
  const kopf = `<header class="head drag"><span class="crumb"><span class="nodrag" style="${cc(c)}"><span class="dot" style="display:inline-block;margin-right:7px"></span></span>${esc(c.name)} · Wiederholen</span>
    ${s ? `<span class="chip acc">${ico('target')}${imLauf(c) ? `Endloslauf · ${n_(laufGesamt(c), 'Aufgabe', 'Aufgaben')} geschafft` : 'Üben'}</span><span class="muted num ueb-stat">${esc(statZeile(s))}</span>` : ''}
    <span class="sp"></span>
    ${s ? `<button class="btn sm ghost" data-ueb="ende" title="Runde beenden">${ico('stop')}Runde beenden</button>` : ''}
    <button class="btn sm ghost" data-nav="kurs:${c.slug}">${ico('arrowLeft')}Zum Kurs</button></header>`;
  if (!s) return kopf + start(c);
  const a = offeneAufgabe(s);
  return kopf + `<div class="view ueb-view" id="ueb-view"><div class="ueb-wrap" style="${cc(c)}">
    <div class="ueb-verlauf">${s.verlauf.map(eintrag).join('')}
    ${s.zustand === 'denkt' ? denktZeile(s) : ''}
    ${s.zustand === 'fehler' ? `<div class="note"><span>${ico('alert')}</span><span>Claude hat nicht geantwortet: ${esc(s.fehler || '')}</span><span class="sp"></span><button class="btn sm" data-ueb="nochmal">${ico('refresh')}Nochmal versuchen</button></div>` : ''}
    </div></div></div>` + dock(c, s, a);
}

function start(c) {
  return `<div class="view"><div class="wrap" style="${cc(c)}"><div class="ueb-start card">
    <div class="ueb-eyebrow">${ico('target')} Üben</div>
    <h1 class="title">Alles Bisherige wiederholen</h1>
    <p class="ueb-prose">Claude stellt dir Aufgaben zu allem, was du in ${esc(c.name)} schon gelernt hast: eine nach der anderen, Themen gemischt, jede ein neuer Fall. Du schreibst deine Gedanken, und Claude gibt dir statt der Lösung kleine Hinweise, bis du es selbst schaffst. Nach jeder Aufgabe siehst du die Musterlösung und kannst nachfragen.</p>
    ${c.practice ? `<p class="muted">${esc(zahlText(c.practice))} von ${n_(c.practice.themen || 0, 'Thema', 'Themen')}.</p>` : ''}
    <div class="acts"><button class="btn primary" data-ueb="start">${ico('play')}Runde starten</button></div>
    <p class="muted klein">Offene Lücken und lange nicht geübte Themen kommen zuerst. Was du sauber löst, kommt später wieder (1, 3, 7, 14, 30 Tage).</p>
  </div></div></div>`;
}

function dock(c, s, a) {
  const denkt = s.zustand === 'denkt';
  const t = entwurf[c.key] || '';
  if (a) {
    const zu = !!eingeklappt[c.key];
    return `<div class="ueb-dock" style="${cc(c)}"><div class="ueb-dock-in">
      <button class="ueb-dock-kopf" data-ueb="klappen" title="${zu ? 'Aufgabe zeigen' : 'Aufgabe einklappen'}"><span class="ueb-eyebrow">Aufgabe ${a.nr || ''}</span>${zu ? `<span class="ueb-kurz">${esc(String(a.aufgabe).replace(/\s+/g, ' ').slice(0, 140))}</span>` : ''}<span class="sp"></span>${ico('chevron', zu ? 'rot-hoch' : 'rot-runter')}</button>
      ${zu ? '' : `<div class="ueb-dock-aufgabe ueb-prose sel">${md(a.aufgabe)}</div>`}
      <div class="ueb-feld"><div class="ueb-eyebrow">Deine Gedanken</div>
        <textarea id="ueb-text" rows="4" placeholder="Hier arbeiten, laut denken." spellcheck="true" ${denkt ? 'disabled' : ''}>${esc(t)}</textarea>${zwischen()}</div>
      <div class="ueb-zeile">${mic()}<span class="muted klein">↵ sendet · ⇧↵ neue Zeile · ${D.zustand === 'aus' || D.zustand === 'fehler' ? 'Esc verwirft die Aufgabe' : 'Esc beendet das Diktieren'}</span><span class="sp"></span>
        <button class="btn primary sm" data-ueb="senden" ${denkt || !t.trim() ? 'disabled' : ''}>Gedanken senden</button></div>
    </div></div>`;
  }
  const weiter = !t.trim() && (s.stat && s.stat.aufgaben);
  const wechsel = serieUm(c) ? naechsterKurs(c) : null;                   // Serie vorbei: Lernhub wechselt den Kurs
  return `<div class="ueb-dock" style="${cc(c)}"><div class="ueb-dock-in ueb-pause">
    <textarea id="ueb-text" rows="2" placeholder="Fragen, antworten oder die Runde lenken …" spellcheck="true" ${denkt ? 'disabled' : ''}>${esc(t)}</textarea>${zwischen()}
    <div class="ueb-zeile">${mic()}<span class="muted klein">${weiter && wechsel ? `Serie geschafft · ↵ weiter mit ${esc(wechsel.short)}, damit es gemischt bleibt` : weiter ? '↵ auf leerem Feld: nächste Aufgabe' : '↵ sendet · ⇧↵ neue Zeile'}</span><span class="sp"></span>
      ${weiter && wechsel ? `<button class="btn ueb-naechste" data-ueb="kurswechsel" ${denkt ? 'disabled' : ''}>Nächste Aufgabe · ${esc(wechsel.short)} →</button>`
    : weiter ? `<button class="btn ueb-naechste" data-ueb="weiter" ${denkt ? 'disabled' : ''}>Nächste Aufgabe →</button>`
    : `<button class="btn primary sm" data-ueb="senden" ${denkt || !t.trim() ? 'disabled' : ''}>Senden</button>`}</div>
  </div></div>`;
}

function mic() {
  const z = D.zustand;
  if (z === 'laeuft') return `<button class="mic an" data-ueb="diktat" title="Diktieren beenden (⌘⇧L)"><span class="pegel" id="ueb-pegel"><i></i><i></i><i></i><i></i><i></i></span>Hört zu</button>`;
  if (z === 'verbindet') return `<button class="mic" data-ueb="diktat" title="Verbindet …">${ico('mic')}Verbindet …</button>`;
  return `<button class="mic${z === 'fehler' ? ' err' : ''}" data-ueb="diktat" title="${esc(z === 'fehler' ? D.text : 'Gedanken diktieren (⌘⇧L)')}">${ico('mic')}Diktieren</button>`;
}
const zwischen = () => `<div class="ueb-zwischen" id="ueb-zwischen">${esc(D.interim)}</div>`;

// ---------------------------------------------------------------- Diktieren
function anhaengen(c, text) {
  text = String(text || '').trim(); if (!text) return;
  const alt = entwurf[c.key] || '';
  entwurf[c.key] = alt + (alt && !/\s$/.test(alt) ? ' ' : '') + text;
  const ta = $('#ueb-text');
  if (ta) {
    ta.value = entwurf[c.key];
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 260) + 'px';
    ta.scrollTop = ta.scrollHeight;
    const s = sitzung(c);
    if (s && !offeneAufgabe(s) && !alt.trim()) { hooks.zeichnen(); return; }   // Knopf: Nächste Aufgabe → Senden
    const k = document.querySelector('.ueb-dock [data-ueb="senden"]');
    if (k) k.disabled = !entwurf[c.key].trim() || (s && s.zustand === 'denkt');
  }
}
function pegel(v) {
  const p = $('#ueb-pegel'); if (!p) return;
  [...p.children].forEach((i, n) => { i.style.height = Math.max(15, Math.min(100, v * 100 * (0.6 + 0.4 * Math.sin((n + 1) * 1.7 + Date.now() / 120)))) + '%'; });
}
export async function diktatUmschalten() {
  const c = aktuell(); if (!c) return;
  if (D.zustand === 'laeuft' || D.zustand === 'verbindet' || A.laeuft()) return diktatAus();
  if (!S.schluessel) { hooks.toast('Für das Diktieren fehlt der Deepgram-Schlüssel (Einstellungen).', 'fehler'); return; }
  D.kurs = c.key; D.zustand = 'verbindet'; D.interim = ''; hooks.zeichnen();
  try { await A.starten(pegel); } catch (e) {
    D.zustand = 'fehler'; D.text = 'Mikrofon nicht verfügbar: ' + e.message; hooks.toast(D.text, 'fehler'); hooks.zeichnen(); return;
  }
  const r = await L.diktatStart();
  if (!r || !r.ok) { await A.stoppen(); D.zustand = 'fehler'; D.text = (r && r.text) || 'Start fehlgeschlagen'; hooks.zeichnen(); return; }
  A.los();
}
export async function diktatAus() {
  const c = D.kurs && S.byKey[D.kurs];
  await A.stoppen();
  await L.diktatStopp();
  if (c && D.interim) anhaengen(c, D.interim);       // angefangener Satz geht nicht verloren
  D.interim = '';
  if (D.zustand !== 'fehler') D.zustand = 'aus';
  if (S.route.name === 'ueben') hooks.zeichnen();
}
export function verlassen() { if (D.zustand !== 'aus' && D.zustand !== 'fehler') diktatAus(); }
L.on.diktatStatus((x) => {
  if (S.route.name === 'lernen') return;              // dort diktiert die Lernen-Ansicht (js/lernen.js)
  if (x.zustand === 'aus' && D.zustand === 'fehler') return;
  D.zustand = x.zustand; D.text = x.text || '';
  if (x.zustand === 'fehler') { A.stoppen(); hooks.toast(x.text, 'fehler'); }
  if (x.zustand === 'aus') D.interim = '';
  if (S.route.name === 'ueben') hooks.zeichnen();
});
L.on.diktatText((x) => {
  if (S.route.name === 'lernen') return;
  const c = D.kurs && S.byKey[D.kurs]; if (!c) return;
  if (x.final) { D.interim = ''; anhaengen(c, x.text); }
  else D.interim = x.text;
  const z = $('#ueb-zwischen'); if (z) z.textContent = D.interim;
});

// Nach dem Einsetzen ins DOM: ans Ende scrollen, Feld fokussieren, Uhr fürs Warten
export function verdrahten(c, { fokus = true } = {}) {
  const v = $('#ueb-view');
  if (v) v.scrollTop = v.scrollHeight;
  const ta = $('#ueb-text');
  if (ta) {
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 260) + 'px';
    if (fokus && !ta.disabled) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  clearInterval(uhr);
  const s = sitzung(c);
  if (s && s.zustand === 'denkt') {
    uhr = setInterval(() => {
      const el = document.querySelector('[data-ueb-uhr]');
      if (!el || S.route.name !== 'ueben') return clearInterval(uhr);
      el.textContent = Math.round((Date.now() - (s.seit || Date.now())) / 1000) + ' s';
    }, 1000);
  }
}

// ---------------------------------------------------------------- Daten
export async function laden(c) {
  S.ueb[c.key] = await L.uebenStand(c.key);
}
export function stand(s) {
  if (!s) return;
  const vorher = !!S.ueb[s.kurs];
  if (s.zustand === 'beendet') delete S.ueb[s.kurs]; else S.ueb[s.kurs] = s;
  const c = S.byKey[s.kurs];
  if (c && S.route.name === 'ueben' && S.route.slug === c.slug) hooks.zeichnen();
  else if (vorher !== !!S.ueb[s.kurs]) hooks.geaendert();    // Karten und Seitenleiste zeigen, dass eine Runde läuft
}

// ---------------------------------------------------------------- Aktionen
const aktuell = () => (S.route.name === 'ueben' ? S.bySlug[S.route.slug] : null);

async function aktion(was) {
  const c = aktuell(); if (!c) return;
  const s = sitzung(c);
  if (was === 'start') {
    const r = await L.uebenStarten(c.key);
    if (!r.ok) hooks.toast(r.text || 'Runde nicht gestartet.', 'fehler');
    return;
  }
  if (was === 'diktat') { diktatUmschalten(); return; }
  if (was === 'kurswechsel') { kursWechsel(); return; }
  if (was === 'klappen') { eingeklappt[c.key] = !eingeklappt[c.key]; hooks.zeichnen(); return; }
  if (!s) return;
  if (was === 'nochmal') { L.uebenNochmal(c.key); return; }
  if (was === 'ende') {
    verlassen();
    const r = await L.uebenBeenden(c.key);
    if (imLauf(c)) await laufEnde(c);                 // „Runde beenden“ beendet den Endloslauf samt der offenen Runden der anderen Kurse
    if (r.ok) { delete S.ueb[c.key]; hooks.toast(s.stat && s.stat.aufgaben ? `Runde beendet: ${statZeile(s)}.` : 'Runde beendet.'); hooks.zeichnen(); }
    return;
  }
  if (was === 'weiter') { entwurf[c.key] = ''; const r = await L.uebenSenden(c.key, 'weiter', ''); if (!r.ok) hooks.toast(r.text, 'fehler'); return; }
  if (was === 'senden') {
    if (D.interim && D.kurs === c.key) { anhaengen(c, D.interim); D.interim = ''; }
    const t = (entwurf[c.key] || '').trim();
    if (!t) return;
    const r = await L.uebenSenden(c.key, offeneAufgabe(s) ? 'denken' : 'text', t);
    if (r.ok) entwurf[c.key] = ''; else hooks.toast(r.text, 'fehler');
  }
}

function verwerfenFragen(c) {
  const ov = document.createElement('div');
  ov.className = 'overlay bew';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-label="Aufgabe verwerfen?" style="width:420px">
    <h3>Aufgabe verwerfen?</h3><p class="muted" style="margin:6px 0 16px">Die Aufgabe fällt weg, eine Lösung gibt es nicht.</p>
    <div class="acts" style="justify-content:flex-end"><button class="btn ghost" data-v="0">Abbrechen</button><button class="btn primary" data-v="1">Verwerfen</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-v="1"]').focus();
  ov.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-v]');
    if (!b && e.target !== ov) return;
    ov.remove();
    if (b && b.dataset.v === '1') { entwurf[c.key] = ''; await L.uebenVerwerfen(c.key); }
  });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ueb]');
  if (b && !b.disabled) { e.stopPropagation(); aktion(b.dataset.ueb); }
}, true);

document.addEventListener('input', (e) => {
  if (e.target.id !== 'ueb-text') return;
  const c = aktuell(); if (!c) return;
  const vorher = !!(entwurf[c.key] || '').trim();
  entwurf[c.key] = e.target.value;
  const ta = e.target; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 260) + 'px';
  const s = sitzung(c);
  if (s && !offeneAufgabe(s) && vorher !== !!e.target.value.trim()) { hooks.zeichnen(); return; }   // Knopf wechselt (Senden ↔ Nächste Aufgabe)
  const k = document.querySelector('.ueb-dock [data-ueb="senden"]');
  if (k) k.disabled = !e.target.value.trim() || (s && s.zustand === 'denkt');
});

document.addEventListener('keydown', (e) => {
  const c = aktuell(); if (!c) return;
  const s = sitzung(c); if (!s) return;
  if (document.querySelector('.overlay')) return;
  if (e.key === 'Escape' && (D.zustand === 'laeuft' || D.zustand === 'verbindet')) { e.preventDefault(); e.stopImmediatePropagation(); diktatAus(); return; }
  // stopImmediatePropagation: der Esc-Handler in app.js würde den Dialog sonst sofort wieder schließen
  if (e.key === 'Escape' && offeneAufgabe(s) && s.zustand !== 'denkt') { e.preventDefault(); e.stopImmediatePropagation(); verwerfenFragen(c); return; }
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  const imFeld = e.target && e.target.id === 'ueb-text';
  if (!imFeld && e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (s.zustand === 'denkt') { if (imFeld) e.preventDefault(); return; }
  const t = (entwurf[c.key] || '').trim();
  if (!offeneAufgabe(s) && !t && s.stat && s.stat.aufgaben) { e.preventDefault(); aktion(serieUm(c) && naechsterKurs(c) ? 'kurswechsel' : 'weiter'); return; }
  if (imFeld || e.metaKey) { e.preventDefault(); if (t) aktion('senden'); }
});
