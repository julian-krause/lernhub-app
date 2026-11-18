#!/usr/bin/env node
// claude-Attrappe für tests/ueben.test.mjs: antwortet wie `claude -p --output-format json --json-schema` im
// Übungsmodus, je nach Nachricht: Start → Aufgabe, „Hinweis“ → Hinweis, „Antwort“ → Abschluss, Nächste → Aufgabe.
import fs from 'fs';
const args = process.argv.slice(2);
const sid = args[args.indexOf('--session-id') + 1] || args[args.indexOf('--resume') + 1] || 'x';
let ein = ''; process.stdin.on('data', (b) => { ein += b; });
process.stdin.on('end', () => {
  if (process.env.UEBEN_ATTRAPPE_LOG) fs.appendFileSync(process.env.UEBEN_ATTRAPPE_LOG, JSON.stringify({ args: args.filter((a) => a.length < 200), ein }) + '\n');
  let x;
  if (/\[Uni-Übung\]|\[NÄCHSTE AUFGABE\]/.test(ein)) {
    const n = /NÄCHSTE/.test(ein) ? 2 : 1;
    x = { art: 'aufgabe', text: n === 1 ? 'Wir starten mit Mustern.' : '', aufgabe: `Aufgabe ${n}: Welche Datei ignoriert \`/build\`?\n\n- \`build/a.js\`\n- \`src/build/b.js\``,
      modus: 'abruf', thema: 'L5', musterloesung: `GEHEIM-${n}: nur build/a.js, weil der Schrägstrich vorne an die Wurzel bindet.` };
  } else if (/Deine Gedanken:[\s\S]*Hinweis/.test(ein)) x = { art: 'text', text: 'Schau, **wo** der Schrägstrich steht.', stufe: 'R1' };
  else if (/Deine Gedanken:[\s\S]*Antwort/.test(ein)) x = { art: 'abschluss', text: 'Sauber gelöst.', ergebnis: 'geloest', urteil: 'Wurzelbindung erkannt.', stufe: 'R1', fehlerart: 'keine', wiederholen: false };
  else x = { art: 'text', text: 'Gute Frage: Der Schrägstrich vorne bindet an die Wurzel.' };
  setTimeout(() => process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '', session_id: sid, structured_output: x })), 300);
});
