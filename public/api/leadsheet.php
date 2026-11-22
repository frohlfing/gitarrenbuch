<?php

/**
 * Angaben für das Leadsheet, die alphaTex nicht kennt (siehe public/js/sheet.js). Sie stehen im Feld leadsheet von
 * song.json (siehe read_leadsheet()):
 *
 *   "leadsheet": {
 *     "patterns": [{"id": "folk", "when": "Strophe und Refrain"}],
 *     "tabs": [{"from": 0, "to": 3, "track": "picking", "label": "Intro"}],
 *     "cuts": [{"from": 40, "to": 47, "text": "wiederholen und leiser werden"}],
 *     "chords": {"G": false, "G*": true},
 *     "links": [{"label": "Original", "url": "https://…", "qr": true}],
 *     "instructions": "Markdown",
 *     "layout": {"twoPages": true, "columns": false, "font": 12, "compactTabs": false, "smallChords": false,
 *                "tabCounts": false, "mergeSections": true},
 *     "wip": ["picking"]
 *   }
 *
 * patterns: die Patterns des Songs (Verweis auf den Katalog data/patterns.json) mit Freitext, wann sie gespielt
 * werden. tabs: Takte, die als Tab auf das Blatt kommen; from/to sind Indizes der Takte (0 = erster Takt), track der
 * Name der Spur. Fügt der Editor Takte ein oder löscht welche, zieht er die Indizes nach. cuts: Takte, die in
 * "Text & Akkorde" nicht ausgeschrieben werden, an ihrer Stelle steht text (leer: nichts); nur gespeichert, wenn es
 * welche gibt. chords: Griffbilder, die
 * von der Regel abweichen (true zeigen, false ausblenden). links: auf dem Blatt als QR-Code oder Text; Links ohne
 * Adresse fallen beim Speichern weg. instructions: Hinweise zur Spielweise für Seite 1 (Markdown, höchstens 5000
 * Zeichen); nicht zu verwechseln mit notes in song.json (Notizen der Stammdaten), beide bleiben getrennt. Beim Import
 * einer GP-Datei wird es mit deren Anweisungen vorbelegt (api/import.php). layout: wie das Blatt gesetzt wird
 * (Kontrollkästchen im Reiter "Leadsheet": zwei Seiten, Text zweispaltig, Schrift in pt, Tabs zusammenfassen,
 * Griffbilder klein, Zählzeiten unter den Tabs, gleiche Abschnitte nur einmal); gespeichert nur, wenn es von LEADSHEET_LAYOUT abweicht.
 * wip: Baustellen, die Namen der Spuren, an denen noch gearbeitet wird (Schalter im Dialog "Spuren" des Editors; wie
 * bei tabs zieht der Editor den Namen beim Umbenennen nach); nur gespeichert, wenn es welche gibt.
 *
 * Ein eigener Endpunkt statt PUT api/songs.php: Der Editor speichert die Angaben zusammen mit den Noten, das Formular
 * "Stammdaten" getrennt davon; so überschreibt keiner die Änderungen des anderen.
 *
 * GET /api/leadsheet.php?slug=xyz   -> Inhalt, fehlende Felder leer. Kein Token nötig.
 * GET /api/leadsheet.php?slug=xyz&version=<id>
 *                                   -> dasselbe aus einem aufgehobenen Stand (id aus api/score.php?history=1).
 * PUT /api/leadsheet.php?slug=xyz   -> ersetzt das Feld leadsheet in song.json (ohne Einträge fällt es weg). Body wie
 *                                      oben (ohne "leadsheet"). Vorher kommt der bisherige Stand in den Verlauf
 *                                      (siehe keep_score_history(); mit &note=… samt Notiz, was sich ändert), außer
 *                                      mit &keep=0 (der Editor setzt es, wenn er im selben Speichern schon die Noten
 *                                      gesichert hat). Antwort: das
 *                                      aktualisierte Lied. Token nötig.
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/crud.php';
require_once __DIR__ . '/lib/file_store.php';

/**
 * Höchstzahl der Patterns und der Tab-Stellen je Song.
 *
 * @var int
 */
const LEADSHEET_MAX_ITEMS = 50;

/**
 * Höchster Index eines Takts (ein Song hat selten mehr als 300 Takte).
 *
 * @var int
 */
const LEADSHEET_MAX_BAR = 4999;

/**
 * Kürzt einen Freitext und prüft seine Länge.
 *
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
    $text = trim((string) $value);
    if (mb_strlen($text) > $max) {
        json_error(400, "$what ist zu lang (höchstens $max Zeichen)");
    }
    return $text;
}

/**
 * Prüft den Inhalt und bringt ihn in die gespeicherte Form (Tab-Stellen nach Takt sortiert).
 *
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
        $cleanTabs[] = [
            'from' => $from,
            'to' => $to,
            'track' => leadsheet_text($tab['track'] ?? '', 'Tab ' . ($k + 1) . ': track'),
            'label' => leadsheet_text($tab['label'] ?? '', 'Tab ' . ($k + 1) . ': label'),
        ];
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
        $cleanCuts[] = [
            'from' => $from,
            'to' => $to,
            'text' => leadsheet_text($cut['text'] ?? '', 'Ersetzte Takte ' . ($k + 1) . ': text'),
        ];
    }
    usort($cleanCuts, fn($a, $b) => [$a['from'], $a['to']] <=> [$b['from'], $b['to']]);

    $chords = $data['chords'] ?? [];
    if (!is_array($chords) || count($chords) > 200) {
        json_error(400, 'chords muss ein Objekt mit höchstens 200 Einträgen sein');
    }
    $cleanChords = [];
    foreach ($chords as $name => $shown) {
        if (!is_bool($shown) || mb_strlen((string) $name) > 40) {
            json_error(400, "Griffbild '$name' ungültig");
        }
        $cleanChords[(string) $name] = $shown;
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
        $cleanLinks[] = [
            'label' => leadsheet_text($link['label'] ?? '', 'Link ' . ($k + 1) . ': label', 80),
            'url' => $url,
            'qr' => ($link['qr'] ?? true) !== false,
        ];
    }

    $wip = $data['wip'] ?? [];
    if (!is_array($wip) || !array_is_list($wip) || count($wip) > LEADSHEET_MAX_ITEMS) {
        json_error(400, 'wip muss eine Liste mit höchstens ' . LEADSHEET_MAX_ITEMS . ' Spurnamen sein');
    }
    $cleanWip = [];
    foreach ($wip as $k => $name) {
        $name = leadsheet_text($name, 'Baustelle ' . ($k + 1));
        if ($name !== '' && !in_array($name, $cleanWip, true)) {
            $cleanWip[] = $name;
        }
    }

    return [
        'patterns' => $cleanPatterns,
        'tabs' => $cleanTabs,
        'cuts' => $cleanCuts,
        'chords' => $cleanChords,
        'links' => $cleanLinks,
        'instructions' => leadsheet_text($data['instructions'] ?? '', 'instructions', LEADSHEET_TEXT_MAX),
        'layout' => leadsheet_layout($data['layout'] ?? null),
        'wip' => $cleanWip,
    ];
}

/**
 * Layout ohne Angabe (wie DEFAULT_LAYOUT in js/sheet.js): eine Seite, einspaltig, 12 pt, gleiche Abschnitte nur
 * einmal.
 *
 * @var array<string, bool|int>
 */
const LEADSHEET_LAYOUT = ['twoPages' => false, 'columns' => false, 'font' => 12, 'compactTabs' => false,
    'smallChords' => false, 'tabCounts' => false, 'mergeSections' => true];

/**
 * Schriftgrößen des Blatts in pt (wie FONT_SIZES in js/sheet.js).
 *
 * @var int[]
 */
const LEADSHEET_FONTS = [12, 11, 10, 9];

/**
 * Prüft das Layout aus einem Request; fehlende Angaben bekommen die Vorgabe.
 *
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
$slug = (string) ($_GET['slug'] ?? '');

try {
    $song = read_song_json($slug);
    if ($song === null) {
        json_error(404, "Song '$slug' nicht gefunden");
    }
    switch ($method) {
        case 'GET':
            $data = isset($_GET['version'])
                ? score_history_leadsheet($slug, (string) $_GET['version']) : read_leadsheet($slug, $song);
            $result = [
                'patterns' => is_array($data['patterns'] ?? null) ? array_values($data['patterns']) : [],
                'tabs' => is_array($data['tabs'] ?? null) ? array_values($data['tabs']) : [],
                'cuts' => is_array($data['cuts'] ?? null) ? array_values($data['cuts']) : [],
                'chords' => (object) (is_array($data['chords'] ?? null) ? $data['chords'] : []),
                'links' => is_array($data['links'] ?? null) ? array_values($data['links']) : [],
                'instructions' => is_string($data['instructions'] ?? null) ? $data['instructions'] : '',
                'layout' => array_merge(LEADSHEET_LAYOUT,
                    array_intersect_key(is_array($data['layout'] ?? null) ? $data['layout'] : [], LEADSHEET_LAYOUT)),
                'wip' => is_array($data['wip'] ?? null) ? array_values($data['wip']) : [],
            ];
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
            // Ebenso die Baustellen.
            if (!$data['wip']) {
                unset($data['wip']);
            }
            if (!$data['patterns'] && !$data['tabs'] && !isset($data['cuts']) && !$data['chords'] && !$data['links'] && $data['instructions'] === ''
                && !isset($data['layout']) && !isset($data['wip'])) {
                unset($song['leadsheet']);
            } else {
                $song['leadsheet'] = $data;
            }
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
