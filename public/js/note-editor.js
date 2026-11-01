/**
 * Bearbeitungsmodus der Liedansicht (Noten, Tabs, Text, Akkorde) nach dem Vorbild von Guitar Pro.
 *
 * Bearbeitet werden frisch geladene Noten (score.atex), nicht das Modell des Players: Das ändert der Player für die
 * Anzeige (Akkorde, Text, Abschnitts- und Spurnamen). Der Editor zeichnet sie selbst in die Notenansicht, so wie sie
 * gespeichert werden. Nach jeder Änderung schreibt er sie als alphaTex und liest sie neu ein (score-edit.js); der
 * Text vorher ist der Schritt für "Rückgängig". Gespeichert wird mit derselben Prüfung wie beim Import
 * (writeScoreChecked()). Beim Verlassen zeigt der Player wieder seine Ansicht, nach dem Speichern neu geladen.
 *
 * Der Cursor steht auf einem Schlag und einer Saite (EditPosition). Die Saite ergibt sich aus der Lage der Tab-Zeile
 * (boundsLookup von alphaTab): Sie reicht genau von der obersten bis zur untersten Saite. Ohne Tabs (Ansicht
 * "Noten") gibt es nur die Spalte des Schlags.
 *
 * Aufbau (docs/Editor.md): Die Werkzeugleiste (Noten ein/aus, Speichern, Rückgängig, Dauer, Einfügen, Hilfe,
 * Fertig) ist im Modus die einzige feste Leiste. Links steht, was am Cursor hängt (Effekte, Schlag, Takt), rechts,
 * was am ganzen Song hängt (Tonart, Tempo, Capo …, Songdaten), unten, was sich über den Song erstreckt (Liedtext,
 * Akkorde, Spuren, Audio mit dem Sync-Editor) samt Statuszeile. Die Panels lassen sich einklappen; auf schmalen
 * Bildschirmen sind die seitlichen anfangs eingeklappt und legen sich ausgeklappt über die Noten. Abspielen geht
 * weiter. Mit der Maus lassen sich Noten an eine andere Stelle und Taktstriche in den Nachbartakt ziehen.
 */

import {escapeHtml, loadChordLibrary, loadScoreText, saveScore} from './api.js';
import {barreFret, detectKeySignature, diagramFirstFret, gripOf, normalizeChords, parseGrip} from './chords.js';
import {GLYPHS, glyph, svgIcon} from './icons.js';
import {
  keyName, parseScore, parseTuningText, recordingTempoFactor, scaleTempo, writeScore, writeScoreChecked,
} from './score.js';
import * as edit from './score-edit.js';
import {openShortcutHelp} from './shortcuts.js';
import {SyncEditor} from './sync-editor.js';
import {buildTextModel, lyricsLines, lyricsSectionStarts, renderTextView} from './textview.js';
import {moveChordsTo} from './editor.js';
import {
  chordsTrack, lyricsTrack, moveToCapo, trackLabel, trackRole, TRACK_ROLES, unifyCapo,
} from './tracks.js';

/** @typedef {import('./player.js').Player} Player */
/** @typedef {import('./api.js').Song} Song */
/** @typedef {import('./score-edit.js').EditPosition} EditPosition */
/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Beat} Beat */

/**
 * Zwischenablage für Takte (Strg+C/X/V), gilt für alle Songs, solange die Seite offen ist.
 * @type {?import('./score-edit.js').BarClipboard}
 */
let clipboard = null;

/** So viele Schritte hält "Rückgängig". */
const UNDO_MAX = 200;

/** Innerhalb dieser Zeit (ms) ergeben zwei Ziffern einen zweistelligen Bund ("1", "2" = 12). */
const DIGIT_MS = 1000;

/** Rand um den Cursor (px): Spalte des Schlags und Kästchen der Saite. */
const CURSOR_PAD = 5;

/** Abstand (px), in dem ein Klick einen Taktstrich trifft und ihn zieht. */
const BARLINE_PX = 5;

/** Ab dieser Strecke (px) ist ein Klick ein Ziehen (Note an eine andere Stelle). */
const DRAG_PX = 4;

/** Breite, ab der die seitlichen Panels neben den Noten stehen statt darüber (wie in app.css). */
const WIDE_LAYOUT = '(min-width: 900px)';

/**
 * Anzeige-Einstellungen eines Notensystems, die der Player für die Ansicht setzt (applyStave()) und die alphaTab
 * mitschreiben würde; gespeichert werden sie so, wie sie in der Datei stehen (NoteEditor.writeTex()).
 */
const STAFF_FLAGS = ['showStandardNotation', 'showTablature', 'showSlash', 'showNumbered'];

/** So lange (ms) nach dem letzten Tastendruck im Liedtext werden die Noten neu gezeichnet. */
const LYRICS_MS = 300;

/** So lange steht der Hinweis "Noch nicht umgesetzt" (ms). */
const TOAST_MS = 2200;

/** Speicherschlüssel für eingeklappte Panels (gilt für alle Songs). */
const PANELS_KEY = 'gitarrenbuch_editor_panels';

/** Kleinste Höhe des Inhalts im unteren Panel (unter den Reitern, px). */
const BOTTOM_MIN_H = 60;

/** Höhe des Inhalts im unteren Panel, solange sie nicht gezogen wurde (px). */
const BOTTOM_DEFAULT_H = 150;

/** Größte Höhe des Inhalts im unteren Panel als Anteil der Fensterhöhe. */
const BOTTOM_MAX_SHARE = 0.7;

/** Knöpfe für die Dauer: Notenwert (1 = Ganze, 4 = Viertel) → Zeichen der Notenschrift. */
const NOTE_GLYPHS = {
  1: GLYPHS.whole, 2: GLYPHS.half, 4: GLYPHS.quarter, 8: GLYPHS.eighth, 16: GLYPHS.sixteenth, 32: GLYPHS.thirtySecond,
};

/** Namen der Notenwerte für Tooltips. */
const NOTE_NAMES = {1: 'Ganze', 2: 'Halbe', 4: 'Viertel', 8: 'Achtel', 16: 'Sechzehntel', 32: 'Zweiunddreißigstel'};

/**
 * Effekte am Cursor (linkes Panel), in Gruppen: [Symbol (HTML), Name mit Tastenkürzel (siehe shortcuts.js), Befehl
 * (siehe NoteEditor.run())]. Was aus Guitar Pro nicht übernommen wird, steht in docs/Editor.md.
 * @type {[string, [string, string, string][]][]}
 */
const EFFECTS = [
  ['Note', [
    [svgIcon('hammer'), 'Hammer-on / Pull-off (H)', 'hammer'], [svgIcon('slide'), 'Slide (S)', 'slide'],
    [svgIcon('bend'), 'Bend (B)', 'bend'], [svgIcon('vibrato'), 'Vibrato (V)', 'vibrato'],
    [svgIcon('dead'), 'Saite dämpfen (X)', 'dead'],
  ]],
  ['Tonhöhe', [
    [glyph(GLYPHS.sharp, true), 'Kreuz (Strg+9)', 'sharp'], [glyph(GLYPHS.flat, true), 'Be (Strg+7)', 'flat'],
    [glyph(GLYPHS.natural, true), 'Auflösungszeichen (Strg+8)', 'natural'],
    [svgIcon('semitoneUp'), 'Halbton höher (Alt+Umschalt+↑)', 'semitoneUp'],
    [svgIcon('semitoneDown'), 'Halbton tiefer (Alt+Umschalt+↓)', 'semitoneDown'],
  ]],
  ['Anschlag', [
    [glyph(GLYPHS.pickDown, true), 'Abschlag (Umschalt+D)', 'pickDown'],
    [glyph(GLYPHS.pickUp, true), 'Aufschlag (Umschalt+U)', 'pickUp'],
    [svgIcon('brushDown'), 'Anschlagpfeil abwärts (Strg+D)', 'brushDown'],
    [svgIcon('brushUp'), 'Anschlagpfeil aufwärts (Strg+U)', 'brushUp'],
    [svgIcon('arpeggioDown'), 'Arpeggio abwärts (Strg+Umschalt+D)', 'arpeggioDown'],
    [svgIcon('arpeggioUp'), 'Arpeggio aufwärts (Strg+Umschalt+U)', 'arpeggioUp'],
  ]],
];

/**
 * Triolen-Feeling wie in Guitar Pro, in der Reihenfolge von alphaTab (TripletFeel): Wert → Name.
 * @type {string[]}
 */
const TRIPLET_FEELS = ['kein', 'Sechzehntel-Triolen', 'Achtel-Triolen (Shuffle)', 'punktierte Sechzehntel',
  'punktierte Achtel', 'Scottish Sechzehntel', 'Scottish Achtel'];

/**
 * Instrumente zur Auswahl je Spur: MIDI-Programm → Name.
 * @type {[number, string][]}
 */
const INSTRUMENTS = [[25, 'Akustikgitarre (Stahl)'], [24, 'Akustikgitarre (Nylon)'], [27, 'E-Gitarre (clean)'],
  [29, 'E-Gitarre (verzerrt)'], [33, 'E-Bass'], [53, 'Gesang (Voice Oohs)']];

/** Tasten, die Panels ein- und ausklappen (wie Guitar Pro: F2 Palette, F6 Inspektor): Taste → Seite. */
const PANEL_KEYS = {F2: 'left', F6: 'right', F8: 'bottom'};

/** Reiter des rechten Panels "Song": [Schlüssel, Name]. */
const SONG_TABS = [['notes', 'Noten'], ['songdata', 'Songdaten']];

/** Reiter des unteren Panels: [Schlüssel, Name]. */
const BOTTOM_TABS = [['lyrics', 'Liedtext'], ['chords', 'Akkorde'], ['tracks', 'Spuren'], ['audio', 'Audio']];

/** Wahl beim Ändern von Capo und Stimmung: [Name, Erklärung]. Der Klang bleibt (umgerechnet, siehe moveToCapo()) oder
 * die Griffe bleiben (Noten und Tonart ändern sich). */
const KEEP_OPTIONS = [
  ['Klang behalten', 'Tabulatur wird umgerechnet, Noten und Tonart bleiben'],
  ['Griffe behalten', 'Tabulatur bleibt, Noten und Tonart ändern sich'],
];

/**
 * Feld mit Beschriftung.
 * @param {string} label Beschriftung (HTML)
 * @param {string} control Eingabeelement (HTML)
 * @returns {string} HTML
 */
function field(label, control){
  return `<label class="efield"><span>${label}</span>${control}</label>`;
}

/**
 * Einzeiliges Textfeld.
 * @param {string} [placeholder] Platzhalter
 * @param {string} [attrs] weitere Attribute (z. B. data-song="tempo")
 * @returns {string} HTML
 */
function text(placeholder = '', attrs = ''){
  return `<input type="text" placeholder="${escapeHtml(placeholder)}" ${attrs}>`;
}

/**
 * Zahlenfeld.
 * @param {number} min kleinster Wert
 * @param {number} max größter Wert
 * @param {string} [attrs] weitere Attribute
 * @returns {string} HTML
 */
function num(min, max, attrs = ''){
  return `<input type="number" min="${min}" max="${max}" ${attrs}>`;
}

/**
 * Auswahlliste; der Wert eines Eintrags ist sein Text.
 * @param {string[]} options Einträge
 * @param {string} [attrs] weitere Attribute
 * @returns {string} HTML
 */
function select(options, attrs = ''){
  return `<select ${attrs}>${options.map(o => `<option>${escapeHtml(o)}</option>`).join('')}</select>`;
}

/** Alle Tonarten für die Auswahl: Dur von Cb bis C#, dann Moll von Abm bis A#m. */
const KEY_NAMES = [false, true].flatMap(minor => Array.from({length: 15}, (_, i) => keyName(i - 7, minor)));

/**
 * Radiobuttons untereinander, der erste gewählt.
 * @param {string} name Name der Gruppe
 * @param {string[][]} options [Name, Erklärung]
 * @param {string} [title] Überschrift davor
 * @returns {string} HTML
 */
function radios(name, options, title = ''){
  return `<div class="efield-radios">${title ? `<span>${escapeHtml(title)}</span>` : ''}${options.map(([label, hint], i) => `
    <label title="${escapeHtml(hint)}"><input type="radio" name="${name}"${i ? '' : ' checked'}> ${label}</label>`)
    .join('')}</div>`;
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
function todoButton(label, title, cls = '', cmd = ''){
  return `<button type="button" class="ebtn${cls ? ' ' + cls : ''}" data-todo="${escapeHtml(title)}"
    ${cmd ? `data-cmd="${cmd}" ` : ''}title="${escapeHtml(title)}">${label}</button>`;
}

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

/**
 * Eingeklappte Panels und Höhe des unteren Panels aus dem Browser.
 * @returns {{left?: boolean, right?: boolean, bottom?: boolean, bottomH?: number}} true = eingeklappt; bottomH: Höhe
 *   des Inhalts unten in px
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
   * @param {{onClose: function(boolean): void, onSongData: function(HTMLElement): void, onSaved: function(Song): void}}
   *   callbacks onClose: "Fertig" wurde gewählt, mit true, wenn in der Sitzung gespeichert wurde (der Aufrufer ruft
   *   destroy() und lädt dann den Song neu); onSongData: zeichnet das Formular "Songdaten" in das übergebene Element
   *   (rechtes Panel); onSaved: nach dem Speichern der Noten, mit dem aktualisierten Lied
   */
  constructor(songView, player, {onClose, onSongData, onSaved}){
    /** Liedansicht. */
    this.songView = songView;
    /** Player der Liedansicht. */
    this.player = player;
    /** Rückruf für "Fertig". */
    this.onClose = onClose;
    /** Zeichnet das Formular "Songdaten". */
    this.onSongData = onSongData;
    /** Rückruf nach dem Speichern. */
    this.onSaved = onSaved;
    /**
     * Sync-Editor im Reiter "Audio" (eingebettet), null, bis der Reiter zum ersten Mal gezeigt wird.
     * @type {?SyncEditor}
     */
    this.sync = null;
    /**
     * Ausgewählte Takte einer Spur (Umschalt+Pfeile, Strg+A), für Kopieren und Ausschneiden; null ohne Auswahl.
     * @type {?{track: number, anchor: number, from: number, to: number}}
     */
    this.selection = null;
    /**
     * Stelle, an der die Maus gedrückt wurde (Note an eine andere Stelle ziehen): Position und Zeiger (clientX/Y).
     * @type {?{pos: EditPosition, x: number, y: number}}
     */
    this.dragStart = null;
    /**
     * Gezogener Taktstrich (siehe barLineAt()), null sonst.
     * @type {?{track: number, bar: number, top: number, height: number}}
     */
    this.barDrag = null;
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
     * Schritte für "Rückgängig" und "Wiederholen": Text und Cursor vor bzw. nach der Änderung.
     * @type {{tex: string, pos: EditPosition, tracks: number[]}[]}
     */
    this.undoStack = [];
    /** @type {{tex: string, pos: EditPosition, tracks: number[]}[]} */
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
     * Ob der Liedtext Silben ohne Schlag hat: Dann bleibt der Text im Feld stehen (mit den roten Abschnitten), statt
     * aus den Noten neu gefüllt zu werden, bis er passt oder "Rückgängig" ihn zurücksetzt.
     */
    this.lyricsOverflow = false;
    /**
     * Anzeige-Einstellungen je Notensystem, wie sie in der Datei stehen (vor applyStave(), siehe writeTex()).
     * @type {WeakMap<object, boolean[]>}
     */
    this.fileFlags = new WeakMap();
  }

  /**
   * Ob es ungespeicherte Änderungen gibt.
   * @returns {boolean}
   */
  get dirty(){
    return !!this.score && this.tex !== this.savedTex;
  }

  /**
   * Schaltet in den Bearbeitungsmodus: Leisten und Panels einfügen. Die feste Leiste zeigt dann nur noch die
   * Werkzeugleiste (Zurück, Ansicht, aktueller Akkord, Stift und Menü sind ausgeblendet). Bearbeitet wird mit Tabs:
   * Aus "Noten" oder "Chords" geht es in "Noten + Tabs".
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
    this.addPart(this.songView, 'aside', 'edit-panel edit-right', this.songPanelHtml(), narrow || collapsed.right);
    const bottom = this.addPart(this.songView, 'section', 'edit-bottom', this.bottomHtml(), collapsed.bottom);
    this.setBottomHeight(collapsed.bottomH ?? BOTTOM_DEFAULT_H);
    bottom.querySelector('.edit-bottom-resize').addEventListener('pointerdown', e => this.startBottomResize(e));
    this.addPart(this.songView, 'div', 'edit-toast', '').setAttribute('role', 'status');
    this.onSongData(/** @type {HTMLElement} */ (this.part('edit-right').querySelector('.edit-songdata')));

    this.songView.classList.add('editing');
    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(songbar);
    this.resize.observe(this.part('edit-bottom'));
    this.measure();

    this.onClick = e => this.handleClick(/** @type {HTMLElement} */ (e.target));
    for(const part of this.parts) part.addEventListener('click', this.onClick);
    this.onKey = e => this.handleKey(e);
    document.addEventListener('keydown', this.onKey);
    this.onFieldChange = e => this.applyField(/** @type {HTMLInputElement} */ (e.target));
    this.part('edit-left').addEventListener('change', this.onFieldChange);
    this.part('edit-right').addEventListener('change', this.onFieldChange);
    this.part('edit-bottom').addEventListener('change', this.onFieldChange);
    // Liedtext: beim Schreiben (kurz nach dem letzten Tastendruck) in die Noten, ein Schritt für "Rückgängig" je
    // Bearbeitung des Felds.
    const lyrics = /** @type {HTMLTextAreaElement} */ (this.part('edit-bottom').querySelector('[data-lyrics]'));
    lyrics.addEventListener('input', () => {
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
      this.part('edit-bottom').querySelector('.elyrics-marks').scrollTop = lyrics.scrollTop;
    });
    // Noten und Vorschau folgen dem Cursor im Feld (Klick, Pfeil-, Bild-, Pos1- und Ende-Taste).
    lyrics.addEventListener('click', () => this.followLyricsCaret());
    lyrics.addEventListener('keyup', e => {
      if(/^(Arrow|Page|Home$|End$)/.test(e.key)) this.followLyricsCaret();
    });
    void this.load().catch(err => this.toast('Noten konnten nicht geladen werden: ' + err.message));
    this.showTab('edit-bottom', 'lyrics');
    this.showTab('edit-right', 'notes');
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
   * Werkzeugleiste: Noten ein/aus | Speichern, Rückgängig, Wiederholen | Dauer | Punktierung, Triole, Pause,
   * Haltebogen | Schlag und Takt einfügen und löschen | Hilfe, Fertig.
   * @returns {string} HTML
   */
  toolbarHtml(){
    const durations = Object.entries(NOTE_GLYPHS).map(([value, sign]) =>
      `<button type="button" class="ebtn ebtn-note" data-duration="${value}" aria-pressed="${value === '4'}"
        title="${NOTE_NAMES[value]} (+ kürzer, - länger)">${glyph(sign)}</button>`).join('');
    return `
      <div class="egroup">
        <button type="button" class="ebtn ebtn-note" data-action="notation" aria-pressed="false"
          title="Noten ein-/ausblenden (Tabs bleiben)">${glyph(GLYPHS.gClef, true)}</button>
      </div>
      <div class="egroup">
        ${todoButton(svgIcon('save'), 'Speichern (Strg+S)', '', 'save')}
        ${todoButton(svgIcon('undo'), 'Rückgängig (Strg+Z)', '', 'undo')}
        ${todoButton(svgIcon('redo'), 'Wiederholen (Strg+Y)', '', 'redo')}
      </div>
      <div class="egroup" role="group" aria-label="Dauer">${durations}</div>
      <div class="egroup">
        ${todoButton(glyph(GLYPHS.quarter + GLYPHS.dot), 'Punktiert (.)', 'ebtn-note', 'dot')}
        ${todoButton(glyph(GLYPHS.quarter + GLYPHS.dot + GLYPHS.dot), 'Doppelt punktiert (Strg+.)', 'ebtn-note', 'dot2')}
        ${todoButton('3', 'Triole (/)', '', 'triplet')}
        ${todoButton(glyph(GLYPHS.restQuarter), 'Pause (R)', 'ebtn-note', 'rest')}
        ${todoButton(glyph(GLYPHS.quarter + GLYPHS.tie + GLYPHS.quarter), 'Haltebogen (L)', 'ebtn-note ebtn-wide', 'tie')}
      </div>
      <div class="egroup">
        ${todoButton(svgIcon('insertBeat'), 'Schlag einfügen (Strg+Einfg)', '', 'insertBeat')}
        ${todoButton(svgIcon('deleteBeat'), 'Schlag löschen (Umschalt+Entf)', '', 'deleteBeat')}
        ${todoButton(svgIcon('insertBar'), 'Takt einfügen (Einfg)', '', 'insertBar')}
        ${todoButton(svgIcon('deleteBar'), 'Takt löschen (Strg+Entf)', '', 'deleteBar')}
      </div>
      <div class="egroup edit-end">
        <button type="button" class="ebtn ebtn-help" data-action="help" title="Tastenkürzel (?)"
          aria-label="Tastenkürzel">?</button>
        <button type="button" class="btn btn-primary" data-action="done" title="Bearbeiten beenden">Fertig</button>
      </div>
    `;
  }

  /**
   * Rechtes Panel "Song" mit zwei Reitern: "Noten" (was am ganzen Song hängt: Tonart, Taktart, Tempo,
   * Triolen-Feeling, Capo, Wiederholungen ausschreiben) und "Songdaten" (das Formular, zeichnet der Aufrufer, siehe
   * onSongData).
   * @returns {string} HTML
   */
  songPanelHtml(){
    return `
      ${this.panelHead('Song', 'right')}
      <div class="edit-panel-body">
        ${this.tabsHtml(SONG_TABS)}
        <div class="etab" data-tab="notes">
        ${field('Tonart', select(KEY_NAMES, 'data-song="key"'))}
        <div class="efield-hint">Erkannt aus Akkorden und Tönen: <strong data-song-hint="key">–</strong></div>
        <div class="ebtn-row">${todoButton('Erkannte übernehmen', 'Erkannte Tonart übernehmen', 'ebtn-text',
          'detectKey')}</div>
        ${field('Taktart', `<span class="efield-row">${num(1, 32, 'data-song="tsNum"')} /
          ${num(1, 32, 'data-song="tsDen"')}</span>`)}
        ${field('Tempo', `<span class="efield-row">${num(20, 300, 'data-song="tempo"')} BPM</span>`)}
        <div class="ebtn-row">${todoButton('Tempo aus der Audiospur ermitteln',
          'Tempo aus den Sync-Punkten der Audiospur ermitteln', 'ebtn-text', 'tempoFromAudio')}</div>
        ${field('Triolen-Feeling (Strg+/)', select(TRIPLET_FEELS, 'data-song="feel"'))}
        ${field('Capo (alle Spuren)', num(0, 12, 'data-song="capo"'))}
        <div class="ecapo-tracks" data-capo-tracks hidden></div>
        ${radios('capoKeep', KEEP_OPTIONS)}
        <div class="ebtn-row">
          ${todoButton('Wiederholungen ausschreiben', 'Wiederholungen, Volta-Klammern und Sprünge ausschreiben',
            'ebtn-text', 'unroll')}
        </div>
        </div>
        <div class="etab edit-songdata" data-tab="songdata"></div>
      </div>`;
  }

  /**
   * Linkes Panel "Am Cursor" (wie die Palette in Guitar Pro links): Effekte der Note bzw. des Schlags, Felder des
   * Schlags und des Takts.
   * @returns {string} HTML
   */
  cursorPanelHtml(){
    return `
      ${this.panelHead('Am Cursor', 'left')}
      <div class="edit-panel-body">
        ${EFFECTS.map(([group, items]) => `
          <h4>${escapeHtml(group)}</h4>
          <div class="effect-grid">${items.map(([label, title, cmd]) => todoButton(label, title, '', cmd)).join('')}</div>
        `).join('')}
        <h4>Schlag</h4>
        ${field('Akkord (A)', '<input type="text" data-field="chord" placeholder="z. B. Am">')}
        ${field('Griff (tiefe Saite zuerst)', '<input type="text" data-field="grip" placeholder="z. B. x02210">')}
        ${field('Text über dem Schlag (T)', '<input type="text" data-field="text" placeholder="z. B. Picking Pattern">')}
        <h4>Takt</h4>
        ${field('Abschnitt (Umschalt+Einfg)', text('z. B. Verse', 'data-bar="section"'))}
        ${field('Taktart', `<span class="efield-row">${num(1, 32, 'data-bar="tsNum"')} /
          ${num(1, 32, 'data-bar="tsDen"')}</span>`)}
        ${field('Tonartwechsel ab diesem Takt', select(['–', ...KEY_NAMES], 'data-bar="key"'))}
        ${field('Tempowechsel ab diesem Takt', `<span class="efield-row">${num(20, 300, 'data-bar="tempo"')}
          BPM</span>`)}
        ${field('Triolen-Feeling', select(TRIPLET_FEELS, 'data-bar="feel"'))}
        <label class="efield-check" title="Doppelter Taktstrich am Ende des Takts, z. B. am Ende eines Abschnitts">
          <input type="checkbox" data-bar="double"> Doppelter Taktstrich (Abschnittsende)</label>
      </div>`;
  }

  /**
   * Unteres Panel: Reiter (Liedtext, Akkorde, Spuren, Audio) mit Statuszeile. Akkorde und Spuren füllt
   * renderSongTabs() aus den bearbeiteten Noten.
   * @returns {string} HTML
   */
  bottomHtml(){
    return `
      <div class="edit-bottom-resize" title="Höhe ändern (ziehen)" aria-hidden="true"></div>
      <div class="edit-bottom-head">
        ${this.tabsHtml(BOTTOM_TABS)}
        <div class="edit-status">Noten werden geladen …</div>
        <button type="button" class="ebtn ebtn-collapse" data-collapse="bottom" title="Ein-/Ausklappen (F8)"
          aria-label="Unteres Panel ein- oder ausklappen"></button>
      </div>
      <div class="edit-bottom-body">
        <div class="etab etab-lyrics" data-tab="lyrics">
          <div class="elyrics-wrap">
            <div class="elyrics-marks" aria-hidden="true"></div>
            <textarea rows="4" data-lyrics spellcheck="false"
              placeholder="Liedtext. Silben mit Bindestrich trennen (Lie-der-buch).
Jedes Leerzeichen und jeder Bindestrich geht zum nächsten Schlag, ein einzelnes _ lässt einen Schlag aus,
mir_zu setzt zwei Wörter auf einen Schlag. [Verse] usw. sind die Abschnitte."></textarea>
          </div>
          <div class="elyrics-view" data-lyrics-view aria-label="Vorschau Text &amp; Akkorde"></div>
        </div>
        <div class="etab" data-tab="chords"><div class="echord-list"></div></div>
        <div class="etab" data-tab="tracks"><div class="etrack-list"></div></div>
        <div class="etab etab-audio" data-tab="audio"><p class="efield-hint">Audiospur wird geladen …</p></div>
      </div>`;
  }

  /**
   * Füllt den Reiter "Liedtext" mit dem Text der Spur mit dem Liedtext (außer während darin geschrieben wird).
   * @returns {void}
   */
  fillLyrics(){
    const bottom = this.part('edit-bottom');
    const area = /** @type {?HTMLTextAreaElement} */ (bottom?.querySelector('[data-lyrics]'));
    const track = this.lyricsTarget();
    if(!area || !track) return;
    // Die Vorschau gilt auch, während geschrieben wird (dann ruft applyLyrics() fillLyrics() nicht).
    this.renderLyricsView();
    if(document.activeElement === area || this.lyricsOverflow) return;
    area.value = lyricsLines(this.score, track);
    area.title = this.lyricsTitle(track, []);
    this.lyricsRed = [];
    this.showLyricsAt(edit.beatAt(this.score, this.pos));
  }

  /**
   * Hinweis zum Liedtext-Feld (Mouseover): Spur und die Abschnitte, deren Text zu lang ist.
   * @param {import('../../types/alphatab').model.Track} track Spur mit dem Text
   * @param {{name: string, left: number}[]} overflow Abschnitte mit Silben ohne Schlag
   * @returns {string}
   */
  lyricsTitle(track, overflow){
    const left = overflow.map(o => `${o.name}: ${o.left} ${o.left === 1 ? 'Silbe' : 'Silben'} ohne Schlag (Text zu lang)`);
    return [`Spur: ${trackLabel(track.name)}`, ...left].join('\n');
  }

  /**
   * Zeigt rechts neben dem Liedtext die Ansicht "Text & Akkorde" der bearbeiteten Noten, wie im Player. Nur bei
   * sichtbarem Reiter; beim Schreiben einmal je Übernahme (applyLyrics(), also schon verzögert).
   * @returns {void}
   */
  renderLyricsView(){
    const bottom = this.part('edit-bottom');
    const view = /** @type {?HTMLElement} */ (bottom?.querySelector('[data-lyrics-view]'));
    if(!view || !this.score || bottom.classList.contains('collapsed') || view.closest('.etab').hidden) return;
    const top = view.scrollTop;
    view.innerHTML = renderTextView(buildTextModel(this.score));
    view.scrollTop = top;
    const area = bottom.querySelector('[data-lyrics]');
    // Es gilt der Cursor, der gerade bedient wird: im Feld oder in den Noten.
    const focused = document.activeElement === area;
    const beat = focused ? this.lyricsCaretBeat() : this.lyricsBeatAt(edit.beatAt(this.score, this.pos));
    if(beat) this.markLyricsView(beat);
    else if(focused) this.scrollLyricsView();
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
    const area = /** @type {HTMLTextAreaElement} */ (this.part('edit-bottom').querySelector('[data-lyrics]'));
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
   * und nur bei sichtbarem Reiter.
   * @param {?Beat} beat Schlag am Cursor (irgendeine Spur)
   * @returns {void}
   */
  showLyricsAt(beat){
    const bottom = this.part('edit-bottom');
    const area = /** @type {?HTMLTextAreaElement} */ (bottom?.querySelector('[data-lyrics]'));
    if(!area || !this.score || bottom.classList.contains('collapsed') || area.closest('.etab').hidden) return;
    if(document.activeElement === area){
      this.drawLyricsMarks();
      return;
    }
    const lyricBeat = this.lyricsBeatAt(beat);
    this.lyricsCur = lyricBeat ? this.lyricsRangeOf(lyricBeat) : null;
    const cur = this.drawLyricsMarks();
    if(cur){
      const top = cur.offsetTop;
      if(top < area.scrollTop || top > area.scrollTop + area.clientHeight - 24){
        area.scrollTop = Math.max(0, top - area.clientHeight / 3);
        /** @type {HTMLElement} */ (bottom.querySelector('.elyrics-marks')).scrollTop = area.scrollTop;
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
    const area = /** @type {?HTMLTextAreaElement} */ (this.part('edit-bottom')?.querySelector('[data-lyrics]'));
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
      ? {...this.pos, track, bar, beat: beat.index} : {...this.pos, bar, beat: 0});
    this.updateState();
    this.drawCursor(true);
    this.markLyricsView(beat);
  }

  /**
   * Hebt in der Vorschau "Text & Akkorde" die Silbe eines Schlags hervor (wie der Player beim Abspielen) und rollt sie
   * ins Bild. Die Zeit kommt aus dem MIDI von alphaTab (erstes Vorkommen in Abspielreihenfolge), solange es noch
   * fehlt aus den Noten.
   * @param {Beat} beat Schlag mit Silbe
   * @returns {void}
   */
  markLyricsView(beat){
    const view = /** @type {?HTMLElement} */ (this.part('edit-bottom')?.querySelector('[data-lyrics-view]'));
    if(!view) return;
    for(const el of view.querySelectorAll('.tv-now-syl')) el.classList.remove('tv-now-syl');
    const t = this.player.api.tickCache?.getBeatStart(beat) || beat.voice.bar.masterBar.start + beat.playbackStart;
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
    const bottom = this.part('edit-bottom');
    const area = /** @type {HTMLTextAreaElement} */ (bottom.querySelector('[data-lyrics]'));
    const view = /** @type {HTMLElement} */ (bottom.querySelector('[data-lyrics-view]'));
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
   * hat, die Silbe am Cursor der Noten (lyricsCur).
   * @returns {?HTMLElement} Markierung der Silbe am Cursor, null ohne
   */
  drawLyricsMarks(){
    const bottom = this.part('edit-bottom');
    const area = /** @type {HTMLTextAreaElement} */ (bottom.querySelector('[data-lyrics]'));
    const marks = /** @type {HTMLElement} */ (bottom.querySelector('.elyrics-marks'));
    const red = new Set(this.lyricsRed.flatMap(b => Array.from({length: b.lines}, (_, i) => b.line + i)));
    const cur = document.activeElement === area ? null : this.lyricsCur;
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
   * Füllt die Reiter "Akkorde" und "Spuren" aus den bearbeiteten Noten (nach jeder Änderung). Ein Feld, in dem
   * gerade geschrieben wird, bleibt stehen.
   * @returns {void}
   */
  renderSongTabs(){
    this.fillLyrics();
    const bottom = this.part('edit-bottom');
    if(!this.score || !bottom || bottom.contains(document.activeElement) && document.activeElement !== document.body
      && document.activeElement.matches('input, select, textarea')) return;
    /** @type {Set<string>} */
    const chords = new Set();
    for(const track of this.score.tracks) for(const staff of track.staves){
      for(const chord of staff.chords?.values() ?? []) chords.add(chord.name);
    }
    bottom.querySelector('.echord-list').innerHTML = [...chords].map(name =>
      `<button type="button" class="ebtn ebtn-text" data-chord="${escapeHtml(name)}"
        title="Akkord ${escapeHtml(name)} an den Schlag am Cursor setzen">${escapeHtml(name)}</button>`).join('')
      + `<span class="echord-new"><input type="text" data-new-chord="name" placeholder="Name" aria-label="Akkordname">
        <input type="text" data-new-chord="grip" placeholder="Griff, z. B. x02210" aria-label="Griff">
        ${todoButton('+ Akkord', 'Akkord anlegen und an den Schlag am Cursor setzen', 'ebtn-text', 'newChord')}</span>`;

    const shown = new Set(this.trackIndexes);
    const roles = role => `<option value="">– keine Rolle –</option>` + Object.entries(TRACK_ROLES).map(([key, label]) =>
      `<option value="${key}"${key === role ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
    const instruments = program => {
      const known = INSTRUMENTS.some(([p]) => p === program);
      return (known ? '' : `<option selected>Programm ${program}</option>`) + INSTRUMENTS.map(([p, label]) =>
        `<option value="${p}"${p === program ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
    };
    const tuning = staff => staff.tuning.slice().reverse()
      .map(pitch => this.alphaTab.model.Tuning.getTextForTuning(pitch, false)).join(' ');
    bottom.querySelector('.etrack-list').innerHTML = `
      <div class="etrack etrack-head"><span>Zeigen</span><span>Name</span><span>Rolle</span><span>Stimmung</span>
        <span>Instrument</span><span></span></div>
      ${this.score.tracks.map(track => {
        const staff = track.staves[0];
        const role = trackRole(track) ?? '';
        return `
          <div class="etrack">
            <input type="checkbox" data-show-track="${track.index}"${shown.has(track.index) ? ' checked' : ''}
              aria-label="Spur ${track.index + 1} zeigen">
            <input type="text" data-track-field="name" data-track="${track.index}"
              value="${escapeHtml(role ? TRACK_ROLES[role] : track.name)}"${role ? ' disabled' : ''}
              aria-label="Name der Spur ${track.index + 1}">
            <select data-track-field="role" data-track="${track.index}" aria-label="Rolle">${roles(role)}</select>
            <input type="text" data-track-field="tuning" data-track="${track.index}" value="${escapeHtml(tuning(staff))}"
              aria-label="Stimmung"${staff.tuning.length ? '' : ' disabled'}>
            <select data-track-field="instrument" data-track="${track.index}" aria-label="Instrument">
              ${instruments(track.playbackInfo.program)}</select>
            <span class="etrack-buttons">
              <button type="button" class="ebtn" data-cmd="trackUp" data-track="${track.index}"
                title="Spur nach oben">↑</button>
              <button type="button" class="ebtn" data-cmd="trackDown" data-track="${track.index}"
                title="Spur nach unten">↓</button>
              <button type="button" class="ebtn ebtn-danger" data-cmd="trackDelete" data-track="${track.index}"
                title="Spur löschen">×</button></span>
          </div>`;
      }).join('')}
      <div class="etrack-foot">
        ${radios('tuningKeep', KEEP_OPTIONS, 'Beim Ändern der Stimmung:')}
        ${todoButton('+ Spur', 'Gitarrenspur hinzufügen (Standardstimmung)', 'ebtn-text', 'addTrack')}
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
   * Reiterleiste.
   * @param {string[][]} tabs [Schlüssel, Name]
   * @returns {string} HTML
   */
  tabsHtml(tabs){
    return `<div class="etabs" role="tablist">${tabs.map(([key, label]) =>
      `<button type="button" role="tab" data-show-tab="${key}">${escapeHtml(label)}</button>`).join('')}</div>`;
  }

  /**
   * Zeigt einen Reiter eines Panels.
   * @param {string} cls Klasse des Panels
   * @param {string} key Reiter
   * @returns {void}
   */
  showTab(cls, key){
    const panel = this.part(cls);
    for(const b of panel.querySelectorAll('[data-show-tab]')){
      b.setAttribute('aria-selected', String(/** @type {HTMLElement} */ (b).dataset.showTab === key));
    }
    for(const tab of panel.querySelectorAll('.etab')) /** @type {HTMLElement} */ (tab).hidden = tab.dataset.tab !== key;
  }

  /**
   * Reagiert auf Klicks in Leiste und Panels.
   * @param {HTMLElement} target angeklicktes Element
   * @returns {void}
   */
  handleClick(target){
    const el = /** @type {?HTMLElement} */ (target.closest('[data-action], [data-collapse], [data-show-tab], '
      + '[data-duration], [data-cmd], [data-chord], [data-todo]'));
    if(!el) return;
    if(el.dataset.cmd){
      this.run(el.dataset.cmd, el);
    } else if(el.dataset.chord){
      this.change(beat => this.setChordName(beat, el.dataset.chord));
    } else if(el.dataset.action === 'done'){
      this.finish();
    } else if(el.dataset.action === 'help'){
      openShortcutHelp();
    } else if(el.dataset.action === 'notation'){
      this.player.setView(this.player.prefs.view === 'both' ? 'tab' : 'both');
      this.updateState();
    } else if(el.dataset.collapse){
      this.togglePanel(el.dataset.collapse);
    } else if(el.dataset.showTab){
      this.showTab(el.closest('.edit-bottom') ? 'edit-bottom' : 'edit-right', el.dataset.showTab);
      if(el.dataset.showTab === 'audio') void this.openSync();
      if(el.dataset.showTab === 'lyrics') this.renderLyricsView();
    } else if(el.dataset.duration){
      this.change(beat => edit.setDuration(beat, Number(el.dataset.duration)));
    } else if(el.dataset.todo){
      this.toast(`Noch nicht umgesetzt: ${el.dataset.todo}`);
    }
  }

  /**
   * Tastenkürzel wie in Guitar Pro 8 (Liste in shortcuts.js). Nicht beim Schreiben in einem Eingabefeld und nicht,
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
      if(key === 'Insert') return 'insertBeat';
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
    if(alt) return null;
    switch(key){
      case 'ArrowLeft': return shift ? 'selectLeft' : () => this.moveTo(edit.stepBeat(this.score, this.pos, -1));
      case 'ArrowRight': return shift ? 'selectRight' : () => this.moveTo(edit.stepBeat(this.score, this.pos, 1));
      case 'ArrowUp': return shift ? null : () => this.moveTo({string: this.pos.string + 1});
      case 'ArrowDown': return shift ? null : () => this.moveTo({string: this.pos.string - 1});
      case 'Escape': return this.selection ? () => this.setSelection(null) : null;
      case 'Home': return () => this.moveTo({beat: 0});
      case 'End': return 'lastBar';
      case 'Backspace': return 'deleteNote';
      case 'Insert': return shift ? 'section' : 'insertBar';
      case 'Delete': return shift ? 'deleteBeat' : null;
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
      case 'a': return shift ? null : () => this.focusField('chord');
      case 't': return shift ? null : () => this.focusField('text');
      default: return null;
    }
  }

  /**
   * Klappt ein Panel ein bzw. aus (F2, F6, F8 oder der Pfeil am Panel).
   * @param {string} side "left", "right" oder "bottom"
   * @returns {void}
   */
  togglePanel(side){
    this.part(side === 'bottom' ? 'edit-bottom' : `edit-${side}`).classList.toggle('collapsed');
    this.saveCollapsed();
    this.measure();
    this.relayout();
    if(side === 'bottom') this.renderLyricsView();
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
      shorter: () => this.change(beat => edit.stepDuration(beat, 1)),
      longer: () => this.change(beat => edit.stepDuration(beat, -1)),
      dot: () => this.change(beat => edit.toggleDots(beat, 1)),
      dot2: () => this.change(beat => edit.toggleDots(beat, 2)),
      triplet: () => this.change(beat => edit.toggleTriplet(beat)),
      rest: () => this.change(beat => edit.makeRest(beat)),
      deleteNote: () => this.change(beat => edit.deleteNote(beat, string)),
      tie: () => this.change(beat => edit.toggleTie(at, beat, this.previousBeat(), string)
        || this.toast('Haltebogen: Auf dieser Saite klingt davor keine Note.')),
      semitoneUp: () => this.change(beat => edit.shiftSemitone(beat, string, 1)),
      semitoneDown: () => this.change(beat => edit.shiftSemitone(beat, string, -1)),
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
      insertBeat: () => this.change(beat => edit.insertBeat(at, beat)),
      deleteBeat: () => this.change(beat => edit.deleteBeat(beat)),
      insertBar: () => this.change(() => edit.insertBar(at, this.score, this.pos.bar), {pos: {beat: 0}}),
      deleteBar: () => this.change(() => edit.deleteBar(this.score, this.pos.bar), {pos: {beat: 0}}),
      lastBar: () => this.moveTo({bar: this.score.masterBars.length - 1, beat: 0}),
      bend: () => this.change(beat => edit.toggleBend(at, note(beat))),
      stringUp: () => this.moveNoteString(string, string + 1),
      stringDown: () => this.moveNoteString(string, string - 1),
      selectLeft: () => this.extendSelection(-1),
      selectRight: () => this.extendSelection(1),
      selectAll: () => this.setSelection({track: this.pos.track, anchor: 0, from: 0,
        to: this.score.masterBars.length - 1}),
      copy: () => this.copyBars(false),
      cut: () => this.copyBars(true),
      paste: () => this.pasteBars(),
      section: () => this.focusField('[data-bar="section"]'),
      tripletFeel: () => {
        const on = this.score.masterBars[0].tripletFeel === at.model.TripletFeel.NoTripletFeel;
        this.change(() => edit.setTripletFeel(this.score, 0,
          on ? at.model.TripletFeel.Triplet8th : at.model.TripletFeel.NoTripletFeel, true));
        this.toast(on ? 'Triolen-Feeling: Achtel (Shuffle)' : 'Triolen-Feeling: kein');
      },
      keySignature: () => {
        if(this.part('edit-right').classList.contains('collapsed')) this.togglePanel('right');
        this.showTab('edit-right', 'notes');
        /** @type {HTMLElement} */ (this.part('edit-right').querySelector('[data-song="key"]')).focus();
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
      tempoFromAudio: () => {
        const factor = recordingTempoFactor(at, this.score);
        if(!factor){
          this.toast('Dafür braucht es Sync-Punkte (Sync-Editor).');
          return;
        }
        this.change(() => scaleTempo(this.score, factor));
        this.toast(`Tempo: ${Math.round(this.score.tempo)} BPM (aus der Audiospur)`);
      },
      unroll: () => this.unrollRepeats(),
      unifyCapo: () => {
        let result = {capo: 0, moved: [], octaves: 0};
        this.change(() => { result = unifyCapo(this.score); });
        this.toast(`Capo ${result.capo} für alle Spuren`
          + (result.octaves ? `; ${result.octaves} Noten passten nur eine Oktave höher.` : ''));
      },
      mergeChords: () => {
        const target = chordsTrack(this.score);
        if(!target) return;
        let result = {moved: 0, kept: 0};
        this.change(() => { result = moveChordsTo(at, this.score, this.score.tracks[target.index]); });
        const kept = result.kept ? `, ${result.kept} ${result.kept === 1 ? 'bleibt' : 'bleiben'} (dort kein Schlag)` : '';
        this.toast(result.moved ? `${result.moved} Akkorde übertragen${kept}`
          : `Die Akkorde standen schon in „${trackLabel(target.name)}“, doppelte sind entfernt${kept}`);
      },
      tracksTab: () => {
        if(this.part('edit-bottom').classList.contains('collapsed')) this.togglePanel('bottom');
        this.showTab('edit-bottom', 'tracks');
      },
      newChord: () => this.newChord(),
      trackUp: () => this.changeTracks(score => edit.moveTrack(score, Number(el.dataset.track), -1),
        Number(el.dataset.track), -1),
      trackDown: () => this.changeTracks(score => edit.moveTrack(score, Number(el.dataset.track), 1),
        Number(el.dataset.track), 1),
      trackDelete: () => {
        const track = this.score.tracks[Number(el.dataset.track)];
        if(!confirm(`Spur "${trackLabel(track.name)}" löschen?`)) return;
        this.changeTracks(score => edit.deleteTrack(score, track.index), track.index, 0);
      },
      addTrack: () => this.changeTracks(score => edit.addTrack(at, score, `Gitarre ${score.tracks.length + 1}`),
        this.score.tracks.length, 0),
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
   * Setzt die Auswahl (Takte einer Spur) und zeichnet sie.
   * @param {?{track: number, anchor: number, from: number, to: number}} selection Auswahl, null für keine
   * @returns {void}
   */
  setSelection(selection){
    this.selection = selection;
    this.drawCursor(false);
    this.updateState();
  }

  /**
   * Erweitert die Auswahl um einen Takt nach links bzw. rechts (Umschalt+←/→); der Cursor geht mit.
   * @param {number} step -1 oder +1
   * @returns {void}
   */
  extendSelection(step){
    const sel = this.selection?.track === this.pos.track ? this.selection
      : {track: this.pos.track, anchor: this.pos.bar, from: this.pos.bar, to: this.pos.bar};
    const edge = sel.anchor === sel.from ? sel.to : sel.from;
    const next = Math.max(0, Math.min(this.score.masterBars.length - 1, edge + step));
    this.pos = edit.clampPosition(this.score, {...this.pos, bar: next, beat: 0});
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
   * Schreibt Wiederholungen, Volta-Klammern, Sprungzeichen und Takt-Wiederholungszeichen aus (score-edit.js), als ein
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
    this.commitTex(writeScore(this.alphaTab, result.score));
    this.toast(`Ausgeschrieben: ${result.before} → ${result.after} Takte`);
  }

  /**
   * Übernimmt einen neuen Stand als einen Schritt für "Rückgängig" (für Änderungen, die ein neues Modell liefern).
   * @param {string} tex alphaTex
   * @returns {void}
   */
  commitTex(tex){
    if(tex === this.tex) return;
    this.undoStack.push(this.snapshot());
    if(this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.setTex(tex);
  }

  /**
   * Ändert die Spuren (verschieben, löschen, hinzufügen) und hält die Auswahl der gezeigten Spuren mit.
   * @param {function(Score): *} fn Änderung an den Noten
   * @param {number} index betroffene Spur
   * @param {number} step Verschiebung (-1, +1), 0 beim Löschen bzw. Hinzufügen
   * @returns {void}
   */
  changeTracks(fn, index, step){
    const before = this.score.tracks.length;
    const shown = new Set(this.trackIndexes);
    this.change(() => fn(this.score));
    const after = this.score.tracks.length;
    /** @type {function(number): ?number} alter Index → neuer Index */
    let map = i => i;
    if(step) map = i => i === index ? index + step : i === index + step ? index : i;
    else if(after < before) map = i => i === index ? null : i > index ? i - 1 : i;
    const indexes = [...shown].map(map).filter(i => i !== null && i < after);
    if(after > before) indexes.push(after - 1);
    this.trackIndexes = this.player.orderTracks(indexes.map(i => this.score.tracks[i])).map(t => t.index);
    if(!this.trackIndexes.length) this.trackIndexes = [0];
    this.pos = edit.clampPosition(this.score, {...this.pos, track: map(this.pos.track) ?? this.trackIndexes[0]});
    this.player.api.renderScore(this.score, this.trackIndexes);
    this.updateState();
    this.renderSongTabs();
  }

  /**
   * Spur, deren Liedtext der Reiter "Liedtext" bearbeitet: die Spur mit dem Text (lyricsTrack()); hat der Song noch
   * keinen Text, die Gesangsspur, ohne sie die am Cursor.
   * @returns {?import('../../types/alphatab').model.Track}
   */
  lyricsTarget(){
    if(!this.score) return null;
    return lyricsTrack(this.score) ?? this.score.tracks.find(t => trackRole(t) === 'vocal')
      ?? this.score.tracks[this.pos.track];
  }

  /**
   * Verteilt den Text aus dem Reiter "Liedtext" auf die Schläge (setLyricsText()) und zeichnet die Noten neu, während
   * geschrieben wird. Alles bis zum Verlassen des Felds ist ein Schritt für "Rückgängig". Verteilt wird immer vom
   * Stand vor diesem Schritt aus (lyricsBase): Ein zu langer Abschnitt rückt seine Silben Schlag für Schlag nach und
   * füllt dabei Lücken; wird er wieder gekürzt, stehen die Silben so wieder wie vorher. Silben, für die keine Schläge
   * mehr da sind, nennt der Hinweis daneben.
   * @returns {void}
   */
  applyLyrics(){
    this.lyricsTimer = 0;
    const bottom = this.part('edit-bottom');
    const area = /** @type {HTMLTextAreaElement} */ (bottom?.querySelector('[data-lyrics]'));
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

  /**
   * Legt im Reiter "Akkorde" einen Akkord an (Name und Griff) und setzt ihn an den Schlag am Cursor.
   * @returns {void}
   */
  newChord(){
    const bottom = this.part('edit-bottom');
    const name = /** @type {HTMLInputElement} */ (bottom.querySelector('[data-new-chord="name"]')).value.trim();
    const grip = /** @type {HTMLInputElement} */ (bottom.querySelector('[data-new-chord="grip"]')).value.trim();
    if(!name){
      this.toast('Bitte einen Namen eingeben, z. B. "Am".');
      return;
    }
    if(grip && parseGrip(grip).length !== 6){
      this.toast('Griff bitte als sechs Zeichen, z. B. "x02210".');
      return;
    }
    this.change(beat => {
      this.setChordName(beat, name);
      if(grip) this.setChordGrip(beat.voice.bar.staff, name, grip);
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
    const tex = await loadScoreText(player.slug);
    if(!this.parts.length) return;
    // Das Raster der Schläge (boundsLookup) ist erst nach postRenderFinished vollständig, beim ersten Zeichnen kommt
    // renderFinished davor.
    // Beim Schreiben in einem Feld (z. B. Liedtext) rollt die Seite nicht zum Cursor.
    const redraw = () => this.drawCursor(!document.activeElement?.matches('input, textarea, select'));
    const offs = [api.renderFinished.on(redraw), api.postRenderFinished.on(redraw)];
    this.offRender = () => offs.forEach(off => off());
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'edit-cursor';
    this.cursorEl.innerHTML = '<div class="edit-selection"></div><div class="edit-cursor-beat"></div>'
      + '<div class="edit-cursor-string"></div><div class="edit-barline-ghost" hidden></div>';
    player.el.at.append(this.cursorEl);
    this.onPointer = e => this.handlePointer(e);
    player.el.at.addEventListener('pointerdown', this.onPointer);
    this.onPointerMove = e => this.handlePointerMove(e);
    window.addEventListener('pointermove', this.onPointerMove);
    player.editor = this;
    this.savedTex = writeScore(this.alphaTab, parseScore(this.alphaTab, tex));
    const score = parseScore(this.alphaTab, tex);
    const first = this.trackIndexes.find(i => score.tracks[i]?.staves[0]?.isStringed) ?? this.trackIndexes[0] ?? 0;
    this.pos = {track: first, bar: 0, beat: 0, string: score.tracks[first]?.staves[0]?.tuning.length || 1};
    this.setTex(this.savedTex);
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
    this.renderSongTabs();
    this.fillSongFields();
    this.renderNotices();
  }

  /**
   * Meldungen unter der Werkzeugleiste: Abweichungen von der Form des Gitarrenbuchs (wie die Prüfung der API, siehe
   * read_score_issues() in api/lib/crud.php, dazu Tonart und Akkorde wie im Struktur-Editor), jede mit einem Knopf,
   * der sie behebt. Nach jeder Änderung neu.
   * @returns {void}
   */
  renderNotices(){
    const el = this.part('edit-notices');
    const score = this.score;
    if(!el || !score) return;
    /** @type {[string, string, string, string][]} Text, Knopf, Befehl für run(), Tooltip */
    const notices = [];
    if(score.masterBars.some(mb => mb.directions?.size)){
      notices.push(['Sprungzeichen (D.S., D.C., Coda, Fine) kennt die Ansicht „Text & Akkorde“ nicht.',
        'Wiederholungen und Sprünge ausschreiben', 'unroll', 'Jeder Takt steht danach so oft da, wie er gespielt wird']);
    }
    const staves = score.tracks.flatMap(t => t.staves).filter(st => st.isStringed && st.tuning.length);
    if(new Set(staves.map(st => st.capo)).size > 1){
      notices.push([`Capo ungleich: ${staves.map(st => `${trackLabel(st.track.name)} ${st.capo}`).join(', ')}.`,
        'Capo angleichen', 'unifyCapo',
        'Alle Spuren auf den Capo der Begleitspur; die anderen werden umgerechnet und klingen gleich']);
    }
    const key = detectKeySignature(score);
    if(key){
      const bar = (staves[0] ?? score.tracks[0].staves[0]).bars[0];
      const minor = bar.keySignatureType === this.alphaTab.model.KeySignatureType.Minor;
      notices.push([`Tonart: notiert ${keyName(bar.keySignature, minor)}, erkannt aus Akkorden und Tönen `
        + `${keyName(key.keySignature, key.minor)}.`, 'Erkannte übernehmen', 'detectKey',
      'Vorzeichen im ganzen Song auf die erkannte Tonart setzen']);
    }
    const target = chordsTrack(score);
    const foreign = target && score.tracks.some(t => t !== target && t.staves.some(st =>
      st.bars.some(b => b.voices.some(v => v.beats.some(beat => beat.chordId)))));
    if(foreign){
      const name = trackLabel(target.name);
      notices.push([`Akkorde stehen auch außerhalb von „${name}“.`, `Akkorde nach „${name}“ übertragen`,
        'mergeChords', 'Die Akkorde aller Spuren in die Begleitspur schreiben (bei verschiedenen gewinnt sie)']);
    }
    const unnamed = score.tracks.filter(t => !trackRole(t));
    if(unnamed.length){
      notices.push([`${unnamed.length === 1 ? 'Spur' : 'Spuren'} ohne Rolle: `
        + `${unnamed.map(t => `„${trackLabel(t.name)}“`).join(', ')}.`, 'Spuren zeigen', 'tracksTab',
      'Reiter "Spuren" unten öffnen; dort lässt sich die Rolle wählen']);
    }
    el.hidden = !notices.length;
    el.innerHTML = notices.map(([text, label, cmd, hint]) => `
      <div class="edit-notice"><span>&#9888; ${escapeHtml(text)}</span>
        <button type="button" class="ebtn ebtn-text" data-cmd="${cmd}"
          title="${escapeHtml(hint)}">${escapeHtml(label)}</button></div>`).join('');
  }

  /**
   * Setzt die Höhe des unteren Panels (Inhalt unter den Reitern), in Grenzen.
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
   * Zeigt im Reiter "Audio" den Sync-Editor (wie außerhalb des Modus unter den Noten, aber eingebettet), sobald die
   * Audiospur geladen ist. Seine Änderungen sind Änderungen an den Noten (syncEdited()).
   * @returns {Promise<void>}
   */
  async openSync(){
    const tab = /** @type {HTMLElement} */ (this.part('edit-bottom').querySelector('[data-tab="audio"]'));
    if(this.sync || tab.dataset.started) return;
    tab.dataset.started = '1';
    const seconds = this.player.hasAudio ? await this.player.audioDuration : 0;
    if(!this.parts.length) return;
    if(!seconds || !this.player.mixer){
      tab.innerHTML = `<p class="efield-hint">${this.player.hasAudio ? 'Die Audiospur konnte nicht geladen werden.'
        : 'Der Song hat keine Audiospur. Sie kommt über „Songdaten“ dazu.'}</p>`;
      return;
    }
    tab.innerHTML = '';
    this.sync = new SyncEditor(tab, this.player, {slug: this.player.slug}, {onEdit: () => this.syncEdited()});
    try {
      await this.sync.open();
    } catch(err){
      this.sync.destroy();
      this.sync = null;
      tab.innerHTML = `<p class="efield-hint">${escapeHtml('Sync-Editor: ' + err.message)}</p>`;
    }
  }

  /**
   * Schreibt die bearbeiteten Noten als alphaTex, mit den Anzeige-Einstellungen aus der Datei statt denen der
   * Ansicht (sonst gälte schon das Umschalten der Ansicht als Änderung und käme mit in die Datei).
   * @returns {string} alphaTex
   */
  writeTex(){
    const staves = this.score.tracks.flatMap(t => t.staves).filter(st => this.fileFlags.has(st));
    const shown = staves.map(st => STAFF_FLAGS.map(f => st[f]));
    staves.forEach(st => STAFF_FLAGS.forEach((f, i) => { st[f] = this.fileFlags.get(st)[i]; }));
    try {
      return writeScore(this.alphaTab, this.score);
    } finally {
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
    fn(beat);
    const tex = this.writeTex();
    if(tex === this.tex){
      // Das Modell kann halb geändert sein (z. B. ein Bogen ohne Note davor): auf den Stand zurück, neu gezeichnet,
      // damit Bild und Modell wieder zusammenpassen.
      this.setTex(this.tex);
      return;
    }
    if(!merge){
      this.undoStack.push(this.snapshot());
      if(this.undoStack.length > UNDO_MAX) this.undoStack.shift();
      this.redoStack = [];
    }
    if(pos) this.pos = {...this.pos, ...pos};
    this.setTex(tex);
  }

  /**
   * Stand für "Rückgängig" bzw. "Wiederholen": Text, Cursor und gezeigte Spuren.
   * @returns {{tex: string, pos: EditPosition, tracks: number[]}}
   */
  snapshot(){
    return {tex: this.tex, pos: {...this.pos}, tracks: [...this.trackIndexes]};
  }

  /**
   * Rückgängig bzw. Wiederholen: nimmt den letzten Stand vom einen Stapel und legt den jetzigen auf den anderen.
   * @param {{tex: string, pos: EditPosition, tracks: number[]}[]} from Stapel, von dem der Stand kommt
   * @param {{tex: string, pos: EditPosition, tracks: number[]}[]} to Stapel für den jetzigen Stand
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
   * Zeigt andere Spuren (Checkboxen in der Werkzeugleiste, siehe Player.showTracks()).
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
    this.renderSongTabs();
  }

  /**
   * Setzt den Cursor auf die Stelle eines Klicks ins Notenblatt: Spur und Takt nach der Lage, der Schlag nach der
   * Waagerechten, die Saite nach der Höhe (nur in der Tab-Zeile; in der Notenzeile bleibt sie).
   * @param {PointerEvent} e Klick
   * @returns {void}
   */
  handlePointer(e){
    if(e.button !== 0 || !this.score) return;
    const rect = this.player.el.at.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    window.addEventListener('pointerup', this.onPointerUp ??= event => this.handlePointerUp(event), {once: true});
    const line = this.barLineAt(x, y);
    if(line){
      e.preventDefault();
      this.barDrag = line;
      this.showBarGhost(x, line.top, line.height);
      return;
    }
    const hit = this.hitTest(x, y);
    if(!hit) return;
    this.pos = edit.clampPosition(this.score, hit);
    this.digit = null;
    this.selection = null;
    this.dragStart = {pos: {...this.pos}, x: e.clientX, y: e.clientY};
    this.drawCursor(false);
    this.updateState();
  }

  /**
   * Maus über den Noten: Über einem Taktstrich zeigt der Zeiger, dass er sich ziehen lässt; beim Ziehen folgt ihm
   * eine Linie.
   * @param {PointerEvent} e Bewegung
   * @returns {void}
   */
  handlePointerMove(e){
    if(!this.score) return;
    const at = this.player.el.at;
    const rect = at.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if(this.barDrag){
      this.showBarGhost(x, this.barDrag.top, this.barDrag.height);
      return;
    }
    if(this.dragStart){
      const moved = Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) > DRAG_PX;
      at.classList.toggle('edit-dragging', moved);
      return;
    }
    at.classList.toggle('edit-over-barline', !!this.barLineAt(x, e.clientY - rect.top));
  }

  /**
   * Loslassen nach einem Klick: Wurde ein Taktstrich gezogen, wandern Schläge in den Nachbartakt (dropBarLine()).
   * Wurde eine Note gezogen, kommt sie an die neue Stelle, mit demselben Ton: senkrecht auf eine andere Saite
   * desselben Schlags, waagerecht auf einen anderen Schlag der Spur (auch in einem anderen Takt).
   * @param {PointerEvent} e Loslassen
   * @returns {void}
   */
  handlePointerUp(e){
    const rect = this.player.el.at.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const line = this.barDrag;
    const drag = this.dragStart;
    this.barDrag = null;
    this.dragStart = null;
    this.player.el.at.classList.remove('edit-dragging');
    this.cursorEl?.querySelector('.edit-barline-ghost')?.setAttribute('hidden', '');
    if(!this.score) return;
    if(line){
      this.dropBarLine(line, x, y);
      return;
    }
    if(!drag || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= DRAG_PX) return;
    const start = drag.pos;
    const hit = this.hitTest(x, y);
    if(!hit || hit.track !== start.track) return;
    const beat = edit.beatAt(this.score, start);
    if(!beat || !edit.noteOn(beat, start.string)) return;
    this.pos = start;
    if(hit.bar === start.bar && hit.beat === start.beat){
      if(hit.string !== start.string) this.moveNoteString(start.string, hit.string);
      return;
    }
    const staff = edit.editStaff(this.score, start.track);
    let moved = false;
    this.change(from => {
      moved = edit.moveNoteToBeat(this.alphaTab, staff, from, start.string, edit.beatAt(this.score, hit), hit.string);
    }, {pos: {bar: hit.bar, beat: hit.beat, string: hit.string}});
    if(!moved) this.toast('Dort ist die Saite belegt oder der Ton nicht greifbar.');
  }

  /**
   * Taktstrich an einer Stelle des Notenblatts (rechter Rand eines Takts, nicht der letzte) in einer Spur, die sich
   * bearbeiten lässt.
   * @param {number} x waagerecht, relativ zur Notenansicht
   * @param {number} y senkrecht, relativ zur Notenansicht
   * @returns {?{track: number, bar: number, top: number, height: number}} Spur, Takt links vom Strich und senkrechte
   *   Ausdehnung der Spur; null, wenn dort keiner ist
   */
  barLineAt(x, y){
    for(const system of this.player.api.boundsLookup?.staffSystems ?? []){
      const r = system.realBounds;
      if(y < r.y || y > r.y + r.h) continue;
      for(const masterBar of system.bars){
        if(Math.abs(x - (masterBar.realBounds.x + masterBar.realBounds.w)) > BARLINE_PX) continue;
        const entries = masterBar.bars.filter(b => y >= b.visualBounds.y - CURSOR_PAD
          && y <= b.visualBounds.y + b.visualBounds.h + CURSOR_PAD);
        const bar = entries.length ? entryBar(entries[0]) : null;
        if(!bar || bar.staff.index !== 0 || !bar.nextBar) return null;
        const own = masterBar.bars.filter(b => entryBar(b) === bar);
        const top = own[0].visualBounds.y;
        const last = own.at(-1).visualBounds;
        return {track: bar.staff.track.index, bar: bar.index, top, height: last.y + last.h - top};
      }
    }
    return null;
  }

  /**
   * Zeigt beim Ziehen eines Taktstrichs eine Linie an der Stelle des Zeigers.
   * @param {number} x waagerecht, relativ zur Notenansicht
   * @param {number} top Oberkante der Spur
   * @param {number} height Höhe der Spur
   * @returns {void}
   */
  showBarGhost(x, top, height){
    const ghost = /** @type {?HTMLElement} */ (this.cursorEl?.querySelector('.edit-barline-ghost'));
    if(!ghost) return;
    ghost.hidden = false;
    Object.assign(ghost.style, {
      left: `${x - 1}px`, top: `${top - CURSOR_PAD}px`, height: `${height + 2 * CURSOR_PAD}px`,
    });
  }

  /**
   * Setzt einen gezogenen Taktstrich an der Stelle, an der er losgelassen wurde: auf die nächste Grenze zwischen zwei
   * Schlägen im Takt links oder rechts davon. Die Schläge dazwischen wandern in den Nachbartakt (moveBarLine()); ob
   * die Takte dann noch voll sind, zeigt die Statuszeile.
   * @param {{track: number, bar: number}} line gezogener Taktstrich (Spur, Takt links davon)
   * @param {number} x waagerecht, relativ zur Notenansicht
   * @param {number} y senkrecht, relativ zur Notenansicht
   * @returns {void}
   */
  dropBarLine(line, x, y){
    const hit = this.hitTest(x, y);
    const staff = edit.editStaff(this.score, line.track);
    if(!hit || hit.track !== line.track || (hit.bar !== line.bar && hit.bar !== line.bar + 1)){
      if(hit && hit.track === line.track){
        this.toast('Einen Taktstrich bitte nur in einen der beiden Nachbartakte ziehen.');
      }
      return;
    }
    const lookup = this.player.api.boundsLookup;
    const beats = staff.bars[hit.bar].voices[0].beats;
    // Grenze: vor dem ersten Schlag, dessen Mitte rechts vom Zeiger liegt.
    let boundary = beats.findIndex(b => {
      const bounds = lookup.findBeat(b)?.visualBounds;
      return bounds && bounds.x + bounds.w / 2 > x;
    });
    if(boundary < 0) boundary = beats.length;
    const shift = hit.bar === line.bar ? boundary - beats.length : boundary;
    if(!shift) return;
    let count = 0;
    this.pos = {...this.pos, track: line.track, bar: line.bar, beat: 0};
    this.change(() => { count = edit.moveBarLine(this.alphaTab, staff, line.bar, shift); });
    this.toast(count ? `Taktstrich um ${count} Schl${count === 1 ? 'ag' : 'äge'} verschoben`
      : 'In jedem Takt muss ein Schlag bleiben.');
  }

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
   * Zeichnet den Cursor: eine Spalte über den Schlag in seiner Spur und, wenn Tabs zu sehen sind, ein Kästchen um die
   * Saite.
   * @param {boolean} scroll ob er ins Bild gerollt werden soll (nach Tasten, nicht nach einem Klick)
   * @returns {void}
   */
  drawCursor(scroll){
    const el = this.cursorEl;
    const api = this.player.api;
    const beat = this.score ? edit.beatAt(this.score, this.pos) : null;
    const bounds = beat ? api.boundsLookup?.findBeat(beat) : null;
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
   * Zeichnet die ausgewählten Takte als Flächen über der Spur.
   * @returns {void}
   */
  drawSelection(){
    const layer = this.cursorEl?.querySelector('.edit-selection');
    if(!layer) return;
    layer.innerHTML = '';
    const sel = this.selection;
    const lookup = this.player.api.boundsLookup;
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

  /**
   * Zeigt den Stand: Statuszeile ("Takt zu lang/kurz" für den Takt am Cursor, sonst leer), gedrückte Dauer in der
   * Werkzeugleiste, Felder im Reiter "Schlag", Knöpfe für Rückgängig/Wiederholen/Speichern (Speichern nur bei
   * ungespeicherten Änderungen aktiv, dann hervorgehoben).
   * @returns {void}
   */
  updateState(){
    const beat = this.score ? edit.beatAt(this.score, this.pos) : null;
    const status = this.part('edit-bottom')?.querySelector('.edit-status');
    if(!beat || !status) return;
    const staff = beat.voice.bar.staff;
    const fill = edit.barFill(beat.voice.bar);
    status.innerHTML = fill > 0 ? '<strong class="edit-warn">Takt zu lang</strong>'
      : fill < 0 ? '<strong class="edit-warn">Takt zu kurz</strong>' : '';
    for(const b of this.part('edit-toolbar').querySelectorAll('[data-duration]')){
      b.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (b).dataset.duration) === beat.duration));
    }
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
    const chord = beat.chordId ? staff.chords?.get(beat.chordId) : null;
    value('chord', chord?.name ?? '');
    value('grip', chord?.strings.length ? gripOf(chord) : '');
    value('text', beat.text ?? '');
    this.fillBarFields(beat.voice.bar);
    this.showLyricsAt(beat);
    toolbar.querySelector('[data-action="notation"]').setAttribute('aria-pressed',
      String(this.player.prefs.view === 'both'));
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
   * Füllt die Felder "Takt" (linkes Panel) mit dem Takt am Cursor. Taktart, Tonart, Tempo und Triolen-Feeling
   * gelten ab dem Takt, in dem sie gesetzt sind; ein Wechsel steht nur dort, wo sie sich ändern.
   * @param {import('../../types/alphatab').model.Bar} bar Takt am Cursor
   * @returns {void}
   */
  fillBarFields(bar){
    const panel = this.part('edit-left');
    const mb = bar.masterBar;
    const previous = bar.previousBar;
    const minor = bar.keySignatureType === this.alphaTab.model.KeySignatureType.Minor;
    const keyChanged = previous && (previous.keySignature !== bar.keySignature
      || previous.keySignatureType !== bar.keySignatureType);
    this.fillField(panel, '[data-bar="section"]', mb.section?.text.replace(/^\[(.*)]$/, '$1') ?? '');
    this.fillField(panel, '[data-bar="tsNum"]', mb.timeSignatureNumerator);
    this.fillField(panel, '[data-bar="tsDen"]', mb.timeSignatureDenominator);
    this.fillField(panel, '[data-bar="key"]', keyChanged ? keyName(bar.keySignature, minor) : '–');
    this.fillField(panel, '[data-bar="tempo"]', mb.tempoAutomations[0]?.value ?? '');
    this.fillField(panel, '[data-bar="feel"]', Number(mb.tripletFeel));
    this.fillField(panel, '[data-bar="double"]', bar.barLineRight === this.alphaTab.model.BarLineStyle.LightLight);
  }

  /**
   * Füllt die Felder "Noten" im rechten Panel mit den Werten des Songs (erster Takt, erste Spur mit Saiten).
   * @returns {void}
   */
  fillSongFields(){
    const panel = this.part('edit-right');
    const score = this.score;
    if(!panel || !score) return;
    const staff = score.tracks.flatMap(t => t.staves).find(st => st.isStringed) ?? score.tracks[0].staves[0];
    const bar = staff.bars[0];
    const mb = score.masterBars[0];
    const minor = bar.keySignatureType === this.alphaTab.model.KeySignatureType.Minor;
    this.fillField(panel, '[data-song="key"]', keyName(bar.keySignature, minor));
    this.fillField(panel, '[data-song="tsNum"]', mb.timeSignatureNumerator);
    this.fillField(panel, '[data-song="tsDen"]', mb.timeSignatureDenominator);
    this.fillField(panel, '[data-song="tempo"]', score.tempo);
    this.fillField(panel, '[data-song="feel"]', Number(mb.tripletFeel));
    const staves = score.tracks.flatMap(t => t.staves).filter(st => st.isStringed && st.tuning.length);
    const differ = new Set(staves.map(st => st.capo)).size > 1;
    this.fillField(panel, '[data-song="capo"]', differ ? '' : staff.capo);
    /** @type {HTMLInputElement} */ (panel.querySelector('[data-song="capo"]')).placeholder = differ ? 'je Spur' : '';
    // Bei ungleichem Capo: je Spur ein Feld und "Angleichen".
    const list = /** @type {HTMLElement} */ (panel.querySelector('[data-capo-tracks]'));
    if(!list.contains(document.activeElement)){
      list.hidden = !differ;
      list.innerHTML = differ ? staves.map(st => `
        <label class="ecapo-track"><span>${escapeHtml(trackLabel(st.track.name))}</span>
          <input type="number" min="0" max="12" value="${st.capo}" data-track-capo="${st.track.index}"
            aria-label="Capo ${escapeHtml(trackLabel(st.track.name))}"></label>`).join('')
        + `<div class="ebtn-row">${todoButton('Capo angleichen', 'Alle Spuren auf den Capo der Begleitspur; die '
          + 'anderen werden umgerechnet und klingen gleich', 'ebtn-text', 'unifyCapo')}</div>` : '';
    }
    const detected = detectKeySignature(score);
    panel.querySelector('[data-song-hint="key"]').textContent = detected
      ? keyName(detected.keySignature, detected.minor) : 'passt';
  }

  /**
   * Setzt den Cursor in ein Feld des linken Panels (A: Akkord, T: Text, Umschalt+Einfg: Abschnitt) und klappt das
   * Panel dafür aus.
   * @param {string} name Feld: Name in data-field oder ein Selektor ("[data-bar=…]")
   * @returns {void}
   */
  focusField(name){
    const panel = this.part('edit-left');
    if(panel.classList.contains('collapsed')) this.togglePanel('left');
    const input = /** @type {HTMLInputElement} */ (panel.querySelector(name.startsWith('[') ? name
      : `[data-field="${name}"]`));
    input.focus();
    input.select();
  }

  /**
   * Übernimmt ein geändertes Feld: Schlag am Cursor (linkes Panel), Spur oder Spurwahl (Reiter "Spuren").
   * @param {HTMLInputElement} input Feld
   * @returns {void}
   */
  applyField(input){
    if(input.dataset.showTrack !== undefined){
      const checked = [...this.part('edit-bottom').querySelectorAll('[data-show-track]:checked')]
        .map(c => Number(/** @type {HTMLElement} */ (c).dataset.showTrack));
      if(checked.length) this.player.showTracks(checked);
      else input.checked = true;
      return;
    }
    if(input.dataset.trackField){
      this.applyTrackField(input);
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
    if(input.dataset.trackCapo !== undefined){
      this.applyTrackCapo(input);
      return;
    }
    const field = input.dataset.field;
    if(!field) return;
    const value = input.value.trim();
    this.change(beat => {
      if(field === 'chord') this.setChordName(beat, value);
      else if(field === 'grip'){
        const chord = beat.chordId ? beat.voice.bar.staff.chords?.get(beat.chordId) : null;
        if(!chord || !this.setChordGrip(beat.voice.bar.staff, chord.name, value)){
          this.toast(chord ? 'Griff bitte als sechs Zeichen, z. B. "x02210".' : 'Erst einen Akkord setzen.');
        }
      }
      else if(field === 'text') beat.text = value || null;
    });
  }

  /**
   * Übernimmt ein Feld "Takt" (linkes Panel) für den Takt am Cursor: Abschnitt, Taktart, Tonartwechsel, Tempowechsel
   * und Triolen-Feeling (ab diesem Takt bis zur nächsten Änderung), doppelter Taktstrich.
   * @param {HTMLInputElement} input Feld (data-bar)
   * @returns {void}
   */
  applyBarField(input){
    const at = this.alphaTab;
    const index = this.pos.bar;
    const panel = this.part('edit-left');
    const value = input.value.trim();
    const number = name => Number(/** @type {HTMLInputElement} */ (panel.querySelector(`[data-bar="${name}"]`)).value);
    this.change(beat => {
      switch(input.dataset.bar){
        case 'section': edit.setSection(at, this.score, index, value); break;
        case 'tsNum': case 'tsDen':
          if(number('tsNum') > 0 && [1, 2, 4, 8, 16, 32].includes(number('tsDen'))){
            edit.setTimeSignature(this.score, index, number('tsNum'), number('tsDen'));
          }
          break;
        case 'key': {
          const previous = beat.voice.bar.previousBar ?? beat.voice.bar;
          const k = KEY_NAMES.indexOf(value);
          const minor = k >= 15;
          if(value === '–') edit.setKeySignature(at, this.score, index, previous.keySignature,
            previous.keySignatureType === at.model.KeySignatureType.Minor);
          else edit.setKeySignature(at, this.score, index, (k % 15) - 7, minor);
          break;
        }
        case 'tempo': edit.setTempo(at, this.score, index, Number(value) || null); break;
        case 'feel': edit.setTripletFeel(this.score, index, /** @type {HTMLSelectElement} */ (input).selectedIndex); break;
        case 'double': edit.setDoubleBar(at, this.score, index, input.checked); break;
      }
    });
    this.updateState();
  }

  /**
   * Übernimmt ein Feld "Noten" (rechtes Panel) für den ganzen Song: Tonart, Taktart, Tempo, Triolen-Feeling, Capo
   * (mit "Klang behalten" bzw. "Griffe behalten").
   * @param {HTMLInputElement} input Feld (data-song)
   * @returns {void}
   */
  applySongField(input){
    const at = this.alphaTab;
    const panel = this.part('edit-right');
    const value = input.value.trim();
    const number = name => Number(/** @type {HTMLInputElement} */ (panel.querySelector(`[data-song="${name}"]`)).value);
    let octaves = 0;
    this.change(() => {
      switch(input.dataset.song){
        case 'key': {
          const k = KEY_NAMES.indexOf(value);
          edit.setKeySignature(at, this.score, 0, (k % 15) - 7, k >= 15, true);
          break;
        }
        case 'tsNum': case 'tsDen':
          if(number('tsNum') > 0 && [1, 2, 4, 8, 16, 32].includes(number('tsDen'))){
            edit.setTimeSignature(this.score, 0, number('tsNum'), number('tsDen'), true);
          }
          break;
        case 'tempo': if(Number(value) > 0) edit.setTempo(at, this.score, 0, Number(value)); break;
        case 'feel': edit.setTripletFeel(this.score, 0, /** @type {HTMLSelectElement} */ (input).selectedIndex, true); break;
        case 'capo': {
          const keepSound = /** @type {HTMLInputElement} */ (panel.querySelector('[name="capoKeep"]')).checked;
          octaves = edit.setCapo(this.score, Math.max(0, Math.min(12, Number(value) || 0)), keepSound, moveToCapo);
          break;
        }
      }
    });
    if(octaves) this.toast(`${octaves} Noten passten nur eine Oktave höher.`);
    this.fillSongFields();
  }

  /**
   * Setzt den Capo einer Spur (Feld je Spur im rechten Panel, nur bei ungleichem Capo), mit "Klang behalten" bzw.
   * "Griffe behalten" darunter.
   * @param {HTMLInputElement} input Feld (data-track-capo)
   * @returns {void}
   */
  applyTrackCapo(input){
    const panel = this.part('edit-right');
    const keepSound = /** @type {HTMLInputElement} */ (panel.querySelector('[name="capoKeep"]')).checked;
    const capo = Math.max(0, Math.min(12, Number(input.value) || 0));
    const index = Number(input.dataset.trackCapo);
    let octaves = 0;
    input.blur();
    this.change(() => {
      const staff = this.score.tracks[index].staves.find(st => st.isStringed);
      if(keepSound) octaves = moveToCapo(staff, capo);
      else staff.capo = capo;
    });
    if(octaves) this.toast(`${octaves} Noten passten nur eine Oktave höher.`);
  }

  /**
   * Übernimmt ein Feld einer Spur im Reiter "Spuren": Name, Rolle (eine Spur mit Rolle heißt wie die Rolle, jede Rolle
   * nur einmal), Stimmung (mit "Klang behalten" bzw. "Griffe behalten" darunter) und Instrument.
   * @param {HTMLInputElement} input Feld (data-track-field, data-track)
   * @returns {void}
   */
  applyTrackField(input){
    const track = this.score.tracks[Number(input.dataset.track)];
    const value = input.value.trim();
    const field = input.dataset.trackField;
    if(field === 'role'){
      const taken = value && this.score.tracks.find(t => t !== track && trackRole(t) === value);
      if(taken){
        this.toast(`Die Rolle "${TRACK_ROLES[value]}" hat schon "${trackLabel(taken.name)}".`);
        this.renderSongTabs();
        return;
      }
      // Ohne Rolle braucht die Spur einen eigenen Namen statt des Rollennamens.
      const name = value || `Spur ${track.index + 1}`;
      this.change(() => { track.name = track.shortName = value || name; });
    } else if(field === 'name'){
      if(!value || Object.hasOwn(TRACK_ROLES, value.toLowerCase())){
        this.toast('Spuren ohne Rolle brauchen einen eigenen Namen, nicht den einer Rolle.');
        this.renderSongTabs();
        return;
      }
      this.change(() => { track.name = track.shortName = value; });
    } else if(field === 'tuning'){
      const tuning = parseTuningText(value);
      if(!tuning || track.staves[0].tuning.length !== tuning.length){
        this.toast('Stimmung bitte als sechs Töne von tief nach hoch, z. B. "D A D G B E".');
        this.renderSongTabs();
        return;
      }
      const keepSound = /** @type {HTMLInputElement} */ (this.part('edit-bottom')
        .querySelector('[name="tuningKeep"]')).checked;
      let misses = 0;
      this.change(() => { misses = edit.setTuning(this.alphaTab, track.staves[0], tuning, keepSound); });
      if(misses) this.toast(`${misses} Noten ließen sich nicht umrechnen (Bund unter 0 oder über 24).`);
    } else if(field === 'instrument'){
      this.change(() => { track.playbackInfo.program = Number(value); });
    }
  }

  /**
   * Setzt den Akkordnamen eines Schlags; leer löscht ihn. Gibt es den Akkord in der Spur noch nicht, wird er ohne
   * Griff angelegt (den Griff aus der Bibliothek setzt das Speichern, siehe normalizeChords()).
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
    }
    beat.chordId = id;
  }

  /**
   * Speichert die Noten: Griffbilder vereinheitlichen (wie beim Import), als alphaTex schreiben, prüfen, hochladen.
   * Der Server hebt die vorige Fassung auf (history/).
   * @returns {Promise<void>}
   */
  async save(){
    if(!this.dirty){
      this.toast('Keine Änderungen');
      return;
    }
    const tex = this.tex;
    try {
      const result = parseScore(this.alphaTab, tex);
      // Ohne Bibliothek (Netzfehler) behalten die Akkorde ihren eigenen meistgenutzten Griff.
      normalizeChords(this.alphaTab, result, await loadChordLibrary().catch(() => ({})), true);
      const song = await saveScore(this.player.slug, writeScoreChecked(this.alphaTab, result));
      this.savedTex = tex;
      this.saved = true;
      this.sync?.saved();
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
   * "Fertig": verlässt den Bearbeitungsmodus, bei ungespeicherten Änderungen erst nach Rückfrage.
   * @returns {void}
   */
  finish(){
    if(this.dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    this.onClose(this.saved);
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
    this.offRender?.();
    this.player.el.at.removeEventListener('pointerdown', this.onPointer);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.player.el.at.classList.remove('edit-over-barline', 'edit-dragging');
    this.cursorEl?.remove();
    this.sync?.destroy();
    this.sync = null;
    if(this.player.editor === this) this.player.editor = null;
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
    this.relayout();
  }
}
