# Instrumente

Jede Spur hat eines von 13 Instrumenten plus Schlagzeug. Ein Instrument legt den Klang fest (ein General-MIDI-Programm);
so gibt es im Dialog "Spuren" statt 128 Klängen nur eine kurze Auswahlliste.

**Notenlage:** Jede Spur ist Gitarren-Tab, auch Gesang, Flöte oder Klavier: Eingegeben wird auf dem Griffbrett, der
Tonraum ist der der Gitarre. Deshalb wird jede Spur wie Gitarre notiert, eine Oktave höher, als sie klingt
(`TAB_NOTATION`, `notationPitch()`), gleich welches Instrument; dieselben Bünde stehen in allen Spuren gleich hoch. Ob
das Original eine Oktave höher oder tiefer klingt, nehmen wir in Kauf.

Der Konfliktlöser ordnet beim Import jeder Spur ein Instrument zu (Spalte "Programme"). Die Spalte "u. a." ist für den
Tooltip gedacht.

Umgesetzt in `INSTRUMENTS`, `instrumentOf()`, `setInstrument()`, `notationPitch()`, `toGuitarTab()` und
`normalizeTuningOctave()` (`public/js/lib/notation.js`), im Dialog "Spuren" (`public/js/pages/editor.js`) und im Konfliktlöser (`public/js/lib/conflicts.js`, Schritte "Spur ohne Saiten",
"Tuning in falscher Oktave" und "Instrument und Notenlage").

## Die Liste

| Instrument         | MIDI           | Programme                    | u. a.                                                                                  |
|--------------------|----------------|------------------------------|----------------------------------------------------------------------------------------|
| Klavier            | 0              | 0–7                          | Flügel, E-Piano, Honky-Tonk, Cembalo, Clavinet                                         |
| Xylophon           | 13             | 8–15, 108                    | Glockenspiel, Vibraphon, Marimba, Celesta, Spieluhr, Röhrenglocken, Hackbrett, Kalimba |
| Orgel              | 16             | 16–23                        | Hammond-Orgel, Kirchenorgel, Akkordeon, Bandoneon, Mundharmonika                       |
| Akustikgitarre     | 25             | 24, 25, 46, 104–107          | Westerngitarre, Konzertgitarre (Nylon), Harfe, Banjo, Sitar, Koto                      |
| E-Gitarre          | 27             | 26–28                        | Jazzgitarre, cleane E-Gitarre, gedämpfte E-Gitarre                                     |
| E-Gitarre verzerrt | 30             | 29–31                        | Overdrive, Distortion, Flageolett-Gitarre                                              |
| Bass               | 32             | 32–39                        | E-Bass, akustischer Bass, Fretless, Slap-Bass, Synth-Bass                              |
| Streicher          | 48             | 40–45, 47–51, 110            | Geige, Bratsche, Cello, Kontrabass, Pizzicato, Streichorchester, Fiddle, Pauke         |
| Gesang             | 53             | 52–54                        | Chor, Stimme ("Ooh"), Synth-Stimme                                                     |
| Trompete           | 56             | 56–63                        | Posaune, Tuba, Waldhorn, Blechbläsersatz                                               |
| Klarinette         | 71             | 64–71, 109, 111              | Saxophon (Sopran, Alt, Tenor, Bariton), Oboe, Englischhorn, Fagott, Dudelsack          |
| Flöte              | 73             | 72–79                        | Querflöte, Blockflöte, Piccolo, Panflöte, Okarina, Pfeifen                             |
| Synth              | 80             | 55, 80–103, 112–127          | Synthesizer (Melodie, Flächen), Klangeffekte, Orchesterschlag, Steel Drums, Geräusche  |
| Schlagzeug         | – (Kanal 10)   | Schlagzeugspuren             | Schlagzeug, Percussion                                                                 |

- **MIDI** ist der Klang, den die Spur bekommt; **Programme** sind die General-MIDI-Programme (0–127), die zu diesem
  Instrument werden. Die Einteilung folgt den 16 Familien von General MIDI (je acht Programme, z. B. 24–31 Gitarre),
  bis auf wenige Ausnahmen: Harfe (46) und die gezupften Ethno-Instrumente (104–107) klingen wie eine gezupfte
  Gitarre, Kalimba (108) wie ein Xylophon, Fiddle (110) ist eine Geige, Dudelsack (109) und Shanai (111) sind
  Rohrblattinstrumente, die Pauke (47) bleibt bei den Streichern wie in General MIDI.
- **Schlagzeug** ist kein Programm, sondern der Schlagzeugkanal von General MIDI (Kanal 10): Jede Tonhöhe ist ein
  anderes Schlaginstrument. Für Schlagzeug gibt es keine Notenlage, keinen Capo und kein Tuning.
- **Mehrere Saiten-Instrumente im Song:** Capo und Tuning müssen für die Spuren mit so vielen Saiten wie die Akkordspur
  gleich sein (Konfliktlöser, `conflicts.js`); ein Bass (4 Saiten) hat sein eigenes Tuning.

## Zuordnung beim Import (Regelwerk für den Konfliktlöser)

1. **Schlagzeug:** Notensystem mit Schlagzeug (`staff.isPercussion`) → Schlagzeug.
2. **Bass:** 4 oder 5 Saiten, tiefe Saite unter E2 → Bass, auch wenn das Programm etwas anderes sagt (in den
   GP-Dateien hat eine Bassspur Programm 0).
3. **Sonst nach dem Programm** (Spalte "Programme"). Das gilt auch für 6-saitige Spuren mit anderem Klang: Eine
   Melodie, die in Guitar Pro als Gitarren-Tab mit Gesangs- oder Flötenklang angelegt ist, wird Gesang bzw. Flöte
   (Tab bleibt).
4. **Spur ohne Saiten** (Gesang, Orgel): wird Gitarren-Tab mit Standard-Tuning (`toGuitarTab()`). Der ganze Satz
   wandert um so viele Oktaven, dass möglichst viele Töne zwischen tiefer leerer Saite (E2) und 12. Bund der hohen
   (E5) liegen; einzelne Töne, die dann noch nicht zu greifen sind, um eine weitere Oktave (Datenverlust im Protokoll).
5. **Tuning in die übliche Lage:** Liegt das Tuning eine oder mehrere Oktaven über oder unter der üblichen Lage
   (Gitarre E2 A2 D3 G3 B3 E4, Bass E1 A1 D2 G2; Grenze: tiefe Saite mehr als eine Quinte daneben), wird es um ganze
   Oktaven verschoben; die Bünde bleiben. Bei einer Gitarre ist das der Oktav-Trick aus Guitar Pro (Tuning E3 … mit
   "gleicher Oktave" statt E2 … mit "eine Oktave tiefer"); die Wiedergabe klingt danach so tief wie das echte
   Instrument (Datenverlust im Protokoll, weil sich der Klang ändert).
6. **Klang** aus der Liste setzen, **Notenlage** für Tab (`notationPitch()`). Ein anderer Klang (MIDI-Programm) ist
   kein Datenverlust: Noten, Tabs und Akkorde bleiben, nur die Wiedergabe klingt nach dem Instrument der Liste; im Protokoll steht er als normale
   Änderung (z. B. "Spur „Trompete“: Trompete (vorher Klang 57)").

## Analyse der Guitar-Pro-Dateien

31 Originaldateien in den Upload-Ordnern, 140 Spuren in 30 Songs:

| Spurart                                                                      | Spuren  | Notenlage in der Datei                                             |
|------------------------------------------------------------------------------|---------|--------------------------------------------------------------------|
| 6 Saiten, Gitarrenklang (24–30)                                              | 55      | fast immer eine Oktave höher                                       |
| 6 Saiten, anderer Klang (Gesang, Klavier, Flöte, Trompete, Sax, Streicher …) | 32      | fast immer klingend; einmal -9, einmal -2 (Saxophon-Transposition) |
| 4 Saiten, Bass (E1 A1 D2 G2, einmal Eb1)                                     | 14      | eine Oktave höher                                                  |
| Schlagzeug (in 14 Songs)                                                     | 21      | –                                                                  |
| ohne Saiten (Gesang, Orgel)                                                  | 8       | klingend                                                           |

Tunings: Standard E2 (108 Spuren), Eb (7), D G D G B D (Open G, 2), einmal der Oktav-Trick E3 ("Singer" in "Johnny
Walker", Gesangsklang). Capo nur 0 und 2. Keine Ukulele, keine 7-saitige Gitarre (beide sind nicht vorgesehen).

Programme (Anzahl Spuren): 0: 28 (davon 21 Schlagzeug), 1, 2, 6, 8, 10 je 1, 16: 3, 22: 1, 24: 5, 25: 25, 26: 7,
27: 6, 28: 1, 29: 5, 30: 6, 32: 1, 33: 9, 34: 2, 35: 2, 41, 43, 45 je 1, 48: 3, 53: 5, 56: 3, 60, 61, 63, 64, 65 je 1,
66: 2, 68: 2, 71: 1, 73: 4, 74, 75 je 1, 81: 2, 87, 101 je 1.

## Alle 128 General-MIDI-Instrumente

Die Programmnummern zählen wie in alphaTab und in den Noten ab 0 (in vielen Tabellen ab 1). Je acht bilden eine
Gruppe. Schlagzeug ist kein Programm, sondern der Kanal 10 (siehe oben). Anhören lassen sich alle in
`public/dev/instruments.html`.

| Nr. | Instrument (en)         | Instrument (de)          | Gruppe                  |
|----:|-------------------------|--------------------------|-------------------------|
|   0 | Acoustic Grand Piano    | Akustischer Flügel       | Klavier                 |
|   1 | Bright Acoustic Piano   | Helles Klavier           | Klavier                 |
|   2 | Electric Grand Piano    | Elektrischer Flügel      | Klavier                 |
|   3 | Honky-tonk Piano        | Honky-Tonk-Klavier       | Klavier                 |
|   4 | Electric Piano 1        | E-Piano 1                | Klavier                 |
|   5 | Electric Piano 2        | E-Piano 2                | Klavier                 |
|   6 | Harpsichord             | Cembalo                  | Klavier                 |
|   7 | Clavinet                | Clavinet                 | Klavier                 |
|   8 | Celesta                 | Celesta                  | Chromatische Perkussion |
|   9 | Glockenspiel            | Glockenspiel             | Chromatische Perkussion |
|  10 | Music Box               | Spieluhr                 | Chromatische Perkussion |
|  11 | Vibraphone              | Vibraphon                | Chromatische Perkussion |
|  12 | Marimba                 | Marimba                  | Chromatische Perkussion |
|  13 | Xylophone               | Xylophon                 | Chromatische Perkussion |
|  14 | Tubular Bells           | Röhrenglocken            | Chromatische Perkussion |
|  15 | Dulcimer                | Hackbrett                | Chromatische Perkussion |
|  16 | Drawbar Organ           | Zugriegelorgel           | Orgel                   |
|  17 | Percussive Organ        | Perkussive Orgel         | Orgel                   |
|  18 | Rock Organ              | Rockorgel                | Orgel                   |
|  19 | Church Organ            | Kirchenorgel             | Orgel                   |
|  20 | Reed Organ              | Harmonium                | Orgel                   |
|  21 | Accordion               | Akkordeon                | Orgel                   |
|  22 | Harmonica               | Mundharmonika            | Orgel                   |
|  23 | Tango Accordion         | Bandoneon                | Orgel                   |
|  24 | Acoustic Guitar (nylon) | Konzertgitarre (Nylon)   | Gitarre                 |
|  25 | Acoustic Guitar (steel) | Westerngitarre (Stahl)   | Gitarre                 |
|  26 | Electric Guitar (jazz)  | E-Gitarre (Jazz)         | Gitarre                 |
|  27 | Electric Guitar (clean) | E-Gitarre (clean)        | Gitarre                 |
|  28 | Electric Guitar (muted) | E-Gitarre (gedämpft)     | Gitarre                 |
|  29 | Overdriven Guitar       | E-Gitarre (Overdrive)    | Gitarre                 |
|  30 | Distortion Guitar       | E-Gitarre (Distortion)   | Gitarre                 |
|  31 | Guitar Harmonics        | Gitarren-Flageolett      | Gitarre                 |
|  32 | Acoustic Bass           | Kontrabass (akustisch)   | Bass                    |
|  33 | Electric Bass (finger)  | E-Bass (Finger)          | Bass                    |
|  34 | Electric Bass (pick)    | E-Bass (Plektrum)        | Bass                    |
|  35 | Fretless Bass           | Bundloser Bass           | Bass                    |
|  36 | Slap Bass 1             | Slap-Bass 1              | Bass                    |
|  37 | Slap Bass 2             | Slap-Bass 2              | Bass                    |
|  38 | Synth Bass 1            | Synth-Bass 1             | Bass                    |
|  39 | Synth Bass 2            | Synth-Bass 2             | Bass                    |
|  40 | Violin                  | Violine                  | Streicher               |
|  41 | Viola                   | Bratsche                 | Streicher               |
|  42 | Cello                   | Cello                    | Streicher               |
|  43 | Contrabass              | Kontrabass               | Streicher               |
|  44 | Tremolo Strings         | Streicher-Tremolo        | Streicher               |
|  45 | Pizzicato Strings       | Streicher-Pizzicato      | Streicher               |
|  46 | Orchestral Harp         | Konzertharfe             | Streicher               |
|  47 | Timpani                 | Pauke                    | Streicher               |
|  48 | String Ensemble 1       | Streicherensemble 1      | Ensemble                |
|  49 | String Ensemble 2       | Streicherensemble 2      | Ensemble                |
|  50 | Synth Strings 1         | Synth-Streicher 1        | Ensemble                |
|  51 | Synth Strings 2         | Synth-Streicher 2        | Ensemble                |
|  52 | Choir Aahs              | Chor „Aah“               | Ensemble                |
|  53 | Voice Oohs              | Stimme „Ooh“             | Ensemble                |
|  54 | Synth Voice             | Synth-Stimme             | Ensemble                |
|  55 | Orchestra Hit           | Orchesterschlag          | Ensemble                |
|  56 | Trumpet                 | Trompete                 | Blechbläser             |
|  57 | Trombone                | Posaune                  | Blechbläser             |
|  58 | Tuba                    | Tuba                     | Blechbläser             |
|  59 | Muted Trumpet           | Gedämpfte Trompete       | Blechbläser             |
|  60 | French Horn             | Waldhorn                 | Blechbläser             |
|  61 | Brass Section           | Blechbläsersatz          | Blechbläser             |
|  62 | Synth Brass 1           | Synth-Blech 1            | Blechbläser             |
|  63 | Synth Brass 2           | Synth-Blech 2            | Blechbläser             |
|  64 | Soprano Sax             | Sopransaxophon           | Rohrblatt               |
|  65 | Alto Sax                | Altsaxophon              | Rohrblatt               |
|  66 | Tenor Sax               | Tenorsaxophon            | Rohrblatt               |
|  67 | Baritone Sax            | Baritonsaxophon          | Rohrblatt               |
|  68 | Oboe                    | Oboe                     | Rohrblatt               |
|  69 | English Horn            | Englischhorn             | Rohrblatt               |
|  70 | Bassoon                 | Fagott                   | Rohrblatt               |
|  71 | Clarinet                | Klarinette               | Rohrblatt               |
|  72 | Piccolo                 | Piccoloflöte             | Flöten                  |
|  73 | Flute                   | Querflöte                | Flöten                  |
|  74 | Recorder                | Blockflöte               | Flöten                  |
|  75 | Pan Flute               | Panflöte                 | Flöten                  |
|  76 | Blown Bottle            | Flaschenblasen           | Flöten                  |
|  77 | Shakuhachi              | Shakuhachi               | Flöten                  |
|  78 | Whistle                 | Pfeifen                  | Flöten                  |
|  79 | Ocarina                 | Okarina                  | Flöten                  |
|  80 | Lead 1 (square)         | Lead 1 (Rechteck)        | Synth Lead              |
|  81 | Lead 2 (sawtooth)       | Lead 2 (Sägezahn)        | Synth Lead              |
|  82 | Lead 3 (calliope)       | Lead 3 (Dampforgel)      | Synth Lead              |
|  83 | Lead 4 (chiff)          | Lead 4 (Chiff)           | Synth Lead              |
|  84 | Lead 5 (charang)        | Lead 5 (Charang)         | Synth Lead              |
|  85 | Lead 6 (voice)          | Lead 6 (Stimme)          | Synth Lead              |
|  86 | Lead 7 (fifths)         | Lead 7 (Quinten)         | Synth Lead              |
|  87 | Lead 8 (bass + lead)    | Lead 8 (Bass und Lead)   | Synth Lead              |
|  88 | Pad 1 (new age)         | Pad 1 (New Age)          | Synth Pad               |
|  89 | Pad 2 (warm)            | Pad 2 (warm)             | Synth Pad               |
|  90 | Pad 3 (polysynth)       | Pad 3 (Polysynth)        | Synth Pad               |
|  91 | Pad 4 (choir)           | Pad 4 (Chor)             | Synth Pad               |
|  92 | Pad 5 (bowed)           | Pad 5 (gestrichen)       | Synth Pad               |
|  93 | Pad 6 (metallic)        | Pad 6 (metallisch)       | Synth Pad               |
|  94 | Pad 7 (halo)            | Pad 7 (Halo)             | Synth Pad               |
|  95 | Pad 8 (sweep)           | Pad 8 (Sweep)            | Synth Pad               |
|  96 | FX 1 (rain)             | FX 1 (Regen)             | Synth-Effekte           |
|  97 | FX 2 (soundtrack)       | FX 2 (Soundtrack)        | Synth-Effekte           |
|  98 | FX 3 (crystal)          | FX 3 (Kristall)          | Synth-Effekte           |
|  99 | FX 4 (atmosphere)       | FX 4 (Atmosphäre)        | Synth-Effekte           |
| 100 | FX 5 (brightness)       | FX 5 (Helligkeit)        | Synth-Effekte           |
| 101 | FX 6 (goblins)          | FX 6 (Kobolde)           | Synth-Effekte           |
| 102 | FX 7 (echoes)           | FX 7 (Echos)             | Synth-Effekte           |
| 103 | FX 8 (sci-fi)           | FX 8 (Science-Fiction)   | Synth-Effekte           |
| 104 | Sitar                   | Sitar                    | Ethnisch                |
| 105 | Banjo                   | Banjo                    | Ethnisch                |
| 106 | Shamisen                | Shamisen                 | Ethnisch                |
| 107 | Koto                    | Koto                     | Ethnisch                |
| 108 | Kalimba                 | Kalimba                  | Ethnisch                |
| 109 | Bagpipe                 | Dudelsack                | Ethnisch                |
| 110 | Fiddle                  | Fiedel                   | Ethnisch                |
| 111 | Shanai                  | Shehnai                  | Ethnisch                |
| 112 | Tinkle Bell             | Glöckchen                | Perkussion              |
| 113 | Agogo                   | Agogo                    | Perkussion              |
| 114 | Steel Drums             | Steeldrums               | Perkussion              |
| 115 | Woodblock               | Holzblock                | Perkussion              |
| 116 | Taiko Drum              | Taiko-Trommel            | Perkussion              |
| 117 | Melodic Tom             | Melodisches Tom          | Perkussion              |
| 118 | Synth Drum              | Synth-Trommel            | Perkussion              |
| 119 | Reverse Cymbal          | Rückwärts-Becken         | Perkussion              |
| 120 | Guitar Fret Noise       | Bundgeräusch der Gitarre | Geräusche               |
| 121 | Breath Noise            | Atemgeräusch             | Geräusche               |
| 122 | Seashore                | Meeresrauschen           | Geräusche               |
| 123 | Bird Tweet              | Vogelgezwitscher         | Geräusche               |
| 124 | Telephone Ring          | Telefonklingeln          | Geräusche               |
| 125 | Helicopter              | Hubschrauber             | Geräusche               |
| 126 | Applause                | Applaus                  | Geräusche               |
| 127 | Gunshot                 | Schuss                   | Geräusche               |
