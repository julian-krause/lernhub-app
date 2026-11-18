// ILIAS-Sync: Karte auf „Diese Woche“. Der Lauf selbst liegt im Hauptprozess (src/main/sync.js, claude -p mit der
// Skill ilias-sync, ohne Terminal und ohne Browserfenster); hier nur Knopf, Fortschritt und Ergebnis.
import { esc, ico, $, pd, fDM } from './util.js';
import { S, aktion } from './state.js';
import { md } from './ueben.js';

const L = window.lernhub;
let hooks = { toast: () => {} };
let takt = null;

export function init(h) { hooks = { ...hooks, ...h }; }
export async function laden() { try { S.sync = await L.syncStand(); } catch { } }

const dauer = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function wann(t) {
  const d = new Date(t), heute = new Date().toDateString() === d.toDateString();
  return (heute ? 'heute' : `am ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`) + ' um ' + d.toTimeString().slice(0, 5);
}

export function karte() {
  const s = S.sync || { zustand: 'aus', schritte: [] }, d = S.d.sync || {};
  const laeuft = s.zustand === 'laeuft';
  const a = aktion('ilias-sync');
  const chip = laeuft ? `<span class="chip acc"><span class="spin">${ico('refresh')}</span>läuft</span>`
    : d.due ? '<span class="chip warn">fällig</span>' : '<span class="chip ok">aktuell</span>';
  const zuletzt = d.last ? `zuletzt am ${fDM(pd(d.last))}` : 'noch nie gelaufen';
  let rumpf;
  if (laeuft) {
    const liste = (s.schritte || []).map((x, i, alle) => {
      const jetzt = i === alle.length - 1;
      return `<li class="${jetzt ? 'jetzt' : 'done'}">${jetzt ? `<span class="spin">${ico('refresh')}</span>` : ico('check')}<span>${esc(x.text)}</span></li>`;
    }).join('') || `<li class="jetzt"><span class="spin">${ico('refresh')}</span><span>startet Claude</span></li>`;
    rumpf = `<ol class="sync-schritte">${liste}</ol>
      <p class="muted mini">Läuft hier in der App, ohne Terminal und ohne Browserfenster. Du kannst währenddessen lernen.</p>`;
  } else if (s.zustand === 'fertig' || s.zustand === 'fehler' || s.zustand === 'abgebrochen') {
    const kopf = { fertig: ['ok', 'check', 'Fertig'], fehler: ['bad', 'alert', 'Nicht durchgelaufen'], abgebrochen: ['', 'x', 'Abgebrochen'] }[s.zustand];
    rumpf = `<div class="sync-ergebnis ${s.zustand}"><div class="sync-kopf"><span class="chip ${kopf[0]}">${ico(kopf[1])}${kopf[2]}</span>
        <span class="muted mini">${s.ende ? esc(wann(s.ende)) : ''}${s.ende && s.start ? ' · ' + dauer(s.ende - s.start) + ' Min.' : ''}</span><span class="sp"></span>
        <button class="icon-btn" data-sync="leeren" title="Ergebnis ausblenden">${ico('x')}</button></div>
      <div class="ueb-prose sel">${md(s.text || '')}</div></div>`;
  } else {
    rumpf = `<p class="muted">Lädt neue Folien und Übungen aus ILIAS und sortiert sie in die Kursordner. Läuft hier in der App, ohne Terminal und ohne Browserfenster.</p>`;
  }
  return `<div class="card sync" id="sync"><h3>${ico('download')}ILIAS-Sync ${chip}<span class="muted mini">${esc(zuletzt)}</span><span class="sp"></span>
      ${laeuft ? `<span class="muted mini num" data-sync-zeit="${s.start}">${dauer(Date.now() - s.start)}</span><button class="btn sm ghost" data-sync="abbrechen">Abbrechen</button>`
    : `${a ? `<button class="btn sm ghost" data-url="${esc(a.url)}" title="Für alles, was Rückfragen braucht: neue Kurse aufnehmen, Kurse beitreten, Ersteinrichtung">In Claude Code</button>` : ''}
      <button class="btn sm ${d.due ? 'primary' : ''}" data-sync="start">${ico('download')}Sync starten</button>`}</h3>
    ${rumpf}</div>`;
}

// Nur die Karte neu zeichnen (der Rest der Seite bleibt stehen, Scrollposition inklusive)
function neu() {
  const el = $('#sync');
  if (el && S.d) el.outerHTML = karte();
  clearInterval(takt);
  if (S.sync.zustand === 'laeuft') takt = setInterval(() => {
    const z = document.querySelector('[data-sync-zeit]');
    if (!z) return clearInterval(takt);
    z.textContent = dauer(Date.now() - +z.dataset.syncZeit);
  }, 1000);
}

export function stand(s) {
  const vorher = S.sync ? S.sync.zustand : 'aus';
  S.sync = s;
  neu();
  if (vorher !== 'laeuft' || s.zustand === 'laeuft') return;
  const zeile = String(s.text || '').split('\n')[0].replace(/[*`]/g, '');
  if (s.zustand === 'fertig') hooks.toast(zeile || 'ILIAS-Sync fertig.');
  else if (s.zustand === 'fehler') hooks.toast(zeile || 'ILIAS-Sync nicht durchgelaufen.', 'fehler');
}

export async function starten() {
  const r = await L.syncStarten();
  if (!r || !r.ok) return hooks.toast((r && r.text) || 'Sync nicht gestartet.', 'fehler');
  const el = $('#sync');
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sync]');
  if (!b || b.disabled) return;
  if (b.dataset.sync === 'start') starten();
  else if (b.dataset.sync === 'abbrechen') L.syncAbbrechen();
  else if (b.dataset.sync === 'leeren') L.syncLeeren();
});
