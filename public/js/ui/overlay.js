/**
 * Overlay für alle Dialoge: öffnen, übereinander stapeln, schließen, Hinweis während einer langen Aktion.
 */

import {escapeHtml} from '../lib/format.js';

export const overlay = document.getElementById('overlay');
export const dialog = document.getElementById('dialog');

/**
 * `true`, während ein Dialog offen ist, in dem man etwas eingeben oder einstellen kann (ungespeicherte Eingaben sind
 * möglich). Dann schließen nur die Knöpfe des Dialogs das Overlay, nicht ein Klick daneben oder Escape. Das gilt für
 * alle Dialoge außer reinen Übersichten (openOverlay() mit modal = false).
 * @type {boolean}
 */
let formIsOpen = false;

/**
 * Öffnet das Overlay mit Schließen-Button und dem übergebenen Inhalt.
 * @param {string} html Inhalt des Dialogs
 * @param {boolean} [small] schmaler Dialog für kurze Dialoge (z. B. "Darstellung")
 * @param {boolean} [modal] der Dialog schließt nur über seine Knöpfe (Voreinstellung); false für reine Übersichten, die
 *   auch ein Klick daneben oder Escape schließt
 * @param {boolean} [wide] breiter Dialog für Seiten wie Akkorde und Patterns (wird auch gedruckt)
 * @returns {void}
 */
export function openOverlay(html, small = false, modal = true, wide = false) {
    formIsOpen = modal;
    dialog.classList.toggle('dialog-small', small);
    dialog.classList.toggle('dialog-wide', wide);
    dialog.innerHTML = `<button class="close" id="closeBtn" type="button" aria-label="Schließen">&times;</button>${html}`;
    overlay.classList.add('open');
    document.getElementById('closeBtn').addEventListener('click', closeOverlay);
}

/**
 * Dialoge, die ein darübergelegter Dialog (z. B. das Cover aus dem Formular heraus) vorübergehend verdrängt hat.
 * Gemerkt werden die Elemente selbst, damit Eingaben und Listener erhalten bleiben.
 * @type {{nodes: Node[], formIsOpen: boolean, drag: Array<?function>}[]}
 */
const dialogStack = [];

/**
 * Legt einen Dialog über den gerade offenen. closeOverlay() schließt dann nur ihn und zeigt den vorigen wieder.
 * @param {string} html Inhalt des Dialogs
 * @param {boolean} [modal] wie bei openOverlay()
 * @returns {void}
 */
export function openStackedOverlay(html, modal = true) {
    dialogStack.push({
        nodes: [...dialog.childNodes],
        formIsOpen,
        drag: [overlay.ondragover, overlay.ondragleave, overlay.ondrop],
    });
    overlay.ondragover = overlay.ondragleave = overlay.ondrop = null;
    openOverlay(html, false, modal);
}

/**
 * Zeigt über allem eine Fläche mit einem Hinweis in der Mitte, solange etwas dauert (z. B. "Audiospur wird
 * ausgewertet …"); Klicks darunter gehen nicht durch. Wartet, bis sie gezeichnet ist, damit eine Rechnung danach sie
 * nicht verdeckt.
 * @param {string} text Hinweis
 * @returns {Promise<function(): void>} entfernt die Fläche wieder
 */
export async function showBusy(text) {
    const busy = document.createElement('div');
    busy.className = 'busy';
    busy.setAttribute('role', 'status');
    busy.innerHTML = `<div class="busy-box"><span class="busy-spinner" aria-hidden="true"></span>${escapeHtml(text)}</div>`;
    document.body.append(busy);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return () => busy.remove();
}

/**
 * Ob ein Dialog offen ist.
 * @returns {boolean}
 */
export function isOverlayOpen() {
    return overlay.classList.contains('open');
}

/**
 * Schließt den obersten Dialog. Lag darunter ein verdrängter Dialog, erscheint dieser wieder (seine Elemente erhalten
 * das Ereignis "overlayshow"); sonst wird das
 * Overlay geschlossen, geleert und die Drag-&-Drop-Handler werden entfernt.
 * @returns {void}
 */
export function closeOverlay() {
    const previous = dialogStack.pop();
    if (previous) {
        dialog.replaceChildren(...previous.nodes);
        formIsOpen = previous.formIsOpen;
        [overlay.ondragover, overlay.ondragleave, overlay.ondrop] = previous.drag;
        // Wer Inhalt im verdrängten Dialog hat, kann ihn neu zeichnen (Ereignis "overlayshow" am Element).
        for (const node of previous.nodes) node.dispatchEvent(new Event('overlayshow'));
        return;
    }
    formIsOpen = false;
    overlay.ondragover = overlay.ondragleave = overlay.ondrop = null;
    overlay.classList.remove('open');
    dialog.innerHTML = '';
}

/**
 * Verdrahtet das Overlay einmal beim Start: Klick neben den Dialog und Escape schließen ihn, außer bei einem Dialog mit
 * Eingaben (formIsOpen).
 * @returns {void}
 */
export function initOverlay() {
    overlay.addEventListener('click', e => {
        if (e.target === overlay && !formIsOpen) closeOverlay();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !formIsOpen) closeOverlay();
    });
}
