// Ansichten: Diese Woche, Nächster Lerntag, Kurs (Pfad, Liste, Material, Lücken, Notizen), Einstellungen.
// Gelernt wird in zwei Modi mit eigener Ansicht: „Lernen“ (js/lernen.js) und „Wiederholen“ (js/ueben.js).
import { esc, ico, pd, fDM, fDMY, fWTL, addDays, isoWeek, cc, n_ } from './util.js';
import { S, aktionen, aktion } from './state.js';
import * as Ln from './lernen.js';
import * as U from './ueben.js';
import * as Sy from './sync.js';

// Zustand einer Roadmap-Lektion für die Anzeige: erledigt, offen (geplant) oder wartet auf Material
const zustand = (l) => (l.state === 'erledigt' ? 'erledigt' : l.state === 'Material folgt' ? 'ph' : 'geplant');
const ZUSTAND = { erledigt: 'Erledigt', geplant: 'Offen', ph: 'Material folgt' };

// ---------------------------------------------------------------- Bausteine
function status(l) {
  const z = zustand(l);
  return `<span class="st ${z}" title="${ZUSTAND[z]}">${z === 'erledigt' ? ico('check') : ''}</span>`;
}
function meta(l) {
  const b = [];
  if (l.state === 'erledigt') {
    if (l.score != null) b.push(`${l.score} %`);
    if (l.minutes) b.push(`${l.minutes} Min.`);
    if (l.done) b.push(`am ${fDM(pd(l.done))}`);
  } else if (zustand(l) === 'ph') b.push(l.availableFrom ? `Material ab ${fDM(pd(l.availableFrom))}` : 'Material folgt');
  else b.push(`ca. ${l.estMin} Min.`);
  if (l.sources) b.push(l.sources);
  return b.join(' · ');
}
// Was man mit einer Lektion tun kann: die, die dran ist, lernen; eine erledigte nachlesen (Merkblatt im Browser)
function knopf(c, l, { gross = false } = {}) {
  const sz = gross ? '' : ' sm';
  const d = Ln.dran(c);
  if (d && d.id === l.id) return `<button class="btn primary${sz}" data-lernen="kurs|${esc(c.key)}">${ico('play')}${d.sitzung ? 'Weiterlernen' : 'Lernen'}</button>`;
  if (l.state === 'erledigt') return l.file ? `<button class="btn ghost${sz}" data-url="${esc(l.file)}" title="Merkblatt im Browser öffnen">${ico('book')}Merkblatt</button>` : '';
  if (zustand(l) === 'ph') return `<span class="chip" title="Das Material ist noch nicht in ILIAS">${l.availableFrom ? 'ab ' + fDM(pd(l.availableFrom)) : 'Material folgt'}</span>`;
  return d ? `<span class="later" title="Gelernt wird in der Reihenfolge der Roadmap">nach ${esc(d.id)}</span>` : '';
}
function zeile(c, l) {
  const dran = (Ln.dran(c) || {}).id === l.id;
  return `<li class="lrow${dran ? ' dran' : ''}" style="${cc(c)}">${status(l)}<span class="id">${esc(l.id)}</span>
    <div class="tt"><b title="${esc(l.title)}">${esc(l.title)}</b><span>${esc(meta(l))}</span></div><div class="ac">${knopf(c, l)}</div></li>`;
}
function aktKarte(a) {
  const st = a.status ? `<div class="stt"><span class="chip ${a.statusLevel === 'warn' ? 'warn' : a.statusLevel === 'ok' ? 'ok' : ''}">${esc(a.status)}</span></div>` : '';
  return `<button class="act" data-url="${esc(a.url)}" title="${esc(a.prompt || a.desc || '')}"><span class="ic">${ico(a.icon)}</span>
    <div><b>${esc(a.title)}</b><span>${esc(a.desc || '')}</span>${st}</div></button>`;
}
function kopf(titel, rechts = '') {
  return `<header class="head drag"><span class="crumb">${titel}</span><span class="sp"></span>${rechts}</header>`;
}

function hinweise() {
  const d = S.d, h = [];
  if (d.sync && d.sync.due && S.sync.zustand !== 'laeuft') {
    h.push(`<div class="note">${ico('download')}<span>ILIAS-Sync ist fällig: ${esc(d.sync.why || '')}</span><span class="sp"></span><button class="btn sm" data-sync="start">Sync starten</button></div>`);
  }
  S.rc.forEach((c) => {
    if (c.alarm) h.push(`<div class="note" style="${cc(c)}">${ico('alert')}<span><b>${esc(c.short)}</b>: Rückstand, das Pensum ist deutlich gestiegen. Mit dem Tutor einen Aufholplan besprechen.</span><span class="sp"></span><button class="btn sm" data-nav="kurs:${c.slug}">Zum Kurs</button></div>`);
    if (c.newMaterial && c.newMaterial.length) h.push(`<div class="note info" style="${cc(c)}">${ico('inbox')}<span><b>${esc(c.short)}</b>: ${n_(c.newMaterial.length, 'neue Datei', 'neue Dateien')} noch nicht in der Roadmap.</span><span class="sp"></span><button class="btn sm" data-nav="kurs:${c.slug}:material">Ansehen</button></div>`);
  });
  return h.length ? `<div class="notes">${h.join('')}</div>` : '';
}

// ---------------------------------------------------------------- Diese Woche
export function woche() {
  const d = S.d, st = d.stats, mon = pd(d.semester.monday), heute = pd(d.today);
  const pruef = d.semester.exams && pd(d.semester.exams[0]);
  const wochenBis = pruef ? Math.max(0, Math.round((pruef - mon) / 6048e5)) : null;
  const std = new Date().getHours();
  const gruss = std < 11 ? 'Guten Morgen' : std < 18 ? 'Hallo' : 'Guten Abend';

  const p = st.weekQuota ? Math.round(st.weekDone / st.weekQuota * 100) : 0;
  const bars = S.rc.map((c) => {
    const q = c.quota || 0, dn = c.doneThis || 0, pc = q ? Math.min(100, dn / q * 100) : 0;
    return `<button class="bar-row" data-nav="kurs:${c.slug}" style="${cc(c)}" title="${esc(c.name)}: ${dn} von ${q} Lektionen diese Woche">
      <span class="nm"><span class="dot"></span>${esc(c.short)}</span><span class="bar"><i style="width:${pc}%"></i></span><span class="v">${dn}/${q}</span></button>`;
  }).join('');
  const pensum = `<div class="card"><h3>${ico('target')}Wochenpensum<span class="sp"></span><span class="muted num">${st.weekOpen} offen</span></h3>
    <div class="pensum"><div class="bigring" style="--p:${p}"><span>${st.weekDone}/${st.weekQuota}<small>Lektionen</small></span></div><div class="bars">${bars}</div></div></div>`;

  const ag = d.agenda;
  let lt = `<div class="card"><h3>${ico('calendar')}Nächster Lerntag</h3><p class="empty">Kein Lerntag geplant.</p></div>`;
  if (ag) {
    const tag = pd(ag.date);
    const bl = ag.events.filter((e) => e.kind === 'block' || e.kind === 'probe');
    lt = `<div class="card"><h3>${ico('calendar')}Nächster Lerntag<span class="sp"></span><button class="btn sm ghost" data-nav="lerntag">Ansehen${ico('chevron')}</button></h3>
      <div class="lt-tag">${fWTL(tag)}, ${fDM(tag)}${+tag === +heute ? ' · heute' : ''}</div>
      <div class="muted lt-zeit">${esc(ag.events[0] ? ag.events[0].start : '')}–${esc(ag.events.length ? ag.events[ag.events.length - 1].end : '')} · ${n_(bl.length, 'Block', 'Blöcke')}</div>
      <div class="bars">${bl.map((e) => { const c = S.byKey[e.course]; return `<div class="bar-row" style="${cc(c)}"><span class="nm"><span class="dot"></span>${esc(c ? c.short : e.course || '')}</span><span class="muted">${esc(e.start)}–${esc(e.end)} · ${n_(e.lessons.length, 'Lektion', 'Lektionen')}</span><span></span></div>`; }).join('')}</div></div>`;
  }

  // Fortschritt im Semester: je Kurs erledigte von allen Lektionen der Roadmap
  const ges = S.rc.reduce((a, c) => ({ done: a.done + c.done, total: a.total + c.total }), { done: 0, total: 0 });
  const fort = `<div class="card"><h3>${ico('flag')}Fortschritt im Semester<span class="sp"></span><span class="muted num">${ges.done} von ${ges.total} Lektionen · ${ges.total ? Math.round(ges.done / ges.total * 100) : 0} %</span></h3>
    <div class="fort">${S.rc.map((c) => {
    const pc = c.total ? c.done / c.total * 100 : 0;
    const nx = Ln.dran(c);
    const info = [c.avgScore != null ? `Ø ${c.avgScore} %` : '', c.alarm ? 'Rückstand' : '', `Klausur ${fDM(pd(c.exam))}`].filter(Boolean).join(' · ');
    return `<button class="fort-row" data-nav="kurs:${c.slug}" style="${cc(c)}" title="${esc(c.name)}: ${c.done} von ${c.total} Lektionen erledigt">
      <span class="nm"><span class="dot"></span>${esc(c.short)}</span><span class="bar"><i style="width:${pc}%"></i></span>
      <span class="v num"><b>${Math.round(pc)} %</b> · ${c.done}/${c.total}</span><span class="inf${c.alarm ? ' warn' : ''}">${esc(info)}</span>
      <span class="nx">${nx ? `als Nächstes: ${esc(nx.id)} ${esc(nx.title)}` : esc(Ln.grund(c) || 'alles erledigt')}</span></button>`;
  }).join('')}</div></div>`;

  // Lernzeit: gemessene Minuten der abgeschlossenen Lektionen (roadmap.json) plus Übungszeit aus „Wiederholen“ (uebung.json)
  const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} Min.` : `${m} Min.`);
  const zeit = S.rc.map((c) => {
    const mit = c.lessons.filter((l) => l.done && l.minutes);
    const uz = Object.entries((c.practice && c.practice.zeit) || {});
    const sek = (ab) => uz.reduce((a, [tag, v]) => a + (!ab || tag >= ab ? v : 0), 0);
    const lek = mit.reduce((a, l) => a + l.minutes, 0), ueb = Math.round(sek() / 60), uebWo = Math.round(sek(d.semester.monday) / 60);
    return { c, lek, ueb, ges: lek + ueb, wo: mit.filter((l) => l.done >= d.semester.monday).reduce((a, l) => a + l.minutes, 0) + uebWo, n: mit.length };
  });
  const sum = (k) => zeit.reduce((a, x) => a + x[k], 0);
  const zGes = sum('ges'), zWo = sum('wo'), zN = sum('n'), zLek = sum('lek'), zUeb = sum('ueb');
  const zMax = Math.max(1, ...zeit.map((x) => x.ges));
  const lernzeit = `<div class="card"><h3>${ico('clock')}Lernzeit<span class="sp"></span><span class="muted mini" title="Gezählt wird die gemessene Zeit abgeschlossener Lektionen und die Zeit im Wiederholen (je Aufgabe höchstens 10 Min.). Anki ist nicht dabei.">Lernen und Wiederholen, ohne Anki</span></h3>
    <div class="zeit-kacheln"><div><b class="num">${hm(zGes)}</b><span>insgesamt${zUeb ? ` · davon ${hm(zUeb)} Wiederholen` : ''}</span></div><div><b class="num">${hm(zWo)}</b><span>diese Woche</span></div>
      <div><b class="num">${zN ? Math.round(zLek / zN) : 0} Min.</b><span>im Schnitt je Lektion</span></div></div>
    <div class="fort">${zeit.map((x) => `<button class="zeit-row" data-nav="kurs:${x.c.slug}" style="${cc(x.c)}" title="${esc(x.c.name)}: ${hm(x.lek)} in ${x.n} Lektionen, ${hm(x.ueb)} Wiederholen">
      <span class="nm"><span class="dot"></span>${esc(x.c.short)}</span><span class="bar"><i style="width:${x.ges / zMax * 100}%"></i></span>
      <span class="v num"><b>${hm(x.ges)}</b></span><span class="inf num">diese Woche ${hm(x.wo)}${x.ueb ? ` · Wiederholen ${hm(x.ueb)}` : x.n ? ` · Ø ${Math.round(x.lek / x.n)} Min.` : ''}</span></button>`).join('')}</div></div>`;

  const recent = (d.recent || []).slice(0, 8);
  const claude = aktionen('claude').filter((a) => a.id !== 'ilias-sync');     // der Sync läuft in der App (Karte unten)
  return kopf('Diese Woche', `<button class="btn sm" data-url="kurstutor://sync" title="Roadmaps neu rechnen, Lernkalender und Lernhub aktualisieren">${ico('refresh')}Plan & Kalender abgleichen</button>`) +
    `<div class="view"><div class="wrap stack">
    <div><h1 class="title">${gruss}${d.name ? ', ' + esc(d.name) : ''}</h1>
      <p class="sub">KW ${isoWeek(mon)} · ${fDM(mon)}–${fDM(addDays(mon, 6))} · ${esc(d.semester.title)}${wochenBis != null ? ` · noch ${wochenBis} Wochen bis zu den Prüfungen` : ''}</p></div>
    ${hinweise()}
    <div class="modi">${Ln.karte()}${U.laufKarte()}</div>
    <div class="grid2">${pensum}${lt}</div>
    ${fort}
    ${lernzeit}
    <h2 class="sec-h">ILIAS</h2>
    ${Sy.karte()}
    ${recent.length ? `<div class="card"><h3>${ico('inbox')}Zuletzt aus ILIAS</h3><ul class="files">${recent.map((f) => `<li>${ico('file')}<span class="nm" title="${esc(f.name)}">${esc(f.name)}</span><span class="mt">${esc(S.byKey[f.course] ? S.byKey[f.course].short : f.course)} · ${esc(f.folder || '')} · ${fDM(pd(f.added))}</span><button class="btn sm ghost" data-url="${esc(f.url)}">Öffnen</button></li>`).join('')}</ul></div>` : ''}
    ${claude.length ? `<h2 class="sec-h">Mit Claude Code <span class="muted">öffnet Claude Code mit vorausgefülltem Befehl</span></h2>
    <div class="acts-grid">${claude.map(aktKarte).join('')}</div>` : ''}
  </div></div>`;
}

// ---------------------------------------------------------------- Nächster Lerntag
function diagramm() {
  const wk = S.d.stats.weeks || [];
  if (!wk.length) return '';
  const W = 900, H = 200, L = 34, B = 26, T = 14;
  const max = Math.max(60, ...wk.map((w) => Object.values(w.courses).reduce((s, x) => s + x.min, 0)));
  const step = Math.ceil(max / 4 / 60) * 60, top = step * 4;
  const bw = (W - L) / wk.length;
  const y = (m) => T + (H - T - B) * (1 - m / top);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = step * i;
    g += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v / 60} h</text>`;
  }
  const mon = S.d.semester.monday;
  wk.forEach((w, i) => {
    let acc = 0;
    const x = L + i * bw + bw * 0.18, wd = bw * 0.64;
    const tip = [];
    S.rc.forEach((c) => {
      const v = w.courses[c.key];
      if (!v) return;
      const y1 = y(acc + v.min), y0 = y(acc);
      g += `<rect x="${x}" y="${y1}" width="${wd}" height="${Math.max(0, y0 - y1 - 1)}" rx="2" fill="var(--c${c.color})"/>`;
      acc += v.min;
      tip.push(`${c.short}: ${v.n} L., ${v.min} Min.${v.done ? `, ${v.done} erledigt` : ''}`);
    });
    const kw = isoWeek(pd(w.monday)), jetzt = w.monday === mon;
    g += `<g class="${jetzt ? 'now' : ''}"><text x="${x + wd / 2}" y="${H - 8}" text-anchor="middle">${jetzt ? 'jetzt' : 'KW ' + kw}</text></g>`;
    g += `<rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent" data-tip="${esc(`KW ${kw} · ${fDM(pd(w.monday))} · ${Math.round(acc / 6) / 10} h${w.skip ? ' · Pause' : ''}`)}" data-tip2="${esc(tip.join('\n'))}"/>`;
  });
  const legende = S.rc.map((c) => `<span style="${cc(c)}"><span class="dot"></span>${esc(c.short)}</span>`).join('');
  const tabelle = `<table class="sr"><tr><th>Woche</th>${S.rc.map((c) => `<th>${esc(c.short)}</th>`).join('')}</tr>${wk.map((w) => `<tr><td>${w.monday}</td>${S.rc.map((c) => `<td>${w.courses[c.key] ? w.courses[c.key].min : 0}</td>`).join('')}</tr>`).join('')}</table>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Geplante Lernzeit je Woche bis zur Klausur">${g}</svg><div class="legend">${legende}</div>${tabelle}`;
}

export function lerntag() {
  const d = S.d, ag = d.agenda;
  const kal = aktion('calendar');
  const knoepfe = `${kal ? `<button class="btn sm" data-url="${esc(kal.url)}">${ico('calendar')}Im Kalender öffnen</button>` : ''}<button class="btn sm" data-url="kurstutor://sync">${ico('refresh')}Plan & Kalender abgleichen</button>`;
  let body = '<p class="empty">Kein Lerntag geplant.</p>';
  if (ag) {
    const tag = pd(ag.date);
    const zuerst = ((Ln.reihenfolge()[0] || {}).c || {}).key;      // der Kurs, den „Los“ zuerst nähme
    body = `<div><h1 class="title">${fWTL(tag)}, ${fDMY(tag)}</h1><p class="sub">Kalender „${esc(d.calendar.name)}“ · Start ${esc(d.calendar.start)} Uhr · gleicht sich bei jedem Abschluss selbst ab</p></div>
    <div class="agenda">${ag.events.map((e) => {
      const c = e.course ? S.byKey[e.course] : null;
      const block = e.kind === 'block' || e.kind === 'probe';
      const dran = c ? Ln.dran(c) : null;
      const ls = block && c ? `<div class="ls">${e.lessons.map((id) => {
        const l = c.byId[id];
        if (!l) return `<span class="lchip">${esc(id)}</span>`;
        const text = `${esc(id)} ${esc(l.title.length > 34 ? l.title.slice(0, 33) + '…' : l.title)}`;
        const titel = `title="${esc(l.title)} · ${ZUSTAND[zustand(l)]}"`;
        if (dran && dran.id === id) return `<button class="lchip jetzt" data-lernen="kurs|${esc(c.key)}" ${titel}>${ico('play')}${text}</button>`;
        if (l.state === 'erledigt') return `<span class="lchip erledigt" ${titel}>${ico('check')}${text}</span>`;
        return `<span class="lchip" ${titel}>${text}</span>`;
      }).join('')}</div>` : '';
      return `<div class="ev ${block ? 'block' : e.kind === 'lunch' ? 'pause' : ''}" style="${cc(c)}"><div class="zeit">${esc(e.start)}<small>bis ${esc(e.end)}</small></div>
        <div><div class="ttl">${esc(e.title)}${e.moved ? ' <span class="chip">von dir verschoben</span>' : ''}</div>${ls}</div>
        <div class="ev-akt">${c && dran ? `<button class="btn sm${zuerst === c.key ? ' primary' : ''}" data-lernen="kurs|${esc(c.key)}">${ico('play')}${dran.sitzung ? 'Weiterlernen' : 'Lernen'}</button>` : ''}${c ? `<button class="btn sm ghost" data-nav="kurs:${c.slug}">Kurs</button>` : ''}</div></div>`;
    }).join('')}</div>`;
  }
  return kopf('Nächster Lerntag', knoepfe) + `<div class="view"><div class="wrap stack">${body}
    <h2 class="sec-h">Pensum bis zur Klausur <span class="muted">geplante Minuten je Woche, aus den Roadmaps</span></h2>
    <div class="card">${diagramm()}</div>
    <h2 class="sec-h">Abgleich</h2><div class="acts-grid">${aktionen('native').map(aktKarte).join('')}</div>
  </div></div>`;
}

// ---------------------------------------------------------------- Kurs
const TABS = [['pfad', 'Pfad'], ['liste', 'Liste'], ['material', 'Material'], ['luecken', 'Lücken'], ['notizen', 'Notizen']];

export function kurs(c, tab = 'pfad') {
  if (!c.hasRoadmap) return kursOhne(c);
  if (!TABS.some(([id]) => id === tab)) tab = 'pfad';
  const exam = pd(c.exam);
  const reife = c.avgScore != null ? `<span>Ø <b>${c.avgScore} %</b> beim ersten Versuch (Ziel ${c.targetPercent} %)</span>` : '';
  const doneW = c.total ? c.done / c.total * 100 : 0;
  const offW = c.total ? Math.max(0, (c.quota - c.doneThis)) / c.total * 100 : 0;
  // Was die Skill sonst noch anbietet (Aufholplan, neues Material, Frage an den Tutor): öffnet Claude Code
  const kacts = (c.actions || []).filter((a) => a.url).map((a) => `<button class="btn sm" data-url="${esc(a.url)}" title="${esc(a.desc || '')}">${ico(a.icon)}${esc(a.title)}</button>`).join('');
  const rechts = `<button class="btn sm ghost" data-url="${esc(c.folderUrl)}">${ico('folder')}Ordner</button>${c.ilias ? `<button class="btn sm ghost" data-url="${esc(c.ilias)}">${ico('globe')}ILIAS</button>` : ''}`;
  let inhalt = '';
  if (tab === 'liste') inhalt = liste(c);
  else if (tab === 'material') inhalt = material(c);
  else if (tab === 'luecken') inhalt = `<div id="luecken"><p class="muted">Lücken laden …</p></div>`;
  else if (tab === 'notizen') inhalt = notizen(c);
  else inhalt = pfad(c);
  return kopf(`<span style="${cc(c)}" class="nodrag"><span class="dot" style="display:inline-block;margin-right:7px"></span></span>${esc(c.name)}`, rechts) +
    `<div class="view"><div class="wrap" style="${cc(c)}">
    <div class="khead"><div class="em">${esc(c.emoji)}</div><div style="flex:1;min-width:0"><h1 class="title">${esc(c.name)}</h1>
      <div class="facts"><span>Klausur <b>${fDMY(exam)}</b>${c.examAssumed ? ' (angenommen)' : ''}</span><span>Zielnote <b>${esc(c.targetGrade)}</b></span>
      <span><b>${c.done}</b> von ${c.total} Lektionen</span><span>diese Woche <b>${c.doneThis}/${c.quota}</b></span>${reife}${c.avgMin ? `<span>Ø <b>${c.avgMin} Min.</b></span>` : ''}</div></div></div>
    <div class="prog" title="${c.done} erledigt, ${c.quota - c.doneThis} diese Woche offen"><i style="width:${doneW}%"></i><i class="w" style="width:${offW}%"></i></div>
    <div class="modi">${Ln.kursKarte(c)}${U.kursKarte(c)}</div>
    ${kacts ? `<div class="kacts">${kacts}</div>` : ''}
    <nav class="tabs">${TABS.map(([id, t]) => `<button class="tab ${tab === id ? 'on' : ''}" data-nav="kurs:${c.slug}:${id}">${t}</button>`).join('')}</nav>
    ${inhalt}</div></div>`;
}

function kursOhne(c) {
  return kopf(esc(c.name), `<button class="btn sm ghost" data-url="${esc(c.folderUrl)}">${ico('folder')}Ordner</button>${c.ilias ? `<button class="btn sm ghost" data-url="${esc(c.ilias)}">${ico('globe')}ILIAS</button>` : ''}`) +
    `<div class="view"><div class="wrap stack"><div><h1 class="title">${esc(c.name)}</h1><p class="sub">Ohne Roadmap: nur Material aus ILIAS.</p></div>
    ${(c.actions || []).length ? `<div class="kacts">${c.actions.map((a) => `<button class="btn sm" data-url="${esc(a.url)}">${ico(a.icon)}${esc(a.title)}</button>`).join('')}</div>` : ''}
    ${material(c)}</div></div>`;
}

function wochen(c) {
  const by = {};
  c.lessons.forEach((l) => { (by[l.week || 'später'] = by[l.week || 'später'] || []).push(l); });
  return Object.keys(by).sort().map((w) => ({ w, ls: by[w] }));
}
function wocheTitel(w) {
  if (w === 'später') return 'Später';
  const m = pd(w);
  return `KW ${isoWeek(m)} · ${fDM(m)}–${fDM(addDays(m, 6))}`;
}

// Wochen, die vorbei und ganz erledigt sind, klappen ein: Die Seite beginnt mit dem, was jetzt ansteht.
function mitFrueher(c, zeichne) {
  const mon = S.d.semester.monday, alle = wochen(c);
  let i = alle.findIndex(({ w, ls }) => w === 'später' || w >= mon || ls.some((l) => l.state !== 'erledigt'));
  if (i < 0) i = alle.length;
  const html = alle.map(zeichne);
  if (!i) return html.join('');
  const n = alle.slice(0, i).reduce((a, x) => a + x.ls.length, 0);
  return `<details class="frueher" data-kurs="${esc(c.key)}" ${S.frueherOffen[c.key] ? 'open' : ''}><summary>${ico('chevron')}Frühere Wochen · ${n_(n, 'Lektion', 'Lektionen')} erledigt</summary>${html.slice(0, i).join('')}</details>${html.slice(i).join('')}`;
}

function liste(c) {
  const mon = S.d.semester.monday;
  return mitFrueher(c, ({ w, ls }) => {
    const dn = ls.filter((l) => l.state === 'erledigt').length;
    return `<section class="week ${w === mon ? 'cur' : ''}"><div class="week-h"><b>${wocheTitel(w)}</b><span>${dn}/${ls.length} erledigt</span></div>
      <ul class="lrows">${ls.map((l) => zeile(c, l)).join('')}</ul></section>`;
  });
}

const ZICK = [0, 46, 70, 46, 0, -46, -70, -46];
function kurzMeta(l) {
  if (l.state === 'erledigt') return [l.score != null ? l.score + ' %' : '', l.minutes ? l.minutes + ' Min.' : '', l.done ? 'am ' + fDM(pd(l.done)) : ''].filter(Boolean).join(' · ');
  if (zustand(l) === 'ph') return l.availableFrom ? 'Material ab ' + fDM(pd(l.availableFrom)) : 'Material folgt';
  return 'ca. ' + l.estMin + ' Min.';
}
function pfad(c) {
  const mon = S.d.semester.monday;
  const dran = Ln.dran(c);
  let i = 0;
  const secs = mitFrueher(c, ({ w, ls }) => {
    const dn = ls.filter((l) => l.state === 'erledigt').length;
    const nodes = ls.map((l) => {
      const x = ZICK[i++ % ZICK.length];
      const jetzt = !!dran && dran.id === l.id;
      const icon = l.state === 'erledigt' ? 'check' : jetzt ? 'play' : l.training ? 'target' : 'book';
      return `<div class="pnode ${jetzt ? 'jetzt' : zustand(l)} ${x > 0 ? 'left' : ''}" style="--x:${x}px">
        <button class="ball" data-pop="${esc(c.key)}|${esc(l.id)}" title="${esc(l.id)} ${esc(l.title)}">${ico(icon)}</button>
        <div class="plab"><b>${esc(l.id)} · ${esc(l.title)}</b><span>${jetzt ? (dran.sitzung ? 'läuft · ' : 'als Nächstes · ') : ''}${esc(kurzMeta(l))}</span></div></div>`;
    }).join('');
    return `<section class="psec ${w === mon ? 'cur' : ''}"><div class="psec-h"><b>${wocheTitel(w)}${w === mon ? ' · diese Woche' : ''}</b><span>${dn}/${ls.length}</span></div>${nodes}
      <div class="pflag">${ico('flag')}Wochenziel</div></section>`;
  });
  return `<div class="path">${secs}<div class="ptrophy">${ico('trophy')}Klausur am ${fDMY(pd(c.exam))}</div></div>`;
}

export function popKarte(c, l) {
  return `<div class="pop-k" style="${cc(c)}"><span class="dot"></span>${esc(c.short)} · ${esc(l.id)} · ${ZUSTAND[zustand(l)]}</div>
    <div class="t">${esc(l.title)}</div><div class="m">${esc(meta(l))}</div><div class="acts">${knopf(c, l, { gross: true })}</div>`;
}

function material(c) {
  const gr = (c.materials || []).map((g) => `<div class="card mat"><h3>${ico('folder')}${esc(g.group)}<span class="sp"></span><span class="muted">${g.files.length}</span></h3>
    <ul class="files">${g.files.map((f) => `<li>${ico('file')}<span class="nm" title="${esc(f.name)}">${esc(f.name)}</span>${f.new ? '<span class="chip acc">neu</span>' : ''}
      <button class="btn sm ghost" data-url="${esc(f.url)}">Öffnen</button>${f.reveal ? `<button class="icon-btn" data-url="${esc(f.reveal)}" title="Im Finder zeigen">${ico('folder')}</button>` : ''}</li>`).join('')}</ul></div>`).join('');
  const refs = (c.references || []).length ? `<div class="card mat"><h3>${ico('book')}Spickzettel</h3><ul class="files">${c.references.map((r) => `<li>${ico('book')}<span class="nm">${esc(r.title)}</span><button class="btn sm ghost" data-url="${esc(r.url)}">Öffnen</button></li>`).join('')}</ul></div>` : '';
  const links = (c.links || []).length ? `<div class="card mat"><h3>${ico('link')}Links</h3><ul class="files">${c.links.map((r) => `<li>${ico('link')}<span class="nm">${esc(r.title)}</span><button class="btn sm ghost" data-url="${esc(r.url)}">Öffnen</button></li>`).join('')}</ul></div>` : '';
  return refs + links + (gr || '<p class="empty">Kein Material.</p>');
}

function notizen(c) {
  return `<div class="grid2"><div class="card"><h3>${ico('target')}Mission</h3><p class="sel mission">${esc(c.mission || '')}</p>
      <div class="kacts">${(c.docs || []).map((x) => `<button class="btn sm" data-url="${esc(x.url)}">${ico('note')}${esc(x.title)}</button>`).join('')}</div></div>
    <div class="card"><h3>${ico('pen')}Learning Records</h3><ul class="files">${(c.records || []).map((r) => `<li>${ico('note')}<span class="nm" title="${esc(r.title)}">${esc(r.title)}</span><span class="mt">${r.date ? fDM(pd(r.date)) : ''}</span><button class="btn sm ghost" data-url="${esc(r.url)}">Öffnen</button></li>`).join('') || '<li class="muted">Noch keine.</li>'}</ul></div></div>`;
}

// Tab „Lücken“: was beim Lernen und Wiederholen noch wackelt (luecken.py) und was zum Wiederholen fällig ist
export function lueckenFuellen(el, text, c) {
  const p = c.practice;
  el.innerHTML = `<div class="grid2"><div class="card"><h3>${ico('target')}Offene Lücken<span class="sp"></span><span class="muted mini">schließen sich, wenn du das Thema beim Wiederholen sauber löst</span></h3><div class="pre sel">${esc(text || '–')}</div></div>
    <div class="card"><h3>${ico('refresh')}Zum Wiederholen fällig</h3>
      ${p ? `<div class="zeit-kacheln zwei"><div><b class="num">${p.faellig || 0}</b><span>von ${n_(p.themen || 0, 'Thema', 'Themen')} fällig</span></div><div><b class="num">${p.luecken || 0}</b><span>${p.luecken === 1 ? 'offene Lücke' : 'offene Lücken'}</span></div></div>
      <p class="muted mini">Was du sauber löst, kommt später wieder (nach 1, 3, 7, 14 und 30 Tagen). Lücken und lange nicht Geübtes kommen zuerst.</p>
      <div class="kacts"><button class="btn primary sm" data-ueben="kurs|${esc(c.key)}">${ico('play')}Wiederholen</button></div>`
    : '<p class="empty">Noch nichts gelernt, also noch nichts zu wiederholen.</p>'}</div></div>`;
}

// ---------------------------------------------------------------- Einstellungen
export function einstellungen(e, info) {
  const st = e.schluessel ? `<span class="chip ok">${ico('check')}gespeichert</span>` : '<span class="chip warn">kein Schlüssel</span>';
  return kopf('Einstellungen') + `<div class="view"><div class="wrap stack">
    <h1 class="title">Einstellungen</h1>
    <div class="card"><h3>${ico('mic')}Deepgram fürs Diktieren<span class="sp"></span>${st}</h3>
      <div class="form">
        <p class="muted">Im Lernen und Wiederholen kannst du deine Antwort diktieren (Mikrofon im Feld oder ⌘⇧L). Der Schlüssel wird mit Electron safeStorage verschlüsselt, der Schlüssel dazu liegt im macOS-Schlüsselbund. Er steht nirgends im Klartext und wird hier nie wieder angezeigt.${e.sicher ? '' : ' <b>Achtung: Verschlüsselung gerade nicht verfügbar.</b>'}</p>
        <div class="field"><input id="dg-key" type="password" placeholder="${e.schluessel ? 'Neuen Schlüssel eintragen, um ihn zu ersetzen' : 'Deepgram API-Schlüssel einfügen'}" autocomplete="off" spellcheck="false">
          <button class="btn primary" id="dg-save">Speichern</button></div>
        <div class="field"><button class="btn sm" id="dg-test" ${e.schluessel ? '' : 'disabled'}>Testen</button><button class="btn sm ghost" id="dg-del" ${e.schluessel ? '' : 'disabled'}>Entfernen</button><span id="dg-msg" class="muted"></span></div>
        <p class="muted">Modell nova-3, Sprache Deutsch. Ton geht direkt an Deepgram, nur während du diktierst.</p>
      </div></div>
    <div class="card"><h3>${ico('link')}Verbindung</h3><dl class="kv">
      <dt>Studienordner</dt><dd class="sel">${esc(info.root || 'nicht gefunden (kurs-tutor: KURSTUTOR_ROOT)')}</dd>
      <dt>Semester</dt><dd class="sel">${esc(S.d ? S.d.semester.path : '')}</dd>
      <dt>Skill kurs-tutor</dt><dd class="sel">${esc(info.skill)}</dd>
      <dt>Skill ilias-sync</dt><dd class="sel">${esc(info.ilias)}</dd>
      <dt>Claude</dt><dd>${info.claude ? 'gefunden. Lernen, Wiederholen und der ILIAS-Sync laufen über dein Claude-Abo (<code>claude -p</code>).' : '<b>claude nicht gefunden</b> (~/.local/bin/claude): Lernen, Wiederholen und der ILIAS-Sync brauchen es.'}</dd>
      <dt>Abschließen</dt><dd>${info.direkt ? 'direkt über tutor.py (Testmodus oder Kurs-Tutor-App fehlt)' : 'über die Kurs-Tutor-App: Roadmap, Kalender und Lernhub ziehen nach'}</dd>
      <dt>Version</dt><dd>${esc(info.version)}</dd></dl></div>
    <div class="card"><h3>${ico('grid')}Tastenkürzel</h3><div class="keys">
      <kbd>⌘ L</kbd><span>Lernen: die Lektion, die nach dem Plan dran ist</span><kbd>⌘ ⇧ W</kbd><span>Wiederholen: alle Kurse gemischt</span>
      <kbd>⌘ K</kbd><span>Suchen: Kurse, Lernen, Wiederholen, Aktionen</span><kbd>⌘ 0</kbd><span>Diese Woche</span><kbd>⌘ 1 … 6</kbd><span>Kurse</span>
      <kbd>⌘ ⇧ T</kbd><span>Nächster Lerntag</span><kbd>⌘ ⇧ L</kbd><span>Diktieren an/aus (im Lernen und Wiederholen)</span>
      <kbd>⌘ ⇧ S</kbd><span>Plan & Kalender abgleichen</span><kbd>⌘ R</kbd><span>Daten neu laden</span></div></div>
  </div></div>`;
}
