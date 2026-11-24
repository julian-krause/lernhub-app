// Katalog der Bausteine für die Prompts von „Lernen“ (lernen.js) und „Wiederholen“ (ueben.js). Gezeichnet werden sie
// in src/ui/js/bilder.js; die Syntax hier und die Parser dort gehören zusammen (tests/bilder.test.mjs prüft jedes
// Beispiel unten gegen den Parser). Wann ein Baustein kommt, prüft tests/bilder-live.mjs mit echtem Claude.

const BEISPIELE = {
  kette: `Sicherheitsbestand ↑
Lieferbereitschaft ↑ | gut: Ziel Zeit erfüllt
Kapitalbindung ↑ | schlecht: Ziel Kosten leidet`,
  zielkonflikt: `Sicherheitsbestand erhöhen
+ Zeit: Lieferbereitschaft
- Kosten: Kapitalbindung, Lagerkosten
Beim Billigsten in Riesenmengen kaufen
+ Kosten: niedriger Einstandspreis
- Qualität: Qualitätsrisiko`,
  vergleich: `| Just-in-Time | Vorratshaltung
Bestand | minimal | hoch
Bei Lieferausfall | Bandstillstand | Puffer überbrückt`,
  ablauf: `Bedarf ermitteln | was, wie viel, wann
Angebote einholen
* Lieferant wählen | Nutzwertanalyse
Bestellen`,
  baum: `Ziele der Materialwirtschaft
- Kosten
  - geringe Kapitalbindung
- Qualität
  - * Verhinderung qualitätsmindernder Liegezeiten
- Zeit
  - Lieferbereitschaft`,
  falle: `Falle: „Liegezeiten“ klingt nach ~~Zeit~~.
Richtig: Geschützt wird das Aroma, also die **Qualität**.
Regel: Ordne nach dem, was geschützt wird, nicht nach dem Wort.`,
  spannung: `Kosten | Qualität | Zeit
Kosten–Qualität: billig einkaufen gefährdet die Qualität
Kosten–Zeit: mehr Bestand sichert Lieferung, bindet Kapital`,
  anteil: `Menge | A 15 | B 35 | C 50
Wert | A 75 | B 20 | C 5
Wenige A-Teile tragen drei Viertel des Werts.`,
  kurve: `x: Bestellmenge in Stück | 200 bis 1500
y: Kosten pro Jahr in €
Bestellkosten = 600000 / x
Lagerkosten = x
Gesamtkosten = 600000 / x + x | Minimum`,
  formel: `x_opt = sqrt(2 · M · K_B / (p · q))
M = Jahresbedarf | 12 000 Stück
K_B = Kosten je Bestellung | 50 €
p = Einstandspreis | 10 €
q = Lagerhaltungskostensatz | 20 %
→ x_opt = sqrt(2 · 12000 · 50 / (10 · 0,2)) = sqrt(600000)
= Optimale Bestellmenge | ≈ 775 Stück`,
  rechnung: `| alt | neu
Umsatz | 20 · 1.000 = 20.000 € | 20 · 1.000 = 20.000 €
Fremdbezug | 10 · 1.000 = 10.000 € | 12 · 1.000 = 12.000 €
= Wertschöpfungsquote | 10.000 / 20.000 = 0,5 | 8.000 / 20.000 = 0,4`,
  matrix: `y: Wettbewerbsfeld | breit (Gesamtmarkt) | eng (Teilmarkt)
x: Wettbewerbsvorteil | niedrige Kosten | hoher Kundennutzen
Kostenführerschaft | Differenzierung
Nische mit Kostenschwerpunkt | * Nische mit Differenzierungsschwerpunkt`,
  skala: `Integrationsgrad hoch | niedrig
Volle Integration | 0
Partielle Integration | 33
Quasi-Integration | 66
Verträge | 100`,
};

const WOFUER = {
  kette: 'Ursache → Folge über mehrere Glieder, „was steigt, was sinkt“. Zeile = Glied, ↑/↓ optional, nach | eine Notiz, „gut:“/„schlecht:“ färbt sie.',
  zielkonflikt: 'Maßnahmen mit dem, was sie gewinnen und was sie kosten. Zeile ohne Zeichen = Maßnahme, „+ Ziel: Detail“ gewinnt, „- Ziel: Detail“ verliert. Jede Maßnahme hat mindestens ein + und ein -.',
  vergleich: 'Zwei bis vier Konzepte, die man verwechselt, Merkmal für Merkmal. Kopfzeile „| A | B“, dann „Merkmal | Wert A | Wert B“. Zellen dürfen ganze Sätze sein (anders als Markdown-Tabellen).',
  ablauf: 'Eine feste Reihenfolge (Prozess, Algorithmus in Schritten). „Schritt | Detail“, „* “ davor hebt den Schritt hervor, um den es gerade geht.',
  baum: 'Ober- und Unterbegriffe, Einteilungen, Zuordnungen. Nicht für zwei Merkmale, die sich kreuzen: dann matrix. Erste Zeile die Wurzel, „- Ast“, eingerückt „  - Blatt“, „* “ nach dem Strich markiert. 2–5 Äste.',
  falle: 'Der typische Denkfehler zu einem Punkt. „Falle:“, „Richtig:“, optional „Regel:“.',
  spannung: 'Genau drei Ziele, die sich gegenseitig behindern (magisches Dreieck, Trilemma). Erste Zeile „A | B | C“, dann „A–B: Konflikt“.',
  anteil: 'Anteile und Verteilungen (ABC-Analyse, Kostenstruktur, Marktanteile). „Zeile | Teil Zahl | Teil Zahl“, danach optional ein Satz.',
  kurve: 'Funktionsverläufe zum Ansehen (Kosten über Menge, Angebot/Nachfrage, Verteilungen). „x: Beschriftung | von bis bis“, „y: Beschriftung“, je Kurve „Name = Ausdruck in x“ (+ - * / ^, Klammern, sqrt, ln, exp), „| Minimum“ oder „| Maximum“ markiert den Punkt. Die App rechnet die Punkte selbst.',
  rechnung: 'Jede Rechnung mit Zahlen, die mehr als eine Zeile braucht: Rechenweg, Prüfziffer, Kennzahl, alt gegen neu. „Bezeichnung | Rechnung“, optional Kopfzeile „| Variante A | Variante B“ und dann eine Rechnung je Spalte; einzelne Zahlen in eigenen Spalten („Grundzahlen | 3 | 1 | 8“) stehen sauber untereinander. „= Bezeichnung | Ergebnis“ hebt das Ergebnis hervor.',
  matrix: 'Ein Raster aus zwei Merkmalen mit je zwei bis vier Ausprägungen (Porter, BCG-Portfolio, Ansoff, Eisenhower). Ergeben sich Begriffe aus der Kombination zweier Merkmale, ist das immer eine matrix, kein baum, kein ablauf und kein vergleich. „y: Achse | Zeile 1 | Zeile 2“, „x: Achse | Spalte 1 | Spalte 2“, dann je Zeile die Felder, „* “ markiert ein Feld.',
  skala: 'Einordnung zwischen zwei Polen (Integrationsgrad, Zentralisierung, Make or Buy). Erste Zeile „linker Pol | rechter Pol“, dann „Eintrag | Position von 0 bis 100“.',
  formel: 'Eine Formel mit ihren Variablen und einem Rechenbeispiel. Erste Zeile die Formel (Index mit _, Potenz mit ^, Wurzel mit sqrt), dann „Symbol = Bedeutung | Wert“, Rechenschritte mit „→“, Ergebnis mit „= Bezeichnung | Wert“.',
};

const KATALOG = `## Bausteine: die App zeichnet, du beschreibst

Die App zeichnet Strukturen und Rechnungen selbst als saubere Grafik. Du schreibst dafür einen Codeblock, dessen Sprache der Bausteinname ist, und darin nur den Inhalt in der Form unten. Kein Baustein passt? Dann Text, eine Liste oder eine einfache Tabelle. **Ein Codeblock ohne Bausteinnamen ist nur für Programmcode, Befehle und Programmausgaben** und trägt dann seine Sprache (\`\`\`java, \`\`\`bash). Alles andere in einem Codeblock sieht für den Lernenden kaputt aus: keine Rechnungen, keine Kästen, Pfeile, Achsen oder Spalten aus Leerzeichen. Eine Rechnung kommt in den Baustein rechnung (oder formel, wenn die Formel selbst das Thema ist).

**Wann ein Baustein, wann keiner.** Das ist die wichtigste Regel dieses Abschnitts.
- Ein Baustein nur, wenn der Stoff dieses Zugs eine Form hat, die man sehen kann: eine Wirkung über mehrere Glieder, Maßnahmen mit Gewinn und Verlust, zwei bis vier verwechselbare Konzepte, eine feste Reihenfolge, Ober- und Unterbegriffe, ein typischer Fehler, drei Ziele im Konflikt, ein Raster aus zwei Merkmalen, eine Einordnung zwischen zwei Polen, Anteile, ein Funktionsverlauf, eine Formel mit mehreren Variablen, eine Rechnung über mehrere Zeilen.
- Kein Baustein für eine Definition, eine einzelne Tatsache, eine Begründung in zwei, drei Sätzen, eine kurze Rückfrage, ein Lob oder eine Korrektur, und nie für Code (der bleibt ein Codeblock mit seiner Sprache, z. B. \`\`\`java).
- Höchstens eine Grafik je Antwort; dazu höchstens zwei rechnung (etwa Rechenweg und Probe). Die meisten Züge haben keine Grafik; das ist richtig so.
- Der Baustein trägt den Kern. Der Text davor und danach erklärt das Warum und zählt den Inhalt des Bausteins nicht noch einmal auf.
- Vor einer Vorhersagefrage verrät der Baustein die Antwort nicht.
- Kurz halten: wenige Zeilen, kurze Einträge. Ein Baustein ist eine Grafik, kein Absatz.

**Katalog** (Name, wofür, Form, Beispiel):

${Object.keys(BEISPIELE).map((k) => `- **${k}**: ${WOFUER[k]}\n\`\`\`${k}\n${BEISPIELE[k]}\n\`\`\``).join('\n')}`;

module.exports = { KATALOG, BEISPIELE };
