/**
 * Export als ChordPro (.cho), wie es in der Community üblich ist (chordpro.org): Kopfangaben als Direktiven, Akkorde
 * in eckigen Klammern vor ihrer Silbe ("[G]warum hast du nichts ge[Am]lernt?"), Abschnitte als Umgebungen
 * (start_of_verse, start_of_chorus, start_of_bridge mit label). Takte kennt ChordPro im Text nicht; sie fallen dort
 * weg. Abschnitte ganz ohne Text (Intro, Solo) werden zu Rastern (start_of_grid) mit einer Zelle je Schlag, so
 * bleiben dort Takte und die Lage der Wechsel erhalten.
 *
 * Inhalt wie in der Ansicht "Text & Akkorde" (buildTextModel() in textview.js): Text aus der Gesangsspur, Akkorde
 * aus allen Spuren nach derselben Regel wie über den Noten (mergeChords() in tracks.js), Wiederholungen
 * ausgeschrieben. Griffe, die von der Akkordbibliothek abweichen oder dort
 * fehlen, kommen als {define} dazu.
 */

import {loadChordLibrary} from './api.js';
import {chordKey, diagramFirstFret, parseGrip} from './chords.js';
import {loadAlphaTab, parseScore, readScoreInfo} from './score.js';
import {buildTextModel} from './textview.js';

/** @typedef {import('./textview.js').TextModel} TextModel */
/** @typedef {import('./textview.js').TextLine} TextLine */
/** @typedef {import('./chords.js').ChordLibrary} ChordLibrary */

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
 * @param {ChordLibrary} library Akkordbibliothek; Griffe, die davon abweichen, kommen als {define} dazu
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
 * @param {import('./api.js').Song} song Song
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
  // Ohne Bibliothek (Netzfehler) kommen alle Griffe als {define} in die Datei.
  const library = await loadChordLibrary().catch(() => ({}));
  const text = toChordPro(buildTextModel(score), song, {...info, time}, library);
  const name = [song.artist, song.title].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]/g, '') || 'Song';
  return new File([text], `${name}.cho`, {type: 'text/plain;charset=utf-8'});
}
