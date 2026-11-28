// Sprechstunde: Wiederholen freihändig per Sprache (GPT-Live-1.1). Der Tutor fragt mündlich ab, du antwortest,
// er erklärt, was nicht saß. Gedacht für Momente ohne Hände und Blick frei, etwa beim Kochen.
//   - Einstieg: Knopf „Sprechstunde“ neben „Wiederholen“ (Kursseite, Kurskarten auf „Diese Woche“), Suche (⌘K)
//     und ⌘⇧E (Kurs, den der Plan zuerst nähme).
//   - Ton läuft hier über WebRTC (Mikrofon mit Echo- und Rauschunterdrückung, Ausgabe über ein Audio-Element,
//     das nicht im DOM der Ansicht hängt). Die Sitzung läuft also weiter, wenn du zu einer anderen Ansicht wechselst.
//   - Den Schlüssel kennt nur der Hauptprozess (src/main/sprechstunde.js): Er legt die Sitzung mit unserem
//     SDP-Angebot an. Ereignisse des Datenkanals gehen gefiltert dorthin, seine Befehle kommen über sprechSenden.
//   - Abriss (Kanal zu, Verbindung gescheitert): der Hauptprozess entscheidet, ob und wann neu verbunden wird.
//   - Leertaste: Pause an/aus. Pause schaltet Mikrofon und Ton stumm; lange Pausen legen auf, „Weitermachen“ verbindet neu.
import { esc, ico, cc, n_, $ } from './util.js';
import { S } from './state.js';
import * as Sp from './spiel.js';
import * as Kugel from './kugel.js';

const L = window.lernhub;
let hooks = { toast: () => {}, zeichnen: () => {}, nav: () => {}, geaendert: () => {}, seitenleiste: () => {} };
export function init(h) { hooks = { ...hooks, ...h }; }

// Verbindung (eine zur Zeit)
const V = { kurs: null, pc: null, dc: null, mic: null, audio: null, ctx: null, anMic: null, anAus: null, zuGesehen: false, bewusst: false, versuch: 0 };
// Untertitel: letzte Zeile je Sprecher
const U = { tutor: '', tutorEnde: 0, satzT: '', satzI: '', ichTimer: 0 };
let untertitelAn = (() => { try { return localStorage.getItem('sprech.untertitel') !== '0'; } catch { return true; } })();
const vorbereitet = {};            // Kursschlüssel → Zeitpunkt der letzten Vorbereitung
let neuTimer = null;

export const sitzung = (c) => (S.sprech && c && S.sprech.kurs === c.key ? S.sprech : null);
const laeuftZustand = (s) => s && ['vorbereiten', 'verbindet', 'laeuft', 'getrennt'].includes(s.zustand);
export const laeuft = () => laeuftZustand(S.sprech);

// ---------------------------------------------------------------- Einstieg
export function knopf(c, { klein = false } = {}) {
  if (!c.done || !c.practice) return '';
  const s = sitzung(c);
  return `<button class="btn${klein ? ' sm ghost kk-sprech' : ''}" data-sprech="kurs|${esc(c.key)}" title="Wiederholen per Sprache: Der Tutor fragt dich ab, du antwortest laut. Gut beim Kochen.">${ico('headset')}${s && laeuftZustand(s) ? 'Sprechstunde läuft' : 'Sprechstunde'}</button>`;
}

// Karten im Hintergrund vorbereiten (höchstens alle 10 Min. je Kurs), damit der Start sofort geht
export function vorbereiten(c) {
  if (!c || !c.done || !c.practice || !S.openai || laeuft()) return;
  if (Date.now() - (vorbereitet[c.key] || 0) < 10 * 60000) return;
  vorbereitet[c.key] = Date.now();
  L.sprechVorbereiten(c.key).catch(() => { });
}

export async function direkt(c) {
  if (!c) return;
  const s = S.sprech;
  if (s && laeuftZustand(s) && s.kurs !== c.key) {
    hooks.toast(`Es läuft schon eine Sprechstunde (${s.kursName}).`, 'fehler');
    const c2 = S.byKey[s.kurs]; if (c2) hooks.nav({ name: 'sprech', slug: c2.slug });
    return;
  }
  hooks.nav({ name: 'sprech', slug: c.slug });
  if (s && s.kurs === c.key && laeuftZustand(s)) return;
  if (s && s.kurs === c.key) await L.sprechVerwerfen(c.key);         // altes Ergebnis weg, neue Runde
  if (!S.openai) { S.sprech = null; hooks.zeichnen(); return; }       // Ansicht zeigt, wo der Schlüssel hinkommt
  const r = await L.sprechStarten(c.key);
  if (!r || !r.ok) {
    if (r && r.schluessel === false) { S.openai = false; hooks.zeichnen(); return; }
    if (!r || r.text !== 'Abgebrochen.') hooks.toast((r && r.text) || 'Sprechstunde nicht gestartet.', 'fehler');
    hooks.zeichnen();
    return;
  }
  if (r.laeuft) return;
  await verbinden(c.key, false);
}

// Für ⌘⇧E: Kurs mit dem größten Wiederholbedarf (wie der Endloslauf), sonst der erste mit Gelerntem
export function empfohlen(reihenfolge) {
  if (S.sprech && laeuftZustand(S.sprech)) return S.byKey[S.sprech.kurs];
  return (reihenfolge && reihenfolge[0]) || S.rc.find((c) => c.done && c.practice) || null;
}

// ---------------------------------------------------------------- Verbindung (WebRTC)
function stopp(track) { try { track.stop(); } catch { } }
function aufraeumen() {
  clearTimeout(neuTimer);
  const { pc, dc, mic, audio, ctx } = V;
  V.pc = V.dc = V.mic = V.anMic = V.anAus = V.ctx = null;
  try { if (dc) { dc.onclose = dc.onmessage = null; dc.close(); } } catch { }
  try { if (pc) { pc.onconnectionstatechange = pc.ontrack = null; pc.close(); } } catch { }
  if (mic) mic.getTracks().forEach(stopp);
  if (audio) { try { audio.pause(); audio.srcObject = null; } catch { } }
  V.audio = null;
  if (ctx) ctx.close().catch(() => { });
}

function iceFertig(pc, ms = 8000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((ok) => {
    const t = setTimeout(fertig, ms);                 // nach der Frist mit dem, was da ist
    function fertig() { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', pruef); ok(); }
    function pruef() { if (pc.iceGatheringState === 'complete') fertig(); }
    pc.addEventListener('icegatheringstatechange', pruef);
  });
}

function pegel(stream) {
  try {
    if (!V.ctx) V.ctx = new AudioContext();
    const src = V.ctx.createMediaStreamSource(stream);
    const an = V.ctx.createAnalyser(); an.fftSize = 512;
    src.connect(an);
    return an;
  } catch { return null; }
}
const lautstaerke = (an) => {
  if (!an) return 0;
  const d = new Uint8Array(an.fftSize); an.getByteTimeDomainData(d);
  let q = 0; for (const x of d) q += ((x - 128) / 128) ** 2;
  return Math.sqrt(q / d.length);
};

async function verbinden(key, nachAbriss) {
  aufraeumen();
  V.kurs = key; V.zuGesehen = false; V.bewusst = false;
  let mic;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    hooks.toast('Kein Zugriff aufs Mikrofon. Systemeinstellungen → Datenschutz → Mikrofon → Lernhub.', 'fehler');
    await L.sprechBeenden(key); await L.sprechZu(key);
    return;
  }
  if (!S.sprech || S.sprech.kurs !== key || !laeuftZustand(S.sprech)) { mic.getTracks().forEach(stopp); return; }
  V.mic = mic;
  try {
    const pc = new RTCPeerConnection();
    V.pc = pc;
    const audio = new Audio(); audio.autoplay = true; V.audio = audio;
    pc.ontrack = (e) => {
      const st = (e.streams && e.streams[0]) || new MediaStream([e.track]);
      audio.srcObject = st;
      audio.play().catch(() => { });
      V.anAus = pegel(st);
    };
    for (const t of mic.getAudioTracks()) pc.addTrack(t, mic);
    V.anMic = pegel(mic);
    const dc = pc.createDataChannel('oai-events');
    V.dc = dc;
    dc.onmessage = (m) => empfangen(key, m.data);
    dc.onclose = () => getrennt(key, 'Datenkanal geschlossen');
    pc.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(pc.connectionState)) getrenntBald(key, pc); };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await iceFertig(pc);
    if (V.pc !== pc) return;
    const sdp = pc.localDescription && pc.localDescription.sdp;
    const zuletzt = nachAbriss && U.tutor ? 'Tutor zuletzt: ' + U.tutor.trim().slice(-500) : '';
    const r = await L.sprechVerbinden(key, sdp || '', !!nachAbriss, zuletzt);
    if (V.pc !== pc) return;
    if (!r || !r.ok) { V.bewusst = true; aufraeumen(); return; }         // Hauptprozess zeigt den Fehler
    if (r.sdp === 'attrappe') return attrappe(key, pc);
    await pc.setRemoteDescription({ type: 'answer', sdp: r.sdp });
  } catch (e) {
    console.error('Sprechstunde:', e);
    if (V.kurs === key && !V.bewusst) getrennt(key, 'Verbindung nicht aufgebaut: ' + (e && e.message));
  }
}

// „disconnected“ kann sich von selbst erholen: 4 s abwarten
function getrenntBald(key, pc) {
  if (pc.connectionState === 'failed') return getrennt(key, 'Verbindung gescheitert');
  setTimeout(() => { if (V.pc === pc && ['failed', 'disconnected'].includes(pc.connectionState)) getrennt(key, 'Verbindung verloren'); }, 4000);
}

async function getrennt(key, grund) {
  if (V.kurs !== key || V.zuGesehen || V.bewusst) return;
  V.zuGesehen = true;
  aufraeumen();
  let r = null;
  try { r = await L.sprechAbriss(key, grund); } catch { }
  if (r && r.nochmal) neuTimer = setTimeout(() => verbinden(key, true), r.warte || 2000);
}

// Ereignisse vom Datenkanal: Untertitel hier, alles Nötige an den Hauptprozess
const NACH_MAIN = new Set(['session.started', 'session.closed', 'session.usage.updated', 'session.delegation.created', 'error']);
const NESTED = new Set(['response.output_item.done', 'response.completed', 'response.done', 'response.failed', 'response.incomplete', 'response.cancelled']);
async function empfangen(key, roh) {
  let ev;
  try { ev = typeof roh === 'string' ? JSON.parse(roh) : roh; } catch { return; }
  if (!ev || typeof ev.type !== 'string') return;
  if (ev.type === 'session.input_transcript.delta' || ev.type === 'session.output_transcript.delta') return untertitel(ev);
  const weiter = NACH_MAIN.has(ev.type) || (ev.type === 'response.event' && ev.event && NESTED.has(ev.event.type)
    && (ev.event.type !== 'response.output_item.done' || (ev.event.item && ev.event.item.type === 'function_call')));
  if (!weiter) return;
  let r = {};
  try { r = (await L.sprechEreignis(key, ev)) || {}; } catch { }
  if (r.aktion === 'aufraeumen' || r.aktion === 'neu') {
    V.zuGesehen = true;
    aufraeumen();
    if (r.aktion === 'neu') neuTimer = setTimeout(() => verbinden(key, true), r.warte || 2000);
  }
}

// Befehle des Hauptprozesses an den Datenkanal
export function ausMain({ kurs, ev } = {}) {
  if (!ev || kurs !== V.kurs) return;
  if (ev.type === 'lernhub.aufraeumen') { V.bewusst = true; aufraeumen(); return; }
  if (ev.type === 'session.input_audio.mute' || ev.type === 'session.input_audio.unmute') {
    const aus = ev.type.endsWith('.mute');
    if (V.mic) V.mic.getAudioTracks().forEach((t) => { t.enabled = !aus; });
    if (V.audio) V.audio.muted = aus;
  }
  if (V.dc && V.dc.readyState === 'open') { try { V.dc.send(JSON.stringify(ev)); } catch (e) { console.error(e); } }
  else if (ev.type === 'session.close') { V.bewusst = true; aufraeumen(); L.sprechZu(kurs); }
}

// Tests (LERNHUB_LIVE_ATTRAPPE): statt OpenAI ein Kanal, der Gesendetes sammelt; Ereignisse kommen über __sprechTest
function attrappe(key, pc) {
  const alt = V.dc;
  if (alt) alt.onclose = alt.onmessage = null;
  pc.onconnectionstatechange = pc.ontrack = null;
  try { pc.close(); } catch { }
  V.pc = null;
  const gesendet = [];
  V.dc = { readyState: 'open', send: (j) => gesendet.push(JSON.parse(j)), close() { this.readyState = 'closed'; } };
  window.__sprechTest = { gesendet, empfangen: (ev) => empfangen(key, JSON.stringify(ev)), abriss: () => getrennt(key, 'Test') };
}

// ---------------------------------------------------------------- Untertitel und Pegel (ohne Neuzeichnen)
// Untertitel: nur was der Tutor sagt (sein eigener Text, also genau). Dein Mitschnitt ist zu ungenau und flackert,
// er wird nicht angezeigt. Eine neue Äußerung (Lücke > 1,2 s) beginnt eine neue Zeile; gezeigt wird das Ende.
// Fertige Sätze gehen an den Hauptprozess: Er sucht dazu Kursstoff und legt ihn dem Tutor still hin.
function satzMelden(wer, text) {
  const t = String(text || '').trim();
  if (t.length >= 8 && V.kurs) L.sprechKontext(V.kurs, wer, t).catch(() => { });
}
function untertitel(ev) {
  if (ev.type === 'session.input_transcript.delta') {           // dein Gesagtes: nur für die Suche, nicht angezeigt
    U.satzI += ev.delta || '';
    clearTimeout(U.ichTimer);
    U.ichTimer = setTimeout(() => { satzMelden('ich', U.satzI); U.satzI = ''; }, 900);
    return;
  }
  if (ev.type !== 'session.output_transcript.delta') return;
  U.satzT += ev.delta || '';
  if (/[.!?…]\s*$/.test(U.satzT) || U.satzT.length > 280) { satzMelden('tutor', U.satzT); U.satzT = ''; }
  const neu = (ev.start_ms || 0) - U.tutorEnde > 1200;
  U.tutor = (neu ? '' : U.tutor) + (ev.delta || '');
  U.tutorEnde = ev.end_ms || U.tutorEnde;
  U.tutor = U.tutor.slice(-600);
  if (!untertitelPlan) untertitelPlan = requestAnimationFrame(untertitelZeigen);
}
let untertitelPlan = 0;
// Höchstens ~2 Zeilen: ab einem Satz- oder Wortanfang innerhalb der letzten 170 Zeichen
function untertitelText() {
  const t = U.tutor.trim();
  if (t.length <= 170) return t;
  const rest = t.slice(-170), satz = rest.search(/[.!?]\s+\S/);
  return satz >= 0 && satz < 120 ? rest.slice(satz + 1).trim() : '… ' + rest.slice(rest.indexOf(' ') + 1);
}
function untertitelZeigen() {
  untertitelPlan = 0;
  const el = $('#sp-tutor');
  if (el) el.textContent = untertitelText();
}

// Kugel: Pegel aus Tutor-Ausgabe und Mikrofon (der Tutor zählt mehr), Zustand aus der Sitzung
function kugelStarten() {
  const cv = $('#sp-kugel');
  if (!cv || cv.__kugel) return;                  // bleibt die Kugel beim Neuzeichnen stehen, läuft ihre Animation weiter
  cv.__kugel = true;
  Kugel.starten(cv, {
    pegel: () => Math.max(lautstaerke(V.anAus) * 7, lautstaerke(V.anMic) * 3.5),
    zustand: () => {
      const s = S.sprech;
      if (!s) return 'ruhe';
      if (s.zustand === 'laeuft') return s.pause ? 'pause' : s.schautNach ? 'sucht' : 'laeuft';
      return s.zustand === 'verbindet' || s.zustand === 'vorbereiten' ? 'verbindet' : 'still';
    },
  });
}

// ---------------------------------------------------------------- Stand aus dem Hauptprozess
export async function laden() {
  try { S.sprech = (await L.sprechStand()) || null; } catch { }
}
export function stand(x) {
  if (x && x.weg) { if (S.sprech && S.sprech.kurs === x.kurs) S.sprech = null; }
  else S.sprech = x;
  const s = S.sprech;
  if (s && s.verlauf) {
    Sp.ueben(s, true);                                  // XP und Serie wie beim Wiederholen
  }
  if (s && s.zustand === 'beendet' && V.kurs === s.kurs && (V.pc || V.dc)) { V.bewusst = true; aufraeumen(); }
  hooks.seitenleiste();
  const r = S.route, c = r.slug ? S.bySlug[r.slug] : null;
  if (r.name === 'sprech' && c && (!x || x.weg || x.kurs === c.key)) {
    if (!feinZeichnen(c)) hooks.zeichnen();
  } else hooks.geaendert();
}

// Nur Zustandszeile, Themen und Knöpfe aktualisieren, wenn die Ansicht schon steht (Kugel und Untertitel laufen weiter)
function feinZeichnen(c) {
  const v = $('.sp-view'), s = sitzung(c);
  if (!v || !s || !['laeuft', 'verbindet'].includes(s.zustand) || !['laeuft', 'verbindet'].includes(v.dataset.zustand)) return false;
  v.dataset.zustand = s.zustand;
  const l = $('#sp-leiste'); if (l) l.innerHTML = leisteHtml(s);
  const h = $('#sp-hinweis'); if (h) h.textContent = statusText(s);
  const p = $('[data-sp="pause"]'); if (p) { p.innerHTML = ico(s.pause ? 'play' : 'pause'); p.title = s.pause ? 'Weiter (Leertaste)' : 'Pause (Leertaste)'; }
  v.classList.toggle('pausiert', !!s.pause);
  const z = $('#sp-zahl'); if (z) z.innerHTML = zahlHtml(s);
  return true;
}
// Eine ruhige Zeile statt „spricht/hört zu“ im Millisekundentakt: nur was länger gilt
const statusText = (s) => (s.zustand === 'verbindet' ? s.hinweis || 'Verbinde …' : s.pause ? 'Pause · Leertaste oder „Weiter“ drücken' : s.schautNach ? 'schaut kurz im Stoff nach …' : '');

// ---------------------------------------------------------------- Ansicht
const ERG = { geloest: ['ok', 'saß'], hinweise: ['warn', 'mit Hinweisen'], aufgegeben: ['bad', 'erklärt'] };
// Die Themen von heute mit ihrem Stand. Kein „aktuelles“ Thema: Der Tutor führt frei durchs Gespräch.
// Gezeigt: eingetragene Themen und die nächsten fälligen (höchstens 10)
function leisteHtml(s) {
  const zeig = [...s.themen.filter((t) => t.ergebnis), ...s.themen.filter((t) => !t.ergebnis && t.faellig)].slice(0, 10);
  return zeig.map((k) => {
    const e = k.ergebnis ? ERG[k.ergebnis] : null;
    return `<span class="sp-th${e ? ' ' + e[0] : ''}" title="${esc(e ? e[1] : k.luecke ? 'Lücke offen' : 'noch offen')}">${e ? ico(e[0] === 'ok' ? 'check' : e[0] === 'warn' ? 'star' : 'book') : ''}${esc(k.titel)}</span>`;
  }).join('');
}
const zahlHtml = (s) => `${n_(s.stat.karten, 'Thema', 'Themen')} eingetragen · ${s.themen.filter((t) => t.faellig && !t.ergebnis).length} noch fällig`;

export function ansicht(c) {
  const s = sitzung(c);
  const kopf = `<header class="head drag"><span class="crumb"><span class="nodrag" style="${cc(c)}"><span class="dot" style="display:inline-block;margin-right:7px"></span></span>${esc(c.name)} · Sprechstunde</span>
    ${s && s.themen && s.themen.length && s.zustand !== 'beendet' ? `<span class="muted num" id="sp-zahl">${zahlHtml(s)}</span>` : ''}
    <span class="sp"></span>${Sp.fokusKnopf()}
    <button class="btn sm ghost" data-nav="kurs:${c.slug}">${ico('arrowLeft')}Zum Kurs</button></header>`;
  return kopf + `<div class="view sp-view${s && s.pause ? ' pausiert' : ''}" data-zustand="${esc(s ? s.zustand : 'start')}" style="${cc(c)}">${inhalt(c, s)}</div>`;
}

function inhalt(c, s) {
  if (!S.openai) return `<div class="sp-mitte"><div class="sp-leer">
      <div class="sp-icon">${ico('headset')}</div>
      <h2>Sprechstunde braucht einen OpenAI-Schlüssel</h2>
      <p class="muted">Der Tutor spricht über OpenAI GPT-Live-1.1 mit dir (etwa 0,05 $ pro Minute). Trag den Schlüssel einmal in den Einstellungen ein, er wird verschlüsselt im Schlüsselbund gespeichert.</p>
      <div class="acts"><button class="btn primary" data-nav="einstellungen">${ico('gear')}Zu den Einstellungen</button></div></div></div>`;
  if (!s) return `<div class="sp-mitte"><div class="sp-leer">
      <canvas class="sp-kugel klein" id="sp-kugel" aria-hidden="true"></canvas>
      <h2>Wiederholen, ohne hinzusehen</h2>
      <p class="muted">Der Tutor geht mit dir im Gespräch durch, was in ${esc(c.short)} fällig ist. Du antwortest einfach laut, ihr bleibt bei einem Thema, so lange du willst. Wenn etwas nicht sitzt, erklärt er es. Sag jederzeit „Pause“, „Nächstes Thema“, „Erklär das genauer“ oder „Schluss“.</p>
      <div class="acts"><button class="btn primary" data-sprech="kurs|${esc(c.key)}">${ico('play')}Sprechstunde starten</button></div></div></div>`;
  if (s.zustand === 'vorbereiten') return `<div class="sp-buehne"><canvas class="sp-kugel" id="sp-kugel"></canvas>
      <p class="sp-zeile-status">Lade den Kursstoff …</p>
      <div class="sp-leiste-unten"><button class="sp-rund klein" data-sp="ende" title="Abbrechen">${ico('x')}</button></div></div>`;
  if (s.zustand === 'fehler') return `<div class="sp-mitte"><div class="sp-leer">
      <div class="sp-icon bad">${ico('alert')}</div><h2>Das hat nicht geklappt</h2>
      <p class="muted sel">${esc(s.fehler || 'Unbekannter Fehler.')}</p>
      <div class="acts"><button class="btn primary" data-sprech="kurs|${esc(c.key)}">${ico('refresh')}Nochmal versuchen</button>${/Schlüssel/.test(s.fehler || '') ? `<button class="btn" data-nav="einstellungen">${ico('gear')}Einstellungen</button>` : ''}</div></div></div>`;
  if (s.zustand === 'beendet') return ergebnis(c, s);
  if (s.zustand === 'getrennt') return `<div class="sp-buehne"><canvas class="sp-kugel" id="sp-kugel"></canvas>
      <p class="sp-zeile-status">${esc(s.hinweis || 'Verbindung unterbrochen')}</p>${s.fehler ? `<p class="muted sel">${esc(s.fehler)}</p>` : ''}
      <p class="muted mini">Dein Stand bleibt: ${n_(s.stat.karten, 'Thema', 'Themen')} durch.</p>
      <div class="acts"><button class="btn primary" data-sp="fortsetzen">${ico('play')}Weitermachen</button><button class="btn ghost" data-sp="ende">${ico('stop')}Beenden</button></div></div>`;
  // verbindet | laeuft
  return `<div class="sp-buehne">
      <canvas class="sp-kugel" id="sp-kugel" aria-hidden="true"></canvas>
      <p class="sp-zeile-status" id="sp-hinweis">${esc(statusText(s))}</p>
      <p class="sp-untertitel${untertitelAn ? '' : ' aus'}" id="sp-tutor" aria-live="polite">${esc(untertitelText())}</p>
      <div class="sp-themen" id="sp-leiste">${leisteHtml(s)}</div>
      <div class="sp-leiste-unten">
        <button class="sp-rund klein${untertitelAn ? ' an' : ''}" data-sp="untertitel" title="Untertitel ${untertitelAn ? 'aus' : 'an'}">${ico('chat')}</button>
        <button class="sp-rund" data-sp="pause" title="${s.pause ? 'Weiter' : 'Pause'} (Leertaste)">${ico(s.pause ? 'play' : 'pause')}</button>
        <button class="sp-rund klein rot" data-sp="ende" title="Sprechstunde beenden">${ico('x')}</button>
      </div>
      <p class="muted mini sp-tipp">Sag einfach „Pause“, „Nochmal“, „Nächstes Thema“ oder „Schluss“</p>
    </div>`;
}

function ergebnis(c, s) {
  const fertig = s.verlauf.filter((v) => v.art === 'abschluss');
  const min = Math.max(1, Math.round(((s.ende || Date.now()) - s.start) / 60000));
  const xp = Sp.sitzungXp(s.id);
  const zeilen = fertig.map((e) => {
    const [art, lbl] = ERG[e.ergebnis] || ['', e.ergebnis];
    return `<li><span class="chip ${art}">${lbl}</span><span class="t"><b>${esc(e.titel || e.thema)}</b></span></li>`;
  }).join('');
  return `<div class="sp-mitte sp-ende"><div class="sp-icon ok">${ico('check')}</div>
      <h2>${fertig.length ? 'Gut gemacht' : 'Sprechstunde beendet'}</h2>
      <p class="muted num">${n_(fertig.length, 'Thema', 'Themen')} in ${min} Min.${fertig.length ? ` · ${s.stat.geloest} saßen, ${s.stat.hinweise} mit Hinweisen, ${s.stat.aufgegeben} erklärt` : ''}${xp ? ` · +${xp} XP` : ''}</p>
      ${zeilen ? `<ul class="sp-liste">${zeilen}</ul>` : '<p class="muted">Kein Thema eingetragen. Fällig bleibt, was fällig war.</p>'}
      <p class="muted mini">Was nicht saß, kommt beim nächsten Wiederholen wieder dran.</p>
      <div class="acts"><button class="btn primary" data-sprech="kurs|${esc(c.key)}">${ico('refresh')}Nochmal</button><button class="btn" data-sp="fertig">${ico('check')}Fertig</button></div></div>`;
}

export function verdrahten() { kugelStarten(); }

// Oberfläche neu geladen, die Sitzung im Hauptprozess läuft noch: Verbindung neu aufbauen (Stand bleibt)
export async function wiederaufnehmen() {
  const s = S.sprech;
  if (!s || !['laeuft', 'verbindet'].includes(s.zustand) || V.pc || V.dc) return;
  V.kurs = s.kurs; V.zuGesehen = false; V.bewusst = false;
  getrennt(s.kurs, 'Oberfläche neu geladen');
}

async function knopfAktion(was, c) {
  const s = sitzung(c);
  if (was === 'pause' && s) return L.sprechPause(c.key, !s.pause);
  if (was === 'untertitel') {
    untertitelAn = !untertitelAn;
    try { localStorage.setItem('sprech.untertitel', untertitelAn ? '1' : '0'); } catch { }
    return hooks.zeichnen();
  }
  if (was === 'ende' && s) {
    const offen = V.dc && V.dc.readyState === 'open';
    await L.sprechBeenden(c.key);
    if (!offen) { V.bewusst = true; aufraeumen(); await L.sprechZu(c.key); }
    return;
  }
  if (was === 'fortsetzen' && s) { const r = await L.sprechFortsetzen(c.key); if (r && r.ok) verbinden(c.key, true); return; }
  if (was === 'fertig') { await L.sprechVerwerfen(c.key); S.sprech = null; hooks.nav({ name: 'kurs', slug: c.slug }); }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sprech]');
  if (b) { const c = S.byKey[b.dataset.sprech.split('|')[1]]; if (c) direkt(c); return; }
  const k = e.target.closest('[data-sp]');
  if (k && S.route.name === 'sprech') { const c = S.bySlug[S.route.slug]; if (c) knopfAktion(k.dataset.sp, c); }
});
// Karten vorbereiten, sobald jemand auf einen Sprechstunden-Knopf zeigt
document.addEventListener('mouseover', (e) => {
  const b = e.target.closest && e.target.closest('[data-sprech]');
  if (b) vorbereiten(S.byKey[b.dataset.sprech.split('|')[1]]);
});
document.addEventListener('keydown', (e) => {
  if (S.route.name !== 'sprech' || e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const c = S.bySlug[S.route.slug], s = sitzung(c);
  if (s && s.zustand === 'laeuft') { e.preventDefault(); L.sprechPause(c.key, !s.pause); }
});
window.addEventListener('beforeunload', () => { if (V.dc && V.dc.readyState === 'open') { try { V.dc.send(JSON.stringify({ type: 'session.close' })); } catch { } } });

// ---------------------------------------------------------------- Einstellungen
export function einstellungenKarte(e) {
  const st = e.openai ? `<span class="chip ok">${ico('check')}gespeichert</span>` : '<span class="chip warn">kein Schlüssel</span>';
  const ein = S.sprechEinst || { stimme: 'juni', tempo: 'zuegig', stimmen: ['juni', 'nuri', 'flitz'] };
  const NAME = { juni: 'Juni (weiblich)', nuri: 'Nuri (weiblich)', flitz: 'Flitz (männlich)' };
  return `<div class="card"><h3>${ico('headset')}OpenAI für die Sprechstunde<span class="sp"></span>${st}</h3>
      <div class="form">
        <p class="muted">Die Sprechstunde fragt dich per Sprache ab (GPT-Live-1.1, etwa 0,05 $ pro Minute). Der Schlüssel wird wie der Deepgram-Schlüssel verschlüsselt gespeichert und nie wieder angezeigt.</p>
        <div class="field"><input id="oa-key" type="password" placeholder="${e.openai ? 'Neuen Schlüssel eintragen, um ihn zu ersetzen' : 'OpenAI API-Schlüssel einfügen (sk-…)'}" autocomplete="off" spellcheck="false">
          <button class="btn primary" id="oa-save">Speichern</button></div>
        <div class="field"><button class="btn sm" id="oa-test" ${e.openai ? '' : 'disabled'}>Testen</button><button class="btn sm ghost" id="oa-del" ${e.openai ? '' : 'disabled'}>Entfernen</button><span id="oa-msg" class="muted"></span></div>
        <div class="field"><label class="muted" for="oa-stimme">Stimme</label><select id="oa-stimme">${(ein.stimmen || []).map((v) => `<option value="${v}"${v === ein.stimme ? ' selected' : ''}>${NAME[v] || v}</option>`).join('')}</select>
          <label class="muted" for="oa-tempo">Tempo</label><select id="oa-tempo">${[['normal', 'normal'], ['zuegig', 'zügig'], ['schnell', 'schnell']].map(([v, t]) => `<option value="${v}"${ein.tempo === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        <p class="muted">Stimme und Tempo gelten ab der nächsten Sprechstunde. Im Gespräch reicht „langsamer“ oder „schneller“.</p>
      </div></div>`;
}
export async function einstellungenLaden() {
  try { S.sprechEinst = await L.sprechEinstellungen(); } catch { }
}
export function einstellungenVerdrahten() {
  const msg = (t, ok) => { const m = $('#oa-msg'); if (m) { m.textContent = t; m.style.color = ok ? 'var(--ok)' : 'var(--bad)'; } };
  const sv = $('#oa-save'); if (!sv) return;
  sv.onclick = async () => {
    const inp = $('#oa-key'); const v = inp.value; inp.value = '';
    if (!v.trim()) return msg('Bitte einen Schlüssel einfügen.', false);
    msg('Prüfe …', true);
    const r = await L.openaiSetzen(v);
    if (r.ok || /lehnt|antwortet|erreichbar/.test(r.text || '')) S.openai = true;
    await hooks.zeichnen(); msg(r.text, r.ok);
  };
  $('#oa-key').onkeydown = (e) => { if (e.key === 'Enter') sv.click(); };
  $('#oa-test').onclick = async () => { msg('Teste …', true); const r = await L.openaiTesten(); msg(r.text, r.ok); };
  $('#oa-del').onclick = async () => { await L.openaiLoeschen(); S.openai = false; await hooks.zeichnen(); msg('Schlüssel entfernt.', true); };
  const setz = async () => { S.sprechEinst = await L.sprechEinstellungen({ stimme: $('#oa-stimme').value, tempo: $('#oa-tempo').value }); msg('Gespeichert.', true); };
  $('#oa-stimme').onchange = setz; $('#oa-tempo').onchange = setz;
}

// Seitenleiste „LÄUFT“
export function laufendEintrag() {
  const s = S.sprech;
  if (!laeuftZustand(s)) return null;
  const c = S.byKey[s.kurs];
  return c ? { c, modus: 'sprech', text: `${c.short} · Sprechstunde`, titel: `${c.name}: Sprechstunde${s.pause ? ' (Pause)' : ''}`, denkt: s.zustand !== 'laeuft' } : null;
}
