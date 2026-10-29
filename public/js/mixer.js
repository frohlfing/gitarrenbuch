/**
 * Mixer: Synthesizer von alphaTab und Audiospur (audio.mp3) gleichzeitig. alphaTab kann beides nicht zusammen
 * abspielen (die Audiospur ersetzt dort den Synth); deshalb läuft die Audiospur in einem eigenen <audio>-Element und
 * folgt der Synth-Position. Die Sync-Punkte in den Noten (\sync) rechnen die Synth-Position in Audio-Zeit um.
 *
 * Der Synth spielt im notierten Tempo, die Aufnahme oft in einem anderen (z. B. "Junge": notiert 105, Aufnahme 211
 * BPM). Wie in Guitar Pro folgt der Synth deshalb je Abschnitt zwischen zwei Sync-Punkten dem Tempo der Aufnahme
 * (tempoFactor()): Der Player schreibt es beim Laden in das MIDI (applyRecordingTempo() in score.js). Nur solange
 * Sync-Punkte im Sync-Editor geändert und noch nicht ins MIDI übernommen sind, gleicht der Player mit dem
 * Abspieltempo von alphaTab aus, dann aber erst ab SPEED_CHANGE_MIN (player.js); kleinere Unterschiede holt die
 * Audiospur je Abschnitt auf (baseRate).
 *
 * Nachführung: Die Abweichung wird als Median über SAMPLE_WINDOW_MS geglättet. Kleine Abweichungen gleicht eine um
 * RATE_STEP veränderte playbackRate aus, große ein Sprung. Die Rate ändert sich dabei so selten wie möglich: Jede
 * Änderung ist hörbar, weil der Browser die Tonhöhenkorrektur neu einstellt (eine stufenlos nachgeführte Rate änderte
 * sich bis zu 15-mal pro Sekunde, die Audiospur hakte und ruckelte).
 */

import {loadAudio} from './api.js';
import {playbackSyncPoints, QUARTER_TICKS, recordingTempoAt, syncSegmentAt} from './score.js';

/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */
/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').synth.BackingTrackSyncPoint} BackingTrackSyncPoint */

/** Zeitfenster für den Median der Abweichung. */
const SAMPLE_WINDOW_MS = 500;
/** Mindestanzahl Messwerte im Zeitfenster, bevor nachgeführt wird. */
const MIN_SAMPLES = 5;
/** Mindestabstand zwischen zwei Messungen (alphaTab meldet die Position mehrere hundert Mal pro Sekunde). */
const SAMPLE_INTERVAL_MS = 25;
/** Nach Start oder Sprung braucht das <audio>-Element einen Moment, bis currentTime gleichmäßig läuft. */
const SETTLE_MS = 500;
/** Ab dieser Abweichung wird die playbackRate angepasst. */
const RATE_THRESHOLD_MS = 40;
/** Unter dieser Abweichung kehrt die playbackRate zum eingestellten Tempo zurück (Hysterese). */
const RATE_RELEASE_MS = 10;
/** Ab dieser Abweichung wird gesprungen, höchstens einmal je SEEK_INTERVAL_MS. */
const SEEK_THRESHOLD_MS = 300;
/** Ab dieser Abweichung wird sofort gesprungen (z. B. beim Loop zurück an den Anfang des Bereichs). */
const JUMP_THRESHOLD_MS = 1000;
/** Mindestabstand zwischen zwei Sprüngen. */
const SEEK_INTERVAL_MS = 1000;
/**
 * Änderung der playbackRate beim Nachführen (Anteil), fest statt stufenlos. Muss größer sein als SPEED_CHANGE_MIN im
 * Player: Bis dahin stellt der Player das Tempo des Synths nicht um, die Audiospur muss den Unterschied aufholen.
 */
const RATE_STEP = 0.04;
/** Obergrenze für die gemessene Verzögerung beim Start der Audiospur (siehe Mixer.startLatency). */
const MAX_START_LATENCY_MS = 300;

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
  /** Abspieltempo (Faktor), wie im Player eingestellt. */
  speed = 1;
  /**
   * Abspielrate der Audiospur ohne Korrektur: eingestelltes Tempo, angepasst an das tatsächliche Tempo des Synths im
   * aktuellen Abschnitt (siehe onPosition()).
   */
  baseRate = 1;
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
  /** Laufende Korrektur der playbackRate: 1 = Audio langsamer (läuft vor), -1 = schneller, 0 = keine. */
  correction = 0;
  /**
   * Verzögerung in ms, mit der die Audiospur nach play() losläuft (gemessen beim vorigen Start); um so viel weiter
   * hinten setzt sie beim nächsten Start ein, damit sie nicht erst nachgeführt werden muss.
   */
  startLatency = 0;
  /** Ob die nächste vollständige Messung die Verzögerung beim Start ermittelt. */
  measureStart = false;
  /**
   * Object-URL der geladenen MP3, null vor load().
   * @type {?string}
   */
  objectUrl = null;
  /**
   * Inhalt der geladenen MP3 (für die Wellenform im Sync-Editor), null vor load().
   * @type {?Uint8Array}
   */
  bytes = null;

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
    const bytes = this.bytes = await loadAudio(slug);
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
   * Übernimmt die Sync-Punkte aus den Noten (nach dem Laden oder wenn sich die Noten ändern, z. B. im Sync-Editor).
   * Spielt der Synth gerade, springt die Audiospur beim nächsten Positionsereignis an die neue Stelle.
   * @param {Score} score Noten
   * @returns {void}
   */
  setScore(score){
    this.forceSeek = true;
    this.syncPoints = playbackSyncPoints(this.alphaTab, score);
  }

  /**
   * MIDI-Tick des Synths -> erwartete Position in der Audiospur, linear zwischen den Sync-Punkten.
   * @param {number} tick MIDI-Tick
   * @returns {number} Position in ms (negativ, solange die Audiospur noch nicht eingesetzt hat)
   */
  tickToAudioMs(tick){
    const sp = syncSegmentAt(this.syncPoints, tick);
    return sp.syncTime + (tick - sp.synthTick) / QUARTER_TICKS * 60000 / sp.syncBpm + this.offset;
  }

  /**
   * Position in der Audiospur -> MIDI-Tick des Synths (Umkehrung von tickToAudioMs(), ohne Versatz). Vor dem ersten
   * Sync-Punkt wird der erste Abschnitt rückwärts verlängert, nach dem letzten der letzte.
   * @param {number} ms Position in der Audiospur
   * @returns {number} MIDI-Tick (nicht kleiner als 0)
   */
  audioMsToTick(ms){
    let sp = this.syncPoints[0];
    for(const p of this.syncPoints){
      if(p.syncTime <= ms) sp = p;
      else break;
    }
    if(!sp) return 0;
    return Math.max(0, sp.synthTick + (ms - sp.syncTime) * sp.syncBpm * QUARTER_TICKS / 60000);
  }

  /**
   * Faktor, um den der Synth an dieser Stelle schneller spielen muss, damit er mit der Aufnahme Schritt hält.
   * @param {number} tick MIDI-Tick
   * @returns {number} Tempo der Aufnahme geteilt durch das notierte Tempo; 1 ohne Sync-Punkte
   */
  tempoFactor(tick){
    return recordingTempoAt(this.syncPoints, tick);
  }

  /**
   * Setzt die Audiospur auf eine Position und setzt die Messung kurz aus.
   * @param {number} ms Position in der Audiospur
   * @returns {void}
   */
  seekAudio(ms){
    this.audio.currentTime = Math.max(0, ms / 1000);
    this.audio.playbackRate = this.baseRate;
    this.correction = 0;
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
   * @param {number} [synthSpeed] tatsächliches Tempo des Synths bezogen auf das notierte (playbackSpeed von alphaTab
   * mal dem Tempofaktor, der im MIDI steckt), sonst das eingestellte mal tempoFactor()
   * @returns {void}
   */
  onPosition(tick, isSeek, synthSpeed = this.speed * this.tempoFactor(tick)){
    if(!this.synced) return;
    // Spielt der Synth nicht genau im Tempo der Aufnahme, läuft die Audiospur um denselben Anteil anders; die Rate
    // ändert sich so nur an den Sync-Punkten statt ständig über die Korrektur.
    const baseRate = synthSpeed / this.tempoFactor(tick);
    if(Math.abs(baseRate - this.baseRate) > 0.0005){
      this.baseRate = baseRate;
      this.audio.playbackRate = baseRate * (1 - this.correction * RATE_STEP);
    }
    const expected = this.tickToAudioMs(tick);
    // alphaTab meldet auch beim Umstellen des Abspieltempos einen Sprung; liegt die Audiospur noch richtig, läuft sie
    // ohne Unterbrechung weiter (Anhalten und neu Ansetzen wäre als Aussetzer hörbar).
    const inPlace = this.playing && !this.audio.paused
      && Math.abs(this.audio.currentTime * 1000 - expected) < SEEK_THRESHOLD_MS;
    if(isSeek && inPlace){
      this.samples = [];
      return;
    }
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
      this.seekAudio(expected + (this.audio.paused ? this.startLatency : 0));
      this.measureStart = this.audio.paused;
      void this.audio.play().catch(() => { /* Autoplay verweigert: läuft ab der nächsten Nutzeraktion */ });
      return;
    }
    const now = performance.now();
    if(now < this.settleUntil || now - (this.samples.at(-1)?.t ?? 0) < SAMPLE_INTERVAL_MS) return;

    this.samples.push({t: now, drift: this.audio.currentTime * 1000 - expected});
    this.samples = this.samples.filter(x => x.t > now - SAMPLE_WINDOW_MS);
    const latest = this.samples[this.samples.length - 1].drift;
    if(Math.abs(latest) > JUMP_THRESHOLD_MS){
      this.seekAudio(expected);
      return;
    }
    if(this.samples.length < MIN_SAMPLES) return;
    const drift = median(this.samples.map(x => x.drift));
    if(this.measureStart){
      // Erste Messung nach dem Start: Um so viel lief die Audiospur verspätet los; beim nächsten Start ausgleichen.
      this.measureStart = false;
      this.startLatency = Math.min(MAX_START_LATENCY_MS, Math.max(0, this.startLatency - drift));
    }
    const abs = Math.abs(drift);
    if(abs > SEEK_THRESHOLD_MS && now - this.lastSeek > SEEK_INTERVAL_MS){
      this.seekAudio(expected);
      return;
    }
    // Audio läuft vor (drift > 0) -> etwas langsamer, sonst schneller. Erst ab RATE_THRESHOLD_MS, dann bis unter
    // RATE_RELEASE_MS; dazwischen bleibt es, wie es ist.
    const correction = abs > RATE_THRESHOLD_MS ? Math.sign(drift) : abs < RATE_RELEASE_MS ? 0 : this.correction;
    if(correction !== this.correction){
      this.correction = correction;
      this.audio.playbackRate = this.baseRate * (1 - correction * RATE_STEP);
    }
  }

  /**
   * Abspieltempo übernehmen (wie alphaTab.playbackSpeed); die Tonhöhe bleibt.
   * @param {number} speed Faktor
   * @returns {void}
   */
  setSpeed(speed){
    this.speed = speed;
    this.baseRate = speed;
    this.correction = 0;
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
