#!/usr/bin/env node
// claude-Attrappe für tests/lernen.test.mjs: antwortet wie `claude -p --output-format json --json-schema` im
// Lehrmodus. Start → Plan + Schritt 1 + Prüffrage (Auswahl), dann Vorhersage, freie Prüffrage, Auswahl, Abschluss.
import fs from 'fs';
const args = process.argv.slice(2);
const sid = args[args.indexOf('--session-id') + 1] || args[args.indexOf('--resume') + 1] || 'x';
let ein = ''; process.stdin.on('data', (b) => { ein += b; });
process.stdin.on('end', () => {
  if (process.env.LERNEN_ATTRAPPE_LOG) fs.appendFileSync(process.env.LERNEN_ATTRAPPE_LOG, JSON.stringify({ args: args.filter((a) => a.length < 200), ein }) + '\n');
  const abschluss = { art: 'abschluss', text: 'Das steht jetzt: die Kette von HEAD bis zum Blob.', bewertung: 'keine',
    gelernt: ['Punkt eins', 'Punkt zwei', 'Punkt drei'], offen: ['Lücke bei **Tags**'], nachlesen: ['Reflog, F. 60'], kernaussage: 'Kette sitzt, Tags wackeln',
    schritte: [{ titel: 'Schritt A', thema: 'test-thema-a', kern: 'Kern A: gilt, weil `x`.' }, { titel: 'Schritt B', thema: 'test-thema-b', kern: 'Kern B.' }] };
  let x;
  if (/\[Uni-Lektion\]/.test(ein)) x = { art: 'frage', plan: ['Schritt A', 'Schritt B', 'Schritt C'], schritt: 1, text: 'Schritt-1-Unterricht: **HEAD** zeigt auf einen Branch.\n\n```kette\ngit switch dev\nHEAD ↑ | gut: zeigt auf refs/heads/dev\nCommit ↑ | schlecht: Branch rückt vor\n```\n\nDanach geht es weiter.',
    rolle: 'pruefung', frage: 'Worauf zeigt `HEAD` nach `git switch dev`?', optionen: ['auf den Commit', 'auf refs/heads/dev', 'auf den Tree'], richtig: 1, erklaerung: 'GEHEIM-ERKL-1: HEAD ist eine symbolische Referenz.' };
  else if (/^Rückfrage, während Frage/.test(ein)) x = { art: 'text', text: 'Kurze Antwort auf die Rückfrage.', bewertung: 'keine' };
  else if (/^Antwort auf Frage 1 /.test(ein)) x = { art: 'frage', schritt: 2, text: 'Auflösung 1. Jetzt eine Vorhersage.', rolle: 'vorhersage',
    frage: 'Was passiert wohl beim Commit?', optionen: ['Der Branch rückt vor', 'HEAD rückt vor'], richtig: 0, erklaerung: 'GEHEIM-ERKL-2' };
  else if (/^Antwort auf Frage 2 /.test(ein)) x = { art: 'frage', schritt: 2, text: 'Deine Vorhersage stimmt. Schritt-2-Unterricht.', rolle: 'pruefung',
    frage: 'Wie viele Objekte entstehen?', optionen: [], loesung: 'GEHEIM-LSG: 42', erklaerung: 'GEHEIM-ERKL-3' };
  else if (/^Antwort auf Frage 3 /.test(ein)) x = { art: 'frage', bewertung: 'richtig', schritt: 3, text: 'Stimmt. Schritt-3-Unterricht.', rolle: 'pruefung',
    frage: 'Letzte Frage: Was ist ein Tag-Objekt?', optionen: ['ein Blob', 'ein Tree', 'ein eigenes Objekt'], richtig: 2, erklaerung: 'GEHEIM-ERKL-4' };
  else if (/^Antwort auf Frage 4 |\[ABSCHLIESSEN\]/.test(ein)) x = abschluss;
  else x = { art: 'text', text: 'Antwort ohne Frage.' };
  setTimeout(() => process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '', session_id: sid, structured_output: x })), 300);
});
