/**
 * Kleine Helfer für Text: HTML maskieren, Zeiten formatieren.
 */

/**
 * Maskiert Text für die Ausgabe in HTML.
 * @param {*} str beliebiger Wert, null/undefined ergibt ''
 * @returns {string} HTML-sicherer Text
 */
export function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

/**
 * Formatiert eine Zeitspanne.
 * @param {number} ms Millisekunden
 * @returns {string} m:ss
 */
export function formatTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
