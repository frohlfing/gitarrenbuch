/**
 * Wiedergabe: Player (alphaTab), Mixer mit der Audiospur und Sync-Editor.
 */

import {
  chordDiagramSvg, creditHtml, escapeHtml, formatTime, hideAttribution, loadAudio, loadLeadsheet, loadPatterns,
  loadScoreText, markPlayed, useCreditLogos,
} from './base.js';
import {
  applyRecordingTempo, applySongMeta, joinSyllables, loadAlphaTab, lyricsTrack, mergeChords, parseScore,
  playbackSyncPoints, QUARTER_TICKS, readScoreInfo, recordingTempoAt, recordingTempoRegion, sortSyncPoints,
  stringedStaves, syncSegmentAt, timeline, trackName,
} from './notation.js';
import {deriveBar, patternGridHtml, similarity, slotCount, TECHNIQUES} from './sheet.js';
import {buildTextModel, playTimeline, renderTextView} from './textview.js';

/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */
/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').synth.BackingTrackSyncPoint} BackingTrackSyncPoint */
/** @typedef {import('../../types/alphatab').AlphaTabApi} AlphaTabApi */
/** @typedef {import('../../types/alphatab').model.Track} Track */
/** @typedef {import('./base.js').Song} Song */
/** @typedef {import('./notation.js').ScoreInfo} ScoreInfo */
/** @typedef {import('../../types/alphatab').model.FlatSyncPoint} FlatSyncPoint */
/** @typedef {import('../../types/alphatab').midi.MasterBarTickLookup} MasterBarTickLookup */

// --------------------------------------------------------------------------------------------------------------------
// Mixer und Audiospur
// --------------------------------------------------------------------------------------------------------------------

/**
 * Mixer: Synthesizer von alphaTab und Audiospur (audio.mp3) gleichzeitig. alphaTab kann beides nicht zusammen
 * abspielen (die Audiospur ersetzt dort den Synth); deshalb spielt der Mixer die Audiospur selbst und folgt der
 * Synth-Position. Die Sync-Punkte in den Noten (\sync) rechnen die Synth-Position in Audio-Zeit um.
 *
 * Abgespielt wird über Web Audio mit Signalsmith Stretch (vendor/signalsmith, Zeitdehnung im AudioWorklet): Die
 * Audiospur wird ganz dekodiert in den Knoten geladen und dort mit einer Rate gespielt, die Tonhöhe bleibt. Ein <audio>-
 * Element mit preservesPitch klingt bei langsamem Tempo (unter etwa 70 %) deutlich schlechter, und jede Änderung seiner
 * Rate war hörbar; hier lässt sich die Rate beliebig oft ändern.
 *
 * Der Synth spielt im notierten Tempo, die Audiospur oft in einem anderen (z. B. "Junge": notiert 105, Audiospur 211
 * BPM). Wie in Guitar Pro folgt der Synth deshalb je Abschnitt zwischen zwei Sync-Punkten dem Tempo der Audiospur
 * (tempoFactor()): Der Player schreibt es beim Laden in das MIDI (applyRecordingTempo() in notation.js). Nur solange
 * Sync-Punkte im Sync-Editor geändert und noch nicht ins MIDI übernommen sind, gleicht der Player mit dem
 * Abspieltempo von alphaTab aus, dann aber erst ab SPEED_CHANGE_MIN (playback.js); kleinere Unterschiede holt die
 * Audiospur je Abschnitt auf (baseRate).
 *
 * Nachführung: Die Position der Audiospur ergibt sich aus der Uhr des AudioContext (Anker: Position, Zeit und Rate beim
 * letzten Setzen). Ihre Abweichung von der erwarteten Position wird als Median über SAMPLE_WINDOW_MS geglättet. Kleine
 * Abweichungen gleicht eine um RATE_STEP veränderte Rate aus, große ein Sprung. Den Synth der Audiospur folgen zu
 * lassen scheidet aus: Jede Änderung von playbackSpeed während der Wiedergabe setzt alphaTab wie einen Sprung um
 * (gemessen: 40–50 ms Lücke, klingende Töne brechen ab, siehe README "Gegen Haken und Ruckeln").
 */

/** Zeitfenster für den Median der Abweichung. */
const SAMPLE_WINDOW_MS = 500;
/** Mindestanzahl Messwerte im Zeitfenster, bevor nachgeführt wird. */
const MIN_SAMPLES = 5;
/** Mindestabstand zwischen zwei Messungen (alphaTab meldet die Position mehrere hundert Mal pro Sekunde). */
const SAMPLE_INTERVAL_MS = 25;
/** Nach Start oder Sprung braucht der Knoten einen Moment, bis die Audiospur gleichmäßig läuft. */
const SETTLE_MS = 500;
/** Ab dieser Abweichung wird die Rate angepasst. */
const RATE_THRESHOLD_MS = 40;
/** Unter dieser Abweichung kehrt die Rate zum eingestellten Tempo zurück (Hysterese). */
const RATE_RELEASE_MS = 10;
/** Ab dieser Abweichung wird gesprungen, höchstens einmal je SEEK_INTERVAL_MS. */
const SEEK_THRESHOLD_MS = 300;
/** Ab dieser Abweichung wird sofort gesprungen (z. B. beim Loop zurück an den Anfang des Bereichs). */
const JUMP_THRESHOLD_MS = 1000;
/** Mindestabstand zwischen zwei Sprüngen. */
const SEEK_INTERVAL_MS = 1000;
/**
 * Änderung der Rate beim Nachführen (Anteil), fest statt stufenlos. Muss größer sein als SPEED_CHANGE_MIN im Player:
 * Bis dahin stellt der Player das Tempo des Synths nicht um, die Audiospur muss den Unterschied aufholen.
 */
const RATE_STEP = 0.04;
/**
 * Abtastrate des AudioContext des Mixers und damit der dekodierten Audiospur. Die Audiospuren sind mit 16 kHz
 * gespeichert (bin/audio.php); bei höherer Rate wäre der Speicher (Float32, zweimal: Dekodierung und Knoten) mehr als
 * dreimal so groß, ohne dass etwas dazukäme.
 */
const AUDIO_SAMPLE_RATE = 16000;

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
 * Fasst häufige Aufrufe auf einen je Bildschirmbild zusammen: alphaTab meldet die Abspielposition mehrere hundert Mal
 * pro Sekunde. Die Arbeit der Anzeige (DOM, Canvas) läge sonst so oft auf dem Hauptthread, über den sich der Synth seine
 * Audiopuffer holt; ist er zu lange belegt, stottert der Synth (die Audiospur nicht, sie läuft im eigenen Knoten).
 * Ausgeführt wird mit den Argumenten des letzten Aufrufs.
 * @template {any[]} A
 * @param {function(...A): void} fn Anzeige
 * @returns {function(...A): void} gibt sofort zurück; fn läuft im nächsten Bild
 */
export function perFrame(fn){
  /** @type {?A} */
  let args = null;
  return (...a) => {
    if(!args) requestAnimationFrame(() => {
      const last = args;
      args = null;
      fn(...last);
    });
    args = a;
  };
}

/**
 * Schlag der ersten Stimme einer Spur, der an einer Stelle klingt (beginnt oder schon klingt).
 * @param {Track} track Spur
 * @param {number} tick MIDI-Tick ab Songanfang (ohne Wiederholungen)
 * @returns {?import('../../types/alphatab').model.Beat}
 */
function soundingBeat(track, tick){
  const bar = track.staves[0]?.bars.find(b => b.masterBar.start <= tick
    && tick < b.masterBar.start + b.masterBar.calculateDuration());
  if(!bar?.voices[0]) return null;
  const at = tick - bar.masterBar.start;
  return timeline(bar.voices[0]).find(e => e.start <= at && at < e.end)?.beat ?? null;
}

/**
 * Audiospur eines Lieds, die dem Synth von alphaTab folgt.
 * Aufruf: const mixer = new Mixer(alphaTab); await mixer.load(slug, score); dann onPosition()/onState() aus den
 * Ereignissen von alphaTab aufrufen; zum Schluss destroy().
 */
export class Mixer {
  /**
   * AudioContext der Audiospur (eigener, nicht der von alphaTab); null vor load().
   * @type {?AudioContext}
   */
  context = null;
  /**
   * Knoten von Signalsmith Stretch, der die Audiospur mit Rate und ohne Tonhöhenänderung abspielt; null vor load().
   * @type {?*}
   */
  stretch = null;
  /**
   * Lautstärkeregler hinter dem Knoten; null vor load().
   * @type {?GainNode}
   */
  gain = null;
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
  /** Aktuelle Rate der Audiospur: baseRate, während einer Korrektur um RATE_STEP verändert. */
  rate = 1;
  /** Ob die Audiospur gerade läuft. */
  active = false;
  /**
   * Zuordnung von Zeit des AudioContext zu Position in der Audiospur beim letzten Setzen: ab time (Sekunden der Uhr
   * des Contexts) läuft die Audiospur ab position (Sekunden) mit rate.
   * @type {{time: number, position: number, rate: number}}
   */
  anchor = {time: 0, position: 0, rate: 1};
  /** Position der Audiospur in ms, an der sie steht, solange sie nicht läuft. */
  heldMs = 0;
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
  /** Ob beim nächsten Positionsereignis gesprungen wird (nach neuen Sync-Punkten, siehe setScore()). */
  forceSeek = false;
  /** Laufende Korrektur der Rate: 1 = Audio langsamer (läuft vor), -1 = schneller, 0 = keine. */
  correction = 0;
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
  }

  /**
   * Ob die Audiospur den Noten folgen kann (die Noten haben Sync-Punkte).
   * @returns {boolean}
   */
  get synced(){
    return this.syncPoints.length > 0;
  }

  /**
   * Lädt die Audiospur (ganz, auch zum Springen) in den Knoten und liest die Sync-Punkte aus den Noten.
   * @param {string} slug Slug des Lieds
   * @param {Score} score Noten mit \sync
   * @returns {Promise<number>} Länge der Audiospur in Sekunden
   * @throws {Error} wenn die Audiospur nicht zu laden oder zu dekodieren ist
   */
  async load(slug, score){
    const bytes = this.bytes = await loadAudio(slug);
    const stretchModule = await import('../vendor/signalsmith/SignalsmithStretch.mjs');
    /** @type {(context: AudioContext, options: {outputChannelCount: number[]}) => Promise<any>} */
    const SignalsmithStretch = stretchModule.default;
    const context = this.context = new AudioContext({sampleRate: AUDIO_SAMPLE_RATE});
    let buffer;
    try {
      buffer = await context.decodeAudioData(bytes.slice().buffer);
    } catch{
      throw new Error('Audiospur nicht lesbar');
    }
    const stretch = this.stretch = await SignalsmithStretch(context, {outputChannelCount: [2]});
    const gain = this.gain = context.createGain();
    stretch.connect(gain);
    gain.connect(context.destination);
    // Ein Kanal wird auf beide Seiten gelegt.
    const channels = [0, 1].map(c => buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).slice());
    await stretch.addBuffers(channels);
    this.setScore(score);
    return buffer.duration;
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
    return sp.syncTime + (tick - sp.synthTick) / QUARTER_TICKS * 60000 / sp.syncBpm;
  }

  /**
   * Position in der Audiospur -> MIDI-Tick des Synths (Umkehrung von tickToAudioMs()). Vor dem ersten
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
   * Faktor, um den der Synth an dieser Stelle schneller spielen muss, damit er mit der Audiospur Schritt hält.
   * @param {number} tick MIDI-Tick
   * @returns {number} Tempo der Audiospur geteilt durch das notierte Tempo; 1 ohne Sync-Punkte
   */
  tempoFactor(tick){
    return recordingTempoAt(this.syncPoints, tick);
  }

  /**
   * Aktuelle Position der Audiospur.
   * @returns {number} ms; die Position, an der sie steht, wenn sie nicht läuft
   */
  get positionMs(){
    if(!this.active) return this.heldMs;
    const {time, position, rate} = this.anchor;
    return (position + (this.context.currentTime - time) * rate) * 1000;
  }

  /**
   * Lässt die Audiospur ab einer Position mit der aktuellen Rate laufen (neu oder weiter).
   * @param {number} ms Position in der Audiospur
   * @returns {void}
   */
  runFrom(ms){
    const time = this.context.currentTime;
    this.anchor = {time, position: ms / 1000, rate: this.rate};
    this.stretch.schedule({active: true, input: ms / 1000, rate: this.rate, semitones: 0, output: time});
    this.active = true;
  }

  /**
   * Hält die Audiospur an; ihre Position bleibt in heldMs.
   * @returns {void}
   */
  stopAudio(){
    if(!this.active) return;
    this.heldMs = this.positionMs;
    this.active = false;
    this.stretch.schedule({active: false, output: this.context.currentTime});
  }

  /**
   * Setzt die Rate der Audiospur; sie läuft ohne Unterbrechung an der aktuellen Stelle weiter.
   * @param {number} rate neue Rate
   * @returns {void}
   */
  setRate(rate){
    if(this.rate === rate) return;
    this.rate = rate;
    if(this.active) this.runFrom(this.positionMs);
  }

  /**
   * Setzt die Audiospur auf eine Position (läuft sie, dann dort weiter) und setzt die Messung kurz aus.
   * @param {number} ms Position in der Audiospur
   * @returns {void}
   */
  seekAudio(ms){
    this.heldMs = Math.max(0, ms);
    this.rate = this.baseRate;
    if(this.active) this.runFrom(this.heldMs);
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
    if(playing) void this.context?.resume();
    else this.stopAudio();
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
    // Spielt der Synth nicht genau im Tempo der Audiospur, läuft die Audiospur um denselben Anteil anders; die Rate
    // ändert sich so nur an den Sync-Punkten statt ständig über die Korrektur.
    const baseRate = synthSpeed / this.tempoFactor(tick);
    if(Math.abs(baseRate - this.baseRate) > 0.0005){
      this.baseRate = baseRate;
      this.setRate(baseRate * (1 - this.correction * RATE_STEP));
    }
    const expected = this.tickToAudioMs(tick);
    // alphaTab meldet auch beim Umstellen des Abspieltempos einen Sprung; liegt die Audiospur noch richtig, läuft sie
    // ohne Unterbrechung weiter.
    const inPlace = this.playing && this.active && Math.abs(this.positionMs - expected) < SEEK_THRESHOLD_MS;
    if(isSeek && inPlace){
      this.samples = [];
      return;
    }
    if(!this.playing || isSeek){
      this.stopAudio();
      this.seekAudio(expected);
      return;
    }
    // Negative Position: Die Audiospur setzt erst später ein (in GP8 ein Padding vor dem Audio).
    if(expected < 0){
      this.stopAudio();
      this.heldMs = 0;
      return;
    }
    if(!this.active || this.forceSeek){
      this.forceSeek = false;
      const wasActive = this.active;
      this.seekAudio(expected);
      if(!wasActive) this.runFrom(expected);
      return;
    }
    const now = performance.now();
    if(now < this.settleUntil || now - (this.samples.at(-1)?.t ?? 0) < SAMPLE_INTERVAL_MS) return;

    this.samples.push({t: now, drift: this.positionMs - expected});
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
      return;
    }
    // Audio läuft vor (drift > 0) -> etwas langsamer, sonst schneller. Erst ab RATE_THRESHOLD_MS, dann bis unter
    // RATE_RELEASE_MS; dazwischen bleibt es, wie es ist.
    const correction = abs > RATE_THRESHOLD_MS ? Math.sign(drift) : abs < RATE_RELEASE_MS ? 0 : this.correction;
    if(correction !== this.correction){
      this.correction = correction;
      this.setRate(this.baseRate * (1 - correction * RATE_STEP));
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
    this.setRate(speed);
    this.samples = [];
  }

  /**
   * Lautstärke der Audiospur.
   * @param {number} volume 0 bis 1
   * @returns {void}
   */
  setVolume(volume){
    if(this.gain) this.gain.gain.value = volume;
  }

  /**
   * Hält die Audiospur an und gibt Knoten und AudioContext frei.
   * @returns {void}
   */
  destroy(){
    this.stopAudio();
    this.stretch?.disconnect();
    this.gain?.disconnect();
    void this.context?.close();
    this.stretch = this.gain = this.context = null;
  }
}

// --------------------------------------------------------------------------------------------------------------------
// Player
// --------------------------------------------------------------------------------------------------------------------

/**
 * alphaTab-Wrapper: Noten und Tabs anzeigen und mit dem Synthesizer abspielen, bei vorhandener audio.mp3 zusammen
 * mit der Audiospur (siehe playback.js). In der Kopfzeile wählt man die Ansicht (Noten, Tabs, Noten + Tabs oder Chords,
 * d. h. "Text & Akkorde", siehe textview.js) und die angezeigten Spuren, daneben steht der aktuelle Akkord. Der
 * Lautsprecher in der Abspielleiste öffnet den Mixer-Dialog (Lautstärke und hörbar ja/nein je Spur, Audiospur,
 * Metronom und Vorzähler); er gilt in allen Ansichten, die Wiedergabe läuft auch in "Chords" weiter. Den
 * Loop-Bereich wählt man mit der Maus im Notenblatt.
 *
 * alphaTab (rund 1 MB) und der SoundFont werden erst geladen, wenn ein Lied geöffnet wird.
 */

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
 * Liest die Player-Einstellungen, ergänzt um Vorgaben.
 * @returns {{speed: number, view: string, staves: string, scale: number, metronomeVolume: number,
 *   countInVolume: number, metronomeMute: boolean, countInMute: boolean}} view: Ansicht (siehe VIEWS); staves: die
 *   zuletzt gewählte Notenansicht ("score", "tab" oder "both"), gilt auch für die eingeklappten Noten in "chords";
 *   Lautstärken von 0 bis 1
 */
function loadPrefs(){
  const defaults = {
    speed: 1, view: 'both', staves: 'both', scale: window.innerWidth < 600 ? 0.75 : 1,
    metronomeVolume: 1, countInVolume: 1, metronomeMute: true, countInMute: true,
  };
  /** @type {Object<string, *>} Einstellungen aus dem Browser */
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch(err){ /* Vorgaben verwenden */ }
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
 * Spurnamen links neben den Spuren: bei mehreren angezeigten Spuren in jeder Notenzeile, senkrecht, mit dem Namen
 * aus den Noten (unübersetzt, ohne Namen "Spur 1" usw., trackName()); bei einer Spur keiner. Was die Datei aus
 * Guitar Pro vorgibt (meist ausgeblendet), gilt nicht.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score geladene Noten
 * @returns {void}
 */
export function showTrackNames(alphaTab, score){
  const {TrackNameMode, TrackNameOrientation, TrackNamePolicy} = alphaTab.model;
  const sheet = score.stylesheet;
  sheet.singleTrackTrackNamePolicy = TrackNamePolicy.Hidden;
  sheet.multiTrackTrackNamePolicy = TrackNamePolicy.AllSystems;
  sheet.firstSystemTrackNameMode = sheet.otherSystemsTrackNameMode = TrackNameMode.ShortName;
  sheet.firstSystemTrackNameOrientation = sheet.otherSystemsTrackNameOrientation = TrackNameOrientation.Vertical;
  for(const track of score.tracks) track.shortName = trackName(track);
}

/**
 * Teile der Noten, die alphaTab nicht zeichnen soll (Namen aus alphaTab.NotationElement): Titel, Interpret usw.
 * stehen schon in der Kopfzeile der Seite, die Griffbilder darüber für alle Ansichten gleich, das Tuning (mit dem
 * Spurnamen davor) und der Capo in der Kopfzeile. "Capo. fret 1" über dem ersten Takt verdeckte außerdem den
 * Akkordnamen. Dynamikzeichen ("f") nützen nichts: Alle Schläge haben dieselbe Dynamik (normalizeLevels() in
 * notation.js).
 */
const HIDDEN_SCORE_ELEMENTS = [
  'ScoreTitle', 'ScoreSubTitle', 'ScoreArtist', 'ScoreAlbum', 'ScoreWords', 'ScoreMusic', 'ScoreWordsAndMusic',
  'ScoreCopyright', 'GuitarTuning', 'ChordDiagrams', 'EffectCapo', 'EffectDynamics',
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
const SPEEDS = [0.25, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
/**
 * Abstand unter jeder Notenzeile außer der letzten, wenn mehrere Spuren angezeigt werden (px, bei Größe 100 %): Dann
 * muss man sehen, wo eine Zeile mit allen Spuren endet. Der Systemtrenner aus Guitar Pro (zwei schräge Striche
 * zwischen den Zeilen) entfällt beim Import; dieser Abstand ersetzt ihn.
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

/** So viel vom oberen Rand des Griffbilds (Platz für den Namen) schneidet der aktuelle Akkord ab (SVG-Einheiten). */
const CHORD_NOW_CROP = 22;
/** Zusätzlicher Platz links im Griffbild des aktuellen Akkords für die vergrößerte Bundangabe (SVG-Einheiten). */
const CHORD_NOW_FRET_SPACE = 20;

/**
 * Material-Symbol "directions_run" (Google Material Icons, Apache 2.0) für den Knopf der Geschwindigkeit, in
 * currentColor.
 */
const RUN_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">'
  + '<path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 '
  + '.6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2'
  + 'v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/></svg>';

/** Symbol für den Knopf des Mixers: drei Regler (in currentColor). */
const MIXER_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" '
  + 'stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 4v16M12 4v16M18 4v16"/>'
  + '<circle cx="6" cy="9" r="2.3" fill="currentColor"/><circle cx="12" cy="15" r="2.3" fill="currentColor"/>'
  + '<circle cx="18" cy="7" r="2.3" fill="currentColor"/></svg>';

/** Symbol für den Knopf der Ansicht: Notenlinien mit einer Note. */
const VIEW_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" '
  + 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M3 10h18M3 14h18M3 18h18"/>'
  + '<ellipse cx="9" cy="16" rx="2.4" ry="1.8" fill="currentColor" stroke="none"/><path d="M11.3 16V7.5"/></svg>';

/** Symbol für den Umschalter zwischen Strumming und Picking Patterns (zwei Pfeile). */
const SWAP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" '
  + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/></svg>';

/**
 * Auge im Mixer: Spur anzeigen (durchgestrichen: ausgeblendet).
 * @param {boolean} on angezeigt
 * @returns {string} SVG
 */
export const eyeIcon = on => '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" '
  + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
  + (on ? '' : '<path d="M4 4l16 16"/>') + '</svg>';

/**
 * Lautsprecher im Mixer: zu hören (durchgestrichen: stumm, wie beim Auge).
 * @param {boolean} on zu hören
 * @returns {string} SVG
 */
export const speakerIcon = on => '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" '
  + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M4 9v6h4l5 4V5L8 9H4z"/>'
  + '<path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>' + (on ? '' : '<path d="M4 4l16 16"/>') + '</svg>';

/** Präfix im localStorage für das am Handy gezeigte Pattern je Lied (+ Slug): "strumming" oder "picking". */
const PATTERN_KEY_PREFIX = 'gitarrenbuch_pattern_';

/** Ab dieser Ähnlichkeit (similarity() in sheet.js) gilt ein Pattern als das eines Takts. */
const PATTERN_MATCH = 0.75;

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
export const SCALES = [0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5];

/**
 * Notenansicht mit Abspielleiste für ein Lied.
 * Aufruf: const player = new Player(root, strip); const info = await player.load(song); … player.destroy();
 *
 * Lage der Bedienelemente:
 * - Oben steht nur der Kopf des Songs (app.js) und ein Streifen mit dem aktuellen Akkord samt Griffbild und dem
 *   Strumming bzw. Picking Patterns des Leadsheets, dessen aktueller Schlag mitläuft. Der Streifen bleibt beim Scrollen
 *   stehen; am PC steht er rechts neben dem Kopf, und beides bleibt stehen.
 * - Alles zum Bedienen liegt in der Leiste unten: Play, Zeit, Tempo, Wiederholen, Ansicht, Mixer, Menü (das Menü
 *   setzt app.js in el.menuWrap). Den Fortschritt zeigt eine Linie am oberen Rand der Leiste, gesprungen wird per
 *   Klick auf einen Takt bzw. eine Textstelle.
 * - Welche Spuren zu sehen und zu hören sind, steht im Mixer (Auge und Lautsprecher je Spur).
 * - Die Tonhöhe ändert nur der Bearbeitungsmodus (Noten transponieren); der Player hat dafür keine Einstellung.
 */
export class Player {
  /**
   * alphaTab-Instanz, null vor load() und nach destroy().
   * @type {?AlphaTabApi}
   */
  api = null;
  /**
   * Beendet das Ausblenden des Vermerks "rendered by alphaTab" (hideAttribution() in base.js).
   * @type {(() => void)|null}
   */
  stopHidingAttribution = null;
  /**
   * alphaTab-Modul, gesetzt von load().
   * @type {?AlphaTabModule}
   */
  alphaTab = null;
  /**
   * Sperre gegen das Abschalten des Bildschirms, solange der Song offen ist.
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
   * Sync-Punkte, deren Tempo im MIDI des Synths steckt (siehe applyRecordingTempo() in notation.js); leer ohne
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
   * Vorgaben des Songs je Spur (Index), ob sie angezeigt und gehört wird (Feld trackDefaults, gesetzt im Reiter
   * "Spuren" des Editors). Gilt, solange das Gerät im Mixer nichts anderes eingestellt hat.
   * @type {{show: boolean, mute: boolean}[]}
   */
  defaults = [];
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
   * Akkorde aller Spuren, zusammengetragen nach der Regel der Konvention (mergeChords() in notation.js), siehe
   * applyChordNames().
   * @type {import('./notation.js').MergedChord[]}
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
   * Schläge einer anderen Spur, auf die applyLyrics() den Text gelegt hat, weil die Spur mit dem Text ausgeblendet ist.
   * @type {import('../../types/alphatab').model.Beat[]}
   */
  projectedLyrics = [];
  /** Akkord, den der Streifen gerade zeigt (siehe showCurrentChord()); null für keinen. */
  currentChord = null;
  /**
   * Patterns des Leadsheets je Technik, in der Reihenfolge des Blatts (loadStripPatterns()).
   * @type {Record<string, import('./sheet.js').Pattern[]>}
   */
  patterns = {strumming: [], picking: []};
  /**
   * Je Technik: Takt (Index) → Pattern, das zu ihm passt (nur Takte, zu denen eines passt).
   * @type {Record<string, Map<number, import('./sheet.js').Pattern>>}
   */
  patternAt = {strumming: new Map(), picking: new Map()};
  /**
   * Je Technik, was der Streifen gerade zeigt: Pattern, Spalten des Rasters (je Schlag die Zellen) und der
   * hervorgehobene Schlag.
   * @type {Record<string, {pattern: ?import('./sheet.js').Pattern, columns: HTMLElement[][], step: number}>}
   */
  patternShown = {strumming: {pattern: null, columns: [], step: -1}, picking: {pattern: null, columns: [], step: -1}};
  /**
   * Takte in Abspielreihenfolge mit ihrer Zeit (playTimeline()), für Patterns und Wiederholen.
   * @type {{mb: import('../../types/alphatab').model.MasterBar, t: number, end: number}[]}
   */
  timeline = [];
  /**
   * Wiederholen per Klick (onLoopClick()): erster gewählter Takt bzw. Zeit (Ansicht "Chords"), solange das Ende noch
   * fehlt; ranged: Anfang und Ende stehen.
   * @type {{start: ?import('../../types/alphatab').model.Beat, startTick: ?number, ranged: boolean}}
   */
  loop = {start: null, startTick: null, ranged: false};
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
   * @param {HTMLElement} strip leeres Element für den Streifen mit aktuellem Akkord und Patterns
   */
  constructor(root, strip){
    /** Element, in das gerendert wird. */
    this.root = root;
    /** Streifen mit aktuellem Akkord und Patterns. */
    this.strip = strip;
    strip.hidden = true;
    strip.innerHTML = `
      <div class="chord-now" data-strip="chord" hidden></div>
      <button type="button" class="strip-swap" data-strip="swap" hidden aria-label="Strumming Patterns / Picking Patterns"
        title="Zwischen Strumming und Picking Patterns wechseln">${SWAP_ICON}</button>
      ${Object.keys(TECHNIQUES).map(t => `<div class="strip-pattern" data-technique="${t}" hidden>
        <div class="strip-pattern-name"></div><div class="strip-pattern-grid"></div></div>`).join('')}`;
    /**
     * Aktueller Akkord im Streifen: Name und Griffbild (showCurrentChord()).
     */
    this.chordNow = /** @type {HTMLElement} */ (strip.querySelector('[data-strip="chord"]'));
    /** Umschalter Strumming/Picking Patterns (nur am Handy und nur, wenn der Song beides hat). */
    this.patternSwap = /** @type {HTMLElement} */ (strip.querySelector('[data-strip="swap"]'));
    this.patternSwap.addEventListener('click', () => this.showPatternTechnique(
      strip.dataset.show === 'picking' ? 'strumming' : 'picking', true));
    /**
     * Bearbeitungsmodus, solange er offen ist (siehe editor.js): Dann zeichnet er die Noten und bekommt die
     * Spurwahl.
     * @type {?import('./editor.js').NoteEditor}
     */
    this.editor = null;
    root.innerHTML = `
      <div class="score-status" data-ref="status">Noten werden geladen &hellip;</div>
      <div class="score-wrap" data-ref="wrap"><div data-ref="at"></div>${creditHtml('player-credit', 'Score')}</div>
      <div class="text-view" data-ref="text" hidden></div>
      <div class="mixer-dialog" data-ref="mixer" hidden></div>
      <div class="transport" data-ref="transport">
        <div class="tline"><div data-ref="progress"></div></div>
        <button class="tbtn tbtn-play" data-ref="play" type="button" disabled aria-label="Abspielen">&#9654;</button>
        <span class="ttime" data-ref="time"><span data-ref="timeNow">0:00</span><span class="ttime-sep"> / </span><span
          data-ref="timeEnd">0:00</span></span>
        <button class="tbtn" data-ref="loop" type="button" aria-pressed="false" aria-label="Wiederholen"
          title="Wiederholen: an, dann einen Takt für den Anfang und einen für das Ende anklicken">&#10227;</button>
        <div class="speed-menu">
          <button class="tbtn tbtn-speed" data-ref="speedBtn" type="button" aria-haspopup="true" aria-expanded="false"
            aria-label="Geschwindigkeit" title="Geschwindigkeit">
            ${RUN_ICON}<span data-ref="speedBadge" hidden></span>
          </button>
          <div class="speed-pop" data-ref="speedPop" hidden>
            ${SPEEDS.map(s => `<button type="button" data-speed="${s}">${Math.round(s * 100)} %</button>`).join('')}
          </div>
        </div>
        <div class="view-menu">
          <button class="tbtn" data-ref="viewBtn" type="button" aria-haspopup="true" aria-expanded="false"
            aria-label="Ansicht" title="Ansicht">${VIEW_ICON}</button>
          <div class="speed-pop view-pop" data-ref="viewPop" hidden>
            ${VIEWS.map(([value, label]) => `<button type="button" data-view="${value}">${label}</button>`).join('')}
          </div>
        </div>
        <button class="tbtn" data-ref="mixerBtn" type="button" aria-expanded="false" aria-label="Mixer"
          title="Mixer: Spuren anzeigen, Lautstärken">${MIXER_ICON}</button>
        <div class="songbar-menu" data-ref="menuWrap"></div>
      </div>
    `;
    /**
     * Bedienelemente nach ihrem data-ref.
     * @type {Record<string, HTMLElement>}
     */
    this.el = {};
    root.querySelectorAll('[data-ref]').forEach(n => { this.el[n.dataset.ref] = n; });
    this.showView();
    // Ein gespeichertes Tempo, das es in der Auswahl nicht mehr gibt (z. B. 75 %), auf das nächste setzen.
    const saved = this.prefs.speed;
    this.prefs.speed = SPEEDS.reduce((best, s) => Math.abs(s - saved) < Math.abs(best - saved) ? s : best);
    this.showSpeed();
    /** Holt die Wake-Lock-Sperre zurück, wenn die Seite beim Abspielen wieder sichtbar wird. */
    // Der Bildschirm bleibt an, solange ein Song offen ist, nicht nur beim Abspielen: Am Notenständer liest man Text
    // und Akkorde auch ohne Wiedergabe. Der Browser gibt die Sperre frei, wenn die Seite/ in den Hintergrund geht;
    // beim Zurückkommen wird sie neu angefordert.
    this.onVisibility = () => { if(document.visibilityState === 'visible') void this.requestWakeLock(); };
    void this.requestWakeLock();
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
    this.defaults = song.trackDefaults ?? [];
    this.mix = this.loadMix();
    // Nacheinander statt mit Promise.all: Dort verliert die IDE die Typen der einzelnen Ergebnisse.
    const alphaTab = await loadAlphaTab();
    const tex = await loadScoreText(song.slug);
    this.alphaTab = alphaTab;

    // Hinweis auf alphaTab in der Fußzeile anzeigen.
    this.stopHidingAttribution = hideAttribution(this.el.at);
    useCreditLogos(this.el.wrap);
    const api = this.api = new alphaTab.AlphaTabApi(this.el.at, {
      core: {fontDirectory: VENDOR_URL + 'font/'},
      display: {
        scale: this.prefs.scale,
        layoutMode: alphaTab.LayoutMode.Page,
        // Abstand zwischen den Notenzeilen: siehe SYSTEM_GAP und SYSTEM_GAP_SINGLE (Vorgabe von alphaTab 10).
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
    });
    api.midiLoad.on(midi => {
      this.midiSyncPoints = this.hasAudio ? playbackSyncPoints(alphaTab, api.score) : [];
      applyRecordingTempo(alphaTab, midi, this.midiSyncPoints);
      // Lautstärken und Stumm je Spur gelten für das geladene MIDI, also erst danach setzen. (Das Ereignis
      // midiLoaded ruft sich in alphaTab 1.8.4 endlos selbst auf und ist deshalb nicht nutzbar.)
      setTimeout(() => this.applyLevels());
    });
    api.playerStateChanged.on(e => this.onStateChanged(e.state));
    // Audiospur und Tempo folgen jeder Meldung, die Anzeige einmal je Bild (perFrame()).
    const show = perFrame((/** @type {number} */ time, /** @type {number} */ end, /** @type {number} */ tick) => {
      if(!this.api) return;
      this.onPosition(time, end);
      this.highlightText(tick);
      this.showCurrentChord(tick);
      this.showPatterns(tick);
    });
    api.playerPositionChanged.on(e => {
      this.mixer?.onPosition(e.currentTick, e.isSeek,
        api.playbackSpeed * recordingTempoAt(this.midiSyncPoints, e.currentTick));
      this.applySpeed(e.currentTick);
      show(e.currentTime, e.endTime, e.currentTick);
    });
    api.error.on(err => this.setStatus(escapeHtml('Fehler: ' + (err.message || err))));

    this.el.play.addEventListener('click', () => api.playPause());
    this.el.speedBtn.addEventListener('click', () => this.toggleSpeedMenu());
    this.el.speedPop.addEventListener('click', e => {
      const choice = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-speed]'));
      if(!choice) return;
      this.prefs.speed = Number(choice.dataset.speed);
      this.mixer?.setSpeed(this.prefs.speed);
      this.applySpeed(api.tickPosition, true);
      savePrefs(this.prefs);
      this.showSpeed();
      this.toggleSpeedMenu(false);
    });
    this.el.loop.addEventListener('click', () => {
      api.isLooping = !api.isLooping;
      this.el.loop.setAttribute('aria-pressed', String(api.isLooping));
      // Aus und wieder an beginnt von vorn: ohne Bereich wiederholt sich der ganze Song.
      this.clearLoopRange();
    });
    // Wiederholen per Klick auf zwei Takte. alphaTab verarbeitet den Klick selbst (springt zum Schlag und räumt
    // dabei seine Auswahl ab), deshalb danach.
    api.beatMouseUp.on(beat => { if(beat) setTimeout(() => this.onLoopClick(beat)); });
    this.el.viewBtn.addEventListener('click', () => this.toggleViewMenu());
    this.el.viewPop.addEventListener('click', e => {
      const view = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-view]'))?.dataset.view;
      if(!view) return;
      this.setView(view);
      this.toggleViewMenu(false);
    });
    this.el.mixerBtn.addEventListener('click', () => this.toggleMixerDialog());
    /** Schließt Mixer, Geschwindigkeits- und Ansichtsliste bei einem Klick daneben (nicht darauf, nicht auf den Knopf). */
    this.onOutsideClick = e => {
      const target = /** @type {Node} */ (e.target);
      if(!this.el.mixer.hidden && !this.el.mixer.contains(target) && !this.el.mixerBtn.contains(target)){
        this.toggleMixerDialog(false);
      }
      if(!this.el.speedPop.hidden && !this.el.speedPop.closest('.speed-menu').contains(target)){
        this.toggleSpeedMenu(false);
      }
      if(!this.el.viewPop.hidden && !this.el.viewPop.closest('.view-menu').contains(target)){
        this.toggleViewMenu(false);
      }
    };
    document.addEventListener('pointerdown', this.onOutsideClick);
    // Lautstärken schon beim Ziehen übernehmen, nicht erst beim Loslassen.
    this.el.mixer.addEventListener('input', e => {
      const t = /** @type {HTMLInputElement} */ (e.target);
      if(t.dataset.volume) this.onVolumeChange(t);
    });
    this.el.mixer.addEventListener('click', e => this.onMixerClick(/** @type {HTMLElement} */ (e.target)));
    this.el.text.addEventListener('click', e => this.onTextClick(/** @type {HTMLElement} */ (e.target)));

    const score = parseScore(alphaTab, tex, api.settings);
    applySongMeta(score, song);
    // Stumm und Solo aus der Datei gelten nicht; was zu hören ist, steuert der Mixer-Dialog.
    for(const track of score.tracks){
      track.playbackInfo.isMute = false;
      track.playbackInfo.isSolo = false;
    }
    this.applyStave(score);
    // Das Modell für "Chords" und den aktuellen Akkord braucht die Akkorde, wie sie in der Datei stehen, also vor
    // applyChordNames().
    this.textModel = buildTextModel(score);
    this.timeline = playTimeline(score);
    this.mergedChords = mergeChords(score);
    showSectionNames(score);
    showTrackNames(alphaTab, score);
    this.trackLyrics = new Map(score.tracks.map(track => [track, track.staves
      .flatMap(staff => staff.bars).flatMap(bar => bar.voices).flatMap(voice => voice.beats)
      .filter(beat => beat.lyrics?.some(l => l?.trim())).map(beat => [beat, withoutTrailingEmpty(beat.lyrics)])]));
    this.lyricsOwner = lyricsTrack(score);
    const visible = this.orderTracks(this.loadVisibleTracks(score));
    this.applyLyrics(visible);
    this.applyChordNames(visible);
    this.applySystemGap(visible);
    api.updateSettings();
    api.renderScore(score, visible.map(t => t.index));
    this.currentChord = null;
    this.showCurrentChord(0);
    this.renderText();
    this.scrollMode = api.settings.player.scrollMode;
    this.applyView();
    void this.loadStripPatterns(score);
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
    mixer.onState(this.isPlaying);
    this.mixer = mixer;
    this.applyLevels();
    this.applySpeed(this.api.tickPosition, true);
    this.renderMixerDialog();
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
   * Setzt das Abspieltempo von alphaTab: eingestelltes Tempo mal Tempofaktor der Audiospur an dieser Stelle (siehe
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
   * Einstellung deutlich lauter als eine Audiospur.
   * @param {number} index Index der Spur
   * @returns {{volume: number, mute: boolean}} Eintrag in this.mix, wird bei Bedarf angelegt
   */
  trackMix(index){
    return this.mix.tracks[index] ??= {volume: this.hasAudio ? 0.5 : 1, mute: this.defaults[index]?.mute ?? false};
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
   * Übernimmt eine Lautstärke aus dem Mixer-Dialog, schon beim Ziehen.
   * @param {HTMLInputElement} t Regler mit data-volume ("track:<Index>", "audio", "metronome" oder "countIn")
   * @returns {void}
   */
  onVolumeChange(t){
    const value = Number(t.value);
    const level = this.el.mixer.querySelector(`[data-level="${t.dataset.volume}"]`);
    if(level) level.textContent = `${Math.round(value * 100)} %`;
    this.levelOf(t.dataset.volume).set(value);
    this.saveLevels();
  }

  /**
   * Lautstärke und Stumm eines Eintrags im Mixer-Dialog.
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
   * nur Noten), je Notensystem (nicht über settings.display.staveProfile). Was die Datei je Spur vorgibt, zählt nicht
   * (aus GP kamen viele Spuren mit nur Tabs, zwei nur mit Rhythmus-Schrägstrichen). Notensysteme ohne Saiten (z. B.
   * Schlagzeug) haben nur Noten. Neu gezeichnet wird vom Aufrufer.
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
    this.showView();
    this.applyView();
  }

  /**
   * Markiert die gewählte Ansicht in der Liste über dem Knopf "Ansicht".
   * @returns {void}
   */
  showView(){
    for(const b of this.el.viewPop.querySelectorAll('[data-view]')){
      b.setAttribute('aria-current', String(/** @type {HTMLElement} */ (b).dataset.view === this.prefs.view));
    }
  }

  /**
   * Öffnet bzw. schließt die Liste der Ansichten über ihrem Knopf.
   * @param {boolean} [open] öffnen; ohne Angabe umschalten
   * @returns {void}
   */
  toggleViewMenu(open = this.el.viewPop.hidden){
    this.el.viewPop.hidden = !open;
    this.el.viewBtn.setAttribute('aria-expanded', String(open));
  }

  /**
   * Darstellung, die der Dialog "Darstellung" (Menü ⋮, app.js) zeigt und ändert.
   * @returns {{scale: number}} Größe (Faktor, siehe SCALES)
   */
  get display(){
    return {scale: this.prefs.scale};
  }

  /**
   * Übernimmt die Darstellung aus dem Dialog "Darstellung" und merkt sie für alle Songs.
   * @param {{scale: number}} display Größe (Faktor)
   * @returns {void}
   */
  setDisplay({scale}){
    const rescale = scale !== this.prefs.scale;
    this.prefs.scale = scale;
    savePrefs(this.prefs);
    const api = this.api;
    if(rescale && api){
      api.settings.display.scale = scale;
      api.updateSettings();
      api.render();
    }
    this.applyView();
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
    this.renderMixerDialog();
    // Der aktuelle Akkord hängt von der Ansicht ab (Griffe in "Chords", sonst wie notiert).
    this.currentChord = null;
    this.showCurrentChord(api.tickPosition);
  }

  /**
   * Zeichnet "Chords" neu (Text und Akkorde).
   * @returns {void}
   */
  renderText(){
    this.el.text.innerHTML = renderTextView(this.textModel);
    this.textMarks = [...this.el.text.querySelectorAll('[data-t]')].map(el => ({t: Number(el.dataset.t), el}));
    this.textCurrent = -2;
  }

  /**
   * Zeigt im Streifen den Akkord, der an einer Stelle klingt: Name und Griffbild; vor dem ersten Akkord den ersten.
   * Ohne Akkorde bleibt die Anzeige leer.
   * @param {number} tick MIDI-Tick in Abspielreihenfolge
   * @returns {void}
   */
  showCurrentChord(tick){
    const model = this.textModel;
    const times = model?.chordTimes ?? [];
    this.chordNow.hidden = !times.length;
    this.showStrip();
    if(!times.length) return;
    let index = 0;
    for(let lo = 0, hi = times.length - 1; lo <= hi;){
      const mid = (lo + hi) >> 1;
      if(times[mid].t <= tick){
        index = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const name = times[index].name;
    if(name === this.currentChord) return;
    this.currentChord = name;
    const grip = model.chords.find(c => c.name === name)?.grip ?? '';
    this.chordNow.innerHTML = `<span class="chord-now-label"><strong>${escapeHtml(name)}</strong></span>`
      + (grip ? `<span class="chord-now-svg">${chordDiagramSvg(name, grip)}</span>` : '');
    // Oben sitzt im Griffbild der Name, der hier schon daneben steht: diesen Teil abschneiden, das Bild wird größer.
    const svg = this.chordNow.querySelector('svg');
    const box = svg?.viewBox.baseVal;
    // Mit Bundangabe links Platz für die größere Zahl (app.css: .chord-now-svg .fret-label).
    const left = svg?.querySelector('.fret-label') ? CHORD_NOW_FRET_SPACE : 0;
    if(box){
      svg.setAttribute('viewBox',
        `${box.x - left} ${CHORD_NOW_CROP} ${box.width + left} ${box.height - CHORD_NOW_CROP}`);
    }
  }

  /**
   * Zeigt den Streifen, wenn er etwas enthält (Akkord oder Patterns).
   * @returns {void}
   */
  showStrip(){
    this.strip.hidden = this.chordNow.hidden && !this.patterns.strumming.length && !this.patterns.picking.length;
  }

  /**
   * Lädt die Patterns des Leadsheets für den Streifen und bestimmt, welches zu welchem Takt gehört: Je Takt wird aus
   * jeder Spur mit Saiten das Patterns abgeleitet (deriveBar()) und mit den Patterns des Blatts derselben Technik
   * verglichen; das ähnlichste* gilt ab PATTERN_MATCH. Takte, zu denen keines passt, behalten das zuletzt gezeigte.
   * Scheitert das Laden (kein Leadsheet, kein Netz), bleibt der Streifen ohne Patterns.
   * @param {Score} score geladene Noten
   * @returns {Promise<void>}
   */
  async loadStripPatterns(score){
    let sheet;
    let catalog;
    try {
      sheet = await loadLeadsheet(this.slug);
      catalog = sheet.patterns?.length ? (await loadPatterns()).patterns : [];
    } catch(err){
      return;
    }
    if(!this.api) return;
    const byId = new Map(catalog.map(p => [p.id, p]));
    for(const technique of Object.keys(TECHNIQUES)){
      this.patterns[technique] = (sheet.patterns ?? []).map(p => byId.get(p.id))
        .filter(p => p?.technique === technique);
      this.patternAt[technique] = new Map();
    }
    const staves = stringedStaves(score);
    for(const mb of score.masterBars){
      /** @type {Record<string, {pattern: ?import('./sheet.js').Pattern, score: number}>} */
      const best = {strumming: {pattern: null, score: 0}, picking: {pattern: null, score: 0}};
      for(const staff of staves){
        const derived = staff.bars[mb.index] ? deriveBar(staff.bars[mb.index]) : null;
        if(!derived) continue;
        for(const pattern of this.patterns[derived.technique]){
          const value = similarity(pattern, derived);
          if(value >= PATTERN_MATCH && value > best[derived.technique].score){
            best[derived.technique] = {pattern, score: value};
          }
        }
      }
      for(const technique of Object.keys(best)){
        if(best[technique].pattern) this.patternAt[technique].set(mb.index, best[technique].pattern);
      }
    }
    const has = t => this.patterns[t].length > 0;
    this.strip.classList.toggle('has-both', has('strumming') && has('picking'));
    this.patternSwap.hidden = !(has('strumming') && has('picking'));
    const saved = localStorage.getItem(PATTERN_KEY_PREFIX + this.slug);
    this.showPatternTechnique(saved && has(saved) ? saved : has('strumming') ? 'strumming' : 'picking');
    this.showStrip();
    this.showPatterns(this.api.tickPosition);
  }

  /**
   * Welches Pattern der Streifen am Handy zeigt (am PC stehen beide nebeneinander, app.css).
   * @param {string} technique "strumming" oder "picking"
   * @param {boolean} [remember] für diesen Song merken
   * @returns {void}
   */
  showPatternTechnique(technique, remember = false){
    this.strip.dataset.show = technique;
    if(remember) localStorage.setItem(PATTERN_KEY_PREFIX + this.slug, technique);
  }

  /**
   * Zeigt im Streifen je Technik das Pattern des Takts an einer Stelle und hebt den Schlag hervor, der gerade dran ist.
   * Gezeichnet wie auf dem Leadsheet (patternGridHtml()). Passt zum Takt keines, bleibt das zuletzt gezeigte stehen
   * (am Anfang das erste des Blatts); der Schlag läuft nur mit, wenn die Taktart des Patterns die des Takts ist.
   * @param {number} tick MIDI-Tick in Abspielreihenfolge
   * @returns {void}
   */
  showPatterns(tick){
    const timeline = this.timeline;
    if(!timeline.length) return;
    let index = 0;
    for(let lo = 0, hi = timeline.length - 1; lo <= hi;){
      const mid = (lo + hi) >> 1;
      if(timeline[mid].t <= tick){
        index = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const entry = timeline[index];
    for(const technique of Object.keys(TECHNIQUES)){
      const shown = this.patternShown[technique];
      const slot = /** @type {?HTMLElement} */ (this.strip.querySelector(`[data-technique="${technique}"]`));
      // Nach destroy() ist der Streifen leer; alphaTab meldet dann unter Umständen noch eine Position.
      if(!slot) return;
      const pattern = this.patternAt[technique].get(entry.mb.index) ?? shown.pattern ?? this.patterns[technique][0] ?? null;
      slot.hidden = !pattern;
      if(!pattern) continue;
      if(pattern !== shown.pattern){
        shown.pattern = pattern;
        shown.step = -1;
        slot.querySelector('.strip-pattern-name').textContent = `${TECHNIQUES[technique]} · ${pattern.name}`;
        const grid = slot.querySelector('.strip-pattern-grid');
        grid.innerHTML = patternGridHtml(pattern);
        // Spalten: je Schlag die Zellen aller Zeilen (ohne die Beschriftung der Saiten beim Picking Pattern).
        const rows = [...grid.querySelectorAll('tr')].map(tr =>
          /** @type {HTMLElement[]} */ ([...tr.children]).filter(td => !td.classList.contains('pgrid-label')));
        shown.columns = (rows[0] ?? []).map((_, k) => rows.map(row => row[k]).filter(Boolean));
      }
      const mb = entry.mb;
      const slots = pattern.timeSignature === `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`
        ? slotCount(pattern.timeSignature, pattern.grid) : 0;
      const step = slots && tick >= entry.t && tick < entry.end
        ? Math.min(slots - 1, Math.floor((tick - entry.t) / (entry.end - entry.t) * slots)) : -1;
      if(step === shown.step) continue;
      for(const cell of shown.columns[shown.step] ?? []) cell.classList.remove('pgrid-now');
      for(const cell of shown.columns[step] ?? []) cell.classList.add('pgrid-now');
      shown.step = step;
    }
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
   * Bereich des Fensters zwischen dem, was oben stehen bleibt, und der Abspielleiste. Oben: im Bearbeitungsmodus
   * dessen Werkzeugleiste (.songbar), sonst der Streifen (Handy) bzw. Kopf und Streifen (PC, .songtop).
   * @returns {{top: number, bottom: number}} Pixel im Fenster
   */
  visibleArea(){
    const bottomOf = selector => {
      const el = /** @type {?HTMLElement} */ (this.root.parentElement?.querySelector(selector));
      return el && el.getClientRects().length ? el.getBoundingClientRect().bottom : 0;
    };
    return {
      top: Math.max(0, this.editor ? bottomOf('.songbar') : Math.max(bottomOf('.songtop'), bottomOf('.songstrip'))),
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
    // Im Bearbeitungsmodus führt der Cursor des Editors; alphaTab setzt die Abspielposition nach jedem Neuzeichnen
    // auf den Anfang und würde sonst jedes Mal zu Takt 1 rollen.
    if(this.editor && !this.isPlaying) return;
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
    if(this.api.isLooping) this.onLoopTick(Number(part.dataset.t));
  }

  /**
   * Wiederholen per Klick in den Noten: Der erste Klick wählt den Takt für den Anfang (er ist* markiert), der zweite
   * den für das Ende; wiederholt wird vom Anfang des früheren bis zum Ende des späteren Takts. Ein weiterer Klick
   * beginnt eine neue Auswahl. Ohne Auswahl wiederholt sich der ganze Song. Nicht im Bearbeitungsmodus (dort wählt der
   * Klick Noten aus).
   * @param {import('../../types/alphatab').model.Beat} beat angeklickter Schlag
   * @returns {void}
   */
  onLoopClick(beat){
    const api = this.api;
    if(!api?.isLooping || this.editor || !api.tickCache) return;
    const staff = beat.voice.bar.staff;
    const edge = (index, last) => {
      const beats = staff.bars[index].voices[0].beats;
      return beats[last ? beats.length - 1 : 0];
    };
    const clicked = beat.voice.bar.index;
    if(!this.loop.start || this.loop.ranged){
      this.clearLoopRange();
      this.loop.start = beat;
      api.highlightPlaybackRange(edge(clicked, false), edge(clicked, true));
      return;
    }
    const from = Math.min(this.loop.start.voice.bar.index, clicked);
    const to = Math.max(this.loop.start.voice.bar.index, clicked);
    const masterBars = api.score.masterBars;
    api.playbackRange = {
      startTick: api.tickCache.getMasterBarStart(masterBars[from]),
      endTick: api.tickCache.getMasterBarStart(masterBars[to]) + masterBars[to].calculateDuration(),
    };
    api.highlightPlaybackRange(edge(from, false), edge(to, true));
    this.loop.ranged = true;
  }

  /**
   * Wiederholen per Klick in "Chords": wie onLoopClick(), mit den Zeiten der Textstellen. Anfang ist der Beginn des
   * Takts der ersten Stelle, Ende der Beginn des Takts nach der zweiten. Die Takte dazwischen sind markiert.
   * @param {number} tick Zeit der angeklickten Stelle
   * @returns {void}
   */
  onLoopTick(tick){
    const api = this.api;
    const timeline = this.timeline;
    const barAt = t => timeline.findLast(e => e.t <= t) ?? timeline[0];
    if(!api || !timeline.length) return;
    if(this.loop.startTick === null || this.loop.ranged){
      this.clearLoopRange();
      this.loop.startTick = barAt(tick).t;
      this.markLoopText(this.loop.startTick, barAt(tick).end);
      return;
    }
    const a = barAt(Math.min(this.loop.startTick, tick));
    const b = barAt(Math.max(this.loop.startTick, tick));
    api.playbackRange = {startTick: a.t, endTick: b.end};
    this.markLoopText(a.t, b.end);
    this.loop.ranged = true;
  }

  /**
   * Markiert in "Chords" die Stellen eines Zeitbereichs als Bereich zum Wiederholen.
   * @param {number} from Anfang (Ticks)
   * @param {number} to Ende (Ticks)
   * @returns {void}
   */
  markLoopText(from, to){
    for(const mark of this.textMarks) mark.el.classList.toggle('tv-loop', mark.t >= from && mark.t < to);
  }

  /**
   * Hebt die Auswahl zum Wiederholen auf (der ganze Song wiederholt sich, solange "Wiederholen" an ist).
   * @returns {void}
   */
  clearLoopRange(){
    this.loop = {start: null, startTick: null, ranged: false};
    const api = this.api;
    if(!api) return;
    api.playbackRange = null;
    api.clearPlaybackRangeHighlight();
    this.markLoopText(0, 0);
  }

  /**
   * Zeigt die gewählten Spuren und merkt sie für diesen Song; mindestens eine bleibt angezeigt.
   * @param {number[]} indexes Indizes der anzuzeigenden Spuren
   * @returns {void}
   */
  showTracks(indexes){
    const api = this.api;
    if(!api?.score || !indexes.length) return;
    localStorage.setItem(TRACKS_KEY_PREFIX + this.slug, JSON.stringify(indexes));
    if(this.editor){
      // Im Bearbeitungsmodus zeigt der Editor seine Noten unverändert (ohne Text und Akkorde umzuhängen).
      this.editor.showTracks(indexes);
    } else {
      const tracks = this.orderTracks(indexes.map(i => api.score.tracks[i]));
      this.applyLyrics(tracks);
      this.applyChordNames(tracks);
      this.applySystemGap(tracks);
      api.updateSettings();
      api.renderTracks(tracks);
    }
    this.renderMixerDialog();
  }

  /**
   * Zeigt die Akkorde über den Noten einmal, an der obersten angezeigten Spur: alle Akkorde des Songs nach der Regel
   * der Konvention zusammengetragen (mergeChords(): bei verschiedenen Akkorden an einer Stelle gewinnt die
   * Akkordspur), so wie sie der Editor in die Akkordspur schreibt (moveContent() in notation.js), auch wenn die
   * Akkordspur ausgeblendet ist. alphaTab hängt einen Akkordnamen an einen Schlag; hat die oberste Spur an der Stelle
   * keinen (z. B. weil eine lange Note klingt), kommt er an die nächste angezeigte Spur, die dort einen hat, und hat
   * keine einen, an den Schlag der obersten Spur, der dann klingt. Dafür werden die Akkorde im geladenen Modell
   * umgehängt (beat.chordId, staff.chords); gespeichert wird dieses Modell nie.
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
      const beat = beatsAt.map(map => map.get(tick)).find(Boolean) ?? (tracks[0] ? soundingBeat(tracks[0], tick) : null);
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
   * Reihenfolge der angezeigten Spuren: die der Datei. Sie wird im Editor festgelegt (Dialog "Spuren", ↑/↓), statt
   * sie hier nach Rollen umzusortieren; so steht jede Spur dort, wo man sie hingestellt hat. Text und Akkorde zeichnet
   * alphaTab an der Spur, die sie trägt.
   * @param {Track[]} tracks anzuzeigende Spuren
   * @returns {Track[]} dieselben Spuren, sortiert
   */
  orderTracks(tracks){
    return [...tracks].sort((a, b) => a.index - b.index);
  }

  /**
   * Zeigt den Liedtext an genau einer der angezeigten Spuren: an der Spur mit dem Text (lyricsTrack()), wenn sie
   * angezeigt wird, sonst unter der untersten angezeigten Spur (projectLyrics()). Geändert wird nur das geladene
   * Modell (beat.lyrics), die Originale stehen in trackLyrics.
   * @param {Track[]} tracks angezeigte Spuren
   * @returns {void}
   */
  applyLyrics(tracks){
    const shown = tracks.includes(this.lyricsOwner);
    for(const beat of this.projectedLyrics) beat.lyrics = null;
    this.projectedLyrics = [];
    for(const [track, beats] of this.trackLyrics){
      for(const [beat, lyrics] of beats) beat.lyrics = shown && track === this.lyricsOwner ? lyrics : null;
    }
    const bottom = this.orderTracks(tracks).at(-1);
    if(!shown && this.lyricsOwner && bottom) this.projectLyrics(bottom);
  }

  /**
   * Legt den Text der Textspur zur Anzeige auf eine andere Spur: je Silbe auf den Schlag, der dort an derselben Stelle
   * beginnt, sonst auf den, der dann klingt (mehrere Silben auf einem Schlag hängt joinSyllables() aneinander).
   * Gemerkt in projectedLyrics, damit applyLyrics() es wieder wegnehmen kann.
   * @param {Track} track angezeigte Spur ohne Text
   * @returns {void}
   */
  projectLyrics(track){
    const staff = track.staves[0];
    for(const [beat, lyrics] of this.trackLyrics.get(this.lyricsOwner) ?? []){
      const voice = staff.bars[beat.voice.bar.index]?.voices[0];
      if(!voice) continue;
      const at = beat.playbackStart;
      const line = timeline(voice);
      const target = (line.find(e => e.start === at) ?? line.find(e => e.start < at && at < e.end))?.beat;
      if(!target) continue;
      if(!this.projectedLyrics.includes(target)){
        target.lyrics = [...lyrics];
        this.projectedLyrics.push(target);
      } else {
        target.lyrics = lyrics.map((l, k) => joinSyllables(target.lyrics[k] ?? '', l));
      }
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
    if(!indexes.length) indexes = this.defaults.flatMap((d, i) => d.show ? [i] : []);
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
    // Der Bearbeitungsmodus zeigt Takt und Linie des Abspielens nur, solange gespielt wird (siehe app.css).
    document.getElementById('songView')?.classList.toggle('is-playing', playing);
    this.mixer?.onState(playing);
    if(playing){
      // Manche Browser geben die Sperre erst nach einer Nutzeraktion; der Start ist eine.
      void this.requestWakeLock();
      markPlayed(this.slug);
    }
    if(!playing && this.midiStale) this.refreshMidi();
  }

  /**
   * Aktualisiert die Zeitanzeige und die Fortschrittslinie am oberen Rand der Leiste.
   * @param {number} current aktuelle Position in ms
   * @param {number} end Gesamtlänge in ms
   * @returns {void}
   */
  onPosition(current, end){
    this.el.timeNow.textContent = formatTime(current);
    this.el.timeEnd.textContent = formatTime(end);
    this.el.progress.style.width = `${end > 0 ? Math.min(100, current / end * 100) : 0}%`;
  }

  /**
   * Bildschirm anlassen (Handy am Notenständer).
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
   * Zeigt die Geschwindigkeit am Knopf: unter 100 % zusätzlich den Wert ("50 %"), und markiert ihn in der Liste.
   * @returns {void}
   */
  showSpeed(){
    const speed = this.prefs.speed;
    const badge = this.el.speedBadge;
    badge.hidden = speed === 1;
    badge.textContent = `${Math.round(speed * 100)} %`;
    this.el.speedBtn.title = `Geschwindigkeit: ${Math.round(speed * 100)} %`;
    for(const b of this.el.speedPop.querySelectorAll('[data-speed]')){
      b.setAttribute('aria-current', String(Number(/** @type {HTMLElement} */ (b).dataset.speed) === speed));
    }
  }

  /**
   * Öffnet bzw. schließt die Liste der Geschwindigkeiten über ihrem Knopf.
   * @param {boolean} [open] öffnen; ohne Angabe umschalten
   * @returns {void}
   */
  toggleSpeedMenu(open = this.el.speedPop.hidden){
    this.el.speedPop.hidden = !open;
    this.el.speedBtn.setAttribute('aria-expanded', String(open));
  }

  /**
   * Öffnet bzw. schließt den Mixer-Dialog.
   * @param {boolean} [open] öffnen; ohne Angabe umschalten
   * @returns {void}
   */
  toggleMixerDialog(open = this.el.mixer.hidden){
    this.el.mixer.hidden = !open;
    this.el.mixerBtn.setAttribute('aria-expanded', String(open));
    if(open) this.renderMixerDialog();
  }

  /**
   * Zeichnet den Mixer neu (nur wenn er offen ist und Noten geladen sind). Je Spur: Auge (Spur in den Noten anzeigen),
   * Lautsprecher (zu hören), Name, darunter Regler und Wert; darunter die Audiospur und mit Abstand Metronom und
   * Vorzähler, die nur den Lautsprecher haben. Was nicht zu hören ist, steht blass da. In "Chords" gibt es keine
   * Spuren zu zeigen, die Augen sind dort ohne Funktion.
   * @returns {void}
   */
  renderMixerDialog(){
    const api = this.api;
    if(!api?.score || this.el.mixer.hidden) return;
    const score = api.score;
    const shown = new Set(api.tracks.map(t => t.index));
    const chords = this.prefs.view === 'chords';

    /**
     * Eine Zeile des Mischpults.
     * @param {string} key Schlüssel der Spur ("track:3", "audio", "metronome" …)
     * @param {string} label Beschriftung
     * @param {number} [track] Index der Spur (nur bei Spuren: Auge zum Anzeigen)
     * @returns {string} HTML
     */
    const row = (key, label, track) => {
      const {volume, mute} = this.levelOf(key);
      const name = escapeHtml(label);
      const eye = track === undefined ? '<span class="mix-gap-icon"></span>'
        : `<button type="button" class="mix-icon" data-track-eye="${track}" aria-pressed="${shown.has(track)}"
            ${chords ? 'disabled' : ''} aria-label="${name} anzeigen"
            title="${chords ? 'In „Chords“ gibt es keine Spuren zu zeigen' : 'Spur in den Noten anzeigen'}">${
            eyeIcon(shown.has(track))}</button>`;
      return `<div class="mix-row">
        ${eye}
        <button type="button" class="mix-icon" data-audible="${key}" aria-pressed="${!mute}" aria-label="${name} hören"
          title="Zu hören">${speakerIcon(!mute)}</button>
        <div class="mix-body${mute ? ' off' : ''}">
          <div class="mix-label">${name}</div>
          <div class="mix-slider"><input type="range" min="0" max="1" step="0.05" value="${volume}"
            data-volume="${key}" aria-label="Lautstärke ${name}"><output data-level="${key}">${
            Math.round(volume * 100)} %</output></div>
        </div>
      </div>`;
    };

    this.el.mixer.innerHTML = `
      <div class="mix-rows">
        ${this.orderTracks(score.tracks).map(t => row(`track:${t.index}`, trackName(t), t.index)).join('')}
        ${this.mixer ? row('audio', 'Audiospur') : ''}
        ${this.mixer && !this.mixer.synced
          ? '<div class="hint">Die Noten haben keine Sync-Punkte, die Audiospur kann ihnen noch nicht folgen. Setzen '
            + 'lassen sie sich im Bearbeitungsmodus (Reiter „Audio“).</div>' : ''}
        <div class="mix-gap"></div>
        ${row('metronome', 'Metronom')}
        ${row('countIn', 'Vorzähler')}
      </div>
    `;
  }

  /**
   * Schaltet eine Spur zwischen zu hören und stumm um (Lautsprecher im Dialog "Spuren" des Editors).
   * @param {number} index Index der Spur
   * @returns {void}
   */
  toggleTrackMute(index){
    this.levelOf(`track:${index}`).toggleMute();
    this.saveLevels();
    this.renderMixerDialog();
  }

  /**
   * Zieht Lautstärke und Stumm der Spuren nach, wenn sich im Editor ihre Reihenfolge oder Zahl ändert.
   * @param {function(number): ?number} map alter Index → neuer Index (null: Spur gibt es nicht mehr)
   * @returns {void}
   */
  remapTracks(map){
    const tracks = {};
    for(const [index, entry] of Object.entries(this.mix.tracks)){
      const moved = map(Number(index));
      if(moved !== null) tracks[moved] = entry;
    }
    this.mix.tracks = tracks;
    this.saveLevels();
    this.renderMixerDialog();
  }

  /**
   * Klick im Mixer: Auge (Spur anzeigen; mindestens eine bleibt) oder Lautsprecher (zu hören bzw. stumm).
   * @param {HTMLElement} target angeklicktes Element
   * @returns {void}
   */
  onMixerClick(target){
    const button = /** @type {?HTMLElement} */ (target.closest('.mix-icon'));
    if(!button || !this.api) return;
    if(button.dataset.trackEye !== undefined){
      const track = Number(button.dataset.trackEye);
      const shown = new Set(this.api.tracks.map(t => t.index));
      if(shown.has(track)) shown.delete(track);
      else shown.add(track);
      if(shown.size) this.showTracks([...shown]);
    } else if(button.dataset.audible){
      this.levelOf(button.dataset.audible).toggleMute();
      this.saveLevels();
      this.renderMixerDialog();
    }
  }

  /**
   * Gibt alphaTab, Wake Lock und Listener frei und leert das Element.
   * @returns {void}
   */
  destroy(){
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerdown', this.onOutsideClick);
    clearTimeout(this.renderStatusTimer);
    this.strip.innerHTML = '';
    this.strip.hidden = true;
    this.releaseWakeLock();
    this.mixer?.destroy();
    this.mixer = null;
    this.stopHidingAttribution?.();
    this.stopHidingAttribution = null;
    this.api?.destroy();
    this.api = null;
    this.root.innerHTML = '';
  }
}

// --------------------------------------------------------------------------------------------------------------------
// Sync-Editor
// --------------------------------------------------------------------------------------------------------------------

/**
 * Sync-Editor: Sync-Punkte der Noten (\sync) an der Audiospur ausrichten. Unter den Noten liegt die Wellenform der
 * Audiospur mit einem Marker je Sync-Punkt; Marker lassen sich ziehen, setzen und löschen. Dazu Anfang und Ende der
 * Audiospur erkennen, alle Punkte verschieben und das Tempo an die Audiospur anpassen.
 *
 * Der Editor liegt im Panel "Audio" des Bearbeitungsmodus (Rückruf onEdit). Jede Änderung wirkt sofort auf den Player
 * (Noten und Mixer); Speichern und Rückgängig übernimmt der Bearbeitungsmodus. Ändern sich dort die Noten, liest
 * reload() die Sync-Punkte neu.
 */

/** Auflösung der Wellenform: ein Wert je PEAK_MS Millisekunden. */
const PEAK_MS = 10;
/** Fensterlänge für die Lautheit beim Erkennen von Anfang und Ende. */
const LOUDNESS_MS = 50;
/** Ab dieser Lautheit (relativ zum lautesten Fenster) gilt die Audiospur als hörbar: -30 dB. */
const ONSET_RATIO = 10 ** (-30 / 20);
/** Sichtbare Ausschnitte der Wellenform in Sekunden; der letzte zeigt die ganze Audiospur. */
const ZOOMS = [5, 10, 20, 40, 80, Infinity];
/** Abstand in Pixeln (CSS), in dem ein Klick einen Marker trifft. */
const HIT_PX = 8;
/** Mindestabstand zwischen zwei Sync-Punkten in ms. */
const MIN_GAP_MS = 10;
/** Schritt der Pfeiltasten für den ausgewählten Marker in ms (mit Umschalt: 1 ms). */
const NUDGE_MS = 10;

/**
 * Formatiert eine Position in der Audiospur.
 * @param {number} ms Millisekunden (auch negativ)
 * @returns {string} z. B. "1:04,61" oder "−0:00,25"
 */
function formatMs(ms){
  const sign = ms < 0 ? '−' : '';
  const cs = Math.round(Math.abs(ms) / 10);
  const s = Math.floor(cs / 100);
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')},${String(cs % 100).padStart(2, '0')}`;
}

/**
 * Formatiert eine Verschiebung mit Vorzeichen.
 * @param {number} ms Millisekunden
 * @returns {string} z. B. "+120 ms" oder "−2761 ms"
 */
function formatDelta(ms){
  const rounded = Math.round(ms);
  return `${rounded < 0 ? '−' : '+'}${Math.abs(rounded)} ms`;
}

/**
 * Schläge mit Noten in einem Takt, über alle Spuren (Pausen zählen nicht).
 * @param {Score} score Noten
 * @param {number} index Index des Takts
 * @returns {import('../../types/alphatab').model.Beat[]}
 */
function beatsWithNotes(score, index){
  /** @type {import('../../types/alphatab').model.Beat[]} */
  const beats = [];
  for(const track of score.tracks) for(const staff of track.staves) for(const voice of staff.bars[index]?.voices ?? []){
    for(const beat of voice.beats) if(!beat.isRest && beat.notes.length > 0) beats.push(beat);
  }
  return beats;
}

/**
 * Ob ein Takt in irgendeiner Spur Noten enthält.
 * @param {Score} score Noten
 * @param {number} index Index des Takts
 * @returns {boolean}
 */
function barHasNotes(score, index){
  return beatsWithNotes(score, index).length > 0;
}

/**
 * Sync-Editor für einen geladenen Player mit Audiospur.
 * Aufruf: const editor = new SyncEditor(root, player, callbacks); await editor.open(); … editor.destroy();
 */
export class SyncEditor {
  /**
   * Aktuelle Sync-Punkte, sortiert in Abspielreihenfolge.
   * @type {FlatSyncPoint[]}
   */
  points = [];
  /** Faktor der Tempoangaben je Takt (Index = Takt) gegenüber den Noten beim Laden (siehe baseTempos); fehlt: 1. */
  tempoFactors = [];
  /** Takt, für den das Tempo der Audiospur gerade angezeigt wird. */
  shownBar = -1;
  /**
   * Tempoangaben je Takt beim Laden (Grundlage für tempoFactor).
   * @type {number[][]}
   */
  baseTempos = [];
  /** Index des ausgewählten Punkts in points, -1 ohne Auswahl. */
  selected = -1;
  /**
   * Spitzenwerte der Wellenform (0 bis 1), ein Wert je PEAK_MS.
   * @type {Float32Array}
   */
  peaks = new Float32Array(0);
  /**
   * Lautheit (RMS) je LOUDNESS_MS.
   * @type {Float32Array}
   */
  loudness = new Float32Array(0);
  /** Länge der Audiospur in ms. */
  durationMs = 0;
  /** Beginn des sichtbaren Ausschnitts in ms. */
  viewStart = 0;
  /** Index in ZOOMS; beim Öffnen die ganze Audiospur. */
  zoom = ZOOMS.length - 1;
  /** Position der Wiedergabe in der Audiospur (ms). */
  playheadMs = 0;
  /**
   * Laufendes Ziehen eines Markers, null sonst.
   * @type {?{index: number, moved: boolean}}
   */
  drag = null;
  /** Verschiebung, die "Übrige Punkte auch verschieben" anwendet (ms), siehe offerShiftRest(). */
  pendingShift = 0;
  /**
   * Punkt, der dabei bleibt, wo er ist.
   * @type {?FlatSyncPoint}
   */
  pendingShiftExcept = null;
  /**
   * Abmeldungen von den Ereignissen von alphaTab.
   * @type {(() => void)[]}
   */
  unsubscribe = [];

  /**
   * @param {HTMLElement} root leeres Element für den Editor
   * @param {Player} player geladener Player mit Mixer
   * @param {{onEdit: function(): void, onSeek: function(number): void}} callbacks onEdit nach jeder Änderung an den
   *   Noten (die der Bearbeitungsmodus dann übernimmt), onSeek nach einem Klick in die Wellenform mit dem MIDI-Tick der
   *   Stelle (der Bearbeitungsmodus setzt dort seinen Cursor)
   */
  constructor(root, player, callbacks){
    /** Element des Editors. */
    this.root = root;
    /** Player mit Noten und Mixer. */
    this.player = player;
    /** Rückmeldung an den Bearbeitungsmodus. */
    this.callbacks = callbacks;
    root.innerHTML = `
      <div class="sync-editor">
        <div class="sync-toolbar">
          <button class="btn btn-sm" type="button" data-act="first" title="Ersten Sync-Punkt an den Anfang der Audiospur setzen">Anfang erkennen</button>
          <button class="btn btn-sm" type="button" data-act="last" title="Letzten Sync-Punkt an das Ende der Audiospur setzen">Ende erkennen</button>
          <button class="btn btn-sm" type="button" data-act="add" title="Sync-Punkt am Anfang des Takts setzen, in dem der Wellenform-Cursor steht">+ Punkt</button>
          <button class="btn btn-sm" type="button" data-act="remove" title="Ausgewählten Sync-Punkt löschen (Entf)">Punkt löschen</button>
          <span class="sync-shift">
            <input type="number" step="10" value="0" data-ref="shiftMs" aria-label="Alle Sync-Punkte verschieben um (ms)">
            <button class="btn btn-sm" type="button" data-act="shift" title="Alle Sync-Punkte verschieben; negativ heißt Audiospur früher">ms verschieben</button>
          </span>
          <span class="sync-tempo" data-ref="tempoInfo"></span>
          <button class="btn btn-sm" type="button" data-act="tempo" hidden></button>
          <span class="sync-spacer"></span>
          <button class="btn btn-sm" type="button" data-act="zoomOut" title="Ansicht verkleinern">&minus;</button>
          <button class="btn btn-sm" type="button" data-act="zoomIn" title="Ansicht vergrößern">+</button>
        </div>
        <canvas class="sync-wave" data-ref="canvas" tabindex="0" aria-label="Wellenform der Audiospur mit Sync-Punkten"></canvas>
        <input class="sync-scroll" type="range" min="0" max="0" step="10" value="0" data-ref="scroll" aria-label="Ausschnitt">
        <div class="sync-status" data-ref="status">Audiospur wird ausgewertet &hellip;</div>
      </div>
    `;
    /**
     * Elemente nach ihrem data-ref bzw. data-act.
     * @type {Record<string, HTMLElement>}
     */
    this.el = {};
    root.querySelectorAll('[data-ref]').forEach(n => { this.el[n.dataset.ref] = n; });
    root.querySelectorAll('[data-act]').forEach(n => { this.el[n.dataset.act] = n; });
    /** Zeichenfläche der Wellenform. */
    this.canvas = /** @type {HTMLCanvasElement} */ (this.el.canvas);
    /** Regler für den sichtbaren Ausschnitt. */
    this.scroll = /** @type {HTMLInputElement} */ (this.el.scroll);
    /** Zeichnet neu, wenn sich die Breite ändert. */
    this.resizeObserver = new ResizeObserver(() => this.draw());
  }

  /** alphaTab-Instanz des Players. */
  get api(){
    return this.player.api;
  }

  /** Mixer des Players. */
  get mixer(){
    return this.player.mixer;
  }

  /**
   * Liest die Sync-Punkte, wertet die Audiospur aus und verdrahtet die Bedienelemente.
   * @returns {Promise<void>}
   */
  async open(){
    // Abspielreihenfolge und Ticks gibt es erst, wenn alphaTab das MIDI erzeugt hat.
    if(!this.api.tickCache) await new Promise(resolve => { const off = this.api.midiLoaded.on(() => { off(); resolve(); }); });
    this.readScore();

    this.root.addEventListener('click', e => {
      const act = /** @type {HTMLElement} */ (e.target).closest('[data-act]')?.dataset.act;
      if(act) this.onAction(act);
    });
    this.canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', e => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', e => this.onPointerUp(e));
    this.canvas.addEventListener('keydown', e => this.onKey(e));
    this.canvas.addEventListener('wheel', e => this.onWheel(e), {passive: false});
    this.scroll.addEventListener('input', () => {
      this.viewStart = Number(this.scroll.value);
      this.draw();
    });
    const position = perFrame((/** @type {number} */ tick) => { if(this.unsubscribe.length) this.onPosition(tick); });
    this.unsubscribe.push(this.api.playerPositionChanged.on(e => position(e.currentTick)));
    this.resizeObserver.observe(this.canvas);

    await this.analyzeAudio();
    this.playheadMs = this.audioMsAt(this.api.tickPosition);
    this.showPoint(this.points[0]?.millisecondOffset ?? 0);
    this.updateButtons();
    this.setStatus(this.defaultStatus());
  }

  /**
   * Liest Sync-Punkte und Tempi aus den Noten des Players (Grundlage für Schließen ohne Speichern und das Tempo).
   * @returns {void}
   */
  readScore(){
    /** @type {Score} */
    const score = this.api.score;
    const basePoints = score.exportFlatSyncPoints();
    this.baseTempos = score.masterBars.map(mb => mb.tempoAutomations.map(a => a.value));
    this.tempoFactors = [];
    this.points = this.sortByPlayback(basePoints);
  }

  /**
   * Eingebettet: Die Noten haben sich im Bearbeitungsmodus geändert (neues Modell, Rückgängig). Sync-Punkte und Tempi
   * neu lesen und neu zeichnen; die Auswahl bleibt, solange es den Punkt gibt.
   * @returns {void}
   */
  reload(){
    if(!this.api?.score) return;
    this.readScore();
    if(this.selected >= this.points.length) this.selected = -1;
    this.updateButtons();
    this.draw();
  }

  /**
   * Stelle in der Audiospur, die zu einem Tick gehört; ohne Sync-Punkte die Zeit des Synths.
   * @param {number} tick MIDI-Tick
   * @returns {number} ms
   */
  audioMsAt(tick){
    return this.mixer.synced ? this.mixer.tickToAudioMs(tick) : this.api.timePosition;
  }

  /**
   * Hinweis in der Statuszeile, wenn nichts anderes zu melden ist.
   * @returns {string} HTML
   */
  defaultStatus(){
    return this.points.length
      ? 'Marker ziehen oder auswählen und mit den Pfeiltasten verschieben (10 ms, mit Umschalt 1 ms). Klick in die '
        + 'Wellenform springt an die Stelle.'
      : 'Die Noten haben noch keine Sync-Punkte: Mit „Anfang erkennen“ und „Ende erkennen“ beginnen.';
  }

  /**
   * Dekodiert die Audiospur und berechnet Wellenform und Lautheit.
   * @returns {Promise<void>}
   */
  async analyzeAudio(){
    const context = new AudioContext();
    let buffer;
    try {
      buffer = await context.decodeAudioData(this.mixer.bytes.slice().buffer);
    } finally {
      void context.close();
    }
    const rate = buffer.sampleRate;
    const channels = [...Array(buffer.numberOfChannels).keys()].map(c => buffer.getChannelData(c));
    const length = buffer.length;
    this.durationMs = length / rate * 1000;
    const perPeak = Math.max(1, Math.round(rate * PEAK_MS / 1000));
    const perLoudness = Math.max(1, Math.round(rate * LOUDNESS_MS / 1000));
    this.peaks = new Float32Array(Math.ceil(length / perPeak));
    this.loudness = new Float32Array(Math.ceil(length / perLoudness));
    const squares = new Float64Array(this.loudness.length);
    for(let i = 0; i < length; i++){
      let v = 0;
      for(const data of channels) v += data[i];
      v /= channels.length;
      const abs = Math.abs(v);
      const p = Math.floor(i / perPeak);
      if(abs > this.peaks[p]) this.peaks[p] = abs;
      squares[Math.floor(i / perLoudness)] += v * v;
    }
    for(let i = 0; i < squares.length; i++) this.loudness[i] = Math.sqrt(squares[i] / perLoudness);
    const max = this.peaks.reduce((m, v) => Math.max(m, v), 0) || 1;
    for(let i = 0; i < this.peaks.length; i++) this.peaks[i] /= max;
  }

  /**
   * Takte in Abspielreihenfolge (mit Wiederholungen), mit der wievielten Wiederholung des Takts.
   * @returns {{lookup: MasterBarTickLookup, occurrence: number}[]}
   */
  playOrder(){
    const counts = new Map();
    const ticks = this.api.tickCache;
    return (ticks ? ticks.masterBars : []).map(lookup => {
      const index = lookup.masterBar.index;
      const occurrence = counts.get(index) ?? 0;
      counts.set(index, occurrence + 1);
      return {lookup, occurrence};
    });
  }

  /**
   * MIDI-Tick eines Sync-Punkts.
   * @param {FlatSyncPoint} p Sync-Punkt
   * @returns {number} Tick; Infinity, wenn es den Takt in dieser Wiederholung nicht gibt
   */
  tickOf(p){
    const entry = this.playOrder().find(e => e.lookup.masterBar.index === p.barIndex && e.occurrence === p.barOccurence);
    return entry ? entry.lookup.start + p.barPosition * (entry.lookup.end - entry.lookup.start) : Infinity;
  }

  /**
   * Sortiert Sync-Punkte in Abspielreihenfolge (bei Wiederholungen nicht dasselbe wie nach Takt).
   * @param {FlatSyncPoint[]} points Sync-Punkte
   * @returns {FlatSyncPoint[]} dieselbe Liste, sortiert
   */
  sortByPlayback(points){
    const ticks = new Map(points.map(p => [p, this.tickOf(p)]));
    return points.sort((a, b) => ticks.get(a) - ticks.get(b));
  }

  /**
   * Beschriftung eines Markers.
   * @param {FlatSyncPoint} p Sync-Punkt
   * @returns {string} z. B. "12", "12 (2.)" für die zweite Wiederholung, "12 ⇥" für das Taktende
   */
  label(p){
    return `${p.barIndex + 1}`
      + (p.barPosition >= 1 ? ' ⇥' : p.barPosition > 0 ? ` +${Math.round(p.barPosition * 100)} %` : '')
      + (p.barOccurence > 0 ? ` (${p.barOccurence + 1}.)` : '');
  }

  /**
   * Übernimmt points und tempoFactors in den Player: Sync-Punkte in die Noten und den Mixer, Tempi neu (gerundet wie
   * beim Speichern) und das Tempo der Audiospur ins MIDI (während der Wiedergabe erst, wenn sie anhält; bei geändertem
   * Tempo sofort, dann werden auch die Noten neu gezeichnet, damit die Tempoangaben stimmen).
   * @param {boolean} [tempoChanged] ob sich tempoFactors geändert hat
   * @returns {void}
   */
  apply(tempoChanged = false){
    /** @type {Score} */
    const score = this.api.score;
    score.applyFlatSyncPoints(sortSyncPoints(this.points));
    if(tempoChanged){
      for(const [i, mb] of score.masterBars.entries()){
        mb.tempoAutomations.forEach((a, j) => { a.value = Math.round(this.baseTempos[i][j] * (this.tempoFactors[i] ?? 1)); });
      }
    }
    this.mixer.setScore(score);
    this.player.applySpeed(this.api.tickPosition, true);
    this.player.refreshMidi(tempoChanged);
    // Die Tempoangaben stehen in den Noten (♩=…): neu zeichnen, sonst zeigen sie noch das alte Tempo.
    if(tempoChanged) this.api.render();
    this.updateButtons();
    this.draw();
    this.callbacks.onEdit();
  }

  /**
   * Führt eine Aktion aus der Werkzeugleiste aus.
   * @param {string} act Wert von data-act
   * @returns {void}
   */
  onAction(act){
    switch(act){
      case 'first': this.detectFirst(); break;
      case 'last': this.detectLast(); break;
      case 'add': this.addAtCursor(); break;
      case 'remove': this.removeSelected(); break;
      case 'shift': {
        const input = /** @type {HTMLInputElement} */ (this.el.shiftMs);
        this.shiftAll(Number(input.value) || 0);
        break;
      }
      case 'shiftRest': this.shiftAll(this.pendingShift, this.pendingShiftExcept); break;
      case 'tempo': this.adjustTempo(); break;
      case 'zoomIn': this.setZoom(this.zoom - 1); break;
      case 'zoomOut': this.setZoom(this.zoom + 1); break;
    }
  }

  /**
   * Setzt einen Sync-Punkt (ersetzt einen an derselben Stelle) und entfernt bei Bedarf alle davor bzw. dahinter.
   * @param {FlatSyncPoint} point neuer Sync-Punkt
   * @param {('before'|'after'|null)} drop Punkte davor bzw. dahinter entfernen
   * @returns {number} Verschiebung gegenüber der bisherigen Zuordnung dieser Stelle in ms
   */
  placePoint(point, drop){
    const tick = this.tickOf(point);
    const previousMs = this.mixer.synced ? this.mixer.tickToAudioMs(tick) : point.millisecondOffset;
    this.points = this.points.filter(p => {
      const t = this.tickOf(p);
      return t !== tick && !(drop === 'before' && t < tick) && !(drop === 'after' && t > tick);
    });
    this.points.push(point);
    this.sortByPlayback(this.points);
    this.selected = this.points.indexOf(point);
    this.apply();
    this.showPoint(point.millisecondOffset);
    return point.millisecondOffset - previousMs;
  }

  /**
   * Bietet nach dem Setzen eines Punkts an, alle übrigen um dieselbe Zeit zu verschieben (z. B. nach dem Wechsel auf
   * einen anders geschnittenen Clip).
   * @param {string} message Meldung (Text)
   * @param {number} delta Verschiebung in ms
   * @param {FlatSyncPoint} except der gerade gesetzte Punkt
   * @returns {void}
   */
  offerShiftRest(message, delta, except){
    this.pendingShift = delta;
    this.pendingShiftExcept = except;
    const others = this.points.length - 1;
    this.setStatus(escapeHtml(message) + (others > 0 && Math.abs(delta) >= 1
      ? ` <button class="btn btn-sm" type="button" data-act="shiftRest">${others === 1 ? 'Den anderen Punkt'
        : `Die übrigen ${others} Punkte`} auch um ${formatDelta(delta)} verschieben</button>`
      : ''));
  }

  /**
   * Setzt den ersten Sync-Punkt an die erste Note des ersten Takts mit Noten (beginnt der Takt mit Pausen, also
   * mitten in den Takt), auf die Stelle, an der die Audiospur hörbar wird. Punkte davor fallen weg. Das ist nur ein
   * Vorschlag: Beginnt die Audiospur mit Sprechen oder Geräuschen, liegt er zu früh.
   * @returns {void}
   */
  detectFirst(){
    const threshold = this.loudness.reduce((m, v) => Math.max(m, v), 0) * ONSET_RATIO;
    const index = this.loudness.findIndex(v => v >= threshold);
    const score = this.api.score;
    const bar = score.masterBars.findIndex(mb => barHasNotes(score, mb.index));
    if(index < 0 || bar < 0){
      this.setStatus('Kein Anfang gefunden (keine Noten oder stille Audiospur).');
      return;
    }
    const firstTick = Math.min(...beatsWithNotes(score, bar).map(beat => beat.playbackStart));
    const position = firstTick / score.masterBars[bar].calculateDuration();
    const point = {barIndex: bar, barOccurence: 0, barPosition: position, millisecondOffset: index * LOUDNESS_MS};
    const delta = this.placePoint(point, 'before');
    this.offerShiftRest(`Erste Note (Takt ${this.label(point)}) jetzt bei ${formatMs(point.millisecondOffset)}`
      + ` (${formatDelta(delta)}).`, delta, point);
  }

  /**
   * Setzt den letzten Sync-Punkt an das Ende des letzten Takts mit Noten (in seiner letzten Wiederholung), auf die
   * Stelle, an der die Audiospur verklingt. Punkte dahinter fallen weg.
   * @returns {void}
   */
  detectLast(){
    const threshold = this.loudness.reduce((m, v) => Math.max(m, v), 0) * ONSET_RATIO;
    let index = this.loudness.length - 1;
    while(index >= 0 && this.loudness[index] < threshold) index--;
    const score = this.api.score;
    const order = this.playOrder().filter(e => barHasNotes(score, e.lookup.masterBar.index));
    const last = order[order.length - 1];
    if(index < 0 || !last){
      this.setStatus('Kein Ende gefunden (keine Noten oder stille Audiospur).');
      return;
    }
    const point = {barIndex: last.lookup.masterBar.index, barOccurence: last.occurrence, barPosition: 1,
      millisecondOffset: Math.min(this.durationMs, (index + 1) * LOUDNESS_MS)};
    const delta = this.placePoint(point, 'after');
    this.setStatus(escapeHtml(`Takt ${point.barIndex + 1} endet jetzt bei ${formatMs(point.millisecondOffset)}`
      + ` (${formatDelta(delta)}).`));
  }

  /**
   * Setzt einen Sync-Punkt an den Anfang des Takts, in dem der Wellenform-Cursor (Wiedergabeposition) steht, an die
   * Stelle, die ihm jetzt schon entspricht. Danach lässt er sich ziehen.
   * @returns {void}
   */
  addAtCursor(){
    const tick = this.api.tickPosition;
    const entry = this.playOrder().find(e => e.lookup.start <= tick && tick < e.lookup.end);
    if(!entry) return;
    const ms = this.mixer.synced
      ? this.mixer.tickToAudioMs(entry.lookup.start)
      : this.api.timePosition;
    const point = {barIndex: entry.lookup.masterBar.index, barOccurence: entry.occurrence, barPosition: 0,
      millisecondOffset: Math.max(0, ms)};
    if(this.points.some(p => this.tickOf(p) === entry.lookup.start)){
      this.selected = this.points.findIndex(p => this.tickOf(p) === entry.lookup.start);
      this.showPoint(this.points[this.selected].millisecondOffset);
      this.setStatus(`Takt ${point.barIndex + 1} hat schon einen Sync-Punkt (ausgewählt).`);
      return;
    }
    this.placePoint(point, null);
    this.setStatus(escapeHtml(`Sync-Punkt für Takt ${this.label(point)} gesetzt. Jetzt an die richtige Stelle ziehen.`));
  }

  /**
   * Löscht den ausgewählten Sync-Punkt.
   * @returns {void}
   */
  removeSelected(){
    if(this.selected < 0) return;
    this.points.splice(this.selected, 1);
    this.selected = -1;
    this.apply();
  }

  /**
   * Verschiebt Sync-Punkte um eine feste Zeit.
   * @param {number} ms Verschiebung (negativ: Audiospur früher)
   * @param {?FlatSyncPoint} [except] dieser Punkt bleibt
   * @returns {void}
   */
  shiftAll(ms, except = null){
    if(!ms || !this.points.length) return;
    for(const p of this.points){
      if(p !== except) p.millisecondOffset += ms;
    }
    this.apply();
    const count = except ? this.points.length - 1 : this.points.length;
    this.setStatus(escapeHtml(`${count === 1 ? 'Einen Punkt' : `${count} Punkte`} um ${formatDelta(ms)} verschoben.`));
  }

  /**
   * Takt, auf den sich das Tempo bezieht: der des gewählten Sync-Punkts, sonst der an der Abspielposition.
   * @returns {number} Takt (0-basiert)
   */
  currentBar(){
    const point = this.points[this.selected];
    if(point) return point.barIndex;
    const tick = this.api.tickPosition;
    return this.playOrder().find(e => e.lookup.start <= tick && tick < e.lookup.end)?.lookup.masterBar.index ?? 0;
  }

  /**
   * Tempo der Audiospur im Abschnitt ohne Tempowechsel am aktuellen Takt (siehe recordingTempoRegion()).
   * @returns {?import('./notation.js').TempoRegion}
   */
  tempoRegion(){
    return recordingTempoRegion(this.player.alphaTab, this.api.score, this.currentBar());
  }

  /**
   * Passt das notierte Tempo des aktuellen Abschnitts an die Audiospur an.
   * @returns {?{region: import('./notation.js').TempoRegion}} null, wenn das Tempo schon passt
   */
  tempoProposal(){
    const region = this.tempoRegion();
    return region && region.recorded !== region.tempo ? {region} : null;
  }

  /**
   * Passt das Tempo des aktuellen Abschnitts (ab dem letzten Tempowechsel bis zum nächsten) an die Audiospur an; die
   * Sync-Punkte und die anderen Abschnitte bleiben unverändert.
   * @returns {void}
   */
  adjustTempo(){
    const proposal = this.tempoProposal();
    if(!proposal) return;
    const {region} = proposal;
    this.tempoFactors[region.start] = (this.tempoFactors[region.start] ?? 1) * region.factor;
    this.apply(true);
    this.setStatus(escapeHtml(`Tempo ab Takt ${region.start + 1} von ${region.tempo} auf ${region.recorded} BPM angepasst.`));
  }

  /**
   * Aktiviert bzw. sperrt die Buttons je nach Stand.
   * @returns {void}
   */
  updateButtons(){
    /** @type {(name: string, disabled: boolean) => void} */
    const set = (name, disabled) => {
      const button = /** @type {HTMLButtonElement} */ (this.el[name]);
      button.disabled = disabled;
    };
    set('remove', this.selected < 0);
    set('shift', !this.points.length);
    // Tempo der Audiospur im Abschnitt ohne Tempowechsel am aktuellen Takt: Mittel vom ersten bis zum letzten Sync-Punkt
    // des Abschnitts (siehe recordingTempoRegion()).
    const region = this.tempoRegion();
    this.el.tempoInfo.textContent = region ? `Tempo der Audiospur ab Takt ${region.start + 1} bis ${region.end}: ${region.recorded} BPM` : '';
    this.el.tempoInfo.title = region ? `Im Mittel von Takt ${region.start + 1} bis ${region.end} (bis zum nächsten Tempowechsel)` : '';
    const proposal = this.tempoProposal();
    this.el.tempo.hidden = !proposal;
    if(proposal){
      this.el.tempo.textContent = `Tempo ${proposal.region.tempo} → ${proposal.region.recorded} BPM`;
      this.el.tempo.title = `Passt das notierte Tempo bei Takt ${proposal.region.start + 1} an die Audiospur an`
        + ' (bis zum nächsten Tempowechsel; die Sync-Punkte bleiben)';
    }
  }

  /**
   * Zeigt eine Meldung unter der Wellenform.
   * @param {string} html Meldung (HTML)
   * @returns {void}
   */
  setStatus(html){
    this.el.status.innerHTML = html;
  }

  /**
   * Sichtbare Zeitspanne in ms.
   * @returns {number}
   */
  get viewSpan(){
    return Math.min(this.durationMs, ZOOMS[this.zoom] * 1000) || 1;
  }

  /**
   * Stellt die Vergrößerung ein und behält die Mitte des Ausschnitts.
   * @param {number} zoom Index in ZOOMS
   * @returns {void}
   */
  setZoom(zoom){
    const center = this.viewStart + this.viewSpan / 2;
    this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, zoom));
    this.showPoint(center, true);
  }

  /**
   * Verschiebt den Ausschnitt so, dass eine Stelle sichtbar ist.
   * @param {number} ms Stelle in der Audiospur
   * @param {boolean} [center] immer mittig zeigen, sonst nur, wenn die Stelle außerhalb liegt
   * @returns {void}
   */
  showPoint(ms, center = false){
    const span = this.viewSpan;
    if(center || ms < this.viewStart || ms > this.viewStart + span){
      this.viewStart = ms - span / 2;
    }
    this.viewStart = Math.max(0, Math.min(this.durationMs - span, this.viewStart));
    this.scroll.max = String(Math.max(0, Math.round(this.durationMs - span)));
    this.scroll.value = String(Math.round(this.viewStart));
    this.draw();
  }

  /**
   * Zeichnet Wellenform, Marker und Wiedergabeposition.
   * @returns {void}
   */
  draw(){
    const canvas = this.canvas;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if(!width || !height) return;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const css = getComputedStyle(this.root);
    const color = name => css.getPropertyValue(name).trim();
    ctx.fillStyle = color('--paper');
    ctx.fillRect(0, 0, width, height);

    const top = 16;
    const mid = top + (height - top) / 2;
    const amp = (height - top) / 2 - 2;
    const span = this.viewSpan;
    const msPerPx = span / width;
    ctx.fillStyle = color('--accent');
    for(let x = 0; x < width; x++){
      const from = Math.floor((this.viewStart + x * msPerPx) / PEAK_MS);
      const to = Math.max(from + 1, Math.floor((this.viewStart + (x + 1) * msPerPx) / PEAK_MS));
      let peak = 0;
      for(let i = from; i < to && i < this.peaks.length; i++) if(this.peaks[i] > peak) peak = this.peaks[i];
      const h = Math.max(1, peak * amp);
      ctx.fillRect(x, mid - h, 1, h * 2);
    }

    ctx.font = '11px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.textBaseline = 'top';
    for(const [i, p] of this.points.entries()){
      const x = (p.millisecondOffset - this.viewStart) / msPerPx;
      if(x < -40 || x > width + 40) continue;
      const active = i === this.selected;
      ctx.strokeStyle = ctx.fillStyle = active ? color('--mark') : color('--ink');
      ctx.lineWidth = active ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      const text = this.label(p);
      const w = ctx.measureText(text).width + 8;
      ctx.fillRect(x, 0, w, 14);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x + 4, 1);
    }

    const px = (this.playheadMs - this.viewStart) / msPerPx;
    if(px >= 0 && px <= width){
      ctx.strokeStyle = color('--danger');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
  }

  /**
   * Position in der Audiospur unter einem Zeigerereignis.
   * @param {PointerEvent|WheelEvent} e Ereignis auf der Zeichenfläche
   * @returns {number} ms
   */
  msAt(e){
    const rect = this.canvas.getBoundingClientRect();
    return this.viewStart + (e.clientX - rect.left) / rect.width * this.viewSpan;
  }

  /**
   * Index des Markers unter einem Zeigerereignis.
   * @param {PointerEvent} e Ereignis auf der Zeichenfläche
   * @returns {number} Index in points, -1 ohne Treffer
   */
  hitPoint(e){
    const msPerPx = this.viewSpan / this.canvas.getBoundingClientRect().width;
    const ms = this.msAt(e);
    let best = -1;
    let bestDistance = HIT_PX * msPerPx;
    for(const [i, p] of this.points.entries()){
      const distance = Math.abs(p.millisecondOffset - ms);
      if(distance <= bestDistance){
        best = i;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Klick auf einen Marker wählt ihn aus und beginnt das Ziehen; Klick daneben springt an die Stelle.
   * @param {PointerEvent} e Ereignis
   * @returns {void}
   */
  onPointerDown(e){
    this.canvas.focus();
    const hit = this.hitPoint(e);
    this.selected = hit;
    if(hit >= 0){
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = {index: hit, moved: false};
      const p = this.points[hit];
      this.setStatus(escapeHtml(`Takt ${this.label(p)} bei ${formatMs(p.millisecondOffset)}`));
    } else if(this.mixer.synced){
      const tick = this.mixer.audioMsToTick(this.msAt(e));
      this.api.tickPosition = tick;
      this.callbacks.onSeek(tick);
    }
    this.updateButtons();
    this.draw();
  }

  /**
   * Zieht den ausgewählten Marker, begrenzt durch die Nachbarn.
   * @param {PointerEvent} e Ereignis
   * @returns {void}
   */
  onPointerMove(e){
    if(!this.drag) return;
    if(!this.drag.moved){
      this.drag.moved = true;
    }
    this.moveSelected(this.msAt(e), false);
  }

  /**
   * Beendet das Ziehen und übernimmt die neue Stelle in den Player.
   * @param {PointerEvent} e Ereignis
   * @returns {void}
   */
  onPointerUp(e){
    if(!this.drag) return;
    this.canvas.releasePointerCapture(e.pointerId);
    const moved = this.drag.moved;
    this.drag = null;
    if(moved) this.apply();
  }

  /**
   * Setzt den ausgewählten Marker auf eine Stelle zwischen seinen Nachbarn.
   * @param {number} ms neue Stelle
   * @param {boolean} commit sofort in den Player übernehmen (sonst erst beim Loslassen)
   * @returns {void}
   */
  moveSelected(ms, commit){
    const i = this.selected;
    if(i < 0) return;
    const min = i > 0 ? this.points[i - 1].millisecondOffset + MIN_GAP_MS : -Infinity;
    const max = i < this.points.length - 1 ? this.points[i + 1].millisecondOffset - MIN_GAP_MS : Infinity;
    const p = this.points[i];
    p.millisecondOffset = Math.round(Math.max(min, Math.min(max, ms)));
    this.setStatus(escapeHtml(`Takt ${this.label(p)} bei ${formatMs(p.millisecondOffset)}`));
    if(commit) this.apply();
    else this.draw();
  }

  /**
   * Tastatur auf der Wellenform: Pfeiltasten verschieben den ausgewählten Marker, Entf löscht ihn, Strg+Z nimmt
   * zurück (eingebettet das Rückgängig des Bearbeitungsmodus).
   * @param {KeyboardEvent} e Ereignis
   * @returns {void}
   */
  onKey(e){
    if(e.key === 'Delete' || e.key === 'Backspace'){
      e.preventDefault();
      this.removeSelected();
    } else if((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.selected >= 0){
      e.preventDefault();
      const step = (e.shiftKey ? 1 : NUDGE_MS) * (e.key === 'ArrowLeft' ? -1 : 1);
      this.moveSelected(this.points[this.selected].millisecondOffset + step, true);
    }
  }

  /**
   * Mausrad: verschiebt den Ausschnitt, mit Strg vergrößert bzw. verkleinert es.
   * @param {WheelEvent} e Ereignis
   * @returns {void}
   */
  onWheel(e){
    e.preventDefault();
    if(e.ctrlKey){
      this.setZoom(this.zoom + (e.deltaY > 0 ? 1 : -1));
      return;
    }
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    this.viewStart += delta / this.canvas.clientWidth * this.viewSpan;
    this.showPoint(this.viewStart + this.viewSpan / 2, true);
  }

  /**
   * Folgt der Wiedergabe: Position anzeigen und beim Abspielen den Ausschnitt nachführen.
   * @param {number} tick aktueller MIDI-Tick
   * @returns {void}
   */
  onPosition(tick){
    this.playheadMs = this.audioMsAt(tick);
    // Das Tempo gilt für den Abschnitt an der Abspielposition.
    const bar = this.currentBar();
    if(bar !== this.shownBar){
      this.shownBar = bar;
      this.updateButtons();
    }
    if(this.player.isPlaying && !this.drag) this.showPoint(this.playheadMs);
    else this.draw();
  }

  /**
   * Meldet den Editor ab und leert das Element.
   * @returns {void}
   */
  destroy(){
    for(const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.resizeObserver.disconnect();
    this.root.innerHTML = '';
  }
}
