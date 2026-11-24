// Suche im Kursstoff für die Sprechstunde (BM25, lokal, ohne Netz): Lektionstexte und Referenzseiten werden in
// Abschnitte von ~800 Zeichen geteilt; eine Anfrage (z. B. der letzte Satz des Tutors) liefert die passendsten.
// Deutsch: Umlaute vereinheitlicht, häufige Endungen abgeschnitten, Füllwörter raus. Schnell genug für jeden Satz.
const STOPP = new Set(('der die das den dem des ein eine einen einem einer eines und oder aber auch nur noch schon so wie was wer wo '
  + 'ist sind war waren wird werden wurde hat haben hatte kann koennen muss muessen soll sollen will wollen mit ohne von vom zu zum zur '
  + 'im in an am auf aus bei fuer ueber unter nach vor bis um als dass da dann denn doch ja nein nicht kein keine man sich es er sie '
  + 'wir ihr du ich mir mich dir dich uns euch sein seine ihre ihr diese dieser dieses jetzt hier mal also okay gut genau ganz sehr '
  + 'mehr viel etwas alles immer wieder einfach eigentlich naja aeh aehm hm mhm the a an of to and or is are '
  + 'lass lasst reden red sag sagen erklaer erklaere frage fragen steht drin passiert sieht macht machen gibt geht weiss '
  + 'glaube denke meinst richtig falsch thema themen naechste naechstes andere anderes bitte nochmal').split(' '));

function norm(s) {
  return String(s || '').normalize('NFC').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}
// Grob, aber robust für Deutsch und gesprochene Anfragen: Endung weg, dann auf 6 Zeichen kürzen
function stamm(w) {
  if (w.length > 4) w = w.replace(/(ungen|ung|en|er|es|em|e|n|s)$/, '');
  return w.length > 6 ? w.slice(0, 6) : w;
}
function woerter(s) {
  return norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOPP.has(w)).map(stamm);
}

// Text in Abschnitte: an Absätzen, ~800 Zeichen, mit Überschrift der Quelle
function teilen(quelle, text, { max = 800, themen = [] } = {}) {
  const abs = String(text || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  let teil = '';
  for (const a of abs) {
    if (teil && teil.length + a.length > max) { out.push(teil); teil = ''; }
    teil += (teil ? '\n' : '') + (a.length > max * 1.6 ? a.slice(0, max * 1.6) : a);
  }
  if (teil) out.push(teil);
  return out.map((t) => ({ quelle, text: t, themen }));
}

class Index {
  constructor(abschnitte) {
    this.docs = abschnitte.map((a, id) => {
      const kopf = woerter(a.quelle + ' ' + (a.themen || []).join(' '));
      const w = [...woerter(a.text), ...kopf, ...kopf, ...kopf];          // Titel und Themen zählen dreifach
      const tf = new Map();
      for (const x of w) tf.set(x, (tf.get(x) || 0) + 1);
      return { ...a, id, tf, len: w.length };
    });
    this.df = new Map();
    for (const d of this.docs) for (const x of d.tf.keys()) this.df.set(x, (this.df.get(x) || 0) + 1);
    this.avg = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }
  // → [{ id, quelle, text, score }] absteigend
  suchen(anfrage, n = 3, { thema } = {}) {
    const q = [...new Set(woerter(anfrage))];
    if (!q.length) return [];
    const N = this.docs.length, k1 = 1.2, b = 0.75;
    const out = [];
    for (const d of this.docs) {
      let s = 0;
      for (const w of q) {
        const f = d.tf.get(w);
        if (!f) continue;
        const df = this.df.get(w) || 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / this.avg));
      }
      if (thema && d.themen.includes(thema)) s *= 1.5;
      if (s > 0) out.push({ id: d.id, quelle: d.quelle, text: d.text, score: s });
    }
    return out.sort((x, y) => y.score - x.score).slice(0, n);
  }
}

module.exports = { Index, teilen, woerter, norm };
