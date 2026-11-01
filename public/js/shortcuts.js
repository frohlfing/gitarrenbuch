/**
 * Tastenkürzel des Bearbeitungsmodus. Übernommen aus Guitar Pro 8
 * (https://www.guitar-pro.com/docs/gp8/appendix/shortcuts), soweit der Editor die Funktion hat und der Browser die
 * Taste nicht selbst belegt; Abweichungen stehen in SHORTCUT_DEVIATIONS. Die Übersicht öffnet der Knopf "?" in der
 * Werkzeugleiste bzw. die Taste "?" (siehe note-editor.js).
 */

import {escapeHtml} from './api.js';
import {openOverlay} from './library.js';

/**
 * Kürzel in Gruppen: [Gruppe, [[Tasten, Funktion], …]]. Mehrere Tastenfolgen mit Leerzeichen getrennt (z. B.
 * "Strg+Z Strg+Y" für zwei Funktionen in einer Zeile); "Strg+D/U" steht kurz für Strg+D bzw. Strg+U.
 * @type {[string, [string, string][]][]}
 */
export const SHORTCUTS = [
  ['Cursor und Wiedergabe', [
    ['← →', 'voriger / nächster Schlag'],
    ['↑ ↓', 'Saite darüber / darunter'],
    ['Pos1', 'Anfang des Takts'],
    ['Strg+Pos1', 'erster Takt'],
    ['Ende', 'letzter Takt'],
    ['Strg+↑/↓', 'vorige / nächste Spur'],
    ['Strg+Alt+←/→', 'voriger / nächster Abschnitt'],
    ['Leertaste', 'Abspielen / Pause'],
    ['Strg+Leertaste', 'von vorn abspielen'],
  ]],
  ['Auswahl', [
    ['Umschalt+←/→', 'Schläge auswählen'],
    ['Strg+Umschalt+←/→', 'Takte auswählen'],
    ['Strg+A', 'alles auswählen'],
    ['Esc', 'Auswahl aufheben'],
  ]],
  ['Eingabe', [
    ['0 … 9', 'Bund (zweistellig: zwei Ziffern rasch nacheinander)'],
    ['Rücktaste', 'Note löschen'],
    ['R', 'Pause'],
    ['A', 'Akkord'],
    ['T', 'Text über dem Schlag'],
    ['Umschalt+Einfg', 'Abschnitt'],
    ['Strg+K', 'Tonart'],
  ]],
  ['Dauer', [
    ['+', 'kürzer (ein Fähnchen mehr)'],
    ['-', 'länger (ein Fähnchen weniger)'],
    ['.', 'punktiert'],
    ['Strg+.', 'doppelt punktiert'],
    ['/', 'Triole'],
    ['Strg+/', 'Triolen-Feeling (Shuffle)'],
    ['L', 'Haltebogen'],
  ]],
  ['Takte, Schläge, Noten', [
    ['Einfg', 'Takt einfügen'],
    ['Strg+Einfg', 'Schlag einfügen'],
    ['Strg+Entf', 'Takt löschen'],
    ['Umschalt+Entf', 'Schläge löschen'],
    ['Alt+Umschalt+↑/↓', 'Halbton höher / tiefer'],
    ['Strg+Alt+↑/↓', 'Note auf die Saite darüber / darunter'],
    ['Strg+9 Strg+7 Strg+8', 'Kreuz, Be, Auflösungszeichen'],
  ]],
  ['Bearbeiten', [
    ['Strg+C Strg+X Strg+V', 'kopieren, ausschneiden, einfügen (auch ganze Takte)'],
    ['Strg+Z Strg+Y', 'rückgängig, wiederholen'],
    ['Strg+S', 'speichern'],
  ]],
  ['Effekte', [
    ['H', 'Hammer-on / Pull-off'],
    ['S', 'Slide'],
    ['B', 'Bend'],
    ['V', 'Vibrato'],
    ['X', 'Saite dämpfen (Dead Note)'],
    ['Umschalt+D/U', 'Abschlag, Aufschlag'],
    ['Strg+D/U', 'Anschlagpfeil abwärts, aufwärts'],
    ['Strg+Umschalt+D/U', 'Arpeggio abwärts, aufwärts'],
  ]],
  ['Panels', [
    ['F2', 'Panel "Am Cursor" (links) ein-/ausklappen'],
    ['F6', 'Panel "Song" (rechts) ein-/ausklappen'],
    ['F8', 'Panel unten (Liedtext, Akkorde, Spuren, Audio) ein-/ausklappen'],
    ['?', 'diese Übersicht'],
  ]],
];

/**
 * Wo das Gitarrenbuch von Guitar Pro abweicht: [Guitar Pro, Funktion, hier].
 * @type {[string, string, string][]}
 */
export const SHORTCUT_DEVIATIONS = [
  ['Strg+T', 'Taktart', 'Reiter "Takt" bzw. "Song" (Strg+T öffnet im Browser einen neuen Tab)'],
  ['F5', 'Song-Inspektor', 'F6, Panel "Song" rechts (F5 lädt die Seite neu)'],
  ['F8', 'Gesamtansicht', 'F8 klappt das untere Panel ein und aus'],
  ['Strg+Tab, Strg+W, Strg+N', 'Dateien wechseln, schließen, neu', 'entfällt (belegt der Browser)'],
];

/**
 * Tasten als <kbd>-Elemente: "Strg+Z Strg+Y" wird zu zwei Tastenfolgen, "+" verbindet Tasten einer Folge.
 * @param {string} keys Tasten
 * @returns {string} HTML
 */
function keysHtml(keys){
  return keys.split(' ').map(combo => combo === '…' ? '…'
    : combo.split(/(?<=.)\+(?=.)/).map(k => `<kbd>${escapeHtml(k)}</kbd>`).join('+')).join(' ');
}

/**
 * Öffnet die Übersicht der Tastenkürzel als Dialog.
 * @returns {void}
 */
export function openShortcutHelp(){
  openOverlay(`
    <h2>Tastenkürzel</h2>
    <p class="shortcut-intro">Wie in Guitar Pro 8. Gelten im Notenblatt, nicht beim Schreiben in einem Eingabefeld.</p>
    <div class="shortcut-groups">
      ${SHORTCUTS.map(([group, items]) => `
        <section>
          <h3>${escapeHtml(group)}</h3>
          <table class="shortcut-table">
            ${items.map(([keys, label]) => `<tr><td>${keysHtml(keys)}</td><td>${escapeHtml(label)}</td></tr>`).join('')}
          </table>
        </section>`).join('')}
    </div>
    <h3>Anders als in Guitar Pro</h3>
    <table class="shortcut-table">
      ${SHORTCUT_DEVIATIONS.map(([keys, what, here]) =>
        `<tr><td>${escapeHtml(keys)}</td><td>${escapeHtml(what)}: ${escapeHtml(here)}</td></tr>`).join('')}
    </table>
  `);
}
