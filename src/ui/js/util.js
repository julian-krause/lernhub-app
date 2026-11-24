// Kleine Helfer: Escaping, Icons (gleiche Linien-Icons wie Lernhub.html), Datumsformate.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4.5" height="6" rx="1.6"/><rect x="16.5" y="14" width="4.5" height="6" rx="1.6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  play: '<path d="M7.5 5v14l11-7-11-7Z"/>',
  sparkles: '<path d="M11 3.5l1.6 4.4 4.4 1.6-4.4 1.6L11 15.5l-1.6-4.4L5 9.5l4.4-1.6L11 3.5Z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>',
  download: '<path d="M12 3.5v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M5 20.5h14"/>',
  chat: '<path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.6A8.5 8.5 0 1 1 20.5 12Z"/>',
  note: '<path d="M14 3H6.5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5L14 3Z"/><path d="M14 3v5.5h5.5"/><path d="M8.5 13h7M8.5 16.5h4.5"/>',
  cards: '<rect x="3.5" y="7" width="13" height="13.5" rx="2"/><path d="M7.5 3.5H18a2.5 2.5 0 0 1 2.5 2.5v10.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.2h7.2a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  inbox: '<path d="M3.5 13.5h5l1.5 3h4l1.5-3h5"/><path d="M6 5.5h12l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-5L6 5.5Z"/>',
  pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>',
  file: '<path d="M14 3H6.5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5L14 3Z"/><path d="M14 3v5.5h5.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5S9.6 5.9 12 3.5Z"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  grad: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5 2.5 9Z"/><path d="M6.5 11v5c3 2.3 8 2.3 11 0v-5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4.5h11.5l-2 4 2 4H5"/>',
  trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0V4Z"/><path d="M7.5 6H4.5v1.5A3 3 0 0 0 7.6 10.5M16.5 6h3v1.5a3 3 0 0 1-3.1 3"/><path d="M12 13.5v3.5M8.5 20.5h7M9.5 20.5c0-2 1-3.5 2.5-3.5s2.5 1.5 2.5 3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  // Spiel (js/spiel.js, js/regeln.js)
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.4-5.4 3.6-8.3.4 1.7 1.3 2.9 2.4 3.4-.2-2.9.9-5.6 3.2-7.4.3 3.4 4.8 5.7 4.8 11.4 0 4.1-3 7.1-7.5 7.1Z"/><path d="M12 21c-1.7 0-3-1.2-3-2.9 0-1.9 1.6-2.9 2.3-4.6 1.4 1.3 3.7 2.4 3.7 4.6 0 1.7-1.3 2.9-3 2.9Z"/>',
  bolt: '<path d="M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5l1-8Z"/>',
  ring: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/><circle cx="12" cy="12" r="3"/>',
  crown: '<path d="M3.5 8 7.5 12 12 5l4.5 7 4-4-1.8 10.5H5.3L3.5 8Z"/><path d="M5.5 21h13"/>',
  chest: '<path d="M3.5 10.5h17v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-8Z"/><path d="M3.5 10.5V9a4.5 4.5 0 0 1 4.5-4.5h8A4.5 4.5 0 0 1 20.5 9v1.5"/><path d="M10 10.5v3h4v-3"/>',
  chestOpen: '<path d="M3.5 12.5h17v6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-6Z"/><path d="M4.5 12.5 6 5.5h12l1.5 7"/><path d="M10 12.5v2.5h4v-2.5"/><path d="M12 2v1.5M8.5 2.8l.6 1.2M15.5 2.8l-.6 1.2"/>',
  medal: '<circle cx="12" cy="15" r="5.5"/><path d="M8.5 10.7 6 3.5h4l2 4.5 2-4.5h4l-2.5 7.2"/><path d="m12 12.6.8 1.6 1.7.2-1.3 1.2.4 1.7-1.6-.9-1.6.9.4-1.7-1.3-1.2 1.7-.2.8-1.6Z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  focus: '<path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z"/><path d="M10 21h4"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
};
export const ico = (n, cls) => `<svg class="i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ICONS.file}</svg>`;

// Maskottchen: eine Flamme mit Gesicht, drei Stimmungen (froh, muede, jubelnd). Flächen ohne Verläufe,
// Farben aus --flamme und --gold, das Gesicht dunkel auf dem hellen Kern.
const GESICHT = {
  froh: '<circle cx="27.5" cy="43" r="2.3" class="fl-a"/><circle cx="36.5" cy="43" r="2.3" class="fl-a"/><path d="M28.5 48.5q3.5 3.5 7 0" class="fl-l"/>',
  muede: '<path d="M25 43.5h5M34 43.5h5" class="fl-l"/><path d="M29.5 50h5" class="fl-l"/>',
  jubelnd: '<path d="M25 44.5l2.5-3 2.5 3M34 44.5l2.5-3 2.5 3" class="fl-l"/><path d="M27.5 48h9q-1 6-4.5 6t-4.5-6Z" class="fl-a"/>',
};
export const flamme = (stimmung = 'froh', px = 40) => `<svg class="flamme fl-${stimmung}" viewBox="0 0 64 64" width="${px}" height="${px}" aria-hidden="true">
  <path class="fl-aussen" d="M32 3c3 10 12 15 17 25 4 8 4 18-2 25-5 6-10 8-15 8s-10-2-15-8c-6-7-6-16-2-23 2-4 5-7 7-10 0 6 2 10 5 11-1-9 1-19 5-28Z"/>
  <path class="fl-innen" d="M32 24c3 7 9 11 9 20 0 6-4 10-9 10s-9-4-9-10c0-6 5-11 9-20Z"/>
  ${stimmung === 'jubelnd' ? '<path class="fl-funke" d="M8 14l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4ZM56 10l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5 1.5-3Z"/>' : ''}
  ${GESICHT[stimmung] || GESICHT.froh}</svg>`;

export const pd = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const WTL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const fDM = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
export const fDMY = (d) => fDM(d) + d.getFullYear();
export const fWTL = (d) => WTL[d.getDay()];
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}
export const cc = (c) => `--cc:var(--c${c && c.color ? c.color : 0})`;
const nfc = (s) => String(s || '').normalize('NFC');
export const norm = (s) => nfc(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
export const n_ = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const $ = (sel, root = document) => root.querySelector(sel);
