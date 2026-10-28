/**
 * Notenformat des Gitarrenbuchs: Gespeichert wird alphaTex (score.atex), das Textformat von alphaTab. Hier
 * steckt alles, was zwischen alphaTex und Guitar Pro übersetzt: GP-Datei beim Import umwandeln und prüfen, Gerüst
 * für einen neuen Song anlegen, GP-Datei für den Download erzeugen, Eckdaten (Tonart, Capo, …) aus den Noten lesen.
 *
 * Titel, Interpret und die übrigen Angaben stehen nur in song.json. Im alphaTex fehlen sie; zum Anzeigen und beim
 * GP-Export werden sie ins Modell eingesetzt.
 */

import {escapeHtml} from './api.js';

/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */
/** @typedef {import('../../types/alphatab').model.Score} Score */

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

/** Standardstimmung als MIDI-Noten, tiefe bis hohe Saite (E2 A2 D3 G3 B3 E4). */
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
 * @property {string} key Tonart, z. B. "A" oder "Em"
 * @property {number} capo Bund des Kapodasters, 0 ohne
 * @property {string} tuning Stimmung von der tiefen zur hohen Saite, z. B. "E A D G B E"; leer ohne Saiten
 * @property {number} tempo Anfangstempo in BPM
 * @property {?number} recordedTempo Anfangstempo, wie es in der Aufnahme klingt (siehe recordingTempoFactor()),
 *   auf eine ganze Zahl gerundet; null ohne Sync-Punkte
 * @property {?number} lastSyncMs Position des letzten Sync-Punkts in der Audiospur (ms); null ohne Sync-Punkte
 */

/**
 * Faktor zwischen Aufnahme und Noten: notierte Dauer (mit allen Tempowechseln) geteilt durch die Dauer in der
 * Aufnahme, jeweils vom ersten bis zum letzten Sync-Punkt. Die Sync-Punkte dazwischen zählen nicht, so mitteln sich
 * die natürlichen Schwankungen einer Aufnahme heraus.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @returns {?number} > 1: Die Aufnahme ist schneller als notiert; null mit weniger als zwei Sync-Punkten
 */
export function recordingTempoFactor(alphaTab, score){
  if(!score.masterBars.some(mb => mb.syncPoints?.length)) return null;
  const points = alphaTab.midi.MidiFileGenerator.generateSyncPoints(score).sort((a, b) => a.synthTick - b.synthTick);
  if(points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const recorded = last.syncTime - first.syncTime;
  return recorded > 0 ? (last.synthTime - first.synthTime) / recorded : null;
}

/**
 * Ob das notierte Tempo nicht zur Aufnahme passt: schon dann, wenn ein anderes ganzzahliges Tempo besser passt
 * (Tempi sind ganze Zahlen; 105,6 in der Aufnahme ergibt 106). Korrigiert wird später im Editor mit "Tempo an der
 * Audiospur anpassen".
 * @param {ScoreInfo} info Eckdaten aus readScoreInfo()
 * @returns {boolean}
 */
export function isTempoMismatch(info){
  return Boolean(info.recordedTempo && info.tempo) && info.recordedTempo !== info.tempo;
}

/**
 * Liest Tonart, Capo, Stimmung und Tempo aus den Noten.
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
  const tuning = staff?.isStringed
    ? staff.tuning.slice().reverse().map(p => alphaTab.model.Tuning.getTextForTuning(p, false)).join(' ')
    : '';
  const factor = recordingTempoFactor(alphaTab, score);
  return {
    key: bar ? (keys[bar.keySignature + 7] ?? '') : '',
    capo: staff?.capo || 0,
    tuning,
    tempo: score.tempo,
    recordedTempo: factor ? Math.round(score.tempo * factor) : null,
    lastSyncMs: lastSyncMs(score),
  };
}

/**
 * Position des letzten Sync-Punkts in der Audiospur, wie er in den Noten steht (\sync).
 * @param {Score} score Noten
 * @returns {?number} Millisekunden; null ohne Sync-Punkte
 */
function lastSyncMs(score){
  const offsets = score.masterBars.flatMap(mb => (mb.syncPoints ?? []).map(p => p.syncPointValue.millisecondOffset));
  return offsets.length ? Math.max(...offsets) : null;
}

/**
 * Ob ein Sync-Punkt hinter dem Ende der Audiospur liegt, z. B. nach dem Wechsel auf einen anders geschnittenen
 * YouTube-Clip. Ein negativer erster Sync-Punkt gilt nicht: Dann beginnt Takt 1 vor der Aufnahme (in Guitar Pro das
 * FramePadding), das ist gewollt.
 * @param {ScoreInfo} info Eckdaten aus readScoreInfo()
 * @param {?number} audioSeconds Länge der Audiospur; null ohne Audiospur
 * @returns {boolean}
 */
export function isSyncOutsideAudio(info, audioSeconds){
  return info.lastSyncMs !== null && audioSeconds !== null && info.lastSyncMs > audioSeconds * 1000;
}

/**
 * Kurzinfo für die Kopfzeile eines Songs, als HTML.
 * @param {ScoreInfo} info Eckdaten aus readScoreInfo()
 * @param {?number} [audioSeconds] Länge der Audiospur, sobald sie geladen ist; dann wird auch geprüft, ob die
 *   Sync-Punkte hineinpassen (isSyncOutsideAudio())
 * @returns {string} z. B. "Tonart Am · Capo 2 · 84 BPM", Standardstimmung und Capo 0 werden weggelassen; passt das
 *   Tempo nicht zur Aufnahme (isTempoMismatch()), folgt das Tempo der Audiospur hervorgehoben:
 *   "105 BPM<span class="tempo-warn">(⚠ Audio: 211 BPM)</span>"
 */
export function describeScoreInfo(info, audioSeconds = null){
  const tempo = info.tempo && `${info.tempo} BPM` + (isTempoMismatch(info)
    ? '<span class="tempo-warn" title="Das notierte Tempo passt nicht zur Audiospur">'
      + `(⚠ Audio: ${info.recordedTempo} BPM)</span>`
    : '');
  return [
    info.key && escapeHtml(`Tonart ${info.key}`),
    info.capo ? `Capo ${info.capo}` : null,
    info.tuning && info.tuning !== 'E A D G B E' ? escapeHtml(info.tuning) : null,
    tempo,
    isSyncOutsideAudio(info, audioSeconds)
      ? '<span class="tempo-warn" title="mindestens ein Sync-Punkt liegt außerhalb der Audiospur">'
        + '(⚠ Sync-Punkte passen nicht zur Audiospur)</span>'
      : null,
  ].filter(Boolean).join(' · ');
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
 * Liest alphaTex in ein Modell von alphaTab.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {string} tex Inhalt von score.atex
 * @param {*} [settings] Einstellungen von alphaTab (z. B. die der Notenansicht)
 * @returns {Score} Noten
 */
export function parseScore(alphaTab, tex, settings){
  return alphaTab.importer.ScoreLoader.loadAlphaTex(tex, settings);
}

/**
 * Schreibt ein Modell als alphaTex.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten
 * @returns {string} alphaTex
 */
function writeScore(alphaTab, score){
  return new alphaTab.exporter.AlphaTexExporter().exportToString(score, new alphaTab.Settings());
}

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
 * Liest eine GP-Datei für den Import: Die Angaben (Titel, Interpret, Beschreibung usw.) kommen nach song.json,
 * die Noten werden ohne diese Angaben zu alphaTex. Danach wird das alphaTex wieder eingelesen und mit dem Original
 * verglichen (siehe fingerprint()); geht dabei etwas verloren, wird der Import abgelehnt. Die Audiospur löst der
 * Server aus der Originaldatei, ihre Sync-Punkte stehen im alphaTex.
 * @param {File} file Guitar-Pro-Datei (GP3 bis GP8)
 * @returns {Promise<{meta: Object<string, string>, tex: string}>} Angaben (title, artist, die Felder aus INFO_FIELDS,
 *   notes; leere Texte, wenn die Datei sie nicht enthält) und Noten als alphaTex
 * @throws {Error} wenn die Datei nicht lesbar ist oder sich nicht verlustfrei umwandeln lässt
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

  const tex = writeScore(alphaTab, score);
  let differences;
  try {
    const expected = fingerprint(score);
    const actual = fingerprint(parseScore(alphaTab, tex));
    differences = Math.abs(expected.length - actual.length) + expected.filter((line, i) => line !== actual[i]).length;
  } catch(err){
    differences = -1;
  }
  if(differences !== 0){
    throw new Error('Die Noten lassen sich nicht verlustfrei übernehmen'
      + (differences > 0 ? ` (${differences} Abweichungen).` : ' (alphaTab kann das Ergebnis nicht lesen).'));
  }
  return {meta, tex};
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
 * Wandelt eine Stimmung wie "D A D G B E" (tiefe bis hohe Saite, ohne Oktave) in die Schreibweise von alphaTex um.
 * Die Oktave jeder Saite ist die, die der Standardstimmung am nächsten liegt. Alles außer sechs gültigen Tönen ergibt
 * die Standardstimmung.
 * @param {?string} tuning Stimmung aus dem Formular
 * @returns {string} hohe bis tiefe Saite mit Oktave, z. B. "E4 B3 G3 D3 A2 D2"
 */
function tuningToAlphaTex(tuning){
  const notes = (tuning ?? '').trim().split(/\s+/);
  let midi = STANDARD_TUNING;
  if(notes.length === STANDARD_TUNING.length && notes.every(n => PITCH_CLASSES[n.toUpperCase()] !== undefined)){
    midi = notes.map((n, i) => {
      const below = (STANDARD_TUNING[i] - PITCH_CLASSES[n.toUpperCase()]) % 12;
      return STANDARD_TUNING[i] - below + (below > 6 ? 12 : 0);
    });
  }
  return midi.slice().reverse().map(m => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1)).join(' ');
}

/**
 * Erzeugt die Noten für einen manuell angelegten Song (jeder Song hat Noten): eine Gitarrenspur mit NEW_SCORE_BARS
 * leeren Takten, dazu Tempo, Stimmung, Kapodaster und Tonart aus dem Formular.
 * @param {{tempo?: (number|string), tuning?: string, capo?: (number|string), key?: string}} music Angaben aus dem
 *   Formular; leer oder ungültig ergibt Tempo 120, Standardstimmung, ohne Capo und C-Dur
 * @returns {Promise<string>} alphaTex
 */
export async function createScore(music){
  const alphaTab = await loadAlphaTab();
  const capo = clampInt(music.capo, 0, 24, 0);
  const tex = `\\tempo ${clampInt(music.tempo, 1, 400, 120)}\n\\track "Gitarre"\n`
    + `\\tuning (${tuningToAlphaTex(music.tuning)})\n` + (capo ? `\\capo ${capo}\n` : '')
    + Array(NEW_SCORE_BARS).fill('r.1').join(' | ');
  const score = parseScore(alphaTab, tex);
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
 * @param {import('./api.js').Song} song Song
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
 * @param {import('./api.js').Song} song Song
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
