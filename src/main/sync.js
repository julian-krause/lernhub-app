// ILIAS-Sync aus der App (Knopf „Sync starten“): `claude -p` mit der Skill ilias-sync.
//
//   - Kein Terminal und kein Browserfenster: Die Skill meldet sich über login.py an (agent-browser ohne Fenster).
//     Was sonst eine Rückfrage wäre (neue Kurse, Beitritte, Duplikate löschen), lässt der Lauf aus und nennt es
//     in der Zusammenfassung. Die Regeln dafür stehen im Auftrag unten.
//   - Freigaben vorab und eng (--permission-mode dontAsk: alles andere wird abgelehnt, nichts wird gefragt):
//     lesen überall, Bash nur für die Skripte von ilias-sync, `roadmap.py sync-*` und ein paar Lesebefehle,
//     schreiben nur `Links.md` im Semesterordner. Gesperrt sind der Login mit Fenster, agent-browser direkt,
//     das Ändern der Kursauswahl und tutor.py: Den Abgleich von Roadmaps, Lernhub und Kalender macht danach die
//     Kurs-Tutor-App über kurstutor://sync.
//   - Fortschritt aus --output-format stream-json: Jeder Skript-Aufruf wird zu einer Zeile auf der Seite.
//   - Ein Lauf zur Zeit. Der letzte fertige Lauf liegt in userData/sync/letzter.json, die Protokolle 30 Tage daneben.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const P = require('./pfade');

const FRIST = 30 * 60000;
const MODELL = process.env.LERNHUB_SYNC_MODELL || 'opus';
const EFFORT = process.env.LERNHUB_SYNC_EFFORT || 'medium';

// Pfadregeln: Nicht-ASCII-Zeichen (Umlaute im Ordnernamen) als *, damit NFC/NFD-Schreibweisen beide passen.
const regelPfad = (p) => '/' + P.nfc(p).replace(/[^\x20-\x7e]/g, '*');
const mitTilde = (p) => [p, p.replace(P.HOME, '~')];

function freigaben(sem) {
  const il = mitTilde(path.join(P.ILIAS, 'scripts')), kt = mitTilde(P.SCRIPTS);
  const py = ['', 'python3 ', '/usr/bin/python3 '];
  // Skripte mit Platzhalter (ein Präfix wie `…/scripts/:*` passt nur auf ganze Wörter)
  const skripte = [
    ...il.flatMap((d) => py.map((p) => `${p}${d}/*`)),
    ...kt.flatMap((d) => py.map((p) => `${p}${d}/roadmap.py sync-*`)),
  ];
  const lesen = ['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'sort', 'date', 'cd', 'echo', 'test', 'stat'];
  const erlaubt = ['Read', 'Glob', 'Grep', 'Skill', 'TodoWrite', `Edit(${regelPfad(sem)}/**/Links.md)`,
    ...skripte.map((b) => `Bash(${b})`), ...lesen.map((b) => `Bash(${b}:*)`)];
  const nie = il.flatMap((d) => py.flatMap((p) => [
    `${p}${d}/login.py --manual*`, `${p}${d}/login.py --keep*`,          // nie ein Fenster, nie ein offener Browser
    `${p}${d}/ilias.py select*`, `${p}${d}/ilias.py setup*`,             // Kursauswahl und Einrichtung nur im Gespräch
  ]));
  const tutor = kt.flatMap((d) => py.map((p) => `${p}${d}/tutor.py*`));
  const verboten = [...nie, ...tutor].map((b) => `Bash(${b})`).concat(
    ['Bash(agent-browser:*)', 'Bash(npm:*)', 'Bash(open:*)', 'Bash(osascript:*)', 'Bash(rm:*)', 'WebFetch', 'WebSearch', 'Agent', 'Task']);
  return { erlaubt, verboten };
}

function auftrag({ sem, kategorie }) {
  const il = path.join(P.ILIAS, 'scripts');
  return `/ilias-sync Routine-Lauf fürs ${path.basename(sem)}${kategorie ? ` (ILIAS-Kategorie „${kategorie}“)` : ''}, alle Kurse aus dem Manifest.

Auftrag aus der Mac-App Lernhub (Knopf „Sync starten“). Er läuft ohne Terminal über claude -p: Niemand kann antworten, und es darf sich kein Fenster öffnen. Deshalb gilt zusätzlich zur Skill:
- Keine Rückfragen. Wo die Skill fragen würde, lässt du den Punkt aus und nennst ihn in der Zusammenfassung unter „Offen“.
- Anmelden nur ohne Fenster: login.py ohne --manual und ohne --keep. Bei NO CREDENTIALS, LOGIN FAILED, LOGIN STUCK, MISSING oder NETWORK brichst du sofort ab und antwortest mit „Sync abgebrochen: <Grund>“ und einem Satz, was der User tun muss (bei fehlenden oder abgelehnten Zugangsdaten: Kennung und Passwort in ~/.claude/skills/ilias-sync/.env prüfen). Die Datei .env liest und zeigst du nie.
- Meldet der Befehl config SETUP NEEDED oder NO COURSES: abbrechen mit „Sync abgebrochen: Ersteinrichtung fehlt“ (die läuft nur im Gespräch in Claude Code).
- Neue Kurse (NEW n) nimmst du nicht auf, und du trittst keinem Kurs bei. Beides nennst du unter „Offen“.
- Duplikate löschst du nie. Du nennst nur, wie viele Gruppen es gibt.
- Ordner benennst du nur nach Schritt 6 der Skill um (ilias.py mv). Sonst verschiebst und löschst du nichts.
- Meldet der Download fail: 0, führst du danach aus: python3 ${P.SCRIPTS}/roadmap.py sync-done "${sem}". Bei Fehlern kein sync-done.
- tutor.py rufst du nicht auf. Roadmaps, Lernkalender und Lernhub gleicht die App danach selbst ab. Neues Material arbeitest du nicht in die Roadmaps ein.
- Skripte immer mit vollem Pfad und ohne Shell-Variablen, z. B.: ${il}/ilias.py config
- Keine Notizen im Obsidian-Vault.

Antwort am Ende, kurz, für die Anzeige in der App (schlichtes Markdown, keine Tabellen, keine Überschriften):
Erste Zeile „Sync fertig: n neue Dateien“ (n als Zahl) oder „Sync abgebrochen: <Grund>“.
Danach je Kurs mit neuen Dateien eine Zeile „- <Kurs>: n neu, <was>“.
Zum Schluss, nur falls nötig, „Offen:“ mit den Punkten, die der User selbst klären muss (neue Kurse, Beitritte, Abgabefristen, Duplikate, fehlgeschlagene Dateien).

SEMDIR=${sem}`;
}

// Kurzer Text zum aktuellen Schritt, aus einem tool_use
function schrittText(t) {
  const n = t.name, x = t.input || {};
  if (n === 'Skill') return 'liest die Skill ilias-sync';
  if (n === 'Write' || n === 'Edit' || n === 'MultiEdit') return 'schreibt ' + path.basename(String(x.file_path || ''));
  if (n !== 'Bash') return null;
  const c = String(x.command || '');
  if (/login\.py/.test(c)) return /--check/.test(c) ? 'prüft die Zugangsdaten' : 'meldet sich bei ILIAS an';
  if (/ilias\.py["']?\s+config/.test(c)) return 'liest die Einstellungen';
  if (/ilias\.py["']?\s+inventory/.test(c)) return 'prüft, was im Semesterordner schon liegt';
  if (/ilias\.py["']?\s+courses/.test(c)) return 'gleicht die Kurse ab';
  if (/ilias\.py["']?\s+plan/.test(c)) return 'sucht in ILIAS nach neuen Dateien';
  if (/ilias\.py["']?\s+download/.test(c)) return 'lädt neue Dateien herunter';
  if (/ilias\.py["']?\s+mv/.test(c)) return 'räumt Ordnernamen auf';
  if (/ilias\.py["']?\s+dupes/.test(c)) return 'sucht doppelte Dateien';
  if (/roadmap\.py["']?\s+sync-done/.test(c)) return 'vermerkt den Sync';
  return null;
}

const LEER = { zustand: 'aus', start: null, ende: null, schritt: '', schritte: [], text: '', neu: null };

class Sync {
  constructor({ ordner, beiStand, beiFertig }) {
    this.ordner = ordner;                    // userData/sync
    this.beiStand = beiStand;                // (stand) → Oberfläche
    this.beiFertig = beiFertig || (() => {});
    this.kind = null;
    this.s = { ...LEER };
    try { this.s = { ...LEER, ...JSON.parse(fs.readFileSync(this.datei(), 'utf8')) }; } catch { }
    this.aufraeumen();
  }

  datei() { return path.join(this.ordner, 'letzter.json'); }
  stand() { return { ...this.s, schritte: this.s.schritte.slice(-12) }; }
  melden() { this.beiStand(this.stand()); }

  starten({ sem, kategorie }) {
    if (!P.CLAUDE) return { ok: false, text: 'claude nicht gefunden (~/.local/bin/claude).' };
    if (process.env.LERNHUB_TEST && !process.env.LERNHUB_CLAUDE) return { ok: false, text: 'Im Test nur mit claude-Attrappe (LERNHUB_CLAUDE).' };
    if (!sem || !P.unterRoot(sem)) return { ok: false, text: 'Semesterordner liegt nicht im Studienordner.' };
    if (!fs.existsSync(path.join(P.ILIAS, 'SKILL.md'))) return { ok: false, text: 'Die Skill ilias-sync ist nicht installiert (~/.claude/skills/ilias-sync).' };
    if (this.kind) return { ok: false, text: 'Der Sync läuft schon.' };
    this.s = { ...LEER, zustand: 'laeuft', start: Date.now(), schritt: 'startet Claude', schritte: [] };
    const { erlaubt, verboten } = freigaben(sem);
    const args = ['-p', '--model', MODELL, '--effort', EFFORT, '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'dontAsk', '--strict-mcp-config', '--add-dir', P.ILIAS,
      '--allowedTools', ...erlaubt, '--disallowedTools', ...verboten];
    const env = { ...process.env, PATH: [path.dirname(P.CLAUDE), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':') };
    delete env.ANTHROPIC_API_KEY;              // immer über das Abo
    delete env.ELECTRON_RUN_AS_NODE;
    env.LERNHUB_HINTERGRUND = '1';             // SessionStart-Hook (Obsidian) überspringt den Vault
    fs.mkdirSync(this.ordner, { recursive: true });
    const log = fs.createWriteStream(path.join(this.ordner, `${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.jsonl`), { flags: 'a' });

    const kind = spawn(P.CLAUDE, args, { cwd: sem, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.kind = kind;
    kind.stdin.end(auftrag({ sem, kategorie }));
    let zeitUm = false, rest = '', fehlerText = '', ergebnis = null;
    const timer = setTimeout(() => { zeitUm = true; kind.kill('SIGTERM'); }, FRIST);
    const s = this.s;

    kind.stdout.on('data', (b) => {
      log.write(b);
      rest += b.toString();
      const zeilen = rest.split('\n'); rest = zeilen.pop();
      for (const z of zeilen) {
        let e; try { e = JSON.parse(z); } catch { continue; }
        if (e.type === 'result') { ergebnis = e; continue; }
        if (e.type !== 'assistant' || !e.message || !Array.isArray(e.message.content)) continue;
        for (const t of e.message.content) {
          const text = t.type === 'tool_use' ? schrittText(t) : null;
          if (!text || text === s.schritt) continue;
          s.schritt = text; s.schritte.push({ t: Date.now(), text });
          this.melden();
        }
      }
    });
    kind.stderr.on('data', (b) => { fehlerText = (fehlerText + b.toString()).slice(-2000); });
    kind.on('error', (e) => { fehlerText = e.message; });
    kind.on('close', (code) => {
      clearTimeout(timer);
      log.end();
      this.kind = null;
      s.ende = Date.now();
      const text = ergebnis && typeof ergebnis.result === 'string' ? ergebnis.result.trim() : '';
      s.text = text.slice(0, 4000);
      if (s.abbruch) { s.zustand = 'abgebrochen'; s.text = 'Abgebrochen. Schon geladene Dateien bleiben; der nächste Lauf macht dort weiter.'; }
      else if (zeitUm) { s.zustand = 'fehler'; s.text = `Nach ${FRIST / 60000} Minuten abgebrochen.`; }
      else if (!ergebnis || ergebnis.is_error) {
        s.zustand = 'fehler';
        s.text = text || fehlerText.trim().split('\n').slice(-3).join(' ').slice(0, 400) || `claude endete mit Code ${code}.`;
      } else if (/^\W*Sync fertig/i.test(text)) {
        s.zustand = 'fertig';
        const m = text.match(/Sync fertig:\s*(\d+)/i);
        s.neu = m ? +m[1] : null;
      } else s.zustand = 'fehler';             // „Sync abgebrochen: …“ oder eine Antwort ohne Ergebniszeile
      delete s.abbruch;
      s.schritt = '';
      try { fs.writeFileSync(this.datei(), JSON.stringify(s, null, 1)); } catch (e) { console.error(e); }
      this.melden();
      try { this.beiFertig(this.stand()); } catch (e) { console.error(e); }
    });
    this.melden();
    return { ok: true };
  }

  abbrechen() {
    if (!this.kind) return false;
    this.s.abbruch = true;
    this.kind.kill('SIGTERM');
    return true;
  }

  // Ergebnis des letzten Laufs ausblenden
  leeren() {
    if (this.kind) return false;
    this.s = { ...LEER };
    try { fs.unlinkSync(this.datei()); } catch { }
    this.melden();
    return true;
  }

  aufraeumen() {
    try {
      const grenze = Date.now() - 30 * 86400000;
      for (const f of fs.readdirSync(this.ordner)) {
        const p = path.join(this.ordner, f);
        if (f.endsWith('.jsonl') && fs.statSync(p).mtimeMs < grenze) fs.unlinkSync(p);
      }
    } catch { }
  }
}

module.exports = { Sync, freigaben, auftrag, schrittText };
