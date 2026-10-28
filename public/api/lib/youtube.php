<?php

require_once __DIR__ . '/fetch.php';

/**
 * Cookie, mit dem YouTube die Videoseite ohne Einwilligungsseite ausliefert (sonst leitet es Abrufe aus der EU auf
 * consent.youtube.com um, dort steht keine Länge).
 *
 * @var string
 */
const YOUTUBE_CONSENT_COOKIE = 'Cookie: SOCS=CAI';

/**
 * Höchstgröße der Videoseite in Bytes (sie ist rund 1,5 MB groß, die Angaben stehen weit vorn).
 *
 * @var int
 */
const YOUTUBE_PAGE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Video-ID aus einer YouTube-URL (watch?v=…, youtu.be/…, shorts/…, embed/…, live/…).
 *
 * @param string $url URL, wie sie im Formular steht
 * @return string|null die elfstellige ID; null, wenn die URL kein YouTube-Video ist
 */
function youtube_id(string $url): ?string
{
    $pattern = '#^https?://(?:(?:www\.|m\.|music\.)?youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)'
        . '|youtu\.be/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])#';
    return preg_match($pattern, trim($url), $m) ? $m[1] : null;
}

/**
 * Kurzform einer YouTube-URL ohne Playlist, Startzeit und andere Parameter, so wie sie in sources.youtube steht.
 * Das Formular kürzt schon beim Einfügen (siehe youtubeWatchUrl() in js/library.js).
 *
 * @param string $url URL, wie sie im Formular steht
 * @return string "https://www.youtube.com/watch?v=<ID>"; andere URLs unverändert (nur getrimmt)
 */
function youtube_watch_url(string $url): string
{
    $id = youtube_id($url);
    return $id !== null ? "https://www.youtube.com/watch?v=$id" : trim($url);
}

/**
 * Titel und Länge eines YouTube-Videos, gelesen aus der Videoseite (ohne API-Schlüssel; oEmbed kennt die Länge nicht).
 *
 * @param string $id Video-ID aus youtube_id()
 * @return array{id: string, title: string, seconds: int} Länge in ganzen Sekunden
 * @throws RuntimeException bei Netzwerkfehler oder wenn die Seite keine Länge enthält (Video gelöscht oder privat)
 */
function youtube_video_info(string $id): array
{
    $html = http_get("https://www.youtube.com/watch?v=$id", 10, YOUTUBE_PAGE_MAX_BYTES, [YOUTUBE_CONSENT_COOKIE]);
    if (!preg_match('/"lengthSeconds":"(\d+)"/', $html, $length)) {
        throw new RuntimeException('Video nicht gefunden oder nicht verfügbar');
    }
    preg_match('/<meta name="title" content="([^"]*)"/', $html, $title);
    return [
        'id' => $id,
        'title' => html_entity_decode($title[1] ?? '', ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        'seconds' => (int) $length[1],
    ];
}
