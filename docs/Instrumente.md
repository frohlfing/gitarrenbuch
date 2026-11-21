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
`normalizeTuningOctave()` (`public/js/notation.js`), im Dialog "Spuren" (`public/js/editor.js`) und im Konfliktlöser (`public/js/conflicts.js`, Schritte "Spur ohne Saiten",
"Tuning in falscher Oktave" und "Instrument und Notenlage").

## Die Liste

| Instrument         | MIDI           | Programme                    | u. a.                                                                           |
|--------------------|----------------|------------------------------|---------------------------------------------------------------------------------|
| Klavier            | 0              | 0–7                          | Flügel, E-Piano, Honky-Tonk, Cembalo, Clavinet                                  |
| Xylophon           | 13             | 8–15, 108                    | Glockenspiel, Vibraphon, Marimba, Celesta, Spieluhr, Röhrenglocken, Hackbrett, Kalimba |
| Orgel              | 16             | 16–23                        | Hammond-Orgel, Kirchenorgel, Akkordeon, Bandoneon, Mundharmonika                |
| Akustikgitarre     | 25             | 24, 25, 46, 104–107          | Westerngitarre, Konzertgitarre (Nylon), Harfe, Banjo, Sitar, Koto              |
| E-Gitarre          | 27             | 26–28                        | Jazzgitarre, cleane E-Gitarre, gedämpfte E-Gitarre                              |
| E-Gitarre verzerrt | 30             | 29–31                        | Overdrive, Distortion, Flageolett-Gitarre                                       |
| Bass               | 32             | 32–39                        | E-Bass, akustischer Bass, Fretless, Slap-Bass, Synth-Bass                       |
| Streicher          | 48             | 40–45, 47–51, 110            | Geige, Bratsche, Cello, Kontrabass, Pizzicato, Streichorchester, Fiddle, Pauke  |
| Gesang             | 53             | 52–54                        | Chor, Stimme ("Ooh"), Synth-Stimme                                              |
| Trompete           | 56             | 56–63                        | Posaune, Tuba, Waldhorn, Blechbläsersatz                                        |
| Klarinette         | 71             | 64–71, 109, 111              | Saxophon (Sopran, Alt, Tenor, Bariton), Oboe, Englischhorn, Fagott, Dudelsack   |
| Flöte              | 73             | 72–79                        | Querflöte, Blockflöte, Piccolo, Panflöte, Okarina, Pfeifen                      |
| Synth              | 80             | 55, 80–103, 112–127          | Synthesizer (Melodie, Flächen), Klangeffekte, Orchesterschlag, Steel Drums, Geräusche |
| Schlagzeug         | – (Kanal 10)   | Schlagzeugspuren             | Schlagzeug, Percussion                                                          |

- **MIDI** ist der Klang, den die Spur bekommt; **Programme** sind die General-MIDI-Programme (0–127), die zu diesem
  Instrument werden. Die Einteilung folgt den 16 Familien von General MIDI (je acht Programme, z. B. 24–31 Gitarre),
  bis auf wenige Ausnahmen: Harfe (46) und die gezupften Ethno-Instrumente (104–107) klingen wie eine gezupfte
  Gitarre, Kalimba (108) wie ein Xylophon, Fiddle (110) ist eine Geige, Dudelsack (109) und Shanai (111) sind
  Rohrblattinstrumente, die Pauke (47) bleibt bei den Streichern wie in General MIDI.
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
