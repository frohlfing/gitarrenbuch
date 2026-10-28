<?php

/**
 * Titel und Länge eines YouTube-Videos, damit man im Formular sieht, ob der Clip zu den Noten passt.
 * Die Logik steckt in api/lib/youtube.php.
 *
 * `GET /api/youtube.php?url=…`
 * Antwort: {"id": "…", "title": "…", "seconds": 213}. 400, wenn die URL kein YouTube-Video ist, 502, wenn YouTube
 * nicht antwortet oder das Video nicht verfügbar ist. Kein Token nötig.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/youtube.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error(405, 'Nur GET erlaubt');
}

$id = youtube_id((string) ($_GET['url'] ?? ''));
if ($id === null) {
    json_error(400, 'Keine YouTube-URL');
}

try {
    json_response(200, youtube_video_info($id));
} catch (RuntimeException $e) {
    json_error(502, $e->getMessage());
}
