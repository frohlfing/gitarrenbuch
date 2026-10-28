<?php

/**
 * Akkorddatei (ChordPro oder Text) zu einem Lied hochladen. Die Logik steckt in api/lib/lyrics_store.php.
 *
 * POST /api/lyrics.php?slug=xyz (multipart) -> Feld file (.cho, .chopro, .crd, .pro, .txt). Die Datei landet als
 *                                             Rohmaterial unter orig/; in die Noten eingearbeitet wird sie mit dem
 *                                             geplanten Editor. Token nötig (Header X-API-Token), Antwort: das Lied.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/lyrics_store.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error(405, 'Nur POST erlaubt');
}
require_token();

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    json_error(400, 'Keine gültige Datei im Feld "file" übermittelt');
}
$tmp = tempnam(sys_get_temp_dir(), 'gbchords_');
if (!move_uploaded_file($_FILES['file']['tmp_name'], $tmp)) {
    json_error(500, 'Datei konnte nicht zwischengespeichert werden');
}

try {
    $song = store_chord_file((string) ($_GET['slug'] ?? ''), $tmp, (string) $_FILES['file']['name']);
} catch (FileValidationException $e) {
    @unlink($tmp);
    json_error(400, $e->getMessage());
} catch (NotFoundException $e) {
    @unlink($tmp);
    json_error(404, $e->getMessage());
} catch (RuntimeException $e) {
    @unlink($tmp);
    json_error(500, $e->getMessage());
}
@unlink($tmp);

json_response(200, $song);
