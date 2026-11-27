<?php

/**
 * Legt einen Song mit Noten an, aus einer Guitar-Pro-Datei oder mit dem Gerüst von "+ Neuer Song". Nur alphaTab im
 * Browser liest GP-Dateien; der Browser schickt deshalb fertiges alphaTex. Die GP-Datei kommt unverändert in den
 * Upload-Ordner, eine eingebettete Audiospur wird audio.mp3 (store_new_score()). Danach wird ein Cover gesucht.
 *
 * POST /api/import.php (multipart): meta (JSON wie PUT songs.php, dazu gpSource), score (alphaTex), file (GP-Datei,
 *   fehlt bei "+ Neuer Song"). Antwort: 201 mit dem Song; scheitert das Speichern der Noten, wird er wieder entfernt.
 *   Token nötig.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/file_store.php';
require_once __DIR__ . '/lib/coverstore.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error(405, 'Nur POST erlaubt');
}

require_token();

$meta = json_decode((string)($_POST['meta'] ?? ''), true);
if (!is_array($meta)) {
    json_error(400, 'Ungültiges oder fehlendes Feld "meta"');
}
$tex = (string)($_POST['score'] ?? '');

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
        json_error(400, $tooBig ? 'Datei ist zu groß (Limit der PHP-Konfiguration)' : 'Datei im Feld "file" ist unvollständig');
    }
    if ($file['size'] > MAX_UPLOAD_BYTES) {
        json_error(400, 'Datei ist zu groß (Limit: ' . (int)(MAX_UPLOAD_BYTES / 1024 / 1024) . ' MB)');
    }
    // move_uploaded_file() prüft zusätzlich, dass die Datei tatsächlich per HTTP-Upload kam.
    $safeTmp = tempnam(sys_get_temp_dir(), 'gbimport_');
    if (!move_uploaded_file($file['tmp_name'], $safeTmp)) {
        json_error(500, 'Datei konnte nicht zwischengespeichert werden');
    }
}

// Erst prüfen, dann anlegen: Falsche Daten sollen keinen leeren Song hinterlassen.
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
    $song = store_new_score($song['slug'], $tex, $safeTmp, (string)($file['name'] ?? ''), trim((string)($meta['gpSource'] ?? '')));
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
$song = auto_cover($song['slug'], (string)$song['artist'], $song['title']) ?? $song;

json_response(201, $song);
