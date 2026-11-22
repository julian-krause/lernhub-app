// Spielregeln (src/ui/js/regeln.js): XP, Level, Lerntage, Wochenserie, Quests, Abzeichen. Reine Funktionen,
// ohne Electron. Aufruf: node tests/spiel.test.mjs
import * as R from '../src/ui/js/regeln.js';

let fehler = 0;
const check = (ok, text) => { console.log((ok ? '✓ ' : '✗ ') + text); if (!ok) { fehler++; process.exitCode = 1; } };
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Datum
check(R.plusTage('2026-11-30', 1) === '2026-12-01' && R.plusTage('2026-03-01', -1) === '2026-02-28', 'plusTage rechnet über Monatsgrenzen');
check(R.montag('2026-11-22') === '2026-11-16' && R.montag('2026-11-16') === '2026-11-16' && R.montag('2026-11-23') === '2026-11-23', 'montag: Sonntag gehört zur Woche davor');

// ---- XP
check(R.xpLektion(0) === 40 && R.xpLektion(50) === 70 && R.xpLektion(100) === 120 && R.xpLektion(null) === 60, 'Lektion: 40 bis 100 XP nach Genauigkeit, 120 für fehlerfrei, 60 ohne Score');
check(gleich([null, 40, 65, 84, 85, 100].map(R.sterne), [0, 1, 2, 2, 3, 3]), 'Sterne: ab 65 % zwei, ab 85 % drei');
check(R.xpFrage({ urteil: 'richtig', combo: 1 }) === 10 && R.xpFrage({ urteil: 'richtig', combo: 3 }) === 14 && R.xpFrage({ urteil: 'richtig', combo: 99 }) === 20, 'Prüffrage richtig: 10 XP, Combo bringt bis zu 10 dazu');
check(R.xpFrage({ urteil: 'richtig', combo: 2, glueck: true }) === 24, 'Glückstreffer verdoppelt');
check(R.xpFrage({ urteil: 'teils' }) === 5 && R.xpFrage({ urteil: 'falsch' }) === 2 && R.xpFrage({ urteil: 'weissnicht' }) === 1, 'teils 5, falsch 2, weiß nicht 1: ein Versuch lohnt sich mehr als keiner');
check(R.xpFrage({ rolle: 'vorhersage', urteil: 'falsch' }) === 3, 'Vorhersage: 3 XP fürs Mitmachen, egal wie sie ausgeht');
check(R.xpAufgabe('geloest', 1) === 20 && R.xpAufgabe('geloest', 9) === 32 && R.xpAufgabe('hinweise') === 12 && R.xpAufgabe('aufgegeben') === 5 && R.xpAufgabe('verworfen') === 0, 'Aufgabe: gelöst 20 (+Combo), mit Hinweisen 12, aufgegeben 5, verworfen 0');

// ---- Level
check(R.levelVon(0).level === 1 && R.levelVon(99).level === 1 && R.levelVon(100).level === 2 && R.levelVon(299).level === 2 && R.levelVon(300).level === 3, 'Level: 100 XP für Level 2, 300 für Level 3');
const lv = R.levelVon(8026);
check(lv.level === 13 && lv.von === 7800 && lv.bis === 9100 && lv.rest === 1074 && lv.rang === 'Fackel', `8026 XP = Level 13 „${lv.rang}“, noch ${lv.rest} XP bis Level 14`);
check(lv.naechsterRang.level === 16 && R.levelVon(50000).naechsterRang === null && R.levelVon(-5).level === 1, 'nächster Rang, Ende der Ränge, negative XP');
let ok = true;
for (let l = 1; l < 60; l++) if (R.levelVon(R.xpBis(l)).level !== l || (l > 1 && R.levelVon(R.xpBis(l) - 1).level !== l - 1)) ok = false;
check(ok, 'Levelgrenzen stimmen für Level 1 bis 59');

// ---- Lerntage
const kurse = [
  { lessons: [{ done: '2026-11-17' }, { done: '2026-11-18' }, { done: null }], practice: { zeit: { '2026-11-13': 200, '2026-11-08': 1445 } } },
  { lessons: [{ done: '2026-11-22' }], practice: { zeit: { '2026-11-13': 150 } } },
];
const aktiv = R.lerntage({ kurse, tage: { '2026-11-19': { xp: 39 }, '2026-11-20': { xp: 40 } } });
check(gleich([...aktiv].sort(), ['2026-11-08', '2026-11-13', '2026-11-17', '2026-11-18', '2026-11-20', '2026-11-22']), 'Lerntag: Lektion, 5 Min. Wiederholen (über Kurse summiert) oder 40 XP');

// ---- Wochenserie (echter Verlauf: KW 43 sechs Tage, KW 44 einer, KW 45 fünf, KW 46 vier, KW 47 drei)
const verlauf = new Set(['2026-10-16', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-27',
  '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-10', '2026-11-11', '2026-11-13', '2026-11-14', '2026-11-17', '2026-11-18', '2026-11-22']);
const w = R.wochenserie(verlauf, '2026-11-22', 3);
check(w.serie === 3 && w.dieseWoche === 3 && w.geschafft && w.rekord === 3, 'Serie 3 Wochen (KW 45 bis 47), KW 44 mit einem Lerntag hat sie unterbrochen');
check(w.tage.length === 7 && w.tage[6].heute && w.tage[6].aktiv && w.tage.filter((t) => t.aktiv).length === 3, 'Wochenpunkte Mo bis So, heute ist markiert');
const w4 = R.wochenserie(verlauf, '2026-11-22', 4);
check(w4.serie === 2 && !w4.geschafft && w4.offen === 1 && w4.uebrig === 0 && !w4.moeglich, 'Ziel 4: laufende Woche zählt noch nicht, die Serie davor steht (2), heute ist schon gezählt');
const mi = R.wochenserie(new Set([...verlauf].filter((t) => t < '2026-11-18')), '2026-11-18', 3);
check(mi.serie === 2 && mi.dieseWoche === 1 && mi.offen === 2 && mi.uebrig === 5 && mi.moeglich && !mi.knapp, 'mitten in der Woche: Serie bleibt stehen, solange die Woche läuft');
const sa = R.wochenserie(new Set([...verlauf].filter((t) => t < '2026-11-21')), '2026-11-21', 3);
check(sa.offen === 1 && sa.uebrig === 2 && R.wochenserie(new Set([...verlauf].filter((t) => t < '2026-11-22')), '2026-11-22', 3).knapp, 'knapp: so viele Tage übrig wie Lerntage fehlen');
const ferien = R.wochenserie(new Set(['2026-12-14', '2026-12-15', '2026-12-16', '2027-01-04', '2027-01-05', '2027-01-06']), '2027-01-06', 3, [['2026-12-21', '2027-01-03']]);
check(ferien.serie === 2 && R.wochenserie(new Set(['2026-12-14', '2026-12-15', '2026-12-16', '2027-01-04', '2027-01-05', '2027-01-06']), '2027-01-06', 3).serie === 1, 'Ferienwochen unterbrechen die Serie nicht');
check(R.wochenserie(new Set(), '2026-11-22', 3).serie === 0, 'ohne Lerntage: Serie 0');

// ---- Quests
const q = R.quests('2026-11-22', { lektionen: 2, stark: 1, richtig: 9, comboMax: 4, geloest: 1, kurse: ['a', 'b'], vorhersagen: 2 });
check(q.length === 3 && gleich(q, R.quests('2026-11-22', { lektionen: 2, stark: 1, richtig: 9, comboMax: 4, geloest: 1, kurse: ['a', 'b'], vorhersagen: 2 })), 'drei Quests je Tag, am selben Tag dieselben');
check(q.every((x) => x.ist <= x.ziel && x.xp > 0 && x.text) && q[0].fertig, 'Fortschritt ist auf das Ziel gedeckelt');
const mengen = new Set(); for (let i = 0; i < 40; i++) mengen.add(R.quests(R.plusTage('2026-11-01', i)).map((x) => x.id).join());
check(mengen.size >= 6, `Quests wechseln von Tag zu Tag (${mengen.size} verschiedene Sätze in 40 Tagen)`);
check(R.quests('2026-11-22').every((x) => x.ist === 0 && !x.fertig), 'ohne Stand: alles offen');

// ---- Abzeichen
const a = R.abzeichen({ lektionen: 92, serie: 3, combo: 4, geloest: 12, level: 13, kursAnteil: 35.5, perfekt: 2 });
const hat = (id) => a.find((x) => x.id === id).fertig;
check(hat('lektionen50') && !hat('lektionen100') && hat('serie2') && !hat('serie4') && !hat('combo5') && hat('ueben10') && hat('level10') && hat('perfekt') && !hat('halbzeit'), 'Abzeichen folgen den Fakten');
check(a.find((x) => x.id === 'lektionen100').ist === 92 && new Set(a.map((x) => x.id)).size === a.length, 'Fortschritt zum nächsten Abzeichen, Schlüssel sind eindeutig');
check(R.lob(1, 0) !== R.lob(5, 0) && typeof R.trost(3) === 'string', 'Lob wächst mit der Combo');

console.log(fehler ? `${fehler} Fehler` : 'Spielregeln: alles in Ordnung');
