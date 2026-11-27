/**
 * Dialog "Griffbrett" aus dem Menü ☰ der Übersichtsseite (das Griffbrett selbst zeichnet ui/fbdiagram.js).
 */

import {fretboardSvg, NOTE_LABELS, structureOf, STRUCTURES} from '../ui/fbdiagram.js';
import {escapeHtml} from '../lib/format.js';
import {openOverlay} from '../ui/overlay.js';

/**
 * Zeigt das Griffbrett bis zum 15. Bund. Kartenreiter für Ton, Akkord und Tonleiter, darunter Grundton und Art in
 * Auswahllisten; die Punkte tragen Notennamen oder Intervalle (umschaltbar), sind je Intervall eingefärbt und werden
 * bei Akkorden und Tonleitern durch Klammern zu Griffen bzw. Lagen zusammengefasst. Unter dem Griffbrett steht die
 * Legende.
 * @returns {void}
 */
export function showFretboard() {
    let root = 0;
    let group = STRUCTURES[1];
    let kind = group.items[0].id;
    let showIntervals = false;

    /** Index des umklammerten Griffs bzw. der Lage (-1: keiner). */
    let active = -1;
    openOverlay(`
        <h2>Griffbrett</h2>
        <p class="ov-meta">Standard-Tuning, bis zum 15. Bund</p>
        <div class="ov-tools">
            <button class="btn" type="button" id="printChords">Drucken</button>
        </div>
        <div class="catalog-list">
            <div class="tabs" role="tablist" id="fbTabs">${STRUCTURES.map(g =>
                `<button type="button" role="tab" data-group="${g.id}">${g.group}</button>`).join('')}
            </div>
            <div class="controls pattern-filter">
                <select id="fbRoot" aria-label="Grundton">${NOTE_LABELS.map((label, i) =>
                    `<option value="${i}">${label}</option>`).join('')}
                </select>
                <select id="fbKind" aria-label="Art"></select>
                <span class="fb-mode" role="group" aria-label="Beschriftung">
                    <button class="btn" type="button" data-mode="notes">Noten</button>
                    <button class="btn" type="button" data-mode="intervals">Intervalle</button>
                </span>
            </div>
            <h3 class="fb-title" id="fbTitle"></h3>
            <div class="fb-scroll" id="fretboard"></div>
            <p class="fb-hint" id="fbHint"></p>
            <div class="fb-legend" id="fbLegend"></div>
        </div>
    `, false, false, true);
    const board = document.getElementById('fretboard');
    const kindSel = /** @type {HTMLSelectElement} */ (document.getElementById('fbKind'));
    const tabs = [...document.querySelectorAll('#fbTabs button')];
    const modes = [...document.querySelectorAll('.fb-mode button')];
    const hints = {
        chord: 'Ein Klick auf einen Grundton mit Ring umklammert einen Griff in Grundstellung: je Ton eine Saite, benachbarte '
            + 'Saiten, der tiefste Ton ist der Grundton, alles innerhalb von vier Bünden. Weitere Klicks zeigen die anderen Griffe '
            + 'ab diesem Ton, der letzte schaltet aus.',
        scale: 'Ein Klick auf einen Grundton mit Ring umklammert eine Lage: die Tonleiter vom Grundton an eine Oktave lang ohne '
            + 'Handwechsel (vier Bünde). Weitere Klicks zeigen die anderen Lagen ab diesem Ton, der letzte schaltet aus.',
    };
    const draw = () => {
        const view = structureOf(root, kind);
        document.getElementById('fbTitle').textContent = view.title;
        board.innerHTML = fretboardSvg(view.notes, root, {
            intervals: showIntervals,
            alt: view.alt,
            shapes: view.shapes,
            active
        });
        document.getElementById('fbHint').textContent = view.kind === 'note' ? ''
            : view.shapes.length ? hints[view.kind]
                : view.kind === 'chord' ? 'Für diesen Akkord gibt es keinen Griff in Grundstellung auf benachbarten Saiten innerhalb von vier Bünden.'
                    : 'Für diese Tonleiter gibt es keine Lage mit einer Oktave ab dem Grundton innerhalb von vier Bünden.';
        document.getElementById('fbLegend').innerHTML = view.kind === 'note' ? '' : view.legend.map(i =>
            `<span class="fb-key"><i style="background:${i.color}"></i><b>${i.label}</b> ${escapeHtml(i.name)}</span>`).join('');
        for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.group === group.id));
        for (const button of modes) button.setAttribute('aria-pressed', String((button.dataset.mode === 'intervals') === showIntervals));
    };
    const fillKinds = () => {
        kindSel.innerHTML = group.items.map(i => `<option value="${i.id}">${i.label}</option>`).join('');
        kindSel.value = kind;
        kindSel.hidden = group.id === 'note';
    };
    board.addEventListener('click', e => {
        const dot = (/** @type {Element} */ (e.target)).closest('.fb-pick');
        if (!dot) return;
        const list = dot.getAttribute('data-shapes').split(',').map(Number);
        const at = list.indexOf(active);
        active = at < 0 ? list[0] : at + 1 < list.length ? list[at + 1] : -1;
        draw();
    });
    for (const tab of tabs) tab.addEventListener('click', () => {
        active = -1;
        group = STRUCTURES.find(g => g.id === tab.dataset.group);
        kind = group.items[0].id;
        fillKinds();
        draw();
    });
    for (const button of modes) button.addEventListener('click', () => {
        showIntervals = button.dataset.mode === 'intervals';
        draw();
    });
    document.getElementById('fbRoot').addEventListener('change', e => {
        root = Number(e.target.value);
        active = -1;
        draw();
    });
    kindSel.addEventListener('change', () => {
        kind = kindSel.value;
        active = -1;
        draw();
    });
    document.getElementById('printChords').addEventListener('click', () => window.print());
    fillKinds();
    draw();
}
