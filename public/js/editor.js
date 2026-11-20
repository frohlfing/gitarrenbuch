/**
 * Bearbeitungsmodus der Liedansicht: Werkzeugleiste und Panels, Panel "Liedtext", Maus und Cursor, Felder,
 * Tastenkürzel.
 */

import {
  barreFret, chordDiagramSvg, chordKey, detectKeySignature, diagramFirstFret, escapeHtml, glyph, GLYPHS,
  gripOf, INSTRUMENT_NAMES, isStandardTuning, loadChordLibraryOrEmpty, loadChordUsage, loadLeadsheet, playedStrings,
  deleteScoreVersion, loadScoreHistory, loadScoreText, loadScoreVersion, normalizeChords, parseGrip, saveLeadsheet, saveScore, svgIcon,
} from './base.js';
import {readChordFile, simplifyChord} from './chordfile.js';
import {findGrips, gripToneProblem, nameGrip} from './chordgrips.js';
import {chordNoteNames, parseChord, suggestChordNames} from './chordtheory.js';
import {closeOverlay, findSong, knownTracks, openOverlay, renderAudioSource, saveSongFields, usedPrograms} from './library.js';
import * as edit from './notation.js';
import {
  chordsTrack, describeScoreLoss, KEY_NAMES, keyName, lyricsTrack, parseScore, readGpFile,
  sameTuning, stringedStaves, TRACK_NAMES, trackName,
  TRIPLET_FEELS, tuningStaves, unifyCapo, writeScore, writeScoreChecked,
} from './notation.js';
import {eyeIcon, showTrackNames, speakerIcon, SyncEditor} from './playback.js';
import {
  captureTabs, LeadsheetTab, normalizeSheet, parseTimeSignature, remapSheetByOrder, remapTabs, SECTION_NAMES,
  sectionName, TIME_SIGNATURES,
} from './sheet.js';
import {applyRetune, TransposeDialog} from './transposedialog.js';
import {buildTextModel, lyricsLines, lyricsSectionStarts, renderTextView} from './textview.js';
import {CHORD_EXTENSIONS, GP_EXTENSIONS, openUploads} from './uploads.js';

/** @typedef {import('./playback.js').Player} Player */
/** @typedef {import('./base.js').Song} Song */
/** @typedef {import('./notation.js').EditPosition} EditPosition */
/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Beat} Beat */

/**
 * Position mit geänderten Angaben (der Rest bleibt wie in der Ausgangsposition).
 * @param {EditPosition} pos Ausgangsposition
 * @param {Partial<EditPosition>} changes was sich ändert
 * @returns {EditPosition} neue Position
 */
function movedPosition(pos, changes){
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
export function field(label, control){
  return `<label class="efield"><span>${label}</span>${control}</label>`;
}

/**
 * Einzeiliges Textfeld.
 * @param {string} [placeholder] Platzhalter
 * @param {string} [attrs] weitere Attribute (z. B. data-song="tempo")
 * @returns {string} HTML
 */
export function text(placeholder = '', attrs = ''){
  return `<input type="text" placeholder="${escapeHtml(placeholder)}" ${attrs}>`;
}

/**
 * Zahlenfeld.
 * @param {number} min kleinster Wert
 * @param {number} max größter Wert
 * @param {string} [attrs] weitere Attribute
 * @returns {string} HTML
 */
export function num(min, max, attrs = ''){
  return `<input type="number" min="${min}" max="${max}" ${attrs}>`;
}

/**
 * Auswahlliste; der Wert eines Eintrags ist sein Text.
 * @param {string[]} options Einträge
 * @param {string} [attrs] weitere Attribute
 * @returns {string} HTML
 */
export function select(options, attrs = ''){
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
export function todoButton(label, title, cls = '', cmd = ''){
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
function entryBar(entry){
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
 * Panel ein und aus, die Taktart steht im Panel "Am Cursor"). Die Übersicht öffnet der Knopf "?" in der Werkzeugleiste
 * bzw. die Taste "?" (siehe editor.js).
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
    ['Einfg', 'Schlag links neben dem Cursor einfügen'],
    ['Alt+Einfg', 'Schlag rechts neben dem Cursor einfügen'],
    ['Entf', 'Zahl löschen; leeren oder ausgewählten Schlag löschen'],
    ['Strg+Einfg', 'Takt einfügen'],
    ['Strg+Entf', 'Takt löschen'],
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
 * Aufbau (docs/Editor.md): Die Werkzeugleiste (Speichern, Rückgängig, Tonart, Capo …, Hinweise, Hilfe, ✕) ist im Modus die
 * einzige feste Leiste und enthält, was am ganzen Song hängt (Tonart, Shuffle, Capo, Tuning). Links steht, was am Cursor hängt
 * (Notenwerte, Effekte, Schlag; vom Takt Abschnitt, Taktart und Tempo), unten, was sich über den Song erstreckt (Spuren, Leadsheet, Liedtext, Audio mit dem Sync-Editor)
 * samt Statuszeile. Die Panels lassen sich einklappen; auf schmalen
 * Bildschirmen sind die seitlichen anfangs eingeklappt und legen sich ausgeklappt über die Noten. Abspielen geht
 * weiter.
 */

/**
 * Ein Schritt für "Rückgängig" bzw. "Wiederholen".
 * @typedef {Object} UndoStep
 * @property {string} tex alphaTex
 * @property {string} sheet Angaben für das Leadsheet (NoteEditor.sheetJson())
 * @property {EditPosition} pos Cursor
 * @property {number[]} tracks gezeigte Spuren
 */

/**
 * Zwischenablage für Takte (Strg+C/X/V), gilt für alle Songs, solange die Seite offen ist.
 * @type {?import('./notation.js').BarClipboard}
 */
let clipboard = null;

/** So viele Schritte hält "Rückgängig". */
const UNDO_MAX = 200;

/** Innerhalb dieser Zeit (ms) ergeben zwei Ziffern einen zweistelligen Bund ("1", "2" = 12). */
const DIGIT_MS = 1000;

/** Breite, ab der die seitlichen Panels neben den Noten stehen statt darüber (wie in app.css). */
const WIDE_LAYOUT = '(min-width: 900px)';

/**
 * Anzeige-Einstellungen eines Notensystems, die der Player für die Ansicht setzt (applyStave()) und die alphaTab
 * mitschreiben würde; gespeichert werden sie so, wie sie in der Datei stehen (NoteEditor.writeTex()).
 */
const STAFF_FLAGS = ['showStandardNotation', 'showTablature', 'showSlash', 'showNumbered'];

/** Einstellungen des Stylesheets für die Spurnamen (showTrackNames() in playback.js). */
const TRACK_NAME_STYLE = ['singleTrackTrackNamePolicy', 'multiTrackTrackNamePolicy', 'firstSystemTrackNameMode',
  'otherSystemsTrackNameMode', 'firstSystemTrackNameOrientation', 'otherSystemsTrackNameOrientation'];

/** So lange (ms) nach dem letzten Tastendruck im Liedtext werden die Noten neu gezeichnet. */
const LYRICS_MS = 300;

/** So lange (ms) nach dem letzten Tastendruck im Liedtext rollt das Feld beim Abspielen nicht mit (man schreibt gerade). */
const LYRICS_TYPING_MS = 3000;

/** So viele Griffbilder passen im Dialog "Akkord" nebeneinander. */
const GRIPS_PER_ROW = 6;

/** So lange steht der Hinweis "Noch nicht umgesetzt" (ms). */
const TOAST_MS = 2200;

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
 * Effekte am Cursor (linkes Panel), in Gruppen: [Symbol (HTML), Name mit Tastenkürzel (siehe editor.js), Befehl
 * (siehe NoteEditor.run())]. Was aus Guitar Pro nicht übernommen wird, steht in docs/Editor.md.
 * @type {[string, [string, string, string][]][]}
 */
const EFFECTS = [
  ['Note', [
    [svgIcon('hammer'), 'Hammer-on / Pull-off (H)', 'hammer'], [svgIcon('slide'), 'Slide (S)', 'slide'],
    [svgIcon('bend'), 'Bend (B): ½, full, 1½, aus', 'bend'], [svgIcon('vibrato'), 'Vibrato (V)', 'vibrato'],
    [svgIcon('dead'), 'Saite dämpfen (X)', 'dead'],
  ]],
  ['Tonhöhe', [
    [glyph(GLYPHS.sharp, true), 'Kreuz (Strg+9)', 'sharp'], [glyph(GLYPHS.flat, true), 'Be (Strg+7)', 'flat'],
    [glyph(GLYPHS.natural, true), 'Auflösungszeichen (Strg+8)', 'natural'],
    [svgIcon('semitoneUp'), 'Halbton höher (Alt+Umschalt+↑)', 'semitoneUp'],
    [svgIcon('semitoneDown'), 'Halbton tiefer (Alt+Umschalt+↓)', 'semitoneDown'],
  ]],
  ['Anschlag', [
    [glyph(GLYPHS.pickDown, true, 'smufl-pickdown'), 'Plektrum abwärts (Umschalt+D)', 'pickDown'],
    [glyph(GLYPHS.pickUp, true, 'smufl-pickup'), 'Plektrum aufwärts (Umschalt+U)', 'pickUp'],
    [svgIcon('brushDown'), 'Anschlag abwärts (Strg+D)', 'brushDown'],
    [svgIcon('brushUp'), 'Anschlag aufwärts (Strg+U)', 'brushUp'],
    [svgIcon('arpeggioDown'), 'Arpeggio abwärts (Strg+Umschalt+D)', 'arpeggioDown'],
    [svgIcon('arpeggioUp'), 'Arpeggio aufwärts (Strg+Umschalt+U)', 'arpeggioUp'],
  ]],
];

/**
 * Bezeichnung eines Instruments im Feld der Spur: "Programm Name", z. B. "25 Akustikgitarre (Stahl)".
 * @param {number} program MIDI-Programm
 * @returns {string} Bezeichnung
 */
const instrumentLabel = program => `${program} ${INSTRUMENT_NAMES[program] ?? ''}`.trim();

/** Lagen der Noten gegenüber dem Klang, die der Dialog "Spuren" anbietet (siehe notationPitch() in notation.js). */
const NOTATION_PITCHES = [
  [-24, '2 Oktaven höher'],
  [-12, '1 Oktave höher (Gitarre)'],
  [0, 'wie klingend'],
  [12, '1 Oktave tiefer'],
];

/**
 * Auswahl der Notenlage einer Spur im Dialog "Spuren". Steht in der Datei ein anderer Wert, kommt er als eigener
 * Eintrag dazu. Schlagzeug hat keine Notenlage.
 * @param {import('../../types/alphatab').model.Track} track Spur
 * @returns {string} HTML
 */
function notationPitchSelect(track){
  const pitch = edit.notationPitch(track);
  const options = NOTATION_PITCHES.some(([value]) => value === pitch) ? NOTATION_PITCHES
    : [...NOTATION_PITCHES, [pitch, `${Math.abs(pitch)} Halbtöne ${pitch < 0 ? 'höher' : 'tiefer'}`]];
  const percussion = track.staves.every(st => st.isPercussion);
  return `<select data-track-field="pitch" data-track="${track.index}" aria-label="Notenlage der Spur ${track.index + 1}"
    title="Lage der Noten im Notensystem gegenüber dem Klang. Klang, Tabs und Akkorde ändern sich nicht."
    ${percussion ? 'disabled' : ''}>${options.map(([value, label]) =>
    `<option value="${value}"${value === pitch ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
}

/**
 * MIDI-Programm aus einer Eingabe im Feld Instrument: eine Nummer (auch vor dem Namen, "26 E-Gitarre (Jazz)") oder der
 * Name bzw. ein Teil davon, wenn nur ein Instrument passt.
 * @param {string} text Eingabe
 * @returns {?number} Programm 0 bis 127; null, wenn nichts oder nicht eindeutig passt
 */
function parseProgram(text){
  const input = text.trim().toLowerCase();
  const number = input.match(/^\d+/);
  if(number) return Number(number[0]) <= 127 ? Number(number[0]) : null;
  const exact = INSTRUMENT_NAMES.findIndex(n => n.toLowerCase() === input);
  if(exact >= 0) return exact;
  const part = INSTRUMENT_NAMES.map((n, p) => n.toLowerCase().includes(input) ? p : -1).filter(p => p >= 0);
  return input && part.length === 1 ? part[0] : null;
}

/** Tasten, die Panels ein- und ausklappen (wie Guitar Pro: F2 Palette): Taste → Seite. */
const PANEL_KEYS = {F2: 'left', F4: 'right', F8: 'bottom'};

/**
 * Eingeklappte Panels und Höhe des Textfelds im rechten Panel aus dem Browser.
 * @returns {{left?: boolean, right?: boolean, bottom?: boolean, bottomH?: number, lyricsH?: number, rightW?: number}} true = eingeklappt;
 *   bottomH: Höhe des Inhalts im unteren Panel in px; lyricsH: Höhe des Textfelds im rechten Panel in px (darunter die Vorschau); rightW: Breite des rechten Panels in px
 */
function loadCollapsed(){
  try {
    return JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}') ?? {};
  } catch(err){
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
  constructor(songView, player, {onClose, onSaved}){
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
     * Angaben für das Leadsheet (Feld leadsheet in song.json), die alphaTex nicht kennt. Die
     * Tab-Stellen wandern mit, wenn Takte eingefügt, gelöscht oder ausgeschrieben werden oder sich Spuren ändern
     * (change(), unrollRepeats()); alles gehört zu jedem Schritt für "Rückgängig".
     * @type {import('./sheet.js').Sheet}
     */
    this.sheet = normalizeSheet(null);
    /** Angaben für das Leadsheet wie gespeichert (sheetJson()), zum Vergleich: ungespeicherte Änderungen? */
    this.savedSheet = '';
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
  get dirty(){
    return !!this.score && (this.tex !== this.savedTex || this.sheetJson() !== this.savedSheet || this.viewChanged);
  }

  /**
   * Vorgaben je Spur, wie sie jetzt eingestellt sind: angezeigt (Auge) und stumm (Lautsprecher).
   * @returns {{show: boolean, mute: boolean}[]} in der Reihenfolge der Spuren
   */
  trackDefaults(){
    return this.score.tracks.map(t => ({
      show: this.trackIndexes.includes(t.index), mute: this.player.trackMix(t.index).mute,
    }));
  }

  /**
   * Angaben für das Leadsheet in der gespeicherten Form.
   * @returns {string} JSON
   */
  sheetJson(){
    return JSON.stringify(normalizeSheet(this.sheet));
  }

  /**
   * Übernimmt die Angaben für das Leadsheet (vom Server bzw. aus einem Schritt für "Rückgängig").
   * @param {string} json JSON wie sheetJson()
   * @returns {void}
   */
  setSheet(json){
    this.sheet = normalizeSheet(JSON.parse(json));
  }

  /**
   * Ändert nur die Angaben für das Leadsheet (Patterns, Tab-Stellen), als ein Schritt für "Rückgängig".
   * @param {function(import('./sheet.js').Sheet): *} fn Änderung; darf die Angaben direkt ändern
   * @returns {void}
   */
  changeSheet(fn){
    const before = this.sheetJson();
    fn(this.sheet);
    if(this.sheetJson() === before){
      this.leadsheetTab.renderList();
      return;
    }
    this.undoStack.push(this.snapshot(before));
    if(this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
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
  open(){
    const player = this.player;
    if(!['tab', 'both'].includes(player.prefs.view)) player.setView('both');
    const songbar = this.songView.querySelector('.songbar');
    const collapsed = loadCollapsed();
    // Auf schmalen Bildschirmen liegen die Seiten-Panels über den Noten und sind deshalb anfangs zu.
    const narrow = !matchMedia(WIDE_LAYOUT).matches;

    const toolbar = this.addPart(songbar, 'div', 'edit-toolbar', this.toolbarHtml());
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Bearbeiten');
    this.addPart(songbar, 'div', 'edit-notices', '').hidden = true;
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
    renderAudioSource(/** @type {HTMLElement} */ (this.part('edit-bottom').querySelector('[data-audio-source]')),
      () => findSong(this.player.slug), saved => {
        this.saved = true;
        this.onSaved(saved);
      });

    this.songView.classList.add('editing');
    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(songbar);
    this.resize.observe(this.part('edit-bottom'));
    this.measure();

    this.onClick = e => {
      const target = /** @type {HTMLElement} */ (e.target);
      this.handleClick(target);
      // Ein mit der Maus gedrückter Knopf gibt den Fokus wieder ab: Sonst zeichnet der Browser beim nächsten Tastendruck
      // (z. B. "-" für länger) einen Fokusrahmen um ihn. Mit der Tastatur (detail 0) bleibt der Fokus.
      if(e.detail) target.closest('button')?.blur();
    };
    for(const part of this.parts) part.addEventListener('click', this.onClick);
    this.onKey = e => this.handleKey(e);
    document.addEventListener('keydown', this.onKey);
    // Abspielen beginnt am Cursor. Nach jeder Änderung zeichnet alphaTab neu und stellt die Position an den Anfang;
    // deshalb gilt der Cursor erst beim Drücken von "Play" (vor dem Handler des Players, daher die Capture-Phase).
    this.onPlay = () => this.seekToCursor();
    this.player.el.play.addEventListener('click', this.onPlay, true);
    // Wiederholen gibt es beim Bearbeiten nicht: Der Cursor markiert die Bearbeitung, nicht die Abspielposition. Der
    // Knopf steht ganz links in der Gruppe, die übrigen behalten ihren Platz.
    const loop = this.player.el.loop;
    if(this.player.api.isLooping) loop.click();
    loop.hidden = true;
    this.onFieldChange = e => this.applyField(/** @type {HTMLInputElement} */ (e.target));
    this.part('edit-left').addEventListener('change', this.onFieldChange);
    this.part('edit-toolbar').addEventListener('change', this.onFieldChange);
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
      if(this.lyricsTimer){
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
      if(/^(Arrow|Page|Home$|End$)/.test(e.key)) this.followLyricsCaret();
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
  addPart(parent, tag, cls, html, collapsed = false){
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
  part(cls){
    return this.parts.find(p => p.classList.contains(cls));
  }

  /**
   * Werkzeugleiste: Speichern, Rückgängig, Wiederholen | Dauer | Punktierung, Triole, Pause,
   * Haltebogen | Schlag und Takt einfügen und löschen | Hinweise, Hilfe, Schließen.
   * @returns {string} HTML
   */
  toolbarHtml(){
    return `
      <div class="egroup">
        ${todoButton(svgIcon('save'), 'Speichern (Strg+S)', '', 'save')}
        ${todoButton(svgIcon('undo'), 'Rückgängig (Strg+Z)', '', 'undo')}
        ${todoButton(svgIcon('redo'), 'Wiederholen (Strg+Y)', '', 'redo')}
        ${todoButton(svgIcon('history'), 'Verlauf: frühere gespeicherte Stände der Noten ansehen und laden', '', 'history')}
        ${todoButton(svgIcon('upload'), 'Uploads: hochgeladene Dateien mit Quelle und Beschreibung', '', 'uploads')}
      </div>
      <div class="egroup">
        ${todoButton(svgIcon('tracks'), 'Spuren: anzeigen, hören, benennen, ordnen, hinzufügen', '', 'tracks')}
        ${todoButton(svgIcon('leadsheet'), 'Leadsheet: Patterns, Tab-Stellen, Links und Vorschau des Blatts', '', 'leadsheet')}
      </div>
      <div class="egroup">
        ${todoButton(svgIcon('feelStraight', 48), 'Shuffle: Achtel-Triolen-Feeling im ganzen Song ein- oder ausschalten (Strg+/)',
          'ebtn-shuffle', 'tripletFeel')}
      </div>
      <div class="egroup egroup-song">
        <label class="etool-field"><span>Tonart</span>${select(KEY_NAMES, 'data-song="key" title="Tonart des ganzen Songs"')}</label>
        ${todoButton(svgIcon('transpose'), 'Transponieren: Halbtöne, Capo und Tuning ändern, mit Vorschau', '', 'transpose')}
        <span class="etool-info" data-song-info></span>
      </div>
      <div class="egroup edit-end">
        <button type="button" class="ebtn ebtn-text edit-hint" data-action="notices" aria-expanded="false" hidden
          title="Abweichungen von der Form des Gitarrenbuchs, jede mit einem Knopf zum Beheben"></button>
        <button type="button" class="ebtn ebtn-help" data-action="help" title="Tastenkürzel (?)"
          aria-label="Tastenkürzel">?</button>
        <button type="button" class="edit-close" data-action="done" title="Bearbeiten beenden"
          aria-label="Bearbeiten beenden">&#10005;</button>
      </div>
    `;
  }

  /**
   * Linkes Panel "Am Cursor" (wie die Palette in Guitar Pro links), alles, was den Schlag bzw. die Note betrifft:
   * Notenwert, Punktierung, Triole, Pause, Haltebogen, Schläge und Takte einfügen/löschen, Effekte, Akkord, Griff,
   * Text, zuletzt vom Takt der Abschnitt, Taktart und Tempo (sie gelten ab dem Takt am Cursor). Die Leiste enthält, was am ganzen Song
   * hängt (Tonart, Shuffle, Capo, Tuning), dazu Speichern, Rückgängig, Hinweise, Hilfe, ✕.
   * @returns {string} HTML
   */
  cursorPanelHtml(){
    const durations = Object.entries(NOTE_GLYPHS).map(([value, sign]) =>
      `<button type="button" class="ebtn ebtn-note" data-duration="${value}" aria-pressed="${value === '4'}"
        title="${NOTE_NAMES[value]} (+ kürzer, - länger)">${glyph(sign)}</button>`).join('');
    return `
      ${this.panelHead('Am Cursor', 'left')}
      <div class="edit-panel-body">
        <h4>Notenwert</h4>
        <div class="etools" role="group" aria-label="Dauer">${durations}</div>
        <div class="etools">
          ${todoButton(glyph(GLYPHS.quarter + GLYPHS.dot), 'Punktiert (.)', 'ebtn-note', 'dot')}
          ${todoButton(glyph(GLYPHS.quarter + GLYPHS.dot + GLYPHS.dot), 'Doppelt punktiert (Strg+.)', 'ebtn-note', 'dot2')}
          ${todoButton('3', 'Triole (/)', '', 'triplet')}
          ${todoButton(glyph(GLYPHS.restQuarter, true), 'Pause (R)', 'ebtn-note', 'rest')}
          ${todoButton(glyph(GLYPHS.quarter + GLYPHS.tie + GLYPHS.quarter), 'Haltebogen (L)', 'ebtn-note ebtn-wide', 'tie')}
        </div>
        <h4>Einfügen, löschen</h4>
        <div class="etools">
          ${todoButton(svgIcon('insertBeat'), 'Schlag links neben dem Cursor einfügen (Einfg; Alt+Einfg rechts daneben)', '', 'insertBeat')}
          ${todoButton(svgIcon('deleteBeat'), 'Schlag löschen (Entf auf einem leeren oder ausgewählten Schlag)', '', 'deleteBeat')}
          ${todoButton(svgIcon('insertBar'), 'Takt einfügen (Strg+Einfg)', '', 'insertBar')}
          ${todoButton(svgIcon('deleteBar'), 'Takt löschen (Strg+Entf)', '', 'deleteBar')}
        </div>
        ${EFFECTS.map(([group, items]) => `
          <h4>${escapeHtml(group)}</h4>
          <div class="effect-grid">${items.map(([label, title, cmd]) => todoButton(label, title, '', cmd)).join('')}</div>
        `).join('')}
        <div class="efield echord">
          <label for="eChordSelect">Akkord (A)</label>
          <div class="echord-row">
            <select id="eChordSelect" data-chord-select aria-label="Akkord am Schlag"></select>
            <button type="button" class="ebtn" data-chord-button data-cmd="chordNew" data-todo="Neuer Akkord mit Griff …"
              title="Neuer Akkord mit Griff …" aria-label="Neuer Akkord mit Griff …">+</button>
          </div>
        </div>
        ${field('Text über dem Schlag (T)', '<input type="text" data-field="text" placeholder="z. B. Picking Pattern">')}
        ${field('Abschnitt (Umschalt+Einfg)', `<span class="eclearable"><input type="text" data-bar="section"
          list="ebarSections" placeholder="z. B. Verse"><button type="button" class="eclear" data-clear-section
          aria-label="Abschnitt entfernen" title="Abschnitt entfernen">×</button></span>
          <datalist id="ebarSections"></datalist>`)}
        ${field('Takt', `<span class="etakt"><input type="text" data-song="ts" list="esongSignatures" placeholder="4/4"
          aria-label="Taktart" title="Taktart ab diesem Takt bis zum nächsten Wechsel"><datalist id="esongSignatures">${
          TIME_SIGNATURES.map(t => `<option value="${t}">`).join('')}</datalist><span class="efield-row">${
          num(20, 300, 'data-song="tempo" aria-label="Tempo" title="Tempo ab diesem Takt bis zum nächsten Wechsel"')} BPM</span></span>`)}
      </div>`;
  }

  /**
   * Rechtes Panel "Liedtext": oben das Textfeld, darunter die Vorschau "Text & Akkorde"; die Linie dazwischen
   * lässt sich ziehen (startLyricsResize()).
   * @returns {string} HTML
   */
  lyricsPanelHtml(){
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
  bottomHtml(){
    return `
      <div class="edit-bottom-resize" title="Höhe ändern (ziehen)" aria-hidden="true"></div>
      <div class="edit-bottom-head">
        <span class="edit-panel-title">Audio</span>
        <div class="edit-status">Noten werden geladen …</div>
        <button type="button" class="ebtn ebtn-collapse" data-collapse="bottom" title="Ein-/Ausklappen (F8)"
          aria-label="Unteres Panel ein- oder ausklappen"></button>
      </div>
      <div class="edit-bottom-body">
        <div class="eaudio" data-audio>
          <div class="eaudio-source" data-audio-source></div>
          <div class="eaudio-sync" data-audio-sync><p class="efield-hint">Audiospur wird geladen …</p></div>
        </div>
      </div>`;
  }

  /**
   * Inhalt des Dialogs "Leadsheet": links Patterns, Tab-Stellen und Links (LeadsheetTab.renderList()), rechts die Vorschau
   * des Blatts (renderPreview()).
   * @returns {string} HTML
   */
  leadsheetDialogHtml(){
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
  openEditDialog(title, cls, html){
    openOverlay(`<h2>${escapeHtml(title)}</h2><div class="edit-dialog ${cls}">${html}</div>`);
    const box = /** @type {HTMLElement} */ (document.querySelector(`.sheet .${cls}`));
    box.addEventListener('click', this.onClick);
    box.addEventListener('change', this.onFieldChange);
    box.addEventListener('focusin', e => this.startInstrumentInput(/** @type {HTMLInputElement} */ (e.target)));
    box.addEventListener('focusout', e => this.endInstrumentInput(/** @type {HTMLInputElement} */ (e.target)));
    box.addEventListener('input', e => this.suggestInstruments(/** @type {HTMLInputElement} */ (e.target)));
    return box;
  }

  /**
   * Dialog "Spuren": je Spur Zeigen, Hören, Name, Akkorde und Text, Instrument, Notenlage und Knöpfe (renderTracks()).
   * @returns {void}
   */
  openTracksDialog(){
    const box = this.openEditDialog('Spuren', 'etracks-dialog', '<div class="etrack-list"></div>');
    // Nach einem Dialog darüber (z. B. Spur importieren) steht die Liste so, wie die Noten jetzt sind.
    box.addEventListener('overlayshow', () => this.renderTracks());
    this.renderTracks();
  }

  /**
   * Dialog "Leadsheet" (LeadsheetTab): Eingaben und Vorschau des Blatts.
   * @returns {void}
   */
  openLeadsheetDialog(){
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
  renderSongPanels(){
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
  renderTracks(){
    const list = document.querySelector('.sheet .etrack-list');
    if(!this.score || !list || list.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) return;
    const shown = new Set(this.trackIndexes);
    // Namensliste: die üblichen Namen, dazu alle aus der Bibliothek und dem Song (unübersetzt, siehe notation.js).
    const names = [...new Set([...TRACK_NAMES, ...knownTracks(), ...this.score.tracks.map(t => t.name.trim())])]
      .filter(Boolean);
    const chordsAt = this.contentTrack('chords');
    const lyricsAt = this.contentTrack('lyrics');
    const last = this.score.tracks.length - 1;
    list.innerHTML = `
      <datalist id="etrackPrograms"></datalist>
      <datalist id="etrackNames">${names.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
      <div class="etrack etrack-head"><span></span><span>Name</span>
        <span title="Spur, in der die Akkorde stehen">Akkorde</span>
        <span title="Spur, in der der Liedtext steht">Text</span>
        <span>Instrument</span>
        <span title="Lage der Noten im Notensystem gegenüber dem Klang. Klang, Tabs und Akkorde ändern sich nicht.">Notenlage</span><span></span></div>
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
            <input type="text" data-track-field="instrument" data-track="${i}" list="etrackPrograms"
              value="${escapeHtml(instrumentLabel(track.playbackInfo.program))}"
              data-label="${escapeHtml(instrumentLabel(track.playbackInfo.program))}" autocomplete="off"
              aria-label="Instrument der Spur ${i + 1}"
              title="Nummer oder Name eingeben (z. B. 26 oder Gitarre), dann erscheinen die passenden Instrumente">
            ${notationPitchSelect(track)}
            <span class="etrack-buttons">
              <button type="button" class="ebtn" data-cmd="trackUp" data-track="${i}"
                title="Spur nach oben"${i ? '' : ' disabled'}>↑</button>
              <button type="button" class="ebtn" data-cmd="trackDown" data-track="${i}"
                title="Spur nach unten"${i < last ? '' : ' disabled'}>↓</button>
              <button type="button" class="ebtn" data-cmd="trackDuplicate" data-track="${i}"
                title="Spur duplizieren (ohne Akkorde und Text)">⧉</button>
              <button type="button" class="ebtn ebtn-danger" data-cmd="trackDelete" data-track="${i}"
                title="Spur löschen"${last ? '' : ' disabled'}>×</button></span>
          </div>`;
      }).join('')}
      <div class="etrack-foot">
        ${todoButton('+ Spur', 'Gitarrenspur hinzufügen (Standard-Tuning)', 'ebtn-text', 'addTrack')}
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
  panelHead(title, side){
    return `
      <div class="edit-panel-head">
        <span class="edit-panel-title">${escapeHtml(title)}</span>
        <button type="button" class="ebtn ebtn-collapse" data-collapse="${side}"
          title="Ein-/Ausklappen (${Object.keys(PANEL_KEYS).find(k => PANEL_KEYS[k] === side)})"
          aria-label="${escapeHtml(title)} ein- oder ausklappen"></button>
      </div>`;
  }

  /**
   * Reagiert auf Klicks in Leiste und Panels.
   * @param {HTMLElement} target angeklicktes Element
   * @returns {void}
   */
  handleClick(target){
    const el = /** @type {?HTMLElement} */ (target.closest('[data-action], [data-collapse], '
      + '[data-duration], [data-cmd], [data-todo], [data-bar-goto], [data-ls-action], '
      + '[data-show-track], [data-track-audible], [data-clear-section]'));
    if(!el) return;
    if(el.dataset.clearSection !== undefined){
      this.change(() => edit.setSection(this.alphaTab, this.score, this.pos.bar, ''));
    } else if(el.dataset.showTrack !== undefined){
      this.toggleTrackEye(Number(el.dataset.showTrack));
    } else if(el.dataset.trackAudible !== undefined){
      this.toggleTrackAudible(Number(el.dataset.trackAudible));
    } else if(el.dataset.barGoto){
      this.moveTo({bar: Number(el.dataset.barGoto), beat: 0});
    } else if(el.dataset.lsAction){
      this.leadsheetTab.action(el);
    } else if(el.dataset.cmd){
      this.run(el.dataset.cmd, el);
    } else if(el.dataset.action === 'done'){
      this.finish();
    } else if(el.dataset.action === 'notices'){
      this.toggleNotices();
    } else if(el.dataset.action === 'help'){
      openShortcutHelp();
    } else if(el.dataset.collapse){
      this.togglePanel(el.dataset.collapse);
    } else if(el.dataset.duration){
      this.changeBeats(beat => edit.setDuration(beat, Number(el.dataset.duration)));
    } else if(el.dataset.todo){
      this.toast(`Noch nicht umgesetzt: ${el.dataset.todo}`);
    }
  }

  /**
   * Tastenkürzel wie in Guitar Pro 8 (Liste in editor.js). Nicht beim Schreiben in einem Eingabefeld und nicht,
   * solange ein Dialog offen ist. Bekannte Tasten verlieren ihre Wirkung im Browser (Strg+S, Strg+D, Leertaste …).
   * @param {KeyboardEvent} e Tastendruck
   * @returns {void}
   */
  handleKey(e){
    const target = /** @type {HTMLElement} */ (e.target);
    if(target.closest('input, textarea, select, [contenteditable]') || document.querySelector('.overlay.open')) return;
    // Auf der Wellenform verschieben Pfeile und Entf den Sync-Punkt; Strg+Z usw. gelten weiter.
    if(target.closest('.sync-wave') && !e.ctrlKey && !e.metaKey && e.key !== ' ') return;
    const command = this.keyCommand(e);
    if(!command) return;
    e.preventDefault();
    if(typeof command === 'function') command();
    else this.run(command);
  }

  /**
   * Befehl zu einem Tastendruck.
   * @param {KeyboardEvent} e Tastendruck
   * @returns {?(string|function(): void)} Name für run() oder eine Funktion; null für fremde Tasten
   */
  keyCommand(e){
    const ctrl = e.ctrlKey || e.metaKey;
    const {shiftKey: shift, altKey: alt} = e;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const plain = !ctrl && !alt;
    if(plain && /^[0-9]$/.test(key) && !shift) return () => this.typeDigit(Number(key));
    if(!ctrl && !alt && !shift && PANEL_KEYS[key]) return () => this.togglePanel(PANEL_KEYS[key]);
    if(ctrl && !alt){
      if(key === 'z') return 'undo';
      if(key === 'y') return 'redo';
      if(key === 's') return 'save';
      if(key === '.') return 'dot2';
      if(key === '9') return 'sharp';
      if(key === '7') return 'flat';
      if(key === '8') return 'natural';
      if(key === 'd') return shift ? 'arpeggioDown' : 'brushDown';
      if(key === 'u') return shift ? 'arpeggioUp' : 'brushUp';
      if(key === 'Insert') return 'insertBar';
      if(key === 'Delete') return 'deleteBar';
      if(key === 'Home') return () => this.moveTo({bar: 0, beat: 0});
      if(key === 'End') return 'lastBar';
      if(shift && (key === 'ArrowLeft' || key === 'ArrowRight')) return key === 'ArrowLeft' ? 'selectLeft' : 'selectRight';
      if(key === 'ArrowUp' || key === 'ArrowDown') return () => this.stepTrack(key === 'ArrowUp' ? -1 : 1);
      if(key === 'c') return 'copy';
      if(key === 'x') return 'cut';
      if(key === 'v') return 'paste';
      if(key === 'a') return 'selectAll';
      if(key === '/') return 'tripletFeel';
      if(key === 'k') return 'keySignature';
      return null;
    }
    if(alt && shift && (key === 'ArrowUp' || key === 'ArrowDown')) return key === 'ArrowUp' ? 'semitoneUp' : 'semitoneDown';
    if(ctrl && alt && (key === 'ArrowUp' || key === 'ArrowDown')) return key === 'ArrowUp' ? 'stringUp' : 'stringDown';
    if(alt && !shift && key === 'Insert') return 'insertBeatAfter';
    if(alt) return null;
    switch(key){
      case 'ArrowLeft': return shift ? 'selectBeatLeft' : () => this.moveTo(edit.stepBeat(this.score, this.pos, -1));
      case 'ArrowRight': return shift ? 'selectBeatRight' : () => this.moveTo(edit.stepBeat(this.score, this.pos, 1));
      case 'ArrowUp': return shift ? null : () => this.moveTo({string: this.pos.string + 1});
      case 'ArrowDown': return shift ? null : () => this.moveTo({string: this.pos.string - 1});
      case 'Escape': return this.selection || this.beatSelection ? () => this.setSelection(null) : null;
      case 'Home': return () => this.moveTo({beat: 0});
      case 'End': return 'lastBar';
      case 'Backspace': return 'deleteNote';
      case 'Insert': return shift ? 'section' : 'insertBeat';
      case 'Delete': return shift ? null : 'deleteKey';
      case ' ': return () => this.player.api?.playPause();
      case '?': return () => openShortcutHelp();
      case '+': case '=': return 'shorter';
      case '-': case '_': return 'longer';
      case '.': return 'dot';
      case '/': return 'triplet';
      case 'r': return shift ? null : 'rest';
      case 'l': return shift ? null : 'tie';
      case 'h': return shift ? null : 'hammer';
      case 's': return shift ? null : 'slide';
      case 'b': return shift ? null : 'bend';
      case 'v': return shift ? null : 'vibrato';
      case 'x': return shift ? null : 'dead';
      case 'd': return shift ? 'pickDown' : null;
      case 'u': return shift ? 'pickUp' : null;
      case 'a': return shift ? null : () => this.focusField('[data-chord-select]');
      case 't': return shift ? null : () => this.focusField('text');
      default: return null;
    }
  }

  /**
   * Klappt ein Panel ein bzw. aus (F2, F4, F8 oder der Pfeil am Panel).
   * @param {string} side "left", "right" oder "bottom"
   * @returns {void}
   */
  togglePanel(side){
    this.part(`edit-${side}`).classList.toggle('collapsed');
    this.saveCollapsed();
    this.measure();
    this.relayout();
    if(side === 'right') this.fillLyrics();
    if(side === 'bottom') void this.openSync();
  }

  /**
   * Führt einen Befehl aus (Knopf oder Taste).
   * @param {string} name Befehl
   * @param {?HTMLElement} [el] Knopf (für Befehle einer Spur: data-track)
   * @returns {void}
   */
  run(name, el = null){
    if(!this.score) return;
    const at = this.alphaTab;
    const string = this.pos.string;
    const note = beat => edit.noteOn(beat, string);
    const {AccidentalMode, PickStroke, BrushType, VibratoType, SlideOutType} = {
      AccidentalMode: at.model.NoteAccidentalMode, PickStroke: at.model.PickStroke, BrushType: at.model.BrushType,
      VibratoType: at.model.VibratoType, SlideOutType: at.model.SlideOutType,
    };
    /** @type {Object<string, function(): void>} */
    const commands = {
      save: () => void this.save(),
      undo: () => this.undo(this.undoStack, this.redoStack),
      redo: () => this.undo(this.redoStack, this.undoStack),
      shorter: () => this.changeBeats(beat => edit.stepDuration(beat, 1)),
      longer: () => this.changeBeats(beat => edit.stepDuration(beat, -1)),
      dot: () => this.changeBeats(beat => edit.toggleDots(beat, 1), true),
      dot2: () => this.changeBeats(beat => edit.toggleDots(beat, 2), true),
      triplet: () => this.changeBeats(beat => edit.toggleTriplet(beat), true),
      rest: () => this.change(beat => edit.makeRest(beat)),
      deleteNote: () => this.change(beat => edit.deleteNote(beat, string)),
      tie: () => this.change(beat => edit.toggleTie(at, beat, this.previousBeat(), string)
        || this.toast('Haltebogen: Auf dieser Saite klingt davor keine Note.')),
      semitoneUp: () => this.change(beat => edit.shiftSemitone(at, beat, string, 1)),
      semitoneDown: () => this.change(beat => edit.shiftSemitone(at, beat, string, -1)),
      hammer: () => this.change(beat => edit.toggleNoteProp(note(beat), 'isHammerPullOrigin', true, false)),
      slide: () => this.change(beat =>
        edit.toggleNoteProp(note(beat), 'slideOutType', SlideOutType.Legato, SlideOutType.None)),
      vibrato: () => this.change(beat =>
        edit.toggleNoteProp(note(beat), 'vibrato', VibratoType.Slight, VibratoType.None)),
      dead: () => this.change(beat => edit.toggleNoteProp(note(beat), 'isDead', true, false)),
      sharp: () => this.change(beat =>
        edit.toggleNoteProp(note(beat), 'accidentalMode', AccidentalMode.ForceSharp, AccidentalMode.Default)),
      flat: () => this.change(beat =>
        edit.toggleNoteProp(note(beat), 'accidentalMode', AccidentalMode.ForceFlat, AccidentalMode.Default)),
      natural: () => this.change(beat =>
        edit.toggleNoteProp(note(beat), 'accidentalMode', AccidentalMode.ForceNatural, AccidentalMode.Default)),
      pickDown: () => this.change(beat => edit.toggleBeatProp(beat, 'pickStroke', PickStroke.Down)),
      pickUp: () => this.change(beat => edit.toggleBeatProp(beat, 'pickStroke', PickStroke.Up)),
      brushDown: () => this.change(beat => edit.toggleBeatProp(beat, 'brushType', BrushType.BrushDown)),
      brushUp: () => this.change(beat => edit.toggleBeatProp(beat, 'brushType', BrushType.BrushUp)),
      arpeggioDown: () => this.change(beat => edit.toggleBeatProp(beat, 'brushType', BrushType.ArpeggioDown)),
      arpeggioUp: () => this.change(beat => edit.toggleBeatProp(beat, 'brushType', BrushType.ArpeggioUp)),
      chordNew: () => void this.openChordDialog(false),
      chordEdit: () => void this.openChordDialog(true),
      insertBeat: () => this.change(beat => edit.insertBeat(at, beat)),
      insertBeatAfter: () => this.change(beat => edit.insertBeatAfter(at, beat), {pos: {beat: this.pos.beat + 1}}),
      deleteBeat: () => this.change(beat => edit.deleteBeat(beat)),
      deleteKey: () => this.deleteKey(),
      insertBar: () => this.change(() => edit.insertBar(at, this.score, this.pos.bar), {pos: {beat: 0}}),
      deleteBar: () => this.change(() => edit.deleteBar(this.score, this.pos.bar), {pos: {beat: 0}}),
      lastBar: () => this.moveTo({bar: this.score.masterBars.length - 1, beat: 0}),
      bend: () => this.change(beat => edit.cycleBend(at, note(beat))),
      stringUp: () => this.moveNoteString(string, string + 1),
      stringDown: () => this.moveNoteString(string, string - 1),
      selectBeatLeft: () => this.extendBeatSelection(-1),
      selectBeatRight: () => this.extendBeatSelection(1),
      selectLeft: () => this.extendSelection(-1),
      selectRight: () => this.extendSelection(1),
      selectAll: () => this.setSelection({track: this.pos.track, anchor: 0, from: 0,
        to: this.score.masterBars.length - 1}),
      copy: () => this.copyBars(false),
      cut: () => this.copyBars(true),
      paste: () => this.pasteBars(),
      section: () => this.focusField('[data-bar="section"]'),
      patternSuggest: () => this.leadsheetTab.suggest(),
      patternRollOut: () => this.leadsheetTab.rollOut(),
      patternCatalog: () => this.leadsheetTab.catalogDialog(),
      tripletFeel: () => {
        const on = this.score.masterBars[0].tripletFeel === at.model.TripletFeel.NoTripletFeel;
        this.change(() => edit.setTripletFeel(this.score, 0,
          on ? at.model.TripletFeel.Triplet8th : at.model.TripletFeel.NoTripletFeel, true));
        this.toast(on ? 'Triolen-Feeling: Achtel (Shuffle)' : 'Triolen-Feeling: kein');
      },
      keySignature: () => /** @type {HTMLElement} */ (this.part('edit-toolbar').querySelector('[data-song="key"]')).focus(),
      removeFeel: () => {
        this.change(() => edit.setTripletFeel(this.score, 0, at.model.TripletFeel.NoTripletFeel, true));
        this.toast('Triolen-Feeling: kein');
      },
      detectKey: () => {
        const key = detectKeySignature(this.score);
        if(!key){
          this.toast('Die notierte Tonart passt.');
          return;
        }
        this.change(() => edit.setKeySignature(at, this.score, 0, key.keySignature, key.minor, true));
        this.toast(`Tonart: ${keyName(key.keySignature, key.minor)}`);
      },
      unroll: () => this.unrollRepeats(),
      transpose: () => this.openTransposeDialog(),
      history: () => void this.openHistoryDialog(),
      uploads: () => openUploads(this.player.slug),
      unifyCapo: () => {
        let result = {capo: 0, moved: [], octaves: 0};
        this.change(() => { result = unifyCapo(this.score); });
        this.toast(`Capo ${result.capo} für alle Spuren`
          + (result.octaves ? `; ${result.octaves} Noten passten nur eine Oktave höher.` : ''));
      },
      unifyTuning: () => {
        // Wie beim Capo: Die anderen Spuren werden umgerechnet und klingen gleich.
        const [first, ...others] = tuningStaves(this.score);
        let misses = 0;
        this.change(() => {
          const tuning = [...first.tuning].reverse();
          for(const staff of others) misses += edit.setTuning(this.alphaTab, staff, tuning, true);
        });
        this.toast(`Tuning ${this.tuningText(first)} für alle Spuren`
          + (misses ? `; ${misses} Noten ließen sich nicht umrechnen (Bund unter 0 oder über 24).` : ''));
      },
      mergeChords: () => this.moveContentTo('chords', chordsTrack(this.score)?.index ?? 0),
      mergeLyrics: () => this.moveContentTo('lyrics', lyricsTrack(this.score)?.index ?? 0),
      tracks: () => this.openTracksDialog(),
      leadsheet: () => this.openLeadsheetDialog(),
      trackUp: () => this.changeTracks(score => edit.moveTrack(score, Number(el.dataset.track), -1),
        Number(el.dataset.track), -1),
      trackDown: () => this.changeTracks(score => edit.moveTrack(score, Number(el.dataset.track), 1),
        Number(el.dataset.track), 1),
      trackDelete: () => {
        const track = this.score.tracks[Number(el.dataset.track)];
        if(!confirm(`Spur "${trackName(track)}" löschen?`)) return;
        this.changeTracks(score => edit.deleteTrack(score, track.index), track.index, 0);
      },
      addTrack: () => this.changeTracks(score => edit.addTrack(at, score, `Gitarre ${score.tracks.length + 1}`),
        this.score.tracks.length, 0),
      trackDuplicate: () => {
        const index = Number(el.dataset.track);
        // Aus dem alphaTex gelesen statt aus dem Modell kopiert: So ist die Kopie vollständig und unabhängig.
        this.changeTracks(score => edit.duplicateTrack(t => parseScore(at, t), this.tex, score, index), index + 1, 0);
        this.toast(`Kopie „${trackName(this.score.tracks[index + 1])}“ angelegt, ohne Akkorde und Text.`);
      },
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
    if(commands[name]) commands[name]();
    else this.toast(`Unbekannter Befehl: ${name}`);
  }

  /**
   * Legt die Note am Cursor auf eine andere Saite, gleicher Ton (Strg+Alt+↑/↓ oder Ziehen mit der Maus).
   * @param {number} from Saite der Note
   * @param {number} to Zielsaite
   * @returns {void}
   */
  moveNoteString(from, to){
    const staff = edit.editStaff(this.score, this.pos.track);
    let moved = false;
    this.change(beat => { moved = edit.moveNoteToString(staff, beat, from, to); }, {pos: {string: to}});
    if(!moved) this.toast('Die Note passt dort nicht (Saite belegt oder Bund außerhalb 0–24).');
  }

  /**
   * Entf: Sind Schläge ausgewählt (Umschalt+←/→), werden sie gelöscht. Sonst löscht es die Zahl (Note) am Cursor; steht
   * dort keine, aber der Schlag ist leer (Pause), den Schlag. Der letzte Schlag eines Takts bleibt als Pause.
   * @returns {void}
   */
  deleteKey(){
    const selected = this.selectedBeats();
    if(selected.length){
      const from = this.beatSelection.from;
      this.beatSelection = null;
      this.change(() => selected.forEach(b => edit.deleteBeat(b)), {pos: {bar: from.bar, beat: from.beat}});
      this.toast(`${selected.length} ${selected.length === 1 ? 'Schlag' : 'Schläge'} gelöscht.`);
      return;
    }
    const string = this.pos.string;
    this.change(beat => {
      if(!edit.deleteNote(beat, string) && !beat.notes.length) edit.deleteBeat(beat);
    });
  }

  /**
   * Schläge der Auswahl (Umschalt+←/→) in der Reihenfolge der Noten.
   * @returns {Beat[]} leer ohne Auswahl
   */
  selectedBeats(){
    const sel = this.beatSelection;
    const staff = sel ? edit.editStaff(this.score, sel.track) : null;
    if(!sel || !staff) return [];
    const beats = [];
    for(let bar = sel.from.bar; bar <= sel.to.bar; bar++){
      const list = staff.bars[bar]?.voices[0]?.beats ?? [];
      const first = bar === sel.from.bar ? sel.from.beat : 0;
      const last = bar === sel.to.bar ? sel.to.beat : list.length - 1;
      for(let i = first; i <= last; i++) if(list[i]) beats.push(list[i]);
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
  changeBeats(fn, byCursor = false){
    const beats = this.selectedBeats();
    if(beats.length <= 1){
      this.change(fn);
      return;
    }
    this.change(() => {
      if(byCursor){
        const cursor = edit.beatAt(this.score, this.pos);
        fn(cursor);
        for(const beat of beats){
          if(beat === cursor) continue;
          edit.setDots(beat, cursor.dots);
          edit.setTriplet(beat, edit.isTriplet(cursor));
        }
      } else {
        for(const beat of beats) fn(beat);
      }
    });
    this.toast(`${beats.length} Schläge geändert.`);
  }

  /**
   * Erweitert die Auswahl der Schläge um einen Schlag nach links bzw. rechts (Umschalt+←/→); der Cursor geht mit.
   * @param {number} step -1 oder +1
   * @returns {void}
   */
  extendBeatSelection(step){
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
  setBeatRange(anchor, edge, scroll = false){
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
  setSelection(selection){
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
  extendSelection(step){
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
  copyBars(cut){
    const sel = this.selection ?? {track: this.pos.track, from: this.pos.bar, to: this.pos.bar};
    clipboard = {tex: this.tex, track: sel.track, from: sel.from, to: sel.to};
    const count = sel.to - sel.from + 1;
    if(cut){
      const staff = edit.editStaff(this.score, sel.track);
      this.change(() => {
        for(let i = sel.from; i <= sel.to; i++) edit.clearBar(this.alphaTab, staff.bars[i]);
      });
    }
    this.toast(`${count} ${count === 1 ? 'Takt' : 'Takte'} ${cut ? 'ausgeschnitten' : 'kopiert'}`);
  }

  /**
   * Fügt die Takte der Zwischenablage ab dem Takt am Cursor in dessen Spur ein und ersetzt die Takte dort.
   * @returns {void}
   */
  pasteBars(){
    if(!clipboard){
      this.toast('Die Zwischenablage ist leer (erst Strg+C).');
      return;
    }
    let count = 0;
    this.change(() => {
      count = edit.pasteBars(this.alphaTab, t => parseScore(this.alphaTab, t), this.score, clipboard, this.pos.track,
        this.pos.bar);
    }, {pos: {beat: 0}});
    this.toast(`${count} ${count === 1 ? 'Takt' : 'Takte'} eingefügt`);
  }

  /**
   * Schreibt Wiederholungen, Volta-Klammern, Sprungzeichen und Takt-Wiederholungszeichen aus (notation.js), als ein
   * Schritt für "Rückgängig".
   * @returns {void}
   */
  unrollRepeats(){
    let result;
    try {
      result = edit.unrollRepeats(this.alphaTab, t => parseScore(this.alphaTab, t), this.tex);
    } catch(err){
      this.toast(err.message);
      return;
    }
    if(!result){
      this.toast('Keine Wiederholungen oder Sprünge auszuschreiben.');
      return;
    }
    // Tab-Stellen wandern mit (ihr erstes Vorkommen).
    const sheet = JSON.stringify(remapSheetByOrder(this.sheet, result.order));
    this.commitTex(writeScore(this.alphaTab, result.score), sheet);
    this.toast(`Ausgeschrieben: ${result.before} → ${result.after} Takte`);
  }

  /**
   * Übernimmt einen neuen Stand als einen Schritt für "Rückgängig" (für Änderungen, die ein neues Modell liefern).
   * @param {string} tex alphaTex
   * @param {?string} [sheet] neue Angaben für das Leadsheet (wie sheetJson()), wenn sich die Takte verschoben haben
   * @returns {void}
   */
  commitTex(tex, sheet = null){
    if(tex === this.tex && (sheet === null || sheet === this.sheetJson())) return;
    this.undoStack.push(this.snapshot());
    if(this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
    if(sheet !== null) this.setSheet(sheet);
    this.setTex(tex);
  }

  /**
   * Ändert die Spuren (verschieben, löschen, hinzufügen) und hält die Auswahl der gezeigten Spuren mit.
   * @param {function(Score): *} fn Änderung an den Noten
   * @param {number} index betroffene Spur (beim Hinzufügen: Index der neuen)
   * @param {number} step Verschiebung (-1, +1), 0 beim Löschen bzw. Hinzufügen
   * @returns {void}
   */
  changeTracks(fn, index, step){
    // Die gewählte Spur für Akkorde bzw. Text ohne Inhalt (contentChoice) hängt am Index; nach dem Umbau neu wählen.
    this.contentChoice = {chords: null, lyrics: null};
    const before = this.score.tracks.length;
    const shown = new Set(this.trackIndexes);
    this.change(() => fn(this.score));
    const after = this.score.tracks.length;
    /** @type {function(number): ?number} alter Index → neuer Index */
    let map = i => i;
    if(step) map = i => i === index ? index + step : i === index + step ? index : i;
    else if(after < before) map = i => i === index ? null : i > index ? i - 1 : i;
    else if(after > before) map = i => i >= index ? i + 1 : i;
    this.player.remapTracks(map);
    const indexes = [...shown].map(map).filter(i => i !== null && i < after);
    if(after > before) indexes.push(index);
    this.trackIndexes = this.player.orderTracks(indexes.map(i => this.score.tracks[i])).map(t => t.index);
    if(!this.trackIndexes.length) this.trackIndexes = [0];
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
  contentTrack(kind){
    const found = kind === 'chords' ? chordsTrack(this.score) : lyricsTrack(this.score);
    if(found) return found.index;
    const chosen = this.contentChoice[kind];
    if(chosen !== null && chosen < this.score.tracks.length) return chosen;
    if(kind === 'chords') return 0;
    const vocal = this.score.tracks.find(t => t.name.trim().toLowerCase() === 'vocal');
    return vocal?.index ?? this.score.tracks.length - 1;
  }

  /**
   * Spur, deren Liedtext das Panel "Liedtext" bearbeitet (contentTrack()).
   * @returns {?import('../../types/alphatab').model.Track}
   */
  lyricsTarget(){
    if(!this.score) return null;
    return this.score.tracks[this.contentTrack('lyrics')] ?? null;
  }

  /**
   * Schlag, an dem der Akkord für den Schlag am Cursor steht: der Schlag der Akkordspur (contentTrack()), der an
   * derselben Stelle beginnt. So landen neue Akkorde in der Spur, die die Radiobuttons zeigen, auch wenn der Cursor in
   * einer anderen steht. Beginnt dort kein Schlag (z. B. mitten in einer langen Note), der Schlag am Cursor selbst;
   * dann meldet renderNotices() Akkorde außerhalb der Akkordspur.
   * @param {Beat} beat Schlag am Cursor
   * @returns {Beat}
   */
  chordBeat(beat){
    const staff = this.score.tracks[this.contentTrack('chords')]?.staves[0];
    if(!staff || staff === beat.voice.bar.staff) return beat;
    const bar = staff.bars[beat.voice.bar.index];
    return bar?.voices[0]?.beats.find(b => b.playbackStart === beat.playbackStart) ?? beat;
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
  moveContentTo(kind, index){
    const chords = kind === 'chords';
    const has = chords ? chordsTrack(this.score) : lyricsTrack(this.score);
    const name = `„${trackName(this.score.tracks[index])}“`;
    if(!has){
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
      this.change(() => { result = edit.moveContent(this.alphaTab, this.score, kind, index, mode); });
      this.toast(`${chords ? 'Akkorde' : 'Liedtext'} jetzt in ${name}`
        + (result.split ? `; ${result.split} ${result.split === 1 ? 'Schlag' : 'Schläge'} geteilt` : '')
        + (result.shifted ? `; ${result.shifted} auf den Schlag davor gesetzt` : '') + '.');
    };
    if(!shift.shifted && !shift.lost && !shift.dropped){
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
    for(const button of document.querySelectorAll('[data-move]')){
      button.addEventListener('click', () => {
        const mode = /** @type {HTMLElement} */ (button).dataset.move;
        closeOverlay();
        if(mode) apply(/** @type {import('./notation.js').MoveMode} */ (mode));
        else this.renderSongPanels();
      });
    }
  }

  /**
   * Übernimmt Text und Akkorde einer hochgeladenen Akkorddatei (Knopf "Chord-Datei importieren", readChordFile() in
   * chordfile.js). Der Text kommt ins Feld "Liedtext" und wird auf die Schläge verteilt (applyLyrics()); das Feld ist
   * dabei leer, es gibt also keinen Text, der Vorrang hätte. Jeder Akkord kommt an den Schlag seiner Silbe (in der
   * Akkordspur, siehe chordBeat()), aber nur dort, wo noch kein Akkord steht. Kennt der Akkordkatalog einen Akkord
   * nicht, steht ein einfacherer (simplifyChord()); die Griffe kommen aus dem Katalog (normalizeChords()).
   * @param {File} file ChordPro- oder Textdatei
   * @returns {Promise<void>}
   */
  async insertChordFileText(file){
    const {text, chords} = readChordFile(await file.text());
    if(!text.trim()){
      this.toast(`In ${file.name} wurde kein Text gefunden.`);
      return;
    }
    const area = /** @type {HTMLTextAreaElement} */ (this.part('edit-right').querySelector('[data-lyrics]'));
    area.value = text;
    this.applyLyrics();
    this.lyricsTyping = false;

    // Die Schläge mit Silbe in der Reihenfolge der Silben des Textes (die Silben ohne Schlag am Ende fehlen).
    const track = this.lyricsTarget();
    const beats = track.staves[0].bars.flatMap(bar => bar.voices[0]?.beats ?? []).filter(b => b.lyrics?.[0]?.trim());
    const ranges = edit.syllableRanges(text);
    const library = await loadChordLibraryOrEmpty();
    const result = {placed: 0, kept: 0, lost: 0, simplified: /** @type {string[]} */ ([])};
    this.change(() => {
      for(const {at, name} of chords){
        const k = ranges.findIndex(r => r.to > at);
        if(k < 0 || k >= beats.length){
          result.lost++;
          continue;
        }
        const beat = this.chordBeat(beats[k]);
        if(beat.chordId){
          result.kept++;
          continue;
        }
        const simple = simplifyChord(name, library);
        if(simple !== name && !result.simplified.includes(`${name} → ${simple}`)) result.simplified.push(`${name} → ${simple}`);
        this.setChordName(beat, simple);
        result.placed++;
      }
      normalizeChords(this.alphaTab, this.score, library);
    });
    this.fillLyrics();
    this.toast(`${file.name}: Text eingefügt (mehrsilbige Wörter noch mit Bindestrich trennen, Lie-der-buch)`
      + (chords.length ? `; ${result.placed} von ${chords.length} Akkorden gesetzt` : '; keine Akkorde gefunden')
      + (result.kept ? `, ${result.kept} übersprungen (am Schlag stand schon einer)` : '')
      + (result.lost ? `, ${result.lost} ohne Schlag` : '')
      + (result.simplified.length ? `. Ersetzt: ${result.simplified.join(', ')}` : '') + '.');
  }

  /**
   * Übernimmt eine Spur aus einer anderen Guitar-Pro-Datei (Knopf "Spur aus GuitarPro-Datei importieren"): Die Datei wird wie beim
   * Import gelesen und bereinigt (readGpFile() in notation.js), dann fragt ein Dialog nach der Spur und den Takten, ab
   * denen sie passt (der Song kann z. B. ein kürzeres Intro haben). Die Spur kommt ans Ende, ohne Akkorde und Text
   * (edit.importTrack()).
   * @param {File} file gewählte Datei
   * @returns {Promise<void>}
   */
  async importTrackFile(file){
    let tex = '';
    let loss = null;
    try {
      ({tex, loss} = await readGpFile(file));
    } catch(err){
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
        <p class="hint">Taktart, Tempo und Abschnitte bleiben die des Songs; Takte davor werden Pausen, was über das
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
      let result = {bars: 0, cut: 0, misfit: []};
      // Frisch gelesen: importTrack() hängt die Takte der Quelle um.
      this.changeTracks(score => { result = edit.importTrack(this.alphaTab, score, parse().tracks[index], from, at); },
        this.score.tracks.length, 0);
      const misfit = result.misfit.length ? `; Länge passt nicht zur Taktart in Takt `
        + `${result.misfit.slice(0, 8).map(i => i + 1).join(', ')}${result.misfit.length > 8 ? ' …' : ''}` : '';
      this.toast(`Spur „${trackName(this.score.tracks.at(-1))}“ übernommen: ${result.bars} Takte`
        + (result.cut ? `, ${result.cut} am Ende weggefallen` : '') + misfit + '.');
    });
  }

  /**
   * Setzt den Griff eines Akkords in einem Notensystem (Griffbild mit erstem Bund und Barré).
   * @param {import('../../types/alphatab').model.Staff} staff Notensystem
   * @param {string} name Akkordname
   * @param {string} grip Griff, tiefe Saite zuerst, z. B. "x02210"
   * @returns {boolean} ob es den Akkord gab und der Griff gültig war
   */
  setChordGrip(staff, name, grip){
    const chord = [...staff.chords?.values() ?? []].find(c => c.name === name);
    const frets = parseGrip(grip);
    if(!chord || frets.length !== staff.tuning.length) return false;
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
  async load(){
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
    if(!this.parts.length) return;
    this.setSheet(JSON.stringify(sheet));
    this.savedSheet = this.sheetJson();
    void this.leadsheetTab.loadCatalog();
    // Das Raster der Schläge (boundsLookup) ist erst nach postRenderFinished vollständig, beim ersten Zeichnen kommt
    // renderFinished davor.
    // Beim Schreiben in einem Feld (z. B. Liedtext) rollt die Seite nicht zum Cursor.
    const redraw = () => this.drawCursor(!document.activeElement?.matches('input, textarea, select'));
    // Beim Abspielen wandert die Silbe im Liedtext und in der Vorschau mit.
    const offs = [api.renderFinished.on(redraw), api.postRenderFinished.on(redraw),
      api.playerPositionChanged.on(e => this.followPlayback(e.currentTick))];
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
    for(const b of player.el.viewPop.querySelectorAll('[data-view="score"], [data-view="chords"]')) b.hidden = true;
    this.savedTex = writeScore(this.alphaTab, parseScore(this.alphaTab, tex));
    const score = parseScore(this.alphaTab, tex);
    const first = this.trackIndexes.find(i => score.tracks[i]?.staves[0]?.isStringed) ?? this.trackIndexes[0] ?? 0;
    this.pos = {track: first, bar: 0, beat: 0, string: score.tracks[first]?.staves[0]?.tuning.length || 1};
    this.setTex(this.savedTex);
    if(!this.part('edit-bottom').classList.contains('collapsed')) void this.openSync();
  }

  /**
   * Stellt die Abspielposition auf den Schlag am Cursor, solange nicht gespielt wird. Fehlt noch das MIDI zu den
   * gezeichneten Noten (tickCache), bleibt die Position, wie sie ist.
   * @returns {void}
   */
  seekToCursor(){
    const api = this.player.api;
    if(this.player.isPlaying || !this.score) return;
    const beat = edit.beatAt(this.score, this.pos);
    const ticks = api.tickCache;
    const tick = beat && ticks ? ticks.getBeatStart(beat) : undefined;
    if(tick !== undefined && tick !== api.tickPosition) api.tickPosition = tick;
  }

  /**
   * Übernimmt einen Stand der Noten: einlesen, Cursor in Grenzen halten, zeichnen.
   * @param {string} tex alphaTex
   * @returns {void}
   */
  setTex(tex){
    const api = this.player.api;
    this.tex = tex;
    this.score = parseScore(this.alphaTab, tex, api.settings);
    this.fileFlags = new WeakMap(this.score.tracks.flatMap(t => t.staves)
      .map(st => [st, STAFF_FLAGS.map(f => st[f])]));
    this.player.applyStave(this.score);
    this.fileShortNames = new WeakMap(this.score.tracks.map(t => [t, t.shortName]));
    this.fileStyle = TRACK_NAME_STYLE.map(f => this.score.stylesheet[f]);
    showTrackNames(this.alphaTab, this.score);
    // Gezeigt werden nur Spuren, die es gibt (nach Löschen oder Rückgängig), mindestens eine.
    this.trackIndexes = this.trackIndexes.filter(i => i < this.score.tracks.length);
    if(!this.trackIndexes.length) this.trackIndexes = [0];
    if(!this.trackIndexes.includes(this.pos.track)) this.pos = {...this.pos, track: this.trackIndexes[0]};
    this.pos = edit.clampPosition(this.score, this.pos);
    api.renderScore(this.score, this.trackIndexes);
    // Die Audiospur folgt den Sync-Punkten der bearbeiteten Noten (auch nach Rückgängig).
    this.player.mixer?.setScore(this.score);
    this.sync?.reload();
    this.updateState();
    this.renderSongPanels();
    this.fillSongFields();
    this.renderNotices();
  }

  /**
   * Meldungen unter der Werkzeugleiste: Abweichungen von der Form des Gitarrenbuchs (wie die Prüfung der API, siehe
   * read_score_issues() in api/lib/crud.php, dazu Tonart und Akkorde wie im Struktur-Editor), jede mit einem Knopf,
   * der sie behebt (außer den Hinweisen zu Akkordnamen und Griffen, die man im Dialog "Akkord" ändert). Nach jeder Änderung neu.
   * @returns {void}
   */
  renderNotices(){
    const el = this.part('edit-notices');
    const score = this.score;
    if(!el || !score) return;
    /** @type {[string, string, string, string][]} Text, Knopf, Befehl für run(), Tooltip (ohne Knopf: Befehl leer) */
    const notices = [];
    // Der Song soll von oben nach unten durchlaufen, damit jeder Takt eindeutig ist.
    if(edit.hasRepeats(this.alphaTab, score)){
      notices.push(['Der Song läuft nicht von oben nach unten durch (Wiederholungen, Volta-Klammern, Sprungzeichen oder '
        + 'Wiederholungstakte).', 'Wiederholungen und Sprünge ausschreiben', 'unroll',
      'Jeder Takt steht danach so oft da, wie er gespielt wird']);
    }
    const staves = stringedStaves(score);
    if(new Set(staves.map(st => st.capo)).size > 1){
      notices.push([`Capo ungleich: ${staves.map(st => `${trackName(st.track)} ${st.capo}`).join(', ')}.`,
        'Capo angleichen', 'unifyCapo',
        'Alle Spuren auf den Capo der Akkordspur; die anderen werden umgerechnet und klingen gleich']);
    }
    if(!sameTuning(score)){
      notices.push([`Tuning ungleich: ${tuningStaves(score).map(st => `${trackName(st.track)} ${
        this.tuningText(st)}`).join(', ')}.`, 'Tuning angleichen', 'unifyTuning',
      'Alle Spuren auf das Tuning der Akkordspur; die anderen werden umgerechnet und klingen gleich']);
    }
    const key = detectKeySignature(score);
    if(key){
      const bar = (staves[0] ?? score.tracks[0].staves[0]).bars[0];
      const minor = bar.keySignatureType === this.alphaTab.model.KeySignatureType.Minor;
      notices.push([`Tonart: notiert ${keyName(bar.keySignature, minor)}, erkannt aus Akkorden und Tönen `
        + `${keyName(key.keySignature, key.minor)}.`, 'Tonart korrigieren', 'detectKey',
      'Vorzeichen im ganzen Song auf die erkannte Tonart setzen']);
    }
    // Triolen-Feeling: Das Gitarrenbuch kennt nur Shuffle (Achtel-Triolen).
    const feels = new Set(score.masterBars.map(mb => Number(mb.tripletFeel))
      .filter(f => f !== this.alphaTab.model.TripletFeel.NoTripletFeel && f !== this.alphaTab.model.TripletFeel.Triplet8th));
    if(feels.size){
      notices.push([`Triolen-Feeling ${[...feels].map(f => TRIPLET_FEELS[f]).join(', ')}: Vorgesehen ist nur Shuffle (Achtel-Triolen).`,
        'Feeling entfernen', 'removeFeel', 'Das Triolen-Feeling im ganzen Song ausschalten (die Noten bleiben, wie sie sind)']);
    }
    // Akkorde bzw. Text in mehr als einer Spur: Die Radiobuttons im Dialog "Spuren" zeigen dann die Spur mit den
    // meisten, die übrigen sollen dorthin (eine Stelle je Information, siehe notation.js).
    for(const [kind, track, label, has] of [
      ['chords', chordsTrack(score), 'Akkorde', beat => !!beat.chordId],
      ['lyrics', lyricsTrack(score), 'Liedtext', beat => !!beat.lyrics?.some(l => l?.trim())],
    ]){
      if(!track || !score.tracks.some(t => t !== track && t.staves.some(st => st.bars.some(b => b.voices.some(v =>
        v.beats.some(has)))))) continue;
      const name = trackName(track);
      notices.push([`${label} stehen auch außerhalb von „${name}“.`, `${label} nach „${name}“ übertragen`,
        kind === 'chords' ? 'mergeChords' : 'mergeLyrics',
        `${label} ganz in diese Spur schreiben (fragt nach, wenn sich dabei etwas verschiebt)`]);
    }
    // Akkordnamen, die die Regeln der Akkordtheorie nicht kennen, und Griffe, die nicht zum Namen passen.
    const unknown = new Set();
    const mismatches = new Map();
    for(const staff of staves) for(const chord of staff.chords?.values() ?? []){
      const parsed = parseChord(chord.name);
      if(!parsed){
        unknown.add(chord.name);
        continue;
      }
      const grip = gripOf(chord);
      if(playedStrings(grip) < 3) continue;
      const frets = parseGrip(grip);
      const tuning = [...staff.tuning].reverse();
      if(!gripToneProblem(parsed, frets, tuning)) continue;
      const alike = nameGrip(frets, tuning, 1)[0];
      mismatches.set(`${chord.name}|${grip}`, `${chord.name} (${grip}${alike ? `, klingt wie ${alike}` : ''})`);
    }
    const list = items => items.length > 8 ? `${items.slice(0, 8).join(', ')} … (${items.length})` : items.join(', ');
    if(unknown.size){
      notices.push([`Unbekannte Akkordnamen: ${list([...unknown])}.`, '', '',
        'Der Name entspricht nicht den Regeln der Akkordtheorie (docs/Musiktheorie.md); im Dialog "Akkord" ändern']);
    }
    if(mismatches.size){
      notices.push([`Der Griff passt nicht zum Namen: ${list([...mismatches.values()])}.`, '', '',
        'Die Töne des Griffs sind andere als die des Akkordnamens; im Dialog "Akkord" Name oder Griff ändern']);
    }
    const button = /** @type {?HTMLElement} */ (this.part('edit-toolbar')?.querySelector('[data-action="notices"]'));
    if(button){
      button.hidden = !notices.length;
      button.innerHTML = `&#9888; ${notices.length} Hinweis${notices.length === 1 ? '' : 'e'}`;
    }
    if(!notices.length) this.toggleNotices(false);
    el.innerHTML = notices.map(([text, label, cmd, hint]) => `
      <div class="edit-notice"><span${cmd ? '' : ` title="${escapeHtml(hint)}"`}>&#9888; ${escapeHtml(text)}</span>
        ${cmd ? `<button type="button" class="ebtn ebtn-text" data-cmd="${cmd}"
          title="${escapeHtml(hint)}">${escapeHtml(label)}</button>` : ''}</div>`).join('');
  }

  /**
   * Klappt die Hinweise unter ihrem Knopf auf bzw. zu. Sie bleiben offen, bis man den Knopf wieder drückt oder alle
   * behoben sind (nach "Beheben" zeigt die Liste gleich, was noch übrig ist).
   * @param {boolean} [open] öffnen; ohne Angabe umschalten
   * @returns {void}
   */
  toggleNotices(open){
    const el = this.part('edit-notices');
    const button = this.part('edit-toolbar')?.querySelector('[data-action="notices"]');
    if(!el) return;
    const show = open ?? el.hidden;
    el.hidden = !show || !el.children.length;
    button?.setAttribute('aria-expanded', String(!el.hidden));
  }

  /**
   * Setzt die Höhe des unteren Panels (Inhalt unter der Kopfzeile), in Grenzen.
   * @param {number} height Höhe in px
   * @returns {number} gesetzte Höhe
   */
  setBottomHeight(height){
    const h = Math.round(Math.max(BOTTOM_MIN_H, Math.min(window.innerHeight * BOTTOM_MAX_SHARE, height)));
    this.part('edit-bottom').style.setProperty('--edit-bottom-body-h', `${h}px`);
    return h;
  }

  /**
   * Ziehen am oberen Rand des unteren Panels ändert seine Höhe; sie gilt danach für alle Songs.
   * @param {PointerEvent} e Drücken auf den Rand
   * @returns {void}
   */
  startBottomResize(e){
    e.preventDefault();
    const bottom = this.part('edit-bottom');
    if(bottom.classList.contains('collapsed')) this.togglePanel('bottom');
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
      } catch(err){
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
  setLyricsHeight(height){
    const body = this.part('edit-right').querySelector('.elyrics');
    if(height === undefined){
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
  setRightWidth(width){
    if(width === undefined){
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
  startRightResize(e){
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
      } catch(err){
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
  startLyricsResize(e){
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
      } catch(err){
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
  async openSync(){
    const tab = /** @type {HTMLElement} */ (this.part('edit-bottom').querySelector('[data-audio]'));
    const sync = /** @type {HTMLElement} */ (tab.querySelector('[data-audio-sync]'));
    if(this.sync || tab.dataset.started) return;
    tab.dataset.started = '1';
    const seconds = this.player.hasAudio ? await this.player.audioDuration : 0;
    if(!this.parts.length) return;
    if(!seconds || !this.player.mixer){
      // Ohne Audiospur steht der Hinweis schon bei der Quelle (renderAudioSource()).
      sync.innerHTML = this.player.hasAudio ? '<p class="efield-hint">Die Audiospur konnte nicht geladen werden.</p>' : '';
      return;
    }
    sync.innerHTML = '';
    this.sync = new SyncEditor(sync, this.player, {onEdit: () => this.syncEdited()});
    try {
      await this.sync.open();
    } catch(err){
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
  writeTex(){
    const staves = this.score.tracks.flatMap(t => t.staves).filter(st => this.fileFlags.has(st));
    const shown = staves.map(st => STAFF_FLAGS.map(f => st[f]));
    staves.forEach(st => STAFF_FLAGS.forEach((f, i) => { st[f] = this.fileFlags.get(st)[i]; }));
    const sheet = this.score.stylesheet;
    const names = this.score.tracks.map(t => t.shortName);
    const style = TRACK_NAME_STYLE.map(f => sheet[f]);
    this.score.tracks.forEach(t => { t.shortName = this.fileShortNames.get(t) ?? t.shortName; });
    TRACK_NAME_STYLE.forEach((f, i) => { sheet[f] = this.fileStyle[i]; });
    try {
      return writeScore(this.alphaTab, this.score);
    } finally {
      this.score.tracks.forEach((t, k) => { t.shortName = names[k]; });
      TRACK_NAME_STYLE.forEach((f, i) => { sheet[f] = style[i]; });
      staves.forEach((st, k) => STAFF_FLAGS.forEach((f, i) => { st[f] = shown[k][i]; }));
    }
  }

  /**
   * Übernimmt eine Änderung aus dem Sync-Editor als Schritt für "Rückgängig". Er ändert die Noten (Sync-Punkte,
   * Tempi) direkt; neu eingelesen und gezeichnet wird nicht, das Bild bleibt gleich.
   * @returns {void}
   */
  syncEdited(){
    const tex = this.writeTex();
    if(tex === this.tex) return;
    this.undoStack.push(this.snapshot());
    if(this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.tex = tex;
    this.updateState();
    this.fillSongFields();
  }

  /**
   * Ändert den Schlag am Cursor (oder die Noten) und übernimmt das Ergebnis: als alphaTex schreiben, neu einlesen,
   * zeichnen. Der Stand davor kommt auf "Rückgängig". Ändert sich nichts, bleibt alles, wie es war.
   * @param {function(Beat): *} fn Änderung am Schlag; das Modell darf sie direkt ändern
   * @param {{merge?: boolean, pos?: Object}} [options] merge: mit dem letzten Schritt zusammenfassen (zweite Ziffer
   *   eines Bunds); pos: Cursor danach (Teile von EditPosition)
   * @returns {void}
   */
  change(fn, {merge = false, pos = null} = {}){
    const beat = this.score ? edit.beatAt(this.score, this.pos) : null;
    if(!beat) return;
    // Tab-Stellen (Angaben für das Leadsheet) hängen am Index der Takte und am Namen der Spur. Die Änderung arbeitet am Modell,
    // eingefügte Takte sind neue, gelöschte fehlen danach, die übrigen Takte und Spuren bleiben dieselben Objekte: So
    // lassen sich neuer Index und Name finden.
    const sheetBefore = this.sheetJson();
    const tabs = captureTabs(this.sheet, this.score);
    fn(beat);
    edit.applySectionBars(this.alphaTab, this.score);
    remapTabs(this.sheet, this.score, tabs);
    const tex = this.writeTex();
    if(tex === this.tex){
      // Das Modell kann halb geändert sein (z. B. ein Bogen ohne Note davor): auf den Stand zurück, neu gezeichnet,
      // damit Bild und Modell wieder zusammenpassen.
      this.setTex(this.tex);
      return;
    }
    if(!merge){
      this.undoStack.push(this.snapshot(sheetBefore));
      if(this.undoStack.length > UNDO_MAX) this.undoStack.shift();
      this.redoStack = [];
    }
    if(pos) this.pos = {...this.pos, ...pos};
    this.setTex(tex);
  }

  /**
   * Stand für "Rückgängig" bzw. "Wiederholen": Text, Angaben für das Leadsheet, Cursor und gezeigte Spuren.
   * @param {string} [sheet] Angaben für das Leadsheet (sheetJson()), wenn sie schon geändert sind: der Stand davor
   * @returns {UndoStep}
   */
  snapshot(sheet = this.sheetJson()){
    return {tex: this.tex, sheet, pos: {...this.pos}, tracks: [...this.trackIndexes]};
  }

  /**
   * Rückgängig bzw. Wiederholen: nimmt den letzten Stand vom einen Stapel und legt den jetzigen auf den anderen.
   * @param {UndoStep[]} from Stapel, von dem der Stand kommt
   * @param {UndoStep[]} to Stapel für den jetzigen Stand
   * @returns {void}
   */
  undo(from, to){
    const step = from.pop();
    if(!step){
      this.toast(from === this.undoStack ? 'Nichts rückgängig zu machen' : 'Nichts zu wiederholen');
      return;
    }
    to.push(this.snapshot());
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
  typeDigit(digit){
    const now = Date.now();
    const previous = this.digit;
    const same = previous && now - previous.time < DIGIT_MS
      && ['track', 'bar', 'beat', 'string'].every(k => previous.pos[k] === this.pos[k]);
    if(same && previous.value * 10 + digit <= edit.MAX_FRET){
      this.digit = null;
      this.change(beat => edit.setFret(this.alphaTab, beat, this.pos.string, previous.value * 10 + digit), {merge: true});
      return;
    }
    if(!edit.editStaff(this.score, this.pos.track)?.isStringed){
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
  previousBeat(){
    const pos = edit.stepBeat(this.score, this.pos, -1);
    return pos === this.pos ? null : edit.beatAt(this.score, pos);
  }

  /**
   * Bewegt den Cursor (ohne die Noten zu ändern).
   * @param {Object} changes Teile von EditPosition
   * @returns {void}
   */
  moveTo(changes){
    if(!this.score) return;
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
  stepTrack(step){
    const index = this.trackIndexes.indexOf(this.pos.track) + step;
    if(index < 0 || index >= this.trackIndexes.length) return;
    this.moveTo({track: this.trackIndexes[index], beat: 0});
  }

  /**
   * Beginnt die Eingabe im Feld Instrument: Das Feld wird geleert (das bisherige steht als Platzhalter da), sonst
   * zeigte die Liste nur Instrumente, die zum bisherigen Text passen. Vorgeschlagen werden die Instrumente, die
   * Songs schon nutzen.
   * @param {HTMLInputElement} input beliebiges Feld im Dialog "Spuren"
   * @returns {void}
   */
  startInstrumentInput(input){
    if(input.dataset.trackField !== 'instrument') return;
    input.placeholder = input.dataset.label;
    input.value = '';
    this.suggestInstruments(input);
  }

  /**
   * Beendet die Eingabe im Feld Instrument: Wurde nichts gewählt, steht wieder das bisherige darin.
   * @param {HTMLInputElement} input beliebiges Feld im Dialog "Spuren"
   * @returns {void}
   */
  endInstrumentInput(input){
    if(input.dataset.trackField === 'instrument' && !input.value.trim()) input.value = input.dataset.label;
  }

  /**
   * Füllt die Vorschlagsliste für das Feld Instrument: ohne Eingabe die Instrumente, die schon in Songs vorkommen (und
   * das der Spur), mit Eingabe alle, deren Name den Text enthält (bei einer Zahl: deren Nummer damit beginnt).
   * @param {HTMLInputElement} input beliebiges Feld im Dialog "Spuren"
   * @returns {void}
   */
  suggestInstruments(input){
    if(input.dataset.trackField !== 'instrument') return;
    const text = input.value.trim().toLowerCase();
    const programs = text
      ? INSTRUMENT_NAMES.map((n, p) => p).filter(p => /^\d+$/.test(text)
        ? String(p).startsWith(text) : instrumentLabel(p).toLowerCase().includes(text))
      : [...new Set([...usedPrograms(), this.score.tracks[Number(input.dataset.track)].playbackInfo.program])]
        .sort((a, b) => a - b);
    document.getElementById('etrackPrograms').innerHTML = programs
      .map(p => `<option value="${escapeHtml(instrumentLabel(p))}">`).join('');
  }

  /**
   * Blendet eine Spur in den Noten ein oder aus (Auge im Dialog "Spuren"); mindestens eine bleibt angezeigt.
   * @param {number} index Index der Spur
   * @returns {void}
   */
  toggleTrackEye(index){
    const shown = new Set(this.trackIndexes);
    if(!shown.delete(index)) shown.add(index);
    if(!shown.size) return;
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
  toggleTrackAudible(index){
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
  showTracks(indexes){
    if(!this.score) return;
    this.trackIndexes = this.player.orderTracks(indexes.map(i => this.score.tracks[i])).map(t => t.index);
    if(!this.trackIndexes.includes(this.pos.track)) this.pos = {...this.pos, track: this.trackIndexes[0], beat: 0};
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
  updateState(){
    const beat = this.score ? edit.beatAt(this.score, this.pos) : null;
    const status = this.part('edit-bottom')?.querySelector('.edit-status');
    if(!beat || !status) return;
    const fill = edit.barFill(beat.voice.bar);
    status.innerHTML = fill > 0 ? '<strong class="edit-warn">Takt zu lang</strong>'
      : fill < 0 ? '<strong class="edit-warn">Takt zu kurz</strong>' : '';
    for(const b of this.part('edit-left').querySelectorAll('[data-duration]')){
      b.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (b).dataset.duration) === beat.duration));
    }
    const pressed = (cmd, on) => this.part('edit-left').querySelector(`[data-cmd="${cmd}"]`)
      .setAttribute('aria-pressed', String(on));
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
    const toolbar = this.part('edit-toolbar');
    toolbar.querySelector('[data-cmd="undo"]').disabled = !this.undoStack.length;
    toolbar.querySelector('[data-cmd="redo"]').disabled = !this.redoStack.length;
    const save = /** @type {HTMLButtonElement} */ (toolbar.querySelector('[data-cmd="save"]'));
    save.classList.toggle('ebtn-dirty', this.dirty);
    save.disabled = !this.dirty;
    const fields = this.part('edit-left');
    const value = (name, v) => {
      const input = /** @type {HTMLInputElement} */ (fields.querySelector(`[data-field="${name}"]`));
      if(input && document.activeElement !== input) input.value = v;
    };
    this.fillChordSelect();
    value('text', beat.text ?? '');
    const mb = beat.voice.bar.masterBar;
    this.fillField(fields, '[data-bar="section"]', sectionName(mb.section));
    this.fillBarSignature();
    this.leadsheetTab.cursorMoved();
    this.showLyricsAt(beat);
  }

  /**
   * Speichert die Noten: Griffbilder vereinheitlichen (wie beim Import), als alphaTex schreiben, prüfen, hochladen.
   * Der Server hebt die vorige Fassung auf (history/). Danach, wenn geändert, die Angaben für das Leadsheet.
   * @returns {Promise<void>}
   */
  async save(){
    if(!this.dirty){
      this.toast('Keine Änderungen');
      return;
    }
    const tex = this.tex;
    const sheet = this.sheetJson();
    try {
      let song = null;
      const scoreSaved = tex !== this.savedTex;
      if(scoreSaved){
        const result = parseScore(this.alphaTab, tex);
        // Ohne Katalog (Netzfehler) behalten die Akkorde ihren eigenen meistgenutzten Griff.
        normalizeChords(this.alphaTab, result, await loadChordLibraryOrEmpty(), true);
        song = await saveScore(this.player.slug, writeScoreChecked(this.alphaTab, result));
        this.savedTex = tex;
      }
      // Nach den Noten: Passen sie nicht (Prüfung), bleiben auch die Angaben je Takt ungespeichert, so passen beide
      // Dateien weiter zueinander.
      if(sheet !== this.savedSheet){
        // Die Noten haben den bisherigen Stand schon in den Verlauf gelegt (mit den damaligen Angaben).
        song = await saveLeadsheet(this.player.slug, JSON.parse(sheet), !scoreSaved);
        this.savedSheet = sheet;
      }
      // Zuletzt: Die Vorgaben gelten für die Spuren, wie sie nach dem Speichern der Noten sind.
      if(this.viewChanged){
        song = await saveSongFields(this.player.slug, {trackDefaults: this.trackDefaults()});
        this.viewChanged = false;
      }
      this.saved = true;
      this.onSaved(song);
      this.updateState();
      this.toast('Gespeichert');
    } catch(err){
      this.toast('Nicht gespeichert: ' + err.message);
    }
  }

  /**
   * Zeigt kurz einen Hinweis unter der Werkzeugleiste.
   * @param {string} text Hinweis
   * @returns {void}
   */
  toast(text){
    const el = this.part('edit-toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), TOAST_MS);
  }

  /**
   * Merkt sich, welche Panels eingeklappt sind. Auf schmalen Bildschirmen nur das untere: Die seitlichen sind dort
   * immer anfangs zu.
   * @returns {void}
   */
  saveCollapsed(){
    const state = loadCollapsed();
    state.bottom = this.part('edit-bottom').classList.contains('collapsed');
    if(matchMedia(WIDE_LAYOUT).matches){
      state.left = this.part('edit-left').classList.contains('collapsed');
      state.right = this.part('edit-right').classList.contains('collapsed');
    }
    try {
      localStorage.setItem(PANELS_KEY, JSON.stringify(state));
    } catch(err){
      // Ohne Speicher (privates Fenster) gilt die Wahl nur bis zum Schließen.
    }
  }

  /**
   * Überträgt die Höhen von fester Leiste und unterem Panel in CSS-Variablen (Lage der Panels, Platz der Noten).
   * @returns {void}
   */
  measure(){
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
  relayout(){
    window.dispatchEvent(new Event('resize'));
  }

  /**
   * X-Button verlässt den Bearbeitungsmodus; bei ungespeicherten Änderungen fragt ein Dialog, ob sie gespeichert werden.
   * @returns {void}
   */
  finish(){
    if(!this.dirty){
      this.onClose(this.saved);
      return;
    }
    openOverlay(`<h2>Änderungen speichern?</h2>
      <p>Möchtest du die Änderungen speichern?</p>
      <div class="struct-actions">
        <button class="btn" type="button" id="finishDiscard">Nein, verwerfen</button>
        <button class="btn btn-primary" type="button" id="finishSave">Ja, speichern</button>
      </div>`, true);
    document.getElementById('finishDiscard').addEventListener('click', () => {
      closeOverlay();
      this.onClose(this.saved);
    });
    document.getElementById('finishSave').addEventListener('click', async () => {
      closeOverlay();
      await this.save();
      // Misslang das Speichern (Meldung unten), bleibt der Bearbeitungsmodus offen.
      if(!this.dirty) this.onClose(this.saved);
    });
  }

  /**
   * Entfernt Leiste und Panels und gibt die volle Breite an die Noten zurück.
   * @returns {void}
   */
  destroy(){
    this.resize?.disconnect();
    clearTimeout(this.toastTimer);
    clearTimeout(this.lyricsTimer);
    document.removeEventListener('keydown', this.onKey);
    this.player.el.play.removeEventListener('click', this.onPlay, true);
    this.player.el.loop.hidden = false;
    this.offRender?.();
    this.player.el.at.removeEventListener('pointerdown', this.onPointer);
    this.cursorEl?.remove();
    this.sync?.destroy();
    this.sync = null;
    if(this.player.editor === this) this.player.editor = null;
    for(const b of /** @type {NodeListOf<HTMLElement>} */ (this.player.el.viewPop.querySelectorAll('[data-view]'))) b.hidden = false;
    // Wieder die Ansicht des Players (nach dem Speichern lädt der Aufrufer den Song ohnehin neu).
    if(this.display && this.player.api && !this.saved){
      this.player.applyStave(this.display.score);
      this.player.api.renderScore(this.display.score, this.display.tracks);
    }
    this.score = null;
    for(const part of this.parts) part.remove();
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
  handlePointer(e){
    if(e.button !== 0 || !this.score) return;
    // Ein Klick in die Noten beendet das Schreiben im Liedtext, sonst folgt dieser dem Cursor nicht.
    const lyrics = this.part('edit-right').querySelector('[data-lyrics]');
    if(document.activeElement === lyrics) /** @type {HTMLElement} */ (lyrics).blur();
    const rect = this.player.el.at.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = this.hitTest(x, y);
    if(!hit) return;
    // Umschalt+Klick wählt die Schläge vom Anker (Beginn der Auswahl, sonst der Cursor) bis zum Klick.
    if(e.shiftKey && hit.track === this.pos.track){
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
  drawCursor(scroll){
    const el = this.cursorEl;
    const api = this.player.api;
    this.drawProblems();
    const beat = this.score ? edit.beatAt(this.score, this.pos) : null;
    const lookup = api.boundsLookup;
    const bounds = beat && lookup ? lookup.findBeat(beat) : null;
    if(!el || !bounds || this.player.prefs.view === 'chords'){
      if(el) el.hidden = true;
      return;
    }
    el.hidden = false;
    const staff = beat.voice.bar.staff;
    const entries = bounds.barBounds.masterBarBounds.bars.filter(b => entryBar(b) === beat.voice.bar);
    if(!entries.length){
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
    if(!box.hidden){
      const spacing = last.h / (strings - 1);
      const y = last.y + (strings - this.pos.string) * spacing;
      Object.assign(box.style, {
        left: `${x - CURSOR_PAD}px`, top: `${y - spacing / 2}px`,
        width: `${w + 2 * CURSOR_PAD}px`, height: `${spacing}px`,
      });
    }
    this.drawSelection();
    if(scroll) this.scrollCursorIntoView(box.hidden ? column : box);
  }

  /**
   * Füllt ein Feld, außer während darin geschrieben wird.
   * @param {Element} root Panel
   * @param {string} selector Feld
   * @param {string|number|boolean} v Wert (Checkbox: an/aus; Auswahl: Text bzw. Index bei Zahlen)
   * @returns {void}
   */
  fillField(root, selector, v){
    const input = /** @type {HTMLInputElement|HTMLSelectElement} */ (root.querySelector(selector));
    if(!input || document.activeElement === input) return;
    if(input.type === 'checkbox') /** @type {HTMLInputElement} */ (input).checked = !!v;
    else if(input instanceof HTMLSelectElement && typeof v === 'number') input.selectedIndex = v;
    else input.value = String(v);
  }

  /**
   * Tuning eines Notensystems als Text von tief nach hoch, z. B. "E A D G B E".
   * @param {import('../../types/alphatab').model.Staff} staff Notensystem
   * @returns {string}
   */
  tuningText(staff){
    return staff.tuning.slice().reverse().map(pitch => this.alphaTab.model.Tuning.getTextForTuning(pitch, false))
      .join(' ');
  }

  /**
   * Standard-Tuning für eine Saitenzahl.
   * @param {number} strings Saitenzahl
   * @returns {{midi: number[], names: string[]}} MIDI-Tonhöhen und Töne von tief nach hoch; ohne Standard für diese Saitenzahl
   *   das Standard-Tuning mit sechs Saiten
   */
  standardTuning(strings){
    const Tuning = this.alphaTab.model.Tuning;
    const midi = (Tuning.getDefaultTuningFor(strings) ?? Tuning.getDefaultTuningFor(6)).tunings.slice().reverse();
    return {midi, names: midi.map(p => Tuning.getTextForTuning(p, false))};
  }

  /**
   * Füllt die Leiste (Tonart, Shuffle, Anzeige von Capo und Tuning) mit den Werten des Songs (erster Takt, erste Spur mit
   * Saiten) und die Felder "Taktart" und "Tempo" im linken Panel mit den Werten am Cursor.
   * @returns {void}
   */
  fillSongFields(){
    const toolbar = this.part('edit-toolbar');
    const score = this.score;
    if(!toolbar || !score) return;
    const staff = score.tracks.flatMap(t => t.staves).find(st => st.isStringed) ?? score.tracks[0].staves[0];
    const bar = staff.bars[0];
    const minor = bar.keySignatureType === this.alphaTab.model.KeySignatureType.Minor;
    this.fillField(toolbar, '[data-song="key"]', keyName(bar.keySignature, minor));
    // Shuffle: Achtel-Triolen-Feeling im ganzen Song. Der Knopf zeigt den Zustand und schaltet um; bei einer anderen Art
    // (meldet renderNotices()) gilt er als aus.
    const shuffle = score.masterBars[0].tripletFeel === this.alphaTab.model.TripletFeel.Triplet8th;
    const shuffleButton = toolbar.querySelector('[data-cmd="tripletFeel"]');
    shuffleButton.innerHTML = svgIcon(shuffle ? 'feelShuffle' : 'feelStraight', 48);
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
  }

  /**
   * Füllt die Felder "Taktart" und "Tempo" im linken Panel mit den Werten am Takt des Cursors.
   * @returns {void}
   */
  fillBarSignature(){
    const panel = this.part('edit-left');
    const mb = this.score?.masterBars[this.pos.bar];
    if(!panel || !mb) return;
    this.fillField(panel, '[data-song="ts"]', `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`);
    this.fillField(panel, '[data-song="tempo"]', Math.round(edit.tempoAt(this.score, this.pos.bar)));
  }

  /**
   * Setzt den Cursor in ein Feld des linken Panels (A: Akkord, T: Text, Umschalt+Einfg: Abschnitt) und klappt das
   * Panel dafür aus.
   * @param {string} name Feld: Name in data-field oder ein Selektor
   * @returns {void}
   */
  focusField(name){
    const panel = this.part('edit-left');
    if(panel.classList.contains('collapsed')) this.togglePanel('left');
    const input = /** @type {HTMLInputElement} */ (panel.querySelector(name.startsWith('[') ? name
      : `[data-field="${name}"]`));
    input.focus();
    input.select?.();
  }

  /**
   * Übernimmt ein geändertes Feld: Schlag am Cursor (linkes Panel), Spur oder Spurwahl (Dialog "Spuren").
   * @param {HTMLInputElement} input Feld
   * @returns {void}
   */
  applyField(input){
    if(input.dataset.trackField){
      this.applyTrackField(input);
      return;
    }
    if(input.dataset.content){
      this.moveContentTo(/** @type {'chords'|'lyrics'} */ (input.dataset.content), Number(input.dataset.track));
      return;
    }
    if(input.dataset.ls){
      this.leadsheetTab.apply(input);
      return;
    }
    if(input.dataset.bar){
      this.applyBarField(input);
      return;
    }
    if(input.dataset.song){
      this.applySongField(input);
      return;
    }
    if(input.dataset.chordSelect !== undefined){
      this.change(beat => this.setChordName(this.chordBeat(beat), input.value));
      return;
    }
    const field = input.dataset.field;
    if(!field) return;
    const value = input.value.trim();
    this.change(beat => {
      if(field === 'text') beat.text = value || null;
    });
  }

  /**
   * Füllt die Auswahlliste "Akkord" im linken Panel mit den Akkorden des Songs (in der Reihenfolge ihres ersten
   * Auftretens, je Eintrag Name und Griff) und wählt den Akkord am Cursor. Der Knopf daneben ist "+" (neuer Akkord)
   * ohne Akkord am Schlag, sonst "✎" (Akkord und Griff ändern); beide öffnen openChordDialog().
   * @returns {void}
   */
  fillChordSelect(){
    const panel = this.part('edit-left');
    const select = /** @type {?HTMLSelectElement} */ (panel?.querySelector('[data-chord-select]'));
    const button = /** @type {?HTMLButtonElement} */ (panel?.querySelector('[data-chord-button]'));
    if(!select || !button || !this.score) return;
    const beat = edit.beatAt(this.score, this.pos);
    const chordBeat = beat ? this.chordBeat(beat) : null;
    const staff = chordBeat?.voice.bar.staff;
    const chord = chordBeat?.chordId ? staff.chords?.get(chordBeat.chordId) ?? null : null;
    const names = [...new Set(edit.mergeChords(this.score).map(m => m.chord.name))];
    if(chord && !names.includes(chord.name)) names.push(chord.name);
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
  fillSectionNames(){
    const list = this.part('edit-left')?.querySelector('#ebarSections');
    if(!list || !this.score) return;
    const names = new Set([...SECTION_NAMES, ...this.score.masterBars.map(mb => sectionName(mb.section)).filter(Boolean)]);
    list.innerHTML = [...names].map(n => `<option value="${escapeHtml(n)}">`).join('');
  }

  /**
   * Dialog zum Transponieren (Knopf in der Leiste oben): Halbtöne, Capo und Tuning mit Vorschau (transposedialog.js).
   * @returns {void}
   */
  openTransposeDialog(){
    void new TransposeDialog(this).open();
  }

  /**
   * Dialog "Verlauf": die aufgehobenen Stände der Noten samt den Angaben für das Leadsheet (jedes Speichern hebt den
   * vorigen auf, siehe keep_score_history() in api/lib/file_store.php), neueste zuerst, jeder mit Knöpfen zum Laden
   * und zum Löschen.
   * @param {import('./base.js').ScoreVersion[]} [known] schon geladene Liste (nach dem Löschen eines Stands)
   * @returns {Promise<void>}
   */
  async openHistoryDialog(known){
    let versions = known;
    if(!versions){
      try {
        versions = await loadScoreHistory(this.player.slug);
      } catch(err){
        this.toast(err.message);
        return;
      }
    }
    const rows = versions.map((v, i) => {
      const when = new Date(v.time.replace(' ', 'T')).toLocaleString('de-DE');
      return `<li><span>${escapeHtml(when)}</span><span class="history-size">${Math.round(v.size / 1024)} KB${i ? '' : ' (zuletzt ersetzt)'}</span>
        <button type="button" class="btn" data-version="${escapeHtml(v.id)}">Laden</button>
        <button type="button" class="ebtn" data-delete="${escapeHtml(v.id)}" title="Diesen Stand löschen"
          aria-label="Diesen Stand löschen">${svgIcon('trash')}</button></li>`;
    }).join('');
    openOverlay(`<h2>Verlauf</h2>
      <p class="history-hint">Jedes Speichern hebt den vorigen Stand der Noten und des Leadsheets auf.
        Geladen wird in den Editor, wie ein Schritt: Mit Rückgängig (Strg+Z) kommt der jetzige Stand zurück.
        Gespeichert wird erst mit Speichern, dann wandert auch der jetzige Stand in den Verlauf.</p>
      ${rows ? `<ul class="history-list">${rows}</ul>
        <label class="history-option"><input type="checkbox" id="historySheet" checked> Angaben für das Leadsheet mit laden</label>`
        : '<p class="empty">Es gibt noch keine früheren Stände.</p>'}`);
    for(const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.history-list [data-version]'))){
      button.addEventListener('click', () => {
        const withSheet = /** @type {HTMLInputElement} */ (document.getElementById('historySheet')).checked;
        closeOverlay();
        void this.loadVersion(button.dataset.version, withSheet);
      });
    }
    for(const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.history-list [data-delete]'))){
      button.addEventListener('click', async () => {
        if(!confirm('Diesen Stand endgültig löschen?')) return;
        try {
          await this.openHistoryDialog(await deleteScoreVersion(this.player.slug, button.dataset.delete));
        } catch(err){
          this.toast(`Nicht gelöscht: ${err.message}`);
        }
      });
    }
  }

  /**
   * Lädt einen aufgehobenen Stand in den Editor (ein Schritt für "Rückgängig", noch nicht gespeichert).
   * @param {string} id Kennung des Stands (siehe loadScoreHistory())
   * @param {boolean} withSheet ob die Angaben für das Leadsheet mitkommen (sonst bleiben die jetzigen)
   * @returns {Promise<void>}
   */
  async loadVersion(id, withSheet){
    try {
      const slug = this.player.slug;
      const tex = await loadScoreVersion(slug, id);
      const sheet = withSheet ? JSON.stringify(normalizeSheet(await loadLeadsheet(slug, id))) : null;
      // Vorab lesen: Ein Stand, der sich nicht einlesen lässt, darf den Editor nicht zerlegen.
      parseScore(this.alphaTab, tex, this.player.api.settings);
      if(tex === this.tex && (sheet === null || sheet === this.sheetJson())){
        this.toast('Dieser Stand ist der jetzige.');
        return;
      }
      this.commitTex(tex, sheet);
      this.toast('Stand geladen (noch nicht gespeichert; Strg+Z macht es rückgängig).');
    } catch(err){
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
  setChordName(beat, name){
    if(!name){
      beat.chordId = null;
      return;
    }
    const staff = beat.voice.bar.staff;
    let id = [...staff.chords ?? []].find(([, c]) => c.name === name)?.[0];
    if(id === undefined){
      const chord = new this.alphaTab.model.Chord();
      chord.name = name;
      id = name;
      staff.addChord(id, chord);
      // Ein Akkordname hat im Song einen Griff: Steht er schon in einer anderen Spur, gilt er auch hier.
      const known = this.songChordGrip(name, staff.tuning.length);
      if(known) this.setChordGrip(staff, name, known);
    }
    beat.chordId = id;
  }

  /**
   * Dialog für einen Akkord: Name und Griff zusammen. Namen, Vorschläge, Reihenfolge der Griffe und Warnung: docs/Akkorddialog.md.
   * "Übernehmen" setzt den Akkord an den Schlag am Cursor; hat der Name im Song schon einen Griff, gilt der neue für alle Stellen.
   * In den Katalog kommt er mit dem Speichern des Songs (der Katalog baut sich aus den Songs auf).
   * @param {boolean} current Akkord am Cursor ändern (sein Name und Griff stehen vorbelegt), sonst ein neuer
   * @returns {Promise<void>}
   */
  async openChordDialog(current){
    const library = await loadChordLibraryOrEmpty();
    const usage = await loadChordUsage().catch(() => ({}));
    const beat = edit.beatAt(this.score, this.pos);
    const chordBeat = this.chordBeat(beat);
    const staff = chordBeat.voice.bar.staff;
    const strings = staff.tuning.length;
    const existing = chordBeat.chordId ? staff.chords?.get(chordBeat.chordId) ?? null : null;
    if(current && !existing){
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
      if(!standard) return [];
      const key = chordKey(name);
      const counts = new Map(Object.entries(usage[key] ?? {}));
      for(const grip of library[key] ?? []) if(!counts.has(grip)) counts.set(grip, 0);
      const songGrip = this.songChordGrip(name, strings);
      if(songGrip && !counts.has(songGrip)){
        let beats = 0;
        for(const st of stringedStaves(this.score)) for(const bar of st.bars) for(const voice of bar.voices) for(const b of voice.beats){
          if(b.chordId && st.chords?.get(b.chordId)?.name === name) beats += 1;
        }
        counts.set(songGrip, beats);
      }
      const top = grip => Math.max(...parseGrip(grip));
      return [...counts].sort((a, b) => b[1] - a[1] || top(a[0]) - top(b[0]) || a[0].localeCompare(b[0])).map(([grip]) => grip);
    };
    /**
     * Griffe, die zum Namen passen, in der Reihenfolge von docs/Akkorddialog.md, Abschnitt 2: der Katalog (catalogGrips()), die
     * berechneten Griffe der Priorität 1 und 2, zum Auffüllen der ersten Reihe (GRIPS_PER_ROW) die der Priorität 3 und 4; höchstens
     * vier Reihen.
     * @returns {string[]}
     */
    const candidates = () => {
      const name = nameInput.value.trim();
      if(!name) return [];
      const found = findGrips(name, {tuning, all: true}).filter(g => valid(g.grip));
      const list = [...new Set([...catalogGrips(name).filter(valid), ...found.filter(g => g.priority <= 2).map(g => g.grip)])];
      for(const g of found){
        if(list.length >= GRIPS_PER_ROW) break;
        if(!list.includes(g.grip)) list.push(g.grip);
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
      byId('chordOk').disabled = !chord || !gripOk;
      // Die Töne des Akkords; ein Name, den die Regeln nicht kennen, geht nicht.
      const tones = byId('chordTones');
      tones.classList.toggle('hint-warn', !!name && !chord);
      tones.textContent = !name ? '' : chord ? `Töne: ${chordNoteNames(chord).join(' ')}` : 'Dieser Akkordname ist unbekannt.';
      // Passt der Griff nicht zum Namen: rote Warnung mit den Namen, die zum Griff passen.
      const mismatch = byId('chordMismatch');
      const problem = gripOk && chord ? gripToneProblem(chord, parseGrip(grip), tuning) : null;
      mismatch.hidden = !problem;
      if(problem){
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
      if(!pick) return;
      nameInput.value = pick.dataset.name;
      render();
    });
    gripInput.addEventListener('input', render);
    byId('chordGrips').addEventListener('click', e => {
      const pick = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-grip]'));
      if(!pick) return;
      gripInput.value = pick.dataset.grip;
      render();
    });
    byId('chordCancel').addEventListener('click', closeOverlay);
    byId('chordForm').addEventListener('submit', e => {
      e.preventDefault();
      if(byId('chordOk').disabled) return;
      const name = nameInput.value.trim();
      const grip = gripInput.value.trim();
      closeOverlay();
      this.applyChord(name, grip, current ? existing.name : '');
    });
    if(!current) nameInput.focus();
    render();
  }

  // ----------------------------------------------------------------------------------------------------
  // Panel "Liedtext"
  // ----------------------------------------------------------------------------------------------------
  /**
   * Füllt das Panel "Liedtext" mit dem Text der Spur mit dem Liedtext (außer während darin geschrieben wird).
   * @returns {void}
   */
  fillLyrics(){
    const panel = this.part('edit-right');
    const area = /** @type {?HTMLTextAreaElement} */ (panel?.querySelector('[data-lyrics]'));
    const track = this.lyricsTarget();
    if(!area || !track) return;
    // Die Vorschau gilt auch, während geschrieben wird (dann ruft applyLyrics() fillLyrics() nicht).
    this.renderLyricsView();
    if(document.activeElement === area || this.lyricsOverflow) return;
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
  showChordFileButton(){
    const panel = this.part('edit-right');
    const area = /** @type {HTMLTextAreaElement} */ (panel.querySelector('[data-lyrics]'));
    const empty = area.value.split('\n').every(line => !line.trim() || /^\s*\[[^\]]*]\s*$/.test(line));
    const tools = /** @type {HTMLElement} */ (panel.querySelector('[data-chord-tools]'));
    tools.hidden = !empty;
  }

  /**
   * Hinweis zum Liedtext-Feld (Mouseover): Spur und die Abschnitte, deren Text zu lang ist.
   * @param {import('../../types/alphatab').model.Track} track Spur mit dem Text
   * @param {{name: string, left: number}[]} overflow Abschnitte mit Silben ohne Schlag
   * @returns {string}
   */
  lyricsTitle(track, overflow){
    const left = overflow.map(o => `${o.name}: ${o.left} ${o.left === 1 ? 'Silbe' : 'Silben'} ohne Schlag (Text zu lang)`);
    return [`Spur: ${trackName(track)}`, ...left].join('\n');
  }

  /**
   * Zeigt unter dem Liedtext die Ansicht "Text & Akkorde" der bearbeiteten Noten, wie im Player. Nur bei
   * offenem Panel; beim Schreiben einmal je Übernahme (applyLyrics(), also schon verzögert).
   * @returns {void}
   */
  renderLyricsView(){
    const panel = this.part('edit-right');
    const view = /** @type {?HTMLElement} */ (panel?.querySelector('[data-lyrics-view]'));
    if(!view || !this.score || panel.classList.contains('collapsed')) return;
    const top = view.scrollTop;
    view.innerHTML = renderTextView(buildTextModel(this.score));
    view.scrollTop = top;
    const area = panel.querySelector('[data-lyrics]');
    // Es gilt der Cursor, der gerade bedient wird: im Feld oder in den Noten.
    const focused = document.activeElement === area;
    const beat = focused ? this.lyricsCaretBeat() : this.lyricsBeatAt(edit.beatAt(this.score, this.pos));
    if(beat) this.markLyricsView(beat);
    else if(focused) this.scrollLyricsView();
  }

  /**
   * Zeigt beim Abspielen die Silbe an der Abspielposition im Liedtext-Feld und in der Vorschau (nur bei offenem Panel).
   * @param {number} tick Abspielposition (Ticks)
   * @returns {void}
   */
  followPlayback(tick){
    const ticks = this.player.api.tickCache;
    const track = this.lyricsTarget();
    if(!this.score || !ticks || !track || this.part('edit-right').classList.contains('collapsed')) return;
    let found = null;
    search: for(const bar of track.staves[0].bars) for(const beat of bar.voices[0]?.beats ?? []){
      if(!beat.lyrics?.[0]?.trim()) continue;
      if(ticks.getBeatStart(beat) > tick) break search;
      found = beat;
    }
    if(!found || found === this.playedLyric) return;
    this.playedLyric = found;
    // Auch mit dem Cursor im Feld (nach einem Klick dorthin) läuft alles mit, nur nicht, solange man gerade schreibt:
    // Dann folgt allein die Vorschau.
    if(Date.now() - this.lyricsInputAt < LYRICS_TYPING_MS) this.markLyricsView(found);
    else this.showLyricsAt(found, true);
  }

  /**
   * Schlag mit Silbe in der Spur mit dem Text, der zu einem Schlag irgendeiner Spur gehört: die letzte Silbe, die
   * spätestens mit ihm beginnt (Zeit in der Reihenfolge der Noten).
   * @param {?Beat} beat Schlag
   * @returns {?Beat}
   */
  lyricsBeatAt(beat){
    const track = this.lyricsTarget();
    if(!beat || !track) return null;
    const time = b => b.voice.bar.masterBar.start + b.playbackStart;
    const t = time(beat);
    let found = null;
    for(const bar of track.staves[0].bars) for(const b of bar.voices[0]?.beats ?? []){
      if(time(b) > t) return found;
      if(b.lyrics?.[0]?.trim()) found = b;
    }
    return found;
  }

  /**
   * Zeichenbereich der Silbe eines Schlags im Liedtext-Feld, gezählt wie in setLyricsText() (je Abschnitt in seinen
   * Takten). Nur solange das Feld den Text der Noten zeigt.
   * @param {Beat} beat Schlag mit Silbe in der Spur mit dem Text
   * @returns {?{from: number, to: number}}
   */
  lyricsRangeOf(beat){
    const area = /** @type {HTMLTextAreaElement} */ (this.part('edit-right').querySelector('[data-lyrics]'));
    const track = this.lyricsTarget();
    if(!track || this.lyricsOverflow) return null;
    const time = b => b.voice.bar.masterBar.start + b.playbackStart;
    const text = area.value;
    const blocks = edit.splitLyricsBlocks(text);
    const starts = lyricsSectionStarts(this.score, track);
    const bySection = starts.length > 0 && blocks.length === starts.length + 1;
    const i = bySection ? starts.filter(s => s <= time(beat)).length : 0;
    const min = bySection && i ? starts[i - 1] : -Infinity;
    const max = bySection ? starts[i] ?? Infinity : Infinity;
    const sung = track.staves[0].bars.flatMap(bar => bar.voices[0]?.beats ?? [])
      .filter(b => b.lyrics?.[0]?.trim() && time(b) >= min && time(b) < max);
    const k = sung.indexOf(beat);
    const lines = text.split('\n');
    const from = bySection ? lines.slice(0, blocks[i].line).reduce((n, l) => n + l.length + 1, 0) : 0;
    const to = bySection && blocks[i + 1] ? lines.slice(0, blocks[i + 1].line).reduce((n, l) => n + l.length + 1, 0)
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
  showLyricsAt(beat, playing = false){
    const panel = this.part('edit-right');
    const area = /** @type {?HTMLTextAreaElement} */ (panel?.querySelector('[data-lyrics]'));
    if(!area || !this.score || panel.classList.contains('collapsed')) return;
    if(document.activeElement === area && !playing){
      this.drawLyricsMarks();
      return;
    }
    const lyricBeat = this.lyricsBeatAt(beat);
    this.lyricsCur = lyricBeat ? this.lyricsRangeOf(lyricBeat) : null;
    const cur = this.drawLyricsMarks(playing);
    if(cur){
      const top = cur.offsetTop;
      if(top < area.scrollTop || top > area.scrollTop + area.clientHeight - 24){
        area.scrollTop = Math.max(0, top - area.clientHeight / 3);
        const marks = /** @type {HTMLElement} */ (panel.querySelector('.elyrics-marks'));
        marks.scrollTop = area.scrollTop;
      }
    }
    if(lyricBeat) this.markLyricsView(lyricBeat);
  }

  /**
   * Schlag der Silbe, an der der Cursor im Liedtext-Feld steht: in einem Wort die Silbe, in der er steht, zwischen
   * zwei Wörtern die davor, auf einer Abschnittszeile die erste des Abschnitts. Gezählt wird wie in setLyricsText()
   * (je Abschnitt in seinen Takten); gilt, solange das Feld den Text der Noten zeigt (nicht bei zu langem Text).
   * @returns {?Beat}
   */
  lyricsCaretBeat(){
    const area = /** @type {?HTMLTextAreaElement} */ (this.part('edit-right')?.querySelector('[data-lyrics]'));
    const track = this.lyricsTarget();
    if(!area || !track || !this.score || this.lyricsOverflow) return null;
    const text = area.value;
    const caret = area.selectionStart;
    const lines = text.split('\n');
    const line = text.slice(0, caret).split('\n').length - 1;
    const blocks = edit.splitLyricsBlocks(text);
    const starts = lyricsSectionStarts(this.score, track);
    const bySection = starts.length > 0 && blocks.length === starts.length + 1;
    const i = bySection ? blocks.findLastIndex(b => b.line <= line) : 0;
    const from = bySection ? lines.slice(0, blocks[i].line).reduce((n, l) => n + l.length + 1, 0) : 0;
    // Bis zum Ende der Silbe am Cursor ("Str|uk-tur" zählt "Struk-" mit).
    const end = caret + (text.slice(caret).match(/^[^\s-]*-?/)?.[0].length ?? 0);
    const count = edit.splitSyllables(text.slice(from, end)).filter(s => s.trim()).length;
    const min = bySection && i ? starts[i - 1] : -Infinity;
    const max = bySection ? starts[i] ?? Infinity : Infinity;
    const time = b => b.voice.bar.masterBar.start + b.playbackStart;
    const sung = track.staves[0].bars.flatMap(bar => bar.voices[0]?.beats ?? [])
      .filter(b => b.lyrics?.[0]?.trim() && time(b) >= min && time(b) < max);
    return sung[Math.max(0, count - 1)] ?? null;
  }

  /**
   * Setzt den Cursor in den Noten auf die Silbe, an der der Cursor im Liedtext-Feld steht, rollt dorthin und hebt sie
   * in der Vorschau "Text & Akkorde" hervor. Ist die Spur mit dem Text nicht zu sehen, geht der Cursor in ihren Takt.
   * Läuft die Wiedergabe, springt sie zu dieser Silbe und spielt von dort weiter.
   * @returns {void}
   */
  followLyricsCaret(){
    const beat = this.lyricsCaretBeat();
    if(!beat){
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
    if(tick !== undefined){
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
  markLyricsView(beat){
    const view = /** @type {?HTMLElement} */ (this.part('edit-right')?.querySelector('[data-lyrics-view]'));
    if(!view) return;
    for(const el of view.querySelectorAll('.tv-now-syl')) el.classList.remove('tv-now-syl');
    const ticks = this.player.api.tickCache;
    const t = (ticks ? ticks.getBeatStart(beat) : 0) || beat.voice.bar.masterBar.start + beat.playbackStart;
    const parts = /** @type {HTMLElement[]} */ ([...view.querySelectorAll('[data-t]')]);
    const part = parts.find(p => Number(p.dataset.t) === t && !p.classList.contains('tv-empty'))
      ?? parts.filter(p => Number(p.dataset.t) <= t).at(-1);
    if(!part) return;
    part.classList.add('tv-now-syl');
    const offset = part.getBoundingClientRect().top - view.getBoundingClientRect().top;
    if(offset < 0 || offset > view.clientHeight - 30) view.scrollTop += offset - view.clientHeight / 3;
  }

  /**
   * Rollt die Vorschau "Text & Akkorde" zum Abschnitt, in dem der Cursor im Liedtext-Feld steht (zum ersten mit
   * demselben Namen), wenn er nicht schon zu sehen ist.
   * @returns {void}
   */
  scrollLyricsView(){
    const panel = this.part('edit-right');
    const area = /** @type {HTMLTextAreaElement} */ (panel.querySelector('[data-lyrics]'));
    const view = /** @type {HTMLElement} */ (panel.querySelector('[data-lyrics-view]'));
    const line = area.value.slice(0, area.selectionStart).split('\n').length - 1;
    const block = edit.splitLyricsBlocks(area.value).filter(b => b.line <= line).at(-1);
    const name = block?.text.match(/^\s*\[([^\]]*)]/)?.[1].trim();
    const heading = name ? [...view.querySelectorAll('.tv-section h3')].find(h => h.textContent.trim() === name) : null;
    const section = /** @type {?HTMLElement} */ (heading?.closest('.tv-section') ?? null);
    if(!section) return;
    const offset = section.getBoundingClientRect().top - view.getBoundingClientRect().top;
    if(offset < 0 || offset > view.clientHeight - 40) view.scrollTop += offset;
  }

  /**
   * Markiert Abschnitte des Liedtexts rot (Ebene hinter dem Feld mit demselben Text, nur die Hintergründe zu sehen).
   * @param {{line: number, lines: number}[]} blocks Abschnitte: erste Zeile und Zahl der Zeilen
   * @returns {void}
   */
  markLyrics(blocks){
    this.lyricsRed = blocks;
    this.drawLyricsMarks();
  }

  /**
   * Zeichnet die Ebene hinter dem Liedtext-Feld: rote Abschnitte (lyricsRed) und, solange das Feld nicht den Fokus
   * hat (beim Abspielen auch mit Fokus), die Silbe am Cursor der Noten bzw. an der Abspielposition (lyricsCur).
   * @param {boolean} [playing] beim Abspielen: die Silbe auch zeigen, wenn das Feld den Fokus hat
   * @returns {?HTMLElement} Markierung der Silbe am Cursor, null ohne
   */
  drawLyricsMarks(playing = false){
    const panel = this.part('edit-right');
    const area = /** @type {HTMLTextAreaElement} */ (panel.querySelector('[data-lyrics]'));
    const marks = /** @type {HTMLElement} */ (panel.querySelector('.elyrics-marks'));
    const red = new Set(this.lyricsRed.flatMap(b => Array.from({length: b.lines}, (_, i) => b.line + i)));
    const cur = document.activeElement === area && !playing ? null : this.lyricsCur;
    if(!red.size && !cur){
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
   * mehr da sind, nennt der Hinweis daneben.
   * @returns {void}
   */
  applyLyrics(){
    this.lyricsTimer = 0;
    const panel = this.part('edit-right');
    const area = /** @type {HTMLTextAreaElement} */ (panel?.querySelector('[data-lyrics]'));
    const track = this.lyricsTarget();
    if(!area || !track) return;
    const index = track.index;
    // Ist der Text noch zu lang, gilt der Stand davor auch nach Verlassen des Felds weiter.
    const base = this.lyricsTyping || this.lyricsOverflow ? this.lyricsBase : this.tex;
    const baseTrack = parseScore(this.alphaTab, base, this.player.api.settings).tracks[index];
    // Die Abschnitte so, wie das Feld sie zeigt (vor der Änderung, mit dem bisherigen Text).
    const starts = lyricsSectionStarts(baseTrack.score, baseTrack);
    const result = edit.setLyricsText(baseTrack, area.value, starts);
    const before = this.tex;
    this.change(() => edit.copyLyrics(baseTrack, this.score.tracks[index]), {merge: this.lyricsTyping});
    // Erst wenn sich etwas geändert hat, gibt es den Schritt, an den sich weiteres Schreiben anhängt.
    if(this.tex !== before && !this.lyricsTyping){
      this.lyricsTyping = true;
      this.lyricsBase = base;
    }
    this.lyricsOverflow = result.left > 0;
    const blocks = edit.splitLyricsBlocks(area.value);
    const red = result.lefts.length === blocks.length ? blocks.filter((b, i) => result.lefts[i] > 0) : [];
    this.markLyrics(red);
    area.title = this.lyricsTitle(this.score.tracks[index], red.length
      ? red.map(b => ({name: b.text.match(/^\s*\[([^\]]*)]/)?.[1] ?? 'Anfang', left: result.lefts[blocks.indexOf(b)]}))
      : result.left ? [{name: 'Text', left: result.left}] : []);
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
  hitTest(x, y){
    const lookup = this.player.api.boundsLookup;
    const systems = lookup?.staffSystems ?? [];
    if(!systems.length) return null;
    const distance = (b, v) => v < b.y ? b.y - v : v > b.y + b.h ? v - b.y - b.h : 0;
    const system = systems.reduce((best, sys) =>
      distance(sys.realBounds, y) < distance(best.realBounds, y) ? sys : best);
    const masterBar = system.bars.find(m => x < m.realBounds.x + m.realBounds.w) ?? system.bars.at(-1);
    if(!masterBar) return null;
    const entry = masterBar.bars.reduce((best, b) =>
      distance(b.visualBounds, y) < distance(best.visualBounds, y) ? b : best);
    const bar = entryBar(entry);
    if(!bar || bar.staff.index !== 0) return null;
    const staff = bar.staff;
    const beats = bar.voices[0]?.beats ?? [];
    let beat = 0;
    beats.forEach((b, i) => {
      const bounds = lookup.findBeat(b);
      if(bounds && bounds.visualBounds.x - CURSOR_PAD <= x) beat = i;
    });
    let string = this.pos.string;
    const entries = masterBar.bars.filter(b => entryBar(b) === bar);
    if(staff.showTablature && entry === entries.at(-1) && staff.tuning.length > 1){
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
  drawProblems(){
    const layer = this.cursorEl?.querySelector('.edit-problems');
    if(!layer) return;
    layer.innerHTML = '';
    const lookup = this.player.api.boundsLookup;
    if(!this.score || !lookup) return;
    for(const {bar, text} of edit.barLengthProblems(this.score)){
      const first = bar.voices[0]?.beats[0];
      const bounds = first ? lookup.findBeat(first) : null;
      const entries = bounds?.barBounds.masterBarBounds.bars.filter(b => entryBar(b) === bar);
      if(!entries?.length) continue;
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
  drawSelection(){
    const layer = this.cursorEl?.querySelector('.edit-selection');
    if(!layer) return;
    layer.innerHTML = '';
    const lookup = this.player.api.boundsLookup;
    // Ausgewählte Schläge: je eine Spalte wie beim Cursor.
    if(lookup) for(const beat of this.selectedBeats()){
      const bounds = lookup.findBeat(beat);
      const entries = bounds?.barBounds.masterBarBounds.bars.filter(b => entryBar(b) === beat.voice.bar);
      if(!bounds || !entries?.length) continue;
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
    if(!sel || !lookup || !staff) return;
    for(let i = sel.from; i <= sel.to; i++){
      const bar = staff.bars[i];
      const first = bar?.voices[0]?.beats[0];
      const bounds = first ? lookup.findBeat(first) : null;
      if(!bounds) continue;
      const entries = bounds.barBounds.masterBarBounds.bars.filter(b => entryBar(b) === bar);
      if(!entries.length) continue;
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
  scrollCursorIntoView(target){
    const rect = target.getBoundingClientRect();
    const top = this.songView.querySelector('.songbar').getBoundingClientRect().bottom + 20;
    const bottom = this.part('edit-bottom').getBoundingClientRect().top - 20;
    if(rect.top < top) window.scrollBy({top: rect.top - top});
    else if(rect.bottom > bottom) window.scrollBy({top: rect.bottom - bottom});
  }

  // ----------------------------------------------------------------------------------------------------
  // Felder der Panels
  // ----------------------------------------------------------------------------------------------------








  /**
   * Übernimmt ein Feld "Song": Tonart (ganzer Song), Capo und Tuning (die Bünde und Griffe bleiben) aus der Werkzeugleiste,
   * Taktart und Tempo aus dem linken Panel. Taktart und Tempo gelten ab dem Takt am Cursor bis zum nächsten Wechsel; ist das
   * Tempo dort gleich dem davor, gibt es keinen Wechsel.
   * @param {HTMLInputElement} input Feld (data-song)
   * @returns {void}
   */
  applySongField(input){
    const at = this.alphaTab;
    const value = input.value.trim();
    const bar = this.pos.bar;
    this.change(() => {
      switch(input.dataset.song){
        case 'key': {
          const k = KEY_NAMES.indexOf(value);
          edit.setKeySignature(at, this.score, 0, (k % 15) - 7, k >= 15, true);
          break;
        }
        case 'ts': {
          const ts = parseTimeSignature(value);
          if(ts) edit.setTimeSignature(this.score, bar, ts.num, ts.den);
          else this.toast('Taktart wie 4/4, 3/4 oder 6/8 angeben.');
          break;
        }
        case 'tempo': {
          const bpm = Number(value);
          if(!(bpm > 0)) break;
          const same = bar > 0 && Math.round(edit.tempoAt(this.score, bar - 1)) === Math.round(bpm);
          edit.setTempo(at, this.score, bar, same ? null : bpm);
          break;
        }
      }
    });
    this.fillSongFields();
  }

  /**
   * Übernimmt ein Feld "Takt" im linken Panel für den Takt am Cursor: Abschnitt (leer entfernt ihn), doppelter
   * Taktstrich.
   * @param {HTMLInputElement} input Feld (data-bar)
   * @returns {void}
   */
  applyBarField(input){
    const bar = this.pos.bar;
    if(input.dataset.bar === 'section') this.change(() => edit.setSection(this.alphaTab, this.score, bar, input.value.trim()));
  }




  /**
   * Wendet die Änderungen des Dialogs "Transponieren" an (applyRetune() in transposedialog.js): Halbtöne, Capo, Tuning und
   * Tonart, als ein Schritt für "Rückgängig". Gespeichert wird keine Verschiebung.
   * @param {import('./transposedialog.js').Retune} change Änderung
   * @returns {Promise<void>}
   */
  async retuneSong(change){
    const library = await loadChordLibraryOrEmpty();
    /** @type {?import('./notation.js').TransposeResult} */
    let result = null;
    this.change(() => { result = applyRetune(this.alphaTab, this.score, change, library); });
    if(!result) return;
    const parts = [];
    if(change.semitones) parts.push(`${result.notes} Noten um ${change.semitones > 0 ? '+' : '−'}${Math.abs(change.semitones)} Halbtöne verschoben`);
    if(change.capo !== null) parts.push(`Capo ${change.capo}`);
    if(result.octaves) parts.push(`${result.octaves} Noten um eine Oktave versetzt`);
    if(result.skipped) parts.push(`${result.skipped} Noten blieben unverändert`);
    this.toast(parts.length ? parts.join('; ') + '.' : 'Angewendet.');
  }

  /**
   * Übernimmt ein Feld einer Spur im Dialog "Spuren": Name und Instrument. (Das Tuning gilt für alle Spuren und
   * steht in der Werkzeugleiste, siehe applySongField().)
   * @param {HTMLInputElement} input Feld (data-track-field, data-track)
   * @returns {void}
   */
  applyTrackField(input){
    const track = this.score.tracks[Number(input.dataset.track)];
    const value = input.value.trim();
    const field = input.dataset.trackField;
    if(field === 'name'){
      // Namen sind frei (Auswahlliste mit den üblichen, siehe TRACK_NAMES), nur leer nicht.
      if(!value){
        this.toast('Die Spur braucht einen Namen.');
        this.renderSongPanels();
        return;
      }
      this.change(() => { track.name = track.shortName = value; });
    } else if(field === 'pitch'){
      this.change(() => edit.setNotationPitch(track, Number(value)));
    } else if(field === 'instrument'){
      const program = parseProgram(value);
      if(program === null){
        this.toast(`Kein Instrument „${value}“: eine Nummer von 0 bis 127 oder einen Namen eingeben.`);
        input.value = input.dataset.label;
        return;
      }
      input.value = input.dataset.label = instrumentLabel(program);
      if(program !== track.playbackInfo.program) this.change(() => edit.setTrackProgram(this.alphaTab, track, program));
    }
  }


  /**
   * Griff, den ein Akkordname im Song schon hat (aus irgendeiner Spur).
   * @param {string} name Akkordname
   * @param {number} strings Zahl der Saiten (nur Spuren mit gleich vielen zählen)
   * @returns {string} Griff von der tiefen Saite aus, "" wenn der Song noch keinen hat
   */
  songChordGrip(name, strings){
    for(const track of this.score.tracks) for(const staff of track.staves){
      if(staff.tuning.length !== strings) continue;
      const chord = [...staff.chords?.values() ?? []].find(c => c.name === name && c.strings.length === strings);
      if(chord) return gripOf(chord);
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
  setSongChordGrip(name, grip){
    for(const track of this.score.tracks) for(const staff of track.staves){
      this.setChordGrip(staff, name, grip);
    }
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
  applyChord(name, grip, oldName = ''){
    this.change(beat => {
      if(oldName && oldName !== name) this.renameSongChord(oldName, name);
      this.setChordName(this.chordBeat(beat), name);
      if(grip) this.setSongChordGrip(name, grip);
    });
  }

  /**
   * Benennt einen Akkord im ganzen Song um (in jeder Spur, in der er steht). Gibt es den neuen Namen in einer Spur
   * schon, gehen die Stellen auf ihn über und der alte Akkord fällt dort weg.
   * @param {string} oldName bisheriger Name
   * @param {string} name neuer Name
   * @returns {void}
   */
  renameSongChord(oldName, name){
    for(const track of this.score.tracks) for(const staff of track.staves){
      const chords = staff.chords;
      if(!chords) continue;
      const oldIds = [...chords].filter(([, c]) => c.name === oldName).map(([id]) => id);
      if(!oldIds.length) continue;
      const target = [...chords].find(([, c]) => c.name === name)?.[0];
      if(target === undefined){
        for(const id of oldIds) chords.get(id).name = name;
        continue;
      }
      for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats){
        if(oldIds.includes(beat.chordId)) beat.chordId = target;
      }
      for(const id of oldIds) chords.delete(id);
    }
  }
}
