<?php

/**
 * Akkord-Katalog, der sich aus den Songs von allein aufbaut.
 *
 * Quelle sind die Akkorde in den Noten (score.atex): `\chord ("G" 3 0 0 0 2 3)` legt den Griff fest (Saiten von
 * der hohen e-Saite aus), `ch "G"` an einem Schlag verwendet ihn. Gezählt werden die Schläge; je Akkord steht der Griff
 * mit den meisten Schlägen vorn. Nur Spuren im Standard-Tuning (auch einheitlich tiefer oder höher gestimmt) zählen,
 * Griffe mit weniger als drei gespielten Saiten (Platzhalter "x x x x x x") nicht.
 *
 * Der Katalog zeigt nur, was in den Songs vorkommt, nach Häufigkeit. Griffe für Akkorde, die noch kein Song nutzt,
 * berechnet der Browser aus dem Namen (findGrips() in js/lib/chordgrips.js).
 *
 * Der Katalog wird bei jedem Aufruf neu gezählt (bei rund 40 Songs etwa 20 ms); einen Zwischenspeicher gibt es nicht.
 */

require_once __DIR__ . '/crud.php';

/** Abstände der Saiten von der tiefen E-Saite aus in Halbtönen (Standard-Tuning). */
const CHORD_STANDARD_INTERVALS = [0, 5, 10, 15, 19, 24];

/** Mindestzahl gespielter Saiten, damit ein Griff zählt (wie MIN_PLAYED_STRINGS in js/lib/chords.js). */
const CHORD_MIN_PLAYED_STRINGS = 3;

/**
 * Tonhöhe (Halbtöne) eines alphaTex-Tons wie "E4" oder "F#3".
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
 * Baut den Akkord-Katalog aus allen Songs: je Akkord die Griffe mit der Zahl ihrer Schläge, der häufigste zuerst; bei
 * Gleichstand der, der weniger weit oben liegt (leichter), dann nach Text.
 * @return array<string, array<int, array{0: string, 1: int}>> Akkordname (klein) → [Griff, Schläge], nach Name sortiert
 */
function chord_catalog(): array
{
    /** @var array<string, array<string, int>> $counts */
    $counts = [];
    foreach (list_song_slugs() as $slug) {
        $file = song_dir($slug) . '/score.atex';
        if (is_file($file)) {
            chord_count_grips((string)file_get_contents($file), $counts);
        }
    }
    $maxFret = static fn(string $g): int => max(array_map('intval', str_contains($g, '-') ? explode('-', $g) : str_split($g)));
    $catalog = [];
    foreach ($counts as $key => $grips) {
        // Rein numerische Griffe ("320003") sind als Array-Schlüssel Zahlen geworden: zurück in Text.
        $pairs = array_map(static fn($grip, int $beats): array => [(string)$grip, $beats], array_keys($grips), $grips);
        usort($pairs, static fn(array $a, array $b): int => [$b[1], $maxFret($a[0]), $a[0]] <=> [$a[1], $maxFret($b[0]), $b[0]]);
        $catalog[$key] = $pairs;
    }
    ksort($catalog);
    return $catalog;
}
