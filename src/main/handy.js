// Lernhub fürs iPhone: kleiner HTTP-Server im Hauptprozess (docs/handy.md).
//   - Lauscht nur auf 127.0.0.1. Ins Tailnet kommt er über `tailscale serve` (HTTPS mit echtem Zertifikat unter
//     <mac>.<tailnet>.ts.net). Andere Rechner im WLAN erreichen ihn nicht.
//   - Jede API-Anfrage braucht den Schlüssel (userData/handy.json): Header X-Lernhub-Token, ?t= oder das Cookie,
//     das der Server nach der ersten gültigen Anfrage setzt (damit Merkblätter samt Bildern laden).
//   - POST /api/<name> ruft die Funktionen aus main.js auf (dieselben wie die IPC-Kanäle der Mac-Oberfläche).
//     GET /api/ereignisse ist ein Server-Sent-Events-Strom mit lernen, ueben, daten:geaendert und meldung.
//   - Statisch: die App selbst (src/mobil), dazu md.js, bilder.js, util.js und regeln.js aus der Mac-Oberfläche
//     und die Baustein-Styles aus app.css (so zeichnet das iPhone Bausteine genau wie der Mac).
//   - Claude läuft weiter auf dem Mac (claude -p über das Abo): Das iPhone ist nur eine zweite Oberfläche für
//     dieselben Sitzungen. XP bucht die Mac-Oberfläche, sobald die Sitzung sich meldet.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { fileURLToPath } = require('url');

const SRC = path.join(__dirname, '..');
const MOBIL = path.join(SRC, 'mobil');
const UI = path.join(SRC, 'ui');
const GETEILT = new Set(['md.js', 'bilder.js', 'util.js', 'regeln.js']);   // aus src/ui/js, ohne DOM-Abhängigkeiten zum Mac
const HTTPS_PORT = 8443;                       // Port im Tailnet (tailscale serve --https=8443)
const TYPEN = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};
const TAILSCALE = ['/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']
  .find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;

function ts(args, timeout = 15000) {
  return new Promise((ok, nein) => {
    if (!TAILSCALE) return nein(new Error('Tailscale ist auf diesem Mac nicht installiert.'));
    execFile(TAILSCALE, args, { timeout }, (err, out, errOut) => (err ? nein(Object.assign(err, { stderr: errOut })) : ok(String(out))));
  });
}

// Baustein-Styles und Farben aus app.css: der :root-Block (hell und dunkel) und jede einzeilige Regel für .bs…
function bausteinCss() {
  const css = fs.readFileSync(path.join(UI, 'app.css'), 'utf8');
  const ende = css.indexOf('*, *::before');
  const kopf = ende > 0 ? css.slice(0, ende) : '';
  const bs = css.split('\n').filter((z) => /^\s*\.bs[\w-]*[\s.,:{>[]/.test(z) || /^\s*\.ueb-tab\b/.test(z) || /^\s*\.ueb-code\b/.test(z));
  return kopf + '\n' + bs.join('\n') + '\n';
}

// hub.py-Daten fürs iPhone: nur, was die Startseite und die Spielkarte brauchen (statt ~350 KB)
function schlank(d) {
  if (!d) return null;
  const pfad = (u) => { try { return u && /^file:/.test(u) ? fileURLToPath(u) : null; } catch { return null; } };
  const sem = d.semester || {};
  return {
    generated: d.generated, today: d.today, alt: !!d._alt, name: d.name,
    semester: { name: sem.name, title: sem.title, monday: sem.monday, breaks: sem.breaks || [], exams: sem.exams || [] },
    agenda: d.agenda ? { date: d.agenda.date, learnMin: d.agenda.learnMin, first: d.agenda.first, last: d.agenda.last,
      events: (d.agenda.events || []).map((e) => ({ kind: e.kind, start: e.start, end: e.end, title: e.title, lernMin: e.lernMin, startTs: e.startTs, endTs: e.endTs })) } : null,
    realismus: d.realismus ? { ok: d.realismus.ok, hinweise: (d.realismus.hinweise || []).map((h) => ({ art: h.art, titel: h.titel, text: h.text })) } : null,
    stats: d.stats ? { lessonsDone: d.stats.lessonsDone, lessonsTotal: d.stats.lessonsTotal, minutesTotal: d.stats.minutesTotal, avgScore: d.stats.avgScore } : null,
    courses: (d.courses || []).filter((c) => c.hasRoadmap).map((c) => ({
      key: c.key, slug: c.slug, name: c.name, short: c.short, emoji: c.emoji, color: c.color, hasRoadmap: true,
      exam: c.exam, examAssumed: c.examAssumed, targetPercent: c.targetPercent, avgScore: c.avgScore, quota: c.quota, doneThis: c.doneThis,
      done: c.done, total: c.total, open: c.open, alarm: c.alarm, weeksLeft: c.weeksLeft, practice: c.practice || null, readiness: c.readiness || null,
      lessons: (c.lessons || []).map((l) => ({ id: l.id, title: l.title, chapter: l.chapter, done: l.done, score: l.score, state: l.state,
        placeholder: l.placeholder, training: l.training, estMin: l.estMin, week: l.week, datei: pfad(l.file) })),
    })),
  };
}

class Handy {
  // api: { name: async (body) => wert }, darf(pfad): liegt die Datei im Studienordner?
  constructor({ ordner, port = 4791, api, darf }) {
    this.ordner = ordner; this.port = port; this.api = api; this.darf = darf;
    this.hoerer = new Set();
    this.server = null; this.laeuft = false; this.fehler = null;
    this.ts = { adresse: null, freigegeben: false, fehler: null, um: 0 };
    this.token = this.tokenLesen();
  }

  tokenLesen() {
    const f = path.join(this.ordner, 'handy.json');
    try { const x = JSON.parse(fs.readFileSync(f, 'utf8')); if (x.token && x.token.length >= 32) return x.token; } catch { }
    const token = crypto.randomBytes(24).toString('base64url');
    try { fs.mkdirSync(this.ordner, { recursive: true }); fs.writeFileSync(f, JSON.stringify({ token }), { mode: 0o600 }); } catch (e) { console.error('handy.json:', e.message); }
    return token;
  }
  neuerSchluessel() {
    try { fs.unlinkSync(path.join(this.ordner, 'handy.json')); } catch { }
    this.token = this.tokenLesen();
    for (const h of this.hoerer) { try { h.end(); } catch { } }
    this.hoerer.clear();
    return this.info();
  }

  start() {
    if (this.server) return;
    this.server = http.createServer((req, res) => this.anfrage(req, res).catch((e) => {
      console.error('Handy:', e);
      if (!res.headersSent) this.json(res, 500, { ok: false, text: 'Fehler auf dem Mac: ' + e.message });
    }));
    this.server.on('error', (e) => { this.laeuft = false; this.fehler = e.code === 'EADDRINUSE' ? `Port ${this.port} ist belegt.` : e.message; console.error('Handy-Server:', e.message); });
    this.server.listen(this.port, '127.0.0.1', () => { this.laeuft = true; this.fehler = null; });
    this.puls = setInterval(() => this.senden('puls', Date.now()), 25000);
    this.tailscalePruefen().catch(() => { });
  }
  stopp() {
    clearInterval(this.puls);
    for (const h of this.hoerer) { try { h.end(); } catch { } }
    this.hoerer.clear();
    if (this.server) this.server.close();
    this.server = null; this.laeuft = false;
  }

  // Ereignis an alle offenen iPhone-Verbindungen
  senden(kanal, wert) {
    if (!this.hoerer.size) return;
    const z = `event: ${kanal}\ndata: ${JSON.stringify(wert === undefined ? null : wert)}\n\n`;
    for (const h of this.hoerer) { try { h.write(z); } catch { this.hoerer.delete(h); } }
  }

  // ---------------------------------------------------------------- Tailscale
  async tailscalePruefen() {
    const x = { adresse: null, freigegeben: false, fehler: null, um: Date.now(), ip: null };
    try {
      const st = JSON.parse(await ts(['status', '--json']));
      if (st.BackendState && st.BackendState !== 'Running') throw new Error('Tailscale ist nicht verbunden (' + st.BackendState + ').');
      x.adresse = String((st.Self && st.Self.DNSName) || '').replace(/\.$/, '') || null;
      x.ip = ((st.Self && st.Self.TailscaleIPs) || [])[0] || null;
      x.handys = Object.values(st.Peer || {}).filter((p) => /ios/i.test(p.OS || '')).map((p) => ({ name: p.HostName, online: !!p.Online }));
      const serve = await ts(['serve', 'status', '--json']).catch(() => '{}');
      x.freigegeben = new RegExp(`127\\.0\\.0\\.1:${this.port}|localhost:${this.port}`).test(serve) && serve.includes(':' + HTTPS_PORT);
    } catch (e) { x.fehler = String(e.stderr || e.message || e).trim().split('\n')[0]; }
    this.ts = x;
    return x;
  }
  // tailscale serve: https://<mac>.ts.net:8443 → http://127.0.0.1:<port>, bleibt nach Neustarts bestehen (--bg)
  async freigeben() {
    try {
      await ts(['serve', '--bg', `--https=${HTTPS_PORT}`, `http://127.0.0.1:${this.port}`], 60000);
    } catch (e) {
      const t = String(e.stderr || e.message || '').trim();
      await this.tailscalePruefen();
      if (/HTTPS|cert/i.test(t)) return { ok: false, text: 'In Tailscale sind HTTPS-Zertifikate aus. Einmal einschalten: login.tailscale.com → DNS → „HTTPS Certificates“ aktivieren, dann noch einmal.', ...this.info() };
      return { ok: false, text: 'tailscale serve ging nicht: ' + t.split('\n').slice(-2).join(' '), ...this.info() };
    }
    await this.tailscalePruefen();
    return { ok: this.ts.freigegeben, text: this.ts.freigegeben ? 'Freigegeben im Tailnet.' : 'Freigabe nicht bestätigt.', ...this.info() };
  }
  async freigabeAufheben() {
    try { await ts(['serve', `--https=${HTTPS_PORT}`, 'off']); } catch { }
    await this.tailscalePruefen();
    return this.info();
  }

  info() {
    const basis = this.ts.adresse ? `https://${this.ts.adresse}:${HTTPS_PORT}` : null;
    return {
      laeuft: this.laeuft, fehler: this.fehler, port: this.port, tailscale: !!TAILSCALE, ts: this.ts,
      verbunden: this.hoerer.size, link: basis ? `${basis}/?t=${this.token}` : null, basis,
    };
  }

  // ---------------------------------------------------------------- Anfragen
  json(res, code, x, kopf = {}) {
    const b = Buffer.from(JSON.stringify(x === undefined ? null : x));
    res.writeHead(code, { 'Content-Type': TYPEN['.json'], 'Content-Length': b.length, 'Cache-Control': 'no-store', ...kopf });
    res.end(b);
  }
  datei(res, p, { cache = 'no-cache', typ } = {}) {
    fs.readFile(p, (err, b) => {
      if (err) { res.writeHead(404, { 'Content-Type': TYPEN['.txt'] }); return res.end('Nicht gefunden'); }
      res.writeHead(200, { 'Content-Type': typ || TYPEN[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache, 'Content-Length': b.length });
      res.end(b);
    });
  }
  echt(req, u) {
    const ck = String(req.headers.cookie || '').split(/;\s*/).find((x) => x.startsWith('lh='));
    const t = req.headers['x-lernhub-token'] || u.searchParams.get('t') || (ck ? decodeURIComponent(ck.slice(3)) : '');
    const a = Buffer.from(String(t)), b = Buffer.from(this.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  // Cookie für Merkblätter und Material (Unterressourcen tragen keinen Header); nur über HTTPS mit Secure
  keks(req) {
    const sicher = req.headers['x-forwarded-proto'] === 'https' || /\.ts\.net/.test(String(req.headers.host || ''));
    return { 'Set-Cookie': `lh=${encodeURIComponent(this.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${sicher ? '; Secure' : ''}` };
  }

  async anfrage(req, res) {
    const u = new URL(req.url, 'http://lernhub');
    const p = decodeURIComponent(u.pathname);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    // ---- API
    if (p.startsWith('/api/')) {
      if (!this.echt(req, u)) return this.json(res, 401, { ok: false, text: 'Schlüssel fehlt oder ist falsch. Link in Lernhub am Mac (Einstellungen → iPhone) neu öffnen.', schluessel: false });
      const name = p.slice(5);
      if (name === 'ereignisse' && req.method === 'GET') return this.ereignisse(req, res);
      if (req.method !== 'POST') return this.json(res, 405, { ok: false });
      const fn = Object.hasOwn(this.api, name) ? this.api[name] : null;
      if (!fn) return this.json(res, 404, { ok: false, text: 'Unbekannt: ' + name });
      const body = await lesen(req);
      return this.json(res, 200, await fn(body || {}), name === 'daten' ? this.keks(req) : {});
    }

    // ---- Merkblätter und Material: /datei/<absoluter Pfad>, nur im Studienordner (relative Bilder laden mit)
    if (p.startsWith('/datei/')) {
      if (!this.echt(req, u)) { res.writeHead(401, { 'Content-Type': TYPEN['.txt'] }); return res.end('Nicht freigegeben'); }
      const f = path.normalize(p.slice(6));
      if (!this.darf(f) || !TYPEN[path.extname(f).toLowerCase()]) { res.writeHead(403); return res.end(); }
      return this.datei(res, f, { cache: 'private, max-age=300' });
    }

    // ---- App
    if (p === '/' || p === '/index.html') return this.datei(res, path.join(MOBIL, 'index.html'));
    if (p === '/sw.js') return this.datei(res, path.join(MOBIL, 'sw.js'));
    if (p === '/manifest.webmanifest') return this.manifest(res, u);
    if (p === '/bs.css') { const b = Buffer.from(bausteinCss()); res.writeHead(200, { 'Content-Type': TYPEN['.css'], 'Cache-Control': 'no-cache' }); return res.end(b); }
    if (p === '/icon-180.png' || p === '/icon-512.png') return this.datei(res, path.join(MOBIL, p.slice(1)), { cache: 'max-age=86400' });
    const sicherIn = (basis, rel) => { const f = path.normalize(path.join(basis, rel)); return f.startsWith(basis + path.sep) ? f : null; };
    if (p.startsWith('/m/')) { const f = sicherIn(MOBIL, p.slice(3)); return f ? this.datei(res, f) : this.json(res, 404, null); }
    if (p.startsWith('/js/') && GETEILT.has(p.slice(4))) return this.datei(res, path.join(UI, 'js', p.slice(4)));
    if (p.startsWith('/klaenge/') && /^[a-z]+\.wav$/.test(p.slice(9))) return this.datei(res, path.join(UI, 'klaenge', p.slice(9)), { cache: 'max-age=86400' });
    res.writeHead(404, { 'Content-Type': TYPEN['.txt'] });
    res.end('Nicht gefunden');
  }

  // Der Schlüssel steht in start_url: Eine Web-App auf dem Home-Bildschirm hat eigenen Speicher und kennt sonst nichts
  manifest(res, u) {
    const t = this.echt({ headers: {} }, u) ? u.searchParams.get('t') : '';
    this.json(res, 200, {
      name: 'Lernhub', short_name: 'Lernhub', lang: 'de', display: 'standalone', orientation: 'portrait',
      start_url: t ? `/?t=${encodeURIComponent(t)}` : '/', scope: '/', background_color: '#fffff8', theme_color: '#fffff8',
      icons: [{ src: '/icon-180.png', sizes: '180x180', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }

  ereignisse(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 3000\nevent: hallo\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
    this.hoerer.add(res);
    req.on('close', () => this.hoerer.delete(res));
  }
}

function lesen(req) {
  return new Promise((ok, nein) => {
    let n = 0; const teile = [];
    req.on('data', (b) => { n += b.length; if (n > 256 * 1024) { nein(new Error('Anfrage zu groß')); req.destroy(); } else teile.push(b); });
    req.on('end', () => { try { ok(teile.length ? JSON.parse(Buffer.concat(teile).toString('utf8')) : {}); } catch { ok({}); } });
    req.on('error', nein);
  });
}

module.exports = { Handy, schlank, bausteinCss, HTTPS_PORT };
