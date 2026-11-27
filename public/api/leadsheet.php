<?php

/**
 * Angaben für das Leadsheet (score.json neben score.atex; Aufbau siehe Typ Sheet in public/js/lib/sheetmodel.js).
 * Ein eigener Endpunkt statt PUT api/songs.php: Der Editor speichert sie mit den Noten, das Formular "Stammdaten"
 * getrennt davon; so überschreibt keiner die Änderungen des anderen.
 *
 * GET /api/leadsheet.php?slug=xyz              -> Inhalt, fehlende Felder leer. Kein Token nötig.
 * GET /api/leadsheet.php?slug=xyz&version=<id> -> dasselbe aus einem Stand im Verlauf (id aus score.php?history=1).
 * PUT /api/leadsheet.php?slug=xyz              -> ersetzt score.json; der bisherige Stand kommt in den Verlauf (mit
 *                                                 &note=… samt Notiz), außer mit &keep=0. Antwort: der Song.
 *                                                 Token nötig.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/crud.php';
require_once __DIR__ . '/lib/file_store.php';

/**
 * Höchstzahl der Patterns und der Tab-Stellen je Song.
 * @var int
 */
const LEADSHEET_MAX_ITEMS = 50;

/**
 * Höchster Index eines Takts (ein Song hat selten mehr als 300 Takte).
 * @var int
 */
const LEADSHEET_MAX_BAR = 4999;

/**
 * Höchstzahl der Takte pro Zeile (wie BARS_PER_ROW_MAX in js/pages/editor.js).
 * @var int
 */
const LEADSHEET_BARS_PER_ROW_MAX = 12;

/**
 * Kürzt einen Freitext und prüft seine Länge.
 * @param mixed $value Wert aus dem Body
 * @param string $what Bezeichnung für die Fehlermeldung
 * @param int $max höchste Länge in Zeichen
 * @return string
 */
function leadsheet_text(mixed $value, string $what, int $max = 200): string
{
    if ($value !== null && !is_string($value)) {
        json_error(400, "$what muss Text sein");
    }
    $text = trim((string)$value);
    if (mb_strlen($text) > $max) {
        json_error(400, "$what ist zu lang (höchstens $max Zeichen)");
    }
    return $text;
}

/**
 * Prüft den Inhalt und bringt ihn in die gespeicherte Form (Tab-Stellen nach Takt sortiert).
 * @param array $data dekodierter Body
 * @return array{patterns: array<int, array>, tabs: array<int, array>, chords: array<string, bool>,
 *               links: array<int, array>, instructions: string}
 */
function validate_leadsheet(array $data): array
{
    $patterns = $data['patterns'] ?? [];
    $tabs = $data['tabs'] ?? [];
    if (!is_array($patterns) || !array_is_list($patterns) || count($patterns) > LEADSHEET_MAX_ITEMS) {
        json_error(400, 'patterns muss eine Liste mit höchstens ' . LEADSHEET_MAX_ITEMS . ' Einträgen sein');
    }
    if (!is_array($tabs) || !array_is_list($tabs) || count($tabs) > LEADSHEET_MAX_ITEMS) {
        json_error(400, 'tabs muss eine Liste mit höchstens ' . LEADSHEET_MAX_ITEMS . ' Einträgen sein');
    }
    $cleanPatterns = [];
    foreach ($patterns as $k => $pattern) {
        $id = is_array($pattern) ? ($pattern['id'] ?? null) : null;
        if (!is_string($id) || !preg_match('/^[a-z0-9-]{1,64}$/', $id)) {
            json_error(400, 'Pattern ' . ($k + 1) . ': id ungültig');
        }
        $cleanPatterns[] = ['id' => $id, 'when' => leadsheet_text($pattern['when'] ?? '', 'Pattern ' . ($k + 1) . ': when')];
    }
    $cleanTabs = [];
    foreach ($tabs as $k => $tab) {
        $from = is_array($tab) ? ($tab['from'] ?? null) : null;
        $to = is_array($tab) ? ($tab['to'] ?? null) : null;
        if (!is_int($from) || !is_int($to) || $from < 0 || $to < $from || $to > LEADSHEET_MAX_BAR) {
            json_error(400, 'Tab ' . ($k + 1) . ': from/to ungültig');
        }
        $cleanTabs[] = ['from' => $from, 'to' => $to, 'track' => leadsheet_text($tab['track'] ?? '', 'Tab ' . ($k + 1) . ': track'), 'label' => leadsheet_text($tab['label'] ?? '', 'Tab ' . ($k + 1) . ': label'),];
    }
    usort($cleanTabs, fn($a, $b) => [$a['from'], $a['to']] <=> [$b['from'], $b['to']]);

    // Takte, die in "Text & Akkorde" durch einen Hinweis ersetzt sind; text darf leer sein.
    $cuts = $data['cuts'] ?? [];
    if (!is_array($cuts) || !array_is_list($cuts) || count($cuts) > LEADSHEET_MAX_ITEMS) {
        json_error(400, 'cuts muss eine Liste mit höchstens ' . LEADSHEET_MAX_ITEMS . ' Einträgen sein');
    }
    $cleanCuts = [];
    foreach ($cuts as $k => $cut) {
        $from = is_array($cut) ? ($cut['from'] ?? null) : null;
        $to = is_array($cut) ? ($cut['to'] ?? null) : null;
        if (!is_int($from) || !is_int($to) || $from < 0 || $to < $from || $to > LEADSHEET_MAX_BAR) {
            json_error(400, 'Ersetzte Takte ' . ($k + 1) . ': from/to ungültig');
        }
        $cleanCuts[] = ['from' => $from, 'to' => $to, 'text' => leadsheet_text($cut['text'] ?? '', 'Ersetzte Takte ' . ($k + 1) . ': text'),];
    }
    usort($cleanCuts, fn($a, $b) => [$a['from'], $a['to']] <=> [$b['from'], $b['to']]);

    $chords = $data['chords'] ?? [];
    if (!is_array($chords) || count($chords) > 200) {
        json_error(400, 'chords muss ein Objekt mit höchstens 200 Einträgen sein');
    }
    $cleanChords = [];
    foreach ($chords as $name => $shown) {
        if (!is_bool($shown) || mb_strlen((string)$name) > 40) {
            json_error(400, "Griffbild '$name' ungültig");
        }
        $cleanChords[(string)$name] = $shown;
    }

    $links = $data['links'] ?? [];
    if (!is_array($links) || !array_is_list($links) || count($links) > 10) {
        json_error(400, 'links muss eine Liste mit höchstens 10 Einträgen sein');
    }
    $cleanLinks = [];
    foreach ($links as $k => $link) {
        $url = leadsheet_text(is_array($link) ? ($link['url'] ?? '') : null, 'Link ' . ($k + 1) . ': url', 500);
        if ($url === '') {
            continue;
        }
        if (!preg_match('~^https?://\S+$~i', $url)) {
            /** @noinspection HttpUrlsUsage */
            json_error(400, 'Link ' . ($k + 1) . ': Adresse muss mit http:// oder https:// beginnen');
        }
        $cleanLinks[] = ['label' => leadsheet_text($link['label'] ?? '', 'Link ' . ($k + 1) . ': label', 80), 'url' => $url, 'qr' => ($link['qr'] ?? true) !== false,];
    }

    $barsPerRow = $data['barsPerRow'] ?? 0;
    if (!is_int($barsPerRow) || $barsPerRow < 0 || $barsPerRow > LEADSHEET_BARS_PER_ROW_MAX) {
        json_error(400, 'barsPerRow muss eine ganze Zahl von 0 bis ' . LEADSHEET_BARS_PER_ROW_MAX . ' sein');
    }

    return ['patterns' => $cleanPatterns, 'tabs' => $cleanTabs, 'cuts' => $cleanCuts, 'chords' => $cleanChords, 'links' => $cleanLinks, 'instructions' => leadsheet_text($data['instructions'] ?? '', 'instructions', LEADSHEET_TEXT_MAX), 'layout' => leadsheet_layout($data['layout'] ?? null), 'barsPerRow' => $barsPerRow,];
}

/**
 * Layout ohne Angabe (wie DEFAULT_LAYOUT in js/lib/sheetmodel.js): eine Seite, einspaltig, 12 pt, gleiche Abschnitte
 * nur einmal.
 * @var array<string, bool|int>
 */
const LEADSHEET_LAYOUT = ['twoPages' => false, 'columns' => false, 'font' => 12, 'compactTabs' => false, 'smallChords' => false, 'tabCounts' => false, 'mergeSections' => true];

/**
 * Schriftgrößen des Blatts in pt (wie FONT_SIZES in js/lib/sheetmodel.js).
 * @var int[]
 */
const LEADSHEET_FONTS = [12, 11, 10, 9];

/**
 * Prüft das Layout aus einem Request; fehlende Angaben bekommen die Vorgabe.
 * @param mixed $layout Wert von "layout" im Body
 * @return array<string, bool|int> vollständiges Layout
 */
function leadsheet_layout(mixed $layout): array
{
    if ($layout === null) {
        return LEADSHEET_LAYOUT;
    }
    if (!is_array($layout)) {
        json_error(400, 'layout muss ein Objekt sein');
    }
    $result = LEADSHEET_LAYOUT;
    foreach (LEADSHEET_LAYOUT as $key => $preset) {
        if (!array_key_exists($key, $layout)) {
            continue;
        }
        $value = $layout[$key];
        if ($key === 'font' ? !in_array($value, LEADSHEET_FONTS, true) : !is_bool($value)) {
            json_error(400, "layout.$key ist ungültig");
        }
        $result[$key] = $value;
    }
    return $result;
}

$method = $_SERVER['REQUEST_METHOD'];
$slug = (string)($_GET['slug'] ?? '');

try {
    $song = read_song_json($slug);
    if ($song === null) {
        json_error(404, "Song '$slug' nicht gefunden");
    }
    switch ($method) {
        case 'GET':
            $data = isset($_GET['version']) ? score_history_leadsheet($slug, (string)$_GET['version']) : read_leadsheet($slug);
            $result = ['patterns' => is_array($data['patterns'] ?? null) ? array_values($data['patterns']) : [], 'tabs' => is_array($data['tabs'] ?? null) ? array_values($data['tabs']) : [], 'cuts' => is_array($data['cuts'] ?? null) ? array_values($data['cuts']) : [], 'chords' => (object)(is_array($data['chords'] ?? null) ? $data['chords'] : []), 'links' => is_array($data['links'] ?? null) ? array_values($data['links']) : [], 'instructions' => is_string($data['instructions'] ?? null) ? $data['instructions'] : '', 'layout' => array_merge(LEADSHEET_LAYOUT, array_intersect_key(is_array($data['layout'] ?? null) ? $data['layout'] : [], LEADSHEET_LAYOUT)), 'barsPerRow' => is_int($data['barsPerRow'] ?? null) ? $data['barsPerRow'] : 0,];
            json_response(200, $result);

        case 'PUT':
            require_token();
            $data = validate_leadsheet(read_json_body());
            if (($_GET['keep'] ?? '1') !== '0' && is_file(song_dir($slug) . '/' . SONG_FILES['score'])) {
                keep_score_history($slug, history_note());
            }
            // Das Layout steht nur da, wenn es von der Vorgabe abweicht (sonst hätte es jeder Song).
            if ($data['layout'] === LEADSHEET_LAYOUT) {
                unset($data['layout']);
            }
            // Auch die ersetzten Takte stehen nur da, wenn es welche gibt.
            if (!$data['cuts']) {
                unset($data['cuts']);
            }
            // Ebenso die Takte pro Zeile.
            if (!$data['barsPerRow']) {
                unset($data['barsPerRow']);
            }
            // Leere Listen und Texte gelten als keine Angaben.
            $empty = !array_filter($data, static fn($value) => $value !== [] && $value !== '');
            write_leadsheet($slug, $empty ? [] : $data);
            $song['updated'] = date('c');
            write_song_json($slug, $song);
            json_response(200, with_file_flags($slug, $song));

        default:
            json_error(405, "Methode '$method' nicht erlaubt");
    }
} catch (NotFoundException $e) {
    json_error(404, $e->getMessage());
} catch (RuntimeException $e) {
    json_error(500, $e->getMessage());
}
