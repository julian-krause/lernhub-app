// Pfade und Umgebung. Alles Überschreibbare kommt aus Umgebungsvariablen (Tests, andere Semester).
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const env = process.env;

const SKILL = env.LERNHUB_KURSTUTOR_DIR || path.join(HOME, '.claude/skills/kurs-tutor');
const SCRIPTS = path.join(SKILL, 'scripts');
const ILIAS = env.LERNHUB_ILIAS_DIR || path.join(HOME, '.claude/skills/ilias-sync');   // Skill für den ILIAS-Sync
const PYTHON = '/usr/bin/python3';                       // so ruft auch die Kurs-Tutor-App die Skripte auf

// Studienordner (darunter liegen die Semester): KURSTUTOR_ROOT, sonst der Ordner, den die Skill kurs-tutor kennt.
// Nur dort liest, öffnet und schreibt die App.
function studienordner() {
  if (env.KURSTUTOR_ROOT) return env.KURSTUTOR_ROOT;
  try {
    return execFileSync(PYTHON, ['-c', 'import sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]); import tutor; print(tutor.ROOT)', SCRIPTS],
      { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}
const ROOT = studienordner();
const LOG = path.join(HOME, 'Library/Logs/kurs-tutor.log');
const KT_APP = path.join(HOME, 'Applications/Kurs-Tutor.app');

function ersterVorhanden(liste) {
  return liste.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;
}
const CLAUDE = ersterVorhanden([env.LERNHUB_CLAUDE, path.join(HOME, '.local/bin/claude'),
  '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].filter(Boolean));

// Abschließen, Rückgängig und Abgleich laufen über die Kurs-Tutor-App (kurstutor://-Adressen).
// Nur in Tests oder ohne die App ruft Lernhub tutor.py selbst auf.
const DIREKT = env.LERNHUB_DIREKT === '1' || !fs.existsSync(KT_APP);

function pyEnv() {
  const e = { ...env, LANG: 'de_DE.UTF-8', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
  delete e.ELECTRON_RUN_AS_NODE;
  if (env.LERNHUB_PY_HOME) e.HOME = env.LERNHUB_PY_HOME;   // Tests: Log der Skripte nicht ins echte ~/Library/Logs
  return e;
}

const nfc = (s) => String(s).normalize('NFC');
// Auch über Pfad-Aliase (/var ↔ /private/var, Symlinks) hinweg: aufgelöste Pfade vergleichen
const echt = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
function unterRoot(p) {
  if (!ROOT || !p) return false;
  const r = nfc(path.resolve(ROOT)), x = nfc(path.resolve(p));
  if (x.startsWith(r + '/')) return true;
  return nfc(echt(p)).startsWith(nfc(echt(ROOT)) + '/');
}

module.exports = { HOME, ROOT, SKILL, SCRIPTS, ILIAS, PYTHON, LOG, KT_APP, CLAUDE, DIREKT, pyEnv, nfc, unterRoot };
