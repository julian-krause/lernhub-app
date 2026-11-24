// Markdown (klein): Absätze, Listen, Code, **fett**, ~~durchgestrichen~~, einfache Tabellen und Bausteine.
// Ein Codeblock, dessen Sprache ein Bausteinname ist (```kette, ```vergleich …), wird gezeichnet (bilder.js);
// jeder andere Codeblock bleibt Code. Ohne DOM, damit tests/bilder.test.mjs ihn direkt prüfen kann.
import { esc } from './util.js';
import { BAUSTEINE, baustein, rueckfall } from './bilder.js';

// Code-Spans zuerst herauslösen, damit Sternchen darin (*.md) unangetastet bleiben; keine Kursivschrift
export const inline = (z) => String(z).split(/(`[^`]+`)/).map((x, j) => (j % 2 ? `<code>${esc(x.slice(1, -1))}</code>`
  : esc(x).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/~~([^~]+)~~/g, '<s>$1</s>'))).join('');

export function md(t) {
  const teile = String(t || '').replace(/\r/g, '').split(/```/);
  return teile.map((p, i) => {
    if (i % 2) {
      const sprache = (p.match(/^[ \t]*([\w+-]*)[ \t]*\n/) || [])[1] || '';
      const code = p.replace(/^[ \t]*[\w+-]*[ \t]*\n/, '').replace(/\n$/, '');
      if (Object.hasOwn(BAUSTEINE, sprache.toLowerCase())) return baustein(sprache, code, inline) || rueckfall(code, inline);
      return `<pre class="ueb-code">${esc(code)}</pre>`;
    }
    return p.split(/\n{2,}/).map((block) => {
      const zeilen = block.split('\n').filter((z) => z.trim() !== '');
      if (!zeilen.length) return '';
      // einfache Tabelle: Zeilen mit |, zweite Zeile ist die Trennzeile
      if (zeilen.length >= 2 && zeilen.every((z) => z.includes('|')) && /^[\s|:-]+$/.test(zeilen[1]) && zeilen[1].includes('-')) {
        const zellen = (z) => z.trim().replace(/^\||\|$/g, '').split('|').map((x) => inline(x.trim()));
        return `<table class="ueb-tab"><tr>${zellen(zeilen[0]).map((x) => `<th>${x}</th>`).join('')}</tr>${zeilen.slice(2).map((z) => `<tr>${zellen(z).map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</table>`;
      }
      // aufeinanderfolgende Listenzeilen werden eine Liste, alles andere Absätze (auch „Satz, direkt darunter die Liste“)
      const LI = /^\s*([-*]|\d+[.)])\s+/, teile = [];
      for (const z of zeilen) {
        const art = LI.test(z) ? (/^\s*\d/.test(z) ? 'ol' : 'ul') : 'p', letzter = teile[teile.length - 1];
        if (letzter && letzter.art === art) letzter.z.push(z); else teile.push({ art, z: [z] });
      }
      return teile.map((t) => (t.art === 'p' ? `<p>${t.z.map(inline).join('<br>')}</p>`
        : `<${t.art} class="ueb-liste">${t.z.map((z) => `<li>${inline(z.replace(LI, ''))}</li>`).join('')}</${t.art}>`)).join('');
    }).join('');
  }).join('');
}
