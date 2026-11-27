/**
 * Konfliktlöser: bringt Noten ohne Rückfrage in die Form des Gitarrenbuchs. Ein Konflikt ist eine Abweichung von dieser
 * Form: jede Information an genau einer Stelle, der Song von oben nach unten, ein Capo und ein Tuning für alle Spuren.
 * Konflikte kommen nur aus Guitar-Pro-Dateien (beim Import und bei "Spur aus Guitar-Pro-Datei importieren"); der
 * Editor erzeugt keine, deshalb zeigt sie nirgends jemand an. Vorher hat cleanImportedScore() in notation.js das
 * Formale bereinigt.
 *
 * Begriffe: Die Akkordspur ist die Spur mit den meisten Akkorden (chordsTrack()), die Textspur die mit den meisten
 * Silben (lyricsTrack()).
 *
 * Die Schritte in dieser Reihenfolge (die Nummern stehen auch in resolveConflicts()); in Klammern, warum es ein
 * Konflikt ist und warum er in GP-Dateien typisch ist:
 *
 *  1. Wiederholungen, Volta-Klammern, Sprünge und Simile ausschreiben (unrollRepeats()). Nur so sind Takt, Silbe,
 *     Akkord und Sync-Punkt eindeutig; GP-Dateien sparen damit Platz.
 *  2. Takte mit falscher Länge auffüllen bzw. kürzen (fixBarLengths()); Guitar Pro erlaubt unvollständige Takte.
 *  3. Triolen-Feeling nur als Shuffle (fixTripletFeel()); das Gitarrenbuch kennt nur Achtel-Shuffle.
 *  4. Spuren ohne Saiten werden Gitarren-Tab (fixPitchedTracks()); jede Spur ist Tab.
 *  5. Tuning in der üblichen Oktave (fixTuningOctaves(), Oktav-Trick aus Guitar Pro).
 *  6. Instrument aus der festen Liste und Notenlage für Tab (fixInstruments()).
 *  7. Ein Capo für alle Spuren (fixCapo()). Akkordnamen und Leadsheet gehen von einem Capo aus; in Guitar Pro hat jede
 *     Spur ihren eigenen, Gesang oder Bass oft keinen.
 *  8. Ein Tuning für alle Spuren mit so vielen Saiten wie die Akkordspur (fixTuning()); ein Song hat ein Tuning
 *     (Leiste, Transponieren, Kopf des Blatts). Spuren mit anderer Saitenzahl (Bass) behalten ihres.
 *  9. Akkorde nur in der Akkordspur (fixChordTracks()); in GP stehen sie oft an Gitarre und Gesang.
 * 10. Liedtext nur in der Textspur (fixLyricsTracks()); das Panel "Liedtext" bearbeitet nur sie.
 * 11. Unbekannte Akkordnamen ersetzen (fixChordNames()): Ohne gelesenen Namen (parseChord()) gibt es keine Töne, also
 *     keinen berechneten Griff, kein Transponieren und keine Prüfung. GP-Namen sind frei ("N.C.", "Dsus2/4", Tippfehler).
 * 12. Griff, der nicht zum Namen passt (fixGrips()); Griffbilder in GP sind frei gezeichnet und oft falsch benannt,
 *     sonst widersprächen sich Griffbild und Name auf dem Blatt, und der Akkordkatalog lernte den falschen Griff.
 * 13. Griffbilder: eigene bleiben, fehlende kommen aus dem Katalog (normalizeChords()).
 *
 * Ohne eigenen Schritt gleicht schon das Einlesen (parseScore() → normalizeLevels()) die Lautstärke an.
 *
 * Der Import fragt nicht nach und speichert keinen Bericht; die Änderungen (Change) stehen nur in der Konsole, solche
 * mit Datenverlust mit "⚠". Was Datenverlust ist, sagt jeder Schritt selbst (lossy()); ein anderer Klang durch das
 * Instrument (Schritt 6) ist keiner.
 */

import {gripOf, normalizeChords} from './base.js';
import {simplifyChord} from './chordfile.js';
import {findGrips, gripToneProblem, nameGrip} from './chordgrips.js';
import {parseChord} from './chordtheory.js';
import {
    chordsTrack,
    hasLyrics,
    hasStrings,
    instrumentOf,
    lyricsTrack,
    moveContent,
    moveToCapo,
    normalizeTuningOctave,
    notationPitch,
    parseScore,
    sameTuning,
    setInstrument,
    setTuning,
    splitTicks,
    stringedStaves,
    timeline,
    toGuitarTab,
    trackName,
    tuningStaves,
    unrollRepeats,
    writeScore,
} from './notation.js';
import {lyricsLines} from './textview.js';

/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Staff} Staff */
/** @typedef {import('../../types/alphatab').model.Voice} Voice */
/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */

/** Mindestzahl gespielter Saiten, damit ein Griff einen Namen ergibt bzw. geprüft wird. */
const MIN_PLAYED = 3;

/**
 * Liedtext einer Spur, der nicht in die Textspur übernommen wurde (als Chord-Datei abzulegen).
 * @typedef {Object} LeftoverLyrics
 * @property {string} name Dateiname, z. B. "Vocal – Liedtext.txt"
 * @property {string} text Text mit Abschnittszeilen ("[Verse]"), wie das Panel "Liedtext" ihn zeigt
 */

/**
 * Eine Änderung des Konfliktlösers.
 * @typedef {Object} Change
 * @property {string} text Satz für das Protokoll
 * @property {boolean} critical mit Datenverlust: Noten oder Text fallen weg, Noten werden versetzt oder klingen anders
 *   (zum genauen Ansehen)
 */

/**
 * Änderung ohne Datenverlust.
 * @param {string} text Satz für das Protokoll
 * @returns {Change}
 */
const done = text => ({text, critical: false});

/**
 * Änderung mit Datenverlust (siehe Change).
 * @param {string} text Satz für das Protokoll
 * @returns {Change}
 */
const lossy = text => ({text, critical: true});

/**
 * Ergebnis von resolveConflicts().
 * @typedef {Object} ResolveResult
 * @property {string} tex Noten als alphaTex, ohne Konflikte
 * @property {Change[]} changes was geändert wurde (leer: nichts zu tun)
 * @property {LeftoverLyrics[]} lyrics nicht übernommener Liedtext je Spur
 */

/**
 * Löst alle Konflikte ohne Rückfrage, Schritt für Schritt in der Reihenfolge der Regeln (Kopf der Datei).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {string} tex Noten als alphaTex
 * @param {import('./base.js').ChordLibrary} library Akkordkatalog
 * @returns {ResolveResult}
 */
export function resolveConflicts(alphaTab, tex, library) {
    const parse = t => parseScore(alphaTab, t);
    /** @type {Change[]} */
    const changes = [];
    // 1. Wiederholungen und Sprünge ausschreiben.
    const unrolled = unrollRepeats(alphaTab, parse, tex);
    let score = unrolled ? parse(writeScore(alphaTab, unrolled.score)) : parse(tex);
    if (unrolled) {
        changes.push(done(unrolled.before === unrolled.after
            ? `Wiederholungs- bzw. Sprungzeichen entfernt (${unrolled.after} Takte wie vorher).`
            : `Wiederholungen und Sprünge ausgeschrieben: ${unrolled.before} → ${unrolled.after} Takte.`));
    }
    // 2. Takte mit falscher Länge (danach neu einlesen, damit die Zeiten der Schläge stimmen).
    const lengths = fixBarLengths(alphaTab, score);
    if (lengths.length) {
        changes.push(...lengths);
        score = parse(writeScore(alphaTab, score));
    }
    // 3. bis 12.
    changes.push(...fixTripletFeel(alphaTab, score));
    changes.push(...fixPitchedTracks(alphaTab, score));
    changes.push(...fixTuningOctaves(alphaTab, score));
    changes.push(...fixInstruments(alphaTab, score));
    changes.push(...fixCapo(score));
    changes.push(...fixTuning(alphaTab, score));
    changes.push(...fixChordTracks(alphaTab, score));
    const lyrics = fixLyricsTracks(score, changes);
    changes.push(...fixChordNames(score, library));
    changes.push(...fixGrips(score));
    // 13. Griffbilder: eigene bleiben, fehlende kommen aus dem Katalog.
    normalizeChords(alphaTab, score, library, true);
    // Nichts geändert: die Noten wie gegeben (das Neuschreiben allein ändert nichts).
    if (!changes.length && !lyrics.length) return {tex, changes, lyrics};
    return {tex: writeScore(alphaTab, score), changes, lyrics};
}

/**
 * Füllt zu kurze Takte am Ende mit Pausen auf und kürzt zu lange: von hinten den letzten Schlag verkürzen, wenn das mit
 * einem Notenwert geht, sonst Schläge löschen (eine entstandene Lücke füllen Pausen). Je Stimme; leere Stimmen und ein
 * Auftakt zählen nicht (dessen Länge ergibt sich aus dem Inhalt, Pausen gehörten an den Anfang).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @returns {Change[]} Änderungen
 */
function fixBarLengths(alphaTab, score) {
    const changes = [];
    for (const track of score.tracks) for (const staff of track.staves) for (const bar of staff.bars) {
        const mb = bar.masterBar;
        if (mb.isAnacrusis) continue;
        const length = mb.calculateDuration();
        for (const voice of bar.voices) {
            if (!voice.beats.length || voice.isEmpty) continue;
            const filled = timeline(voice).at(-1).end;
            if (Math.abs(filled - length) < 1) continue;
            const where = `${trackName(track)}, Takt ${bar.index + 1}`;
            if (filled < length) {
                addRests(alphaTab, voice, length - filled);
                changes.push(done(`${where}: zu kurz, mit Pausen aufgefüllt.`));
                continue;
            }
            let excess = filled - length;
            let shortened = 0;
            let deleted = 0;
            while (excess > 0 && voice.beats.length) {
                const last = timeline(voice).at(-1);
                const ticks = last.end - last.start;
                const parts = ticks > excess && !last.beat.hasTuplet ? splitTicks(ticks - excess) : null;
                if (parts?.length === 1) {
                    last.beat.duration = parts[0].duration;
                    last.beat.dots = parts[0].dots;
                    excess = 0;
                    shortened++;
                } else {
                    voice.beats.pop();
                    excess -= ticks;
                    deleted++;
                }
            }
            if (excess < 0) addRests(alphaTab, voice, -excess);
            changes.push(lossy(`${where}: zu lang, ${[shortened ? 'letzter Schlag verkürzt' : '',
                deleted ? `${deleted} ${deleted === 1 ? 'Schlag' : 'Schläge'} gelöscht` : ''].filter(Boolean).join(', ')}.`));
        }
    }
    return changes;
}

/**
 * Hängt Pausen an eine Stimme an.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Voice} voice Stimme
 * @param {number} ticks Länge
 * @returns {void}
 */
function addRests(alphaTab, voice, ticks) {
    for (const {duration, dots} of splitTicks(ticks) ?? []) {
        const rest = new alphaTab.model.Beat();
        rest.duration = duration;
        rest.dots = dots;
        voice.addBeat(rest);
    }
}

/**
 * Triolen-Feeling: punktierte Achtel und Scottish (Achtel) werden Shuffle, die Sechzehntel-Varianten fallen weg; die
 * Noten bleiben, wie sie sind. (GP3/GP4 kennen nur Achtel-Triolen, GP5 auch Sechzehntel-Triolen, GP6 bis GP8 dazu
 * punktiert und Scottish in Achteln und Sechzehnteln.)
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @returns {Change[]} Änderungen
 */
function fixTripletFeel(alphaTab, score) {
    const Feel = alphaTab.model.TripletFeel;
    const toShuffle = [Feel.Dotted8th, Feel.Scottish8th];
    const toNone = [Feel.Triplet16th, Feel.Dotted16th, Feel.Scottish16th];
    let shuffle = 0;
    let none = 0;
    for (const mb of score.masterBars) {
        if (toShuffle.includes(mb.tripletFeel)) {
            mb.tripletFeel = Feel.Triplet8th;
            shuffle++;
        } else if (toNone.includes(mb.tripletFeel)) {
            mb.tripletFeel = Feel.NoTripletFeel;
            none++;
        }
    }
    // Beides ändert, wie der Song gespielt wird.
    return [
        shuffle ? lossy(`Triolen-Feeling (punktiert/Scottish) in ${shuffle} Takten zu Shuffle.`) : null,
        none ? lossy(`Triolen-Feeling (Sechzehntel) in ${none} Takten entfernt.`) : null,
    ].filter(Boolean);
}

/**
 * Spuren ohne Saiten (Gesang, Orgel …) werden Gitarren-Tab in Standard-Tuning (toGuitarTab()): Ihr Tonraum ist der des
 * Griffbretts. Der ganze Satz wandert um so viele Oktaven, dass möglichst viele Töne zwischen tiefer leerer Saite und
 * 12. Bund der hohen liegen; einzelne Töne, die dann noch nicht zu greifen sind, um eine weitere Oktave. Klingt die
 * Spur dadurch anders (verschoben, oktaviert, nicht zu greifen), ist das Datenverlust.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @returns {Change[]} Änderungen
 */
function fixPitchedTracks(alphaTab, score) {
    const changes = [];
    for (const track of score.tracks) for (const staff of track.staves) {
        if (staff.isPercussion || hasStrings(staff)) continue;
        const {shift, octaves, skipped} = toGuitarTab(alphaTab, staff);
        const octave = n => `${Math.abs(n / 12)} Oktave${Math.abs(n) > 12 ? 'n' : ''}`;
        const parts = [
            shift ? `alle Töne ${octave(shift)} ${shift > 0 ? 'höher' : 'tiefer'}` : '',
            octaves ? `${octaves} weitere Töne um eine Oktave versetzt` : '',
            skipped ? `${skipped} Töne nicht zu greifen` : '',
        ].filter(Boolean);
        const text = `Spur „${trackName(track)}“ ohne Saiten: jetzt Gitarren-Tab`
            + (parts.length ? ` (${parts.join(', ')})` : '') + '.';
        changes.push(shift || octaves || skipped ? lossy(text) : done(text));
    }
    return changes;
}

/**
 * Tuning in der üblichen Lage (Gitarre um E2, Bass um E1): Liegt es eine oder mehrere Oktaven daneben (Oktav-Trick aus
 * Guitar Pro), wird es um die Oktaven verschoben; die Bünde bleiben, der Klang wandert mit (deshalb Datenverlust).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @returns {Change[]} Änderungen
 */
function fixTuningOctaves(alphaTab, score) {
    const changes = [];
    for (const track of score.tracks) {
        const instrument = instrumentOf(track);
        for (const staff of track.staves) {
            const shift = normalizeTuningOctave(alphaTab, staff, instrument);
            if (!shift) continue;
            const names = [...staff.tuning].reverse().map(p => alphaTab.model.Tuning.getTextForTuning(p, true)).join(' ');
            changes.push(lossy(`Spur „${trackName(track)}“: Tuning ${Math.abs(shift / 12)} Oktave${Math.abs(shift) > 12 ? 'n' : ''} `
                + `${shift < 0 ? 'tiefer' : 'höher'} auf ${names}; Bünde bleiben, klingt ${shift < 0 ? 'tiefer' : 'höher'}.`));
        }
    }
    return changes;
}

/**
 * Instrument und Notenlage: Jede Spur bekommt das Instrument nach den Regeln in docs/Instrumente.md (instrumentOf())
 * und die Notenlage für Tab (notationPitch()). Beides ist kein Datenverlust.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @returns {Change[]} Änderungen
 */
function fixInstruments(alphaTab, score) {
    const changes = [];
    for (const track of score.tracks) {
        const instrument = instrumentOf(track);
        if (instrument.program === null) continue;
        const program = track.playbackInfo.program;
        const staves = track.staves.filter(st => !st.isPercussion);
        const pitches = [...new Set(staves.map(st => st.displayTranspositionPitch))];
        const soundChanged = program !== instrument.program;
        const notationChanged = staves.some(st => st.displayTranspositionPitch !== notationPitch(st));
        if (!soundChanged && !notationChanged) continue;
        setInstrument(alphaTab, track, instrument);
        const text = `Spur „${trackName(track)}“: ${instrument.name}`
            + (soundChanged ? ` (vorher Klang ${program})` : '')
            + (notationChanged ? `; Notenlage wie Tab, eine Oktave höher notiert (vorher ${pitches.join(', ')})` : '')
            + '.';
        changes.push(done(text));
    }
    return changes;
}

/**
 * Capo: der kleinste aller Spuren mit Saiten; die anderen werden umgerechnet (klingen gleich, moveToCapo()). Noten,
 * die unter dem Capo lägen, kommen auf eine andere Saite oder eine Oktave höher (das ist Datenverlust).
 * @param {Score} score Noten, werden geändert
 * @returns {Change[]} Änderungen
 */
function fixCapo(score) {
    const staves = stringedStaves(score);
    if (new Set(staves.map(st => st.capo)).size <= 1) return [];
    const capo = Math.min(...staves.map(st => st.capo));
    const moved = [];
    let octaves = 0;
    for (const staff of staves) {
        if (staff.capo === capo) continue;
        moved.push(`${trackName(staff.track)} ${staff.capo}`);
        octaves += moveToCapo(staff, capo);
    }
    const text = `Capo ungleich: alle auf Capo ${capo} (umgerechnet: ${moved.join(', ')})`;
    return [octaves ? lossy(`${text}; ${octaves} Noten eine Oktave höher.`) : done(`${text}.`)];
}

/**
 * Tuning: das tiefste, das eine Spur verwendet (kleinste Summe der Tonhöhen), für alle Spuren mit so vielen Saiten wie
 * die Akkordspur; die anderen werden auf derselben Saite umgerechnet (klingen gleich, setTuning(…, true)). Noten, deren
 * Bund unter 0 oder über 24 läge, bleiben stehen und klingen anders (Datenverlust).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @returns {Change[]} Änderungen
 */
function fixTuning(alphaTab, score) {
    if (sameTuning(score)) return [];
    const staves = tuningStaves(score);
    const sum = st => st.tuning.reduce((a, b) => a + b, 0);
    const lowest = staves.reduce((low, st) => sum(st) < sum(low) ? st : low);
    const tuning = [...lowest.tuning].reverse();
    const names = tuning.map(p => alphaTab.model.Tuning.getTextForTuning(p, false)).join(' ');
    const moved = [];
    let misses = 0;
    for (const staff of staves) {
        if (staff.tuning.join(',') === lowest.tuning.join(',')) continue;
        moved.push(trackName(staff.track));
        misses += setTuning(alphaTab, staff, tuning, true);
    }
    const text = `Tuning ungleich: alle auf ${names} (umgerechnet: ${moved.join(', ')})`;
    return [misses ? lossy(`${text}; ${misses} Noten ließen sich nicht umrechnen (Bund unter 0 oder über 24), sie klingen anders.`)
        : done(`${text}.`)];
}

/**
 * Akkorde: alle in die Akkordspur (moveContent(), Modus "insert": fehlt dort an der Stelle ein Schlag, wird der
 * klingende geteilt und angebunden, klingt gleich). Zwei verschiedene Akkorde an derselben Stelle: Die Akkordspur
 * gewinnt, der andere fällt weg (Datenverlust, mit Takt, Name, Herkunftsspur und dem Akkord, der bleibt).
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @returns {Change[]} Änderungen
 */
function fixChordTracks(alphaTab, score) {
    const target = chordsTrack(score);
    if (!target || !score.tracks.some(t => t !== target && t.staves.some(st => st.bars.some(b => b.voices.some(v =>
        v.beats.some(beat => !!beat.chordId)))))) return [];
    const result = moveContent(alphaTab, score, 'chords', target.index, 'insert');
    const text = `Akkorde nach „${trackName(target)}“ übertragen: ${result.moved} (${result.split} Schläge geteilt)`;
    // Welche weggefallen sind (zum Nachsehen): Takt, Akkord und der, der an der Stelle bleibt.
    const lost = result.lostChords.map(l => `Takt ${l.bar + 1}: ${l.name} aus „${l.track}“ entfällt, ${l.kept} bleibt`).join('; ');
    return [result.lost ? lossy(`${text}; ${result.lost} abweichende an derselben Stelle: ${lost}.`)
        : done(`${text}.`)];
}

/** Ab diesem Anteil gleicher Wörter gilt der Text einer anderen Spur als derselbe wie der der Textspur. */
const SAME_LYRICS = 0.9;

/**
 * Wörter des Liedtexts einer Spur, zum Vergleich: Silben zu Wörtern zusammengesetzt ("Christ-" "ma-" "s" → christmas),
 * ohne Satzzeichen, klein.
 * @param {import('../../types/alphatab').model.Track} track Spur
 * @returns {string[]}
 */
function lyricsWords(track) {
    const parts = [];
    for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
        for (const syllable of beat.lyrics ?? []) if (syllable?.trim()) parts.push(syllable.trim());
    }
    return parts.join(' ').replace(/-\s+/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
}

/**
 * Wie sehr zwei Wortfolgen übereinstimmen: Länge der längsten gemeinsamen Teilfolge geteilt durch die längere.
 * @param {string[]} a Wörter
 * @param {string[]} b Wörter
 * @returns {number} 0 bis 1
 */
function wordSimilarity(a, b) {
    if (!a.length || !b.length) return 0;
    let row = new Array(b.length + 1).fill(0);
    for (const word of a) {
        const next = [0];
        for (let j = 1; j <= b.length; j++) next[j] = word === b[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]);
        row = next;
    }
    return row[b.length] / Math.max(a.length, b.length);
}

/**
 * Liedtext: Nur die Textspur behält ihren Text. Der Text jeder anderen Spur wird mit ihm verglichen (Wort für Wort, ohne
 * Trennstriche, Satzzeichen, Groß- und Kleinschreibung): Ist er derselbe (mindestens SAME_LYRICS gleiche Wörter, z. B.
 * dieselben Strophen in einem anderen Rhythmus), fällt er weg; weicht er ab, fällt er ebenfalls weg und kommt als ganzer
 * Text der Spur zurück (für eine Chord-Datei, Datenverlust in den Noten). Silben in Lücken der Textspur zu setzen, taugt
 * nicht: Aus einem anderen Rhythmus stehen sie dort doppelt oder verrutscht.
 * @param {Score} score Noten, werden geändert
 * @param {Change[]} changes Änderungen, wird ergänzt
 * @returns {LeftoverLyrics[]}
 */
function fixLyricsTracks(score, changes) {
    const dest = lyricsTrack(score);
    if (!dest) return [];
    const others = score.tracks.filter(t => t !== dest && t.staves.some(st => st.bars.some(b => b.voices.some(v =>
        v.beats.some(hasLyrics)))));
    const destWords = lyricsWords(dest);
    /** @type {LeftoverLyrics[]} */
    const leftovers = [];
    for (const track of others) {
        const text = lyricsLines(score, track);
        const similarity = wordSimilarity(destWords, lyricsWords(track));
        for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) {
            for (const beat of voice.beats) beat.lyrics = null;
        }
        const percent = `${Math.round(similarity * 100)} % gleiche Wörter`;
        if (similarity >= SAME_LYRICS) {
            changes.push(done(`Liedtext aus „${trackName(track)}“ entfernt: derselbe wie in „${trackName(dest)}“ (${percent}).`));
        } else {
            changes.push(lossy(`Liedtext aus „${trackName(track)}“ entfernt: weicht von „${trackName(dest)}“ ab (${percent}), `
                + 'als Chord-Datei abgelegt.'));
            leftovers.push({name: `${trackName(track)} – Liedtext.txt`, text});
        }
    }
    return leftovers;
}

/**
 * Unbekannte Akkordnamen (parseChord() kann sie nicht lesen, Regeln in docs/Musiktheorie.md): mit Griff (mindestens
 * drei Saiten) der Name aus dem Griff (nameGrip()), sonst vereinfacht (simplifyChord(): "Dsus2/4" → "Dsus2"); bleibt
 * er unbekannt ("N.C."), fällt der Akkord weg (Datenverlust).
 * @param {Score} score Noten, werden geändert
 * @param {import('./base.js').ChordLibrary} library Akkordkatalog
 * @returns {Change[]} Änderungen
 */
function fixChordNames(score, library) {
    const changes = [];
    for (const track of score.tracks) for (const staff of track.staves) {
        for (const [id, chord] of [...staff.chords ?? []]) {
            if (parseChord(chord.name)) continue;
            const frets = [...chord.strings].reverse();
            const tuning = [...staff.tuning].reverse();
            const fromGrip = staff.isStringed && frets.length === tuning.length && frets.filter(f => f >= 0).length >= MIN_PLAYED
                ? nameGrip(frets, tuning, 1)[0] : null;
            const simple = fromGrip ?? simplifyChord(chord.name, library);
            if (parseChord(simple)) {
                changes.push(done(`Akkord „${chord.name}“ in „${trackName(track)}“ heißt jetzt „${simple}“.`));
                chord.name = simple;
                continue;
            }
            for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
                if (beat.chordId === id) beat.chordId = null;
            }
            staff.chords.delete(id);
            changes.push(lossy(`Akkord „${chord.name}“ in „${trackName(track)}“ entfernt (unbekannt).`));
        }
    }
    return changes;
}

/**
 * Griffe, die nicht zum Namen passen (gripToneProblem(), je Akkord mit mindestens drei gespielten Saiten, im Tuning
 * der Spur): Der Name gewinnt, denn ein Griff allein ist mehrdeutig; der Griff wird der erste Vorschlag der Griffsuche
 * (findGrips(), ohne den Katalog). Die Noten ändern sich nicht, nur das Griffbild.
 * @param {Score} score Noten, werden geändert
 * @returns {Change[]} Änderungen
 */
function fixGrips(score) {
    const changes = [];
    for (const staff of stringedStaves(score)) {
        const tuning = [...staff.tuning].reverse();
        for (const chord of staff.chords?.values() ?? []) {
            const parsed = parseChord(chord.name);
            const frets = [...chord.strings].reverse();
            if (!parsed || frets.length !== tuning.length || frets.filter(f => f >= 0).length < MIN_PLAYED) continue;
            if (!gripToneProblem(parsed, frets, tuning)) continue;
            const found = findGrips(chord.name, {tuning, limit: 1})[0];
            if (!found) continue;
            changes.push(done(`Griff von „${chord.name}“ in „${trackName(staff.track)}“: ${gripOf(chord)} → ${found.grip}.`));
            chord.strings = [...found.frets].reverse();
            chord.firstFret = 0;
        }
    }
    return changes;
}
