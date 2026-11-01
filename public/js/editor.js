/**
 * Struktur-Editor: bringt die Noten eines Songs in die Form des Gitarrenbuchs, ohne einzelne Noten anzufassen.
 * Spuren bekommen ihre Rolle (siehe tracks.js), alle Spuren denselben Capo, die Vorzeichen die erkannte Tonart, und
 * die Akkorde aller Spuren landen in der ersten Begleitspur (nach der Regel von mergeChords()). Sprungzeichen (D.S.,
 * D.C., Coda, Fine) werden samt Wiederholungen ausgeschrieben (unrollRepeats() in score-edit.js). Gespeichert wird
 * das ganze alphaTex über den Exporter von alphaTab, geprüft wie beim Import (writeScoreChecked() in score.js); der
 * Server hebt die vorige Fassung auf (history/).
 *
 * Gearbeitet wird auf frisch geladenen Noten, nicht auf dem Modell des Players: Das ändert der Player für die
 * Anzeige (Akkorde, Text, Abschnittsnamen, Spurnamen).
 */

import {escapeHtml, loadChordLibrary, loadScoreText, saveScore} from './api.js';
import {detectKeySignature, normalizeChords, transposeChordName} from './chords.js';
import {closeOverlay, openOverlay} from './library.js';
import {keyName, loadAlphaTab, parseScore, writeScoreChecked} from './score.js';
import {unrollRepeats} from './score-edit.js';
import {
  assignTrackRoles, chordsTrack, mergeChords, moveToCapo, TRACK_ROLES, trackLabel, trackRole, unifyCapo,
} from './tracks.js';

/** @typedef {typeof import('../../types/alphatab')} AlphaTabModule */
/** @typedef {import('../../types/alphatab').model.Score} Score */
/** @typedef {import('../../types/alphatab').model.Track} Track */
/** @typedef {import('../../types/alphatab').model.Staff} Staff */
/** @typedef {import('../../types/alphatab').model.Beat} Beat */
/** @typedef {import('./api.js').Song} Song */

/** Rollen, deren Spur die Akkorde trägt, in dieser Rangfolge (wie chordsTrack()). */
const CHORD_ROLES = ['strumming', 'picking'];

/**
 * Was der Editor ändern soll, so wie es im Dialog gewählt ist.
 * @typedef {Object} StructureChoice
 * @property {{role: string, name: string}[]} tracks je Spur die Rolle ('' = keine) und der Name ohne Rolle
 * @property {?number} capo Capo für alle Spuren mit Saiten; null = je Spur lassen
 * @property {?{keySignature: number, minor: boolean}} key neue Vorzeichen; null = lassen
 * @property {boolean} chords Akkorde in die erste Begleitspur schreiben
 * @property {boolean} unroll Wiederholungen und Sprungzeichen ausschreiben (unrollRepeats() in score-edit.js)
 */

/**
 * Notensysteme mit Saiten (Gitarre, Bass, …), auf die sich der Capo bezieht.
 * @param {Score} score Noten
 * @returns {Staff[]}
 */
function stringedStaves(score){
  return score.tracks.flatMap(t => t.staves).filter(st => st.isStringed && st.tuning.length);
}

/**
 * Zählt Schläge mit Akkord bzw. mit Silbe in einer Spur.
 * @param {Track} track Spur
 * @returns {{chords: number, lyrics: number}}
 */
function countContent(track){
  let chords = 0;
  let lyrics = 0;
  for(const staff of track.staves) for(const bar of staff.bars) for(const voice of bar.voices){
    for(const beat of voice.beats){
      if(beat.chordId) chords++;
      if(beat.lyrics?.some(s => s?.trim())) lyrics++;
    }
  }
  return {chords, lyrics};
}

/**
 * Spur, die nach den gewählten Rollen die Akkorde trägt: Schlagbegleitung, sonst Zupfbegleitung, sonst die erste
 * Begleitspur nach den bisherigen Namen (chordsTrack()).
 * @param {Score} score Noten
 * @param {string[]} roles gewählte Rolle je Spur ('' = keine)
 * @returns {?Track} null, wenn der Song keine Akkorde hat und keine Begleitspur gewählt ist
 */
function chordTarget(score, roles){
  for(const role of CHORD_ROLES){
    const index = roles.indexOf(role);
    if(index >= 0) return score.tracks[index];
  }
  return chordsTrack(score);
}

/**
 * Sucht in einer Spur den Schlag, der an einer Stelle beginnt (erste Stimme mit Inhalt zuerst).
 * @param {Track} track Spur
 * @param {number} barIndex Takt
 * @param {number} tick Anfang in MIDI-Ticks (Takt einmal gespielt)
 * @returns {?Beat} null, wenn dort kein Schlag beginnt
 */
function beatAt(track, barIndex, tick){
  const bar = track.staves[0]?.bars[barIndex];
  if(!bar) return null;
  for(const voice of bar.voices){
    if(voice.isEmpty) continue;
    const beat = voice.beats.find(b => bar.masterBar.start + b.playbackStart === tick);
    if(beat) return beat;
  }
  return null;
}

/**
 * Schreibt die Akkorde aller Spuren in eine Spur (nach mergeChords(), diese Spur gewinnt) und nimmt sie aus den
 * anderen Spuren. Ein Akkord, an dessen Stelle die Zielspur keinen Schlag hat (z. B. mitten in einer langen Note),
 * bleibt in seiner Spur. Hat die Zielspur einen anderen Capo, wird der Name umgerechnet (Griffnamen gelten relativ
 * zum Capo). Die Griffbilder setzt danach normalizeChords().
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @param {Track} target Zielspur
 * @returns {{moved: number, kept: number}} übertragene Akkorde und solche, die bleiben mussten
 */
export function moveChordsTo(alphaTab, score, target){
  const staff = target.staves[0];
  let moved = 0;
  let kept = 0;
  /** @type {Set<number>} Ticks, an denen die Zielspur danach einen Akkord hat */
  const covered = new Set();
  for(const {tick, chord, beat} of mergeChords(score, target)){
    const barIndex = beat.voice.bar.index;
    if(beat.voice.bar.staff.track === target){
      covered.add(tick);
      continue;
    }
    const dest = beatAt(target, barIndex, tick);
    if(!dest){
      kept++;
      continue;
    }
    const delta = chord.staff.capo - staff.capo;
    const name = transposeChordName(chord.name, delta);
    let id = [...staff.chords ?? []].find(([, c]) => c.name === name)?.[0];
    if(id === undefined){
      const copy = new alphaTab.model.Chord();
      copy.name = name;
      // Der Griff passt nur bei gleichem Capo und gleich vielen Saiten.
      copy.strings = delta === 0 && chord.strings.length === staff.tuning.length ? [...chord.strings] : [];
      copy.firstFret = chord.firstFret;
      copy.barreFrets = [...chord.barreFrets];
      id = name;
      staff.addChord(id, copy);
    }
    dest.chordId = id;
    covered.add(tick);
    moved++;
  }
  // Akkorde der übrigen Spuren an Stellen, die jetzt die Zielspur hat, fallen weg (auch unterlegene).
  for(const track of score.tracks){
    if(track === target) continue;
    for(const st of track.staves) for(const bar of st.bars) for(const voice of bar.voices){
      for(const beat of voice.beats){
        if(beat.chordId && covered.has(bar.masterBar.start + beat.playbackStart)) beat.chordId = null;
      }
    }
  }
  return {moved, kept};
}

/**
 * Wendet die Auswahl des Dialogs auf die Noten an.
 * @param {AlphaTabModule} alphaTab alphaTab-Modul
 * @param {Score} score Noten, werden geändert
 * @param {StructureChoice} choice Auswahl
 * @returns {{octaves: number, chords: ?{moved: number, kept: number}}} eine Oktave höher gelegte Noten (Capo),
 *   übertragene Akkorde (null, wenn nicht gewählt)
 */
export function applyStructure(alphaTab, score, choice){
  // Die Begleitspur nach den gewählten Rollen bestimmen, solange die Spuren noch ihre alten Namen haben.
  const target = choice.chords ? chordTarget(score, choice.tracks.map(t => t.role)) : null;
  for(const [i, track] of score.tracks.entries()){
    const {role, name} = choice.tracks[i];
    track.name = track.shortName = role || name;
  }
  let octaves = 0;
  if(choice.capo !== null){
    for(const staff of stringedStaves(score)) octaves += moveToCapo(staff, choice.capo);
  }
  const chords = target ? moveChordsTo(alphaTab, score, target) : null;
  if(choice.key){
    const type = choice.key.minor ? alphaTab.model.KeySignatureType.Minor : alphaTab.model.KeySignatureType.Major;
    for(const track of score.tracks) for(const staff of track.staves) for(const bar of staff.bars){
      bar.keySignature = choice.key.keySignature;
      bar.keySignatureType = type;
    }
  }
  return {octaves, chords};
}

/**
 * Öffnet den Struktur-Editor als Dialog. Vorbelegt sind die Vorschläge: Rollen nach dem Spurnamen
 * (assignTrackRoles()), der Capo der Begleitspur (unifyCapo()), die erkannte Tonart (detectKeySignature()) und das
 * Übertragen der Akkorde, wenn welche außerhalb der Begleitspur stehen.
 * @param {Song} song Lied (mit Noten)
 * @param {function(Song): void} onSaved nach dem Speichern, mit dem aktualisierten Lied
 * @returns {Promise<void>}
 * @throws {Error} wenn die Noten nicht geladen werden können
 */
export async function openStructureEditor(song, onSaved){
  const alphaTab = await loadAlphaTab();
  const tex = await loadScoreText(song.slug);
  /** @returns {Score} frisch gelesene, unveränderte Noten */
  const fresh = () => parseScore(alphaTab, tex);
  const score = fresh();

  const suggested = fresh();
  assignTrackRoles(suggested);
  const capos = [...new Set(stringedStaves(score).map(st => st.capo))].sort((a, b) => a - b);
  const capoSuggestion = capos.length > 1 ? unifyCapo(fresh()).capo : null;
  const key = detectKeySignature(score);
  // Sprungzeichen (D.S., Coda …) kennt die Ansicht "Text & Akkorde" nicht: ausschreiben, samt Wiederholungen.
  const unrolled = score.masterBars.some(mb => mb.directions?.size)
    ? unrollRepeats(alphaTab, t => parseScore(alphaTab, t), tex) : null;
  const firstBar = score.tracks[0]?.staves[0]?.bars[0];
  const currentKey = firstBar
    ? keyName(firstBar.keySignature, firstBar.keySignatureType === alphaTab.model.KeySignatureType.Minor) : '';

  const roleOptions = selected => `<option value="">– keine Rolle –</option>`
    + Object.entries(TRACK_ROLES).map(([role, label]) =>
      `<option value="${role}"${role === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const trackRows = score.tracks.map((track, i) => {
    const role = trackRole(track) ?? trackRole(suggested.tracks[i]) ?? '';
    const {chords, lyrics} = countContent(track);
    const capo = track.staves.find(st => st.isStringed)?.capo;
    const facts = [
      capo === undefined ? 'ohne Saiten' : `Capo ${capo}`,
      chords ? `${chords} ${chords === 1 ? 'Akkord' : 'Akkorde'}` : '',
      lyrics ? `${lyrics} ${lyrics === 1 ? 'Silbe' : 'Silben'}` : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="struct-track">
        <input type="text" data-name="${i}" data-own="${escapeHtml(trackLabel(track.name))}"
          value="${escapeHtml(role ? TRACK_ROLES[role] : trackLabel(track.name))}" aria-label="Name der Spur ${i + 1}"
          ${role ? ' disabled' : ''}>
        <select data-role="${i}" aria-label="Rolle der Spur ${i + 1}">${roleOptions(role)}</select>
        <span class="struct-facts">${escapeHtml(facts)}${!trackRole(track) && role ? ' · Rolle vorgeschlagen'
          : ''}</span>
      </div>`;
  }).join('');

  openOverlay(`
    <h2>Struktur</h2>
    <form id="structForm" class="struct-form">
      <fieldset>
        <legend>Spuren</legend>
        ${trackRows}
        <div class="hint">Eine Spur mit Rolle heißt wie die Rolle; jede Rolle gibt es nur einmal.</div>
      </fieldset>
      ${unrolled ? `
        <fieldset>
          <legend>Sprungzeichen</legend>
          <label class="check-field"><input type="checkbox" id="structUnroll" checked>
            Wiederholungen und Sprungzeichen (D.S., D.C., Coda, Fine) ausschreiben: ${unrolled.before} →
            ${unrolled.after} Takte</label>
        </fieldset>` : ''}
      ${capoSuggestion === null ? '' : `
        <fieldset>
          <legend>Capo</legend>
          <div class="form-field">
            <label for="structCapo">Capo für alle Spuren</label>
            <select id="structCapo">
              <option value="">je Spur lassen</option>
              ${capos.map(c => `<option value="${c}"${c === capoSuggestion ? ' selected' : ''}>Capo ${c}</option>`)
                .join('')}
            </select>
            <div class="hint" id="structCapoHint"></div>
          </div>
        </fieldset>`}
      <fieldset>
        <legend>Tonart</legend>
        ${key ? `
          <label class="check-field"><input type="checkbox" id="structKey" checked>
            Vorzeichen auf ${escapeHtml(keyName(key.keySignature, key.minor))} setzen
            (erkannt aus Akkorden und Tönen; bisher ${escapeHtml(currentKey || '–')})</label>`
          : `<p class="struct-ok">${escapeHtml(currentKey || '–')} passt.</p>`}
      </fieldset>
      <fieldset>
        <legend>Akkorde</legend>
        <label class="check-field"><input type="checkbox" id="structChords">
          <span id="structChordsText"></span></label>
      </fieldset>
      <p class="struct-error" id="structError" hidden></p>
      <div class="struct-actions">
        <button class="btn btn-primary" id="structSave" type="submit">Speichern</button>
        <button class="btn" id="structCancel" type="button">Abbrechen</button>
      </div>
    </form>
  `);

  const form = /** @type {HTMLFormElement} */ (document.getElementById('structForm'));
  const roleSelects = /** @type {HTMLSelectElement[]} */ ([...form.querySelectorAll('[data-role]')]);
  const nameInputs = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll('[data-name]')]);
  const capoSelect = /** @type {?HTMLSelectElement} */ (document.getElementById('structCapo'));
  const keyCheck = /** @type {?HTMLInputElement} */ (document.getElementById('structKey'));
  const chordsCheck = /** @type {HTMLInputElement} */ (document.getElementById('structChords'));
  const unrollCheck = /** @type {?HTMLInputElement} */ (document.getElementById('structUnroll'));
  const errorEl = document.getElementById('structError');

  /** @returns {StructureChoice} Auswahl im Dialog */
  const readChoice = () => ({
    tracks: roleSelects.map((select, i) => ({role: select.value, name: nameInputs[i].value.trim()})),
    capo: capoSelect?.value ? Number(capoSelect.value) : null,
    key: keyCheck?.checked ? key : null,
    chords: chordsCheck.checked && !chordsCheck.disabled,
    unroll: !!unrollCheck?.checked,
  });

  // Folgen der Auswahl als Hinweis: probehalber auf frischen Noten angewendet.
  const showEffects = () => {
    const choice = readChoice();
    if(capoSelect){
      const trial = fresh();
      const moved = choice.capo === null ? []
        : stringedStaves(trial).filter(st => st.capo !== choice.capo).map(st => trackLabel(st.track.name));
      const {octaves} = applyStructure(alphaTab, trial, {...choice, chords: false, key: null});
      document.getElementById('structCapoHint').textContent = choice.capo === null ? ''
        : `Umgerechnet: ${moved.join(', ')}. Klang bleibt gleich`
          + (octaves ? `; ${octaves} Noten passen nur eine Oktave höher.` : '.');
    }
    const target = chordTarget(score, choice.tracks.map(t => t.role));
    const text = document.getElementById('structChordsText');
    chordsCheck.disabled = !target || !hasForeignChords(score, target);
    if(chordsCheck.disabled){
      chordsCheck.checked = false;
      text.textContent = target ? `Alle Akkorde stehen in „${roleLabelOf(choice, target)}“.` : 'Keine Akkorde.';
    } else {
      const trial = fresh();
      const {moved, kept} = moveChordsTo(alphaTab, trial, trial.tracks[target.index]);
      text.textContent = `Akkorde aus den anderen Spuren nach „${roleLabelOf(choice, target)}“ übertragen `
        + `(${moved} übertragen${kept ? `, ${kept} ${kept === 1 ? 'bleibt' : 'bleiben'}: dort kein Schlag` : ''})`;
    }
  };
  /**
   * Anzeigename der Zielspur nach der Auswahl.
   * @param {StructureChoice} choice Auswahl
   * @param {Track} target Zielspur
   * @returns {string}
   */
  const roleLabelOf = (choice, target) => {
    const {role, name} = choice.tracks[target.index];
    return role ? TRACK_ROLES[role] : name;
  };

  form.addEventListener('change', e => {
    const t = /** @type {HTMLElement} */ (e.target);
    if(t.dataset.role !== undefined){
      // Mit Rolle zeigt das Feld den Namen der Rolle, ohne wieder den eigenen (bis dahin eingegebenen) Namen.
      const input = nameInputs[Number(t.dataset.role)];
      const role = /** @type {HTMLSelectElement} */ (t).value;
      if(!input.disabled) input.dataset.own = input.value;
      input.disabled = !!role;
      input.value = role ? TRACK_ROLES[role] : input.dataset.own;
    }
    if(t !== chordsCheck && t !== keyCheck && t !== unrollCheck) showEffects();
  });
  document.getElementById('structCancel').addEventListener('click', closeOverlay);
  form.addEventListener('submit', e => {
    e.preventDefault();
    void save();
  });
  showEffects();
  // Vorschlag: übertragen, wenn es etwas zu übertragen gibt.
  if(!chordsCheck.disabled) chordsCheck.checked = true;

  /**
   * Prüft die Auswahl, wendet sie auf frische Noten an und speichert.
   * @returns {Promise<void>}
   */
  async function save(){
    const choice = readChoice();
    const roles = choice.tracks.map(t => t.role).filter(Boolean);
    let problem = '';
    if(new Set(roles).size !== roles.length) problem = 'Jede Rolle darf nur einer Spur gehören.';
    else if(choice.tracks.some(t => !t.role && !t.name)) problem = 'Spuren ohne Rolle brauchen einen Namen.';
    else if(choice.tracks.some(t => !t.role && Object.hasOwn(TRACK_ROLES, t.name.toLowerCase()))){
      problem = 'Spuren ohne Rolle dürfen nicht wie eine Rolle heißen.';
    }
    errorEl.textContent = problem;
    errorEl.hidden = !problem;
    if(problem) return;

    form.classList.add('busy');
    try {
      const unchanged = writeScoreChecked(alphaTab, fresh());
      const result = choice.unroll ? unrollRepeats(alphaTab, t => parseScore(alphaTab, t), tex).score : fresh();
      applyStructure(alphaTab, result, choice);
      // Ohne Bibliothek (Netzfehler) behalten die Akkorde ihren eigenen meistgenutzten Griff.
      normalizeChords(alphaTab, result, await loadChordLibrary().catch(() => ({})));
      const out = writeScoreChecked(alphaTab, result);
      if(out === unchanged){
        closeOverlay();
        return;
      }
      const saved = await saveScore(song.slug, out);
      closeOverlay();
      onSaved(saved);
    } catch(err){
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      form.classList.remove('busy');
    }
  }
}

/**
 * Ob außerhalb einer Spur noch Akkorde stehen.
 * @param {Score} score Noten
 * @param {Track} target Spur
 * @returns {boolean}
 */
function hasForeignChords(score, target){
  return score.tracks.some(t => t !== target && countContent(t).chords > 0);
}
