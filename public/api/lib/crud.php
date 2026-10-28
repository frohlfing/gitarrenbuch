<?php

require_once __DIR__ . '/slug.php';
require_once __DIR__ . '/youtube.php';

/** Eingaben eines Lieds sind ungültig; $errors enthält die einzelnen Meldungen. */
class ValidationException extends RuntimeException
{
    /**
     * @param string[] $errors Fehlermeldungen
     */
    public function __construct(public readonly array $errors)
    {
        parent::__construct(implode('; ', $errors));
    }
}

/** Lied-Slug existiert nicht. */
class NotFoundException extends RuntimeException
{
}

/** Ziel-Slug beim Rename ist bereits belegt. */
class ConflictException extends RuntimeException
{
}

/**
 * Erlaubte Werte für das Feld technique (null = nicht festgelegt).
 *
 * @var string[]
 */
const SONG_TECHNIQUES = ['strumming', 'fingerpicking'];

/**
 * Erlaubte Schlüssel in sources (Herkunft des Rohmaterials).
 *
 * @var string[]
 */
const SONG_SOURCES = ['ultimateGuitar', 'youtube'];

/**
 * Weitere Angaben aus der GP-Datei, beim Import 1:1 übernommen und in song.json als eigene Felder vor notes
 * gespeichert (die Noten enthalten keine Angaben; beim GP-Export werden sie wieder eingesetzt). Das Gitarrenbuch nutzt
 * sie vorerst nicht, das Formular "Song bearbeiten" lässt sie unverändert.
 *
 * @var array<string, string> Feld in song.json => Bezeichnung in Guitar Pro
 */
const SONG_INFO_FIELDS = [
    'subtitle' => 'Untertitel',
    'album' => 'Album',
    'words' => 'Text',
    'music' => 'Musik',
    'copyright' => 'Copyright',
    'tab' => 'Tab-Autor',
    'instructions' => 'Anweisungen',
];

/**
 * Dateien im Liedordner, deren Vorhandensein die API als "files" mitliefert (Liste der Schlüssel der vorhandenen
 * Dateien). Wird bei jedem Lesen aus dem Dateisystem bestimmt und nicht in song.json gespeichert, damit es nicht
 * veralten kann.
 *
 * @var array<string, string> Schlüssel in files => Dateiname
 */
const SONG_FILES = [
    'score' => 'score.atex',
    'audio' => 'audio.mp3',
    'leadsheet' => 'leadsheet.json',
    'cover' => 'cover.jpg',
];

/**
 * Absoluter Pfad zum Ordner eines Lieds (existiert nicht zwingend).
 *
 * @param string $slug Slug des Lieds
 * @return string Ordnerpfad ohne "/" am Ende
 */
function song_dir(string $slug): string
{
    return SONGS_DIR . '/' . $slug;
}

/**
 * Liest und dekodiert song.json eines Lieds.
 *
 * @param string $slug Slug des Lieds
 * @return array|null Inhalt von song.json; null, fals Slug ungültig, Ordner/Datei fehlt oder JSON ungültig ist
 */
function read_song_json(string $slug): ?array
{
    if (!is_valid_slug($slug)) {
        return null;
    }
    $path = song_dir($slug) . '/song.json';
    if (!is_file($path)) {
        return null;
    }
    $data = json_decode(file_get_contents($path), true);
    return is_array($data) ? $data : null;
}

/**
 * Schreibt $song als song.json (überschreibt eine vorhandene Datei vollständig). Das berechnete Feld files wird
 * nicht gespeichert.
 *
 * @param string $slug Slug des Lieds, der Ordner muss existieren
 * @param array $song zu speichernde Felder
 * @return void
 */
function write_song_json(string $slug, array $song): void
{
    unset($song['files']);
    // Leeres sources muss als {} statt [] gespeichert werden (json_decode() liefert dafür ein leeres Array).
    $song['sources'] = (object) ($song['sources'] ?? []);
    file_put_contents(
        song_dir($slug) . '/song.json',
        json_encode($song, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n"
    );
}

/**
 * Alle Unterordner von SONGS_DIR (= alle Slugs), unsortiert.
 *
 * @return string[] Slugs; leer, falls SONGS_DIR noch gar nicht existiert (frische Installation, bevor das erste
 *                  Lied angelegt wurde)
 */
function list_song_slugs(): array
{
    if (!is_dir(SONGS_DIR)) {
        return [];
    }
    $slugs = [];
    foreach (scandir(SONGS_DIR) ?: [] as $entry) {
        if ($entry !== '.' && $entry !== '..' && is_dir(SONGS_DIR . '/' . $entry)) {
            $slugs[] = $entry;
        }
    }
    return $slugs;
}

/**
 * Ergänzt $song um das berechnete Feld files (welche Dateien im Liedordner vorhanden sind).
 *
 * @param string $slug Slug des Lieds
 * @param array $song Inhalt von song.json
 * @return array $song mit files (Liste der Schlüssel aus SONG_FILES, deren Datei vorhanden ist, z. B.
 *               ["score", "audio", "cover"]) und sources als Objekt
 */
function with_file_flags(string $slug, array $song): array
{
    $dir = song_dir($slug);
    $song['sources'] = (object) ($song['sources'] ?? []);
    $song['files'] = array_keys(array_filter(SONG_FILES, fn(string $name) => is_file($dir . '/' . $name)));
    return $song;
}

/**
 * Liest ein einzelnes Lied inkl. files.
 *
 * @param string $slug Slug des Lieds
 * @return array|null das Lied; null, wenn nicht gefunden
 */
function get_song(string $slug): ?array
{
    $song = read_song_json($slug);
    return $song === null ? null : with_file_flags($slug, $song);
}

/**
 * Liest alle Lieder inkl. files.
 *
 * @return array[] alphabetisch nach Titel sortiert (das Frontend sortiert clientseitig ggf. um)
 */
function list_songs(): array
{
    $songs = [];
    foreach (list_song_slugs() as $slug) {
        $song = get_song($slug);
        if ($song !== null) {
            $songs[] = $song;
        }
    }
    usort($songs, fn(array $a, array $b) => strcasecmp((string) $a['title'], (string) $b['title']));
    return $songs;
}

/**
 * Vergleichsschlüssel für Interpret + Titel (case-insensitiv, Leerraum am Rand ignoriert).
 *
 * @param string $artist Interpret
 * @param string $title Titel
 * @return string Schlüssel für den Vergleich
 */
function song_identity(string $artist, string $title): string
{
    return mb_strtolower(trim($artist)) . "\n" . mb_strtolower(trim($title));
}

/**
 * Prüft, ob es Interpret + Titel schon gibt.
 *
 * @param string $artist Interpret
 * @param string $title Titel
 * @param string|null $excludeSlug schließt das eigene Lied beim Update aus
 * @return bool true, wenn ein anderes Lied mit Interpret + Titel existiert
 */
function song_exists(string $artist, string $title, ?string $excludeSlug = null): bool
{
    $needle = song_identity($artist, $title);
    foreach (list_song_slugs() as $slug) {
        if ($slug === $excludeSlug) {
            continue;
        }
        $s = read_song_json($slug);
        if ($s !== null && song_identity((string) ($s['artist'] ?? ''), (string) $s['title']) === $needle) {
            return true;
        }
    }
    return false;
}

/**
 * Prüft die rohen Request-Daten eines Lieds.
 *
 * @param array $data Request-Daten (siehe PUT api/songs.php bzw. meta von api/import.php)
 * @return string[] Fehlermeldungen, leer wenn valide
 */
function validate_song_input(array $data): array
{
    $errors = [];

    if (trim((string) ($data['title'] ?? '')) === '') {
        $errors[] = 'title ist erforderlich';
    }
    foreach (['artist', 'notes', ...array_keys(SONG_INFO_FIELDS)] as $field) {
        if (isset($data[$field]) && !is_string($data[$field])) {
            $errors[] = "$field muss ein Text sein";
        }
    }
    if (!empty($data['technique']) && !in_array($data['technique'], SONG_TECHNIQUES, true)) {
        $errors[] = 'technique muss ' . implode(' oder ', SONG_TECHNIQUES) . ' sein';
    }
    if (isset($data['tags']) && !is_array($data['tags'])) {
        $errors[] = 'tags muss ein Array sein';
    }
    if (isset($data['sources']) && !is_array($data['sources'])) {
        $errors[] = 'sources muss ein Objekt sein';
    }
    if (isset($data['youtubeSeconds']) && (!is_int($data['youtubeSeconds']) || $data['youtubeSeconds'] < 0)) {
        $errors[] = 'youtubeSeconds muss eine ganze Zahl ab 0 sein';
    }

    return $errors;
}

/**
 * Baut aus rohen Request-Daten die vom Store verwalteten Felder, mit Defaults/Typumwandlung. Tonart, Capo,
 * Stimmung und Tempo gehören nicht dazu: Sie stehen nur in den Noten. Eine YouTube-Quelle wird auf
 * "https://www.youtube.com/watch?v=<ID>" gekürzt (siehe youtube_watch_url()). youtubeSeconds ist die Länge dieses
 * Clips; das Formular ermittelt sie nur, wenn sich die URL ändert, und speichert sie hier, damit YouTube nicht bei
 * jedem Öffnen abgefragt wird. Ohne YouTube-Quelle ist sie null.
 *
 * @param array $data bereits validierte Request-Daten (siehe validate_song_input())
 * @return array title, artist, technique, tags, die Felder aus SONG_INFO_FIELDS, notes, sources, youtubeSeconds
 */
function normalize_song_fields(array $data): array
{
    $optionalText = fn(string $field) => trim((string) ($data[$field] ?? '')) ?: null;

    $tags = array_map(fn($t) => trim((string) $t), $data['tags'] ?? []);
    $tags = array_values(array_unique(array_filter($tags, fn(string $t) => $t !== '')));

    $sources = [];
    foreach (SONG_SOURCES as $key) {
        $url = trim((string) ($data['sources'][$key] ?? ''));
        if ($key === 'youtube') {
            $url = youtube_watch_url($url);
        }
        if ($url !== '') {
            $sources[$key] = $url;
        }
    }

    $info = [];
    foreach (array_keys(SONG_INFO_FIELDS) as $field) {
        $info[$field] = $optionalText($field);
    }

    return [
        'title' => trim((string) ($data['title'] ?? '')),
        'artist' => $optionalText('artist'),
        'technique' => !empty($data['technique']) ? (string) $data['technique'] : null,
        'tags' => $tags,
        ...$info,
        'notes' => $optionalText('notes'),
        'sources' => (object) $sources,
        'youtubeSeconds' => isset($sources['youtube']) && isset($data['youtubeSeconds'])
            ? (int) $data['youtubeSeconds'] : null,
    ];
}

/**
 * Bildet den Slug aus Interpret + Titel.
 *
 * @param array $fields normalisierte Felder (siehe normalize_song_fields())
 * @return string Slug, z. B. "cat-stevens-father-and-son"
 * @throws ValidationException wenn sich daraus kein gültiger Ordnername ergibt
 */
function song_base_slug(array $fields): string
{
    $baseSlug = slugify(trim(($fields['artist'] ?? '') . ' ' . $fields['title']));
    if ($baseSlug === '') {
        throw new ValidationException(['Titel ergibt keinen gültigen Ordnernamen']);
    }
    return $baseSlug;
}

/**
 * Legt ein neues Lied an: validiert, vergibt Slug/created, erstellt den Ordner und schreibt song.json.
 *
 * @param array $data Request-Daten (siehe PUT api/songs.php bzw. meta von api/import.php)
 * @return array das neue Lied inkl. files
 * @throws ValidationException|RuntimeException
 */
function create_song(array $data): array
{
    $errors = validate_song_input($data);
    if ($errors) {
        throw new ValidationException($errors);
    }

    $fields = normalize_song_fields($data);
    if (song_exists((string) $fields['artist'], $fields['title'])) {
        throw new ValidationException(['Song mit diesem Interpreten und Titel gibt es schon']);
    }

    $slug = unique_slug(song_base_slug($fields));

    if (!mkdir(song_dir($slug), 0775, true) && !is_dir(song_dir($slug))) {
        throw new RuntimeException('Song-Ordner konnte nicht angelegt werden');
    }

    $now = date('c');
    $song = array_merge($fields, [
        'slug' => $slug,
        'created' => $now,
        'updated' => $now,
    ]);

    write_song_json($slug, $song);
    return with_file_flags($slug, $song);
}

/**
 * Aktualisiert ein Lied. Ändern sich Interpret oder Titel so, dass der Slug wechselt, wird der
 * Ordner umbenannt – bei Fehlschlag bleibt der alte Zustand vollständig erhalten.
 * Ändert sich die YouTube-URL, wird die bisherige audio.mp3 entfernt (siehe delete_audio()).
 *
 * @param string $slug bisheriger Slug des Lieds
 * @param array $data Request-Daten (siehe PUT api/songs.php)
 * @return array das aktualisierte Lied inkl. files (ggf. mit neuem Slug)
 * @throws NotFoundException|ValidationException|ConflictException|RuntimeException
 */
function update_song(string $slug, array $data): array
{
    $existing = read_song_json($slug);
    if ($existing === null) {
        throw new NotFoundException("Song '$slug' nicht gefunden");
    }

    $errors = validate_song_input($data);
    if ($errors) {
        throw new ValidationException($errors);
    }

    // Das Formular schickt die Angaben aus SONG_INFO_FIELDS nicht mit (nicht angezeigt): Fehlen sie, bleiben die
    // gespeicherten.
    $data += array_intersect_key($existing, SONG_INFO_FIELDS);
    $fields = normalize_song_fields($data);
    // Ohne youtubeSeconds (z. B. Aufruf per Skript) bleibt die gespeicherte Länge, solange die URL gleich ist.
    if (!array_key_exists('youtubeSeconds', $data)
        && ($fields['sources']->youtube ?? null) === ($existing['sources']['youtube'] ?? null)) {
        $fields['youtubeSeconds'] = $existing['youtubeSeconds'] ?? null;
    }
    if (song_exists((string) $fields['artist'], $fields['title'], $slug)) {
        throw new ValidationException(['Song mit diesem Interpreten und Titel gibt es schon']);
    }

    $newBaseSlug = song_base_slug($fields);
    $newSlug = $newBaseSlug === $slug ? $slug : unique_slug($newBaseSlug, $slug);

    if ($newSlug !== $slug) {
        $oldDir = song_dir($slug);
        $newDir = song_dir($newSlug);
        if (is_dir($newDir)) {
            throw new ConflictException("Zielordner '$newSlug' existiert bereits");
        }
        if (!rename($oldDir, $newDir)) {
            throw new RuntimeException('Umbenennen des Song-Ordners fehlgeschlagen');
        }
    }

    // Anderer YouTube-Clip: Die Audiospur passt nicht mehr dazu (und die Sync-Punkte meist auch nicht). Wird die URL
    // nur gelöscht, bleibt die Audiospur.
    $newUrl = $fields['sources']->youtube ?? null;
    if ($newUrl !== null && $newUrl !== ($existing['sources']['youtube'] ?? null)) {
        delete_audio($newSlug);
    }

    // $fields zweimal: Das erste bestimmt die Reihenfolge der Schlüssel (neu hinzugekommene Felder landen so an
    // ihrem Platz statt am Ende), das zweite die Werte. Übrige Felder aus $existing (created usw.) bleiben erhalten.
    $song = array_merge($fields, $existing, $fields, ['slug' => $newSlug, 'updated' => date('c')]);
    write_song_json($newSlug, $song);
    return with_file_flags($newSlug, $song);
}

/**
 * Entfernt audio.mp3 eines Lieds, z. B. weil ein anderer YouTube-Clip eingetragen wurde. Danach hat das Lied keine
 * Audiospur mehr, und bin/audio.php holt die neue. Ein Backup auf dem Server gibt es nicht: Das YouTube-Original
 * liegt bei bin/audio.php (data/backup/<slug>/youtube-<Video-ID>.<ext>). Ohne audio.mp3 passiert nichts.
 *
 * @param string $slug Slug des Lieds
 * @return void
 * @throws RuntimeException wenn die Datei nicht gelöscht werden kann
 */
function delete_audio(string $slug): void
{
    $audio = song_dir($slug) . '/' . SONG_FILES['audio'];
    if (is_file($audio) && !unlink($audio)) {
        throw new RuntimeException('Audiospur konnte nicht entfernt werden');
    }
}

/**
 * Setzt nur das Änderungsdatum (z. B. nach einem Datei-Upload).
 *
 * @param string $slug Slug des Lieds
 * @return array das aktualisierte Lied inkl. files
 * @throws NotFoundException
 */
function touch_song(string $slug): array
{
    $song = read_song_json($slug);
    if ($song === null) {
        throw new NotFoundException("Song '$slug' nicht gefunden");
    }
    $song['updated'] = date('c');
    write_song_json($slug, $song);
    return with_file_flags($slug, $song);
}

/**
 * Entfernt den kompletten Liedordner (inkl. orig/).
 *
 * @param string $slug Slug des Lieds
 * @return void
 * @throws NotFoundException|RuntimeException
 */
function delete_song(string $slug): void
{
    if (read_song_json($slug) === null) {
        throw new NotFoundException("Song '$slug' nicht gefunden");
    }
    remove_directory_recursive(song_dir($slug));
}

/**
 * Löscht einen Ordner samt Inhalt rekursiv (PHP hat dafür keine eingebaute Funktion).
 * Prüft die Rückgabewerte von unlink()/rmdir() bewusst: Unter Windows kann ein kurzzeitiger Datei-Lock
 * (z. B. Windows Search/Virenscanner) das Löschen verhindern, die API darf dann keinen Erfolg melden.
 *
 * @param string $dir zu löschender Ordner
 * @return void
 * @throws RuntimeException wenn eine Datei oder der Ordner selbst nicht gelöscht werden konnte
 */
function remove_directory_recursive(string $dir): void
{
    foreach (scandir($dir) ?: [] as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $path = $dir . '/' . $item;
        if (is_dir($path)) {
            remove_directory_recursive($path);
        } elseif (!unlink($path)) {
            throw new RuntimeException("Datei konnte nicht gelöscht werden: $path");
        }
    }
    if (!rmdir($dir)) {
        throw new RuntimeException("Ordner konnte nicht gelöscht werden: $dir");
    }
}
