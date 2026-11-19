/**
 * Die Ansicht "Text & Akkorde" und ihr ChordPro-Export.
 */

import {chordDiagramSvg, chordKey, diagramFirstFret, escapeHtml, gripOf, loadChordLibraryOrEmpty, parseGrip} from './base.js';
import {
  chordsTrack, endsLyricsLine, loadAlphaTab, lyricsTrack, mergeChords, parseScore, playOrder, readScoreInfo,
} from './notation.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.MasterBar} MasterBar */
/** @typedef {import('./base.js').ChordLibrary} ChordLibrary */

// --------------------------------------------------------------------------------------------------------------------
// Text und Akkorde
// --------------------------------------------------------------------------------------------------------------------

/**
 * Ansicht "Text & Akkorde": der Songtext in Zeilen, die Akkorde genau über ihrer Silbe, gegliedert nach Abschnitten,
 * darüber die Griffbilder. Alles wird aus den Noten erzeugt: der Text aus der Gesangsspur (lyricsTrack() in
 * notation.js), die Akkorde aus allen Spuren zusammengetragen, bei verschiedenen Akkorden an einer Stelle aus der
 * ersten Begleitspur (mergeChords() in notation.js, dieselbe Regel wie über den Noten), in Abspielreihenfolge mit
 * Wiederholungen.
 *
 * Jeder Takt des Songs kommt vor, wie in den handgebauten Leadsheets: In Abschnitten mit Text steht über der ersten
 * Silbe eines Takts ein Taktstrich "|" (mit Akkord, wenn dort einer angeschlagen wird), Takte ohne Silbe hängen als
 * "|Am |Asus2" an der Zeile. Abschnitte ganz ohne Text (Intro, Solo) stehen als Taktzeile "| G | % | C |" da.
 * Zeilenumbrüche stehen als "\n" am Ende der letzten Silbe einer Zeile in den Noten (LYRICS_BREAK in notation.js,
 * gesetzt im Reiter "Liedtext"); hat eine Strophe keine, ergeben sie sich aus Satzzeichen, Pausen und Abschnitten.
 * buildTextModel() kommt ohne DOM aus.
 */

/**
 * Silbe mit absoluter Zeit in Abspielreihenfolge. br: Die Silbe beendet eine Zeile (gespeicherter Zeilenumbruch);
 * fehlt, wenn ihre Strophe keine gespeicherten Umbrüche hat (dann bricht splitPhrases() selbst um).
 * @typedef {{t: number, end: number, text: string, br?: boolean}} Syllable
 */

/**
 * Abschnitt (Marker an einem Takt) mit absoluter Zeit.
 * @typedef {{t: number, name: string}} SectionMark
 */

/**
 * Teil einer Textzeile: eine Silbe mit den Akkorden, die auf ihr (oder kurz davor) angeschlagen werden, oder ein Takt
 * ohne eigene Silbe (text leer).
 * @typedef {{t: number, text: string, bar: boolean, chords: string[]}} LinePart t Zeit in Ticks (Abspielreihenfolge),
 *   bar: Hier beginnt ein Takt
 */

/**
 * Takt einer Taktzeile mit seinen Akkorden (leer: kein neuer Akkord, angezeigt als leerer Taktstrich), at: Zeitpunkt
 * jedes Akkords in Ticks ab Taktanfang, beats: Schläge des Takts (Zähler der Taktart), length: Länge in Ticks.
 * @typedef {{t: number, chords: string[], at: number[], beats: number, length: number}} BarCell
 */

/**
 * Zeile der Ansicht: Text mit Akkorden und Taktstrichen (parts) oder eine Taktzeile in einem Abschnitt ohne Text
 * (bars); closed: Die Zeile endet mit dem Ende eines Takts (die nächste beginnt mit einem neuen Takt). hint: Die
 * Zeile ist ein Hinweis an Stelle ausgelassener Takte (nur auf dem Leadsheet, applyCuts() in sheet.js).
 * @typedef {{t: number, parts?: LinePart[], bars?: BarCell[], closed?: boolean, hint?: string}} TextLine
 */

/**
 * Ein Abschnitt der Ansicht; start/end: Zeitbereich in Ticks (Abspielreihenfolge, Ende ausschließlich), mit einem Auftakt davor.
 * @typedef {{name: string, lines: TextLine[], start: number, end: number}} TextSection
 */

/**
 * Inhalt der Ansicht.
 * @typedef {Object} TextModel
 * @property {TextSection[]} sections Abschnitte in
 *   Abspielreihenfolge (name leer vor dem ersten Marker); start/end: Zeitbereich in Ticks (Abspielreihenfolge, Ende
 *   ausschließlich), mit einem Auftakt davor
 * @property {{name: string, grip: string}[]} chords Griffbilder der Akkorde in der Reihenfolge des ersten Anschlags
 * @property {{t: number, name: string}[]} chordTimes alle Akkordwechsel in Abspielreihenfolge (t in Ticks wie das MIDI),
 *   z. B. für die Anzeige des aktuellen Akkords
 * @property {string} lyricsTrack Name der Spur, aus der der Text kommt (leer ohne Text)
 * @property {string} chordsTrack Name der ersten Begleitspur, die bei verschiedenen Akkorden gewinnt (leer ohne
 *   Akkorde)
 */

/** Ticks einer halben Note: Eine Pause von zwei halben Noten beendet eine Zeile immer. */
const HALF_NOTE_TICKS = 1920;

/** Ab so vielen Zeichen beendet schon eine kürzere Pause (eine Viertel) eine Zeile. */
const LINE_SOFT_CHARS = 30;

/** Mindestzahl Silben einer Zeile, bevor sie an einem Satzzeichen endet. */
const LINE_MIN_SYLLABLES = 3;

/** Mindestzahl Silben einer Zeile, bevor sie an einem Komma endet. */
const LINE_COMMA_SYLLABLES = 6;

/** Takte je Taktzeile; längere Folgen werden umbrochen. */
const BARS_PER_LINE = 8;

/**
 * Takte in Abspielreihenfolge (playOrder() in notation.js: Wiederholungen und Volta-Klammern, Sprünge wie D.S.
 * al Coda nicht) mit ihrer Zeit: t Beginn, end Ende in Ticks, gezählt ab dem Anfang des
 * Songs in Abspielreihenfolge (wie TextLine.t und die Zeitbereiche der Abschnitte). Für "Abschnitte vergleichen"
 * (sectionBars() in sheet.js), das so vom Zeitbereich eines Abschnitts zu seinen Takten kommt.
 * @param {Score} score Noten
 * @returns {{mb: MasterBar, pass: number, t: number, end: number}[]}
 */
export function playTimeline(score){
  let time = 0;
  return playOrder(score).map(({bar, pass}) => {
    const mb = score.masterBars[bar];
    const t = time;
    time += mb.calculateDuration();
    return {mb, pass, t, end: time};
  });
}

/**
 * Strophe, deren Silbe ein Schlag im jeweiligen Durchgang singt: Strophe 2 beim zweiten Mal usw.; hat der Schlag nur
 * eine Strophe, gilt sie in jedem Durchgang.
 * @param {string[]} lyrics Silben des Schlags je Strophe
 * @param {number} pass Durchgang
 * @returns {number} Index der Strophe, -1, wenn keine Silbe
 */
export function verseFor(lyrics, pass){
  if(lyrics[pass - 1]?.trim()) return pass - 1;
  return !lyrics.slice(1).some(s => s?.trim()) && lyrics[0]?.trim() ? 0 : -1;
}

/**
 * Strophen einer Spur mit gespeicherten Zeilenumbrüchen (endsLyricsLine()).
 * @param {?import('../../types/alphatab').model.Track} track Spur mit dem Text
 * @returns {Set<number>} Indizes der Strophen
 */
function versesWithBreaks(track){
  const verses = new Set();
  for(const staff of track?.staves ?? []) for(const bar of staff.bars) for(const voice of bar.voices){
    for(const beat of voice.beats) beat.lyrics?.forEach((s, i) => { if(endsLyricsLine(s)) verses.add(i); });
  }
  return verses;
}

/**
 * Silbe für die Zeilen: ohne Leerzeichen und Umbruch drumherum, mit br, wenn ihre Strophe gespeicherte Umbrüche hat.
 * @param {number} t Beginn in Ticks
 * @param {number} end Ende in Ticks
 * @param {string} raw Silbe aus beat.lyrics
 * @param {boolean} explicit ob die Strophe gespeicherte Umbrüche hat
 * @returns {Syllable}
 */
function syllable(t, end, raw, explicit){
  return explicit ? {t, end, text: raw.trim(), br: endsLyricsLine(raw)} : {t, end, text: raw.trim()};
}

/**
 * Teilt Silben in Zeilen: nach einer Silbe mit gespeichertem Umbruch (br) und bei Abschnittswechsel; in Strophen ohne
 * gespeicherte Umbrüche auch bei längerer Pause oder Satzzeichen, dann nie mitten im Wort. Ein Auftakt (die Zeile
 * beginnt erst im Takt vor dem Abschnitt) gehört schon zum neuen Abschnitt.
 * @param {Syllable[]} syllables Silben, nach Zeit sortiert
 * @param {SectionMark[]} sections Abschnitte, nach Zeit sortiert
 * @param {function(number): {t: number, end: number}} barAt Takt, in dem ein Tick liegt
 * @returns {{syl: Syllable[], section: ?SectionMark}[]} Zeilen; section nur bei einem Auftakt gesetzt
 */
function splitPhrases(syllables, sections, barAt){
  /** @type {{syl: Syllable[], section: ?SectionMark}[]} */
  const phrases = [];
  let current = null;
  for(const s of syllables){
    const prev = current?.syl.at(-1);
    // Liegen mehrere Abschnitte dazwischen (z. B. ein Zwischenspiel ohne Text), zählt der letzte.
    const sectionBetween = prev ? sections.filter(x => x.t > prev.t && x.t <= s.t).at(-1) ?? null : null;
    const pickup = !!sectionBetween && current !== null && current.syl[0].t >= barAt(sectionBetween.t - 1).t;
    const chars = current ? current.syl.reduce((n, x) => n + x.text.length + 1, 0) : 0;
    const gap = prev ? s.t - prev.end : 0;
    const explicit = prev?.br !== undefined;
    const lineEnd = !current || (sectionBetween && !pickup) || (explicit ? prev.br : gap >= HALF_NOTE_TICKS * 2
      || (chars >= LINE_SOFT_CHARS && gap >= HALF_NOTE_TICKS / 2)
      || (/[.!?;:]$/.test(prev.text) && current.syl.length >= LINE_MIN_SYLLABLES)
      || (/,$/.test(prev.text) && current.syl.length >= LINE_COMMA_SYLLABLES));
    const midWord = !explicit && prev?.text.endsWith('-') && !(sectionBetween && !pickup);
    if(!current || (lineEnd && !midWord)){
      current = {syl: [], section: null};
      phrases.push(current);
    } else if(sectionBetween && pickup){
      // Die Zeile hat als Auftakt begonnen und geht im neuen Abschnitt weiter: Sie gehört zu ihm.
      current.section = sectionBetween;
    }
    current.syl.push(s);
  }
  return phrases;
}

/**
 * Liedtext einer Spur zum Bearbeiten (Reiter "Liedtext"): die erste Strophe in der Reihenfolge der Noten (ohne
 * Wiederholungen), Silben eines Worts mit Bindestrich ("Frank-" "furt" → "Frank-furt"). Die Zeilen sind umbrochen wie
 * in der Ansicht "Text & Akkorde" (splitPhrases()). Vor jedem Abschnitt steht sein Name in einer eigenen Zeile, z. B.
 * "[Verse]", auch vor Abschnitten ohne Text (Intro, Solo), davor eine Leerzeile. Diese Zeilen teilen den Text beim
 * Verteilen auf die Schläge in Abschnitte (setLyricsText() in notation.js).
 * @param {Score} score Noten
 * @param {import('../../types/alphatab').model.Track} track Spur mit dem Text
 * @returns {string} Text mit Zeilenumbrüchen
 */
export function lyricsLines(score, track){
  return layoutLyrics(score, track).lines.join('\n');
}

/**
 * Anfang jedes Abschnitts für den Liedtext, in der Reihenfolge der Abschnittszeilen von lyricsLines(): der Anfang
 * des Abschnitts oder, wenn er mit einem Auftakt beginnt, der Anfang des Auftakts.
 * @param {Score} score Noten
 * @param {import('../../types/alphatab').model.Track} track Spur mit dem Text
 * @returns {number[]} Zeit in Ticks (Reihenfolge der Noten, ohne Wiederholungen), je Abschnitt
 */
export function lyricsSectionStarts(score, track){
  return layoutLyrics(score, track).starts;
}

/**
 * Zeilen des Liedtexts und Anfänge der Abschnitte (siehe lyricsLines() und lyricsSectionStarts()).
 * @param {Score} score Noten
 * @param {import('../../types/alphatab').model.Track} track Spur mit dem Text
 * @returns {{lines: string[], starts: number[]}}
 */
function layoutLyrics(score, track){
  /** @type {Syllable[]} */
  const syllables = [];
  /** @type {SectionMark[]} */
  const sections = [];
  /** @type {{t: number, end: number}[]} */
  const bars = [];
  const explicit = versesWithBreaks(track).has(0);
  // Zeit wie masterBar.start (Reihenfolge der Noten), wie setLyricsText() sie für die Abschnitte nimmt.
  for(const mb of score.masterBars){
    const time = mb.start;
    bars.push({t: time, end: time + mb.calculateDuration()});
    if(mb.section){
      sections.push({t: time, name: (mb.section.text || mb.section.marker || '').replace(/^\[|]$/g, '')});
    }
    for(const beat of track.staves[0].bars[mb.index]?.voices[0]?.beats ?? []){
      const raw = beat.lyrics?.[0] ?? '';
      const t = time + beat.playbackStart;
      if(raw.trim()) syllables.push(syllable(t, t + beat.playbackDuration, raw, explicit));
    }
  }
  const barAt = t => bars.find(b => b.t <= t && t < b.end) ?? bars[bars.length - 1];
  const sectionAt = t => sections.filter(s => s.t <= t).at(-1) ?? null;
  /** @type {string[]} */
  const lines = [];
  const starts = sections.map(s => s.t);
  let next = 0;
  /**
   * Schreibt die Namen aller Abschnitte bis zu einer Zeit, je mit einer Leerzeile davor (außer ganz oben).
   * @param {number} t Zeit in Ticks
   * @returns {void}
   */
  const headers = t => {
    for(; next < sections.length && sections[next].t <= t; next++){
      if(lines.length) lines.push('');
      lines.push(`[${sections[next].name}]`);
    }
  };
  for(const p of splitPhrases(syllables, sections, barAt)){
    // Ein Auftakt gehört schon zum nächsten Abschnitt: dessen Name steht über ihm, und dort beginnt der Abschnitt.
    const section = p.section ?? sectionAt(p.syl[0].t);
    if(section){
      headers(section.t);
      const index = sections.indexOf(section);
      starts[index] = Math.min(starts[index], p.syl[0].t);
    }
    // Mehrere Wörter auf einem Schlag stehen mit "_" verbunden da ("mir_zu."), siehe splitSyllables().
    lines.push(p.syl.reduce((line, s) => line + (line && !line.endsWith('-') ? ' ' : '') + s.text.replace(/\s+/g, '_'),
      ''));
  }
  headers(Infinity);
  return {lines, starts};
}

/**
 * Erzeugt den Inhalt der Ansicht aus den Noten.
 * @param {Score} score Noten
 * @returns {TextModel}
 */
export function buildTextModel(score){
  const textTrack = lyricsTrack(score);
  const chordTrack = chordsTrack(score);
  /** @type {Map<number, import('./notation.js').MergedChord[]>} Akkorde je Takt (Index des Mastertakts) */
  const barChords = new Map();
  for(const merged of mergeChords(score)){
    const index = merged.beat.voice.bar.index;
    if(!barChords.has(index)) barChords.set(index, []);
    barChords.get(index).push(merged);
  }

  // 1. Silben, Akkorde, Abschnitte und Takte mit absoluter Zeit in Abspielreihenfolge.
  /** @type {Syllable[]} */
  const syllables = [];
  /** @type {{t: number, name: string}[]} */
  const chords = [];
  /** @type {SectionMark[]} */
  const sections = [];
  /** @type {{t: number, end: number, beats: number}[]} */
  const bars = [];
  /** @type {Map<string, string>} */
  const grips = new Map();
  const explicit = versesWithBreaks(textTrack);
  const timeline = playTimeline(score);
  for(const {mb, pass, t: time, end} of timeline){
    bars.push({t: time, end, beats: mb.timeSignatureNumerator});
    if(mb.section) sections.push({t: time, name: (mb.section.text || mb.section.marker || '').replace(/^\[|]$/g, '')});
    for(const voice of textTrack?.staves[0].bars[mb.index]?.voices ?? []) for(const beat of voice.beats){
      const verse = verseFor(beat.lyrics ?? [], pass);
      const t = time + beat.playbackStart;
      if(verse >= 0) syllables.push(syllable(t, t + beat.playbackDuration, beat.lyrics[verse], explicit.has(verse)));
    }
    for(const {tick, chord} of barChords.get(mb.index) ?? []){
      const t = time + tick - mb.start;
      chords.push({t, name: chord.name});
      if(!grips.has(chord.name)) grips.set(chord.name, chord.strings.some(f => f >= 0) ? gripOf(chord) : '');
    }
  }
  chords.sort((a, b) => a.t - b.t);
  syllables.sort((a, b) => a.t - b.t);
  /** @type {(t: number) => ?SectionMark} */
  const sectionAt = t => sections.filter(s => s.t <= t).at(-1) ?? null;
  const barAt = t => bars.find(b => b.t <= t && t < b.end) ?? bars[bars.length - 1];

  // 2. Zeilen (splitPhrases()).
  const phrases = splitPhrases(syllables, sections, barAt);
  for(const p of phrases){
    if(p.section) continue;
    // Auftakt: Die Zeile liegt ganz im Takt vor einem Abschnitt, und dort geht der Text weiter.
    const next = sections.find(x => x.t >= p.syl.at(-1).end && x.t > p.syl[0].t);
    const lastBar = next ? barAt(next.t - 1) : null;
    p.section = next && p.syl[0].t >= lastBar.t && !/[.!?]$/.test(p.syl.at(-1).text)
      && syllables.some(s => s.t >= next.t && s.t < next.t + (lastBar.end - lastBar.t))
      ? next : sectionAt(p.syl[0].t);
  }

  // 3. Jeder Takt kommt vor. In Abschnitten mit Text bekommt die erste Silbe des Takts den Taktstrich; ein Takt ohne
  // eigene Silbe (oder deren erste erst in der zweiten Takthälfte beginnt, ein Auftakt) bekommt einen leeren Teil, der
  // an die laufende Zeile angehängt wird. Abschnitte ganz ohne Text (Intro, Solo) werden zu Taktzeilen.
  const textSections = new Set(phrases.map(p => p.section));
  /** @type {Map<Syllable, {syl: Syllable[], section: ?SectionMark}>} */
  const phraseOf = new Map();
  for(const p of phrases) for(const s of p.syl) phraseOf.set(s, p);
  /**
   * Stelle in einem Takt, an die Akkorde kommen: ein Teil einer Textzeile oder ein Takt einer Taktzeile.
   * leads: leerer Teil eines Takts, in dem eine Zeile beginnt (gehört an deren Anfang).
   * @type {{t: number, section: ?SectionMark, syl?: Syllable, part?: LinePart, bar?: BarCell, leads?: boolean}[]}
   */
  const anchors = [];
  for(const b of bars){
    const section = sectionAt(b.t);
    const own = syllables.filter(s => s.t >= b.t && s.t < b.end);
    const list = [];
    if(!textSections.has(section)){
      list.push({t: b.t, section, bar: {t: b.t, chords: [], at: [], beats: b.beats, length: b.end - b.t}});
    } else if(!own.length || own[0].t - b.t >= (b.end - b.t) / 2){
      // Beginnt im Takt eine Zeile (Auftakt), gehört der leere Teil schon zu ihr.
      const leads = own.length > 0 && phraseOf.get(own[0]).syl[0] === own[0];
      list.push({t: b.t, section: leads ? phraseOf.get(own[0]).section : section, leads,
        part: {t: b.t, text: '', bar: false, chords: []}});
    }
    for(const s of own) list.push({t: s.t, section: phraseOf.get(s).section, syl: s, part: {t: s.t, text: s.text, bar: false, chords: []}});
    if(list[0].part) list[0].part.bar = true;
    // Ein Akkord gehört an die nächste Stelle im Takt, wenn bis dahin kein anderer angeschlagen wird (Akkord kurz vor
    // der Silbe), sonst an die Stelle, die gerade klingt.
    for(const c of chords.filter(x => x.t >= b.t && x.t < b.end)){
      const nextChord = chords.find(x => x.t > c.t);
      const ahead = list.find(a => a.t >= c.t);
      const target = ahead && !(nextChord && nextChord.t <= ahead.t) ? ahead : (list.filter(a => a.t <= c.t).at(-1) ?? list[0]);
      (target.part ?? target.bar).chords.push(c.name);
      target.bar?.at.push(c.t - b.t);
    }
    anchors.push(...list);
  }

  // 4. Zeilen: Eine Textzeile beginnt mit der ersten Silbe einer Phrase; leere Takte davor gehören an das Ende der
  // vorigen Zeile, am Anfang eines Abschnitts an den Anfang der ersten. Taktzeilen fassen bis zu BARS_PER_LINE Takte.
  /** @type {{t: number, section: ?SectionMark, line: TextLine, hasText?: boolean}[]} */
  const items = [];
  let item = null;
  for(const a of anchors){
    const startsPhrase = a.leads || (a.syl && phraseOf.get(a.syl).syl[0] === a.syl);
    const kind = a.bar ? 'bars' : 'parts';
    if(!item || item.section !== a.section || !item.line[kind] || (startsPhrase && item.hasText)
      || (a.bar && item.line.bars.length >= BARS_PER_LINE)){
      item = {t: a.t, section: a.section, line: {t: a.t, [kind]: []}};
      items.push(item);
    }
    if(a.bar){
      item.line.bars.push(a.bar);
    } else {
      item.line.parts.push(a.part);
      if(a.syl) item.hasText = true;
    }
  }

  // Eine Zeile endet mit einem Takt, wenn die nächste mit einem Takt beginnt (sonst geht der Takt dort weiter).
  items.forEach((it, i) => {
    const next = items[i + 1]?.line;
    it.line.closed = !next || !!next.bars || next.parts[0].bar;
  });
  const out = [];
  for(const item of items){
    if(!out.length || out.at(-1).ref !== item.section) out.push({ref: item.section, name: item.section?.name ?? '', lines: []});
    out.at(-1).lines.push(item.line);
  }
  // Zeitbereich je Abschnitt: von seiner ersten Zeile bis zur ersten des nächsten (ein Auftakt gehört so schon zum
  // neuen Abschnitt, wie in der Ansicht). Damit findet "Abschnitte vergleichen" zum Abschnitt seine Takte.
  const songEnd = timeline.at(-1)?.end ?? 0;
  return {
    sections: out.map(({name, lines}, i) => ({name, lines, start: lines[0].t, end: out[i + 1]?.lines[0].t ?? songEnd})),
    chords: [...grips].map(([name, grip]) => ({name, grip})),
    chordTimes: chords,
    lyricsTrack: syllables.length ? textTrack.name : '',
    chordsTrack: chords.length ? chordTrack.name : '',
  };
}

// noinspection JSUnusedGlobalSymbols: für Leadsheet und Druck, noch ohne Aufrufer
/**
 * Alle Griffbilder des Songs in der Reihenfolge des ersten Anschlags. Für Leadsheet und Druck gedacht; der Player
 * zeigt nur den aktuellen Akkord.
 * @param {TextModel} model Inhalt aus buildTextModel()
 * @returns {string} HTML, leer ohne Griffbilder
 */
export function renderChordDiagrams(model){
  return model.chords.filter(c => c.grip).map(c => chordDiagramSvg(c.name, c.grip)).join('');
}

/**
 * Zeichnet die Ansicht als HTML: je Abschnitt die Zeilen (die Griffbilder darüber zeichnet renderChordDiagrams()).
 * Jede Silbe steht mit ihren Akkorden in einem eigenen Block (Akkord oben, Silbe unten), so sitzt der Akkord auch in Proportionalschrift genau
 * über ihr, und lange Zeilen brechen auf schmalen Bildschirmen zwischen den Silben um. Jeder Teil trägt seine Zeit
 * (data-t, Ticks in Abspielreihenfolge), ein Taktanfang zusätzlich data-bar; daran hebt der Player beim Abspielen
 * den aktuellen Takt und die aktuelle Silbe hervor. Taktzeilen sehen aus wie die
 * Akkordzeile einer Textzeile, nur ohne Text. Ein Abschnitt kann einen Zusatz neben dem Namen tragen (note, z. B.
 * "wie oben" oder "2×" auf dem Leadsheet, siehe collapseSections() in sheet.js).
 * @param {{sections: {name: string, lines: TextLine[], note?: string}[]}} model Inhalt aus buildTextModel()
 * @returns {string} HTML
 */
export function renderTextView(model){
  if(!model.sections.length) return '<p class="empty">Dieser Song hat weder Text noch Akkorde.</p>';
  const barline = '<span class="tv-barline">|</span>';
  /** @type {(p: LinePart) => string} */
  const chordHtml = p => (p.bar ? barline : '') + escapeHtml(p.chords.join(' '));
  const line = l => {
    if(l.hint !== undefined) return `<div class="tv-line tv-hint">${escapeHtml(l.hint)}</div>`;
    const parts = l.bars ? l.bars.map(b => ({t: b.t, text: '', bar: true, chords: b.chords})) : l.parts;
    // Ein Strich schließt die Zeile, wenn mit ihr ein Takt endet.
    const close = l.closed ? `<span class="tv-part tv-empty"><span class="tv-chord">${barline}</span><span class="tv-syl"> </span></span>` : '';
    return `<div class="tv-line${l.bars ? ' tv-barrow' : ''}">${parts.map(p => {
      // Silben mit Bindestrich gehören zum nächsten Wort: ohne Leerzeichen anschließen. Dehnt ein Akkord oder
      // Taktstrich die Silbe, füllt ein Strich die Lücke im Wort (tv-stretch).
      const joined = p.text.endsWith('-');
      // Ein Takt ohne Silbe braucht trotzdem die Höhe einer Textzeile, sonst rutscht sein Akkord nach unten.
      const word = joined ? p.text.slice(0, -1) : p.text ? p.text + ' ' : ' ';
      const classes = ['tv-part', joined && (p.chords.length || p.bar) ? 'tv-stretch' : '', p.text ? '' : 'tv-empty'];
      return `<span class="${classes.filter(Boolean).join(' ')}" data-t="${p.t}"${p.bar ? ' data-bar' : ''}>`
        + `<span class="tv-chord">${chordHtml(p)}</span>`
        + `<span class="tv-syl">${escapeHtml(word)}</span></span>`;
    }).join('')}${close}</div>`;
  };
  return `
    ${model.sections.map(s => `
      <section class="tv-section">
        ${s.name ? `<h3>${escapeHtml(s.name)}${s.note ? ` <span class="tv-note">${escapeHtml(s.note)}</span>` : ''}</h3>`
          : ''}
        ${s.lines.map(line).join('')}
      </section>`).join('')}
  `;
}

// --------------------------------------------------------------------------------------------------------------------
// ChordPro-Export
// --------------------------------------------------------------------------------------------------------------------

/**
 * Export als ChordPro (.cho), wie es in der Community üblich ist (chordpro.org): Kopfangaben als Direktiven, Akkorde
 * in eckigen Klammern vor ihrer Silbe ("[G]warum hast du nichts ge[Am]lernt?"), Abschnitte als Umgebungen
 * (start_of_verse, start_of_chorus, start_of_bridge mit label). Takte kennt ChordPro im Text nicht; sie fallen dort
 * weg. Abschnitte ganz ohne Text (Intro, Solo) werden zu Rastern (start_of_grid) mit einer Zelle je Schlag, so
 * bleiben dort Takte und die Lage der Wechsel erhalten.
 *
 * Inhalt wie in der Ansicht "Text & Akkorde" (buildTextModel() in textview.js): Text aus der Gesangsspur, Akkorde
 * aus allen Spuren nach derselben Regel wie über den Noten (mergeChords() in notation.js), Wiederholungen
 * ausgeschrieben. Griffe, die vom Akkordkatalog abweichen oder dort
 * fehlen, kommen als {define} dazu.
 */

/** Takte je Zeile eines Rasters. */
const GRID_BARS_PER_ROW = 4;

/**
 * Wert einer Direktive: Zeilenumbrüche und geschweifte Klammern würden die Direktive beenden.
 * @param {*} value Wert
 * @returns {string} einzeilig, ohne { und }
 */
function directiveValue(value){
  return String(value).replace(/[\r\n]+/g, ' ').replace(/[{}]/g, '').trim();
}

/**
 * Umgebung eines Abschnitts nach seinem Namen.
 * @param {string} name Name des Abschnitts, z. B. "Chorus 1", "Strophe 2", "Bridge"
 * @returns {string} "chorus", "bridge" oder "verse"
 */
function environmentOf(name){
  if(/chorus|refrain/i.test(name)) return 'chorus';
  if(/bridge/i.test(name)) return 'bridge';
  return 'verse';
}

/**
 * {define} eines Griffs, z. B. "{define: Bm base-fret 2 frets x 1 3 3 2 1}". ChordPro zählt die Bünde ab dem
 * Grundbund (1 = base-fret).
 * @param {string} name Akkordname
 * @param {string} grip Griff von der tiefen E-Saite aus, z. B. "x24432"
 * @returns {string} Direktive
 */
function defineLine(name, grip){
  const frets = parseGrip(grip);
  const base = diagramFirstFret(frets);
  const cells = frets.map(f => f < 0 ? 'x' : f === 0 ? '0' : String(f - base + 1));
  return `{define: ${directiveValue(name)} base-fret ${base} frets ${cells.join(' ')}}`;
}

/**
 * Textzeile als ChordPro: Akkorde in Klammern vor ihrer Silbe, Silben eines Worts zusammengesetzt. Takte ohne Silbe
 * bleiben als Akkorde mit Leerzeichen stehen ("lernt? [Asus2] [Am]"), Taktstriche fallen weg.
 * @param {TextLine} line Zeile mit parts
 * @returns {string} Zeile, leer, wenn sie weder Text noch Akkorde hat
 */
function lyricLine(line){
  let out = '';
  for(const p of line.parts){
    out += p.chords.map(c => `[${c}]`).join('');
    if(p.text) out += p.text.endsWith('-') ? p.text.slice(0, -1) : p.text + ' ';
    else if(p.chords.length) out += ' ';
  }
  return out.trimEnd();
}

/**
 * Taktzeilen als Raster-Zeilen: je Takt so viele Zellen wie Schläge, der Akkord in der Zelle seines Schlags, sonst
 * "."; mehrere Akkorde auf einem Schlag mit "~" verbunden.
 * @param {TextLine[]} lines Taktzeilen eines Abschnitts
 * @returns {string[]} Zeilen wie "| C . G/B . | Am . F . |"
 */
function gridRows(lines){
  const bars = lines.flatMap(l => l.bars);
  const rows = [];
  for(let i = 0; i < bars.length; i += GRID_BARS_PER_ROW){
    const cells = bars.slice(i, i + GRID_BARS_PER_ROW).map(bar => {
      const beats = Array.from({length: bar.beats}, () => []);
      bar.chords.forEach((name, k) => {
        const beat = Math.min(bar.beats - 1, Math.floor(bar.at[k] / (bar.length / bar.beats)));
        beats[beat].push(name);
      });
      return beats.map(b => b.length ? b.join('~') : '.').join(' ');
    });
    rows.push(`| ${cells.join(' | ')} |`);
  }
  return rows;
}

/**
 * Erzeugt den Inhalt einer ChordPro-Datei.
 * @param {TextModel} model Inhalt der Ansicht "Text & Akkorde"
 * @param {{title: string, artist?: ?string}} song Titel und Interpret
 * @param {{key: string, shapeKey: string, capo: number, tempo: number, time: string}} info Tonart (klingend und der
 *   Griffe), Capo, Tempo und Taktart, z. B. time "4/4"
 * @param {ChordLibrary} library Akkordkatalog; Griffe, die davon abweichen, kommen als {define} dazu
 * @returns {string} ChordPro
 */
export function toChordPro(model, song, info, library){
  const out = [`{title: ${directiveValue(song.title)}}`];
  if(song.artist) out.push(`{artist: ${directiveValue(song.artist)}}`);
  // Die Akkorde sind Griffnamen relativ zum Capo; {key} ist deshalb die Tonart der Griffe.
  if(info.shapeKey) out.push(`{key: ${info.shapeKey}}`);
  if(info.capo) out.push(`{capo: ${info.capo}}`);
  if(info.tempo) out.push(`{tempo: ${info.tempo}}`);
  if(info.time) out.push(`{time: ${info.time}}`);

  const defines = model.chords.filter(c => c.grip && library[chordKey(c.name)]?.[0] !== c.grip);
  if(defines.length) out.push('', ...defines.map(c => defineLine(c.name, c.grip)));

  for(const section of model.sections){
    const label = section.name ? `: label="${directiveValue(section.name).replace(/"/g, "'")}"` : '';
    const hasText = section.lines.some(l => l.parts);
    const env = hasText ? environmentOf(section.name) : 'grid';
    const body = hasText
      ? section.lines.map(l => l.bars ? gridRows([l]).join('\n') : lyricLine(l)).filter(Boolean)
      : gridRows(section.lines);
    if(!body.length) continue;
    out.push('', `{start_of_${env}${label}}`, ...body, `{end_of_${env}}`);
  }
  return out.join('\n') + '\n';
}

/**
 * Erzeugt eine ChordPro-Datei für den Download.
 * @param {import('./base.js').Song} song Song
 * @param {string} tex Inhalt von score.atex
 * @returns {Promise<File>} Datei, benannt "Interpret - Titel.cho"
 */
export async function exportChordProFile(song, tex){
  const alphaTab = await loadAlphaTab();
  const score = parseScore(alphaTab, tex);
  const info = readScoreInfo(alphaTab, score);
  // Die häufigste Taktart; der erste Takt ist oft ein kürzerer Auftakt.
  /** @type {Map<string, number>} */
  const times = new Map();
  for(const mb of score.masterBars){
    const t = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
    times.set(t, (times.get(t) ?? 0) + 1);
  }
  const time = [...times].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  // Ohne Katalog (Netzfehler) kommen alle Griffe als {define} in die Datei.
  const library = await loadChordLibraryOrEmpty();
  const text = toChordPro(buildTextModel(score), song, {...info, time}, library);
  const name = [song.artist, song.title].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]/g, '') || 'Song';
  return new File([text], `${name}.cho`, {type: 'text/plain;charset=utf-8'});
}
