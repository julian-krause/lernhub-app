// Einstellungen → iPhone: Lernhub fürs iPhone einrichten (Server: src/main/handy.js, App: src/mobil, docs/handy.md).
// Die Karte zeichnet aus dem zuletzt geholten Stand und holt beim Zeichnen im Hintergrund einen frischen (Tailscale
// fragen dauert einen Moment). Die Knöpfe hören über einen eigenen Klick-Hörer, app.js muss nichts verdrahten.
import { esc, ico } from './util.js';

const L = window.lernhub;
let info = null, um = 0, laedt = false, meldung = null;

export function karte() {
  if (!laedt && Date.now() - um > 15000) holen(true);
  return `<div class="card" id="handy-karte">${inhalt()}</div>`;
}

function inhalt() {
  const i = info;
  const kopf = `<h3>${ico('bolt')}iPhone<span class="sp"></span>${i ? (i.ts && i.ts.freigegeben && i.laeuft ? `<span class="chip ok">${ico('check')}bereit</span>` : '<span class="chip warn">noch einrichten</span>') : ''}</h3>`;
  const text = `<p class="muted">Lernen und Wiederholen auch am iPhone, mit <b>Leise-Modus</b> für unterwegs: Claude stellt dann nur Auswahlfragen, Rückfragen gehen über Knöpfe, nichts muss getippt oder diktiert werden. Claude läuft weiter hier auf dem Mac über dein Abo; das iPhone verbindet sich über Tailscale. Lernhub muss dafür hier offen sein.</p>`;
  if (!i) return kopf + text + '<p class="muted">Prüfe Server und Tailscale …</p>';
  const ts = i.ts || {};
  const zeilen = [];
  zeilen.push(['Server', i.laeuft ? `läuft (nur lokal, Port ${i.port})` : `<b>läuft nicht</b>${i.fehler ? ': ' + esc(i.fehler) : ''}`]);
  zeilen.push(['Tailscale', !i.tailscale ? '<b>nicht installiert</b> (tailscale.com, auf Mac und iPhone)' : ts.fehler ? `<b>${esc(ts.fehler)}</b>` : ts.adresse ? esc(ts.adresse) : 'prüft …']);
  zeilen.push(['Im Tailnet', ts.freigegeben ? `freigegeben unter <span class="sel">${esc(i.basis || '')}</span>` : 'noch nicht freigegeben']);
  if (ts.handys && ts.handys.length) zeilen.push(['iPhone', ts.handys.map((h) => `${esc(h.name)} ${h.online ? '<span class="chip ok">online</span>' : '<span class="chip">offline: Tailscale-App am iPhone öffnen</span>'}`).join(' · ')]);
  if (i.verbunden) zeilen.push(['Verbunden', `${i.verbunden} ${i.verbunden === 1 ? 'Gerät' : 'Geräte'} gerade offen`]);
  const knoepfe = [];
  if (i.laeuft && i.tailscale && !ts.fehler && !ts.freigegeben) knoepfe.push(`<button class="btn primary" data-handy="freigeben">${ico('globe')}Im Tailnet freigeben</button>`);
  if (i.link && ts.freigegeben) knoepfe.push(`<button class="btn primary" data-handy="kopieren">${ico('link')}Link kopieren</button>`);
  knoepfe.push(`<button class="btn sm ghost" data-handy="pruefen">${ico('refresh')}Erneut prüfen</button>`);
  if (ts.freigegeben) knoepfe.push(`<button class="btn sm ghost" data-handy="neu" title="Alte Links funktionieren danach nicht mehr">Neuer Schlüssel</button>`);
  return kopf + text + `<dl class="kv">${zeilen.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <div class="field" style="margin-top:10px">${knoepfe.join('')}${meldung ? `<span class="muted" style="color:${meldung.ok ? 'var(--ok)' : 'var(--bad)'}">${esc(meldung.text)}</span>` : ''}</div>
    ${ts.freigegeben ? `<ol class="muted" style="list-style:decimal;padding-left:20px;margin-top:10px;line-height:1.6">
      <li>Am iPhone die Tailscale-App öffnen und verbinden (dasselbe Konto wie hier).</li>
      <li>„Link kopieren“ und am iPhone in Safari einsetzen (die Zwischenablage teilt sich über Handoff), öffnen.</li>
      <li>In Safari Teilen → „Zum Home-Bildschirm“. Fertig: Lernhub startet dann wie eine App.</li></ol>
      ${i.link ? `<p class="muted mini sel" style="margin-top:6px;word-break:break-all">${esc(i.link)}</p>` : ''}` : ''}`;
}

async function holen(pruefen) {
  if (!L || !L.handyInfo) return;
  laedt = true;
  try { info = await L.handyInfo(pruefen); um = Date.now(); } catch { } finally { laedt = false; }
  neu();
}
function neu() { const el = document.getElementById('handy-karte'); if (el) el.innerHTML = inhalt(); }

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-handy]');
  if (!b) return;
  const was = b.dataset.handy;
  b.disabled = true;
  try {
    if (was === 'freigeben') { meldung = { ok: true, text: 'Gebe frei …' }; neu(); const r = await L.handyFreigeben(); info = r; meldung = { ok: !!r.ok, text: r.text || '' }; }
    if (was === 'kopieren') { const ok = await L.handyKopieren(); meldung = { ok, text: ok ? 'Kopiert. Am iPhone in Safari einsetzen.' : 'Kein Link da.' }; }
    if (was === 'pruefen') { meldung = null; await holen(true); }
    if (was === 'neu') { info = await L.handyNeu(); meldung = { ok: true, text: 'Neuer Schlüssel. Link neu kopieren und am iPhone öffnen.' }; }
  } catch (err) { meldung = { ok: false, text: String(err.message || err) }; }
  um = Date.now();
  neu();
});
