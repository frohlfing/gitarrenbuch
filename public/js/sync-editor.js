/**
 * Sync-Editor: Sync-Punkte der Noten (\sync) an der Audiospur ausrichten. Unter den Noten liegt die Wellenform der
 * Audiospur mit einem Marker je Sync-Punkt; Marker lassen sich ziehen, setzen und löschen. Dazu Anfang und Ende der
 * Aufnahme erkennen, alle Punkte verschieben, das Tempo an die Aufnahme anpassen und Rückgängig.
 *
 * Jede Änderung wirkt sofort auf den Player (Noten und Mixer), gespeichert wird erst mit "Speichern". Geschrieben
 * werden dabei nur die Zeilen \sync und \tempo in score.atex (siehe writeSyncAndTempo() in score.js).
 */

import {escapeHtml, loadScoreText, saveScore} from './api.js';
import {readScoreInfo, recordingTempoFactor, sortSyncPoints, writeSyncAndTempo} from './score.js';

/** @typedef {import('../../types/alphatab').model.FlatSyncPoint} FlatSyncPoint */
/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').midi.MasterBarTickLookup} MasterBarTickLookup */
/** @typedef {import('./api.js').Song} Song */
/** @typedef {import('./player.js').Player} Player */
/** @typedef {import('./score.js').ScoreInfo} ScoreInfo */

/** Auflösung der Wellenform: ein Wert je PEAK_MS Millisekunden. */
const PEAK_MS = 10;
/** Fensterlänge für die Lautheit beim Erkennen von Anfang und Ende. */
const LOUDNESS_MS = 50;
/** Ab dieser Lautheit (relativ zum lautesten Fenster) gilt die Aufnahme als hörbar: -30 dB. */
const ONSET_RATIO = 10 ** (-30 / 20);
/** Sichtbare Ausschnitte der Wellenform in Sekunden; der letzte zeigt die ganze Aufnahme. */
const ZOOMS = [5, 10, 20, 40, 80, Infinity];
/** Abstand in Pixeln (CSS), in dem ein Klick einen Marker trifft. */
const HIT_PX = 8;
/** Mindestabstand zwischen zwei Sync-Punkten in ms. */
const MIN_GAP_MS = 10;
/** Schritt der Pfeiltasten für den ausgewählten Marker in ms (mit Umschalt: 1 ms). */
const NUDGE_MS = 10;
/** Höchstzahl der Schritte für Rückgängig. */
const MAX_UNDO = 100;

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
  return score.tracks.flatMap(track => track.staves.flatMap(staff => (staff.bars[index]?.voices ?? []).flatMap(voice =>
    voice.beats.filter(beat => !beat.isRest && beat.notes.length > 0))));
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
 * Aufruf: const editor = new SyncEditor(root, player, song, callbacks); await editor.open(); … editor.destroy();
 */
export class SyncEditor {
  /**
   * Aktuelle Sync-Punkte, sortiert in Abspielreihenfolge.
   * @type {FlatSyncPoint[]}
   */
  points = [];
  /** Faktor für alle Tempoangaben gegenüber score.atex beim Laden bzw. letzten Speichern. */
  tempoFactor = 1;
  /**
   * Tempoangaben je Takt beim Laden bzw. letzten Speichern (Grundlage für tempoFactor).
   * @type {number[][]}
   */
  baseTempos = [];
  /** Inhalt von score.atex beim Laden bzw. letzten Speichern. */
  baseTex = '';
  /**
   * Sync-Punkte beim Laden bzw. letzten Speichern (für Schließen ohne Speichern).
   * @type {FlatSyncPoint[]}
   */
  basePoints = [];
  /**
   * Frühere Stände für Rückgängig.
   * @type {{points: FlatSyncPoint[], tempoFactor: number, offsetTaken: boolean}[]}
   */
  undoStack = [];
  /** Ob es ungespeicherte Änderungen gibt. */
  dirty = false;
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
  /** Index in ZOOMS; beim Öffnen die ganze Aufnahme. */
  zoom = ZOOMS.length - 1;
  /** Position der Wiedergabe in der Audiospur (ms). */
  playheadMs = 0;
  /**
   * Laufendes Ziehen eines Markers, null sonst.
   * @type {?{index: number, moved: boolean}}
   */
  drag = null;
  /** Im Player eingestellter Audio-Versatz beim Öffnen (ms, positiv: Audio später), siehe takeOffset(). */
  playerOffset = 0;
  /** Ob der Versatz aus dem Player in die Sync-Punkte übernommen wurde (wird beim Speichern gelöscht). */
  offsetTaken = false;
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
   * @param {Song} song Song
   * @param {{onChange?: function(ScoreInfo): void, onClose?: function(): void}} [callbacks] onChange nach jeder
   *   Änderung (z. B. für die Kopfzeile), onClose nach dem Schließen
   */
  constructor(root, player, song, callbacks = {}){
    /** Element des Editors. */
    this.root = root;
    /** Player mit Noten und Mixer. */
    this.player = player;
    /** Song. */
    this.song = song;
    /** Rückmeldungen an die Liedansicht. */
    this.callbacks = callbacks;
    root.innerHTML = `
      <div class="sync-editor">
        <div class="sync-toolbar">
          <button class="btn btn-sm" type="button" data-act="first" title="Ersten Sync-Punkt an den Anfang der Aufnahme setzen">Anfang erkennen</button>
          <button class="btn btn-sm" type="button" data-act="last" title="Letzten Sync-Punkt an das Ende der Aufnahme setzen">Ende erkennen</button>
          <button class="btn btn-sm" type="button" data-act="add" title="Sync-Punkt am Anfang des Takts setzen, in dem der Wellenform-Cursor steht">+ Punkt</button>
          <button class="btn btn-sm" type="button" data-act="remove" title="Ausgewählten Sync-Punkt löschen (Entf)">Punkt löschen</button>
          <span class="sync-shift">
            <input type="number" step="10" value="0" data-ref="shiftMs" aria-label="Alle Sync-Punkte verschieben um (ms)">
            <button class="btn btn-sm" type="button" data-act="shift" title="Alle Sync-Punkte verschieben; negativ heißt Audiospur früher">ms verschieben</button>
          </span>
          <button class="btn btn-sm" type="button" data-act="tempo" hidden></button>
          <span class="sync-spacer"></span>
          <button class="btn btn-sm" type="button" data-act="undo" title="Rückgängig (Strg+Z)">&#8630;</button>
          <button class="btn btn-sm" type="button" data-act="zoomOut" title="Ansicht verkleinern">&minus;</button>
          <button class="btn btn-sm" type="button" data-act="zoomIn" title="Ansicht vergrößern">+</button>
          <button class="btn btn-sm btn-primary" type="button" data-act="save">Speichern</button>
          <button class="btn btn-sm" type="button" data-act="close">Schließen</button>
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
   * Lädt score.atex (Grundlage zum Speichern), wertet die Audiospur aus und verdrahtet die Bedienelemente.
   * @returns {Promise<void>}
   */
  async open(){
    // Abspielreihenfolge und Ticks gibt es erst, wenn alphaTab das MIDI erzeugt hat.
    if(!this.api.tickCache) await new Promise(resolve => { const off = this.api.midiLoaded.on(() => { off(); resolve(); }); });
    this.baseTex = await loadScoreText(this.song.slug);
    this.playerOffset = this.mixer.offset;
    /** @type {Score} */
    const score = this.api.score;
    this.basePoints = score.exportFlatSyncPoints();
    this.baseTempos = score.masterBars.map(mb => mb.tempoAutomations.map(a => a.value));
    this.points = this.sortByPlayback(this.basePoints.map(p => ({...p})));

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
    this.unsubscribe.push(this.api.playerPositionChanged.on(e => this.onPosition(e.currentTick)));
    this.resizeObserver.observe(this.canvas);

    await this.analyzeAudio();
    this.playheadMs = this.audioMsAt(this.api.tickPosition);
    this.showPoint(this.points[0]?.millisecondOffset ?? 0);
    this.updateButtons();
    this.setStatus(this.playerOffset
      ? `Im Player ist noch ein Audio-Versatz von ${this.playerOffset} ms eingestellt. `
        + '<button class="btn btn-sm" type="button" data-act="takeOffset">In die Sync-Punkte übernehmen</button>'
      : this.defaultStatus());
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
    return (this.api.tickCache?.masterBars ?? []).map(lookup => {
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
   * Merkt den aktuellen Stand für Rückgängig, vor jeder Änderung aufzurufen.
   * @returns {void}
   */
  remember(){
    this.undoStack.push({points: this.points.map(p => ({...p})), tempoFactor: this.tempoFactor,
      offsetTaken: this.offsetTaken});
    if(this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  /**
   * Übernimmt points und tempoFactor in den Player: Sync-Punkte in die Noten und den Mixer, Tempi neu (gerundet wie
   * beim Speichern) und das Tempo der Aufnahme ins MIDI (während der Wiedergabe erst, wenn sie anhält; bei geändertem
   * Tempo sofort).
   * @param {boolean} [tempoChanged] ob sich tempoFactor geändert hat
   * @returns {void}
   */
  apply(tempoChanged = false){
    /** @type {Score} */
    const score = this.api.score;
    score.applyFlatSyncPoints(sortSyncPoints(this.points));
    if(tempoChanged){
      for(const [i, mb] of score.masterBars.entries()){
        mb.tempoAutomations.forEach((a, j) => { a.value = Math.round(this.baseTempos[i][j] * this.tempoFactor); });
      }
    }
    this.mixer.setOffset(this.offsetTaken ? 0 : this.playerOffset);
    this.mixer.setScore(score);
    this.player.applySpeed(this.api.tickPosition, true);
    this.player.refreshMidi(tempoChanged);
    this.dirty = true;
    this.updateButtons();
    this.draw();
    this.callbacks.onChange?.(readScoreInfo(this.player.alphaTab, score));
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
      case 'shift': this.shiftAll(Number(/** @type {HTMLInputElement} */ (this.el.shiftMs).value) || 0); break;
      case 'shiftRest': this.shiftAll(this.pendingShift, this.pendingShiftExcept); break;
      case 'takeOffset': this.takeOffset(); break;
      case 'tempo': this.adjustTempo(); break;
      case 'undo': this.undo(); break;
      case 'zoomIn': this.setZoom(this.zoom - 1); break;
      case 'zoomOut': this.setZoom(this.zoom + 1); break;
      case 'save': void this.save(); break;
      case 'close': this.close(); break;
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
    const previousMs = this.mixer.synced ? this.mixer.tickToAudioMs(tick) - this.mixer.offset : point.millisecondOffset;
    this.remember();
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
   * mitten in den Takt), auf die Stelle, an der die Aufnahme hörbar wird. Punkte davor fallen weg. Das ist nur ein
   * Vorschlag: Beginnt die Aufnahme mit Sprechen oder Geräuschen, liegt er zu früh.
   * @returns {void}
   */
  detectFirst(){
    const threshold = this.loudness.reduce((m, v) => Math.max(m, v), 0) * ONSET_RATIO;
    const index = this.loudness.findIndex(v => v >= threshold);
    const score = this.api.score;
    const bar = score.masterBars.findIndex(mb => barHasNotes(score, mb.index));
    if(index < 0 || bar < 0){
      this.setStatus('Kein Anfang gefunden (keine Noten oder stille Aufnahme).');
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
   * Stelle, an der die Aufnahme verklingt. Punkte dahinter fallen weg.
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
      this.setStatus('Kein Ende gefunden (keine Noten oder stille Aufnahme).');
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
      ? this.mixer.tickToAudioMs(entry.lookup.start) - this.mixer.offset
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
    this.remember();
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
    this.remember();
    for(const p of this.points){
      if(p !== except) p.millisecondOffset += ms;
    }
    this.apply();
    const count = except ? this.points.length - 1 : this.points.length;
    this.setStatus(escapeHtml(`${count === 1 ? 'Einen Punkt' : `${count} Punkte`} um ${formatDelta(ms)} verschoben.`));
  }

  /**
   * Übernimmt den im Player eingestellten Audio-Versatz in die Sync-Punkte (positiv: Audio später).
   * @returns {void}
   */
  takeOffset(){
    const offset = this.playerOffset;
    if(!offset || this.offsetTaken) return;
    this.remember();
    for(const p of this.points) p.millisecondOffset += offset;
    this.offsetTaken = true;
    this.apply();
    this.setStatus(escapeHtml(`Versatz ${offset} ms übernommen. Nach dem Speichern ist er im Player wieder 0.`));
  }

  /**
   * Faktor, um den sich das Tempo an die Aufnahme anpassen ließe (siehe recordingTempoFactor()).
   * @returns {?{from: number, to: number, factor: number}} null, wenn das Tempo schon passt
   */
  tempoProposal(){
    const info = readScoreInfo(this.player.alphaTab, this.api.score);
    if(!info.recordedTempo || info.recordedTempo === info.tempo) return null;
    const factor = recordingTempoFactor(this.player.alphaTab, this.api.score);
    return factor ? {from: info.tempo, to: info.recordedTempo, factor} : null;
  }

  /**
   * Passt alle Tempoangaben an die Aufnahme an ("Tempo an der Audiospur anpassen"); Tempowechsel bleiben im
   * Verhältnis, die Sync-Punkte unverändert.
   * @returns {void}
   */
  adjustTempo(){
    const proposal = this.tempoProposal();
    if(!proposal) return;
    this.remember();
    this.tempoFactor *= proposal.factor;
    this.apply(true);
    this.setStatus(escapeHtml(`Tempo von ${proposal.from} auf ${this.api.score.tempo} BPM angepasst.`));
  }

  /**
   * Nimmt die letzte Änderung zurück.
   * @returns {void}
   */
  undo(){
    const state = this.undoStack.pop();
    if(!state) return;
    const tempoChanged = state.tempoFactor !== this.tempoFactor;
    this.points = state.points;
    this.tempoFactor = state.tempoFactor;
    this.offsetTaken = state.offsetTaken;
    this.selected = -1;
    this.apply(tempoChanged);
    this.dirty = this.undoStack.length > 0;
    this.updateButtons();
    this.setStatus(this.defaultStatus());
  }

  /**
   * Speichert Sync-Punkte und Tempi in score.atex.
   * @returns {Promise<void>}
   */
  async save(){
    const button = /** @type {HTMLButtonElement} */ (this.el.save);
    button.disabled = true;
    try {
      const tex = writeSyncAndTempo(this.player.alphaTab, this.baseTex, this.points, this.tempoFactor);
      await saveScore(this.song.slug, tex);
      this.baseTex = tex;
      this.basePoints = this.points.map(p => ({...p}));
      this.baseTempos = this.api.score.masterBars.map(mb => mb.tempoAutomations.map(a => a.value));
      this.tempoFactor = 1;
      this.undoStack = [];
      if(this.offsetTaken){
        this.player.clearStoredOffset();
        this.offsetTaken = false;
      }
      this.dirty = false;
      this.setStatus('Gespeichert.');
    } catch(err){
      this.setStatus(escapeHtml('Speichern fehlgeschlagen: ' + err.message));
    } finally {
      this.updateButtons();
    }
  }

  /**
   * Schließt den Editor; ungespeicherte Änderungen werden nach Rückfrage verworfen und im Player zurückgesetzt.
   * @returns {void}
   */
  close(){
    if(this.dirty){
      if(!window.confirm('Ungespeicherte Änderungen an den Sync-Punkten verwerfen?')) return;
      this.points = this.basePoints.map(p => ({...p}));
      const tempoChanged = this.tempoFactor !== 1;
      this.tempoFactor = 1;
      this.offsetTaken = false;
      this.apply(tempoChanged);
      this.dirty = false;
    }
    this.destroy();
    this.callbacks.onClose?.();
  }

  /**
   * Aktiviert bzw. sperrt die Buttons je nach Stand.
   * @returns {void}
   */
  updateButtons(){
    /** @type {(name: string, disabled: boolean) => void} */
    const set = (name, disabled) => { /** @type {HTMLButtonElement} */ (this.el[name]).disabled = disabled; };
    set('remove', this.selected < 0);
    set('shift', !this.points.length);
    set('undo', !this.undoStack.length);
    set('save', !this.dirty);
    const proposal = this.tempoProposal();
    this.el.tempo.hidden = !proposal;
    if(proposal) this.el.tempo.textContent = `Tempo ${proposal.from} → ${proposal.to} BPM`;
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
      this.api.tickPosition = this.mixer.audioMsToTick(this.msAt(e) - this.mixer.offset);
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
      this.remember();
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
   * zurück.
   * @param {KeyboardEvent} e Ereignis
   * @returns {void}
   */
  onKey(e){
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'){
      e.preventDefault();
      this.undo();
    } else if(e.key === 'Delete' || e.key === 'Backspace'){
      e.preventDefault();
      this.removeSelected();
    } else if((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.selected >= 0){
      e.preventDefault();
      this.remember();
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
