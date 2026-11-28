#!/usr/bin/env node
// claude-Attrappe für tests/handy.test.mjs: Lernen und Wiederholen im Leise-Modus (iPhone).
//   Lernen:      Start → Auswahlfrage 1 → freie Frage 2 (aufdecken, selbst einschätzen) → Text ohne Frage
//                → Rückfrage per Knopf → [WEITER] / [ABSCHLIESSEN] → Abschluss
//   Wiederholen: Start → Aufgabe mit 4 Optionen → falsche Wahl: Hinweis → richtige Wahl: Abschluss „hinweise“
//                → [NÄCHSTE AUFGABE] → Aufgabe 2 → Text in der Pause
import fs from 'fs';
const args = process.argv.slice(2);
const sid = args[args.indexOf('--session-id') + 1] || args[args.indexOf('--resume') + 1] || 'x';
let ein = ''; process.stdin.on('data', (b) => { ein += b; });
process.stdin.on('end', () => {
  if (process.env.HANDY_ATTRAPPE_LOG) fs.appendFileSync(process.env.HANDY_ATTRAPPE_LOG, JSON.stringify({ args: args.filter((a) => a.length < 200), ein }) + '\n');
  const abschluss = { art: 'abschluss', text: 'Das sitzt: HEAD, Branch, Commit.', bewertung: 'keine', gelernt: ['HEAD zeigt auf einen Branch', 'Commits sind Objekte', 'Branches rücken vor'],
    offen: [], nachlesen: [], kernaussage: 'Grundkette sitzt', schritte: [{ titel: 'Schritt A', thema: 'handy-a', kern: 'Kern A.' }, { titel: 'Schritt B', thema: 'handy-b', kern: 'Kern B.' }] };
  let x;
  // ---- Lernen
  if (/\[Uni-Lektion\]/.test(ein)) x = { art: 'frage', plan: ['Schritt A', 'Schritt B'], schritt: 1, text: 'Schritt-1-Unterricht: **HEAD** zeigt auf einen Branch.',
    rolle: 'pruefung', frage: 'Worauf zeigt `HEAD` nach `git switch dev`?', optionen: ['auf den Commit', 'auf refs/heads/dev', 'auf den Tree', 'auf den Index'], richtig: 1, erklaerung: 'ERKL-1: symbolische Referenz.' };
  else if (/^Antwort auf Frage 1 /.test(ein)) x = { art: 'frage', schritt: 2, text: 'Auflösung 1. Schritt-2-Unterricht.', rolle: 'pruefung',
    frage: 'Wie viele Objekte entstehen bei einem Commit mit einer neuen Datei?', optionen: [], loesung: 'LSG-2: drei (Blob, Tree, Commit)', erklaerung: 'ERKL-2' };
  else if (/^Antwort auf Frage 2 /.test(ein)) x = { art: 'text', bewertung: 'keine', text: 'NACH-SELBST: Gut eingeschätzt. Blob, Tree und Commit.' };
  else if (/^(Rückfrage|Gib mir bitte noch ein Beispiel)/.test(ein)) x = { art: 'text', bewertung: 'keine', text: 'BEISPIEL-ANTWORT: Stell dir HEAD als Lesezeichen vor.' };
  else if (/\[WEITER\]|\[ABSCHLIESSEN\]/.test(ein)) x = abschluss;
  // ---- Wiederholen
  else if (/\[Uni-Übung\]|\[NÄCHSTE AUFGABE\]/.test(ein)) {
    const n = /NÄCHSTE/.test(ein) ? 2 : 1;
    x = { art: 'aufgabe', text: '', aufgabe: `AUFGABE-${n}: Welche Datei ignoriert \`/build\`?`, modus: 'abruf', thema: 'L1', musterloesung: `MUSTER-${n}: nur build/a.js.`,
      ...(/\[Leise-Modus/.test(ein) || n === 2 ? { optionen: ['src/build/b.js', 'beide', 'build/a.js', 'keine'], richtig: 2 } : {}) };
  } else if (/^Gewählt \(Versuch 1\)[^\n]*FALSCH/.test(ein)) x = { art: 'text', text: 'HINWEIS-R1: Schau, wo der Schrägstrich steht.', stufe: 'R1' };
  else if (/^Gewählt \(Versuch \d\)[^\n]*RICHTIG/.test(ein)) x = { art: 'abschluss', text: 'Jetzt passt es.', ergebnis: /Versuch 1/.test(ein) ? 'geloest' : 'hinweise', urteil: 'URTEIL: Wurzelbindung erkannt.', stufe: 'R1', fehlerart: 'Verwechslung', wiederholen: false };
  else x = { art: 'text', text: 'PAUSE-ANTWORT: Der Schrägstrich vorne bindet an die Wurzel.', bewertung: 'keine' };
  setTimeout(() => process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '', session_id: sid, structured_output: x })), 300);
});
