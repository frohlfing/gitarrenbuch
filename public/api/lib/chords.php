<?php

/**
 * Akkordkatalog, der sich aus den Liedern von allein aufbaut.
 *
 * Quelle sind die Akkorde in den Noten (score.atex): `\chord ("G" 3 0 0 0 2 3)` legt den Griff fest (Saiten von
 * der hohen e-Saite aus), `ch "G"` an einem Schlag verwendet ihn. Gezählt werden die Schläge; je Akkord steht der Griff
 * mit den meisten Schlägen vorn. Nur Spuren im Standard-Tuning (auch einheitlich tiefer oder höher gestimmt) zählen,
 * Griffe mit weniger als drei gespielten Saiten (Platzhalter "x x x x x x") nicht.
 *
 * Der Katalog zeigt nur, was in den Liedern vorkommt, nach Häufigkeit. Griffe für Akkorde, die noch kein Lied nutzt, berechnet
 * der Browser aus dem Namen (findGrips() in js/chordgrips.js).
 *
 * data/chords.json ist der Zwischenspeicher: Er wird neu gebaut, wenn er fehlt oder wenn eine Partitur, der
 * Liederordner oder diese Datei neuer ist.
 */

require_once __DIR__ . '/crud.php';

/** Abstände der Saiten von der tiefen E-Saite aus in Halbtönen (Standard-Tuning). */
const CHORD_STANDARD_INTERVALS = [0, 5, 10, 15, 19, 24];

/** Mindestzahl gespielter Saiten, damit ein Griff zählt (wie MIN_PLAYED_STRINGS in js/base.js). */
const CHORD_MIN_PLAYED_STRINGS = 3;

/**
 * Pfad des Zwischenspeichers.
 *
 * @var string
 */
const CHORDS_FILE = DATA_DIR . '/chords.json';

/**
 * Tonhöhe (Halbtöne) eines alphaTex-Tons wie "E4" oder "F#3".
 *
 * @param string $note Ton
 * @return int|null Halbtöne, null bei unlesbarem Ton
 */
function chord_note_value(string $note): ?int
{
    if (!preg_match('/^([A-Ga-g])([#b]?)(-?\d+)$/', $note, $m)) {
        return null;
    }
    $base = ['c' => 0, 'd' => 2, 'e' => 4, 'f' => 5, 'g' => 7, 'a' => 9, 'b' => 11][strtolower($m[1])];
    $shift = $m[2] === '#' ? 1 : ($m[2] === 'b' ? -1 : 0);
    return $base + $shift + 12 * (int)$m[3];
}

/**
 * Ist das Tuning einer Spur das Standard-Tuning (Abstände wie E A D G B E), gleich auf welcher Höhe?
 *
 * @param string $tuning Töne von der hohen Saite aus, z. B. "E4 B3 G3 D3 A2 E2"
 * @return bool
 */
function chord_is_standard_tuning(string $tuning): bool
{
    $values = array_map('chord_note_value', preg_split('/\s+/', trim($tuning)) ?: []);
    if (count($values) !== count(CHORD_STANDARD_INTERVALS) || in_array(null, $values, true)) {
        return false;
    }
    $values = array_reverse($values);
    return array_all(
        $values,
        static fn(?int $value, int $i): bool => $value - $values[0] === CHORD_STANDARD_INTERVALS[$i]
    );
}

/**
 * Schreibt einen Griff als Text.
 *
 * @param int[] $frets Bünde von der tiefen E-Saite aus, -1 = nicht gespielt
 * @return string z. B. "x32010", ab Bund 10 mit "-" getrennt
 */
function chord_format_grip(array $frets): string
{
    $parts = array_map(static fn(int $f): string => $f < 0 ? 'x' : (string)$f, $frets);
    return implode(max($frets) > 9 ? '-' : '', $parts);
}

/**
 * Zählt die Griffe der Akkorde in einer Partitur.
 *
 * @param string $tex Inhalt von score.atex
 * @param array<string, array<string, int>> $counts Akkordname (klein) → Griff → Zahl der Schläge, wird ergänzt
 * @return void
 */
function chord_count_grips(string $tex, array &$counts): void
{
    foreach (preg_split('/^\\\\track\b/m', $tex) ?: [] as $track) {
        if (!preg_match('/\\\\tuning\s*\(([^)]*)\)/', $track, $t) || !chord_is_standard_tuning($t[1])) {
            continue;
        }
        // Je Name zählt die letzte Festlegung, wie beim Laden in alphaTab.
        $grips = [];
        preg_match_all('/\\\\chord\s*\(\s*"([^"]+)"([^)]*)\)/', $track, $defs, PREG_SET_ORDER);
        foreach ($defs as $def) {
            $frets = [];
            foreach (preg_split('/\s+/', trim($def[2])) ?: [] as $token) {
                if ($token === '') {
                    continue;
                }
                $frets[] = strtolower($token) === 'x' ? -1 : (int)$token;
            }
            if (count($frets) !== 6 || count(array_filter($frets, static fn(int $f): bool => $f >= 0)) < CHORD_MIN_PLAYED_STRINGS) {
                continue;
            }
            $grips[strtolower($def[1])] = chord_format_grip(array_reverse($frets));
        }
        preg_match_all('/\bch\s+"([^"]+)"/', $track, $uses);
        foreach ($uses[1] as $name) {
            $key = strtolower($name);
            if (isset($grips[$key])) {
                $counts[$key][$grips[$key]] = ($counts[$key][$grips[$key]] ?? 0) + 1;
            }
        }
    }
}

/**
 * Baut den Akkordkatalog aus allen Liedern.
 *
 * @return array<string, string[]> Akkordname (klein) → Griffe, der häufigste zuerst; nach Grundton und Name sortiert
 */
function build_chord_library(): array
{
    /** @var array<string, array<string, int>> $counts */
    $counts = [];
    foreach (list_song_slugs() as $slug) {
        $file = song_dir($slug) . '/score.atex';
        if (is_file($file)) {
            chord_count_grips((string)file_get_contents($file), $counts);
        }
    }
    $library = [];
    foreach ($counts as $key => $grips) {
        // Gleich oft: der Griff, der weniger weit oben liegt (leichter), dann nach Text.
        uksort($grips, static function (string $a, string $b) use ($grips): int {
            $maxFret = static fn(string $g): int => max(array_map('intval', str_contains($g, '-') ? explode('-', $g) : str_split($g)));
            return [$grips[$b], $maxFret($a), $a] <=> [$grips[$a], $maxFret($b), $b];
        });
        // Rein numerische Griffe ("320003") sind als Array-Schlüssel Zahlen geworden: zurück in Text.
        $library[$key] = array_map('strval', array_keys($grips));
    }
    ksort($library);
    return $library;
}

/**
 * Wie oft die Griffe in den Liedern vorkommen (Schläge, je Spur gezählt).
 *
 * @return array<string, array<string, int>> Akkordname (klein) → Griff → Zahl der Schläge
 */
function chord_usage(): array
{
    /** @var array<string, array<string, int>> $counts */
    $counts = [];
    foreach (list_song_slugs() as $slug) {
        $file = song_dir($slug) . '/score.atex';
        if (is_file($file)) {
            chord_count_grips((string)file_get_contents($file), $counts);
        }
    }
    return $counts;
}

/**
 * Ist der Zwischenspeicher veraltet?
 *
 * @return bool true, wenn er fehlt oder eine Partitur bzw. der Liederordner neuer ist
 */
function chord_library_is_stale(): bool
{
    $cached = @filemtime(CHORDS_FILE);
    if ($cached === false || filemtime(__FILE__) > $cached) {
        return true;
    }
    // Der Liederordner ändert sich, wenn ein Lied hinzukommt oder wegfällt.
    if ((@filemtime(SONGS_DIR) ?: 0) > $cached) {
        return true;
    }
    return array_any(
        list_song_slugs(),
        static fn(string $slug): bool => (@filemtime(song_dir($slug) . '/score.atex') ?: 0) > $cached
    );
}

/**
 * Liefert den Akkordkatalog als JSON-Text und baut ihn bei Bedarf neu.
 *
 * @return string JSON-Objekt, z. B. {"c": ["x32010", "xxx553"], ...}
 */
function chord_library_json(): string
{
    if (!chord_library_is_stale()) {
        $json = @file_get_contents(CHORDS_FILE);
        if ($json !== false) {
            return $json;
        }
    }
    $json = json_encode((object)build_chord_library(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    // Zwischenspeichern; klappt das Schreiben nicht, wird trotzdem geliefert (und beim nächsten Mal neu gebaut).
    if (is_dir(DATA_DIR) || @mkdir(DATA_DIR, 0775, true)) {
        $tmp = CHORDS_FILE . '.' . getmypid() . '.tmp';
        if (@file_put_contents($tmp, $json) !== false) {
            @rename($tmp, CHORDS_FILE) || @unlink($tmp);
        }
    }
    return $json;
}
