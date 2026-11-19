<?php

/**
 * MIDI-Programme (General MIDI, 0 bis 127) nach den Namen, mit denen alphaTex Instrumente schreibt
 * (`instrument acousticguitarsteel`). Die Namen sind die von alphaTab (GeneralMidi in alphaTab.core.mjs).
 *
 * @var array<string, int>
 */
const INSTRUMENT_PROGRAMS = [
    'acousticgrandpiano' => 0, 'brightacousticpiano' => 1, 'electricgrandpiano' => 2, 'honkytonkpiano' => 3,
    'electricpiano1' => 4, 'electricpiano2' => 5, 'harpsichord' => 6, 'clavinet' => 7,
    'celesta' => 8, 'glockenspiel' => 9, 'musicbox' => 10, 'vibraphone' => 11,
    'marimba' => 12, 'xylophone' => 13, 'tubularbells' => 14, 'dulcimer' => 15,
    'drawbarorgan' => 16, 'percussiveorgan' => 17, 'rockorgan' => 18, 'churchorgan' => 19,
    'reedorgan' => 20, 'accordion' => 21, 'harmonica' => 22, 'tangoaccordion' => 23,
    'acousticguitarnylon' => 24, 'acousticguitarsteel' => 25, 'electricguitarjazz' => 26, 'electricguitarclean' => 27,
    'electricguitarmuted' => 28, 'overdrivenguitar' => 29, 'distortionguitar' => 30, 'guitarharmonics' => 31,
    'acousticbass' => 32, 'electricbassfinger' => 33, 'electricbasspick' => 34, 'fretlessbass' => 35,
    'slapbass1' => 36, 'slapbass2' => 37, 'synthbass1' => 38, 'synthbass2' => 39,
    'violin' => 40, 'viola' => 41, 'cello' => 42, 'contrabass' => 43,
    'tremolostrings' => 44, 'pizzicatostrings' => 45, 'orchestralharp' => 46, 'timpani' => 47,
    'stringensemble1' => 48, 'stringensemble2' => 49, 'synthstrings1' => 50, 'synthstrings2' => 51,
    'choiraahs' => 52, 'voiceoohs' => 53, 'synthvoice' => 54, 'orchestrahit' => 55,
    'trumpet' => 56, 'trombone' => 57, 'tuba' => 58, 'mutedtrumpet' => 59,
    'frenchhorn' => 60, 'brasssection' => 61, 'synthbrass1' => 62, 'synthbrass2' => 63,
    'sopranosax' => 64, 'altosax' => 65, 'tenorsax' => 66, 'baritonesax' => 67,
    'oboe' => 68, 'englishhorn' => 69, 'bassoon' => 70, 'clarinet' => 71,
    'piccolo' => 72, 'flute' => 73, 'recorder' => 74, 'panflute' => 75,
    'blownbottle' => 76, 'shakuhachi' => 77, 'whistle' => 78, 'ocarina' => 79,
    'lead1square' => 80, 'lead2sawtooth' => 81, 'lead3calliope' => 82, 'lead4chiff' => 83,
    'lead5charang' => 84, 'lead6voice' => 85, 'lead7fifths' => 86, 'lead8bassandlead' => 87,
    'pad1newage' => 88, 'pad2warm' => 89, 'pad3polysynth' => 90, 'pad4choir' => 91,
    'pad5bowed' => 92, 'pad6metallic' => 93, 'pad7halo' => 94, 'pad8sweep' => 95,
    'fx1rain' => 96, 'fx2soundtrack' => 97, 'fx3crystal' => 98, 'fx4atmosphere' => 99,
    'fx5brightness' => 100, 'fx6goblins' => 101, 'fx7echoes' => 102, 'fx8scifi' => 103,
    'sitar' => 104, 'banjo' => 105, 'shamisen' => 106, 'koto' => 107,
    'kalimba' => 108, 'bagpipe' => 109, 'fiddle' => 110, 'shanai' => 111,
    'tinklebell' => 112, 'agogo' => 113, 'steeldrums' => 114, 'woodblock' => 115,
    'taikodrum' => 116, 'melodictom' => 117, 'synthdrum' => 118, 'reversecymbal' => 119,
    'guitarfretnoise' => 120, 'breathnoise' => 121, 'seashore' => 122, 'birdtweet' => 123,
    'telephonering' => 124, 'helicopter' => 125, 'applause' => 126, 'gunshot' => 127,
];

/**
 * Programme der Instrumente in score.atex, je Spur das der Spur selbst (Instrumentwechsel an einzelnen Schlägen
 * zählen nicht). Daraus schlägt der Editor im Reiter "Spuren" die schon verwendeten Instrumente vor.
 *
 * @param string $slug Slug des Lieds
 * @return int[] MIDI-Programme ohne Duplikate, aufsteigend; leer, wenn es keine Partitur gibt
 */
function read_track_programs(string $slug): array
{
    $path = song_dir($slug) . '/' . SONG_FILES['score'];
    if (!is_file($path)) {
        return [];
    }
    $programs = [];
    // Der Exporter von alphaTab beginnt jede Spur mit "\track" am Zeilenanfang; "instrument" in ihrem Kopf kommt vor
    // den Noten, ein Instrumentwechsel am Schlag steht erst danach in geschweiften Klammern.
    foreach (preg_split('/^(?=\\\\track\b)/m', (string) file_get_contents($path)) as $part) {
        if (!str_starts_with($part, '\\track') || !preg_match('/\binstrument\s+(\w+)/', $part, $m)) {
            continue;
        }
        $program = ctype_digit($m[1]) ? (int) $m[1] : (INSTRUMENT_PROGRAMS[strtolower($m[1])] ?? null);
        if ($program !== null && $program <= 127) {
            $programs[$program] = $program;
        }
    }
    sort($programs);
    return array_values($programs);
}
