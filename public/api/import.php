<?php

/**
 * Importiert eine Guitar-Pro-Datei als neues Lied: legt das Lied an und speichert die Datei als Rohmaterial
 * unter orig/ sowie als Arbeitsversion score.gp (siehe store_gp_file() in api/lib/file_store.php).
 * Titel, Interpret usw. liest der Browser vorher mit alphaTab aus der Datei und schickt sie als meta mit,
 * weil PHP die GP-Formate nicht selbst auswerten kann.
 *
 * POST /api/import.php (multipart/form-data)
 *   Felder: file (Pflicht, GP3–GP8), meta (Pflicht, JSON mit denselben Feldern wie POST api/songs.php).
 *   Token nötig (Header X-API-Token). Antwort: 201 mit dem neuen Lied.
 *   Schlägt das Ablegen der Datei fehl, wird das gerade angelegte Lied wieder entfernt.
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

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    $tooBig = in_array($_FILES['file']['error'] ?? null, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);
    json_error(400, $tooBig ? 'Datei ist zu groß (Limit der PHP-Konfiguration)' : 'Keine gültige Datei im Feld "file" übermittelt');
}

$file = $_FILES['file'];
if ($file['size'] > MAX_UPLOAD_BYTES) {
    json_error(400, 'Datei ist zu groß (Limit: ' . (int) (MAX_UPLOAD_BYTES / 1024 / 1024) . ' MB)');
}

$meta = json_decode((string) ($_POST['meta'] ?? ''), true);
if (!is_array($meta)) {
    json_error(400, 'Ungültiges oder fehlendes Feld "meta"');
}

// move_uploaded_file() prüft zusätzlich, dass die Datei tatsächlich per HTTP-Upload kam.
$safeTmp = tempnam(sys_get_temp_dir(), 'gbimport_');
if (!move_uploaded_file($file['tmp_name'], $safeTmp)) {
    json_error(500, 'Datei konnte nicht zwischengespeichert werden');
}

// Erst prüfen, dann anlegen: Eine falsche Datei soll kein leeres Lied hinterlassen.
// Kein finally: json_error() beendet das Skript per exit(), das würde ein finally-Block überspringen.
if (detect_gp_format($safeTmp) === null) {
    @unlink($safeTmp);
    json_error(400, 'Keine Guitar-Pro-Datei (unterstützt: GP3 bis GP8)');
}

try {
    $song = create_song($meta);
} catch (ValidationException $e) {
    @unlink($safeTmp);
    json_response(400, ['error' => 'Validierung fehlgeschlagen', 'details' => $e->errors]);
} catch (RuntimeException $e) {
    @unlink($safeTmp);
    json_error(500, $e->getMessage());
}

try {
    $song = store_gp_file($song['slug'], $safeTmp, (string) $file['name']);
} catch (RuntimeException $e) {
    @unlink($safeTmp);
    try {
        delete_song($song['slug']);
    } catch (RuntimeException) {
        // Aufräumen ist nur ein Versuch - gemeldet wird der eigentliche Fehler.
    }
    json_error(500, $e->getMessage());
}
@unlink($safeTmp);

// Cover gleich mitholen (erster Treffer bei Deezer/iTunes). Ohne Treffer bleibt es beim Platzhalter.
$song = auto_cover($song['slug'], (string) $song['artist'], $song['title']) ?? $song;

json_response(201, $song);
