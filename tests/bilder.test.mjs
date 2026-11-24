// Bausteine (src/ui/js/bilder.js, src/ui/js/md.js): jeder Typ zeichnet sein Beispiel aus dem Prompt-Katalog,
// kaputte Blöcke fallen auf eine Liste zurück, Code bleibt Code, nichts von Claude wird als HTML oder Code
// ausgeführt. Reine Funktionen, ohne Electron. Aufruf: node tests/bilder.test.mjs
import { createRequire } from 'module';
import { md } from '../src/ui/js/md.js';
import { BAUSTEINE, baustein, ausdruck } from '../src/ui/js/bilder.js';

const require = createRequire(import.meta.url);
const { KATALOG, BEISPIELE } = require('../src/main/bausteine.js');
let fehler = 0;
const check = (ok, text) => { console.log((ok ? '✓ ' : '✗ ') + text); if (!ok) { fehler++; process.exitCode = 1; } };
const block = (typ, inhalt) => md('```' + typ + '\n' + inhalt + '\n```');
const zahl = (html, re) => (html.match(re) || []).length;

// ---- Katalog und Parser gehören zusammen
const typen = Object.keys(BAUSTEINE);
check(typen.length === 13 && typen.every((t) => BEISPIELE[t] && KATALOG.includes('```' + t)), 'Katalog im Prompt nennt alle 13 Bausteine mit Beispiel');
for (const t of typen) {
  const h = baustein(t, BEISPIELE[t]);
  check(typeof h === 'string' && h.includes(`bs-${t === 'vergleich' ? 'vgl' : t === 'zielkonflikt' ? 'zk' : t}`) && !h.includes('ueb-code'), `Beispiel aus dem Katalog zeichnet: ${t}`);
}

// ---- Inhalt der einzelnen Bausteine
let h = block('kette', BEISPIELE.kette);
check(zahl(h, /class="bs-glied/g) === 3 && zahl(h, /bs-pfeil/g) === 2 && h.includes('bs-t bs-gut') && h.includes('bs-t bs-schlecht') && h.includes('<i>↑</i>'), 'kette: drei Glieder, zwei Pfeile, gut/schlecht gefärbt');
h = block('zielkonflikt', BEISPIELE.zielkonflikt);
check(zahl(h, /bs-zk-zeile/g) === 2 && zahl(h, /bs-chip bs-plus/g) === 2 && zahl(h, /bs-chip bs-minus/g) === 2 && h.includes('<b>Kosten</b> · Kapitalbindung, Lagerkosten'), 'zielkonflikt: je Maßnahme Gewinn und Verlust als Chips');
h = block('vergleich', BEISPIELE.vergleich);
check(zahl(h, /role="columnheader"/g) === 3 && zahl(h, /role="rowheader"/g) === 2 && h.includes('repeat(2,'), 'vergleich: zwei Spalten, zwei Merkmale');
h = block('vergleich', 'Merkmal | A | B\n|---|---|---|\nx | 1 | 2');
check(h.includes('bs-vgl') && zahl(h, /role="rowheader"/g) === 1, 'vergleich: Kopf mit Merkmal-Spalte und Markdown-Trennzeile geht auch');
h = block('ablauf', BEISPIELE.ablauf);
check(zahl(h, /<li/g) === 4 && zahl(h, /bs-akt/g) === 1, 'ablauf: vier Schritte, einer hervorgehoben');
h = block('baum', BEISPIELE.baum);
check(zahl(h, /bs-ast"/g) === 3 && zahl(h, /bs-blatt/g) === 3 && zahl(h, /bs-blatt bs-mark/g) === 1, 'baum: drei Äste, drei Blätter, eines markiert');
h = block('falle', BEISPIELE.falle);
check(h.includes('bs-f1') && h.includes('bs-f2') && h.includes('bs-f3') && h.includes('<s>Zeit</s>') && h.includes('<b>Qualität</b>'), 'falle: Falle, Richtig, Regel; ~~ und ** wirken');
h = block('spannung', BEISPIELE.spannung);
check(h.includes('<svg') && zahl(h, /class="bs-nr"/g) === 2 && zahl(h, /<rect/g) === 3, 'spannung: drei Pole, zwei nummerierte Konflikte');
h = block('anteil', BEISPIELE.anteil);
check(zahl(h, /bs-a-zeile/g) === 2 && h.includes('A 75 %') && h.includes('bs-a-notiz') && h.includes('flex:5'), 'anteil: zwei Balken in Prozent, kleine Teile ohne Beschriftung, Notiz');
h = block('kurve', BEISPIELE.kurve);
check(zahl(h, /<path/g) === 3 && /Minimum bei 775</.test(h) && h.includes('Bestellmenge in Stück'), 'kurve: drei Kurven, Minimum der Gesamtkosten exakt bei 775 (= √600 000)');
h = block('formel', BEISPIELE.formel);
check(h.includes('<sub>opt</sub>') && h.includes('<sub>B</sub>') && zahl(h, /bs-var/g) >= 8 && h.includes('bs-f-weg') && h.includes('≈ 775 Stück'), 'formel: Indizes, gefärbte Variablen, Rechenweg, Ergebnis');

h = block('rechnung', BEISPIELE.rechnung);
check(zahl(h, /bs-r-kopf/g) === 2 && zahl(h, /bs-r-l/g) === 3 && zahl(h, /bs-r-w bs-r-erg/g) === 2 && h.includes('= <b>0,4</b>') && h.includes('repeat(2,'), 'rechnung: Kopf alt/neu, Rechenzeilen, Ergebnis hervorgehoben und fett');
h = block('rechnung', 'Grundzahlen | 3 | 1 | 8 | 1 | 6\nFaktoren | 6 | 5 | 4 | 3 | 2\nProdukte | 18 + 5 + 32 + 3 + 12 = 70\n70 : 11 = 6 Rest 4\n= Prüfziffer | 11 − 4 = 7');
check(h.includes('repeat(5,') && zahl(h, /grid-column:span 5/g) === 3 && zahl(h, /bs-r-erg/g) === 2, 'rechnung: Zahlen in Spalten untereinander, ganze Rechnungen über die volle Breite (Prüfziffer)');
h = block('matrix', BEISPIELE.matrix);
check(zahl(h, /bs-m-feld/g) === 4 && zahl(h, /bs-m-feld bs-mark/g) === 1 && zahl(h, /bs-m-zk/g) === 2 && h.includes('Wettbewerbsvorteil →'), 'matrix: vier Felder, eines markiert, Achsen beschriftet');
h = block('skala', BEISPIELE.skala);
check(zahl(h, /bs-s-punkt/g) === 4 && h.includes('left:0%') && h.includes('bs-s-links') && h.includes('bs-s-rechts') && h.includes('Integrationsgrad hoch'), 'skala: vier Punkte, Ränder nach innen ausgerichtet, Pole');

// ---- Formel-Parser: rechnet richtig, führt nichts aus
const f = (s, x) => ausdruck(s)(x);
check(f('600000 / x + x', 775) > 1549 && f('600000 / x + x', 775) < 1550 && f('2x^2 - 3', 2) === 5 && f('sqrt(16) + ln(e)', 0) === 5 && f('3(x+1)', 1) === 6 && f('-x^2', 3) === -9, 'Ausdrücke: Punkt vor Strich, Potenz, implizites Mal, sqrt/ln/e');
check(f('0,2 · x', 10) === 2 && f('1 200 / x', 2) === 600 && f('x²', 3) === 9 && f('√x', 9) === 3, 'Ausdrücke: Komma, Tausender-Leerzeichen, ², √, ·');
let wirft = 0;
for (const boese of ['process.exit(1)', 'constructor', 'x)(', 'alert(1)', 'x + ', '`x`', 'this']) { try { ausdruck(boese); } catch { wirft++; } }
check(wirft === 7, 'Ausdrücke: unbekannte Namen und kaputte Syntax werfen, nichts wird ausgeführt');
check(block('kurve', 'x: a | 0 bis 10\ny = process.exit(1)').includes('bs-rueck'), 'kurve mit unbekanntem Namen: Liste statt Grafik');

// ---- Rückfall: kaputte Blöcke werden eine Liste, nie ein grauer Kasten
const kaputt = {
  kette: 'nur ein Glied',
  zielkonflikt: 'Maßnahme ohne Folgen',
  vergleich: 'keine Spalten\nnoch eine Zeile',
  ablauf: 'ein Schritt',
  baum: 'Wurzel\n- nur ein Ast',
  falle: 'Richtig: ohne Falle',
  spannung: 'A | B\nA–B: zwei Pole',
  anteil: 'Menge | A 10',
  kurve: 'x: Menge | 10 bis 1\nk = x',
  formel: 'a = b + c',
  rechnung: '| a | b\nx | 1 | 2 | 3',
  matrix: 'x: A | a1 | a2\ny: B | b1 | b2\nnur | zwei\n',
  skala: 'links | rechts\nEins | 150\nZwei | 20',
};
for (const [t, inhalt] of Object.entries(kaputt)) {
  const r = block(t, inhalt);
  check(r.includes('bs-rueck') && !r.includes('ueb-code') && !r.includes(`class="bs bs-`), `kaputter Block ${t}: schlichte Liste`);
}
check(block('kette', '') === '' && block('baum', '\n\n') === '', 'leerer Block: nichts');

// ---- Code bleibt Code, unbekannte Sprachen auch
check(block('java', 'int a = 1;').includes('<pre class="ueb-code">int a = 1;</pre>'), 'Codeblock mit Sprache bleibt Code');
check(md('```\nClient --> Server\n```').includes('ueb-code'), 'Codeblock ohne Sprache bleibt Code');
check(block('KETTE', 'A ↑\nB ↓').includes('bs-kette') && md('```kette \nA\nB\n```').includes('bs-kette'), 'Bausteinname ohne Rücksicht auf Groß/klein und Leerzeichen dahinter');

// ---- Sicherheit: kein HTML von Claude
const xss = '<img src=x onerror=alert(1)>';
const alle = typen.map((t) => block(t, BEISPIELE[t].replace(/Kosten/g, xss).replace(/Bestellmenge/g, xss))).join('') + block('kette', `${xss}\n<script>alert(1)</script> ↑ | gut: ${xss}`) + block('kette', 'a\nb\n' + xss);
check(!/<img|<script/i.test(alle) && alle.includes('&lt;img'), 'HTML in Bausteinen wird als Text gezeigt, nie ausgeführt');

// ---- Umgebung: Text davor und danach bleibt Markdown
h = md('Davor **fett**.\n\n```kette\nA ↑\nB ↑\n```\n\nDanach mit `code`.');
check(/^<p>Davor <b>fett<\/b>.<\/p><div class="bs bs-kette"/.test(h) && h.endsWith('<p>Danach mit <code>code</code>.</p>'), 'Absätze vor und nach dem Baustein bleiben normaler Text');

console.log(fehler ? `${fehler} Fehler` : 'Bausteine: alles in Ordnung');
