// Testumgebung: Kopie des Semesters (ohne große Dateien) und der kurs-tutor-Skill, Kalender-Helfer als Attrappe.
// So schreiben die Tests nie in die echten Roadmaps, den echten Kalender oder das echte Log.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const HOME = os.homedir();
export const ECHT_SKILL = path.join(HOME, '.claude/skills/kurs-tutor');

// Welches Semester und welcher Kurs kopiert werden: tests/lokal.json (nicht im Repo) oder LERNHUB_TEST_ROOT,
// LERNHUB_TEST_SEMESTER, LERNHUB_TEST_KURS. Ohne Angabe: Studienordner der Skill, höchstes Semester mit Roadmaps,
// erster Kurs mit mindestens fünf erledigten und zwei offenen Lektionen.
const LOKAL = (() => { try { return JSON.parse(fs.readFileSync(new URL('./lokal.json', import.meta.url), 'utf8')); } catch { return {}; } })();
const roadmaps = (sem) => {            // Kursschlüssel → roadmap.json, bis zu zwei Ebenen unter dem Semester
  const out = {};
  const lies = (dir, key, tiefe) => {
    for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!n.isDirectory() || n.name.startsWith('.')) continue;
      const k = key ? key + '/' + n.name : n.name, rm = path.join(dir, n.name, 'Lernbereich/roadmap.json');
      if (fs.existsSync(rm)) out[k.normalize('NFC')] = rm; else if (tiefe < 2) lies(path.join(dir, n.name), k, tiefe + 1);
    }
  };
  try { lies(sem, '', 1); } catch { }
  return out;
};
export const ECHT_ROOT = process.env.LERNHUB_TEST_ROOT || LOKAL.root || execFileSync('/usr/bin/python3',
  ['-c', 'import sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]); import tutor; print(tutor.ROOT)', path.join(ECHT_SKILL, 'scripts')], { encoding: 'utf8' }).trim();
const SEMESTER = process.env.LERNHUB_TEST_SEMESTER || LOKAL.semester || fs.readdirSync(ECHT_ROOT)
  .filter((n) => /Semester/.test(n) && Object.keys(roadmaps(path.join(ECHT_ROOT, n))).length)
  .sort((a, b) => parseInt(b, 10) - parseInt(a, 10))[0];
function kursWaehlen(sem) {
  const alle = roadmaps(sem), fest = process.env.LERNHUB_TEST_KURS || LOKAL.kurs;
  if (fest) return fest.normalize('NFC');
  for (const [key, rm] of Object.entries(alle)) {
    try {
      const ls = JSON.parse(fs.readFileSync(rm, 'utf8')).lessons;
      if (ls.filter((l) => l.done).length >= 5 && ls.filter((l) => !l.done && !l.placeholder).length >= 2) return key;
    } catch { }
  }
  return Object.keys(alle)[0];
}
// wie slugify in kurs-tutor/scripts/hub.py
export const slug = (s) => s.normalize('NFC').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const FAKE_EK = `#!/usr/bin/python3
# Attrappe für kalender-ek: rechnet wie der echte Helfer, schreibt aber in keinen Kalender.
import json, sys
from pathlib import Path
req = json.load(sys.stdin)
if req.get("mode") == "busy":            # belegte Zeiten lesen (tutor.py fetch_busy): im Test keine
    print("[]"); sys.exit(0)
st, created, updated = {}, 0, 0
for e in req["events"]:
    old = req["state"].get(e["key"])
    st[e["key"]] = {"id": (old or {}).get("id") or "fake-" + e["key"], "start": e["start"], "end": e["end"]}
    if not old: created += 1
    elif abs(old["start"] - e["start"]) > 30 or abs(old["end"] - e["end"]) > 30: updated += 1
removed = len([k for k in req["state"] if k not in st])
with open(Path(__file__).with_name("kalender-aufrufe.jsonl"), "a") as f:
    f.write(json.dumps({"n": len(req["events"]), "notes": [e["notes"] for e in req["events"]]}, ensure_ascii=False) + "\\n")
print(json.dumps({"state": st, "created": created, "updated": updated, "removed": removed, "unchanged": 0, "moved": [], "deleted": []}))
`;

export function bereiten(semester = SEMESTER) {
  const T = process.env.LERNHUB_TESTDIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lernhub-test-'));
  const root = path.join(T, 'root', path.basename(ECHT_ROOT));
  const sem = path.join(root, semester);
  fs.mkdirSync(sem, { recursive: true });
  // nur Einstellungen des Semesters und die Lernbereiche (Material bleibt weg, iCloud müsste es sonst laden)
  const quelle = path.join(ECHT_ROOT, semester);
  const regeln = ['--exclude', '.venv/', '--exclude', 'node_modules/', '--exclude', '__pycache__/', '--exclude', 'video/',
    '--exclude', 'übungen/', '--exclude', 'learnharness-import/',
    '--include', '/*.json', '--include', '/.*.json', '--include', '/.*.js', '--include', '/Lernhub.html',
    '--include', '/*/', '--include', '/*/*/', '--include', '**/Lernbereich/***', '--exclude', '*'];
  execFileSync('rsync', ['-a', '--delete', '--max-size=2m', '--prune-empty-dirs', ...regeln, quelle + '/', sem + '/']);
  const skill = path.join(T, 'skill');
  execFileSync('rsync', ['-a', '--delete', ECHT_SKILL + '/', skill + '/']);
  const ek = path.join(skill, 'scripts/bin/kalender-ek');
  fs.writeFileSync(ek, FAKE_EK); fs.chmodSync(ek, 0o755);
  try { fs.unlinkSync(path.join(skill, 'scripts/bin/kalender-aufrufe.jsonl')); } catch { }
  const home = path.join(T, 'home');
  fs.mkdirSync(path.join(home, 'Library/Logs'), { recursive: true });
  const daten = path.join(T, 'daten');
  fs.mkdirSync(daten, { recursive: true });
  const kurs = kursWaehlen(sem);
  return {
    T, root, sem, skill, home, daten, kurs, slug: slug(kurs),
    env: { ...process.env, KURSTUTOR_ROOT: root, LERNHUB_KURSTUTOR_DIR: skill, LERNHUB_DIREKT: '1',
      LERNHUB_DATEN: daten, LERNHUB_PY_HOME: home, LERNHUB_TEST: '1' },
    kalenderAufrufe: () => {
      try { return fs.readFileSync(path.join(skill, 'scripts/bin/kalender-aufrufe.jsonl'), 'utf8').trim().split('\n').map((z) => JSON.parse(z)); } catch { return []; }
    },
  };
}

export function check(ok, text) {
  console.log((ok ? '✓ ' : '✗ ') + text);
  if (!ok) process.exitCode = 1;
  return ok;
}

export async function warte(fn, { timeout = 20000, schritt = 250, text = 'Bedingung' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('Zeitüberschreitung: ' + text);
    await new Promise((r) => setTimeout(r, schritt));
  }
}
