/**
 * Bearbeitungsschritte am Modell von alphaTab für den Bearbeitungsmodus (note-editor.js): Bünde setzen und löschen,
 * Dauer, Pausen, Haltebögen, Effekte, Schläge und Takte einfügen und löschen. Jede Funktion ändert nur das Modell;
 * danach schreibt der Editor es als alphaTex und liest es neu ein (so stimmen alle abgeleiteten Werte wie Indizes,
 * Verkettungen und Abspielzeiten wieder). Ohne DOM, deshalb auch in Node nutzbar.
 *
 * Saiten zählen wie in alphaTab: 1 = tiefste Saite. Bearbeitet wird nur die erste Stimme eines Takts (mehrstimmige
 * Songs gibt es nicht, siehe docs/Editor.md).
 */

import {LYRICS_BREAK} from './tracks.js';

/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */
/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Staff} Staff */
/** @typedef {import('../../types/alphatab').model.Bar} Bar */
/** @typedef {import('../../types/alphatab').model.Beat} Beat */
/** @typedef {import('../../types/alphatab').model.Note} Note */
/** @typedef {import('../../types/alphatab').model.Track} Track */

/** Notenwerte von lang nach kurz, wie alphaTab sie zählt (1 = Ganze, 32 = Zweiunddreißigstel). */
export const DURATIONS = [1, 2, 4, 8, 16, 32];

/** Höchster Bund, der sich eingeben lässt. */
export const MAX_FRET = 24;

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
  beat.dots = beat.dots === dots ? 0 : dots;
}

/**
 * Schaltet die Triole um (drei Schläge in der Zeit von zweien).
 * @param {Beat} beat Schlag
 * @returns {void}
 */
export function toggleTriplet(beat){
  const on = beat.tupletNumerator === 3 && beat.tupletDenominator === 2;
  beat.tupletNumerator = on ? -1 : 3;
  beat.tupletDenominator = on ? -1 : 2;
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
 * Schaltet eine Eigenschaft eines Schlags um, z. B. Anschlag oder Anschlagpfeil.
 * @param {Beat} beat Schlag
 * @param {string} prop Eigenschaft von Beat (pickStroke, brushType)
 * @param {number} on Wert für "an"
 * @returns {void}
 */
export function toggleBeatProp(beat, prop, on){
  beat[prop] = beat[prop] === on ? 0 : on;
}

/**
 * Verschiebt die Note auf einer Saite um Halbtöne (Bund ±1), solange sie auf der Saite bleibt.
 * @param {Beat} beat Schlag
 * @param {number} string Saite
 * @param {number} delta +1 oder -1
 * @returns {boolean} ob es eine Note gab und sie sich verschieben ließ
 */
export function shiftSemitone(beat, string, delta){
  const note = noteOn(beat, string);
  if(!note || note.fret + delta < 0 || note.fret + delta > MAX_FRET) return false;
  note.fret += delta;
  note.isTieDestination = false;
  return true;
}

/**
 * Fügt vor einem Schlag einen neuen ein: eine Pause mit derselben Dauer.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Beat} beat Schlag, vor dem eingefügt wird
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

/** Bend um einen Ganzton (alphaTab zählt in Vierteltönen): Punkte [Position 0–60, Höhe]. */
const FULL_BEND = [[0, 0], [15, 4], [60, 4]];

/**
 * Schaltet einen Bend um einen Ganzton auf der Note um (hochziehen und halten); nochmal entfernt ihn.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {?Note} note Note (ohne Note passiert nichts)
 * @returns {boolean} ob es eine Note gab
 */
export function toggleBend(alphaTab, note){
  if(!note) return false;
  if(note.hasBend){
    note.bendPoints = null;
    note.bendType = alphaTab.model.BendType.None;
    return true;
  }
  for(const [offset, value] of FULL_BEND) note.addBendPoint(new alphaTab.model.BendPoint(offset, value));
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
 * Schaltet den doppelten Taktstrich am Ende eines Takts um (in allen Spuren).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @param {number} index Takt
 * @param {boolean} on doppelt
 * @returns {void}
 */
export function setDoubleBar(alphaTab, score, index, on){
  const style = on ? alphaTab.model.BarLineStyle.LightLight : alphaTab.model.BarLineStyle.Automatic;
  for(const track of score.tracks) for(const staff of track.staves) staff.bars[index].barLineRight = style;
}

/**
 * Setzt den Capo aller Spuren mit Saiten. "Klang behalten" rechnet die Bünde und Akkordnamen um (moveToCapo() in
 * tracks.js), "Griffe behalten" ändert nur den Capo, die Noten klingen dann anders.
 * @param {Score} score Noten
 * @param {number} capo neuer Capo
 * @param {boolean} keepSound Klang behalten
 * @param {function(Staff, number): number} moveToCapo Umrechnung aus tracks.js
 * @returns {number} Noten, die nur eine Oktave höher passten
 */
export function setCapo(score, capo, keepSound, moveToCapo){
  let octaves = 0;
  for(const track of score.tracks) for(const staff of track.staves){
    if(!staff.isStringed || !staff.tuning.length) continue;
    if(keepSound) octaves += moveToCapo(staff, capo);
    else staff.capo = capo;
  }
  return octaves;
}

/**
 * Ändert die Stimmung eines Notensystems. "Klang behalten" rechnet jede Note auf derselben Saite um; passt sie dort
 * nicht (unter 0 oder über 24), bleibt der Bund und sie wird gezählt. "Griffe behalten" ändert nur die Stimmung.
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
  // staff.tuning ist nur lesbar; es kommt aus stringTuning (mit dem Namen der bekannten Stimmung, sonst keinem).
  staff.stringTuning = new alphaTab.model.Tuning(alphaTab.model.Tuning.findTuning(next)?.name ?? '', next, false);
  return misses;
}

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
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @returns {{bar: number, pass: number}[]} je gespielter Takt: Index und wievielter Durchgang durch diesen Takt
 */
function playOrder(alphaTab, score){
  const D = alphaTab.model.Direction;
  const bars = score.masterBars;
  const has = (mb, direction) => mb.directions?.has(direction) ?? false;
  const find = direction => bars.findIndex(mb => has(mb, direction));
  const start0 = () => 0;
  const segno = () => find(D.TargetSegno);
  const segnoSegno = () => find(D.TargetSegnoSegno);
  /** @type {Map<number, [function(): number, ?string]>} Sprung → Ziel und Ende (coda, doubleCoda, fine) */
  const jumps = new Map([
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
    order.push({bar: i, pass: seen});
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
    const jump = [...mb.directions ?? []].find(d => jumps.has(d));
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
  const order = playOrder(alphaTab, base);
  if(order.length === base.masterBars.length && !simile && !directions) return null;
  const copiesNeeded = Math.max(...order.map(o => o.pass)) + 2;
  const copies = [base, ...Array.from({length: copiesNeeded - 1}, () => parse(tex))];
  /** @type {Map<number, number>} wie oft ein Takt schon für ein Simile kopiert wurde */
  const simileUse = new Map();

  const masterBars = order.map(({bar, pass}) => {
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
    const bar = source.bars[clip.from + j];
    bar.staff = staff;
    for(const voice of bar.voices) for(const beat of voice.beats){
      if(!beat.chordId) continue;
      const chord = source.chords?.get(beat.chordId);
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
  relinkBars(score);
  return count;
}

/**
 * Liedtext einer Spur als Text: Silben der ersten Strophe in Spielreihenfolge, Wörter durch Leerzeichen getrennt,
 * Silben eines Worts mit Bindestrich (so stehen sie in den Noten: "Frank-" "furt").
 * @param {Track} track Spur
 * @returns {string} z. B. "Ich kam von Frank-furt nach Ber-lin"
 */
export function lyricsText(track){
  let text = '';
  for(const bar of track.staves[0].bars) for(const beat of bar.voices[0]?.beats ?? []){
    const syllable = beat.lyrics?.[0]?.trim();
    if(!syllable) continue;
    text += (text && !text.endsWith('-') ? ' ' : '') + syllable;
  }
  return text;
}

/** Zeile mit einem Abschnittsnamen im Liedtext, z. B. "[Verse]" (siehe lyricsLines() in textview.js). */
const SECTION_LINE = /^\s*\[[^\]]*]\s*$/;

/**
 * Silben eines Liedtexts: an Leerzeichen und nach Bindestrichen getrennt ("Frank-furt" → "Frank-", "furt"). Ein
 * einzelnes "_" lässt einen Schlag ohne Silbe, ein "_" im Wort verbindet zwei Wörter auf einem Schlag ("mir_zu." →
 * "mir zu."). Zeilen mit einem Abschnittsnamen ("[Verse]") zählen nicht. Die letzte Silbe jeder Zeile bekommt den
 * Zeilenumbruch (LYRICS_BREAK in tracks.js), auch am Ende eines Abschnitts und des Texts: Beginnt der nächste
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
 * Fügt eine Gitarrenspur hinzu (Standardstimmung, Akustikgitarre), mit einer Ganztaktpause je Takt.
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
  staff.stringTuning = new model.Tuning('', [64, 59, 55, 50, 45, 40], true);
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
  for(const bar of staff.bars) bar.finish(settings);
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

/**
 * Legt die Note einer Saite auf einen anderen Schlag derselben Spur (auch in einem anderen Takt) und eine Saite nach
 * Wahl, mit demselben Ton (der Bund wird umgerechnet) und ihren Effekten. Geht nur, wenn die Zielsaite dort frei ist
 * und der Bund zwischen 0 und 24 liegt. Bleibt der alte Schlag ohne Note, wird er zur Pause; aus einer Pause am Ziel
 * wird eine Note.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Staff} staff Notensystem
 * @param {Beat} from Schlag der Note
 * @param {number} string Saite der Note
 * @param {Beat} to Zielschlag
 * @param {number} toString Zielsaite
 * @returns {boolean} ob verschoben wurde
 */
export function moveNoteToBeat(alphaTab, staff, from, string, to, toString){
  if(from === to) return moveNoteToString(staff, from, string, toString);
  const note = noteOn(from, string);
  if(!note || noteOn(to, toString) || toString < 1 || toString > staff.tuning.length) return false;
  const open = s => staff.tuning[staff.tuning.length - s];
  const fret = note.fret + open(string) - open(toString);
  if(fret < 0 || fret > MAX_FRET) return false;
  from.removeNote(note);
  note.string = toString;
  note.fret = fret;
  note.isTieDestination = false;
  to.addNote(note);
  if(to.isEmpty || to.voice.isEmpty){
    to.isEmpty = false;
    to.voice.bar.finish(new alphaTab.Settings());
  }
  return true;
}

/**
 * Verschiebt den Taktstrich zwischen einem Takt und dem nächsten in einem Notensystem um ganze Schläge (erste
 * Stimme): nach links (shift < 0) wandern die letzten Schläge des Takts an den Anfang des nächsten, nach rechts die
 * ersten des nächsten an das Ende des Takts, mit Silben, Akkorden und Effekten. In jedem Takt bleibt mindestens ein
 * Schlag; ein leerer Schlag (leerer Takt) am Ziel fällt weg.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Staff} staff Notensystem
 * @param {number} index Takt links vom Taktstrich
 * @param {number} shift Schläge, negativ nach links
 * @returns {number} verschobene Schläge (0, wenn nichts ging)
 */
export function moveBarLine(alphaTab, staff, index, shift){
  const left = staff.bars[index]?.voices[0];
  const right = staff.bars[index + 1]?.voices[0];
  if(!left || !right || !shift) return 0;
  const [source, target] = shift < 0 ? [left, right] : [right, left];
  const count = Math.min(Math.abs(shift), source.beats.filter(b => !b.isEmpty).length - 1);
  if(count < 1) return 0;
  const moved = shift < 0 ? source.beats.splice(source.beats.length - count, count) : source.beats.splice(0, count);
  target.beats = target.beats.filter(b => !b.isEmpty);
  if(shift < 0) target.beats.unshift(...moved);
  else target.beats.push(...moved);
  for(const beat of moved) beat.voice = target;
  const settings = new alphaTab.Settings();
  left.bar.finish(settings);
  right.bar.finish(settings);
  return count;
}
