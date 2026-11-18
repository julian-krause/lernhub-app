#!/usr/bin/env node
// claude-Attrappe für tests/sync.test.mjs: antwortet wie `claude -p --output-format stream-json` beim ILIAS-Sync.
// Die Datei in SYNC_ATTRAPPE_MODUS bestimmt den Lauf: „ok“ (Standard), „login“ (Zugangsdaten fehlen), „lang“ (läuft,
// bis er abgebrochen wird).
import fs from 'fs';
const args = process.argv.slice(2);
let modus = 'ok';
try { modus = fs.readFileSync(process.env.SYNC_ATTRAPPE_MODUS, 'utf8').trim() || 'ok'; } catch { }
let ein = ''; process.stdin.on('data', (b) => { ein += b; });
const raus = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const bash = (command) => raus({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
process.stdin.on('end', async () => {
  if (process.env.SYNC_ATTRAPPE_LOG) fs.appendFileSync(process.env.SYNC_ATTRAPPE_LOG, JSON.stringify({ args, ein, cwd: process.cwd() }) + '\n');
  const I = '/x/.claude/skills/ilias-sync/scripts';
  raus({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'ilias-sync' } }] } });
  await warte(250); bash(`${I}/ilias.py config`);
  await warte(250); bash(`${I}/login.py`);
  if (modus === 'login') {
    await warte(250);
    return raus({ type: 'result', is_error: false, result: 'Sync abgebrochen: NO CREDENTIALS. Trag Kennung und Passwort in ~/.claude/skills/ilias-sync/.env ein.' });
  }
  await warte(250); bash(`${I}/ilias.py courses --current`);
  await warte(250); bash(`${I}/ilias.py plan "/sem"`);
  await warte(250); bash(`${I}/ilias.py download "/sem"`);
  if (modus === 'lang') { await warte(60000); return; }
  await warte(250); bash(`python3 /x/.claude/skills/kurs-tutor/scripts/roadmap.py sync-done "/sem"`);
  await warte(250);
  raus({ type: 'result', is_error: false, result: 'Sync fertig: 3 neue Dateien\n- Kurs A: 2 neu, Folien **Kapitel 5** und Übung 7\n- Kurs B: 1 neu, Übungsblatt 6\n\nOffen:\n- Neuer Kurs „Tutorium“ (Ref 1700001) ist nicht aufgenommen.' });
});
