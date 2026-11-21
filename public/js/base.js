/**
 * Grundlagen, die alle Teile der Seite brauchen: Akkorde und Griffe, Zugriff auf die API, Symbole, Griffbilder als SVG,
 * Marken der Liederliste, der Hinweis auf alphaTab und das Griffbrett.
 */

import {barreOf} from './chordgrips.js';
import {parseChord} from './chordtheory.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Staff} Staff */
/** @typedef {import('../../types/alphatab').model.Chord} Chord */
/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */

// --------------------------------------------------------------------------------------------------------------------
// Akkorde und Griffe
// --------------------------------------------------------------------------------------------------------------------

/**
 * Akkordkatalog (data/chords.json) und Griffbilder in den Noten.
 *
 * Der Katalog ordnet jedem Akkordnamen (klein geschrieben, z. B. "c", "f#m", "d/f#") seine Griffe in
 * Standard-Tuning zu. Der erste Griff ist der Standard: offen bzw. am einfachsten zu greifen. Ein Griff ist ein
 * String von der tiefen E-Saite aus, "x" für nicht gespielt, z. B. "x32010" (C). Liegt ein Bund über 9, sind die
 * Saiten mit "-" getrennt, z. B. "x-10-12-12-12-10".
 *
 * In den Noten zeigt jede Spur je Akkordname genau ein Griffbild, und zwar das des Katalogs. Nur Akkorde, die
 * der Katalog nicht kennt (oder Spuren in anderem Tuning), behalten ihren Griff aus der Datei. Die
 * Funktionen dieses Abschnitts brauchen kein DOM.
 */

/**
 * Akkordkatalog: Akkordname (klein) → Griffe, Standardgriff zuerst.
 * @typedef {Object<string, string[]>} ChordLibrary
 */

/** Abstände der Saiten zur tiefen E-Saite in Halbtönen bei Standard-Tuning (E A D G H E, tiefe E zuerst). */
const STANDARD_INTERVALS = [0, 5, 10, 15, 19, 24];

/** Ab so vielen gespielten Saiten gilt ein Griff als echter Griff und nicht als Bruchstück einer Melodie. */
const MIN_PLAYED_STRINGS = 3;

/** Höchster Bund, der noch ab dem 1. Bund gezeichnet wird; darüber beginnt das Griffbild beim tiefsten Bund. */
const MAX_FRET_FROM_NUT = 4;

/**
 * Schlüssel eines Akkordnamens im Katalog.
 * @param {string} name Akkordname aus den Noten, z. B. "F#m"
 * @returns {string} z. B. "f#m"
 */
export function chordKey(name){
  return name.trim().toLowerCase();
}

/**
 * Liest einen Griff.
 * @param {string} grip z. B. "x32010" oder "x-10-12-12-12-10"
 * @returns {number[]} Bünde von der tiefen E-Saite aus, -1 = nicht gespielt
 */
export function parseGrip(grip){
  const parts = grip.includes('-') ? grip.split('-') : [...grip];
  return parts.map(f => f === 'x' ? -1 : Number(f));
}

/**
 * Schreibt einen Griff.
 * @param {number[]} frets Bünde von der tiefen E-Saite aus, -1 = nicht gespielt
 * @returns {string} z. B. "x32010"
 */
export function formatGrip(frets){
  const parts = frets.map(f => f < 0 ? 'x' : String(f));
  return parts.join(frets.some(f => f > 9) ? '-' : '');
}

/**
 * Griff eines alphaTab-Akkords. alphaTab zählt die Saiten von der hohen e-Saite aus.
 * @param {Chord} chord Akkord
 * @returns {string} Griff von der tiefen E-Saite aus
 */
export function gripOf(chord){
  return formatGrip([...chord.strings].reverse());
}

/**
 * Anzahl der gespielten Saiten eines Griffs.
 * @param {string} grip Griff
 * @returns {number} gespielte Saiten
 */
export function playedStrings(grip){
  return parseGrip(grip).filter(f => f >= 0).length;
}

/**
 * Prüft, ob ein Notensystem sechs Saiten im Standard-Tuning hat (auch eine Oktave versetzt).
 * @param {Staff} staff Notensystem
 * @returns {boolean} true, wenn der Katalog für dieses Notensystem gilt
 */
export function isStandardTuning(staff){
  const tuning = [...staff.tuning].reverse();
  return tuning.length === STANDARD_INTERVALS.length
    && tuning.every((pitch, i) => pitch - tuning[0] === STANDARD_INTERVALS[i]);
}

/**
 * Bund, bei dem das Griffbild beginnt.
 * @param {number[]} frets Bünde von der tiefen E-Saite aus
 * @returns {number} 1 für Griffe bis zum 4. Bund, sonst der tiefste gegriffene Bund
 */
export function diagramFirstFret(frets){
  const fretted = frets.filter(f => f > 0);
  if(!fretted.length || Math.max(...fretted) <= MAX_FRET_FROM_NUT) return 1;
  return Math.min(...fretted);
}

/**
 * Bund eines Barrés (ein Finger über mehrere Saiten), siehe barreOf() in chordgrips.js und docs/Akkorddialog.md, Abschnitt 3
 * (F 133211, Bm x24432, F#m xx4222). alphaTab zeichnet den Balken von der ersten bis zur letzten Saite in diesem Bund.
 * @param {number[]} frets Bünde von der tiefen E-Saite aus
 * @returns {?number} Bund, null ohne Barré
 */
export function barreFret(frets){
  return barreOf(frets)?.fret ?? null;
}

/**
 * Wählt das Griffbild eines Akkords: den Standardgriff des Katalogs, sonst den meistgenutzten echten Griff aus
 * der Datei; mit preferOwn umgekehrt (im Bearbeitungsmodus gesetzte Griffe gelten).
 * @param {string} name Akkordname
 * @param {Map<string, number>} ownGrips Griffe aus der Datei mit Anzahl der Schläge
 * @param {?ChordLibrary} library Katalog, null für Notensysteme in anderem Tuning
 * @param {boolean} [preferOwn] eigener Griff vor dem des Katalogs
 * @returns {?string} Griff, null, wenn es keinen echten Griff gibt
 */
export function chooseGrip(name, ownGrips, library, preferOwn = false){
  const known = library?.[chordKey(name)]?.[0];
  const own = [...ownGrips].filter(([grip]) => playedStrings(grip) >= MIN_PLAYED_STRINGS).sort((a, b) => b[1] - a[1]);
  if(preferOwn && own.length) return own[0][0];
  return known ?? own[0]?.[0] ?? null;
}

/** Tonhöhenklassen der Stammtöne (H und B für die deutsche bzw. englische Schreibweise). */
const NOTE_CLASSES = {c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11, h: 11};

/** Stufen einer Dur-Tonleiter in Halbtönen über dem Grundton. */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

/** So viel besser (Anteil passender Töne, Akkorde und Noten zusammen) muss eine Tonart passen, damit sie gilt. */
const KEY_MIN_GAIN = 0.05;

/** So viel schlechter als die beste darf die Tonart des Schlussakkords passen und wird trotzdem genommen. */
const KEY_FINAL_CHORD_TOLERANCE = 0.1;

/**
 * Töne eines Akkordnamens (aus parseChord(), siehe chordtheory.js).
 * @param {string} name Akkordname, z. B. "F#m7" oder "D/F#"
 * @param {number} [transpose=0] Halbtöne nach oben, z. B. der Capo (die Namen sind dann Griffnamen)
 * @returns {?{root: number, minor: boolean, tones: number[]}} Grundton und Töne als Tonhöhenklassen (0 = C),
 *   null bei unlesbarem Namen
 */
export function chordTones(name, transpose = 0){
  const chord = parseChord(name);
  if(!chord) return null;
  const shift = pc => (pc + transpose % 12 + 12) % 12;
  return {root: shift(chord.root), minor: chord.minor, tones: chord.tones.map(shift)};
}

/** Namen der Grundtöne beim Transponieren, wie sie der Katalog führt (C#, D#, F#, G#, aber Bb). */
const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/**
 * Transponiert einen Akkordnamen, samt Basston ("D/F#" um 2 → "E/G#").
 * @param {string} name Akkordname, z. B. "F#m7"
 * @param {number} semitones Halbtöne nach oben (negativ nach unten)
 * @returns {string} transponierter Name; unlesbare Namen und 0 Halbtöne unverändert
 */
export function transposeChordName(name, semitones){
  if(!(semitones % 12)) return name;
  const shift = (letter, sign) => {
    const pc = NOTE_CLASSES[letter.toLowerCase()] + (sign === '#' ? 1 : sign === 'b' ? -1 : 0);
    return ROOT_NAMES[((pc + semitones) % 12 + 24) % 12];
  };
  return name.replace(/^(\s*)([A-Ha-h])([#b]?)([^/]*)(?:\/([A-Ha-h])([#b]?))?/,
    (all, space, root, sign, quality, bass, bassSign) => space + shift(root, sign) + quality
      + (bass ? '/' + shift(bass, bassSign) : ''));
}

/**
 * Grundton der Dur-Tonart zu einer Vorzeichenzahl.
 * @param {number} keySignature Kreuze positiv, Bes negativ (wie bar.keySignature)
 * @returns {number} Tonhöhenklasse
 */
function majorTonic(keySignature){
  return ((keySignature * 7) % 12 + 12) % 12;
}

/**
 * Verschiebt Vorzeichen um Halbtöne (D-Dur mit 2 Kreuzen um 2 nach oben: E-Dur mit 4). Dur und Moll verschieben sich
 * gleich, die Zahl gilt für die Dur-Tonart gleicher Vorzeichen.
 * @param {number} keySignature Kreuze positiv, Bes negativ (wie bar.keySignature)
 * @param {number} semitones Halbtöne nach oben (negativ nach unten)
 * @returns {number} neue Vorzeichenzahl mit möglichst wenigen Vorzeichen
 */
export function transposeKeySignature(keySignature, semitones){
  return keySignatureOf(((majorTonic(keySignature) + semitones) % 12 + 12) % 12, false);
}

/**
 * Vorzeichenzahl einer Tonart, möglichst wenige Vorzeichen (Fis-Dur statt Ges-Dur nur bei Gleichstand nicht).
 * @param {number} tonic Grundton als Tonhöhenklasse
 * @param {boolean} minor Moll
 * @returns {number} -6 bis 6
 */
function keySignatureOf(tonic, minor){
  const major = minor ? (tonic + 3) % 12 : tonic;
  for(let s = 0; s <= 6; s++){
    if(majorTonic(s) === major) return s;
    if(majorTonic(-s) === major) return -s;
  }
  return 0;
}

/**
 * Erkennt die Tonart aus den Akkorden (klingend, also mit Capo gerechnet) und den gespielten Tönen und vergleicht
 * sie mit den notierten Vorzeichen. Viele GP-Dateien haben gar keine Vorzeichen, obwohl das Lied etwa in A steht.
 * Gewählt wird die Tonleiter, in die Akkorde und Töne am besten passen; Grundton ist der Schlussakkord, wenn seine
 * Tonart kaum schlechter passt (A-Dur mit G-Akkord, also A-Mixolydisch, wird A-Dur, nicht D-Dur). Gedacht für
 * Vorschläge im Editor; der Import ändert die Vorzeichen nicht.
 * @param {Score} score Noten
 * @returns {?{keySignature: number, minor: boolean}} bessere Vorzeichen, null, wenn die notierten passen, die
 *   Vorzeichen im Lied wechseln oder es keine Akkorde gibt
 */
export function detectKeySignature(score){
  /** @type {Staff[]} */
  const staves = [];
  for(const track of score.tracks) staves.push(...track.staves);
  const signatures = new Set(staves.flatMap(st => st.bars.map(bar => `${bar.keySignature}/${bar.keySignatureType}`)));
  if(signatures.size !== 1) return null;
  const current = staves[0].bars[0].keySignature;

  const chords = [];
  let last = null;
  const notes = Array(12).fill(0);
  for(const staff of staves) for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats){
    for(const note of beat.notes) notes[note.realValue % 12] += beat.playbackDuration;
    const chord = beat.chordId ? staff.chords?.get(beat.chordId) : null;
    const tones = chord ? chordTones(chord.name, staff.capo) : null;
    if(!tones) continue;
    chords.push(tones);
    if(staff === staves.find(st => st.chords?.size)) last = tones;
  }
  if(!chords.length || !last) return null;
  const allNotes = notes.reduce((a, b) => a + b, 0) || 1;
  const fit = s => {
    const inScale = pc => MAJOR_SCALE.includes((pc - majorTonic(s) + 12) % 12);
    const chordFit = chords.reduce((sum, c) => sum + c.tones.filter(inScale).length / c.tones.length, 0) / chords.length;
    const noteFit = notes.reduce((sum, d, pc) => sum + (inScale(pc) ? d : 0), 0) / allNotes;
    return chordFit + noteFit;
  };

  let best = current;
  for(let s = -6; s <= 6; s++) if(fit(s) > fit(best) + 1e-9) best = s;
  const final = keySignatureOf(last.root, last.minor);
  const chosen = fit(final) >= fit(best) - KEY_FINAL_CHORD_TOLERANCE ? final : best;
  if(fit(chosen) < fit(current) + KEY_MIN_GAIN) return null;
  // Moll, wenn der Schlussakkord Moll ist und auf der Moll-Tonika der gewählten Vorzeichen steht.
  const minor = last.minor && (last.root + 3) % 12 === majorTonic(chosen);
  return {keySignature: chosen, minor};
}

/**
 * Vereinheitlicht die Griffbilder: Jede Spur bekommt je angeschlagenem Akkordnamen genau einen Akkord mit
 * sichtbarem Griffbild (siehe chooseGrip()), samt Barré (siehe barreFret()); ungenutzte Akkorde fallen weg. Aus GP kommen oft mehrere Akkorde
 * gleichen Namens, teils Bruchstücke oder ausgeblendet; alphaTex unterscheidet sie ohnehin nur nach dem Namen.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @param {ChordLibrary} library Akkordkatalog
 * @param {boolean} [preferOwn] eigene Griffe vor denen des Katalogs (Bearbeitungsmodus, siehe chooseGrip())
 * @returns {void}
 */
export function normalizeChords(alphaTab, score, library, preferOwn = false){
  for(const track of score.tracks) for(const staff of track.staves){
    /** @type {Map<string, Map<string, number>>} */
    const used = new Map();
    const beats = [];
    for(const bar of staff.bars) for(const voice of bar.voices) for(const beat of voice.beats){
      const chord = beat.chordId ? staff.chords?.get(beat.chordId) : null;
      if(!chord) continue;
      const grips = used.get(chord.name) ?? new Map();
      used.set(chord.name, grips);
      if(chord.strings.length) grips.set(gripOf(chord), (grips.get(gripOf(chord)) ?? 0) + 1);
      beats.push([beat, chord.name]);
    }
    staff.chords = new Map();
    for(const [name, grips] of used){
      const chord = new alphaTab.model.Chord();
      chord.name = name;
      const grip = chooseGrip(name, grips, isStandardTuning(staff) ? library : null, preferOwn);
      const frets = grip ? parseGrip(grip) : [];
      chord.strings = [...frets].reverse();
      chord.firstFret = diagramFirstFret(frets);
      const barre = barreFret(frets);
      chord.barreFrets = barre === null ? [] : [barre];
      chord.showDiagram = frets.length > 0;
      chord.showFingering = false;
      staff.addChord(name, chord);
    }
    for(const [beat, name] of beats) beat.chordId = name;
  }
}

/**
 * Gängige Akkorde: Für sie gibt es auf dem Leadsheet kein Griffbild, außer der Song greift sie anders als der
 * Katalog (Erstbefüllung laut Planung: offene Akkorde und ihre 7er). Später kommt das Kennzeichen aus
 * data/chords.json. (Das Transponieren in notation.js nutzt sie nicht.)
 */
export const COMMON_CHORDS = ['C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em', 'C7', 'D7', 'E7', 'G7', 'A7', 'Am7', 'Dm7',
  'Em7'];

// --------------------------------------------------------------------------------------------------------------------
// Zugriff auf die API
// --------------------------------------------------------------------------------------------------------------------

/**
 * Zugriff auf die JSON-API unter api/: Lesen ohne Token, Schreiben mit X-API-Token aus dem localStorage
 * (beim ersten Schreibzugriff per prompt() abgefragt, bei Ablehnung durch den Server vergessen).
 */

/**
 * Eine Datei im Liedordner: score (score.atex, Noten mit Text, Akkorden und Sync-Punkten), audio (audio.mp3) oder
 * cover (cover.jpg). Die Angaben für das Leadsheet stehen in song.json (Feld leadsheet).
 * @typedef {'score'|'audio'|'cover'} SongFile
 */

/**
 * Ein Lied, wie es die API liefert (song.json plus files).
 * @typedef {Object} Song
 * @property {string} slug Ordnername, aus Interpret + Titel gebildet
 * @property {string} title Titel
 * @property {?string} artist Interpret
 * @property {string[]} tags Genres (in der Oberfläche "Genre", mehrere je Song möglich), z. B. ["Rock & Pop"]
 * @property {?string} subtitle Untertitel (wie die folgenden Felder beim Import aus der GP-Datei, vorerst ungenutzt)
 * @property {?string} album Album
 * @property {?string} words Text von
 * @property {?string} music Musik von
 * @property {?string} copyright Copyright
 * @property {?string} tab Tab-Autor
 * @property {?string} instructions Anweisungen
 * @property {?string} notes Notizen, mehrzeilig (beim Import die Beschreibung aus der GP-Datei)
 * @property {{youtube?: string}} sources Herkunft des Rohmaterials (URLs)
 * @property {?number} youtubeSeconds Länge des YouTube-Clips aus sources.youtube in Sekunden; null, wenn unbekannt
 * @property {Leadsheet} [leadsheet] Angaben für das Leadsheet (gespeichert über api/leadsheet.php, siehe dort)
 * @property {boolean} [favorite] Favorit (fehlt, wenn nicht; gesetzt im Formular "Stammdaten")
 * @property {'can'|'practice'|'cannot'} [level] Einstufung: kann ich, übe ich gerade, kann ich nicht (fehlt ohne)
 * @property {string} created Anlagezeitpunkt (ISO 8601)
 * @property {string} updated Änderungszeitpunkt (ISO 8601)
 * @property {SongFile[]} files vorhandene Dateien (berechnet die API bei jedem Lesen), z. B. ["score", "cover"]
 * @property {string[]} tracks Namen der Spuren aus der Partitur (berechnet die API bei jedem Lesen), z. B. ["Guitar"]
 * @property {{show: boolean, mute: boolean}[]} [trackDefaults] Vorgaben je Spur (in der Reihenfolge der Spuren), ob sie in
 *   den Noten angezeigt und gehört wird; gesetzt im Dialog "Spuren" des Editors. Was ein Gerät im Mixer einstellt,
 *   hat dort Vorrang. Fehlt, wenn nie gesetzt.
 */

/** Schlüssel des API-Tokens im localStorage. */
const TOKEN_KEY = 'gitarrenbuch_api_token';

/** Basis-URL der API, relativ zu diesem Modul (funktioniert so auch aus dev/ heraus). */
export const API_URL = new URL('../api/', import.meta.url).href;

/**
 * Maskiert Text für die Ausgabe in HTML.
 * @param {*} str beliebiger Wert, null/undefined ergibt ''
 * @returns {string} HTML-sicherer Text
 */
export function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/**
 * Lädt alle Lieder.
 * @returns {Promise<Song[]>} alphabetisch nach Titel sortiert
 */
export async function loadSongs(){
  const res = await fetch(API_URL + 'songs.php');
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  /** @type {{songs: Song[]}} */
  const data = await res.json();
  return data.songs;
}

/**
 * Ladevorgang des Akkordkatalogs, null bis zum ersten Aufruf von loadChordLibrary().
 * @type {?Promise<ChordLibrary>}
 */
let chordLibraryPromise = null;

/**
 * Lädt den Akkordkatalog (data/chords.json) einmal je Seitenaufruf. Namen, die die Regeln der Akkordtheorie nicht kennen
 * (parseChord() in chordtheory.js), erscheinen nicht.
 * @returns {Promise<ChordLibrary>} Akkordname (klein) → Griffe, Standardgriff zuerst
 */
export function loadChordLibrary(){
  chordLibraryPromise ??= fetch(API_URL + 'chords.php').then(res => {
    if(!res.ok) throw new Error(`Akkordkatalog konnte nicht geladen werden (HTTP ${res.status}).`);
    return /** @type {Promise<ChordLibrary>} */ (res.json());
  }).then(library => {
    /** @type {ChordLibrary} */
    const known = {};
    for(const [name, grips] of Object.entries(library)){
      if(parseChord(name) !== null) known[name] = grips;
    }
    return known;
  });
  // Bei einem Fehler beim nächsten Aufruf neu versuchen.
  void chordLibraryPromise.catch(() => { chordLibraryPromise = null; });
  return chordLibraryPromise;
}

/**
 * Wie loadChordLibrary(), aber ohne Fehler: Kann der Katalog nicht geladen werden, ist er leer.
 * @returns {Promise<ChordLibrary>} Katalog bzw. ein leerer
 */
export async function loadChordLibraryOrEmpty(){
  /** @type {ChordLibrary} */
  const none = {};
  return loadChordLibrary().catch(() => none);
}

/**
 * Lädt, wie oft die Griffe des Akkordkatalogs in den Liedern vorkommen.
 * @returns {Promise<Object<string, Object<string, number>>>} Akkordname (klein) → Griff → Zahl der Schläge; was kein
 *   Lied nutzt, fehlt
 * @throws {Error} wenn der Server nicht antwortet
 */
export async function loadChordUsage(){
  const res = await fetch(API_URL + 'chords.php?usage=1');
  if(!res.ok) throw new Error(`Nutzung der Akkorde konnte nicht geladen werden (HTTP ${res.status}).`);
  return res.json();
}

/**
 * Lädt die Noten eines Lieds (score.atex; data/ liegt außerhalb des Document Root, deshalb über die API).
 * @param {string} slug Slug des Lieds
 * @returns {Promise<string>} alphaTex
 */
export async function loadScoreText(slug){
  const res = await fetch(`${API_URL}score.php?slug=${encodeURIComponent(slug)}`);
  if(!res.ok){
    throw new Error(res.status === 404
      ? 'Keine Noten vorhanden.'
      : `Noten konnten nicht geladen werden (HTTP ${res.status}).`);
  }
  return res.text();
}

/**
 * @typedef {{id: string, time: string, size: number, note: string}} ScoreVersion Aufgehobene Fassung der Noten (siehe
 *   list_score_history() in api/lib/file_store.php): id zum Laden, time "2026-10-31 22:42:55" (Zeitpunkt des
 *   Überschreibens), size in Bytes, note: was sich beim Überschreiben geändert hat (leer ohne Notiz)
 */

/**
 * Listet die aufgehobenen Fassungen der Noten eines Lieds.
 * @param {string} slug Slug des Lieds
 * @returns {Promise<ScoreVersion[]>} die neueste zuerst
 */
export async function loadScoreHistory(slug){
  const res = await fetch(`${API_URL}score.php?slug=${encodeURIComponent(slug)}&history=1`);
  if(!res.ok) throw new Error(`Der Verlauf konnte nicht geladen werden (HTTP ${res.status}).`);
  return /** @type {Promise<ScoreVersion[]>} */ (res.json());
}

/**
 * Lädt eine aufgehobene Fassung der Noten.
 * @param {string} slug Slug des Lieds
 * @param {string} id Kennung aus loadScoreHistory()
 * @returns {Promise<string>} alphaTex
 */
export async function loadScoreVersion(slug, id){
  const res = await fetch(`${API_URL}score.php?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(id)}`);
  if(!res.ok) throw new Error(`Die Fassung konnte nicht geladen werden (HTTP ${res.status}).`);
  return res.text();
}

/**
 * Löscht einen Stand aus dem Verlauf (Noten und Angaben für das Leadsheet).
 * @param {string} slug Slug des Lieds
 * @param {string} id Kennung aus loadScoreHistory()
 * @returns {Promise<ScoreVersion[]>} die übrigen Stände, die neueste zuerst
 */
export function deleteScoreVersion(slug, id){
  return apiWrite(`${API_URL}score.php?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(id)}`,
    {method: 'DELETE'});
}

/**
 * Notiz für den Verlauf als Teil der Adresse.
 * @param {string} note Notiz, leer = keine
 * @returns {string} "&note=…" oder leer
 */
function noteParam(note){
  return note ? `&note=${encodeURIComponent(note)}` : '';
}

/**
 * Ersetzt die Noten eines Lieds (score.atex), z. B. aus dem Sync-Editor.
 * @param {string} slug Slug des Lieds
 * @param {string} tex Noten als alphaTex
 * @param {string} [note] was sich geändert hat (steht im Verlauf beim aufgehobenen Stand)
 * @returns {Promise<Song>} das aktualisierte Lied (der bisherige Stand kommt in den Verlauf)
 */
export function saveScore(slug, tex, note = ''){
  return apiWrite(`${API_URL}score.php?slug=${encodeURIComponent(slug)}${noteParam(note)}`, {
    method: 'PUT',
    headers: {'Content-Type': 'text/plain; charset=utf-8'},
    body: tex,
  });
}

/**
 * Angaben für das Leadsheet (Feld leadsheet in song.json): Patterns, Tab-Stellen, Griffbilder, Links, Spielweise (siehe
 * js/sheet.js und api/leadsheet.php).
 * @typedef {import('./sheet.js').Sheet} Leadsheet
 */

/**
 * Lädt die Angaben für das Leadsheet eines Lieds.
 * @param {string} slug Slug des Lieds
 * @param {string} [version] Kennung eines Stands aus dem Verlauf (loadScoreHistory()); ohne den jetzigen
 * @returns {Promise<Leadsheet>} ohne Datei {patterns: [], tabs: []}
 */
export async function loadLeadsheet(slug, version = ''){
  const res = await fetch(`${API_URL}leadsheet.php?slug=${encodeURIComponent(slug)}`
    + (version ? `&version=${encodeURIComponent(version)}` : ''));
  if(!res.ok) throw new Error(`Angaben für das Leadsheet konnten nicht geladen werden (HTTP ${res.status}).`);
  return res.json();
}

/**
 * Ersetzt die Angaben für das Leadsheet eines Lieds (Feld leadsheet in song.json; ohne Einträge fällt es weg).
 * @param {string} slug Slug des Lieds
 * @param {Leadsheet} leadsheet Inhalt
 * @param {boolean} [keep] ob der bisherige Stand in den Verlauf kommt (false, wenn im selben Speichern schon die Noten
 *   gesichert wurden)
 * @param {string} [note] was sich geändert hat (steht im Verlauf beim aufgehobenen Stand, nur mit keep)
 * @returns {Promise<Song>} das aktualisierte Lied
 */
export function saveLeadsheet(slug, leadsheet, keep = true, note = ''){
  return apiWrite(`${API_URL}leadsheet.php?slug=${encodeURIComponent(slug)}${keep ? noteParam(note) : '&keep=0'}`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(leadsheet),
  });
}

/**
 * Lädt den Pattern-Katalog (data/patterns.json, siehe js/sheet.js) samt Verwendung.
 * @returns {Promise<{patterns: import('./sheet.js').Pattern[], usage: Object<string, number>}>} usage: Zahl der
 *   Songs je Pattern
 */
export async function loadPatterns(){
  const res = await fetch(API_URL + 'patterns.php');
  if(!res.ok) throw new Error(`Pattern-Katalog konnte nicht geladen werden (HTTP ${res.status}).`);
  return res.json();
}

/**
 * Ersetzt den Pattern-Katalog.
 * @param {import('./sheet.js').Pattern[]} patterns alle Patterns
 * @returns {Promise<{patterns: import('./sheet.js').Pattern[], usage: Object<string, number>}>}
 */
export function savePatterns(patterns){
  return apiWrite(API_URL + 'patterns.php', {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({patterns}),
  });
}

/**
 * Lädt die Audiospur eines Lieds (audio.mp3).
 * @param {string} slug Slug des Lieds
 * @returns {Promise<Uint8Array>} MP3
 */
export async function loadAudio(slug){
  const res = await fetch(audioUrl(slug));
  if(!res.ok) throw new Error(`Audiospur konnte nicht geladen werden (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * URL der Audiospur eines Lieds (audio.mp3).
 * @param {string} slug Slug des Lieds
 * @returns {string} URL
 */
export function audioUrl(slug){
  return `${API_URL}audio.php?slug=${encodeURIComponent(slug)}`;
}

/**
 * Titel und Länge eines YouTube-Videos.
 * @param {string} url YouTube-URL
 * @returns {Promise<{id: string, title: string, seconds: number}>} Angaben zum Video
 * @throws {Error} wenn die URL kein YouTube-Video ist oder das Video nicht verfügbar ist
 */
export async function loadYoutubeInfo(url){
  const res = await fetch(`${API_URL}youtube.php?${new URLSearchParams({url})}`);
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/**
 * Liest das gespeicherte API-Token.
 * @returns {string} Token oder '', wenn keins gespeichert ist
 */
function getStoredToken(){
  return localStorage.getItem(TOKEN_KEY) || '';
}

/**
 * Löscht das gespeicherte API-Token.
 * @returns {void}
 */
function forgetToken(){
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Holt das gespeicherte API-Token oder fragt es einmalig per prompt() ab und merkt es sich in localStorage.
 * @returns {string} Token oder '', wenn die Eingabe abgebrochen wurde
 */
function requireToken(){
  let token = getStoredToken();
  if(!token){
    token = (window.prompt('API-Token für Änderungen eingeben:') || '').trim();
    if(token) localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}

/**
 * fetch()-Wrapper für schreibende API-Aufrufe: hängt das Token an, wirft bei
 * 401 (und vergisst dann das falsche Token) bzw. anderen Fehlerstatus mit der
 * Server-Fehlermeldung als Error.
 * @param {string} url Endpunkt
 * @param {RequestInit} [options] fetch()-Optionen, die Header werden ergänzt
 * @returns {Promise<*>} dekodierter JSON-Body der Antwort
 */
export async function apiWrite(url, options){
  const token = requireToken();
  if(!token){
    throw new Error('Ohne Token sind keine Änderungen möglich.');
  }
  options = options || {};
  options.headers = Object.assign({}, options.headers, {'X-API-Token': token});

  const res = await fetch(url, options);
  if(res.status === 401){
    forgetToken();
    throw new Error('Token wurde vom Server abgelehnt. Bitte erneut versuchen.');
  }
  const body = await res.json().catch(() => ({}));
  if(!res.ok){
    const msg = body.details ? body.details.join('; ') : (body.error || `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return body;
}

/**
 * Legt ein neues Lied mit Noten an: aus einer importierten GP-Datei oder mit dem Gerüst aus dem Formular.
 * @param {Object} meta Angaben aus der Datei bzw. dem Formular (Felder wie bei PUT api/songs.php, dazu gpSource: die
 *   Quelle der GP-Datei)
 * @param {string} tex Noten als alphaTex (siehe readGpFile() bzw. createScore() in notation.js)
 * @param {?File} [file] Original-GP-Datei; der Server legt sie unter data/songs/<slug>/upload/ ab und löst die Audiospur heraus
 * @returns {Promise<Song>} das neue Lied
 */
export function importSong(meta, tex, file = null){
  const fd = new FormData();
  fd.append('meta', JSON.stringify(meta));
  fd.append('score', tex);
  if(file) fd.append('file', file);
  return apiWrite(API_URL + 'import.php', {method: 'POST', body: fd});
}

/**
 * Ein Treffer der Cover-Suche.
 * @typedef {Object} CoverHit
 * @property {('deezer'|'itunes')} source Quelle
 * @property {string} artist Interpret laut Quelle
 * @property {string} title Titel laut Quelle
 * @property {string} album Album, aus dem das Cover stammt
 * @property {string} url Cover in voller Größe (500 px)
 * @property {string} preview Vorschaubild (250 px)
 */

/**
 * URL des Covers. Das Änderungsdatum hängt als Parameter dran, damit ein neues Cover sofort erscheint.
 * @param {Song} song Lied mit Cover (files enthält "cover")
 * @returns {string} URL von api/cover.php
 */
export function coverUrl(song){
  return `${API_URL}cover.php?slug=${encodeURIComponent(song.slug)}&v=${encodeURIComponent(song.updated)}`;
}

/**
 * Sucht Cover bei Deezer und iTunes.
 * @param {string} artist Interpret (darf leer sein)
 * @param {string} title Titel
 * @returns {Promise<CoverHit[]>} Treffer, Deezer zuerst
 */
export async function searchCovers(artist, title){
  const res = await fetch(`${API_URL}cover.php?${new URLSearchParams({artist, title})}`);
  if(!res.ok) throw new Error(`Cover-Suche fehlgeschlagen (HTTP ${res.status})`);
  /** @type {{results: CoverHit[]}} */
  const data = await res.json();
  return data.results;
}

/**
 * Übernimmt ein Cover aus der Suche.
 * @param {string} slug Slug des Lieds
 * @param {string} url Bild-URL aus searchCovers()
 * @returns {Promise<Song>} das aktualisierte Lied
 */
export function setCover(slug, url){
  return apiWrite(`${API_URL}cover.php?slug=${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({url}),
  });
}

/**
 * Lädt ein eigenes Cover hoch.
 * @param {string} slug Slug des Lieds
 * @param {Blob} jpeg Bild im JPEG-Format (siehe toCoverJpeg() in library.js)
 * @returns {Promise<Song>} das aktualisierte Lied
 */
export function uploadCover(slug, jpeg){
  const fd = new FormData();
  fd.append('file', jpeg, 'cover.jpg');
  return apiWrite(`${API_URL}cover.php?slug=${encodeURIComponent(slug)}`, {method: 'POST', body: fd});
}

/**
 * Entfernt das Cover.
 * @param {string} slug Slug des Lieds
 * @returns {Promise<Song>} das aktualisierte Lied
 */
export function deleteCover(slug){
  return apiWrite(`${API_URL}cover.php?slug=${encodeURIComponent(slug)}`, {method: 'DELETE'});
}

/**
 * Eine hochgeladene Datei eines Lieds (data/songs/<slug>/upload/, siehe api/uploads.php).
 * @typedef {Object} Upload
 * @property {string} file Dateiname
 * @property {number} size Größe in Bytes
 * @property {string} source Quelle, meist eine URL ("" ohne Angabe)
 * @property {string} description Beschreibung ("" ohne Angabe)
 * @property {string} added Datum der Aufnahme (ISO 8601)
 */

/**
 * URL einer hochgeladenen Datei.
 * @param {string} slug Slug des Lieds
 * @param {string} file Dateiname
 * @returns {string} URL von api/uploads.php
 */
export function uploadUrl(slug, file){
  return `${API_URL}uploads.php?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(file)}`;
}

/**
 * Listet die hochgeladenen Dateien eines Lieds, die ältesten zuerst.
 * @param {string} slug Slug des Lieds
 * @returns {Promise<Upload[]>} Uploads
 * @throws {Error} wenn der Server nicht antwortet
 */
export async function listUploads(slug){
  const res = await fetch(`${API_URL}uploads.php?slug=${encodeURIComponent(slug)}`);
  if(!res.ok) throw new Error(`Uploads nicht geladen (HTTP ${res.status})`);
  /** @type {{uploads: Upload[]}} */
  const body = await res.json();
  return body.uploads;
}

/**
 * Lädt eine hochgeladene Datei vom Server.
 * @param {string} slug Slug des Lieds
 * @param {string} file Dateiname
 * @returns {Promise<File>} die Datei mit ihrem Namen
 * @throws {Error} wenn der Server nicht antwortet
 */
export async function fetchUpload(slug, file){
  const res = await fetch(uploadUrl(slug, file));
  if(!res.ok) throw new Error(`${file} nicht geladen (HTTP ${res.status})`);
  return new File([await res.blob()], file);
}

/**
 * Legt eine Datei als Upload eines Lieds ab: entweder die Datei selbst oder ein Direktlink, von dem der Server sie
 * lädt.
 * @param {string} slug Slug des Lieds
 * @param {{file?: ?File, url?: string, source?: string, description?: string}} upload Datei oder Link (einer von
 *   beiden), Quelle (ohne Angabe gilt bei einem Link der Link) und Beschreibung
 * @returns {Promise<Upload>} der Upload
 */
export function addUpload(slug, {file = null, url = '', source = '', description = ''}){
  const fd = new FormData();
  if(file) fd.append('file', file);
  if(url) fd.append('url', url);
  fd.append('source', source);
  fd.append('description', description);
  return apiWrite(`${API_URL}uploads.php?slug=${encodeURIComponent(slug)}`, {method: 'POST', body: fd});
}

/**
 * Ändert Quelle und Beschreibung eines Uploads.
 * @param {string} slug Slug des Lieds
 * @param {string} file Dateiname
 * @param {{source: string, description: string}} info neue Angaben
 * @returns {Promise<Upload>} der Upload
 */
export function updateUpload(slug, file, info){
  return apiWrite(`${API_URL}uploads.php?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(file)}`, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(info),
  });
}

/**
 * Löscht einen Upload samt seinen Angaben.
 * @param {string} slug Slug des Lieds
 * @param {string} file Dateiname
 * @returns {Promise<{uploads: Upload[]}>} die übrigen Uploads
 */
export function deleteUpload(slug, file){
  return apiWrite(`${API_URL}uploads.php?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(file)}`,
    {method: 'DELETE'});
}

/**
 * Formatiert eine Zeitspanne.
 * @param {number} ms Millisekunden
 * @returns {string} m:ss
 */
export function formatTime(ms){
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// --------------------------------------------------------------------------------------------------------------------
// Symbole
// --------------------------------------------------------------------------------------------------------------------

/**
 * Symbole für die Knöpfe des Bearbeitungsmodus, selbst gezeichnet als SVG (24 × 24, in currentColor), dazu Zeichen
 * der Notenschrift Bravura (SMuFL, SIL Open Font License), die alphaTab mitbringt. Speichern, Rückgängig und
 * Wiederholen sind aus den Material Icons (Apache 2.0).
 */

/** Gemeinsame Attribute der gezeichneten Symbole: Linien in currentColor, runde Enden. */
const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/**
 * Inhalt der SVG-Symbole (ohne <svg>), viewBox 0 0 24 24.
 * @type {Object<string, string>}
 */
const PATHS = {
  // Material Icons (Apache 2.0)
  save: '<path fill="currentColor" stroke="none" d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4z'
    + 'm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/>',
  // Triolen-Feeling, viewBox 0 0 48 24 (svgIcon(name, 48)): zwei Achtel = zwei Achtel gebalkt (gerade) bzw. = Triole aus
  // Viertel und Achtel (Shuffle)
  feelStraight: '<g fill="currentColor" stroke="none"><ellipse cx="5" cy="18" rx="3" ry="2.2"/>'
    + '<ellipse cx="16" cy="18" rx="3" ry="2.2"/><ellipse cx="35" cy="18" rx="3" ry="2.2"/>'
    + '<ellipse cx="44" cy="18" rx="3" ry="2.2"/></g>'
    + '<g stroke-width="1.6"><path d="M7.8 18V6M18.8 18V6M37.8 18V6M46.8 18V6"/>'
    + '<path d="M7.8 6q4 1 4 6M18.8 6q4 1 4 6"/><path d="M24.5 10.5h6M24.5 14.5h6"/></g>'
    + '<path d="M37.8 6.8h9" stroke-width="3"/>',
  feelShuffle: '<g fill="currentColor" stroke="none"><ellipse cx="5" cy="19" rx="3" ry="2.2"/>'
    + '<ellipse cx="14" cy="19" rx="3" ry="2.2"/><ellipse cx="33" cy="19" rx="3" ry="2.2"/>'
    + '<ellipse cx="43" cy="19" rx="3" ry="2.2"/>'
    + '<text x="40.5" y="7" font-size="7" font-weight="700" text-anchor="middle" font-family="sans-serif">3</text></g>'
    + '<g stroke-width="1.6"><path d="M7.8 19V8M16.8 19V8M35.8 19V10M45.8 19V10"/>'
    + '<path d="M45.8 10q4 1 2.5 7"/><path d="M23 11h6M23 15h6"/>'
    + '<path d="M32 8.5V4h6M43 4h5v4.5" stroke-width="1.2"/></g>'
    + '<path d="M7.8 8.8h9" stroke-width="3"/>',
  // Transponieren: Pfeil nach oben und nach unten.
  transpose: '<path d="M7 20V5M3 9l4-4 4 4M17 4v15M13 15l4 4 4-4"/>',
  // Achtelnote (Melodie): Hals mit Fähnchen und gefüllter Notenkopf
  melodyNote: '<path d="M15 3v14M15 3q1 4 5 6"/><ellipse fill="currentColor" stroke="none" cx="11" cy="17.5" rx="4.2" ry="3"'
    + ' transform="rotate(-20 11 17.5)"/>',
  // Betonung (Akzent): kurzes, kräftiges ">"
  accent: '<path stroke-width="2.6" d="M7 7.5l10 4.5-10 4.5"/>',
  // Ausblenden: Decrescendo-Gabel mit leicht geschwungenen Linien wie in alphaTab, schließt sich nach rechts
  fadeOut: '<path d="M3 5Q11 10 21 12M3 19Q11 14 21 12"/>',
  // Slash-Note (Rhythmus ohne Tonhöhe): Hals und schräger Notenkopf
  slashNote: '<path d="M16 3v14"/><path fill="currentColor" stroke="none" d="M7 21h3.5l6-5.5H13z"/>',
  // Bereinigen: Besen (Stiel schräg nach oben rechts, Borsten unten links)
  clean: '<path d="M20.5 3.5L13 11"/><path d="M10.5 9.5l4 4c-.6 3-2.6 5.4-5 6.5-2.6-1.2-5-3.6-6.5-6.5 2.6-.6 5-2 7.5-4z"/>'
    + '<path d="M7 18.5l2.5-3M4.6 16.4l3-2.4"/>',
  // Neu laden: Kreispfeil
  reload: '<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/>',
  // Uploads: Büroklammer.
  upload: '<path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/>',
  // Ändern: Stift.
  edit: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1zM14.5 6.5l3 3"/>',
  // Papierkorb.
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  // Verlauf: Uhr mit Pfeil gegen den Uhrzeigersinn.
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 3.5v5h5M12 7.5V12l3 2"/>',
  undo: '<path fill="currentColor" stroke="none" d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 '
    + '12.5 10c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 10.53 17.15 8 12.5 8z"/>',
  redo: '<path fill="currentColor" stroke="none" d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22'
    + 'L3.9 16a8 8 0 0 1 7.6-5.5c1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>',
  // Schlag: Notenkopf mit Hals, daneben Plus bzw. Minus
  insertBeat: '<ellipse cx="7" cy="17" rx="3.2" ry="2.4" fill="currentColor" stroke="none"/><path d="M10 17V5"/>'
    + '<path d="M18 7v8M14 11h8"/>',
  deleteBeat: '<ellipse cx="7" cy="17" rx="3.2" ry="2.4" fill="currentColor" stroke="none"/><path d="M10 17V5"/>'
    + '<path d="M14 11h8"/>',
  // Takt: zwei Taktstriche, dazwischen Plus bzw. Minus
  insertBar: '<path d="M4 4v16M20 4v16M12 8v8M8 12h8"/>',
  deleteBar: '<path d="M4 4v16M20 4v16M8 12h8"/>',
  // Hammer-on / Pull-off: "H/P" über dem Bogen
  hammer: '<g fill="currentColor" stroke="none" font-family="sans-serif" font-size="10" text-anchor="middle">'
    + '<text x="5.5" y="12" font-weight="700">H</text><text x="12" y="12">/</text>'
    + '<text x="18.5" y="12" font-weight="700">P</text></g><path d="M4 21q8-9 16 0"/>',
  // Slide: "sl." über dem Bogen, wie beim Hammer-on
  slide: '<text x="12" y="12" fill="currentColor" stroke="none" font-family="sans-serif" font-size="10.5"'
    + ' font-weight="700" text-anchor="middle">sl.</text><path d="M4 21q8-9 16 0"/>',
  // Bend: waagerecht, dann nach oben gebogen mit Pfeilspitze
  bend: '<path d="M3 19h6q6 0 7-12"/><path d="m12.5 9.5 3.5-4 3 4.5"/>',
  // Vibrato: Wellenlinie
  vibrato: '<path d="M2 12q2.5-5 5 0t5 0 5 0 5 0"/>',
  // Saite dämpfen: Kreuz wie im Tab
  dead: '<path d="M6 6l12 12M18 6 6 18"/>',
  // Halbton höher / tiefer: Pfeil mit "½"
  semitoneUp: '<path d="M7 20V5M3 9l4-4 4 4"/><text x="13" y="17" font-size="9" fill="currentColor" stroke="none"'
    + ' font-family="sans-serif">½</text>',
  semitoneDown: '<path d="M7 4v15M3 15l4 4 4-4"/><text x="13" y="13" font-size="9" fill="currentColor" stroke="none"'
    + ' font-family="sans-serif">½</text>',
  // Anschlagpfeile: Abwärts (von der tiefen zur hohen Saite) steht in den Noten als Pfeil nach oben
  brushDown: '<path d="M12 21V4M7 9l5-5 5 5"/>',
  brushUp: '<path d="M12 3v17M7 15l5 5 5-5"/>',
  // Arpeggio: Wellenlinie senkrecht mit Pfeilspitze, Richtung wie bei den Anschlagpfeilen
  arpeggioDown: '<path d="M12 21q-3-2 0-4t0-4 0-4 0-5"/><path d="M8 8l4-4 4 4"/>',
  arpeggioUp: '<path d="M12 3q3 2 0 4t0 4 0 4 0 5"/><path d="M8 16l4 4 4-4"/>',
  copy: '<path fill="currentColor" stroke="none" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11'
    + 'a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/>',
  // Spuren: drei Zeilen mit Punkt; Leadsheet: Blatt mit Zeilen
  tracks: '<path d="M10 6h10M10 12h10M10 18h10"/><path fill="currentColor" d="M5 6m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M5 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M5 18m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"/>',
  leadsheet: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 11h6M9 14h6M9 17h4"/>',
};

/**
 * Zeichen der Notenschrift Bravura (SMuFL-Codepunkte).
 * @type {Object<string, string>}
 */
export const GLYPHS = {
  whole: '', half: '', quarter: '', eighth: '', sixteenth: '', thirtySecond: '',
  dot: '', tie: '', restQuarter: '',
  sharp: '', flat: '', natural: '',
  pickDown: '', pickUp: '',
  gClef: '',
};

/**
 * Gezeichnetes Symbol als SVG.
 * @param {string} name Schlüssel in PATHS
 * @param {number} [width] Breite der viewBox (Höhe 24); die Symbole sind 24 breit, das Triolen-Feeling 48
 * @returns {string} SVG
 */
export function svgIcon(name, width = 24){
  const height = width > 24 ? 26 : 20; // das breite Triolen-Feeling braucht Platz, damit man es erkennt
  return `<svg viewBox="0 0 ${width} 24" width="${width * height / 24}" height="${height}" aria-hidden="true" ${STROKE}>${PATHS[name]}</svg>`;
}

/**
 * Zeichen der Notenschrift als Inhalt eines Knopfs.
 * @param {string} text Zeichen aus GLYPHS (auch mehrere)
 * @param {boolean} [centered] Zeichen, die um die Mitte stehen (Vorzeichen, Anschlag, Schlüssel); Notenwerte stehen
 *   auf der Grundlinie und ragen nach oben
 * @param {string} [extra] weitere CSS-Klassen (z. B. "smufl-pickdown", siehe app.css)
 * @returns {string} HTML
 */
export function glyph(text, centered = false, extra = ''){
  return `<span class="smufl${centered ? ' smufl-c' : ''}${extra ? ' ' + extra : ''}">${text}</span>`;
}

// --------------------------------------------------------------------------------------------------------------------
// Griffbilder als SVG
// --------------------------------------------------------------------------------------------------------------------

/**
 * Grafiken als SVG-Text: Griffbild eines Akkords (für die Griffbild-Seite, später auch fürs Leadsheet).
 * Gezeichnet wird in currentColor, damit Bildschirm und Druck dieselbe Grafik nutzen.
 */

/** Anzahl der gezeichneten Bünde. */
const FRETS_SHOWN = 5;
/** Abstand der Saiten in SVG-Einheiten. */
const STRING_GAP = 16;
/** Abstand der Bünde in SVG-Einheiten. */
const FRET_GAP = 20;
/** Linker Rand (Platz für die Bundangabe). */
const LEFT = 22;
/** Oberer Rand (Akkordname, Kennzeichen x und o). */
const TOP = 40;

/**
 * Griffbild eines Akkords.
 * @param {string} name Akkordname, steht über dem Griffbild
 * @param {string} grip Griff von der tiefen E-Saite aus, z. B. "x32010"
 * @returns {string} SVG-Element als Text
 */
export function chordDiagramSvg(name, grip){
  const frets = parseGrip(grip);
  const first = diagramFirstFret(frets);
  const strings = frets.length;
  const width = LEFT + (strings - 1) * STRING_GAP + 12;
  const height = TOP + FRETS_SHOWN * FRET_GAP + 8;
  const x = i => LEFT + i * STRING_GAP;
  const y = fret => TOP + (fret - first + 0.5) * FRET_GAP;
  const parts = [];

  parts.push(`<text x="${(LEFT + x(strings - 1)) / 2}" y="14" text-anchor="middle" font-size="14"
    fill="currentColor">${escapeHtml(name)}</text>`);
  // Saiten und Bünde, bei Griffen ab dem 1. Bund ein dicker Sattel.
  for(let i = 0; i < strings; i++){
    parts.push(`<line x1="${x(i)}" y1="${TOP}" x2="${x(i)}" y2="${TOP + FRETS_SHOWN * FRET_GAP}"/>`);
  }
  for(let f = 0; f <= FRETS_SHOWN; f++){
    const w = f === 0 && first === 1 ? 4 : 1;
    parts.push(`<line x1="${x(0)}" y1="${TOP + f * FRET_GAP}" x2="${x(strings - 1)}" y2="${TOP + f * FRET_GAP}"
      stroke-width="${w}"/>`);
  }
  if(first > 1){
    parts.push(`<text class="fret-label" x="${LEFT - 6}" y="${y(first) + 4}" text-anchor="end" font-size="11"
      fill="currentColor">${first}</text>`);
  }
  // Kennzeichen über dem Sattel, Barré, Fingerpunkte.
  frets.forEach((f, i) => {
    if(f < 0) parts.push(`<text x="${x(i)}" y="${TOP - 6}" text-anchor="middle" font-size="12"
      fill="currentColor">×</text>`);
    if(f === 0) parts.push(`<circle cx="${x(i)}" cy="${TOP - 10}" r="4" fill="none"/>`);
  });
  // Barré (barreOf()): von der tiefsten Saite im Barré-Bund bis einschließlich der e-Saite.
  const barre = barreOf(frets);
  if(barre){
    parts.push(`<rect x="${x(barre.from) - 6}" y="${y(barre.fret) - 6}" width="${x(barre.to) - x(barre.from) + 12}" height="12"
      rx="6" fill="currentColor" stroke="none"/>`);
  }
  frets.forEach((f, i) => {
    if(f > 0 && f !== barre?.fret) parts.push(`<circle cx="${x(i)}" cy="${y(f)}" r="6" fill="currentColor" stroke="none"/>`);
  });

  return `<svg class="chord-diagram" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
    role="img" aria-label="${escapeHtml(`${name}: ${grip}`)}" fill="none" stroke="currentColor"
    stroke-width="1">${parts.join('')}</svg>`;
}

// --------------------------------------------------------------------------------------------------------------------
// Marken der Liederliste
// --------------------------------------------------------------------------------------------------------------------

/**
 * Einstufung und Favorit eines Songs, dazu "zuletzt gespielt".
 *
 * - Einstufung: wie gut ich den Song spielen kann: "Kann ich", "Übe ich gerade", "Kann ich nicht" (Feld level in
 *   song.json), dazu der Favorit (Feld favorite). Beides gehört zum Song und wird im Bearbeitungsmodus gesetzt
 *   (Dialog "Stammdaten" im Menü ⋮; openSongForm() in library.js); die Übersicht zeigt es auf der Kachel und filtert
 *   danach. Im Player selbst steht es nicht.
 * - Zuletzt gespielt: je Gerät im localStorage (wann ein Song zuletzt abgespielt wurde); das ist keine Angabe zum
 *   Song, sondern zur Nutzung, und soll ohne Token und ohne Schreiben auf dem Server gehen.
 */

/**
 * Namen der 128 General-MIDI-Instrumente, Index = MIDI-Programm (0 bis 127), für die Testseite dev/instruments.html.
 * Im Dialog "Spuren" gibt es nur die kurze Liste INSTRUMENTS (notation.js, docs/Instrumente.md).
 * @type {string[]}
 */
export const INSTRUMENT_NAMES = [
  'Akustikflügel', 'Helles Klavier', 'E-Flügel', 'Honky-Tonk-Klavier', 'E-Piano 1', 'E-Piano 2', 'Cembalo',
  'Clavinet', 'Celesta', 'Glockenspiel', 'Spieluhr', 'Vibraphon', 'Marimba', 'Xylophon', 'Röhrenglocken', 'Dulcimer',
  'Drawbar-Orgel', 'Percussive-Orgel', 'Rock-Orgel', 'Kirchenorgel', 'Harmonium', 'Akkordeon', 'Mundharmonika',
  'Tango-Akkordeon', 'Akustikgitarre (Nylon)', 'Akustikgitarre (Stahl)', 'E-Gitarre (Jazz)', 'E-Gitarre (clean)',
  'E-Gitarre (gedämpft)', 'E-Gitarre (verzerrt)', 'Distortion-Gitarre', 'Gitarren-Obertöne', 'Akustikbass', 'E-Bass',
  'E-Bass (Plektrum)', 'Fretless-Bass', 'Slap-Bass 1', 'Slap-Bass 2', 'Synth-Bass 1', 'Synth-Bass 2', 'Violine',
  'Bratsche', 'Cello', 'Kontrabass', 'Tremolo-Streicher', 'Pizzicato-Streicher', 'Harfe', 'Pauken',
  'Streicherensemble 1', 'Streicherensemble 2', 'Synth-Streicher 1', 'Synth-Streicher 2', 'Chor Aahs',
  'Gesang (Voice Oohs)', 'Synth-Stimme', 'Orchester-Hit', 'Trompete', 'Posaune', 'Tuba', 'Gedämpfte Trompete',
  'Waldhorn', 'Blechbläsersatz', 'Synth-Blech 1', 'Synth-Blech 2', 'Sopransaxophon', 'Altsaxophon', 'Tenorsaxophon',
  'Baritonsaxophon', 'Oboe', 'Englischhorn', 'Fagott', 'Klarinette', 'Piccolo', 'Flöte', 'Blockflöte', 'Panflöte',
  'Flaschenblasen', 'Shakuhachi', 'Pfeife', 'Okarina', 'Rechteck', 'Sägezahn', 'Calliope', 'Chiff', 'Charang',
  'Stimme', 'Quinten', 'Bass + Lead', 'New Age', 'Warm', 'Polysynth', 'Chor', 'Gestrichen', 'Metallisch', 'Halo',
  'Sweep', 'Regen', 'Soundtrack', 'Kristall', 'Atmosphäre', 'Helligkeit', 'Kobolde', 'Echos', 'Sci-Fi', 'Sitar',
  'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Dudelsack', 'Fiedel', 'Shanai', 'Glöckchen', 'Agogo', 'Steel Drums',
  'Woodblock', 'Taiko', 'Melodic Tom', 'Synth-Drum', 'Umgekehrtes Becken', 'Gitarrenbundgeräusch', 'Atem',
  'Meeresrauschen', 'Vogelgezwitscher', 'Telefonklingeln', 'Hubschrauber', 'Applaus', 'Gewehrschuss'
];

/** Einstufungen: Wert in song.json, Bezeichnung, Kurzform für die Kachel. */
export const LEVELS = [
  {value: 'can', label: 'Kann ich', short: 'kann ich'},
  {value: 'practice', label: 'Übe ich gerade', short: 'übe ich'},
  {value: 'cannot', label: 'Kann ich nicht', short: 'kann ich nicht'},
];

/** Schlüssel im localStorage: wann welcher Song zuletzt abgespielt wurde ({slug: Zeit in ms}). */
const PLAYED_KEY = 'gitarrenbuch_played';

/**
 * Wann die Songs zuletzt abgespielt wurden (auf diesem Gerät).
 * @returns {Object<string, number>} Slug → Zeit in ms; leer, wenn nichts (Gültiges) gespeichert ist
 */
export function playedTimes(){
  try {
    /** @type {?Object<string, number>} */
    const times = JSON.parse(localStorage.getItem(PLAYED_KEY) || '{}');
    return times ?? {};
  } catch(err){
    return {};
  }
}

/**
 * Merkt sich, dass ein Song jetzt abgespielt wird.
 * @param {string} slug Song
 * @returns {void}
 */
export function markPlayed(slug){
  const times = playedTimes();
  times[slug] = Date.now();
  localStorage.setItem(PLAYED_KEY, JSON.stringify(times));
}

// --------------------------------------------------------------------------------------------------------------------
// Hinweis auf alphaTab
// --------------------------------------------------------------------------------------------------------------------

/**
 * Hinweis auf alphaTab mit dem offiziellen Logo in der Fußzeile anzeigen, statt "rendered by alphaTab" unter jedem Tab.
 * Daniel Kuschny, Autor von alphaTab hat genau diese Form gutgeheißen (siehe
 * https://github.com/CoderLine/alphaTab/discussions/1608).
 */

/** Text des Vermerks, den alphaTab unter jede Zeichnung setzt. */
export const ATTRIBUTION_TEXT = 'rendered by alphaTab';

/** Offizielles Logo von alphaTab: lokal abgelegt (zuerst) und von alphatab.net (falls die Datei fehlt). */
export const ALPHATAB_LOGO = {
  local: new URL('../vendor/alphatab/alphatab-official-logo.svg', import.meta.url).href,
  remote: 'https://alphatab.net/img/brand/alphatab-official-logo.svg',
};

/**
 * Fußzeile mit dem Hinweis auf alphaTab.
 * @param {string} place Klasse für die Lage (ls-credit: Leadsheet, player-credit, cmp-credit)
 * @param {string} [what] was alphaTab gezeichnet hat
 * @returns {string} HTML
 */
export function creditHtml(place, what = 'Tabs'){
  return `<p class="credit ${place}">${what} rendered by
    <a href="https://alphatab.net" target="_blank" rel="noopener" title="alphatab.net">
      <img class="credit-logo" alt="alphaTab" src="${ALPHATAB_LOGO.local}">
      <span class="credit-name">alphaTab</span>
    </a></p>`;
}

/**
 * Logos in den Fußzeilen unter root: Fehlt die lokale Datei, kommt das Logo von alphatab.net; geht auch das nicht,
 * wird es entfernt, und der Name steht als Text da.
 * @param {ParentNode} root Bereich mit Fußzeilen
 * @returns {void}
 */
export function useCreditLogos(root){
  for(const logo of /** @type {NodeListOf<HTMLImageElement>} */ (root.querySelectorAll('.credit-logo'))){
    if(logo.dataset.creditWatched) continue;
    logo.dataset.creditWatched = '1';
    const failed = () => {
      if(logo.src !== ALPHATAB_LOGO.remote) logo.src = ALPHATAB_LOGO.remote;
      else logo.remove();
    };
    if(logo.complete && !logo.naturalWidth) failed();
    logo.addEventListener('error', failed);
  }
}

/**
 * Ist das Element der Vermerk "rendered by alphaTab" (ein Stück der Zeichnung mit nur diesem Text)?
 * @param {Element} element Stück der Zeichnung (SVG bzw. dessen Behälter)
 * @returns {boolean}
 */
export function isAttribution(element){
  return element.textContent?.trim() === ATTRIBUTION_TEXT;
}

/**
 * Blendet im Player den Hinweis auf alphaTab aus (wird stattdessen in der Fußzeile angezeigt).
 * AlphaTab zeichnet ihn später nach (beim Scrollen oder Größenänderung).
 * (creditHtml()) unter den Noten.
 * @param {HTMLElement} host Element, in das alphaTab zeichnet
 * @returns {() => void} beendet das Beobachten
 */
export function hideAttribution(host){
  /** @param {ParentNode} root neu eingefügter Teil */
  const sweep = root => {
    const list = root instanceof SVGSVGElement ? [root] : root.querySelectorAll?.('svg') ?? [];
    for(const svg of list){
      // Der Vermerk ist ein kleines Stück mit einem Text; große Stücke (Notenzeilen) gar nicht erst lesen.
      if(svg.childElementCount > 3 || !isAttribution(svg)) continue;
      const piece = /** @type {HTMLElement} */ (svg.closest('.at-surface > *') ?? svg);
      piece.style.display = 'none';
    }
  };
  const observer = new MutationObserver(records => {
    for(const record of records) for(const node of record.addedNodes){
      if(node instanceof Element) sweep(node);
    }
  });
  observer.observe(host, {childList: true, subtree: true});
  sweep(host);
  return () => observer.disconnect();
}

// --------------------------------------------------------------------------------------------------------------------
// Griffbrett
// --------------------------------------------------------------------------------------------------------------------

/**
 * Griffbrett (Dialog aus dem Menü der Songliste): zeichnet das Griffbrett bis zum 15. Bund und markiert, wo gewählte Töne
 * liegen; die Punkte tragen Notennamen oder Intervalle und sind je Intervall eingefärbt. Bei Akkorden und Tonleitern
 * kommen Klammern um die Griffe bzw. Lagen dazu. Standard-Tuning; ohne DOM.
 */

/** Zahl der Bünde. */
export const FRETS = 15;

/** Leere Saiten im Standard-Tuning, die hohe e-Saite zuerst (oben gezeichnet, wie im Tab): MIDI-Tonhöhen. */
const STRINGS = [64, 59, 55, 50, 45, 40];

/** Leere Saiten, die tiefste zuerst (Zählung der Griffe und Lagen: 0 = tiefe E-Saite). */
const LOW_FIRST = [...STRINGS].reverse();

/** Breite des Bereichs, in dem ein Griff bzw. eine Lage liegen darf: vier Bünde (die Greifhand bleibt stehen). */
const HAND_SPAN = 3;

/** Namen der zwölf Töne (wie in den Akkordnamen des Katalogs). */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/** Beschriftung der Auswahl (mit der anderen Schreibweise). */
export const NOTE_LABELS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

/** Kurzschreibweise der Intervalle nach Halbtönen vom Grundton (siehe docs/Musiktheorie.md). */
const INTERVAL_LABELS = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];

/** Namen der Intervalle nach Kurzschreibweise, auch der anderen Schreibweisen (#5, 9 …). */
const INTERVAL_NAMES = {
  '1': 'Prime (Grundton, Oktave)', 'b2': 'kleine Sekunde', '2': 'große Sekunde', 'b3': 'kleine Terz', '3': 'große Terz',
  '4': 'Quarte', '#4': 'übermäßige Quarte', 'b5': 'verminderte Quinte', '5': 'Quinte', '#5': 'übermäßige Quinte',
  'b6': 'kleine Sexte', '6': 'große Sexte', 'b7': 'kleine Septime', '7': 'große Septime',
  'b9': 'kleine None', '9': 'None', '#9': 'übermäßige None',
};

/**
 * Farbe je Intervall (nach Halbtönen vom Grundton), weiße Schrift darauf gut lesbar.
 * @type {string[]}
 */
export const INTERVAL_COLORS = ['#2f6fdc', '#7b4bb3', '#1b9ac4', '#e0832d', '#d6453d', '#4f9a45', '#8a6d3b', '#b8860b',
  '#c2549a', '#1f8f7a', '#6c7280', '#8b2d2d'];

/**
 * @typedef {Object} FretPosition Eine Stelle auf dem Griffbrett.
 * @property {number} s Saite, 0 = tiefe E-Saite … 5 = hohe e-Saite
 * @property {number} fret Bund, 0 = leere Saite
 */

/**
 * @typedef {Object} Structure Ein Eintrag der Auswahl.
 * @property {string} id Kennung
 * @property {string} label Beschriftung in der Auswahlliste
 * @property {string} [suffix] Akkordzeichen nach dem Grundton ("C" + suffix), nur bei Akkorden
 * @property {number[]} intervals Abstände der Töne vom Grundton in Halbtönen, aufsteigend
 * @property {Object<number, string>} [alt] andere Schreibweise einzelner Intervalle (Halbtöne -> Kurzschreibweise), z. B.
 *   {8: '#5'} im übermäßigen Akkord
 */

/**
 * Was das Griffbrett zeigen kann: ein Ton, Akkorde, Tonleitern (je ein Kartenreiter im Dialog).
 * @type {Array<{id: 'note'|'chord'|'scale', group: string, items: Structure[]}>}
 */
export const STRUCTURES = [
  {id: 'note', group: 'Ton', items: [{id: 'note', label: 'Einzelner Ton', suffix: '', intervals: [0]}]},
  {id: 'chord', group: 'Akkord', items: [
    {id: 'major', label: 'Dur-Akkord', suffix: '', intervals: [0, 4, 7]},
    {id: 'minor', label: 'Moll-Akkord', suffix: 'm', intervals: [0, 3, 7]},
    {id: 'dim', label: 'Verminderter Akkord (dim)', suffix: 'dim', intervals: [0, 3, 6]},
    {id: 'aug', label: 'Übermäßiger Akkord (aug)', suffix: 'aug', intervals: [0, 4, 8], alt: {8: '#5'}},
    {id: 'sus2', label: 'Sus2-Akkord', suffix: 'sus2', intervals: [0, 2, 7]},
    {id: 'sus4', label: 'Sus4-Akkord', suffix: 'sus4', intervals: [0, 5, 7]},
    {id: '5', label: 'Powerchord (5)', suffix: '5', intervals: [0, 7]},
    {id: '7', label: 'Dominantseptakkord (7)', suffix: '7', intervals: [0, 4, 7, 10]},
    {id: 'maj7', label: 'Major-Septakkord (maj7)', suffix: 'maj7', intervals: [0, 4, 7, 11]},
    {id: 'm7', label: 'Moll-Septakkord (m7)', suffix: 'm7', intervals: [0, 3, 7, 10]},
    {id: 'mmaj7', label: 'Moll mit großer Septime (mmaj7)', suffix: 'mmaj7', intervals: [0, 3, 7, 11]},
    {id: 'm7b5', label: 'Halbvermindert (m7b5)', suffix: 'm7b5', intervals: [0, 3, 6, 10]},
    {id: 'dim7', label: 'Vollvermindert (dim7)', suffix: 'dim7', intervals: [0, 3, 6, 9]},
    {id: '7sus4', label: 'Septakkord mit Quarte (7sus4)', suffix: '7sus4', intervals: [0, 5, 7, 10]},
    {id: '7#5', label: 'Septakkord übermäßig (7#5)', suffix: '7#5', intervals: [0, 4, 8, 10], alt: {8: '#5'}},
    {id: '7b5', label: 'Septakkord mit b5 (7b5)', suffix: '7b5', intervals: [0, 4, 6, 10]},
    {id: '6', label: 'Dur-Sextakkord (6)', suffix: '6', intervals: [0, 4, 7, 9]},
    {id: 'm6', label: 'Moll-Sextakkord (m6)', suffix: 'm6', intervals: [0, 3, 7, 9]},
    {id: 'add9', label: 'Dur mit None (add9)', suffix: 'add9', intervals: [0, 2, 4, 7], alt: {2: '9'}},
    {id: '9', label: 'Dominantnonakkord (9)', suffix: '9', intervals: [0, 2, 4, 7, 10], alt: {2: '9'}},
    {id: 'maj9', label: 'Major-Nonakkord (maj9)', suffix: 'maj9', intervals: [0, 2, 4, 7, 11], alt: {2: '9'}},
    {id: 'm9', label: 'Moll-Nonakkord (m9)', suffix: 'm9', intervals: [0, 2, 3, 7, 10], alt: {2: '9'}},
    {id: '6/9', label: 'Sext-Non-Akkord (6/9)', suffix: '6/9', intervals: [0, 2, 4, 7, 9], alt: {2: '9'}},
    {id: '7b9', label: 'Septakkord mit b9 (7b9)', suffix: '7b9', intervals: [0, 1, 4, 7, 10], alt: {1: 'b9'}},
    {id: '7#9', label: 'Septakkord mit #9 (7#9)', suffix: '7#9', intervals: [0, 3, 4, 7, 10], alt: {3: '#9'}},
  ]},
  {id: 'scale', group: 'Tonleiter', items: [
    {id: 'scale-major', label: 'Dur-Tonleiter', intervals: [0, 2, 4, 5, 7, 9, 11]},
    {id: 'scale-minor', label: 'Moll-Tonleiter (natürlich)', intervals: [0, 2, 3, 5, 7, 8, 10]},
    {id: 'scale-harm', label: 'Moll-Tonleiter (harmonisch)', intervals: [0, 2, 3, 5, 7, 8, 11]},
    {id: 'scale-melodic', label: 'Moll-Tonleiter (melodisch)', intervals: [0, 2, 3, 5, 7, 9, 11]},
    {id: 'scale-pent-major', label: 'Dur-Pentatonik', intervals: [0, 2, 4, 7, 9]},
    {id: 'scale-pent-minor', label: 'Moll-Pentatonik', intervals: [0, 3, 5, 7, 10]},
    {id: 'scale-blues', label: 'Blues-Tonleiter', intervals: [0, 3, 5, 6, 7, 10]},
    {id: 'scale-dorian', label: 'Dorisch', intervals: [0, 2, 3, 5, 7, 9, 10]},
    {id: 'scale-phrygian', label: 'Phrygisch', intervals: [0, 1, 3, 5, 7, 8, 10]},
    {id: 'scale-lydian', label: 'Lydisch', intervals: [0, 2, 4, 6, 7, 9, 11], alt: {6: '#4'}},
    {id: 'scale-mixolydian', label: 'Mixolydisch', intervals: [0, 2, 4, 5, 7, 9, 10]},
    {id: 'scale-locrian', label: 'Lokrisch', intervals: [0, 1, 3, 5, 6, 8, 10]},
  ]},
];

/**
 * Kurzschreibweise eines Intervalls in einer Auswahl.
 * @param {Structure} item Eintrag der Auswahl
 * @param {number} semitones Halbtöne vom Grundton (0–11)
 * @returns {string} z. B. "b3"
 */
function intervalLabel(item, semitones){
  return item.alt?.[semitones] ?? INTERVAL_LABELS[semitones];
}

/**
 * Griffe eines Akkords in Grundstellung: je Ton eine Saite, auf benachbarten Saiten, der tiefste Ton ist der Grundton, die
 * übrigen Töne liegen in beliebiger Reihenfolge darüber. Alle Töne liegen innerhalb von vier Bünden (leere Saiten
 * zählen als Bund 0). Der Akkord C ergibt z. B. A3 + D2 + G0.
 * @param {number} root Grundton (0 = C … 11 = H)
 * @param {number[]} intervals Abstände der Töne vom Grundton in Halbtönen, aufsteigend
 * @returns {FretPosition[][]} Griffe, je Griff die Töne vom Grundton an
 */
export function chordShapes(root, intervals){
  const count = intervals.length;
  if(count < 2 || count > 5) return [];
  const pitchClasses = intervals.map(i => (root + i) % 12);
  /** @type {FretPosition[][]} */
  const shapes = [];
  for(let first = 0; first + count <= STRINGS.length; first++){
    /**
     * @param {number} k Index der Saite im Griff (0 = tiefste, spielt den Grundton)
     * @param {FretPosition[]} chosen bisher gewählte Stellen
     * @param {number[]} left Töne (Indizes in pitchClasses), die noch fehlen
     * @returns {void}
     */
    const pick = (k, chosen, left) => {
      if(k === count){
        shapes.push(chosen);
        return;
      }
      const s = first + k;
      for(const tone of k === 0 ? [0] : left){
        for(let fret = 0; fret <= FRETS; fret++){
          if((LOW_FIRST[s] + fret) % 12 !== pitchClasses[tone]) continue;
          const next = [...chosen, {s, fret}];
          const frets = next.map(p => p.fret);
          if(Math.max(...frets) - Math.min(...frets) > HAND_SPAN) continue;
          pick(k + 1, next, left.filter(t => t !== tone));
        }
      }
    };
    pick(0, [], pitchClasses.map((_, i) => i).slice(1));
  }
  return shapes.sort((a, b) => Math.min(...a.map(p => p.fret)) - Math.min(...b.map(p => p.fret)));
}

/**
 * Lagen einer Tonleiter: eine Oktave vom Grundton an, die in vier Bünden ohne Handwechsel greifbar ist. Der Grundton ist
 * der tiefste Ton; jeder weitere Ton liegt auf der tiefsten Saite, die ihn im Bereich hat. Die C-Dur-Tonleiter ergibt
 * z. B. A3 + D0 + D2 + D3 + G0 + G2 + B0.
 * @param {number} root Grundton (0 = C … 11 = H)
 * @param {number[]} intervals Abstände der Töne vom Grundton in Halbtönen, aufsteigend
 * @returns {FretPosition[][]} Lagen, je Lage die Töne vom Grundton an
 */
export function scaleShapes(root, intervals){
  /** @type {FretPosition[][]} */
  const shapes = [];
  const seen = new Set();
  for(let low = 0; low + HAND_SPAN <= FRETS; low++){
    for(let first = 0; first < STRINGS.length; first++){
      for(let rootFret = low; rootFret <= low + HAND_SPAN; rootFret++){
        const rootPitch = LOW_FIRST[first] + rootFret;
        if(rootPitch % 12 !== root) continue;
        /** @type {FretPosition[]} */
        const shape = [];
        for(const interval of intervals){
          const target = rootPitch + interval;
          let found = null;
          for(let s = first; s < STRINGS.length && !found; s++){
            const fret = target - LOW_FIRST[s];
            if(fret >= low && fret <= low + HAND_SPAN && fret <= FRETS) found = {s, fret};
          }
          if(!found) break;
          shape.push(found);
        }
        if(shape.length !== intervals.length) continue;
        const key = shape.map(p => `${p.s}:${p.fret}`).join(',');
        if(seen.has(key)) continue;
        seen.add(key);
        shapes.push(shape);
      }
    }
  }
  return shapes.sort((a, b) => Math.min(...a.map(p => p.fret)) - Math.min(...b.map(p => p.fret)));
}

/**
 * Was zu einer Auswahl gehört.
 * @typedef {Object} StructureView
 * @property {number[]} notes Töne (der Grundton zuerst)
 * @property {string} title Überschrift, z. B. "Am: A C E"
 * @property {Object<number, string>} alt andere Schreibweise einzelner Intervalle
 * @property {Array<{semitones: number, label: string, name: string, color: string}>} legend die vorkommenden Intervalle
 * @property {FretPosition[][]} shapes Griffe (Akkord) bzw. Lagen (Tonleiter), leer bei einem Ton
 * @property {'note'|'chord'|'scale'} kind Art der Auswahl
 */

/**
 * Töne, Intervalle und Klammern eines Eintrags der Auswahl.
 * @param {number} root Grundton (0 = C … 11 = H)
 * @param {string} id Eintrag aus STRUCTURES
 * @returns {StructureView} Ansicht der Auswahl
 */
export function structureOf(root, id){
  const group = STRUCTURES.find(g => g.items.some(i => i.id === id)) ?? STRUCTURES[0];
  const item = group.items.find(i => i.id === id) ?? group.items[0];
  const notes = item.intervals.map(i => (root + i) % 12);
  const names = notes.map(n => NOTE_NAMES[n]);
  const legend = item.intervals.map(semitones => {
    const label = intervalLabel(item, semitones);
    return {semitones, label, name: INTERVAL_NAMES[label], color: INTERVAL_COLORS[semitones]};
  });
  const shapes = group.id === 'chord' ? chordShapes(root, item.intervals)
    : group.id === 'scale' ? scaleShapes(root, item.intervals) : [];
  const rootName = NOTE_NAMES[root];
  const short = item.label.replace(/ \(.*\)$/, '');
  let name = `Ton ${rootName}`;
  if(group.id === 'chord') name = `${rootName}${item.suffix ?? ''} (${short})`;
  else if(group.id === 'scale') name = `${rootName}-${/Tonleiter|Pentatonik/.test(short) ? short : short + '-Tonleiter'}`;
  return {
    notes,
    title: group.id === 'note' ? name : `${name}: ${names.join(' ')}`,
    alt: item.alt ?? {},
    legend,
    shapes,
    kind: group.id,
  };
}

const WIDTH = 1000;
const NUT_X = 58;
const FIRST_Y = 30;
const BOARD_STRING_GAP = 30;
const BOTTOM = FIRST_Y + BOARD_STRING_GAP * 5;
/** Bünde mit Markierungspunkt. */
const MARKERS = [3, 5, 7, 9, 12, 15];

/**
 * x-Lage des Bundstabs (wie auf einem echten Griffbrett: die Abstände werden nach oben kleiner; das Ende des 15. Bundes
 * liegt am rechten Rand).
 * @param {number} fret Bund (0 = Sattel)
 * @returns {number} x in der Zeichnung
 */
function fretX(fret){
  const scale = (1 - 2 ** (-fret / 12)) / (1 - 2 ** (-FRETS / 12));
  return NUT_X + (WIDTH - 10 - NUT_X) * scale;
}

/**
 * Mitte eines Punkts: zwischen den Bundstäben, die leere Saite links vom Sattel.
 * @param {FretPosition} position Stelle
 * @returns {{x: number, y: number}} Lage in der Zeichnung
 */
function dotCenter({s, fret}){
  return {
    x: fret ? (fretX(fret - 1) + fretX(fret)) / 2 : NUT_X - 26,
    y: FIRST_Y + BOARD_STRING_GAP * (STRINGS.length - 1 - s),
  };
}

/**
 * @typedef {Object} FretboardOptions Darstellung des Griffbretts.
 * @property {boolean} [intervals] Intervalle statt Notennamen auf die Punkte schreiben
 * @property {Object<number, string>} [alt] andere Schreibweise einzelner Intervalle (Halbtöne -> Kurzschreibweise)
 * @property {FretPosition[][]} [shapes] Griffe bzw. Lagen; an ihren Grundtönen (data-shapes) lassen sie sich anklicken
 * @property {number} [active] Index des umklammerten Griffs bzw. der Lage in shapes (-1: keiner)
 */

/**
 * Zeichnet das Griffbrett mit den Stellen der gewählten Töne. Die Punkte sind nach dem Intervall zum Grundton eingefärbt.
 * @param {number[]} notes gewählte Töne (0 = C … 11 = H)
 * @param {number} [root] Grundton, wird hervorgehoben (-1: keiner)
 * @param {FretboardOptions} [options] Beschriftung und Klammern
 * @returns {string} SVG
 */
export function fretboardSvg(notes, root = -1, options = {}){
  const {intervals = false, alt = {}, shapes = [], active = -1} = options;
  const chosen = new Set(notes);
  const parts = [];
  // Markierungspunkte auf dem Griffbrett
  for(const fret of MARKERS){
    const x = (fretX(fret - 1) + fretX(fret)) / 2;
    const ys = fret === 12 ? [FIRST_Y + BOARD_STRING_GAP * 1.5, FIRST_Y + BOARD_STRING_GAP * 3.5] : [FIRST_Y + BOARD_STRING_GAP * 2.5];
    for(const y of ys) parts.push(`<circle class="fb-marker" cx="${x.toFixed(1)}" cy="${y}" r="7"/>`);
  }
  // Bundstäbe, Sattel, Saiten
  for(let fret = 0; fret <= FRETS; fret++){
    const x = fretX(fret).toFixed(1);
    parts.push(`<line class="${fret ? 'fb-fret' : 'fb-nut'}" x1="${x}" y1="${FIRST_Y}" x2="${x}" y2="${BOTTOM}"/>`);
  }
  STRINGS.forEach((_, i) => {
    const y = FIRST_Y + BOARD_STRING_GAP * i;
    parts.push(`<line class="fb-string" style="stroke-width:${(1 + i * 0.35).toFixed(2)}" x1="${NUT_X}" y1="${y}" `
      + `x2="${WIDTH - 10}" y2="${y}"/>`);
  });
  // Bundnummern
  for(const fret of MARKERS){
    const x = ((fretX(fret - 1) + fretX(fret)) / 2).toFixed(1);
    parts.push(`<text class="fb-number" x="${x}" y="${BOTTOM + 22}" text-anchor="middle">${fret}</text>`);
  }
  // Klammer unter den Punkten: ein breiter, halbtransparenter Linienzug durch die Töne des gewählten Griffs bzw. der Lage
  if(shapes[active]){
    const points = shapes[active].map(p => dotCenter(p)).map(c => `${c.x.toFixed(1)},${c.y}`).join(' ');
    parts.push(`<polyline class="fb-shape" points="${points}"/>`);
  }
  // Grundtöne, an denen ein Griff bzw. eine Lage beginnt: Kennung der Griffe (für den Klick)
  /** @type {Map<string, number[]>} */
  const starts = new Map();
  shapes.forEach((shape, n) => {
    const key = `${shape[0].s}:${shape[0].fret}`;
    starts.set(key, [...(starts.get(key) ?? []), n]);
  });
  // Töne: Leere Saiten links vom Sattel, sonst zwischen den Bundstäben
  STRINGS.forEach((open, i) => {
    const s = STRINGS.length - 1 - i;
    for(let fret = 0; fret <= FRETS; fret++){
      const pitchClass = (open + fret) % 12;
      if(!chosen.has(pitchClass)) continue;
      const {x, y} = dotCenter({s, fret});
      const semitones = root < 0 ? 0 : (pitchClass - root + 12) % 12;
      const color = INTERVAL_COLORS[semitones];
      const label = intervals && root >= 0 ? alt[semitones] ?? INTERVAL_LABELS[semitones] : NOTE_NAMES[pitchClass];
      const begins = starts.get(`${s}:${fret}`);
      parts.push(`<g class="fb-note${fret ? '' : ' fb-open'}${pitchClass === root ? ' fb-root' : ''}${begins ? ' fb-pick' : ''}" `
        + (begins ? `data-shapes="${begins.join(',')}" ` : '') + `style="--fb-color:${color}"><circle cx="${x.toFixed(1)}" cy="${y}" r="12"/>`
        + `<text x="${x.toFixed(1)}" y="${y + 4}" text-anchor="middle">${label}</text></g>`);
    }
  });
  // Namen der leeren Saiten ganz links
  STRINGS.forEach((open, i) => parts.push(`<text class="fb-string-name" x="6" y="${FIRST_Y + BOARD_STRING_GAP * i + 4}">`
    + `${NOTE_NAMES[open % 12]}</text>`));
  return `<svg class="fretboard" viewBox="0 0 ${WIDTH} ${BOTTOM + 34}" role="img" `
    + `aria-label="Griffbrett bis zum ${FRETS}. Bund">${parts.join('')}</svg>`;
}
