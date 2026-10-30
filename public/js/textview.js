/**
 * Ansicht "Text & Akkorde": der Songtext in Zeilen, die Akkorde genau über ihrer Silbe, gegliedert nach Abschnitten,
 * darüber die Griffbilder. Alles wird aus den Noten erzeugt: der Text aus der Gesangsspur (lyricsTrack() in
 * tracks.js), die Akkorde aus allen Spuren zusammengetragen, bei verschiedenen Akkorden an einer Stelle aus der
 * ersten Begleitspur (mergeChords() in tracks.js, dieselbe Regel wie über den Noten), in Abspielreihenfolge mit
 * Wiederholungen.
 *
 * Jeder Takt des Songs kommt vor, wie in den handgebauten Leadsheets: In Abschnitten mit Text steht über der ersten
 * Silbe eines Takts ein Taktstrich "|" (mit Akkord, wenn dort einer angeschlagen wird), Takte ohne Silbe hängen als
 * "|Am |Asus2" an der Zeile. Abschnitte ganz ohne Text (Intro, Solo) stehen als Taktzeile "| G | % | C |" da.
 * Zeilenumbrüche stehen nicht in den Noten; sie ergeben sich aus Satzzeichen, Pausen und Abschnitten (später aus
 * leadsheet.json). buildTextModel() kommt ohne DOM aus und läuft deshalb auch in Node.
 */

import {escapeHtml} from './api.js';
import {gripOf} from './chords.js';
import {chordDiagramSvg} from './svg.js';
import {chordsTrack, lyricsTrack, mergeChords} from './tracks.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.MasterBar} MasterBar */

/**
 * Silbe mit absoluter Zeit in Abspielreihenfolge.
 * @typedef {{t: number, end: number, text: string}} Syllable
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
 * (bars); closed: Die Zeile endet mit dem Ende eines Takts (die nächste beginnt mit einem neuen Takt).
 * @typedef {{t: number, parts?: LinePart[], bars?: BarCell[], closed?: boolean}} TextLine
 */

/**
 * Inhalt der Ansicht.
 * @typedef {Object} TextModel
 * @property {{name: string, lines: TextLine[]}[]} sections Abschnitte in Abspielreihenfolge (name leer vor dem
 *   ersten Marker)
 * @property {{name: string, grip: string}[]} chords Griffbilder der Akkorde in der Reihenfolge des ersten Anschlags
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
 * Takte in Abspielreihenfolge: Wiederholungen ausgeschrieben, Volta-Klammern beachtet (Sprünge wie D.S. al Coda
 * nicht).
 * @param {Score} score Noten
 * @returns {{mb: MasterBar, pass: number}[]} Takt und Durchgang (1 beim ersten Mal)
 */
function playOrder(score){
  const out = [];
  const bars = score.masterBars;
  /** @type {Map<number, number>} */
  const passes = new Map();
  let i = 0;
  let start = 0;
  let pass = 1;
  // Schutz gegen Endlosschleifen bei widersprüchlichen Wiederholungszeichen.
  for(let guard = 0; i < bars.length && guard < 10000; guard++){
    const mb = bars[i];
    if(mb.isRepeatStart && pass === 1) start = i;
    if(mb.alternateEndings && !(mb.alternateEndings & (1 << (pass - 1)))){
      i++;
      continue;
    }
    out.push({mb, pass});
    if(mb.isRepeatEnd){
      const done = passes.get(mb.index) ?? 1;
      if(done < mb.repeatCount){
        passes.set(mb.index, done + 1);
        pass = done + 1;
        i = start;
        continue;
      }
      passes.delete(mb.index);
      pass = 1;
    }
    i++;
  }
  return out;
}

/**
 * Silbe eines Schlags im jeweiligen Durchgang: Strophe 2 beim zweiten Mal usw.; hat der Schlag nur eine Strophe,
 * gilt sie in jedem Durchgang.
 * @param {string[]} lyrics Silben des Schlags je Strophe
 * @param {number} pass Durchgang
 * @returns {string} Silbe, leer, wenn keine
 */
function syllableFor(lyrics, pass){
  const own = lyrics[pass - 1]?.trim() ?? '';
  if(own) return own;
  return lyrics.slice(1).some(s => s?.trim()) ? '' : (lyrics[0]?.trim() ?? '');
}

/**
 * Erzeugt den Inhalt der Ansicht aus den Noten.
 * @param {Score} score Noten
 * @returns {TextModel}
 */
export function buildTextModel(score){
  const textTrack = lyricsTrack(score);
  const chordTrack = chordsTrack(score);
  /** @type {Map<number, import('./tracks.js').MergedChord[]>} Akkorde je Takt (Index des Mastertakts) */
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
  let time = 0;
  for(const {mb, pass} of playOrder(score)){
    const length = mb.calculateDuration();
    bars.push({t: time, end: time + length, beats: mb.timeSignatureNumerator});
    if(mb.section) sections.push({t: time, name: (mb.section.text || mb.section.marker || '').replace(/^\[|]$/g, '')});
    for(const voice of textTrack?.staves[0].bars[mb.index]?.voices ?? []) for(const beat of voice.beats){
      const text = syllableFor(beat.lyrics ?? [], pass);
      if(text) syllables.push({t: time + beat.playbackStart, end: time + beat.playbackStart + beat.playbackDuration, text});
    }
    for(const {tick, chord} of barChords.get(mb.index) ?? []){
      const t = time + tick - mb.start;
      chords.push({t, name: chord.name});
      if(!grips.has(chord.name)) grips.set(chord.name, chord.strings.some(f => f >= 0) ? gripOf(chord) : '');
    }
    time += length;
  }
  chords.sort((a, b) => a.t - b.t);
  syllables.sort((a, b) => a.t - b.t);
  /** @type {(t: number) => ?SectionMark} */
  const sectionAt = t => sections.filter(s => s.t <= t).at(-1) ?? null;
  const barAt = t => bars.find(b => b.t <= t && t < b.end) ?? bars[bars.length - 1];

  // 2. Zeilen: Umbruch bei längerer Pause, Satzzeichen oder Abschnittswechsel, nie mitten im Wort. Ein Auftakt (die
  // Zeile beginnt erst im Takt vor dem Abschnitt) gehört schon zum neuen Abschnitt.
  /** @type {{syl: Syllable[], section: ?SectionMark}[]} */
  const phrases = [];
  let current = null;
  for(const s of syllables){
    const prev = current?.syl.at(-1);
    const sectionBetween = prev ? sections.find(x => x.t > prev.t && x.t <= s.t) : null;
    const pickup = !!sectionBetween && current !== null && current.syl[0].t >= barAt(sectionBetween.t - 1).t;
    const chars = current ? current.syl.reduce((n, x) => n + x.text.length + 1, 0) : 0;
    const gap = prev ? s.t - prev.end : 0;
    const lineEnd = !current || gap >= HALF_NOTE_TICKS * 2 || (chars >= LINE_SOFT_CHARS && gap >= HALF_NOTE_TICKS / 2)
      || (/[.!?;:]$/.test(prev.text) && current.syl.length >= LINE_MIN_SYLLABLES)
      || (/,$/.test(prev.text) && current.syl.length >= LINE_COMMA_SYLLABLES) || (sectionBetween && !pickup);
    const midWord = prev?.text.endsWith('-') && !(sectionBetween && !pickup);
    if(!current || (lineEnd && !midWord)){
      current = {syl: [], section: null};
      phrases.push(current);
    }
    if(sectionBetween && pickup) current.section = sectionBetween;
    current.syl.push(s);
  }
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
  return {
    sections: out.map(({name, lines}) => ({name, lines})),
    chords: [...grips].map(([name, grip]) => ({name, grip})),
    lyricsTrack: syllables.length ? textTrack.name : '',
    chordsTrack: chords.length ? chordTrack.name : '',
  };
}

/**
 * Griffbilder der Akkordspur in der Reihenfolge des ersten Anschlags, für alle Ansichten des Players (statt der von
 * alphaTab, damit sie überall gleich aussehen).
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
 * Akkordzeile einer Textzeile, nur ohne Text.
 * @param {TextModel} model Inhalt aus buildTextModel()
 * @returns {string} HTML
 */
export function renderTextView(model){
  if(!model.sections.length) return '<p class="empty">Dieser Song hat weder Text noch Akkorde.</p>';
  const barline = '<span class="tv-barline">|</span>';
  /** @type {(p: LinePart) => string} */
  const chordHtml = p => (p.bar ? barline : '') + escapeHtml(p.chords.join(' '));
  const line = l => {
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
        ${s.name ? `<h3>${escapeHtml(s.name)}</h3>` : ''}
        ${s.lines.map(line).join('')}
      </section>`).join('')}
  `;
}
