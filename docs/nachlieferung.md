# Nachlieferung und Prüfung nach der Archiv-Übernahme

Stand 27.10.2026. Übernommen wurden 42 Lieder aus `data/archiv`. Diese Liste zeigt, wo noch etwas fehlt oder wo
du nachsehen solltest, damit jedes Lied so vollständig ist, als wäre es über den Import angelegt worden.

## Audio fehlt (✅ erledigt)

Im Archiv gab es für diese Lieder keine MP3-Datei.

- [x] Frank Rohlfing – Ich bin in Rente - ich muss gar nichts!
- [x] Ludwig van Beethoven – Für Elise
- [x] Traditional – Adeste Fideles
- [x] Traditional – Amarillo
- [x] Traditional – Beginner Blues
- [x] Traditional – Drunken Sailor
- [x] Traditional – Easy Slow Delta Blues
- [x] Traditional – Happy Birthday
- [x] Traditional – Kol Dodie
- [x] Traditional – Kommet ihr Hirten
- [x] Traditional – Stille Nacht

-> das ist ok.

## Cover (✅ erledigt)

Stand 27.10.2026 hat jedes der 42 Lieder ein Cover mit 500 × 500 px. 

## Noten fehlen (✅ erledigt)

- [x] Frank Rohlfing – Ich bin in Rente - ich muss gar nichts! – angelegt wie „+ Neues Lied“ (Gerüst mit 4 Takten,
  G-Dur, Tempo 114 laut Leadsheet). Es gab keine GP-Datei, nur das Leadsheet.

-> das ist ok.

## Namen prüfen (✅ erledigt)

Übernommen wie in der GP-Datei; die übliche Schreibweise weicht ab.

- [x] The Animals – House Of Rising Sun (üblich: „The House of the Rising Sun“) -> Nein, ist korrekt so
- [x] Die Ärzte – Ich weiss nicht (ob es Liebe ist) (Original: „Ich weiß nicht (ob es Liebe ist)“)
- [x] John Lennon – Happy Xmas War is Over (üblich: „Happy Xmas (War Is Over)“)

## Quelle für Guitar Pro prüfen (✅ erledigt)

- [x] Bruce Springsteen – This Land Is Your Land – der UG-Link zeigt auf die Fassung von Woody Guthrie (passt zur Datei
  unter `Upload/`, im Gitarrenbuch steht das Lied aber unter Bruce Springsteen). -> Das is ok, von Springsteen gibt es keine GP-Datei.
- [x] Traditional – Easy Slow Delta Blues – der Link zeigt auf eine Lektion vom Blues Guitar Institute. -> das ist ok.

## Zwei Ultimate-Guitar-Links in den Notizen (✅ erledigt)

Als Quelle wurde jeweils der erste Link übernommen. Der zweite steht weiter in den Notizen.

| Lied                                        | Übernommen (Quelle)                                              | Zweiter Link (nur Notizen)                                      |
|---------------------------------------------|------------------------------------------------------------------|-----------------------------------------------------------------|
| Bob Dylan – Blowin' In The Wind             | `tab/bob-dylan/blowin-in-the-wind-official-2077645`              | `tab/bob-dylan/blowin-in-the-wind-chords-14835`                 |
| Bob Marley – No Woman No Cry                | `tab/bob-marley/no-woman-no-cry-official-1920907`                | `tab/bob-marley/no-woman-no-cry-guitar-pro-1520306`             |
| Bob Marley – Three Little Birds             | `tab/bob-marley/three-little-birds-official-2072761`             | `tab/bob-marley/three-little-birds-tabs-3713126`                |
| Bruce Springsteen – This Land Is Your Land  | `tab/woody-guthrie/this-land-is-your-land-official-2777410`      | `tab/bruce-springsteen/this-land-is-your-land-chords-671502`    |
| Die Ärzte – Junge                           | `tab/2097451`                                                    | `tab/751634`                                                    |
| Ludwig van Beethoven – Für Elise            | `tab/2484503`                                                    | `tab/100626`                                                    |
| Marius Müller-Westernhagen – Dicke          | `tab/77147`                                                      | `tab/1997337`                                                   |
| Traditional – Drunken Sailor                | `tab/misc-traditional/drunken-sailor-official-2812862`           | `tab/misc-traditional/drunken-sailor-guitar-pro-669922`         |

Alle Links beginnen mit `https://tabs.ultimate-guitar.com/`.

## Ohne Quelle für Guitar Pro (✅ erledigt)

In den Notizen stand kein Ultimate-Guitar-Link.

- [X] Frank Rohlfing – Ich bin in Rente - ich muss gar nichts! (eigenes Lied, braucht keine) -> hierzu gibt es keine GP-Datei bei UG
- [x] Ganz Schön Feist – Du willst immer nur ficken -> nachgetragen und runtergeladen (ptb-Datei ersetzt)
- [X] John Lennon – Happy Xmas War is Over -> nachgetragen und runtergeladen
- [x] M.L.M.S.C. – Fröhliche Weihnacht -> gibt es nicht bei UG
- [x] Traditional – Adeste Fideles -> hatte ich selbst erstellt 
- [x] Traditional – Amarillo -> hatte ich selbst erstellt
- [x] Traditional – Beginner Blues -> hatte ich selbst erstellt
- [x] Traditional – Kol Dodie -> hatte ich selbst erstellt
- [x] Traditional – Kommet ihr Hirten -> nachgetragen und runtergeladen
- [x] Traditional – Stille Nacht -> nachgetragen und runtergeladen
- [x] Unheilig – Geboren um zu leben -> hatte ich aus PDS manuell übertragen

## YouTube-Quelle (✅ erledigt)

Stand 27.10.2026 ist bei allen 31 Liedern mit Audio eine YouTube-URL samt Clip-Länge eingetragen.

## Clip weicht von der Audiospur ab (✅ erledigt)

Verglichen wurde die Länge des YouTube-Clips mit der von `audio.mp3`. YouTube nennt die Länge nur in ganzen
Sekunden, eine Abweichung bis 1 Sekunde ist deshalb normal. Gleiche Länge heißt nicht sicher gleiche Audiospur, ist
aber ein guter Hinweis. Bei 29 Liedern passt es, abweichend sind:

| Lied                                  | Clip |  MP3 | Abweichung | Bemerkung                                         |
|---------------------------------------|-----:|-----:|-----------:|---------------------------------------------------|
| John Lennon – Happy Xmas War is Over  | 3:33 | 3:35 |     −2,7 s | bekannt: Stille am Ende fehlt im Clip (s. unten)  |
| Die Ärzte – Junge                     | 3:36 | 3:37 |     −1,4 s | geprüft: richtiger Clip                           |

- [x] **Junge:** Clip ist der richtige.

## Audio neu extrahieren (✅ erledigt)

- [ ] John Lennon – Happy Xmas War is Over – `audio.mp3` stammt aus der GP-Datei und wurde damals über notmp3.com
  geholt („Ultimate Mix“). Darin stecken das YouTube-Vorschaubild als Cover, ein Titel und der Kommentar
  `https://notmp3.com`. Neu extrahieren aus dem YouTube-Clip, der 2 Sekunden kürzer ist (Stille am Ende entfernt).
  Die Sync-Punkte bleiben gültig, solange der Clip am Anfang gleich beginnt: Sie zählen ab Beginn der Audiospur, und
  der letzte liegt bei 3:23, also vor dem Ende des neuen Clips (rund 3:33). Beginnt der Clip früher oder später,
  müssen alle Sync-Punkte um diese Zeit verschoben werden.

## Tempo passt nicht zur Audiospur (✅ erledigt)

Erledigt am 28.10.2026: Alle Tempoangaben dieser Lieder sind mit dem gemessenen Faktor multipliziert und auf ganze
Zahlen gerundet (auch Tempowechsel, z. B. Stairway To Heaven und House Of Rising Sun). Die vorherigen Noten liegen
in `data/backup/<slug>/score-vor-tempo-korrektur.atex`. Die Spalte „notiert“ zeigt den alten Wert.

Die Kopfzeile des Songs zeigt das rot: „105 BPM (⚠ Audio: 211 BPM)“. Gemessen wird vom ersten bis zum
letzten Sync-Punkt (mit allen Tempowechseln) und auf eine ganze Zahl gerundet; markiert ist jeder Song, bei dem ein
anderes ganzzahliges Tempo besser passt. Korrigiert wird später im Editor mit „Tempo an der Audiospur anpassen“.
Sortiert nach der Abweichung, die größte zuerst.

| Lied                                            | notiert | Audiospur | Bemerkung                                          |
|-------------------------------------------------|--------:|----------:|----------------------------------------------------|
| Die Ärzte – Junge                               |     105 |       211 | Achtel zu Vierteln gemacht, Tempo nicht verdoppelt |
| Bob Dylan – Blowin' In The Wind                 |     348 |       178 | vermutlich umgekehrt: Tempo doppelt                |
| Die Ärzte – Manchmal haben Frauen               |     105 |       117 |                                                    |
| The Animals – House Of Rising Sun               |     115 |       125 |                                                    |
| Marius Müller-Westernhagen – Dicke              |      62 |        66 |                                                    |
| Johnny Cash – Ring Of Fire                      |     207 |       209 |                                                    |
| John Lennon – Happy Xmas War is Over            |     100 |        98 |                                                    |
| Led Zeppelin – Stairway To Heaven               |     140 |       142 |                                                    |
| Bob Dylan – Knockin' On Heaven's Door           |     140 |       141 |                                                    |
| Bob Marley – Redemption Song                    |     117 |       116 |                                                    |
| Die Ärzte – Ich weiss nicht (ob es Liebe ist)   |      92 |        91 |                                                    |
| Marius Müller-Westernhagen – Johnny Walker      |     150 |       151 |                                                    |
| Pink Floyd – Wish You Were Here                 |     120 |       121 |                                                    |
| R.E.M. – Losing My Religion                     |     126 |       125 |                                                    |
| The Beach Boys – Sloop John B                   |   125,6 |       126 | Kommazahl                                          |
| The Cranberries – Zombie                        |      83 |        84 |                                                    |


## Längen prüfen ❌

Gemessen am 27.10.2026, so wie sie im Formular „Song bearbeiten“ neben den Quellen stehen. „Noten“ ist die
Spieldauer im eigenen Tempo, „Sync-Ende“ die Stelle in der Audiospur, an der die Noten laut Sync-Punkten enden.
Kleine Unterschiede zur MP3 (Ein- und Ausklingen) sind normal. Aufgeführt sind Abweichungen ab 10 Sekunden.

| Lied                                           | Noten | Sync-Ende |  MP3 | Auffällig                                |
|------------------------------------------------|------:|----------:|-----:|------------------------------------------|
| Die Ärzte – Junge                              |  6:05 |      3:11 | 3:37 | Noten fast doppelt so lang wie Audiospur |
| Bob Dylan – Blowin' In The Wind                |  1:23 |      2:44 | 2:50 | Noten nur halb so lang wie Audiospur     |
| R.E.M. – Losing My Religion                    |  4:23 |      4:42 | 4:54 | MP3 31 s länger                          |
| Pink Floyd – Wish You Were Here                |  5:06 |      5:19 | 5:34 | MP3 29 s länger                          |
| The Animals – House Of Rising Sun              |  4:32 |      4:09 | 4:08 | Noten 24 s länger                        |
| John Lennon – Happy Xmas War is Over           |  3:16 |      3:23 | 3:35 | MP3 19 s länger                          |
| Marius Müller-Westernhagen – Dicke             |  4:23 |      4:07 | 4:09 | Noten 14 s länger                        |
| Unheilig – Geboren um zu leben                 |  3:43 |      3:44 | 3:56 | MP3 14 s länger (Sync endet früh)        |
| Marius Müller-Westernhagen – Johnny Walker     |  3:15 |      3:23 | 3:28 | MP3 13 s länger                          |
| Bob Marley – Redemption Song                   |  3:43 |      3:46 | 3:55 | MP3 12 s länger (Sync endet früh)        |

- [x] **Junge:** Die Noten dauern 6:05, die MP3 nur 3:37, und die Sync-Punkte enden schon bei 3:11. Geklärt: Die
  Noten stehen auf Tempo 105, die Audiospur läuft laut Sync-Punkt mit rund 211 BPM (in der GP-Datei `OriginalTempo`
  105, `ModifiedTempo` 210,95). Das Lied ist im halben Tempo notiert; die Sync-Punkte gleichen das aus.
- [ ] **Blowin' In The Wind:** Die Noten decken nur 1:23 ab; die Sync-Punkte strecken sie auf die ganze Audiospur.
  Vermutlich fehlen Strophen oder Wiederholungen.
- [ ] Die übrigen Lieder der Tabelle kurz anhören, ob Intro, Outro oder Wiederholungen in den Noten fehlen.

## Sync-Punkte an die YouTube-Spur anpassen ❌

Die neuen `audio.mp3` (von YouTube) beginnen nicht genau dort, wo die bisherige Spur aus der GP-Datei begann. Um
diesen Versatz müssen alle Sync-Punkte in `score.atex` verschoben werden (negativ: Audio früher). „Gemessen“ ist
ein Vergleich der beiden Spuren und nur ein Startwert: Bei Three Little Birds und Geboren um zu leben lag die
Messung genau um das Doppelte daneben, bei Junge und Fröhliche Weihnacht passt 0. Maßgeblich ist das Gehör: In der
App unter Zahnrad → Lautstärke den „Audio-Versatz“ einstellen (vorübergehend, bis zum Sync-Editor), bis Synth und
Audiospur zusammen klingen, und den Wert unter „nach Gehör“ eintragen. Sortiert nach dem gemessenen Versatz, der größte zuerst.

| Lied                                            | gemessen | nach Gehör      |
|-------------------------------------------------|---------:|-----------------|
| Bob Marley – Three Little Birds                 |  −456 ms | −228 ms         |
| Unheilig – Geboren um zu leben                  |  −321 ms | −160 ms         |
| The Beach Boys – Sloop John B                   |  −213 ms | −213 ms         |
| Ben E. King – Stand By Me                       |  −141 ms |                 |
| Bob Marley – Redemption Song                    |  −141 ms |                 |
| Johnny Cash – Ring Of Fire                      |  −141 ms |                 |
| The Cranberries – Zombie                        |  −141 ms |                 |
| U2 – With Or Without You                        |  −141 ms |                 |
| Die Ärzte – Manchmal haben Frauen               |  −137 ms |                 |
| Pink Floyd – Wish You Were Here                 |  −133 ms |                 |
| John Lennon – Happy Xmas War is Over            |  +124 ms | +124 ms         |
| Die Ärzte – Junge                               |  −117 ms | 0 ms            |
| M.L.M.S.C. – Fröhliche Weihnacht                |  −100 ms | 0 ms            |
| Bob Dylan – Knockin' On Heaven's Door           |   −49 ms |                 |
| Bob Dylan – Blowin' In The Wind                 |   −36 ms |                 |
| Bob Marley – No Woman No Cry                    |   −36 ms |                 |
| Bruce Springsteen – This Land Is Your Land      |   −36 ms |                 |
| Chris Stapleton – Tennessee Whiskey             |   −36 ms |                 |
| Die Ärzte – Ich weiss nicht (ob es Liebe ist)   |   −36 ms |                 |
| Die Ärzte – Schlaflied                          |   −36 ms |                 |
| Die Feisten – Nussschüsselblues                 |   −36 ms |                 |
| Die Toten Hosen – Alles aus Liebe               |   −36 ms | 0 ms (passt so) |
| Ganz Schön Feist – Du willst immer nur ficken   |   −36 ms |                 |
| Hannes Wader – Kokain                           |   −36 ms |                 |
| Led Zeppelin – Stairway To Heaven               |   −36 ms |                 |
| Marius Müller-Westernhagen – Dicke              |   −36 ms |                 |
| Marius Müller-Westernhagen – Geiler is schon    |   −36 ms |                 |
| Marius Müller-Westernhagen – Johnny Walker      |   −36 ms |                 |
| The Animals – House Of Rising Sun               |   −36 ms |                 |
| R.E.M. – Losing My Religion                     |   +25 ms |                 |
| Snow Patrol – Chasing Cars                      |   −18 ms |                 |

- [ ] Alle Lieder nach Gehör prüfen; danach verschiebe ich die Sync-Punkte (vorher wird `score.atex` gesichert).

## Sync-Punkte passen nicht zur Audiospur (4 ❌)

Die Kopfzeile zeigt das rot: „(⚠ Sync-Punkte passen nicht zur Audiospur)“, wenn der letzte Sync-Punkt hinter dem Ende
der Audiospur liegt. Ein negativer erster Sync-Punkt ist gewollt (Takt 1 beginnt vor der Aufnahme) und wird nicht
gemeldet.

- [ ] Die Ärzte – Junge: Der letzte Sync-Punkt muss ganz leicht korrigiert werden: Das Audio kommt in Takt 158 minimal zu früh.
- [ ] Bob Dylan – Knockin' On Heaven's Door: letzter Sync-Punkt 2,5 s hinter dem Ende der Audiospur.
- [ ] Die Ärzte – Ich weiss nicht (ob es Liebe ist): letzter Sync-Punkt 0,7 s hinter dem Ende.
- [ ] The Animals – House Of Rising Sun: letzter Sync-Punkt 0,6 s hinter dem Ende.
