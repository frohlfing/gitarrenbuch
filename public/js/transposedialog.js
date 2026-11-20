/**
 * Dialog "Transponieren" des Bearbeitungsmodus: Halbtöne, Capo und Tuning an einer Stelle.
 *
 * - Halbtöne ändern Noten, Tabs, Akkorde und Tonart (transposeScore() in notation.js).
 * - Capo und Tuning ändern nur die Noten: Bünde, Tabs, Akkordnamen und Griffe bleiben, der Klang ändert sich.
 * - Der Klang eines Songs verschiebt sich um Halbtöne + Capo + Tuning (bei gleichmäßig verschobenen Saiten). Die
 *   Tonart wandert aus dem Feld "Tonart" um diese Verschiebung. Mit -2 Halbtönen und Capo +2 bleibt der Klang, nur die
 *   Griffe sind andere.
 * - Links stehen die Eingaben untereinander (darunter der Hinweis auf die Audiospur und die neue Tonart), rechts die Vorschau, untereinander "Jetzt" und "Danach": Tonart, die Griffbilder aller Akkorde des Songs, darunter alle
 *   gegriffenen Töne (von der tiefsten bis zur höchsten) mit Notenschlüssel, Vorzeichen und Tab. Ein Vorschlag nennt das Capo, bei
 *   dem die Akkorde am leichtesten zu greifen sind (Klang bleibt).
 */

import {
  chordDiagramSvg, escapeHtml, loadChordLibraryOrEmpty, NOTE_NAMES, svgIcon, transposeChordName,
  transposeKeySignature,
} from './base.js';
import {findGrips} from './chordgrips.js';
import {closeOverlay, openOverlay} from './library.js';
import {
  keyName, mergeChords, normalizeTuningText, openString, parseScore, parseTuningText, setCapo, setKeySignature, setTuning,
  SHIFT_MAX, transposeScore, tuningStaves,
} from './notation.js';
import {renderMiniScore, sheetChords} from './sheet.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Staff} Staff */

/** Größter Capo-Bund. */
const CAPO_MAX = 12;

/** Größtes Capo, das der Vorschlag für leichte Griffe prüft. */
const SUGGEST_CAPO_MAX = 9;

/** Wartezeit nach der letzten Eingabe, bis die Vorschau neu entsteht (ms). */
const PREVIEW_MS = 300;

/** Breite der Zeichnung der Vorschau (px). */
const PREVIEW_WIDTH = 1000;

/** So viele Töne zeigt die Vorschau höchstens (gleichmäßig ausgewählt, tiefster und höchster bleiben). */
const PREVIEW_NOTES = 32;

/** Töne je Takt in der Vorschau. */
const NOTES_PER_BAR = 8;

/**
 * Was der Dialog am Song ändert.
 * @typedef {Object} Retune
 * @property {number} semitones Halbtöne (Noten, Tabs, Akkorde, Tonart)
 * @property {?number} capo neuer Capo aller Spuren mit Saiten; null lässt ihn
 * @property {?number[]} tuning neues Tuning (MIDI, tiefste Saite zuerst) der Spuren mit so vielen Saiten wie die
 *   Akkordspur; null lässt es
 */

/**
 * Verschiebung des Klangs durch Capo und Tuning.
 * @param {Staff} staff Notensystem, an dem der Song gemessen wird (erste Spur der Akkorde, siehe tuningStaves())
 * @param {?number} capo neuer Capo
 * @param {?number[]} tuning neues Tuning (MIDI, tiefste Saite zuerst)
 * @returns {number} Halbtöne; bei Saiten, die verschieden weit wandern, zählt nur der Capo
 */
function soundShift(staff, capo, tuning){
  let shift = capo === null ? 0 : capo - staff.capo;
  if(tuning){
    const old = [...staff.tuning].reverse();
    const diffs = tuning.map((pitch, i) => pitch - old[i]);
    if(diffs.every(d => d === diffs[0])) shift += diffs[0];
  }
  return shift;
}

/**
 * Wendet die Änderung auf die Noten an: transponieren, Capo und Tuning setzen (die Bünde bleiben), die Tonart um die
 * Verschiebung des Klangs wandern lassen.
 * @param {import('./notation.js').AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @param {Retune} change Änderung
 * @param {import('./base.js').ChordLibrary} library Akkordkatalog (Griffe für neue Akkordnamen)
 * @returns {import('./notation.js').TransposeResult}
 */
export function applyRetune(alphaTab, score, change, library){
  const first = tuningStaves(score)[0] ?? null;
  const extra = first ? soundShift(first, change.capo, change.tuning) : 0;
  const result = transposeScore(alphaTab, score, change.semitones, library);
  if(first){
    if(change.capo !== null) setCapo(score, change.capo);
    if(change.tuning) for(const staff of tuningStaves(score)) setTuning(alphaTab, staff, change.tuning, false);
  }
  if(extra){
    for(const track of score.tracks) for(const staff of track.staves){
      if(staff.isPercussion) continue;
      for(const bar of staff.bars) bar.keySignature = transposeKeySignature(bar.keySignature, extra);
    }
  }
  return result;
}

/**
 * Tonart am Anfang des Songs.
 * @param {import('./notation.js').AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @returns {{keySignature: number, minor: boolean}}
 */
function keyOf(alphaTab, score){
  const bar = score.tracks.flatMap(t => t.staves).find(st => !st.isPercussion)?.bars[0];
  return {
    keySignature: bar?.keySignature ?? 0,
    minor: bar?.keySignatureType === alphaTab.model.KeySignatureType.Minor,
  };
}

/**
 * Kosten eines Akkords: Wie schwer ist sein bester Griff? Lage, Spanne, Finger und Barré zählen.
 * @param {string} name Akkordname
 * @param {number[]} tuning Tuning (MIDI, tiefste Saite zuerst)
 * @param {Map<string, number>} cache bekannte Kosten
 * @returns {number} kleiner = leichter
 */
function gripCost(name, tuning, cache){
  const key = `${name}|${tuning.join(',')}`;
  let cost = cache.get(key);
  if(cost === undefined){
    const found = findGrips(name, {tuning, limit: 1})[0];
    const f = found?.features;
    cost = !found ? 14 : f.position * 0.8 + f.span * 0.5 + f.fingers * 0.6 + (f.barre ? 3 : 0) + (found.preferred ? 0 : 2);
    cache.set(key, cost);
  }
  return cost;
}

/**
 * Die Töne, die der Song auf den Saiten greift (jede Saite-Bund-Kombination einmal), von der tiefsten zur höchsten, als
 * kleine Partitur mit Schlüssel, Vorzeichen und Tab.
 * @param {import('./notation.js').AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {{keySignature: number, minor: boolean}} key Tonart, die die Vorzeichen zeigen
 * @returns {?Score} null, wenn der Song keine Spur mit Saiten und Noten hat
 */
function miniScore(alphaTab, score, key){
  const staves = tuningStaves(score);
  const ref = staves[0];
  if(!ref) return null;
  /** @type {Map<string, {string: number, fret: number, pitch: number}>} */
  const seen = new Map();
  for(const staff of staves) for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats){
    for(const note of beat.notes){
      const key = `${note.string}:${note.fret}`;
      if(!seen.has(key)){
        seen.set(key, {string: note.string, fret: note.fret, pitch: openString(ref, note.string) + ref.capo + note.fret});
      }
    }
  }
  let notes = [...seen.values()].sort((a, b) => a.pitch - b.pitch || a.string - b.string);
  if(!notes.length) return null;
  if(notes.length > PREVIEW_NOTES){
    const step = (notes.length - 1) / (PREVIEW_NOTES - 1);
    notes = Array.from({length: PREVIEW_NOTES}, (_, i) => notes[Math.round(i * step)]);
  }
  const strings = ref.tuning.length;
  const tuning = ref.tuning.map(p => NOTE_NAMES[p % 12] + (Math.floor(p / 12) - 1)).join(' ');
  const bars = [];
  for(let i = 0; i < notes.length; i += NOTES_PER_BAR){
    bars.push(notes.slice(i, i + NOTES_PER_BAR).map(n => `${n.fret}.${strings - n.string + 1}.8`).join(' '));
  }
  const tex = `\\track ("Gitarre") {
  instrument acousticguitarsteel
}
  \\staff
    \\capo ${ref.capo}
    \\tuning (${tuning})
    \\ts (4 4)
    \\clef g2
      ${bars.join('\n    |\n      ')}
`;
  const mini = parseScore(alphaTab, tex);
  setKeySignature(alphaTab, mini, 0, key.keySignature, key.minor, true);
  return mini;
}

/**
 * Dialog "Transponieren" eines NoteEditor.
 */
export class TransposeDialog {
  /**
   * @param {import('./editor.js').NoteEditor} editor Bearbeitungsmodus
   */
  constructor(editor){
    this.editor = editor;
    this.alphaTab = editor.alphaTab;
    /** Zeitgeber der Vorschau. */
    this.timer = 0;
    /** Zähler der Vorschauen: Nur die jüngste zeichnet. */
    this.run = 0;
    /** Kosten der Griffe (Akkordname und Tuning → Kosten). @type {Map<string, number>} */
    this.costs = new Map();
  }

  /**
   * Öffnet den Dialog.
   * @returns {Promise<void>}
   */
  async open(){
    const ed = this.editor;
    const score = ed.score;
    this.library = await loadChordLibraryOrEmpty();
    /** Notensystem, an dem Capo und Tuning gemessen werden, null ohne Saiten. */
    this.ref = tuningStaves(score)[0] ?? null;
    this.standard = this.ref ? ed.standardTuning(this.ref.tuning.length) : null;
    /** Tuning der Spur als Text, wie es im Feld beginnt. */
    this.tuningText = this.ref ? ed.tuningText(this.ref) : '';
    const same = 'Schreibt die Noten um. Tabs und Akkorde bleiben unverändert.';
    const strings = this.ref
      ? `<div class="form-field"><label for="tpCapo">Capo</label>
          <input type="number" id="tpCapo" min="0" max="${CAPO_MAX}" value="${this.ref.capo}">
          <div class="hint">${same}</div><div class="hint" id="tpSuggest"></div></div>
        <div class="form-field"><label for="tpTuning">Tuning</label>
          <input type="text" id="tpTuning" value="${escapeHtml(this.tuningText)}" spellcheck="false">
          <div class="hint">${same}</div></div>`
      : '';
    openOverlay(`<h2>Transponieren</h2>
      <div class="tp">
        <div class="tp-inputs">
        <div class="tp-keyrow" id="tpKeyRow"></div>
        <div class="tp-row">
          <div class="form-field"><label for="tpSteps">Halbtöne</label>
            <input type="number" id="tpSteps" min="${-SHIFT_MAX}" max="${SHIFT_MAX}" value="0">
            <div class="hint">Schreibt Noten, Tabs und Akkorde um.</div></div>
          ${strings}
        </div>
        <div class="tp-warn" id="tpWarn" aria-live="polite"></div>
        <div class="tp-audio" id="tpAudio" hidden></div>
        <div class="tp-newkey" id="tpNewKey"></div>
        </div>
        <div class="tp-preview">
        <div class="tp-side" id="tpBefore"><p class="empty">Vorschau wird berechnet …</p></div>
        <div class="tp-side" id="tpAfter"></div>
        </div>
      </div>
      <div class="struct-actions">
        <button class="btn" type="button" id="tpCancel">Abbrechen</button>
        <button class="btn btn-primary" type="button" id="tpApply">Anwenden</button>
      </div>`);
    const root = /** @type {HTMLElement} */ (document.querySelector('.sheet .tp'));
    const refresh = () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.refresh(), PREVIEW_MS);
    };
    root.addEventListener('input', refresh);
    root.addEventListener('change', e => {
      const target = /** @type {HTMLInputElement} */ (e.target);
      if(target.id === 'tpTuning') this.normalizeTuning();
      if(target.id === 'tpSteps' || target.id === 'tpCapo') target.value = String(this.read()[target.id === 'tpSteps' ? 'semitones' : 'capo']);
      refresh();
    });
    root.addEventListener('click', e => {
      const target = /** @type {HTMLElement} */ (e.target);
      if(target.closest('[data-suggest-apply]')) this.takeSuggestion();
      const copy = /** @type {?HTMLElement} */ (target.closest('[data-copy]'));
      if(copy){
        void navigator.clipboard.writeText(copy.dataset.copy).then(() => {
          copy.setAttribute('aria-pressed', 'true');
          copy.title = 'Kopiert';
          window.setTimeout(() => {
            copy.setAttribute('aria-pressed', 'false');
            copy.title = 'Befehl kopieren';
          }, 1500);
        });
      }
    });
    document.getElementById('tpCancel').addEventListener('click', closeOverlay);
    document.getElementById('tpApply').addEventListener('click', () => void this.apply());
    this.renderKeyRow();
    void this.drawBefore();
    void this.refresh();
    window.setTimeout(() => this.suggest(), 50);
  }

  /**
   * Zeile über den Eingaben: die Tonart des Songs, von der aus sie wandert.
   * @returns {void}
   */
  renderKeyRow(){
    const key = keyOf(this.alphaTab, this.editor.score);
    document.getElementById('tpKeyRow').innerHTML =
      `<span>Aktuelle Tonart: <strong>${escapeHtml(keyName(key.keySignature, key.minor))}</strong></span>`;
  }

  /**
   * Eingaben des Dialogs.
   * @returns {{semitones: number, capo: ?number, tuning: ?number[]}}
   */
  read(){
    const field = id => /** @type {?HTMLInputElement} */ (document.getElementById(id));
    /**
     * Ganze Zahl aus einem Feld, in Grenzen.
     * @param {string} id Feld
     * @param {number} min kleinster Wert
     * @param {number} max größter Wert
     * @param {number} fallback Wert bei leerem oder ungültigem Feld
     * @returns {number}
     */
    const whole = (id, min, max, fallback) => {
      const text = field(id)?.value.trim();
      const n = Number(text);
      return text && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
    };
    // Unverändert (Text wie zu Beginn) gilt das Tuning der Spur, auch in anderer Oktavlage als der Standard.
    const same = field('tpTuning')?.value === this.tuningText;
    const tuning = !this.ref ? null : same ? [...this.ref.tuning].reverse()
      : parseTuningText(field('tpTuning').value, this.standard.midi) ?? [...this.ref.tuning].reverse();
    return {
      semitones: whole('tpSteps', -SHIFT_MAX, SHIFT_MAX, 0),
      capo: this.ref ? whole('tpCapo', 0, CAPO_MAX, this.ref.capo) : null,
      tuning,
    };
  }

  /**
   * Bringt das Tuning-Feld in die Form "D A D G B E" (siehe normalizeTuningText()).
   * @returns {void}
   */
  normalizeTuning(){
    const input = /** @type {HTMLInputElement} */ (document.getElementById('tpTuning'));
    input.value = normalizeTuningText(input.value, this.standard.names);
  }

  /**
   * Ob die Eingaben etwas ändern.
   * @param {{semitones: number, capo: ?number, tuning: ?number[]}} input Eingaben
   * @returns {boolean}
   */
  changes(input){
    if(input.semitones) return true;
    if(!this.ref) return false;
    return input.capo !== this.ref.capo || input.tuning?.join(',') !== [...this.ref.tuning].reverse().join(',');
  }

  /**
   * Zeichnet die Vorschau "Jetzt".
   * @returns {Promise<void>}
   */
  async drawBefore(){
    const html = await this.side(this.editor.score, 'Jetzt', keyOf(this.alphaTab, this.editor.score));
    const box = document.getElementById('tpBefore');
    if(box) box.innerHTML = html;
  }

  /**
   * Zeichnet die Vorschau "Danach" und die Hinweise dazu neu.
   * @returns {Promise<void>}
   */
  async refresh(){
    const run = ++this.run;
    const input = this.read();
    const apply = /** @type {?HTMLButtonElement} */ (document.getElementById('tpApply'));
    if(!apply) return;
    apply.disabled = !this.changes(input);
    const after = parseScore(this.alphaTab, this.editor.tex);
    const result = applyRetune(this.alphaTab, after, input, this.library);
    const shift = input.semitones + (this.ref ? soundShift(this.ref, input.capo, input.tuning) : 0);
    const warn = [];
    if(result.octaves) warn.push(`${result.octaves} Noten müssen um eine Oktave versetzt werden.`);
    if(result.skipped) warn.push(`${result.skipped} Noten bleiben unverändert (Flageoletts).`);
    document.getElementById('tpWarn').innerHTML = warn.map(w => `<div class="hint hint-warn">${escapeHtml(w)}</div>`).join('');
    this.showAudioHint(shift);
    const keyAfter = keyOf(this.alphaTab, after);
    document.getElementById('tpNewKey').innerHTML = `Neue Tonart: <strong>${escapeHtml(keyName(keyAfter.keySignature, keyAfter.minor))}</strong>`;
    const html = await this.side(after, 'Danach', keyAfter);
    if(run !== this.run) return;
    const box = document.getElementById('tpAfter');
    if(box) box.innerHTML = html;
  }

  /**
   * Hinweis auf die Audiospur: Ändert sich der Klang, bleibt sie unverändert; bin/audio.php erzeugt sie neu. Mit dem Befehl
   * zum Kopieren.
   * @param {number} shift Verschiebung des Klangs in Halbtönen
   * @returns {void}
   */
  showAudioHint(shift){
    const box = document.getElementById('tpAudio');
    box.hidden = !shift || !this.editor.player.hasAudio;
    if(box.hidden) return;
    const command = `php bin/audio.php --password=… --only=${this.editor.player.slug} --transponieren=${shift > 0 ? '+' : ''}${shift} --override`;
    box.innerHTML = `<div class="hint hint-warn">Die Audiospur bleibt unverändert. Bei Bedarf neu generieren:</div>
      <div class="tp-command"><code>${escapeHtml(command)}</code>
        <button class="ebtn" type="button" data-copy="${escapeHtml(command)}" title="Befehl kopieren"
          aria-label="Befehl kopieren">${svgIcon('copy')}</button></div>`;
  }

  /**
   * Eine Seite der Vorschau: Überschrift mit der Tonart, die Griffbilder der Akkorde, darunter die gegriffenen Töne als
   * Noten und Tab.
   * @param {Score} score Noten (jetzt oder danach)
   * @param {string} title Überschrift
   * @param {{keySignature: number, minor: boolean}} key Tonart, die gezeigt wird
   * @returns {Promise<string>} HTML
   */
  async side(score, title, key){
    const mini = miniScore(this.alphaTab, score, key);
    const svg = mini ? await renderMiniScore(this.alphaTab, mini, PREVIEW_WIDTH) : '<p class="empty">Keine Noten mit Saiten.</p>';
    const chords = sheetChords(score, {chords: {}}, this.library)
      .map(c => `<span class="tp-chord">${chordDiagramSvg(c.name, c.grip)}</span>`).join('');
    return `<h3>${escapeHtml(title)}: ${escapeHtml(keyName(key.keySignature, key.minor))}</h3>
      ${chords ? `<div class="tp-chords">${chords}</div>` : ''}
      <div class="tp-score">${svg}</div>`;
  }

  /**
   * Sucht das Capo, bei dem die Akkorde am leichtesten zu greifen sind, wenn der Klang bleibt (die Halbtöne gleichen das
   * Capo aus), und zeigt den Vorschlag.
   * @returns {void}
   */
  suggest(){
    const box = document.getElementById('tpSuggest');
    if(!box || !this.ref) return;
    /** @type {Map<string, number>} */
    const counts = new Map();
    for(const {chord} of mergeChords(this.editor.score)) counts.set(chord.name, (counts.get(chord.name) ?? 0) + 1);
    box.innerHTML = '';
    if(!counts.size) return;
    const tuning = this.read().tuning ?? [...this.ref.tuning].reverse();
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const current = this.ref.capo;
    const cost = capo => [...counts].reduce((sum, [name, n]) =>
      sum + n * gripCost(transposeChordName(name, current - capo), tuning, this.costs), 0) / total;
    let best = current;
    let bestCost = cost(current);
    for(let c = 0; c <= SUGGEST_CAPO_MAX; c++){
      const value = cost(c);
      if(value < bestCost - 1e-9){
        best = c;
        bestCost = value;
      }
    }
    if(best === current) return;
    box.dataset.capo = String(best);
    box.dataset.steps = String(current - best);
    box.innerHTML = `Empfohlen: ${best} (ergibt die meisten offenen Akkorde)
      <button class="btn btn-sm" type="button" data-suggest-apply title="Capo und die Halbtöne setzen, die den Klang erhalten">Übernehmen</button>`;
  }

  /**
   * Übernimmt den Vorschlag in die Felder: Capo und die passenden Halbtöne.
   * @returns {void}
   */
  takeSuggestion(){
    const box = document.getElementById('tpSuggest');
    /** @type {HTMLSelectElement} */ (document.getElementById('tpCapo')).value = box.dataset.capo;
    /** @type {HTMLSelectElement} */ (document.getElementById('tpSteps')).value = box.dataset.steps;
    void this.refresh();
  }

  /**
   * Übernimmt die Änderung in den Editor (ein Schritt für "Rückgängig") und schließt den Dialog.
   * @returns {Promise<void>}
   */
  async apply(){
    const input = this.read();
    if(!this.changes(input)) return;
    closeOverlay();
    await this.editor.retuneSong(input);
  }
}
