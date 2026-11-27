/**
 * Kleine Helfer für Formulare in Dialogen.
 */

import {escapeHtml} from '../lib/format.js';

/**
 * Kurzform für document.getElementById(), typisiert als Eingabefeld.
 * @param {string} id ID des Elements
 * @returns {?HTMLInputElement} das Element oder null
 */
export function byId(id) {
    return /** @type {?HTMLInputElement} */ (document.getElementById(id));
}

/**
 * Textfeld mit Beschriftung im Formular eines Dialogs (.form-field).
 * HTML eines einzeiligen Formularfelds mit Label.
 * @param {string} id ID des Eingabefelds
 * @param {string} label Beschriftung (HTML)
 * @param {*} value Vorbelegung, null/undefined ergibt ''
 * @param {string} [attrs] zusätzliche Attribute des input-Elements
 * @returns {string} HTML
 */
export function formField(id, label, value, attrs = '') {
    return `
        <div class="form-field">
            <label for="${id}">${label}</label>
            <input type="text" id="${id}" value="${escapeHtml(value ?? '')}" ${attrs}>
        </div>
    `;
}
