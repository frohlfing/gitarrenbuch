/**
 * alphaTab-Wrapper: Noten und Tabs anzeigen und mit dem Synthesizer abspielen. Übe-Funktionen: Tempo,
 * Loop über einen Taktbereich, Spuren anzeigen/stumm/solo, Metronom, Vorzähler, Darstellung.
 *
 * alphaTab (rund 1 MB) und der SoundFont werden erst geladen, wenn ein Lied geöffnet wird.
 */

import {escapeHtml, scoreUrl} from './api.js';

/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */
/** @typedef {import('../../types/alphatab').AlphaTabApi} AlphaTabApi */
/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Track} Track */

/** Basis-URL von alphaTab mit Schrift und SoundFont, relativ zu diesem Modul. */
const VENDOR_URL = new URL('../vendor/alphatab/', import.meta.url).href;
/** Schlüssel im localStorage für die Player-Einstellungen (gelten für alle Lieder). */
const PREFS_KEY = 'gitarrenbuch_player';
/** Präfix im localStorage für die angezeigten Spuren je Lied (+ Slug). */
const TRACKS_KEY_PREFIX = 'gitarrenbuch_tracks_';

/**
 * Ladevorgang des alphaTab-Moduls, null bis zum ersten Aufruf von loadAlphaTab().
 * @type {?Promise<AlphaTabModule>}
 */
let alphaTabPromise = null;

/**
 * Lädt das alphaTab-Modul beim ersten Aufruf (Lazy Loading).
 * @returns {Promise<AlphaTabModule>} das Modul
 */
export function loadAlphaTab(){
  alphaTabPromise ??= import('../vendor/alphatab/alphaTab.mjs');
  return alphaTabPromise;
}

/** Dur-Tonarten nach Vorzeichen, Index = Anzahl Kreuze + 7 (wie bar.keySignature + 7). */
const MAJOR_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
/** Moll-Tonarten nach Vorzeichen, Index wie bei MAJOR_KEYS. */
const MINOR_KEYS = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'];

/**
 * Liest Titel, Interpret, Tempo, Tonart, Capo und Stimmung aus einer GP-Datei, ohne sie anzuzeigen.
 * Dient als Angaben für das neue Lied beim Import.
 * @param {File} file Guitar-Pro-Datei
 * @returns {Promise<{title: string, artist: string, tempo: ?number, key: string, capo: number, tuning: string}>}
 *   leere Texte, wenn die Datei die Angabe nicht enthält
 */
export async function readGpMetadata(file){
  const alphaTab = await loadAlphaTab();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(await file.arrayBuffer()));
  const track = score.tracks.find(t => !t.isPercussion) ?? score.tracks[0];
  const staff = track?.staves[0];
  const bar = staff?.bars[0];
  const keys = bar?.keySignatureType === alphaTab.model.KeySignatureType.Minor ? MINOR_KEYS : MAJOR_KEYS;
  // alphaTab führt die Saiten von der höchsten zur tiefsten, üblich ist die Schreibweise von Tief nach Hoch.
  const tuning = staff?.isStringed
    ? staff.tuning.slice().reverse().map(p => alphaTab.model.Tuning.getTextForTuning(p, false)).join(' ')
    : '';
  return {
    title: score.title.trim(),
    artist: score.artist.trim(),
    tempo: score.tempo || null,
    key: bar ? (keys[bar.keySignature + 7] ?? '') : '',
    capo: staff?.capo || 0,
    tuning,
  };
}

/**
 * Liest die Player-Einstellungen, ergänzt um Vorgaben.
 * @returns {{speed: number, metronome: boolean, countIn: boolean, layout: string, stave: string, scale: number}}
 */
function loadPrefs(){
  const defaults = {
    speed: 1, metronome: false, countIn: false, layout: 'Page', stave: 'Default', scale: window.innerWidth < 600 ? 0.75 : 1,
  };
  try {
    return Object.assign(defaults, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
  } catch(err){
    return defaults;
  }
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
 * Wert von alphaTab.synth.PlayerState.Playing. Als Konstante, weil das Modul erst beim Öffnen eines Lieds
 * geladen wird und die IDE das Enum über den dynamischen Import nicht auflöst.
 */
const PLAYER_STATE_PLAYING = 1;

/** Wählbare Abspieltempi (Faktor). */
const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.1, 1.25];
/** Wählbare Größen der Notendarstellung (Faktor). */
const SCALES = [0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5];

/**
 * Notenansicht mit Transportleiste und Einstellungsfeld für ein Lied.
 * Aufruf: const player = new Player(root); await player.load(slug); … player.destroy();
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
  /**
   * Noten-/Tab-Anzeige je Notensystem, wie sie in der Datei steht (für prefs.stave = "Default").
   * @type {Map<Object, {notation: boolean, tab: boolean}>}
   */
  staffDefaults = new Map();

  /**
   * @param {HTMLElement} root leeres Element, in das Notenblatt und Bedienelemente gerendert werden
   */
  constructor(root){
    /** Element, in das gerendert wird. */
    this.root = root;
    root.innerHTML = `
      <div class="score-status" data-ref="status">Noten werden geladen &hellip;</div>
      <div class="score-wrap"><div data-ref="at"></div></div>
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
    this.speed.value = String(this.prefs.speed);
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
   * Lädt alphaTab, den SoundFont und die Noten des Lieds.
   * @param {string} slug Slug des Lieds
   * @returns {Promise<void>} erfüllt, sobald die Noten an alphaTab übergeben sind
   */
  async load(slug){
    this.slug = slug;
    const alphaTab = this.alphaTab = await loadAlphaTab();
    const res = await fetch(scoreUrl(slug));
    if(!res.ok) throw new Error(res.status === 404 ? 'Keine Noten vorhanden.' : `Noten konnten nicht geladen werden (HTTP ${res.status}).`);
    const data = new Uint8Array(await res.arrayBuffer());

    const api = this.api = new alphaTab.AlphaTabApi(this.el.at, {
      core: {fontDirectory: VENDOR_URL + 'font/'},
      display: {
        scale: this.prefs.scale,
        layoutMode: alphaTab.LayoutMode[this.prefs.layout],
      },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
        soundFont: VENDOR_URL + 'soundfont/sonivox.sf2',
        // Platz für die feste Kopfzeile, damit der mitlaufende Cursor nicht darunter verschwindet.
        scrollOffsetY: -80,
      },
    });
    api.metronomeVolume = this.prefs.metronome ? 1 : 0;
    api.countInVolume = this.prefs.countIn ? 1 : 0;
    api.playbackSpeed = this.prefs.speed;

    api.scoreLoaded.on(score => this.onScoreLoaded(score));
    api.renderStarted.on(() => this.setStatus('Noten werden gezeichnet &hellip;'));
    api.renderFinished.on(() => this.setStatus(''));
    api.soundFontLoad.on(e => this.setStatus(`Klänge werden geladen &hellip; ${Math.round(e.loaded / e.total * 100)} %`));
    api.playerReady.on(() => {
      this.el.play.disabled = false;
      this.el.stop.disabled = false;
    });
    api.playerStateChanged.on(e => this.onStateChanged(e.state));
    api.playerPositionChanged.on(e => this.onPosition(e.currentTime, e.endTime));
    api.playbackRangeChanged.on(() => this.renderPanel());
    api.error.on(err => this.setStatus(escapeHtml('Fehler: ' + (err.message || err))));

    this.el.play.addEventListener('click', () => api.playPause());
    this.el.stop.addEventListener('click', () => api.stop());
    this.seek.addEventListener('input', () => { api.timePosition = Number(this.seek.value); });
    this.speed.addEventListener('change', () => {
      api.playbackSpeed = this.prefs.speed = Number(this.speed.value);
      savePrefs(this.prefs);
    });
    this.el.loop.addEventListener('click', () => {
      api.isLooping = !api.isLooping;
      this.el.loop.setAttribute('aria-pressed', String(api.isLooping));
    });
    this.el.settings.addEventListener('click', () => this.togglePanel());
    this.el.panel.addEventListener('change', e => this.onPanelChange(/** @type {HTMLInputElement} */ (e.target)));
    this.el.panel.addEventListener('click', e => this.onPanelClick(/** @type {HTMLElement} */ (e.target)));

    api.load(data);
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
   * Zeigt die gemerkten Spuren an, sobald alphaTab die Noten gelesen hat.
   * @param {Score} score geladene Noten
   * @returns {void}
   */
  onScoreLoaded(score){
    this.applyStave(score);
    const visible = this.loadVisibleTracks(score);
    if(visible.length) this.api.renderTracks(visible);
    this.renderPanel();
  }

  /**
   * Stellt Noten und Tabs nach prefs.stave ein ("Default" = wie in der Datei, "Tab" = nur Tabs, "Score" = nur
   * Noten). Ersetzt das veraltete settings.display.staveProfile: alphaTab steuert das inzwischen je Notensystem.
   * Notensysteme ohne Saiten (z. B. Schlagzeug) behalten bei "Tab" ihre Noten. Neu gezeichnet wird vom Aufrufer.
   * @param {Score} score geladene Noten
   * @returns {void}
   */
  applyStave(score){
    const mode = this.prefs.stave;
    for(const track of score.tracks){
      for(const staff of track.staves){
        if(!this.staffDefaults.has(staff)){
          this.staffDefaults.set(staff, {notation: staff.showStandardNotation, tab: staff.showTablature});
        }
        const original = this.staffDefaults.get(staff);
        if(mode === 'Score' || (mode === 'Tab' && !staff.isStringed)){
          staff.showStandardNotation = true;
          staff.showTablature = false;
        } else if(mode === 'Tab'){
          staff.showStandardNotation = false;
          staff.showTablature = true;
        } else {
          staff.showStandardNotation = original.notation;
          staff.showTablature = original.tab;
        }
      }
    }
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
    if(playing) void this.requestWakeLock();
    else this.releaseWakeLock();
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
    const shown = new Set(api.tracks.map(t => t.index));
    const range = api.playbackRange;
    const barCount = score.masterBars.length;
    const fromBar = range ? this.barAtTick(range.startTick) : '';
    const toBar = range ? this.barAtTick(range.endTick - 1) : '';
    const option = (value, label, current) => `<option value="${value}"${String(value) === String(current) ? ' selected' : ''}>${label}</option>`;

    this.el.panel.innerHTML = `
      <h4>Spuren</h4>
      <ul class="track-list">
        ${score.tracks.map(t => `
          <li>
            <label><input type="checkbox" data-track-show="${t.index}"${shown.has(t.index) ? ' checked' : ''}> ${escapeHtml(t.name || `Spur ${t.index + 1}`)}</label>
            <button class="tbtn small${t.playbackInfo.isMute ? ' on' : ''}" type="button" data-track-mute="${t.index}" title="Stumm">M</button>
            <button class="tbtn small${t.playbackInfo.isSolo ? ' on' : ''}" type="button" data-track-solo="${t.index}" title="Solo">S</button>
          </li>`).join('')}
      </ul>
      <h4>Loop-Bereich</h4>
      <div class="panel-row">
        Takt <input type="number" min="1" max="${barCount}" value="${fromBar}" data-range="from" aria-label="Von Takt">
        bis <input type="number" min="1" max="${barCount}" value="${toBar}" data-range="to" aria-label="Bis Takt">
        <button class="tbtn small" type="button" data-range-clear>&times;</button>
      </div>
      <div class="hint">Oder im Notenblatt mit der Maus bzw. dem Finger über die Takte ziehen.</div>
      <h4>Üben</h4>
      <div class="panel-row">
        <label><input type="checkbox" data-pref="metronome"${this.prefs.metronome ? ' checked' : ''}> Metronom</label>
        <label><input type="checkbox" data-pref="countIn"${this.prefs.countIn ? ' checked' : ''}> Vorzähler</label>
      </div>
      <h4>Darstellung</h4>
      <div class="panel-row">
        <select data-pref="stave" aria-label="Notensystem">
          ${option('Default', 'Noten + Tabs', this.prefs.stave)}
          ${option('Tab', 'Nur Tabs', this.prefs.stave)}
          ${option('Score', 'Nur Noten', this.prefs.stave)}
        </select>
        <select data-pref="layout" aria-label="Layout">
          ${option('Page', 'Seite', this.prefs.layout)}
          ${option('Horizontal', 'Eine Zeile', this.prefs.layout)}
        </select>
        <select data-pref="scale" aria-label="Größe">
          ${SCALES.map(s => option(s, `${Math.round(s * 100)} %`, this.prefs.scale)).join('')}
        </select>
      </div>
    `;
  }

  /**
   * Reagiert auf Änderungen im Einstellungsfeld: Spuren, Loop-Bereich, Üben, Darstellung.
   * @param {HTMLInputElement} t geändertes Element
   * @returns {void}
   */
  onPanelChange(t){
    const api = this.api;
    const alphaTab = this.alphaTab;
    if(t.dataset.trackShow !== undefined){
      const checked = [...this.el.panel.querySelectorAll('[data-track-show]:checked')].map(n => Number(n.dataset.trackShow));
      if(!checked.length){ t.checked = true; return; }
      localStorage.setItem(TRACKS_KEY_PREFIX + this.slug, JSON.stringify(checked));
      api.renderTracks(checked.map(i => api.score.tracks[i]));
    } else if(t.dataset.range){
      this.applyRangeInputs();
    } else if(t.dataset.pref){
      const pref = t.dataset.pref;
      if(pref === 'metronome' || pref === 'countIn'){
        this.prefs[pref] = t.checked;
        if(pref === 'metronome') api.metronomeVolume = t.checked ? 1 : 0;
        else api.countInVolume = t.checked ? 1 : 0;
      } else {
        this.prefs[pref] = pref === 'scale' ? Number(t.value) : t.value;
        api.settings.display.scale = this.prefs.scale;
        api.settings.display.layoutMode = alphaTab.LayoutMode[this.prefs.layout];
        this.applyStave(api.score);
        api.updateSettings();
        api.render();
      }
      savePrefs(this.prefs);
    }
  }

  /**
   * Reagiert auf Klicks im Einstellungsfeld: Stumm, Solo, Loop-Bereich löschen.
   * @param {HTMLElement} t angeklicktes Element
   * @returns {void}
   */
  onPanelClick(t){
    const api = this.api;
    if(t.dataset.trackMute !== undefined){
      const track = api.score.tracks[Number(t.dataset.trackMute)];
      api.changeTrackMute([track], !track.playbackInfo.isMute);
      track.playbackInfo.isMute = !track.playbackInfo.isMute;
      this.renderPanel();
    } else if(t.dataset.trackSolo !== undefined){
      const track = api.score.tracks[Number(t.dataset.trackSolo)];
      api.changeTrackSolo([track], !track.playbackInfo.isSolo);
      track.playbackInfo.isSolo = !track.playbackInfo.isSolo;
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
    this.releaseWakeLock();
    this.api?.destroy();
    this.api = null;
    this.root.innerHTML = '';
  }
}
