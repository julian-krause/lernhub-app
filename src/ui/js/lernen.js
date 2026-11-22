// Lernen: die nächste Lektion der Roadmap im Gespräch lernen (Lehrmodus der LearnHarness-App, Kompakt-Fassung).
//   - Einstieg: Karte „Lernen“ auf „Diese Woche“ (Lernhub wählt Kurs und Lektion nach dem Plan, karte/reihenfolge)
//     und auf jeder Kursseite (kursKarte). Ein Klick startet sofort (los).
//   - Verlauf: Claudes Unterricht, Fragekarte (Auswahl oder frei, Prüffrage oder Vorhersage), deine Gedanken,
//     am Ende die Rückschau mit „Lektion abschließen“.
//   - Unten das Feld: Sicherheit, „Deine Gedanken“ (oder eine Rückfrage), ↵ sendet. Auswahl per Klick oder 1–4.
//   - Rechts: der Plan dieser Lektion mit Lektionsuhr und die Roadmap des Kurses.
//   - Diktieren: Mikrofon im Feld oder ⌘⇧L (Deepgram, Kanal diktat:* wie in der Übungsansicht).
// Die Sitzung läuft im Hauptprozess (src/main/lernen.js, claude -p); hier nur Anzeige und Eingaben.
import { esc, ico, cc, n_, $, pd, fDM, addDays, isoWeek, flamme } from './util.js';
import { S } from './state.js';
import { md } from './ueben.js';
import * as A from './aufnahme.js';
import * as Sp from './spiel.js';
import { ton } from './effekte.js';

const L = window.lernhub;
let hooks = { toast: () => {}, zeichnen: () => {}, nav: () => {}, geaendert: () => {} };
const entwurf = {};            // Kursschlüssel → Text im Feld
const wahl = {};               // Kursschlüssel → gewählte Option der offenen Frage
const sicher = {};             // Kursschlüssel → sicher | unsicher | geraten
const gesehen = {};            // Kursschlüssel → Zahl der Verlaufseinträge beim letzten Zeichnen (fürs Scrollen)
let uhr = null;
const D = { zustand: 'aus', interim: '', kurs: null, text: '' };
// Spiel: Rückmeldung zu Fragen, die du in dieser Ansicht beantwortet hast (<Sitzung>:f<nr> → { text, art }),
// und was beim nächsten Zeichnen einmal aufleuchten soll (Puls, Wackeln, „+n XP“)
const rueck = {};
const einmal = new Set();

export function init(h) { hooks = { ...hooks, ...h }; }

const eintrag = (c) => S.lern[c.key] || null;
const sitzung = (c) => { const e = eintrag(c); return e ? e.sitzung : null; };
const ziel = (c) => (eintrag(c) || {}).ziel || {};
// Sitzung, an der noch gelernt wird (eine eingetragene zählt nicht mehr)
const aktiv = (c) => { const s = sitzung(c); return s && s.zustand !== 'erledigt' ? s : null; };
// Gerade eingetragen, aber hub.py kennt den Abschluss noch nicht: zählt fürs Wochenpensum schon mit
const gebucht = (c) => { const s = sitzung(c); return !!(s && s.zustand === 'erledigt' && !(c.byId[s.lektion.id] || {}).done); };
const offeneFrage = (s) => (s ? [...s.verlauf].reverse().find((v) => v.art === 'frage' && v.offen && !v.beantwortet) : null);
const BUCHSTABE = (i) => String.fromCharCode(65 + i);
const PAUSE_MAX = 10 * 60000;

function minuten(s) {
  if (s.ergebnis) return s.ergebnis.min;
  const zeiten = [s.start, ...s.verlauf.map((v) => v.t).filter(Boolean)];
  if (!s.ende) zeiten.push(Date.now());
  let ms = 0;
  for (let i = 1; i < zeiten.length; i++) ms += Math.min(PAUSE_MAX, Math.max(0, zeiten[i] - zeiten[i - 1]));
  return Math.max(0, Math.round(ms / 60000));
}
function statText(s) {
  const st = s.stat || {};
  if (!st.fragen) return '';
  const p = Math.round(st.punkte * 10) / 10;
  return `${String(p).replace('.', ',')} von ${n_(st.fragen, 'Prüffrage', 'Prüffragen')} richtig`;
}

// ---------------------------------------------------------------- Einstieg: was ist dran, in welchem Kurs?
// Die Lektion, die in einem Kurs dran ist: die laufende Sitzung, sonst die nächste der Roadmap (lernen.js ziel).
export function dran(c) {
  const s = aktiv(c), z = ziel(c);
  if (s) return { id: s.lektion.id, title: s.lektion.title, chapter: s.lektion.chapter, sources: s.lektion.sources, budget: s.budget, training: s.lektion.training, sitzung: s };
  return z.id ? { ...z, sitzung: null } : null;
}
export const grund = (c) => ziel(c).grund || '';

// Reihenfolge über alle Kurse, ohne Einstellung: erst, woran du schon sitzt; dann der Lernblock von heute im
// Kalender; dann der Kurs mit dem größten offenen Wochenpensum (Rückstand zuerst); zuletzt Vorlernen.
export function reihenfolge() {
  const ag = S.d.agenda;
  const bloecke = ag && ag.date === S.d.today ? ag.events.filter((e) => e.kind === 'block' && e.course) : [];
  return S.rc.map((c, i) => {
    const d = dran(c);
    if (!d) return null;
    const heute = bloecke.findIndex((e) => e.course === c.key && e.lessons.includes(d.id));
    const rest = Math.max(0, (c.quota || 0) - (c.doneThis || 0) - (gebucht(c) ? 1 : 0));
    const rang = d.sitzung ? 0 : heute >= 0 ? 1 : rest > 0 ? 2 : 3;
    return { c, d, rang, heute, rest, i, block: heute >= 0 ? bloecke[heute] : null };
  }).filter(Boolean).sort((a, b) => a.rang - b.rang || a.heute - b.heute || b.rest - a.rest || (b.c.alarm ? 1 : 0) - (a.c.alarm ? 1 : 0) || a.i - b.i);
}
function warum(x) {
  if (x.rang === 0) return 'weil du dort mittendrin bist';
  if (x.rang === 1) return `weil heute ab ${x.block.start} Uhr der Lernblock im Kalender steht`;
  if (x.rang === 2) return `weil dort diese Woche noch ${n_(x.rest, 'Lektion', 'Lektionen')} offen ${x.rest === 1 ? 'ist' : 'sind'}`;
  return 'zum Vorlernen, das Wochenpensum ist geschafft';
}
function standText(s) {
  const t = [];
  if (s.plan && s.plan.length) t.push(`Schritt ${Math.min(Math.max(1, s.schritt), s.plan.length)} von ${s.plan.length}`);
  t.push(`${minuten(s)} von ${s.budget} Min.`);
  return t.join(' · ');
}
const zielMeta = (d) => [`ca. ${d.budget} Min.`, d.chapter ? 'Kap. ' + d.chapter : '', d.sources || '', d.training ? 'Klausurtraining' : ''].filter(Boolean).join(' · ');

// Karte „Lernen“ auf „Diese Woche“: ein Klick lernt die Lektion, die nach dem Plan dran ist.
export function karte() {
  const r = reihenfolge();
  const chips = S.rc.map((c) => {
    const d = dran(c);
    return d ? `<button class="chip kurs-chip" style="${cc(c)}" data-lernen="kurs|${esc(c.key)}" title="${esc(`${c.name}: ${d.id} ${d.title}${d.sitzung ? ' · läuft' : ''}`)}"><span class="dot"></span>${esc(c.short)}${d.sitzung ? ' · läuft' : ''}</button>`
      : `<span class="chip kurs-chip aus" style="${cc(c)}" title="${esc(`${c.name}: ${grund(c) || 'nichts zu lernen'}`)}"><span class="dot"></span>${esc(c.short)}</span>`;
  }).join('');
  const kopf = `<h3>${ico('grad')}Lernen<span class="sp"></span><span class="muted mini">neuer Stoff im Gespräch</span></h3>`;
  if (!r.length) {
    return `<div class="card modus" id="modus-lernen" style="--cc:var(--accent)">${kopf}
      <div class="modus-t">Gerade nichts zu lernen</div>
      <p class="modus-m">${S.rc.map((c) => `${esc(c.short)}: ${esc(grund(c) || 'alle Lektionen erledigt')}`).join(' · ')}</p>
      <div class="lauf-in"><div class="lauf-kurse">${chips}</div></div></div>`;
  }
  const x = r[0], d = x.d;
  return `<div class="card modus" id="modus-lernen" style="${cc(x.c)}">${kopf}
    <div class="modus-k"><span class="dot"></span>${esc(x.c.name)}${x.rang === 3 ? ' · vorlernen' : ''}</div>
    <div class="modus-t">${esc(d.id)} · ${esc(d.title)}</div>
    <div class="modus-m" title="${esc(d.sources || '')}">${esc(d.sitzung ? standText(d.sitzung) : zielMeta(d))}</div>
    <div class="lauf-in"><div class="lauf-kurse">${chips}</div><span class="sp"></span>
      <button class="btn los haupt" data-lernen="lauf">${ico('play')}${d.sitzung ? 'Weiterlernen' : 'Los'}</button></div>
    <p class="muted mini">Start mit ${esc(x.c.short)}, ${esc(warum(x))}. Nach jeder Lektion schlägt Lernhub die nächste vor. Ein Klick auf einen Kurs lernt dort.</p></div>`;
}

// Karte „Lernen“ auf der Kursseite
export function kursKarte(c) {
  const d = dran(c);
  const kopf = `<h3>${ico('grad')}Lernen<span class="sp"></span><span class="muted mini">${d ? (d.sitzung ? 'läuft' : `ca. ${d.budget} Min.`) : 'neuer Stoff im Gespräch'}</span></h3>`;
  if (!d) return `<div class="card modus" id="modus-lernen" style="${cc(c)}">${kopf}<div class="modus-t">Gerade nichts zu lernen</div><p class="modus-m">${esc(grund(c) || 'Alle Lektionen dieses Kurses sind erledigt.')}</p></div>`;
  const s = d.sitzung;
  return `<div class="card modus" id="modus-lernen" style="${cc(c)}">${kopf}
    <div class="modus-t">${esc(d.id)} · ${esc(d.title)}</div>
    <div class="modus-m" title="${esc(d.sources || '')}">${esc(s ? standText(s) : [d.chapter ? 'Kap. ' + d.chapter : '', d.sources || '', d.training ? 'Klausurtraining' : ''].filter(Boolean).join(' · ') || 'nächste Lektion der Roadmap')}</div>
    ${s ? `<div class="lrn-uhr"><span class="bar"><i style="width:${Math.min(100, Math.round(minuten(s) / s.budget * 100))}%"></i></span></div>` : ''}
    <div class="acts"><button class="btn los haupt" data-lernen="kurs|${esc(c.key)}">${ico('play')}${s ? 'Weiterlernen' : 'Lernen starten'}</button></div></div>`;
}

// Ein Klick lernt: zur Ansicht wechseln, eine laufende Sitzung fortsetzen, sonst die nächste Lektion starten.
export async function los(c, { lauf = false } = {}) {
  hooks.nav({ name: 'lernen', slug: c.slug, lauf });
  await laden(c);
  if (sitzung(c) && !aktiv(c)) { await L.lernenBeenden(c.key); await laden(c); }      // eingetragene Sitzung schließen
  if (!aktiv(c) && ziel(c).id) {
    leeren(c); delete gesehen[c.key];
    const r = await L.lernenStarten(c.key);
    if (r && !r.ok && r.text) hooks.toast(r.text, 'fehler');
  }
  hooks.zeichnen();
}
export function laufLos() {
  const r = reihenfolge();
  if (!r.length) return hooks.toast('Gerade gibt es in keinem Kurs eine Lektion zu lernen.');
  return los(r[0].c, { lauf: true });
}
// Nach dem Eintragen: im Lauf über alle Kurse die nächste nach dem Plan, sonst die nächste dieses Kurses
function danach(c) {
  if (S.lernLauf) return reihenfolge()[0] || null;
  const d = dran(c);
  return d ? { c, d } : null;
}

// ---------------------------------------------------------------- Verlauf
const SICHER = [['geraten', 'Geraten'], ['unsicher', 'Unsicher'], ['sicher', 'Sicher']];

function frageKarte(c, s, q) {
  const offen = q.offen && !q.beantwortet;
  const titel = q.rolle === 'vorhersage' ? 'Vorhersage' : q.rolle === 'abruf' ? 'Aufwärmen' : 'Prüffrage';
  let chip = '';
  if (q.ersetzt) chip = '<span class="chip">übersprungen</span>';
  else if (q.rolle === 'vorhersage') chip = q.aufgedeckt && q.korrekt != null ? `<span class="chip">${q.korrekt ? 'traf zu' : 'traf nicht zu'}</span>` : '<span class="chip">zählt nicht</span>';
  else if (q.aufgedeckt && q.rolle === 'abruf') chip = `<span class="chip ${q.korrekt ? 'ok' : 'bad'}">${q.korrekt ? 'Richtig' : 'Falsch'}</span><span class="chip">zählt nicht</span>`;
  else if (q.aufgedeckt) chip = q.urteil === 'teils' ? '<span class="chip warn">Teils richtig</span>' : q.korrekt ? '<span class="chip ok">Richtig</span>' : '<span class="chip bad">Falsch</span>';
  else if (q.beantwortet) chip = '<span class="chip">wird bewertet …</span>';
  const key = `${s.id}:f${q.nr}`, gebucht = q.aufgedeckt && !q.ersetzt ? Sp.gebuchtVon(s.id, 'f', q.nr) : null;
  chip += Sp.xpChip(gebucht);
  const jetzt = einmal.delete(key), rm = rueck[key];
  const a = q.antwort || {};
  let rumpf = '';
  if (!q.frei) {
    const gew = offen ? wahl[c.key] : a.wahl;
    rumpf = `<div class="lrn-opts">${q.optionen.map((o, i) => {
      const kl = ['lrn-opt'];
      if (gew === i) kl.push('gew');
      if (q.aufgedeckt && q.richtig === i) kl.push('richtig');
      if (q.aufgedeckt && a.wahl === i && q.richtig !== i) kl.push('falsch');
      if (jetzt && q.aufgedeckt && q.rolle !== 'vorhersage') kl.push(q.richtig === i && a.wahl === i ? 'puls' : a.wahl === i ? 'wackeln' : '');
      const inhalt = `<span class="lrn-b">${BUCHSTABE(i)}</span><span class="ueb-prose sel">${md(o)}</span>`;
      return offen ? `<button class="${kl.join(' ')}" data-lrn-opt="${i}" title="Taste ${i + 1}">${inhalt}</button>` : `<div class="${kl.join(' ')}">${inhalt}</div>`;
    }).join('')}</div>`;
    if (a.weissNicht) rumpf += '<p class="ueb-leise">Du hast „Weiß ich nicht“ gewählt.</p>';
  } else if (q.beantwortet || !q.offen) {
    rumpf = a.weissNicht ? '<p class="ueb-leise">Du hast „Weiß ich nicht“ gewählt.</p>' : '';
    if (q.aufgedeckt && q.loesung) rumpf += `<div class="lrn-loesung"><div class="ueb-eyebrow">Lösung</div><div class="ueb-prose sel">${md(q.loesung)}</div></div>`;
  } else rumpf = '<p class="ueb-leise">Freie Antwort: unten ins Feld schreiben.</p>';
  if (rm) rumpf += `<p class="lrn-lob ${rm.art}${jetzt ? ' neu' : ''}">${rm.art === 'ok' ? flamme(rm.combo >= 3 ? 'jubelnd' : 'froh', 22) : ico(rm.art === 'teils' ? 'star' : 'sparkles')}<span>${esc(rm.text)}</span></p>`;
  const flug = jetzt && gebucht ? `<span class="xp-flug" aria-hidden="true">+${gebucht.xp} XP</span>` : '';
  const erkl = q.aufgedeckt && q.erklaerung ? `<div class="ueb-trenner"></div><div class="ueb-eyebrow">Erklärung</div><div class="ueb-prose sel">${md(q.erklaerung)}</div>` : '';
  return `<div class="ueb-karte lrn-frage${offen ? ' offen' : ''}" data-frage="${q.nr}">${flug}<div class="ueb-eyebrow">${titel} ${chip}</div>
    <div class="ueb-prose ueb-gross sel">${md(q.frage)}</div>${rumpf}${erkl}</div>`;
}

function rueckschau(c, s) {
  const a = s.abschluss || {};
  const liste = (titel, xs) => (xs && xs.length ? `<div class="ueb-eyebrow" style="margin-top:12px">${titel}</div><ul class="ueb-liste ueb-prose">${xs.map((x) => `<li>${md(x).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul>` : '');
  const zahlen = [statText(s), s.score != null ? `${s.score} %` : '', `${minuten(s)} Min.`].filter(Boolean).join(' · ');
  let unten = '';
  if (s.zustand === 'erledigt') unten = `<p class="lrn-ok">${ico('check')}Eingetragen: ${esc(s.lektion.id)} ist in der Roadmap erledigt.</p>`;
  else if (s.zustand === 'traegtEin') unten = `<div class="ueb-denkt"><span class="ueb-punkte"><i></i><i></i><i></i></span>Wird eingetragen: Roadmap, Kalender und Lernhub ziehen nach …</div>`;
  else unten = `${s.eintragFehler ? `<div class="note"><span>${ico('alert')}</span><span>${esc(s.eintragFehler)}</span></div>` : ''}
    <div class="acts"><button class="btn primary" data-lrn="eintragen">${ico('check')}Lektion abschließen</button>
    <span class="muted klein">Trägt ${esc(s.lektion.id)} in der Roadmap als erledigt ein. Pensum, Kalender und Lernzeit ziehen nach.</span></div>`;
  return `<div class="ueb-karte lrn-rueck"><div class="ueb-eyebrow">Rückschau <span class="chip acc">${esc(zahlen)}</span></div>
    ${a.text ? `<div class="ueb-prose sel">${md(a.text)}</div>` : ''}${liste('Das hast du gelernt', a.gelernt)}${liste('Noch offen', a.offen)}${liste('Zum Nachlesen', a.nachlesen)}
    <div class="ueb-trenner"></div>${unten}</div>`;
}

function zeile(c, s, e) {
  if (e.von === 'ich') {
    if (e.art === 'weiter') return '<div class="ueb-weiter">→ Weiter</div>';
    if (e.art === 'ende') return '<div class="ueb-weiter">→ Lektion beenden</div>';
    if (e.art === 'antwort') {
      if (!e.text) return '';
      const q = s.verlauf.find((v) => v.art === 'frage' && v.nr === e.nr);
      return `<div class="ueb-ich"><div class="ueb-gedanken"><div class="ueb-eyebrow">${q && q.frei ? 'Deine Antwort' : 'Deine Gedanken'}</div><div class="ueb-prose sel">${md(e.text)}</div></div></div>`;
    }
    return `<div class="ueb-ich"><div class="ueb-blase sel">${md(e.text)}</div></div>`;
  }
  if (e.art === 'frage') return frageKarte(c, s, e);
  if (e.art === 'abschluss') return rueckschau(c, s);
  return `<div class="ueb-claude ueb-prose lrn-text sel">${md(e.text)}</div>`;
}

function denktZeile(s) {
  const was = !s.verlauf.length ? 'liest das Material und plant die Lektion' : 'denkt';
  return Sp.warten(s, { art: 'lernen', was, sek: 'data-lrn-sek' });
}

// Fokus-Modus: Balken unter dem Kopf, ein Segment je Schritt des Plans, die Uhr klein daneben
function fokusLeiste(c, s) {
  if (!Sp.fokusAn() || !s) return '';
  const n = s.plan && s.plan.length ? s.plan.length : 0, m = minuten(s);
  const seg = n ? s.plan.map((t, i) => `<i class="${i + 1 < s.schritt ? 'done' : i + 1 === s.schritt ? 'jetzt' : ''}" title="${esc(`${i + 1}. ${t}`)}"></i>`).join('') : '<i class="leer"></i>';
  return `<div class="fokus-leiste" style="${cc(c)}"><div class="fokus-seg">${seg}</div><span class="muted num fokus-uhr" data-lrn-uhr2>${m} / ${s.budget} Min.</span></div>`;
}

// ---------------------------------------------------------------- Seitenspalte: Plan und Roadmap
function planBox(c, s) {
  const l = s.lektion, m = minuten(s), p = Math.min(100, Math.round(m / s.budget * 100));
  const plan = s.plan && s.plan.length ? `<ol class="lrn-plan">${s.plan.map((t, i) => {
    const n = i + 1, kl = n < s.schritt ? 'done' : n === s.schritt ? 'jetzt' : '';
    return `<li class="${kl}"><span class="lrn-pn">${n < s.schritt ? ico('check') : n}</span><span>${esc(t)}</span></li>`;
  }).join('')}</ol>` : '<p class="muted klein">Der Plan kommt mit Claudes erster Nachricht.</p>';
  return `<div class="lrn-box"><div class="ueb-eyebrow">Diese Lektion</div>
    <b class="lrn-titel">${esc(l.id)} · ${esc(l.title)}</b>
    <div class="muted klein lrn-quellen" title="${esc(l.sources || '')}">${[l.chapter ? 'Kap. ' + esc(l.chapter) : '', esc(l.sources || '')].filter(Boolean).join(' · ')}</div>
    <div class="lrn-uhr${m >= s.budget ? ' voll' : ''}" title="Aktive Lernzeit, Pausen über 10 Min. zählen als 10"><span class="bar"><i style="width:${p}%"></i></span><span class="num" data-lrn-uhr>${m} / ${s.budget} Min.</span></div>
    ${plan}${statText(s) ? `<div class="muted klein" style="margin-top:8px">${esc(statText(s))}${s.score != null ? ` · ${s.score} %` : ''}</div>` : ''}</div>`;
}

function roadmapBox(c, jetztId) {
  const mon = S.d.semester.monday;
  const by = {};
  c.lessons.forEach((l) => { (by[l.week || 'später'] = by[l.week || 'später'] || []).push(l); });
  const wochen = Object.keys(by).sort().map((w) => {
    const m = w === 'später' ? null : pd(w);
    const titel = m ? `KW ${isoWeek(m)} · ${fDM(m)}–${fDM(addDays(m, 6))}${w === mon ? ' · diese Woche' : ''}` : 'Später';
    const dn = by[w].filter((l) => l.state === 'erledigt').length;
    return `<div class="lrn-woche${w === mon ? ' cur' : ''}"><span>${titel}</span><span>${dn}/${by[w].length}</span></div>` + by[w].map((l) => {
      const kl = l.state === 'erledigt' ? 'erledigt' : l.state === 'Material folgt' ? 'ph' : 'geplant';
      const meta = l.state === 'erledigt' ? [l.score != null ? l.score + ' %' : '', l.minutes ? l.minutes + ' Min.' : ''].filter(Boolean).join(' · ')
        : l.state === 'Material folgt' ? 'Material folgt' : `ca. ${l.estMin} Min.`;
      return `<div class="lrn-rm ${l.id === jetztId ? 'jetzt' : ''}" title="${esc(l.id + ' ' + l.title + (l.sources ? ' · ' + l.sources : ''))}">
        <span class="st ${kl}">${l.state === 'erledigt' ? ico('check') : ''}</span><span class="id">${esc(l.id)}</span>
        <span class="tt"><b>${esc(l.title)}</b><span>${l.id === jetztId ? 'jetzt · ' : ''}${esc(meta)}</span></span></div>`;
    }).join('');
  }).join('');
  return `<div class="lrn-box lrn-roadmap"><div class="ueb-eyebrow">Roadmap <span class="sp" style="flex:1"></span><span class="num" style="text-transform:none;letter-spacing:0">${c.done} von ${c.total}</span></div>${wochen}
    <div class="lrn-woche"><span>${ico('trophy')} Klausur am ${fDM(pd(c.exam))}${pd(c.exam).getFullYear()}</span><span></span></div></div>`;
}

// ---------------------------------------------------------------- Ansicht
export function ansicht(c) {
  const s = sitzung(c), z = ziel(c);
  const offen = s && s.zustand !== 'erledigt' && s.zustand !== 'traegtEin';
  const kopf = `<header class="head drag"><span class="crumb"><span class="nodrag" style="${cc(c)}"><span class="dot" style="display:inline-block;margin-right:7px"></span></span>${esc(c.name)} · Lernen</span>
    ${s ? `<span class="chip acc">${ico('grad')}Lektion ${esc(s.lektion.id)}</span>` : ''}${s && S.lernLauf ? '<span class="chip" title="Nach jeder Lektion schlägt Lernhub die nächste vor, nach dem Plan über alle Kurse">nach Plan</span>' : ''}
    ${s ? Sp.comboChip(Sp.comboLernen(s)) : ''}
    <span class="sp"></span>${Sp.fokusKnopf()}
    ${offen && !s.abschluss && s.stat.gestellt ? `<button class="btn sm" data-lrn="ende" ${s.zustand === 'denkt' ? 'disabled' : ''} title="Claude fasst zusammen, danach kannst du die Lektion abschließen">${ico('flag')}Lektion beenden</button>` : ''}
    ${offen ? `<button class="btn sm ghost" data-lrn="verwerfen" title="Sitzung verwerfen, nichts wird eingetragen">${ico('x')}Abbrechen</button>` : ''}
    <button class="btn sm ghost" data-nav="kurs:${c.slug}">${ico('arrowLeft')}Zum Kurs</button></header>`;
  const seite = `<aside class="lrn-seite" style="${cc(c)}">${s ? planBox(c, s) : ''}${roadmapBox(c, s ? s.lektion.id : z.id)}</aside>`;
  if (!s) return kopf + `<div class="lrn-layout"><div class="lrn-haupt"><div class="view">${start(c, z)}</div></div>${seite}</div>`;
  return kopf + fokusLeiste(c, s) + `<div class="lrn-layout"><div class="lrn-haupt"><div class="view ueb-view" id="lrn-view"><div class="ueb-wrap" style="${cc(c)}">
    <div class="ueb-verlauf">${s.verlauf.map((x) => zeile(c, s, x)).join('')}
    ${s.zustand === 'denkt' ? denktZeile(s) : ''}
    ${s.zustand === 'fehler' ? `<div class="note"><span>${ico('alert')}</span><span>Claude hat nicht geantwortet: ${esc(s.fehler || '')}</span><span class="sp"></span><button class="btn sm" data-lrn="nochmal">${ico('refresh')}Nochmal versuchen</button></div>` : ''}
    </div></div></div>${dock(c, s)}</div>${seite}</div>`;
}

function start(c, z) {
  const kann = !!z.id;
  return `<div class="wrap" style="${cc(c)}"><div class="ueb-start card">
    <div class="ueb-eyebrow">${ico('grad')} Lernen</div>
    <h1 class="title">${kann ? `${esc(z.id)} · ${esc(z.title)}` : 'Gerade nichts zu lernen'}</h1>
    ${kann ? `<p class="muted">ca. ${z.budget} Min.${z.chapter ? ' · Kap. ' + esc(z.chapter) : ''}${z.sources ? ' · ' + esc(z.sources) : ''}${z.training ? ' · Klausurtraining' : ''}</p>
    <p class="ueb-prose">Claude bringt dir diese Lektion im Gespräch bei: ein kleiner Schritt, dann eine Frage, deine Antwort, dann der nächste Schritt. Der Stoff sind genau die Folien und Übungen, die in der Roadmap zu dieser Lektion stehen. Am Ende trägst du sie mit „Lektion abschließen“ ein, und die Roadmap rückt weiter.</p>
    <div class="acts"><button class="btn los haupt" data-lrn="start">${ico('play')}Lektion starten</button></div>
    <p class="muted klein">Nach dem Abschluss entsteht ein Merkblatt mit dem Kern jedes Schritts, daraus übt „Wiederholen“. Du kannst jederzeit unterbrechen und später weitermachen.</p>`
    : `<p class="ueb-prose">${esc(z.grund || 'Keine Lektion gefunden.')}</p>`}
  </div></div>`;
}

function mic() {
  const z = D.zustand;
  if (z === 'laeuft') return `<button class="mic an" data-lrn="diktat" title="Diktieren beenden (⌘⇧L)"><span class="pegel" id="lrn-pegel"><i></i><i></i><i></i><i></i><i></i></span>Hört zu</button>`;
  if (z === 'verbindet') return `<button class="mic" data-lrn="diktat" title="Verbindet …">${ico('mic')}Verbindet …</button>`;
  return `<button class="mic${z === 'fehler' ? ' err' : ''}" data-lrn="diktat" title="${esc(z === 'fehler' ? D.text : 'Diktieren (⌘⇧L)')}">${ico('mic')}Diktieren</button>`;
}
const zwischen = () => `<div class="ueb-zwischen" id="lrn-zwischen">${esc(D.interim)}</div>`;
const feld = (c, s, ph, rows = 2) => `<textarea id="lrn-text" rows="${rows}" placeholder="${esc(ph)}" spellcheck="true" ${s.zustand === 'denkt' ? 'disabled' : ''}>${esc(entwurf[c.key] || '')}</textarea>${zwischen()}`;

// Beschriftung und Zustand des Sendeknopfs bei offener Frage
function sendeKnopf(c, s, q) {
  const t = (entwurf[c.key] || '').trim(), hatWahl = wahl[c.key] != null;
  if (q.frei) return { text: 'Antworten', aus: !t };
  return hatWahl ? { text: 'Antworten', aus: false } : { text: t ? 'Rückfrage senden' : 'Antworten', aus: !t };
}

function dock(c, s) {
  const denkt = s.zustand === 'denkt';
  const t = entwurf[c.key] || '';
  if (s.zustand === 'erledigt' || s.zustand === 'traegtEin') {
    const fertig = s.zustand === 'erledigt', e = s.ergebnis || {};
    const n = fertig ? danach(c) : null;
    return `<div class="ueb-dock" style="${cc(c)}"><div class="ueb-dock-in lrn-fertig">
      <div class="ueb-zeile" style="margin-top:0"><b>${fertig ? `${esc(s.lektion.id)} erledigt` : 'Wird eingetragen …'}</b>
      <span class="muted klein">${fertig ? esc([e.score != null ? e.score + ' %' : '', e.min ? e.min + ' Min.' : ''].filter(Boolean).join(' · ')) : ''}</span><span class="sp"></span>
      ${fertig ? `<button class="btn sm ghost" data-lrn="zurueck" title="Abschluss zurücknehmen: Die Lektion ist wieder offen">${ico('undo')}Rückgängig</button>
      ${e.datei ? `<button class="btn sm ghost" data-lrn="ansehen" title="Merkblatt dieser Lektion im Browser öffnen">${ico('book')}Merkblatt</button>` : ''}
      ${n ? `<button class="btn ueb-naechste haupt" data-lrn="naechste" title="${esc(`${n.d.id} ${n.d.title}`)}">Nächste Lektion${n.c.key !== c.key ? ' · ' + esc(n.c.short) : ''} →</button>`
    : `<button class="btn sm" data-nav="woche">Zur Übersicht</button>`}` : ''}</div></div></div>`;
  }
  const q = offeneFrage(s);
  if (q) {
    const k = sendeKnopf(c, s, q);
    return `<div class="ueb-dock" style="${cc(c)}"><div class="ueb-dock-in">
      <div class="lrn-sicher"><span class="ueb-eyebrow" style="margin:0">Wie sicher?</span>${SICHER.map(([w, lbl]) => `<button class="lrn-chip${sicher[c.key] === w ? ' on' : ''}" data-lrn-sicher="${w}">${lbl}</button>`).join('')}</div>
      <div class="ueb-feld"><div class="ueb-eyebrow">${q.frei ? 'Deine Antwort' : 'Deine Gedanken'}</div>${feld(c, s, q.frei ? 'Antwort hier schreiben, gern mit deinem Gedankengang.' : 'Optional: laut denken. Ohne Auswahl geht der Text als Rückfrage an Claude.', q.frei ? 3 : 2)}</div>
      <div class="ueb-zeile">${mic()}<span class="muted klein">${q.frei ? '↵ sendet' : '1–' + q.optionen.length + ' wählt · ↵ sendet'}</span><span class="sp"></span>
        <button class="btn sm ghost" data-lrn="weissnicht" ${denkt ? 'disabled' : ''} title="Keine Schätzung: zählt als nicht gewusst">Weiß ich nicht</button>
        <button class="btn los haupt" data-lrn="senden" ${denkt || k.aus ? 'disabled' : ''}>${k.text}</button></div>
    </div></div>`;
  }
  const weiter = !t.trim() && !s.abschluss && s.stat.gestellt > 0;
  return `<div class="ueb-dock" style="${cc(c)}"><div class="ueb-dock-in ueb-pause">
    ${feld(c, s, s.abschluss ? 'Noch eine Frage zur Lektion? Sonst oben „Lektion abschließen“.' : 'Fragen oder die Lektion lenken …')}
    <div class="ueb-zeile">${mic()}<span class="muted klein">${weiter ? '↵ auf leerem Feld: weiter' : '↵ sendet · ⇧↵ neue Zeile'}</span><span class="sp"></span>
      ${weiter ? `<button class="btn ueb-naechste haupt" data-lrn="weiter" ${denkt ? 'disabled' : ''}>Weiter →</button>`
    : `<button class="btn los haupt" data-lrn="senden" ${denkt || !t.trim() ? 'disabled' : ''}>Senden</button>`}</div>
  </div></div>`;
}

// ---------------------------------------------------------------- Diktieren (wie in der Übungsansicht)
function knopfNeu(c) {
  const s = sitzung(c); if (!s) return;
  const q = offeneFrage(s), k = document.querySelector('.ueb-dock [data-lrn="senden"]');
  if (q && k) { const x = sendeKnopf(c, s, q); k.textContent = x.text; k.disabled = x.aus || s.zustand === 'denkt'; }
  else if (k) k.disabled = !(entwurf[c.key] || '').trim() || s.zustand === 'denkt';
}
function hoehe(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 220) + 'px'; }
function anhaengen(c, text) {
  text = String(text || '').trim(); if (!text) return;
  const alt = entwurf[c.key] || '';
  entwurf[c.key] = alt + (alt && !/\s$/.test(alt) ? ' ' : '') + text;
  const ta = $('#lrn-text');
  if (!ta) return;
  ta.value = entwurf[c.key]; hoehe(ta); ta.scrollTop = ta.scrollHeight;
  const s = sitzung(c);
  if (s && !offeneFrage(s) && !alt.trim()) { hooks.zeichnen(); return; }      // Knopf: Weiter → Senden
  knopfNeu(c);
}
function pegel(v) {
  const p = $('#lrn-pegel'); if (!p) return;
  [...p.children].forEach((i, n) => { i.style.height = Math.max(15, Math.min(100, v * 100 * (0.6 + 0.4 * Math.sin((n + 1) * 1.7 + Date.now() / 120)))) + '%'; });
}
export async function diktatUmschalten() {
  const c = aktuell(); if (!c || !sitzung(c)) return;
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
  if (c && D.interim) anhaengen(c, D.interim);
  D.interim = '';
  if (D.zustand !== 'fehler') D.zustand = 'aus';
  if (S.route.name === 'lernen') hooks.zeichnen();
}
export function verlassen() { if (D.zustand !== 'aus' && D.zustand !== 'fehler') diktatAus(); clearInterval(uhr); }
L.on.diktatStatus((x) => {
  if (S.route.name !== 'lernen') return;
  if (x.zustand === 'aus' && D.zustand === 'fehler') return;
  D.zustand = x.zustand; D.text = x.text || '';
  if (x.zustand === 'fehler') { A.stoppen(); hooks.toast(x.text, 'fehler'); }
  if (x.zustand === 'aus') D.interim = '';
  hooks.zeichnen();
});
L.on.diktatText((x) => {
  if (S.route.name !== 'lernen') return;
  const c = D.kurs && S.byKey[D.kurs]; if (!c) return;
  if (x.final) { D.interim = ''; anhaengen(c, x.text); }
  else D.interim = x.text;
  const z = $('#lrn-zwischen'); if (z) z.textContent = D.interim;
});

// ---------------------------------------------------------------- Nach dem Einsetzen ins DOM
// Neue Nachricht von Claude: an ihren Anfang scrollen (nicht ans Ende, sonst liest man rückwärts). Sonst bleibt
// die Stelle, an der man war.
export function verdrahten(c, { scrollAlt = null } = {}) {
  const s = sitzung(c);
  const v = $('#lrn-view');
  if (v && s) {
    const n = s.verlauf.length, vorher = gesehen[c.key];
    gesehen[c.key] = n;
    if (vorher == null || s.zustand === 'denkt') v.scrollTop = v.scrollHeight;
    else if (n > vorher) {
      const neu = v.querySelector('.ueb-verlauf').children[vorher];
      if (neu) v.scrollTop = Math.max(0, neu.offsetTop - 12); else v.scrollTop = v.scrollHeight;
    } else if (scrollAlt != null) v.scrollTop = scrollAlt;
  }
  const ta = $('#lrn-text');
  if (ta) {
    hoehe(ta);
    const q = s && offeneFrage(s);
    if (!ta.disabled && (!q || q.frei)) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  const j = document.querySelector('.lrn-roadmap .jetzt'), seite = document.querySelector('.lrn-roadmap');
  if (j && seite && !verdrahten.roadmap) { seite.scrollTop = Math.max(0, j.offsetTop - seite.clientHeight / 2); verdrahten.roadmap = true; }
  clearInterval(uhr);
  if (s && s.zustand !== 'erledigt') {
    uhr = setInterval(() => {
      if (S.route.name !== 'lernen') return clearInterval(uhr);
      const sek = document.querySelector('[data-lrn-sek]');
      if (sek) sek.textContent = Math.round((Date.now() - (s.seit || Date.now())) / 1000) + ' s';
      const u = document.querySelector('[data-lrn-uhr]');
      if (u) u.textContent = `${minuten(s)} / ${s.budget} Min.`;
      const u2 = document.querySelector('[data-lrn-uhr2]');
      if (u2) u2.textContent = `${minuten(s)} / ${s.budget} Min.`;
      Sp.wartenTick();
    }, 1000);
  }
}

// ---------------------------------------------------------------- Daten
export async function laden(c) {
  S.lern[c.key] = (await L.lernenStand(c.key)) || { sitzung: null, ziel: { grund: 'Kurs nicht gefunden.' } };
  if (S.lern[c.key].sitzung) Sp.lernen(S.lern[c.key].sitzung, false);          // still nachbuchen
}
// Alle Kurse: laufende Sitzungen und die Lektion, die jeweils dran ist (für die Karten und die Seitenleiste)
export async function ladenAlle() {
  try { S.lern = (await L.lernenUebersicht()) || {}; } catch { }
}
// Neu laden nur, wenn die Sitzung nicht läuft: Dann zählt, welche Lektion laut Roadmap dran ist
export const brauchtLaden = (c) => { const e = eintrag(c); return !e || !e.sitzung || e.sitzung.zustand === 'erledigt'; };
export function betreten() { verdrahten.roadmap = false; }
export async function stand(s) {
  if (!s) return;
  const e = S.lern[s.kurs] || (S.lern[s.kurs] = { sitzung: null, ziel: {} });
  const vorher = e.sitzung ? e.sitzung.zustand : null;
  const c = S.byKey[s.kurs];
  // live: dieselbe Sitzung war schon da, und ihre Ansicht ist offen
  const live = !!(c && e.sitzung && e.sitzung.id === s.id && S.route.name === 'lernen' && S.route.slug === c.slug);
  if (s.zustand === 'beendet') { if (e.sitzung && e.sitzung.id === s.id) { e.sitzung = null; delete gesehen[s.kurs]; } }
  else e.sitzung = s;
  const neu = s.zustand === 'beendet' ? { fragen: [] } : Sp.lernen(s, live, { ohneLevel: s.zustand === 'erledigt' });
  if (live) rueckmelden(s, neu.fragen);
  // eingetragen oder beendet: Welche Lektion jetzt dran ist, weiß der Hauptprozess
  if (c && (s.zustand === 'beendet' || (s.zustand === 'erledigt' && vorher !== 'erledigt'))) {
    const x = await L.lernenStand(c.key);
    if (x) S.lern[c.key] = x;
  }
  if (c && S.route.name === 'lernen' && S.route.slug === c.slug) hooks.zeichnen();
  else if (vorher !== s.zustand) hooks.geaendert();          // Karten und Seitenleiste zeigen den Zustand
  if (live && s.zustand === 'erledigt' && vorher !== 'erledigt' && S.route.name === 'lernen' && S.route.slug === c.slug) {
    Sp.feier({ s, naechste: danach(c), beiNaechste: () => aktion('naechste') });
  }
}
// Frisch aufgedeckte Fragen: Ton, Puls oder Wackeln, „+n XP“, eine Zeile Lob oder Trost
function rueckmelden(s, fragen) {
  let klang = null;
  for (const f of fragen) {
    const key = `${s.id}:f${f.nr}`;
    einmal.add(key);
    if (f.rolle !== 'pruefung') { rueck[key] = { art: 'info', text: `Mitgemacht: +${f.xp} XP` }; continue; }
    if (f.urteil === 'richtig') {
      rueck[key] = { art: 'ok', combo: f.combo, text: `${Sp.lobText(f.combo, f.nr)} +${f.xp} XP${f.glueck ? ' · Glückstreffer, doppelt!' : ''}${f.combo >= 2 ? ` · ${f.combo} in Folge` : ''}` };
      klang = klang || 'richtig';
    } else if (f.urteil === 'teils') { rueck[key] = { art: 'teils', text: `Halb richtig. +${f.xp} XP` }; klang = klang || 'richtig'; }
    else { rueck[key] = { art: 'bad', text: `${Sp.trostText(f.nr)} Die richtige Antwort ist markiert. +${f.xp} XP` }; klang = 'falsch'; }
  }
  if (klang) ton[klang]();
}
export const naechste = () => aktion('naechste');

// ---------------------------------------------------------------- Aktionen
const aktuell = () => (S.route.name === 'lernen' ? S.bySlug[S.route.slug] : null);
function leeren(c) { entwurf[c.key] = ''; delete wahl[c.key]; delete sicher[c.key]; }

function fragen(titel, text, ja, tun) {
  const ov = document.createElement('div');
  ov.className = 'overlay bew';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(titel)}" style="width:440px">
    <h3>${esc(titel)}</h3><p class="muted" style="margin:6px 0 16px">${esc(text)}</p>
    <div class="acts" style="justify-content:flex-end"><button class="btn ghost" data-v="0">Zurück</button><button class="btn primary" data-v="1">${esc(ja)}</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-v="1"]').focus();
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b && e.target !== ov) return;
    ov.remove();
    if (b && b.dataset.v === '1') tun();
  });
}

async function aktion(was) {
  const c = aktuell(); if (!c) return;
  const s = sitzung(c);
  const ok = (r) => { if (r && !r.ok && r.text) hooks.toast(r.text, 'fehler'); return r && r.ok; };
  if (was === 'start') { leeren(c); delete gesehen[c.key]; ok(await L.lernenStarten(c.key)); return; }
  if (was === 'diktat') { diktatUmschalten(); return; }
  if (!s) return;
  if (was === 'nochmal') { L.lernenNochmal(c.key); return; }
  if (was === 'verwerfen') {
    fragen('Lektion abbrechen?', 'Die Sitzung wird verworfen. In der Roadmap wird nichts eingetragen, die Lektion bleibt offen.', 'Abbrechen und verwerfen', async () => {
      verlassen(); leeren(c);
      if (ok(await L.lernenBeenden(c.key))) { await laden(c); hooks.zeichnen(); }
    });
    return;
  }
  if (was === 'ende') { ok(await L.lernenSenden(c.key, 'ende')); return; }
  if (was === 'weiter') { leeren(c); ok(await L.lernenSenden(c.key, 'weiter')); return; }
  if (was === 'eintragen') {
    verlassen();
    const r = await L.lernenEintragen(c.key);
    if (r && r.ok) hooks.toast(`${s.lektion.id} eingetragen. Roadmap, Kalender und Lernhub ziehen nach.`);
    else ok(r);
    return;
  }
  if (was === 'ansehen') { if (s.ergebnis && s.ergebnis.datei) L.oeffnen(s.ergebnis.datei); return; }
  if (was === 'zurueck') {
    fragen('Abschluss zurücknehmen?', `${s.lektion.id} ist danach wieder offen. Das Merkblatt bleibt bei den Lektionen liegen.`, 'Zurücknehmen', async () => {
      L.aktion('kurstutor://undone?lesson=' + encodeURIComponent(s.ergebnis.datei));
      await L.lernenBeenden(c.key); await laden(c); hooks.nav({ name: 'kurs', slug: c.slug });
    });
    return;
  }
  if (was === 'naechste') {
    const n = danach(c);
    leeren(c);
    if (n) return los(n.c, { lauf: S.lernLauf });
    hooks.zeichnen();
    return;
  }
  const q = offeneFrage(s);
  if (was === 'weissnicht' && q) {
    const t = (entwurf[c.key] || '').trim();
    if (ok(await L.lernenSenden(c.key, 'antwort', { weissNicht: true, text: t }))) leeren(c);
    return;
  }
  if (was === 'senden') {
    if (D.interim && D.kurs === c.key) { anhaengen(c, D.interim); D.interim = ''; }
    const t = (entwurf[c.key] || '').trim();
    let r;
    if (q && (q.frei ? t : wahl[c.key] != null)) r = await L.lernenSenden(c.key, 'antwort', { wahl: wahl[c.key], sicherheit: sicher[c.key], text: t });
    else if (t) r = await L.lernenSenden(c.key, 'text', { text: t });
    else return;
    if (ok(r)) leeren(c);
  }
}

function waehlen(c, i) {
  const s = sitzung(c), q = offeneFrage(s);
  if (!q || q.frei || s.zustand === 'denkt' || i < 0 || i >= q.optionen.length) return;
  wahl[c.key] = wahl[c.key] === i ? null : i;
  document.querySelectorAll('.lrn-frage.offen [data-lrn-opt]').forEach((b) => b.classList.toggle('gew', +b.dataset.lrnOpt === wahl[c.key]));
  knopfNeu(c);
}

// Einstiegskarten (auf „Diese Woche“, der Kursseite, im Lerntag): ein Klick lernt
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-lernen]');
  if (!b) return;
  e.stopPropagation();
  const [was, key] = b.dataset.lernen.split('|');
  if (was === 'lauf') laufLos();
  else if (S.byKey[key]) los(S.byKey[key]);
}, true);

document.addEventListener('click', (e) => {
  const c = aktuell(); if (!c) return;
  const o = e.target.closest('[data-lrn-opt]');
  if (o) { e.stopPropagation(); waehlen(c, +o.dataset.lrnOpt); return; }
  const si = e.target.closest('[data-lrn-sicher]');
  if (si) {
    e.stopPropagation();
    sicher[c.key] = sicher[c.key] === si.dataset.lrnSicher ? null : si.dataset.lrnSicher;
    document.querySelectorAll('[data-lrn-sicher]').forEach((b) => b.classList.toggle('on', b.dataset.lrnSicher === sicher[c.key]));
    return;
  }
  const b = e.target.closest('[data-lrn]');
  if (b && !b.disabled) { e.stopPropagation(); aktion(b.dataset.lrn); }
}, true);

document.addEventListener('input', (e) => {
  if (e.target.id !== 'lrn-text') return;
  const c = aktuell(); if (!c) return;
  const vorher = !!(entwurf[c.key] || '').trim();
  entwurf[c.key] = e.target.value;
  hoehe(e.target);
  const s = sitzung(c);
  if (s && !offeneFrage(s) && !s.abschluss && vorher !== !!e.target.value.trim()) { hooks.zeichnen(); return; }   // Senden ↔ Weiter
  knopfNeu(c);
});

document.addEventListener('keydown', (e) => {
  const c = aktuell(); if (!c) return;
  const s = sitzung(c); if (!s) return;
  if (document.querySelector('.overlay, .feier')) return;
  if (e.key === 'Escape' && (D.zustand === 'laeuft' || D.zustand === 'verbindet')) { e.preventDefault(); e.stopImmediatePropagation(); diktatAus(); return; }
  if (s.zustand === 'erledigt' || s.zustand === 'traegtEin') return;
  const imFeld = e.target && e.target.id === 'lrn-text';
  const inEingabe = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const q = offeneFrage(s);
  if (q && !q.frei && !inEingabe && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const i = /^[1-9]$/.test(e.key) ? +e.key - 1 : /^[a-e]$/i.test(e.key) ? e.key.toLowerCase().charCodeAt(0) - 97 : -1;
    if (i >= 0 && i < q.optionen.length) { e.preventDefault(); waehlen(c, i); return; }
  }
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  if (inEingabe && !imFeld) return;
  if (s.zustand === 'denkt') { if (imFeld) e.preventDefault(); return; }
  const t = (entwurf[c.key] || '').trim();
  if (!q && !t && !s.abschluss && s.stat.gestellt) { e.preventDefault(); aktion('weiter'); return; }
  if (q && !q.frei && wahl[c.key] != null) { e.preventDefault(); aktion('senden'); return; }
  if (imFeld || e.metaKey) { e.preventDefault(); if (t) aktion('senden'); }
});
