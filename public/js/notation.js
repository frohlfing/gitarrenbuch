/**
 * Noten: Spuren und Abspielreihenfolge, Lesen und Schreiben (alphaTex, Guitar Pro), Bearbeiten, Transponieren.
 */

import {
  chordKey, escapeHtml, gripOf, loadChordLibraryOrEmpty, normalizeChords, parseGrip, transposeChordName,
  transposeKeySignature,
} from './base.js';
import {findGrips} from './chordgrips.js';
import {resolveConflicts} from './conflicts.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Staff} Staff */
/** @typedef {import('../../types/alphatab').model.Track} Track */
/** @typedef {import('../../types/alphatab').model.Beat} Beat */
/** @typedef {import('../../types/alphatab').model.Chord} Chord */
/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */
/** @typedef {import('../../types/alphatab').model.FlatSyncPoint} FlatSyncPoint */
/** @typedef {import('../../types/alphatab').synth.BackingTrackSyncPoint} BackingTrackSyncPoint */
/** @typedef {import('../../types/alphatab').midi.MidiFile} MidiFile */
/** @typedef {import('../../types/alphatab').midi.TempoChangeEvent} TempoChangeEvent */
/** @typedef {import('./base.js').ChordLibrary} ChordLibrary */
/** @typedef {import('../../types/alphatab').model.Bar} Bar */
/** @typedef {import('../../types/alphatab').model.Note} Note */
/** @typedef {import('../../types/alphatab').model.Voice} Voice */

// --------------------------------------------------------------------------------------------------------------------
// Abspielreihenfolge
// --------------------------------------------------------------------------------------------------------------------

/**
 * Spielfolge der Takte: in welcher Reihenfolge die Takte eines Songs gespielt werden, mit Wiederholungen,
 * Volta-Klammern und (wenn gewünscht) Sprungzeichen.
 */

/** Schutz gegen Endlosschleifen bei widersprüchlichen Wiederholungs- und Sprungzeichen: höchstens so viele Takte. */
const PLAY_ORDER_MAX = 10000;

/**
 * Höchste Volta-Klammer in der Wiederholung um einen Takt (zwischen zwei Wiederholungsanfängen); nach einem Sprung
 * wird nur sie gespielt.
 * @param {Score} score Noten
 * @param {number} index Takt mit Volta-Klammer
 * @returns {number} Nummer der Klammer (1 = erste)
 */
function lastEnding(score, index){
  const bars = score.masterBars;
  let from = index;
  while(from > 0 && !bars[from].isRepeatStart) from--;
  let to = index + 1;
  while(to < bars.length && !bars[to].isRepeatStart) to++;
  const mask = bars.slice(from, to).reduce((m, mb) => m | mb.alternateEndings, 0);
  return 32 - Math.clz32(mask);
}

/**
 * Spielfolge der Takte mit Wiederholungen, Volta-Klammern und Sprungzeichen ausgeschrieben. Ein Sprung (D.C., D.S.,
 * D.S.S.) gilt nach dem letzten Durchgang seines Takts und nur einmal; danach werden Wiederholungen nicht mehr
 * wiederholt, von Volta-Klammern gilt die letzte (wie üblich). "al Coda" springt am "To Coda" zur Coda, "al Fine"
 * endet nach dem Takt mit "Fine".
 *
 * Ohne Direction (die Aufzählung der Sprungzeichen aus alphaTab) gelten nur Wiederholungen und Volta-Klammern: So
 * rechnet die Ansicht "Text & Akkorde" (textview.js), die ohne das alphaTab-Modul auskommt.
 * @param {Score} score Noten
 * @param {?typeof import('../../types/alphatab').model.Direction} [Direction] alphaTab.model.Direction, null ohne
 *   Sprungzeichen
 * @returns {{bar: number, pass: number, seen: number}[]} je gespielter Takt: Index, Durchgang der Wiederholung (ab 1;
 *   nach einem Sprung die letzte Klammer) und wie oft der Takt davor schon gespielt wurde (ab 0)
 */
export function playOrder(score, Direction = null){
  const D = Direction;
  const bars = score.masterBars;
  const has = (mb, direction) => D !== null && (mb.directions?.has(direction) ?? false);
  const find = direction => bars.findIndex(mb => has(mb, direction));
  const start0 = () => 0;
  const segno = () => find(D.TargetSegno);
  const segnoSegno = () => find(D.TargetSegnoSegno);
  /** @type {Map<number, [function(): number, ?string]>} Sprung → Ziel und Ende (coda, doubleCoda, fine) */
  const jumps = D === null ? new Map() : new Map([
    [D.JumpDaCapo, [start0, null]], [D.JumpDaCapoAlCoda, [start0, 'coda']],
    [D.JumpDaCapoAlDoubleCoda, [start0, 'doubleCoda']], [D.JumpDaCapoAlFine, [start0, 'fine']],
    [D.JumpDalSegno, [segno, null]], [D.JumpDalSegnoAlCoda, [segno, 'coda']],
    [D.JumpDalSegnoAlDoubleCoda, [segno, 'doubleCoda']], [D.JumpDalSegnoAlFine, [segno, 'fine']],
    [D.JumpDalSegnoSegno, [segnoSegno, null]], [D.JumpDalSegnoSegnoAlCoda, [segnoSegno, 'coda']],
    [D.JumpDalSegnoSegnoAlDoubleCoda, [segnoSegno, 'doubleCoda']], [D.JumpDalSegnoSegnoAlFine, [segnoSegno, 'fine']],
  ]);
  const order = [];
  const passes = new Map();
  const used = new Set();
  let start = 0;
  let pass = 1;
  let jumped = false;
  /** @type {?string} */
  let ending = null;
  for(let i = 0; i < bars.length && order.length < PLAY_ORDER_MAX;){
    const mb = bars[i];
    if(mb.isRepeatStart && start !== i && !jumped){
      start = i;
      pass = 1;
    }
    const wanted = jumped ? lastEnding(score, i) : pass;
    if(mb.alternateEndings && !(mb.alternateEndings & (1 << (wanted - 1)))){
      i++;
      continue;
    }
    const seen = passes.get(i) ?? 0;
    passes.set(i, seen + 1);
    order.push({bar: i, pass: wanted, seen});
    if(!jumped && mb.repeatCount > 0 && pass < mb.repeatCount){
      pass++;
      i = start;
      continue;
    }
    if(mb.repeatCount > 0){
      // Wiederholung fertig: Danach beginnt ein neuer Abschnitt ohne Durchgänge.
      start = i + 1;
      pass = 1;
    }
    if(ending === 'fine' && has(mb, D.TargetFine)) break;
    const coda = ending === 'coda' && has(mb, D.JumpDaCoda) ? find(D.TargetCoda)
      : ending === 'doubleCoda' && has(mb, D.JumpDaDoubleCoda) ? find(D.TargetDoubleCoda) : -1;
    if(coda >= 0){
      ending = null;
      i = coda;
      continue;
    }
    const jump = D === null ? undefined : [...mb.directions ?? []].find(d => jumps.has(d));
    if(jump !== undefined && !used.has(i)){
      used.add(i);
      const [target, end] = jumps.get(jump);
      const to = target();
      if(to >= 0){
        jumped = true;
        ending = end;
        i = to;
        continue;
      }
    }
    i++;
  }
  return order;
}

// --------------------------------------------------------------------------------------------------------------------
// Spuren
// --------------------------------------------------------------------------------------------------------------------

/**
 * Spuren eines Songs: Namen, Herkunft von Text und Akkorden, ein Capo für alle Spuren.
 *
 * Spuren haben keine Rollen (mehr). Welche Spur die Akkorde und welche den Text trägt, steht in den Noten selbst: Es
 * ist die Spur, in der sie stehen (chordsTrack(), lyricsTrack()). Eine zweite Angabe dafür (Rolle, Name, Feld in
 * song.json) könnte den Noten widersprechen; so gibt es nur eine Quelle. Geändert wird die Zuordnung im Editor, indem
 * Akkorde bzw. Text in eine andere Spur umziehen (moveContent() in notation.js). Die Reihenfolge der Spuren ist die
 * der Datei, man legt sie im Editor fest (Dialog "Spuren", ↑/↓).
 *
 * Spurnamen sind frei und werden nicht übersetzt. TRACK_NAMES schlägt die üblichen vor. "voice" wäre missverständlich:
 * So heißen in alphaTab die Stimmen eines Takts (bar.voices). Der Capo gilt für den ganzen Song; Akkorde sind
 * Griffnamen relativ zum Capo, nur die Noten klingen. Die Funktionen dieses Abschnitts brauchen kein DOM.
 */

/**
 * Vorgeschlagene Spurnamen (Auswahlliste im Editor, dazu die Namen aus der Bibliothek). "percussion" ist für
 * Perkussion: Klopfen auf die Gitarre, Händeklatschen usw., als Schlagzeugspur (\instrument percussion).
 */
export const TRACK_NAMES = ['strumming', 'picking', 'percussion', 'fingerstyle', 'vocal'];

/** Höchster Bund, der sich eingeben lässt und auf den der Capo-Abgleich und das Transponieren eine Note legen. */
export const MAX_FRET = 24;

/**
 * Name einer Spur zum Anzeigen.
 * @param {Track} track Spur
 * @returns {string} der Name aus den Noten, unübersetzt; ohne Namen "Spur 1", "Spur 2" …
 */
export function trackName(track){
  return track.name.trim() || `Spur ${track.index + 1}`;
}

/**
 * Ob ein Notensystem Saiten hat (Gitarre, Bass, Ukulele …): Nur dort gibt es Capo, Tuning, Tabs und Griffe. Gesang,
 * Klavier und Schlagzeug haben keine.
 * @param {?import('../../types/alphatab').model.Staff} [staff] Notensystem
 * @returns {boolean}
 */
export function hasStrings(staff){
  return !!staff?.isStringed && staff.tuning.length > 0;
}

/**
 * Alle Notensysteme mit Saiten, in der Reihenfolge der Spuren.
 * @param {import('../../types/alphatab').model.Score} score Noten
 * @returns {import('../../types/alphatab').model.Staff[]}
 */
export function stringedStaves(score){
  return score.tracks.flatMap(t => t.staves).filter(hasStrings);
}

/**
 * Notensysteme, für die das Tuning des Songs gilt. Eine Spur mit anderer Saitenzahl (Bass, Ukulele) kann nicht
 * dasselbe Tuning haben und zählt nicht mit.
 * @param {import('../../types/alphatab').model.Score} score Noten
 * @returns {import('../../types/alphatab').model.Staff[]} leer ohne Spur mit Saiten
 */
export function tuningStaves(score){
  const all = stringedStaves(score);
  const first = chordsTrack(score)?.staves.find(hasStrings) ?? all[0];
  return first ? [first, ...all.filter(st => st !== first && st.tuning.length === first.tuning.length)] : [];
}

/**
 * Ob das Tuning in allen Spuren von tuningStaves() gleich ist.
 * @param {import('../../types/alphatab').model.Score} score Noten
 * @returns {boolean}
 */
export function sameTuning(score){
  return new Set(tuningStaves(score).map(st => st.tuning.join(','))).size <= 1;
}

/**
 * Zählt die Schläge einer Spur, die eine Bedingung erfüllen.
 * @param {Track} track Spur
 * @param {function(Beat): boolean} test Bedingung
 * @returns {number} Anzahl
 */
export function countBeats(track, test){
  let n = 0;
  for(const staff of track.staves) for(const bar of staff.bars) for(const voice of bar.voices){
    for(const beat of voice.beats) if(test(beat)) n++;
  }
  return n;
}

/**
 * Ob ein Schlag eine Silbe hat.
 * @param {Beat} beat Schlag
 * @returns {boolean}
 */
export function hasLyrics(beat){
  return beat.lyrics?.some(s => s?.trim()) ?? false;
}

/**
 * Zeilenumbruch im Liedtext: steht am Ende der letzten Silbe einer Zeile (beat.lyrics), im alphaTex als "\n" in der
 * Silbe, z. B. lyrics "friend,\n". alphaTab zeichnet ihn nicht (Änderung in alphaTab.core.mjs, README "Setup").
 */
export const LYRICS_BREAK = '\n';

/**
 * Ob eine Silbe eine Zeile des Liedtexts beendet (LYRICS_BREAK am Ende).
 * @param {?string} syllable Silbe aus beat.lyrics
 * @returns {boolean}
 */
export function endsLyricsLine(syllable){
  return /\S\s*\n\s*$/.test(syllable ?? '');
}

/**
 * Spur, die die meisten Schläge mit einer Eigenschaft hat; bei Gleichstand die vordere.
 * @param {Score} score Noten
 * @param {function(Beat): boolean} test Eigenschaft
 * @returns {?Track} null, wenn keine Spur einen solchen Schlag hat
 */
function trackWithMost(score, test){
  let best = null;
  let bestCount = 0;
  for(const track of score.tracks){
    const n = countBeats(track, test);
    if(n > bestCount){ best = track; bestCount = n; }
  }
  return best;
}

/**
 * Ob ein Schlag einen Akkord hat.
 * @param {Beat} beat Schlag
 * @returns {boolean}
 */
export function hasChord(beat){
  return !!beat.chordId;
}

/**
 * Spur, die den Text trägt: die mit dem meisten Text. Normalerweise hat nur eine Spur Text (der Editor zieht ihn
 * beim Umstellen ganz um); in importierten Songs steht er oft mehrfach oder in einer anderen Spur als "Vocal".
 * @param {Score} score Noten
 * @returns {?Track} null, wenn der Song keinen Text hat
 */
export function lyricsTrack(score){
  return trackWithMost(score, hasLyrics);
}

/**
 * Spur, die die Akkorde trägt: die mit den meisten Akkorden (bei Gleichstand die vordere).
 * @param {Score} score Noten
 * @returns {?Track} null, wenn der Song keine Akkorde hat
 */
export function chordsTrack(score){
  return trackWithMost(score, hasChord);
}

/**
 * Ein Akkord des Songs mit seiner Lage, zusammengetragen aus allen Spuren (siehe mergeChords()).
 * @typedef {Object} MergedChord
 * @property {number} tick Anfang des Schlags in MIDI-Ticks (Takt einmal gespielt, ohne Wiederholungen)
 * @property {Chord} chord Akkord samt Griff, aus der Spur, die gewonnen hat
 * @property {Beat} beat Schlag, an dem er in dieser Spur steht
 */

/**
 * Trägt die Akkorde aller Spuren zusammen: je Stelle (Tick) ein Akkord. Steht an einer Stelle in mehreren Spuren
 * ein Akkord, gewinnt die Akkordspur (chordsTrack()), danach die Spuren in ihrer Reihenfolge. So schreibt der
 * Editor die Akkorde in die Akkordspur (moveContent() in notation.js); bis dahin zeigt der Player sie nach dieser
 * Regel einmal über den Noten.
 * @param {Score} score Noten
 * @param {?Track} [first] Spur, die gewinnt; ohne Angabe die Akkordspur (chordsTrack())
 * @returns {MergedChord[]} nach Tick sortiert
 */
export function mergeChords(score, first = chordsTrack(score)){
  const order = first ? [first, ...score.tracks.filter(t => t !== first)] : score.tracks;
  /** @type {Map<number, MergedChord>} */
  const merged = new Map();
  for(const track of order) for(const staff of track.staves) for(const bar of staff.bars){
    for(const voice of bar.voices) for(const beat of voice.beats){
      // Typ ausdrücklich: Map.get() aus den alphaTab-Typen liefert der IDE sonst "unknown".
      const chord = /** @type {?Chord} */ (beat.chordId ? staff.chords?.get(beat.chordId) ?? null : null);
      const tick = bar.masterBar.start + beat.playbackStart;
      if(chord && !merged.has(tick)) merged.set(tick, {tick, chord, beat});
    }
  }
  return [...merged.values()].sort((a, b) => a.tick - b.tick);
}

/**
 * Was "Akkorde bereinigen" ändern würde (ändert selbst nichts): Akkorde, die nur wiederholen, was schon klingt (gleicher
 * Name wie der Akkord davor, in allen Spuren), fallen weg, außer am Anfang eines Abschnitts. Dort soll das Blatt den
 * Akkord immer zeigen: Fehlt er, kommt der klingende hin (erst, wenn im Song schon ein Akkord stand).
 * @param {Score} score Noten
 * @returns {{repeated: Beat[], missing: {bar: number, name: string}[]}} repeated: Schläge (aller Spuren), deren
 *   Akkord wegfällt; missing: Takte am Abschnittsanfang ohne Akkord auf der Eins, mit dem Namen des klingenden
 */
export function chordCleanup(score){
  const merged = mergeChords(score);
  const atSectionStart = tick => score.masterBars.some(mb => mb.section && mb.start === tick);
  const ticks = new Set(merged.filter((m, i) => i > 0 && m.chord.name === merged[i - 1].chord.name
    && !atSectionStart(m.tick)).map(m => m.tick));
  /** @type {Beat[]} */
  const repeated = [];
  for(const track of score.tracks) for(const staff of track.staves) for(const bar of staff.bars){
    for(const voice of bar.voices) for(const beat of voice.beats){
      if(beat.chordId && ticks.has(bar.masterBar.start + beat.playbackStart)) repeated.push(beat);
    }
  }
  const starts = new Set(merged.map(m => m.tick));
  const missing = score.masterBars.filter(mb => mb.section && !starts.has(mb.start)).flatMap(mb => {
    const sounding = merged.findLast(m => m.tick < mb.start);
    return sounding ? [{bar: mb.index, name: sounding.chord.name}] : [];
  });
  return {repeated, missing};
}

/**
 * Leere Saite eines Notensystems.
 * @param {Staff} staff Notensystem
 * @param {number} string Saite wie in alphaTab (1 = tiefste)
 * @returns {number} MIDI-Tonhöhe
 */
export function openString(staff, string){
  return staff.tuning[staff.tuning.length - string];
}

/**
 * Setzt ein Notensystem auf einen anderen Capo, ohne dass sich der Klang ändert: Die Bünde verschieben sich um die
 * Differenz. Landet eine Note unter dem Capo oder zu hoch, kommt sie auf eine andere freie Saite; geht das auch
 * nicht (z. B. die leere tiefe E-Saite bei Capo 2), eine Oktave höher. Gebundene Noten folgen ihrer Ausgangsnote.
 * Akkordnamen werden mitverschoben (Griffnamen relativ zum neuen Capo), ihre Griffe gelten nur, solange sie
 * spielbar bleiben; die Griffbilder setzt danach normalizeChords().
 * @param {Staff} staff Notensystem mit Saiten, wird geändert
 * @param {number} capo neuer Capo
 * @returns {number} Anzahl der Noten, die eine Oktave höher gelegt wurden
 */
export function moveToCapo(staff, capo){
  const delta = staff.capo - capo;
  if(!delta) return 0;
  let octaves = 0;
  for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats){
    /** @type {Set<number>} */
    const used = new Set();
    const pending = [];
    for(const note of beat.notes){
      if(note.isTieDestination && note.tieOrigin){
        note.string = note.tieOrigin.string;
        note.fret = note.tieOrigin.fret;
        used.add(note.string);
      } else if(note.fret + delta >= 0 && note.fret + delta <= MAX_FRET && !used.has(note.string)){
        note.fret += delta;
        used.add(note.string);
      } else {
        pending.push(note);
      }
    }
    for(const note of pending){
      const pitch = openString(staff, note.string) + staff.capo + note.fret;
      let placed = false;
      for(let octave = 0; octave <= 24 && !placed; octave += 12){
        for(let string = 1; string <= staff.tuning.length && !placed; string++){
          const fret = pitch + octave - openString(staff, string) - capo;
          if(used.has(string) || fret < 0 || fret > MAX_FRET) continue;
          note.string = string;
          note.fret = fret;
          placed = true;
          if(octave) octaves++;
        }
      }
      used.add(note.string);
    }
  }
  for(const chord of staff.chords?.values() ?? []){
    chord.name = transposeChordName(chord.name, delta);
    const frets = chord.strings.map(f => f < 0 ? -1 : f + delta);
    chord.strings = frets.some(f => f < -1 || f > MAX_FRET) || frets.every(f => f < 0) ? [] : frets;
  }
  staff.capo = capo;
  return octaves;
}

// --------------------------------------------------------------------------------------------------------------------
// Noten lesen, wandeln und schreiben
// --------------------------------------------------------------------------------------------------------------------

/**
 * Notenformat des Gitarrenbuchs: Gespeichert wird alphaTex (score.atex), das Textformat von alphaTab. Hier
 * steckt alles, was zwischen alphaTex und Guitar Pro übersetzt: GP-Datei beim Import umwandeln und prüfen, Gerüst
 * für einen neuen Song anlegen, GP-Datei für den Download erzeugen, Eckdaten (Tonart, Capo, …) aus den Noten lesen.
 *
 * Titel, Interpret und die übrigen Angaben stehen nur in song.json. Im alphaTex fehlen sie; zum Anzeigen und beim
 * GP-Export werden sie ins Modell eingesetzt.
 */

/**
 * Ladevorgang des alphaTab-Moduls, null bis zum ersten Aufruf von loadAlphaTab().
 * @type {?Promise<AlphaTabModule>}
 */
let alphaTabPromise = null;

/**
 * Lädt das alphaTab-Modul (rund 1 MB) beim ersten Aufruf (Lazy Loading).
 * @returns {Promise<AlphaTabModule>} das Modul
 */
export function loadAlphaTab(){
  alphaTabPromise ??= import('../vendor/alphatab/alphaTab.mjs');
  return alphaTabPromise;
}

/** Dur-Tonarten nach Vorzeichen, Index = Anzahl Kreuze + 7 (wie bar.keySignature + 7). */
const MAJOR_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
/** Moll-Tonarten nach Vorzeichen, Index wie bei MAJOR_KEYS. */
const MINOR_KEYS = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'];

/**
 * Dur-Tonarten der Griffe je Tonhöhenklasse (Grundton mod 12), in der üblichen Schreibweise mit den wenigsten
 * Vorzeichen (Db statt C#, Bb statt A#).
 */
const SHAPE_MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Moll-Tonarten der Griffe je Tonhöhenklasse, wie bei SHAPE_MAJOR_KEYS (C#m statt Dbm, Bbm statt A#m). */
const SHAPE_MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

/** Standard-Tuning als MIDI-Noten, tiefe bis hohe Saite (E2 A2 D3 G3 B3 E4). */
const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

/** Notennamen je Tonhöhenklasse (MIDI-Note mod 12), wie alphaTex sie erwartet. */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Tonhöhenklasse je Notenname (ohne Oktave, Groß-/Kleinschreibung egal, H wie B). */
const PITCH_CLASSES = {
  C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10,
  BB: 10, B: 11, H: 11,
};

/** Anzahl der leeren Takte im Gerüst eines neuen Songs. */
const NEW_SCORE_BARS = 4;

/**
 * Weitere Angaben aus Guitar Pro, die als eigene Felder in song.json stehen: Feld in song.json => Eigenschaft im
 * Modell von alphaTab (Liste wie SONG_INFO_FIELDS in api/lib/crud.php).
 * @type {Object<string, string>}
 */
const INFO_FIELDS = {
  subtitle: 'subTitle', album: 'album', words: 'words', music: 'music', copyright: 'copyright', tab: 'tab',
  instructions: 'instructions',
};

/**
 * Eckdaten eines Songs, gelesen aus den Noten (erste Spur, die kein Schlagzeug ist, erster Takt).
 * @typedef {Object} ScoreInfo
 * @property {string} key Tonart, wie notiert (\ks), z. B. "A" oder "Em". Das ist die klingende Tonart: alphaTab
 *   notiert mit Capo klingend (die Saiten klingen um capo Halbtöne höher), wie Guitar Pro.
 * @property {number} capo Bund des Kapodasters, 0 ohne
 * @property {string} shapeKey Tonart der Griffe (key um capo Halbtöne tiefer, siehe shapeKey()); ohne Capo gleich
 *   key
 * @property {string} tuning Tuning von der tiefen zur hohen Saite, z. B. "E A D G B E"; leer ohne Saiten
 * @property {boolean} standardTuning ob es das Standard-Tuning ist, genau in dieser Lage (E2 bis E4 bei sechs
 *   Saiten); true ohne Saiten
 * @property {{name: string, changed: boolean}[]} tuningStrings Saiten von tief nach hoch: Ton ("D") und ob er von der
 *   Standard-Tuning abweicht; mit Oktave ("E3"), wenn sich nur die Oktaven unterscheiden
 * @property {number} tempo Anfangstempo in BPM
 * @property {number} tempoMin niedrigstes Tempo im Song (Anfangstempo und alle Tempowechsel), in BPM
 * @property {number} tempoMax höchstes Tempo im Song, in BPM
 * @property {?number} recordedTempo Anfangstempo, wie es in der Audiospur klingt (siehe recordingTempoRegion()),
 *   auf eine ganze Zahl gerundet; null ohne Sync-Punkte
 */

/**
 * Abschnitt ohne Tempowechsel mit dem Tempo der Audiospur.
 * @typedef {Object} TempoRegion
 * @property {number} start erster Takt des Abschnitts
 * @property {number} end erster Takt des nächsten Abschnitts (bzw. Anzahl der Takte)
 * @property {number} tempo notiertes Tempo
 * @property {number} factor Faktor, > 1: Die Audiospur ist schneller als notiert
 * @property {number} recorded Tempo in der Audiospur (ganzzahlig)
 */

/**
 * Tempo der Audiospur im Abschnitt ohne Tempowechsel um einen Takt: Faktor zwischen Audiospur und Noten, also
 * notierte Dauer geteilt durch die Dauer in der Audiospur, vom ersten bis zum letzten Sync-Punkt des Abschnitts. Die
 * Sync-Punkte dazwischen zählen nicht, so mitteln sich die natürlichen Schwankungen einer Audiospur heraus. Der
 * Abschnitt reicht vom letzten Tempowechsel bis zum nächsten (der Takt davor ist der letzte, sein Sync-Punkt gehört noch dazu).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {number} [bar] Takt im Abschnitt (0 = erster Abschnitt)
 * @returns {?TempoRegion} null mit weniger als zwei Sync-Punkten im Abschnitt
 */
export function recordingTempoRegion(alphaTab, score, bar = 0){
  if(!score.masterBars.some(mb => mb.syncPoints?.length)) return null;
  const bars = score.masterBars;
  let start = Math.min(Math.max(bar, 0), bars.length - 1);
  while(start > 0 && !bars[start].tempoAutomations.length) start--;
  let end = start + 1;
  while(end < bars.length && !bars[end].tempoAutomations.length) end++;
  const points = alphaTab.midi.MidiFileGenerator.generateSyncPoints(score)
    .filter(p => p.masterBarIndex >= start && p.masterBarIndex <= end).sort((a, b) => a.synthTick - b.synthTick);
  if(points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const recorded = last.syncTime - first.syncTime;
  const factor = recorded > 0 ? (last.synthTime - first.synthTime) / recorded : 0;
  if(!factor) return null;
  const tempo = tempoAt(score, start);
  return {start, end, tempo, factor, recorded: Math.round(tempo * factor)};
}

/**
 * Liest Tonart, Capo, Tuning und Tempo aus den Noten.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @returns {ScoreInfo}
 */
export function readScoreInfo(alphaTab, score){
  const track = score.tracks.find(t => !t.isPercussion) ?? score.tracks[0];
  const staff = track?.staves[0];
  const bar = staff?.bars[0];
  const keys = bar?.keySignatureType === alphaTab.model.KeySignatureType.Minor ? MINOR_KEYS : MAJOR_KEYS;
  // alphaTab führt die Saiten von der höchsten zur tiefsten, üblich ist die Schreibweise von tief nach hoch.
  const stringed = Boolean(staff?.isStringed && staff.tuning.length);
  /** @type {number[]} Tonhöhen der Saiten (MIDI), höchste zuerst; leer ohne Saiten */
  const pitches = stringed ? staff.tuning : [];
  const tuning = pitches.slice().reverse().map(p => alphaTab.model.Tuning.getTextForTuning(p, false)).join(' ');
  const preset = stringed ? alphaTab.model.Tuning.findTuning(pitches) : null;
  const tuningStrings = stringed ? compareTuning(alphaTab, pitches) : [];
  // Das Tempo steht immer in Vierteln: alphaTab rechnet beim GP-Import andere Bezugsnoten (Achtel, punktierte
  // Viertel, …) um, und alphaTex kennt nur Viertel.
  const tempos = [score.tempo, ...score.masterBars.flatMap(mb => mb.tempoAutomations.map(a => a.value))];
  const region = recordingTempoRegion(alphaTab, score);
  const key = bar ? (keys[bar.keySignature + 7] ?? '') : '';
  const capo = staff?.capo || 0;
  return {
    key,
    capo,
    shapeKey: shapeKey(key, capo),
    tuning,
    standardTuning: !stringed || Boolean(preset?.isStandard),
    tuningStrings,
    tempo: score.tempo,
    tempoMin: Math.min(...tempos),
    tempoMax: Math.max(...tempos),
    recordedTempo: region?.recorded ?? null,
  };
}

/**
 * Vergleicht ein Tuning mit dem Standard-Tuning für ebenso viele Saiten.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {number[]} tuning MIDI-Tonhöhen wie in alphaTab (höchste Saite zuerst)
 * @returns {{name: string, changed: boolean}[]} Saiten von tief nach hoch (siehe ScoreInfo.tuningStrings)
 */
export function compareTuning(alphaTab, tuning){
  const standard = alphaTab.model.Tuning.getDefaultTuningFor(tuning.length)?.tunings ?? [];
  const name = (p, octave) => alphaTab.model.Tuning.getTextForTuning(p, octave);
  // Nur die Oktaven anders (z. B. alles eine Oktave höher): Ohne Oktave sähe es wie das Standard-Tuning aus.
  const octaves = tuning.every((p, i) => standard[i] !== undefined && (p - standard[i]) % 12 === 0);
  return tuning.map((p, i) => ({name: name(p, octaves), changed: p !== standard[i]})).reverse();
}

/**
 * Tonart der Griffe mit Kapodaster: Jeder Bund hebt um einen Halbton, die Griffe liegen also um capo Halbtöne tiefer
 * als die klingende Tonart.
 * @param {string} key klingende (notierte) Tonart, z. B. "Db" oder "Bbm"
 * @param {number} capo Bund des Kapodasters, 0 ohne
 * @returns {string} z. B. "C" für Db mit Capo 1; ohne Capo oder bei unbekannter Tonart unverändert key
 */
export function shapeKey(key, capo){
  const minor = key.endsWith('m');
  const pitchClass = PITCH_CLASSES[(minor ? key.slice(0, -1) : key).toUpperCase()];
  if(!capo || pitchClass === undefined) return key;
  return (minor ? SHAPE_MINOR_KEYS : SHAPE_MAJOR_KEYS)[((pitchClass - capo) % 12 + 12) % 12];
}

/**
 * Eckdaten eines Songs für den Kopf der Liedansicht als eine Zeile ("Tonart G · 140 BPM · Capo 3 · DADGBE"; das Tuning
 * nur, wenn es nicht EADGBE ist).
 * @param {ScoreInfo} info Eckdaten aus den Noten
 * @returns {string[]} Teile der Zeile als HTML
 */
export function describeScoreInfo(info){
  const min = Math.round(info.tempoMin);
  const max = Math.round(info.tempoMax);
  return [
    info.key && escapeHtml(`Tonart ${info.key}`),
    info.tempo ? (min === max ? `${min} BPM` : `${min}–${max} BPM`) : null,
    ...capoTuningParts(info),
  ].filter(Boolean);
}

/**
 * Capo und Tuning für die Zeile mit den Eckdaten (Player-Kopf und Leiste des Bearbeitungsmodus).
 * @param {ScoreInfo} info Eckdaten (readScoreInfo())
 * @returns {string[]} HTML; leer ohne Capo und im Standard-Tuning: Den Capo übersieht man leicht, deshalb fett; das Tuning
 *   steht ohne Leerzeichen ("DADGBE", abweichende Saiten fett) nur, wenn es nicht das Standard-Tuning (EADGBE) ist
 */
export function capoTuningParts(info){
  return [
    info.capo ? `<strong>Capo ${info.capo}</strong>` : null,
    info.tuningStrings.some(s => s.changed) ? info.tuningStrings.map(s => {
      // Ohne Oktave ("E2" → "E"): In der Zeile zählt, wie die Saiten heißen.
      const name = escapeHtml(s.name.replace(/\d+$/, ''));
      return s.changed ? `<strong>${name}</strong>` : name;
    }).join('') : null,
  ].filter(Boolean);
}

/**
 * Spieldauer der Noten im eigenen Tempo, mit Wiederholungen und Tempowechseln, ohne Sync-Punkte.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @returns {number} Millisekunden
 */
export function scoreDuration(alphaTab, score){
  // Mit createNew = true setzt alphaTab einen Sync-Punkt an Anfang und Ende und rechnet nur nach dem Tempo.
  return alphaTab.midi.MidiFileGenerator.generateSyncPoints(score, true).at(-1)?.synthTime ?? 0;
}

/**
 * Lautstärke jeder Spur (playbackInfo.volume von alphaTab, 0–16, in alphaTex `volume`). Wie laut etwas klingt, regelt
 * allein der Mixer; bei gleicher Einstellung klingen alle Songs und Spuren gleich laut (normalizeLevels()).
 */
export const TRACK_VOLUME = 12;

/** Panorama jeder Spur (playbackInfo.balance von alphaTab, 0–16, in alphaTex `balance`): Mitte. */
export const TRACK_BALANCE = 8;

/**
 * Gleiche Lautstärke für alle: jede Spur TRACK_VOLUME und TRACK_BALANCE, jeder Schlag die Dynamik forte (die Vorgabe von
 * alphaTab für neue Schläge, in alphaTex `dy f`); Lautstärke- und Panorama-Automationen fallen weg. Akzente und Ghost
 * Notes bleiben, sie gehören zur Spielweise. Dynamikzeichen werden ohnehin nicht gezeigt (HIDDEN_SCORE_ELEMENTS in
 * playback.js, HIDDEN_ELEMENTS in sheet.js).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @returns {void}
 */
export function normalizeLevels(alphaTab, score){
  const {AutomationType, DynamicValue} = alphaTab.model;
  const levels = [AutomationType.Volume, AutomationType.Balance];
  for(const track of score.tracks){
    track.playbackInfo.volume = TRACK_VOLUME;
    track.playbackInfo.balance = TRACK_BALANCE;
    for(const staff of track.staves) for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats){
      beat.dynamics = DynamicValue.F;
      if(beat.automations.some(a => levels.includes(a.type))){
        beat.automations = beat.automations.filter(a => !levels.includes(a.type));
      }
    }
  }
}

/**
 * Liest alphaTex in ein Modell von alphaTab, mit gleicher Lautstärke für alle (normalizeLevels()).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {string} tex Inhalt von score.atex
 * @param {*} [settings] Einstellungen von alphaTab (z. B. die der Notenansicht)
 * @returns {Score} Noten
 */
export function parseScore(alphaTab, tex, settings){
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex, settings);
  normalizeLevels(alphaTab, score);
  return score;
}

/**
 * Schreibt ein Modell als alphaTex, ungeprüft (der Bearbeitungsmodus nach jeder Änderung; gespeichert wird mit
 * writeScoreChecked()).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @returns {string} alphaTex
 */
export function writeScore(alphaTab, score){
  return new alphaTab.exporter.AlphaTexExporter().exportToString(score, new alphaTab.Settings());
}

/** Höchstens so viele Takte nennt describeScoreLoss(), danach "…". */
const LOSS_BARS_SHOWN = 10;

/**
 * Takte, in denen beim Schreiben als alphaTex etwas verloren ging (siehe exportScore()).
 * @typedef {Object} ScoreLoss
 * @property {number[]} bars betroffene Takte, ab 1 gezählt, aufsteigend
 */

/**
 * Takt einer Zeile aus fingerprint().
 * @param {string} line Zeile ("<Spur> <Takt> …" bzw. "T<Takt> …")
 * @returns {number} Takt ab 0
 */
function fingerprintBar(line){
  return line.startsWith('T') ? Number(line.slice(1).split(' ')[0]) : Number(line.split(' ')[1]);
}

/**
 * Fasst die Zeilen aus fingerprint() je Takt zusammen.
 * @param {string[]} lines Zeilen
 * @returns {Map<number, string>} Takt ab 0 → seine Zeilen
 */
function fingerprintByBar(lines){
  /** @type {Map<number, string>} */
  const bars = new Map();
  for(const line of lines){
    const bar = fingerprintBar(line);
    bars.set(bar, (bars.get(bar) ?? '') + line + '\n');
  }
  return bars;
}

/**
 * Schreibt ein Modell als alphaTex und prüft das Ergebnis: Es wird wieder eingelesen und Takt für Takt mit dem Modell
 * verglichen (siehe fingerprint()).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @returns {{tex: string, loss: ?ScoreLoss}} alphaTex; loss null, wenn nichts verloren ging
 * @throws {Error} wenn alphaTab das Ergebnis nicht lesen kann
 */
export function exportScore(alphaTab, score){
  // Der Exporter schreibt "\staff { score tabs }" auch für die Vorgabe; die Angabe braucht es nicht.
  const tex = writeScore(alphaTab, score).replace(/^( *\\staff) \{\n(?: *\S.*\n)*? *}\n/gm, '$1\n');
  let actual;
  try {
    actual = fingerprintByBar(fingerprint(parseScore(alphaTab, tex)));
  } catch(err){
    throw new Error('Die Noten lassen sich nicht übernehmen: alphaTab kann das Ergebnis nicht lesen.');
  }
  const expected = fingerprintByBar(fingerprint(score));
  const bars = [...new Set([...expected.keys(), ...actual.keys()])]
    .filter(bar => expected.get(bar) !== actual.get(bar))
    .sort((a, b) => a - b)
    .map(bar => bar + 1);
  return {tex, loss: bars.length ? {bars} : null};
}

/**
 * Beschreibt einen Verlust beim Schreiben für den Benutzer.
 * @param {ScoreLoss} loss Verlust
 * @returns {string} z. B. "Abweichungen in 2 Takten (Takt 12, 30)."
 */
export function describeScoreLoss(loss){
  const shown = loss.bars.slice(0, LOSS_BARS_SHOWN).join(', ') + (loss.bars.length > LOSS_BARS_SHOWN ? ', …' : '');
  return `Abweichungen in ${loss.bars.length === 1 ? '1 Takt' : `${loss.bars.length} Takten`} (Takt ${shown}).`;
}

/**
 * Schreibt ein Modell als alphaTex und lässt nur ein verlustfreies Ergebnis zu (siehe exportScore()). Für den Editor,
 * der das ganze alphaTex neu schreibt.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @returns {string} alphaTex
 * @throws {Error} wenn dabei etwas verloren geht oder alphaTab das Ergebnis nicht lesen kann
 */
export function writeScoreChecked(alphaTab, score){
  const {tex, loss} = exportScore(alphaTab, score);
  if(loss) throw new Error('Die Noten lassen sich nicht verlustfrei schreiben. ' + describeScoreLoss(loss));
  return tex;
}

/**
 * Name einer Tonart.
 * @param {number} keySignature Vorzeichen: Kreuze positiv, Bes negativ (wie bar.keySignature)
 * @param {boolean} minor Moll
 * @returns {string} z. B. "A", "F#m"; leer außerhalb von -7 bis 7
 */
export function keyName(keySignature, minor){
  return (minor ? MINOR_KEYS : MAJOR_KEYS)[keySignature + 7] ?? '';
}

/** Alle Tonarten für die Auswahl: Dur von Cb bis C#, dann Moll von Abm bis A#m. */
export const KEY_NAMES = [false, true].flatMap(minor => Array.from({length: 15}, (_, i) => keyName(i - 7, minor)));

/**
 * Triolen-Feeling wie in Guitar Pro, in der Reihenfolge von alphaTab (TripletFeel): Wert → Name.
 * @type {string[]}
 */
export const TRIPLET_FEELS = ['kein', 'Sechzehntel-Triolen', 'Achtel-Triolen (Shuffle)', 'punktierte Sechzehntel',
  'punktierte Achtel', 'Scottish Sechzehntel', 'Scottish Achtel'];

/**
 * Fingerabdruck des musikalischen Inhalts, um die Umwandlung nach alphaTex zu prüfen: je Schlag mit Inhalt Dauer,
 * Akkord, Text, Silben und je Note Bund, Saite und die wichtigsten Effekte; dazu Abschnitte, Tempowechsel und
 * Sync-Punkte. Leere Stimmen und ganz leere Takte am Ende zählen nicht (alphaTex lässt beides weg).
 * @param {Score} score Noten
 * @returns {string[]} eine Zeile je Eintrag
 */
function fingerprint(score){
  const lines = [];
  /** Index des letzten Takts mit Inhalt (Noten, Pausen, Abschnitt, Tempowechsel oder Sync-Punkt). */
  let lastBar = -1;
  for(const [ti, track] of score.tracks.entries()) for(const staff of track.staves) for(const bar of staff.bars){
    for(const [vi, voice] of bar.voices.entries()){
      if(voice.isEmpty) continue;
      lastBar = Math.max(lastBar, bar.index);
      for(const beat of voice.beats){
        const notes = beat.notes.map(n => [
          n.fret, n.string, n.isTieDestination, n.slideOutType, n.hasBend, n.vibrato, n.isDead, n.isGhost,
          n.harmonicType, n.isHammerPullOrigin, n.isPalmMute,
        ].join(',')).join(';');
        lines.push([ti, bar.index, vi, beat.duration, beat.dots, beat.isRest, beat.chordId ? beat.chord?.name : '',
          beat.text ?? '', (beat.lyrics ?? []).join('|'), notes].join(' '));
      }
    }
  }
  for(const mb of score.masterBars){
    if(mb.section || mb.tempoAutomations.length || mb.syncPoints?.length) lastBar = Math.max(lastBar, mb.index);
  }
  for(const mb of score.masterBars.slice(0, lastBar + 1)){
    lines.push(`T${mb.index} ${mb.section?.text ?? ''} ${mb.tempoAutomations.map(a => a.value).join(',')}`
      + ` ${(mb.syncPoints ?? []).map(p => Math.round(p.syncPointValue.millisecondOffset)).join(',')}`);
  }
  return lines;
}

/**
 * Sortiert Sync-Punkte wie alphaTab: nach Takt, Wiederholung und Position im Takt.
 * @param {FlatSyncPoint[]} points Sync-Punkte (werden nicht verändert)
 * @returns {FlatSyncPoint[]} sortierte Kopie
 */
export function sortSyncPoints(points){
  return points.slice().sort((a, b) =>
    a.barIndex - b.barIndex || a.barOccurence - b.barOccurence || a.barPosition - b.barPosition);
}

/** alphaTab: MIDI-Ticks pro Viertelnote. */
export const QUARTER_TICKS = 960;

/**
 * Sync-Punkte der Noten so, wie die Wiedergabe sie braucht: je Abschnitt Startposition (MIDI-Tick) mit notiertem
 * Tempo (synthBpm) und Tempo der Audiospur (syncBpm). alphaTab fügt an jedem Tempowechsel einen Punkt ein.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @returns {BackingTrackSyncPoint[]} aufsteigend nach Tick; leer, wenn die Noten keine Sync-Punkte haben
 */
export function playbackSyncPoints(alphaTab, score){
  if(!score.masterBars.some(mb => mb.syncPoints?.length)) return [];
  const points = alphaTab.midi.MidiFileGenerator.generateSyncPoints(score).sort((a, b) => a.synthTick - b.synthTick);
  for(const [i, p] of points.entries()){
    const next = points[i + 1];
    // Das Tempo aus Ticks und Zeit bis zum nächsten Punkt: Das von alphaTab weicht leicht ab (bei "Geiler is schon"
    // kam der Synth so 13 ms zu spät am nächsten Sync-Punkt an, die Audiospur sprang dort hörbar).
    if(next && next.syncTime > p.syncTime && next.synthTick > p.synthTick){
      p.syncBpm = (next.synthTick - p.synthTick) / QUARTER_TICKS * 60000 / (next.syncTime - p.syncTime);
    }
    // Der letzte Sync-Punkt (Ende der Noten) hat kein Tempo mehr: das des vorigen Abschnitts weiterverwenden.
    else if(i > 0 && !next) p.syncBpm = points[i - 1].syncBpm;
  }
  return points;
}

/**
 * Sync-Punkt am Anfang des Abschnitts, in dem ein Tick liegt (vor dem ersten Sync-Punkt: der erste).
 * @param {BackingTrackSyncPoint[]} points Sync-Punkte aus playbackSyncPoints()
 * @param {number} tick MIDI-Tick
 * @returns {?BackingTrackSyncPoint} null ohne Sync-Punkte
 */
export function syncSegmentAt(points, tick){
  let sp = points[0] ?? null;
  for(const p of points){
    if(p.synthTick <= tick) sp = p;
    else break;
  }
  return sp;
}

/**
 * Faktor, um den die Audiospur an einer Stelle schneller ist als notiert.
 * @param {BackingTrackSyncPoint[]} points Sync-Punkte aus playbackSyncPoints()
 * @param {number} tick MIDI-Tick
 * @returns {number} Tempo der Audiospur geteilt durch das notierte Tempo; 1 ohne Sync-Punkte
 */
export function recordingTempoAt(points, tick){
  const sp = syncSegmentAt(points, tick);
  return sp && sp.synthBpm > 0 && sp.syncBpm > 0 ? sp.syncBpm / sp.synthBpm : 1;
}

/**
 * Schreibt das Tempo der Audiospur in das MIDI des Synths (Ereignis midiLoad von alphaTab, vor dem Laden in den
 * Synth). So folgt der Synth der Audiospur von selbst, und das Abspieltempo von alphaTab muss sich während der
 * Wiedergabe nicht ändern: Jede Änderung setzt den Synth neu an die Position, das ist als Aussetzer hörbar.
 * Zwischen erstem und letztem Sync-Punkt ersetzt je Abschnitt eine Tempoangabe mit dem Tempo der Audiospur die
 * notierten; davor und danach werden die notierten mit dem Faktor des ersten bzw. letzten Abschnitts multipliziert.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {MidiFile} midi MIDI von alphaTab (wird verändert)
 * @param {BackingTrackSyncPoint[]} points Sync-Punkte aus playbackSyncPoints()
 * @returns {void}
 */
export function applyRecordingTempo(alphaTab, midi, points){
  if(!points.length) return;
  const tempoType = alphaTab.midi.MidiEventType.TempoChange;
  const first = points[0].synthTick;
  const last = points[points.length - 1].synthTick;
  for(const track of midi.tracks){
    // events ist schreibgeschützt (readonly): die Liste an Ort und Stelle ersetzen.
    const kept = track.events.filter(e => {
      if(e.type !== tempoType) return true;
      const tick = e.tick - midi.tickShift;
      if(tick >= first && tick < last) return false;
      const tempo = /** @type {TempoChangeEvent} */ (e);
      tempo.beatsPerMinute *= recordingTempoAt(points, tick);
      return true;
    });
    track.events.length = 0;
    for(const e of kept) track.events.push(e);
  }
  for(const p of points.slice(0, -1)){
    const tempo = new alphaTab.midi.TempoChangeEvent(p.synthTick + midi.tickShift, 0);
    tempo.beatsPerMinute = p.syncBpm;
    midi.tracks[0].addEvent(tempo);
  }
}

/**
 * Bereinigt Noten aus Guitar Pro für das Gitarrenbuch, automatisch und ohne Rückfrage: je Spur und Akkordname ein
 * Griffbild aus dem Katalog (siehe normalizeChords()), keine Rhythmus-Schrägstriche (alphaTab 1.8.4 stürzt bei
 * nur Tabs daran ab, ganze Takte bleiben leer) und keine Anzeige-Angaben je Spur (Noten, Tabs, Schrägstriche wählt
 * der Player); als Name des Tunings nur das Tuning selbst (GP-Dateien haben dort oft Notizen wie "Key: C (orig.
 * D)"); kein Systemtrenner (die schrägen Doppelstriche zwischen den Notenzeilen); doppelte Taktstriche nur vor
 * Abschnitten (applySectionBars()); nur einfache Betonungen (eine starke wird zur einfachen). Alles andere bleibt wie in der
 * Datei: Tonart und Vorzeichen, Spurnamen, Capo je Spur. Was von der Konvention abweicht (ein Capo, Akkorde und Text
 * in einer Spur …), löst danach resolveConflicts() in conflicts.js.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @param {ChordLibrary} library Akkordkatalog
 * @returns {void}
 */
function cleanImportedScore(alphaTab, score, library){
  normalizeChords(alphaTab, score, library);
  applySectionBars(alphaTab, score);
  if(score.stylesheet) score.stylesheet.useSystemSignSeparator = false;
  for(const track of score.tracks) for(const staff of track.staves){
    staff.showStandardNotation = true;
    staff.showTablature = staff.isStringed;
    staff.showSlash = false;
    staff.showNumbered = false;
    // Name des bekannten Tunings zu den Tonhöhen ("Guitar Standard Tuning"), sonst keiner.
    if(staff.stringTuning) staff.stringTuning.name = alphaTab.model.Tuning.findTuning(staff.tuning)?.name ?? '';
    for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats){
      beat.slashed = false;
      // Nur eine Art Betonung: eine starke wird zur einfachen.
      for(const note of beat.notes){
        if(note.accentuated === alphaTab.model.AccentuationType.Heavy) note.accentuated = alphaTab.model.AccentuationType.Normal;
      }
    }
  }
}

/**
 * Liest eine GP-Datei für den Import: Die Angaben (Titel, Interpret, Beschreibung usw.) kommen nach song.json,
 * die Noten werden ohne diese Angaben zu alphaTex, bereinigt mit cleanImportedScore() und ohne Konflikte
 * (resolveConflicts() in conflicts.js, ohne Rückfrage). Geht beim Umwandeln etwas verloren, meldet das Ergebnis die
 * betroffenen Takte (siehe exportScore()); ob trotzdem übernommen wird, entscheidet der Benutzer. Die Audiospur löst der
 * Server aus der Originaldatei, ihre Sync-Punkte stehen im alphaTex.
 * @param {File} file Guitar-Pro-Datei (GP3 bis GP8)
 * @returns {Promise<{meta: Object<string, string>, tex: string, loss: ?ScoreLoss, changes: import('./conflicts.js').Change[],
 *   lyrics: import('./conflicts.js').LeftoverLyrics[]}>} Angaben (title, artist, die Felder aus INFO_FIELDS, notes;
 *   leere Texte, wenn die Datei sie nicht enthält), Noten als alphaTex, was beim Umwandeln verloren ging (null: nichts),
 *   was der Konfliktlöser geändert hat und nicht übernommener Liedtext (für Chord-Dateien im Upload-Ordner)
 * @throws {Error} wenn die Datei nicht lesbar ist oder alphaTab das Ergebnis nicht lesen kann
 */
export async function readGpFile(file){
  const alphaTab = await loadAlphaTab();
  /** @type {Score} */
  let score;
  try {
    score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(await file.arrayBuffer()));
  } catch(err){
    throw new Error('Die Datei konnte nicht als Guitar-Pro-Datei gelesen werden.');
  }
  const meta = {
    title: score.title.trim(),
    artist: score.artist.trim(),
    ...Object.fromEntries(Object.entries(INFO_FIELDS).map(([field, prop]) => [field, score[prop].trim()])),
    notes: score.notices.trim(),
  };
  for(const prop of ['title', 'artist', 'notices', ...Object.values(INFO_FIELDS)]) score[prop] = '';
  // Ohne Katalog (Netzfehler) behalten die Akkorde ihren eigenen meistgenutzten Griff.
  const library = await loadChordLibraryOrEmpty();
  cleanImportedScore(alphaTab, score, library);
  const resolved = resolveConflicts(alphaTab, writeScore(alphaTab, score), library);
  return {meta, changes: resolved.changes, lyrics: resolved.lyrics,
    ...exportScore(alphaTab, parseScore(alphaTab, resolved.tex))};
}

/**
 * Begrenzt eine Zahl aus dem Formular auf einen Bereich.
 * @param {*} value Eingabe
 * @param {number} min kleinster Wert
 * @param {number} max größter Wert
 * @param {number} fallback Wert bei leerer oder ungültiger Eingabe
 * @returns {number} ganze Zahl
 */
function clampInt(value, min, max, fallback){
  const n = Math.round(Number(value));
  return Number.isFinite(n) && String(value).trim() !== '' ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Liest ein Tuning wie "D A D G B E" (tiefe bis hohe Saite, ohne Oktave). Die Oktave jeder Saite ist die, die der
 * Standard-Tuning am nächsten liegt.
 * @param {?string} tuning Tuning, ein Ton je Saite
 * @param {number[]} [standard] Standard-Tuning als MIDI-Tonhöhen, tiefste Saite zuerst (bei sechs Saiten E A D G B E)
 * @returns {?number[]} MIDI-Tonhöhen, tiefste Saite zuerst; null, wenn es nicht so viele gültige Töne sind wie standard
 */
export function parseTuningText(tuning, standard = STANDARD_TUNING){
  const notes = (tuning ?? '').trim().split(/\s+/);
  if(notes.length !== standard.length || notes.some(n => PITCH_CLASSES[n.toUpperCase()] === undefined)){
    return null;
  }
  return notes.map((n, i) => {
    const below = (standard[i] - PITCH_CLASSES[n.toUpperCase()]) % 12;
    return standard[i] - below + (below > 6 ? 12 : 0);
  });
}

/**
 * Bringt die Eingabe eines Tuning-Felds in die Form "D A D G B E": Großbuchstaben, Töne durch Leerzeichen getrennt
 * (fehlen sie, wird jedes Zeichen ein Ton, mit # für Kreuz), zu viele Töne fallen weg, fehlende und ungültige werden
 * durch die der Standard-Stimmung ersetzt. Eingabe leer oder "Standard" ergibt die Standard-Stimmung.
 * @param {?string} text Eingabe
 * @param {string[]} standard Töne der Standard-Stimmung von tief nach hoch, z. B. ["E", "A", "D", "G", "B", "E"]
 * @returns {string} genau so viele Töne wie standard, mit Leerzeichen getrennt, Kreuze statt Bs
 */
export function normalizeTuningText(text, standard){
  const raw = (text ?? '').trim().toUpperCase();
  const tokens = raw === 'STANDARD' ? [] : /\s/.test(raw) ? raw.split(/\s+/) : raw.match(/[A-H]#?|./g) ?? [];
  return standard.map((name, i) => {
    const pitchClass = PITCH_CLASSES[tokens[i]];
    return pitchClass === undefined ? name : NOTE_NAMES[pitchClass];
  }).join(' ');
}

/**
 * Wandelt ein Tuning wie "D A D G B E" (tiefe bis hohe Saite, ohne Oktave) in die Schreibweise von alphaTex um
 * (siehe parseTuningText()). Alles außer sechs gültigen Tönen ergibt das Standard-Tuning.
 * @param {?string} tuning Tuning aus dem Formular
 * @returns {string} hohe bis tiefe Saite mit Oktave, z. B. "E4 B3 G3 D3 A2 D2"
 */
function tuningToAlphaTex(tuning){
  const midi = parseTuningText(tuning) ?? STANDARD_TUNING;
  return midi.slice().reverse().map(m => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1)).join(' ');
}

/**
 * Erzeugt die Noten für einen manuell angelegten Song (jeder Song hat Noten): eine Gitarrenspur (Instrument
 * Akustikgitarre, docs/Instrumente.md) mit NEW_SCORE_BARS
 * leeren Takten, dazu Tempo, Tuning, Kapodaster und Tonart aus dem Formular.
 * @param {{tempo?: (number|string), tuning?: string, capo?: (number|string), key?: string}} music Angaben aus dem
 *   Formular; leer oder ungültig ergibt Tempo 120, Standard-Tuning, ohne Capo und C-Dur
 * @returns {Promise<string>} alphaTex
 */
export async function createScore(music){
  const alphaTab = await loadAlphaTab();
  const capo = clampInt(music.capo, 0, 24, 0);
  const tex = `\\tempo ${clampInt(music.tempo, 1, 400, 120)}\n\\track "Gitarre"\n`
    + `\\tuning (${tuningToAlphaTex(music.tuning)})\n` + (capo ? `\\capo ${capo}\n` : '')
    + Array(NEW_SCORE_BARS).fill('r.1').join(' | ');
  const score = parseScore(alphaTab, tex);
  setInstrument(alphaTab, score.tracks[0], instrumentByKey('guitar'));
  // Tonart direkt im Modell setzen: Der Exporter schreibt sie dann in der Form, die alphaTex selbst erwartet.
  const key = (music.key ?? '').trim();
  const isMinor = MINOR_KEYS.includes(key);
  const keyIndex = (isMinor ? MINOR_KEYS : MAJOR_KEYS).indexOf(key);
  if(keyIndex >= 0){
    for(const track of score.tracks) for(const staff of track.staves) for(const bar of staff.bars){
      bar.keySignature = keyIndex - 7;
      bar.keySignatureType = isMinor ? alphaTab.model.KeySignatureType.Minor : alphaTab.model.KeySignatureType.Major;
    }
  }
  return writeScore(alphaTab, score);
}

/**
 * Setzt Titel und Interpret aus song.json ins Modell (im alphaTex stehen sie nicht).
 * @param {Score} score Noten
 * @param {import('./base.js').Song} song Song
 * @returns {void}
 */
export function applySongMeta(score, song){
  score.title = song.title;
  score.artist = song.artist ?? '';
}

/**
 * Erzeugt eine vollständige Guitar-Pro-Datei für den Download: Noten aus alphaTex, Titel, Interpret, Beschreibung
 * (notes) und die weiteren Angaben aus song.json, dazu die Audiospur mit den Sync-Punkten. Geschrieben wird das
 * aktuelle .gp-Format (Guitar Pro 7 und 8).
 * @param {import('./base.js').Song} song Song
 * @param {string} tex Inhalt von score.atex
 * @param {?Uint8Array} audio Inhalt von audio.mp3, null ohne Audiospur
 * @returns {Promise<File>} GP-Datei, benannt "Interpret - Titel.gp"
 */
export async function exportGpFile(song, tex, audio){
  const alphaTab = await loadAlphaTab();
  const score = parseScore(alphaTab, tex);
  applySongMeta(score, song);
  score.notices = song.notes ?? '';
  for(const [field, prop] of Object.entries(INFO_FIELDS)) score[prop] = song[field] ?? '';
  if(audio){
    const backingTrack = new alphaTab.model.BackingTrack();
    backingTrack.rawAudioFile = audio;
    score.backingTrack = backingTrack;
  }
  const bytes = new alphaTab.exporter.Gp7Exporter().export(score);
  const name = [song.artist, song.title].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]/g, '') || 'Song';
  return new File([bytes], `${name}.gp`, {type: 'application/octet-stream'});
}

// --------------------------------------------------------------------------------------------------------------------
// Noten ändern
// --------------------------------------------------------------------------------------------------------------------

/**
 * Bearbeitungsschritte am Modell von alphaTab für den Bearbeitungsmodus (editor.js): Bünde setzen und löschen,
 * Dauer, Pausen, Haltebögen, Effekte, Schläge und Takte einfügen und löschen. Jede Funktion ändert nur das Modell;
 * danach schreibt der Editor es als alphaTex und liest es neu ein (so stimmen alle abgeleiteten Werte wie Indizes,
 * Verkettungen und Abspielzeiten wieder). Ohne DOM.
 *
 * Saiten zählen wie in alphaTab: 1 = tiefste Saite. Bearbeitet wird nur die erste Stimme eines Takts (mehrstimmige
 * Songs gibt es nicht, siehe docs/Editor.md).
 */

/** Notenwerte von lang nach kurz, wie alphaTab sie zählt (1 = Ganze, 32 = Zweiunddreißigstel). */
export const DURATIONS = [1, 2, 4, 8, 16, 32];

/**
 * Position des Cursors: Spur, Takt, Schlag (in der ersten Stimme) und Saite. Alles als Index bzw. Nummer, damit sie
 * das Neueinlesen nach jeder Änderung übersteht.
 * @typedef {Object} EditPosition
 * @property {number} track Index der Spur
 * @property {number} bar Index des Takts
 * @property {number} beat Index des Schlags in der ersten Stimme
 * @property {number} string Saite (1 = tiefste)
 */

/**
 * Notensystem einer Spur, das bearbeitet wird (das erste).
 * @param {Score} score Noten
 * @param {number} track Index der Spur
 * @returns {?Staff}
 */
export function editStaff(score, track){
  return score.tracks[track]?.staves[0] ?? null;
}

/**
 * Schlag an einer Position.
 * @param {Score} score Noten
 * @param {EditPosition} pos Position
 * @returns {?Beat} null, wenn es ihn nicht gibt
 */
export function beatAt(score, pos){
  return editStaff(score, pos.track)?.bars[pos.bar]?.voices[0]?.beats[pos.beat] ?? null;
}

/**
 * Note eines Schlags auf einer Saite.
 * @param {Beat} beat Schlag
 * @param {number} string Saite
 * @returns {?Note}
 */
export function noteOn(beat, string){
  return beat.notes.find(n => n.string === string) ?? null;
}

/**
 * Bringt eine Position in gültige Grenzen (z. B. nach dem Löschen eines Takts).
 * @param {Score} score Noten
 * @param {EditPosition} pos Position
 * @returns {EditPosition} gültige Position
 */
export function clampPosition(score, pos){
  const staff = editStaff(score, pos.track) ?? editStaff(score, 0);
  const track = staff.track.index;
  const bar = Math.max(0, Math.min(pos.bar, staff.bars.length - 1));
  const beats = staff.bars[bar].voices[0]?.beats.length ?? 1;
  const beat = Math.max(0, Math.min(pos.beat, beats - 1));
  const strings = staff.tuning.length || 1;
  const string = Math.max(1, Math.min(pos.string, strings));
  return {track, bar, beat, string};
}

/**
 * Nächster bzw. voriger Schlag, über Taktgrenzen hinweg.
 * @param {Score} score Noten
 * @param {EditPosition} pos Position
 * @param {number} step +1 oder -1
 * @returns {EditPosition} neue Position (am Anfang bzw. Ende bleibt sie stehen)
 */
export function stepBeat(score, pos, step){
  const staff = editStaff(score, pos.track);
  let {bar, beat} = pos;
  beat += step;
  if(beat < 0){
    if(bar === 0) return pos;
    bar--;
    beat = staff.bars[bar].voices[0].beats.length - 1;
  } else if(beat >= staff.bars[bar].voices[0].beats.length){
    if(bar === staff.bars.length - 1) return pos;
    bar++;
    beat = 0;
  }
  return {...pos, bar, beat};
}

/**
 * Setzt den Bund auf einer Saite: ändert die Note dort oder legt sie an. Aus einer Pause wird dabei eine Note; ein
 * Haltebogen zur Note fällt weg, weil sie jetzt anders klingt.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Beat} beat Schlag
 * @param {number} string Saite
 * @param {number} fret Bund
 * @returns {void}
 */
export function setFret(alphaTab, beat, string, fret){
  let note = noteOn(beat, string);
  if(!note){
    note = new alphaTab.model.Note();
    note.string = string;
    beat.addNote(note);
  }
  note.fret = fret;
  note.isTieDestination = false;
  // Leere Takte (aus Guitar Pro oder neu eingefügt) haben eine leere Stimme, die der Exporter übergeht; finish()
  // berechnet das neu.
  if(beat.isEmpty || beat.voice.isEmpty){
    beat.isEmpty = false;
    beat.voice.bar.finish(new alphaTab.Settings());
  }
}

/**
 * Löscht die Note auf einer Saite; war es die letzte, wird der Schlag zur Pause.
 * @param {Beat} beat Schlag
 * @param {number} string Saite
 * @returns {boolean} ob es dort eine Note gab
 */
export function deleteNote(beat, string){
  const note = noteOn(beat, string);
  if(note) beat.removeNote(note);
  return !!note;
}

/**
 * Macht einen Schlag zur Pause (alle Noten weg). Eine Pause bleibt Pause.
 * @param {Beat} beat Schlag
 * @returns {void}
 */
export function makeRest(beat){
  for(const note of [...beat.notes]) beat.removeNote(note);
}

/**
 * Setzt die Dauer eines Schlags.
 * @param {Beat} beat Schlag
 * @param {number} duration Notenwert (siehe DURATIONS)
 * @returns {void}
 */
export function setDuration(beat, duration){
  beat.duration = duration;
}

/**
 * Verlängert bzw. verkürzt einen Schlag um eine Stufe (ein Fähnchen weniger bzw. mehr, wie "+" und "-" in Guitar Pro).
 * @param {Beat} beat Schlag
 * @param {number} step +1 = kürzer, -1 = länger
 * @returns {boolean} ob es noch eine Stufe gab
 */
export function stepDuration(beat, step){
  const index = DURATIONS.indexOf(beat.duration) + step;
  if(index < 0 || index >= DURATIONS.length) return false;
  beat.duration = DURATIONS[index];
  return true;
}

/**
 * Schaltet die Punktierung um: gesetzt wird die gewählte Zahl von Punkten, ist sie schon gesetzt, keine.
 * @param {Beat} beat Schlag
 * @param {number} dots 1 oder 2
 * @returns {void}
 */
export function toggleDots(beat, dots){
  setDots(beat, beat.dots === dots ? 0 : dots);
}

/**
 * Setzt die Punktierung eines Schlags.
 * @param {Beat} beat Schlag
 * @param {number} dots 0, 1 oder 2
 * @returns {void}
 */
export function setDots(beat, dots){
  beat.dots = dots;
}

/**
 * Schaltet die Triole um (drei Schläge in der Zeit von zweien).
 * @param {Beat} beat Schlag
 * @returns {void}
 */
export function toggleTriplet(beat){
  setTriplet(beat, !isTriplet(beat));
}

/**
 * Ob ein Schlag eine Triole ist (drei Schläge in der Zeit von zweien).
 * @param {Beat} beat Schlag
 * @returns {boolean}
 */
export function isTriplet(beat){
  return beat.tupletNumerator === 3 && beat.tupletDenominator === 2;
}

/**
 * Macht einen Schlag zur Triole oder nimmt die Triole weg.
 * @param {Beat} beat Schlag
 * @param {boolean} on Triole an
 * @returns {void}
 */
export function setTriplet(beat, on){
  beat.tupletNumerator = on ? 3 : -1;
  beat.tupletDenominator = on ? 2 : -1;
}

/**
 * Schaltet den Haltebogen der Note auf einer Saite um. Gehalten wird die Note des vorigen Schlags auf derselben
 * Saite: Fehlt sie dort, legt der Bogen sie an (mit deren Bund).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Beat} beat Schlag
 * @param {?Beat} previous voriger Schlag derselben Spur (auch im Takt davor)
 * @param {number} string Saite
 * @returns {boolean} ob sich etwas geändert hat (ohne Note davor gibt es keinen Bogen)
 */
export function toggleTie(alphaTab, beat, previous, string){
  const note = noteOn(beat, string);
  if(note?.isTieDestination){
    note.isTieDestination = false;
    return true;
  }
  const origin = previous ? noteOn(previous, string) : null;
  if(!origin) return false;
  setFret(alphaTab, beat, string, origin.fret);
  noteOn(beat, string).isTieDestination = true;
  return true;
}

/**
 * Schaltet eine Eigenschaft der Note auf einer Saite um, z. B. Dead Note oder Vibrato.
 * @param {?Note} note Note (ohne Note passiert nichts)
 * @param {string} prop Eigenschaft von Note (isDead, vibrato, slideOutType, isHammerPullOrigin, accidentalMode)
 * @param {*} on Wert für "an"
 * @param {*} off Wert für "aus"
 * @returns {boolean} ob es eine Note gab
 */
export function toggleNoteProp(note, prop, on, off){
  if(!note) return false;
  note[prop] = note[prop] === on ? off : on;
  return true;
}

/**
 * Schaltet die Betonung (Akzent) eines Schlags um: an allen seinen Noten an, wenn noch keine betont ist, sonst an
 * allen aus.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Beat} beat Schlag
 * @returns {void}
 */
export function toggleAccent(alphaTab, beat){
  const on = !beat.notes.some(n => n.accentuated);
  for(const note of beat.notes){
    note.accentuated = on ? alphaTab.model.AccentuationType.Normal : alphaTab.model.AccentuationType.None;
  }
}

/**
 * Schaltet eine Eigenschaft eines Schlags um, z. B. Anschlag oder Anschlagpfeil.
 * @param {Beat} beat Schlag
 * @param {string} prop Eigenschaft von Beat (pickStroke, brushType, fade)
 * @param {number} on Wert für "an"
 * @returns {void}
 */
export function toggleBeatProp(beat, prop, on){
  beat[prop] = beat[prop] === on ? 0 : on;
}

/**
 * Verschiebt die Note auf einer Saite um Halbtöne (Bund ±1), solange sie auf der Saite bleibt. Steht dort noch keine,
 * legt "höher" eine an (Bund 0); steht dort die 0, entfernt "tiefer" sie.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Beat} beat Schlag
 * @param {number} string Saite
 * @param {number} delta +1 oder -1
 * @returns {boolean} ob sich etwas geändert hat
 */
export function shiftSemitone(alphaTab, beat, string, delta){
  const note = noteOn(beat, string);
  if(!note){
    if(delta < 0) return false;
    setFret(alphaTab, beat, string, 0);
    return true;
  }
  if(note.fret === 0 && delta < 0){
    beat.removeNote(note);
    return true;
  }
  if(note.fret + delta < 0 || note.fret + delta > MAX_FRET) return false;
  note.fret += delta;
  note.isTieDestination = false;
  return true;
}

/**
 * Fügt links neben einem Schlag einen neuen ein: eine Pause mit derselben Dauer.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Beat} beat Schlag, links von dem eingefügt wird
 * @returns {void}
 */
export function insertBeat(alphaTab, beat){
  const voice = beat.voice;
  const added = new alphaTab.model.Beat();
  added.duration = beat.duration;
  added.voice = voice;
  voice.beats.splice(voice.beats.indexOf(beat), 0, added);
}

/**
 * Fügt rechts neben einem Schlag einen neuen ein: eine Pause mit derselben Dauer (auch am Ende des Takts).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Beat} beat Schlag, rechts von dem eingefügt wird
 * @returns {void}
 */
export function insertBeatAfter(alphaTab, beat){
  const voice = beat.voice;
  const added = new alphaTab.model.Beat();
  added.duration = beat.duration;
  added.voice = voice;
  voice.beats.splice(voice.beats.indexOf(beat) + 1, 0, added);
}

/**
 * Löscht einen Schlag. Der letzte Schlag eines Takts bleibt und wird zur Pause.
 * @param {Beat} beat Schlag
 * @returns {void}
 */
export function deleteBeat(beat){
  const beats = beat.voice.beats;
  if(beats.length === 1) makeRest(beat);
  else beats.splice(beats.indexOf(beat), 1);
}

/**
 * Stellt Indizes und Verkettungen von Takten wieder her, nachdem Takte eingefügt oder gelöscht wurden. Der Exporter
 * vergleicht jeden Takt mit dem vorigen (Taktart, Tonart, …) und braucht sie deshalb richtig.
 * @param {Score} score Noten
 * @returns {void}
 */
function relinkBars(score){
  score.masterBars.forEach((mb, i, all) => {
    mb.index = i;
    mb.previousMasterBar = all[i - 1] ?? null;
    mb.nextMasterBar = all[i + 1] ?? null;
  });
  for(const track of score.tracks) for(const staff of track.staves){
    staff.bars.forEach((bar, i, all) => {
      bar.index = i;
      bar.previousBar = all[i - 1] ?? null;
      bar.nextBar = all[i + 1] ?? null;
    });
  }
}

/**
 * Fügt vor einem Takt einen leeren ein (in allen Spuren eine Ganztaktpause), mit Taktart, Tonart und Schlüssel des
 * Takts davor bzw. danach. Sync-Punkte hängen an den Takten und wandern mit.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {number} index Index des neuen Takts
 * @returns {void}
 */
export function insertBar(alphaTab, score, index){
  const model = score.masterBars[Math.max(0, index - 1)];
  const mb = new alphaTab.model.MasterBar();
  mb.timeSignatureNumerator = model.timeSignatureNumerator;
  mb.timeSignatureDenominator = model.timeSignatureDenominator;
  mb.tripletFeel = model.tripletFeel;
  mb.score = score;
  score.masterBars.splice(index, 0, mb);
  for(const track of score.tracks) for(const staff of track.staves){
    const neighbour = staff.bars[Math.max(0, index - 1)];
    const bar = new alphaTab.model.Bar();
    bar.staff = staff;
    bar.clef = neighbour.clef;
    bar.keySignature = neighbour.keySignature;
    bar.keySignatureType = neighbour.keySignatureType;
    const voice = new alphaTab.model.Voice();
    const beat = new alphaTab.model.Beat();
    beat.duration = alphaTab.model.Duration.Whole;
    voice.addBeat(beat);
    bar.addVoice(voice);
    staff.bars.splice(index, 0, bar);
  }
  relinkBars(score);
  // Sonst gelten die neuen Stimmen als leer, und der Exporter schreibt die Takte ohne Pause.
  const settings = new alphaTab.Settings();
  for(const track of score.tracks) for(const staff of track.staves) staff.bars[index].finish(settings);
}

/**
 * Löscht einen Takt in allen Spuren. Der letzte Takt des Songs bleibt.
 * @param {Score} score Noten
 * @param {number} index Index des Takts
 * @returns {boolean} ob gelöscht wurde
 */
export function deleteBar(score, index){
  if(score.masterBars.length < 2) return false;
  // Ein Abschnitt am gelöschten Takt geht auf den nächsten über, sonst verschwände er.
  const removed = score.masterBars[index];
  const next = score.masterBars[index + 1];
  if(removed.section && next && !next.section) next.section = removed.section;
  score.masterBars.splice(index, 1);
  for(const track of score.tracks) for(const staff of track.staves) staff.bars.splice(index, 1);
  relinkBars(score);
  return true;
}

/**
 * Wie voll ein Takt ist: Summe der Schläge der ersten Stimme gegenüber der Taktart.
 * @param {Bar} bar Takt (aus frisch eingelesenen Noten, mit Abspielzeiten)
 * @returns {number} Ticks zu viel (positiv) bzw. zu wenig (negativ); 0 = voll
 */
export function barFill(bar){
  const beats = bar.voices[0]?.beats ?? [];
  const used = beats.reduce((sum, b) => sum + b.playbackDuration, 0);
  return used - bar.masterBar.calculateDuration();
}

/** Höhen der Bend-Stufen in Vierteltönen (so zählt alphaTab): ½, full (ein Ganzton), 1½. */
const BEND_STEPS = [2, 4, 6];

/**
 * Schaltet den Bend einer Note eine Stufe weiter: kein Bend → ½ → full → 1½ → kein Bend. Der Ton wird hochgezogen
 * (Punkte [Position 0–60, Höhe]: bis zur Stufe in einem Viertel der Zeit, dann gehalten).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {?Note} note Note (ohne Note passiert nichts)
 * @returns {boolean} ob es eine Note gab
 */
export function cycleBend(alphaTab, note){
  if(!note) return false;
  const current = note.hasBend ? Math.max(...note.bendPoints.map(p => p.value)) : 0;
  const next = BEND_STEPS[BEND_STEPS.indexOf(current) + 1];
  note.bendPoints = null;
  if(next === undefined){
    note.bendType = alphaTab.model.BendType.None;
    return true;
  }
  for(const [offset, value] of [[0, 0], [15, next], [60, next]]){
    note.addBendPoint(new alphaTab.model.BendPoint(offset, value));
  }
  note.bendType = alphaTab.model.BendType.Bend;
  return true;
}

/**
 * Takte von einem Takt an bis vor die nächste Änderung einer Eigenschaft: Wer die Taktart (o. Ä.) ab Takt 5 ändert,
 * ändert sie bis dorthin, wo sie sich ohnehin wieder ändert.
 * @param {Array<Object>} items Takte (masterBars oder bars einer Stimme)
 * @param {number} from erster Takt
 * @param {function(Object): string} valueOf Eigenschaft als Vergleichswert
 * @returns {Array<Object>} betroffene Takte
 */
function rangeUntilChange(items, from, valueOf){
  const start = valueOf(items[from]);
  const range = [];
  for(let i = from; i < items.length && valueOf(items[i]) === start; i++) range.push(items[i]);
  return range;
}

/**
 * Setzt die Taktart ab einem Takt (bis zur nächsten Änderung) bzw. für den ganzen Song.
 * @param {Score} score Noten
 * @param {number} from erster Takt
 * @param {number} numerator Zähler
 * @param {number} denominator Nenner
 * @param {boolean} [all] für alle Takte
 * @returns {void}
 */
export function setTimeSignature(score, from, numerator, denominator, all = false){
  const bars = all ? score.masterBars
    : rangeUntilChange(score.masterBars, from, mb => `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`);
  for(const mb of bars){
    mb.timeSignatureNumerator = numerator;
    mb.timeSignatureDenominator = denominator;
  }
}

/**
 * Setzt die Vorzeichen ab einem Takt (bis zur nächsten Änderung) bzw. für den ganzen Song, in allen Spuren.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {number} from erster Takt
 * @param {number} keySignature Vorzeichen: Kreuze positiv, Bes negativ
 * @param {boolean} minor Moll
 * @param {boolean} [all] für alle Takte
 * @returns {void}
 */
export function setKeySignature(alphaTab, score, from, keySignature, minor, all = false){
  const type = minor ? alphaTab.model.KeySignatureType.Minor : alphaTab.model.KeySignatureType.Major;
  for(const track of score.tracks) for(const staff of track.staves){
    const bars = all ? staff.bars : rangeUntilChange(staff.bars, from, b => `${b.keySignature}/${b.keySignatureType}`);
    for(const bar of bars){
      bar.keySignature = keySignature;
      bar.keySignatureType = type;
    }
  }
}

/**
 * Setzt das Tempo am Anfang eines Takts. Am ersten Takt ist es das Tempo des Songs; leer entfernt einen
 * Tempowechsel (nicht am ersten Takt).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {number} index Takt
 * @param {?number} bpm Tempo in Vierteln je Minute; null entfernt den Wechsel
 * @returns {void}
 */
export function setTempo(alphaTab, score, index, bpm){
  const mb = score.masterBars[index];
  if(!bpm){
    if(index > 0) mb.tempoAutomations = [];
    return;
  }
  const first = mb.tempoAutomations[0];
  if(first) first.value = bpm;
  else mb.tempoAutomations = [alphaTab.model.Automation.buildTempoAutomation(false, 0, bpm, 2)];
}

/**
 * Tempo, das an einem Takt gilt: das des Songs bzw. das des letzten Tempowechsels bis dorthin.
 * @param {Score} score Noten
 * @param {number} index Takt
 * @returns {number} Tempo in Vierteln je Minute
 */
export function tempoAt(score, index){
  let bpm = score.masterBars[0].tempoAutomations[0]?.value ?? score.tempo;
  for(let i = 1; i <= index; i++) bpm = score.masterBars[i].tempoAutomations[0]?.value ?? bpm;
  return bpm;
}

/**
 * Setzt das Triolen-Feeling ab einem Takt (bis zur nächsten Änderung) bzw. für den ganzen Song.
 * @param {Score} score Noten
 * @param {number} from erster Takt
 * @param {number} feel Wert von alphaTab.model.TripletFeel
 * @param {boolean} [all] für alle Takte
 * @returns {void}
 */
export function setTripletFeel(score, from, feel, all = false){
  const bars = all ? score.masterBars : rangeUntilChange(score.masterBars, from, mb => String(mb.tripletFeel));
  for(const mb of bars) mb.tripletFeel = feel;
}

/**
 * Setzt den Abschnitt an einem Takt; leer entfernt ihn. Wie in den importierten Songs steht der Name in Klammern
 * ("[Verse]"), der Player zeigt ihn ohne.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {number} index Takt
 * @param {string} name Name ohne Klammern, z. B. "Verse"
 * @returns {void}
 */
export function setSection(alphaTab, score, index, name){
  const mb = score.masterBars[index];
  if(!name){
    mb.section = null;
    return;
  }
  const section = mb.section ?? new alphaTab.model.Section();
  section.text = `[${name.replace(/^\[|]$/g, '')}]`;
  mb.section = section;
}

/**
 * Setzt die doppelten Taktstriche nach einer Regel: Ein doppelter Taktstrich steht genau am Ende des Takts vor einem
 * Abschnitt, in allen Spuren, sonst nirgends. Doppelte Striche anderer Herkunft (z. B. aus Guitar Pro) gelten nicht.
 * Andere Taktstriche (z. B. der Schlussstrich) bleiben.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @returns {void}
 */
export function applySectionBars(alphaTab, score){
  const {LightLight, Automatic} = alphaTab.model.BarLineStyle;
  for(const track of score.tracks) for(const staff of track.staves){
    staff.bars.forEach((bar, i) => {
      const beforeSection = !!score.masterBars[i + 1]?.section;
      if(beforeSection) bar.barLineRight = LightLight;
      else if(bar.barLineRight === LightLight) bar.barLineRight = Automatic;
    });
  }
}

/**
 * Setzt den Capo aller Spuren mit Saiten. Die Griffe bleiben: Bünde, Akkordnamen und Griffe ändern sich nicht, die
 * Noten klingen um den Capo höher. Den Klang erhält man, indem man dazu transponiert (notation.js).
 * @param {Score} score Noten
 * @param {number} capo neuer Capo
 * @returns {void}
 */
export function setCapo(score, capo){
  for(const track of score.tracks) for(const staff of track.staves){
    if(hasStrings(staff)) staff.capo = capo;
  }
}

/**
 * Ändert das Tuning eines Notensystems.
 * Mit keepSound rechnet es jede Note auf derselben Saite um (nur "Tuning angleichen"); passt sie dort nicht (unter 0
 * oder über 24), bleibt der Bund und sie wird gezählt. Sonst ändert es nur das Tuning: Die Bünde bleiben, die Noten
 * klingen anders.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Staff} staff Notensystem
 * @param {number[]} tuning neue Tonhöhen (MIDI), tiefste Saite zuerst
 * @param {boolean} keepSound Klang behalten
 * @returns {number} Noten, die sich nicht umrechnen ließen
 */
export function setTuning(alphaTab, staff, tuning, keepSound){
  const old = staff.tuning;
  // alphaTab führt die Saiten von der höchsten zur tiefsten.
  const next = [...tuning].reverse();
  let misses = 0;
  if(keepSound && next.length === old.length){
    const open = (t, string) => t[t.length - string];
    for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats){
      for(const note of beat.notes){
        const fret = note.fret + open(old, note.string) - open(next, note.string);
        if(fret < 0 || fret > MAX_FRET) misses++;
        else note.fret = fret;
      }
    }
  }
  // staff.tuning ist nur lesbar; es kommt aus stringTuning (mit dem Namen des bekannten Tunings, sonst keinem).
  staff.stringTuning = new alphaTab.model.Tuning(alphaTab.model.Tuning.findTuning(next)?.name ?? '', next, false);
  return misses;
}

/**
 * Schreibt Wiederholungen, Volta-Klammern, Sprungzeichen (D.C., D.S., Coda, Fine; siehe playOrder()) und
 * Takt-Wiederholungszeichen (Simile) aus: Jeder Takt steht danach so oft da, wie er gespielt wird, die Zeichen fallen
 * weg. Der Liedtext mehrerer Strophen an einem mehrfach gespielten Takt verteilt sich auf die Durchgänge (erster
 * Durchgang erste Zeile usw.), Sync-Punkte kommen an den Durchgang, zu dem sie gehören. Für die Kopien wird das
 * alphaTex mehrfach eingelesen (alphaTab hat keine Kopierfunktion für Takte).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {function(string): Score} parse liest alphaTex ein
 * @param {string} tex Noten als alphaTex
 * @returns {?{score: Score, before: number, after: number}} ausgeschriebene Noten und Taktzahl vorher/nachher; null,
 *   wenn es nichts auszuschreiben gibt
 */
export function unrollRepeats(alphaTab, parse, tex){
  const base = parse(tex);
  const before = base.masterBars.length;
  const simile = base.tracks.some(t => t.staves.some(st => st.bars.some(b => b.simileMark)));
  const directions = base.masterBars.some(mb => mb.directions?.size);
  const order = playOrder(base, alphaTab.model.Direction);
  if(order.length === base.masterBars.length && !simile && !directions) return null;
  const copiesNeeded = Math.max(...order.map(o => o.seen)) + 2;
  const copies = [base, ...Array.from({length: copiesNeeded - 1}, () => parse(tex))];
  /** @type {Map<number, number>} wie oft ein Takt schon für ein Simile kopiert wurde */
  const simileUse = new Map();

  const masterBars = order.map(({bar, seen: pass}) => {
    const mb = copies[pass].masterBars[bar];
    mb.score = base;
    mb.isRepeatStart = false;
    mb.repeatCount = 0;
    mb.alternateEndings = 0;
    mb.directions = new Set();
    if(mb.syncPoints){
      mb.syncPoints = mb.syncPoints.filter(p => p.syncPointValue.barOccurence === pass);
      for(const p of mb.syncPoints) p.syncPointValue.barOccurence = 0;
    }
    return mb;
  });
  for(const [ti, track] of base.tracks.entries()) for(const [si, staff] of track.staves.entries()){
    const occurrences = new Map();
    for(const {bar} of order) occurrences.set(bar, (occurrences.get(bar) ?? 0) + 1);
    const bars = order.map(({bar, pass}) => {
      const copy = copies[pass].tracks[ti].staves[si].bars[bar];
      copy.staff = staff;
      if(occurrences.get(bar) > 1){
        for(const voice of copy.voices) for(const beat of voice.beats){
          if(beat.lyrics?.length > 1) beat.lyrics = [beat.lyrics[pass] ?? ''];
        }
      }
      return copy;
    });
    // Takt-Wiederholungszeichen: Inhalt des Takts davor (eine frische Kopie, damit kein Objekt doppelt vorkommt).
    for(let i = 1; i < bars.length; i++){
      if(!bars[i].simileMark) continue;
      const sourceIndex = order[i - 1].bar;
      const use = (simileUse.get(sourceIndex) ?? 0) + 1;
      simileUse.set(sourceIndex, use);
      const copy = parse(tex).tracks[ti].staves[si].bars[sourceIndex];
      copy.staff = staff;
      copy.simileMark = 0;
      bars[i] = copy;
    }
    staff.bars = bars;
  }
  base.masterBars = masterBars;
  relinkBars(base);
  // order: je neuer Takt der alte Index, damit Angaben außerhalb der Noten (Leadsheet in song.json) mitwandern können.
  return {score: base, before, after: masterBars.length};
}

/**
 * Inhalt der Zwischenablage: Takte einer Spur, als alphaTex des ganzen Songs samt Bereich (zum Einfügen wird der
 * Text neu eingelesen, so entstehen eigene Kopien der Takte).
 * @typedef {Object} BarClipboard
 * @property {string} tex Noten als alphaTex
 * @property {number} track Spur
 * @property {number} from erster Takt
 * @property {number} to letzter Takt
 */

/**
 * Leert einen Takt: In der ersten Stimme bleibt eine Ganztaktpause, weitere Stimmen fallen weg.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Bar} bar Takt
 * @returns {void}
 */
export function clearBar(alphaTab, bar){
  const voice = bar.voices[0];
  const rest = new alphaTab.model.Beat();
  rest.duration = alphaTab.model.Duration.Whole;
  rest.voice = voice;
  voice.beats = [rest];
  bar.voices.length = 1;
}

/**
 * Fügt Takte aus der Zwischenablage in eine Spur ein, ab einem Takt, und ersetzt die Takte dort (wie Guitar Pro).
 * Reicht der Song nicht, kommen leere Takte dazu. Akkorde nimmt die Spur mit, falls sie sie noch nicht hat.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {function(string): Score} parse liest alphaTex ein
 * @param {Score} score Noten, werden geändert
 * @param {BarClipboard} clip Zwischenablage
 * @param {number} track Zielspur
 * @param {number} at erster Zieltakt
 * @returns {number} eingefügte Takte
 */
export function pasteBars(alphaTab, parse, score, clip, track, at){
  const source = parse(clip.tex).tracks[clip.track]?.staves[0];
  const staff = editStaff(score, track);
  if(!source || !staff) return 0;
  const count = clip.to - clip.from + 1;
  for(let j = 0; j < count; j++){
    const target = at + j;
    if(target >= score.masterBars.length) insertBar(alphaTab, score, score.masterBars.length);
    adoptBar(source, staff, source.bars[clip.from + j], target);
  }
  relinkBars(score);
  return count;
}

/**
 * Setzt einen Takt aus einem anderen Einlesen in ein Notensystem ein und ersetzt den Takt dort. Akkorde nimmt das
 * Notensystem mit, falls es sie noch nicht hat (gemeinsam für pasteBars() und copyBars()). Danach relinkBars().
 * @param {Staff} source Notensystem, aus dem der Takt kommt
 * @param {Staff} staff Zielsystem
 * @param {Bar} bar Takt aus source
 * @param {number} target Index des Zieltakts
 * @returns {void}
 */
function adoptBar(source, staff, bar, target){
  bar.staff = staff;
  for(const voice of bar.voices) for(const beat of voice.beats){
    if(!beat.chordId) continue;
    const chord = /** @type {?Chord} */ (source.chords?.get(beat.chordId) ?? null);
    if(!chord){
      beat.chordId = null;
      continue;
    }
    let id = [...staff.chords ?? []].find(([, c]) => c.name === chord.name)?.[0];
    if(id === undefined){
      id = chord.name;
      staff.addChord(id, chord);
    }
    beat.chordId = id;
  }
  staff.bars[target] = bar;
}

/**
 * Übernimmt einzelne Takte innerhalb des Songs, je Spur ("Abschnitte vergleichen", Pfeile wie in einem
 * Diff-Editor): Der Zieltakt wird durch eine Kopie des Quelltakts ersetzt, mit Noten, Text und Akkorden. Taktart,
 * Tempo und der Abschnittsname gehören zum Mastertakt und bleiben. Die Kopien kommen aus einem frischen Einlesen des
 * Stands vor der Änderung (tex), einmal für alle Takte: So liest jeder Zieltakt die Quelle, wie sie vorher war, auch
 * wenn ein Takt Quelle und Ziel zugleich ist.
 * @param {function(string): Score} parse liest alphaTex ein
 * @param {Score} score Noten, werden geändert
 * @param {string} tex alphaTex zu score (vor der Änderung)
 * @param {{track: number, from: number, to: number}[]} copies je Spur Quell- und Zieltakt (Index des Mastertakts)
 * @returns {number} übernommene Takte
 */
export function copyBars(parse, score, tex, copies){
  let source = parse(tex);
  const used = new Set();
  let count = 0;
  for(const {track, from, to} of copies){
    const staff = editStaff(score, track);
    // Derselbe Quelltakt ein zweites Mal (nach zwei Zielen): neu einlesen, ein Takt kann nur an einer Stelle stehen.
    if(used.has(`${track}:${from}`)){
      source = parse(tex);
      used.clear();
    }
    const origin = source.tracks[track]?.staves[0];
    if(!staff || !origin?.bars[from] || to >= staff.bars.length) continue;
    used.add(`${track}:${from}`);
    adoptBar(origin, staff, origin.bars[from], to);
    count++;
  }
  relinkBars(score);
  return count;
}

/** Zeile mit einem Abschnittsnamen im Liedtext, z. B. "[Verse]" (siehe lyricsLines() in textview.js). */
const SECTION_LINE = /^\s*\[[^\]]*]\s*$/;

/**
 * Silben eines Liedtexts: an Leerzeichen und nach Bindestrichen getrennt ("Frank-furt" → "Frank-", "furt"). Ein
 * einzelnes "_" lässt einen Schlag ohne Silbe, ein "_" im Wort verbindet zwei Wörter auf einem Schlag ("mir_zu." →
 * "mir zu."). Zeilen mit einem Abschnittsnamen ("[Verse]") zählen nicht. Die letzte Silbe jeder Zeile bekommt den
 * Zeilenumbruch (LYRICS_BREAK in notation.js), auch am Ende eines Abschnitts und des Texts: Beginnt der nächste
 * Abschnitt mit einem Auftakt oder folgt nach einer Wiederholung die nächste Strophe, hinge sie sonst an der Zeile.
 * @param {string} text Liedtext
 * @returns {string[]} Silben ("" für "_")
 */
export function splitSyllables(text){
  return text.split('\n').filter(line => !SECTION_LINE.test(line)).flatMap(line => {
    const syllables = line.split(/\s+/).filter(Boolean)
      .flatMap(word => word === '_' ? [''] : (word.match(/[^-]+-?|-/g) ?? []).map(s => s.replace(/_/g, ' ')));
    const last = syllables.findLastIndex(Boolean);
    if(last >= 0) syllables[last] += LYRICS_BREAK;
    return syllables;
  });
}

/**
 * Stellen der Silben in einem Liedtext, wie splitSyllables() sie trennt, ohne die leeren ("_").
 * @param {string} text Liedtext
 * @returns {{from: number, to: number}[]} Zeichenbereich je Silbe (to ausschließlich)
 */
export function syllableRanges(text){
  const out = [];
  let offset = 0;
  for(const line of text.split('\n')){
    if(!SECTION_LINE.test(line)){
      for(const word of line.matchAll(/\S+/g)){
        if(word[0] === '_') continue;
        for(const part of word[0].matchAll(/[^-]+-?|-/g)){
          const from = offset + word.index + part.index;
          out.push({from, to: from + part[0].length});
        }
      }
    }
    offset += line.length + 1;
  }
  return out;
}

/**
 * Teilt einen Liedtext an den Abschnittszeilen ("[Verse]"): zuerst der Text vor der ersten, dann je Abschnitt.
 * @param {string} text Liedtext
 * @returns {{text: string, line: number, lines: number}[]} Teile mit erster Zeile (ab 0, beim Abschnitt die Zeile mit
 *   dem Namen) und Zahl der Zeilen
 */
export function splitLyricsBlocks(text){
  const blocks = [{text: '', line: 0, lines: 0}];
  text.split('\n').forEach((line, i) => {
    if(SECTION_LINE.test(line)) blocks.push({text: '', line: i, lines: 0});
    const block = blocks.at(-1);
    block.text += line + '\n';
    block.lines++;
  });
  return blocks;
}

/**
 * Paare gleicher Einträge zweier Folgen in derselben Reihenfolge (längste gemeinsame Teilfolge).
 * @param {string[]} a erste Folge
 * @param {string[]} b zweite Folge
 * @returns {[number, number][]} Indizes [in a, in b], aufsteigend
 */
function commonPairs(a, b){
  const width = b.length + 1;
  const table = new Int32Array((a.length + 1) * width);
  for(let i = a.length - 1; i >= 0; i--) for(let j = b.length - 1; j >= 0; j--){
    table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1
      : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  }
  const pairs = [];
  for(let i = 0, j = 0; i < a.length && j < b.length;){
    if(a[i] === b[j]){
      pairs.push([i, j]);
      i++;
      j++;
    } else if(table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Setzt die Silbe der ersten Strophe eines Schlags (weitere Strophen bleiben).
 * @param {Beat} beat Schlag
 * @param {string} syllable Silbe, leer zum Löschen
 * @returns {void}
 */
function setSyllable(beat, syllable){
  const lyrics = beat.lyrics ? [...beat.lyrics] : [''];
  lyrics[0] = syllable;
  beat.lyrics = lyrics.some(l => l) ? lyrics : null;
}

/**
 * Bringt die Silben eines Teils der Spur auf einen neuen Text und ändert dabei so wenig wie möglich: Silben, die
 * gleich geblieben sind, bleiben auf ihrem Schlag (auch mit Lücken dazwischen, z. B. einer über mehrere Schläge
 * gehaltenen Silbe). Geänderte Silben kommen auf die Schläge der alten an derselben Stelle; reichen die nicht, auch auf
 * freie Schläge dahinter bis zur nächsten gleich gebliebenen Silbe. Passt es auch so nicht, geht der Text ab dort
 * Schlag für Schlag bis zum Ende des Teils weiter (die Silben dahinter rücken nach).
 * @param {Beat[]} beats Schläge des Teils mit Note oder Silbe, in zeitlicher Folge
 * @param {string[]} syllables neue Silben ("" für "_": ein Schlag ohne Silbe)
 * @returns {{placed: number, left: number}} gesetzte Silben und solche, für die keine Schläge mehr da waren
 */
function placeSyllables(beats, syllables){
  const sung = beats.map((b, i) => (b.lyrics?.[0]?.trim() ? i : -1)).filter(i => i >= 0);
  // Verglichen wird ohne Zeilenumbrüche: Eine Silbe, die nur einen Umbruch bekommt oder verliert, bleibt, wo sie ist.
  const pairs = commonPairs(sung.map(i => beats[i].lyrics[0].trim()), syllables.map(s => s.trim()));
  pairs.push([sung.length, syllables.length]);
  let previousBeat = -1;
  let previousOld = -1;
  let previousNew = -1;
  for(const [oi, nj] of pairs){
    const beatEnd = oi < sung.length ? sung[oi] : beats.length;
    const occupied = sung.slice(previousOld + 1, oi);
    const words = syllables.slice(previousNew + 1, nj);
    if(occupied.length || words.length){
      const from = occupied[0] ?? (previousBeat >= 0 || sung.length ? previousBeat + 1
        : beats.findIndex(b => b.notes.length));
      // Erst die Schläge der alten Silben, dann freie bis zur nächsten gleich gebliebenen.
      const slots = words.length <= occupied.length ? occupied
        : [...new Set([...occupied, ...beats.keys()])].filter(i => i >= from && i < beatEnd).sort((x, y) => x - y);
      if(words.length > slots.length){
        // Passt nicht: ab hier Schlag für Schlag bis zum Ende des Teils.
        const rest = syllables.slice(previousNew + 1);
        const tail = beats.slice(Math.max(0, from)).filter(b => b.notes.length || b.lyrics?.[0]?.trim());
        for(const beat of tail) setSyllable(beat, '');
        tail.forEach((beat, i) => setSyllable(beat, rest[i] ?? ''));
        const placedBefore = syllables.slice(0, previousNew + 1).filter(Boolean).length;
        const placedRest = rest.slice(0, tail.length).filter(Boolean).length;
        return {placed: placedBefore + placedRest, left: rest.slice(tail.length).filter(Boolean).length};
      }
      for(const i of occupied) setSyllable(beats[i], '');
      words.forEach((word, k) => setSyllable(beats[slots[k]], word));
    }
    // Gleich gebliebene Silbe: nur ein geänderter Zeilenumbruch (oder Leerzeichen drumherum) wird übernommen.
    if(oi < sung.length && beats[sung[oi]].lyrics[0] !== syllables[nj]) setSyllable(beats[sung[oi]], syllables[nj]);
    previousBeat = beatEnd;
    previousOld = oi;
    previousNew = nj;
  }
  return {placed: syllables.filter(Boolean).length, left: 0};
}

/**
 * Verteilt einen Liedtext auf die Schläge einer Spur (erste Strophe), eine Silbe je Schlag mit Note, und ändert dabei
 * nur, was sich am Text geändert hat (placeSyllables()). Mit den Anfängen der Abschnitte (lyricsSectionStarts() in
 * textview.js) und passend vielen Abschnittszeilen im Text gilt das je Abschnitt: Der Text eines Abschnitts kommt in
 * die Schläge seines Abschnitts, ein zu langer verschiebt nicht die folgenden. Sonst (oder ohne Abschnitte) gilt es
 * für die ganze Spur. Weitere Strophen bleiben.
 * @param {Track} track Spur
 * @param {string} text Liedtext
 * @param {number[]} [starts] Anfang je Abschnitt in Ticks (Reihenfolge der Noten, ohne Wiederholungen)
 * @returns {{placed: number, left: number, lefts: number[]}} gesetzte Silben, solche ohne Schlag, und diese je Teil
 *   von splitLyricsBlocks() (bei einem Text am Stück alle im ersten)
 */
export function setLyricsText(track, text, starts = []){
  const beats = track.staves[0].bars.flatMap(bar => bar.voices[0]?.beats ?? [])
    .filter(b => (b.notes.length && !b.notes.every(n => n.isTieDestination)) || b.lyrics?.[0]?.trim());
  const time = beat => beat.voice.bar.masterBar.start + beat.playbackStart;
  const blocks = splitLyricsBlocks(text);
  const bySection = starts.length > 0 && blocks.length === starts.length + 1;
  const ranges = bySection
    ? blocks.map((block, i) => ({text: block.text, from: i ? starts[i - 1] : -Infinity, to: starts[i] ?? Infinity}))
    : [{text, from: -Infinity, to: Infinity}];
  let placed = 0;
  const lefts = ranges.map(({text: part, from, to}) => {
    const result = placeSyllables(beats.filter(b => time(b) >= from && time(b) < to), splitSyllables(part));
    placed += result.placed;
    return result.left;
  });
  return {placed, left: lefts.reduce((x, y) => x + y, 0), lefts};
}

/**
 * Übernimmt den Liedtext aller Schläge einer Spur in eine gleich gebaute Spur (dieselbe Spur aus einem anderen
 * Einlesen derselben Noten).
 * @param {Track} from Spur mit dem Text
 * @param {Track} to Spur, die ihn bekommt
 * @returns {void}
 */
export function copyLyrics(from, to){
  from.staves.forEach((staff, s) => staff.bars.forEach((bar, b) => bar.voices.forEach((voice, v) => {
    voice.beats.forEach((beat, i) => {
      const target = to.staves[s]?.bars[b]?.voices[v]?.beats[i];
      if(target) target.lyrics = beat.lyrics ? [...beat.lyrics] : null;
    });
  })));
}

/**
 * Verschiebt eine Spur in der Reihenfolge der Datei.
 * @param {Score} score Noten
 * @param {number} index Spur
 * @param {number} step -1 nach oben, +1 nach unten
 * @returns {boolean} ob verschoben wurde
 */
export function moveTrack(score, index, step){
  const target = index + step;
  if(target < 0 || target >= score.tracks.length) return false;
  const [track] = score.tracks.splice(index, 1);
  score.tracks.splice(target, 0, track);
  score.tracks.forEach((t, i) => { t.index = i; });
  return true;
}

/**
 * Löscht eine Spur. Die letzte bleibt.
 * @param {Score} score Noten
 * @param {number} index Spur
 * @returns {boolean} ob gelöscht wurde
 */
export function deleteTrack(score, index){
  if(score.tracks.length < 2) return false;
  score.tracks.splice(index, 1);
  score.tracks.forEach((t, i) => { t.index = i; });
  return true;
}

/**
 * Fügt eine Gitarrenspur hinzu (Instrument Akustikgitarre, mit Tuning und Capo der Akkordspur, ohne Spur mit Saiten Standard-Tuning
 * ohne Capo), mit einer Ganztaktpause je Takt.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {string} name Name der Spur
 * @returns {void}
 */
export function addTrack(alphaTab, score, name){
  const {model} = alphaTab;
  const track = new model.Track();
  track.name = track.shortName = name;
  track.playbackInfo.program = 25;
  const staff = new model.Staff();
  staff.isPercussion = false;
  // Tuning und Capo wie der Song (die Spur der Akkorde, siehe tuningStaves()), sonst Standard-Tuning ohne Capo.
  const ref = tuningStaves(score)[0];
  const tuning = ref ? [...ref.tuning] : [64, 59, 55, 50, 45, 40];
  staff.stringTuning = new model.Tuning(model.Tuning.findTuning(tuning)?.name ?? '', tuning, false);
  staff.capo = ref?.capo ?? 0;
  track.addStaff(staff);
  const settings = new alphaTab.Settings();
  for(const mb of score.masterBars){
    const bar = new model.Bar();
    const neighbour = score.tracks[0].staves[0].bars[mb.index];
    bar.clef = model.Clef.G2;
    bar.keySignature = neighbour.keySignature;
    bar.keySignatureType = neighbour.keySignatureType;
    const voice = new model.Voice();
    const beat = new model.Beat();
    beat.duration = model.Duration.Whole;
    voice.addBeat(beat);
    bar.addVoice(voice);
    staff.addBar(bar);
  }
  score.addTrack(track);
  setInstrument(alphaTab, track, instrumentByKey('guitar'));
  for(const bar of staff.bars) bar.finish(settings);
}

/** MIDI-Ticks einer ganzen Note (eine Viertel hat 960). */
export const WHOLE_TICKS = 3840;

/** Kürzeste Länge, in die moveContent() einen Schlag teilt: eine Zweiunddreißigstel. */
const MIN_TICKS = WHOLE_TICKS / 32;

/**
 * Länge eines Schlags in MIDI-Ticks, aus Notenwert, Punktierung und Triole berechnet. playbackDuration taugt hier
 * nicht: moveContent() teilt Schläge, und neue Schläge haben sie erst nach dem Neueinlesen.
 * @param {Beat} beat Schlag
 * @returns {number} 0 für Vorschläge (sie liegen vor dem Schlag und zählen nicht)
 */
export function beatTicks(beat){
  if(beat.graceType) return 0;
  let ticks = beat.duration > 0 ? WHOLE_TICKS / beat.duration : WHOLE_TICKS * -beat.duration;
  if(beat.dots === 1) ticks *= 1.5;
  else if(beat.dots === 2) ticks *= 1.75;
  if(beat.hasTuplet) ticks = ticks * beat.tupletDenominator / beat.tupletNumerator;
  return ticks;
}

/**
 * Schläge einer Stimme mit Anfang (Ticks ab Taktanfang) und Länge.
 * @param {Voice} voice Stimme
 * @returns {{beat: Beat, start: number, end: number}[]}
 */
export function timeline(voice){
  let start = 0;
  return voice.beats.map(beat => {
    const end = start + beatTicks(beat);
    const entry = {beat, start, end};
    start = end;
    return entry;
  });
}

/**
 * Länge in Schlägen des größten Notenwerts, in dem sie aufgeht.
 * @param {number} ticks Länge in MIDI-Ticks
 * @returns {string} z. B. "1 Achtelschlag", "3 Achtelschläge"; ohne ganzzahlige Vielfache der 64tel ("3/16")
 */
function beatCount(ticks){
  const names = {1: 'Ganz', 2: 'Halb', 4: 'Viertel', 8: 'Achtel', 16: 'Sechzehntel', 32: 'Zweiunddreißigstel'};
  for(const [value, name] of Object.entries(names)){
    const unit = WHOLE_TICKS / Number(value);
    if(ticks % unit < 1e-6 || unit - ticks % unit < 1e-6){
      const n = Math.round(ticks / unit);
      return `${n} ${name}${n === 1 ? 'schlag' : 'schläge'}`;
    }
  }
  return wholeFraction(ticks);
}

/**
 * Länge als Bruchteil einer ganzen Note.
 * @param {number} ticks Länge in MIDI-Ticks
 * @returns {string} z. B. "5/8" oder "1/4"
 */
function wholeFraction(ticks){
  const unit = WHOLE_TICKS / 64;
  let n = Math.round(ticks / unit);
  let d = 64;
  while(n % 2 === 0 && d > 1){
    n /= 2;
    d /= 2;
  }
  return `${n}/${d}`;
}

/**
 * Ein Takt, dessen Schläge nicht zur Taktart passen.
 * @typedef {Object} BarLengthProblem
 * @property {Bar} bar Takt der Spur
 * @property {string} text Hinweis, z. B. "1 Achtelschlag zu wenig"
 */

/**
 * Sucht die Takte, deren Schläge länger oder kürzer sind als die Taktart verlangt (je Stimme geprüft). Leere Takte und
 * ein Auftakt zählen nicht.
 * @param {Score} score Noten
 * @returns {BarLengthProblem[]} nach Takt sortiert
 */
export function barLengthProblems(score){
  /** @type {BarLengthProblem[]} */
  const problems = [];
  for(const track of score.tracks) for(const staff of track.staves) for(const bar of staff.bars){
    const mb = bar.masterBar;
    if(mb.isAnacrusis) continue;
    const length = mb.calculateDuration();
    for(const voice of bar.voices){
      // Leere Takte (ein Ruhezeichen als Platzhalter) füllen den Takt von selbst.
      if(!voice.beats.length || voice.isEmpty) continue;
      const filled = timeline(voice).at(-1).end;
      if(Math.abs(filled - length) < 1) continue;
      const diff = Math.abs(filled - length);
      problems.push({bar, text: `${beatCount(diff)} zu ${filled > length ? 'viel' : 'wenig'}`});
      break;
    }
  }
  return problems.sort((a, b) => a.bar.index - b.bar.index);
}

/**
 * Zerlegt eine Länge in darstellbare Notenwerte (auch punktiert), die längsten zuerst.
 * @param {number} ticks Länge in MIDI-Ticks
 * @returns {?{duration: number, dots: number}[]} null, wenn es nicht aufgeht (z. B. Triolenteile)
 */
export function splitTicks(ticks){
  if(ticks <= 0 || ticks % MIN_TICKS) return null;
  const values = DURATIONS.flatMap(duration => [2, 1, 0].map(dots => ({
    duration, dots, ticks: WHOLE_TICKS / duration * [1, 1.5, 1.75][dots],
  })));
  /** @type {{duration: number, dots: number}[]} */
  const parts = [];
  let rest = ticks;
  while(rest > 0){
    const value = values.find(v => v.ticks <= rest);
    parts.push({duration: value.duration, dots: value.dots});
    rest -= value.ticks;
  }
  return parts;
}

/**
 * Teilt einen Schlag an einer Stelle in zwei: Der erste Teil bleibt der Schlag selbst (mit Akkord, Silbe, Effekten),
 * dahinter kommen neue Schläge mit denselben Tönen, angebunden (Haltebogen), sodass es gleich klingt. Ist eine Länge
 * nur mit mehreren Notenwerten darstellbar (z. B. fünf Sechzehntel), werden es mehrere angebundene Schläge.
 * Effekte, die zum nächsten Schlag führen (Slide, Hammer-on/Pull-off), wandern an das Ende der Kette.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Beat} beat Schlag in der ersten Stimme
 * @param {number} at Stelle in Ticks ab Anfang des Schlags (zwischen 0 und seiner Länge)
 * @returns {?Beat} der Schlag, der an der Stelle beginnt; null, wenn sich der Schlag dort nicht teilen lässt
 *   (Triole, Vorschlag oder eine Länge, die keine Notenwerte ergibt)
 */
export function splitBeat(alphaTab, beat, at){
  if(beat.hasTuplet || beat.graceType) return null;
  const head = splitTicks(at);
  const tail = splitTicks(beatTicks(beat) - at);
  if(!head || !tail) return null;
  const voice = beat.voice;
  const [first, ...more] = [...head, ...tail];
  beat.duration = first.duration;
  beat.dots = first.dots;
  /** @type {Beat[]} */
  const added = more.map(({duration, dots}) => {
    const copy = new alphaTab.model.Beat();
    copy.duration = duration;
    copy.dots = dots;
    copy.dynamics = beat.dynamics;
    copy.voice = voice;
    for(const note of beat.notes){
      const tied = new alphaTab.model.Note();
      tied.string = note.string;
      tied.fret = note.fret;
      tied.octave = note.octave;
      tied.tone = note.tone;
      tied.percussionArticulation = note.percussionArticulation;
      tied.isTieDestination = true;
      copy.addNote(tied);
    }
    return copy;
  });
  voice.beats.splice(voice.beats.indexOf(beat) + 1, 0, ...added);
  const last = added[added.length - 1];
  beat.notes.forEach((note, i) => {
    const moved = last.notes[i];
    moved.slideOutType = note.slideOutType;
    moved.isHammerPullOrigin = note.isHammerPullOrigin;
    note.slideOutType = alphaTab.model.SlideOutType.None;
    note.isHammerPullOrigin = false;
  });
  return added[head.length - 1];
}

/**
 * Hängt eine Silbe an eine andere (beide landen auf einem Schlag): Silben eines Worts ("Frank-" "furt") ohne
 * Trennstrich zusammen, sonst mit Leerzeichen. Ein Zeilenumbruch (LYRICS_BREAK) bleibt am Ende.
 * @param {string} a erste Silbe
 * @param {string} b zweite Silbe
 * @returns {string}
 */
export function joinSyllables(a, b){
  const left = (a ?? '').trim();
  const right = (b ?? '').trim();
  if(!left || !right) return left || right;
  const text = left.endsWith('-') ? left.slice(0, -1) + right : `${left} ${right}`;
  return /\n\s*$/.test(a) || /\n\s*$/.test(b) ? text.replace(/\s*\n\s*/g, ' ') + LYRICS_BREAK : text;
}

/**
 * Wie moveContent() mit Schlägen umgeht, die die Zielspur an der Stelle eines Akkords bzw. einer Silbe nicht hat:
 * "insert" teilt den dort klingenden Schlag (siehe splitBeat()), "shift" setzt auf diesen Schlag (also nach vorne).
 * @typedef {'insert'|'shift'} MoveMode
 */

/**
 * Ergebnis von moveContent().
 * @typedef {Object} MoveResult
 * @property {number} moved Akkorde bzw. Silben, die in der Zielspur gelandet sind
 * @property {number} exact davon auf einem Schlag, der an derselben Stelle beginnt
 * @property {number} split davon auf einem Schlag, der dafür geteilt wurde
 * @property {number} shifted davon nach vorne auf den klingenden Schlag gesetzt
 * @property {number} lost Akkorde, die auf einem Schlag mit anderem Akkord landen würden und wegfallen
 * @property {{bar: number, name: string, kept: string, track: string}[]} lostChords diese Akkorde: Takt (Index),
 *   Name, der Akkord, der an der Stelle bleibt, und die Spur, aus der der weggefallene kam
 * @property {number} dropped Silben, die die Zielspur oder eine dritte Spur vorher hatte und die wegfallen
 */

/**
 * Zieht die Akkorde bzw. den Liedtext in eine Spur um, damit sie an genau einer Stelle stehen.
 *
 * Akkorde: Alle Akkorde der anderen Spuren kommen in die Zielspur (Regel wie mergeChords(): die Zielspur gewinnt,
 * dann die Spuren in ihrer Reihenfolge), umgerechnet auf ihren Capo (Griffnamen gelten relativ zum Capo). Die
 * Griffbilder setzt danach normalizeChords().
 *
 * Text: Der Text der Spur mit dem meisten Text (lyricsTrack()) kommt in die Zielspur, und zwar ganz, alle Strophen.
 * Was die Zielspur oder eine dritte Spur an Text hatte, fällt weg (meist derselbe Text doppelt); hält die Zielspur
 * schon den meisten Text, wird nur der Rest entfernt.
 *
 * Beginnt in der Zielspur an der Stelle kein Schlag, entscheidet mode. Danach stehen in den anderen Spuren keine
 * Akkorde bzw. kein Text mehr (ungenutzte Akkorddefinitionen fallen auch weg).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @param {'chords'|'lyrics'} kind was umzieht
 * @param {number} target Index der Zielspur
 * @param {MoveMode} mode Umgang mit Stellen ohne Schlag
 * @returns {MoveResult}
 */
export function moveContent(alphaTab, score, kind, target, mode){
  const dest = score.tracks[target];
  const staff = dest.staves[0];
  /** @type {MoveResult} */
  const result = {moved: 0, exact: 0, split: 0, shifted: 0, lost: 0, dropped: 0, lostChords: []};
  const isChords = kind === 'chords';
  const source = isChords ? null : lyricsTrack(score);
  const sources = isChords ? score.tracks.filter(t => t !== dest) : source && source !== dest ? [source] : [];
  /** @type {{bar: number, tick: number, order: number, beat: Beat, staff: Staff}[]} */
  const items = [];
  sources.forEach((track, order) => {
    for(const st of track.staves) for(const bar of st.bars) for(const voice of bar.voices){
      for(const {beat, start} of timeline(voice)){
        if(isChords ? beat.chordId && st.chords?.get(beat.chordId) : hasLyrics(beat)){
          items.push({bar: bar.index, tick: start, order, beat, staff: st});
        }
      }
    }
  });
  // Text der Zielspur und dritter Spuren fällt weg (siehe oben); gezählt für die Nachfrage.
  if(!isChords){
    for(const track of score.tracks){
      if(track === source && track !== dest) continue;
      for(const st of track.staves) for(const bar of st.bars) for(const voice of bar.voices) for(const beat of voice.beats){
        if(!hasLyrics(beat)) continue;
        if(track !== dest || source !== dest){
          result.dropped++;
          beat.lyrics = null;
        }
      }
    }
  }
  items.sort((a, b) => a.bar - b.bar || a.tick - b.tick || a.order - b.order);
  for(const item of items){
    const bar = staff.bars[item.bar];
    const voice = bar?.voices[0];
    if(!voice) continue;
    const beats = timeline(voice).filter(e => e.end > e.start);
    let entry = beats.find(e => e.start === item.tick);
    let how = 'exact';
    if(!entry){
      const sounding = beats.find(e => e.start < item.tick && item.tick < e.end) ?? beats[beats.length - 1];
      const split = mode === 'insert' && sounding ? splitBeat(alphaTab, sounding.beat, item.tick - sounding.start)
        : null;
      entry = split ? {beat: split, start: item.tick, end: item.tick} : sounding;
      how = split ? 'split' : 'shifted';
    }
    if(!entry) continue;
    const beat = entry.beat;
    if(isChords){
      const chord = item.staff.chords.get(item.beat.chordId);
      const name = transposeChordName(chord.name, item.staff.capo - staff.capo);
      if(beat.chordId){
        // Gleicher Akkord: nichts zu tun. Anderer: Der zuerst gesetzte gewinnt (die Zielspur, dann nach Reihenfolge).
        const kept = staff.chords?.get(beat.chordId)?.name;
        if(kept !== name){
          result.lost++;
          result.lostChords.push({bar: item.bar, name, kept, track: trackName(item.staff.track)});
          continue;
        }
      } else {
        let id = [...staff.chords ?? []].find(([, c]) => c.name === name)?.[0];
        if(id === undefined){
          const copy = new alphaTab.model.Chord();
          copy.name = name;
          // Der Griff passt nur bei gleichem Capo und gleich vielen Saiten.
          copy.strings = name === chord.name && chord.strings.length === staff.tuning.length ? [...chord.strings] : [];
          copy.firstFret = chord.firstFret;
          copy.barreFrets = [...chord.barreFrets];
          id = name;
          staff.addChord(id, copy);
        }
        beat.chordId = id;
      }
    } else {
      const incoming = item.beat.lyrics;
      const lyrics = beat.lyrics ? [...beat.lyrics] : [];
      incoming.forEach((syllable, i) => { lyrics[i] = joinSyllables(lyrics[i] ?? '', syllable ?? ''); });
      beat.lyrics = lyrics;
    }
    result.moved++;
    result[how]++;
  }
  // Aus den anderen Spuren entfernen: Akkorde (auch unterlegene) samt ungenutzter Definitionen, Text.
  for(const track of score.tracks){
    if(track === dest) continue;
    for(const st of track.staves){
      for(const bar of st.bars) for(const voice of bar.voices) for(const beat of voice.beats){
        if(isChords) beat.chordId = null;
        else beat.lyrics = null;
      }
      if(isChords) st.chords?.clear();
    }
  }
  return result;
}

/**
 * Nimmt einer Spur Akkorde und Text, z. B. einer Kopie: Beides steht an genau einer Stelle im Song (siehe notation.js).
 * @param {Track} track Spur, wird geändert
 * @returns {void}
 */
export function stripContent(track){
  for(const staff of track.staves){
    for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats){
      beat.chordId = null;
      beat.lyrics = null;
    }
    staff.chords?.clear();
  }
}

/**
 * Freier Name für eine neue Spur: der gewünschte, ist er vergeben, mit angehängter Nummer ("picking 2").
 * @param {Score} score Noten
 * @param {string} name gewünschter Name
 * @param {?Track} [self] die Spur, die den Namen bekommt, wenn sie schon in den Noten steht (ihr bisheriger Name
 *   zählt nicht als vergeben)
 * @returns {string}
 */
export function freeTrackName(score, name, self = null){
  const taken = new Set(score.tracks.filter(t => t !== self).map(t => t.name.trim().toLowerCase()));
  const base = name.trim() || 'Spur';
  if(!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while(taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/**
 * Hängt eine Spur aus anderen (frisch gelesenen) Noten an einer Stelle in die Reihenfolge ein. Wie bei pasteBars()
 * werden ihre Takte umgehängt; Taktart, Tempo usw. (masterBars) bleiben die des Songs.
 * @param {Score} score Noten, werden geändert
 * @param {Track} track Spur aus anderen Noten
 * @param {number} at Index, den sie bekommen soll
 * @returns {void}
 */
function insertTrack(score, track, at){
  score.addTrack(track);
  score.tracks.splice(track.index, 1);
  score.tracks.splice(at, 0, track);
  score.tracks.forEach((t, i) => { t.index = i; });
  relinkBars(score);
}

/**
 * Verdoppelt eine Spur: Die Kopie kommt direkt dahinter (oder an die Stelle at), heißt wie das Original mit Nummer
 * und hat weder Akkorde noch Text (beides steht an genau einer Stelle im Song, siehe notation.js).
 * @param {function(string): Score} parse liest alphaTex ein
 * @param {string} tex alphaTex der Noten (Stand vor der Änderung)
 * @param {Score} score dieselben Noten als Modell, werden geändert
 * @param {number} index zu kopierende Spur
 * @param {number} [at] Index, den die Kopie bekommt
 * @returns {Track} die Kopie
 */
export function duplicateTrack(parse, tex, score, index, at = index + 1){
  const copy = parse(tex).tracks[index];
  stripContent(copy);
  copy.name = copy.shortName = freeTrackName(score, score.tracks[index].name);
  insertTrack(score, copy, at);
  return copy;
}

/**
 * Leitet aus einer Spur (z. B. Fingerstyle) eine reine Melodiespur ab und setzt sie als letzte Spur ein: Wo in der
 * Textspur an derselben Stelle eine Silbe steht, bleibt vom Schlag nur der höchste Ton (neu angeschlagen, ohne
 * Haltebogen davor) mit seiner Dauer. Klingt dieser Ton per Haltebogen in die folgenden Schläge ohne Silbe weiter,
 * bleibt auch die Fortsetzung samt Haltebogen. Alle anderen Schläge werden Pausen, und aufeinanderfolgende Pausen
 * werden zu möglichst wenigen zusammengefasst (mergeRests()); weitere Stimmen der Spur werden Pausen. Die neue Spur heißt
 * "Melodie", hat das Instrument Gesang und bekommt den Text (moveContent()).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {function(string): Score} parse liest alphaTex ein
 * @param {string} tex alphaTex der Noten (Stand vor der Änderung)
 * @param {Score} score dieselben Noten als Modell, werden geändert
 * @param {number} index Spur, aus der die Melodie kommt
 * @returns {?{notes: number, bars: number}} Melodietöne und Takte, deren Pausen nicht zusammengefasst werden konnten
 *   (Triolen, Vorschläge: dort bleiben sie, wie sie sind); null ohne Text
 */
export function deriveMelodyTrack(alphaTab, parse, tex, score, index){
  const text = lyricsTrack(score);
  if(!text) return null;
  /** @type {Set<string>} Stellen mit Silbe: Takt und Start des Schlags */
  const sung = new Set();
  for(const bar of text.staves[0].bars) for(const voice of bar.voices) for(const beat of voice.beats){
    if(beat.lyrics?.[0]?.trim()) sung.add(`${bar.index}|${beat.playbackStart}`);
  }
  const copy = parse(tex).tracks[index];
  stripContent(copy);
  const result = {notes: 0, bars: 0};
  for(const staff of copy.staves){
    /** @type {?Note} zuletzt behaltener Melodieton; klingt er per Haltebogen weiter, bleibt die Fortsetzung */
    let held = null;
    for(const bar of staff.bars) for(const [v, voice] of bar.voices.entries()){
      for(const beat of voice.beats){
        beat.text = null;
        beat.brushType = alphaTab.model.BrushType.None;
        beat.pickStroke = alphaTab.model.PickStroke.None;
        let keep = null;
        if(v === 0 && sung.has(`${bar.index}|${beat.playbackStart}`)){
          keep = beat.notes.reduce((a, n) => (!a || n.realValue > a.realValue ? n : a), null);
          if(keep){
            keep.isTieDestination = false;
            keep.tieOrigin = null;
            result.notes++;
          }
        } else if(v === 0){
          keep = held && beat.notes.find(n => n.isTieDestination && n.tieOrigin === held) || null;
        }
        for(const note of [...beat.notes]) if(note !== keep) beat.removeNote(note);
        if(v === 0) held = keep;
      }
      if(v === 0 && !mergeRests(alphaTab, voice)) result.bars++;
    }
  }
  copy.name = copy.shortName = freeTrackName(score, 'Melodie', copy);
  insertTrack(score, copy, score.tracks.length);
  setInstrument(alphaTab, copy, instrumentByKey('voice'));
  moveContent(alphaTab, score, 'lyrics', copy.index, 'insert');
  return result;
}

/**
 * Fasst in einer Stimme aufeinanderfolgende Pausen zu möglichst wenigen Notenwerten zusammen (splitTicks()). Schläge
 * mit Tönen bleiben, wie sie sind (dieselben Objekte, gleiche Dauer und gleicher Anfang). Triolen und Vorschläge
 * bleiben ebenfalls, wie sie sind.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Voice} voice Stimme, wird geändert
 * @returns {boolean} ob zusammengefasst wurde (false: Triole oder Vorschlag im Takt)
 */
function mergeRests(alphaTab, voice){
  if(voice.beats.some(b => b.hasTuplet || b.graceType)) return false;
  /** @type {Beat[]} */
  const beats = [];
  /** @type {Beat[]} */
  let run = [];
  const flush = () => {
    if(!run.length) return;
    const ticks = run.reduce((sum, b) => sum + beatTicks(b), 0);
    for(const {duration, dots} of splitTicks(ticks) ?? []){
      const rest = new alphaTab.model.Beat();
      rest.voice = voice;
      rest.dynamics = run[0].dynamics;
      rest.duration = duration;
      rest.dots = dots;
      beats.push(rest);
    }
    run = [];
  };
  for(const beat of voice.beats){
    if(beat.notes.length){
      flush();
      beats.push(beat);
    } else {
      run.push(beat);
    }
  }
  flush();
  voice.beats.splice(0, voice.beats.length, ...beats);
  let start = 0;
  for(const beat of beats){
    beat.playbackStart = start;
    start += beatTicks(beat);
  }
  return true;
}

/**
 * Übernimmt eine Spur aus einem anderen Song (z. B. die Melodie aus einer zweiten Guitar-Pro-Datei) als neue,
 * letzte Spur. Takt "from" der Quelle kommt auf Takt "at" des Songs, die Takte davor sind Pausen, was über das Ende
 * des Songs hinausgeht, fällt weg. Taktart, Tempo, Vorzeichen, Abschnitte usw. bleiben die des Songs, Capo und
 * Tuning der Spur werden auf die des Songs umgerechnet (klingt gleich); Takte, deren Länge nicht
 * zur Taktart passt, meldet das Ergebnis. Akkorde und Text der Quelle kommen nicht mit (siehe duplicateTrack()).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @param {Track} track Spur aus anderen, frisch gelesenen Noten (wird umgehängt)
 * @param {number} from erster Takt der Quelle (Index)
 * @param {number} at Zieltakt dafür (Index)
 * @returns {{bars: number, cut: number, misfit: number[], octaves: number, misses: number}} übernommene Takte,
 *   weggefallene Takte, Indizes der Takte mit falscher Länge, Noten, die für den Capo des Songs eine Oktave höher
 *   kamen, und Noten, die sich nicht auf das Tuning des Songs umrechnen ließen
 */
export function importTrack(alphaTab, score, track, from, at){
  const {model} = alphaTab;
  const settings = new alphaTab.Settings();
  stripContent(track);
  // Capo und Tuning wie der Song (umgerechnet, klingt gleich), damit kein Konflikt entsteht.
  const ref = tuningStaves(score)[0];
  let octaves = 0;
  let misses = 0;
  for(const staff of track.staves){
    if(!ref || !hasStrings(staff)) continue;
    if(staff.tuning.length === ref.tuning.length && staff.tuning.join(',') !== ref.tuning.join(',')){
      misses += setTuning(alphaTab, staff, [...ref.tuning].reverse(), true);
    }
    octaves += moveToCapo(staff, ref.capo);
  }
  track.name = track.shortName = freeTrackName(score, track.name, track);
  let bars = 0;
  let cut = 0;
  /** @type {Set<Bar>} übernommene Takte der ersten Notenzeile */
  let taken = new Set();
  /** @type {number[]} */
  const misfit = [];
  for(const staff of track.staves){
    const sourceBars = staff.bars;
    const clef = sourceBars[0]?.clef ?? model.Clef.G2;
    /** @type {Bar[]} */
    const result = [];
    for(const mb of score.masterBars){
      const source = sourceBars[from + mb.index - at];
      const neighbour = score.tracks[0].staves[0].bars[mb.index];
      if(mb.index >= at && source){
        // Vorzeichen wie im Song (die Noten klingen gleich, nur die Schreibweise folgt der Tonart des Songs).
        source.keySignature = neighbour.keySignature;
        source.keySignatureType = neighbour.keySignatureType;
        result.push(source);
        continue;
      }
      const bar = new model.Bar();
      bar.clef = clef;
      bar.keySignature = neighbour.keySignature;
      bar.keySignatureType = neighbour.keySignatureType;
      const voice = new model.Voice();
      // Pausen so lang wie der Takt (eine Ganze passt nur in 4/4 und würde sonst als zu lang gemeldet).
      for(const {duration, dots} of splitTicks(mb.calculateDuration(false)) ?? [{duration: 1, dots: 0}]){
        const rest = new model.Beat();
        rest.duration = duration;
        rest.dots = dots;
        voice.addBeat(rest);
      }
      bar.addVoice(voice);
      bar.staff = staff;
      result.push(bar);
    }
    if(staff === track.staves[0]){
      taken = new Set(result.filter(b => sourceBars.includes(b)));
      bars = taken.size;
      cut = Math.max(0, sourceBars.length - from - bars);
    }
    staff.bars = [];
    for(const bar of result){
      bar.staff = staff;
      staff.bars.push(bar);
    }
  }
  insertTrack(score, track, score.tracks.length);
  for(const staff of track.staves) for(const bar of staff.bars){
    if(!bar.voices[0]?.beats[0]?.playbackDuration) bar.finish(settings);
    const length = bar.masterBar.calculateDuration();
    const filled = bar.voices[0] ? timeline(bar.voices[0]).at(-1)?.end ?? 0 : 0;
    if(taken.has(bar) && filled !== length) misfit.push(bar.index);
  }
  return {bars, cut, misfit, octaves, misses};
}

/**
 * Legt die Note einer Saite auf eine andere Saite, ohne dass sich der Ton ändert (der Bund wird umgerechnet). Geht
 * nur, wenn die Zielsaite frei ist und der Bund dort zwischen 0 und 24 liegt.
 * @param {Staff} staff Notensystem
 * @param {Beat} beat Schlag
 * @param {number} from Saite der Note
 * @param {number} to Zielsaite
 * @returns {boolean} ob verschoben wurde
 */
export function moveNoteToString(staff, beat, from, to){
  const note = noteOn(beat, from);
  if(!note || from === to || noteOn(beat, to) || to < 1 || to > staff.tuning.length) return false;
  const open = string => staff.tuning[staff.tuning.length - string];
  const fret = note.fret + open(from) - open(to);
  if(fret < 0 || fret > MAX_FRET) return false;
  note.string = to;
  note.fret = fret;
  note.isTieDestination = false;
  return true;
}

// --------------------------------------------------------------------------------------------------------------------
// Transponieren
// --------------------------------------------------------------------------------------------------------------------

/**
 * Transponieren im Bearbeitungsmodus.
 *
 * Die Funktion schreibt die Noten um und speichert keine Verschiebung: Töne, Tabs, Akkordnamen samt Griffen und
 * Vorzeichen stehen danach in der neuen Tonart in den Noten. Den Capo rührt sie nicht an (die Bünde zählen ab dem
 * Capo); den ändert man getrennt, und dabei bleiben die Griffe (setCapo() in notation.js). Beides zusammen
 * ergibt z. B. "−2 transponieren und Capo 2": gleiche Tonhöhe wie vorher, aber andere, leichtere Griffe. Die Audiospur
 * lässt sich nicht verschieben und klingt weiter im Original.
 *
 * Wahl der Griffe (stringedStaff()): Je Notensystem mit Saiten und je Stimme geht die Funktion Schlag für Schlag durch
 * die Noten. Zu jedem Schlag gibt es mehrere mögliche Verteilungen der neuen Töne auf die Saiten; gewählt wird die mit
 * den geringsten Kosten:
 *
 * - Die Greifhand erreicht höchstens vier Bünde (sonst hohe Strafe),
 * - leere Saiten und tiefe Lagen sind günstig, hohe Bünde teurer,
 * - die Lage (mittlerer Bund der gegriffenen Töne) soll sich gegenüber dem Schlag davor wenig ändern,
 * - die Töne bleiben möglichst auf den Saiten, auf denen sie waren (eine Melodie springt nicht quer über das Griffbrett,
 *   ein Picking Pattern behält seine Saiten),
 * - eine Oktave verschoben wird ein Ton nur, wenn die Töne des Schlags sonst nicht alle zu greifen sind.
 *
 * Gebundene Noten folgen ihrer Ausgangsnote. Liegt ein Ton außerhalb des Griffbretts, kommt er eine Oktave näher
 * (gezählt, der Editor meldet es). Schlagzeug bleibt, Flageoletts ebenfalls (gezählt). Ohne DOM.
 */

/** Größte Verschiebung in Halbtönen (nach oben und unten). */
export const SHIFT_MAX = 12;

/** Größte Spanne der Greifhand in Bünden, ohne Strafe. */
const HAND_SPAN = 4;
/** Strafe je Bund über der Spanne. */
const SPAN_PENALTY = 6;
/** Strafe je Bund Lagenwechsel gegenüber dem Schlag davor. */
const POSITION_JUMP = 0.5;
/** Strafe je Bund (mittlerer Bund) für hohe Lagen. */
const POSITION_HEIGHT = 0.1;
/** Strafe je Bund über dem 7. Bund, je gegriffener Note. */
const HIGH_FRET = 0.12;
/** Bonus (Abzug) je leerer Saite. */
const OPEN_BONUS = 0.6;
/** Strafe je Oktave, um die ein Ton verschoben wird, weil er sonst nicht zu greifen wäre. */
const OCTAVE_PENALTY = 5;
/** Strafe je Saite, um die ein Ton von seiner alten Saite abweicht. */
const STRING_MOVE = 0.9;

/**
 * Ergebnis des Transponierens.
 * @typedef {Object} TransposeResult
 * @property {number} notes Zahl der verschobenen Noten
 * @property {number} octaves Noten, die nur eine Oktave näher auf das Griffbrett passten
 * @property {number} skipped Noten, die unverändert blieben (Flageoletts)
 * @property {number} chords umbenannte Akkorde (Namen in allen Spuren)
 */

/**
 * Setzt das Instrument einer Spur (MIDI-Programm). Dazu gehören die Instrumentwechsel an den Schlägen (Automation
 * "Instrument"), die Guitar Pro am Anfang jeder Spur ablegt: Sie überstimmen sonst das Programm der Spur, und der
 * Synth klänge unverändert.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Track} track Spur, wird geändert
 * @param {number} program MIDI-Programm (0 bis 127)
 * @returns {void}
 */
export function setTrackProgram(alphaTab, track, program){
  const old = track.playbackInfo.program;
  track.playbackInfo.program = program;
  const type = alphaTab.model.AutomationType.Instrument;
  for(const staff of track.staves) for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats){
    for(const automation of beat.automations){
      if(automation.type === type && automation.value === old) automation.value = program;
    }
  }
}

/**
 * Ein Instrument einer Spur: der Klang (General-MIDI-Programm; Liste und Regeln in docs/Instrumente.md). Die Lage der
 * Noten hängt nicht am Instrument: Jede Spur ist Gitarren-Tab und wird wie Gitarre notiert (TAB_NOTATION).
 * @typedef {Object} Instrument
 * @property {string} key Schlüssel, z. B. "guitar"
 * @property {string} name Name in der Auswahlliste, z. B. "Akustikgitarre"
 * @property {?number} program MIDI-Programm des Klangs; null beim Schlagzeug (Schlagzeugkanal)
 * @property {number[]} programs MIDI-Programme, die zu diesem Instrument werden
 * @property {string} examples Instrumente dieser Gruppe für den Tooltip, z. B. "Querflöte, Blockflöte, Panflöte"
 */

/**
 * Ganze Zahlen von a bis b.
 * @param {number} a erste
 * @param {number} b letzte
 * @returns {number[]}
 */
const programRange = (a, b) => Array.from({length: b - a + 1}, (_, i) => a + i);

/**
 * Die Instrumente, die eine Spur haben kann (docs/Instrumente.md), in der Reihenfolge der Auswahlliste.
 * @type {Instrument[]}
 */
export const INSTRUMENTS = [
  {key: 'piano', name: 'Klavier', program: 0, programs: programRange(0, 7),
    examples: 'Flügel, E-Piano, Honky-Tonk, Cembalo, Clavinet'},
  {key: 'mallets', name: 'Xylophon', program: 13, programs: [...programRange(8, 15), 108],
    examples: 'Glockenspiel, Vibraphon, Marimba, Celesta, Spieluhr, Röhrenglocken, Hackbrett, Kalimba'},
  {key: 'organ', name: 'Orgel', program: 16, programs: programRange(16, 23),
    examples: 'Hammond-Orgel, Kirchenorgel, Akkordeon, Bandoneon, Mundharmonika'},
  {key: 'guitar', name: 'Akustikgitarre', program: 25, programs: [24, 25, 46, ...programRange(104, 107)],
    examples: 'Westerngitarre, Konzertgitarre (Nylon), Harfe, Banjo, Sitar, Koto'},
  {key: 'electric', name: 'E-Gitarre', program: 27, programs: programRange(26, 28),
    examples: 'Jazzgitarre, cleane E-Gitarre, gedämpfte E-Gitarre'},
  {key: 'distortion', name: 'E-Gitarre verzerrt', program: 30, programs: programRange(29, 31),
    examples: 'Overdrive, Distortion, Flageolett-Gitarre'},
  {key: 'bass', name: 'Bass', program: 32, programs: programRange(32, 39),
    examples: 'E-Bass, akustischer Bass, Fretless, Slap-Bass, Synth-Bass'},
  {key: 'strings', name: 'Streicher', program: 48, programs: [...programRange(40, 45), ...programRange(47, 51), 110],
    examples: 'Geige, Bratsche, Cello, Kontrabass, Pizzicato, Streichorchester, Fiddle, Pauke'},
  {key: 'voice', name: 'Gesang', program: 53, programs: programRange(52, 54),
    examples: 'Chor, Stimme ("Ooh"), Synth-Stimme'},
  {key: 'brass', name: 'Trompete', program: 56, programs: programRange(56, 63),
    examples: 'Posaune, Tuba, Waldhorn, Blechbläsersatz'},
  {key: 'reed', name: 'Klarinette', program: 71, programs: [...programRange(64, 71), 109, 111],
    examples: 'Saxophon (Sopran, Alt, Tenor, Bariton), Oboe, Englischhorn, Fagott, Dudelsack'},
  {key: 'flute', name: 'Flöte', program: 73, programs: programRange(72, 79),
    examples: 'Querflöte, Blockflöte, Piccolo, Panflöte, Okarina, Pfeifen'},
  {key: 'synth', name: 'Synth', program: 80, programs: [55, ...programRange(80, 103), ...programRange(112, 127)],
    examples: 'Synthesizer (Melodie, Flächen), Klangeffekte, Orchesterschlag, Steel Drums, Geräusche'},
  {key: 'drums', name: 'Schlagzeug', program: null, programs: [], examples: 'Schlagzeug, Percussion'},
];

/** Tiefste leere Saite in der üblichen Lage (MIDI): Gitarre E2, Bass E1. */
const LOW_STRING = {guitar: 40, bass: 28};

/** So weit (Halbtöne) darf die tiefe Saite von der üblichen Lage abweichen, ohne als falsche Oktave zu gelten (Quinte). */
const OCTAVE_TOLERANCE = 7;

/**
 * Instrument nach Schlüssel.
 * @param {string} key Schlüssel (Instrument.key)
 * @returns {Instrument}
 */
export function instrumentByKey(key){
  return INSTRUMENTS.find(i => i.key === key);
}

/**
 * Instrument einer Spur nach den Regeln in docs/Instrumente.md: Schlagzeug am Notensystem, Bass an Saitenzahl und Lage
 * (4 oder 5 Saiten, tiefe Saite unter E2, gleich welches Programm), sonst nach dem MIDI-Programm.
 * @param {Track} track Spur
 * @returns {Instrument}
 */
export function instrumentOf(track){
  const staff = track.staves[0];
  if(staff?.isPercussion) return instrumentByKey('drums');
  if(staff && hasStrings(staff) && [4, 5].includes(staff.tuning.length) && Math.min(...staff.tuning) < LOW_STRING.guitar){
    return instrumentByKey('bass');
  }
  return INSTRUMENTS.find(i => i.programs.includes(track.playbackInfo.program)) ?? instrumentByKey('synth');
}

/**
 * Lage der Noten im Notensystem (displayTranspositionPitch von alphaTab, in alphaTex `\displaytranspose`): Jede Spur
 * ist Gitarren-Tab, ihr Tonraum ist der des Griffbretts. Deshalb wird jede Spur wie Gitarre notiert, eine Oktave höher
 * als sie klingt, gleich welches Instrument sie spielt; dieselben Bünde stehen in allen Spuren gleich hoch.
 */
export const TAB_NOTATION = -12;

/**
 * Notenlage, die ein Notensystem haben soll: TAB_NOTATION mit Saiten, sonst wie klingend.
 * @param {Staff} staff Notensystem
 * @returns {number}
 */
export function notationPitch(staff){
  return hasStrings(staff) ? TAB_NOTATION : 0;
}

/**
 * Setzt das Instrument einer Spur: Klang (setTrackProgram()) und Notenlage aller Notensysteme (notationPitch()). Beim
 * Schlagzeug ändert sich nichts.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Track} track Spur, wird geändert
 * @param {Instrument} instrument Instrument
 * @returns {void}
 */
export function setInstrument(alphaTab, track, instrument){
  if(instrument.program === null) return;
  setTrackProgram(alphaTab, track, instrument.program);
  for(const staff of track.staves) if(!staff.isPercussion) staff.displayTranspositionPitch = notationPitch(staff);
}

/** Bünde über der höchsten leeren Saite, bis zu denen eine Spur ohne Saiten beim Umwandeln liegen soll (toGuitarTab()). */
const TAB_RANGE_FRETS = 12;

/**
 * Macht aus einem Notensystem ohne Saiten (Gesang, Orgel aus Guitar Pro) Gitarren-Tab: Standard-Tuning, kein Capo,
 * Notenlage TAB_NOTATION. Der ganze Satz wandert um so viele Oktaven, dass möglichst viele Töne zwischen der tiefen
 * leeren Saite und dem TAB_RANGE_FRETS. Bund der hohen liegen (bei Gleichstand die kleinste Verschiebung); dann werden
 * die Töne wie beim Transponieren auf Saiten verteilt (stringedStaff()), einzelne Töne, die noch immer nicht zu greifen
 * sind, um eine weitere Oktave.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Staff} staff Notensystem ohne Saiten, wird geändert
 * @returns {{shift: number, octaves: number, skipped: number}} Verschiebung des Satzes in Halbtönen, einzeln oktavierte
 *   und nicht zu greifende Töne
 */
export function toGuitarTab(alphaTab, staff){
  /** @type {Array<{note: Note, pitch: number}>} */
  const notes = [];
  for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats) for(const note of beat.notes){
    notes.push({note, pitch: note.realValueWithoutHarmonic});
  }
  const standard = alphaTab.model.Tuning.getDefaultTuningFor(6);
  staff.stringTuning = new alphaTab.model.Tuning(standard.name, [...standard.tunings], true);
  staff.capo = 0;
  staff.showTablature = true;
  staff.displayTranspositionPitch = TAB_NOTATION;
  const low = Math.min(...staff.tuning);
  const high = Math.max(...staff.tuning) + TAB_RANGE_FRETS;
  const outside = shift => notes.filter(({pitch}) => pitch + shift < low || pitch + shift > high).length;
  const shift = [0, 12, -12, 24, -24, 36, -36].reduce((best, s) => outside(s) < outside(best) ? s : best);
  // Vorläufig alles auf die tiefe Saite (Bund auch außerhalb des Griffbretts); stringedStaff() verteilt neu.
  for(const {note, pitch} of notes){
    note.string = 1;
    note.fret = pitch + shift - openString(staff, 1);
  }
  /** @type {TransposeResult} */
  const result = {notes: 0, octaves: 0, skipped: 0, chords: 0};
  stringedStaff(staff, 0, result);
  return {shift, octaves: result.octaves, skipped: result.skipped};
}

/**
 * Bringt das Tuning eines Notensystems in die übliche Lage (Gitarre um E2, Bass um E1), wenn die tiefe Saite mehr als
 * eine Quinte daneben liegt: um ganze Oktaven; die Bünde bleiben, der Klang wandert um die Oktaven. Das ist der
 * Oktav-Trick aus Guitar Pro (Tuning E3 … mit "gleicher Oktave" statt E2 … eine Oktave höher notiert). Nur für
 * Gitarren (6 Saiten) und den Bass.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Staff} staff Notensystem, wird geändert
 * @param {Instrument} instrument Instrument der Spur (instrumentOf())
 * @returns {number} Verschiebung in Halbtönen (Vielfaches von 12), 0 ohne Änderung
 */
export function normalizeTuningOctave(alphaTab, staff, instrument){
  if(!hasStrings(staff)) return 0;
  const low = instrument.key === 'bass' ? LOW_STRING.bass : staff.tuning.length === 6 ? LOW_STRING.guitar : null;
  if(low === null) return 0;
  const lowest = Math.min(...staff.tuning);
  let shift = 0;
  while(lowest + shift - low > OCTAVE_TOLERANCE) shift -= 12;
  while(low - (lowest + shift) > OCTAVE_TOLERANCE) shift += 12;
  if(!shift) return 0;
  const tuning = staff.tuning.map(p => p + shift);
  staff.stringTuning = new alphaTab.model.Tuning(alphaTab.model.Tuning.findTuning(tuning)?.name ?? '', tuning, false);
  return shift;
}

/**
 * Transponiert alle Noten, Tabs, Akkorde und Vorzeichen eines Songs.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @param {number} semitones Halbtöne nach oben (negativ nach unten)
 * @param {import('./base.js').ChordLibrary} library Akkordkatalog (Griffe für die neuen Akkordnamen)
 * @returns {TransposeResult}
 */
export function transposeScore(alphaTab, score, semitones, library){
  /** @type {TransposeResult} */
  const result = {notes: 0, octaves: 0, skipped: 0, chords: 0};
  if(!semitones) return result;
  const known = {...library};
  for(const track of score.tracks) for(const staff of track.staves){
    if(staff.isPercussion) continue;
    for(const bar of staff.bars) bar.keySignature = transposeKeySignature(bar.keySignature, semitones);
    if(hasStrings(staff)) stringedStaff(staff, semitones, result);
    else pitchedStaff(staff, semitones, result);
    const ungripped = [];
    result.chords += renameChords(staff, semitones, ungripped);
    for(const name of ungripped){
      const grip = findGrips(name, {limit: 1})[0]?.grip;
      if(grip && !known[chordKey(name)]) known[chordKey(name)] = [grip];
    }
  }
  // Griffbilder: für die neuen Namen der Griff aus dem Katalog, sonst der verschobene eigene (renameChords()), sonst
  // ein berechneter Griff (findGrips()).
  normalizeChords(alphaTab, score, known);
  return result;
}

/**
 * Notensystem ohne Saiten (Gesang, Klavier): Oktave und Ton verschieben.
 * @param {Staff} staff Notensystem
 * @param {number} semitones Halbtöne
 * @param {TransposeResult} result wird fortgeschrieben
 * @returns {void}
 */
function pitchedStaff(staff, semitones, result){
  for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats) for(const note of beat.notes){
    const total = note.octave * 12 + note.tone + semitones;
    note.octave = Math.floor(total / 12);
    note.tone = ((total % 12) + 12) % 12;
    result.notes++;
  }
}

/**
 * Eine Verteilung der Töne eines Schlags auf Saiten.
 * @typedef {Object} Placement
 * @property {Array<{note: Note, string: number, fret: number, octave: number}>} notes Zuordnung je Ton (octave: um wie
 *   viele Oktaven der Ton verschoben ist, weil er sonst nicht zu greifen wäre)
 * @property {number} cost Kosten ohne Lagenwechsel
 * @property {?number} position mittlerer Bund der gegriffenen Töne, null, wenn nur leere Saiten klingen
 */

/**
 * Notensystem mit Saiten: Töne um die Halbtöne verschieben und neu greifen.
 * @param {Staff} staff Notensystem
 * @param {number} semitones Halbtöne
 * @param {TransposeResult} result wird fortgeschrieben
 * @returns {void}
 */
function stringedStaff(staff, semitones, result){
  const voices = Math.max(0, ...staff.bars.map(bar => bar.voices.length));
  // Saiten, die in früher bearbeiteten Stimmen zur gleichen Zeit klingen (Takt → [Anfang, Ende, Saite]); eine zweite
  // Stimme (Bass) soll nicht auf die Saite der ersten (Melodie) greifen.
  /** @type {Map<number, Array<[number, number, number]>>} */
  const sounding = new Map();
  for(let v = 0; v < voices; v++){
    let position = null;
    staff.bars.forEach((bar, b) => {
      const beats = bar.voices[v]?.beats ?? [];
      for(const beat of beats){
        if(!beat.notes.length) continue;
        const start = beat.playbackStart;
        const end = start + beat.playbackDuration;
        const blocked = new Set((sounding.get(b) ?? [])
          .filter(([s, e]) => s < end && start < e).map(([, , string]) => string));
        const chosen = chooseBeat(staff, beat, semitones, blocked, position, result);
        for(const {note, string, fret} of chosen.notes){
          note.string = string;
          note.fret = fret;
          const list = sounding.get(b) ?? [];
          list.push([start, end, string]);
          sounding.set(b, list);
        }
        if(chosen.position !== null) position = chosen.position;
      }
    });
  }
}

/**
 * Wählt die Verteilung der Töne eines Schlags auf die Saiten (siehe Kopf der Datei).
 * @param {Staff} staff Notensystem
 * @param {Beat} beat Schlag
 * @param {number} semitones Halbtöne
 * @param {Set<number>} blocked Saiten, die nicht frei sind (andere Stimme, gleiche Zeit)
 * @param {?number} previous Lage des Schlags davor
 * @param {TransposeResult} result wird fortgeschrieben
 * @param {number} [level] Stufe des Versuchs: 0 nur der genaue Ton; 1 auch eine Oktave höher oder tiefer; 2 zusätzlich ohne
 *   Rücksicht auf die Saiten der anderen Stimme und der Bindungen; danach bleiben die Noten, wie sie sind
 * @returns {Placement}
 */
function chooseBeat(staff, beat, semitones, blocked, previous, result, level = 0){
  /** @type {Placement['notes']} */
  const fixed = [];
  /** @type {Note[]} */
  const free = [];
  const used = new Set(blocked);
  let skipped = 0;
  for(const note of beat.notes){
    if(note.isTieDestination && note.tieOrigin){
      // Der Ton klingt weiter: dieselbe Saite und derselbe Bund wie die Ausgangsnote (schon verschoben).
      fixed.push({note, string: note.tieOrigin.string, fret: note.tieOrigin.fret, octave: 0});
      used.add(note.tieOrigin.string);
    } else if(note.harmonicType) {
      // Flageoletts hängen am Bund, nicht an der Tonhöhe: unverändert lassen.
      fixed.push({note, string: note.string, fret: note.fret, octave: 0});
      used.add(note.string);
      skipped++;
    } else {
      free.push(note);
    }
  }
  // Hohe Töne zuerst: Sie haben die wenigsten Möglichkeiten.
  free.sort((a, b) => pitchOf(staff, b) - pitchOf(staff, a));

  /** @type {?Placement} */
  let best = null;
  let bestCost = Infinity;
  const options = free.map(note => optionsFor(staff, note, semitones, level > 0));
  const pick = [];
  const search = (i, taken) => {
    if(i === free.length){
      const placement = evaluate(staff, free, pick, fixed);
      const jump = placement.position !== null && previous !== null ? Math.abs(placement.position - previous) : 0;
      const cost = placement.cost + jump * POSITION_JUMP;
      if(cost < bestCost){
        bestCost = cost;
        best = placement;
      }
      return;
    }
    for(const option of options[i]){
      if(taken.has(option.string)) continue;
      pick[i] = option;
      taken.add(option.string);
      search(i + 1, taken);
      taken.delete(option.string);
    }
  };
  search(0, new Set(level > 1 ? [] : used));
  if(!best){
    // Keine freie Saite für alle Töne (andere Stimme oder Bindung belegt sie): ohne Rücksicht darauf noch einmal; geht auch
    // das nicht, bleiben die Noten, wie sie sind.
    if(level < 2) return chooseBeat(staff, beat, semitones, level < 1 ? blocked : new Set(), previous, result, level + 1);
    result.skipped += free.length;
    return {notes: [...free.map(note => ({note, string: note.string, fret: note.fret, octave: 0})), ...fixed], cost: 0,
      position: null};
  }
  const placement = /** @type {Placement} */ (best);
  placement.notes.push(...fixed);
  result.notes += free.length;
  result.skipped += skipped;
  // Noten, die nur eine Oktave daneben auf das Griffbrett passten (optionsFor()).
  result.octaves += placement.notes.filter(n => n.octave).length;
  return placement;
}

/**
 * Tonhöhe einer Note (MIDI) auf ihrer Saite mit Capo.
 * @param {Staff} staff Notensystem
 * @param {Note} note Note
 * @returns {number}
 */
function pitchOf(staff, note){
  return openString(staff, note.string) + staff.capo + note.fret;
}

/**
 * Mögliche Saiten und Bünde für den neuen Ton einer Note, die tiefsten Bünde zuerst. Mit oktaviert auch der Ton eine
 * Oktave höher bzw. tiefer, und ist der Ton selbst nicht zu greifen (tiefer als die tiefste Saite), nur diese.
 * @param {Staff} staff Notensystem
 * @param {Note} note Note
 * @param {number} semitones Halbtöne
 * @param {boolean} octaves auch andere Oktaven zulassen
 * @returns {Array<{string: number, fret: number, octave: number}>}
 */
function optionsFor(staff, note, semitones, octaves){
  const target = pitchOf(staff, note) + semitones;
  const find = (pitch, octave) => {
    const found = [];
    for(let string = 1; string <= staff.tuning.length; string++){
      const fret = pitch - openString(staff, string) - staff.capo;
      if(fret >= 0 && fret <= MAX_FRET) found.push({string, fret, octave});
    }
    return found;
  };
  let found = find(target, 0);
  if(octaves || !found.length){
    for(const octave of [1, -1, 2, -2, 3, -3]){
      const more = find(target + 12 * octave, octave);
      // Nur die nächste Oktave dazu, solange der genaue Ton passt; sonst die erste, die passt.
      if(more.length && (octaves && Math.abs(octave) === 1 || !found.length)){
        found = found.concat(more);
        if(!octaves) break;
      }
    }
  }
  return found.sort((a, b) => a.fret - b.fret);
}

/**
 * Bewertet eine Verteilung (Kosten ohne Lagenwechsel).
 * @param {Staff} staff Notensystem
 * @param {Note[]} notes Töne
 * @param {Array<{string: number, fret: number, octave: number}>} pick gewählte Saite und Bund je Ton
 * @param {Placement['notes']} fixed feste Töne (Bindungen, Flageoletts)
 * @returns {Placement}
 */
function evaluate(staff, notes, pick, fixed){
  const all = notes.map((note, i) => ({note, string: pick[i].string, fret: pick[i].fret, octave: pick[i].octave}));
  const frets = [...all, ...fixed].map(n => n.fret);
  const fretted = frets.filter(f => f > 0);
  let cost = 0;
  if(fretted.length > 1){
    const span = Math.max(...fretted) - Math.min(...fretted);
    if(span > HAND_SPAN) cost += (span - HAND_SPAN) * SPAN_PENALTY;
  }
  for(const f of fretted) cost += Math.max(0, f - 7) * HIGH_FRET;
  cost -= OPEN_BONUS * frets.filter(f => f === 0).length;
  const position = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : null;
  if(position !== null) cost += position * POSITION_HEIGHT;
  for(const n of all) cost += Math.abs(n.string - n.note.string) * STRING_MOVE + Math.abs(n.octave) * OCTAVE_PENALTY;
  return {notes: all, cost, position};
}

/**
 * Benennt die Akkorde eines Notensystems um (Griffnamen wandern um die Halbtöne, der Capo bleibt). Der Griff der
 * alten Akkorde gilt nur noch, wenn er sich verschieben lässt (Barré ohne leere Saiten); sonst wählt
 * normalizeChords() den des Katalogs.
 * @param {Staff} staff Notensystem
 * @param {number} semitones Halbtöne
 * @param {string[]} ungripped bekommt die neuen Namen ohne eigenen Griff
 * @returns {number} Zahl der umbenannten Akkorde
 */
function renameChords(staff, semitones, ungripped){
  if(!staff.chords?.size) return 0;
  const old = staff.chords;
  /** @type {Map<string, string>} */
  const names = new Map();
  staff.chords = new Map();
  for(const [id, chord] of old){
    const name = transposeChordName(chord.name, semitones);
    names.set(id, name);
    chord.name = name;
    chord.strings = shiftedGrip(chord, semitones);
    if(!chord.strings.length) ungripped.push(name);
    staff.addChord(name, chord);
  }
  for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats){
    if(beat.chordId && names.has(beat.chordId)) beat.chordId = /** @type {string} */ (names.get(beat.chordId));
  }
  return old.size;
}

/**
 * Verschiebt den Griff eines Akkords um die Halbtöne, wenn er beweglich ist: keine leere Saite, alle Bünde danach
 * im Bereich 1 bis MAX_FRET.
 * @param {import('../../types/alphatab').model.Chord} chord Akkord
 * @param {number} semitones Halbtöne
 * @returns {number[]} neue Bünde (alphaTab-Reihenfolge), leer, wenn der Griff nicht beweglich ist
 */
function shiftedGrip(chord, semitones){
  if(!chord.strings.length) return [];
  const frets = parseGrip(gripOf(chord));
  const played = frets.filter(f => f >= 0);
  if(!played.length || played.includes(0)) return [];
  const moved = frets.map(f => f < 0 ? -1 : f + semitones);
  if(moved.some(f => f >= 0 && (f < 1 || f > MAX_FRET))) return [];
  return [...moved].reverse();
}
