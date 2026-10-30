/**
 * Spuren eines Songs: Rollen, Herkunft von Text und Akkorden, ein Capo für alle Spuren.
 *
 * Ziel sind feste Rollen mit festen Namen (gespeichert wird der interne Name, angezeigt der deutsche): "vocal"
 * (Gesang, trägt den Text), "strumming" (Schlagbegleitung, trägt die Akkorde), "picking" (Zupfbegleitung, trägt die
 * Akkorde, wenn es keine Schlagbegleitung gibt) und "fingerstyle" (Begleitung und Melodie zugleich, allein spielbar).
 * Nicht jeder Song hat alle vier. Fehlt die Rolle, gilt ersatzweise die Spur mit dem meisten Text bzw. den meisten
 * Akkorden. "voice" wäre missverständlich: So heißen in alphaTab die Stimmen eines Takts (bar.voices). Der Capo gilt
 * für den ganzen Song; Akkorde sind Griffnamen relativ zum Capo, nur die Noten klingen. Das Modul kommt ohne DOM aus
 * und läuft deshalb auch in Node (Korrekturskripte).
 */

import {transposeChordName} from './chords.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Staff} Staff */
/** @typedef {import('../../types/alphatab').model.Track} Track */
/** @typedef {import('../../types/alphatab').model.Beat} Beat */
/** @typedef {import('../../types/alphatab').model.Chord} Chord */

/** Rollen der Spuren: interner Name (so steht er in den Noten) → Anzeige. */
export const TRACK_ROLES = {
  vocal: 'Gesang', strumming: 'Schlagbegleitung', picking: 'Zupfbegleitung', fingerstyle: 'Fingerstyle',
};

/** Spurnamen, die assignTrackRoles() einer Rolle zuordnet (ganzer Name, ohne Groß-/Kleinschreibung). */
const ROLE_ALIASES = {
  vocal: /^(vocals?|voice|lead vocals?|gesang|melodie|melody)$/i,
  strumming: /^(strumming|schlagbegleitung|begleitung|rhythmus|rhythm|rhythm guitar|rhythmusgitarre)$/i,
  picking: /^(picking|finger ?picking|zupfbegleitung|zupfen)$/i,
  fingerstyle: /^(fingerstyle)$/i,
};

/** Höchster Bund, auf den der Capo-Abgleich eine Note legt. */
const MAX_FRET = 24;

/**
 * Rolle einer Spur nach ihrem Namen.
 * @param {Track} track Spur
 * @returns {?string} "vocal", "strumming", "picking" oder "fingerstyle"; null für andere Spuren
 */
export function trackRole(track){
  const name = track.name.trim().toLowerCase();
  return Object.hasOwn(TRACK_ROLES, name) ? name : null;
}

/**
 * Anzeigename einer Spur.
 * @param {string} name Spurname aus den Noten
 * @returns {string} "Gesang", "Schlagbegleitung" usw. für die Rollen (siehe TRACK_ROLES), sonst der Name selbst
 */
export function trackLabel(name){
  return TRACK_ROLES[name.trim().toLowerCase()] ?? name;
}

/**
 * Zählt die Schläge einer Spur, die eine Bedingung erfüllen.
 * @param {Track} track Spur
 * @param {function(Beat): boolean} test Bedingung
 * @returns {number} Anzahl
 */
function countBeats(track, test){
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
function hasLyrics(beat){
  return beat.lyrics?.some(s => s?.trim()) ?? false;
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
 * Spur mit einer Rolle, sofern sie Schläge mit einer Eigenschaft hat.
 * @param {Score} score Noten
 * @param {string} role Rolle (siehe TRACK_ROLES)
 * @param {function(Beat): boolean} test Eigenschaft, z. B. "hat eine Silbe"
 * @returns {?Track} null, wenn es die Rolle nicht gibt oder ihre Spur keinen solchen Schlag hat
 */
function roleTrackWith(score, role, test){
  const track = score.tracks.find(t => trackRole(t) === role);
  return track && countBeats(track, test) > 0 ? track : null;
}

/**
 * Spur, aus der der Text kommt: die Gesangsspur, wenn sie Text hat, sonst die Spur mit dem meisten Text. In vielen
 * importierten Songs heißt eine Spur "Vocal", der Text steht aber in der Gitarrenspur.
 * @param {Score} score Noten
 * @returns {?Track} null, wenn der Song keinen Text hat
 */
export function lyricsTrack(score){
  return roleTrackWith(score, 'vocal', hasLyrics) ?? trackWithMost(score, hasLyrics);
}

/**
 * Spur, aus der die Akkorde kommen: die Schlagbegleitung, sonst die Zupfbegleitung, jeweils nur, wenn sie Akkorde hat;
 * sonst die Spur mit den meisten Akkorden.
 * @param {Score} score Noten
 * @returns {?Track} null, wenn der Song keine Akkorde hat
 */
export function chordsTrack(score){
  const hasChord = beat => !!beat.chordId;
  return roleTrackWith(score, 'strumming', hasChord) ?? roleTrackWith(score, 'picking', hasChord)
    ?? trackWithMost(score, hasChord);
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
 * ein Akkord, gewinnt die erste Begleitspur (chordsTrack()), danach die Spuren in ihrer Reihenfolge. So schreibt der
 * Editor die Akkorde später in die erste Begleitspur; bis dahin zeigt der Player sie nach dieser Regel einmal über
 * den Noten.
 * @param {Score} score Noten
 * @returns {MergedChord[]} nach Tick sortiert
 */
export function mergeChords(score){
  const first = chordsTrack(score);
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

// noinspection JSUnusedGlobalSymbols: für den Editor, noch ohne Aufrufer
/**
 * Benennt Spuren, deren Name eindeutig eine Rolle meint ("Voice", "Rhythmus", …), in den internen Namen um. Eine
 * Rolle bekommt nur eine Spur; passen mehrere, bleiben alle wie sie sind. Für den Editor (Vorschlag beim Umbau);
 * der Import lässt die Spurnamen wie in der Datei.
 * @param {Score} score Noten, werden geändert
 * @returns {void}
 */
export function assignTrackRoles(score){
  for(const [role, alias] of Object.entries(ROLE_ALIASES)){
    if(score.tracks.some(t => trackRole(t) === role)) continue;
    const matches = score.tracks.filter(t => !trackRole(t) && alias.test(t.name.trim()));
    if(matches.length !== 1) continue;
    matches[0].name = matches[0].shortName = role;
  }
}

/**
 * Leere Saite eines Notensystems.
 * @param {Staff} staff Notensystem
 * @param {number} string Saite wie in alphaTab (1 = tiefste)
 * @returns {number} MIDI-Tonhöhe
 */
function openString(staff, string){
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

// noinspection JSUnusedGlobalSymbols: für den Editor, noch ohne Aufrufer
/**
 * Gibt allen Spuren mit Saiten denselben Capo: den der Akkordspur (siehe chordsTrack()), ohne Akkorde den der Spur
 * mit den meisten Noten. Die anderen Spuren werden mit moveToCapo() umgerechnet, sie klingen danach gleich. Für den
 * Editor; der Import lässt den Capo je Spur wie in der Datei.
 * @param {Score} score Noten, werden geändert
 * @returns {{capo: number, moved: string[], octaves: number}} Capo, umgerechnete Spuren, eine Oktave höher gelegte
 *   Noten
 */
export function unifyCapo(score){
  const stringed = score.tracks.flatMap(t => t.staves).filter(st => st.isStringed && st.tuning.length);
  const source = chordsTrack(score) ?? trackWithMost(score, beat => beat.notes.length > 0);
  const capo = source?.staves.find(st => st.isStringed)?.capo ?? 0;
  const moved = [];
  let octaves = 0;
  for(const staff of stringed){
    if(staff.capo === capo) continue;
    moved.push(staff.track.name);
    octaves += moveToCapo(staff, capo);
  }
  return {capo, moved, octaves};
}

