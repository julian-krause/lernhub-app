// Gemeinsamer Zustand der Oberfläche und Nachschlagen in den hub.py-Daten.
export const S = {
  d: null,               // hub.py data
  info: null,            // Pfade, Modus
  route: { name: 'woche' },
  rc: [],                // Kurse mit Roadmap
  plain: [],
  bySlug: {},
  byKey: {},
  laden: false,
  lern: {},              // Lernen: Kursschlüssel → { sitzung, ziel } (aus dem Hauptprozess)
  ueb: {},               // Wiederholen: Kursschlüssel → Sitzung
  sprech: null,          // Sprechstunde (js/sprechstunde.js): die eine Sitzung oder null
  openai: false,         // OpenAI-Schlüssel für die Sprechstunde gespeichert
  lernLauf: false,       // Lernen von „Diese Woche“ aus: nach jeder Lektion die nächste über alle Kurse
  strom: null,           // Unendlich-Modus (js/lernen.js): Lektion für Lektion ohne Pause
  lauf: null,            // Wiederholen als Endloslauf über alle Kurse (js/ueben.js), mit kurz: „Nur 5 Minuten“
  sync: { zustand: 'aus', schritte: [] },   // ILIAS-Sync (js/sync.js)
  frueherOffen: {},      // Kursseite: „Frühere Wochen“ aufgeklappt (Kursschlüssel → true)
};

export function setDaten(d) {
  S.d = d;
  S.rc = d.courses.filter((c) => c.hasRoadmap);
  S.plain = d.courses.filter((c) => !c.hasRoadmap);
  S.bySlug = {}; S.byKey = {};
  d.courses.forEach((c) => { S.bySlug[c.slug] = c; S.byKey[c.key] = c; });
  S.rc.forEach((c) => { c.byId = {}; c.lessons.forEach((l) => { c.byId[l.id] = l; }); });
}

export const aktionen = (gruppe) => S.d.actions.filter((a) => !gruppe || a.group === gruppe);
export const aktion = (id) => S.d.actions.find((a) => a.id === id);
