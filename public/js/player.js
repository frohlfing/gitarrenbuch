/**
 * alphaTab-Wrapper: Noten und Tabs anzeigen und mit dem Synthesizer abspielen, bei vorhandener audio.mp3 zusammen
 * mit der Audiospur (siehe mixer.js). Übe-Funktionen: Tempo, Loop über einen Taktbereich, Spuren anzeigen/stumm/solo,
 * Metronom, Vorzähler, Darstellung, Lautstärke von Synth und Audiospur.
 *
 * alphaTab (rund 1 MB) und der SoundFont werden erst geladen, wenn ein Lied geöffnet wird.
 */

import {escapeHtml, loadScoreText} from './api.js';
import {Mixer} from './mixer.js';
import {
  applyRecordingTempo, applySongMeta, loadAlphaTab, parseScore, playbackSyncPoints, readScoreInfo, recordingTempoAt,
} from './score.js';

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
/**
 * Präfix im localStorage für den Audio-Versatz je Lied (+ Slug). Stammt aus der Zeit vor dem Sync-Editor, als sich eine
 * Korrektur der Sync-Punkte nur so nach Gehör ausprobieren ließ. Ein gespeicherter Wert wirkt weiter, bis er im
 * Sync-Editor in die Sync-Punkte übernommen ist (siehe clearStoredOffset()).
 */
const OFFSET_KEY_PREFIX = 'gitarrenbuch_audio_offset_';

/**
 * Liest die Player-Einstellungen, ergänzt um Vorgaben.
 * @returns {{speed: number, metronome: boolean, countIn: boolean, stave: string, scale: number, synthVolume: number,
 *   audioVolume: number, metronomeVolume: number}} Lautstärken von 0 bis 1
 */
function loadPrefs(){
  const defaults = {
    speed: 1, metronome: false, countIn: false, stave: 'Default', scale: window.innerWidth < 600 ? 0.75 : 1,
    // Der Synth klingt bei gleicher Einstellung deutlich lauter als eine Aufnahme; Synth 50 % zu Audio 100 % klingt
    // etwa ausgeglichen.
    synthVolume: 0.5, audioVolume: 1, metronomeVolume: 1,
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
 * Zeigt jedes Griffbild mit mindestens einer gegriffenen Saite, leere ("x x x x x x") nicht. Was die Datei je Akkord
 * vorgibt (in GP "Griffbild anzeigen"), zählt nicht: Im Kopf soll jeder angeschlagene Akkord stehen.
 * @param {Score} score geladene Noten
 * @returns {void}
 */
function showChordDiagrams(score){
  for(const track of score.tracks) for(const staff of track.staves){
    for(const chord of staff.chords?.values() ?? []) chord.showDiagram = chord.strings.some(fret => fret >= 0);
  }
}

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
/** Wählbare Größen der Notendarstellung (Faktor). */
const SCALES = [0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5];

/**
 * Notenansicht mit Transportleiste und Einstellungsfeld für ein Lied.
 * Aufruf: const player = new Player(root); const info = await player.load(song); … player.destroy();
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
  /** Audiospur stumm geschaltet (M in der Spurliste; gilt nur, solange das Lied offen ist). */
  audioMute = false;
  /** Audiospur solo geschaltet (S in der Spurliste): Die Spuren des Synths schweigen, das Metronom nicht. */
  audioSolo = false;
  /**
   * Länge der Audiospur in Sekunden, sobald sie geladen ist; null ohne (oder mit unlesbarer) audio.mp3.
   * @type {Promise<?number>}
   */
  audioDuration = new Promise(resolve => { this.resolveAudioDuration = resolve; });

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
    // Ein gespeichertes Tempo, das es in der Auswahl nicht mehr gibt (z. B. 75 %), auf das nächste setzen.
    const saved = this.prefs.speed;
    this.prefs.speed = SPEEDS.reduce((best, s) => Math.abs(s - saved) < Math.abs(best - saved) ? s : best);
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
   * Lädt alphaTab, den SoundFont und die Noten des Lieds (score.atex); Titel und Interpret kommen aus song.json.
   * @param {Song} song Lied
   * @returns {Promise<ScoreInfo>} Eckdaten aus den Noten, sobald diese an alphaTab übergeben sind
   */
  async load(song){
    this.slug = song.slug;
    this.hasAudio = song.files.includes('audio');
    // Nacheinander statt mit Promise.all: Dort verliert die IDE die Typen der einzelnen Ergebnisse.
    const alphaTab = await loadAlphaTab();
    const tex = await loadScoreText(song.slug);
    this.alphaTab = alphaTab;

    const api = this.api = new alphaTab.AlphaTabApi(this.el.at, {
      core: {fontDirectory: VENDOR_URL + 'font/'},
      display: {
        scale: this.prefs.scale,
        layoutMode: alphaTab.LayoutMode.Page,
      },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
        soundFont: VENDOR_URL + 'soundfont/sonivox.sf2',
        // Platz für die feste Kopfzeile, damit der mitlaufende Cursor nicht darunter verschwindet.
        scrollOffsetY: -80,
      },
    });
    this.applyLevels();
    api.playbackSpeed = this.prefs.speed;

    api.renderStarted.on(() => this.setStatus('Noten werden gezeichnet &hellip;'));
    api.renderFinished.on(() => this.setStatus(''));
    api.soundFontLoad.on(e => this.setStatus(`Klänge werden geladen &hellip; ${Math.round(e.loaded / e.total * 100)} %`));
    api.playerReady.on(() => {
      this.el.play.disabled = false;
      this.el.stop.disabled = false;
    });
    api.midiLoad.on(midi => {
      this.midiSyncPoints = this.hasAudio ? playbackSyncPoints(alphaTab, api.score) : [];
      applyRecordingTempo(alphaTab, midi, this.midiSyncPoints);
    });
    api.playerStateChanged.on(e => this.onStateChanged(e.state));
    api.playerPositionChanged.on(e => {
      this.onPosition(e.currentTime, e.endTime);
      this.mixer?.onPosition(e.currentTick, e.isSeek,
        api.playbackSpeed * recordingTempoAt(this.midiSyncPoints, e.currentTick));
      this.applySpeed(e.currentTick);
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
      if(t.dataset.mix) this.onMixChange(t);
    });
    this.el.panel.addEventListener('click', e => this.onPanelClick(/** @type {HTMLElement} */ (e.target)));

    const score = parseScore(alphaTab, tex, api.settings);
    applySongMeta(score, song);
    showChordDiagrams(score);
    this.applyStave(score);
    api.renderScore(score, this.loadVisibleTracks(score).map(t => t.index));
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
   * Setzt alle Lautstärken: Synth, Metronom und Vorzähler (ein Regler für beide), Audiospur. Stumm und Solo der
   * Audiospur wirken wie bei den Spuren des Synths: Solo auf der Audiospur lässt die Synth-Spuren schweigen, Solo auf
   * einer Synth-Spur die Audiospur. Das Metronom bleibt in beiden Fällen hörbar.
   * @returns {void}
   */
  applyLevels(){
    const api = this.api;
    if(!api) return;
    /** @type {?Score} */
    const score = api.score;
    const trackSolo = score ? score.tracks.some(t => t.playbackInfo.isSolo) : false;
    api.masterVolume = this.prefs.synthVolume;
    api.metronomeVolume = this.prefs.metronome ? this.prefs.metronomeVolume : 0;
    api.countInVolume = this.prefs.countIn ? this.prefs.metronomeVolume : 0;
    if(score) api.changeTrackVolume(score.tracks, this.audioSolo && !trackSolo ? 0 : 1);
    const audible = !this.audioMute && (this.audioSolo || !trackSolo);
    this.mixer?.setVolume(audible ? this.prefs.audioVolume : 0);
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
   * Übernimmt die Lautstärke von Synth, Audiospur oder Metronom aus dem Einstellungsfeld.
   * @param {HTMLInputElement} t geändertes Element mit data-mix ("synth", "audio" oder "metronome")
   * @returns {void}
   */
  onMixChange(t){
    const value = Number(t.value);
    const level = this.el.panel.querySelector(`[data-level="${t.dataset.mix}"]`);
    if(level) level.textContent = `${Math.round(value * 100)} %`;
    const pref = {synth: 'synthVolume', audio: 'audioVolume', metronome: 'metronomeVolume'}[t.dataset.mix];
    this.prefs[pref] = value;
    this.applyLevels();
    savePrefs(this.prefs);
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
   * Stellt Noten und Tabs aller Spuren nach prefs.stave ein ("Default" = Noten und Tabs, "Tab" = nur Tabs,
   * "Score" = nur Noten). Ersetzt das veraltete settings.display.staveProfile: alphaTab steuert das inzwischen je
   * Notensystem. Was die Datei je Spur vorgibt, zählt nicht (aus GP kamen viele Spuren mit nur Tabs, zwei nur mit
   * Rhythmus-Schrägstrichen); seit 29.10.2026 steht es auch nicht mehr in den Dateien.
   * Notensysteme ohne Saiten (z. B. Schlagzeug) haben nur Noten. Neu gezeichnet wird vom Aufrufer.
   * @param {Score} score geladene Noten
   * @returns {void}
   */
  applyStave(score){
    const mode = this.prefs.stave;
    for(const track of score.tracks){
      for(const staff of track.staves){
        staff.showStandardNotation = mode !== 'Tab' || !staff.isStringed;
        staff.showTablature = mode !== 'Score' && staff.isStringed;
        staff.showSlash = false;
        staff.showNumbered = false;
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
        ${this.mixer ? `
          <li>
            <label><input type="checkbox" checked disabled> Audiospur</label>
            <button class="tbtn small${this.audioMute ? ' on' : ''}" type="button" data-audio-mute title="Stumm">M</button>
            <button class="tbtn small${this.audioSolo ? ' on' : ''}" type="button" data-audio-solo title="Solo">S</button>
          </li>` : ''}
      </ul>
      <h4>Üben</h4>
      <div class="panel-row">
        <label><input type="checkbox" data-pref="metronome"${this.prefs.metronome ? ' checked' : ''}> Metronom</label>
        <label><input type="checkbox" data-pref="countIn"${this.prefs.countIn ? ' checked' : ''}> Vorzähler</label>
      </div>
      <h4>Loop-Bereich</h4>
      <div class="panel-row">
        Takt <input type="number" min="1" max="${barCount}" value="${fromBar}" data-range="from" aria-label="Von Takt">
        bis <input type="number" min="1" max="${barCount}" value="${toBar}" data-range="to" aria-label="Bis Takt">
        <button class="tbtn small" type="button" data-range-clear>&times;</button>
      </div>
      <div class="hint">Oder im Notenblatt mit der Maus bzw. dem Finger über die Takte ziehen.</div>
      <h4>Lautstärke</h4>
      <div class="mix-grid">
        ${[['synth', 'Synth', this.prefs.synthVolume], ...(this.mixer ? [['audio', 'Audio', this.prefs.audioVolume]] : []),
          ['metronome', 'Metronom', this.prefs.metronomeVolume]].map(([key, label, value]) => `
          <label for="mix-${key}">${label}</label>
          <input type="range" id="mix-${key}" min="0" max="1" step="0.05" value="${value}" data-mix="${key}">
          <output data-level="${key}">${Math.round(value * 100)} %</output>`).join('')}
      </div>
      ${!this.mixer ? '' : !this.mixer.synced
        ? '<div class="hint">Die Noten haben keine Sync-Punkte, die Audiospur kann ihnen noch nicht folgen. Setzen '
          + 'lassen sie sich im Sync-Editor (Menü).</div>'
        : this.mixer.offset ? `<div class="hint">Noch eingestellt: Audio-Versatz ${this.mixer.offset} ms (frühere
          Einstellung). Im Sync-Editor (Menü) lässt er sich in die Sync-Punkte übernehmen.</div>` : ''}
      <h4>Darstellung</h4>
      <div class="panel-row">
        <select data-pref="stave" aria-label="Notensystem">
          ${option('Default', 'Noten + Tabs', this.prefs.stave)}
          ${option('Tab', 'Nur Tabs', this.prefs.stave)}
          ${option('Score', 'Nur Noten', this.prefs.stave)}
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
    if(t.dataset.mix){
      // Lautstärken übernimmt onMixChange() schon beim input-Ereignis.
    } else if(t.dataset.trackShow !== undefined){
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
        this.applyLevels();
      } else {
        this.prefs[pref] = pref === 'scale' ? Number(t.value) : t.value;
        api.settings.display.scale = this.prefs.scale;
        this.applyStave(api.score);
        api.updateSettings();
        api.render();
      }
      savePrefs(this.prefs);
    }
  }

  /**
   * Reagiert auf Klicks im Einstellungsfeld: Stumm, Solo (auch der Audiospur), Loop-Bereich löschen.
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
      this.applyLevels();
      this.renderPanel();
    } else if(t.dataset.audioMute !== undefined){
      this.audioMute = !this.audioMute;
      this.applyLevels();
      this.renderPanel();
    } else if(t.dataset.audioSolo !== undefined){
      this.audioSolo = !this.audioSolo;
      this.applyLevels();
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
    this.mixer?.destroy();
    this.mixer = null;
    this.api?.destroy();
    this.api = null;
    this.root.innerHTML = '';
  }
}
