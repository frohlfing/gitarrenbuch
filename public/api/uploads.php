<?php

/**
 * Rohmaterial eines Songs (data/songs/<slug>/upload/), je mit Quelle und Beschreibung (Feld uploads in song.json).
 * Dateien werden nie überschrieben; gleicher Inhalt ergibt keine neue Datei. Logik: api/lib/uploadstore.php.
 *
 * GET    /api/uploads.php?slug=xyz            -> {"uploads": [{file, size, source, description, added}, …]}
 * GET    /api/uploads.php?slug=xyz&file=name  -> die Datei selbst
 * POST   /api/uploads.php?slug=xyz            -> Datei (multipart file) oder Direktlink (url), dazu source und
 *                                               description;
 *                                               Antwort: 201 mit dem Upload. Token nötig.
 * PUT    /api/uploads.php?slug=xyz&file=name  -> ändert source und description (JSON). Token nötig.
 * DELETE /api/uploads.php?slug=xyz&file=name  -> löscht die Datei; Antwort wie die Liste. Token nötig.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/uploadstore.php';

/** Content-Type je Endung, wenn die Datei im Browser geöffnet wird; alles andere kommt als Download. */
const UPLOAD_MIME = [
    'pdf' => 'application/pdf',
    'txt' => 'text/plain; charset=utf-8',
    'cho' => 'text/plain; charset=utf-8',
    'chopro' => 'text/plain; charset=utf-8',
    'crd' => 'text/plain; charset=utf-8',
    'pro' => 'text/plain; charset=utf-8',
    'png' => 'image/png',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
];

$method = $_SERVER['REQUEST_METHOD'];
$slug = (string)($_GET['slug'] ?? '');
$file = (string)($_GET['file'] ?? '');

/**
 * Der Upload mit dem Namen aus list_uploads().
 * @param string $slug Slug des Songs
 * @param string $file Dateiname
 * @return array Upload
 * @throws NotFoundException wenn es die Datei nicht gibt
 */
function find_upload(string $slug, string $file): array
{
    foreach (list_uploads($slug) as $upload) {
        if ($upload['file'] === $file) {
            return $upload;
        }
    }
    throw new NotFoundException('Datei nicht gefunden');
}

$tmp = null;
// json_response() und send_file() beenden das Skript per exit(), ein finally-Block würde übersprungen.
register_shutdown_function(function () use (&$tmp): void {
    if ($tmp !== null) {
        @unlink($tmp);
    }
});
try {
    if (read_song_json($slug) === null) {
        json_error(404, "Song '$slug' nicht gefunden");
    }
    switch ($method) {
        case 'GET':
            if ($file === '') {
                json_response(200, ['uploads' => list_uploads($slug)]);
            }
            $path = upload_path($slug, $file);
            if ($path === null) {
                json_error(404, 'Datei nicht gefunden');
            }
            $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
            if (!isset(UPLOAD_MIME[$ext])) {
                header('Content-Disposition: attachment; filename*=UTF-8\'\'' . rawurlencode($file));
            }
            send_file($path, UPLOAD_MIME[$ext] ?? 'application/octet-stream');

        case 'POST':
            require_token();
            $source = trim((string)($_POST['source'] ?? ''));
            $description = trim((string)($_POST['description'] ?? ''));
            $url = trim((string)($_POST['url'] ?? ''));
            $tmp = tempnam(sys_get_temp_dir(), 'gbupload_');
            if ($url !== '') {
                $name = download_to_file($url, $tmp);
                // Ohne eigene Quelle gilt der Link.
                $source = $source !== '' ? $source : $url;
            } else {
                $upload = $_FILES['file'] ?? null;
                if ($upload === null || $upload['error'] !== UPLOAD_ERR_OK) {
                    $tooBig = $upload !== null && in_array($upload['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);
                    json_error(400, $tooBig ? 'Datei ist zu groß (Limit der PHP-Konfiguration)'
                        : 'Keine gültige Datei im Feld "file" und kein Link im Feld "url" übermittelt');
                }
                if (!move_uploaded_file($upload['tmp_name'], $tmp)) {
                    json_error(500, 'Datei konnte nicht zwischengespeichert werden');
                }
                $name = (string)$upload['name'];
            }
            json_response(201, store_upload($slug, $tmp, $name, $source, $description));

        case 'PUT':
            require_token();
            $body = read_json_body();
            find_upload($slug, $file);
            record_upload($slug, $file, trim((string)($body['source'] ?? '')), trim((string)($body['description'] ?? '')));
            json_response(200, find_upload($slug, $file));

        case 'DELETE':
            require_token();
            find_upload($slug, $file);
            delete_upload($slug, $file);
            json_response(200, ['uploads' => list_uploads($slug)]);

        default:
            json_error(405, "Methode '$method' nicht erlaubt");
    }
} catch (FileValidationException $e) {
    json_error(400, $e->getMessage());
} catch (NotFoundException $e) {
    json_error(404, $e->getMessage());
} catch (RuntimeException $e) {
    json_error(500, $e->getMessage());
}
