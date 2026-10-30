/**
 * alphaTab-Wrapper: Noten und Tabs anzeigen und mit dem Synthesizer abspielen, bei vorhandener audio.mp3 zusammen
 * mit der Audiospur (siehe mixer.js). In der Kopfzeile wählt man die Ansicht (Noten, Tabs, Noten + Tabs oder Chords,
 * d. h. "Text & Akkorde", siehe textview.js) und die angezeigten Spuren. Das Einstellungsfeld ist ein kleines
 * Mischpult (Lautstärke und Stumm je Spur, Audiospur, Metronom und Vorzähler), dazu Loop-Bereich, Größe und
 * Griffbilder; es gilt in allen Ansichten, die Wiedergabe läuft auch in "Chords" weiter. Die Griffbilder stehen für
 * alle Ansichten gleich über den Noten bzw. dem Text (renderChordDiagrams() in textview.js), nicht die von alphaTab.
 *
 * alphaTab (rund 1 MB) und der SoundFont werden erst geladen, wenn ein Lied geöffnet wird.
 */

import {escapeHtml, loadScoreText} from './api.js';
import {Mixer} from './mixer.js';
import {
  applyRecordingTempo, applySongMeta, loadAlphaTab, parseScore, playbackSyncPoints, readScoreInfo, recordingTempoAt,
} from './score.js';
import {buildTextModel, renderChordDiagrams, renderTextView} from './textview.js';
import {chordsTrack, lyricsTrack, mergeChords, trackLabel, trackRole} from './tracks.js';

/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */
/** @typedef {import('../../types/alphatab').AlphaTabApi} AlphaTabApi */
/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Track} Track */
/** @typedef {import('../../types/alphatab').synth.BackingTrackSyncPoint} BackingTrackSyncPoint */
/** @typedef {import('./api.js').Song} Song */
/** @typedef {import('./score.js').ScoreInfo} ScoreInfo */

/** Basis-URL von alphaTab mit Schrift und SoundFont, relativ zu diesem Modul. */
const VENDOR_URL = new URL('../vendor/alphatab/', import.meta.url).href;
/** Schlüssel im localStorage für die Player-Einstellungen (gelten für alle Lieder). */
const PREFS_KEY = 'gitarrenbuch_player';
/** Präfix im localStorage für die angezeigten Spuren je Lied (+ Slug). */
const TRACKS_KEY_PREFIX = 'gitarrenbuch_tracks_';
/** Präfix im localStorage für Lautstärke und Stumm der Spuren und der Audiospur je Lied (+ Slug). */
const MIX_KEY_PREFIX = 'gitarrenbuch_mix_';

/** Ansichten in der Kopfzeile: Wert und Beschriftung. "chords" ist "Text & Akkorde", die anderen zeigen die Noten. */
const VIEWS = [['score', 'Noten'], ['tab', 'Tabs'], ['both', 'Noten + Tabs'], ['chords', 'Chords']];
/**
 * Präfix im localStorage für den Audio-Versatz je Lied (+ Slug). Stammt aus der Zeit vor dem Sync-Editor, als sich eine
 * Korrektur der Sync-Punkte nur so nach Gehör ausprobieren ließ. Ein gespeicherter Wert wirkt weiter, bis er im
 * Sync-Editor in die Sync-Punkte übernommen ist (siehe clearStoredOffset()).
 */
const OFFSET_KEY_PREFIX = 'gitarrenbuch_audio_offset_';

/**
 * Liest die Player-Einstellungen, ergänzt um Vorgaben. Einstellungen aus der Zeit vor dem Umbau der Bedienung
 * (29.10.2026: stave, metronome, countIn, synthVolume, audioVolume, barStyle, layout) werden übernommen bzw.
 * verworfen.
 * @returns {{speed: number, view: string, staves: string, scale: number, diagrams: boolean, metronomeVolume: number,
 *   countInVolume: number, metronomeMute: boolean, countInMute: boolean}} view: Ansicht (siehe VIEWS); staves: die
 *   zuletzt gewählte Notenansicht ("score", "tab" oder "both"), gilt auch für die eingeklappten Noten in "chords";
 *   diagrams: Griffbilder anzeigen; Lautstärken von 0 bis 1
 */
function loadPrefs(){
  const defaults = {
    speed: 1, view: 'both', staves: 'both', scale: window.innerWidth < 600 ? 0.75 : 1, diagrams: true,
    metronomeVolume: 1, countInVolume: 1, metronomeMute: true, countInMute: true,
  };
  /** @type {Object<string, *>} Einstellungen aus dem Browser, auch in alter Form (stave, metronome, countIn) */
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch(err){ /* Vorgaben verwenden */ }
  if(saved.stave){
    saved.staves = {Default: 'both', Tab: 'tab', Score: 'score'}[saved.stave] ?? 'both';
    saved.view = saved.view === 'text' ? 'chords' : saved.staves;
  }
  if(typeof saved.metronome === 'boolean') saved.metronomeMute = !saved.metronome;
  if(typeof saved.countIn === 'boolean') saved.countInMute = !saved.countIn;
  for(const old of ['stave', 'metronome', 'countIn', 'synthVolume', 'audioVolume', 'barStyle', 'layout']) delete saved[old];
  return Object.assign(defaults, saved);
}

/**
 * Speichert die Player-Einstellungen.
 * @param {Object} prefs Einstellungen (siehe loadPrefs())
 * @returns {void}
 */
function savePrefs(prefs){
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/**
 * Formatiert eine Zeitspanne.
 * @param {number} ms Millisekunden
 * @returns {string} m:ss
 */
export function formatTime(ms){
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Abschnittsnamen über den Noten wie die Überschriften in "Chords": ohne die eckigen Klammern aus Guitar Pro, in
 * Großbuchstaben ("[Verse 1]" → "VERSE 1"). Geändert wird nur das geladene Modell, die Noten bleiben, wie sie sind.
 * @param {Score} score geladene Noten
 * @returns {void}
 */
function showSectionNames(score){
  for(const mb of score.masterBars){
    if(!mb.section) continue;
    const name = (mb.section.text || mb.section.marker || '').replace(/^\s*\[|]\s*$/g, '').trim();
    mb.section.marker = '';
    mb.section.text = name.toUpperCase();
  }
}

/**
 * Silben eines Schlags ohne leere Strophen am Ende. Aus Guitar Pro hat jeder Schlag oft fünf Strophen, meist nur
 * die erste mit Text; alphaTab rechnet den Abstand zwischen den Strophen (lyricLinesPaddingBetween) auch für die
 * leeren mit, der Text hatte darunter unnötig viel Platz.
 * @param {string[]} lyrics Silben je Strophe
 * @returns {string[]} dieselben ohne leere am Ende
 */
function withoutTrailingEmpty(lyrics){
  let end = lyrics.length;
  while(end > 0 && !lyrics[end - 1]?.trim()) end--;
  return lyrics.slice(0, end);
}

/**
 * Spurnamen links neben den Spuren: bei mehreren angezeigten Spuren in jeder Notenzeile, senkrecht, mit dem
 * Anzeigenamen ("Gesang" statt "vocal", trackLabel()); bei einer Spur keiner. Was die Datei aus Guitar Pro vorgibt
 * (meist ausgeblendet), gilt nicht. Den Anzeigenamen bekommt nur der Kurzname im geladenen Modell; der Name selbst
 * bleibt, an ihm hängt die Rolle (trackRole()).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score geladene Noten
 * @returns {void}
 */
function showTrackNames(alphaTab, score){
  const {TrackNameMode, TrackNameOrientation, TrackNamePolicy} = alphaTab.model;
  const sheet = score.stylesheet;
  sheet.singleTrackTrackNamePolicy = TrackNamePolicy.Hidden;
  sheet.multiTrackTrackNamePolicy = TrackNamePolicy.AllSystems;
  sheet.firstSystemTrackNameMode = sheet.otherSystemsTrackNameMode = TrackNameMode.ShortName;
  sheet.firstSystemTrackNameOrientation = sheet.otherSystemsTrackNameOrientation = TrackNameOrientation.Vertical;
  for(const track of score.tracks) track.shortName = trackLabel(track.name) || `Spur ${track.index + 1}`;
}

/**
 * Teile der Noten, die alphaTab nicht zeichnen soll (Namen aus alphaTab.NotationElement): Titel, Interpret usw.
 * stehen schon in der Kopfzeile der Seite, die Griffbilder darüber für alle Ansichten gleich, die Stimmung (mit dem
 * Spurnamen davor) und der Capo in der Kopfzeile. "Capo. fret 1" über dem ersten Takt verdeckte außerdem den
 * Akkordnamen.
 */
const HIDDEN_SCORE_ELEMENTS = [
  'ScoreTitle', 'ScoreSubTitle', 'ScoreArtist', 'ScoreAlbum', 'ScoreWords', 'ScoreMusic', 'ScoreWordsAndMusic',
  'ScoreCopyright', 'GuitarTuning', 'ChordDiagrams', 'EffectCapo',
];

/**
 * Wert von alphaTab.synth.PlayerState.Playing. Als Konstante, weil das Modul erst beim Öffnen eines Lieds
 * geladen wird und die IDE das Enum über den dynamischen Import nicht auflöst.
 */
const PLAYER_STATE_PLAYING = 1;

/**
 * Kleinste Änderung des Tempofaktors, für die während der Wiedergabe das Abspieltempo von alphaTab umgestellt wird
 * (Anteil). Nötig ist das nur, solange im Sync-Editor geänderte Sync-Punkte noch nicht im MIDI stecken (siehe
 * applySpeed()). Jede Umstellung setzt den Synth intern neu an die Position, das ist als Aussetzer hörbar; kleinere
 * Unterschiede gleicht der Mixer an der Audiospur aus.
 */
const SPEED_CHANGE_MIN = 0.03;

/** Wählbare Abspieltempi (Faktor). */
const SPEEDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
/**
 * Abstand unter jeder Notenzeile außer der letzten, wenn mehrere Spuren angezeigt werden (px, bei Größe 100 %): Dann
 * muss man sehen, wo eine Zeile mit allen Spuren endet. Den Systemtrenner (zwei schräge Striche zwischen den Zeilen)
 * entfernt der Import; er hatte dafür gesorgt.
 */
const SYSTEM_GAP = 45;
/** Abstand unter jeder Notenzeile bei nur einer angezeigten Spur (px, bei Größe 100 %; Vorgabe von alphaTab 10). */
const SYSTEM_GAP_SINGLE = 20;

/** Zusätzlicher Abstand zwischen den Spuren einer Notenzeile (px, bei Größe 100 %). */
const TRACK_GAP = 20;

/** Abstand zwischen den Angaben über den Noten wie Tempo, Abschnitt, Text, Akkordname (px, bei Größe 100 %). */
const EFFECT_GAP = 8;

/** Schrift aller Texte in den Noten (Akkorde, Abschnitte, Liedtext, Tempo, Spurnamen, …), wie die Seite (app.css). */
const TEXT_FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/** Schriftgröße der Akkordnamen über den Noten (px, bei Größe 100 %). */
const CHORD_FONT_SIZE = 16;
/** Schriftgröße des Liedtexts unter den Noten (px, bei Größe 100 %; Vorgabe von alphaTab 12). */
const LYRICS_FONT_SIZE = 13;
/** Schriftgröße der Abschnittsnamen über den Noten (px, bei Größe 100 %). */
const SECTION_FONT_SIZE = 13;

/** Mindestabstand der aktuellen Zeile zur festen Kopfzeile beim Mitscrollen (px). */
const SCROLL_GAP = 16;
/**
 * Wo die aktuelle Zeile (Noten oder Chords) nach dem Mitscrollen beginnt: Anteil des sichtbaren Bereichs zwischen
 * Kopfzeile und Abspielleiste. So liegt sie im oberen Drittel, mit etwas Vorlauf darüber.
 */
const SCROLL_POSITION = 0.12;
/** Verzögerung, bevor "Noten werden gezeichnet" erscheint (ms); kürzeres Zeichnen soll nicht aufblitzen. */
const RENDER_STATUS_DELAY = 400;

/** Wählbare Größen der Notendarstellung (Faktor). */
const SCALES = [0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5];

/**
 * Notenansicht mit Transportleiste und Einstellungsfeld für ein Lied.
 * Aufruf: const player = new Player(root, controls); const info = await player.load(song); … player.destroy();
 */
export class Player {
  /**
   * alphaTab-Instanz, null vor load() und nach destroy().
   * @type {?AlphaTabApi}
   */
  api = null;
  /**
   * alphaTab-Modul, gesetzt von load().
   * @type {?AlphaTabModule}
   */
  alphaTab = null;
  /**
   * Sperre gegen das Abschalten des Bildschirms, solange abgespielt wird.
   * @type {?WakeLockSentinel}
   */
  wakeLock = null;
  /** Player-Einstellungen (siehe loadPrefs()). */
  prefs = loadPrefs();
  /** Slug des geladenen Lieds. */
  slug = '';
  /** Ob das Lied eine audio.mp3 hat; dann folgt der Synth ihrem Tempo. */
  hasAudio = false;
  /**
   * Sync-Punkte, deren Tempo im MIDI des Synths steckt (siehe applyRecordingTempo() in score.js); leer ohne
   * Audiospur.
   * @type {BackingTrackSyncPoint[]}
   */
  midiSyncPoints = [];
  /** Ob das MIDI neu erzeugt werden soll, sobald die Wiedergabe anhält (siehe refreshMidi()). */
  midiStale = false;
  /**
   * Audiospur, die dem Synth folgt; null, wenn das Lied keine audio.mp3 hat.
   * @type {?Mixer}
   */
  mixer = null;
  /**
   * Lautstärke und Stumm je Spur (nach Index) und der Audiospur, gespeichert je Lied (siehe loadMix()).
   * @type {{tracks: Object<string, {volume: number, mute: boolean}>, audio: {volume: number, mute: boolean}}}
   */
  mix = {tracks: {}, audio: {volume: 1, mute: false}};
  /**
   * Länge der Audiospur in Sekunden, sobald sie geladen ist; null ohne (oder mit unlesbarer) audio.mp3.
   * @type {Promise<?number>}
   */
  audioDuration = new Promise(resolve => { this.resolveAudioDuration = resolve; });
  /**
   * Inhalt der Ansicht "Text & Akkorde" und der Griffbilder, erzeugt beim Laden der Noten.
   * @type {?import('./textview.js').TextModel}
   */
  textModel = null;
  /** Scroll-Modus von alphaTab für die Notenansicht; in "Text & Akkorde" folgt die Seite dem Cursor nicht. */
  scrollMode = 0;
  /** Notenzeile, zu der zuletzt gescrollt wurde (siehe scrollToSystem()); -1 für keine. */
  scrolledSystem = -1;
  /**
   * Akkorde aller Spuren, zusammengetragen nach der Regel der Konvention (mergeChords() in tracks.js), siehe
   * applyChordNames().
   * @type {import('./tracks.js').MergedChord[]}
   */
  mergedChords = [];
  /**
   * Liedtext je Spur aus der Datei (Schlag und Silben je Strophe), siehe applyLyrics().
   * @type {Map<Track, [import('../../types/alphatab').model.Beat, string[]][]>}
   */
  trackLyrics = new Map();
  /**
   * Spur mit dem Text (lyricsTrack()), bestimmt beim Laden; null ohne Text.
   * @type {?Track}
   */
  lyricsOwner = null;
  /**
   * Erste Begleitspur (chordsTrack()), bestimmt beim Laden; null ohne Akkorde.
   * @type {?Track}
   */
  accompaniment = null;
  /** Zeitgeber für die verzögerte Meldung "Noten werden gezeichnet" (siehe RENDER_STATUS_DELAY). */
  renderStatusTimer = 0;
  /**
   * Teile der Ansicht "Text & Akkorde" mit ihrer Zeit, in Abspielreihenfolge (siehe highlightText()).
   * @type {{t: number, el: HTMLElement}[]}
   */
  textMarks = [];
  /** Index des Teils in textMarks, der gerade hervorgehoben ist; -1 für keinen, -2: neu bestimmen. */
  textCurrent = -1;

  /**
   * @param {HTMLElement} root leeres Element, in das Notenblatt und Bedienelemente gerendert werden
   * @param {HTMLElement} controls leeres Element in der Kopfzeile für Ansicht und Spuren
   */
  constructor(root, controls){
    /** Element, in das gerendert wird. */
    this.root = root;
    /** Element in der Kopfzeile mit Ansicht und Spuren. */
    this.controls = controls;
    controls.innerHTML = `
      <div class="view-switch" role="group" aria-label="Ansicht">
        ${VIEWS.map(([value, label]) => `<button type="button" data-view="${value}">${label}</button>`).join('')}
      </div>
      <select class="view-select" aria-label="Ansicht">
        ${VIEWS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
      </select>
      <div class="tracks-menu">
        <button class="btn tracks-btn" type="button" aria-expanded="false">Spuren &#9662;</button>
        <div class="tracks-pop" hidden></div>
      </div>
    `;
    controls.addEventListener('click', e => this.onControlsClick(/** @type {HTMLElement} */ (e.target)));
    controls.addEventListener('change', e => this.onControlsChange(/** @type {HTMLInputElement} */ (e.target)));
    /** Schließt das Spuren-Menü bei einem Klick außerhalb. */
    this.onDocumentClick = e => {
      if(!/** @type {Element} */ (e.target).closest('.tracks-menu')) this.toggleTracksMenu(false);
    };
    document.addEventListener('click', this.onDocumentClick);
    this.showViewControls();
    root.innerHTML = `
      <div class="chord-strip" data-ref="diagrams" hidden></div>
      <div class="score-status" data-ref="status">Noten werden geladen &hellip;</div>
      <div class="score-wrap" data-ref="wrap"><div data-ref="at"></div></div>
      <div class="text-view" data-ref="text" hidden></div>
      <div class="player-panel" data-ref="panel" hidden></div>
      <div class="transport">
        <button class="tbtn tbtn-play" data-ref="play" type="button" disabled aria-label="Abspielen">&#9654;</button>
        <button class="tbtn" data-ref="stop" type="button" disabled aria-label="Zum Anfang">&#9632;</button>
        <div class="tprogress">
          <input type="range" data-ref="seek" min="0" max="1" value="0" step="1" aria-label="Position">
          <span class="ttime" data-ref="time">0:00 / 0:00</span>
        </div>
        <select class="tselect" data-ref="speed" aria-label="Tempo">
          ${SPEEDS.map(s => `<option value="${s}">${Math.round(s * 100)} %</option>`).join('')}
        </select>
        <button class="tbtn" data-ref="loop" type="button" aria-pressed="false" aria-label="Loop" title="Loop (Bereich im Notenblatt markieren)">&#10227;</button>
        <button class="tbtn" data-ref="settings" type="button" aria-expanded="false" aria-label="Einstellungen">&#9881;</button>
      </div>
    `;
    /**
     * Bedienelemente nach ihrem data-ref.
     * @type {Record<string, HTMLElement>}
     */
    this.el = {};
    root.querySelectorAll('[data-ref]').forEach(n => { this.el[n.dataset.ref] = n; });
    /** Positionsregler. */
    this.seek = /** @type {HTMLInputElement} */ (this.el.seek);
    /** Auswahl des Abspieltempos. */
    this.speed = /** @type {HTMLSelectElement} */ (this.el.speed);
    // Ein gespeichertes Tempo, das es in der Auswahl nicht mehr gibt (z. B. 75 %), auf das nächste setzen.
    const saved = this.prefs.speed;
    this.prefs.speed = SPEEDS.reduce((best, s) => Math.abs(s - saved) < Math.abs(best - saved) ? s : best);
    this.speed.value = String(this.prefs.speed);
    /** Verteilt die Griffbilder neu, wenn sich die Breite ändert. */
    this.onResize = () => this.layoutChordDiagrams();
    window.addEventListener('resize', this.onResize);
    /** Holt die Wake-Lock-Sperre zurück, wenn die Seite beim Abspielen wieder sichtbar wird. */
    this.onVisibility = () => { if(document.visibilityState === 'visible' && this.isPlaying) void this.requestWakeLock(); };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /**
   * Ob gerade abgespielt wird.
   * @returns {boolean}
   */
  get isPlaying(){
    return this.api?.playerState === PLAYER_STATE_PLAYING;
  }

  /**
   * Lädt alphaTab, den SoundFont und die Noten des Lieds (score.atex); Titel und Interpret kommen aus song.json.
   * @param {Song} song Lied
   * @returns {Promise<ScoreInfo>} Eckdaten aus den Noten, sobald diese an alphaTab übergeben sind
   */
  async load(song){
    this.slug = song.slug;
    this.hasAudio = song.files.includes('audio');
    this.mix = this.loadMix();
    // Nacheinander statt mit Promise.all: Dort verliert die IDE die Typen der einzelnen Ergebnisse.
    const alphaTab = await loadAlphaTab();
    const tex = await loadScoreText(song.slug);
    this.alphaTab = alphaTab;

    const api = this.api = new alphaTab.AlphaTabApi(this.el.at, {
      core: {fontDirectory: VENDOR_URL + 'font/'},
      display: {
        scale: this.prefs.scale,
        layoutMode: alphaTab.LayoutMode.Page,
        // Abstand zwischen den Notenzeilen (Vorgabe 10), so viel wie früher mit dem Systemtrenner aus GP
        // Abstand zwischen den Spuren einer Zeile (Vorgabe 5): Texte über einer Spur ("Rhythm Guitar 1") klebten
        // sonst an den Tabs der Spur darüber.
        trackStaffPaddingBetween: TRACK_GAP,
        // Abstand zwischen den Angaben über den Noten (Vorgabe 2): Tempo, Abschnitt, Text und Akkord standen dicht.
        effectBandPaddingBottom: EFFECT_GAP,
      },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
        soundFont: VENDOR_URL + 'soundfont/sonivox.sf2',
      },
    });
    // Eigenes Scrollen statt dem von alphaTab (siehe scrollToSystem()).
    api.customScrollHandler = /** @type {import('../../types/alphatab').IScrollHandler} */ ({
      forceScrollTo: bounds => this.scrollToSystem(bounds, true),
      onBeatCursorUpdating: bounds => this.scrollToSystem(bounds, false),
      [Symbol.dispose]: () => {},
    });
    for(const element of HIDDEN_SCORE_ELEMENTS){
      api.settings.notation.elements.set(alphaTab.NotationElement[element], false);
    }
    // Alle Texte in der Schrift der Seite statt Georgia/Arial, Größe und Stil wie bei alphaTab; die Notenschrift
    // (Bravura) ist davon nicht betroffen.
    const {Font, FontStyle, FontWeight} = alphaTab.model;
    const fonts = api.settings.display.resources.elementFonts;
    for(const [element, font] of fonts) fonts.set(element, new Font(TEXT_FONT, font.size, font.style, font.weight));
    // Akkordnamen wie in der Ansicht "Chords": fett, größer (Vorgabe 12 kursiv). Eine Farbe nur für Akkordnamen
    // kennt alphaTab nicht; dafür müsste alphaTab.core.mjs geändert werden.
    fonts.set(alphaTab.NotationElement.EffectChordNames,
      new Font(TEXT_FONT, CHORD_FONT_SIZE, FontStyle.Plain, FontWeight.Bold));
    // Liedtext gerade statt kursiv.
    fonts.set(alphaTab.NotationElement.EffectLyrics,
      new Font(TEXT_FONT, LYRICS_FONT_SIZE, FontStyle.Plain, FontWeight.Regular));
    // Abschnittsnamen wie die Überschriften in "Chords": fett (Vorgabe 14 fett); Text siehe showSectionNames().
    fonts.set(alphaTab.NotationElement.EffectMarker,
      new Font(TEXT_FONT, SECTION_FONT_SIZE, FontStyle.Plain, FontWeight.Bold));
    this.applyLevels();
    api.playbackSpeed = this.prefs.speed;

    api.renderStarted.on(() => {
      clearTimeout(this.renderStatusTimer);
      this.renderStatusTimer = setTimeout(() => this.setStatus('Noten werden gezeichnet &hellip;'), RENDER_STATUS_DELAY);
    });
    api.renderFinished.on(() => {
      clearTimeout(this.renderStatusTimer);
      this.setStatus('');
    });
    api.soundFontLoad.on(e => this.setStatus(`Klänge werden geladen &hellip; ${Math.round(e.loaded / e.total * 100)} %`));
    api.playerReady.on(() => {
      this.applyLevels();
      this.el.play.disabled = false;
      this.el.stop.disabled = false;
    });
    api.midiLoad.on(midi => {
      this.midiSyncPoints = this.hasAudio ? playbackSyncPoints(alphaTab, api.score) : [];
      applyRecordingTempo(alphaTab, midi, this.midiSyncPoints);
      // Lautstärken und Stumm je Spur gelten für das geladene MIDI, also erst danach setzen. (Das Ereignis
      // midiLoaded ruft sich in alphaTab 1.8.4 endlos selbst auf und ist deshalb nicht nutzbar.)
      setTimeout(() => this.applyLevels());
    });
    api.playerStateChanged.on(e => this.onStateChanged(e.state));
    api.playerPositionChanged.on(e => {
      this.onPosition(e.currentTime, e.endTime);
      this.mixer?.onPosition(e.currentTick, e.isSeek,
        api.playbackSpeed * recordingTempoAt(this.midiSyncPoints, e.currentTick));
      this.applySpeed(e.currentTick);
      this.highlightText(e.currentTick);
    });
    api.playbackRangeChanged.on(() => this.renderPanel());
    api.error.on(err => this.setStatus(escapeHtml('Fehler: ' + (err.message || err))));

    this.el.play.addEventListener('click', () => api.playPause());
    this.el.stop.addEventListener('click', () => api.stop());
    this.seek.addEventListener('input', () => { api.timePosition = Number(this.seek.value); });
    this.speed.addEventListener('change', () => {
      this.prefs.speed = Number(this.speed.value);
      this.mixer?.setSpeed(this.prefs.speed);
      this.applySpeed(api.tickPosition, true);
      savePrefs(this.prefs);
    });
    this.el.loop.addEventListener('click', () => {
      api.isLooping = !api.isLooping;
      this.el.loop.setAttribute('aria-pressed', String(api.isLooping));
    });
    this.el.settings.addEventListener('click', () => this.togglePanel());
    this.el.panel.addEventListener('change', e => this.onPanelChange(/** @type {HTMLInputElement} */ (e.target)));
    // Lautstärken schon beim Ziehen übernehmen, nicht erst beim Loslassen.
    this.el.panel.addEventListener('input', e => {
      const t = /** @type {HTMLInputElement} */ (e.target);
      if(t.dataset.volume) this.onVolumeChange(t);
    });
    this.el.panel.addEventListener('click', e => this.onPanelClick(/** @type {HTMLElement} */ (e.target)));
    this.el.text.addEventListener('click', e => this.onTextClick(/** @type {HTMLElement} */ (e.target)));

    const score = parseScore(alphaTab, tex, api.settings);
    applySongMeta(score, song);
    // Stumm und Solo aus der Datei gelten nicht; Stumm steuert das Mischpult.
    for(const track of score.tracks){
      track.playbackInfo.isMute = false;
      track.playbackInfo.isSolo = false;
    }
    this.applyStave(score);
    // Das Modell für "Chords" und die Griffbilder braucht die Akkorde, wie sie in der Datei stehen, also vor
    // applyChordNames().
    this.textModel = buildTextModel(score);
    this.mergedChords = mergeChords(score);
    showSectionNames(score);
    showTrackNames(alphaTab, score);
    this.trackLyrics = new Map(score.tracks.map(track => [track, track.staves
      .flatMap(staff => staff.bars).flatMap(bar => bar.voices).flatMap(voice => voice.beats)
      .filter(beat => beat.lyrics?.some(l => l?.trim())).map(beat => [beat, withoutTrailingEmpty(beat.lyrics)])]));
    this.lyricsOwner = lyricsTrack(score);
    this.accompaniment = chordsTrack(score);
    const visible = this.orderTracks(this.loadVisibleTracks(score));
    this.applyLyrics(visible);
    this.applyChordNames(visible);
    this.applySystemGap(visible);
    api.updateSettings();
    api.renderScore(score, visible.map(t => t.index));
    this.el.diagrams.innerHTML = renderChordDiagrams(this.textModel);
    this.el.text.innerHTML = renderTextView(this.textModel);
    this.textMarks = [...this.el.text.querySelectorAll('[data-t]')].map(el => ({t: Number(el.dataset.t), el}));
    this.scrollMode = api.settings.player.scrollMode;
    this.applyView();
    this.renderTracksMenu();
    if(song.files.includes('audio')) void this.loadMixer(score);
    else this.resolveAudioDuration(null);
    return readScoreInfo(alphaTab, score);
  }

  /**
   * Lädt die Audiospur in den Mixer; Fehler erscheinen in der Statuszeile, der Synth spielt weiter allein.
   * @param {Score} score geladene Noten (mit Sync-Punkten)
   * @returns {Promise<void>}
   */
  async loadMixer(score){
    const mixer = new Mixer(this.alphaTab);
    try {
      this.resolveAudioDuration(await mixer.load(this.slug, score));
    } catch(err){
      this.resolveAudioDuration(null);
      this.setStatus(escapeHtml(err.message));
      return;
    }
    if(!this.api){
      mixer.destroy();
      return;
    }
    mixer.setSpeed(this.prefs.speed);
    mixer.setOffset(Number(localStorage.getItem(OFFSET_KEY_PREFIX + this.slug)) || 0);
    mixer.onState(this.isPlaying);
    this.mixer = mixer;
    this.applyLevels();
    this.applySpeed(this.api.tickPosition, true);
    this.renderPanel();
  }

  /**
   * Erzeugt das MIDI neu, damit es das Tempo der aktuellen Sync-Punkte enthält (nach Änderungen im Sync-Editor). Das
   * hält den Synth an; während der Wiedergabe geschieht es deshalb erst, wenn sie anhält. Die Position bleibt.
   * @param {boolean} [now] auch während der Wiedergabe sofort (z. B. wenn sich die notierten Tempi geändert haben)
   * @returns {void}
   */
  refreshMidi(now = false){
    if(!this.api) return;
    if(this.isPlaying && !now){
      this.midiStale = true;
      return;
    }
    this.midiStale = false;
    const tick = this.api.tickPosition;
    this.api.loadMidiForScore();
    this.api.tickPosition = tick;
    this.applySpeed(tick, true);
  }

  /**
   * Setzt das Abspieltempo von alphaTab: eingestelltes Tempo mal Tempofaktor der Aufnahme an dieser Stelle (siehe
   * Mixer.tempoFactor()), geteilt durch den Faktor, der schon im MIDI steckt. Normalerweise ist das genau das
   * eingestellte Tempo; ohne Audiospur ebenso. Nach Änderungen im Sync-Editor (bis refreshMidi()) ändert es sich
   * während der Wiedergabe nur ab SPEED_CHANGE_MIN, sonst genau.
   * @param {number} tick aktueller MIDI-Tick
   * @param {boolean} [force] auch kleine Änderungen während der Wiedergabe übernehmen (nach einer Einstellung)
   * @returns {void}
   */
  applySpeed(tick, force = false){
    if(!this.api) return;
    const speed = this.mixer
      ? this.prefs.speed * this.mixer.tempoFactor(tick) / recordingTempoAt(this.midiSyncPoints, tick)
      : this.prefs.speed;
    const change = Math.abs(speed / this.api.playbackSpeed - 1);
    if(change > 0.0005 && (force || !this.isPlaying || change >= SPEED_CHANGE_MIN)) this.api.playbackSpeed = speed;
  }

  /**
   * Liest Lautstärke und Stumm der Spuren und der Audiospur dieses Lieds.
   * @returns {{tracks: Object<string, {volume: number, mute: boolean}>, audio: {volume: number, mute: boolean}}}
   */
  loadMix(){
    const mix = {tracks: {}, audio: {volume: 1, mute: false}};
    try {
      Object.assign(mix, JSON.parse(localStorage.getItem(MIX_KEY_PREFIX + this.slug) || '{}'));
    } catch(err){ /* Vorgaben verwenden */ }
    return mix;
  }

  /**
   * Lautstärke und Stumm einer Spur. Mit Audiospur beginnen die Spuren bei 50 %: Der Synth klingt bei gleicher
   * Einstellung deutlich lauter als eine Aufnahme.
   * @param {number} index Index der Spur
   * @returns {{volume: number, mute: boolean}} Eintrag in this.mix, wird bei Bedarf angelegt
   */
  trackMix(index){
    return this.mix.tracks[index] ??= {volume: this.hasAudio ? 0.5 : 1, mute: false};
  }

  /**
   * Setzt alle Lautstärken: je Spur des Synths, Audiospur, Metronom und Vorzähler, jeweils 0 bei Stumm.
   * @returns {void}
   */
  applyLevels(){
    const api = this.api;
    if(!api) return;
    api.metronomeVolume = this.prefs.metronomeMute ? 0 : this.prefs.metronomeVolume;
    api.countInVolume = this.prefs.countInMute ? 0 : this.prefs.countInVolume;
    // Typ ausdrücklich: Über die generische Basisklasse von AlphaTabApi findet die IDE score.tracks sonst nicht.
    /** @type {?Score} */
    const score = api.score;
    for(const track of score?.tracks ?? []){
      const {volume, mute} = this.trackMix(track.index);
      api.changeTrackVolume([track], volume);
      api.changeTrackMute([track], mute);
    }
    this.mixer?.setVolume(this.mix.audio.mute ? 0 : this.mix.audio.volume);
  }

  /**
   * Speichert die Lautstärken und setzt sie.
   * @returns {void}
   */
  saveLevels(){
    localStorage.setItem(MIX_KEY_PREFIX + this.slug, JSON.stringify(this.mix));
    savePrefs(this.prefs);
    this.applyLevels();
  }

  /**
   * Löscht den gespeicherten Audio-Versatz, nachdem der Sync-Editor ihn in die Sync-Punkte übernommen hat.
   * @returns {void}
   */
  clearStoredOffset(){
    localStorage.removeItem(OFFSET_KEY_PREFIX + this.slug);
    this.mixer?.setOffset(0);
  }

  /**
   * Übernimmt eine Lautstärke aus dem Einstellungsfeld, schon beim Ziehen.
   * @param {HTMLInputElement} t Regler mit data-volume ("track:<Index>", "audio", "metronome" oder "countIn")
   * @returns {void}
   */
  onVolumeChange(t){
    const value = Number(t.value);
    const level = this.el.panel.querySelector(`[data-level="${t.dataset.volume}"]`);
    if(level) level.textContent = `${Math.round(value * 100)} %`;
    this.levelOf(t.dataset.volume).set(value);
    this.saveLevels();
  }

  /**
   * Lautstärke und Stumm eines Eintrags im Mischpult.
   * @param {string} key "track:<Index>", "audio", "metronome" oder "countIn"
   * @returns {{volume: number, mute: boolean, set: function(number): void, toggleMute: function(): void}}
   */
  levelOf(key){
    if(key === 'metronome' || key === 'countIn'){
      const prefs = this.prefs;
      return {
        volume: prefs[`${key}Volume`], mute: prefs[`${key}Mute`],
        set: v => { prefs[`${key}Volume`] = v; },
        toggleMute: () => { prefs[`${key}Mute`] = !prefs[`${key}Mute`]; },
      };
    }
    const entry = key === 'audio' ? this.mix.audio : this.trackMix(Number(key.split(':')[1]));
    return {
      volume: entry.volume, mute: entry.mute,
      set: v => { entry.volume = v; },
      toggleMute: () => { entry.mute = !entry.mute; },
    };
  }

  /**
   * Zeigt eine Statusmeldung über den Noten an.
   * @param {string} html Meldung (HTML), leer blendet sie aus
   * @returns {void}
   */
  setStatus(html){
    this.el.status.innerHTML = html;
    this.el.status.hidden = !html;
  }

  /**
   * Stellt Noten und Tabs aller Spuren nach prefs.staves ein ("both" = Noten und Tabs, "tab" = nur Tabs, "score" =
   * nur Noten). Ersetzt das veraltete settings.display.staveProfile: alphaTab steuert das inzwischen je
   * Notensystem. Was die Datei je Spur vorgibt, zählt nicht (aus GP kamen viele Spuren mit nur Tabs, zwei nur mit
   * Rhythmus-Schrägstrichen); seit 29.10.2026 steht es auch nicht mehr in den Dateien.
   * Notensysteme ohne Saiten (z. B. Schlagzeug) haben nur Noten. Neu gezeichnet wird vom Aufrufer.
   * @param {Score} score geladene Noten
   * @returns {void}
   */
  applyStave(score){
    const mode = this.prefs.staves;
    for(const track of score.tracks){
      for(const staff of track.staves){
        staff.showStandardNotation = mode !== 'tab' || !staff.isStringed;
        staff.showTablature = mode !== 'score' && staff.isStringed;
        staff.showSlash = false;
        staff.showNumbered = false;
      }
    }
  }

  /**
   * Wechselt die Ansicht und merkt sich die Wahl für alle Lieder. Eine Notenansicht stellt Noten und Tabs um und
   * zeichnet neu.
   * @param {string} view Ansicht (siehe VIEWS)
   * @returns {void}
   */
  setView(view){
    this.prefs.view = view;
    if(view !== 'chords' && view !== this.prefs.staves){
      this.prefs.staves = view;
      if(this.api?.score){
        this.applyStave(this.api.score);
        this.api.render();
      }
    }
    savePrefs(this.prefs);
    this.showViewControls();
    this.applyView();
  }

  /**
   * Zeigt die Wahl im Umschalter der Kopfzeile; "Spuren" gibt es nur in den Notenansichten.
   * @returns {void}
   */
  showViewControls(){
    const view = this.prefs.view;
    for(const b of this.controls.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    const select = /** @type {HTMLSelectElement} */ (this.controls.querySelector('.view-select'));
    select.value = view;
    const tracksMenu = /** @type {HTMLElement} */ (this.controls.querySelector('.tracks-menu'));
    tracksMenu.hidden = view === 'chords';
    if(view === 'chords') this.toggleTracksMenu(false);
  }

  /**
   * Zeigt die gewählte Ansicht. Die Noten werden in "Chords" nur eingeklappt, nicht ausgeblendet: alphaTab braucht
   * die Breite des Containers zum Zeichnen. "Text & Akkorde" wird beim ersten Aufruf erzeugt und folgt der Größe.
   * @returns {void}
   */
  applyView(){
    const text = this.prefs.view === 'chords';
    this.el.wrap.classList.toggle('collapsed', text);
    this.el.text.hidden = !text;
    // Die Größe gilt nur für den Inhalt (--scale in app.css), Blatt und Leiste behalten ihre Breite.
    this.root.style.setProperty('--scale', String(this.prefs.scale));
    this.el.diagrams.hidden = !this.prefs.diagrams || !this.el.diagrams.hasChildNodes();
    // Erst die Breite der Ansicht ("narrow" in Chords), dann verteilen.
    this.el.diagrams.classList.toggle('narrow', text);
    this.layoutChordDiagrams();
    const api = this.api;
    if(!api?.score) return;
    if(text){
      // Auch beim Wechsel aus einer Notenansicht die aktuelle Stelle zeigen.
      this.textCurrent = -2;
      this.highlightText(api.tickPosition);
    }
    // Sonst scrollt alphaTab beim Abspielen zum Cursor in den eingeklappten Noten.
    api.settings.player.scrollMode = text ? this.alphaTab.ScrollMode.Off : this.scrollMode;
    this.scrolledSystem = -1;
    api.updateSettings();
    this.renderPanel();
  }

  /**
   * Verteilt die Griffbilder gleichmäßig auf die Reihen: Passen höchstens m in eine Reihe, braucht es
   * n = ⌈k / m⌉ Reihen für alle k, und jede Reihe bekommt ⌈k / n⌉ (bei 10 Griffbildern und Platz für 7 also zwei
   * Reihen zu 5 statt 7 + 3). Die Größe (zoom) wirkt nur auf die Bilder, ihre Breite wird deshalb gemessen.
   * @returns {void}
   */
  layoutChordDiagrams(){
    const strip = this.el.diagrams;
    const first = /** @type {?HTMLElement} */ (strip.firstElementChild);
    if(strip.hidden || !first) return;
    const style = getComputedStyle(strip);
    const space = strip.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const gap = parseFloat(style.columnGap) || 0;
    const count = strip.childElementCount;
    const fit = Math.max(1, Math.floor((space + gap) / (first.getBoundingClientRect().width + gap)));
    const rows = Math.ceil(count / fit);
    strip.style.setProperty('--per-row', String(Math.ceil(count / rows)));
  }

  /**
   * Hebt in "Text & Akkorde" beim Abspielen den aktuellen Takt und die aktuelle Silbe hervor und hält sie im Blick.
   * Die Zeiten der Ansicht zählen in Ticks in Abspielreihenfolge wie das MIDI von alphaTab (Wiederholungen
   * ausgeschrieben; Sprünge wie D.S. al Coda kennt die Ansicht noch nicht). Hervorgehoben wird der Teil, dessen Zeit
   * zuletzt erreicht ist: alle Teile von seinem Taktanfang bis zum nächsten, und die letzte Silbe davon, die schon
   * erreicht ist.
   * @param {number} tick aktueller MIDI-Tick
   * @returns {void}
   */
  highlightText(tick){
    const marks = this.textMarks;
    if(this.prefs.view !== 'chords' || !marks.length) return;
    // Letzter Teil mit t <= tick (binäre Suche).
    let lo = 0;
    let hi = marks.length - 1;
    let index = -1;
    while(lo <= hi){
      const mid = (lo + hi) >> 1;
      if(marks[mid].t <= tick){
        index = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if(index === this.textCurrent) return;
    this.textCurrent = index;
    for(const el of this.el.text.querySelectorAll('.tv-now-bar, .tv-now-syl')) el.classList.remove('tv-now-bar', 'tv-now-syl');
    if(index < 0) return;
    let start = index;
    while(start > 0 && !marks[start].el.hasAttribute('data-bar')) start--;
    let end = index + 1;
    while(end < marks.length && !marks[end].el.hasAttribute('data-bar')) end++;
    for(let i = start; i < end; i++) marks[i].el.classList.add('tv-now-bar');
    for(let i = index; i >= start; i--){
      if(!marks[i].el.classList.contains('tv-empty')){
        marks[i].el.classList.add('tv-now-syl');
        break;
      }
    }
    // Im oberen Teil des sichtbaren Bereichs halten: Rutscht die Zeile darüber hinaus oder unter zwei Drittel,
    // kommt sie wieder ins obere Drittel.
    const rect = marks[index].el.closest('.tv-line').getBoundingClientRect();
    const {top, bottom} = this.visibleArea();
    if(rect.top < top || rect.bottom > top + (bottom - top) * 2 / 3) this.scrollLineIntoView(rect.top + window.scrollY, rect.height);
  }

  /**
   * Bereich des Fensters zwischen fester Kopfzeile und Abspielleiste.
   * @returns {{top: number, bottom: number}} Pixel im Fenster
   */
  visibleArea(){
    return {
      top: this.controls.closest('.songbar')?.getBoundingClientRect().bottom ?? 0,
      bottom: this.root.querySelector('.transport')?.getBoundingClientRect().top ?? window.innerHeight,
    };
  }

  /**
   * Scrollt so, dass eine Zeile im oberen Drittel des sichtbaren Bereichs beginnt (SCROLL_POSITION); ist sie zu hoch
   * dafür, weiter oben, mindestens SCROLL_GAP unter der Kopfzeile. Die Seite springt, auch beim Abspielen: Gleitendes
   * Scrollen lenkt beim Spielen eher ab.
   * @param {number} pageTop Oberkante der Zeile in der Seite (px)
   * @param {number} height Höhe der Zeile (px)
   * @returns {void}
   */
  scrollLineIntoView(pageTop, height){
    const {top, bottom} = this.visibleArea();
    const space = bottom - top;
    const offset = Math.max(SCROLL_GAP, Math.min(space * SCROLL_POSITION, space - height - SCROLL_GAP));
    window.scrollTo({top: Math.max(0, pageTop - top - offset), behavior: 'instant'});
  }

  /**
   * Scrollt zur Notenzeile des Cursors, wie alphaTab im Modus "Continuous": nur wenn der Cursor in eine andere Zeile
   * wechselt, die Zeile dann im oberen Drittel (scrollLineIntoView()). In der ersten Zeile geht die Seite
   * ganz nach oben, damit Hinweise und Griffbilder zu sehen sind (alphaTab scrollte auch dort, schon beim Laden).
   * alphaTab ruft das nur auf, solange sein Scroll-Modus nicht "Off" ist (in "Chords" ist er aus).
   * @param {import('../../types/alphatab').rendering.BeatBounds} bounds Lage des aktuellen Schlags
   * @param {boolean} force auch ohne Zeilenwechsel (z. B. nach einem Sprung)
   * @returns {void}
   */
  scrollToSystem(bounds, force){
    const system = bounds.barBounds.masterBarBounds.staffSystemBounds;
    if(!system || (!force && system.index === this.scrolledSystem)) return;
    this.scrolledSystem = system.index;
    if(system.index === 0){
      window.scrollTo({top: 0, behavior: 'instant'});
      return;
    }
    const pageTop = this.el.at.getBoundingClientRect().top + window.scrollY + system.realBounds.y;
    this.scrollLineIntoView(pageTop, system.realBounds.h);
  }

  /**
   * Klick auf eine Silbe, einen Akkord oder einen Taktstrich in "Text & Akkorde": Die Wiedergabe springt dorthin und
   * spielt von dort weiter, wenn sie läuft; sonst beginnt sie dort beim nächsten Start.
   * @param {HTMLElement} target angeklicktes Element
   * @returns {void}
   */
  onTextClick(target){
    const part = /** @type {?HTMLElement} */ (target.closest('[data-t]'));
    if(!part || !this.api) return;
    this.api.tickPosition = Number(part.dataset.t);
    this.highlightText(Number(part.dataset.t));
  }

  /**
   * Füllt das Spuren-Menü der Kopfzeile: je Spur eine Checkbox zum Anzeigen, in der Reihenfolge der Anzeige
   * (orderTracks()).
   * @returns {void}
   */
  renderTracksMenu(){
    const api = this.api;
    if(!api?.score) return;
    const shown = new Set(api.tracks.map(t => t.index));
    this.controls.querySelector('.tracks-pop').innerHTML = this.orderTracks(api.score.tracks).map(t => `
      <label><input type="checkbox" data-track-show="${t.index}"${shown.has(t.index) ? ' checked' : ''}>
        ${escapeHtml(trackLabel(t.name) || `Spur ${t.index + 1}`)}</label>`).join('');
  }

  /**
   * Öffnet oder schließt das Spuren-Menü.
   * @param {boolean} open öffnen
   * @returns {void}
   */
  toggleTracksMenu(open){
    const pop = /** @type {HTMLElement} */ (this.controls.querySelector('.tracks-pop'));
    pop.hidden = !open;
    this.controls.querySelector('.tracks-btn').setAttribute('aria-expanded', String(open));
  }

  /**
   * Klicks in der Kopfzeile: Ansicht wählen, Spuren-Menü öffnen.
   * @param {HTMLElement} t angeklicktes Element
   * @returns {void}
   */
  onControlsClick(t){
    const view = t.closest('[data-view]')?.dataset.view;
    if(view) this.setView(view);
    if(t.closest('.tracks-btn')) this.toggleTracksMenu(this.controls.querySelector('.tracks-pop').hidden);
  }

  /**
   * Änderungen in der Kopfzeile: Ansicht im Dropdown (Handy), angezeigte Spuren.
   * @param {HTMLInputElement} t geändertes Element
   * @returns {void}
   */
  onControlsChange(t){
    if(t.classList.contains('view-select')){
      this.setView(t.value);
    } else if(t.dataset.trackShow !== undefined){
      const api = this.api;
      const checked = [...this.controls.querySelectorAll('[data-track-show]:checked')].map(n => Number(n.dataset.trackShow));
      if(!checked.length){
        t.checked = true;
        return;
      }
      localStorage.setItem(TRACKS_KEY_PREFIX + this.slug, JSON.stringify(checked));
      const tracks = this.orderTracks(checked.map(i => api.score.tracks[i]));
      this.applyLyrics(tracks);
      this.applyChordNames(tracks);
      this.applySystemGap(tracks);
      api.updateSettings();
      api.renderTracks(tracks);
    }
  }

  /**
   * Zeigt die Akkorde über den Noten einmal, an der obersten angezeigten Spur: alle Akkorde des Songs nach der Regel
   * der Konvention zusammengetragen (mergeChords(): bei verschiedenen Akkorden an einer Stelle gewinnt die erste
   * Begleitspur), so wie sie der Editor später in die erste Begleitspur schreibt. alphaTab hängt einen Akkordnamen an
   * einen Schlag; hat die oberste Spur an der Stelle keinen (z. B. weil eine lange Note klingt), kommt er an die
   * nächste angezeigte Spur, die dort einen hat. Dafür werden die Akkorde im geladenen Modell umgehängt (beat.chordId,
   * staff.chords); gespeichert wird dieses Modell nie.
   * @param {Track[]} tracks angezeigte Spuren in der angezeigten Reihenfolge (orderTracks())
   * @returns {void}
   */
  applyChordNames(tracks){
    const score = this.api?.score ?? tracks[0]?.score;
    if(!score) return;
    for(const track of score.tracks) for(const staff of track.staves) for(const bar of staff.bars){
      for(const voice of bar.voices) for(const beat of voice.beats) beat.chordId = null;
    }
    /** @type {Map<number, import('../../types/alphatab').model.Beat>[]} je angezeigter Spur: Tick → erster Schlag */
    const beatsAt = tracks.map(track => {
      const map = new Map();
      for(const staff of track.staves) for(const bar of staff.bars) for(const voice of bar.voices){
        for(const beat of voice.beats){
          const tick = bar.masterBar.start + beat.playbackStart;
          if(!map.has(tick)) map.set(tick, beat);
        }
      }
      return map;
    });
    for(const {tick, chord} of this.mergedChords){
      const beat = beatsAt.map(map => map.get(tick)).find(Boolean);
      if(!beat) continue;
      const staff = beat.voice.bar.staff;
      // Eigener Schlüssel: Unter dem Namen kann die Spur einen anderen Griff haben.
      const id = `gitarrenbuch:${chord.name}`;
      staff.chords ??= new Map();
      staff.chords.set(id, chord);
      beat.chordId = id;
    }
  }

  /**
   * Reihenfolge der angezeigten Spuren: oben die Begleitung (Schlag-, dann Zupfbegleitung; ohne Rollen die erste
   * Begleitspur, chordsTrack(), bestimmt beim Laden, bevor applyChordNames() die Akkorde umhängt), unten die Spur mit
   * dem Text (lyricsTrack()), dazwischen die übrigen wie in der Datei.
   * So stehen die Akkorde oben und der Text unten, wie auf einem Leadsheet. Die Reihenfolge in der Datei bleibt.
   * @param {Track[]} tracks anzuzeigende Spuren
   * @returns {Track[]} dieselben Spuren, sortiert
   */
  orderTracks(tracks){
    const accompaniment = this.accompaniment;
    /** @type {(t: Track) => number} */
    const rank = t => {
      if(t === this.lyricsOwner) return 3;
      const role = trackRole(t);
      if(role === 'strumming') return 0;
      if(role === 'picking') return 1;
      return t === accompaniment ? 1 : 2;
    };
    return [...tracks].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  }

  /**
   * Zeigt den Liedtext nur an einer der angezeigten Spuren: an der Spur mit dem Text (lyricsTrack()), wenn sie
   * angezeigt wird, sonst an der angezeigten Spur mit dem meisten Text. In vielen Songs steht derselbe Text in mehreren
   * Spuren; mehrfach würde er die Noten nur auseinanderdrücken. Geändert wird nur das geladene Modell (beat.lyrics),
   * die Originale stehen in trackLyrics.
   * @param {Track[]} tracks angezeigte Spuren
   * @returns {void}
   */
  applyLyrics(tracks){
    const count = t => this.trackLyrics.get(t)?.length ?? 0;
    const owner = tracks.includes(this.lyricsOwner) && count(this.lyricsOwner)
      ? this.lyricsOwner
      : [...tracks].sort((a, b) => count(b) - count(a))[0];
    for(const [track, beats] of this.trackLyrics){
      for(const [beat, lyrics] of beats) beat.lyrics = track === owner ? lyrics : null;
    }
  }

  /**
   * Abstand zwischen den Notenzeilen nach der Zahl der angezeigten Spuren (SYSTEM_GAP, SYSTEM_GAP_SINGLE). Wirkt
   * beim nächsten Zeichnen; nach dem Laden mit api.updateSettings().
   * @param {Track[]} tracks angezeigte Spuren
   * @returns {void}
   */
  applySystemGap(tracks){
    this.api.settings.display.systemPaddingBottom = tracks.length > 1 ? SYSTEM_GAP : SYSTEM_GAP_SINGLE;
  }

  /**
   * Zuletzt angezeigte Spuren dieses Lieds, sonst die erste Nicht-Schlagzeug-Spur.
   * @param {Score} score geladene Noten
   * @returns {Track[]} anzuzeigende Spuren
   */
  loadVisibleTracks(score){
    let indexes = [];
    try {
      indexes = JSON.parse(localStorage.getItem(TRACKS_KEY_PREFIX + this.slug) || '[]');
    } catch(err){ /* Standard verwenden */ }
    const tracks = indexes.map(i => score.tracks[i]).filter(Boolean);
    return tracks.length ? tracks : [score.tracks.find(t => !t.isPercussion) ?? score.tracks[0]].filter(Boolean);
  }

  /**
   * Passt Play-Button und Wake Lock an den Abspielzustand an.
   * @param {number} state alphaTab.synth.PlayerState
   * @returns {void}
   */
  onStateChanged(state){
    const playing = state === PLAYER_STATE_PLAYING;
    this.el.play.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
    this.el.play.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
    this.mixer?.onState(playing);
    if(playing) void this.requestWakeLock();
    else this.releaseWakeLock();
    if(!playing && this.midiStale) this.refreshMidi();
  }

  /**
   * Aktualisiert Positionsregler und Zeitanzeige.
   * @param {number} current aktuelle Position in ms
   * @param {number} end Gesamtlänge in ms
   * @returns {void}
   */
  onPosition(current, end){
    this.seek.max = String(Math.max(1, Math.round(end)));
    this.seek.value = String(Math.round(current));
    this.el.time.textContent = `${formatTime(current)} / ${formatTime(end)}`;
  }

  /**
   * Bildschirm beim Abspielen anlassen (Handy am Notenständer).
   * @returns {Promise<void>}
   */
  async requestWakeLock(){
    try {
      this.wakeLock ??= await navigator.wakeLock?.request('screen') ?? null;
      this.wakeLock?.addEventListener('release', () => { this.wakeLock = null; });
    } catch(err){ /* nicht unterstützt oder verweigert */ }
  }

  /**
   * Gibt die Wake-Lock-Sperre frei.
   * @returns {void}
   */
  releaseWakeLock(){
    this.wakeLock?.release();
    this.wakeLock = null;
  }

  /**
   * Öffnet bzw. schließt das Einstellungsfeld.
   * @returns {void}
   */
  togglePanel(){
    const open = this.el.panel.hidden;
    this.el.panel.hidden = !open;
    this.el.settings.setAttribute('aria-expanded', String(open));
    if(open) this.renderPanel();
  }

  /**
   * Taktnummer zu einem Tick, für die Anzeige des Loop-Bereichs.
   * @param {number} tick MIDI-Tick
   * @returns {number} Taktnummer (1-basiert)
   */
  barAtTick(tick){
    const bars = this.api.score.masterBars;
    let n = 1;
    for(const mb of bars){
      if(mb.start <= tick) n = mb.index + 1;
    }
    return n;
  }

  /**
   * Zeichnet das Einstellungsfeld neu (nur wenn es offen ist und Noten geladen sind).
   * @returns {void}
   */
  renderPanel(){
    const api = this.api;
    if(!api?.score || this.el.panel.hidden) return;
    const score = api.score;
    const range = api.playbackRange;
    const barCount = score.masterBars.length;
    const fromBar = range ? this.barAtTick(range.startTick) : '';
    const toBar = range ? this.barAtTick(range.endTick - 1) : '';
    const option = (value, label, current) => `<option value="${value}"${String(value) === String(current) ? ' selected' : ''}>${label}</option>`;

    /** @type {(key: string, label: string) => string} */
    const row = (key, label) => {
      const {volume, mute} = this.levelOf(key);
      return `
        <label for="vol-${key}">${escapeHtml(label)}</label>
        <input type="range" id="vol-${key}" min="0" max="1" step="0.05" value="${volume}" data-volume="${key}">
        <output data-level="${key}">${Math.round(volume * 100)} %</output>
        <button class="tbtn small${mute ? ' on' : ''}" type="button" data-mute="${key}" title="Stumm"
          aria-pressed="${mute}">M</button>`;
    };

    this.el.panel.innerHTML = `
      <div class="mix-grid">
        <h4>Lautstärke</h4>
        ${this.orderTracks(score.tracks)
          .map(t => row(`track:${t.index}`, trackLabel(t.name) || `Spur ${t.index + 1}`)).join('')}
        ${this.mixer ? row('audio', 'Audiospur') : ''}
        ${!this.mixer ? '' : !this.mixer.synced
          ? '<div class="hint">Die Noten haben keine Sync-Punkte, die Audiospur kann ihnen noch nicht folgen. Setzen '
            + 'lassen sie sich im Sync-Editor (Menü).</div>'
          : this.mixer.offset ? `<div class="hint">Noch eingestellt: Audio-Versatz ${this.mixer.offset} ms (frühere
            Einstellung). Im Sync-Editor (Menü) lässt er sich in die Sync-Punkte übernehmen.</div>` : ''}
        <h4>Schläge</h4>
        ${row('metronome', 'Metronom')}
        ${row('countIn', 'Vorzähler')}
      </div>
      <h4>Loop-Bereich</h4>
      <div class="panel-row">
        Takt <input type="number" min="1" max="${barCount}" value="${fromBar}" data-range="from" aria-label="Von Takt">
        bis <input type="number" min="1" max="${barCount}" value="${toBar}" data-range="to" aria-label="Bis Takt">
        <button class="tbtn small" type="button" data-range-clear>&times;</button>
      </div>
      ${this.prefs.view === 'chords' ? ''
        : '<div class="hint">Oder im Notenblatt mit der Maus bzw. dem Finger über die Takte ziehen.</div>'}
      <h4>Darstellung</h4>
      <div class="panel-row">
        <select data-pref="scale" aria-label="Größe">
          ${SCALES.map(s => option(s, `${Math.round(s * 100)} %`, this.prefs.scale)).join('')}
        </select>
        <label><input type="checkbox" data-pref="diagrams"${this.prefs.diagrams ? ' checked' : ''}> Griffbilder</label>
      </div>
    `;
  }

  /**
   * Reagiert auf Änderungen im Einstellungsfeld: Loop-Bereich, Größe, Griffbilder (Lautstärken übernimmt schon
   * onVolumeChange()).
   * @param {HTMLInputElement} t geändertes Element
   * @returns {void}
   */
  onPanelChange(t){
    const api = this.api;
    if(t.dataset.range){
      this.applyRangeInputs();
    } else if(t.dataset.pref === 'scale'){
      this.prefs.scale = Number(t.value);
      savePrefs(this.prefs);
      api.settings.display.scale = this.prefs.scale;
      api.updateSettings();
      api.render();
      this.applyView();
    } else if(t.dataset.pref === 'diagrams'){
      this.prefs.diagrams = t.checked;
      savePrefs(this.prefs);
      this.applyView();
    }
  }

  /**
   * Reagiert auf Klicks im Einstellungsfeld: Stumm, Loop-Bereich löschen.
   * @param {HTMLElement} t angeklicktes Element
   * @returns {void}
   */
  onPanelClick(t){
    const api = this.api;
    if(t.dataset.mute){
      this.levelOf(t.dataset.mute).toggleMute();
      this.saveLevels();
      this.renderPanel();
    } else if(t.dataset.rangeClear !== undefined){
      api.playbackRange = null;
      api.clearPlaybackRangeHighlight();
      this.renderPanel();
    }
  }

  /**
   * Loop-Bereich aus den Takt-Eingaben setzen (Takte 1-basiert, beide inklusive).
   * @returns {void}
   */
  applyRangeInputs(){
    const api = this.api;
    const bars = api.score.masterBars;
    /** @type {(name: string) => number} */
    const input = name => Number(/** @type {HTMLInputElement} */ (this.el.panel.querySelector(`[data-range="${name}"]`)).value);
    const from = input('from');
    const to = input('to') || from;
    if(!from || from > bars.length) return;
    const first = bars[from - 1];
    const last = bars[Math.min(Math.max(to, from), bars.length) - 1];
    api.playbackRange = {startTick: first.start, endTick: last.start + last.calculateDuration()};

    // Bereich im Notenblatt markieren wie bei einer Auswahl mit der Maus (erste angezeigte Spur).
    const staff = api.tracks[0]?.staves[0];
    const startBeat = staff?.bars[first.index].voices[0].beats[0];
    const endBeats = staff?.bars[last.index].voices[0].beats;
    if(startBeat && endBeats?.length) api.highlightPlaybackRange(startBeat, endBeats[endBeats.length - 1]);
  }

  /**
   * Gibt alphaTab, Wake Lock und Listener frei und leert das Element.
   * @returns {void}
   */
  destroy(){
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('click', this.onDocumentClick);
    clearTimeout(this.renderStatusTimer);
    this.controls.innerHTML = '';
    this.releaseWakeLock();
    this.mixer?.destroy();
    this.mixer = null;
    this.api?.destroy();
    this.api = null;
    this.root.innerHTML = '';
  }
}
