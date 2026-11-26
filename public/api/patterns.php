<?php

/**
 * Pattern-Katalog (data/patterns.json): Strumming und Picking Patterns, auf die die Songs verweisen (score.json
 * der Songs). Aufbau und Schreibweise der Patterns siehe js/sheet.js. Fehlt data/patterns.json (data/ gehört nicht
 * ins Repo), legt der erste Zugriff sie mit DEFAULT_PATTERNS an.
 *
 * GET /api/patterns.php   -> {"patterns": [...], "usage": {"folk": 3, ...}}. usage: in wie vielen Songs ein Pattern
 *                            vorkommt (aus score.json aller Songs), damit der Editor vor dem Ändern warnen kann.
 *                            Kein Token nötig.
 * PUT /api/patterns.php   -> ersetzt den Katalog. Body: {"patterns": [...]}. Antwort wie GET. Token nötig.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/crud.php';

/**
 * Pfad des Katalogs.
 *
 * @var string
 */
const PATTERNS_FILE = DATA_DIR . '/patterns.json';

/**
 * Erstbefüllung des Katalogs (Felder wie in validate_patterns()).
 *
 * @var array<int, array>
 */
const DEFAULT_PATTERNS = [
    ['id' => 'grundschlag', 'name' => 'Grundschlag', 'technique' => 'strumming', 'timeSignature' => '4/4', 'grid' => 8, 'strokes' => 'd.d.d.d.'],
    ['id' => 'folk', 'name' => 'Folk', 'technique' => 'strumming', 'timeSignature' => '4/4', 'grid' => 8, 'strokes' => 'd.du.udu'],
    ['id' => 'pop', 'name' => 'Pop', 'technique' => 'strumming', 'timeSignature' => '4/4', 'grid' => 8, 'strokes' => 'd.duudu.'],
    ['id' => 'rock-achtel', 'name' => 'Rock-Achtel', 'technique' => 'strumming', 'timeSignature' => '4/4', 'grid' => 8, 'strokes' => 'dudududu'],
    ['id' => 'reggae', 'name' => 'Reggae (Offbeat)', 'technique' => 'strumming', 'timeSignature' => '4/4', 'grid' => 8, 'strokes' => '.u.u.u.u'],
    ['id' => 'walzer', 'name' => 'Walzer', 'technique' => 'strumming', 'timeSignature' => '3/4', 'grid' => 8, 'strokes' => 'D.d.d.'],
    ['id' => 'sechs-achtel', 'name' => '6/8', 'technique' => 'strumming', 'timeSignature' => '6/8', 'grid' => 8, 'strokes' => 'D.uD.u'],
    ['id' => 'travis', 'name' => 'Travis-Picking', 'technique' => 'picking', 'timeSignature' => '4/4', 'grid' => 8, 'steps' => 'p i q m p i q m'],
    ['id' => 'arpeggio', 'name' => 'Arpeggio', 'technique' => 'picking', 'timeSignature' => '4/4', 'grid' => 8, 'steps' => 'p i m a m i m i'],
    ['id' => 'wechselbass', 'name' => 'Wechselbass', 'technique' => 'picking', 'timeSignature' => '4/4', 'grid' => 8, 'steps' => 'p . ima . q . ima .'],
    ['id' => 'walzer-zupf', 'name' => 'Walzer (gezupft)', 'technique' => 'picking', 'timeSignature' => '3/4', 'grid' => 8, 'steps' => 'p . im . im .'],
    ['id' => 'arpeggio-3-4', 'name' => 'Arpeggio 3/4', 'technique' => 'picking', 'timeSignature' => '3/4', 'grid' => 8, 'steps' => 'p i m a m i'],
];

/**
 * Höchstzahl der Patterns (Schutz vor versehentlich riesigen Requests).
 *
 * @var int
 */
const PATTERNS_MAX = 500;

/**
 * Liest den Katalog; fehlt die Datei, wird sie mit DEFAULT_PATTERNS angelegt.
 *
 * @return array<int, array> Patterns
 */
function read_patterns(): array
{
    if (!is_file(PATTERNS_FILE)) {
        write_patterns(DEFAULT_PATTERNS);
        return DEFAULT_PATTERNS;
    }
    $data = json_decode((string)@file_get_contents(PATTERNS_FILE), true);
    return is_array($data['patterns'] ?? null) ? $data['patterns'] : [];
}

/**
 * Schreibt den Katalog (erst daneben, dann umbenannt, damit nie eine halbe Datei entsteht).
 *
 * @param array<int, array> $patterns Patterns
 * @return void
 */
function write_patterns(array $patterns): void
{
    $json = json_encode(['patterns' => $patterns], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp = PATTERNS_FILE . '.tmp';
    if (file_put_contents($tmp, $json . "\n") === false || !rename($tmp, PATTERNS_FILE)) {
        @unlink($tmp);
        json_error(500, 'Pattern-Katalog konnte nicht gespeichert werden');
    }
}

/**
 * Zählt, in wie vielen Songs ein Pattern vorkommt (Patterns des Songs, siehe read_leadsheet()), und sammelt dazu die
 * Genres dieser Songs.
 *
 * @return array{usage: array<string, int>, genres: array<string, string[]>} Zahl der Songs und Genres je Pattern-id
 */
function pattern_stats(): array
{
    $usage = [];
    $genres = [];
    foreach (list_song_slugs() as $slug) {
        $data = read_leadsheet($slug);
        $ids = [];
        foreach ((array)($data['patterns'] ?? []) as $pattern) {
            if (is_array($pattern) && is_string($pattern['id'] ?? null) && $pattern['id'] !== '') {
                $ids[$pattern['id']] = true;
            }
        }
        if (!$ids) {
            continue;
        }
        $tags = array_values(array_filter(array_map('strval', (array)(read_song_json($slug)['tags'] ?? []))));
        foreach (array_keys($ids) as $id) {
            $usage[$id] = ($usage[$id] ?? 0) + 1;
            $genres[$id] = array_values(array_unique(array_merge($genres[$id] ?? [], $tags)));
        }
    }
    foreach ($genres as &$list) {
        sort($list, SORT_NATURAL | SORT_FLAG_CASE);
    }
    return ['usage' => $usage, 'genres' => $genres];
}

/**
 * Prüft die Patterns grob (Felder und Typen); die Schreibweise prüft der Editor (patternError() in js/sheet.js).
 *
 * @param mixed $patterns Patterns aus dem Request
 * @return array<int, array> bereinigte Patterns
 */
function validate_patterns(mixed $patterns): array
{
    if (!is_array($patterns) || !array_is_list($patterns) || count($patterns) > PATTERNS_MAX) {
        json_error(400, 'patterns muss eine Liste mit höchstens ' . PATTERNS_MAX . ' Patterns sein');
    }
    $result = [];
    $ids = [];
    foreach ($patterns as $i => $p) {
        $n = $i + 1;
        $id = is_array($p) ? ($p['id'] ?? null) : null;
        if (!is_string($id) || !preg_match('/^[a-z0-9-]{1,64}$/', $id) || isset($ids[$id])) {
            json_error(400, "Pattern $n: id fehlt, ist ungültig oder doppelt");
        }
        $ids[$id] = true;
        $technique = $p['technique'] ?? null;
        if (!in_array($technique, ['strumming', 'picking'], true)) {
            json_error(400, "Pattern $n: technique muss strumming oder picking sein");
        }
        $name = trim((string)($p['name'] ?? ''));
        $ts = (string)($p['timeSignature'] ?? '');
        $grid = $p['grid'] ?? null;
        if ($name === '' || mb_strlen($name) > 80 || !preg_match('#^\d{1,2}/\d{1,2}$#', $ts) || !in_array($grid, [8, 16], true)) {
            json_error(400, "Pattern $n: name, timeSignature oder grid ungültig");
        }
        $clean = ['id' => $id, 'name' => $name, 'technique' => $technique, 'timeSignature' => $ts, 'grid' => $grid];
        // Betonung steckt in der Groß-/Kleinschreibung, Finger im Schritt; eigene Felder dafür gibt es nicht.
        foreach ($technique === 'strumming' ? ['strokes'] : ['steps'] as $field) {
            $value = $p[$field] ?? '';
            if (!is_string($value) || strlen($value) > 400) {
                json_error(400, "Pattern $n: $field ungültig");
            }
            if ($value !== '') {
                $clean[$field] = $value;
            }
        }
        $result[] = $clean;
    }
    return $result;
}

$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {
    case 'GET':
        $stats = pattern_stats();
        json_response(200, ['patterns' => read_patterns(), 'usage' => (object)$stats['usage'], 'genres' => (object)$stats['genres']]);

    case 'PUT':
        require_token();
        $patterns = validate_patterns(read_json_body()['patterns'] ?? null);
        write_patterns($patterns);
        $stats = pattern_stats();
        json_response(200, ['patterns' => $patterns, 'usage' => (object)$stats['usage'], 'genres' => (object)$stats['genres']]);

    default:
        json_error(405, "Methode '$method' nicht erlaubt");
}
