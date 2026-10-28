<?php

/**
 * Legt ein neues Lied mit Noten an: beim Import einer Guitar-Pro-Datei oder mit dem Gerüst aus dem Formular
 * "+ Neues Lied". Die Noten kommen als alphaTex (score.atex), weil nur alphaTab im Browser die GP-Formate
 * auswerten kann: Der Browser wandelt die Datei um, prüft das Ergebnis und schickt Angaben und Noten mit. Die
 * Original-GP-Datei landet unverändert unter orig/, eine eingebettete Audiospur wird zu audio.mp3 (siehe
 * store_new_score() in api/lib/file_store.php).
 *
 * POST /api/import.php (multipart/form-data)
 *   Felder: meta (Pflicht, JSON mit denselben Feldern wie PUT api/songs.php), score (Pflicht, alphaTex),
 *   file (Original-GP-Datei, GP3–GP8; fehlt bei "+ Neues Lied").
 *   Token nötig (Header X-API-Token). Antwort: 201 mit dem neuen Lied.
 *   Schlägt das Speichern der Noten fehl, wird das gerade angelegte Lied wieder entfernt.
 *   Danach wird das Cover gesucht (siehe auto_cover() in api/lib/cover.php); ohne Treffer fehlt es einfach.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/file_store.php';
require_once __DIR__ . '/lib/cover.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error(405, 'Nur POST erlaubt');
}

require_token();

$meta = json_decode((string) ($_POST['meta'] ?? ''), true);
if (!is_array($meta)) {
    json_error(400, 'Ungültiges oder fehlendes Feld "meta"');
}
$tex = (string) ($_POST['score'] ?? '');

// Die GP-Datei ist freiwillig; wenn eine kommt, muss sie aber vollständig angekommen sein.
$file = $_FILES['file'] ?? null;
$safeTmp = null;
/**
 * Entfernt die zwischengespeicherte GP-Datei, falls es eine gibt.
 * @return void
 */
$cleanup = function () use (&$safeTmp): void {
    if ($safeTmp !== null) {
        @unlink($safeTmp);
    }
};
if ($file !== null && $file['error'] !== UPLOAD_ERR_NO_FILE) {
    if ($file['error'] !== UPLOAD_ERR_OK) {
        $tooBig = in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);
        json_error(400, $tooBig
            ? 'Datei ist zu groß (Limit der PHP-Konfiguration)'
            : 'Datei im Feld "file" ist unvollständig');
    }
    if ($file['size'] > MAX_UPLOAD_BYTES) {
        json_error(400, 'Datei ist zu groß (Limit: ' . (int) (MAX_UPLOAD_BYTES / 1024 / 1024) . ' MB)');
    }
    // move_uploaded_file() prüft zusätzlich, dass die Datei tatsächlich per HTTP-Upload kam.
    $safeTmp = tempnam(sys_get_temp_dir(), 'gbimport_');
    if (!move_uploaded_file($file['tmp_name'], $safeTmp)) {
        json_error(500, 'Datei konnte nicht zwischengespeichert werden');
    }
}

// Erst prüfen, dann anlegen: Falsche Daten sollen kein leeres Lied hinterlassen.
// Kein finally: json_error() beendet das Skript per exit(), das würde ein finally-Block überspringen.
try {
    validate_score($tex);
    if ($safeTmp !== null && detect_gp_format($safeTmp) === null) {
        throw new FileValidationException('Keine Guitar-Pro-Datei (unterstützt: GP3 bis GP8)');
    }
    $song = create_song($meta);
} catch (FileValidationException $e) {
    $cleanup();
    json_error(400, $e->getMessage());
} catch (ValidationException $invalid) {
    // Eigener Name statt $e: Sonst sieht PhpStorm hier auch die Typen der anderen catch-Blöcke (ohne errors).
    $cleanup();
    json_response(400, ['error' => 'Validierung fehlgeschlagen', 'details' => $invalid->errors]);
} catch (RuntimeException $e) {
    $cleanup();
    json_error(500, $e->getMessage());
}

try {
    $song = store_new_score($song['slug'], $tex, $safeTmp, (string) ($file['name'] ?? ''));
} catch (RuntimeException $e) {
    $cleanup();
    try {
        delete_song($song['slug']);
    } catch (RuntimeException) {
        // Aufräumen ist nur ein Versuch - gemeldet wird der eigentliche Fehler.
    }
    json_error(500, $e->getMessage());
}
$cleanup();

// Cover gleich mitholen (erster Treffer bei Deezer/iTunes). Ohne Treffer bleibt es beim Platzhalter.
$song = auto_cover($song['slug'], (string) $song['artist'], $song['title']) ?? $song;

json_response(201, $song);
