/**
 * Dialog "Tastenkürzel" der Bearbeitungsseite (Knopf "?", Taste "?"): alle Kürzel in Gruppen.
 */

import {escapeHtml} from '../lib/format.js';
import {openOverlay} from '../ui/overlay.js';

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
        ['Alt+G', 'Gehe zu Takt'],
        ['Alt+Umschalt+G', 'Gehe zu Abschnitt (Menü: ↑/↓, Enter)'],
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
        ['Umschalt+L', 'Liedtext-Silbe'],
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
        ['Einfg', 'Schlag links neben dem Cursor einfügen'],
        ['Alt+Einfg', 'Schlag rechts neben dem Cursor einfügen'],
        ['Entf', 'Zahl löschen; leeren oder ausgewählten Schlag löschen'],
        ['Strg+Einfg', 'Takt links neben dem Cursor einfügen'],
        ['Strg+Alt+Einfg', 'Takt rechts neben dem Cursor einfügen (auch am Ende)'],
        ['Strg+Entf', 'Takt löschen'],
        ['Umschalt+↑/↓', 'Tonleiterschritt höher / tiefer (Ton der Tonart)'],
        ['Alt+Umschalt+↑/↓', 'Halbton höher / tiefer'],
        ['Strg+Umschalt+↑/↓', 'nächster Akkordton höher / tiefer'],
        ['Strg+Alt+↑/↓', 'Note auf die Saite darüber / darunter'],
        ['Strg+9 Strg+7 Strg+8', 'Kreuz, Be, Auflösungszeichen'],
    ]],
    ['Bearbeiten', [
        ['Strg+C Strg+X Strg+V', 'kopieren, ausschneiden, einfügen (auch ganze Takte)'],
        ['Alt+C Alt+V', 'Pinsel: Eigenschaften kopieren, übertragen'],
        ['Strg+Z Strg+Y', 'rückgängig, wiederholen'],
        ['Strg+S', 'speichern'],
    ]],
    ['Effekte', [
        ['H', 'Hammer-on / Pull-off'],
        ['S', 'Slide'],
        ['B', 'Bend'],
        ['V', 'Vibrato'],
        ['X', 'Dead-Note (Saite dämpfen)'],
        ['O', 'Ghost-Note (in Klammern, leise)'],
        ['Umschalt+D/U', 'Plektrum abwärts, aufwärts'],
        ['Strg+D/U', 'Anschlag abwärts, aufwärts'],
        ['Strg+Umschalt+D/U', 'Arpeggio abwärts, aufwärts'],
    ]],
    ['Panels', [
        ['F2', 'Panel "Am Cursor" (links) ein-/ausklappen'],
        ['F4', 'Panel "Liedtext" (rechts) ein-/ausklappen'],
        ['F8', 'Panel "Audio" (unten) ein-/ausklappen'],
        ['?', 'diese Übersicht'],
    ]],
];

/**
 * Tasten als <kbd>-Elemente: "Strg+Z Strg+Y" wird zu zwei Tastenfolgen, "+" verbindet Tasten einer Folge.
 * @param {string} keys Tasten
 * @returns {string} HTML
 */
function keysHtml(keys) {
    return keys.split(' ').map(combo => combo === '…' ? '…'
        : combo.split(/(?<=.)\+(?=.)/).map(k => `<kbd>${escapeHtml(k)}</kbd>`).join('+')).join(' ');
}

/**
 * Öffnet die Übersicht der Tastenkürzel als Dialog.
 * @returns {void}
 */
export function openShortcutHelp() {
    openOverlay(`
        <h2>Tastenkürzel im Notenblatt</h2>
        <div class="shortcut-groups">
            ${SHORTCUTS.map(([group, items]) => `
            <section>
                <h3>${escapeHtml(group)}</h3>
                <table class="shortcut-table">
                    ${items.map(([keys, label]) => `<tr><td>${keysHtml(keys)}</td><td>${escapeHtml(label)}</td></tr>`).join('')}
                </table>
            </section>`).join('')}
        </div>
    `, false, false);
}
