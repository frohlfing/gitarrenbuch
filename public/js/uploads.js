/**
 * Dialog "Uploads": die hochgeladenen Dateien eines Lieds (Guitar-Pro-, ChordPro-, Textdateien, PDFs, …) mit Quelle und
 * Beschreibung, dazu das Hochladen weiterer Dateien. Aus dem Menü des Lieds zeigt er alles; "Spur aus GuitarPro-Datei importieren" und
 * "Chord-Datei importieren" im Bearbeitungsmodus öffnen ihn zur Auswahl (nur passende Dateien, mit "Wählen").
 * Dateien werden nie geändert; nur Quelle und Beschreibung lassen sich ändern, und eine Datei lässt sich löschen.
 */

import {addUpload, deleteUpload, escapeHtml, fetchUpload, listUploads, svgIcon, updateUpload, uploadUrl} from './base.js';
import {bindDropzone, closeOverlay, isOverlayOpen, openOverlay, openStackedOverlay} from './library.js';

/** @typedef {import('./base.js').Upload} Upload */

/** Endungen der Guitar-Pro-Dateien, die alphaTab lesen kann. */
export const GP_EXTENSIONS = ['gp', 'gp3', 'gp4', 'gp5', 'gp7', 'gp8', 'gpx'];

/** Endungen der Akkorddateien (ChordPro und Text). */
export const CHORD_EXTENSIONS = ['cho', 'chopro', 'crd', 'pro', 'txt'];

/**
 * Wie der Dialog zur Auswahl einer Datei benutzt wird.
 * @typedef {Object} UploadPick
 * @property {string} title Überschrift, z. B. "Guitar-Pro-Datei wählen"
 * @property {string[]} extensions Endungen (klein, ohne Punkt) der Dateien, die zur Wahl stehen
 * @property {(file: File, upload: Upload) => void} onPick wird mit der gewählten Datei aufgerufen, der Dialog ist dann
 *   schon geschlossen
 */

/**
 * Endung eines Dateinamens.
 * @param {string} name Dateiname
 * @returns {string} klein, ohne Punkt ("" ohne Endung)
 */
function extension(name){
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
}

/**
 * Dateigröße für die Anzeige.
 * @param {number} bytes Größe
 * @returns {string} z. B. "28 KB" oder "1,6 MB"
 */
function formatSize(bytes){
  if(bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('de-DE', {maximumFractionDigits: 1})} MB`;
}

/**
 * Quelle als Link, wenn sie eine Adresse ist, sonst als Text.
 * @param {string} source Angabe zur Herkunft, meist eine URL
 * @returns {string} HTML
 */
function sourceHtml(source){
  const text = escapeHtml(source);
  return /^https?:\/\//i.test(source) ? `<a href="${text}" target="_blank" rel="noopener">${text}</a>` : text;
}

/**
 * HTML eines Uploads in der Liste.
 * @param {string} slug Slug des Lieds
 * @param {Upload} u Upload
 * @param {boolean} pick ob der Dialog zur Auswahl dient (dann steht "Wählen" am Eintrag)
 * @returns {string} HTML
 */
function uploadHtml(slug, u, pick){
  const date = new Date(u.added).toLocaleDateString('de-DE');
  return `<li class="upl-item" data-file="${escapeHtml(u.file)}">
    <div class="upl-head">
      <a class="upl-name" href="${escapeHtml(uploadUrl(slug, u.file))}" target="_blank" rel="noopener">${escapeHtml(u.file)}</a>
      <span class="upl-meta">${formatSize(u.size)} · ${date}</span>
      ${pick ? '<button type="button" class="btn btn-primary btn-sm" data-pick>Wählen</button>' : ''}
      <button type="button" class="ebtn" data-edit title="Quelle und Beschreibung ändern"
        aria-label="Quelle und Beschreibung ändern">${svgIcon('edit')}</button>
      <button type="button" class="ebtn" data-delete title="Datei löschen" aria-label="Datei löschen">${svgIcon('trash')}</button>
    </div>
    <div class="upl-info">
      ${u.source ? `<div><span class="upl-label">Quelle:</span> ${sourceHtml(u.source)}</div>` : ''}
      ${u.description ? `<div>${escapeHtml(u.description)}</div>` : ''}
      ${u.source || u.description ? '' : '<div class="upl-none">Keine Angaben</div>'}
    </div>
  </li>`;
}

/**
 * Öffnet den Dialog "Uploads" eines Lieds.
 * @param {string} slug Slug des Lieds
 * @param {?UploadPick} [pick] zur Auswahl einer Datei (siehe oben); ohne zeigt der Dialog alle Uploads. Die Felder
 *   zum Hochladen stehen erst nach "Datei hinzufügen" da (Knopf unter der Liste).
 * @returns {void}
 */
export function openUploads(slug, pick = null){
  (isOverlayOpen() ? openStackedOverlay : openOverlay)(`
    <h2>${escapeHtml(pick?.title ?? 'Uploads')}</h2>
    <div id="uplError"></div>
    <ul class="upl-list" id="uplList"><li class="upl-none">Lädt …</li></ul>
    <div class="btn-row" id="uplShowRow"><button class="btn btn-34" id="uplShowAdd" type="button">Datei hinzufügen</button></div>
    <div id="uplAddArea" hidden>
    <div class="upl-tabs" role="tablist">
      <button type="button" role="tab" id="uplTabFile" data-upl-tab="file" aria-selected="true">Datei hochladen</button>
      <button type="button" role="tab" id="uplTabUrl" data-upl-tab="url" aria-selected="false">Direktlink</button>
    </div>
    <div class="upl-card" data-upl-panel="file" role="tabpanel" aria-labelledby="uplTabFile">
      <label class="dropzone" id="dropzone">
        <input type="file" id="uplFile">
        <span id="dropzoneText">Datei hierherziehen oder tippen zum Auswählen</span>
      </label>
      <div class="form-field">
        <label for="uplSource">Quelle</label>
        <input type="text" id="uplSource" inputmode="url" placeholder="z. B. https://tabs.ultimate-guitar.com/tab/…">
      </div>
      <div class="form-field">
        <label for="uplDesc">Beschreibung</label>
        <input type="text" id="uplDesc" placeholder="z. B. Original-Notation, selbst angelegt">
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="uplAdd" type="button">Hochladen</button></div>
    </div>
    <div class="upl-card" data-upl-panel="url" role="tabpanel" aria-labelledby="uplTabUrl" hidden>
      <div class="form-field">
        <label for="uplUrl">Direktlink (der Server lädt die Datei herunter; er gilt als Quelle)</label>
        <input type="text" id="uplUrl" inputmode="url" placeholder="https://…">
      </div>
      <div class="form-field">
        <label for="uplUrlDesc">Beschreibung</label>
        <input type="text" id="uplUrlDesc">
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="uplFetch" type="button">Laden</button></div>
    </div>
    </div>
  `);

  const byId = id => document.getElementById(id);
  const list = byId('uplList');
  const error = byId('uplError');
  /** @type {Upload[]} */
  let uploads = [];

  const showError = message => {
    error.innerHTML = message ? `<div class="error-box">${escapeHtml(message)}</div>` : '';
  };

  /** Zeichnet die Liste (bei der Auswahl nur die passenden Dateien). */
  const render = () => {
    const shown = pick ? uploads.filter(u => pick.extensions.includes(extension(u.file))) : uploads;
    list.innerHTML = shown.length
      ? shown.map(u => uploadHtml(slug, u, !!pick)).join('')
      : pick
        ? `<li class="upl-none upl-warn">Noch keine passende Datei (${pick.extensions.map(e => '.' + e).join(', ')}) hochgeladen.</li>`
        : '<li class="upl-none">Noch keine Dateien hochgeladen.</li>';
  };

  /**
   * Lädt die Liste neu.
   * @returns {Promise<void>}
   */
  const reload = async () => {
    try {
      uploads = await listUploads(slug);
      render();
    } catch(err){
      list.innerHTML = '';
      showError(err.message);
    }
  };
  void reload();

  // Die Felder zum Hochladen stehen erst nach "Datei hinzufügen" da.
  byId('uplShowAdd').addEventListener('click', () => {
    byId('uplAddArea').hidden = false;
    byId('uplShowRow').hidden = true;
  });

  // Reiter: Datei hochladen oder Direktlink (je eine Karte sichtbar, damit der Dialog nicht scrollen muss).
  for(const tab of document.querySelectorAll('[data-upl-tab]')){
    tab.addEventListener('click', () => {
      for(const other of document.querySelectorAll('[data-upl-tab]')){
        other.setAttribute('aria-selected', String(other === tab));
      }
      for(const panel of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-upl-panel]'))){
        panel.hidden = panel.dataset.uplPanel !== tab.getAttribute('data-upl-tab');
      }
    });
  }

  /** @type {?File} per Auswahl oder Drag & Drop */
  let file = null;
  bindDropzone(f => {
    file = f;
    byId('dropzoneText').textContent = f.name;
    byId('dropzone').classList.add('has-file');
  });

  /**
   * Legt eine Datei oder einen Direktlink als Upload ab und lädt die Liste neu.
   * @param {HTMLButtonElement} btn Knopf, der gedrückt wurde (während des Hochladens gesperrt)
   * @param {{file?: ?File, url?: string, source?: string, description?: string}} upload was hochgeladen wird
   * @param {string[]} fields Eingabefelder, die danach geleert werden
   * @returns {Promise<void>}
   */
  const add = async (btn, upload, fields) => {
    showError('');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Lädt …';
    try {
      await addUpload(slug, upload);
      for(const id of fields){
        const input = /** @type {HTMLInputElement} */ (byId(id));
        input.value = '';
      }
      file = null;
      byId('dropzoneText').textContent = 'Datei hierherziehen oder tippen zum Auswählen';
      byId('dropzone').classList.remove('has-file');
      await reload();
    } catch(err){
      showError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };
  /**
   * Getrimmter Inhalt eines Eingabefelds.
   * @param {string} id Id des Feldes
   * @returns {string} Text
   */
  const value = id => {
    const input = /** @type {HTMLInputElement} */ (byId(id));
    return input.value.trim();
  };

  byId('uplAdd').addEventListener('click', e => {
    if(!file){
      showError('Bitte eine Datei wählen oder hierherziehen.');
      return;
    }
    void add(/** @type {HTMLButtonElement} */ (e.currentTarget), {file, source: value('uplSource'), description: value('uplDesc')},
      ['uplFile', 'uplSource', 'uplDesc']);
  });
  byId('uplFetch').addEventListener('click', e => {
    if(!value('uplUrl')){
      showError('Bitte einen Direktlink eingeben.');
      return;
    }
    void add(/** @type {HTMLButtonElement} */ (e.currentTarget), {url: value('uplUrl'), description: value('uplUrlDesc')},
      ['uplUrl', 'uplUrlDesc']);
  });

  list.addEventListener('click', async e => {
    const target = /** @type {HTMLElement} */ (e.target);
    const item = /** @type {?HTMLElement} */ (target.closest('.upl-item'));
    if(!item) return;
    const upload = uploads.find(u => u.file === item.dataset.file);
    if(!upload) return;
    if(target.closest('[data-pick]')){
      showError('');
      try {
        const file = await fetchUpload(slug, upload.file);
        closeOverlay();
        pick.onPick(file, upload);
      } catch(err){
        showError(err.message);
      }
    } else if(target.closest('[data-edit]')){
      item.querySelector('.upl-info').innerHTML = `
        <input type="text" class="upl-input" data-source value="${escapeHtml(upload.source)}" placeholder="Quelle">
        <input type="text" class="upl-input" data-description value="${escapeHtml(upload.description)}" placeholder="Beschreibung">
        <div class="btn-row">
          <button type="button" class="btn btn-primary btn-sm" data-save>Speichern</button>
          <button type="button" class="btn btn-sm" data-cancel>Abbrechen</button>
        </div>`;
    } else if(target.closest('[data-delete]')){
      if(!confirm(`"${upload.file}" endgültig löschen?`)) return;
      showError('');
      try {
        uploads = (await deleteUpload(slug, upload.file)).uploads;
        render();
      } catch(err){
        showError(err.message);
      }
    } else if(target.closest('[data-cancel]')){
      render();
    } else if(target.closest('[data-save]')){
      showError('');
      try {
        const source = /** @type {HTMLInputElement} */ (item.querySelector('[data-source]'));
        const description = /** @type {HTMLInputElement} */ (item.querySelector('[data-description]'));
        const saved = await updateUpload(slug, upload.file, {source: source.value, description: description.value});
        uploads = uploads.map(u => u.file === saved.file ? saved : u);
        render();
      } catch(err){
        showError(err.message);
      }
    }
  });
}
