<?php

require_once __DIR__ . '/crud.php';
require_once __DIR__ . '/fetch.php';

/**
 * Kantenlänge in Pixeln, in der Cover von Deezer und iTunes geladen werden (beide liefern fertige Größen).
 *
 * @var int Pixel
 */
const COVER_SIZE = 500;

/**
 * Kantenlänge der Vorschaubilder in den Suchergebnissen.
 *
 * @var int Pixel
 */
const COVER_PREVIEW_SIZE = 250;

/**
 * Höchstzahl der Suchergebnisse je Quelle.
 *
 * @var int
 */
const COVER_SEARCH_LIMIT = 6;

/**
 * Hosts, von denen Cover geladen werden dürfen (Domain-Endung; verhindert Abrufe beliebiger URLs).
 *
 * @var string[]
 */
const COVER_HOSTS = ['.dzcdn.net', '.mzstatic.com'];

/** Die Datei ist kein JPEG-Bild (geprüft am Dateiinhalt). */
class CoverValidationException extends RuntimeException
{
}

/**
 * Sucht Albumcover zu Interpret + Titel bei Deezer und iTunes (beide ohne API-Schlüssel). Deezer zuerst,
 * iTunes dahinter; gleiche Bilder einer Quelle erscheinen nur einmal. Fällt eine Quelle aus, liefert die
 * andere trotzdem.
 *
 * @param string $artist Interpret (darf leer sein)
 * @param string $title Titel
 * @return array[] Treffer mit source ("deezer" | "itunes"), artist, title, album, url (COVER_SIZE) und
 *                 preview (COVER_PREVIEW_SIZE)
 */
function search_covers(string $artist, string $title): array
{
    $term = trim("$artist $title");
    if ($term === '') {
        return [];
    }
    $results = [];
    $sources = [
        fn() => search_deezer_covers($term),
        fn() => search_itunes_covers($term),
    ];
    foreach ($sources as $search) {
        try {
            $seen = [];
            foreach ($search() as $hit) {
                if (!isset($seen[$hit['url']])) {
                    $seen[$hit['url']] = true;
                    $results[] = $hit;
                }
            }
        } catch (RuntimeException) {
            // Quelle nicht erreichbar oder ungültige Antwort: mit der anderen weitermachen.
        }
    }
    return $results;
}

/**
 * Sucht Titel bei Deezer (https://api.deezer.com/search).
 *
 * @param string $term Suchbegriff, z. B. "Bob Marley Three Little Birds"
 * @return array[] Treffer wie bei search_covers()
 * @throws RuntimeException bei Netzwerkfehler oder ungültiger Antwort
 */
function search_deezer_covers(string $term): array
{
    $url = 'https://api.deezer.com/search?' . http_build_query(['q' => $term, 'limit' => COVER_SEARCH_LIMIT]);
    $data = json_decode(http_get($url, 8, 1024 * 1024), true);
    if (!is_array($data) || !isset($data['data'])) {
        throw new RuntimeException('Deezer: keine gültige Antwort');
    }
    $hits = [];
    foreach ($data['data'] as $track) {
        $album = $track['album'] ?? [];
        if (empty($album['cover_big'])) {
            continue;
        }
        $hits[] = [
            'source' => 'deezer',
            'artist' => (string) ($track['artist']['name'] ?? ''),
            'title' => (string) ($track['title'] ?? ''),
            'album' => (string) ($album['title'] ?? ''),
            'url' => (string) $album['cover_big'],
            'preview' => (string) ($album['cover_medium'] ?? $album['cover_big']),
        ];
    }
    return $hits;
}

/**
 * Sucht Titel bei iTunes (https://itunes.apple.com/search). Die Bildgröße steckt dort in der URL
 * ("…/100x100bb.jpg") und lässt sich frei wählen.
 *
 * @param string $term Suchbegriff, z. B. "Bob Marley Three Little Birds"
 * @return array[] Treffer wie bei search_covers()
 * @throws RuntimeException bei Netzwerkfehler oder ungültiger Antwort
 */
function search_itunes_covers(string $term): array
{
    $url = 'https://itunes.apple.com/search?' . http_build_query([
        'term' => $term,
        'entity' => 'song',
        'country' => 'DE',
        'limit' => COVER_SEARCH_LIMIT,
    ]);
    $data = json_decode(http_get($url, 8, 1024 * 1024), true);
    if (!is_array($data) || !isset($data['results'])) {
        throw new RuntimeException('iTunes: keine gültige Antwort');
    }
    $sized = fn(string $art, int $size) => preg_replace('#/\d+x\d+bb\.#', "/{$size}x{$size}bb.", $art);
    $hits = [];
    foreach ($data['results'] as $track) {
        $art = (string) ($track['artworkUrl100'] ?? '');
        if ($art === '') {
            continue;
        }
        $hits[] = [
            'source' => 'itunes',
            'artist' => (string) ($track['artistName'] ?? ''),
            'title' => (string) ($track['trackName'] ?? ''),
            'album' => (string) ($track['collectionName'] ?? ''),
            'url' => $sized($art, COVER_SIZE),
            'preview' => $sized($art, COVER_PREVIEW_SIZE),
        ];
    }
    return $hits;
}

/**
 * Prüft, ob eine Cover-URL von Deezer oder iTunes stammt (siehe COVER_HOSTS).
 *
 * @param string $url zu prüfende URL
 * @return bool true, wenn https und erlaubter Host
 */
function is_allowed_cover_url(string $url): bool
{
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    if (parse_url($url, PHP_URL_SCHEME) !== 'https' || $host === '') {
        return false;
    }
    return array_any(COVER_HOSTS, fn(string $suffix) => str_ends_with($host, $suffix));
}

/**
 * JPEG-Qualität beim Zuschneiden eigener Bilder (wie toCoverJpeg() in js/library.js).
 *
 * @var int 0 bis 100
 */
const COVER_JPEG_QUALITY = 88;

/**
 * Schneidet ein JPEG mittig quadratisch zu und skaliert es auf COVER_SIZE × COVER_SIZE (kleinere Bilder werden
 * vergrößert). Bilder, die schon so groß sind (Deezer, iTunes), bleiben unverändert, damit sie nicht neu komprimiert
 * werden.
 *
 * @param string $path JPEG-Datei, wird überschrieben
 * @param int $width Breite in Pixeln
 * @param int $height Höhe in Pixeln
 * @return void
 * @throws CoverValidationException wenn sich das Bild nicht lesen lässt
 * @throws RuntimeException wenn GD fehlt oder das Schreiben scheitert
 */
function crop_cover(string $path, int $width, int $height): void
{
    if ($width === COVER_SIZE && $height === COVER_SIZE) {
        return;
    }
    if (!extension_loaded('gd')) {
        throw new RuntimeException('Zuschneiden nicht möglich: PHP-Erweiterung GD fehlt');
    }
    $source = @imagecreatefromjpeg($path);
    if ($source === false) {
        throw new CoverValidationException('JPEG-Bild nicht lesbar');
    }
    $side = min($width, $height);
    $cover = imagecreatetruecolor(COVER_SIZE, COVER_SIZE);
    imagecopyresampled($cover, $source, 0, 0, intdiv($width - $side, 2), intdiv($height - $side, 2),
        COVER_SIZE, COVER_SIZE, $side, $side);
    if (!imagejpeg($cover, $path, COVER_JPEG_QUALITY)) {
        throw new RuntimeException('Cover konnte nicht gespeichert werden');
    }
}

/**
 * Legt eine lokale JPEG-Datei als cover.jpg eines Lieds ab (ersetzt ein vorhandenes Cover), mittig quadratisch
 * zugeschnitten auf COVER_SIZE × COVER_SIZE (siehe crop_cover()). Andere Formate wandelt der Browser vor dem
 * Hochladen in JPEG um.
 *
 * @param string $slug Slug des Lieds
 * @param string $localPath lokale Bilddatei; wird nur gelesen, Aufräumen bleibt Sache des Aufrufers
 * @return array das aktualisierte Lied
 * @throws CoverValidationException|NotFoundException|RuntimeException
 */
function store_cover(string $slug, string $localPath): array
{
    if (read_song_json($slug) === null) {
        throw new NotFoundException("Song '$slug' nicht gefunden");
    }
    $info = @getimagesize($localPath);
    if ($info === false || $info[2] !== IMAGETYPE_JPEG) {
        throw new CoverValidationException('Kein JPEG-Bild');
    }
    $tmp = tempnam(sys_get_temp_dir(), 'gbcover_');
    try {
        if (!copy($localPath, $tmp)) {
            throw new RuntimeException('Cover konnte nicht gespeichert werden');
        }
        crop_cover($tmp, $info[0], $info[1]);
        if (!copy($tmp, song_dir($slug) . '/' . SONG_FILES['cover'])) {
            throw new RuntimeException('Cover konnte nicht gespeichert werden');
        }
    } finally {
        @unlink($tmp);
    }
    return touch_song($slug);
}

/**
 * Lädt ein Cover von Deezer oder iTunes und legt es als cover.jpg ab.
 *
 * @param string $slug Slug des Lieds
 * @param string $url Bild-URL aus search_covers()
 * @return array das aktualisierte Lied
 * @throws CoverValidationException|NotFoundException|RuntimeException
 */
function store_cover_from_url(string $slug, string $url): array
{
    if (!is_allowed_cover_url($url)) {
        throw new CoverValidationException('Cover nur von Deezer oder iTunes');
    }
    $tmp = tempnam(sys_get_temp_dir(), 'gbcover_');
    try {
        file_put_contents($tmp, http_get($url, 10, 4 * 1024 * 1024));
        return store_cover($slug, $tmp);
    } finally {
        @unlink($tmp);
    }
}

/**
 * Sucht ein Cover zu Interpret + Titel und übernimmt den ersten Treffer (beim Import). Fehler werden
 * verschluckt: Ein fehlendes Cover darf den Import nicht scheitern lassen.
 *
 * @param string $slug Slug des Lieds
 * @param string $artist Interpret
 * @param string $title Titel
 * @return array|null das aktualisierte Lied oder null, wenn kein Cover gefunden oder gespeichert wurde
 */
function auto_cover(string $slug, string $artist, string $title): ?array
{
    try {
        $hits = search_covers($artist, $title);
        return $hits ? store_cover_from_url($slug, $hits[0]['url']) : null;
    } catch (RuntimeException) {
        return null;
    }
}

/**
 * Entfernt das Cover eines Lieds.
 *
 * @param string $slug Slug des Lieds
 * @return array das aktualisierte Lied
 * @throws NotFoundException|RuntimeException
 */
function delete_cover(string $slug): array
{
    if (read_song_json($slug) === null) {
        throw new NotFoundException("Song '$slug' nicht gefunden");
    }
    $path = song_dir($slug) . '/' . SONG_FILES['cover'];
    if (is_file($path) && !unlink($path)) {
        throw new RuntimeException('Cover konnte nicht gelöscht werden');
    }
    return touch_song($slug);
}
