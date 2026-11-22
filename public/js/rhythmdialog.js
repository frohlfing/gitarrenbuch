/**
 * Dialog "Rhythmus ableiten" des Bearbeitungsmodus (Knopf im Dialog "Spuren"): legt aus einer Spur (z. B. Fingerstyle)
 * eine Begleitspur "Rhythmus" mit Strumming an, ohne Pattern-Katalog und ohne Namen für die Patterns.
 *
 * - Der Dialog zeigt alle Rhythmen, die in der Quellspur vorkommen (je Takt aus den Anschlägen abgeleitet,
 *   deriveBar() in sheet.js), gleiche zusammengefasst und nach Häufigkeit sortiert. Dazu steht, wo sie vorkommen
 *   ("ganzer Song", "Verse, Chorus", "Takte in 2/4", "Takte mit C", "letzter Takt im Chorus", sonst die Abschnitte
 *   mit Anteil, z. B. "Verse (12/48 Takte), Chorus").
 * - Die Rhythmen sind durchnummeriert. "Ähnliche zusammenfassen" übernimmt für jeden Rhythmus den häufigeren, dem er
 *   ähnlich ist (SIMILAR); der Knopf daneben (Kreispfeil) stellt nach einer Änderung die abgeleiteten wieder her.
 * - "Auf behaltene verteilen" gibt jeden Takt der übrigen Rhythmen dem ähnlichsten behaltenen (Häkchen), der dort
 *   passt (spreadToKept()).
 * - Jeder Rhythmus lässt sich ändern (Feld oder Klick ins Raster: nichts → ab → auf → gedämpft; Klick auf die
 *   Zählzeit betont). Ist ein anderer Rhythmus ähnlich (SIMILAR) und fällt mit ihm
 *   kein Anschlag eines Akkordwechsels weg, bietet ein Knopf an, ihn zu übernehmen.
 * - Wechselt in einem Takt ein Akkord an einer Stelle, an der die Quellspur anschlägt, sein Rhythmus aber nicht, steht
 *   dort eine rote Warnung, und "Übernehmen" ist gesperrt: Akkorde werden nie verschoben. Schlägt auch die Quellspur
 *   dort nicht an (Haltebogen, Pause), ist das kein Fehler.
 * - Übernehmen legt die Spur "Rhythmus" als erste Spur an (die Akkorde stehen oben; Akustikgitarre, Capo und Tuning
 *   der Quellspur) oder überschreibt die Quellspur, schreibt je Takt seinen Rhythmus mit dem Griff des Akkords, der
 *   dann klingt (fillBar() in sheet.js), übernimmt Ein- und Ausblenden der Quellspur (an den Anschlag, der dort klingt) und zieht
 *   die Akkorde in diese Spur (sie wird die Akkordspur). Ein Schritt für "Rückgängig".
 */

import {escapeHtml, loadChordLibraryOrEmpty, svgIcon} from './base.js';
import {closeOverlay, isOverlayOpen, openOverlay, openStackedOverlay} from './library.js';
import {
  deleteTrack, duplicateTrack, freeTrackName, instrumentByKey, instrumentOf, lyricsTrack, makeRest,
  moveContent, parseScore, setInstrument, timeline, trackName, WHOLE_TICKS,
} from './notation.js';
import {
  chordTimeline, deriveBar, editPattern, fillBar, gripFor, patternGridHtml, sectionGroup, sections, similarity,
  slotCount,
} from './sheet.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('./sheet.js').Pattern} Pattern */

/** Ab dieser Ähnlichkeit (Anteil gleicher Rasterplätze, similarity()) bietet der Dialog an, einen Rhythmus zu übernehmen. */
const SIMILAR = 0.75;

/** So viele Knöpfe "Rhythmus aus … übernehmen" stehen höchstens an einem Rhythmus. */
const TAKE_MAX = 2;

/**
 * Ein Rhythmus und die Takte, in denen er gilt.
 * @typedef {Object} RhythmRow
 * @property {Set<number>} bars Takte (Index)
 * @property {Pattern} pattern Strumming Pattern (strokes: ein Zeichen je Rasterplatz)
 * @property {boolean} derived false: In der Quellspur hat keiner dieser Takte Anschläge
 * @property {boolean} simplified In einigen Takten lagen Anschläge neben dem Sechzehntelraster (32tel, Triolen); sie
 *   sind weggelassen (simplifiedBar())
 * @property {boolean} [keep] behalten (spreadToKept())
 */

/**
 * Akkordwechsel ohne Anschlag.
 * @typedef {{bar: number, count: string, name: string}} RhythmWarning
 */

/**
 * Schlüssel eines Rhythmus: gleich heißt gleiche Taktart, gleiches Raster und gleiche Zeichen.
 * @param {Pattern} pattern Pattern
 * @returns {string}
 */
function rhythmKey(pattern){
  return `${pattern.timeSignature}|${pattern.grid}|${pattern.strokes}`;
}

/** Ticks einer Sechzehntel, das feinste Raster der Rhythmen. */
const SIXTEENTH_TICKS = WHOLE_TICKS / 16;

/**
 * Rhythmus eines Takts, wenn deriveBar() keinen findet, weil Anschläge neben dem Sechzehntelraster liegen (32tel,
 * Triolen, Verzierungen): Nur die Anschläge auf Sechzehnteln zählen, die anderen fallen ungefragt weg. Richtung wie in
 * deriveBar(): aus dem Anschlagzeichen (sd/su, kein Brush), sonst gerade Plätze ab, ungerade auf; nur gedämpfte Töne
 * ergeben x.
 * @param {import('../../types/alphatab').model.Bar} bar Takt
 * @param {string} timeSignature Taktart
 * @returns {?{grid: number, tokens: string[]}} null ohne Anschlag auf dem Raster
 */
function simplifiedBar(bar, timeSignature){
  const voice = bar.voices[0];
  if(!voice) return null;
  const hits = timeline(voice).filter(e => e.end > e.start && e.beat.notes.length && !e.beat.isRest
    && !e.beat.notes.every(n => n.isTieDestination) && e.start % SIXTEENTH_TICKS === 0);
  const grid = [8, 16].find(g => slotCount(timeSignature, g) && hits.every(e => e.start % (WHOLE_TICKS / g) === 0));
  if(!hits.length || !grid) return null;
  const tokens = Array(slotCount(timeSignature, grid)).fill('.');
  for(const {beat, start} of hits){
    const slot = start / (WHOLE_TICKS / grid);
    if(slot >= tokens.length) continue;
    // Anschlagrichtung in alphaTab: PickStroke Up = 1, Down = 2; ein Brush zählt nicht (wie in deriveBar()).
    const sign = beat.notes.every(n => n.isDead) ? 'x' : beat.pickStroke === 2 ? 'd' : beat.pickStroke === 1 ? 'u'
      : slot % 2 ? 'u' : 'd';
    tokens[slot] = beat.notes.some(n => n.accentuated) ? sign.toUpperCase() : sign;
  }
  return {grid, tokens};
}

/**
 * Leitet je Takt der Quellspur den Rhythmus ab und fasst gleiche zusammen, häufigste zuerst. Anschläge neben dem
 * Sechzehntelraster fallen weg (simplifiedBar(), der Rhythmus heißt dann "vereinfacht"); Takte ohne Anschlag bilden je
 * Taktart einen eigenen Rhythmus ohne Anschläge.
 * @param {Score} score Noten (frisch eingelesen)
 * @param {number} index Quellspur
 * @returns {RhythmRow[]}
 */
export function analyzeRhythm(score, index){
  const staff = score.tracks[index].staves[0];
  /** @type {Map<string, RhythmRow>} */
  const rows = new Map();
  for(const mb of score.masterBars){
    const timeSignature = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
    const exact = deriveBar(staff.bars[mb.index], 'strumming');
    const found = exact ?? simplifiedBar(staff.bars[mb.index], timeSignature);
    const simplified = !exact && !!found;
    const grid = found?.grid ?? [8, 16].find(g => slotCount(timeSignature, g));
    if(!grid) continue;
    /** @type {Pattern} */
    const pattern = {id: '', name: '', technique: 'strumming', timeSignature, grid,
      strokes: found ? found.tokens.join('') : '.'.repeat(slotCount(timeSignature, grid))};
    const key = `${rhythmKey(pattern)}|${!!found}|${simplified}`;
    const row = rows.get(key) ?? {bars: new Set(), pattern, derived: !!found, simplified};
    row.bars.add(mb.index);
    rows.set(key, row);
  }
  return sortRows([...rows.values()]);
}

/**
 * Häufigste Rhythmen zuerst, bei gleicher Zahl der frühere.
 * @param {RhythmRow[]} rows Rhythmen
 * @returns {RhythmRow[]}
 */
function sortRows(rows){
  return rows.sort((a, b) => b.bars.size - a.bars.size || Math.min(...a.bars) - Math.min(...b.bars));
}

/**
 * Fasst Rhythmen mit gleichem Pattern zusammen (beim Übernehmen eines anderen Rhythmus).
 * @param {RhythmRow[]} rows Rhythmen
 * @returns {RhythmRow[]}
 */
function mergeRows(rows){
  /** @type {Map<string, RhythmRow>} */
  const merged = new Map();
  for(const row of rows){
    const key = rhythmKey(row.pattern);
    const known = merged.get(key);
    if(known){
      for(const bar of row.bars) known.bars.add(bar);
      known.derived ||= row.derived;
      known.simplified ||= row.simplified;
      known.keep ||= row.keep;
    } else {
      merged.set(key, {bars: new Set(row.bars), pattern: {...row.pattern}, derived: row.derived,
        simplified: row.simplified, keep: row.keep});
    }
  }
  return sortRows([...merged.values()]);
}

/**
 * Fasst ähnliche Rhythmen zusammen: Jeder übernimmt den ersten häufigeren mit gleicher Taktart, dem er mindestens
 * SIMILAR ähnlich ist (similarity()) und dessen Rhythmus in seinen Takten keinen Akkordwechsel ohne Anschlag ergibt
 * (fits); sonst bleibt er für sich.
 * @param {RhythmRow[]} rows Rhythmen, häufigste zuerst
 * @param {function(Pattern, Set<number>): boolean} [fits] ob ein Rhythmus in diesen Takten passt
 * @returns {RhythmRow[]}
 */
export function mergeSimilar(rows, fits = () => true){
  /** @type {RhythmRow[]} */
  const kept = [];
  for(const row of rows){
    const target = kept.find(k => similarity(k.pattern, row.pattern) >= SIMILAR && fits(k.pattern, row.bars));
    if(target){
      for(const bar of row.bars) target.bars.add(bar);
      target.simplified ||= row.simplified;
      target.keep ||= row.keep;
    } else {
      kept.push({bars: new Set(row.bars), pattern: {...row.pattern}, derived: row.derived, simplified: row.simplified,
        keep: row.keep});
    }
  }
  return sortRows(kept);
}

/**
 * Verteilt die Takte der übrigen Rhythmen auf die behaltenen: jeder an den ähnlichsten mit gleicher Taktart, der dort
 * passt (fits), sonst bleibt er. Ebenso Takte eines behaltenen, in denen er selbst nicht passt. Takte ohne Anschläge
 * bleiben.
 * @param {RhythmRow[]} rows Rhythmen, häufigste zuerst
 * @param {function(Pattern, Set<number>): boolean} fits ob ein Rhythmus in diesen Takten passt
 * @returns {RhythmRow[]}
 */
export function spreadToKept(rows, fits){
  const copy = row => ({...row, bars: new Set(row.bars), pattern: {...row.pattern}});
  const kept = rows.filter(r => r.keep).map(copy);
  /**
   * Bester behaltener Rhythmus für einen Takt.
   * @param {number} bar Takt
   * @param {Pattern} pattern Rhythmus, den der Takt bisher hat (zum Vergleich)
   * @param {?RhythmRow} [except] dieser nicht (der eigene)
   * @returns {?RhythmRow} null, wenn keiner passt
   */
  const bestFor = (bar, pattern, except = null) => {
    const one = new Set([bar]);
    let best = null;
    let bestValue = -1;
    for(const k of kept){
      if(k === except || k.pattern.timeSignature !== pattern.timeSignature || !fits(k.pattern, one)) continue;
      const value = similarity(k.pattern, pattern);
      if(value > bestValue){
        best = k;
        bestValue = value;
      }
    }
    return best;
  };
  /** @type {RhythmRow[]} */
  const rest = [];
  for(const row of kept){
    for(const bar of [...row.bars]){
      if(fits(row.pattern, new Set([bar]))) continue;
      const best = bestFor(bar, row.pattern, row);
      if(!best) continue;
      row.bars.delete(bar);
      best.bars.add(bar);
    }
  }
  for(const row of rows.filter(r => !r.keep)){
    if(!row.derived){
      rest.push(copy(row));
      continue;
    }
    const left = new Set();
    for(const bar of row.bars){
      const best = bestFor(bar, row.pattern);
      if(best){
        best.bars.add(bar);
        best.simplified ||= row.simplified;
      } else {
        left.add(bar);
      }
    }
    if(left.size) rest.push({...copy(row), bars: left});
  }
  return sortRows([...kept.filter(r => r.bars.size), ...rest]);
}

/**
 * Ob zwei Mengen von Takten gleich sind.
 * @param {Set<number>} a Takte
 * @param {Set<number>} b Takte
 * @returns {boolean}
 */
function sameBars(a, b){
  return a.size === b.size && [...a].every(i => b.has(i));
}

/**
 * Beschreibt, wo ein Rhythmus vorkommt: die erste Beschreibung, die genau diese Takte trifft, in dieser Reihenfolge:
 * ganzer Song, Abschnittsgruppen ("Verse 1" und "Verse 2" sind "Verse"), Taktart, Akkord am Taktanfang, erster bzw.
 * letzter Takt der Abschnitte einer Gruppe; sonst die Gruppen, in denen er vorkommt, mit Anteil, wo er nur in einem
 * Teil der Takte gilt ("Verse (12/48 Takte), Chorus").
 * @param {Score} score Noten
 * @param {Set<number>} bars Takte (Index)
 * @param {{tick: number, name: string}[]} events Akkordwechsel (chordTimeline())
 * @returns {string}
 */
export function describeBars(score, bars, events){
  const all = score.masterBars;
  if(bars.size === all.length) return 'ganzer Song';
  const parts = sections(score).map(s => ({...s, label: (s.name || 'Anfang').replace(/[\s.#-]*\d+\s*$/, '').trim(),
    group: sectionGroup(s.name || 'Anfang')}));
  const range = s => Array.from({length: s.to - s.from + 1}, (_, k) => s.from + k);
  // Abschnittsgruppen: alle Gruppen, in denen die Takte liegen, müssen ganz dazugehören.
  const groups = [...new Set(parts.filter(s => range(s).some(i => bars.has(i))).map(s => s.group))];
  const inGroups = new Set(parts.filter(s => groups.includes(s.group)).flatMap(range));
  if(sameBars(bars, inGroups)){
    return groups.map(g => parts.find(s => s.group === g).label).join(', ');
  }
  // Taktart
  const signature = i => `${all[i].timeSignatureNumerator}/${all[i].timeSignatureDenominator}`;
  const signatures = new Set([...bars].map(signature));
  if(signatures.size === 1){
    const ts = [...signatures][0];
    if(sameBars(bars, new Set(all.filter(mb => signature(mb.index) === ts).map(mb => mb.index)))) return `Takte in ${ts}`;
  }
  // Akkord, der am Taktanfang klingt
  const chordAt = i => events.findLast(e => e.tick <= all[i].start)?.name ?? '';
  const chords = new Set([...bars].map(chordAt));
  if(chords.size === 1 && [...chords][0]){
    const name = [...chords][0];
    if(sameBars(bars, new Set(all.filter(mb => chordAt(mb.index) === name).map(mb => mb.index)))){
      return `Takte mit ${name}`;
    }
  }
  // Erster bzw. letzter Takt der Abschnitte einer Gruppe
  for(const [edge, label] of [['to', 'letzter'], ['from', 'erster']]){
    const groupsAt = new Set(parts.filter(s => bars.has(s[edge])).map(s => s.group));
    if(groupsAt.size !== 1) continue;
    const g = [...groupsAt][0];
    const edges = new Set(parts.filter(s => s.group === g).map(s => s[edge]));
    if(sameBars(bars, edges)){
      return `${label} Takt ${edges.size > 1 ? 'jedes Abschnitts' : 'im Abschnitt'} ${parts.find(s => s.group === g).label}`;
    }
  }
  return groups.map(g => {
    const inGroup = parts.filter(s => s.group === g).flatMap(range);
    const hit = inGroup.filter(i => bars.has(i)).length;
    const label = parts.find(s => s.group === g).label;
    return hit === inGroup.length ? label : `${label} (${hit} von ${inGroup.length} Takten)`;
  }).join(', ');
}

/**
 * Hängt "vereinfacht" an die Beschreibung eines Rhythmus: bei einer Gruppe vor die Klammer ("Solo, vereinfacht (2 von
 * 16 Takten)"), sonst ans Ende.
 * @param {string} text Beschreibung (describeBars())
 * @param {boolean} simplified ob Anschläge weggelassen wurden
 * @returns {string}
 */
function withSimplified(text, simplified){
  if(!simplified) return text;
  const one = /^([^,(]+) (\(\d+ von \d+ Takten\))$/.exec(text);
  return one ? `${one[1]}, vereinfacht ${one[2]}` : `${text}, vereinfacht`;
}

/**
 * Zählzeit einer Stelle im Takt, z. B. "1", "2+", "3e" (Viertel-Taktarten) bzw. "4" (Achtel-Taktarten).
 * @param {number} offset Ticks ab Taktanfang
 * @param {number} denominator Nenner der Taktart
 * @returns {string}
 */
function countAt(offset, denominator){
  const beat = WHOLE_TICKS / denominator;
  const n = Math.floor(offset / beat) + 1;
  const rest = offset % beat;
  return rest === 0 ? `${n}` : rest === beat / 2 ? `${n}+` : rest === beat / 4 ? `${n}e` : rest === beat * 3 / 4 ? `${n}a`
    : `${n} (krumm)`;
}

/**
 * Stellen (Tick ab Songanfang), an denen eine Spur anschlägt (Schläge mit Noten, die nicht nur übergebunden sind).
 * @param {import('../../types/alphatab').model.Track} track Spur
 * @returns {Set<number>}
 */
export function attackTicks(track){
  return new Set(track.staves[0].bars.flatMap(bar => (bar.voices[0] ? timeline(bar.voices[0]) : [])
    .filter(e => e.beat.notes.length && !e.beat.notes.every(n => n.isTieDestination))
    .map(e => bar.masterBar.start + e.start)));
}

/**
 * Akkordwechsel in den Takten eines Rhythmus an Stellen ohne Anschlag (auch zwischen den Rasterplätzen). Gezählt
 * werden nur Wechsel, an denen die Quellspur anschlägt: Klingt dort in der Quellspur nur ein Ton weiter (Haltebogen)
 * oder ist Pause, wird der neue Akkord auch im Original erst später angeschlagen, und es fällt kein Anschlag weg.
 * @param {Score} score Noten
 * @param {RhythmRow} row Rhythmus
 * @param {{tick: number, name: string}[]} events Akkordwechsel (chordTimeline())
 * @param {Set<number>} attacks Stellen, an denen die Quellspur anschlägt (attackTicks())
 * @returns {RhythmWarning[]}
 */
export function rhythmWarnings(score, row, events, attacks){
  const {grid, strokes} = row.pattern;
  const slotTicks = WHOLE_TICKS / grid;
  /** @type {RhythmWarning[]} */
  const warnings = [];
  for(const i of [...row.bars].sort((a, b) => a - b)){
    const mb = score.masterBars[i];
    const end = mb.start + mb.calculateDuration();
    for(const e of events){
      if(e.tick < mb.start || e.tick >= end || !attacks.has(e.tick)) continue;
      const offset = e.tick - mb.start;
      const slot = offset / slotTicks;
      if(Number.isInteger(slot) && strokes[slot] && strokes[slot] !== '.') continue;
      warnings.push({bar: i, count: countAt(offset, mb.timeSignatureDenominator), name: e.name});
    }
  }
  return warnings;
}

/**
 * Schreibt die Rhythmen in eine Spur: Kopie der Quellspur (Capo, Tuning) ohne Inhalt, je Takt sein Rhythmus mit den
 * Griffen der klingenden Akkorde (fillBar()), Takte ohne Rhythmus als Pausen; danach ziehen die Akkorde in diese Spur.
 * Ohne Ziel kommt sie als neue Spur "Rhythmus" an die erste Stelle, mit Ziel ersetzt sie die Zielspur (Stelle, Name,
 * Instrument und Liedtext bleiben).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {string} tex alphaTex der Noten (Stand vor der Änderung)
 * @param {Score} score dieselben Noten als Modell, werden geändert
 * @param {number} index Quellspur
 * @param {RhythmRow[]} rows Rhythmen
 * @param {Object<string, string[]>} library Akkordkatalog (Griffe, wo die Noten keinen haben)
 * @param {?number} [target] Spur, die überschrieben wird (auch die Quellspur selbst); null für eine neue
 * @returns {{track: import('../../types/alphatab').model.Track, gripless: string[]}} Spur mit dem Rhythmus und Akkorde
 *   ohne Griff (dort Pausen)
 */
export function applyRhythm(alphaTab, tex, score, index, rows, library, target = null){
  const events = chordTimeline(score);
  /** @type {Map<number, Pattern>} */
  const perBar = new Map(rows.flatMap(row => [...row.bars].map(i => [i, row.pattern])));
  const gripless = new Set();
  /**
   * Legt eine Kopie der Quellspur an der Stelle at an und schreibt die Rhythmen hinein.
   * @param {number} at Index der neuen Spur
   * @param {string} name gewünschter Name
   * @param {import('./notation.js').Instrument} instrument Instrument
   * @returns {import('../../types/alphatab').model.Track}
   */
  const rhythmTrack = (at, name, instrument) => {
    // duplicateTrack() liest die Quellspur aus dem alphaTex vor der Änderung, dort hat sie noch ihren Index.
    const track = duplicateTrack(t => parseScore(alphaTab, t), tex, score, index, at);
    track.name = track.shortName = freeTrackName(score, name, track);
    setInstrument(alphaTab, track, instrument);
    /** @type {?import('../../types/alphatab').model.Beat} letzter Schlag des vorigen Takts (klingt in den nächsten) */
    let ringing = null;
    for(const bar of track.staves[0].bars){
      const pattern = perBar.get(bar.index);
      if(!pattern){
        for(const voice of bar.voices) for(const beat of voice.beats) makeRest(beat);
        ringing = null;
        continue;
      }
      const start = score.masterBars[bar.index].start;
      fillBar(alphaTab, bar, pattern, tick => {
        const event = events.findLast(e => e.tick <= start + tick);
        if(!event) return null;
        const grip = gripFor(event, library);
        if(!grip) gripless.add(event.name);
        return grip;
      }, ringing);
      ringing = bar.voices[0].beats.at(-1) ?? null;
    }
    return track;
  };
  // Ein- und Ausblenden der Quellspur (z. B. am Schlussakkord): Takt, Stelle im Takt und Art.
  const fades = score.tracks[index].staves[0].bars.flatMap(bar => (bar.voices[0] ? timeline(bar.voices[0]) : [])
    .filter(e => e.beat.fade).map(e => ({bar: bar.index, at: e.start, fade: e.beat.fade})));
  const old = target === null ? null : score.tracks[target];
  // Die neue Spur kommt vor die alte (an ihre Stelle), die alte fällt am Ende weg.
  const track = old ? rhythmTrack(target, old.name, instrumentOf(old))
    : rhythmTrack(0, 'Rhythmus', instrumentByKey('guitar'));
  // Übernommen an den Anschlag der neuen Spur, der dort klingt (auch aus einem Takt davor, wenn der Ton der Quellspur
  // übergebunden ist und die neue Spur dort pausiert).
  const struck = track.staves[0].bars.flatMap(bar => (bar.voices[0] ? timeline(bar.voices[0]) : [])
    .filter(e => e.beat.notes.some(n => !n.isTieDestination)).map(e => ({bar: bar.index, at: e.start, beat: e.beat})));
  for(const {bar, at, fade} of fades){
    const target = struck.findLast(e => e.bar < bar || (e.bar === bar && e.at <= at));
    if(target) target.beat.fade = fade;
  }
  moveContent(alphaTab, score, 'chords', track.index, 'insert');
  if(old){
    if(lyricsTrack(score) === old) moveContent(alphaTab, score, 'lyrics', track.index, 'insert');
    deleteTrack(score, old.index);
    track.name = track.shortName = old.name;
  }
  return {track, gripless: [...gripless]};
}

/**
 * Dialog "Rhythmus ableiten" für eine Spur.
 */
export class RhythmDialog {
  /**
   * @param {import('./editor.js').NoteEditor} editor Editor
   * @param {number} index Quellspur
   */
  constructor(editor, index){
    /** Editor. */
    this.editor = editor;
    /** Quellspur. */
    this.index = index;
    /** Frisch eingelesene Noten (Abspielzeiten stimmen). @type {Score} */
    this.score = parseScore(editor.alphaTab, editor.tex);
    /** Akkordwechsel. @type {{tick: number, name: string}[]} */
    this.events = chordTimeline(this.score);
    /** Stellen, an denen die Quellspur anschlägt (für die Warnungen). @type {Set<number>} */
    this.attacks = attackTicks(this.score.tracks[index]);
    /**
     * Ob ein Rhythmus in Takten passt: kein Akkordwechsel ohne Anschlag (für "Ähnliche zusammenfassen").
     * @type {function(Pattern, Set<number>): boolean}
     */
    this.fits = (pattern, bars) => !rhythmWarnings(this.score, {bars, pattern, derived: true, simplified: false},
      this.events, this.attacks).length;
    /** Rhythmen. @type {RhythmRow[]} */
    this.rows = analyzeRhythm(this.score, index);
    /** Dialog. @type {?HTMLElement} */
    this.box = null;
    /** Ob die Rhythmen nicht mehr die abgeleiteten sind (dann ist der Knopf zum Zurücksetzen aktiv). */
    this.changed = false;
  }

  /**
   * Öffnet den Dialog über dem Dialog "Spuren" (Schließen zeigt ihn wieder).
   * @returns {void}
   */
  open(){
    const html = `<h2>Rhythmus ableiten aus „${escapeHtml(trackName(this.score.tracks[this.index]))}“</h2>
      <div class="rh-tools">
        <button type="button" class="ebtn ebtn-text" id="rhMerge">Ähnliche zusammenfassen</button>
        <button type="button" class="ebtn ebtn-text" id="rhSpread">Auf behaltene verteilen</button>
        <button type="button" class="ebtn" id="rhReset" disabled title="Rhythmen anzeigen, wie sie in der Spur stehen"
          aria-label="Rhythmen anzeigen, wie sie in der Spur stehen">${svgIcon('reload')}</button>
        <span class="efield-hint rh-count" id="rhCount"></span>
        <p class="rh-hint">Zusammengefasst werden Rhythmen, wenn mindestens ${Math.round(SIMILAR * 100)} % der Schläge
          gleich sind (in Sechzehnteln gerastert) und kein Akkordwechsel seinen Anschlag verliert. Der häufigste Rhythmus
          gewinnt.</p>
      </div>
      <div class="rh" id="rhBox"></div>
      <div class="rh-target" role="radiogroup" aria-label="Wohin der Rhythmus kommt">
        <label><input type="radio" name="rhTarget" value="new" checked> Spur neu anlegen</label>
        <label><input type="radio" name="rhTarget" value="overwrite"> Spur überschreiben</label>
      </div>
      <div class="struct-actions">
        <button class="btn btn-primary" type="button" id="rhApply">Übernehmen</button>
        <button class="btn" type="button" id="rhCancel">Abbrechen</button>
      </div>`;
    if(isOverlayOpen()) openStackedOverlay(html);
    else openOverlay(html);
    this.box = document.getElementById('rhBox');
    this.box.addEventListener('click', e => this.click(/** @type {HTMLElement} */ (e.target)));
    this.box.addEventListener('change', e => this.typed(/** @type {HTMLInputElement} */ (e.target)));
    document.getElementById('rhCancel').addEventListener('click', closeOverlay);
    document.getElementById('rhMerge').addEventListener('click', () => {
      this.rows = mergeSimilar(this.rows, this.fits);
      this.changed = true;
      this.render();
    });
    document.getElementById('rhSpread').addEventListener('click', () => {
      this.rows = spreadToKept(this.rows, this.fits);
      this.changed = true;
      this.render();
    });
    document.getElementById('rhReset').addEventListener('click', () => {
      this.rows = analyzeRhythm(this.score, this.index);
      this.changed = false;
      this.render();
    });
    document.getElementById('rhApply').addEventListener('click', () => void this.apply());
    this.render();
  }

  /**
   * Zeichnet alle Rhythmen mit Ort, Raster, Feld, Knöpfen zum Übernehmen und Warnungen.
   * @returns {void}
   */
  render(){
    let blocked = false;
    this.box.innerHTML = this.rows.map((row, k) => {
      const warnings = rhythmWarnings(this.score, row, this.events, this.attacks);
      blocked ||= warnings.length > 0;
      // Angeboten werden nur Rhythmen, mit denen hier kein Anschlag eines Akkordwechsels wegfällt.
      const similar = this.rows.filter(o => o !== row && o.bars.size >= row.bars.size
        && similarity(o.pattern, row.pattern) >= SIMILAR && this.fits(o.pattern, row.bars)).slice(0, TAKE_MAX);
      const n = row.bars.size;
      const canHalve = row.pattern.grid === 16 && [...row.pattern.strokes].every((t, i) => i % 2 === 0 || t === '.');
      return `<div class="rh-row${warnings.length ? ' rh-bad' : ''}">
        <div class="rh-head"><span class="rh-title">Rhythmus ${k + 1}:</span>
          <label class="rh-keep" title="Beim Verteilen behalten"><input type="checkbox"
            data-rh-keep="${k}"${row.keep ? ' checked' : ''}> behalten</label>
          <span class="efield-hint rh-bars">${n} ${n === 1 ? 'Takt' : 'Takte'}${
            row.derived ? '' : ', in der Spur ohne Anschläge'}</span></div>
        <p class="rh-hint rh-where">${
          escapeHtml(withSimplified(describeBars(this.score, row.bars, this.events), row.simplified))}</p>
        <div class="rh-edit">
          ${patternGridHtml(row.pattern, true)}
          <input type="text" data-rh-strokes="${k}" value="${escapeHtml(row.pattern.strokes)}" spellcheck="false"
            aria-label="Rhythmus: d ab, u auf, x gedämpft, . nichts; groß = betont">
          <button type="button" class="ebtn ebtn-text" data-rh-grid="${k}" title="${row.pattern.grid === 8 || canHalve
            ? 'Raster wechseln' : 'Anschläge zwischen den Achteln fallen weg'}">${row.pattern.grid === 8 ? 'in Sechzehnteln'
            : canHalve ? 'in Achteln' : 'auf Achtel vereinfachen'}</button>
        </div>
        ${similar.length ? `<div class="rh-take">${similar.map(o => `<button type="button" class="ebtn ebtn-text"
          data-rh-take="${k}" data-rh-from="${this.rows.indexOf(o)}">Rhythmus ${this.rows.indexOf(o) + 1} übernehmen</button>`)
          .join('')}</div>` : ''}
        ${warnings.length ? `<p class="rh-warn">${warnings.slice(0, 6).map(w =>
          `Takt ${w.bar + 1}, Zählzeit ${escapeHtml(w.count)}: ${escapeHtml(w.name)} ohne Anschlag`).join('; ')}${
          warnings.length > 6 ? ` und ${warnings.length - 6} weitere` : ''}.</p>` : ''}
      </div>`;
    }).join('');
    for(const [k, table] of [...this.box.querySelectorAll('table.pgrid')].entries()) table.dataset.rhRow = String(k);
    const n = this.rows.length;
    document.getElementById('rhCount').textContent = `${n} ${n === 1 ? 'Rhythmus' : 'Rhythmen'}`;
    /** @type {HTMLButtonElement} */ (document.getElementById('rhMerge')).disabled =
      mergeSimilar(this.rows, this.fits).length === n;
    /** @type {HTMLButtonElement} */ (document.getElementById('rhSpread')).disabled =
      !this.rows.some(r => r.keep) || !this.rows.some(r => !r.keep && r.derived);
    /** @type {HTMLButtonElement} */ (document.getElementById('rhReset')).disabled = !this.changed;
    const apply = /** @type {HTMLButtonElement} */ (document.getElementById('rhApply'));
    apply.disabled = blocked || !this.rows.length;
    apply.title = blocked ? 'Erst die roten Warnungen lösen: Jeder Akkordwechsel braucht einen Anschlag.' : '';
    this.alignTools();
  }

  /**
   * Rückt Zahl und Hinweis oben so ein, dass sie rechts mit dem Text der Rhythmen darunter abschließen (die Liste hat
   * Rahmen, Innenabstand und je nach Höhe eine Scrollleiste).
   * @returns {void}
   */
  alignTools(){
    const tools = /** @type {?HTMLElement} */ (document.querySelector('.rh-tools'));
    const bars = this.box.querySelector('.rh-bars');
    if(!tools || !bars) return;
    tools.style.paddingRight = '0px';
    const gap = tools.getBoundingClientRect().right - bars.getBoundingClientRect().right;
    tools.style.paddingRight = `${Math.max(0, gap)}px`;
  }

  /**
   * Klick ins Raster (Zeichen wechseln, Betonung), auf das Raster oder auf "Rhythmus aus … übernehmen". Beim Bearbeiten
   * wird nicht zusammengefasst.
   * @param {HTMLElement} target angeklicktes Element
   * @returns {void}
   */
  click(target){
    const take = /** @type {?HTMLElement} */ (target.closest('[data-rh-take]'));
    if(take){
      const row = this.rows[Number(take.dataset.rhTake)];
      row.pattern = {...this.rows[Number(take.dataset.rhFrom)].pattern};
      this.rows = mergeRows(this.rows);
      this.changed = true;
      this.render();
      return;
    }
    const gridButton = /** @type {?HTMLElement} */ (target.closest('[data-rh-grid]'));
    if(gridButton){
      const pattern = this.rows[Number(gridButton.dataset.rhGrid)].pattern;
      const tokens = [...pattern.strokes];
      // Auf Achtel: Anschläge dazwischen fallen weg, ab und auf richten sich nach dem neuen Platz (gerade ab, ungerade
      // auf), gedämpft und Betonung bleiben.
      const strum = (t, k) => t === '.' || t.toLowerCase() === 'x' ? t
        : (t === t.toUpperCase() ? (k % 2 ? 'U' : 'D') : (k % 2 ? 'u' : 'd'));
      pattern.strokes = pattern.grid === 8 ? tokens.map(t => `${t}.`).join('')
        : tokens.filter((_, i) => i % 2 === 0).map(strum).join('');
      pattern.grid = pattern.grid === 8 ? 16 : 8;
      this.changed = true;
      this.render();
      return;
    }
    const cell = /** @type {?HTMLElement} */ (target.closest('[data-cell]'));
    const table = /** @type {?HTMLElement} */ (target.closest('table[data-rh-row]'));
    if(!cell || !table) return;
    const pattern = this.rows[Number(table.dataset.rhRow)].pattern;
    pattern.strokes = editPattern(pattern, cell.dataset.cell, Number(cell.dataset.slot));
    this.changed = true;
    this.render();
  }

  /**
   * Geändertes Feld übernehmen: "behalten" oder der getippte Rhythmus (nur d, u, x, groß = betont, und Punkt, so viele
   * wie Rasterplätze; sonst bleibt der vorige).
   * @param {HTMLInputElement} input Feld
   * @returns {void}
   */
  typed(input){
    if(input.dataset.rhKeep !== undefined){
      this.rows[Number(input.dataset.rhKeep)].keep = input.checked;
      this.render();
      return;
    }
    if(input.dataset.rhStrokes === undefined) return;
    const pattern = this.rows[Number(input.dataset.rhStrokes)].pattern;
    const value = input.value.replace(/\s+/g, '');
    const slots = slotCount(pattern.timeSignature, pattern.grid);
    if(value.length !== slots || /[^duxDUX.]/.test(value)){
      this.editor.toast(`${slots} Zeichen nötig: d ab, u auf, x gedämpft, . nichts (groß = betont).`);
    } else {
      pattern.strokes = value;
      this.changed = true;
    }
    this.render();
  }

  /**
   * Legt die Spur an bzw. überschreibt die Quellspur (ein Schritt für "Rückgängig") und schließt den Dialog.
   * @returns {Promise<void>}
   */
  async apply(){
    const ed = this.editor;
    const overwrite = /** @type {?HTMLInputElement} */ (document.querySelector('input[name="rhTarget"]:checked'))
      ?.value === 'overwrite';
    const target = overwrite ? this.index : null;
    const library = await loadChordLibraryOrEmpty();
    /** @type {?{track: import('../../types/alphatab').model.Track, gripless: string[]}} */
    let result = null;
    closeOverlay();
    ed.changeTracks(score => {
      result = applyRhythm(ed.alphaTab, ed.tex, score, this.index, this.rows, library, target);
    }, target ?? 0, 0);
    if(!result) return;
    const name = trackName(ed.score.tracks[target ?? 0]);
    ed.toast((target === null ? `Spur „${name}“ als erste Spur angelegt` : `Spur „${name}“ überschrieben`)
      + ', sie trägt jetzt die Akkorde.'
      + (result.gripless.length ? ` Ohne Griff (Pausen): ${result.gripless.join(', ')}.` : ''));
  }
}
