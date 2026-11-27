<?php

/**
 * Audiospur eines Songs (audio.mp3) ausliefern und hochladen. Hochgeladen wird von bin/fetchaudio.php, weil dem
 * Server yt-dlp und ffmpeg fehlen.
 *
 * GET /api/audio.php?slug=xyz   -> die MP3 (audio/mpeg)
 * PUT /api/audio.php?slug=xyz   -> ersetzt audio.mp3 (Body: die MP3, höchstens MAX_UPLOAD_BYTES). Antwort: der Song.
 *                                  Token nötig.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/file_store.php';

$method = $_SERVER['REQUEST_METHOD'];
$slug = (string)($_GET['slug'] ?? '');

try {
    switch ($method) {
        case 'GET':
            if (read_song_json($slug) === null) {
                json_error(404, "Song '$slug' nicht gefunden");
            }
            $path = song_dir($slug) . '/' . SONG_FILES['audio'];
            if (!is_file($path)) {
                json_error(404, 'Keine Audiospur vorhanden');
            }
            send_file($path, 'audio/mpeg');

        case 'PUT':
            require_token();
            $tmp = tempnam(sys_get_temp_dir(), 'gbaudio_');
            try {
                $in = fopen('php://input', 'rb');
                $out = fopen($tmp, 'wb');
                // Ein Byte mehr als erlaubt lesen, damit store_audio() zu große Dateien erkennt.
                stream_copy_to_stream($in, $out, MAX_UPLOAD_BYTES + 1);
                fclose($in);
                fclose($out);
                $song = store_audio($slug, $tmp);
            } finally {
                // Aufräumen vor json_response(): Dessen exit führt finally-Blöcke nicht mehr aus.
                @unlink($tmp);
            }
            json_response(200, $song);

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
