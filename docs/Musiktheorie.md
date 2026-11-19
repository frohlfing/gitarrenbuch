# Musiktheorie

Grundlagen für die Akkorde im Gitarrenbuch. Die Tabellen sind die Vorlage dafür, wie `parseChord()` (`js/chordtheory.js`)
einen Akkordnamen in Töne zerlegt; `findGrips()` (`js/chordgrips.js`) sucht dafür Griffe, `nameGrip()` und `nameChord()`
benennen die Töne eines Griffs, `suggestChordNames()` schlägt beim Tippen Namen vor. 

Alle Beispiele stehen mit dem Grundton C.

## Akkordaufbau

Ein Akkord entsteht durch **Terzschichtung**: Über den Grundton (1) kommt eine Terz, darüber eine weitere und so fort.
Eine große Terz hat vier Halbtöne, eine kleine drei. Der Name sagt, welche Töne zu den Terzen dazukommen und welche
verändert werden.

### Intervalle

Abstand der Töne vom Grundton in Halbtönen.

Die Stufe (Spalte 1) ist die Position des Tons in der Dur-Tonleiter über dem Grundton (1 = C, 2 = D, 3 = E, 4 = F,
5 = G, 6 = A, 7 = B). Ein `b` vor der Zahl macht den Ton einen Halbton tiefer, ein `#` einen Halbton höher: b3 ist die
Terz E einen Halbton tiefer, also Eb; #5 ist die Quinte G einen Halbton höher, also G#.

| Stufe | Halbtöne | Name               | Ton in C |
|-------|---------:|--------------------|----------|
| 1     |        0 | Prime (Grundton)   | C        |
| b2    |        1 | kleine Sekunde     | Db       |
| 2     |        2 | große Sekunde      | D        |
| b3    |        3 | kleine Terz        | Eb       |
| 3     |        4 | große Terz         | E        |
| 4     |        5 | (reine) Quarte     | F        |
| #4    |        6 | übermäßige Quarte  | F#       |
| b5    |        6 | verminderte Quinte | Gb       |
| 5     |        7 | (reine) Quinte     | G        |
| #5    |        8 | übermäßige Quinte  | G#       |
| b6    |        8 | kleine Sexte       | Ab       |
| 6     |        9 | große Sexte        | A        |
| b7    |       10 | kleine Septime     | Bb       |
| 7     |       11 | große Septime      | B        |
| 8     |       12 | Oktave             | C        |

### Dreiklang

Drei Töne: Grundton, Terz, Quinte. Es gibt vier Dreiklänge, je nach Terz und Quinte.

| Akkord                       | Intervall | Töne in C | Akkordname für C | Anmerkung                                                            |
|------------------------------|-----------|-----------|------------------|----------------------------------------------------------------------|
| Dur                          | 1, 3, 5   | C E G     | C                | Hat die gro0e Terz. Ohne Zusatz im Namen ist ein Akkord Dur.         |
| Moll                         | 1, b3, 5  | C Eb G    | Cm               | Hat die kleine Terz. Das `m` steht immer direkt hinter dem Grundton. |
| Vermindert (dim, diminished) | 1, b3, b5 | C Eb Gb   | Cdim (auch C°)   | Besteht aus zwei kleinen Terzen. Wird selten gespielt.               |
| Übermäßig (aug, augmented)   | 1, 3, #5  | C E G#    | Caug             | Besteht aus zwei großen Terzen. Tonleiterfremd!                      |

Daraus ergeben sich die Stufenakkorde:

| Stufe der C-Dur-Tonleiter | Grundton des Akkords | Terz | Quinte | Art        | Akkordname |
|---------------------------|----------------------|------|--------|------------|------------|
| 1                         | C                    | E    | G      | Dur        | C          |
| 2                         | D                    | F    | A      | Moll       | Dm         |
| 3                         | E                    | G    | B      | Moll       | Em         |
| 4                         | F                    | A    | C      | Dur        | F          |
| 5                         | G                    | B    | D      | Dur        | G          |
| 6                         | A                    | C    | E      | Moll       | Am         |
| 7                         | B                    | D    | F      | Vermindert | Bdim       |

Der übermäßige Akkord ist kein Stufenakkord der Dur-Tonleiter (und auch nicht des natürlichen Molls). 
Um ihn zu bilden, benötigt man einen leiterfremden Ton. Das G# des C–E–G# steht nicht in C-Dur.

### Modifizierter Dreiklang (suspended)

Bei **sus** (suspended) wird die Terz durch die Sekunde bzw. durch die Quarte ersetzt. 
Der Akkord hat keine Terz und ist deshalb weder Dur noch Moll.

| Akkord | Intervall         | Töne in C | Akkordname für C | Anmerkung                  |
|--------|-------------------|-----------|------------------|----------------------------|
| Sus2   | 1, 2 (statt 3), 5 | C D G     | Csus2            | Terz durch Sekunde ersetzt |
| Sus4   | 1, 4 (statt 3), 5 | C F G     | Csus4, Csus      | Terz durch Quarte ersetzt  |

- `Csus` ohne Zahl heißt immer **sus4**.
- Sus-Akkorde mit Septime stehen im Kapitel „Vierklang“.

### Vierklang

Ein Vierklang ist ein **Dreiklang plus ein vierter Ton**. Der Name nennt zuerst den Dreiklang (Dur, `m`, `dim`, `aug`,
`sus2`, `sus4`) und dahinter den vierten Ton (`7`, `maj7`, `6`, `add9`, `add4`). So lässt sich ein Akkordname in seine
Töne zerlegen (Dreiklang aus der Zeile, vierter Ton aus der Spalte) und umgekehrt aus den Tönen eines Griffs der Name
herleiten. Die Tabelle zeigt alle Kombinationen mit den Akkordnamen für C (die gängigste Schreibweise zuerst); Klammern
im Namen (`C7(b5)`) bedeuten dasselbe wie ohne Klammern:

| Dreiklang  | Intervall | + kleine Septime (b7) | + große Septime (7) | + Sexte (6)    | + Sekunde (add9)  | + Quarte (add4)        |
|------------|-----------|-----------------------|---------------------|----------------|-------------------|------------------------|
| Dur        | 1, 3, 5   | C7                    | Cmaj7, CΔ7          | C6, Cmaj6      | Cadd9, Cadd2, C2  | Cadd4, Cadd11          |
| Moll       | 1, b3, 5  | Cm7                   | Cmmaj7, CmΔ7        | Cm6, Cmin6     | Cmadd9, Cm2       | Cmadd4, Cmadd11        |
| Vermindert | 1, b3, b5 | Cm7b5, Cø             | Cdimmaj7 (²)        | Cdim7, C°7 (¹) | Cdimadd9 (²)      | Cdimadd4 (²)           |
| Übermäßig  | 1, 3, #5  | C7#5, C7+, Caug7      | Cmaj7#5, CM7+ (²)   | Caug6 (²)      | Caugadd9 (²)      | Caugadd4 (²)           |
| Dur mit b5 | 1, 3, b5  | C7b5                  | Cmaj7b5 (²)         | C6b5 (²)       | Cadd9b5 (²)       | Cadd4b5 (²)            |
| Sus4       | 1, 4, 5   | C7sus4                | Cmaj7sus4           | C6sus4 (²)     | Csus4add9 (³)     | –                      |
| Sus2       | 1, 2, 5   | C7sus2                | Cmaj7sus2           | C6sus2 (²)     | –                 | Csus2add4 (³)          |

- (¹) Beim verminderten Dreiklang ist der vierte Ton die **verminderte Septime** (bb7, 9 Halbtöne). Sie klingt wie eine
  Sexte, daher steht `Cdim7` in der Spalte „Sexte“. Der vollverminderte Akkord (`Cdim7`) besteht nur aus kleinen Terzen,
  jede seiner vier Umkehrungen ist wieder ein `dim7`; `Cm7b5` heißt "halbvermindert".
- (²) Theoretischer Name: Er folgt der Formel, wird auf der Gitarre aber kaum gespielt.
- (³) `Csus4add9` und `Csus2add4` sind derselbe Klang (C D F G); beide kommen nur theoretisch vor.
- `–` heißt: Der vierte Ton steckt schon im Dreiklang (Sus4 hat die Quarte, Sus2 die Sekunde).
- Der Name wird so zusammengesetzt: Grundton, dann `m` (Moll), dann der vierte Ton (`7`, `maj7`, `6`, `add9`), dann die
  Änderung der Quinte oder der Terz (`b5`, `#5`, `sus4`): `Cm7b5`, `C7#5`, `C7sus4`.
- Die **Zahl ohne Zusatz** (`C7`) ist immer die **kleine** Septime (Bb). Die große Septime (B) braucht ein `maj`, `M`
  oder `Δ`.
- **Dur mit b5** (C E Gb) ist kein eigener Dreiklang mit Namen, sondern ein Dur-Dreiklang mit erniedrigter Quinte. Er
  kommt nur mit Septime vor (`C7b5`). Mit erhöhter Quinte (#5) ist es der übermäßige Dreiklang.
- Bei **sus** ersetzt die Sekunde bzw. Quarte die Terz; sie bleibt im Vierklang weg.
- **Septime:** Die Quinte darf entfallen (siehe Akkord ohne Quinte), Terz und Septime nicht.
- **Sexte:** `C6` und `Am7` haben dieselben Töne (C E G A), nur anderer Grundton. Welcher Name gilt, hängt vom Bass und
  von der Harmonie ab. Mit zusätzlicher Sekunde heißt der Akkord `C6/9` (C E G A D, Fünfklang, auf der Gitarre üblich).
- **add9:** `add` heißt: nur diese Stufe wird zusätzlich gespielt. `Cadd9` ist **kein** `C9`: `C9` enthält auch die kleine
  Septime (C E G Bb D, Fünfklang). `C2` meint fast immer `Cadd9` (Terz bleibt); ohne Terz heißt der Akkord `Csus2`.
- **add4:** Die Quarte liegt einen Halbton über der Terz und klingt deshalb schräg; das Gegenstück ohne Terz ist `Csus4`.
  `add4` bzw. `add11` ist auf der Gitarre sehr selten.

Die Stufenakkorde der C-Dur-Tonleiter mit Septime (Dreiklang der Stufe plus die Septime der Tonleiter):

| Stufe | Akkordname | Töne    | Aufbau          |
|-------|------------|---------|-----------------|
| 1     | Cmaj7      | C E G B | Dur + 7         |
| 2     | Dm7        | D F A C | Moll + b7       |
| 3     | Em7        | E G B D | Moll + b7       |
| 4     | Fmaj7      | F A C E | Dur + 7         |
| 5     | G7         | G B D F | Dur + b7        |
| 6     | Am7        | A C E G | Moll + b7       |
| 7     | Bm7b5      | B D F A | Vermindert + b7 |

### Slash-Chord (Akkord mit anderem Bass)

Hinter dem Schrägstrich steht der **tiefste Ton** (Basston). Der Akkord davor bleibt, nur der Bass wechselt.

| Akkord              | Bedeutung                               | Töne in C                  | Art                         |
|---------------------|-----------------------------------------|----------------------------|-----------------------------|
| `C/E`, `D/F#`       | Dur, Terz im Bass (1. Umkehrung)        | E bzw. F#, dann der Akkord | Umkehrung                   |
| `C/G`               | C-Dur, Quinte im Bass (2. Umkehrung)    | G, dann C E G              | Umkehrung                   |
| `Cmaj7/E`, `C7/Bb`  | Vierklang, Terz bzw. Septime im Bass    | E bzw. Bb, dann der Akkord | Umkehrung                   |
| `C/D`, `C/A`, `C/B` | Basston, der nicht im Dreiklang steht   | D, A bzw. B, dann C E G    | Akkord mit fremdem Bass     |
| `Am/G`              | Absteigende Basslinie                   | G, dann A C E              | typisch in Liedbegleitungen |

- Steht der Basston im Akkord (E oder G bei C-Dur), ist es eine **Umkehrung**: dieselben Töne, anderer tiefster Ton.
- Steht er nicht im Akkord (D, A, B bei C-Dur), kommt er als zusätzlicher Bass dazu.
- Auf der Gitarre sind Slash-Chords vor allem für **Basslinien** in der Begleitung wichtig (`C - C/B - Am - Am/G`).
- Den Basston spielt die tiefste Saite im Griff. Die Saiten darunter werden nicht gespielt (x).

### Zweiklang

Zwei Töne: der Grundton und ein weiterer.

Der Akkord hat keine Terz und passt deswegen zu Dur und Moll.

| Akkord                 | Intervall | Töne in C | Akkordname für C    |
|------------------------|-----------|-----------|---------------------|
| Powerchord             | 1, 5      | C G       | C5                  |

### Akkord ohne Quinte (no5)

Die Quinte trägt am wenigsten zum Charakter eines Akkords bei: Dur oder Moll bestimmt die Terz, bei Vierklängen die
Septime. Deshalb lässt man sie weg, wenn der Akkord sonst schwer zu greifen ist. Der Name enthält dann `no5` bzw. `omit5`
(`C7no5`: C E Bb, `Cmaj7no5`: C E B). Meist steht aber der Name des vollständigen Akkords (`C`, `C7`), und nur der Griff
lässt die Quinte aus. Für die Griffberechnung heißt das: Die Quinte darf entfallen, Grundton, Terz und Septime nicht.

| Akkord                 | Intervall | Töne in C | Akkordname für C    |
|------------------------|-----------|-----------|---------------------|
| Dur ohne Quinte (no5)  | 1, 3      | C E       | C (Cno5, Comit5)    |
| Moll ohne Quinte (no5) | 1, b3     | C Eb      | Cm (Cmno5, Cmomit5) |

### Fünf-, Sechs- und Siebenklang (Erweiterungen)

Ein Akkord mit fünf und mehr Tönen ist ein **Vierklang mit Septime plus Erweiterung**. Man schichtet weitere Terzen über
die Septime: None (9), Undezime (11) und Tredezime (13). Die Zahl im Namen schließt alle Stufen darunter ein: `C9` hat
1, 3, 5, b7, 9, `C11` zusätzlich die 11, `C13` zusätzlich die 13 (also 7 Töne). Die Gitarre hat sechs Saiten und eine
Hand, daher werden Töne weggelassen (meist die Quinte, bei Fünfklängen auch der Grundton).

Die Stufen oberhalb der Oktave (Halbtöne vom Grundton, die Reihe geht über 12 hinaus; für die Tonhöhe zählt der Wert
modulo 12):

| Stufe | Halbtöne | Name               | Ton in C | gleicher Ton wie |
|-------|---------:|--------------------|----------|------------------|
| b9    |       13 | kleine None        | Db       | b2               |
| 9     |       14 | None               | D        | 2                |
| #9    |       15 | übermäßige None    | Eb       | b3               |
| 11    |       17 | Undezime           | F        | 4                |
| #11   |       18 | übermäßige Undezime| F#       | #4 / b5          |
| b13   |       20 | kleine Tredezime   | Ab       | b6 / #5          |
| 13    |       21 | Tredezime          | A        | 6                |

Die Matrix zeigt alle Kombinationen aus Vierklang mit Septime (Zeile) und Erweiterung (Spalte) mit den Akkordnamen für C:

| Vierklang               | Intervall      | + None (9)   | + Undezime (11) | + Tredezime (13) |
|-------------------------|----------------|--------------|-----------------|------------------|
| Dur + b7                | 1, 3, 5, b7    | C9           | C11             | C13              |
| Dur + 7                 | 1, 3, 5, 7     | Cmaj9, CM9   | Cmaj11          | Cmaj13           |
| Moll + b7               | 1, b3, 5, b7   | Cm9          | Cm11            | Cm13             |
| Moll + 7                | 1, b3, 5, 7    | Cmmaj9 (²)   | Cmmaj11 (²)     | Cmmaj13 (²)      |
| Vermindert + b7 (m7b5)  | 1, b3, b5, b7  | Cm9b5        | Cm11b5          | Cm13b5 (²)       |
| Vermindert + bb7 (dim7) | 1, b3, b5, bb7 | Cdim9 (²)    | Cdim11 (²)      | Cdim13 (²)       |
| Übermäßig + b7          | 1, 3, #5, b7   | C9#5         | C11#5 (²)       | C13#5 (²)        |
| Übermäßig + 7           | 1, 3, #5, 7    | Cmaj9#5 (²)  | Cmaj11#5 (²)    | Cmaj13#5 (²)     |
| Dur mit b5 + b7         | 1, 3, b5, b7   | C9b5         | C11b5 (²)       | C13b5 (²)        |
| Dur mit b5 + 7          | 1, 3, b5, 7    | Cmaj9b5 (²)  | Cmaj11b5 (²)    | Cmaj13b5 (²)     |
| Sus4 + b7               | 1, 4, 5, b7    | C9sus4       | –               | C13sus4          |
| Sus4 + 7                | 1, 4, 5, 7     | Cmaj9sus4 (²)| –               | Cmaj13sus4 (²)   |
| Sus2 + b7               | 1, 2, 5, b7    | –            | C11sus2 (²)     | C13sus2 (²)      |
| Sus2 + 7                | 1, 2, 5, 7     | –            | Cmaj11sus2 (²)  | Cmaj13sus2 (²)   |

- (²) Theoretischer Name: Er folgt der Formel, wird auf der Gitarre aber kaum gespielt.
- `–` heißt: Die Stufe steckt schon im Dreiklang (Sus4 hat die 11 = Quarte, Sus2 die 9 = Sekunde).
- Ohne `maj` gilt immer die **kleine** Septime (`C9` = C E G Bb D); die große braucht `maj`, `M` oder `Δ`.
- Beim Sus-Akkord ersetzt die Sekunde bzw. Quarte die Terz; die Erweiterung kommt dazu.

Sexte und None zusammen ergeben den **6/9-Akkord**:

| Akkord        | Intervall      | Töne in C   | Akkordname für C |
|---------------|----------------|-------------|------------------|
| Dur + 6 + 9   | 1, 3, 5, 6, 9  | C E G A D   | C6/9, C6add9     |
| Moll + 6 + 9  | 1, b3, 5, 6, 9 | C Eb G A D  | Cm6/9, Cm6add9   |

Die **Alterationen** der Erweiterungsstufen werden an den Namen gehängt und ersetzen die ungeänderte Stufe. Sie kommen vor
allem bei Dominantseptakkorden vor (Blues, Jazz):

| Akkord       | Intervall      | Töne in C    | Akkordname für C |
|--------------|----------------|--------------|------------------|
| 7 + b9       | 1, 3, 5, b7, b9 | C E G Bb Db | C7b9             |
| 7 + #9       | 1, 3, 5, b7, #9 | C E G Bb Eb | C7#9             |
| 7 + #11      | 1, 3, 5, b7, #11 | C E G Bb F# | C7#11           |
| 7 + b13      | 1, 3, 5, b7, b13 | C E G Bb Ab | C7b13           |

Für das Gitarrenbuch genügt es, Namen mit Erweiterung zu **vereinfachen**: `C9` → `C7`, `Cmaj9` → `Cmaj7`, `Cm9` → `Cm7`,
`C11` und `C13` → `C7`. `simplifyChord()` (`js/chordfile.js`) macht das bisher nur zum Teil (Namen ohne "7" wie `C9`
fallen auf `C` zurück); diese Regel ist die Vorlage dafür.

## Variante mit Stern (*)

Ein Stern am Ende eines Akkordnamens ("D7*") kennzeichnet in einem Song eine **zweite Griffvariante** desselben Akkords. alphaTab
kennt zu einem Namen nur einen Griff; braucht ein Song für denselben Akkord einen zweiten (z. B. eine Lage höher), bekommt dessen
Name einen Stern. Für die Akkordtheorie zählt der Stern nicht: `parseChord()` ignoriert ihn, die Töne und die Prüfung des Griffs
gelten für den Akkord ohne Stern. Im Katalog steht die Variante als eigener Eintrag ("d7*") mit ihrem Griff, damit ihr Griffbild
nicht durch den Standardgriff von "D7" ersetzt wird. Der Dialog "Akkord" schlägt keinen Stern vor.

## Quellen

Zur Kontrolle der Namen und Griffe: <https://www.oolimo.com/de/gitarrenakkorde>.
