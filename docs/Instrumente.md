# Instrumente

Jede Spur hat eines von 13 Instrumenten plus Schlagzeug. Ein Instrument legt zwei Dinge fest: den Klang (ein
General-MIDI-Programm) und die Notenlage (wie hoch die Noten im Notensystem gegenüber dem Klang stehen). So gibt es im
Dialog "Spuren" statt 128 Klängen und einer eigenen Spalte "Notenlage" nur eine kurze Auswahlliste. Der Konfliktlöser
ordnet beim Import jeder Spur ein Instrument zu (Spalte "Programme"). Die Spalte "u. a." ist für den Tooltip gedacht.

Umgesetzt in `INSTRUMENTS`, `instrumentOf()`, `setInstrument()` und `normalizeTuningOctave()` (`public/js/notation.js`),
im Dialog "Spuren" (`public/js/editor.js`) und im Konfliktlöser (`public/js/conflicts.js`, Schritte "Tuning in falscher
Oktave" und "Instrument und Notenlage").

## Die Liste

| Instrument         | MIDI           | Programme                    | Notenlage         | u. a.                                                                           |
|--------------------|----------------|------------------------------|-------------------|---------------------------------------------------------------------------------|
| Klavier            | 0              | 0–7                          | klingend          | Flügel, E-Piano, Honky-Tonk, Cembalo, Clavinet                                  |
| Xylophon           | 13             | 8–15, 108                    | klingend          | Glockenspiel, Vibraphon, Marimba, Celesta, Spieluhr, Röhrenglocken, Hackbrett, Kalimba |
| Orgel              | 16             | 16–23                        | klingend          | Hammond-Orgel, Kirchenorgel, Akkordeon, Bandoneon, Mundharmonika                |
| Akustikgitarre     | 25             | 24, 25, 46, 104–107          | eine Oktave höher | Westerngitarre, Konzertgitarre (Nylon), Harfe, Banjo, Sitar, Koto              |
| E-Gitarre          | 27             | 26–28                        | eine Oktave höher | Jazzgitarre, cleane E-Gitarre, gedämpfte E-Gitarre                              |
| E-Gitarre verzerrt | 30             | 29–31                        | eine Oktave höher | Overdrive, Distortion, Flageolett-Gitarre                                       |
| Bass               | 32             | 32–39                        | eine Oktave höher | E-Bass, akustischer Bass, Fretless, Slap-Bass, Synth-Bass                       |
| Streicher          | 48             | 40–45, 47–51, 110            | klingend          | Geige, Bratsche, Cello, Kontrabass, Pizzicato, Streichorchester, Fiddle, Pauke  |
| Gesang             | 53             | 52–54                        | klingend          | Chor, Stimme ("Ooh"), Synth-Stimme                                              |
| Trompete           | 56             | 56–63                        | klingend          | Posaune, Tuba, Waldhorn, Blechbläsersatz                                        |
| Klarinette         | 71             | 64–71, 109, 111              | klingend          | Saxophon (Sopran, Alt, Tenor, Bariton), Oboe, Englischhorn, Fagott, Dudelsack   |
| Flöte              | 73             | 72–79                        | klingend          | Querflöte, Blockflöte, Piccolo, Panflöte, Okarina, Pfeifen                      |
| Synth              | 80             | 55, 80–103, 112–127          | klingend          | Synthesizer (Melodie, Flächen), Klangeffekte, Orchesterschlag, Steel Drums, Geräusche |
| Schlagzeug         | – (Kanal 10)   | Schlagzeugspuren             | –                 | Schlagzeug, Percussion                                                          |

- **MIDI** ist der Klang, den die Spur bekommt; **Programme** sind die General-MIDI-Programme (0–127), die zu diesem
  Instrument werden. Die Einteilung folgt den 16 Familien von General MIDI (je acht Programme, z. B. 24–31 Gitarre),
  bis auf wenige Ausnahmen: Harfe (46) und die gezupften Ethno-Instrumente (104–107) klingen wie eine gezupfte
  Gitarre, Kalimba (108) wie ein Xylophon, Fiddle (110) ist eine Geige, Dudelsack (109) und Shanai (111) sind
  Rohrblattinstrumente, die Pauke (47) bleibt bei den Streichern wie in General MIDI.
- **Notenlage:** Gitarre und Bass werden üblicherweise eine Oktave höher notiert, als sie klingen (Violinschlüssel bzw.
  Bassschlüssel mit kleiner 8 darunter); alle anderen Instrumente stehen, wie sie klingen. Das entspricht den
  Guitar-Pro-Dateien im Upload-Ordner (Analyse unten).
- **Schlagzeug** ist kein Programm, sondern der Schlagzeugkanal von General MIDI (Kanal 10): Jede Tonhöhe ist ein
  anderes Schlaginstrument. Für Schlagzeug gibt es keine Notenlage, keinen Capo und kein Tuning.
- **Mehrere Saiten-Instrumente im Song:** Capo und Tuning müssen für die Spuren mit so vielen Saiten wie die Akkordspur
  gleich sein (`docs/Konflikte.md`); ein Bass (4 Saiten) hat sein eigenes Tuning.

## Zuordnung beim Import (Regelwerk für den Konfliktlöser)

1. **Schlagzeug:** Notensystem mit Schlagzeug (`staff.isPercussion`) → Schlagzeug.
2. **Bass:** 4 oder 5 Saiten, tiefe Saite unter E2 → Bass, auch wenn das Programm etwas anderes sagt (in den
   GP-Dateien hat eine Bassspur Programm 0).
3. **Sonst nach dem Programm** (Spalte "Programme"). Das gilt auch für 6-saitige Spuren mit anderem Klang: Eine
   Melodie, die in Guitar Pro als Gitarren-Tab mit Gesangs- oder Flötenklang angelegt ist, wird Gesang bzw. Flöte
   (Tab bleibt, Noten klingend).
4. **Tuning in die übliche Lage:** Liegt das Tuning eine oder mehrere Oktaven über oder unter der üblichen Lage
   (Gitarre E2 A2 D3 G3 B3 E4, Bass E1 A1 D2 G2; Grenze: tiefe Saite mehr als eine Quinte daneben), wird es um ganze
   Oktaven verschoben; die Bünde bleiben. Bei einer Gitarre ist das der Oktav-Trick aus Guitar Pro (Tuning E3 … mit
   "gleicher Oktave" statt E2 … mit "eine Oktave tiefer"); die Wiedergabe klingt danach so tief wie das echte
   Instrument (Datenverlust im Protokoll, weil sich der Klang ändert).
5. **Klang und Notenlage** aus der Liste setzen. Ein anderer Klang (MIDI-Programm) ist kein Datenverlust: Noten, Tabs
   und Akkorde bleiben, nur die Wiedergabe klingt nach dem Instrument der Liste; im Protokoll steht er als normale
   Änderung (z. B. "Spur „Trompete“: Trompete (vorher Klang 57)").

## Analyse der Guitar-Pro-Dateien (20.11.2026)

31 Originaldateien in den Upload-Ordnern, 140 Spuren in 30 Songs:

| Spurart                                                         | Spuren | Notenlage in der Datei                                   |
|-----------------------------------------------------------------|--------|----------------------------------------------------------|
| 6 Saiten, Gitarrenklang (24–30)                                 | 55     | fast immer eine Oktave höher                             |
| 6 Saiten, anderer Klang (Gesang, Klavier, Flöte, Trompete, Sax, Streicher …) | 32 | fast immer klingend; einmal -9, einmal -2 (Saxophon-Transposition) |
| 4 Saiten, Bass (E1 A1 D2 G2, einmal Eb1)                        | 14     | eine Oktave höher                                        |
| Schlagzeug (in 14 Songs)                                        | 21     | –                                                        |
| ohne Saiten (Gesang, Orgel)                                     | 8      | klingend                                                 |

Tunings: Standard E2 (108 Spuren), Eb (7), D G D G B D (Open G, 2), einmal der Oktav-Trick E3 ("Singer" in "Johnny
Walker", Gesangsklang). Capo nur 0 und 2. Keine Ukulele, keine 7-saitige Gitarre (beide sind nicht vorgesehen).

Programme (Anzahl Spuren): 0: 28 (davon 21 Schlagzeug), 1, 2, 6, 8, 10 je 1, 16: 3, 22: 1, 24: 5, 25: 25, 26: 7,
27: 6, 28: 1, 29: 5, 30: 6, 32: 1, 33: 9, 34: 2, 35: 2, 41, 43, 45 je 1, 48: 3, 53: 5, 56: 3, 60, 61, 63, 64, 65 je 1,
66: 2, 68: 2, 71: 1, 73: 4, 74, 75 je 1, 81: 2, 87, 101 je 1.
