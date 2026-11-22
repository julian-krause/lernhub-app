// Spielregeln des Lernhubs: reine Funktionen ohne DOM und ohne Electron (Test: tests/spiel.test.mjs).
//   XP         Lektionen zählen aus der Roadmap (nichts wird doppelt gebucht, „Rückgängig“ nimmt die XP wieder weg);
//              Prüffragen, Aufgaben, Quests und das Tagesziel stehen als Buchungen im Spielstand (spiel.json).
//   Level      Level L ist ab 50·L·(L−1) XP erreicht: die ersten Level gehen schnell, spätere brauchen länger.
//   Serie      Wochen in Folge mit genug Lerntagen. Keine Tages-Serie: Gelernt wird in Schüben mit Pausentagen,
//              eine Tages-Serie risse jede Woche und wäre dann nichts mehr wert. Ferienwochen zählen nicht mit.
//   Quests     drei je Tag (eine fürs Lernen, eine fürs Wiederholen, eine fürs Können), aus dem Datum gewählt.
//   Abzeichen  aus Fakten berechnet; der Spielstand merkt sich nur, wann eines freigeschaltet wurde.
const pad = (n) => String(n).padStart(2, '0');
const teile = (tag) => String(tag).slice(0, 10).split('-').map(Number);

export const tagVon = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
export const plusTage = (tag, n) => { const [y, m, d] = teile(tag); return tagVon(new Date(y, m - 1, d + n)); };
export const montag = (tag) => { const [y, m, d] = teile(tag); return plusTage(tag, -((new Date(y, m - 1, d).getDay() + 6) % 7)); };

// ---------------------------------------------------------------- XP
// Lektion: 40 fürs Durchziehen, bis zu 60 für die Genauigkeit beim ersten Versuch, 20 obendrauf für fehlerfrei.
export const xpLektion = (score) => (score == null ? 60 : 40 + Math.round(score * 0.6) + (score >= 100 ? 20 : 0));
export const sterne = (score) => (score == null ? 0 : score >= 85 ? 3 : score >= 65 ? 2 : 1);

// Prüffrage. combo = richtige Prüffragen in Folge einschließlich dieser. Auch ein Fehlversuch bringt etwas:
// Wer sich traut zu antworten, lernt mehr als wer „Weiß ich nicht“ sammelt, aber beides soll nicht wehtun.
export const COMBO_BONUS_MAX = 5;
export function xpFrage({ rolle = 'pruefung', urteil, combo = 0, glueck = false }) {
  if (rolle !== 'pruefung') return 3;                    // Vorhersage, Aufwärmen: fürs Mitmachen
  if (urteil === 'richtig') {
    const xp = 10 + 2 * Math.min(Math.max(combo - 1, 0), COMBO_BONUS_MAX);
    return glueck ? xp * 2 : xp;
  }
  if (urteil === 'teils') return 5;
  return urteil === 'falsch' ? 2 : 1;
}
// Aufgabe beim Wiederholen. combo = sauber gelöste Aufgaben in Folge einschließlich dieser.
export function xpAufgabe(ergebnis, combo = 0) {
  if (ergebnis === 'geloest') return 20 + 3 * Math.min(Math.max(combo - 1, 0), 4);
  if (ergebnis === 'hinweise') return 12;
  if (ergebnis === 'weiter' || ergebnis === 'aufgegeben') return 5;
  return 0;
}
export const XP_TAGESZIEL = 20, XP_TRUHE = 30;

// ---------------------------------------------------------------- Level
export const xpBis = (l) => 50 * l * (l - 1);
const RAENGE = [[1, 'Funke'], [3, 'Flämmchen'], [5, 'Flamme'], [8, 'Lagerfeuer'], [12, 'Fackel'], [16, 'Leuchtfeuer'], [20, 'Komet'], [25, 'Stern'], [30, 'Supernova']];
export const rang = (l) => RAENGE.filter(([ab]) => l >= ab).pop()[1];
export function levelVon(xp) {
  xp = Math.max(0, Math.round(xp || 0));
  let l = Math.max(1, Math.floor((1 + Math.sqrt(1 + 4 * xp / 50)) / 2));
  while (xpBis(l + 1) <= xp) l++;
  while (l > 1 && xpBis(l) > xp) l--;
  const von = xpBis(l), bis = xpBis(l + 1);
  const naechster = RAENGE.find(([ab]) => ab > l);
  return { level: l, xp, von, bis, im: xp - von, braucht: bis - von, rest: bis - xp, anteil: (xp - von) / (bis - von), rang: rang(l),
    naechsterRang: naechster ? { level: naechster[0], name: naechster[1] } : null };
}

// ---------------------------------------------------------------- Lerntage und Wochenserie
// Ein Lerntag: eine Lektion abgeschlossen, mindestens 5 Min. wiederholt oder mindestens 40 XP gesammelt.
export const LERNTAG_XP = 40, LERNTAG_SEK = 300;
export function lerntage({ kurse = [], tage = {} }) {
  const s = new Set(), ueb = {};
  for (const c of kurse) {
    for (const l of c.lessons || []) if (l.done) s.add(String(l.done).slice(0, 10));
    for (const [t, sek] of Object.entries((c.practice && c.practice.zeit) || {})) ueb[t] = (ueb[t] || 0) + sek;
  }
  for (const [t, sek] of Object.entries(ueb)) if (sek >= LERNTAG_SEK) s.add(t);
  for (const [t, x] of Object.entries(tage)) if ((x.xp || 0) >= LERNTAG_XP) s.add(t);
  return s;
}

const wocheVon = (mo) => Array.from({ length: 7 }, (_, i) => plusTage(mo, i));
export function wochenserie(aktiv, heute, ziel = 3, ferien = []) {
  const mo = montag(heute);
  const zahl = (m) => wocheVon(m).filter((t) => aktiv.has(t)).length;
  // Ferienwoche: liegt überwiegend in den Ferien. Sie verlängert die Serie nicht und beendet sie nicht.
  const frei = (m) => ferien.some(([a, b]) => wocheVon(m).filter((t) => t >= a && t <= b).length >= 4);
  const dieseWoche = zahl(mo), geschafft = dieseWoche >= ziel;
  const erster = [...aktiv].sort()[0];
  const start = erster ? montag(erster) : mo;
  let serie = geschafft ? 1 : 0;
  for (let m = plusTage(mo, -7), n = 0; m >= start && n < 520; m = plusTage(m, -7), n++) {
    if (zahl(m) >= ziel) serie++; else if (!frei(m)) break;
  }
  let rekord = 0, lauf = 0;
  for (let m = start, n = 0; m <= mo && n < 520; m = plusTage(m, 7), n++) {
    if (zahl(m) >= ziel) lauf++; else if (!frei(m) && m !== mo) lauf = 0;
    rekord = Math.max(rekord, lauf);
  }
  const tage = wocheVon(mo).map((t) => ({ tag: t, aktiv: aktiv.has(t), heute: t === heute, zukunft: t > heute }));
  const offen = Math.max(0, ziel - dieseWoche);
  const uebrig = tage.filter((t) => t.zukunft || (t.heute && !t.aktiv)).length;      // Tage, die diese Woche noch zählen können
  return { serie, rekord: Math.max(rekord, serie), dieseWoche, ziel, geschafft, offen, uebrig, tage,
    heuteAktiv: aktiv.has(heute), moeglich: uebrig >= offen, knapp: !geschafft && offen > 0 && uebrig === offen };
}

// ---------------------------------------------------------------- Tagesquests
// stand: { lektionen, stark, richtig, comboMax, geloest, kurse, vorhersagen, xp }
const QUESTS = {
  lernen: [
    { id: 'lektion1', text: 'Schließ eine Lektion ab', wert: 'lektionen', ziel: 1, xp: 20, icon: 'grad' },
    { id: 'lektion2', text: 'Schließ zwei Lektionen ab', wert: 'lektionen', ziel: 2, xp: 35, icon: 'grad' },
    { id: 'stark', text: 'Schließ eine Lektion mit 80 % oder mehr ab', wert: 'stark', ziel: 1, xp: 25, icon: 'star' },
  ],
  ueben: [
    { id: 'aufgabe1', text: 'Lös eine Aufgabe beim Wiederholen', wert: 'geloest', ziel: 1, xp: 15, icon: 'target' },
    { id: 'aufgaben3', text: 'Lös drei Aufgaben beim Wiederholen', wert: 'geloest', ziel: 3, xp: 30, icon: 'target' },
  ],
  koennen: [
    { id: 'richtig5', text: 'Beantworte fünf Prüffragen richtig', wert: 'richtig', ziel: 5, xp: 20, icon: 'check' },
    { id: 'combo3', text: 'Schaff eine 3er-Combo', wert: 'comboMax', ziel: 3, xp: 15, icon: 'flame' },
    { id: 'combo5', text: 'Schaff eine 5er-Combo', wert: 'comboMax', ziel: 5, xp: 30, icon: 'flame' },
    { id: 'kurse2', text: 'Lern in zwei verschiedenen Kursen', wert: 'kurse', ziel: 2, xp: 20, icon: 'cards' },
    { id: 'vorhersage2', text: 'Wag zwei Vorhersagen', wert: 'vorhersagen', ziel: 2, xp: 10, icon: 'sparkles' },
  ],
};
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export function quests(tag, stand = {}) {
  return ['lernen', 'ueben', 'koennen'].map((gruppe) => {
    const liste = QUESTS[gruppe], q = liste[hash(tag + gruppe) % liste.length];
    const roh = stand[q.wert], ist = Math.min(q.ziel, Array.isArray(roh) ? roh.length : roh || 0);
    return { id: q.id, text: q.text, icon: q.icon, ziel: q.ziel, xp: q.xp, ist, fertig: ist >= q.ziel };
  });
}

// ---------------------------------------------------------------- Abzeichen
// fakten: { lektionen, perfekt, serie, combo, geloest, zieltage, truhen, level, kursAnteil, wochenpensum, frueh, spaet }
const STUFEN = (id, name, icon, wert, stufen, text) => stufen.map((n, i) => ({ id: id + n, name: stufen.length > 1 ? `${name} ${'I'.repeat(i + 1)}` : name, icon, wert, ziel: n, text: text(n) }));
const ABZEICHEN = [
  ...STUFEN('lektionen', 'Dranbleiber', 'grad', 'lektionen', [1, 10, 25, 50, 100, 200], (n) => (n === 1 ? 'Die erste Lektion abgeschlossen' : `${n} Lektionen abgeschlossen`)),
  ...STUFEN('serie', 'Wochenserie', 'flame', 'serie', [2, 4, 8, 12], (n) => `${n} Wochen in Folge das Lerntage-Ziel geschafft`),
  ...STUFEN('combo', 'Combo', 'bolt', 'combo', [5, 10], (n) => `${n} Prüffragen in Folge richtig`),
  ...STUFEN('ueben', 'Wiederholer', 'target', 'geloest', [10, 50, 200], (n) => `${n} Aufgaben beim Wiederholen gelöst`),
  ...STUFEN('ziel', 'Tagesziel', 'ring', 'zieltage', [1, 7, 30], (n) => (n === 1 ? 'Das Tagesziel zum ersten Mal erreicht' : `An ${n} Tagen das Tagesziel erreicht`)),
  ...STUFEN('level', 'Aufsteiger', 'crown', 'level', [10, 20, 30], (n) => `Level ${n} erreicht`),
  { id: 'perfekt', name: 'Fehlerfrei', icon: 'star', wert: 'perfekt', ziel: 1, text: 'Eine Lektion mit 100 % abgeschlossen' },
  { id: 'truhen5', name: 'Schatzsucher', icon: 'chest', wert: 'truhen', ziel: 5, text: 'Fünf Tagestruhen geöffnet (alle drei Quests an einem Tag)' },
  { id: 'wochenpensum', name: 'Woche im Sack', icon: 'flag', wert: 'wochenpensum', ziel: 1, text: 'Das ganze Wochenpensum geschafft' },
  { id: 'halbzeit', name: 'Halbzeit', icon: 'medal', wert: 'kursAnteil', ziel: 50, text: 'Einen Kurs zur Hälfte geschafft' },
  { id: 'kursfertig', name: 'Klausurreif', icon: 'trophy', wert: 'kursAnteil', ziel: 100, text: 'Alle Lektionen eines Kurses abgeschlossen' },
  { id: 'frueh', name: 'Früher Vogel', icon: 'sun', wert: 'frueh', ziel: 1, text: 'Vor 8 Uhr gelernt' },
  { id: 'spaet', name: 'Nachteule', icon: 'moon', wert: 'spaet', ziel: 1, text: 'Nach 22 Uhr gelernt' },
];
export function abzeichen(fakten = {}) {
  return ABZEICHEN.map((a) => {
    const ist = Math.max(0, Math.round(fakten[a.wert] || 0));
    return { id: a.id, name: a.name, icon: a.icon, text: a.text, ziel: a.ziel, ist: Math.min(ist, a.ziel), fertig: ist >= a.ziel };
  });
}

// Lob nach einer richtigen Antwort: wechselt, damit es nicht abstumpft, und wird mit der Combo größer.
const LOB = [['Richtig!', 'Stimmt!', 'Genau!', 'Sitzt!', 'Treffer!'], ['Läuft!', 'Stark!', 'Weiter so!', 'Sauber!'], ['Du brennst!', 'Unaufhaltsam!', 'Wie am Schnürchen!', 'Lauffeuer!']];
export const lob = (combo, n = 0) => { const l = LOB[combo >= 5 ? 2 : combo >= 3 ? 1 : 0]; return l[Math.abs(n) % l.length]; };
const TROST = ['Noch nicht.', 'Knapp daneben.', 'Fast.', 'Daraus lernst du am meisten.'];
export const trost = (n = 0) => TROST[Math.abs(n) % TROST.length];
