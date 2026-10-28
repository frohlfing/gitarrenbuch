/**
 * Mixer: Synthesizer von alphaTab und Audiospur (audio.mp3) gleichzeitig. alphaTab kann beides nicht zusammen
 * abspielen (die Audiospur ersetzt dort den Synth); deshalb läuft die Audiospur in einem eigenen <audio>-Element und
 * folgt der Synth-Position. Die Sync-Punkte in den Noten (\sync) rechnen die Synth-Position in Audio-Zeit um.
 *
 * Der Synth spielt im notierten Tempo, die Aufnahme oft in einem anderen (z. B. "Junge": notiert 105, Aufnahme 211
 * BPM). Wie Guitar Pro passt deshalb tempoFactor() das Abspieltempo des Synths je Abschnitt zwischen zwei
 * Sync-Punkten an die Aufnahme an; der Player multipliziert es mit dem eingestellten Tempo.
 *
 * Nachführung wie im Prototyp vom 26.10.2026 erprobt: Die Abweichung wird als Median über SAMPLE_WINDOW_MS geglättet.
 * Kleine Abweichungen gleicht eine um bis zu MAX_RATE_CHANGE veränderte playbackRate aus, große ein Sprung.
 */

import {loadAudio} from './api.js';

/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */
/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').synth.BackingTrackSyncPoint} BackingTrackSyncPoint */

/** alphaTab: MIDI-Ticks pro Viertelnote. */
const QUARTER_TICKS = 960;
/** Zeitfenster für den Median der Abweichung. */
const SAMPLE_WINDOW_MS = 500;
/** Mindestanzahl Messwerte im Zeitfenster, bevor nachgeführt wird. */
const MIN_SAMPLES = 5;
/** Nach Start oder Sprung braucht das <audio>-Element einen Moment, bis currentTime gleichmäßig läuft. */
const SETTLE_MS = 500;
/** Ab dieser Abweichung wird die playbackRate angepasst. */
const RATE_THRESHOLD_MS = 30;
/** Ab dieser Abweichung wird gesprungen, höchstens einmal je SEEK_INTERVAL_MS. */
const SEEK_THRESHOLD_MS = 300;
/** Ab dieser Abweichung wird sofort gesprungen (z. B. beim Loop zurück an den Anfang des Bereichs). */
const JUMP_THRESHOLD_MS = 1000;
/** Mindestabstand zwischen zwei Sprüngen. */
const SEEK_INTERVAL_MS = 1000;
/** Größte Änderung der playbackRate beim Nachführen (Anteil). */
const MAX_RATE_CHANGE = 0.05;

/**
 * Median einer Zahlenliste.
 * @param {number[]} values Werte (werden nicht verändert)
 * @returns {number} oberer Median bei gerader Anzahl
 */
function median(values){
  const v = values.slice().sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

/**
 * Audiospur eines Lieds, die dem Synth von alphaTab folgt.
 * Aufruf: const mixer = new Mixer(alphaTab); await mixer.load(slug, score); dann onPosition()/onState() aus den
 * Ereignissen von alphaTab aufrufen; zum Schluss destroy().
 */
export class Mixer {
  /** Element, das die Audiospur abspielt. */
  audio = new Audio();
  /**
   * Sync-Punkte, aufsteigend nach Synth-Tick; leer, wenn die Noten keine haben.
   * @type {BackingTrackSyncPoint[]}
   */
  syncPoints = [];
  /** Abspieltempo (Faktor), wie bei alphaTab eingestellt. */
  speed = 1;
  /** Fester Versatz der Audiospur in ms (positiv: Audio später), zum Ausprobieren einer Korrektur. */
  offset = 0;
  /**
   * Abweichungen der letzten SAMPLE_WINDOW_MS (Audio-Position minus erwartete Position, ms).
   * @type {{t: number, drift: number}[]}
   */
  samples = [];
  /** Zeitpunkt (performance.now()), bis zu dem nach Start oder Sprung nicht gemessen wird. */
  settleUntil = 0;
  /** Zeitpunkt (performance.now()) des letzten Sprungs. */
  lastSeek = 0;
  /** Ob der Synth gerade spielt. */
  playing = false;
  /** Ob beim nächsten Positionsereignis gesprungen wird (nach einer Änderung des Versatzes). */
  forceSeek = false;
  /**
   * Object-URL der geladenen MP3, null vor load().
   * @type {?string}
   */
  objectUrl = null;

  /**
   * @param {AlphaTabModule} alphaTab alphaTab-Modul (für die Sync-Punkte)
   */
  constructor(alphaTab){
    /** alphaTab-Modul. */
    this.alphaTab = alphaTab;
    this.audio.preservesPitch = true;
  }

  /**
   * Ob die Audiospur den Noten folgen kann (die Noten haben Sync-Punkte).
   * @returns {boolean}
   */
  get synced(){
    return this.syncPoints.length > 0;
  }

  /**
   * Lädt die Audiospur und liest die Sync-Punkte aus den Noten. Die MP3 wird ganz geladen (rund 2 MB), damit der
   * Browser darin springen kann; api/audio.php beantwortet noch keine Range-Anfragen.
   * @param {string} slug Slug des Lieds
   * @param {Score} score Noten mit \sync
   * @returns {Promise<number>} Länge der Audiospur in Sekunden
   */
  async load(slug, score){
    const bytes = await loadAudio(slug);
    this.objectUrl = URL.createObjectURL(new Blob([bytes], {type: 'audio/mpeg'}));
    const metadata = new Promise((resolve, reject) => {
      this.audio.addEventListener('loadedmetadata', () => resolve(this.audio.duration), {once: true});
      this.audio.addEventListener('error', () => reject(new Error('Audiospur nicht lesbar')), {once: true});
    });
    this.audio.src = this.objectUrl;
    this.setScore(score);
    return metadata;
  }

  /**
   * Übernimmt die Sync-Punkte aus den Noten (nach dem Laden oder wenn sich die Noten ändern).
   * @param {Score} score Noten
   * @returns {void}
   */
  setScore(score){
    const hasSync = score.masterBars.some(mb => mb.syncPoints?.length);
    this.syncPoints = hasSync
      ? this.alphaTab.midi.MidiFileGenerator.generateSyncPoints(score).sort((a, b) => a.synthTick - b.synthTick)
      : [];
    // Der letzte Sync-Punkt (Ende der Noten) hat kein Tempo mehr: das des vorigen Abschnitts weiterverwenden.
    for(const [i, p] of this.syncPoints.entries()){
      if(p.syncBpm <= 0 && i > 0) p.syncBpm = this.syncPoints[i - 1].syncBpm;
    }
  }

  /**
   * Sync-Punkt am Anfang des Abschnitts, in dem ein Tick liegt (vor dem ersten Sync-Punkt: der erste).
   * @param {number} tick MIDI-Tick
   * @returns {BackingTrackSyncPoint}
   */
  segmentAt(tick){
    let sp = this.syncPoints[0];
    for(const p of this.syncPoints){
      if(p.synthTick <= tick) sp = p;
      else break;
    }
    return sp;
  }

  /**
   * MIDI-Tick des Synths -> erwartete Position in der Audiospur, linear zwischen den Sync-Punkten.
   * @param {number} tick MIDI-Tick
   * @returns {number} Position in ms (negativ, solange die Audiospur noch nicht eingesetzt hat)
   */
  tickToAudioMs(tick){
    const sp = this.segmentAt(tick);
    return sp.syncTime + (tick - sp.synthTick) / QUARTER_TICKS * 60000 / sp.syncBpm + this.offset;
  }

  /**
   * Faktor, um den der Synth an dieser Stelle schneller spielen muss, damit er mit der Aufnahme Schritt hält.
   * @param {number} tick MIDI-Tick
   * @returns {number} Tempo der Aufnahme geteilt durch das notierte Tempo; 1 ohne Sync-Punkte
   */
  tempoFactor(tick){
    if(!this.synced) return 1;
    const sp = this.segmentAt(tick);
    return sp.synthBpm > 0 && sp.syncBpm > 0 ? sp.syncBpm / sp.synthBpm : 1;
  }

  /**
   * Setzt die Audiospur auf eine Position und setzt die Messung kurz aus.
   * @param {number} ms Position in der Audiospur
   * @returns {void}
   */
  seekAudio(ms){
    this.audio.currentTime = Math.max(0, ms / 1000);
    this.audio.playbackRate = this.speed;
    this.samples = [];
    this.lastSeek = performance.now();
    this.settleUntil = this.lastSeek + SETTLE_MS;
  }

  /**
   * Abspielzustand des Synths übernehmen.
   * @param {boolean} playing ob der Synth spielt
   * @returns {void}
   */
  onState(playing){
    this.playing = playing;
    // Gestartet wird die Audiospur in onPosition(), sobald ihre Position erreicht ist.
    if(!playing) this.audio.pause();
  }

  /**
   * Folgt der Synth-Position (Ereignis playerPositionChanged von alphaTab).
   * @param {number} tick aktueller MIDI-Tick
   * @param {boolean} isSeek ob die Position durch Spulen entstanden ist
   * @returns {void}
   */
  onPosition(tick, isSeek){
    if(!this.synced) return;
    const expected = this.tickToAudioMs(tick);
    if(!this.playing || isSeek){
      this.audio.pause();
      this.seekAudio(expected);
      return;
    }
    // Negative Position: Die Audiospur setzt erst später ein (in GP8 ein Padding vor dem Audio).
    if(expected < 0){
      if(!this.audio.paused) this.audio.pause();
      this.audio.currentTime = 0;
      return;
    }
    if(this.audio.paused || this.forceSeek){
      this.forceSeek = false;
      this.seekAudio(expected);
      void this.audio.play().catch(() => { /* Autoplay verweigert: läuft ab der nächsten Nutzeraktion */ });
      return;
    }
    const now = performance.now();
    if(now < this.settleUntil) return;

    this.samples.push({t: now, drift: this.audio.currentTime * 1000 - expected});
    this.samples = this.samples.filter(x => x.t > now - SAMPLE_WINDOW_MS);
    const latest = this.samples[this.samples.length - 1].drift;
    if(Math.abs(latest) > JUMP_THRESHOLD_MS){
      this.seekAudio(expected);
      return;
    }
    if(this.samples.length < MIN_SAMPLES) return;
    const drift = median(this.samples.map(x => x.drift));
    const abs = Math.abs(drift);
    if(abs > SEEK_THRESHOLD_MS && now - this.lastSeek > SEEK_INTERVAL_MS){
      this.seekAudio(expected);
    } else if(abs > RATE_THRESHOLD_MS){
      // Audio läuft vor (drift > 0) -> etwas langsamer, sonst schneller.
      const change = Math.max(-MAX_RATE_CHANGE, Math.min(MAX_RATE_CHANGE, drift / 2000));
      this.audio.playbackRate = this.speed * (1 - change);
    } else {
      this.audio.playbackRate = this.speed;
    }
  }

  /**
   * Abspieltempo übernehmen (wie alphaTab.playbackSpeed); die Tonhöhe bleibt.
   * @param {number} speed Faktor
   * @returns {void}
   */
  setSpeed(speed){
    this.speed = speed;
    this.audio.playbackRate = speed;
    this.samples = [];
  }

  /**
   * Lautstärke der Audiospur.
   * @param {number} volume 0 bis 1
   * @returns {void}
   */
  setVolume(volume){
    this.audio.volume = volume;
  }

  /**
   * Versatz der Audiospur ändern; wirkt beim nächsten Positionsereignis (bei Bedarf mit Sprung).
   * @param {number} ms Versatz in ms (positiv: Audio später)
   * @returns {void}
   */
  setOffset(ms){
    this.offset = ms;
    this.forceSeek = true;
  }

  /**
   * Hält die Audiospur an und gibt die MP3 frei.
   * @returns {void}
   */
  destroy(){
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if(this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
