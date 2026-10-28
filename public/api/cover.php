<?php

/**
 * Cover eines Lieds: ausliefern, bei Deezer/iTunes suchen, übernehmen, hochladen, entfernen.
 * Die Logik steckt in api/lib/cover.php.
 *
 * GET    /api/cover.php?slug=xyz                 -> cover.jpg als image/jpeg. 404, falls Lied oder Cover fehlt.
 * GET    /api/cover.php?artist=…&title=…         -> {"results": [...]}, Treffer von Deezer und iTunes (siehe
 *                                                   search_covers()). Kein Token nötig.
 * PUT    /api/cover.php?slug=xyz                 -> übernimmt ein Cover aus der Suche. Body: {"url": "…"}.
 * POST   /api/cover.php?slug=xyz (multipart)     -> lädt ein eigenes Bild hoch (Feld file, JPEG; der Browser
 *                                                   verkleinert und wandelt vorher um).
 * DELETE /api/cover.php?slug=xyz                 -> entfernt das Cover.
 *
 * PUT, POST und DELETE brauchen das Token (Header X-API-Token) und antworten mit dem aktualisierten Lied.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/file_store.php';
require_once __DIR__ . '/lib/cover.php';

$method = $_SERVER['REQUEST_METHOD'];
$slug = isset($_GET['slug']) ? (string) $_GET['slug'] : null;

try {
    switch ($method) {
        case 'GET':
            if ($slug === null) {
                $title = trim((string) ($_GET['title'] ?? ''));
                if ($title === '') {
                    json_error(400, 'title-Parameter erforderlich');
                }
                json_response(200, ['results' => search_covers(trim((string) ($_GET['artist'] ?? '')), $title)]);
            }
            if (read_song_json($slug) === null) {
                json_error(404, "Song '$slug' nicht gefunden");
            }
            $path = song_dir($slug) . '/' . SONG_FILES['cover'];
            if (!is_file($path)) {
                json_error(404, 'Kein Cover vorhanden');
            }
            send_file($path, 'image/jpeg');

        case 'PUT':
            require_token();
            if ($slug === null) {
                json_error(400, 'slug-Parameter erforderlich');
            }
            $data = read_json_body();
            json_response(200, store_cover_from_url($slug, (string) ($data['url'] ?? '')));

        case 'POST':
            require_token();
            if ($slug === null) {
                json_error(400, 'slug-Parameter erforderlich');
            }
            if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                json_error(400, 'Keine gültige Datei im Feld "file" übermittelt');
            }
            if ($_FILES['file']['size'] > MAX_UPLOAD_BYTES) {
                json_error(400, 'Datei ist zu groß');
            }
            $tmp = tempnam(sys_get_temp_dir(), 'gbcover_');
            if (!move_uploaded_file($_FILES['file']['tmp_name'], $tmp)) {
                json_error(500, 'Datei konnte nicht zwischengespeichert werden');
            }
            try {
                $song = store_cover($slug, $tmp);
            } finally {
                @unlink($tmp);
            }
            json_response(200, $song);

        case 'DELETE':
            require_token();
            if ($slug === null) {
                json_error(400, 'slug-Parameter erforderlich');
            }
            json_response(200, delete_cover($slug));

        default:
            json_error(405, "Methode '$method' nicht erlaubt");
    }
} catch (CoverValidationException $e) {
    json_error(400, $e->getMessage());
} catch (NotFoundException $e) {
    json_error(404, $e->getMessage());
} catch (RuntimeException $e) {
    json_error(500, $e->getMessage());
}
