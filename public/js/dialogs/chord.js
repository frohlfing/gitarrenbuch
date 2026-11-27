/**
 * Dialog "Akkord" der Bearbeitungsseite: Name und Griff zusammen, mit Vorschlägen nach den Regeln der Musiktheorie
 * und der Griffsuche (Reihenfolge und Prioritäten in lib/chordgrips.js).
 */

import * as edit from '../lib/notation.js';
import {GRIPS_PER_ROW} from '../pages/editor.js';
import {chordDiagramSvg} from '../ui/chorddiagram.js';
import {chordKey, gripOf, isStandardTuning, parseGrip} from '../lib/chords.js';
import {chordNoteNames, parseChord, suggestChordNames} from '../lib/chordtheory.js';
import {closeOverlay, openOverlay} from '../ui/overlay.js';
import {escapeHtml} from '../lib/format.js';
import {findGrips, gripToneProblem, nameGrip} from '../lib/chordgrips.js';
import {loadChordUsage} from '../lib/api.js';

/** @typedef {import('../pages/editor.js').NoteEditor} NoteEditor */

/**
 * Dialog für einen Akkord: Name und Griff zusammen. Namensvorschläge kommen nur aus der Akkordtheorie
 * (suggestChordNames()), Griffvorschläge aus Song, Katalog und Berechnung (candidates()). "Übernehmen" nur mit
 * bekanntem Namen und passendem Griff; hat der Name im Song schon einen Griff, gilt der neue für alle Stellen.
 * @param {NoteEditor} editor Bearbeitungsseite
 * @param {boolean} current Akkord am Cursor ändern (sein Name und Griff stehen vorbelegt), sonst ein neuer
 * @returns {Promise<void>}
 */
export async function openChordDialog(editor, current) {
    /** @type {import('../lib/api.js').ChordUsage} */
    const usage = await loadChordUsage().catch(() => /** @type {import('../lib/api.js').ChordUsage} */ ({}));
    const beat = edit.beatAt(editor.score, editor.pos);
    const chordBeat = editor.chordBeat(beat);
    const staff = chordBeat.voice.bar.staff;
    const strings = staff.tuning.length;
    const existing = chordBeat.chordId ? staff.chords?.get(chordBeat.chordId) ?? null : null;
    if (current && !existing) {
        editor.toast('Erst einen Akkord setzen.');
        return;
    }
    // Töne der leeren Saiten von der tiefen Saite aus; Katalog und Griffe gelten für das Standard-Tuning.
    const tuning = [...staff.tuning].reverse();
    const standard = isStandardTuning(staff);

    openOverlay(`
        <h2>${current ? 'Akkord bearbeiten' : 'Akkord hinzufügen'}</h2>
        <form id="chordForm" autocomplete="off">
            <div class="chord-edit">
                <div class="chord-fields">
                    <div class="form-field">
                        <label for="chordName">Name</label>
                        <input type="text" id="chordName" list="chordNames" placeholder="z. B. Am7" value="${escapeHtml(current ? existing.name : '')}">
                        <datalist id="chordNames"></datalist>
                        <div class="hint" id="chordTones"></div>
                    </div>
                    <div class="form-field">
                        <label for="chordGrip">Griff (tiefe Saite zuerst)</label>
                        <input type="text" id="chordGrip" placeholder="z. B. x02210" value="${escapeHtml(current ? gripOf(existing) : '')}">
                        <div class="hint" id="chordHint"></div>
                        <div class="hint hint-warn" id="chordMismatch" hidden></div>
                    </div>
                </div>
                <div class="chord-live" id="chordLive" aria-live="polite"></div>
            </div>
            <div class="form-field" id="chordAlternatives" hidden>
                <span class="label">Weitere Griffe zum Namen</span>
                <div class="chord-grips" id="chordGrips"></div>
            </div>
            <div class="btn-row">
                <button class="btn btn-primary" id="chordOk" type="submit" disabled>Übernehmen</button>
                <button class="btn" id="chordCancel" type="button">Abbrechen</button>
            </div>
        </form>
    `);

    const byId = id => /** @type {HTMLInputElement} */ (document.getElementById(id));
    const nameInput = byId('chordName');
    const gripInput = byId('chordGrip');

    /**
     * Griff prüfen: So viele Angaben, wie die Spur Saiten hat, Bünde von 0 bis 24 oder x, mindestens eine gespielte
     * Saite.
     * @param {string} grip Eingabe
     * @returns {boolean} ob es ein Griff für die Saiten der Spur ist
     */
    const valid = grip => {
        const frets = parseGrip(grip);
        return frets.length === strings && frets.every(f => Number.isInteger(f) && f >= -1 && f <= 24) && frets.some(f => f >= 0);
    };

    /**
     * Bekannte Griffe zu einem Namen: zuerst der Griff, den der Song schon für den Namen hat, dann die des Katalogs,
     * der häufigste zuerst.
     * @param {string} name Akkordname
     * @returns {string[]}
     */
    const knownGrips = name => {
        const songGrip = editor.songChordGrip(name, strings);
        const catalogGrips = standard ? [...(usage[chordKey(name)]?.keys() ?? [])] : [];
        return [...new Set([...(songGrip ? [songGrip] : []), ...catalogGrips])];
    };

    /**
     * Griffe, die zum Namen passen, in dieser Reihenfolge: die bekannten (knownGrips()), die berechneten Griffe der
     * Priorität 1 und 2 (findGrips()), zum Auffüllen der ersten Reihe (GRIPS_PER_ROW) die der Priorität 3, dann 4;
     * höchstens vier Reihen.
     * @returns {string[]}
     */
    const candidates = () => {
        const name = nameInput.value.trim();
        if (!name) return [];
        const found = findGrips(name, {tuning, all: true}).filter(g => valid(g.grip));
        const list = [...new Set([...knownGrips(name).filter(valid), ...found.filter(g => g.priority <= 2).map(g => g.grip)])];
        for (const g of found) {
            if (list.length >= GRIPS_PER_ROW) break;
            if (!list.includes(g.grip)) list.push(g.grip);
        }
        return list.slice(0, 4 * GRIPS_PER_ROW);
    };

    /** Zeichnet Griffbild, weitere Griffe, Hinweis und Knopf passend zu Name und Griff neu. */
    const render = () => {
        const name = nameInput.value.trim();
        const grip = gripInput.value.trim();
        const gripOk = valid(grip);
        // Das Griffbild zeigt immer den Griff im Feld, sobald er gültig ist.
        byId('chordLive').innerHTML = gripOk ? chordDiagramSvg(name || '?', grip) : '';
        // Die anderen Griffe des Namens zur Auswahl; der gewählte ist markiert.
        const others = candidates();
        byId('chordAlternatives').hidden = others.length < 2;
        byId('chordGrips').innerHTML = others.map(g => `
            <button type="button" class="chord-pick" data-grip="${escapeHtml(g)}" aria-pressed="${g === grip}" title="${escapeHtml(g)}">${chordDiagramSvg(name, g)}</button>
        `).join('');
        const songGrip = name ? editor.songChordGrip(name, strings) : '';
        // Der Hinweis auf die Wirkung für alle Stellen steht rot, die anderen Hinweise (Eingabehilfe) neutral.
        const overwrites = gripOk && !!songGrip && songGrip !== grip;
        byId('chordHint').classList.toggle('hint-warn', overwrites);
        byId('chordHint').textContent = !grip ? (name && !others.length ? 'Kein Griff bekannt: bitte eingeben, z. B. "x02210" (x = nicht gespielt).' : '') : !gripOk ? `Griff: ${strings} Angaben von der tiefen Saite aus, z. B. "x02210" (x = nicht gespielt; ab Bund 10 mit "-" trennen).` : overwrites ? 'Der Akkord steht schon im Song: Der neue Griff gilt für alle Stellen.' : '';
        const chord = name ? parseChord(name) : null;
        // Die Töne des Akkords; ein Name, den die Regeln nicht kennen, geht nicht.
        const tones = byId('chordTones');
        tones.classList.toggle('hint-warn', !!name && !chord);
        tones.textContent = !name ? '' : chord ? `Töne: ${chordNoteNames(chord).join(' ')}` : 'Dieser Akkordname ist unbekannt.';
        // Passt der Griff nicht zum Namen: Rote Warnung mit den Namen, die zum Griff passen.
        const mismatch = byId('chordMismatch');
        const problem = gripOk && chord ? gripToneProblem(chord, parseGrip(grip), tuning) : null;
        mismatch.hidden = !problem;
        // Übernehmen nur mit bekanntem Namen und einem Griff, der dazu passt.
        byId('chordOk').disabled = !chord || !gripOk || !!problem;
        if (problem) {
            const alike = nameGrip(parseGrip(grip), tuning, 3);
            mismatch.innerHTML = `Der Griff passt nicht zu ${escapeHtml(name)}.` + (alike.length ? ` Er klingt wie ${alike.map(n => `<button type="button" class="chord-name-pick" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join(', ')}.` : '');
        }
    };

    /** Vorschläge zum Namen, der bisher getippt wurde: alle Namen nach den Regeln der Akkordtheorie, die so beginnen. */
    const suggest = () => {
        const list = suggestChordNames(nameInput.value, 80);
        byId('chordNames').innerHTML = list.map(n => `<option value="${escapeHtml(n)}">`).join('');
    };
    // Ein anderer Name holt immer seinen Griff (den ersten bekannten); ein geänderter Griff ändert nur das Griffbild.
    nameInput.addEventListener('input', () => {
        suggest();
        gripInput.value = candidates()[0] ?? '';
        render();
    });
    byId('chordMismatch').addEventListener('click', e => {
        const pick = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-name]'));
        if (!pick) return;
        nameInput.value = pick.dataset.name;
        render();
    });
    gripInput.addEventListener('input', render);
    byId('chordGrips').addEventListener('click', e => {
        const pick = /** @type {?HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-grip]'));
        if (!pick) return;
        gripInput.value = pick.dataset.grip;
        render();
    });
    byId('chordCancel').addEventListener('click', closeOverlay);
    byId('chordForm').addEventListener('submit', e => {
        e.preventDefault();
        if (byId('chordOk').disabled) return;
        const name = nameInput.value.trim();
        const grip = gripInput.value.trim();
        closeOverlay();
        editor.applyChord(name, grip, current ? existing.name : '');
    });
    if (!current) nameInput.focus();
    render();
}
