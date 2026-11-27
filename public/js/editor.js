/**
 * Bearbeitungsmodus: Toolbar und Panels, Maus und Cursor, Tastenkürzel.
 */

import {
    barreFret,
    chordDiagramSvg,
    chordKey,
    deleteScoreVersion,
    detectKeySignature,
    diagramFirstFret,
    escapeHtml,
    glyph,
    GLYPHS,
    gripOf,
    isStandardTuning,
    loadAudio,
    loadChordLibraryOrEmpty,
    loadChordUsage,
    loadLeadsheet,
    loadScoreHistory,
    loadScoreText,
    loadScoreVersion,
    normalizeChords,
    parseGrip,
    saveLeadsheet,
    saveScore,
    svgIcon,
} from './base.js';
import {chordNoteProblems, replaceChordNotes} from './chordcheck.js';
import {readChordFile, simplifyChord} from './chordfile.js';
import {findGrips, gripText, gripToneProblem, nameGrip} from './chordgrips.js';
import {chordNoteNames, parseChord, rankChords, scaleTriads, suggestChordNames} from './chordtheory.js';
import {
    closeOverlay,
    findSong,
    isOverlayOpen,
    knownTracks,
    openOverlay,
    openStackedOverlay,
    renderAudioSource,
    showBusy,
    saveSongFields,
    showScoreLength,
} from './library.js';
import * as edit from './notation.js';
import {applyMelody, audioClock, decodeAudio, detectMelody} from './pitchdetect.js';
import {deriveChords, hasHarmony} from './chorddetect.js';
import {
    chordsTrack,
    describeScoreLoss,
    KEY_NAMES,
    keyName,
    lyricsTrack,
    parseScore,
    readGpFile,
    stringedStaves,
    TRACK_NAMES,
    trackName,
    writeScore,
    writeScoreChecked
} from './notation.js';
import {eyeIcon, perFrame, showTrackNames, speakerIcon, SyncEditor} from './playback.js';
import {
    captureTabs,
    chordTimeline,
    LeadsheetTab,
    normalizeSheet,
    parseTimeSignature,
    remapTabs,
    SECTION_NAMES,
    sectionName,
    TIME_SIGNATURES,
} from './sheet.js';
import {RhythmDialog} from './rhythmdialog.js';
import {applyRetune, TransposeDialog} from './transposedialog.js';
import {retime, TimingDialog} from './timingdialog.js';
import {buildTextModel, lyricsLines, lyricsSectionStarts, renderTextView} from './textview.js';
import {CHORD_EXTENSIONS, GP_EXTENSIONS, openUploads} from './uploads.js';

/** @typedef {import('./playback.js').Player} Player */
/** @typedef {import('./base.js').Song} Song */
/** @typedef {import('./notation.js').EditPosition} EditPosition */
/** @typedef {import('../../types/alphatab').model.Score} Score */

/** @typedef {import('../../types/alphatab').model.Beat} Beat */
/** @typedef {import('../../types/alphatab').model.Track} Track */

/**
 * Position mit geänderten Angaben (der Rest bleibt wie in der Ausgangsposition).
 * @param {EditPosition} pos Ausgangsposition
 * @param {Partial<EditPosition>} changes was sich ändert
 * @returns {EditPosition} neue Position
 */
function movedPosition(pos, changes) {
    return {
        track: changes.track ?? pos.track, bar: changes.bar ?? pos.bar, beat: changes.beat ?? pos.beat,
        string: changes.string ?? pos.string,
    };
}

// --------------------------------------------------------------------------------------------------------------------
// HTML-Bausteine
// --------------------------------------------------------------------------------------------------------------------

/**
 * Kleine HTML-Bausteine für die Panels des Bearbeitungsmodus (editor.js und editor.js): Feld mit
 * Beschriftung, Textfeld, Zahlenfeld, Auswahlliste, Radiobuttons, Knopf.
 */

/**
 * Feld mit Beschriftung.
 * @param {string} label Beschriftung (HTML)
 * @param {string} control Eingabeelement (HTML)
 * @returns {string} HTML
 */
export function field(label, control) {
    return `<label class="efield"><span>${label}</span>${control}</label>`;
}

/**
 * Einzeiliges Textfeld.
 * @param {string} [placeholder] Platzhalter
 * @param {string} [attrs] weitere Attribute (z. B. data-song="tempo")
 * @returns {string} HTML
 */
export function text(placeholder = '', attrs = '') {
    return `<input type="text" placeholder="${escapeHtml(placeholder)}" ${attrs}>`;
}

/**
 * Zahlenfeld.
 * @param {number} min kleinster Wert
 * @param {number} max größter Wert
 * @param {string} [attrs] weitere Attribute
 * @returns {string} HTML
 */
export function num(min, max, attrs = '') {
    return `<input type="number" min="${min}" max="${max}" ${attrs}>`;
}

/**
 * Auswahlliste; der Wert eines Eintrags ist sein Text.
 * @param {string[]} options Einträge
 * @param {string} [attrs] weitere Attribute
 * @returns {string} HTML
 */
export function select(options, attrs = '') {
    return `<select ${attrs}>${options.map(o => `<option>${escapeHtml(o)}</option>`).join('')}</select>`;
}

/**
 * Knopf der Leisten und Panels. Mit Befehl führt er ihn aus (NoteEditor.run()), sonst meldet er "Noch nicht
 * umgesetzt".
 * @param {string} label Beschriftung (HTML)
 * @param {string} title Name der Funktion (Tooltip und Hinweis)
 * @param {string} [cls] zusätzliche Klassen
 * @param {string} [cmd] Befehl
 * @returns {string} HTML
 */
export function todoButton(label, title, cls = '', cmd = '') {
    return `<button type="button" class="ebtn${cls ? ' ' + cls : ''}" data-todo="${escapeHtml(title)}"
    ${cmd ? `data-cmd="${cmd}"` : ''} title="${escapeHtml(title)}">${label}</button>`;
}

// --------------------------------------------------------------------------------------------------------------------
// Panel "Liedtext"
// --------------------------------------------------------------------------------------------------------------------

/**
 * Panel "Liedtext" des Bearbeitungsmodus (NoteEditor): oben der Text zum Bearbeiten, darunter die Vorschau wie in
 * "Text & Akkorde"; die Stelle des Cursors in den Noten ist in beiden markiert und umgekehrt. Der Text wird beim
 * Tippen auf die Schläge verteilt (setLyricsText() in notation.js).
 *
 * Die Methoden stehen am Ende der Klasse NoteEditor.
 */


// --------------------------------------------------------------------------------------------------------------------
// Maus und Cursor
// --------------------------------------------------------------------------------------------------------------------

/**
 * Maus und Cursor im Bearbeitungsmodus (NoteEditor): Klick setzt den Cursor, Umschalt+Klick wählt Schläge aus, dazu das
 * Zeichnen von Cursor und Auswahl über den Noten und der Treffertest gegen die Grenzen aus alphaTab (boundsLookup).
 *
 * Die Methoden stehen am Ende der Klasse NoteEditor.
 */

/** Rand um den Cursor (px): Spalte des Schlags und Kästchen der Saite. */
const CURSOR_PAD = 5;

/**
 * Takt einer Zeile in den Grenzen von alphaTab (BarBounds: eine je Notenzeile, also Noten und Tabs getrennt).
 * alphaTab zeichnet in einem Worker und setzt dort BarBounds.bar nicht; die Schläge darin verweisen aber auf das
 * Modell.
 * @param {import('../../types/alphatab').rendering.BarBounds} entry Zeile eines Takts
 * @returns {?import('../../types/alphatab').model.Bar} Takt im Modell
 */
function entryBar(entry) {
    return entry.bar ?? entry.beats[0]?.beat.voice.bar ?? null;
}


// --------------------------------------------------------------------------------------------------------------------
// Felder der Panels
// --------------------------------------------------------------------------------------------------------------------

/**
 * Felder der Panels im Bearbeitungsmodus (NoteEditor): füllen und übernehmen. Links, was am Cursor hängt (Schlag,
 * Akkord, Abschnitt, Taktart und Tempo des Takts), in der Werkzeugleiste, was am Song hängt (Tonart, Shuffle, Capo, Tuning), im
 * Dialog "Spuren" die Angaben je Spur.
 *
 * Die Methoden stehen am Ende der Klasse NoteEditor.
 */


// --------------------------------------------------------------------------------------------------------------------
// Tastenkürzel
// --------------------------------------------------------------------------------------------------------------------

/**
 * Tastenkürzel des Bearbeitungsmodus. Übernommen aus Guitar Pro 8
 * (https://www.guitar-pro.com/docs/gp8/appendix/shortcuts), soweit der Editor die Funktion hat und der Browser die
 * Taste nicht selbst belegt (Strg+T, F5, Strg+Tab, Strg+W und Strg+N sind es: F5 lädt die Seite neu, F8 klappt das untere
 * Panel ein und aus, die Taktart steht im Panel "Am Cursor"). Weitere Abweichungen von Guitar Pro: F4 klappt das rechte
 * Panel, F8 das untere (in Guitar Pro die Gesamtansicht). Strg+D und Strg+U (Anschlagpfeile) belegt der Browser auch
 * (Lesezeichen, Quelltext); im Bearbeitungsmodus fängt keyCommand() sie ab. Die Übersicht öffnet der Knopf "?" in der
 * Werkzeugleiste bzw. die Taste "?".
 */

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

// --------------------------------------------------------------------------------------------------------------------
// Bearbeitungsmodus
// --------------------------------------------------------------------------------------------------------------------

/**
 * Bearbeitungsmodus der Liedansicht (Noten, Tabs, Text, Akkorde) nach dem Vorbild von Guitar Pro.
 *
 * Bearbeitet werden frisch geladene Noten (score.atex), nicht das Modell des Players: Das ändert der Player für die
 * Anzeige (Akkorde, Text, Abschnitts- und Spurnamen). Der Editor zeichnet sie selbst in die Notenansicht, so wie sie
 * gespeichert werden. Nach jeder Änderung schreibt er sie als alphaTex und liest sie neu ein (notation.js); der
 * Text vorher ist der Schritt für "Rückgängig". Gespeichert wird mit derselben Prüfung wie beim Import
 * (writeScoreChecked()). Beim Verlassen zeigt der Player wieder seine Ansicht, nach dem Speichern neu geladen.
 *
 * Der Cursor steht auf einem Schlag und einer Saite (EditPosition). Die Saite ergibt sich aus der Lage der Tab-Zeile
 * (boundsLookup von alphaTab): Sie reicht genau von der obersten bis zur untersten Saite. Ohne Tabs (Ansicht
 * "Noten") gibt es nur die Spalte des Schlags.
 *
 * Aufbau: Die Werkzeugleiste (Speichern, Rückgängig, Tonart, Capo …, Hilfe, ✕) ist im Modus die einzige feste Leiste
 * und enthält, was am ganzen Song hängt (Tonart, Shuffle, Capo, Tuning), dazu die Knöpfe der Dialoge (Spuren,
 * Leadsheet, Transponieren, Verlauf …). Links steht, was am Cursor hängt (Notenwerte, Effekte, Schlag; vom Takt
 * Abschnitt, Taktart und Tempo), rechts der Liedtext, unten Audio mit dem Sync-Editor samt Statuszeile. Die Panels
 * lassen sich einklappen; auf schmalen Bildschirmen sind die seitlichen anfangs eingeklappt und legen sich ausgeklappt
 * über die Noten. Abspielen geht weiter.
 *
 * Konflikte (Abweichungen von der Form des Gitarrenbuchs, conflicts.js) zeigt der Editor nicht an: Der Import löst sie,
 * und keine Bearbeitung erzeugt neue. Ein Akkord bzw. eine Silbe am Cursor kommt deshalb immer in die Akkord- bzw.
 * Textspur; beginnt dort an der Stelle kein Schlag, wird der klingende geteilt und angebunden (klingt gleich).
 */

/**
 * Ein Schritt für "Rückgängig" bzw. "Wiederholen".
 * @typedef {Object} UndoStep
 * @property {string} tex alphaTex
 * @property {string} sheet Angaben für das Leadsheet (NoteEditor.sheetJson())
 * @property {EditPosition} pos Cursor
 * @property {number[]} tracks gezeigte Spuren
 * @property {string} label was der Schritt geändert hat, z. B. "Takt 12 geändert" (Tooltip von Rückgängig/Wiederholen)
 */

/**
 * Zwischenablage für Takte (Strg+C/X/V), gilt für alle Songs, solange die Seite offen ist.
 * @type {?import('./notation.js').BarClipboard}
 */
let clipboard = null;

/**
 * Was der Pinsel überträgt (Dialog "Pinsel"): [Schlüssel, Beschriftung].
 * @type {[string, string][]}
 */
const BRUSH_KINDS = [['chords', 'Akkorde'], ['stroke', 'Anschlag'], ['notes', 'Notenwerte und Töne'],
    ['text', 'Text über dem Schlag'], ['syllable', 'Liedtext-Silbe']];

/**
 * Was der Pinsel je Art im Ziel ändert (Dialog "Kopieren", Tooltip der Checkbox).
 * @type {Object<string, string>}
 */
const BRUSH_HINTS = {
    chords: 'Akkordnamen',
    stroke: 'Plektrumrichtung, Anschlagpfeil, Arpeggio, Ausblenden und Betonung',
    notes: 'Notenwerte, Saite, Bund und Effekte (Haltebögen, Hammer-on/Pull-off, Slides, ...)',
    text: 'Text über dem Schlag an Schlägen derselben Stelle',
    syllable: 'Silben an Schlägen derselben Stelle',
};

/**
 * Stelle eines Schlags in Ticks ab Songanfang.
 * @param {Beat} beat Schlag
 * @returns {number}
 */
function beatTick(beat) {
    return beat.voice.bar.masterBar.start + beat.playbackStart;
}

/**
 * Takt an einer Stelle.
 * @param {Score} score Noten
 * @param {number} tick Ticks ab Songanfang
 * @returns {import('../../types/alphatab').model.MasterBar}
 */
function masterBarAt(score, tick) {
    return score.masterBars.findLast(mb => mb.start <= tick) ?? score.masterBars[0];
}

/**
 * Dauer in Vierteln zum Anzeigen, z. B. "4 Viertel", "2,5 Viertel".
 * @param {number} ticks Ticks
 * @returns {string}
 */
function quarters(ticks) {
    return `${String(Math.round(ticks / edit.QUARTER_TICKS * 100) / 100).replace('.', ',')} Viertel`;
}

/**
 * Länge eines Bereichs in ganzen Takten und Rest, z. B. "4 Takte", "2 Takte und 3 Viertel", "1 Takt und 6 Achtel".
 * Der Rest steht im gröbsten Notenwert ab Viertel, der ihn ganz zählt.
 * @param {Score} score Noten
 * @param {number} from Anfang in Ticks ab Songanfang
 * @param {number} to Ende in Ticks ab Songanfang
 * @returns {string}
 */
function barsAndRest(score, from, to) {
    const full = score.masterBars.filter(mb => from <= mb.start && mb.start + mb.calculateDuration() <= to);
    const rest = to - from - full.reduce((sum, mb) => sum + mb.calculateDuration(), 0);
    const parts = full.length ? [`${full.length} ${full.length === 1 ? 'Takt' : 'Takte'}`] : [];
    if (rest) {
        const unit = [[1, 'Viertel'], [2, 'Achtel'], [4, 'Sechzehntel'], [8, 'Zweiunddreißigstel']]
            .find(([div]) => rest * div % edit.QUARTER_TICKS === 0);
        parts.push(unit ? `${rest * unit[0] / edit.QUARTER_TICKS} ${unit[1]}` : quarters(rest));
    }
    return parts.join(' und ');
}

/**
 * Eigenschaften eines Schlags für den Pinsel; nur die gewählten Arten sind gesetzt.
 * @typedef {Object} BrushBeat
 * @property {number} offset Stelle in Ticks ab dem ersten kopierten Schlag
 * @property {number} ticks Dauer
 * @property {string} [chord] Akkordname an dieser Stelle, leer ohne
 * @property {import('./notation.js').BrushStroke} [stroke] Anschlag
 * @property {import('./notation.js').BrushNotes} [notes] Notenwerte und Töne
 * @property {string} [text] Text über dem Schlag
 * @property {string} [syllable] Liedtext-Silbe
 */

/**
 * Was der Pinsel kopiert hat (Alt+C) und wie lang es ist (Ticks), gilt für alle Songs, solange die Seite offen ist.
 * @type {?{kinds: string[], beats: BrushBeat[], ticks: number}}
 */
let brush = null;

/**
 * Fehler, mit dem der Pinsel das Übertragen abbricht (applyBrush() nimmt die Änderung zurück und zeigt die Meldung).
 * @param {string} message Meldung für den Benutzer
 * @returns {Error}
 */
function brushConflict(message) {
    return Object.assign(new Error(message), {brushConflict: true});
}

/** Im Dialog "Pinsel" zuletzt gewählte Arten (anfangs alle). */
let brushKinds = BRUSH_KINDS.map(([key]) => key);

/** So viele Schritte hält "Rückgängig". */
const UNDO_MAX = 200;

/**
 * Hinweis für "Rückgängig" zu einer Änderung an ausgewählten Schlägen, z. B. "6 Schläge in Takt 3–5 geändert".
 * @param {Beat[]} beats Schläge (in der Reihenfolge der Noten)
 * @param {string} [what] was mit ihnen geschah
 * @returns {string}
 */
function beatsLabel(beats, what = 'geändert') {
    const first = beats[0].voice.bar.index + 1;
    const last = beats[beats.length - 1].voice.bar.index + 1;
    return `${beats.length} Schläge in Takt ${first === last ? first : `${first}–${last}`} ${what}`;
}

/** Innerhalb dieser Zeit (ms) ergeben zwei Ziffern einen zweistelligen Bund ("1", "2" = 12). */
const DIGIT_MS = 1000;

/** Breite, ab der die seitlichen Panels neben den Noten stehen statt darüber (wie in app.css). */
const WIDE_LAYOUT = '(min-width: 900px)';

/**
 * Anzeige-Einstellungen eines Notensystems, die der Player für die Ansicht setzt (applyStave()) und die alphaTab
 * mitschreiben würde; gespeichert werden sie so, wie sie in der Datei stehen (NoteEditor.writeTex()).
 */
const STAFF_FLAGS = ['showStandardNotation', 'showTablature', 'showSlash', 'showNumbered'];

/** Höchstzahl der Takte pro Zeile (Feld in der Leiste, wie LEADSHEET_BARS_PER_ROW_MAX in api/leadsheet.php). */
const BARS_PER_ROW_MAX = 12;

/** Einstellungen des Stylesheets für die Spurnamen (showTrackNames() in playback.js). */
const TRACK_NAME_STYLE = ['singleTrackTrackNamePolicy', 'multiTrackTrackNamePolicy', 'firstSystemTrackNameMode',
    'otherSystemsTrackNameMode', 'firstSystemTrackNameOrientation', 'otherSystemsTrackNameOrientation'];

/** So lange (ms) nach dem letzten Tastendruck im Liedtext werden die Noten neu gezeichnet. */
const LYRICS_MS = 300;

/** Tooltip des Knopfs neben "Liedtext-Silbe" (applyLyrics() mit reflow). */
const LYRICS_REFLOW_TITLE = 'Liedtext im Abschnitt neu zuordnen: eine Silbe je Note, der Reihe nach '
    + '(Lücken und gehaltene Silben gehen verloren, "_" lässt eine Note frei)';

/** So lange (ms) nach dem letzten Tastendruck im Liedtext rollt das Feld beim Abspielen nicht mit (man schreibt gerade). */
const LYRICS_TYPING_MS = 3000;

/** So viele Griffbilder passen im Dialog "Akkord" nebeneinander. */
const GRIPS_PER_ROW = 6;

/** So lange steht ein kurzer Hinweis unter der Werkzeugleiste mindestens (ms). */
const TOAST_MS = 2200;

/** Lesezeit je Zeichen eines Hinweises (ms): ein langer steht entsprechend länger. */
const TOAST_CHAR_MS = 70;

/** So lange steht ein Hinweis höchstens (ms), außer die Maus steht darauf. */
const TOAST_MAX_MS = 20000;

/** Speicherschlüssel für eingeklappte Panels (gilt für alle Songs). */
const PANELS_KEY = 'gitarrenbuch_editor_panels';

/** Kleinste Höhe des Inhalts im unteren Panel (unter der Kopfzeile, px). */
const BOTTOM_MIN_H = 60;

/** Höhe des Inhalts im unteren Panel, solange sie nicht gezogen wurde (px). */
const BOTTOM_DEFAULT_H = 200;

/** Größte Höhe des Inhalts im unteren Panel als Anteil der Fensterhöhe. */
const BOTTOM_MAX_SHARE = 0.7;

/** Kleinste Höhe des Textfelds im rechten Panel (px); darunter die Vorschau. */
const LYRICS_MIN_H = 80;

/** Kleinste Höhe der Vorschau im rechten Panel (px). */
const LYRICS_VIEW_MIN_H = 80;

/** Kleinste Breite des rechten Panels (px). */
const RIGHT_MIN_W = 260;

/** Größte Breite des rechten Panels als Anteil der Fensterbreite. */
const RIGHT_MAX_SHARE = 0.6;

/** Knöpfe für die Dauer: Notenwert (1 = Ganze, 4 = Viertel) → Zeichen der Notenschrift. */
const NOTE_GLYPHS = {
    1: GLYPHS.whole, 2: GLYPHS.half, 4: GLYPHS.quarter, 8: GLYPHS.eighth, 16: GLYPHS.sixteenth, 32: GLYPHS.thirtySecond,
};

/** Namen der Notenwerte für Tooltips. */
const NOTE_NAMES = {1: 'Ganze', 2: 'Halbe', 4: 'Viertel', 8: 'Achtel', 16: 'Sechzehntel', 32: 'Zweiunddreißigstel'};

/**
 * Knöpfe am Cursor (linkes Panel unter "Note"), in Gruppen: [Überschrift, [Symbol (HTML), Name mit Tastenkürzel
 * (SHORTCUTS), Befehl (NoteEditor.run())]]. Unter "Effekt" folgt die Reihe "Einfügen, löschen" (insertToolsHtml()).
 *
 * Nicht aus Guitar Pro übernommen (kein Knopf, aber was ein Song davon hat, bleibt beim Bearbeiten erhalten, denn
 * alphaTex speichert es): Fermate, Dynamik, Staccato, Let Ring, Palm Mute, Legato, Slap, Vorschlagsnoten, Einblenden,
 * Balken und Notenhals (setzt alphaTab selbst) und weitere, die kein Song verwendet (Flageolett, Tapping, Triller …).
 * Wiederholungszeichen, Volta-Klammern, Sprünge und Takt-Wiederholungszeichen gibt es nur ausgeschrieben (der Import
 * schreibt sie aus). Statt der Triolen-Feelings von Guitar Pro gibt es nur Shuffle (Werkzeugleiste), statt "Dead
 * Note" heißt es "Saite dämpfen".
 * @type {[string, [string, string, string][]][]}
 */
const EFFECTS = [
    ['Tonhöhe', [
        [glyph(GLYPHS.sharp, true), 'Kreuz (Strg+9)', 'sharp'], [glyph(GLYPHS.flat, true), 'Be (Strg+7)', 'flat'],
        [glyph(GLYPHS.natural, true), 'Auflösungszeichen (Strg+8)', 'natural'],
        [svgIcon('scaleUp'), 'Tonleiterschritt höher (Umschalt+↑); mit Alt ein Halbton (Alt+Umschalt+↑)', 'scaleUp'],
        [svgIcon('scaleDown'), 'Tonleiterschritt tiefer (Umschalt+↓); mit Alt ein Halbton (Alt+Umschalt+↓)',
            'scaleDown'],
        [svgIcon('chordUp'), 'Nächster Akkordton höher (Strg+Umschalt+↑)', 'chordUp'],
        [svgIcon('chordDown'), 'Nächster Akkordton tiefer (Strg+Umschalt+↓)', 'chordDown'],
    ]],
    ['Anschlag', [
        [glyph(GLYPHS.pickDown, true, 'smufl-pickdown'), 'Plektrum abwärts (Umschalt+D)', 'pickDown'],
        [glyph(GLYPHS.pickUp, true, 'smufl-pickup'), 'Plektrum aufwärts (Umschalt+U)', 'pickUp'],
        [svgIcon('brushDown'), 'Anschlag abwärts (Strg+D)', 'brushDown'],
        [svgIcon('brushUp'), 'Anschlag aufwärts (Strg+U)', 'brushUp'],
        [svgIcon('arpeggioDown'), 'Arpeggio abwärts (Strg+Umschalt+D)', 'arpeggioDown'],
        [svgIcon('arpeggioUp'), 'Arpeggio aufwärts (Strg+Umschalt+U)', 'arpeggioUp'],
        [svgIcon('accent'), 'Betonung (Akzent auf allen Noten des Schlags)', 'accent'],
        [svgIcon('fadeOut'), 'Ausblenden (Fade-out, z. B. am Schluss)', 'fadeOut'],
    ]],
    ['Effekt', [
        [svgIcon('hammer'), 'Hammer-on / Pull-off (H)', 'hammer'],
        [svgIcon('slide'), 'Slide (S)', 'slide'],
        [svgIcon('bend'), 'Bend (B): ½, full, 1½, aus', 'bend'],
        [svgIcon('vibrato'), 'Vibrato (V)', 'vibrato'],
        [svgIcon('ghost'), 'Ghost-Note (O); mit Auswahl an allen ausgewählten Schlägen', 'ghost'],
        [svgIcon('dead'), 'Dead-Note (X); mit Auswahl an allen ausgewählten Schlägen', 'dead'],
    ]],
];

/** Tooltip des Knopfs "Wiederholen" im Bearbeitungsmodus (applyLoop()). */
const LOOP_TITLE = 'Wiederholen: die ausgewählten Takte (Strg+Umschalt+←/→), ohne Auswahl der Takt am Cursor';

/** Befehle eines Knopfs mit gedrückter Alt-Taste (wie bei den Tastenkürzeln: Alt+Einfg, Alt+Umschalt+↑). */
const ALT_COMMANDS = {
    insertBeat: 'insertBeatAfter', insertBar: 'insertBarAfter', scaleUp: 'semitoneUp', scaleDown: 'semitoneDown',
};

/**
 * Auswahl des Instruments einer Spur im Dialog "Spuren" (INSTRUMENTS in notation.js, docs/Instrumente.md): Klang und
 * Notenlage zusammen; der Tooltip jedes Eintrags nennt Instrumente dieser Gruppe. Schlagzeug steht nur bei einer
 * Schlagzeugspur da und lässt sich nicht ändern.
 * @param {import('../../types/alphatab').model.Track} track Spur
 * @returns {string} HTML
 */
function instrumentSelect(track) {
    const current = edit.instrumentOf(track);
    const drums = current.key === 'drums';
    const options = edit.INSTRUMENTS.filter(i => drums ? i.key === 'drums' : i.key !== 'drums');
    return `<select data-track-field="instrument" data-track="${track.index}" aria-label="Instrument der Spur ${track.index + 1}"
    title="${escapeHtml(current.examples)}"${drums ? ' disabled' : ''}>${options.map(i =>
        `<option value="${i.key}" title="${escapeHtml(i.examples)}"${i === current ? ' selected' : ''}>${escapeHtml(i.name)}</option>`)
        .join('')}</select>`;
}

/** Höchstlänge der Notiz beim Speichern (wie NOTE_MAX in api/lib/file_store.php). */
const NOTE_MAX = 200;

/** Schlüssel im Browser für die letzten Änderungsnotizen: {slug: Notiz}. */
const NOTES_KEY = 'gitarrenbuch_editor_notes';

/**
 * Feld für die Änderungsnotiz (Dialoge "Speichern" und "Änderungen speichern?"), vorbelegt mit der letzten Notiz.
 * @param {string} slug Slug des Songs
 * @returns {string} HTML
 */
function noteFieldHtml(slug) {
    return `<div class="form-field"><input type="text" id="saveNote" maxlength="${NOTE_MAX}" autocomplete="off"
    placeholder="Änderungsnotiz" aria-label="Änderungsnotiz" value="${escapeHtml(lastNote(slug))}"></div>`;
}

/**
 * Letzte Änderungsnotiz eines Songs (gemerkt bei Speichern und Verwerfen, keepLastNote()).
 * @param {string} slug Slug des Songs
 * @returns {string} leer ohne Notiz
 */
function lastNote(slug) {
    try {
        return String(JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}')?.[slug] ?? '');
    } catch (err) {
        return '';
    }
}

/**
 * Merkt sich die Änderungsnotiz eines Songs (überschreibt die vorige); leer vergisst sie.
 * @param {string} slug Slug des Songs
 * @param {string} note Notiz
 * @returns {void}
 */
function keepLastNote(slug, note) {
    try {
        const notes = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}') ?? {};
        if (note) notes[slug] = note;
        else delete notes[slug];
        localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch (err) {
        // Ohne Speicher im Browser bleibt die Notiz nur bis zum Schließen des Dialogs.
    }
}

/**
 * Notiz aus dem Feld noteFieldHtml().
 * @returns {string} ohne Leerraum am Rand, leer ohne Feld
 */
function noteValue() {
    return /** @type {?HTMLInputElement} */ (document.getElementById('saveNote'))?.value.trim() ?? '';
}

/**
 * Bindet das Feld noteFieldHtml() an: Enter speichert (wie der Knopf).
 * @param {function(): void} save Speichern
 * @returns {void}
 */
function bindNoteField(save) {
    const input = document.getElementById('saveNote');
    input?.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        save();
    });
}

/** Tasten, die Panels ein- und ausklappen (wie Guitar Pro: F2 Palette): Taste → Seite. */
const PANEL_KEYS = {F2: 'left', F4: 'right', F8: 'bottom'};

/**
 * Eingeklappte Panels und Höhe des Textfelds im rechten Panel aus dem Browser.
 * @returns {{left?: boolean, right?: boolean, bottom?: boolean, bottomH?: number, lyricsH?: number, rightW?: number}} true = eingeklappt;
 *   bottomH: Höhe des Inhalts im unteren Panel in px; lyricsH: Höhe des Textfelds im rechten Panel in px (darunter die Vorschau); rightW: Breite des rechten Panels in px
 */
function loadCollapsed() {
    try {
        return JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}') ?? {};
    } catch (err) {
        return {};
    }
}

/**
 * Bearbeitungsmodus einer Liedansicht.
 */
export class NoteEditor {
    /**
     * @param {HTMLElement} songView Liedansicht (#songView)
     * @param {Player} player Player der Liedansicht
     * @param {{onClose: function(boolean): void, onSaved: function(Song): void}} callbacks onClose: ✕ (Bearbeiten
     *   beenden) wurde gewählt, mit true, wenn in der Sitzung gespeichert wurde (der Aufrufer ruft destroy() und lädt
     *   dann den Song neu); onSaved: nach dem Speichern von Noten, Akkorddatei oder Audioquelle, mit dem aktualisierten
     *   Lied
     */
    constructor(songView, player, {onClose, onSaved}) {
        /** Liedansicht. */
        this.songView = songView;
        /** Player der Liedansicht. */
        this.player = player;
        /** Rückruf für ✕ (Bearbeiten beenden). */
        this.onClose = onClose;
        /** Rückruf nach dem Speichern. */
        this.onSaved = onSaved;
        /**
         * Sync-Editor im unteren Panel (eingebettet), null, bis er geladen ist.
         * @type {?SyncEditor}
         */
        this.sync = null;
        /**
         * Ausgewählte Takte einer Spur (Strg+Umschalt+Pfeile, Strg+A), für Kopieren und Ausschneiden; null ohne Auswahl.
         * @type {?{track: number, anchor: number, from: number, to: number}}
         */
        this.selection = null;
        /**
         * Ausgewählte Schläge einer Spur (Umschalt+←/→), für Notenwert, Punktierung und Triole; null ohne Auswahl. Der Anker
         * ist der Schlag, an dem die Auswahl begann, der andere Rand der Cursor.
         * @type {?{track: number, anchor: {bar: number, beat: number}, from: {bar: number, beat: number},
         *   to: {bar: number, beat: number}}}
         */
        this.beatSelection = null;
        /** alphaTab-Modul (aus dem Player). */
        this.alphaTab = player.alphaTab;
        /**
         * Bearbeitete Noten, nach jeder Änderung neu eingelesen; null, bis sie geladen sind.
         * @type {?Score}
         */
        this.score = null;
        /** alphaTex der bearbeiteten Noten. */
        this.tex = '';
        /** alphaTex wie gespeichert, in der Form des Exporters (zum Vergleich: ungespeicherte Änderungen?). */
        this.savedTex = '';
        /** Ob in dieser Sitzung gespeichert wurde (dann lädt der Aufrufer beim Verlassen den Song neu). */
        this.saved = false;
        /**
         * Angaben für das Leadsheet (score.json), die alphaTex nicht kennt. Die
         * Tab-Stellen wandern mit, wenn Takte eingefügt, gelöscht oder ausgeschrieben werden oder sich Spuren ändern
         * (change(), unrollRepeats()); alles gehört zu jedem Schritt für "Rückgängig".
         * @type {import('./sheet.js').Sheet}
         */
        this.sheet = normalizeSheet(null);
        /** Angaben für das Leadsheet wie gespeichert (sheetJson()), zum Vergleich: ungespeicherte Änderungen? */
        this.savedSheet = '';
        /**
         * Spuren der Baustelle beim Öffnen (song.json); weichen sie beim Speichern ab (Spur umbenannt oder gelöscht), werden
         * sie nachgetragen.
         * @type {string[]}
         */
        this.wipAtLoad = [];
        /**
         * Ob Auge oder Lautsprecher im Dialog "Spuren" seit dem Speichern geändert wurden (dann speichert "Speichern" auch die
         * Vorgaben je Spur, siehe trackDefaults()).
         */
        this.viewChanged = false;
        /** Dialog "Leadsheet". */
        this.leadsheetTab = new LeadsheetTab(this);
        /**
         * Schritte für "Rückgängig" und "Wiederholen": Text, Angaben je Takt und Cursor vor bzw. nach der Änderung.
         * @type {UndoStep[]}
         */
        this.undoStack = [];
        /** @type {UndoStep[]} */
        this.redoStack = [];
        /**
         * Takt des letzten Schritts aus dem linken Panel ("Spur|Takt"): Weitere Änderungen dort im selben Takt gehören
         * zu diesem Schritt (spart Speicher, jeder Schritt hält den ganzen Text); null, wenn der letzte Schritt anders
         * entstand.
         * @type {?string}
         */
        this.mergeKey = null;
        /** Ob die laufende Änderung aus dem linken Panel "Am Cursor" kommt (Klick oder Feld, siehe onClick). */
        this.panelEdit = false;
        /**
         * Cursor.
         * @type {EditPosition}
         */
        this.pos = {track: 0, bar: 0, beat: 0, string: 1};
        /**
         * Angezeigte Spuren (Indizes, in der angezeigten Reihenfolge).
         * @type {number[]}
         */
        this.trackIndexes = [];
        /**
         * Modell und Spuren der Ansicht des Players, zum Wiederherstellen beim Verlassen.
         * @type {?{score: Score, tracks: number[]}}
         */
        this.display = null;
        /**
         * Erste Ziffer eines Bunds, solange eine zweite folgen kann.
         * @type {?{value: number, time: number, pos: EditPosition}}
         */
        this.digit = null;
        /**
         * Meldet sich von renderFinished ab.
         * @type {?function(): void}
         */
        this.offRender = null;
        /**
         * Meldet sich von playerStateChanged ab (Abspielposition beim Anhalten zurück an den Cursor).
         * @type {?function(): void}
         */
        this.offStopped = null;
        /** Cursor im Notenblatt: Spalte des Schlags und Kästchen der Saite. */
        this.cursorEl = null;
        /**
         * Eingefügte Elemente (Werkzeugleiste und Panels), zum Entfernen.
         * @type {HTMLElement[]}
         */
        this.parts = [];
        /**
         * Beobachtet die Höhen von Leiste und unterem Panel.
         * @type {?ResizeObserver}
         */
        this.resize = null;
        /**
         * Zeitgeber des Hinweises.
         * @type {number}
         */
        this.toastTimer = 0;
        /**
         * Zeitgeber für den Liedtext beim Schreiben (0, wenn nichts aussteht).
         * @type {number}
         */
        this.lyricsTimer = 0;
        /** Ob der Liedtext gerade bearbeitet wird (weitere Änderungen gehören zum selben Schritt für "Rückgängig"). */
        this.lyricsTyping = false;
        /** alphaTex vor dem Schritt, in dem der Liedtext gerade bearbeitet wird; von dort aus wird verteilt. */
        this.lyricsBase = '';
        /**
         * Gewählte Spur für Akkorde bzw. Text, solange der Song keine hat (Radiobuttons im Dialog "Spuren", siehe
         * contentTrack()). Mit Inhalt gilt die Spur, in der er steht.
         * @type {{chords: ?number, lyrics: ?number}}
         */
        this.contentChoice = {chords: null, lyrics: null};
        /**
         * Rot markierte Abschnitte im Liedtext-Feld (markLyrics()).
         * @type {{line: number, lines: number}[]}
         */
        this.lyricsRed = [];
        /**
         * Silbe am Cursor der Noten im Liedtext-Feld (Zeichenbereich), null ohne.
         * @type {?{from: number, to: number}}
         */
        this.lyricsCur = null;
        /**
         * Schlag mit der Silbe, die beim Abspielen zuletzt gezeigt wurde (followPlayback()), null ohne.
         * @type {?Beat}
         */
        this.playedLyric = null;
        /** Zeit des letzten Tastendrucks im Liedtext-Feld (ms, Date.now()), 0 ohne. */
        this.lyricsInputAt = 0;
        /**
         * Tempo der Audiospur je Takt (recordingTempoRegion()), gemerkt für einen Stand der Noten (fillBarSignature()).
         * @type {?{tex: string, bars: Map<number, ?import('./notation.js').TempoRegion>}}
         */
        this.tempoRegions = null;
        /**
         * Abschnitte, deren Tempo nicht zur Audiospur passt (showTempoMismatches()).
         * @type {import('./notation.js').TempoRegion[]}
         */
        this.tempoMismatchList = [];
        /**
         * Längen von Partitur und Audiospur im Panel "Audio" (renderAudioSource()).
         * @type {?HTMLElement}
         */
        this.audioLengths = null;
        /**
         * Ob der Liedtext Silben ohne Schlag hat: Dann bleibt der Text im Feld stehen (mit den roten Abschnitten), statt
         * aus den Noten neu gefüllt zu werden, bis er passt oder "Rückgängig" ihn zurücksetzt.
         */
        this.lyricsOverflow = false;
        /**
         * Anzeige-Einstellungen je Notensystem, wie sie in der Datei stehen (vor applyStave(), siehe writeTex()).
         * @type {WeakMap<object, boolean[]>}
         */
        this.fileFlags = new WeakMap();
        /**
         * Kurzname der Spuren und Stylesheet für die Spurnamen, wie sie in der Datei stehen (siehe writeTex()).
         * @type {WeakMap<object, string>}
         */
        this.fileShortNames = new WeakMap();
        /** Werte von TRACK_NAME_STYLE in der Datei. */
        this.fileStyle = [];
    }

    /**
     * Ob es ungespeicherte Änderungen gibt.
     * @returns {boolean}
     */
    get dirty() {
        return !!this.score && (this.tex !== this.savedTex || this.sheetJson() !== this.savedSheet || this.viewChanged);
    }

    /**
     * Vorgaben je Spur, wie sie jetzt eingestellt sind: angezeigt (Auge) und stumm (Lautsprecher).
     * @returns {import('./notation.js').TrackDefault[]} in der Reihenfolge der Spuren
     */
    trackDefaults() {
        return this.score.tracks.map(t => ({
            show: this.trackIndexes.includes(t.index), mute: this.player.trackMix(t.index).mute,
        }));
    }

    /**
     * Angaben für das Leadsheet in der gespeicherten Form.
     * @returns {string} JSON
     */
    sheetJson() {
        return JSON.stringify(normalizeSheet(this.sheet));
    }

    /**
     * Übernimmt die Angaben für das Leadsheet (vom Server bzw. aus einem Schritt für "Rückgängig").
     * @param {string} json JSON wie sheetJson()
     * @returns {void}
     */
    setSheet(json) {
        this.sheet = normalizeSheet(JSON.parse(json));
        this.player.setBarsPerRow(this.sheet.barsPerRow, false);
    }

    /**
     * Ändert nur die Angaben für das Leadsheet (Patterns, Tab-Stellen), als ein Schritt für "Rückgängig".
     * @param {function(import('./sheet.js').Sheet): *} fn Änderung; darf die Angaben direkt ändern
     * @param {string} [label] was sich geändert hat (Tooltip von Rückgängig)
     * @returns {void}
     */
    changeSheet(fn, label = 'Leadsheet geändert') {
        const before = this.sheetJson();
        fn(this.sheet);
        if (this.sheetJson() === before) {
            this.leadsheetTab.renderList();
            return;
        }
        this.pushUndo(this.snapshot(before), label);
        this.player.setBarsPerRow(this.sheet.barsPerRow);
        this.updateState();
        this.leadsheetTab.render();
    }

    /**
     * Schaltet in den Bearbeitungsmodus: Leisten und Panels einfügen (links "Am Cursor", rechts "Liedtext", unten "Audio";
     * Spuren und Leadsheet öffnen als Dialoge aus der Werkzeugleiste). Die feste Leiste zeigt dann nur noch die
     * Werkzeugleiste (Zurück, aktueller Akkord, Stift und Menü sind ausgeblendet). Bearbeitet wird mit Tabs: Aus
     * "Noten" oder "Chords" geht es in "Noten + Tabs"; die Ansicht unten bietet nur "Tabs" und "Noten + Tabs".
     * @returns {void}
     */
    open() {
        const player = this.player;
        if (!['tab', 'both'].includes(player.prefs.view)) player.setView('both');
        const songbar = this.songView.querySelector('.songbar');
        const collapsed = loadCollapsed();
        // Auf schmalen Bildschirmen liegen die Seiten-Panels über den Noten und sind deshalb anfangs zu.
        const narrow = !matchMedia(WIDE_LAYOUT).matches;

        const toolbar = this.addPart(songbar, 'div', 'edit-toolbar', this.toolbarHtml());
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Bearbeiten');
        this.addPart(this.songView, 'aside', 'edit-panel edit-left', this.cursorPanelHtml(), narrow || collapsed.left);
        const right = this.addPart(this.songView, 'aside', 'edit-panel edit-right', this.lyricsPanelHtml(), narrow || collapsed.right);
        const bottom = this.addPart(this.songView, 'section', 'edit-bottom', this.bottomHtml(), collapsed.bottom);
        this.setBottomHeight(collapsed.bottomH ?? BOTTOM_DEFAULT_H);
        bottom.querySelector('.edit-bottom-resize').addEventListener('pointerdown', e => this.startBottomResize(/** @type {PointerEvent} */ (e)));
        this.setLyricsHeight(collapsed.lyricsH);
        this.setRightWidth(collapsed.rightW);
        right.querySelector('.edit-right-resize').addEventListener('pointerdown', e => this.startRightResize(/** @type {PointerEvent} */ (e)));
        right.querySelector('.elyrics-split').addEventListener('pointerdown', e => this.startLyricsResize(/** @type {PointerEvent} */ (e)));
        this.addPart(this.songView, 'div', 'edit-toast', '').setAttribute('role', 'status');
        this.audioLengths = /** @type {HTMLElement} */ (bottom.querySelector('[data-audio-lengths]'));
        renderAudioSource(/** @type {HTMLElement} */ (bottom.querySelector('[data-audio-source]')),
            () => findSong(this.player.slug), saved => {
                this.saved = true;
                this.onSaved(saved);
            }, this.audioLengths, () => this.score ? edit.scoreDuration(this.alphaTab, this.score) : null);

        this.songView.classList.add('editing');
        this.resize = new ResizeObserver(() => this.measure());
        this.resize.observe(songbar);
        this.resize.observe(this.part('edit-bottom'));
        this.measure();

        this.onClick = e => {
            const target = /** @type {HTMLElement} */ (e.target);
            this.fromPanel(target, () => this.handleClick(target, e.altKey));
            // Ein mit der Maus gedrückter Knopf gibt den Fokus wieder ab: Sonst zeichnet der Browser beim nächsten Tastendruck
            // (z. B. "-" für länger) einen Fokusrahmen um ihn. Mit der Tastatur (detail 0) bleibt der Fokus.
            if (e.detail) target.closest('button')?.blur();
        };
        for (const part of this.parts) part.addEventListener('click', this.onClick);
        // Ein Klick außerhalb schließt die Menüs der Leiste.
        this.onPointerDown = e => {
            if (!/** @type {HTMLElement} */ (e.target).closest?.('.etool-menu')) this.toggleMenu(null);
        };
        document.addEventListener('pointerdown', this.onPointerDown);
        this.onKey = e => this.handleKey(e);
        document.addEventListener('keydown', this.onKey);
        // Abspielen beginnt am Cursor. Nach jeder Änderung zeichnet alphaTab neu und stellt die Position an den Anfang;
        // deshalb gilt der Cursor erst beim Drücken von "Play" (vor dem Handler des Players, daher die Capture-Phase).
        this.onPlay = () => {
            this.applyLoop();
            this.seekToCursor();
        };
        this.player.el.play.addEventListener('click', this.onPlay, true);
        // Angehalten geht die Abspielposition gleich zurück an den Cursor (dort beginnt das nächste Abspielen). Sonst
        // stünde die Linie im Sync-Editor an der Stelle des Anhaltens und spränge erst beim nächsten "Play" zurück.
        this.offStopped = this.player.api.playerStateChanged.on(e => {
            if (e.state !== 1) setTimeout(() => this.seekToCursor());
        });
        // Wiederholen beim Bearbeiten: die ausgewählten Takte bzw. der Takt am Cursor (applyLoop()), nicht per Klick in
        // die Noten (der setzt den Cursor). Beim Öffnen aus.
        const loop = this.player.el.loop;
        if (this.player.api.isLooping) loop.click();
        loop.title = LOOP_TITLE;
        this.onFieldChange = e => {
            const input = /** @type {HTMLInputElement} */ (e.target);
            this.fromPanel(input, () => this.applyField(input));
        };
        this.part('edit-left').addEventListener('change', this.onFieldChange);
        this.part('edit-toolbar').addEventListener('change', this.onFieldChange);
        this.onFieldEnter = e => this.leaveFieldOnEnter(e);
        this.part('edit-left').addEventListener('keydown', this.onFieldEnter);
        this.part('edit-toolbar').addEventListener('keydown', this.onFieldEnter);
        // Liedtext: beim Schreiben (kurz nach dem letzten Tastendruck) in die Noten, ein Schritt für "Rückgängig" je
        // Bearbeitung des Felds.
        const lyrics = /** @type {HTMLTextAreaElement} */ (this.part('edit-right').querySelector('[data-lyrics]'));
        lyrics.addEventListener('input', () => {
            this.lyricsInputAt = Date.now();
            this.showChordFileButton();
            clearTimeout(this.lyricsTimer);
            this.lyricsTimer = window.setTimeout(() => this.applyLyrics(), LYRICS_MS);
        });
        lyrics.addEventListener('blur', () => {
            if (this.lyricsTimer) {
                clearTimeout(this.lyricsTimer);
                this.applyLyrics();
            }
            this.lyricsTyping = false;
            this.fillLyrics();
        });
        // Die roten Markierungen liegen hinter dem Feld und rollen mit.
        lyrics.addEventListener('scroll', () => {
            this.part('edit-right').querySelector('.elyrics-marks').scrollTop = lyrics.scrollTop;
        });
        // Noten und Vorschau folgen dem Cursor im Feld (Klick, Pfeil-, Bild-, Pos1- und Ende-Taste).
        lyrics.addEventListener('click', () => this.followLyricsCaret());
        lyrics.addEventListener('keyup', e => {
            if (/^(Arrow|Page|Home$|End$)/.test(e.key)) this.followLyricsCaret();
        });
        void this.load().catch(err => this.toast('Noten konnten nicht geladen werden: ' + err.message));
        this.relayout();
    }

    /**
     * Fügt ein Element des Bearbeitungsmodus ein.
     * @param {HTMLElement} parent Elternelement
     * @param {string} tag Tag
     * @param {string} cls Klassen
     * @param {string} html Inhalt
     * @param {boolean} [collapsed] eingeklappt
     * @returns {HTMLElement} das Element
     */
    addPart(parent, tag, cls, html, collapsed = false) {
        const el = document.createElement(tag);
        el.className = cls;
        el.innerHTML = html;
        el.classList.toggle('collapsed', !!collapsed);
        parent.append(el);
        this.parts.push(el);
        return el;
    }

    /**
     * Eingefügtes Element nach seiner Klasse.
     * @param {string} cls Klasse
     * @returns {HTMLElement}
     */
    part(cls) {
        return this.parts.find(p => p.classList.contains(cls));
    }

    /**
     * Werkzeugleiste: Speichern, Rückgängig, Wiederholen | Dauer | Punktierung, Triole, Pause,
     * Haltebogen | Schlag und Takt einfügen und löschen | Hilfe, Schließen.
     * @returns {string} HTML
     */
    toolbarHtml() {
        return `
      <div class="egroup">
        ${todoButton(svgIcon('history'), 'Verlauf: frühere gespeicherte Stände der Noten ansehen und laden', '', 'history')}
        ${todoButton(svgIcon('save'), 'Speichern (Strg+S)', '', 'save')}
        ${todoButton(svgIcon('undo'), 'Rückgängig (Strg+Z)', '', 'undo')}
        ${todoButton(svgIcon('redo'), 'Wiederholen (Strg+Y)', '', 'redo')}
      </div>
      <div class="egroup">
        ${todoButton(svgIcon('upload'), 'Uploads: hochgeladene Dateien mit Quelle und Beschreibung', '', 'uploads')}
      </div>
      <div class="egroup">
        ${todoButton(svgIcon('tracks'), 'Spuren: anzeigen, hören, benennen, ordnen, hinzufügen', '', 'tracks')}
      </div>
      <div class="egroup">
        ${todoButton(svgIcon('feelStraight', 52, 60),'Shuffle: Achtel-Triolen-Feeling im ganzen Song ein- oder ausschalten (Strg+/)',
            'ebtn-shuffle', 'tripletFeel')}
        ${todoButton(svgIcon('timing'), 'Metrum umschreiben: Notenwerte, Tempo, Taktart und Takte umrechnen', '', 'timing')}
      </div>
      <div class="egroup egroup-song">
        <label class="etool-field"><span>Tonart</span>${select(KEY_NAMES, 'data-song="key" title="Tonart des ganzen Songs"')}</label>
        <span class="etool-keyhint" data-key-hint hidden>!</span>
        ${todoButton(svgIcon('transpose'), 'Transponieren: Halbtöne, Capo und Tuning ändern', '', 'transpose')}
        <span class="etool-info" data-song-info></span>
      </div>
      <div class="egroup egroup-song">
        <label class="etool-field" title="Takte pro Zeile, gezählt ab jedem Abschnitt">
          <span>Takte pro Zeile</span>
          <input type="number" min="1" max="${BARS_PER_ROW_MAX}" placeholder="auto" data-per-row aria-label="Takte pro Zeile">
        </label>
        ${todoButton(svgIcon('leadsheet'), 'Leadsheet: Patterns, Tab-Stellen, Links und Vorschau des Blatts', '', 'leadsheet')}
      </div>
      <div class="egroup">
        <div class="etool-menu">
          <button type="button" class="ebtn" data-action="cleanMenu" aria-haspopup="true" aria-expanded="false"
            title="Bereinigen" aria-label="Bereinigen">${svgIcon('clean')}</button>
          <div class="speed-pop view-pop etool-pop" data-pop="clean" hidden>
            <button type="button" data-cmd="tidyChords"
              title="Überflüssige Akkorde entfernen; fehlende am Abschnittsanfang setzen">Akkorde bereinigen</button>
            <button type="button" data-cmd="checkChordNotes"
              title="Prüft, ob die Noten der Akkordspur zu ihren Akkorden passen">Griffe prüfen</button>
          </div>
        </div>
      </div>
      <div class="egroup edit-end">
        <label class="etool-field" title="Springe zu Takt (Alt+G)"><span>Gehe zu</span>
          <input type="number" min="1" placeholder="Takt" data-goto aria-label="Gehe zu Takt"></label>
        <div class="etool-menu">
          <button type="button" class="ebtn" data-action="sectionMenu" aria-haspopup="true" aria-expanded="false"
            title="Springe zu Abschnitt (Alt+Umschalt+G)" aria-label="Springe zu Abschnitt">
            ${svgIcon('sections')}</button>
          <div class="speed-pop view-pop etool-pop etool-pop-end" data-pop="sections" hidden></div>
        </div>
        <button type="button" class="ebtn ebtn-help" data-action="help" title="Tastenkürzel (?)"
          aria-label="Tastenkürzel">?</button>
        <button type="button" class="edit-close" data-action="done" title="Bearbeiten beenden"
          aria-label="Bearbeiten beenden">&#10005;</button>
      </div>
    `;
    }

    /**
     * Reihe "Einfügen, löschen" im linken Panel (unter "Effekt"): Schläge und Takte einfügen bzw. löschen, Pinsel. Mit
     * Alt fügen die Knöpfe rechts neben dem Cursor ein (ALT_COMMANDS).
     * @returns {string} HTML
     */
    insertToolsHtml() {
        return `<h4>Einfügen, löschen</h4>
        <div class="etools">
          ${todoButton(svgIcon('insertBeat'),
            'Schlag links neben dem Cursor einfügen (Einfg); mit Alt rechts daneben (Alt+Einfg)', '', 'insertBeat')}
          ${todoButton(svgIcon('deleteBeat'), 'Schlag löschen (Entf auf einem leeren oder ausgewählten Schlag)', '',
            'deleteBeat')}
          ${todoButton(svgIcon('insertBar'),
            'Takt links neben dem Cursor einfügen (Strg+Einfg); mit Alt rechts daneben (Strg+Alt+Einfg)', '',
            'insertBar')}
          ${todoButton(svgIcon('deleteBar'), 'Takt löschen (Strg+Entf)', '', 'deleteBar')}
          ${todoButton(svgIcon('paintBrush'), 'Aktuelle Auswahl kopieren (Alt+C)', '', 'brush')}
          ${todoButton(svgIcon('paintRoller'), 'Kopierte Auswahl übertragen (Alt+V)', '', 'brushApply')}
        </div>`;
    }

    /**
     * Linkes Panel "Am Cursor" (wie die Palette in Guitar Pro links), alles, was den Schlag bzw. die Note betrifft:
     * oben "Note" (Notenwert, Triole, Pause; darunter Punktierung und Haltebogen), Tonhöhe, Anschlag, Effekt, Schläge
     * und Takte einfügen/löschen, Taktart und Tempo (ab dem Takt am Cursor), Abschnitt, Akkord, Text über dem Schlag,
     * zuletzt die Silbe. Die Leiste enthält, was am ganzen Song
     * hängt (Tonart, Shuffle, Capo, Tuning), dazu Speichern, Rückgängig, Hilfe, ✕.
     * @returns {string} HTML
     */
    cursorPanelHtml() {
        const durations = Object.entries(NOTE_GLYPHS).map(([value, sign]) =>
            `<button type="button" class="ebtn ebtn-note" data-duration="${value}" aria-pressed="${value === '4'}"
        title="${NOTE_NAMES[value]} (+ kürzer, - länger)">${glyph(sign)}</button>`).join('');
        return `
      ${this.panelHead('Am Cursor', 'left')}
      <div class="edit-panel-body">
        <h4>Note</h4>
        <div class="etools" role="group" aria-label="Dauer">${durations}
          ${todoButton('3', 'Triole (/)', '', 'triplet')}
          ${todoButton(glyph(GLYPHS.restQuarter, true), 'Pause (R)', 'ebtn-note', 'rest')}
        </div>
        <div class="etools">
          ${todoButton(glyph(GLYPHS.quarter + GLYPHS.dot), 'Punktiert (.)', 'ebtn-note', 'dot')}
          ${todoButton(glyph(GLYPHS.quarter + GLYPHS.dot + GLYPHS.dot), 'Doppelt punktiert (Strg+.)', 'ebtn-note', 'dot2')}
          ${todoButton(glyph(GLYPHS.quarter + GLYPHS.tie + GLYPHS.quarter), 'Haltebogen (L)', 'ebtn-note ebtn-wide', 'tie')}
        </div>
        ${EFFECTS.map(([group, items]) => `
          <h4>${escapeHtml(group)}</h4>
          <div class="effect-grid">${items.map(([label, title, cmd]) => todoButton(label, title, '', cmd)).join('')}</div>
          ${group === 'Effekt' ? this.insertToolsHtml() : ''}
        `).join('')}
        ${field('Takt', `<span class="etakt">${todoButton(svgIcon('anacrusis'), 'Auftakt (unvollständiger Takt)', '',
            'anacrusis')}<input type="text" data-song="ts" list="esongSignatures" placeholder="4/4"
          aria-label="Taktart" title="Taktart ab diesem Takt bis zum nächsten Wechsel"><datalist id="esongSignatures">${
            TIME_SIGNATURES.map(t => `<option value="${t}">`).join('')}</datalist><span class="efield-row">${
            num(20, 300, 'step="1" data-song="tempo" aria-label="Tempo" title="Tempo ab diesem Takt bis zum nächsten Wechsel"')} BPM
          <span class="etool-keyhint etool-tempohint" data-tempo-hint hidden>!</span></span></span>`)}
        ${field('Abschnitt (Umschalt+Einfg)', `<span class="eclearable"><input type="text" data-bar="section"
          list="ebarSections" placeholder="z. B. Verse"><button type="button" class="eclear" data-clear-section
          aria-label="Abschnitt entfernen" title="Abschnitt entfernen">×</button></span>
          <datalist id="ebarSections"></datalist>`)}
        <div class="efield echord">
          <label for="eChordSelect">Akkord (A)</label>
          <div class="echord-row">
            <select id="eChordSelect" data-chord-select aria-label="Akkord am Schlag"></select>
            <span class="ebtn-group">
              <button type="button" class="ebtn" data-chord-button data-cmd="chordNew" data-todo="Neuer Akkord mit Griff …"
                title="Neuer Akkord mit Griff …" aria-label="Neuer Akkord mit Griff …">+</button>
              ${todoButton(svgIcon('chordDetect'), 'Passenden Akkord erkennen und einfügen', '', 'chordDetect')}
            </span>
          </div>
        </div>
        ${field('Text über dem Schlag (T)', '<input type="text" data-field="text" placeholder="z. B. Picking Pattern">')}
        ${field('Liedtext-Silbe (Umschalt+L)', `<span class="echord-row"><input type="text" data-field="syllable"
          placeholder="z. B. ja" title="Silbe an dieser Stelle, in der Textspur"><span class="ebtn-group">${
            todoButton(svgIcon('syllableFromLeft'), 'Linke Silbe auf diesen Schlag ziehen', '', 'syllableFromLeft')}${
            todoButton(svgIcon('syllableFromRight'), 'Rechte Silbe auf diesen Schlag ziehen', '', 'syllableFromRight')}<button
          type="button" class="ebtn" data-cmd="lyricsReflow" title="${LYRICS_REFLOW_TITLE}"
          aria-label="${LYRICS_REFLOW_TITLE}">${svgIcon('reload')}</button></span></span>`)}
      </div>`;
    }

    /**
     * Rechtes Panel "Liedtext": oben das Textfeld, darunter die Vorschau "Text & Akkorde"; die Linie dazwischen
     * lässt sich ziehen (startLyricsResize()).
     * @returns {string} HTML
     */
    lyricsPanelHtml() {
        return `
      <div class="edit-right-resize" title="Breite ändern (ziehen)" aria-hidden="true"></div>
      ${this.panelHead('Liedtext', 'right')}
      <div class="edit-panel-body elyrics">
        <div class="elyrics-edit">
          <div class="elyrics-tools" data-chord-tools hidden>
            ${todoButton('Chord-Datei importieren', 'ChordPro oder Akkord-über-Text', 'ebtn-text',
            'chordFile')}
          </div>
          <div class="elyrics-wrap">
            <div class="elyrics-marks" aria-hidden="true"></div>
            <textarea rows="4" data-lyrics spellcheck="false"
              placeholder="Liedtext. Silben mit Bindestrich trennen (Lie-der-buch).
Jedes Leerzeichen und jeder Bindestrich geht zum nächsten Schlag, ein einzelnes _ lässt einen Schlag aus,
mir_zu setzt zwei Wörter auf einen Schlag. [Verse] usw. sind die Abschnitte."></textarea>
          </div>
        </div>
        <div class="elyrics-split" role="separator" aria-orientation="horizontal" title="Höhe ändern (ziehen)"></div>
        <div class="elyrics-view" data-lyrics-view aria-label="Vorschau Text &amp; Akkorde"></div>
      </div>`;
    }

    /**
     * Unteres Panel "Audio": Quelle der Audiodatei und Sync-Editor, mit Statuszeile ("Takt zu lang/kurz"). Die Höhe lässt sich ziehen (startBottomResize()); die Wellenform passt sich an.
     * @returns {string} HTML
     */
    bottomHtml() {
        return `
      <div class="edit-bottom-resize" title="Höhe ändern (ziehen)" aria-hidden="true"></div>
      <div class="edit-bottom-head">
        <span class="edit-panel-title">Audio${findSong(this.player.slug)?.wip?.audio ? ` ${edit.WIP_MARK}` : ''}</span>
        <button type="button" class="etool-keyhint etool-audiohint" data-action="tempoHint" hidden>!</button>
        <div class="edit-status">Noten werden geladen …</div>
        <button type="button" class="ebtn ebtn-collapse" data-collapse="bottom" title="Ein-/Ausklappen (F8)"
          aria-label="Unteres Panel ein- oder ausklappen"></button>
      </div>
      <div class="edit-bottom-body">
        <div class="eaudio" data-audio>
          <div class="eaudio-head">
            <div class="eaudio-source" data-audio-source></div>
            <span class="lengths" data-audio-lengths></span>
          </div>
          <div class="eaudio-sync" data-audio-sync><p class="efield-hint">Audiospur wird geladen …</p></div>
        </div>
      </div>`;
    }

    /**
     * Inhalt des Dialogs "Leadsheet": links Patterns, Tab-Stellen und Links (LeadsheetTab.renderList()), rechts die Vorschau
     * des Blatts (renderPreview()).
     * @returns {string} HTML
     */
    leadsheetDialogHtml() {
        return `
      <div class="els-list"></div>
      <div class="els-side">
        <div class="els-preview" aria-label="Vorschau Leadsheet"><div class="ls-page"></div></div>
        <div class="els-foot">
          <div class="els-fit efield-hint" aria-live="polite"></div>
          <button type="button" class="ebtn ebtn-text" data-ls-action="compare"
            title="Zwei Abschnitte nebeneinander, Unterschiede markiert; eine Fassung für beide übernehmen">
            Vergleichen …</button>
          <button type="button" class="ebtn ebtn-text" data-ls-action="print"
            title="Das Blatt drucken, wie die Vorschau es zeigt (auch als PDF)">Drucken</button>
        </div>
      </div>`;
    }

    /**
     * Öffnet einen Dialog des Bearbeitungsmodus (Spuren, Leadsheet). Seine Knöpfe und Felder arbeiten wie die der Panels;
     * er legt sich über die Noten, deshalb gelten die Tasten des Editors darunter nicht.
     * @param {string} title Überschrift
     * @param {string} cls Klasse des Inhalts (auch Kennung für ihn, z. B. "etracks-dialog")
     * @param {string} html Inhalt
     * @returns {HTMLElement} der Inhalt
     */
    openEditDialog(title, cls, html) {
        openOverlay(`<h2>${escapeHtml(title)}</h2><div class="edit-dialog ${cls}">${html}</div>`);
        const box = /** @type {HTMLElement} */ (document.querySelector(`.sheet .${cls}`));
        box.addEventListener('click', this.onClick);
        box.addEventListener('change', this.onFieldChange);
        return box;
    }

    /**
     * Dialog "Spuren": je Spur Zeigen, Hören, Name, Akkorde und Text, Instrument und Knöpfe (renderTracks()).
     * @returns {void}
     */
    openTracksDialog() {
        const box = this.openEditDialog('Spuren', 'etracks-dialog', `<div class="etrack-list"></div>
      <div class="struct-actions etrack-close"><button class="btn" type="button" data-close-dialog>Schließen</button></div>`);
        box.querySelector('[data-close-dialog]').addEventListener('click', closeOverlay);
        // Nach einem Dialog darüber (z. B. Spur importieren) steht die Liste so, wie die Noten jetzt sind.
        box.addEventListener('overlayshow', () => this.renderTracks());
        this.renderTracks();
    }

    /**
     * Dialog "Leadsheet" (LeadsheetTab): Eingaben und Vorschau des Blatts.
     * @returns {void}
     */
    openLeadsheetDialog() {
        const box = this.openEditDialog('Leadsheet', 'etab-leadsheet', this.leadsheetDialogHtml());
        box.addEventListener('overlayshow', () => this.leadsheetTab.render());
        this.leadsheetTab.render();
    }

    /**
     * Füllt Liedtext, Leadsheet und Spuren und die Auswahllisten links (Abschnitte, Akkorde des Songs) aus den
     * bearbeiteten Noten (nach jeder Änderung). Ein Feld, in dem gerade geschrieben wird, bleibt stehen. Leadsheet und
     * Spuren sind Dialoge, gefüllt wird, was offen ist.
     * @returns {void}
     */
    renderSongPanels() {
        this.fillLyrics();
        this.leadsheetTab.render();
        this.fillSectionNames();
        this.fillChordSelect();
        this.renderTracks();
    }

    /**
     * Zeichnet die Liste im Dialog "Spuren" neu, falls er offen ist (nicht, während in einem ihrer Felder geschrieben wird).
     * @returns {void}
     */
    renderTracks() {
        const list = document.querySelector('.sheet .etrack-list');
        if (!this.score || !list || list.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) return;
        const shown = new Set(this.trackIndexes);
        // Namensliste: die üblichen Namen, dazu alle aus der Bibliothek und dem Song (unübersetzt, siehe notation.js).
        const names = [...new Set([...TRACK_NAMES, ...knownTracks(), ...this.score.tracks.map(t => t.name.trim())])]
            .filter(Boolean);
        const chordsAt = this.contentTrack('chords');
        const lyricsAt = this.contentTrack('lyrics');
        const last = this.score.tracks.length - 1;
        list.innerHTML = `
      <datalist id="etrackNames">${names.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
      <div class="etrack etrack-head"><span></span><span>Name</span>
        <span title="Spur, in der die Akkorde stehen">Akkorde</span>
        <span title="Spur, in der der Liedtext steht">Text</span>
        <span title="Klang der Spur">Instrument</span><span></span></div>
      ${this.score.tracks.map(track => {
            const i = track.index;
            return `
          <div class="etrack">
            <span class="etrack-vis">
              <button type="button" class="mix-icon" data-show-track="${i}" aria-pressed="${shown.has(i)}"
                aria-label="Spur ${i + 1} anzeigen" title="Spur in den Noten anzeigen">${eyeIcon(shown.has(i))}</button>
              <button type="button" class="mix-icon" data-track-audible="${i}"
                aria-pressed="${!this.player.trackMix(i).mute}" aria-label="Spur ${i + 1} hören"
                title="Spur hören (sonst stumm)">${speakerIcon(!this.player.trackMix(i).mute)}</button>
            </span>
            <input type="text" data-track-field="name" data-track="${i}" list="etrackNames"
              value="${escapeHtml(track.name)}" placeholder="${escapeHtml(trackName(track))}"
              aria-label="Name der Spur ${i + 1}">
            <input type="radio" name="etrackChords" data-content="chords" data-track="${i}"
              ${i === chordsAt ? ' checked' : ''} aria-label="Akkorde in Spur ${i + 1}"
              title="Akkorde in dieser Spur speichern">
            <input type="radio" name="etrackLyrics" data-content="lyrics" data-track="${i}"
              ${i === lyricsAt ? ' checked' : ''} aria-label="Liedtext in Spur ${i + 1}"
              title="Liedtext in dieser Spur speichern">
            ${instrumentSelect(track)}
            <span class="etrack-buttons">
              <button type="button" class="ebtn" data-cmd="trackUp" data-track="${i}"
                title="Spur nach oben"${i ? '' : ' disabled'}>↑</button>
              <button type="button" class="ebtn" data-cmd="trackDown" data-track="${i}"
                title="Spur nach unten"${i < last ? '' : ' disabled'}>↓</button>
              <button type="button" class="ebtn" data-cmd="trackDuplicate" data-track="${i}"
                title="Spur duplizieren (ohne Akkorde und Text)">⧉</button>
              <button type="button" class="ebtn" data-cmd="trackRhythm" data-track="${i}"
                title="Rhythmus ableiten (Strumming mit den Akkorden)">${svgIcon('slashNote')}</button>
              <button type="button" class="ebtn" data-cmd="trackMelody" data-track="${i}"
                title="Melodie ableiten (höchste Töne mit Text)">${svgIcon('melodyNote')}</button>
              <button type="button" class="ebtn ebtn-danger" data-cmd="trackDelete" data-track="${i}"
                title="Spur löschen"${last ? '' : ' disabled'}>×</button></span>
          </div>`;
        }).join('')}
      <div class="etrack-foot">
        ${todoButton('Spur hinzufügen', 'Gitarrenspur hinzufügen (mit Tuning und Capo des Songs)', 'ebtn-text', 'addTrack')}
        ${todoButton('Spur aus GuitarPro-Datei importieren', 'Spur aus einer hochgeladenen Guitar-Pro-Datei übernehmen, '
            + 'z. B. die Melodie', 'ebtn-text', 'trackImport')}
      </div>`;
    }

    /**
     * Kopf eines seitlichen Panels mit Titel und Knopf zum Einklappen.
     * @param {string} title Titel
     * @param {string} side "left" oder "right"
     * @returns {string} HTML
     */
    panelHead(title, side) {
        return `
      <div class="edit-panel-head">
        <span class="edit-panel-title">${escapeHtml(title)}</span>
        <button type="button" class="ebtn ebtn-collapse" data-collapse="${side}"
          title="Ein-/Ausklappen (${Object.keys(PANEL_KEYS).find(k => PANEL_KEYS[k] === side)})"
          aria-label="${escapeHtml(title)} ein- oder ausklappen"></button>
      </div>`;
    }

    /**
     * Reagiert auf Klicks in Leiste und Panels. Mit Alt führen manche Knöpfe die Variante aus (ALT_COMMANDS).
     * @param {HTMLElement} target angeklicktes Element
     * @param {boolean} [alt] ob die Alt-Taste gedrückt war
     * @returns {void}
     */
    handleClick(target, alt = false) {
        // Ein Eintrag in einem Menü der Leiste schließt es (der Befehl läuft weiter unten).
        if (target.closest('[data-pop]')) this.toggleMenu(null);
        const el =/** @type {?HTMLElement} */ (target.closest('[data-action], [data-collapse], '
            + '[data-duration], [data-cmd], [data-todo], [data-bar-goto], [data-ls-action], '
            + '[data-show-track], [data-track-audible], [data-clear-section]'));
        if (!el) return;
        if (el.dataset.clearSection !== undefined) {
            this.change(() => edit.setSection(this.alphaTab, this.score, this.pos.bar, ''));
        } else if (el.dataset.showTrack !== undefined) {
            this.toggleTrackEye(Number(el.dataset.showTrack));
        } else if (el.dataset.trackAudible !== undefined) {
            this.toggleTrackAudible(Number(el.dataset.trackAudible));
        } else if (el.dataset.barGoto) {
            this.moveTo({bar: Number(el.dataset.barGoto), beat: 0});
        } else if (el.dataset.lsAction) {
            this.leadsheetTab.action(el);
        } else if (el.dataset.cmd) {
            this.run((alt && ALT_COMMANDS[el.dataset.cmd]) || el.dataset.cmd, el);
        } else if (el.dataset.action === 'cleanMenu') {
            this.toggleMenu('clean');
        } else if (el.dataset.action === 'sectionMenu') {
            this.toggleMenu('sections');
        } else if (el.dataset.action === 'done') {
            this.finish();
        } else if (el.dataset.action === 'tempoHint') {
            this.gotoTempoMismatch();
        } else if (el.dataset.action === 'help') {
            openShortcutHelp();
        } else if (el.dataset.collapse) {
            this.togglePanel(el.dataset.collapse);
        } else if (el.dataset.duration) {
            this.changeBeats(beat => edit.setDuration(beat, Number(el.dataset.duration)));
        } else if (el.dataset.todo) {
            this.toast(`Noch nicht umgesetzt: ${el.dataset.todo}`);
        }
    }

    /**
     * Tastenkürzel wie in Guitar Pro 8 (Liste in editor.js). Nicht beim Schreiben in einem Eingabefeld und nicht,
     * solange ein Dialog offen ist. Bekannte Tasten verlieren ihre Wirkung im Browser (Strg+S, Strg+D, Leertaste …).
     * @param {KeyboardEvent} e Tastendruck
     * @returns {void}
     */
    handleKey(e) {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.closest('input, textarea, select, [contenteditable]') || document.querySelector('.overlay.open')) return;
        // Auf der Wellenform verschieben Pfeile und Entf den Sync-Punkt; Strg+Z usw. gelten weiter.
        if (target.closest('.sync-wave') && !e.ctrlKey && !e.metaKey && e.key !== ' ') return;
        // In einem Menü der Leiste gehören die Tasten dem Menü (Enter und Leertaste klicken den Eintrag).
        const pop = /** @type {?HTMLElement} */ (target.closest('[data-pop]'));
        if (pop) {
            if (this.menuKey(e.key, pop)) e.preventDefault();
            return;
        }
        const command = this.keyCommand(e);
        if (!command) return;
        e.preventDefault();
        if (typeof command === 'function') command();
        else this.run(command);
    }

    /**
     * Befehl zu einem Tastendruck.
     * @param {KeyboardEvent} e Tastendruck
     * @returns {?(string|function(): void)} Name für run() oder eine Funktion; null für fremde Tasten
     */
    keyCommand(e) {
        const ctrl = e.ctrlKey || e.metaKey;
        const {shiftKey: shift, altKey: alt} = e;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const plain = !ctrl && !alt;
        if (plain && /^[0-9]$/.test(key) && !shift) return () => this.typeDigit(Number(key));
        if (!ctrl && !alt && !shift && PANEL_KEYS[key]) return () => this.togglePanel(PANEL_KEYS[key]);
        if (ctrl && !alt) {
            if (key === 'z') return 'undo';
            if (key === 'y') return 'redo';
            if (key === 's') return 'save';
            if (key === '.') return 'dot2';
            if (key === '9') return 'sharp';
            if (key === '7') return 'flat';
            if (key === '8') return 'natural';
            if (key === 'd') return shift ? 'arpeggioDown' : 'brushDown';
            if (key === 'u') return shift ? 'arpeggioUp' : 'brushUp';
            if (key === 'Insert') return 'insertBar';
            if (key === 'Delete') return 'deleteBar';
            if (key === 'Home') return () => this.moveTo({bar: 0, beat: 0});
            if (key === 'End') return 'lastBar';
            if (shift && (key === 'ArrowLeft' || key === 'ArrowRight')) return key === 'ArrowLeft' ? 'selectLeft' : 'selectRight';
            if (shift && (key === 'ArrowUp' || key === 'ArrowDown')) return key === 'ArrowUp' ? 'chordUp' : 'chordDown';
            if (key === 'ArrowUp' || key === 'ArrowDown') return () => this.stepTrack(key === 'ArrowUp' ? -1 : 1);
            if (key === 'c') return 'copy';
            if (key === 'x') return 'cut';
            if (key === 'v') return 'paste';
            if (key === 'a') return 'selectAll';
            if (key === '/') return 'tripletFeel';
            if (key === 'k') return 'keySignature';
            return null;
        }
        if (alt && shift && (key === 'ArrowUp' || key === 'ArrowDown')) return key === 'ArrowUp' ? 'semitoneUp' : 'semitoneDown';
        if (ctrl && alt && (key === 'ArrowUp' || key === 'ArrowDown')) return key === 'ArrowUp' ? 'stringUp' : 'stringDown';
        if (ctrl && alt && !shift && (key === 'ArrowLeft' || key === 'ArrowRight')) {
            return () => this.stepSection(key === 'ArrowLeft' ? -1 : 1);
        }
        if (ctrl && alt && !shift && key === 'Insert') return 'insertBarAfter';
        if (alt && !shift && key === 'Insert') return 'insertBeatAfter';
        if (alt && !shift && key === 'c') return 'brush';
        if (alt && !shift && key === 'v') return 'brushApply';
        if (alt && shift && key === 'g') return () => this.openMenuByKey('sections');
        if (alt && !shift && key === 'g') return () => {
            const input = /** @type {HTMLInputElement} */ (this.part('edit-toolbar').querySelector('[data-goto]'));
            input.focus();
            input.select();
        };
        if (alt) return null;
        switch (key) {
            case 'ArrowLeft':
                return shift ? 'selectBeatLeft' : () => this.moveTo(edit.stepBeat(this.score, this.pos, -1));
            case 'ArrowRight':
                return shift ? 'selectBeatRight' : () => this.moveTo(edit.stepBeat(this.score, this.pos, 1));
            case 'ArrowUp':
                return shift ? 'scaleUp' : () => this.moveTo({string: this.pos.string + 1});
            case 'ArrowDown':
                return shift ? 'scaleDown' : () => this.moveTo({string: this.pos.string - 1});
            case 'Escape':
                return this.selection || this.beatSelection ? () => this.setSelection(null) : null;
            case 'Home':
                return () => this.moveTo({beat: 0});
            case 'End':
                return 'lastBar';
            case 'Backspace':
                return 'deleteNote';
            case 'Insert':
                return shift ? 'section' : 'insertBeat';
            case 'Delete':
                return shift ? null : 'deleteKey';
            case ' ':
                return () => {
                    this.onPlay();
                    this.player.api?.playPause();
                };
            case '?':
                return () => openShortcutHelp();
            case '+':
            case '=':
                return 'shorter';
            case '-':
            case '_':
                return 'longer';
            case '.':
                return 'dot';
            case '/':
                return 'triplet';
            case 'r':
                return shift ? null : 'rest';
            case 'l':
                return shift ? () => this.focusField('syllable') : 'tie';
            case 'h':
                return shift ? null : 'hammer';
            case 's':
                return shift ? null : 'slide';
            case 'b':
                return shift ? null : 'bend';
            case 'v':
                return shift ? null : 'vibrato';
            case 'x':
                return shift ? null : 'dead';
            case 'o':
                return shift ? null : 'ghost';
            case 'd':
                return shift ? 'pickDown' : null;
            case 'u':
                return shift ? 'pickUp' : null;
            case 'a':
                return shift ? null : () => this.focusField('[data-chord-select]');
            case 't':
                return shift ? null : () => this.focusField('text');
            default:
                return null;
        }
    }

    /**
     * Klappt ein Panel ein bzw. aus (F2, F4, F8 oder der Pfeil am Panel).
     * @param {string} side "left", "right" oder "bottom"
     * @returns {void}
     */
    togglePanel(side) {
        this.part(`edit-${side}`).classList.toggle('collapsed');
        this.saveCollapsed();
        this.measure();
        this.relayout();
        if (side === 'right') this.fillLyrics();
        if (side === 'bottom') void this.openSync();
    }

    /**
     * Führt einen Befehl aus (Knopf oder Taste).
     * @param {string} name Befehl
     * @param {?HTMLElement} [el] Knopf (für Befehle einer Spur: data-track)
     * @returns {void}
     */
    run(name, el = null) {
        if (!this.score) return;
        const at = this.alphaTab;
        const string = this.pos.string;
        const note = beat => edit.noteOn(beat, string);
        const {AccidentalMode, PickStroke, BrushType, VibratoType, SlideOutType} = {
            AccidentalMode: at.model.NoteAccidentalMode, PickStroke: at.model.PickStroke, BrushType: at.model.BrushType,
            VibratoType: at.model.VibratoType, SlideOutType: at.model.SlideOutType,
        };
        /** @type {Object<string, function(): void>} */
        const commands = {
            save: () => this.askSave(),
            tidyChords: () => this.tidyChords(),
            checkChordNotes: () => void this.checkChordNotes(),
            undo: () => this.undo(this.undoStack, this.redoStack),
            redo: () => this.undo(this.redoStack, this.undoStack),
            shorter: () => this.changeBeats(beat => edit.stepDuration(beat, 1)),
            longer: () => this.changeBeats(beat => edit.stepDuration(beat, -1)),
            dot: () => this.changeBeats(beat => edit.toggleDots(beat, 1), true),
            dot2: () => this.changeBeats(beat => edit.toggleDots(beat, 2), true),
            triplet: () => this.changeBeats(beat => edit.toggleTriplet(beat), true),
            rest: () => this.changeBeats(beat => edit.makeRest(beat)),
            deleteNote: () => this.change(beat => edit.deleteNote(beat, string)),
            tie: () => this.tieSelected(),
            semitoneUp: () => this.change(beat => edit.shiftSemitone(at, beat, string, 1)),
            semitoneDown: () => this.change(beat => edit.shiftSemitone(at, beat, string, -1)),
            scaleUp: () => this.stepPitch('scale', 1),
            scaleDown: () => this.stepPitch('scale', -1),
            chordUp: () => this.stepPitch('chord', 1),
            chordDown: () => this.stepPitch('chord', -1),
            hammer: () => this.change(beat => edit.toggleNoteProp(note(beat), 'isHammerPullOrigin', true, false)),
            slide: () => this.change(beat =>
                edit.toggleNoteProp(note(beat), 'slideOutType', SlideOutType.Legato, SlideOutType.None)),
            vibrato: () => this.change(beat =>
                edit.toggleNoteProp(note(beat), 'vibrato', VibratoType.Slight, VibratoType.None)),
            dead: () => this.toggleSelectedNotes('isDead'),
            ghost: () => this.toggleSelectedNotes('isGhost'),
            sharp: () => this.change(beat =>
                edit.toggleNoteProp(note(beat), 'accidentalMode', AccidentalMode.ForceSharp, AccidentalMode.Default)),
            flat: () => this.change(beat =>
                edit.toggleNoteProp(note(beat), 'accidentalMode', AccidentalMode.ForceFlat, AccidentalMode.Default)),
            natural: () => this.change(beat =>
                edit.toggleNoteProp(note(beat), 'accidentalMode', AccidentalMode.ForceNatural, AccidentalMode.Default)),
            pickDown: () => this.toggleSelectedBeats('pickStroke', PickStroke.Down),
            pickUp: () => this.toggleSelectedBeats('pickStroke', PickStroke.Up),
            brushDown: () => this.toggleSelectedBeats('brushType', BrushType.BrushDown),
            brushUp: () => this.toggleSelectedBeats('brushType', BrushType.BrushUp),
            arpeggioDown: () => this.toggleSelectedBeats('brushType', BrushType.ArpeggioDown),
            arpeggioUp: () => this.toggleSelectedBeats('brushType', BrushType.ArpeggioUp),
            fadeOut: () => this.toggleSelectedBeats('fade', at.model.FadeType.FadeOut),
            accent: () => {
                const on = !edit.beatAt(this.score, this.pos)?.notes.some(n => n.accentuated);
                this.changeBeats(beat => edit.setAccent(at, beat, on));
            },
            chordNew: () => void this.openChordDialog(false),
            chordDetect: () => void this.detectChord(),
            chordEdit: () => void this.openChordDialog(true),
            insertBeat: () => this.change(beat => edit.insertBeat(at, beat)),
            insertBeatAfter: () => this.change(beat => edit.insertBeatAfter(at, beat), {pos: {beat: this.pos.beat + 1}}),
            deleteBeat: () => this.change(beat => edit.deleteBeat(beat)),
            deleteKey: () => this.deleteKey(),
            lyricsReflow: () => void this.applyLyrics({reflow: true}),
            syllableFromLeft: () => this.pullSyllable(-1),
            syllableFromRight: () => this.pullSyllable(1),
            insertBar: () => this.change(() => edit.insertBar(at, this.score, this.pos.bar),
                {pos: {beat: 0}, label: `Takt vor Takt ${this.pos.bar + 1} eingefügt`}),
            insertBarAfter: () => this.change(() => edit.insertBar(at, this.score, this.pos.bar + 1),
                {pos: {bar: this.pos.bar + 1, beat: 0}, label: `Takt nach Takt ${this.pos.bar + 1} eingefügt`}),
            deleteBar: () => this.change(() => edit.deleteBar(this.score, this.pos.bar),
                {pos: {beat: 0}, label: `Takt ${this.pos.bar + 1} gelöscht`}),
            lastBar: () => this.moveTo({bar: this.score.masterBars.length - 1, beat: 0}),
            bend: () => this.change(beat => edit.cycleBend(at, note(beat))),
            stringUp: () => this.moveNoteString(string, string + 1),
            stringDown: () => this.moveNoteString(string, string - 1),
            selectBeatLeft: () => this.extendBeatSelection(-1),
            selectBeatRight: () => this.extendBeatSelection(1),
            selectLeft: () => this.extendSelection(-1),
            selectRight: () => this.extendSelection(1),
            selectAll: () => this.setSelection({
                track: this.pos.track, anchor: 0, from: 0,
                to: this.score.masterBars.length - 1
            }),
            copy: () => this.copyBars(false),
            cut: () => this.copyBars(true),
            paste: () => this.pasteBars(),
            brush: () => this.openBrushDialog(),
            brushApply: () => this.applyBrush(),
            anacrusis: () => this.toggleAnacrusis(),
            section: () => this.focusField('[data-bar="section"]'),
            patternSuggest: () => this.leadsheetTab.suggest(),
            patternRollOut: () => this.leadsheetTab.rollOut(),
            patternCatalog: () => this.leadsheetTab.catalogDialog(),
            tripletFeel: () => {
                const on = this.score.masterBars[0].tripletFeel === at.model.TripletFeel.NoTripletFeel;
                this.change(() => edit.setTripletFeel(this.score, 0,
                    on ? at.model.TripletFeel.Triplet8th : at.model.TripletFeel.NoTripletFeel, true),
                {label: on ? 'Shuffle eingeschaltet' : 'Shuffle ausgeschaltet'});
                this.toast(on ? 'Triolen-Feeling: Achtel (Shuffle)' : 'Triolen-Feeling: kein');
            },
            keySignature: () => /** @type {HTMLElement} */ (this.part('edit-toolbar').querySelector('[data-song="key"]')).focus(),
            transpose: () => this.openTransposeDialog(),
            timing: () => void new TimingDialog(this).open(),
            history: () => void this.openHistoryDialog(),
            uploads: () => openUploads(this.player.slug),
            tracks: () => this.openTracksDialog(),
            leadsheet: () => this.openLeadsheetDialog(),
            trackUp: () => this.changeTracks(score => edit.moveTrack(score, Number(el.dataset.track), -1),
                Number(el.dataset.track), -1, 'Spur verschoben'),
            trackDown: () => this.changeTracks(score => edit.moveTrack(score, Number(el.dataset.track), 1),
                Number(el.dataset.track), 1, 'Spur verschoben'),
            trackDelete: () => {
                const track = this.score.tracks[Number(el.dataset.track)];
                if (!confirm(`Spur "${trackName(track)}" löschen?`)) return;
                this.changeTracks(score => edit.deleteTrack(score, track.index), track.index, 0,
                    `Spur „${trackName(track)}“ gelöscht`);
            },
            addTrack: () => this.changeTracks(score => edit.addTrack(at, score, `Gitarre ${score.tracks.length + 1}`),
                this.score.tracks.length, 0, 'Spur hinzugefügt'),
            trackDuplicate: () => {
                const index = Number(el.dataset.track);
                // Aus dem alphaTex gelesen statt aus dem Modell kopiert: So ist die Kopie vollständig und unabhängig.
                this.changeTracks(score => edit.duplicateTrack(t => parseScore(at, t), this.tex, score, index), index + 1, 0,
                    'Spur kopiert');
                this.toast(`Kopie „${trackName(this.score.tracks[index + 1])}“ angelegt, ohne Akkorde und Text.`);
            },
            trackRhythm: () => new RhythmDialog(this, Number(el.dataset.track)).open(),
            trackMelody: () => this.openMelodyDialog(Number(el.dataset.track)),
            chordFile: () => openUploads(this.player.slug, {
                title: 'ChordPro- oder Textdatei',
                extensions: CHORD_EXTENSIONS,
                onPick: file => void this.insertChordFileText(file),
            }),
            trackImport: () => openUploads(this.player.slug, {
                title: 'GuitarPro-Datei',
                extensions: GP_EXTENSIONS,
                onPick: file => void this.importTrackFile(file),
            }),
        };
        if (commands[name]) commands[name]();
        else this.toast(`Unbekannter Befehl: ${name}`);
    }

    /**
     * Legt die Note am Cursor auf eine andere Saite, gleicher Ton (Strg+Alt+↑/↓ oder Ziehen mit der Maus).
     * @param {number} from Saite der Note
     * @param {number} to Zielsaite
     * @returns {void}
     */
    moveNoteString(from, to) {
        const staff = edit.editStaff(this.score, this.pos.track);
        let moved = false;
        this.change(beat => {
            moved = edit.moveNoteToString(staff, beat, from, to);
        }, {pos: {string: to}});
        if (!moved) this.toast('Die Note passt dort nicht (Saite belegt oder Bund außerhalb 0–24).');
    }

    /**
     * Entf: Sind Schläge ausgewählt (Umschalt+←/→), werden sie gelöscht. Sonst löscht es die Zahl (Note) am Cursor; steht
     * dort keine, aber der Schlag ist leer (Pause), den Schlag. Der letzte Schlag eines Takts bleibt als Pause.
     * @returns {void}
     */
    deleteKey() {
        const selected = this.selectedBeats();
        if (selected.length) {
            const from = this.beatSelection.from;
            this.beatSelection = null;
            this.change(() => selected.forEach(b => edit.deleteBeat(b)),
                {pos: {bar: from.bar, beat: from.beat}, label: beatsLabel(selected, 'gelöscht')});
            this.toast(`${selected.length} ${selected.length === 1 ? 'Schlag' : 'Schläge'} gelöscht.`);
            return;
        }
        const string = this.pos.string;
        this.change(beat => {
            if (!edit.deleteNote(beat, string) && !beat.notes.length) edit.deleteBeat(beat);
        });
    }

    /**
     * Schläge der Auswahl (Umschalt+←/→) in der Reihenfolge der Noten.
     * @returns {Beat[]} leer ohne Auswahl
     */
    selectedBeats() {
        const sel = this.beatSelection;
        const staff = sel ? edit.editStaff(this.score, sel.track) : null;
        if (!sel || !staff) return [];
        const beats = [];
        for (let bar = sel.from.bar; bar <= sel.to.bar; bar++) {
            const list = staff.bars[bar]?.voices[0]?.beats ?? [];
            const first = bar === sel.from.bar ? sel.from.beat : 0;
            const last = bar === sel.to.bar ? sel.to.beat : list.length - 1;
            for (let i = first; i <= last; i++) if (list[i]) beats.push(list[i]);
        }
        return beats;
    }

    /**
     * Ändert den Schlag am Cursor oder, wenn Schläge ausgewählt sind (Umschalt+←/→), alle ausgewählten.
     * @param {function(Beat): *} fn Änderung eines Schlags
     * @param {boolean} [byCursor] fn schaltet um (Punkt, Triole): Dann entscheidet der Schlag am Cursor, und alle
     *   bekommen danach dieselbe Punktierung und Triole wie er, statt einzeln umzuschalten
     * @returns {void}
     */
    changeBeats(fn, byCursor = false) {
        const beats = this.selectedBeats();
        if (beats.length <= 1) {
            this.change(fn);
            return;
        }
        this.change(() => {
            if (byCursor) {
                const cursor = edit.beatAt(this.score, this.pos);
                fn(cursor);
                for (const beat of beats) {
                    if (beat === cursor) continue;
                    edit.setDots(beat, cursor.dots);
                    edit.setTriplet(beat, edit.isTriplet(cursor));
                }
            } else {
                for (const beat of beats) fn(beat);
            }
        }, {label: beatsLabel(beats)});
        this.toast(`${beats.length} Schläge geändert.`);
    }

    /**
     * Schaltet Ghost- bzw. Dead-Note um: ohne Auswahl an der Note am Cursor, mit Auswahl (Umschalt+←/→) an allen
     * Noten der ausgewählten Schläge, alle gleich: an, wenn die Note am Cursor es nicht ist (ohne Note dort: wenn
     * nicht schon alle es sind).
     * @param {'isGhost'|'isDead'} prop Eigenschaft der Note
     * @returns {void}
     */
    toggleSelectedNotes(prop) {
        const beats = this.selectedBeats();
        if (beats.length <= 1) {
            this.change(beat => edit.toggleNoteProp(edit.noteOn(beat, this.pos.string), prop, true, false));
            return;
        }
        const cursor = edit.noteOn(edit.beatAt(this.score, this.pos), this.pos.string);
        const notes = beats.flatMap(b => b.notes);
        const on = cursor ? !cursor[prop] : !notes.every(n => n[prop]);
        this.change(() => {
            for (const note of notes) note[prop] = on;
        }, {label: beatsLabel(beats)});
        this.toast(`${beats.length} Schläge geändert.`);
    }

    /**
     * Schaltet eine Eigenschaft des Schlags um (Anschlag, Ausblenden): ohne Auswahl am Schlag am Cursor, mit Auswahl
     * (Umschalt+←/→) an allen ausgewählten Schlägen gleich, nach dem Schlag am Cursor (hat er sie, geht sie überall weg).
     * @param {string} prop Eigenschaft von Beat (pickStroke, brushType, fade)
     * @param {number} on Wert für "an"
     * @returns {void}
     */
    toggleSelectedBeats(prop, on) {
        const value = edit.beatAt(this.score, this.pos)?.[prop] === on ? 0 : on;
        this.changeBeats(beat => {
            beat[prop] = value;
        });
    }

    /**
     * Haltebogen (L): ohne Auswahl an der Note am Cursor wie toggleTie(); mit Auswahl (Umschalt+←/→) an der Saite am
     * Cursor in allen ausgewählten Schlägen gleich, der Reihe nach (so hält jeder die Note des Schlags davor).
     * @returns {void}
     */
    tieSelected() {
        const at = this.alphaTab;
        const string = this.pos.string;
        const beats = this.selectedBeats();
        if (beats.length <= 1) {
            this.change(beat => edit.toggleTie(at, beat, this.previousBeat(), string)
                || this.toast('Haltebogen: Auf dieser Saite klingt davor keine Note.'));
            return;
        }
        const on = !edit.noteOn(edit.beatAt(this.score, this.pos), string)?.isTieDestination;
        const all = beats[0].voice.bar.staff.bars.flatMap(bar => bar.voices[0]?.beats ?? []);
        this.change(() => {
            for (const beat of beats) {
                if (!!edit.noteOn(beat, string)?.isTieDestination !== on) {
                    edit.toggleTie(at, beat, all[all.indexOf(beat) - 1] ?? null, string);
                }
            }
        }, {label: beatsLabel(beats)});
        this.toast(`${beats.length} Schläge geändert.`);
    }

    /**
     * Tonleiter- bzw. Akkordtonschritt der Note am Cursor (Umschalt+↑/↓, Strg+Umschalt+↑/↓): zum nächsten höheren bzw.
     * tieferen Ton der Tonart (Vorzeichnung des Takts; Dur und parallele Moll haben dieselben Töne) bzw. des Akkords,
     * der dort klingt (Akkordspur). Über mehrere Schritte wandert der Ton durch die Oktaven. Die Note bleibt auf ihrer
     * Saite; ginge der Bund dort nicht, sagt ein Hinweis es.
     * @param {'scale'|'chord'} kind Tonleiter oder Akkord
     * @param {1|-1} direction höher oder tiefer
     * @returns {void}
     */
    stepPitch(kind, direction) {
        const beat = edit.beatAt(this.score, this.pos);
        if (!beat || !edit.noteOn(beat, this.pos.string)) {
            this.toast('Am Cursor steht keine Note.');
            return;
        }
        /** @type {Set<number>} */
        let classes;
        if (kind === 'scale') {
            classes = edit.scalePitchClasses(this.score.masterBars[this.pos.bar].keySignature);
        } else {
            const time = beat.voice.bar.masterBar.start + beat.playbackStart;
            const name = chordTimeline(this.score).findLast(e => e.tick <= time)?.name;
            const chord = name ? parseChord(name) : null;
            if (!chord) {
                this.toast(name ? `Den Akkord „${name}“ kann ich nicht zerlegen.` : 'Hier klingt kein Akkord.');
                return;
            }
            classes = new Set(chord.tones);
        }
        let moved = false;
        this.change(b => {
            moved = edit.shiftToPitch(b, this.pos.string, classes, direction);
        });
        if (!moved) this.toast('Auf dieser Saite geht der Ton nicht weiter.');
    }

    /**
     * Erweitert die Auswahl der Schläge um einen Schlag nach links bzw. rechts (Umschalt+←/→); der Cursor geht mit.
     * @param {number} step -1 oder +1
     * @returns {void}
     */
    extendBeatSelection(step) {
        const next = edit.stepBeat(this.score, this.pos, step);
        const anchor = this.beatSelection?.track === this.pos.track ? this.beatSelection.anchor
            : {bar: this.pos.bar, beat: this.pos.beat};
        this.setBeatRange(anchor, next, true);
    }

    /**
     * Wählt die Schläge vom Anker bis zu einem Schlag derselben Spur und setzt den Cursor dorthin.
     * @param {{bar: number, beat: number}} anchor Schlag, an dem die Auswahl begann
     * @param {{bar: number, beat: number}} edge Schlag am anderen Rand (dort steht danach der Cursor)
     * @param {boolean} [scroll] Cursor ins Bild rollen (nach Tasten, nicht nach der Maus)
     * @returns {void}
     */
    setBeatRange(anchor, edge, scroll = false) {
        const before = (a, b) => a.bar < b.bar || a.bar === b.bar && a.beat < b.beat;
        const end = {bar: edge.bar, beat: edge.beat};
        const [from, to] = before(end, anchor) ? [end, anchor] : [anchor, end];
        this.selection = null;
        this.beatSelection = {track: this.pos.track, anchor: {bar: anchor.bar, beat: anchor.beat}, from, to};
        this.pos = edit.clampPosition(this.score, movedPosition(this.pos, {bar: end.bar, beat: end.beat}));
        this.digit = null;
        this.drawCursor(scroll);
        this.updateState();
    }

    /**
     * Setzt die Auswahl (Takte einer Spur) und zeichnet sie.
     * @param {?{track: number, anchor: number, from: number, to: number}} selection Auswahl, null für keine
     * @returns {void}
     */
    setSelection(selection) {
        this.selection = selection;
        this.beatSelection = null;
        this.drawCursor(false);
        this.updateState();
    }

    /**
     * Erweitert die Auswahl um einen Takt nach links bzw. rechts (Strg+Umschalt+←/→); der Cursor geht mit.
     * @param {number} step -1 oder +1
     * @returns {void}
     */
    extendSelection(step) {
        const sel = this.selection?.track === this.pos.track ? this.selection
            : {track: this.pos.track, anchor: this.pos.bar, from: this.pos.bar, to: this.pos.bar};
        const edge = sel.anchor === sel.from ? sel.to : sel.from;
        const next = Math.max(0, Math.min(this.score.masterBars.length - 1, edge + step));
        this.pos = edit.clampPosition(this.score, movedPosition(this.pos, {bar: next, beat: 0}));
        this.setSelection({...sel, from: Math.min(sel.anchor, next), to: Math.max(sel.anchor, next)});
        this.drawCursor(true);
    }

    /**
     * Kopiert die ausgewählten Takte (ohne Auswahl den Takt am Cursor) in die Zwischenablage; beim Ausschneiden werden
     * sie danach geleert (Ganztaktpausen).
     * @param {boolean} cut ausschneiden
     * @returns {void}
     */
    copyBars(cut) {
        const sel = this.selection ?? {track: this.pos.track, from: this.pos.bar, to: this.pos.bar};
        clipboard = {tex: this.tex, track: sel.track, from: sel.from, to: sel.to};
        const count = sel.to - sel.from + 1;
        if (cut) {
            const staff = edit.editStaff(this.score, sel.track);
            this.change(() => {
                for (let i = sel.from; i <= sel.to; i++) edit.clearBar(this.alphaTab, staff.bars[i]);
            }, {label: `Takt ${sel.from + 1}${sel.to > sel.from ? `–${sel.to + 1}` : ''} ausgeschnitten`});
        }
        this.toast(`${count} ${count === 1 ? 'Takt' : 'Takte'} ${cut ? 'ausgeschnitten' : 'kopiert'}`);
    }

    /**
     * Schläge für den Pinsel: die ausgewählten Schläge, sonst die der ausgewählten Takte, sonst der am Cursor.
     * @returns {Beat[]}
     */
    brushBeats() {
        const beats = this.selectedBeats();
        if (beats.length) return beats;
        const sel = this.selection;
        const staff = sel ? edit.editStaff(this.score, sel.track) : null;
        if (sel && staff) {
            return staff.bars.slice(sel.from, sel.to + 1).flatMap(bar => bar.voices[0]?.beats ?? []);
        }
        return [edit.beatAt(this.score, this.pos)];
    }

    /**
     * Dialog "Pinsel" (Alt+C): Welche Eigenschaften der Schläge am Cursor bzw. in der Auswahl kopiert werden.
     * @returns {void}
     */
    openBrushDialog() {
        const beats = this.brushBeats();
        const end = beats[beats.length - 1];
        const extent = barsAndRest(this.score, beatTick(beats[0]), beatTick(end) + edit.beatTicks(end));
        openOverlay(`<h2>Kopieren</h2>
      <p>${extent} ausgewählt</p>
      <div class="brush-kinds">${BRUSH_KINDS.map(([key, label]) => `<label title="${BRUSH_HINTS[key]}"><input
        type="checkbox" value="${key}"${brushKinds.includes(key) ? ' checked' : ''}> ${label}</label>`).join('')}</div>
      <div class="struct-actions">
        <button class="btn btn-primary" type="button" id="brushOk">Kopieren</button>
        <button class="btn" type="button" id="brushCancel">Abbrechen</button>
      </div>`, true);
        const ok = /** @type {HTMLButtonElement} */ (document.getElementById('brushOk'));
        const boxes = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('.brush-kinds input')]);
        const update = () => {
            ok.disabled = !boxes.some(b => b.checked);
        };
        boxes.forEach(b => b.addEventListener('change', update));
        update();
        document.getElementById('brushCancel').addEventListener('click', closeOverlay);
        ok.addEventListener('click', () => {
            brushKinds = boxes.filter(b => b.checked).map(b => b.value);
            this.copyBrush(brushKinds);
            closeOverlay();
        });
        ok.focus();
    }

    /**
     * Kopiert die gewählten Eigenschaften der Schläge am Cursor bzw. in der Auswahl für den Pinsel, je Schlag mit Stelle
     * und Dauer.
     * @param {string[]} kinds Arten aus BRUSH_KINDS
     * @returns {void}
     */
    copyBrush(kinds) {
        const beats = this.brushBeats();
        const start = beatTick(beats[0]);
        const data = beats.map(beat => {
            /** @type {BrushBeat} */
            const d = {offset: beatTick(beat) - start, ticks: edit.beatTicks(beat)};
            if (kinds.includes('chords')) {
                const chordBeat = this.chordBeat(beat);
                const staff = chordBeat.voice.bar.staff;
                d.chord = chordBeat.chordId ? staff.chords?.get(chordBeat.chordId)?.name ?? '' : '';
            }
            if (kinds.includes('stroke')) d.stroke = edit.brushStroke(beat);
            if (kinds.includes('notes')) d.notes = edit.brushNotes(beat);
            if (kinds.includes('text')) d.text = beat.text ?? '';
            if (kinds.includes('syllable')) d.syllable = this.syllableAt(beat);
            return d;
        });
        const last = data[data.length - 1];
        brush = {kinds, beats: data, ticks: last.offset + last.ticks};
        this.updateState();
        const labels = BRUSH_KINDS.filter(([key]) => kinds.includes(key)).map(([, label]) => label).join(', ');
        this.toast(`Pinsel: ${quarters(brush.ticks)} kopiert (${labels}). Übertragen mit Alt+V.`);
    }

    /**
     * Zielbereich für den Pinsel: die Auswahl (gleich lang wie das Kopierte) bzw. ab dem Cursor so lang wie das
     * Kopierte. Mit Notenwerten muss er an einer Schlaggrenze enden, und kein Schlag darf über einen Taktstrich gehen.
     * @returns {{track: number, from: number, to: number}|string} Spur und Ticks ab Songanfang; sonst der Hinweis, warum
     *   es nicht geht
     */
    brushRange() {
        const selected = this.selectedBeats().length > 0 || !!this.selection;
        const beats = this.brushBeats();
        const staff = beats[0].voice.bar.staff;
        const from = beatTick(beats[0]);
        const end = beats[beats.length - 1];
        const to = selected ? beatTick(end) + edit.beatTicks(end) : from + brush.ticks;
        if (selected && to - from !== brush.ticks) {
            return `Die Dauer passt nicht: kopiert ${quarters(brush.ticks)}, ausgewählt ${quarters(to - from)}.`;
        }
        const bars = this.score.masterBars;
        const last = bars[bars.length - 1];
        if (to > last.start + last.calculateDuration()) return 'Ab dem Cursor reicht der Song nicht für das Kopierte.';
        if (brush.kinds.includes('notes')) {
            const starts = new Set(staff.bars.flatMap(bar => bar.voices[0]?.beats.map(beatTick) ?? []));
            if (to < last.start + last.calculateDuration() && !starts.has(to)) {
                return 'Das Kopierte endet mitten in einem Schlag.';
            }
            for (const d of brush.beats) {
                const mb = masterBarAt(this.score, from + d.offset);
                if (from + d.offset + d.ticks > mb.start + mb.calculateDuration()) {
                    return `Ein kopierter Schlag ginge in Takt ${mb.index + 1} über den Taktstrich.`;
                }
            }
        }
        return {track: staff.track.index, from, to};
    }

    /**
     * Überträgt, was der Pinsel kopiert hat, in den Zielbereich (brushRange(); ein Schritt für "Rückgängig"). Nur die
     * kopierten Arten ändern sich, alles andere bleibt. Mit Notenwerten ersetzen die kopierten Schläge die dort; sonst
     * kommen Anschlag und Text an die Schläge, die an derselben Stelle beginnen, Akkorde und Silben an die Stelle selbst
     * (in der Akkord- bzw. Textspur). Geht etwas nicht (kein Schlag für einen kopierten Anschlag oder Text, eine Stelle
     * lässt sich nicht teilen, eine nicht kopierte Angabe verlöre ihren Schlag), bricht es ohne Änderung mit Meldung ab.
     * @returns {void}
     */
    applyBrush() {
        if (!brush) return;
        const range = this.brushRange();
        if (typeof range === 'string') {
            this.toast(range);
            return;
        }
        const data = brush.beats;
        try {
            this.change(() => {
                const staff = this.score.tracks[range.track].staves[0];
                /** @type {?Beat[]} */
                const targets = brush.kinds.includes('notes') ? this.replaceBeats(staff, range, data)
                    : data.map(d => {
                        const tick = range.from + d.offset;
                        const mb = masterBarAt(this.score, tick);
                        return staff.bars[mb.index].voices[0]?.beats.find(b => b.playbackStart === tick - mb.start) ?? null;
                    });
                data.forEach((d, i) => {
                    const tick = range.from + d.offset;
                    const mb = masterBarAt(this.score, tick);
                    const beat = targets[i];
                    const stroke = d.stroke && (d.stroke.pickStroke || d.stroke.brushType || d.stroke.fade || d.stroke.accent);
                    if (beat) {
                        if (d.stroke) edit.applyBrushStroke(this.alphaTab, beat, d.stroke);
                        if (d.text !== undefined) beat.text = d.text || null;
                    } else if (stroke || d.text) {
                        throw brushConflict(`Abgebrochen: In Takt ${mb.index + 1} beginnt kein Schlag für ${
                            stroke ? 'den kopierten Anschlag' : `den Text „${d.text}“`}.`);
                    }
                    for (const [kind, value, label] of /** @type {const} */ ([['chords', d.chord, 'den Akkord'],
                        ['lyrics', d.syllable, 'die Silbe']])) {
                        if (value === undefined) continue;
                        const target = this.contentBeatAt(kind, staff, mb.index, tick - mb.start, Boolean(value));
                        if (!target && value) {
                            throw brushConflict(`Abgebrochen: In Takt ${mb.index + 1} lässt sich für ${label} „${value}“ kein Schlag `
                                + 'teilen (Triole oder Vorschlag).');
                        }
                        if (target && kind === 'chords') this.setChordName(target, value);
                        if (target && kind === 'lyrics') this.setSyllableOn(target, value);
                    }
                });
            }, {label: `Pinsel ab Takt ${masterBarAt(this.score, range.from).index + 1} übertragen`});
        } catch (e) {
            // Das Modell ist halb geändert: zurück auf den Stand davor.
            this.setTex(this.tex);
            if (!e.brushConflict) throw e;
            this.toast(e.message);
            return;
        }
        this.toast(`Pinsel: ${quarters(brush.ticks)} übertragen.`);
    }

    /**
     * Was an einem Schlag steht, das der Pinsel nicht kopiert hat und daher behalten muss.
     * @param {Beat} beat Schlag im Zielbereich
     * @returns {string} z. B. 'der Akkord „G“', leer ohne
     */
    brushKept(beat) {
        const kinds = brush.kinds;
        const chord = beat.chordId ? beat.voice.bar.staff.chords?.get(beat.chordId)?.name : '';
        if (!kinds.includes('chords') && chord) return `der Akkord „${chord}“`;
        const syllable = (beat.lyrics ?? []).find(l => l)?.replace(edit.LYRICS_BREAK, '').trim();
        if (!kinds.includes('syllable') && beat.lyrics?.some(l => l)) {
            return syllable ? `die Silbe „${syllable}“` : 'ein Zeilenumbruch im Liedtext';
        }
        if (!kinds.includes('text') && beat.text) return `der Text „${beat.text}“`;
        const stroke = edit.brushStroke(beat);
        if (!kinds.includes('stroke') && (stroke.pickStroke || stroke.brushType || stroke.fade || stroke.accent)) {
            return 'der Anschlag';
        }
        return '';
    }

    /**
     * Ersetzt die Schläge im Zielbereich durch die kopierten (Pinsel mit Notenwerten), Takt für Takt. Nicht kopierte
     * Angaben (Akkord, Silben, Text, Anschlag) bleiben am neuen Schlag derselben Stelle; beginnt dort keiner, bricht es
     * ab (brushConflict()). Automationen
     * (z. B. Instrumentwechsel) und Dynamik der ersetzten Schläge bleiben am neuen Schlag, der an ihrer Stelle klingt.
     * @param {import('../../types/alphatab').model.Staff} staff Notensystem
     * @param {{from: number, to: number}} range Zielbereich in Ticks ab Songanfang (brushRange())
     * @param {BrushBeat[]} data kopierte Schläge
     * @returns {Beat[]} die neuen Schläge, in der Reihenfolge von data
     */
    replaceBeats(staff, range, data) {
        /** @type {Beat[]} */
        const created = [];
        const first = masterBarAt(this.score, range.from).index;
        const last = masterBarAt(this.score, range.to - 1).index;
        for (let index = first; index <= last; index++) {
            const mb = this.score.masterBars[index];
            const voice = staff.bars[index].voices[0];
            const from = Math.max(range.from, mb.start) - mb.start;
            const to = Math.min(range.to, mb.start + mb.calculateDuration()) - mb.start;
            const old = voice.beats.filter(b => b.playbackStart >= from && b.playbackStart < to);
            const at = old.length ? voice.beats.indexOf(old[0]) : voice.beats.filter(b => b.playbackStart < from).length;
            /** @param {BrushBeat} d @returns {number} Stelle im Takt */
            const inBar = d => range.from + d.offset - mb.start;
            const placed = data.filter(d => from <= inBar(d) && inBar(d) < to);
            const fresh = placed.map(d => {
                const beat = new this.alphaTab.model.Beat();
                beat.voice = voice;
                edit.applyBrushNotes(this.alphaTab, beat, d.notes);
                return beat;
            });
            for (const beat of old) {
                const i = Math.max(placed.findLastIndex(d => range.from + d.offset - mb.start <= beat.playbackStart), 0);
                const target = fresh[i];
                if (!target) continue;
                target.automations.push(...beat.automations);
                if (range.from + placed[i].offset - mb.start === beat.playbackStart) {
                    // Akkord, Silben, Text und Anschlag bleiben; kopierte Arten überschreibt applyBrush() danach.
                    target.dynamics = beat.dynamics;
                    target.chordId = beat.chordId;
                    target.lyrics = beat.lyrics;
                    target.text = beat.text;
                    edit.applyBrushStroke(this.alphaTab, target, edit.brushStroke(beat));
                    continue;
                }
                const lost = this.brushKept(beat);
                if (lost) throw brushConflict(`Abgebrochen: In Takt ${index + 1} verlöre ${lost} den Schlag (an seiner Stelle `
                    + 'beginnt im Kopierten keiner). Mitkopieren oder einen anderen Bereich wählen.');
            }
            voice.beats.splice(at, old.length, ...fresh);
            // Haltebögen an den Ton davor auf derselben Saite binden; fehlt er dort, entfällt der Bogen.
            fresh.forEach((beat, i) => {
                const previous = voice.beats[at + i - 1] ?? staff.bars[index - 1]?.voices[0]?.beats.at(-1) ?? null;
                for (const note of beat.notes.filter(n => n.isTieDestination)) {
                    const origin = previous ? edit.noteOn(previous, note.string) : null;
                    note.isTieDestination = Boolean(origin);
                    note.tieOrigin = origin;
                    if (origin) {
                        origin.tieDestination = note;
                        note.fret = origin.fret;
                    }
                }
            });
            created.push(...fresh);
            staff.bars[index].finish(new this.alphaTab.Settings());
        }
        return created;
    }

    /**
     * Macht Takt 1 zum Auftakt bzw. wieder zum vollen Takt und rechnet ihn um (setAnacrusis() in notation.js); geht es
     * nicht, sagt eine Meldung warum.
     * @returns {void}
     */
    toggleAnacrusis() {
        const on = !this.score.masterBars[0].isAnacrusis;
        let error = '';
        this.change(() => {
            error = edit.setAnacrusis(this.alphaTab, this.score, on);
        }, {pos: {beat: 0}, label: on ? 'Auftakt eingeschaltet' : 'Auftakt ausgeschaltet'});
        this.fillBarSignature();
        this.toast(error || (on ? 'Takt 1 ist jetzt ein Auftakt.' : 'Takt 1 ist wieder ein voller Takt.'));
    }

    /**
     * Fügt die Takte der Zwischenablage ab dem Takt am Cursor in dessen Spur ein und ersetzt die Takte dort.
     * @returns {void}
     */
    pasteBars() {
        if (!clipboard) {
            this.toast('Die Zwischenablage ist leer (erst Strg+C).');
            return;
        }
        let count = 0;
        this.change(() => {
            count = edit.pasteBars(this.alphaTab, t => parseScore(this.alphaTab, t), this.score, clipboard, this.pos.track,
                this.pos.bar);
        }, {pos: {beat: 0}, label: `Takte ab Takt ${this.pos.bar + 1} eingefügt`});
        this.toast(`${count} ${count === 1 ? 'Takt' : 'Takte'} eingefügt`);
    }

    /**
     * Übernimmt einen neuen Stand als einen Schritt für "Rückgängig" (für Änderungen, die ein neues Modell liefern).
     * @param {string} tex alphaTex
     * @param {?string} [sheet] neue Angaben für das Leadsheet (wie sheetJson()), wenn sich die Takte verschoben haben
     * @param {string} [label] was sich geändert hat (Tooltip von Rückgängig)
     * @returns {void}
     */
    commitTex(tex, sheet = null, label = 'Noten geändert') {
        if (tex === this.tex && (sheet === null || sheet === this.sheetJson())) return;
        this.pushUndo(this.snapshot(), label);
        if (sheet !== null) this.setSheet(sheet);
        this.setTex(tex);
    }

    /**
     * Ändert die Spuren (verschieben, löschen, hinzufügen) und hält die Auswahl der gezeigten Spuren mit, ebenso
     * Lautstärke, Stumm und die Vorgaben je Spur (Player.remapTracks()); die gehören dann zum nächsten Speichern, sie
     * hängen am Index. (Baustellen und Tab-Stellen hängen am Namen, die zieht change() nach.)
     * @param {function(Score): *} fn Änderung an den Noten
     * @param {number} index betroffene Spur (beim Hinzufügen: Index der neuen)
     * @param {number} step Verschiebung (-1, +1), 0 beim Löschen bzw. Hinzufügen
     * @param {string} [label] was sich geändert hat (Tooltip von Rückgängig)
     * @returns {void}
     */
    changeTracks(fn, index, step, label = 'Spuren geändert') {
        // Die gewählte Spur für Akkorde bzw. Text ohne Inhalt (contentChoice) hängt am Index; nach dem Umbau neu wählen.
        this.contentChoice = {chords: null, lyrics: null};
        const before = this.score.tracks.length;
        const shown = new Set(this.trackIndexes);
        this.change(() => fn(this.score), {label});
        const after = this.score.tracks.length;
        /** @type {function(number): ?number} alter Index → neuer Index */
        let map = i => i;
        if (step) map = i => i === index ? index + step : i === index + step ? index : i;
        else if (after < before) map = i => i === index ? null : i > index ? i - 1 : i;
        else if (after > before) map = i => i >= index ? i + 1 : i;
        this.player.remapTracks(map);
        // Die Vorgaben je Spur hängen am Index.
        if (step || after !== before) this.viewChanged = true;
        const indexes = [...shown].map(map).filter(i => i !== null && i < after);
        if (after > before) indexes.push(index);
        this.trackIndexes = this.player.orderTracks(indexes.map(i => this.score.tracks[i])).map(t => t.index);
        if (!this.trackIndexes.length) this.trackIndexes = [0];
        this.pos = edit.clampPosition(this.score, movedPosition(this.pos, {track: map(this.pos.track) ?? this.trackIndexes[0]}));
        this.player.api.renderScore(this.score, this.trackIndexes);
        this.updateState();
        this.renderSongPanels();
    }

    /**
     * Spur, die Akkorde bzw. Text trägt (Radiobuttons im Dialog "Spuren"). Steht schon etwas in den Noten, ist es die
     * Spur damit (chordsTrack(), lyricsTrack()); sonst die zuletzt gewählte (contentChoice), ohne Wahl für Akkorde die
     * erste Spur und für Text die Spur "vocal", ohne sie die letzte (der Text steht unter den Noten).
     * @param {'chords'|'lyrics'} kind Akkorde oder Text
     * @returns {number} Index der Spur
     */
    contentTrack(kind) {
        const found = kind === 'chords' ? chordsTrack(this.score) : lyricsTrack(this.score);
        if (found) return found.index;
        const chosen = this.contentChoice[kind];
        if (chosen !== null && chosen < this.score.tracks.length) return chosen;
        if (kind === 'chords') return 0;
        const vocal = this.score.tracks.find(t => t.name.trim().toLowerCase() === 'vocal');
        return vocal?.index ?? this.score.tracks.length - 1;
    }

    /**
     * Spur, deren Liedtext das Panel "Liedtext" bearbeitet (contentTrack()).
     * @returns {?import('../../types/alphatab').model.Track}
     */
    lyricsTarget() {
        if (!this.score) return null;
        return this.score.tracks[this.contentTrack('lyrics')] ?? null;
    }

    /**
     * Schlag, an dem der Akkord für den Schlag am Cursor steht: der Schlag der Akkordspur (contentTrack()), der an
     * derselben Stelle beginnt. So landen neue Akkorde in der Spur, die die Radiobuttons zeigen, auch wenn der Cursor in
     * einer anderen steht. Beginnt dort kein Schlag (z. B. mitten in einer langen Note): zum Lesen der Schlag am Cursor
     * selbst (er hat dann keinen Akkord der Akkordspur); zum Setzen (create) wird der klingende Schlag der Akkordspur dort
     * geteilt und angebunden (klingt gleich, splitBeat() in notation.js), damit Akkorde nur in der Akkordspur stehen.
     * @param {Beat} beat Schlag am Cursor
     * @param {boolean} [create] zum Setzen eines Akkords
     * @returns {?Beat} null nur mit create, wenn sich dort kein Schlag teilen lässt (Triole, Vorschlag)
     */
    chordBeat(beat, create = false) {
        return this.contentBeat('chords', beat, create);
    }

    /**
     * Schlag, an dem die Silbe für den Schlag am Cursor steht: wie chordBeat(), nur in der Textspur.
     * @param {Beat} beat Schlag am Cursor
     * @param {boolean} [create] zum Setzen einer Silbe
     * @returns {?Beat} null nur mit create, wenn sich dort kein Schlag teilen lässt (Triole, Vorschlag)
     */
    syllableBeat(beat, create = false) {
        return this.contentBeat('lyrics', beat, create);
    }

    /**
     * Schlag der Akkord- bzw. Textspur (contentTrack()) an der Stelle des Schlags am Cursor; Einzelheiten bei chordBeat().
     * @param {'chords'|'lyrics'} kind Akkord- oder Textspur
     * @param {Beat} beat Schlag am Cursor
     * @param {boolean} create zum Setzen: notfalls den klingenden Schlag dort teilen
     * @returns {?Beat} null nur mit create, wenn sich dort kein Schlag teilen lässt
     */
    contentBeat(kind, beat, create) {
        const staff = this.score.tracks[this.contentTrack(kind)]?.staves[0];
        if (!staff || staff === beat.voice.bar.staff) return beat;
        return this.contentBeatAt(kind, beat.voice.bar.staff, beat.voice.bar.index, beat.playbackStart, create)
            ?? (create ? null : beat);
    }

    /**
     * Schlag der Akkord- bzw. Textspur an einer Stelle (ohne eigene Akkord- bzw. Textspur in diesem Notensystem).
     * @param {'chords'|'lyrics'} kind Akkord- oder Textspur
     * @param {import('../../types/alphatab').model.Staff} staff Notensystem am Cursor
     * @param {number} bar Takt
     * @param {number} start Ticks ab Taktanfang
     * @param {boolean} create notfalls den klingenden Schlag dort teilen
     * @returns {?Beat} null, wenn dort keiner beginnt (mit create: wenn er sich nicht teilen lässt)
     */
    contentBeatAt(kind, staff, bar, start, create) {
        const own = this.score.tracks[this.contentTrack(kind)]?.staves[0] ?? staff;
        const voice = own.bars[bar]?.voices[0];
        const found = voice?.beats.find(b => b.playbackStart === start);
        if (found || !create) return found ?? null;
        const sounding = voice ? edit.timeline(voice).find(e => e.start < start && start < e.end) : null;
        const split = sounding ? edit.splitBeat(this.alphaTab, sounding.beat, start - sounding.start) : null;
        // Startzeiten der neuen Schläge für weitere Stellen in derselben Änderung.
        if (split) voice.bar.finish(new this.alphaTab.Settings());
        return split;
    }

    /**
     * Schaltet ein Menü der Leiste um ("clean": Bereinigen, "sections": Abschnitte; klappt unter dem Knopf auf); die
     * anderen schließen.
     * @param {?string} name data-pop des Menüs; null schließt alle
     * @returns {void}
     */
    toggleMenu(name) {
        const pops = this.part('edit-toolbar')?.querySelectorAll('[data-pop]') ?? [];
        for (const pop of /** @type {NodeListOf<HTMLElement>} */ (pops)) {
            const show = pop.dataset.pop === name && pop.hidden;
            if (show && name === 'sections') this.fillSectionMenu(pop);
            pop.hidden = !show;
            pop.previousElementSibling.setAttribute('aria-expanded', String(show));
        }
    }

    /**
     * Öffnet ein Menü der Leiste per Tastenkürzel (bzw. schließt es, wenn es offen ist) und setzt den Fokus auf den
     * markierten oder ersten Eintrag, damit die Pfeiltasten darin wandern.
     * @param {string} name data-pop des Menüs
     * @returns {void}
     */
    openMenuByKey(name) {
        this.toggleMenu(name);
        const pop = /** @type {?HTMLElement} */ (this.part('edit-toolbar')?.querySelector(`[data-pop="${name}"]`));
        if (!pop || pop.hidden) return;
        /** @type {?HTMLElement} */ (pop.querySelector('[aria-current="true"]')
            ?? pop.querySelector('button:not(:disabled)'))?.focus();
    }

    /**
     * Taste in einem Menü der Leiste: ↑/↓ wandern durch die Einträge (am Ende weiter am anderen Ende), Pos1/Ende
     * zum ersten bzw. letzten, Esc schließt das Menü und gibt den Fokus an seinen Knopf zurück.
     * @param {string} key KeyboardEvent.key
     * @param {HTMLElement} pop Menü
     * @returns {boolean} Taste verwendet
     */
    menuKey(key, pop) {
        const items = /** @type {HTMLElement[]} */ ([...pop.querySelectorAll('button:not(:disabled)')]);
        const at = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
        const last = items.length - 1;
        const next = {ArrowDown: at < last ? at + 1 : 0, ArrowUp: at > 0 ? at - 1 : last, Home: 0, End: last}[key];
        if (key === 'Escape') {
            this.toggleMenu(null);
            /** @type {HTMLElement} */ (pop.previousElementSibling).focus();
        } else if (next !== undefined) {
            items[next]?.focus();
        }
        return key === 'Escape' || next !== undefined;
    }

    /**
     * Füllt das Menü "Abschnitte": je Abschnitt ein Eintrag, der zu seinem ersten Takt springt; der Abschnitt am
     * Cursor ist markiert.
     * @param {HTMLElement} pop Menü
     * @returns {void}
     */
    fillSectionMenu(pop) {
        const starts = this.sectionStarts();
        const current = starts.findLast(mb => mb.index <= this.pos.bar);
        pop.innerHTML = starts.map(mb => `<button type="button" data-bar-goto="${mb.index}"
            aria-current="${mb === current}"><span>${escapeHtml(sectionName(mb.section))}</span>
            <span class="etool-pop-bar">Takt ${mb.index + 1}</span></button>`).join('')
            || '<button type="button" disabled>Keine Abschnitte</button>';
    }

    /**
     * Takte, mit denen ein Abschnitt beginnt.
     * @returns {import('../../types/alphatab').model.MasterBar[]} in Song-Reihenfolge
     */
    sectionStarts() {
        return this.score?.masterBars.filter(mb => sectionName(mb.section)) ?? [];
    }

    /**
     * Strg+Alt+←/→: Cursor an den Anfang des vorigen bzw. nächsten Abschnitts. Rückwärts zählt der Abschnitt am
     * Cursor erst, wenn der Cursor nicht schon auf seinem ersten Schlag steht.
     * @param {number} direction -1 zurück, 1 vor
     * @returns {void}
     */
    stepSection(direction) {
        const {bar, beat} = this.pos;
        const starts = this.sectionStarts().map(mb => mb.index);
        const target = direction > 0 ? starts.find(i => i > bar)
            : starts.findLast(i => i < bar || (i === bar && beat > 0));
        if (target !== undefined) this.moveTo({bar: target, beat: 0});
    }

    /**
     * Menü "Bereinigen", Eintrag "Akkorde": doppelte Akkorde entfernen und an jeden Abschnittsanfang den klingenden
     * setzen (chordCleanup() in notation.js; neue Akkorde in die Akkordspur). Ein Schritt für "Rückgängig"; gibt es
     * nichts zu tun, bleibt alles, wie es war.
     * @returns {void}
     */
    tidyChords() {
        const plan = edit.chordCleanup(this.score);
        if (!plan.repeated.length && !plan.missing.length) {
            this.toast('Akkorde sind schon bereinigt.');
            return;
        }
        this.change(() => {
            const {repeated, missing} = edit.chordCleanup(this.score);
            for (const beat of repeated) beat.chordId = null;
            const staff = this.score.tracks[this.contentTrack('chords')]?.staves[0];
            for (const {bar, name} of missing) {
                const beat = staff?.bars[bar]?.voices[0]?.beats[0];
                if (beat) this.setChordName(beat, name);
            }
        }, {label: 'Akkorde bereinigt'});
        const parts = [];
        if (plan.repeated.length) parts.push(`${plan.repeated.length} doppelte entfernt`);
        if (plan.missing.length) parts.push(`${plan.missing.length} am Abschnittsanfang gesetzt`);
        this.toast(`Akkorde: ${parts.join(', ')}.`);
    }

    /**
     * Menü "Bereinigen", Eintrag "Griffe prüfen": zeigt, wo die Noten der Akkordspur nicht zu ihrem Akkord passen
     * (chordNoteProblems() in chordcheck.js), und ersetzt die angehakten durch den Griff des Akkords (ein Schritt für
     * "Rückgängig"). Ein Klick auf eine Taktzahl setzt den Cursor dorthin.
     * @returns {Promise<void>}
     */
    async checkChordNotes() {
        const index = this.contentTrack('chords');
        const staff = this.score.tracks[index]?.staves[0];
        if (!staff || staff.tuning.length !== 6) {
            this.toast('Die Akkordspur hat keine sechs Saiten, dort gibt es keine Griffe zu prüfen.');
            return;
        }
        const library = await loadChordLibraryOrEmpty();
        const problems = chordNoteProblems(staff, library);
        if (!problems.length) {
            this.toast('Alle Noten der Akkordspur passen zu ihren Akkorden.');
            return;
        }
        const rows = problems.map((p, k) => {
            const bars = [...new Set(p.regions.map(r => r.bar))];
            const links = bars.slice(0, 30).map(b => `<button type="button" data-check-bar="${b}"
        title="Zu Takt ${b + 1}">${b + 1}</button>`).join(' ');
            const title = `${p.reason}. Gespielt: ${p.played}; ersetzen durch ${p.grip ? gripText(p.grip) : '– (kein Griff)'}`;
            return `<tr title="${escapeHtml(title)}">
        <td><input type="checkbox" data-check-row="${k}"${p.grip ? ' checked' : ' disabled'}
          aria-label="${escapeHtml(p.name)} ersetzen"></td>
        <td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.sounds || '–')}</td>
        <td class="check-bars">${links}${bars.length > 30 ? ` … (${bars.length})` : ''}</td></tr>`;
        }).join('');
        openOverlay(`<h2>Griffe prüfen</h2>
      <p>In der Spur „${escapeHtml(trackName(this.score.tracks[index]))}“ werden akkordfremde Noten gespielt:</p>
      <table class="ebar-table check-table"><thead><tr><th></th><th>Akkord</th><th>Klingt wie</th><th>Takte</th></tr>
        </thead><tbody>${rows}</tbody></table>
      <div class="struct-actions">
        <button class="btn btn-primary" type="button" id="checkReplace">Griffe anpassen</button>
        <button class="btn" type="button" id="checkClose">Schließen</button>
      </div>`);
        const boxes = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('[data-check-row]')]);
        const replace = /** @type {HTMLButtonElement} */ (document.getElementById('checkReplace'));
        const update = () => {
            replace.disabled = !boxes.some(b => b.checked);
        };
        boxes.forEach(b => b.addEventListener('change', update));
        update();
        document.getElementById('checkClose').addEventListener('click', closeOverlay);
        for (const link of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-check-bar]'))) {
            link.addEventListener('click', () => {
                closeOverlay();
                this.pos = {...this.pos, track: index};
                this.moveTo({bar: Number(link.dataset.checkBar), beat: 0});
            });
        }
        replace.addEventListener('click', () => {
            const keys = new Set(boxes.filter(b => b.checked).map(b => {
                const p = problems[Number(b.dataset.checkRow)];
                return `${p.name}|${p.sounds}`;
            }));
            closeOverlay();
            let count = 0;
            this.change(() => {
                const current = this.score.tracks[index].staves[0];
                const chosen = chordNoteProblems(current, library).filter(p => keys.has(`${p.name}|${p.sounds}`));
                count = replaceChordNotes(this.alphaTab, current, chosen);
            }, {label: 'Griffe ersetzt'});
            this.toast(`${count} ${count === 1 ? 'Schlag' : 'Schläge'} mit dem Griff des Akkords ersetzt.`);
        });
    }

    /**
     * Setzt einen Akkord an die Stelle des Schlags am Cursor, in der Akkordspur (chordBeat()); geht das dort nicht,
     * sagt es ein Hinweis.
     * @param {Beat} beat Schlag am Cursor
     * @param {string} name Akkordname, leer entfernt ihn
     * @returns {void}
     */
    setChordAt(beat, name) {
        const target = this.chordBeat(beat, true);
        if (target) this.setChordName(target, name);
        else this.toast('Hier kann die Akkordspur keinen Akkord tragen (Triole oder Vorschlag an dieser Stelle).');
    }

    /**
     * Setzt die Silbe (erste Strophe) an die Stelle des Schlags am Cursor, in der Textspur (syllableBeat()). Ein
     * Zeilenumbruch, der dort schon stand, bleibt; weitere Strophen bleiben ebenfalls.
     * @param {Beat} beat Schlag am Cursor
     * @param {string} syllable Silbe, leer entfernt sie
     * @returns {void}
     */
    setSyllableAt(beat, syllable) {
        const target = this.syllableBeat(beat, Boolean(syllable));
        if (!target) {
            if (syllable) this.toast('Hier kann die Textspur keine Silbe tragen (Triole oder Vorschlag an dieser Stelle).');
            return;
        }
        this.setSyllableOn(target, syllable);
    }

    /**
     * Nach einer Änderung an den Silben im linken Panel (setzen, löschen, T→/←T), solange der Text im Feld "Liedtext"
     * zu lang ist (lyricsOverflow): prüft auf einer Kopie, ob er jetzt auf die Noten passt. Dann ist er nicht mehr zu
     * lang, und das Feld zeigt wieder den Text der Noten; sonst bleibt er stehen, rot nach dem neuen Stand. Weiteres
     * Schreiben im Feld rechnet in beiden Fällen vom geänderten Stand aus (lyricsBase), nicht von dem davor.
     * @returns {void}
     */
    recheckLyrics() {
        const area = /** @type {?HTMLTextAreaElement} */ (this.part('edit-right')?.querySelector('[data-lyrics]'));
        const track = this.lyricsTarget();
        if (!this.lyricsOverflow || !area || !track) return;
        const probe = parseScore(this.alphaTab, this.tex, this.player.api.settings).tracks[track.index];
        const result = edit.setLyricsText(probe, area.value, this.lyricsSections(probe, area.value));
        this.lyricsBase = this.tex;
        if (result.left) {
            this.markLyricsProblems(area, area.value, result, track);
            return;
        }
        this.lyricsOverflow = false;
        this.fillLyrics();
    }

    /**
     * Abschnitte, nach denen ein Liedtext auf die Noten geht: die der Noten, wenn der Text Abschnittszeilen hat
     * ("[Verse]"); sonst keine, dann gilt er für den ganzen Song (z. B. aus einer Akkorddatei ohne Abschnitte).
     * @param {Track} track Spur mit dem Text
     * @param {string} text Liedtext
     * @returns {{t: number, start: number, name: string}[]}
     */
    lyricsSections(track, text) {
        return /^\s*\[[^\]]*]\s*$/m.test(text) ? lyricsSectionStarts(track.score, track) : [];
    }

    /**
     * Setzt die Silbe (erste Strophe) an einen Schlag der Textspur; ein Zeilenumbruch dort bleibt. Wird die letzte
     * Silbe einer Zeile gelöscht, geht ihr Umbruch auf die Silbe davor.
     * @param {Beat} target Schlag der Textspur (syllableBeat())
     * @param {string} syllable Silbe, leer entfernt sie
     * @returns {void}
     */
    setSyllableOn(target, syllable) {
        if (target.voice.bar.staff.track !== this.lyricsTarget() && !syllable) return;
        const lyrics = target.lyrics ? [...target.lyrics] : [''];
        const old = lyrics[0] ?? '';
        const lineEnd = old.endsWith(edit.LYRICS_BREAK);
        lyrics[0] = syllable ? syllable + (lineEnd ? edit.LYRICS_BREAK : '') : '';
        target.lyrics = lyrics.some(l => l) ? lyrics : null;
        if (syllable || !lineEnd) return;
        // Gelöscht am Zeilenende: Der Umbruch geht auf die Silbe davor, sonst verschmölze die Zeile mit der nächsten.
        // Endet die schon eine Zeile, hatte diese nur die eine Silbe und fällt weg.
        const time = beat => beat.voice.bar.masterBar.start + beat.playbackStart;
        const previous = target.voice.bar.staff.bars.flatMap(bar => bar.voices[0]?.beats ?? [])
            .findLast(b => time(b) < time(target) && b.lyrics?.[0]?.trim());
        if (previous && !previous.lyrics[0].endsWith(edit.LYRICS_BREAK)) {
            previous.lyrics = [previous.lyrics[0] + edit.LYRICS_BREAK, ...previous.lyrics.slice(1)];
        }
    }

    /**
     * Zieht die nächste Silbe links bzw. rechts vom Cursor (Textspur, erste Strophe) auf den Schlag am Cursor (Knöpfe
     * neben "Liedtext-Silbe"); ihr Zeilenumbruch geht mit, die Reihenfolge des Texts bleibt. Steht am Cursor schon eine
     * Silbe, rückt sie zur anderen Seite weiter (T→ nach rechts, ←T nach links), eine Silbe dort ebenso, bis zum
     * nächsten freien Schlag. Gibt es auf der Seite keine Silbe oder dahinter keinen freien Schlag, sagt ein Hinweis
     * es, und nichts ändert sich.
     * @param {-1|1} side -1 die linke, 1 die rechte
     * @returns {void}
     */
    pullSyllable(side) {
        const cursor = this.score ? edit.beatAt(this.score, this.pos) : null;
        const track = this.lyricsTarget();
        if (!cursor || !track) return;
        const time = beat => beat.voice.bar.masterBar.start + beat.playbackStart;
        const sung = beat => !!beat.lyrics?.[0]?.trim();
        const at = time(cursor);
        // Schläge, die eine Silbe tragen können (wie setLyricsText(): mit Note, nicht nur angebunden) oder eine haben.
        const slots = track.staves[0].bars.flatMap(bar => bar.voices[0]?.beats ?? [])
            .filter(b => (b.notes.length && !b.notes.every(n => n.isTieDestination)) || sung(b));
        const from = side < 0 ? slots.findLast(b => time(b) < at && sung(b)) : slots.find(b => time(b) > at && sung(b));
        if (!from) {
            this.toast(`${side < 0 ? 'Links' : 'Rechts'} vom Cursor steht keine Silbe.`);
            return;
        }
        // Belegt: Die Silben ab dem Cursor rücken zur anderen Seite bis zum ersten freien Schlag.
        const occupied = this.syllableBeat(cursor);
        /** @type {Beat[]} */
        let chain = [];
        if (occupied && sung(occupied) && occupied.voice.bar.staff.track === track) {
            const step = -side;
            let k = slots.indexOf(occupied);
            while (slots[k] && sung(slots[k])) k += step;
            if (!slots[k]) {
                this.toast(`Hier steht schon „${this.syllableAt(cursor)}“, und ${step > 0 ? 'rechts' : 'links'} davon `
                    + 'ist kein Schlag mehr frei.');
                return;
            }
            chain = slots.slice(Math.min(k, slots.indexOf(occupied)), Math.max(k, slots.indexOf(occupied)) + 1);
            if (step < 0) chain.reverse();
        }
        const moveSyllable = (source, target) => {
            const lyrics = target.lyrics ? [...target.lyrics] : [''];
            lyrics[0] = source.lyrics[0];
            target.lyrics = lyrics;
            const rest = [...source.lyrics];
            rest[0] = '';
            source.lyrics = rest.some(l => l) ? rest : null;
        };
        this.change(beat => {
            // Von hinten nach vorn: zuerst auf den freien Schlag, zuletzt wird der am Cursor frei.
            for (let i = chain.length - 1; i > 0; i--) moveSyllable(chain[i - 1], chain[i]);
            const target = this.syllableBeat(beat, true);
            if (!target) {
                this.toast('Hier kann die Textspur keine Silbe tragen (Triole oder Vorschlag an dieser Stelle).');
                return;
            }
            moveSyllable(from, target);
        });
        this.recheckLyrics();
    }

    /**
     * Silbe der Textspur an der Stelle des Schlags am Cursor, ohne Zeilenumbruch (für das Feld im linken Panel).
     * @param {Beat} beat Schlag am Cursor
     * @returns {string}
     */
    syllableAt(beat) {
        const target = this.syllableBeat(beat);
        if (!target || target.voice.bar.staff.track !== this.lyricsTarget()) return '';
        return (target.lyrics?.[0] ?? '').replace(edit.LYRICS_BREAK, '').trim();
    }

    /**
     * Stellt im Dialog "Spuren" um, welche Spur Akkorde bzw. Text trägt: Sie ziehen ganz in die gewählte Spur um
     * (moveContent() in notation.js). Probehalber auf frisch gelesenen Noten gerechnet: Ändert sich dabei nichts an
     * der Lage und fällt nichts weg, geschieht es ohne Rückfrage; sonst fragt ein Dialog, ob Schläge eingefügt
     * (geteilt und angebunden, klingt gleich) oder Akkorde bzw. Silben auf den Schlag davor gesetzt werden sollen.
     * Ohne Akkorde bzw. Text merkt sich der Editor nur die Wahl (contentChoice).
     * @param {'chords'|'lyrics'} kind Akkorde oder Text
     * @param {number} index Zielspur
     * @returns {void}
     */
    moveContentTo(kind, index) {
        const chords = kind === 'chords';
        const has = chords ? chordsTrack(this.score) : lyricsTrack(this.score);
        const name = `„${trackName(this.score.tracks[index])}“`;
        if (!has) {
            this.contentChoice[kind] = index;
            this.toast(chords ? `Neue Akkorde kommen in ${name}.` : `Der Liedtext kommt in ${name}.`);
            this.renderSongPanels();
            return;
        }
        /** @param {import('./notation.js').MoveMode} mode @returns {import('./notation.js').MoveResult} */
        const trial = mode => edit.moveContent(this.alphaTab, parseScore(this.alphaTab, this.tex), kind, index, mode);
        const shift = trial('shift');
        const insert = trial('insert');
        /** @param {import('./notation.js').MoveMode} mode @returns {void} */
        const apply = mode => {
            let result = shift;
            this.change(() => {
                result = edit.moveContent(this.alphaTab, this.score, kind, index, mode);
            }, {label: `${chords ? 'Akkorde' : 'Liedtext'} nach ${name} verschoben`});
            this.toast(`${chords ? 'Akkorde' : 'Liedtext'} jetzt in ${name}`
                + (result.split ? `; ${result.split} ${result.split === 1 ? 'Schlag' : 'Schläge'} geteilt` : '')
                + (result.shifted ? `; ${result.shifted} auf den Schlag davor gesetzt` : '') + '.');
        };
        if (!shift.shifted && !shift.lost && !shift.dropped) {
            apply('shift');
            return;
        }
        const noun = chords ? ['Akkord', 'Akkorde'] : ['Silbe', 'Silben'];
        const n = (count, [one, more]) => `${count} ${count === 1 ? one : more}`;
        const lost = r => r.lost ? ` ${n(r.lost, noun)} ${r.lost === 1 ? 'fällt' : 'fallen'} weg: Dort steht in ${name} `
            + 'schon ein anderer Akkord.' : '';
        const facts = [
            shift.exact ? `${n(shift.exact, noun)} ${shift.exact === 1 ? 'passt' : 'passen'} auf einen Schlag von ${name}.`
                : '',
            shift.shifted ? `${n(shift.shifted, noun)} ${shift.shifted === 1 ? 'liegt' : 'liegen'} dort mitten in einem `
                + 'Schlag.' : '',
            shift.dropped ? `${n(shift.dropped, noun)} in anderen Spuren ${shift.dropped === 1 ? 'wird' : 'werden'} gelöscht `
                + '(der Text steht danach nur noch in einer Spur).' : '',
        ].filter(Boolean);
        const options = shift.shifted ? [
            ['insert', 'Schläge einfügen', `Der klingende Schlag wird geteilt und angebunden, es klingt gleich `
            + `(${n(insert.split, ['Stelle', 'Stellen'])}).`
            + (insert.shifted ? ` ${n(insert.shifted, noun)} lassen sich nicht teilen (Triole) und kommen auf den Schlag `
                + 'davor.' : '') + lost(insert)],
            ['shift', 'Auf den Schlag davor', `${chords ? 'Der Akkord' : 'Die Silbe'} rutscht nach vorne auf den klingenden `
            + `Schlag.${chords ? '' : ' Silben auf einem Schlag werden zusammengefasst.'}` + lost(shift)],
        ] : [['shift', 'Verschieben', lost(shift).trim()]];
        openOverlay(`
      <h2>${chords ? 'Akkorde' : 'Liedtext'} nach ${escapeHtml(name)}</h2>
      <div class="struct-form">
        ${facts.map(f => `<p>${escapeHtml(f)}</p>`).join('')}
        ${options.map(([mode, label, hint]) => `
          <div class="move-option"><button class="btn${mode === options[0][0] ? ' btn-primary' : ''}" type="button"
            data-move="${mode}">${escapeHtml(label)}</button><span class="hint">${escapeHtml(hint)}</span></div>`)
            .join('')}
        <div class="struct-actions"><button class="btn" type="button" data-move="">Abbrechen</button></div>
      </div>`);
        for (const button of document.querySelectorAll('[data-move]')) {
            button.addEventListener('click', () => {
                const mode = /** @type {HTMLElement} */ (button).dataset.move;
                closeOverlay();
                if (mode) apply(/** @type {import('./notation.js').MoveMode} */ (mode));
                else this.renderSongPanels();
            });
        }
    }

    /**
     * Übernimmt Text und Akkorde einer hochgeladenen Akkorddatei (Knopf "Chord-Datei importieren", readChordFile() in
     * chordfile.js). Der Text kommt ins Feld "Liedtext" und wird auf die Schläge verteilt (applyLyrics()); das Feld ist
     * dabei leer, es gibt also keinen Text, der Vorrang hätte. Hat die Datei Taktstriche oder passen ihre Akkorde zu
     * denen der Noten, liegen die Silben daran (anchorLyrics() in notation.js), sonst der Reihe nach. Jeder Akkord kommt
     * an die Stelle seines Ankers bzw. an den Schlag seiner Silbe (in der Akkordspur, siehe chordBeat()), aber nur dort,
     * wo noch kein Akkord steht. Kennt der Akkordkatalog einen Akkord
     * nicht, steht ein einfacherer (simplifyChord()); die Griffe kommen aus dem Katalog (normalizeChords()). Namen, die
     * auch dann unbekannt sind (parseChord() liest sie nicht, z. B. "N.C."), werden nicht übernommen; die Meldung nennt sie.
     * @param {File} file ChordPro- oder Textdatei
     * @returns {Promise<void>}
     */
    async insertChordFileText(file) {
        const {text, chords} = readChordFile(await file.text());
        if (!text.trim()) {
            this.toast(`In ${file.name} wurde kein Text gefunden.`);
            return;
        }
        const area = /** @type {HTMLTextAreaElement} */ (this.part('edit-right').querySelector('[data-lyrics]'));
        area.value = text;
        // Auch wenn der Text zu lang ist (dann füllt fillLyrics() das Feld nicht neu): Der Knopf verschwindet.
        this.showChordFileButton();
        const applied = this.applyLyrics({marks: chords});
        this.lyricsTyping = false;
        if (!applied) return;
        // Bleibt der Text zu lang, rechnet weiteres Schreiben vom importierten Stand aus, nicht von dem davor.
        this.lyricsBase = this.tex;

        // Je Silbe des Textes (ohne "_", wie syllableRanges()) ihr Schlag in den Noten; null, wenn sie keinen bekam.
        const lyricTrack = this.score.tracks[applied.track.index];
        const beats = edit.splitLyricsBlocks(text).flatMap((block, i) => {
            const placed = applied.result.beats[i];
            return edit.splitSyllables(block.text).filter(Boolean).map((_, k) => placed[k]
                ? lyricTrack.staves[0].bars[placed[k].voice.bar.index].voices[0].beats[placed[k].index] : null);
        });
        const ranges = edit.syllableRanges(text);
        const library = await loadChordLibraryOrEmpty();
        const result = {
            placed: 0, kept: 0, lost: 0, simplified: /** @type {string[]} */ ([]),
            unknown: /** @type {string[]} */ ([])
        };
        /**
         * Erster Schlag der Textspur ab einer Zeit im selben Takt (Anker eines Akkords).
         * @param {number} tick Zeit in Ticks
         * @returns {?Beat}
         */
        const beatAt = tick => {
            const mb = this.score.masterBars.findLast(m => m.start <= tick);
            return lyricTrack.staves[0].bars[mb?.index ?? -1]?.voices[0]?.beats
                .find(b => mb.start + b.playbackStart >= tick) ?? null;
        };
        const named = chords.filter(c => c.name);
        // Klingt an der Stelle schon derselbe Akkord (z. B. "|G |G"), kommt kein zweiter dazu.
        const sounding = chordTimeline(parseScore(this.alphaTab, this.tex)).map(e => ({tick: e.tick, name: e.name}));
        const time = beat => beat.voice.bar.masterBar.start + beat.playbackStart;
        this.change(() => {
            for (const [j, {at, name, end}] of chords.entries()) {
                if (!name) continue;
                const tick = applied.anchors?.ticks[j] ?? null;
                const k = tick === null && !end ? ranges.findIndex(r => r.to > at) : -1;
                const source = tick !== null ? beatAt(tick) : beats[k] ?? null;
                if (!source) {
                    result.lost++;
                    continue;
                }
                const beat = this.chordBeat(source, true);
                if (!beat) {
                    result.lost++;
                    continue;
                }
                const before = sounding.findLast(e => e.tick <= time(beat));
                if (beat.chordId || before?.name === name) {
                    result.kept++;
                    continue;
                }
                const simple = simplifyChord(name, library);
                if (!parseChord(simple)) {
                    if (!result.unknown.includes(name)) result.unknown.push(name);
                    continue;
                }
                if (simple !== name && !result.simplified.includes(`${name} → ${simple}`)) result.simplified.push(`${name} → ${simple}`);
                this.setChordName(beat, simple);
                result.placed++;
                const at = time(beat);
                sounding.splice(sounding.filter(e => e.tick <= at).length, 0, {tick: at, name: simple});
            }
            normalizeChords(this.alphaTab, this.score, library);
        }, {label: 'Akkorde aus Chord-Datei übernommen'});
        this.fillLyrics();
        this.chordFileReport(file.name, text, applied, result, named.length);
    }

    /**
     * Meldung nach "Chord-Datei importieren": oben, was geschehen ist, darunter je Zeile, was nicht aufging (Silben ohne
     * Schlag mit Takt, fehlende Abschnitte, Akkorde, die nicht zu den Noten passen oder unbekannt sind). Gibt es so etwas,
     * ist es eine Warnung, die stehen bleibt, bis man sie schließt.
     * @param {string} name Dateiname
     * @param {string} text eingefügter Liedtext
     * @param {NonNullable<ReturnType<NoteEditor['applyLyrics']>>} applied Ergebnis von applyLyrics()
     * @param {{placed: number, lost: number, simplified: string[], unknown: string[]}} chords gesetzte Akkorde
     * @param {number} count Akkorde in der Datei
     * @returns {void}
     */
    chordFileReport(name, text, applied, chords, count) {
        const {anchors, result} = applied;
        const blocks = edit.splitLyricsBlocks(text);
        const nameOf = i => blocks[i].text.match(/^\s*\[([^\]]*)]/)?.[1] ?? 'Anfang';
        const quote = words => words.map(w => `„${w}“`).join(' ');
        /** @type {string[]} */
        const problems = [];
        /** @type {Map<number, string[]>} */
        const byBar = new Map();
        for (const {bar, text: word} of anchors?.lost ?? []) byBar.set(bar, [...byBar.get(bar) ?? [], word]);
        for (const [bar, words] of byBar) {
            problems.push(`Takt ${bar}: ${words.length === 1 ? 'Silbe' : 'Silben'} ${quote(words)} nicht zugeordnet`);
        }
        result.lefts.forEach((left, i) => {
            if (left > 0 && !result.missing[i] && (anchors?.lefts[i] ?? -1) < 0) {
                problems.push(`${nameOf(i)}: ${left} ${left === 1 ? 'Silbe' : 'Silben'} ohne Schlag (Text zu lang)`);
            }
        });
        result.missing.forEach((missing, i) => {
            if (missing) problems.push(`Abschnitt „${nameOf(i)}“ fehlt in den Noten, sein Text ist nicht übernommen`);
        });
        if (anchors?.loose.length) {
            problems.push(`Akkorde passen nicht zu den Noten in ${anchors.loose.join(', ')}: Text dort der Reihe nach`);
        }
        if (chords.lost) {
            problems.push(`${chords.lost} ${chords.lost === 1 ? 'Akkord' : 'Akkorde'} ohne Schlag nicht gesetzt`);
        }
        if (chords.unknown.length) problems.push(`Unbekannte Akkorde nicht übernommen: ${chords.unknown.join(', ')}`);
        const lines = [`${name}: Text eingefügt${chords.placed ? `, ${chords.placed} von ${count} Akkorden ergänzt` : ''}.`,
            ...problems.map(p => `• ${p}.`)];
        if (chords.simplified.length) lines.push(`Ersetzt: ${chords.simplified.join(', ')}.`);
        if (!/\S-\S/.test(text)) lines.push('Mehrsilbige Wörter noch mit Bindestrich trennen (Lie-der-buch).');
        this.toast(lines.join('\n'), {warn: problems.length > 0});
    }

    /**
     * Dialog "Melodie ableiten" (Knopf im Dialog "Spuren", über ihm geöffnet): Hinweis, dass die höchsten Töne mit
     * Liedtext übernommen werden, der Schalter "Tonhöhe mit Hilfe der Audiospur korrigieren" (an, wenn der Song eine
     * Audiospur mit Sync-Punkten hat; sonst gesperrt, der Grund im Tooltip) und wie bei "Rhythmus ableiten" die
     * Radiobuttons "Spur neu anlegen" / "Spur überschreiben".
     * @param {number} index Spur, aus der die Melodie kommt
     * @returns {void}
     */
    openMelodyDialog(index) {
        if (!lyricsTrack(this.score)) {
            this.toast('Der Song hat keinen Liedtext: Die Melodie richtet sich nach den Silben.');
            return;
        }
        const synced = this.player.hasAudio && edit.playbackSyncPoints(this.alphaTab, this.score).length > 0;
        const why = !this.player.hasAudio ? 'Keine Audiospur vorhanden.'
            : !synced ? 'Die Audiospur ist noch nicht mit den Noten synchronisiert.' : '';
        const html = `<h2>Melodie ableiten aus „${escapeHtml(trackName(this.score.tracks[index]))}“</h2>
      <p class="rh-hint">Höchste Töne mit Liedtext werden übernommen.</p>
      <label class="rh-switch md-switch" title="${escapeHtml(why)}"><input type="checkbox" role="switch" class="switch"
        id="mdAudio" ${synced ? 'checked' : 'disabled'}> Tonhöhe mit Hilfe der Audiospur korrigieren</label>
      <div class="rh-target" role="radiogroup" aria-label="Wohin die Melodie kommt">
        <label><input type="radio" name="mdTarget" value="new" checked> Spur neu anlegen</label>
        <label><input type="radio" name="mdTarget" value="overwrite"> Spur überschreiben</label>
      </div>
      <div class="struct-actions">
        <button class="btn btn-primary" type="button" id="mdApply">Übernehmen</button>
        <button class="btn" type="button" id="mdCancel">Abbrechen</button>
      </div>`;
        if (isOverlayOpen()) openStackedOverlay(html);
        else openOverlay(html);
        document.getElementById('mdCancel').addEventListener('click', closeOverlay);
        document.getElementById('mdApply').addEventListener('click', () => {
            const audio = /** @type {HTMLInputElement} */ (document.getElementById('mdAudio')).checked;
            const overwrite = /** @type {?HTMLInputElement} */ (document.querySelector('input[name="mdTarget"]:checked'))
                ?.value === 'overwrite';
            closeOverlay();
            void this.deriveMelody(index, audio, overwrite);
        });
    }

    /**
     * Leitet die Akkorde des ganzen Songs aus einer Spur ab (deriveChords() in chorddetect.js), mit audio zusätzlich
     * aus der Audiospur (Schalter im Dialog "Rhythmus ableiten"), samt Griffen: Akkorde, die der Song schon hat,
     * behalten ihren Griff; neue bekommen den ersten des Katalogs, ohne den den einfachsten berechneten (findGrips()),
     * wie der Dialog "Akkord" ihn vorschlägt. Eine einstimmige Spur (z. B. die Melodie) ohne Audiospur wird abgelehnt.
     * @param {number} index Spur, aus der abgeleitet wird
     * @param {boolean} audio Audiospur einbeziehen
     * @returns {Promise<{chords: {tick: number, name: string}[], grips: Map<string, string>}|{error: string}>}
     *   Akkordwechsel (Ticks in Notenreihenfolge) und Griff je Name; sonst der Grund, warum es keine gibt
     */
    async songChordsFrom(index, audio) {
        const at = this.alphaTab;
        const source = this.score.tracks[index];
        if (!audio && !hasHarmony(source)) {
            return {error: 'In dieser Spur klingt meist nur ein Ton (z. B. die Melodie). Dafür die Audiospur einschalten.'};
        }
        let clock = null;
        if (audio) {
            try {
                clock = {samples: await decodeAudio(await loadAudio(this.player.slug)), msAt: audioClock(at, this.score)};
            } catch (err) {
                return {error: err.message};
            }
            if (!clock.msAt) return {error: 'Die Audiospur ist noch nicht mit den Noten synchronisiert.'};
        }
        const used = new Set(edit.mergeChords(this.score).map(m => m.chord.name));
        const chords = deriveChords(this.score, source, used, clock);
        if (!chords.length) return {error: 'In dieser Spur klingen keine Töne.'};
        const staff = source.staves[0];
        const library = await loadChordLibraryOrEmpty();
        const tuning = [...staff.tuning].reverse();
        /** @type {Map<string, string>} */
        const grips = new Map([...new Set(chords.map(c => c.name))].map(name => [name,
            this.songChordGrip(name, staff.tuning.length)
            || (isStandardTuning(staff) ? library[chordKey(name)]?.[0] : '')
            || findGrips(name, {tuning})[0]?.grip || '']));
        return {chords, grips};
    }

    /**
     * Ersetzt alle Akkorde des Songs durch abgeleitete (songChordsFrom()): Sie kommen in eine Spur, je an den Schlag
     * ihrer Stelle (beginnt dort keiner, wird geteilt und angebunden), mit ihren Griffen. Für eine Änderung in
     * change() bzw. changeTracks().
     * @param {Score} score Noten, werden geändert
     * @param {Track} track Spur, die die Akkorde bekommt
     * @param {{tick: number, name: string}[]} chords Akkordwechsel (Ticks in Notenreihenfolge)
     * @param {Map<string, string>} grips Griff je Name ("" für keinen)
     * @returns {number} Akkorde ohne Schlag (Triole oder Vorschlag an der Stelle)
     */
    placeSongChords(score, track, chords, grips) {
        for (const t of score.tracks) for (const st of t.staves) {
            for (const bar of st.bars) for (const voice of bar.voices) for (const beat of voice.beats) beat.chordId = null;
            st.chords?.clear();
        }
        let lost = 0;
        for (const {tick, name} of chords) {
            const mb = score.masterBars.findLast(m => m.start <= tick);
            const beat = mb ? this.beatAtTick(track.staves[0], mb, tick - mb.start) : null;
            if (beat) this.setChordName(beat, name);
            else lost++;
        }
        for (const [name, grip] of grips) if (grip) this.setChordGrip(track.staves[0], name, grip);
        return lost;
    }

    /**
     * Schlag einer Stimme 1, der an einer Stelle beginnt; beginnt dort keiner, wird der klingende geteilt und angebunden
     * (klingt gleich, splitBeat() in notation.js).
     * @param {import('../../types/alphatab').model.Staff} staff Notensystem
     * @param {import('../../types/alphatab').model.MasterBar} mb Takt
     * @param {number} offset Ticks ab Taktanfang
     * @returns {?Beat} null, wenn sich dort nicht teilen lässt (Triole, Vorschlag)
     */
    beatAtTick(staff, mb, offset) {
        const voice = staff.bars[mb.index]?.voices[0];
        const found = voice?.beats.find(b => b.playbackStart === offset);
        if (found || !voice) return found ?? null;
        const sounding = edit.timeline(voice).find(e => e.start < offset && offset < e.end);
        const split = sounding ? edit.splitBeat(this.alphaTab, sounding.beat, offset - sounding.start) : null;
        if (split) voice.bar.finish(new this.alphaTab.Settings());
        return split;
    }

    /**
     * Legt die Spur "Melodie" an bzw. überschreibt die Quellspur damit (deriveMelodyTrack() in notation.js; Stelle,
     * Name und Instrument bleiben); mit audio setzt danach die Erkennung aus der
     * Audiospur die Tonhöhe jeder Silbe (detectMelody(), applyMelody() in pitchdetect.js). Beides ist ein Schritt für
     * "Rückgängig". Die Meldung ist kurz: "Melodie erfolgreich abgeleitet."; ging die Erkennung nicht ganz, bleibt die
     * Spur, und eine Warnung sagt warum; ohne Spur sagt eine Warnung, warum keine angelegt wurde.
     * @param {number} index Spur, aus der die Melodie kommt
     * @param {boolean} audio Tonhöhe aus der Audiospur
     * @param {boolean} overwrite Quellspur überschreiben statt eine neue anzulegen
     * @returns {Promise<void>}
     */
    async deriveMelody(index, audio, overwrite) {
        const at = this.alphaTab;
        /** @type {?Float32Array} */
        let samples = null;
        let failed = '';
        // Solange die Audiospur ausgewertet wird, liegt eine Fläche mit Hinweis über allem.
        const done = audio ? await showBusy('Audiospur wird ausgewertet …') : () => {};
        let result = null;
        try {
            if (audio) {
                try {
                    samples = await decodeAudio(await loadAudio(this.player.slug));
                } catch (err) {
                    failed = err.message;
                }
            }
            const target = overwrite ? index : null;
            this.changeTracks(score => {
                result = edit.deriveMelodyTrack(at, t => parseScore(at, t), this.tex, score, index, target);
            }, target ?? this.score.tracks.length, 0, 'Melodie abgeleitet');
            if (result && samples) {
                try {
                    const melody = this.score.tracks[target ?? this.score.tracks.length - 1];
                    const {notes, pitches} = detectMelody(at, this.score, melody, samples);
                    let set = 0;
                    this.change(() => {
                        set = applyMelody(notes, pitches);
                    }, {merge: true});
                    if (set < notes.length) failed = `${notes.length - set} Silben ohne passenden Ton auf der Gitarre.`;
                } catch (err) {
                    failed = err.message;
                }
            }
        } finally {
            done();
        }
        if (!result) this.toast('Keine Melodie abgeleitet: Der Song hat keinen Liedtext.', {warn: true});
        else if (failed) this.toast(`Melodie abgeleitet, die Tonhöhe aber nicht ganz aus der Audiospur:\n• ${failed}`,
            {warn: true});
        else this.toast('Melodie erfolgreich abgeleitet.');
    }

    /**
     * Übernimmt eine Spur aus einer anderen Guitar-Pro-Datei (Knopf "Spur aus GuitarPro-Datei importieren"): Die Datei wird wie beim
     * Import gelesen und bereinigt (readGpFile() in notation.js), dann fragt ein Dialog nach der Spur und den Takten, ab
     * denen sie passt (der Song kann z. B. ein kürzeres Intro haben). Die Spur kommt ans Ende, ohne Akkorde und Text
     * (edit.importTrack()).
     * @param {File} file gewählte Datei
     * @returns {Promise<void>}
     */
    async importTrackFile(file) {
        let tex = '';
        let loss = null;
        try {
            ({tex, loss} = await readGpFile(file));
        } catch (err) {
            this.toast(err.message);
            return;
        }
        const parse = () => parseScore(this.alphaTab, tex);
        const source = parse();
        const bars = this.score.masterBars.length;
        openOverlay(`
      <h2>Spur aus ${escapeHtml(file.name)}</h2>
      <form class="struct-form" id="trackImportForm">
        <div class="form-field"><label for="trackImportTrack">Spur</label>
          <select id="trackImportTrack">${source.tracks.map(t => `<option value="${t.index}">${escapeHtml(trackName(t))}
            (${t.staves[0].bars.length} Takte)</option>`).join('')}</select></div>
        <div class="form-field"><label for="trackImportFrom">Ab Takt der Datei</label>
          <input type="number" id="trackImportFrom" min="1" max="${source.masterBars.length}" value="1"></div>
        <div class="form-field"><label for="trackImportAt">Auf Takt des Songs</label>
          <input type="number" id="trackImportAt" min="1" max="${bars}" value="1"></div>
        <p class="hint">Taktart, Tempo, Vorzeichen und Abschnitte bleiben die des Songs; Takte davor werden Pausen, was über das
          Ende (${bars} Takte) hinausgeht, fällt weg. Akkorde und Text der Datei kommen nicht mit.</p>
        ${loss?.length ? `<p class="hint">${escapeHtml(describeScoreLoss(loss))}</p>` : ''}
        <div class="struct-actions">
          <button class="btn btn-primary" type="submit">Übernehmen</button>
          <button class="btn" type="button" id="trackImportCancel">Abbrechen</button>
        </div>
      </form>`);
        document.getElementById('trackImportCancel').addEventListener('click', closeOverlay);
        document.getElementById('trackImportForm').addEventListener('submit', e => {
            e.preventDefault();
            const value = id => Number(/** @type {HTMLInputElement} */ (document.getElementById(id)).value);
            const index = value('trackImportTrack');
            const from = Math.max(1, value('trackImportFrom') || 1) - 1;
            const at = Math.min(bars, Math.max(1, value('trackImportAt') || 1)) - 1;
            closeOverlay();
            let result = {bars: 0, cut: 0, misfit: [], octaves: 0, misses: 0};
            // Frisch gelesen: importTrack() hängt die Takte der Quelle um.
            this.changeTracks(score => {
                    result = edit.importTrack(this.alphaTab, score, parse().tracks[index], from, at);
                },
                this.score.tracks.length, 0, 'Spur aus Guitar-Pro-Datei übernommen');
            const misfit = result.misfit.length ? `; Länge passt nicht zur Taktart in Takt `
                + `${result.misfit.slice(0, 8).map(i => i + 1).join(', ')}${result.misfit.length > 8 ? ' …' : ''}` : '';
            this.toast(`Spur „${trackName(this.score.tracks.at(-1))}“ übernommen: ${result.bars} Takte`
                + (result.cut ? `, ${result.cut} am Ende weggefallen` : '') + misfit
                + (result.octaves ? `; ${result.octaves} Noten für den Capo eine Oktave höher` : '')
                + (result.misses ? `; ${result.misses} Noten passten nicht ins Tuning des Songs` : '') + '.');
        });
    }

    /**
     * Setzt den Griff eines Akkords in einem Notensystem (Griffbild mit erstem Bund und Barré).
     * @param {import('../../types/alphatab').model.Staff} staff Notensystem
     * @param {string} name Akkordname
     * @param {string} grip Griff, tiefe Saite zuerst, z. B. "x02210"
     * @returns {boolean} ob es den Akkord gab und der Griff gültig war
     */
    setChordGrip(staff, name, grip) {
        const chord = [...staff.chords?.values() ?? []].find(c => c.name === name);
        const frets = parseGrip(grip);
        if (!chord || frets.length !== staff.tuning.length) return false;
        chord.strings = [...frets].reverse();
        chord.firstFret = diagramFirstFret(frets);
        const barre = barreFret(frets);
        chord.barreFrets = barre === null ? [] : [barre];
        chord.showDiagram = true;
        return true;
    }

    /**
     * Lädt die Noten zum Bearbeiten und zeichnet sie in die Notenansicht des Players. Der Cursor steht am Anfang auf
     * der obersten Saite der ersten angezeigten Spur mit Saiten.
     * @returns {Promise<void>}
     */
    async load() {
        const player = this.player;
        const api = player.api;
        this.display = {score: api.score, tracks: api.tracks.map(t => t.index)};
        this.trackIndexes = [...this.display.tracks];
        const loadingText = loadScoreText(player.slug);
        const loadingSheet = loadLeadsheet(player.slug).catch(err => {
            this.toast(err.message);
            return null;
        });
        const tex = await loadingText;
        const sheet = await loadingSheet;
        if (!this.parts.length) return;
        // Die Baustelle steht in song.json; die Spurnamen laufen im Editor mit, damit Umbenennen sie nachzieht.
        this.setSheet(JSON.stringify({...sheet, wip: findSong(player.slug)?.wip?.tracks ?? []}));
        this.savedSheet = this.sheetJson();
        this.wipAtLoad = [...this.sheet.wip];
        void this.leadsheetTab.loadCatalog();
        // Das Raster der Schläge (boundsLookup) ist erst nach postRenderFinished vollständig, beim ersten Zeichnen kommt
        // renderFinished davor.
        // Beim Schreiben in einem Feld (z. B. Liedtext) rollt die Seite nicht zum Cursor.
        const redraw = () => this.drawCursor(!document.activeElement?.matches('input, textarea, select'));
        // Beim Abspielen wandert die Silbe im Liedtext und in der Vorschau mit (einmal je Bild, perFrame()).
        const follow = perFrame((/** @type {number} */ tick) => this.followPlayback(tick));
        const offs = [api.renderFinished.on(redraw), api.postRenderFinished.on(redraw),
            api.playerPositionChanged.on(e => follow(e.currentTick))];
        this.offRender = () => offs.forEach(off => off());
        this.cursorEl = document.createElement('div');
        this.cursorEl.className = 'edit-cursor';
        this.cursorEl.innerHTML = '<div class="edit-problems"></div><div class="edit-selection"></div><div class="edit-cursor-beat"></div>'
            + '<div class="edit-cursor-string"></div>';
        player.el.at.append(this.cursorEl);
        this.onPointer = e => this.handlePointer(e);
        player.el.at.addEventListener('pointerdown', this.onPointer);
        player.editor = this;
        // Ein im Player zum Wiederholen gewählter Bereich gilt hier nicht (der Klick wählt im Modus Noten aus).
        player.clearLoopRange();
        // Bearbeitet wird mit Tabs: Das Menü "Ansicht" in der Leiste unten bietet nur "Tabs" und "Noten + Tabs".
        for (const b of player.el.viewPop.querySelectorAll('[data-view="score"], [data-view="chords"]')) b.hidden = true;
        this.savedTex = writeScore(this.alphaTab, parseScore(this.alphaTab, tex));
        const score = parseScore(this.alphaTab, tex);
        const first = this.trackIndexes.find(i => score.tracks[i]?.staves[0]?.isStringed) ?? this.trackIndexes[0] ?? 0;
        this.pos = {track: first, bar: 0, beat: 0, string: score.tracks[first]?.staves[0]?.tuning.length || 1};
        this.setTex(this.savedTex);
        if (!this.part('edit-bottom').classList.contains('collapsed')) void this.openSync();
    }

    /**
     * Stellt die Abspielposition auf den Schlag am Cursor, solange nicht gespielt wird. Fehlt noch das MIDI zu den
     * gezeichneten Noten (tickCache), bleibt die Position, wie sie ist.
     * @returns {void}
     */
    seekToCursor() {
        const api = this.player.api;
        if (this.player.isPlaying || !this.score) return;
        const beat = edit.beatAt(this.score, this.pos);
        const ticks = api.tickCache;
        let tick = beat && ticks ? ticks.getBeatStart(beat) : undefined;
        // Beim Wiederholen beginnt es am Cursor, wenn er im Bereich steht, sonst am Anfang des Bereichs.
        const range = api.isLooping ? api.playbackRange : null;
        if (range && tick !== undefined && (tick < range.startTick || tick >= range.endTick)) tick = range.startTick;
        if (tick !== undefined && tick !== api.tickPosition) api.tickPosition = tick;
    }

    /**
     * Wiederholen im Bearbeitungsmodus (Knopf des Players, beim Drücken von "Play"): die ausgewählten Takte
     * (Strg+Umschalt+←/→, auch die Takte ausgewählter Schläge), ohne Auswahl der Takt am Cursor.
     * @returns {void}
     */
    applyLoop() {
        const api = this.player.api;
        const ticks = api.tickCache;
        if (!api.isLooping || this.player.isPlaying || !this.score || !ticks) return;
        const sel = this.selection ?? this.beatSelection;
        const from = !sel ? this.pos.bar : typeof sel.from === 'number' ? sel.from : sel.from.bar;
        const to = !sel ? this.pos.bar : typeof sel.to === 'number' ? sel.to : sel.to.bar;
        const bars = this.score.masterBars;
        api.playbackRange = {
            startTick: ticks.getMasterBarStart(bars[from]),
            endTick: ticks.getMasterBarStart(bars[to]) + bars[to].calculateDuration(),
        };
    }

    /**
     * Setzt den Cursor auf den Schlag an einer Abspielposition (Klick in die Wellenform), nicht beim Abspielen.
     * @param {number} tick MIDI-Tick in Abspielreihenfolge
     * @returns {void}
     */
    cursorToTick(tick) {
        const ticks = this.player.api?.tickCache;
        if (this.player.isPlaying || !this.score || !ticks) return;
        const found = ticks.findBeat(new Set([this.pos.track]), tick)?.beat
            ?? ticks.findBeat(new Set(this.trackIndexes), tick)?.beat;
        if (!found) return;
        // Der Cursor zählt in der ersten Stimme.
        const bar = found.voice.bar;
        const beat = found.voice.index === 0 ? found : bar.voices[0]?.beats.findLast(b => b.playbackStart <= found.playbackStart);
        if (!beat) return;
        this.moveTo({track: bar.staff.track.index, bar: bar.index, beat: beat.index});
    }

    /**
     * Übernimmt einen Stand der Noten: einlesen, Cursor in Grenzen halten, zeichnen.
     * @param {string} tex alphaTex
     * @returns {void}
     */
    setTex(tex) {
        const api = this.player.api;
        this.tex = tex;
        this.score = parseScore(this.alphaTab, tex, api.settings);
        this.fileFlags = new WeakMap(this.score.tracks.flatMap(t => t.staves)
            .map(st => [st, STAFF_FLAGS.map(f => st[f])]));
        this.player.applyStave(this.score);
        this.fileShortNames = new WeakMap(this.score.tracks.map(t => [t, t.shortName]));
        this.fileStyle = TRACK_NAME_STYLE.map(f => this.score.stylesheet[f]);
        edit.markWip(this.score, this.sheet.wip);
        showTrackNames(this.alphaTab, this.score);
        // Gezeigt werden nur Spuren, die es gibt (nach Löschen oder Rückgängig), mindestens eine.
        this.trackIndexes = this.trackIndexes.filter(i => i < this.score.tracks.length);
        if (!this.trackIndexes.length) this.trackIndexes = [0];
        if (!this.trackIndexes.includes(this.pos.track)) this.pos = {...this.pos, track: this.trackIndexes[0]};
        this.pos = edit.clampPosition(this.score, this.pos);
        // Zeilenumbrüche der Ansicht.
        this.player.setBarsPerRow(this.sheet.barsPerRow, false);
        this.player.applyBarsLayout(this.score);
        api.renderScore(this.score, this.trackIndexes);
        // Die Audiospur folgt den Sync-Punkten der bearbeiteten Noten (auch nach Rückgängig).
        this.player.mixer?.setScore(this.score);
        this.sync?.reload();
        showScoreLength(this.audioLengths, edit.scoreDuration(this.alphaTab, this.score));
        this.updateState();
        this.renderSongPanels();
        this.fillSongFields();
    }

    /**
     * Setzt die Höhe des unteren Panels (Inhalt unter der Kopfzeile), in Grenzen.
     * @param {number} height Höhe in px
     * @returns {number} gesetzte Höhe
     */
    setBottomHeight(height) {
        const h = Math.round(Math.max(BOTTOM_MIN_H, Math.min(window.innerHeight * BOTTOM_MAX_SHARE, height)));
        this.part('edit-bottom').style.setProperty('--edit-bottom-body-h', `${h}px`);
        return h;
    }

    /**
     * Ziehen am oberen Rand des unteren Panels ändert seine Höhe; sie gilt danach für alle Songs.
     * @param {PointerEvent} e Drücken auf den Rand
     * @returns {void}
     */
    startBottomResize(e) {
        e.preventDefault();
        const bottom = this.part('edit-bottom');
        if (bottom.classList.contains('collapsed')) this.togglePanel('bottom');
        const body = /** @type {HTMLElement} */ (bottom.querySelector('.edit-bottom-body'));
        const startY = e.clientY;
        const startH = body.offsetHeight;
        let height = startH;
        /** @param {PointerEvent} event Bewegung */
        const move = event => {
            height = this.setBottomHeight(startH + startY - event.clientY);
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            const state = loadCollapsed();
            state.bottomH = height;
            try {
                localStorage.setItem(PANELS_KEY, JSON.stringify(state));
            } catch (err) {
                // Ohne Speicher (privates Fenster) gilt die Höhe nur bis zum Schließen.
            }
            this.relayout();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, {once: true});
    }

    /**
     * Setzt die Höhe des Textfelds im rechten Panel (darunter die Vorschau), in Grenzen.
     * @param {number} [height] Höhe in px; ohne Angabe teilt sich der Platz zu gleichen Teilen
     * @returns {number} gesetzte Höhe, 0 ohne Angabe
     */
    setLyricsHeight(height) {
        const body = this.part('edit-right').querySelector('.elyrics');
        if (height === undefined) {
            body.style.removeProperty('--elyrics-h');
            return 0;
        }
        const room = body.clientHeight - LYRICS_VIEW_MIN_H;
        const h = Math.round(Math.max(LYRICS_MIN_H, room > LYRICS_MIN_H ? Math.min(room, height) : height));
        body.style.setProperty('--elyrics-h', `${h}px`);
        return h;
    }

    /**
     * Setzt die Breite des rechten Panels, in Grenzen.
     * @param {number} [width] Breite in px; ohne Angabe gilt die Breite aus dem CSS
     * @returns {number} gesetzte Breite, 0 ohne Angabe
     */
    setRightWidth(width) {
        if (width === undefined) {
            this.songView.style.removeProperty('--edit-right-w');
            return 0;
        }
        const w = Math.round(Math.max(RIGHT_MIN_W, Math.min(window.innerWidth * RIGHT_MAX_SHARE, width)));
        this.songView.style.setProperty('--edit-right-w', `${w}px`);
        return w;
    }

    /**
     * Ziehen am linken Rand des rechten Panels ändert seine Breite; sie gilt danach für alle Songs.
     * @param {PointerEvent} e Drücken auf den Rand
     * @returns {void}
     */
    startRightResize(e) {
        e.preventDefault();
        const startX = e.clientX;
        const startW = this.part('edit-right').offsetWidth;
        let width = startW;
        /** @param {PointerEvent} event Bewegung */
        const move = event => {
            width = this.setRightWidth(startW + startX - event.clientX);
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            const state = loadCollapsed();
            state.rightW = width;
            try {
                localStorage.setItem(PANELS_KEY, JSON.stringify(state));
            } catch (err) {
                // Ohne Speicher (privates Fenster) gilt die Breite nur bis zum Schließen.
            }
            this.relayout();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, {once: true});
    }

    /**
     * Ziehen an der Linie zwischen Textfeld und Vorschau im rechten Panel ändert die Höhen; sie gelten danach für alle
     * Songs.
     * @param {PointerEvent} e Drücken auf die Linie
     * @returns {void}
     */
    startLyricsResize(e) {
        e.preventDefault();
        const edit = /** @type {HTMLElement} */ (this.part('edit-right').querySelector('.elyrics-edit'));
        const startY = e.clientY;
        const startH = edit.offsetHeight;
        let height = startH;
        /** @param {PointerEvent} event Bewegung */
        const move = event => {
            height = this.setLyricsHeight(startH + event.clientY - startY);
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            const state = loadCollapsed();
            state.lyricsH = height;
            try {
                localStorage.setItem(PANELS_KEY, JSON.stringify(state));
            } catch (err) {
                // Ohne Speicher (privates Fenster) gilt die Höhe nur bis zum Schließen.
            }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, {once: true});
    }

    /**
     * Zeigt im unteren Panel den Sync-Editor (wie außerhalb des Modus unter den Noten, aber eingebettet), sobald die
     * Audiospur geladen ist. Seine Änderungen sind Änderungen an den Noten (syncEdited()).
     * @returns {Promise<void>}
     */
    async openSync() {
        const tab = /** @type {HTMLElement} */ (this.part('edit-bottom').querySelector('[data-audio]'));
        const sync = /** @type {HTMLElement} */ (tab.querySelector('[data-audio-sync]'));
        if (this.sync || tab.dataset.started) return;
        tab.dataset.started = '1';
        const seconds = this.player.hasAudio ? await this.player.audioDuration : 0;
        if (!this.parts.length) return;
        if (!seconds || !this.player.mixer) {
            // Ohne Audiospur steht der Hinweis schon bei der Quelle (renderAudioSource()).
            sync.innerHTML = this.player.hasAudio ? '<p class="efield-hint">Die Audiospur konnte nicht geladen werden.</p>' : '';
            return;
        }
        sync.innerHTML = '';
        this.sync = new SyncEditor(sync, this.player, {
            onEdit: merge => this.syncEdited(merge),
            onSeek: tick => this.cursorToTick(tick)
        });
        try {
            await this.sync.open();
            // Quelle und Längen rücken in Werkzeugleiste und Statuszeile des Editors: alles in einer Zeile.
            this.sync.embed(/** @type {HTMLElement} */ (tab.querySelector('[data-audio-source]')),
                /** @type {HTMLElement} */ (tab.querySelector('[data-audio-lengths]')));
            tab.querySelector('.eaudio-head').remove();
        } catch (err) {
            this.sync.destroy();
            this.sync = null;
            sync.innerHTML = `<p class="efield-hint">${escapeHtml('Sync-Editor: ' + err.message)}</p>`;
        }
    }

    /**
     * Schreibt die bearbeiteten Noten als alphaTex, mit den Anzeige-Einstellungen aus der Datei statt denen der
     * Ansicht (sonst gälte schon das Umschalten der Ansicht als Änderung und käme mit in die Datei). Das gilt auch für
     * die Spurnamen links neben den Noten (showTrackNames()): Kurzname und Darstellung gehören der Ansicht.
     * @returns {string} alphaTex
     */
    writeTex() {
        const staves = this.score.tracks.flatMap(t => t.staves).filter(st => this.fileFlags.has(st));
        const shown = staves.map(st => STAFF_FLAGS.map(f => st[f]));
        staves.forEach(st => STAFF_FLAGS.forEach((f, i) => {
            st[f] = this.fileFlags.get(st)[i];
        }));
        const sheet = this.score.stylesheet;
        const names = this.score.tracks.map(t => t.shortName);
        const style = TRACK_NAME_STYLE.map(f => sheet[f]);
        this.score.tracks.forEach(t => {
            t.shortName = this.fileShortNames.get(t) ?? t.shortName;
        });
        TRACK_NAME_STYLE.forEach((f, i) => {
            sheet[f] = this.fileStyle[i];
        });
        try {
            return writeScore(this.alphaTab, this.score);
        } finally {
            this.score.tracks.forEach((t, k) => {
                t.shortName = names[k];
            });
            TRACK_NAME_STYLE.forEach((f, i) => {
                sheet[f] = style[i];
            });
            staves.forEach((st, k) => STAFF_FLAGS.forEach((f, i) => {
                st[f] = shown[k][i];
            }));
        }
    }

    /**
     * Übernimmt eine Änderung aus dem Sync-Editor als Schritt für "Rückgängig". Er ändert die Noten (Sync-Punkte,
     * Tempi) direkt; neu eingelesen und gezeichnet wird nicht, das Bild bleibt gleich.
     * @param {boolean} [merge] mit dem letzten Schritt zusammenfassen (weitere Änderungen im Zahlenfeld)
     * @returns {void}
     */
    syncEdited(merge = false) {
        const tex = this.writeTex();
        if (tex === this.tex) return;
        if (merge && this.undoStack.length) this.redoStack = [];
        else this.pushUndo(this.snapshot(), 'Sync-Punkte geändert');
        this.tex = tex;
        this.updateState();
        this.fillSongFields();
    }

    /**
     * Ändert den Schlag am Cursor (oder die Noten) und übernimmt das Ergebnis: als alphaTex schreiben, neu einlesen,
     * zeichnen. Der Stand davor kommt auf "Rückgängig". Ändert sich nichts, bleibt alles, wie es war.
     *
     * Ohne label ist es eine Änderung am Takt des Cursors ("Takt 12 geändert"). Kommt sie aus dem linken Panel, gehört
     * sie zum letzten Schritt, wenn der ebenfalls aus dem linken Panel im selben Takt kam (pushUndo()). Änderungen über
     * mehrere Takte oder am ganzen Song geben ein label mit und sind immer ein eigener Schritt.
     * @param {function(Beat): *} fn Änderung am Schlag; das Modell darf sie direkt ändern
     * @param {{merge?: boolean, pos?: Object, label?: string}} [options] merge: mit dem letzten Schritt zusammenfassen
     *   (zweite Ziffer eines Bunds); pos: Cursor danach (Teile von EditPosition); label: was sich geändert hat
     *   (Tooltip von Rückgängig)
     * @returns {void}
     */
    change(fn, {merge = false, pos = null, label = ''} = {}) {
        const beat = this.score ? edit.beatAt(this.score, this.pos) : null;
        if (!beat) return;
        const {track, bar} = this.pos;
        // Tab-Stellen (Angaben für das Leadsheet) hängen am Index der Takte und am Namen der Spur. Die Änderung arbeitet am Modell,
        // eingefügte Takte sind neue, gelöschte fehlen danach, die übrigen Takte und Spuren bleiben dieselben Objekte: So
        // lassen sich neuer Index und Name finden.
        const sheetBefore = this.sheetJson();
        const tabs = captureTabs(this.sheet, this.score);
        fn(beat);
        edit.applySectionBars(this.alphaTab, this.score);
        remapTabs(this.sheet, this.score, tabs);
        const tex = this.writeTex();
        if (tex === this.tex) {
            // Das Modell kann halb geändert sein (z. B. ein Bogen ohne Note davor): auf den Stand zurück, neu gezeichnet,
            // damit Bild und Modell wieder zusammenpassen.
            this.setTex(this.tex);
            return;
        }
        if (merge && this.undoStack.length) this.redoStack = [];
        else if (label) this.pushUndo(this.snapshot(sheetBefore), label);
        else {
            this.pushUndo(this.snapshot(sheetBefore), `Takt ${bar + 1} geändert`,
                this.panelEdit ? `${track}|${bar}` : null);
        }
        if (pos) this.pos = {...this.pos, ...pos};
        this.setTex(tex);
    }

    /**
     * Legt einen Schritt auf "Rückgängig" (höchstens UNDO_MAX) und leert "Wiederholen". Mit key und demselben key wie
     * beim letzten Schritt entsteht kein neuer: Die Änderung gehört zum letzten, der den Stand vor der ersten hält.
     * @param {UndoStep} step Stand vor der Änderung (snapshot())
     * @param {string} label was sich geändert hat
     * @param {?string} [key] Kennung zum Zusammenfassen ("Spur|Takt" aus dem linken Panel), null für keine
     * @returns {void}
     */
    pushUndo(step, label, key = null) {
        if (!key || key !== this.mergeKey || !this.undoStack.length) {
            this.undoStack.push({...step, label});
            if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
        }
        this.mergeKey = key;
        this.redoStack = [];
    }

    /**
     * Führt eine Eingabe aus und merkt dabei, ob sie aus dem linken Panel "Am Cursor" kommt (für das Zusammenfassen in
     * change()).
     * @param {HTMLElement} target Element der Eingabe
     * @param {function(): void} fn Eingabe ausführen
     * @returns {void}
     */
    fromPanel(target, fn) {
        this.panelEdit = !!target.closest('.edit-left');
        try {
            fn();
        } finally {
            this.panelEdit = false;
        }
    }

    /**
     * Leert "Rückgängig" und "Wiederholen" (nach dem Speichern: Der gespeicherte Stand ist der neue Anfang).
     * @returns {void}
     */
    clearUndo() {
        this.undoStack = [];
        this.redoStack = [];
        this.mergeKey = null;
    }

    /**
     * Stand für "Rückgängig" bzw. "Wiederholen": Text, Angaben für das Leadsheet, Cursor und gezeigte Spuren.
     * @param {string} [sheet] Angaben für das Leadsheet (sheetJson()), wenn sie schon geändert sind: der Stand davor
     * @returns {UndoStep} label ist leer, das setzt pushUndo() bzw. undo()
     */
    snapshot(sheet = this.sheetJson()) {
        return {tex: this.tex, sheet, pos: {...this.pos}, tracks: [...this.trackIndexes], label: ''};
    }

    /**
     * Rückgängig bzw. Wiederholen: nimmt den letzten Stand vom einen Stapel und legt den jetzigen auf den anderen.
     * @param {UndoStep[]} from Stapel, von dem der Stand kommt
     * @param {UndoStep[]} to Stapel für den jetzigen Stand
     * @returns {void}
     */
    undo(from, to) {
        const step = from.pop();
        if (!step) {
            this.toast(from === this.undoStack ? 'Nichts rückgängig zu machen' : 'Nichts zu wiederholen');
            return;
        }
        // Der Stand jetzt geht mit demselben Hinweis auf den anderen Stapel ("Wiederholen: Takt 12 geändert").
        to.push({...this.snapshot(), label: step.label});
        this.mergeKey = null;
        this.pos = step.pos;
        this.trackIndexes = step.tracks;
        this.digit = null;
        // Ein zu langer Liedtext im Feld gilt nicht mehr: Es zeigt wieder den Text der Noten.
        this.lyricsOverflow = false;
        this.setSheet(step.sheet);
        this.setTex(step.tex);
    }

    /**
     * Ziffer für den Bund. Folgt eine zweite rasch auf derselben Stelle und ergibt beides einen gültigen Bund (bis 24),
     * wird daraus ein zweistelliger (wie in Guitar Pro), als ein Schritt für "Rückgängig".
     * @param {number} digit Ziffer
     * @returns {void}
     */
    typeDigit(digit) {
        const now = Date.now();
        const previous = this.digit;
        const same = previous && now - previous.time < DIGIT_MS
            && ['track', 'bar', 'beat', 'string'].every(k => previous.pos[k] === this.pos[k]);
        if (same && previous.value * 10 + digit <= edit.MAX_FRET) {
            this.digit = null;
            this.change(beat => edit.setFret(this.alphaTab, beat, this.pos.string, previous.value * 10 + digit), {merge: true});
            return;
        }
        if (!edit.editStaff(this.score, this.pos.track)?.isStringed) {
            this.toast('Bünde gibt es nur in Spuren mit Saiten.');
            return;
        }
        this.digit = {value: digit, time: now, pos: {...this.pos}};
        this.change(beat => edit.setFret(this.alphaTab, beat, this.pos.string, digit));
    }

    /**
     * Schlag vor dem am Cursor (auch im Takt davor), für den Haltebogen.
     * @returns {?Beat}
     */
    previousBeat() {
        const pos = edit.stepBeat(this.score, this.pos, -1);
        return pos === this.pos ? null : edit.beatAt(this.score, pos);
    }

    /**
     * Bewegt den Cursor (ohne die Noten zu ändern).
     * @param {Object} changes Teile von EditPosition
     * @returns {void}
     */
    moveTo(changes) {
        if (!this.score) return;
        this.selection = null;
        this.beatSelection = null;
        this.pos = edit.clampPosition(this.score, {...this.pos, ...changes});
        this.digit = null;
        this.updateState();
        this.drawCursor(true);
    }

    /**
     * Wechselt den Cursor in die vorige bzw. nächste angezeigte Spur, auf denselben Takt.
     * @param {number} step -1 oder +1
     * @returns {void}
     */
    stepTrack(step) {
        const index = this.trackIndexes.indexOf(this.pos.track) + step;
        if (index < 0 || index >= this.trackIndexes.length) return;
        this.moveTo({track: this.trackIndexes[index], beat: 0});
    }

    /**
     * Blendet eine Spur in den Noten ein oder aus (Auge im Dialog "Spuren"); mindestens eine bleibt angezeigt.
     * @param {number} index Index der Spur
     * @returns {void}
     */
    toggleTrackEye(index) {
        const shown = new Set(this.trackIndexes);
        if (!shown.delete(index)) shown.add(index);
        if (!shown.size) return;
        this.player.showTracks([...shown]);
        this.viewChanged = true;
        this.updateState();
    }

    /**
     * Schaltet eine Spur zwischen zu hören und stumm um (Lautsprecher im Dialog "Spuren"). Wie im Mixer gilt es gleich
     * für dieses Gerät, "Speichern" macht es zur Vorgabe des Songs.
     * @param {number} index Index der Spur
     * @returns {void}
     */
    toggleTrackAudible(index) {
        this.player.toggleTrackMute(index);
        this.viewChanged = true;
        this.updateState();
        this.renderSongPanels();
    }

    /**
     * Zeigt andere Spuren (Augen im Dialog "Spuren", siehe Player.showTracks()).
     * @param {number[]} indexes Indizes der Spuren
     * @returns {void}
     */
    showTracks(indexes) {
        if (!this.score) return;
        this.trackIndexes = this.player.orderTracks(indexes.map(i => this.score.tracks[i])).map(t => t.index);
        if (!this.trackIndexes.includes(this.pos.track)) this.pos = {...this.pos, track: this.trackIndexes[0], beat: 0};
        this.pos = edit.clampPosition(this.score, this.pos);
        this.player.api.renderScore(this.score, this.trackIndexes);
        this.updateState();
        this.renderSongPanels();
    }

    /**
     * Zeigt den Stand: Statuszeile ("Takt zu lang/kurz" für den Takt am Cursor, sonst leer), gedrückte Dauer, Punktierung, Triole,
     * Pause, Haltebogen und die Effekte der Note bzw. des Schlags am Cursor im linken Panel, Felder im Reiter "Schlag", Knöpfe für Rückgängig/Wiederholen/Speichern (Speichern nur bei
     * ungespeicherten Änderungen aktiv, dann hervorgehoben).
     * @returns {void}
     */
    updateState() {
        const beat = this.score ? edit.beatAt(this.score, this.pos) : null;
        const status = this.part('edit-bottom')?.querySelector('.edit-status');
        if (!beat || !status) return;
        const fill = edit.barFill(beat.voice.bar);
        status.innerHTML = fill > 0 ? '<strong class="edit-warn">Takt zu lang</strong>'
            : fill < 0 ? '<strong class="edit-warn">Takt zu kurz</strong>' : '';
        for (const b of this.part('edit-left').querySelectorAll('[data-duration]')) {
            b.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (b).dataset.duration) === beat.duration));
        }
        const pressed = (cmd, on) => this.part('edit-left').querySelector(`[data-cmd="${cmd}"]`)
            .setAttribute('aria-pressed', String(on));
        const brushApply = this.part('edit-left').querySelector('[data-cmd="brushApply"]');
        /** @type {HTMLButtonElement} */ (brushApply).disabled = !brush;
        const anacrusis = /** @type {HTMLButtonElement} */ (this.part('edit-left').querySelector('[data-cmd="anacrusis"]'));
        anacrusis.disabled = this.pos.bar !== 0 || this.score.masterBars.length < 2;
        pressed('anacrusis', this.score.masterBars[0].isAnacrusis);
        pressed('dot', beat.dots === 1);
        pressed('dot2', beat.dots === 2);
        pressed('triplet', beat.tupletNumerator === 3 && beat.tupletDenominator === 2);
        pressed('rest', beat.isRest);
        const note = edit.noteOn(beat, this.pos.string);
        pressed('tie', !!note?.isTieDestination);
        // Effekte: gedrückt, wenn die Note am Cursor (bzw. der Schlag) den Effekt hat
        const {NoteAccidentalMode: Accidental, PickStroke, BrushType, VibratoType, SlideOutType} = this.alphaTab.model;
        pressed('hammer', !!note?.isHammerPullOrigin);
        pressed('slide', !!note && note.slideOutType !== SlideOutType.None);
        pressed('bend', !!note?.hasBend);
        pressed('vibrato', !!note && note.vibrato !== VibratoType.None);
        pressed('ghost', !!note?.isGhost);
        pressed('dead', !!note?.isDead);
        pressed('sharp', note?.accidentalMode === Accidental.ForceSharp);
        pressed('flat', note?.accidentalMode === Accidental.ForceFlat);
        pressed('natural', note?.accidentalMode === Accidental.ForceNatural);
        pressed('pickDown', beat.pickStroke === PickStroke.Down);
        pressed('pickUp', beat.pickStroke === PickStroke.Up);
        pressed('brushDown', beat.brushType === BrushType.BrushDown);
        pressed('brushUp', beat.brushType === BrushType.BrushUp);
        pressed('arpeggioDown', beat.brushType === BrushType.ArpeggioDown);
        pressed('arpeggioUp', beat.brushType === BrushType.ArpeggioUp);
        pressed('fadeOut', beat.fade === this.alphaTab.model.FadeType.FadeOut);
        pressed('accent', beat.notes.some(n => n.accentuated));
        const toolbar = this.part('edit-toolbar');
        // Tooltip mit dem Hinweis des Schritts, z. B. "Rückgängig: Takt 12 geändert (Strg+Z)".
        for (const [cmd, stack, name, key] of /** @type {[string, UndoStep[], string, string][]} */ ([
            ['undo', this.undoStack, 'Rückgängig', 'Strg+Z'], ['redo', this.redoStack, 'Wiederholen', 'Strg+Y']])) {
            const button = /** @type {HTMLButtonElement} */ (toolbar.querySelector(`[data-cmd="${cmd}"]`));
            const label = stack.at(-1)?.label;
            button.disabled = !stack.length;
            button.title = label ? `${name}: ${label} (${key})` : `${name} (${key})`;
        }
        const save = /** @type {HTMLButtonElement} */ (toolbar.querySelector('[data-cmd="save"]'));
        save.classList.toggle('ebtn-dirty', this.dirty);
        save.disabled = !this.dirty;
        /** @type {HTMLInputElement} */ (toolbar.querySelector('[data-goto]')).max = String(this.score.masterBars.length);
        // Auch mit Fokus: Rückgängig ändert die Zahl.
        const perRow = /** @type {HTMLInputElement} */ (toolbar.querySelector('[data-per-row]'));
        perRow.value = String(this.sheet.barsPerRow || '');
        const fields = this.part('edit-left');
        const value = (name, v) => {
            const input = /** @type {HTMLInputElement} */ (fields.querySelector(`[data-field="${name}"]`));
            if (input && document.activeElement !== input) input.value = v;
        };
        this.fillChordSelect();
        value('text', beat.text ?? '');
        value('syllable', this.syllableAt(beat));
        const mb = beat.voice.bar.masterBar;
        this.fillField(fields, '[data-bar="section"]', sectionName(mb.section));
        this.fillBarSignature();
        this.leadsheetTab.cursorMoved();
        this.showLyricsAt(beat);
    }

    /**
     * Speichert die Noten: Griffbilder vereinheitlichen (wie beim Import), als alphaTex schreiben, prüfen, hochladen.
     * Der Server hebt die vorige Fassung auf (history/). Danach, wenn geändert, die Angaben für das Leadsheet.
     * @param {string} [note] was sich geändert hat (steht im Verlauf beim aufgehobenen Stand)
     * @returns {Promise<void>}
     */
    async save(note = '') {
        if (!this.dirty) {
            this.toast('Keine Änderungen');
            return;
        }
        const tex = this.tex;
        // Takte, deren Länge nicht zur Taktart passt, kommen nicht in die Datei (Angaben fürs Leadsheet allein schon).
        const problems = tex === this.savedTex ? [] : edit.barLengthProblems(this.score);
        if (problems.length) {
            this.refuseSave(problems);
            return;
        }
        const sheet = this.sheetJson();
        try {
            let song = null;
            const scoreSaved = tex !== this.savedTex;
            if (scoreSaved) {
                const result = parseScore(this.alphaTab, tex);
                // Ohne Katalog (Netzfehler) behalten die Akkorde ihren eigenen meistgenutzten Griff.
                normalizeChords(this.alphaTab, result, await loadChordLibraryOrEmpty(), true);
                song = await saveScore(this.player.slug, writeScoreChecked(this.alphaTab, result), note);
                this.savedTex = tex;
            }
            // Nach den Noten: Passen sie nicht (Prüfung), bleiben auch die Angaben je Takt ungespeichert, so passen beide
            // Dateien weiter zueinander.
            if (sheet !== this.savedSheet) {
                // Die Noten haben den bisherigen Stand schon in den Verlauf gelegt (mit den damaligen Angaben).
                // Ohne die Baustelle, die steht in song.json.
                song = await saveLeadsheet(this.player.slug, {...JSON.parse(sheet), wip: undefined}, !scoreSaved, note);
                this.savedSheet = sheet;
            }
            // Zuletzt: Die Vorgaben gelten für die Spuren, wie sie nach dem Speichern der Noten sind.
            if (this.viewChanged) {
                song = await saveSongFields(this.player.slug, {trackDefaults: this.trackDefaults()});
                this.viewChanged = false;
            }
            // Baustelle: umbenannte bzw. gelöschte Spuren in song.json nachtragen.
            const wip = findSong(this.player.slug)?.wip;
            if (wip && JSON.stringify(this.sheet.wip) !== JSON.stringify(this.wipAtLoad)) {
                song = await saveSongFields(this.player.slug, {wip: {reason: wip.reason, tracks: this.sheet.wip}});
                this.wipAtLoad = [...this.sheet.wip];
            }
            this.saved = true;
            // Gespeichert ist der neue Anfang: Die Schritte davor brauchen nur noch Speicher (frühere Fassungen stehen im
            // Verlauf).
            this.clearUndo();
            this.onSaved(song);
            this.updateState();
            this.toast('Gespeichert');
        } catch (err) {
            this.toast('Nicht gespeichert: ' + err.message);
        }
    }

    /**
     * Dialog statt Speichern: Takte, deren Länge nicht zur Taktart passt, werden so nicht gespeichert. Genannt wird der
     * erste dieser Takte, mit einem Knopf dorthin.
     * @param {import('./notation.js').BarLengthProblem[]} problems Takte mit falscher Länge (barLengthProblems())
     * @returns {void}
     */
    refuseSave(problems) {
        const bars = [...new Set(problems.map(p => p.bar.index))].sort((a, b) => a - b);
        const first = problems.find(p => p.bar.index === bars[0]);
        openOverlay(`<h2>Speichern nicht möglich</h2>
      <p>In Takt ${bars[0] + 1} passt die Länge nicht zur Taktart (${escapeHtml(first.text)}).</p>
      <div class="struct-actions">
        <button class="btn" type="button" id="refuseGo">Zu Takt ${bars[0] + 1}</button>
        <button class="btn btn-primary" type="button" id="refuseCancel">Abbrechen</button>
      </div>`, true);
        document.getElementById('refuseCancel').addEventListener('click', closeOverlay);
        document.getElementById('refuseGo').addEventListener('click', () => {
            closeOverlay();
            const track = first.bar.staff.track.index;
            this.moveTo(this.trackIndexes.includes(track) ? {track, bar: bars[0], beat: 0} : {bar: bars[0], beat: 0});
        });
    }

    /**
     * Zeigt einen Hinweis unter der Werkzeugleiste, so lange, wie man zum Lesen braucht (TOAST_CHAR_MS je Zeichen,
     * zwischen TOAST_MS und TOAST_MAX_MS). Steht die Maus darauf, bleibt er; ein Klick schließt ihn. Eine Warnung ist
     * rötlich und bleibt, bis man auf ihr × klickt. Zeilenumbrüche im Text bleiben.
     * @param {string} text Hinweis
     * @param {{warn?: boolean}} [options] warn: als Warnung
     * @returns {void}
     */
    toast(text, {warn = false} = {}) {
        const el = this.part('edit-toast');
        const hide = () => el.classList.remove('show');
        const span = document.createElement('span');
        span.textContent = text;
        el.replaceChildren(span);
        el.classList.toggle('edit-toast-warn', warn);
        el.classList.add('show');
        clearTimeout(this.toastTimer);
        if (warn) {
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'edit-toast-close';
            close.textContent = '×';
            close.title = 'Warnung schließen';
            close.setAttribute('aria-label', close.title);
            close.onclick = hide;
            el.append(close);
            el.onmouseenter = el.onmouseleave = el.onclick = null;
            return;
        }
        const ms = Math.min(TOAST_MAX_MS, Math.max(TOAST_MS, text.length * TOAST_CHAR_MS));
        const start = () => {
            clearTimeout(this.toastTimer);
            this.toastTimer = window.setTimeout(hide, ms);
        };
        el.onmouseenter = () => clearTimeout(this.toastTimer);
        el.onmouseleave = start;
        el.onclick = hide;
        start();
    }

    /**
     * Merkt sich, welche Panels eingeklappt sind. Auf schmalen Bildschirmen nur das untere: Die seitlichen sind dort
     * immer anfangs zu.
     * @returns {void}
     */
    saveCollapsed() {
        const state = loadCollapsed();
        state.bottom = this.part('edit-bottom').classList.contains('collapsed');
        if (matchMedia(WIDE_LAYOUT).matches) {
            state.left = this.part('edit-left').classList.contains('collapsed');
            state.right = this.part('edit-right').classList.contains('collapsed');
        }
        try {
            localStorage.setItem(PANELS_KEY, JSON.stringify(state));
        } catch (err) {
            // Ohne Speicher (privates Fenster) gilt die Wahl nur bis zum Schließen.
        }
    }

    /**
     * Überträgt die Höhen von fester Leiste und unterem Panel in CSS-Variablen (Lage der Panels, Platz der Noten).
     * @returns {void}
     */
    measure() {
        const songbar = this.songView.querySelector('.songbar');
        this.songView.style.setProperty('--edit-top', `${songbar.getBoundingClientRect().bottom}px`);
        this.songView.style.setProperty('--edit-bottom-h', `${this.part('edit-bottom').offsetHeight}px`);
        this.songView.classList.toggle('edit-left-open', !this.part('edit-left').classList.contains('collapsed'));
        this.songView.classList.toggle('edit-right-open', !this.part('edit-right').classList.contains('collapsed'));
    }

    /**
     * Lässt alphaTab die Noten an die neue Breite anpassen (Panels auf- oder zugeklappt, Modus an oder aus).
     * @returns {void}
     */
    relayout() {
        window.dispatchEvent(new Event('resize'));
    }

    /**
     * X-Button verlässt den Bearbeitungsmodus; bei ungespeicherten Änderungen fragt ein Dialog, ob sie gespeichert werden.
     * @returns {void}
     */
    finish() {
        if (!this.dirty) {
            this.onClose(this.saved);
            return;
        }
        openOverlay(`<h2>Änderungen speichern?</h2>
      <p>Möchtest du die Änderungen speichern?</p>
      ${this.keepsHistory() ? noteFieldHtml(this.player.slug) : ''}
      <div class="struct-actions">
        <button class="btn btn-primary" type="button" id="finishSave">Ja, speichern</button>
        <button class="btn" type="button" id="finishDiscard">Nein, verwerfen</button>
      </div>`, true);
        const slug = this.player.slug;
        document.getElementById('finishDiscard').addEventListener('click', () => {
            if (this.keepsHistory()) keepLastNote(slug, noteValue());
            closeOverlay();
            this.onClose(this.saved);
        });
        const finishSave = async () => {
            const note = noteValue();
            if (this.keepsHistory()) keepLastNote(slug, note);
            closeOverlay();
            await this.save(note);
            // Misslang das Speichern (Meldung unten), bleibt der Bearbeitungsmodus offen.
            if (!this.dirty) this.onClose(this.saved);
        };
        document.getElementById('finishSave').addEventListener('click', () => void finishSave());
        bindNoteField(() => void finishSave());
    }

    /**
     * Ob Speichern einen Stand in den Verlauf legt (geänderte Noten oder Angaben für das Leadsheet; die Vorgaben der
     * Ansicht allein nicht).
     * @returns {boolean}
     */
    keepsHistory() {
        return this.tex !== this.savedTex || this.sheetJson() !== this.savedSheet;
    }

    /**
     * Speichern aus der Leiste (Strg+S): Legt es einen Stand in den Verlauf, fragt erst ein Dialog, was sich geändert hat
     * (optional, steht dann im Verlauf).
     * @returns {void}
     */
    askSave() {
        if (!this.dirty || !this.keepsHistory()) {
            void this.save();
            return;
        }
        openOverlay(`<h2>Speichern</h2>
      ${noteFieldHtml(this.player.slug)}
      <div class="struct-actions">
        <button class="btn btn-primary" type="button" id="saveOk">Speichern</button>
        <button class="btn" type="button" id="saveCancel">Abbrechen</button>
      </div>`, true);
        const ok = () => {
            const note = noteValue();
            keepLastNote(this.player.slug, note);
            closeOverlay();
            void this.save(note);
        };
        document.getElementById('saveOk').addEventListener('click', ok);
        document.getElementById('saveCancel').addEventListener('click', closeOverlay);
        bindNoteField(ok);
        document.getElementById('saveNote').focus();
    }

    /**
     * Entfernt Leiste und Panels und gibt die volle Breite an die Noten zurück.
     * @returns {void}
     */
    destroy() {
        this.resize?.disconnect();
        clearTimeout(this.toastTimer);
        clearTimeout(this.lyricsTimer);
        document.removeEventListener('keydown', this.onKey);
        document.removeEventListener('pointerdown', this.onPointerDown);
        this.player.el.play.removeEventListener('click', this.onPlay, true);
        this.offStopped?.();
        this.player.el.loop.removeAttribute('title');
        this.offRender?.();
        this.player.el.at.removeEventListener('pointerdown', this.onPointer);
        this.cursorEl?.remove();
        this.sync?.destroy();
        this.sync = null;
        if (this.player.editor === this) this.player.editor = null;
        for (const b of /** @type {NodeListOf<HTMLElement>} */ (this.player.el.viewPop.querySelectorAll('[data-view]'))) b.hidden = false;
        // Wieder die Ansicht des Players (nach dem Speichern lädt der Aufrufer den Song ohnehin neu).
        if (this.display && this.player.api && !this.saved) {
            this.player.applyStave(this.display.score);
            // Mit den gespeicherten Takten pro Zeile.
            this.player.setBarsPerRow(JSON.parse(this.savedSheet || '{}').barsPerRow ?? 0, false);
            this.player.applyBarsLayout(this.display.score);
            this.player.api.renderScore(this.display.score, this.display.tracks);
        }
        this.score = null;
        for (const part of this.parts) part.remove();
        this.parts = [];
        this.songView.classList.remove('editing', 'edit-left-open', 'edit-right-open');
        this.songView.style.removeProperty('--edit-top');
        this.songView.style.removeProperty('--edit-bottom-h');
        this.songView.style.removeProperty('--edit-right-w');
        this.relayout();
    }

    /**
     * Setzt den Cursor auf die Stelle eines Klicks ins Notenblatt: Spur und Takt nach der Lage, der Schlag nach der
     * Waagerechten, die Saite nach der Höhe (nur in der Tab-Zeile; in der Notenzeile bleibt sie).
     * @param {PointerEvent} e Klick
     * @returns {void}
     */
    handlePointer(e) {
        if (e.button !== 0 || !this.score) return;
        // Ein Klick in die Noten verlässt ein Feld, sonst zeigt es den neuen Schlag nicht an (updateState()).
        // Ein getippter Wert gilt dabei noch für den alten Schlag.
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.matches('input, textarea, select')) active.blur();
        const rect = this.player.el.at.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hit = this.hitTest(x, y);
        if (!hit) return;
        // Umschalt+Klick wählt die Schläge vom Anker (Beginn der Auswahl, sonst der Cursor) bis zum Klick.
        if (e.shiftKey && hit.track === this.pos.track) {
            const anchor = this.beatSelection?.track === hit.track ? this.beatSelection.anchor : this.pos;
            this.setBeatRange({bar: anchor.bar, beat: anchor.beat}, hit);
            return;
        }
        this.pos = edit.clampPosition(this.score, hit);
        this.digit = null;
        this.selection = null;
        this.beatSelection = null;
        this.drawCursor(false);
        this.updateState();
    }

    /**
     * Zeichnet den Cursor: eine Spalte über den Schlag in seiner Spur und, wenn Tabs zu sehen sind, ein Kästchen um die
     * Saite.
     * @param {boolean} scroll ob er ins Bild gerollt werden soll (nach Tasten, nicht nach einem Klick)
     * @returns {void}
     */
    drawCursor(scroll) {
        const el = this.cursorEl;
        const api = this.player.api;
        this.drawProblems();
        const beat = this.score ? edit.beatAt(this.score, this.pos) : null;
        const lookup = api.boundsLookup;
        const bounds = beat && lookup ? lookup.findBeat(beat) : null;
        if (!el || !bounds || this.player.prefs.view === 'chords') {
            if (el) el.hidden = true;
            return;
        }
        el.hidden = false;
        const staff = beat.voice.bar.staff;
        const entries = bounds.barBounds.masterBarBounds.bars.filter(b => entryBar(b) === beat.voice.bar);
        if (!entries.length) {
            el.hidden = true;
            return;
        }
        const top = entries[0].visualBounds.y;
        const last = entries.at(-1).visualBounds;
        const x = bounds.visualBounds.x;
        const w = Math.max(bounds.visualBounds.w, 12);
        const column = /** @type {HTMLElement} */ (el.querySelector('.edit-cursor-beat'));
        Object.assign(column.style, {
            left: `${x - CURSOR_PAD}px`, top: `${top - CURSOR_PAD}px`,
            width: `${w + 2 * CURSOR_PAD}px`, height: `${last.y + last.h - top + 2 * CURSOR_PAD}px`,
        });
        const box = /** @type {HTMLElement} */ (el.querySelector('.edit-cursor-string'));
        const strings = staff.tuning.length;
        box.hidden = !staff.showTablature || strings < 2;
        if (!box.hidden) {
            const spacing = last.h / (strings - 1);
            const y = last.y + (strings - this.pos.string) * spacing;
            Object.assign(box.style, {
                left: `${x - CURSOR_PAD}px`, top: `${y - spacing / 2}px`,
                width: `${w + 2 * CURSOR_PAD}px`, height: `${spacing}px`,
            });
        }
        this.drawSelection();
        if (scroll) this.scrollCursorIntoView(box.hidden ? column : box);
    }

    /**
     * Füllt ein Feld, außer während darin geschrieben wird.
     * @param {Element} root Panel
     * @param {string} selector Feld
     * @param {string|number|boolean} v Wert (Checkbox: an/aus; Auswahl: Text bzw. Index bei Zahlen)
     * @returns {void}
     */
    fillField(root, selector, v) {
        const input = /** @type {HTMLInputElement|HTMLSelectElement} */ (root.querySelector(selector));
        if (!input || document.activeElement === input) return;
        if (input.type === 'checkbox') /** @type {HTMLInputElement} */ (input).checked = !!v;
        else if (input instanceof HTMLSelectElement && typeof v === 'number') input.selectedIndex = v;
        else input.value = String(v);
    }

    /**
     * Tuning eines Notensystems als Text von tief nach hoch, z. B. "E A D G B E".
     * @param {import('../../types/alphatab').model.Staff} staff Notensystem
     * @returns {string}
     */
    tuningText(staff) {
        return staff.tuning.slice().reverse().map(pitch => this.alphaTab.model.Tuning.getTextForTuning(pitch, false))
            .join(' ');
    }

    /**
     * Standard-Tuning für eine Saitenzahl.
     * @param {number} strings Saitenzahl
     * @returns {{midi: number[], names: string[]}} MIDI-Tonhöhen und Töne von tief nach hoch; ohne Standard für diese Saitenzahl
     *   das Standard-Tuning mit sechs Saiten
     */
    standardTuning(strings) {
        const Tuning = this.alphaTab.model.Tuning;
        const midi = (Tuning.getDefaultTuningFor(strings) ?? Tuning.getDefaultTuningFor(6)).tunings.slice().reverse();
        return {midi, names: midi.map(p => Tuning.getTextForTuning(p, false))};
    }

    /**
     * Füllt die Leiste (Tonart, Shuffle, Anzeige von Capo und Tuning) mit den Werten des Songs (erster Takt, erste Spur mit
     * Saiten) und die Felder "Taktart" und "Tempo" im linken Panel mit den Werten am Cursor.
     * @returns {void}
     */
    fillSongFields() {
        const toolbar = this.part('edit-toolbar');
        const score = this.score;
        if (!toolbar || !score) return;
        const staff = score.tracks.flatMap(t => t.staves).find(st => st.isStringed) ?? score.tracks[0].staves[0];
        const bar = staff.bars[0];
        const minor = bar.keySignatureType === this.alphaTab.model.KeySignatureType.Minor;
        this.fillField(toolbar, '[data-song="key"]', keyName(bar.keySignature, minor));
        // Erkennt die App aus Akkorden und Tönen eine andere Tonart, steht ein "!" daneben (nur ein Hinweis: Die notierte
        // muss nicht zu allen Akkorden passen, z. B. Blues, modale Songs, entlehnte Akkorde).
        const detected = detectKeySignature(score);
        const hint = /** @type {HTMLElement} */ (toolbar.querySelector('[data-key-hint]'));
        hint.hidden = !detected;
        hint.title = detected ? `Erkannte Tonart: ${keyName(detected.keySignature, detected.minor)}` : '';
        // Shuffle: Achtel-Triolen-Feeling im ganzen Song. Der Knopf zeigt den Zustand und schaltet um; eine andere Art
        // (löst der Import, siehe conflicts.js) gilt als aus.
        const shuffle = score.masterBars[0].tripletFeel === this.alphaTab.model.TripletFeel.Triplet8th;
        const shuffleButton = toolbar.querySelector('[data-cmd="tripletFeel"]');
        shuffleButton.innerHTML = svgIcon(shuffle ? 'feelShuffle' : 'feelStraight', 52, 60);
        shuffleButton.setAttribute('aria-pressed', String(shuffle));
        shuffleButton.title = shuffle ? 'Shuffle: Achtel als Triolen (Viertel + Achtel); Klick schaltet aus (Strg+/)'
            : 'Kein Shuffle: Achtel gerade; Klick schaltet Shuffle ein (Strg+/)';
        // Capo und Tuning nur als Anzeige wie im Kopf des Players (fett: Capo und abweichende Saiten); geändert wird im Dialog.
        const parts = edit.capoTuningParts(edit.readScoreInfo(this.alphaTab, score));
        const info = /** @type {HTMLElement} */ (toolbar.querySelector('[data-song-info]'));
        info.innerHTML = parts.join(' · ');
        info.hidden = !parts.length;
        info.title = 'Capo und Tuning (ändern im Dialog Transponieren)';
        this.fillBarSignature();
        this.showTempoMismatches();
    }

    /**
     * Abschnitte ohne Tempowechsel, deren notiertes Tempo nicht zum Tempo der Audiospur passt (recordingTempoRegion() in
     * notation.js; die Grenzen sind die notierten Tempowechsel).
     * @returns {import('./notation.js').TempoRegion[]} in Taktfolge; leer ohne Sync-Punkte oder wenn alle passen
     */
    tempoMismatches() {
        const bars = this.score.masterBars;
        const list = [];
        for (let bar = 0; bar < bars.length;) {
            const region = edit.recordingTempoRegion(this.alphaTab, this.score, bar);
            if (region) {
                if (region.recorded !== region.tempo) list.push(region);
                bar = region.end;
            } else {
                bar++;
                while (bar < bars.length && !bars[bar].tempoAutomations.length) bar++;
            }
        }
        return list;
    }

    /**
     * "!" am Label "Audio" des unteren Panels, wenn irgendwo das notierte Tempo nicht zur Audiospur passt; ein Klick
     * springt zum ersten Abschnitt (gotoTempoMismatch()).
     * @returns {void}
     */
    showTempoMismatches() {
        const hint = /** @type {?HTMLElement} */ (this.part('edit-bottom')?.querySelector('[data-action="tempoHint"]'));
        if (!hint || !this.score) return;
        this.tempoMismatchList = this.tempoMismatches();
        hint.hidden = !this.tempoMismatchList.length;
        hint.title = this.tempoMismatchList.length ? 'Tempo in der Partitur ungenau' : '';
    }

    /**
     * Setzt den Cursor auf den ersten Abschnitt, dessen Tempo nicht zur Audiospur passt (und die Abspielposition dorthin,
     * damit der Sync-Editor ihn zeigt).
     * @returns {void}
     */
    gotoTempoMismatch() {
        const first = this.tempoMismatchList?.[0];
        if (!first) return;
        this.moveTo({bar: first.start, beat: 0});
        this.seekToCursor();
    }

    /**
     * Füllt die Felder "Taktart" und "Tempo" im linken Panel mit den Werten am Takt des Cursors; weicht das Tempo der
     * Audiospur dort ab, steht ein "!" neben dem Tempo (Tooltip mit dem Tempo der Audiospur).
     * @returns {void}
     */
    fillBarSignature() {
        const panel = this.part('edit-left');
        const mb = this.score?.masterBars[this.pos.bar];
        if (!panel || !mb) return;
        this.fillField(panel, '[data-song="ts"]', `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`);
        this.fillField(panel, '[data-song="tempo"]', edit.roundTempo(edit.tempoAt(this.score, this.pos.bar)));
        // Tempo der Audiospur im Abschnitt ohne Tempowechsel am Cursor (aus den Sync-Punkten): weicht es ab, ein "!" daneben.
        // Gemerkt je Takt und Stand der Noten: Die Rechnung geht über alle Sync-Punkte, der Cursor bewegt sich oft.
        if (this.tempoRegions?.tex !== this.tex) this.tempoRegions = {tex: this.tex, bars: new Map()};
        const cache = this.tempoRegions.bars;
        if (!cache.has(this.pos.bar)) cache.set(this.pos.bar, edit.recordingTempoRegion(this.alphaTab, this.score, this.pos.bar));
        const region = cache.get(this.pos.bar);
        const hint = /** @type {?HTMLElement} */ (panel.querySelector('[data-tempo-hint]'));
        if (!hint) return;
        hint.hidden = !region || region.recorded === region.tempo;
        const until = region?.end >= this.score.masterBars.length ? 'bis zum Ende' : 'bis zur nächsten Tempoangabe';
        hint.title = hint.hidden ? '' : `Tempo in der Partitur ungenau (${until} ${edit.roundTempo(region.recorded)} BPM)`;
    }

    /**
     * Setzt den Cursor in ein Feld des linken Panels (A: Akkord, T: Text, Umschalt+Einfg: Abschnitt) und klappt das
     * Panel dafür aus.
     * @param {string} name Feld: Name in data-field oder ein Selektor
     * @returns {void}
     */
    focusField(name) {
        const panel = this.part('edit-left');
        if (panel.classList.contains('collapsed')) this.togglePanel('left');
        const input = /** @type {HTMLInputElement} */ (panel.querySelector(name.startsWith('[') ? name
            : `[data-field="${name}"]`));
        input.focus();
        input.select?.();
    }

    /**
     * Enter in einem Eingabefeld des linken Panels oder der Leiste verlässt das Feld, nachdem der Browser den Wert
     * übernommen hat; danach gehören die Tasten wieder den Noten.
     * @param {KeyboardEvent} e Tastendruck im linken Panel bzw. in der Leiste
     * @returns {void}
     */
    leaveFieldOnEnter(e) {
        const field = /** @type {HTMLElement} */ (e.target);
        if (e.key !== 'Enter' || e.isComposing || !field.matches('input[type=text], input[type=number]')) return;
        setTimeout(() => {
            if (document.activeElement !== field) return;
            field.blur();
            this.updateState();
        });
    }

    /**
     * Setzt die Takte pro Zeile (Feld in der Leiste, Sheet.barsPerRow), als ein Schritt für "Rückgängig".
     * @param {number} count Takte pro Zeile; 0 ohne
     * @returns {void}
     */
    setBarsPerRow(count) {
        count = Number.isInteger(count) && count > 0 ? count : 0;
        this.changeSheet(sheet => {
            sheet.barsPerRow = count;
        }, 'Takte pro Zeile geändert');
        this.fillField(this.part('edit-toolbar'), '[data-per-row]', count || '');
    }

    /**
     * Feld "Gehe zu" in der Leiste: Cursor auf den ersten Schlag dieses Takts (in der Spur am Cursor); danach ist das Feld
     * wieder leer und die Tasten gehören wieder den Noten.
     * @param {HTMLInputElement} input Feld (Taktnummer ab 1)
     * @returns {void}
     */
    gotoBar(input) {
        const count = this.score?.masterBars.length ?? 0;
        const bar = Math.round(Number(input.value));
        if (!count || !Number.isFinite(bar) || input.value.trim() === '') return;
        this.moveTo({bar: Math.min(Math.max(bar, 1), count) - 1, beat: 0});
        input.value = '';
        input.blur();
    }

    /**
     * Übernimmt ein geändertes Feld: Schlag am Cursor (linkes Panel), Spur oder Spurwahl (Dialog "Spuren").
     * @param {HTMLInputElement} input Feld
     * @returns {void}
     */
    applyField(input) {
        if (input.dataset.goto !== undefined) {
            this.gotoBar(input);
            return;
        }
        if (input.dataset.perRow !== undefined) {
            this.setBarsPerRow(Math.min(Math.round(Number(input.value)), BARS_PER_ROW_MAX));
            return;
        }
        if (input.dataset.trackField) {
            this.applyTrackField(input);
            return;
        }
        if (input.dataset.content) {
            this.moveContentTo(/** @type {'chords'|'lyrics'} */ (input.dataset.content), Number(input.dataset.track));
            return;
        }
        if (input.dataset.ls) {
            this.leadsheetTab.apply(input);
            return;
        }
        if (input.dataset.bar) {
            this.applyBarField(input);
            return;
        }
        if (input.dataset.song) {
            this.applySongField(input);
            return;
        }
        if (input.dataset.chordSelect !== undefined) {
            this.change(beat => this.setChordAt(beat, input.value));
            return;
        }
        const field = input.dataset.field;
        if (!field) return;
        const value = input.value.trim();
        this.change(beat => {
            if (field === 'text') beat.text = value || null;
            if (field === 'syllable') this.setSyllableAt(beat, value);
        });
        if (field === 'syllable') this.recheckLyrics();
    }

    /**
     * Füllt die Auswahlliste "Akkord" im linken Panel mit den Akkorden des Songs (in der Reihenfolge ihres ersten
     * Auftretens, je Eintrag Name und Griff) und wählt den Akkord am Cursor. Der Knopf daneben ist "+" (neuer Akkord)
     * ohne Akkord am Schlag, sonst "✎" (Akkord und Griff ändern); beide öffnen openChordDialog().
     * @returns {void}
     */
    fillChordSelect() {
        const panel = this.part('edit-left');
        const select = /** @type {?HTMLSelectElement} */ (panel?.querySelector('[data-chord-select]'));
        const button = /** @type {?HTMLButtonElement} */ (panel?.querySelector('[data-chord-button]'));
        if (!select || !button || !this.score) return;
        const beat = edit.beatAt(this.score, this.pos);
        const chordBeat = beat ? this.chordBeat(beat) : null;
        const staff = chordBeat?.voice.bar.staff;
        const chord = chordBeat?.chordId ? staff.chords?.get(chordBeat.chordId) ?? null : null;
        const names = [...new Set(edit.mergeChords(this.score).map(m => m.chord.name))];
        if (chord && !names.includes(chord.name)) names.push(chord.name);
        // Name und Griff in Spalten (Festbreitenschrift, geschützte Leerzeichen).
        const width = Math.max(0, ...names.map(n => n.length)) + 2;
        const strings = staff?.tuning.length ?? 6;
        select.innerHTML = ['', ...names].map(n => {
            const text = n ? n.padEnd(width, '\u00a0') + this.songChordGrip(n, strings) : '–';
            return `<option value="${escapeHtml(n)}"${n === (chord?.name ?? '') ? ' selected' : ''}>${escapeHtml(text)}</option>`;
        }).join('');
        const title = chord ? 'Akkord und Griff ändern …' : 'Neuer Akkord mit Griff …';
        button.dataset.cmd = chord ? 'chordEdit' : 'chordNew';
        button.dataset.todo = button.title = title;
        button.setAttribute('aria-label', title);
        button.textContent = chord ? '✎' : '+';
    }

    /**
     * Auswahlliste der Abschnittsnamen im linken Panel: die üblichen und die des Songs.
     * @returns {void}
     */
    fillSectionNames() {
        const list = this.part('edit-left')?.querySelector('#ebarSections');
        if (!list || !this.score) return;
        const names = new Set([...SECTION_NAMES, ...this.score.masterBars.map(mb => sectionName(mb.section)).filter(Boolean)]);
        list.innerHTML = [...names].map(n => `<option value="${escapeHtml(n)}">`).join('');
    }

    /**
     * Dialog zum Transponieren (Knopf in der Leiste oben): Halbtöne, Capo und Tuning mit Vorschau (transposedialog.js).
     * @returns {void}
     */
    openTransposeDialog() {
        void new TransposeDialog(this).open();
    }

    /**
     * Dialog "Verlauf": oben die aktuelle Fassung, darunter die früheren samt den Angaben für das Leadsheet (siehe
     * keep_score_history() in api/lib/file_store.php), je mit Zeitpunkt und Notiz des Speicherns; die früheren mit
     * Knöpfen zum Laden und zum Löschen.
     * @param {import('./base.js').ScoreVersion[]} [known] schon geladene Liste (nach dem Löschen eines Stands)
     * @returns {Promise<void>}
     */
    async openHistoryDialog(known) {
        let versions = known;
        if (!versions) {
            try {
                versions = await loadScoreHistory(this.player.slug);
            } catch (err) {
                this.toast(err.message);
                return;
            }
        }
        const rows = versions.map(v => {
            const when = new Date(v.time.replace(' ', 'T')).toLocaleString('de-DE');
            const actions = v.current ? '<span class="history-current">Aktuelle Fassung</span>'
                : `<button type="button" class="btn btn-34" data-version="${escapeHtml(v.id)}">Laden</button>
        <button type="button" class="ebtn" data-delete="${escapeHtml(v.id)}" title="Diesen Stand löschen"
          aria-label="Diesen Stand löschen">${svgIcon('trash')}</button>`;
            return `<li><span>${escapeHtml(when)}</span><span class="history-size">${Math.round(v.size / 1024)} KB</span>
        ${actions}${v.note ? `
        <span class="history-note">${escapeHtml(v.note)}</span>` : ''}</li>`;
        }).join('');
        openOverlay(`<h2>Verlauf</h2>
      <p class="history-hint">Das Laden ist ein Bearbeitungsschritt. Mit Rückgängig (Strg+Z) kommt der jetzige Stand zurück.</p>
      ${rows ? `<ul class="history-list">${rows}</ul>` : ''}${versions.length > 1 ? ''
            : '<p class="empty">Es gibt noch keine früheren Stände.</p>'}`);
        for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.history-list [data-version]'))) {
            button.addEventListener('click', () => {
                closeOverlay();
                void this.loadVersion(button.dataset.version);
            });
        }
        for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.history-list [data-delete]'))) {
            button.addEventListener('click', async () => {
                if (!confirm('Diesen Stand endgültig löschen?')) return;
                try {
                    await this.openHistoryDialog(await deleteScoreVersion(this.player.slug, button.dataset.delete));
                } catch (err) {
                    this.toast(`Nicht gelöscht: ${err.message}`);
                }
            });
        }
    }

    /**
     * Lädt einen aufgehobenen Stand in den Editor, Noten samt Angaben für das Leadsheet (ein Schritt für "Rückgängig",
     * noch nicht gespeichert).
     * @param {string} id Kennung des Stands (siehe loadScoreHistory())
     * @returns {Promise<void>}
     */
    async loadVersion(id) {
        try {
            const slug = this.player.slug;
            const tex = await loadScoreVersion(slug, id);
            // Die Baustelle (song.json) gehört nicht zum Stand.
            const sheet = JSON.stringify({...normalizeSheet(await loadLeadsheet(slug, id)), wip: this.sheet.wip});
            // Vorab lesen: Ein Stand, der sich nicht einlesen lässt, darf den Editor nicht zerlegen.
            parseScore(this.alphaTab, tex, this.player.api.settings);
            if (tex === this.tex && sheet === this.sheetJson()) {
                this.toast('Dieser Stand ist der jetzige.');
                return;
            }
            this.commitTex(tex, sheet, 'Fassung aus dem Verlauf geladen');
            this.toast('Stand geladen (noch nicht gespeichert; Strg+Z macht es rückgängig).');
        } catch (err) {
            this.toast(`Der Stand ließ sich nicht laden: ${err.message}`);
        }
    }

    /**
     * Setzt den Akkordnamen eines Schlags; leer löscht ihn. Gibt es den Akkord in der Spur noch nicht, wird er ohne
     * Griff angelegt (den Griff aus dem Katalog setzt das Speichern, siehe normalizeChords()).
     * @param {Beat} beat Schlag
     * @param {string} name Akkordname
     * @returns {void}
     */
    setChordName(beat, name) {
        if (!name) {
            beat.chordId = null;
            return;
        }
        const staff = beat.voice.bar.staff;
        let id = [...staff.chords ?? []].find(([, c]) => c.name === name)?.[0];
        if (id === undefined) {
            const chord = new this.alphaTab.model.Chord();
            chord.name = name;
            id = name;
            staff.addChord(id, chord);
            // Ein Akkordname hat im Song einen Griff: Steht er schon in einer anderen Spur, gilt er auch hier.
            const known = this.songChordGrip(name, staff.tuning.length);
            if (known) this.setChordGrip(staff, name, known);
        }
        beat.chordId = id;
    }

    /**
     * Dialog für einen Akkord: Name und Griff zusammen. Die Namensvorschläge kommen nur aus den Regeln der Akkordtheorie
     * (suggestChordNames()), nie aus dem Song oder dem Katalog. Ein neuer Name trägt den ersten seiner Griffe ins Feld ein
     * (candidates()); das Griffbild zeigt immer den Griff im Feld. "Übernehmen" gibt es nur mit bekanntem Namen und einem
     * Griff, der dazu passt. "Übernehmen" setzt den Akkord an den Schlag am Cursor; hat der Name im Song schon einen Griff, gilt der neue für alle Stellen.
     * In den Katalog kommt er mit dem Speichern des Songs (der Katalog baut sich aus den Songs auf).
     * @param {boolean} current Akkord am Cursor ändern (sein Name und Griff stehen vorbelegt), sonst ein neuer
     * @returns {Promise<void>}
     */
    async openChordDialog(current) {
        const library = await loadChordLibraryOrEmpty();
        const usage = await loadChordUsage().catch(() => ({}));
        const beat = edit.beatAt(this.score, this.pos);
        const chordBeat = this.chordBeat(beat);
        const staff = chordBeat.voice.bar.staff;
        const strings = staff.tuning.length;
        const existing = chordBeat.chordId ? staff.chords?.get(chordBeat.chordId) ?? null : null;
        if (current && !existing) {
            this.toast('Erst einen Akkord setzen.');
            return;
        }
        // Töne der leeren Saiten von der tiefen Saite aus; Katalog und Griffe gelten für das Standard-Tuning.
        const tuning = [...staff.tuning].reverse();
        const standard = isStandardTuning(staff);

        openOverlay(`
      <h2>${current ? 'Akkord bearbeiten' : 'Akkord hinzufügen'}</h2>
      <form id="chordForm" autocomplete="off">
        <div class="chord-edit">
          <div class="chord-fields">
            <div class="form-field">
              <label for="chordName">Name</label>
              <input type="text" id="chordName" list="chordNames" placeholder="z. B. Am7" value="${escapeHtml(current ? existing.name : '')}">
              <datalist id="chordNames"></datalist>
              <div class="hint" id="chordTones"></div>
            </div>
            <div class="form-field">
              <label for="chordGrip">Griff (tiefe Saite zuerst)</label>
              <input type="text" id="chordGrip" placeholder="z. B. x02210" value="${escapeHtml(current ? gripOf(existing) : '')}">
              <div class="hint" id="chordHint"></div>
              <div class="hint hint-warn" id="chordMismatch" hidden></div>
            </div>
          </div>
          <div class="chord-live" id="chordLive" aria-live="polite"></div>
        </div>
        <div class="form-field" id="chordAlternatives" hidden>
          <span class="label">Weitere Griffe zum Namen</span>
          <div class="chord-grips" id="chordGrips"></div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="chordOk" type="submit" disabled>Übernehmen</button>
          <button class="btn" id="chordCancel" type="button">Abbrechen</button>
        </div>
      </form>`);

        const byId = id => /** @type {HTMLInputElement} */ (document.getElementById(id));
        const nameInput = byId('chordName');
        const gripInput = byId('chordGrip');
        /**
         * Griff prüfen: so viele Angaben wie die Spur Saiten hat, Bünde von 0 bis 24 oder x, mindestens eine gespielte Saite.
         * @param {string} grip Eingabe
         * @returns {boolean} ob es ein Griff für die Saiten der Spur ist
         */
        const valid = grip => {
            const frets = parseGrip(grip);
            return frets.length === strings && frets.every(f => Number.isInteger(f) && f >= -1 && f <= 24)
                && frets.some(f => f >= 0);
        };
        /**
         * Griffe des Katalogs zu einem Namen, so wie er nach dem Speichern des Songs wäre: Dazu kommt der Griff, den der Song für
         * den Namen hat, wenn der Katalog ihn noch nicht kennt (er zählt mit den Schlägen des Songs). Häufigster zuerst, bei
         * Gleichstand der weiter unten am Hals, wie beim Aufbau des Katalogs (chord_library_json()).
         * @param {string} name Akkordname
         * @returns {string[]}
         */
        const catalogGrips = name => {
            if (!standard) return [];
            const key = chordKey(name);
            const counts = new Map(Object.entries(usage[key] ?? {}));
            for (const grip of library[key] ?? []) if (!counts.has(grip)) counts.set(grip, 0);
            const songGrip = this.songChordGrip(name, strings);
            if (songGrip && !counts.has(songGrip)) {
                let beats = 0;
                for (const st of stringedStaves(this.score)) for (const bar of st.bars) for (const voice of bar.voices) for (const b of voice.beats) {
                    if (b.chordId && st.chords?.get(b.chordId)?.name === name) beats += 1;
                }
                counts.set(songGrip, beats);
            }
            const top = grip => Math.max(...parseGrip(grip));
            return [...counts].sort((a, b) => b[1] - a[1] || top(a[0]) - top(b[0]) || a[0].localeCompare(b[0])).map(([grip]) => grip);
        };
        /**
         * Griffe, die zum Namen passen, in dieser Reihenfolge: der Katalog (catalogGrips()), die berechneten Griffe der Priorität 1
         * und 2 (findGrips()), zum Auffüllen der ersten Reihe (GRIPS_PER_ROW) die der Priorität 3, dann 4; höchstens vier Reihen.
         * @returns {string[]}
         */
        const candidates = () => {
            const name = nameInput.value.trim();
            if (!name) return [];
            const found = findGrips(name, {tuning, all: true}).filter(g => valid(g.grip));
            const list = [...new Set([...catalogGrips(name).filter(valid), ...found.filter(g => g.priority <= 2).map(g => g.grip)])];
            for (const g of found) {
                if (list.length >= GRIPS_PER_ROW) break;
                if (!list.includes(g.grip)) list.push(g.grip);
            }
            return list.slice(0, 4 * GRIPS_PER_ROW);
        };
        /** Zeichnet Griffbild, weitere Griffe, Hinweis und Knopf passend zu Name und Griff neu. */
        const render = () => {
            const name = nameInput.value.trim();
            const grip = gripInput.value.trim();
            const gripOk = valid(grip);
            // Das Griffbild zeigt immer den Griff im Feld, sobald er gültig ist.
            byId('chordLive').innerHTML = gripOk ? chordDiagramSvg(name || '?', grip) : '';
            // Die anderen Griffe des Namens zur Auswahl; der gewählte ist markiert.
            const others = candidates();
            byId('chordAlternatives').hidden = others.length < 2;
            byId('chordGrips').innerHTML = others.map(g => `
        <button type="button" class="chord-pick" data-grip="${escapeHtml(g)}" aria-pressed="${g === grip}"
          title="${escapeHtml(g)}">${chordDiagramSvg(name, g)}</button>`).join('');
            const songGrip = name ? this.songChordGrip(name, strings) : '';
            // Der Hinweis auf die Wirkung für alle Stellen steht rot, die anderen Hinweise (Eingabehilfe) neutral.
            const overwrites = gripOk && !!songGrip && songGrip !== grip;
            byId('chordHint').classList.toggle('hint-warn', overwrites);
            byId('chordHint').textContent = !grip
                ? (name && !others.length ? 'Kein Griff bekannt: bitte eingeben, z. B. "x02210" (x = nicht gespielt).' : '')
                : !gripOk
                    ? `Griff: ${strings} Angaben von der tiefen Saite aus, z. B. "x02210" (x = nicht gespielt; ab Bund 10 mit "-" trennen).`
                    : overwrites ? 'Der Akkord steht schon im Song: Der neue Griff gilt für alle Stellen.' : '';
            const chord = name ? parseChord(name) : null;
            // Die Töne des Akkords; ein Name, den die Regeln nicht kennen, geht nicht.
            const tones = byId('chordTones');
            tones.classList.toggle('hint-warn', !!name && !chord);
            tones.textContent = !name ? '' : chord ? `Töne: ${chordNoteNames(chord).join(' ')}` : 'Dieser Akkordname ist unbekannt.';
            // Passt der Griff nicht zum Namen: rote Warnung mit den Namen, die zum Griff passen.
            const mismatch = byId('chordMismatch');
            const problem = gripOk && chord ? gripToneProblem(chord, parseGrip(grip), tuning) : null;
            mismatch.hidden = !problem;
            // Übernehmen nur mit bekanntem Namen und einem Griff, der dazu passt.
            byId('chordOk').disabled = !chord || !gripOk || !!problem;
            if (problem) {
                const alike = nameGrip(parseGrip(grip), tuning, 3);
                mismatch.innerHTML = `Der Griff passt nicht zu ${escapeHtml(name)}.`
                    + (alike.length ? ` Er klingt wie ${alike.map(n => `<button type="button" class="chord-name-pick" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join(', ')}.` : '');
            }
        };
        /** Vorschläge zum Namen, der bisher getippt wurde: alle Namen nach den Regeln der Akkordtheorie, die so beginnen. */
        const suggest = () => {
            const list = suggestChordNames(nameInput.value, 80);
            byId('chordNames').innerHTML = list.map(n => `<option value="${escapeHtml(n)}">`).join('');
        };
        // Ein anderer Name holt immer seinen Griff (den ersten bekannten); ein geänderter Griff ändert nur das Griffbild.
        nameInput.addEventListener('input', () => {
            suggest();
            gripInput.value = candidates()[0] ?? '';
            render();
        });
        byId('chordMismatch').addEventListener('click', e => {
            const pick = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-name]'));
            if (!pick) return;
            nameInput.value = pick.dataset.name;
            render();
        });
        gripInput.addEventListener('input', render);
        byId('chordGrips').addEventListener('click', e => {
            const pick = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-grip]'));
            if (!pick) return;
            gripInput.value = pick.dataset.grip;
            render();
        });
        byId('chordCancel').addEventListener('click', closeOverlay);
        byId('chordForm').addEventListener('submit', e => {
            e.preventDefault();
            if (byId('chordOk').disabled) return;
            const name = nameInput.value.trim();
            const grip = gripInput.value.trim();
            closeOverlay();
            this.applyChord(name, grip, current ? existing.name : '');
        });
        if (!current) nameInput.focus();
        render();
    }

    // ----------------------------------------------------------------------------------------------------
    // Panel "Liedtext"
    // ----------------------------------------------------------------------------------------------------
    /**
     * Füllt das Panel "Liedtext" mit dem Text der Spur mit dem Liedtext (außer während darin geschrieben wird).
     * @returns {void}
     */
    fillLyrics() {
        const panel = this.part('edit-right');
        const area = /** @type {?HTMLTextAreaElement} */ (panel?.querySelector('[data-lyrics]'));
        const track = this.lyricsTarget();
        if (!area || !track) return;
        // Die Vorschau gilt auch, während geschrieben wird (dann ruft applyLyrics() fillLyrics() nicht).
        this.renderLyricsView();
        if (document.activeElement === area || this.lyricsOverflow) return;
        area.value = lyricsLines(this.score, track);
        area.title = this.lyricsTitle(track, []);
        this.lyricsRed = [];
        this.showLyricsAt(edit.beatAt(this.score, this.pos));
        this.showChordFileButton();
    }

    /**
     * Zeigt den Knopf "Chord-Datei importieren" über dem Liedtext-Feld nur, solange das Feld leer ist (die Zeilen mit
     * den Abschnittsnamen zählen nicht).
     * @returns {void}
     */
    showChordFileButton() {
        const panel = this.part('edit-right');
        const area = /** @type {HTMLTextAreaElement} */ (panel.querySelector('[data-lyrics]'));
        const empty = area.value.split('\n').every(line => !line.trim() || /^\s*\[[^\]]*]\s*$/.test(line));
        const tools = /** @type {HTMLElement} */ (panel.querySelector('[data-chord-tools]'));
        tools.hidden = !empty;
    }

    /**
     * Hinweis zum Liedtext-Feld (Mouseover): Spur und die Abschnitte, deren Text zu lang ist oder die in den Noten fehlen.
     * @param {import('../../types/alphatab').model.Track} track Spur mit dem Text
     * @param {{name: string, left: number, missing?: boolean}[]} overflow Abschnitte mit Silben ohne Schlag
     * @returns {string}
     */
    lyricsTitle(track, overflow) {
        const left = overflow.map(o => o.missing ? `Abschnitt ${o.name} fehlt in den Noten`
            : `${o.name}: ${o.left} ${o.left === 1 ? 'Silbe' : 'Silben'} ohne Schlag (Text zu lang)`);
        return [`Spur: ${trackName(track)}`, ...left].join('\n');
    }

    /**
     * Zeigt unter dem Liedtext die Ansicht "Text & Akkorde" der bearbeiteten Noten, wie im Player. Nur bei
     * offenem Panel; beim Schreiben einmal je Übernahme (applyLyrics(), also schon verzögert).
     * @returns {void}
     */
    renderLyricsView() {
        const panel = this.part('edit-right');
        const view = /** @type {?HTMLElement} */ (panel?.querySelector('[data-lyrics-view]'));
        if (!view || !this.score || panel.classList.contains('collapsed')) return;
        const top = view.scrollTop;
        view.innerHTML = renderTextView(buildTextModel(this.score));
        view.scrollTop = top;
        const area = panel.querySelector('[data-lyrics]');
        // Es gilt der Cursor, der gerade bedient wird: im Feld oder in den Noten.
        const focused = document.activeElement === area;
        const beat = focused ? this.lyricsCaretBeat() : this.lyricsBeatAt(edit.beatAt(this.score, this.pos));
        if (beat) this.markLyricsView(beat);
        else if (focused) this.scrollLyricsView();
    }

    /**
     * Zeigt beim Abspielen die Silbe an der Abspielposition im Liedtext-Feld und in der Vorschau (nur bei offenem Panel).
     * @param {number} tick Abspielposition (Ticks)
     * @returns {void}
     */
    followPlayback(tick) {
        const ticks = this.player.api?.tickCache;
        const track = this.score && this.lyricsTarget();
        if (!this.score || !ticks || !track || this.part('edit-right').classList.contains('collapsed')) return;
        let found = null;
        search: for (const bar of track.staves[0].bars) for (const beat of bar.voices[0]?.beats ?? []) {
            if (!beat.lyrics?.[0]?.trim()) continue;
            if (ticks.getBeatStart(beat) > tick) break search;
            found = beat;
        }
        if (!found || found === this.playedLyric) return;
        this.playedLyric = found;
        // Auch mit dem Cursor im Feld (nach einem Klick dorthin) läuft alles mit, nur nicht, solange man gerade schreibt:
        // Dann folgt allein die Vorschau.
        if (Date.now() - this.lyricsInputAt < LYRICS_TYPING_MS) this.markLyricsView(found);
        else this.showLyricsAt(found, true);
    }

    /**
     * Schlag mit Silbe in der Spur mit dem Text, der zu einem Schlag irgendeiner Spur gehört: die letzte Silbe, die
     * spätestens mit ihm beginnt (Zeit in der Reihenfolge der Noten).
     * @param {?Beat} beat Schlag
     * @returns {?Beat}
     */
    lyricsBeatAt(beat) {
        const track = this.lyricsTarget();
        if (!beat || !track) return null;
        const time = b => b.voice.bar.masterBar.start + b.playbackStart;
        const t = time(beat);
        let found = null;
        for (const bar of track.staves[0].bars) for (const b of bar.voices[0]?.beats ?? []) {
            if (time(b) > t) return found;
            if (b.lyrics?.[0]?.trim()) found = b;
        }
        return found;
    }

    /**
     * Zeichenbereich der Silbe eines Schlags im Liedtext-Feld, gezählt wie in setLyricsText() (je Abschnitt in seinen
     * Takten). Nur solange das Feld den Text der Noten zeigt.
     * @param {Beat} beat Schlag mit Silbe in der Spur mit dem Text
     * @returns {?{from: number, to: number}}
     */
    lyricsRangeOf(beat) {
        const area = /** @type {HTMLTextAreaElement} */ (this.part('edit-right').querySelector('[data-lyrics]'));
        const track = this.lyricsTarget();
        if (!track || this.lyricsOverflow) return null;
        const time = b => b.voice.bar.masterBar.start + b.playbackStart;
        const text = area.value;
        const blocks = edit.splitLyricsBlocks(text);
        const ranges = edit.lyricsBlockRanges(blocks, lyricsSectionStarts(this.score, track));
        const i = ranges.findIndex(r => r && r.from <= time(beat) && time(beat) < r.to);
        if (i < 0) return null;
        const sung = track.staves[0].bars.flatMap(bar => bar.voices[0]?.beats ?? [])
            .filter(b => b.lyrics?.[0]?.trim() && time(b) >= ranges[i].from && time(b) < ranges[i].to);
        const k = sung.indexOf(beat);
        const lines = text.split('\n');
        const from = lines.slice(0, blocks[i].line).reduce((n, l) => n + l.length + 1, 0);
        const to = blocks[i + 1] ? lines.slice(0, blocks[i + 1].line).reduce((n, l) => n + l.length + 1, 0)
            : text.length;
        const range = k >= 0 ? edit.syllableRanges(text.slice(from, to))[k] : null;
        return range ? {from: from + range.from, to: from + range.to} : null;
    }

    /**
     * Zeigt im Liedtext-Feld und in der Vorschau die Silbe zum Schlag am Cursor der Noten (hinterlegt, ins Bild
     * gerollt). Nicht, solange im Feld geschrieben wird oder der Cursor dort steht (dann gilt er, followLyricsCaret()),
     * und nur bei offenem Panel. Beim Abspielen (playing) gilt die Abspielposition auch mit dem Cursor im Feld.
     * @param {?Beat} beat Schlag am Cursor (irgendeine Spur)
     * @param {boolean} [playing] Aufruf beim Abspielen (followPlayback())
     * @returns {void}
     */
    showLyricsAt(beat, playing = false) {
        const panel = this.part('edit-right');
        const area = /** @type {?HTMLTextAreaElement} */ (panel?.querySelector('[data-lyrics]'));
        if (!area || !this.score || panel.classList.contains('collapsed')) return;
        if (document.activeElement === area && !playing) {
            this.drawLyricsMarks();
            return;
        }
        const lyricBeat = this.lyricsBeatAt(beat);
        this.lyricsCur = lyricBeat ? this.lyricsRangeOf(lyricBeat) : null;
        const cur = this.drawLyricsMarks(playing);
        if (cur) {
            const top = cur.offsetTop;
            if (top < area.scrollTop || top > area.scrollTop + area.clientHeight - 24) {
                area.scrollTop = Math.max(0, top - area.clientHeight / 3);
                const marks = /** @type {HTMLElement} */ (panel.querySelector('.elyrics-marks'));
                marks.scrollTop = area.scrollTop;
            }
        }
        if (lyricBeat) this.markLyricsView(lyricBeat);
    }

    /**
     * Schlag der Silbe, an der der Cursor im Liedtext-Feld steht: in einem Wort die Silbe, in der er steht, zwischen
     * zwei Wörtern die davor, auf einer Abschnittszeile die erste des Abschnitts. Gezählt wird wie in setLyricsText()
     * (je Abschnitt in seinen Takten); gilt, solange das Feld den Text der Noten zeigt (nicht bei zu langem Text).
     * @returns {?Beat}
     */
    lyricsCaretBeat() {
        const area = /** @type {?HTMLTextAreaElement} */ (this.part('edit-right')?.querySelector('[data-lyrics]'));
        const track = this.lyricsTarget();
        if (!area || !track || !this.score || this.lyricsOverflow) return null;
        const text = area.value;
        const caret = area.selectionStart;
        const lines = text.split('\n');
        const line = text.slice(0, caret).split('\n').length - 1;
        const blocks = edit.splitLyricsBlocks(text);
        const i = blocks.findLastIndex(b => b.line <= line);
        const range = edit.lyricsBlockRanges(blocks, lyricsSectionStarts(this.score, track))[i];
        if (!range) return null;
        const from = lines.slice(0, blocks[i].line).reduce((n, l) => n + l.length + 1, 0);
        // Bis zum Ende der Silbe am Cursor ("Str|uk-tur" zählt "Struk-" mit).
        const end = caret + (text.slice(caret).match(/^[^\s-]*-?/)?.[0].length ?? 0);
        const count = edit.splitSyllables(text.slice(from, end)).filter(s => s.trim()).length;
        const time = b => b.voice.bar.masterBar.start + b.playbackStart;
        const sung = track.staves[0].bars.flatMap(bar => bar.voices[0]?.beats ?? [])
            .filter(b => b.lyrics?.[0]?.trim() && time(b) >= range.from && time(b) < range.to);
        return sung[Math.max(0, count - 1)] ?? null;
    }

    /**
     * Setzt den Cursor in den Noten auf die Silbe, an der der Cursor im Liedtext-Feld steht, rollt dorthin und hebt sie
     * in der Vorschau "Text & Akkorde" hervor. Ist die Spur mit dem Text nicht zu sehen, geht der Cursor in ihren Takt.
     * Läuft die Wiedergabe, springt sie zu dieser Silbe und spielt von dort weiter.
     * @returns {void}
     */
    followLyricsCaret() {
        const beat = this.lyricsCaretBeat();
        if (!beat) {
            this.scrollLyricsView();
            return;
        }
        const track = beat.voice.bar.staff.track.index;
        const bar = beat.voice.bar.index;
        this.pos = edit.clampPosition(this.score, this.trackIndexes.includes(track)
            ? movedPosition(this.pos, {track, bar, beat: beat.index}) : movedPosition(this.pos, {bar, beat: 0}));
        this.updateState();
        this.drawCursor(true);
        this.markLyricsView(beat);
        // Beim Abspielen springt die Wiedergabe mit (Noten, Audiospur), wie ein Klick in "Text & Akkorde" im Player.
        const api = this.player.api;
        const tick = this.player.isPlaying ? api.tickCache?.getBeatStart(beat) : undefined;
        if (tick !== undefined) {
            this.playedLyric = beat;
            api.tickPosition = tick;
        }
    }

    /**
     * Hebt in der Vorschau "Text & Akkorde" die Silbe eines Schlags hervor (wie der Player beim Abspielen) und rollt sie
     * ins Bild. Die Zeit kommt aus dem MIDI von alphaTab (erstes Vorkommen in Abspielreihenfolge), solange es noch
     * fehlt aus den Noten.
     * @param {Beat} beat Schlag mit Silbe
     * @returns {void}
     */
    markLyricsView(beat) {
        const view = /** @type {?HTMLElement} */ (this.part('edit-right')?.querySelector('[data-lyrics-view]'));
        if (!view) return;
        for (const el of view.querySelectorAll('.tv-now-syl')) el.classList.remove('tv-now-syl');
        const ticks = this.player.api.tickCache;
        const t = (ticks ? ticks.getBeatStart(beat) : 0) || beat.voice.bar.masterBar.start + beat.playbackStart;
        const parts = /** @type {HTMLElement[]} */ ([...view.querySelectorAll('[data-t]')]);
        const part = parts.find(p => Number(p.dataset.t) === t && !p.classList.contains('tv-empty'))
            ?? parts.filter(p => Number(p.dataset.t) <= t).at(-1);
        if (!part) return;
        part.classList.add('tv-now-syl');
        const offset = part.getBoundingClientRect().top - view.getBoundingClientRect().top;
        if (offset < 0 || offset > view.clientHeight - 30) view.scrollTop += offset - view.clientHeight / 3;
    }

    /**
     * Rollt die Vorschau "Text & Akkorde" zum Abschnitt, in dem der Cursor im Liedtext-Feld steht (zum ersten mit
     * demselben Namen), wenn er nicht schon zu sehen ist.
     * @returns {void}
     */
    scrollLyricsView() {
        const panel = this.part('edit-right');
        const area = /** @type {HTMLTextAreaElement} */ (panel.querySelector('[data-lyrics]'));
        const view = /** @type {HTMLElement} */ (panel.querySelector('[data-lyrics-view]'));
        const line = area.value.slice(0, area.selectionStart).split('\n').length - 1;
        const block = edit.splitLyricsBlocks(area.value).filter(b => b.line <= line).at(-1);
        const name = block?.text.match(/^\s*\[([^\]]*)]/)?.[1].trim();
        const heading = name ? [...view.querySelectorAll('.tv-section h3')].find(h => h.textContent.trim() === name) : null;
        const section = /** @type {?HTMLElement} */ (heading?.closest('.tv-section') ?? null);
        if (!section) return;
        const offset = section.getBoundingClientRect().top - view.getBoundingClientRect().top;
        if (offset < 0 || offset > view.clientHeight - 40) view.scrollTop += offset;
    }

    /**
     * Markiert Abschnitte des Liedtexts rot (Ebene hinter dem Feld mit demselben Text, nur die Hintergründe zu sehen).
     * @param {{line: number, lines: number}[]} blocks Abschnitte: erste Zeile und Zahl der Zeilen
     * @returns {void}
     */
    markLyrics(blocks) {
        this.lyricsRed = blocks;
        this.drawLyricsMarks();
    }

    /**
     * Zeichnet die Ebene hinter dem Liedtext-Feld: rote Abschnitte (lyricsRed) und, solange das Feld nicht den Fokus
     * hat (beim Abspielen auch mit Fokus), die Silbe am Cursor der Noten bzw. an der Abspielposition (lyricsCur).
     * @param {boolean} [playing] beim Abspielen: die Silbe auch zeigen, wenn das Feld den Fokus hat
     * @returns {?HTMLElement} Markierung der Silbe am Cursor, null ohne
     */
    drawLyricsMarks(playing = false) {
        const panel = this.part('edit-right');
        const area = /** @type {HTMLTextAreaElement} */ (panel.querySelector('[data-lyrics]'));
        const marks = /** @type {HTMLElement} */ (panel.querySelector('.elyrics-marks'));
        const red = new Set(this.lyricsRed.flatMap(b => Array.from({length: b.lines}, (_, i) => b.line + i)));
        const cur = document.activeElement === area && !playing ? null : this.lyricsCur;
        if (!red.size && !cur) {
            marks.innerHTML = '';
            return null;
        }
        let offset = 0;
        marks.innerHTML = area.value.split('\n').map((line, i) => {
            const start = offset;
            offset += line.length + 1;
            const html = cur && cur.from >= start && cur.to <= start + line.length
                ? escapeHtml(line.slice(0, cur.from - start)) + `<mark class="elyrics-cur">${escapeHtml(line.slice(cur.from - start,
                cur.to - start))}</mark>` + escapeHtml(line.slice(cur.to - start)) : escapeHtml(line);
            return red.has(i) ? `<mark>${html || ' '}</mark>` : html;
        }).join('\n') + '\n';
        marks.scrollTop = area.scrollTop;
        return marks.querySelector('.elyrics-cur');
    }

    /**
     * Verteilt den Text aus dem Panel "Liedtext" auf die Schläge (setLyricsText()) und zeichnet die Noten neu, während
     * geschrieben wird. Alles bis zum Verlassen des Felds ist ein Schritt für "Rückgängig". Verteilt wird immer vom
     * Stand vor diesem Schritt aus (lyricsBase): Ein zu langer Abschnitt rückt seine Silben Schlag für Schlag nach und
     * füllt dabei Lücken; wird er wieder gekürzt, stehen die Silben so wieder wie vorher. Silben, für die keine Schläge
     * mehr da sind oder deren Abschnitt in den Noten fehlt, sind rot, der Tooltip nennt sie. Mit reflow kommt der Text
     * des Abschnitts am Cursor neu auf seine Noten, eine Silbe je Note der Reihe nach (Knopf neben "Liedtext-Silbe").
     * Mit marks (Import einer Akkorddatei) liegt der Text danach an Taktstrichen bzw. Akkorden (anchorLyrics()). Ohne
     * Abschnittszeilen im Text gilt er für den ganzen Song (lyricsSections()).
     * @param {{reflow?: boolean, marks?: ?import('./chordfile.js').FileChord[]}} [options] reflow: Abschnitt am Cursor
     *   vorher leeren; marks: Akkorde und Taktstriche der Datei
     * @returns {?{result: ReturnType<typeof edit.setLyricsText>, track: Track,
     *   anchors: ?ReturnType<typeof edit.anchorLyrics>}} Ergebnis von setLyricsText() (nach den Ankern), die Spur, auf
     *   die es sich bezieht (Schläge mit denselben Indizes wie in this.score), und das von anchorLyrics(); null ohne
     *   Spur mit Text
     */
    applyLyrics({reflow = false, marks = null} = {}) {
        this.lyricsTimer = 0;
        const panel = this.part('edit-right');
        const area = /** @type {HTMLTextAreaElement} */ (panel?.querySelector('[data-lyrics]'));
        const track = this.lyricsTarget();
        if (!area || !track) return null;
        const index = track.index;
        // Ist der Text noch zu lang, gilt der Stand davor auch nach Verlassen des Felds weiter.
        const base = this.lyricsTyping || this.lyricsOverflow ? this.lyricsBase : this.tex;
        const baseTrack = parseScore(this.alphaTab, base, this.player.api.settings).tracks[index];
        const text = area.value;
        // Die Abschnitte so, wie das Feld sie zeigt (vor der Änderung, mit dem bisherigen Text).
        const sections = this.lyricsSections(baseTrack, text);
        if (reflow) {
            // Abschnitt am Cursor (nach Takten), mit einer Zeile, die schon im Takt davor beginnt.
            const k = sections.findLastIndex(s => s.start <= baseTrack.score.masterBars[this.pos.bar].start);
            edit.clearLyrics(baseTrack, k >= 0 ? sections[k].t : -Infinity, sections[k + 1]?.t ?? Infinity);
        }
        const result = edit.setLyricsText(baseTrack, text, sections);
        const anchors = marks ? edit.anchorLyrics(baseTrack, text, sections, marks, chordTimeline(baseTrack.score),
            result.beats) : null;
        if (anchors) {
            anchors.lefts.forEach((left, i) => {
                if (left >= 0) result.lefts[i] = left;
            });
            anchors.beats.forEach((list, i) => {
                if (list) result.beats[i] = /** @type {Beat[]} */ (list);
            });
            result.left = result.lefts.reduce((x, y) => x + y, 0);
        }
        const before = this.tex;
        // Vor dem Neuzeichnen: Mit zu langem Text füllt fillLyrics() das Feld nicht neu (ohne Fokus, z. B. beim Import).
        this.lyricsOverflow = result.left > 0;
        this.change(() => edit.copyLyrics(baseTrack, this.score.tracks[index]),
            {merge: this.lyricsTyping, label: 'Liedtext geändert'});
        // Erst wenn sich etwas geändert hat, gibt es den Schritt, an den sich weiteres Schreiben anhängt.
        if (this.tex !== before && !this.lyricsTyping) {
            this.lyricsTyping = true;
            this.lyricsBase = base;
        }
        this.markLyricsProblems(area, text, result, this.score.tracks[index]);
        return {result, track: baseTrack, anchors};
    }

    /**
     * Markiert im Feld "Liedtext" die Abschnitte rot, deren Text keine Schläge mehr findet, und nennt sie im Tooltip.
     * @param {HTMLTextAreaElement} area Feld
     * @param {string} text Text im Feld
     * @param {{lefts: number[], missing: boolean[]}} result Ergebnis von setLyricsText()
     * @param {Track} track Spur mit dem Text
     * @returns {void}
     */
    markLyricsProblems(area, text, result, track) {
        const blocks = edit.splitLyricsBlocks(text);
        const red = blocks.filter((b, i) => result.lefts[i] > 0);
        this.markLyrics(red);
        area.title = this.lyricsTitle(track, red.map(b => {
            const i = blocks.indexOf(b);
            return {
                name: b.text.match(/^\s*\[([^\]]*)]/)?.[1] ?? 'Anfang',
                left: result.lefts[i],
                missing: result.missing[i]
            };
        }));
    }

    // ----------------------------------------------------------------------------------------------------
    // Maus und Cursor
    // ----------------------------------------------------------------------------------------------------

    /**
     * Position an einer Stelle des Notenblatts.
     * @param {number} x waagerecht, relativ zur Notenansicht
     * @param {number} y senkrecht, relativ zur Notenansicht
     * @returns {?EditPosition} null, wenn dort nichts ist
     */
    hitTest(x, y) {
        const lookup = this.player.api.boundsLookup;
        const systems = lookup?.staffSystems ?? [];
        if (!systems.length) return null;
        const distance = (b, v) => v < b.y ? b.y - v : v > b.y + b.h ? v - b.y - b.h : 0;
        const system = systems.reduce((best, sys) =>
            distance(sys.realBounds, y) < distance(best.realBounds, y) ? sys : best);
        const masterBar = system.bars.find(m => x < m.realBounds.x + m.realBounds.w) ?? system.bars.at(-1);
        if (!masterBar) return null;
        const entry = masterBar.bars.reduce((best, b) =>
            distance(b.visualBounds, y) < distance(best.visualBounds, y) ? b : best);
        const bar = entryBar(entry);
        if (!bar || bar.staff.index !== 0) return null;
        const staff = bar.staff;
        const beats = bar.voices[0]?.beats ?? [];
        let beat = 0;
        beats.forEach((b, i) => {
            const bounds = lookup.findBeat(b);
            if (bounds && bounds.visualBounds.x - CURSOR_PAD <= x) beat = i;
        });
        let string = this.pos.string;
        const entries = masterBar.bars.filter(b => entryBar(b) === bar);
        if (staff.showTablature && entry === entries.at(-1) && staff.tuning.length > 1) {
            const tab = entry.visualBounds;
            const spacing = tab.h / (staff.tuning.length - 1);
            string = staff.tuning.length - Math.round((y - tab.y) / spacing);
        }
        return {track: staff.track.index, bar: bar.index, beat, string};
    }


    /**
     * Kennzeichnet Takte, deren Schläge nicht zur Taktart passen: rote Fläche über dem Takt und ein Zeichen oben links,
     * dessen Hinweis beim Darüberfahren erscheint (edit.barLengthProblems()).
     * @returns {void}
     */
    drawProblems() {
        const layer = this.cursorEl?.querySelector('.edit-problems');
        if (!layer) return;
        layer.innerHTML = '';
        const lookup = this.player.api.boundsLookup;
        if (!this.score || !lookup) return;
        for (const {bar, text} of edit.barLengthProblems(this.score)) {
            const first = bar.voices[0]?.beats[0];
            const bounds = first ? lookup.findBeat(first) : null;
            const entries = bounds?.barBounds.masterBarBounds.bars.filter(b => entryBar(b) === bar);
            if (!entries?.length) continue;
            const top = entries[0].visualBounds.y;
            const last = entries.at(-1).visualBounds;
            const area = document.createElement('div');
            area.className = 'edit-problem';
            Object.assign(area.style, {
                left: `${entries[0].visualBounds.x}px`, top: `${top - CURSOR_PAD}px`,
                width: `${entries[0].visualBounds.w}px`, height: `${last.y + last.h - top + 2 * CURSOR_PAD}px`,
            });
            const flag = document.createElement('div');
            flag.className = 'edit-problem-flag';
            flag.textContent = '!';
            flag.title = text;
            area.append(flag);
            layer.append(area);
        }
    }

    /**
     * Zeichnet die ausgewählten Takte als Flächen über der Spur.
     * @returns {void}
     */
    drawSelection() {
        const layer = this.cursorEl?.querySelector('.edit-selection');
        if (!layer) return;
        layer.innerHTML = '';
        const lookup = this.player.api.boundsLookup;
        // Ausgewählte Schläge: je eine Spalte wie beim Cursor.
        if (lookup) for (const beat of this.selectedBeats()) {
            const bounds = lookup.findBeat(beat);
            const entries = bounds?.barBounds.masterBarBounds.bars.filter(b => entryBar(b) === beat.voice.bar);
            if (!bounds || !entries?.length) continue;
            const top = entries[0].visualBounds.y;
            const last = entries.at(-1).visualBounds;
            const box = document.createElement('div');
            Object.assign(box.style, {
                left: `${bounds.visualBounds.x - CURSOR_PAD}px`, top: `${top - CURSOR_PAD}px`,
                width: `${Math.max(bounds.visualBounds.w, 12) + 2 * CURSOR_PAD}px`,
                height: `${last.y + last.h - top + 2 * CURSOR_PAD}px`,
            });
            layer.append(box);
        }
        const sel = this.selection;
        const staff = sel ? edit.editStaff(this.score, sel.track) : null;
        if (!sel || !lookup || !staff) return;
        for (let i = sel.from; i <= sel.to; i++) {
            const bar = staff.bars[i];
            const first = bar?.voices[0]?.beats[0];
            const bounds = first ? lookup.findBeat(first) : null;
            if (!bounds) continue;
            const entries = bounds.barBounds.masterBarBounds.bars.filter(b => entryBar(b) === bar);
            if (!entries.length) continue;
            const top = entries[0].visualBounds.y;
            const last = entries.at(-1).visualBounds;
            const box = document.createElement('div');
            Object.assign(box.style, {
                left: `${entries[0].visualBounds.x}px`, top: `${top - CURSOR_PAD}px`,
                width: `${entries[0].visualBounds.w}px`, height: `${last.y + last.h - top + 2 * CURSOR_PAD}px`,
            });
            layer.append(box);
        }
    }

    /**
     * Rollt die Seite, bis der Cursor zwischen Werkzeugleiste und unterem Panel zu sehen ist.
     * @param {HTMLElement} target Element des Cursors
     * @returns {void}
     */
    scrollCursorIntoView(target) {
        const rect = target.getBoundingClientRect();
        const top = this.songView.querySelector('.songbar').getBoundingClientRect().bottom + 20;
        const bottom = this.part('edit-bottom').getBoundingClientRect().top - 20;
        if (rect.top < top) window.scrollBy({top: rect.top - top});
        else if (rect.bottom > bottom) window.scrollBy({top: rect.bottom - bottom});
    }

    // ----------------------------------------------------------------------------------------------------
    // Felder der Panels
    // ----------------------------------------------------------------------------------------------------


    /**
     * Übernimmt ein Feld "Song": Tonart (ganzer Song), Capo und Tuning (die Bünde und Griffe bleiben) aus der Werkzeugleiste,
     * Taktart und Tempo aus dem linken Panel. Taktart und Tempo gelten ab dem Takt am Cursor bis zum nächsten Wechsel; ist das
     * Tempo dort gleich dem davor oder das Feld leer, gibt es keinen Wechsel.
     * @param {HTMLInputElement} input Feld (data-song)
     * @returns {void}
     */
    applySongField(input) {
        const at = this.alphaTab;
        const value = input.value.trim();
        const bar = this.pos.bar;
        this.change(() => {
            switch (input.dataset.song) {
                case 'key': {
                    const k = KEY_NAMES.indexOf(value);
                    edit.setKeySignature(at, this.score, 0, (k % 15) - 7, k >= 15, true);
                    break;
                }
                case 'ts': {
                    const ts = parseTimeSignature(value);
                    if (ts) edit.setTimeSignature(this.score, bar, ts.num, ts.den);
                    else this.toast('Taktart wie 4/4, 3/4 oder 6/8 angeben.');
                    break;
                }
                case 'tempo': {
                    if (!value) {
                        edit.setTempo(at, this.score, bar, null);
                        break;
                    }
                    // Tempi sind ganzzahlig (roundTempo()); eine Eingabe wie "120,5" gilt nicht, das Feld zeigt danach
                    // wieder das bisherige Tempo.
                    if (!/^\d+$/.test(value) || !(Number(value) > 0)) {
                        this.toast('Tempo als ganze Zahl angeben, z. B. 120.');
                        break;
                    }
                    const bpm = Number(value);
                    const same = bar > 0 && edit.roundTempo(edit.tempoAt(this.score, bar - 1)) === bpm;
                    edit.setTempo(at, this.score, bar, same ? null : bpm);
                    break;
                }
            }
        }, {label: input.dataset.song === 'key' ? 'Tonart geändert' : ''});
        this.fillSongFields();
    }

    /**
     * Übernimmt ein Feld "Takt" im linken Panel für den Takt am Cursor: Abschnitt (leer entfernt ihn), doppelter
     * Taktstrich.
     * @param {HTMLInputElement} input Feld (data-bar)
     * @returns {void}
     */
    applyBarField(input) {
        const bar = this.pos.bar;
        if (input.dataset.bar === 'section') this.change(() => edit.setSection(this.alphaTab, this.score, bar, input.value.trim()));
    }


    /**
     * Wendet die Änderungen des Dialogs "Transponieren" an (applyRetune() in transposedialog.js): Halbtöne, Capo, Tuning und
     * Tonart, als ein Schritt für "Rückgängig". Gespeichert wird keine Verschiebung.
     * @param {import('./transposedialog.js').Retune} change Änderung
     * @returns {Promise<void>}
     */
    async retuneSong(change) {
        const library = await loadChordLibraryOrEmpty();
        /** @type {?import('./notation.js').TransposeResult} */
        let result = null;
        this.change(() => {
            result = applyRetune(this.alphaTab, this.score, change, library);
        }, {label: 'Transponiert'});
        if (!result) return;
        const parts = [];
        if (change.semitones) parts.push(`${result.notes} Noten um ${change.semitones > 0 ? '+' : '−'}${Math.abs(change.semitones)} Halbtöne verschoben`);
        if (change.capo !== null) parts.push(`Capo ${change.capo}`);
        if (result.octaves) parts.push(`${result.octaves} Noten um eine Oktave versetzt`);
        if (result.skipped) parts.push(`${result.skipped} Noten blieben unverändert`);
        this.toast(parts.length ? parts.join('; ') + '.' : 'Angewendet.');
    }

    /**
     * Wendet die Änderung des Dialogs "Zeiteinteilung" an (retime() in timingdialog.js), als ein Schritt für
     * "Rückgängig". Erst an einer Kopie geprüft: Bei Problemen bleibt alles, wie es war.
     * @param {import('./timingdialog.js').Retime} plan Änderung (Notenwerte, Tempo, Takte, Taktart)
     * @returns {void}
     */
    retimeSong(plan) {
        const check = retime(this.alphaTab, parseScore(this.alphaTab, this.tex), plan);
        if (check.problems.length) {
            this.toast(check.problems[0]);
            return;
        }
        this.change(() => retime(this.alphaTab, this.score, plan),
            {pos: {bar: 0, beat: 0}, label: 'Metrum umgeschrieben'});
        this.toast(`Umgerechnet: ${this.score.masterBars.length} Takte${check.ties
            ? `, ${check.ties} Schläge angebunden` : ''}.`);
    }

    /**
     * Übernimmt ein Feld einer Spur im Dialog "Spuren": Name und Instrument (Klang und Notenlage). (Das Tuning gilt für alle Spuren und
     * steht in der Werkzeugleiste, siehe applySongField().)
     * @param {HTMLInputElement} input Feld (data-track-field, data-track)
     * @returns {void}
     */
    applyTrackField(input) {
        const track = this.score.tracks[Number(input.dataset.track)];
        const value = input.value.trim();
        const field = input.dataset.trackField;
        if (field === 'name') {
            // Namen sind frei (Auswahlliste mit den üblichen, siehe TRACK_NAMES), nur leer nicht.
            if (!value) {
                this.toast('Die Spur braucht einen Namen.');
                this.renderSongPanels();
                return;
            }
            this.change(() => {
                track.name = track.shortName = value;
            }, {label: 'Spur umbenannt'});
        } else if (field === 'instrument') {
            // Klang und Notenlage zusammen (docs/Instrumente.md).
            const instrument = edit.instrumentByKey(value);
            if (instrument) {
                this.change(() => edit.setInstrument(this.alphaTab, track, instrument), {label: 'Instrument geändert'});
            }
        }
    }


    /**
     * Griff, den ein Akkordname im Song schon hat (aus irgendeiner Spur).
     * @param {string} name Akkordname
     * @param {number} strings Zahl der Saiten (nur Spuren mit gleich vielen zählen)
     * @returns {string} Griff von der tiefen Saite aus, "" wenn der Song noch keinen hat
     */
    songChordGrip(name, strings) {
        for (const track of this.score.tracks) for (const staff of track.staves) {
            if (staff.tuning.length !== strings) continue;
            const chord = [...staff.chords?.values() ?? []].find(c => c.name === name && c.strings.length === strings);
            if (chord) return gripOf(chord);
        }
        return '';
    }

    /**
     * Setzt den Griff eines Akkordnamens im ganzen Song: in jeder Spur, in der der Akkord steht und die gleich viele
     * Saiten hat.
     * @param {string} name Akkordname
     * @param {string} grip Griff von der tiefen Saite aus, z. B. "x02210"
     * @returns {void}
     */
    setSongChordGrip(name, grip) {
        for (const track of this.score.tracks) for (const staff of track.staves) {
            this.setChordGrip(staff, name, grip);
        }
    }


    /**
     * Knopf "Passenden Akkord erkennen und einfügen" neben "Akkord": sammelt die Töne, die ab dem Schlag am Cursor bis
     * zum nächsten Akkordwechsel klingen (höchstens bis zum Taktende; alle Spuren außer Schlagzeug, gewichtet nach
     * Klingdauer, der tiefste als Bass; um den Capo der Akkordspur zurückgerechnet, denn Akkordnamen sind Griffnamen),
     * und setzt den passendsten Akkord (rankChords() in chordtheory.js) aus den Dreiklängen der Tonart und den Akkorden
     * des Songs; die des Songs werden bevorzugt. Ein Akkord des Songs behält seinen Griff, ein neuer bekommt den ersten
     * des Katalogs, ohne den den einfachsten berechneten (findGrips()), wie ihn der Dialog "Akkord" vorschlägt.
     * Nichts ändert sich (nur ein Hinweis), wenn dort schon derselbe Akkord klingt (gleiche Töne), wenn am Schlag schon
     * ein Akkord steht (der Knopf ergänzt, er ersetzt nicht) oder wenn nur eine Stimme klingt (nie zwei Töne zugleich):
     * Aus einer Melodie allein lässt sich kein Akkord sicher bestimmen (Probe an Kokain: ein Drittel richtig).
     * @returns {Promise<void>}
     */
    async detectChord() {
        const beat = this.score ? edit.beatAt(this.score, this.pos) : null;
        if (!beat) return;
        const mb = beat.voice.bar.masterBar;
        const from = mb.start + beat.playbackStart;
        const events = chordTimeline(this.score);
        const to = Math.min(events.find(e => e.tick > from)?.tick ?? Infinity, mb.start + mb.calculateDuration());
        // Akkordnamen sind Griffnamen in der Akkordspur: Klingende Töne um ihren Capo zurück, ebenso die Tonart.
        const staff = this.score.tracks[this.contentTrack('chords')]?.staves[0];
        const capo = staff?.capo ?? 0;
        const weights = new Array(12).fill(0);
        let low = Infinity;
        /** @type {[number, number][]} Klingzeit je Ton, um eine einzelne Stimme zu erkennen */
        const spans = [];
        for (const track of this.score.tracks) for (const st of track.staves) {
            if (st.isPercussion) continue;
            for (const voice of st.bars[mb.index]?.voices ?? []) for (const b of voice.beats) {
                const start = mb.start + b.playbackStart;
                const overlap = Math.min(start + b.playbackDuration, to) - Math.max(start, from);
                if (overlap <= 0 || b.isRest) continue;
                for (const note of b.notes) {
                    if (note.isDead) continue;
                    weights[((note.realValue - capo) % 12 + 12) % 12] += overlap;
                    low = Math.min(low, note.realValue - capo);
                    spans.push([start, start + b.playbackDuration]);
                }
            }
        }
        if (!weights.some(Boolean)) {
            this.toast('Hier klingen keine Noten.');
            return;
        }
        const used = new Set(edit.mergeChords(this.score).map(m => m.chord.name));
        const names = [...new Set([...scaleTriads(7 * mb.keySignature - capo), ...used])];
        const best = rankChords(weights, Number.isFinite(low) ? ((low % 12) + 12) % 12 : null, names, used)[0];
        if (!best) return;
        // Gleiche Töne gelten als derselbe Akkord ("D7" und "D7*" sind nur verschiedene Griffe).
        const tones = name => String(parseChord(name)?.tones.toSorted() ?? name);
        const sounding = events.findLast(e => e.tick <= from);
        if (sounding && tones(sounding.name) === tones(best.name)) {
            this.toast(`Hier klingt schon ${sounding.name}.`);
            return;
        }
        // Eine einzelne Stimme (nie zwei Töne zugleich) reicht nicht: Melodietöne sind oft keine Akkordtöne.
        const together = spans.some(([a, b], i) => spans.some(([c, d], j) => i !== j && a < d && c < b));
        // Ein Akkord, der an diesem Schlag schon steht, bleibt: Der Knopf ergänzt, er ersetzt nicht.
        if (sounding?.tick === from) {
            this.toast(`Hier steht schon ${sounding.name}.`
                + (together ? ` Erkannt wäre ${best.name}; ändern über den Dialog „Akkord“.` : ''));
            return;
        }
        if (!together) {
            this.toast(`Hier klingt nur eine Stimme, das reicht für keinen sicheren Akkord (Vermutung: ${best.name}).`);
            return;
        }
        let grip = '';
        if (!used.has(best.name)) {
            const tuning = staff ? [...staff.tuning].reverse() : undefined;
            const library = await loadChordLibraryOrEmpty();
            grip = (staff && isStandardTuning(staff) ? library[chordKey(best.name)]?.[0] : '')
                || findGrips(best.name, {tuning})[0]?.grip || '';
        }
        this.applyChord(best.name, grip);
        this.toast(`Akkord ${best.name} eingefügt.`);
    }

    /**
     * Setzt einen Akkord an den Schlag am Cursor (in der Akkordspur) und, wenn ein Griff dabei ist, den Griff des
     * Namens im ganzen Song. Ohne Griff gilt der des Songs, sonst der des Katalogs beim Speichern. Ändert der Dialog
     * einen vorhandenen Akkord (oldName) auf einen anderen Namen, wird er ausgetauscht: Der Akkord heißt dann im ganzen
     * Song so (alle Stellen und Spuren), der alte Name fällt weg.
     * @param {string} name Akkordname
     * @param {string} grip Griff von der tiefen Saite aus, "" für keinen
     * @param {string} [oldName] bisheriger Name des Akkords am Cursor, wenn der Dialog ihn ändert
     * @returns {void}
     */
    applyChord(name, grip, oldName = '') {
        this.change(beat => {
            if (oldName && oldName !== name) this.renameSongChord(oldName, name);
            this.setChordAt(beat, name);
            if (grip) this.setSongChordGrip(name, grip);
        });
    }

    /**
     * Benennt einen Akkord im ganzen Song um (in jeder Spur, in der er steht). Gibt es den neuen Namen in einer Spur
     * schon, gehen die Stellen auf ihn über und der alte Akkord fällt dort weg.
     * @param {string} oldName bisheriger Name
     * @param {string} name neuer Name
     * @returns {void}
     */
    renameSongChord(oldName, name) {
        for (const track of this.score.tracks) for (const staff of track.staves) {
            const chords = staff.chords;
            if (!chords) continue;
            const oldIds = [...chords].filter(([, c]) => c.name === oldName).map(([id]) => id);
            if (!oldIds.length) continue;
            const target = [...chords].find(([, c]) => c.name === name)?.[0];
            if (target === undefined) {
                for (const id of oldIds) chords.get(id).name = name;
                continue;
            }
            for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
                if (oldIds.includes(beat.chordId)) beat.chordId = target;
            }
            for (const id of oldIds) chords.delete(id);
        }
    }
}
