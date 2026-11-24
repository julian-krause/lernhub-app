// Lernhub · Oberfläche: Seitenleiste, Navigation, Suche, Meldungen. Daten kommen aus hub.py (über den Hauptprozess).
import { esc, ico, cc, norm, $ } from './js/util.js';
import { S, setDaten } from './js/state.js';
import * as V from './js/ansichten.js';
import * as U from './js/ueben.js';
import * as Ln from './js/lernen.js';
import * as Sy from './js/sync.js';
import * as Sp from './js/spiel.js';
import * as Sh from './js/sprechstunde.js';

const L = window.lernhub;

// ---------------------------------------------------------------- Meldungen
function toast(text, art = 'ok', icon = null) {
  if (!text) return;
  const t = document.createElement('div');
  t.className = 'toast' + (art === 'fehler' ? ' fehler' : art === 'spiel' ? ' spiel' : '');
  t.innerHTML = `${ico(icon || (art === 'fehler' ? 'alert' : 'check'))}<span>${esc(text)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), art === 'fehler' ? 12000 : 6500);
}

// ---------------------------------------------------------------- Daten
let geladenUm = 0, wiederholen = null;
let pop = null, nachzeichnen = false;          // offene Pfad-Karte; neue Daten warten, bis sie zugeht
async function laden() {
  S.laden = true; seitenleiste();
  try {
    const d = await L.daten();
    S.alt = !!d._alt;                       // alter Stand, hub.py rechnet noch (Neues kommt per daten:geaendert)
    setDaten(d);
    Ln.sofortAnwenden();                    // gerade abgeschlossene Lektionen, die hub.py noch nicht kennt
    await Promise.all([Ln.ladenAlle(), U.ladenAlle()]);      // laufende Sitzungen und was je Kurs dran ist
    Sp.nachbuchen();                                          // Spielstand: still nachbuchen, Abzeichen freischalten
    S.fehler = null;
    geladenUm = Date.now();
  } catch (e) {
    S.fehler = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    if (S.d) toast('Daten nicht geladen: ' + S.fehler, 'fehler');
    clearTimeout(wiederholen);              // ohne Daten nie stehen bleiben: in 20 s erneut versuchen
    if (!S.d) wiederholen = setTimeout(neuLaden, 20000);
  }
  S.laden = false;
}
async function neuLaden() {
  await laden();
  if (pop) nachzeichnen = true;                // eine offene Pfad-Karte bleibt stehen: gezeichnet wird, wenn sie zugeht
  else if (S.route.name !== 'einstellungen') zeichnen();
  seitenleiste();
  Sp.willkommen();                                    // falls die Daten beim Start noch fehlten
}

// ---------------------------------------------------------------- Navigation
const MODI = ['lernen', 'ueben', 'sprech'];
function nav(r) {
  if (typeof r === 'string') r = parse(r);
  const wechsel = r.name !== S.route.name || r.slug !== S.route.slug;
  if (S.route.name === 'ueben' && wechsel) U.verlassen();          // Diktieren endet mit der Ansicht
  if (S.route.name === 'lernen' && wechsel) { Ln.verlassen(); Ln.weg(); }
  if (r.name === 'lernen') { if (wechsel) Ln.betreten(r.slug); S.lernLauf = !!r.lauf; }
  S.route = r;
  zeichnen(); seitenleiste();
}
function parse(s) {
  const [name, slug, tab] = s.split(':');
  if (MODI.includes(name)) return { name, slug };
  return name === 'kurs' ? { name, slug, tab } : { name };
}

// Fokus-Modus: In Lernen und Wiederholen verschwinden Seitenleiste und rechte Spalte (bleiben im DOM)
function fokusSetzen() {
  $('.app').classList.toggle('fokus', Sp.fokusAn() && MODI.includes(S.route.name));
}
async function zeichnen() {
  if (pop) { pop.remove(); pop = null; }
  nachzeichnen = false;
  fokusSetzen();
  if (!S.d) {
    if (S.fehler) $('#ansicht').innerHTML = `<div class="view"><div class="leer-start"><h2>Daten noch nicht da</h2>
      <p class="muted">${esc(S.fehler)}</p><p class="muted">${S.icloud && S.icloud.zustand === 'laeuft' ? `iCloud lädt gerade ${S.icloud.fertig}/${S.icloud.gesamt} Dateien zurück auf den Mac. ` : ''}Lernhub versucht es alle 20 Sekunden erneut.</p>
      <button class="btn" data-reload>${ico('refresh')}Jetzt erneut versuchen</button></div></div>`;
    return;
  }
  const el = $('#ansicht');
  const r = S.route;
  const c = r.slug ? S.bySlug[r.slug] : null;
  let html = '';
  try {                                           // eine Ansicht, die wirft, darf nie stumm auf der alten Seite stehen bleiben
  if (r.name === 'lerntag') html = V.lerntag();
  else if (r.name === 'kurs' && c) html = V.kurs(c, r.tab || 'pfad');
  else if (r.name === 'ueben' && c && c.hasRoadmap) {
    if (!(c.key in S.ueb)) await U.laden(c);
    if (S.route !== r) return;                    // inzwischen woanders hin navigiert
    el.innerHTML = U.ansicht(c); zeichnen.letzte = r; U.verdrahten(c);
    return;
  }
  else if (r.name === 'sprech' && c && c.hasRoadmap) {
    el.innerHTML = Sh.ansicht(c); zeichnen.letzte = r; Sh.verdrahten(c);
    return;
  }
  else if (r.name === 'lernen' && c && c.hasRoadmap) {
    if (Ln.brauchtLaden(c)) await Ln.laden(c);
    if (S.route !== r) return;
    const alt = el.querySelector('#lrn-view'), scrollAlt = alt && zeichnen.letzte === r ? alt.scrollTop : null;
    const seite = el.querySelector('.lrn-roadmap'), seiteAlt = seite && zeichnen.letzte === r ? seite.scrollTop : null;
    el.innerHTML = Ln.ansicht(c); zeichnen.letzte = r;
    if (seiteAlt != null && el.querySelector('.lrn-roadmap')) el.querySelector('.lrn-roadmap').scrollTop = seiteAlt;
    Ln.verdrahten(c, { scrollAlt });
    return;
  }
  else if (r.name === 'einstellungen') { await Sh.einstellungenLaden(); html = V.einstellungen(await L.einstellungen(true), S.info); }
  else if (r.name === 'profil') html = Sp.profil();
  else html = V.woche();
  } catch (e) {
    console.error('Ansicht', r.name, e);
    html = `<div class="view"><div class="leer-start"><h2>Diese Ansicht ließ sich nicht zeichnen</h2>
      <p class="muted">${esc(String(e && e.message || e))}</p><p class="muted">Die anderen Bereiche funktionieren weiter. Neu laden (⌘R) holt frische Daten.</p>
      <button class="btn" data-reload>${ico('refresh')}Neu laden</button></div></div>`;
  }
  const alt = el.querySelector('.view'), scroll = alt && S.route === zeichnen.letzte ? alt.scrollTop : 0;
  el.innerHTML = html;
  zeichnen.letzte = S.route;
  const v = el.querySelector('.view'), h = el.querySelector('.head');
  if (v) {
    v.scrollTop = scroll;
    v.addEventListener('scroll', () => h && h.classList.toggle('scrolled', v.scrollTop > 4), { passive: true });
  }
  if (r.name === 'kurs' && r.tab === 'luecken' && c && c.hasRoadmap) lueckenLaden(c);
  if (r.name === 'einstellungen') { einstellungenVerdrahten(); Sh.einstellungenVerdrahten(); }
  if (r.name === 'kurs' && c) Sh.vorbereiten(c);              // Sprechstunde: Karten im Hintergrund bereitlegen
}

async function lueckenLaden(c) {
  const text = await L.luecken(c.ws);
  const el = $('#luecken');
  if (el && S.route.slug === c.slug) V.lueckenFuellen(el, text, c);
}

function einstellungenVerdrahten() {
  const msg = (t, ok) => { const m = $('#dg-msg'); if (m) { m.textContent = t; m.style.color = ok ? 'var(--ok)' : 'var(--bad)'; } };
  $('#dg-save').onclick = async () => {
    const inp = $('#dg-key'); const v = inp.value; inp.value = '';
    if (!v.trim()) return msg('Bitte einen Schlüssel einfügen.', false);
    const r = await L.schluesselSetzen(v);
    S.schluessel = r.ok || S.schluessel;
    await zeichnen(); msg(r.text, r.ok);
  };
  $('#dg-key').onkeydown = (e) => { if (e.key === 'Enter') $('#dg-save').click(); };
  $('#dg-test').onclick = async () => { msg('Teste …', true); const r = await L.schluesselTesten(); msg(r.text, r.ok); };
  $('#dg-del').onclick = async () => { await L.schluesselLoeschen(); S.schluessel = false; await zeichnen(); msg('Schlüssel entfernt.', true); };
}

// ---------------------------------------------------------------- Seitenleiste
// Was gerade läuft: offene Lektionen im Lernen und offene Runden im Wiederholen, ein Klick setzt sie fort
function laufend() {
  const z = [];
  for (const c of S.rc) {
    const d = Ln.dran(c);
    if (d && d.sitzung) z.push({ c, modus: 'lernen', text: `${c.short} · ${d.id} lernen`, titel: `${c.name}: ${d.id} ${d.title} weiterlernen`, denkt: d.sitzung.zustand === 'denkt' });
    const u = S.ueb[c.key];
    if (u) z.push({ c, modus: 'ueben', text: `${c.short} · wiederholen`, titel: `${c.name}: Runde fortsetzen`, denkt: u.zustand === 'denkt' });
  }
  const sp = Sh.laufendEintrag();
  if (sp) z.unshift(sp);
  return z;
}
function seitenleiste() {
  const el = $('#sidebar');
  if (!S.d) { el.innerHTML = `<div class="side-top drag"></div><p class="side-h">Lädt …</p>${icloudZeile()}`; return; }
  const r = S.route;
  const on = (n, slug) => (r.name === n && (!slug || r.slug === slug) ? ' on' : '');
  const st = S.d.stats;
  const ag = S.d.agenda;
  const agTag = ag ? new Date(ag.date + 'T12:00') : null;
  const kurse = S.rc.map((c, i) => {
    const p = c.quota ? Math.round(Math.min(1, c.doneThis / c.quota) * 100) : 0;
    return `<button class="side-item${on('kurs', c.slug)}" data-nav="kurs:${c.slug}" style="${cc(c)}" title="${esc(c.name)} · ⌘${i + 1}">
      <span class="ring" style="--p:${p}"></span><span class="lbl">${esc(c.short)}</span><span class="cnt ${c.doneThis >= c.quota && c.quota ? 'ok' : ''}">${c.doneThis}/${c.quota}</span></button>`;
  }).join('');
  const plain = S.plain.map((c) => `<button class="side-item" data-url="${esc(c.folderUrl)}" title="Ordner öffnen"><span class="em">${ico('folder')}</span><span class="lbl">${esc(c.short)}</span></button>`).join('');
  const lf = laufend().map((x) => `<button class="side-item side-open${on(x.modus, x.c.slug)}" data-nav="${x.modus}:${x.c.slug}" style="${cc(x.c)}" title="${esc(x.titel)}">
      <span class="em">${x.denkt ? '<span class="rec" title="Claude antwortet"></span>' : ico(x.modus === 'lernen' ? 'grad' : x.modus === 'sprech' ? 'headset' : 'target')}</span><span class="lbl">${esc(x.text)}</span></button>`).join('');
  const stand = S.d.generated ? new Date(S.d.generated) : null;
  el.innerHTML = `<div class="side-top drag"></div>
    ${Sp.seitenKarte(r.name === 'profil')}
    <button class="side-search" data-suche>${ico('search')}<span>Suchen</span><kbd>⌘K</kbd></button>
    <div class="side-scroll">
      <button class="side-item${on('woche')}" data-nav="woche"><span class="em">${ico('sun')}</span><span class="lbl">Diese Woche</span><span class="cnt">${st.weekDone}/${st.weekQuota}</span></button>
      <button class="side-item${on('lerntag')}" data-nav="lerntag"><span class="em">${ico('calendar')}</span><span class="lbl">Nächster Lerntag</span><span class="cnt">${agTag ? ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][agTag.getDay()] + ' ' + agTag.getDate() + '.' + (agTag.getMonth() + 1) + '.' : ''}</span></button>
      ${lf ? `<div class="side-h">LÄUFT</div>${lf}` : ''}
      <div class="side-h">KURSE</div>${kurse}
      ${plain ? `<div class="side-h">OHNE ROADMAP</div>${plain}` : ''}
    </div>
    ${icloudZeile()}${syncZeile()}
    <div class="side-foot"><button class="icon-btn${on('einstellungen')}" data-nav="einstellungen" title="Einstellungen (⌘,)">${ico('gear')}</button>
      <span class="stand${S.alt ? ' alt' : ''}" title="${S.alt ? 'Gespeicherter Stand. hub.py rechnet noch (iCloud lädt evtl. Dateien nach).' : 'Stand der Daten (hub.py)'}">${stand ? (S.alt ? 'Stand ' + standText(stand) + ' · lädt' : 'Stand ' + stand.toTimeString().slice(0, 5)) : ''}</span>
      <button class="icon-btn ${S.laden ? 'spin' : ''}" data-reload title="Neu laden (⌘R)">${ico('refresh')}</button></div>`;
}

function standText(d) {
  const heute = new Date().toDateString() === d.toDateString();
  return heute ? d.toTimeString().slice(0, 5) : d.getDate() + '.' + (d.getMonth() + 1) + '. ' + d.toTimeString().slice(0, 5);
}
function icloudZeile() {
  const x = S.icloud;
  if (!x || x.zustand !== 'laeuft' || !x.gesamt) return '';
  return `<div class="side-icloud" title="macOS hatte diese Dateien nur in iCloud abgelegt. Lernhub holt sie zurück auf den Mac.">
    ${ico('refresh')}<span>iCloud lädt ${x.fertig || 0}/${x.gesamt} Dateien</span></div>`;
}
function syncZeile() {
  if (S.sync.zustand !== 'laeuft') return '';
  return `<button class="side-icloud" data-nav="woche" title="ILIAS-Sync läuft: ${esc(S.sync.schritt || '')}">${ico('refresh')}<span>ILIAS-Sync ${esc(S.sync.schritt || 'läuft')}</span></button>`;
}

// ---------------------------------------------------------------- Pfad-Karte
function schliessePop() {
  if (!pop) return;
  pop.remove(); pop = null;
  if (nachzeichnen) zeichnen();                // inzwischen kamen neue Daten
}
function zeigePop(btn, c, l) {
  schliessePop();
  pop = document.createElement('div');
  pop.className = 'pop';
  pop.innerHTML = V.popKarte(c, l);
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(), w = 320;
  let x = r.right + 14, y = r.top - 10;
  if (x + w > innerWidth - 12) x = r.left - w - 14;
  y = Math.min(y, innerHeight - pop.offsetHeight - 12);
  pop.style.left = x + 'px'; pop.style.top = Math.max(12, y) + 'px';
}

// ---------------------------------------------------------------- Suche (⌘K)
function suche() {
  if ($('.overlay')) return;
  const items = [
    { t: 'Lernen', a: 'die Lektion, die nach dem Plan dran ist', go: () => Ln.laufLos(), i: 'grad' },
    { t: '∞ Unendlich lernen', a: 'Lektion für Lektion ohne Pause, danach Wiederholen (⌘⇧U)', go: () => Ln.unendlichLos(), i: 'grad' },
    { t: 'Wiederholen', a: 'alle Kurse gemischt', go: () => U.laufStart(), i: 'target' },
    { t: 'Nur 5 Minuten wiederholen', a: 'alle Kurse gemischt, mit Ring', go: () => U.laufStart({ kurz: true }), i: 'clock' },
    { t: 'Sprechstunde', a: 'Wiederholen per Sprache, freihändig', go: () => Sh.direkt(Sh.empfohlen(U.reihenfolge())), i: 'headset' },
    { t: 'Diese Woche', a: 'Ansicht', go: () => nav('woche'), i: 'sun' },
    { t: 'Nächster Lerntag', a: 'Ansicht', go: () => nav('lerntag'), i: 'calendar' },
    { t: 'Einstellungen', a: 'Ansicht', go: () => nav('einstellungen'), i: 'gear' },
    { t: 'Profil', a: 'Level, Serie, Abzeichen', go: () => nav('profil'), i: 'user' },
    ...S.rc.map((c) => ({ t: c.name, a: 'Kurs', go: () => nav({ name: 'kurs', slug: c.slug }), c })),
    ...S.rc.map((c) => ({ c, d: Ln.dran(c) })).filter((x) => x.d).map(({ c, d }) => ({ t: `Lernen · ${c.short} · ${d.id} ${d.title}`, a: d.sitzung ? 'läuft' : 'Lernen', go: () => Ln.los(c), i: 'grad', c })),
    ...S.rc.filter((c) => c.done && c.practice).map((c) => ({ t: `Wiederholen · ${c.short}`, a: 'Wiederholen', go: () => U.direkt(c), i: 'target', c })),
    ...S.rc.filter((c) => c.done && c.practice).map((c) => ({ t: `Sprechstunde · ${c.short}`, a: 'per Sprache', go: () => Sh.direkt(c), i: 'headset', c })),
    { t: 'ILIAS-Sync starten', a: 'läuft in der App', go: () => { nav('woche'); Sy.starten(); }, i: 'download' },
    ...S.d.actions.filter((x) => x.id !== 'ilias-sync').map((x) => ({ t: x.title, a: x.kind === 'claude' ? 'Claude Code' : 'Aktion', i: x.icon, go: () => L.aktion(x.url) })),
  ];
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="palette" role="dialog" aria-label="Suchen"><input placeholder="Kurs, Lernen, Wiederholen oder Aktion …" spellcheck="false"><ul></ul></div>`;
  document.body.appendChild(ov);
  const inp = ov.querySelector('input'), ul = ov.querySelector('ul');
  let treffer = [], sel = 0;
  const zeig = () => {
    const q = norm(inp.value).split(/\s+/).filter(Boolean);
    treffer = items.filter((x) => { const h = norm(x.t + ' ' + x.a); return q.every((w) => h.includes(w)); }).slice(0, 40);
    sel = Math.min(sel, Math.max(0, treffer.length - 1));
    ul.innerHTML = treffer.map((x, i) => `<li class="${i === sel ? 'on' : ''}" data-i="${i}" style="${x.c ? cc(x.c) : ''}">${x.c ? '<span class="dot"></span>' : ico(x.i)}<span class="lbl">${esc(x.t)}</span><span class="art">${esc(x.a)}</span></li>`).join('') || '<li class="muted">Nichts gefunden</li>';
    const o = ul.querySelector('.on'); if (o) o.scrollIntoView({ block: 'nearest' });
  };
  const zu = () => ov.remove();
  const los = (i) => { const x = treffer[i]; zu(); if (x) x.go(); };
  inp.oninput = () => { sel = 0; zeig(); };
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(treffer.length - 1, sel + 1); zeig(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); zeig(); e.preventDefault(); }
    else if (e.key === 'Enter') los(sel);
    else if (e.key === 'Escape') zu();
  };
  ul.onclick = (e) => { const li = e.target.closest('li[data-i]'); if (li) los(+li.dataset.i); };
  ov.onmousedown = (e) => { if (e.target === ov) zu(); };
  zeig(); inp.focus();
}

// ---------------------------------------------------------------- Klicks
// Lernen, Wiederholen und der Sync haben eigene Knöpfe (data-lernen, data-ueben, data-lauf, data-sync) in ihren Modulen.
document.addEventListener('click', (e) => {
  const f = e.target.closest('[data-fokus]');
  if (f) { Sp.fokusUmschalten(); zeichnen(); seitenleiste(); return; }
  const t = e.target.closest('[data-nav],[data-url],[data-pop],[data-suche],[data-reload]');
  if (!t) { if (pop && !e.target.closest('.pop')) schliessePop(); return; }
  if (t.dataset.suche !== undefined) return suche();
  if (t.dataset.reload !== undefined) return neuLaden();
  if (t.dataset.pop) {
    const [k, id] = t.dataset.pop.split('|'); const c = S.byKey[k];
    if (c && c.byId[id]) zeigePop(t, c, c.byId[id]);
    return;
  }
  schliessePop();
  if (t.dataset.nav) return nav(t.dataset.nav);
  if (t.dataset.url) {
    L.aktion(t.dataset.url);
    if (/^kurstutor:\/\/sync/.test(t.dataset.url)) toast('Abgleich läuft … Roadmaps, Kalender und Lernhub werden aktualisiert.');
  }
});
document.addEventListener('toggle', (e) => {          // „Frühere Wochen“ bleibt beim Neuzeichnen, wie es war
  if (e.target.matches && e.target.matches('details.frueher')) S.frueherOffen[e.target.dataset.kurs] = e.target.open;
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { schliessePop(); const o = $('.overlay'); if (o) o.remove(); }
});

// Tooltip fürs Diagramm
let tip = null;
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (!t) { if (tip) { tip.remove(); tip = null; } return; }
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip); }
  tip.innerHTML = `<b>${esc(t.dataset.tip)}</b>${esc(t.dataset.tip2 || '').replace(/\n/g, '<br>')}`;
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 270) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
});

// ---------------------------------------------------------------- Ereignisse aus dem Hauptprozess
// Sitzungen ändern ihren Zustand, während eine Übersicht offen ist: Karten und Seitenleiste nachziehen
function uebersichtNeu() {
  seitenleiste();
  if (!S.d || !['woche', 'kurs', 'lerntag', 'profil'].includes(S.route.name) || $('.overlay')) return;
  if (pop) nachzeichnen = true; else zeichnen();
}
L.on.datenGeaendert(() => neuLaden());
L.on.fokus(() => { if (Date.now() - geladenUm > 30000) neuLaden(); });
L.on.meldung((m) => toast(m.text, m.art));
L.on.nav((r) => nav(r));
L.on.navKursNr((i) => { const c = S.rc[i]; if (c) nav({ name: 'kurs', slug: c.slug }); });
L.on.navRoadmap(({ ws }) => { const c = S.rc.find((x) => x.ws.normalize('NFC') === ws.normalize('NFC')); if (c) nav({ name: 'kurs', slug: c.slug, tab: 'liste' }); });
L.on.suche(() => suche());
L.on.befehl((b) => {
  if (!S.d) return;
  if (b === 'lernen') Ln.laufLos();
  else if (b === 'unendlich') Ln.unendlichLos();
  else if (b === 'wiederholen') U.laufStart();
  else if (b === 'sprechstunde') { const c = Sh.empfohlen(U.reihenfolge()); if (c) Sh.direkt(c); else toast('Noch nichts zu wiederholen.'); }
  else if (b === 'diktat' && S.route.name === 'ueben') U.diktatUmschalten();          // ⌘⇧L: ins Feld diktieren
  else if (b === 'diktat' && S.route.name === 'lernen') Ln.diktatUmschalten();
  else if (b === 'fokus') { Sp.fokusUmschalten(); zeichnen(); seitenleiste(); toast(Sp.fokusAn() ? 'Fokus-Modus an: nur die Lektion.' : 'Fokus-Modus aus.'); }
});
L.on.ueben((x) => { U.stand(x); seitenleiste(); });
L.on.sprech((x) => Sh.stand(x));
L.on.sprechSenden((x) => Sh.ausMain(x));
L.on.lernen((x) => Ln.stand(x).then(seitenleiste));
L.on.sync((x) => { Sy.stand(x); seitenleiste(); });
L.on.icloud((x) => {
  S.icloud = x; seitenleiste();
  if (!S.d && S.fehler) zeichnen();
  if (x.zustand === 'fertig' && x.gesamt) toast(`iCloud: ${x.fertig} ausgelagerte Dateien wieder auf dem Mac.`);
});

// ---------------------------------------------------------------- Start
(async function start() {
  seitenleiste();
  S.info = await L.info();
  const ein = await L.einstellungen();
  S.schluessel = ein.schluessel; S.openai = !!ein.openai;
  const hooks = { toast, nav: (r) => nav(r), zeichnen: () => zeichnen(), geaendert: uebersichtNeu, seitenleiste: () => seitenleiste(), neuLaden: () => neuLaden() };
  U.init(hooks); Ln.init(hooks); Sy.init(hooks); Sp.init(hooks); Sh.init(hooks);
  await Sp.laden();
  await Sy.laden();
  await Sh.laden();
  await laden();
  Sh.wiederaufnehmen();
  seitenleiste(); await zeichnen();
  Sp.willkommen();                                    // einmal: was das Spiel aus dem bisherigen Verlauf schon weiß
  Sp.erinnern();                                      // Lernblock beginnt, Serie wird knapp
  window.__lernhubTest = { S, nav, suche };          // für die Ende-zu-Ende-Tests
})();
