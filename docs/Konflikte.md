# Konflikte im Bearbeitungsmodus

Ein **Konflikt** ist eine Abweichung der Noten von der Form, die das Gitarrenbuch erwartet (eine Stelle je Information,
Song von oben nach unten, ein Capo und ein Tuning für alle Spuren …). Der Editor prüft nach jeder Änderung
(`renderConflicts()` in `public/js/editor.js`). Gibt es Konflikte, steht rechts in der Werkzeugleiste ein roter Knopf
"⚠ 2 Konflikte"; er klappt die Liste auf. Jede Zeile nennt den Konflikt, meist mit einem Knopf, der ihn löst. Lösen ist
ein Schritt für "Rückgängig" (Strg+Z) und wird erst mit "Speichern" dauerhaft. Die Liste bleibt offen, bis man den
Knopf wieder drückt oder alle Konflikte gelöst sind.

Diese Datei ist die Vorbereitung für die Überarbeitung von Anzeige und Lösung. Die Reihenfolge der Abschnitte ist die
Reihenfolge in der Liste.

## Übersicht

| Nr. | Konflikt                                     | Knopf (Befehl)                                       | Lösung ändert             |
|-----|----------------------------------------------|------------------------------------------------------|---------------------------|
| 1   | Song läuft nicht von oben nach unten durch   | Wiederholungen und Sprünge ausschreiben (`unroll`)   | Takte, Leadsheet-Stellen  |
| 2   | Capo ungleich                                | Capo angleichen (`unifyCapo`)                        | Capo, Bünde               |
| 3   | Tuning ungleich                              | Tuning angleichen (`unifyTuning`)                    | Tuning, Bünde             |
| 4   | Tonart: notiert X, erkannt Y                 | Tonart korrigieren (`detectKey`)                     | Vorzeichen                |
| 5   | Triolen-Feeling, das nicht Shuffle ist       | Feeling entfernen (`removeFeel`)                     | Triolen-Feeling           |
| 6   | Akkorde stehen auch außerhalb der Akkordspur | Akkorde nach „…“ übertragen (`mergeChords`)          | Akkorde, ggf. Schläge     |
| 7   | Liedtext steht auch außerhalb der Textspur   | Liedtext nach „…“ übertragen (`mergeLyrics`)         | Silben, ggf. Schläge      |
| 8   | Unbekannte Akkordnamen                       | – (Dialog "Akkord")                                  | –                         |
| 9   | Der Griff passt nicht zum Namen              | – (Dialog "Akkord")                                  | –                         |

## 1. Song läuft nicht von oben nach unten durch

- **Anzeige:** "Der Song läuft nicht von oben nach unten durch (Wiederholungen, Volta-Klammern, Sprungzeichen oder
  Wiederholungstakte)."
- **Prüfung:** `hasRepeats()` in `notation.js`: Wiederholungszeichen, Volta-Klammern, Sprungzeichen (D.C., D.S.,
  D.S.S., Coda, Fine) oder Takt-Wiederholungszeichen (Simile). Kommt fast nur nach einem Guitar-Pro-Import vor.
- **Warum ein Konflikt:** Im Gitarrenbuch steht jeder gespielte Takt genau einmal da. Sonst sind Takt, Silbe,
  Akkord und Sync-Punkt nicht eindeutig.
- **Lösung:** "Wiederholungen und Sprünge ausschreiben" (`unrollRepeats()` in `notation.js`, `unroll` im Editor):
  Jeder Takt steht danach so oft da, wie er gespielt wird, die Zeichen fallen weg. Der Liedtext mehrerer Strophen an
  einem mehrfach gespielten Takt verteilt sich auf die Durchgänge, Sync-Punkte kommen an ihren Durchgang, die
  Tab-Stellen und ersetzten Takte des Leadsheets wandern mit (`remapSheetByOrder()`).
- **Auch in der API:** `read_score_issues()` in `api/lib/crud.php` meldet Sprungzeichen (`\jump`) als "Sprungzeichen";
  die Übersicht zeigt das am Song, ohne Lösung.

## 2. Capo ungleich

- **Anzeige:** "Capo ungleich: Gitarre 2, Bass 0." (je Spur mit Saiten der Capo)
- **Prüfung:** Die Spuren mit Saiten (`stringedStaves()`) haben nicht alle denselben Capo.
- **Warum ein Konflikt:** Akkordnamen und Leadsheet gehen von einem Capo aus (auf dem Blatt steht der der Akkordspur,
  die Vorschau des Leadsheets meldet die Abweichung ebenfalls rot).
- **Lösung:** "Capo angleichen" (`unifyCapo()` in `notation.js`): Alle Spuren bekommen den Capo der Akkordspur (ohne
  Akkorde den der Spur mit den meisten Noten). Die anderen werden umgerechnet (`moveToCapo()`), sie klingen gleich;
  Noten, die unter dem Capo lägen, kommen auf eine andere Saite oder eine Oktave höher (der Hinweis danach nennt die
  Zahl).
- **Auch in der API:** `read_score_issues()` meldet "Capo ungleich"; die Übersicht zeigt den Song mit rotem Rahmen.

## 3. Tuning ungleich

- **Anzeige:** "Tuning ungleich: Gitarre E A D G B E, Gitarre 2 D A D G B E."
- **Prüfung:** `sameTuning()` in `notation.js`: Die Spuren mit so vielen Saiten wie die Akkordspur (`tuningStaves()`)
  sind verschieden gestimmt. Spuren mit anderer Saitenzahl (Bass) zählen nicht.
- **Warum ein Konflikt:** Ein Song hat ein Tuning (Anzeige in der Leiste, Dialog "Transponieren", Kopf des Blatts).
- **Lösung:** "Tuning angleichen" (`unifyTuning`): Alle Spuren auf das Tuning der Akkordspur
  (`setTuning(…, true)`), die Noten werden auf derselben Saite umgerechnet und klingen gleich. Noten, deren Bund unter 0
  oder über 24 läge, bleiben stehen und werden gezählt (Hinweis danach).

## 4. Tonart weicht von der erkannten ab

- **Anzeige:** "Tonart: notiert C, erkannt aus Akkorden und Tönen G."
- **Prüfung:** `detectKeySignature()` in `base.js`: Aus Akkorden (klingend, mit Capo) und gespielten Tönen wird die
  Tonleiter gesucht, die am besten passt; Grundton ist der Schlussakkord, wenn dessen Tonart kaum schlechter passt.
  Kein Konflikt, wenn die notierte passt, die Vorzeichen im Song wechseln oder es keine Akkorde gibt.
- **Warum ein Konflikt:** Viele GP-Dateien haben gar keine Vorzeichen, obwohl der Song etwa in A steht. Die Tonart
  steht auf dem Blatt und ist der Ausgangspunkt im Dialog "Transponieren".
- **Lösung:** "Tonart korrigieren" (`detectKey`): Vorzeichen im ganzen Song auf die erkannte Tonart
  (`setKeySignature(…, true)`). Die Noten klingen gleich, nur die Schreibweise (Vorzeichen) ändert sich.
- **Verwandt:** Der Dialog "Transponieren" zeigt dieselbe Erkennung als "Erkannte Tonart: … Übernehmen".

## 5. Triolen-Feeling, das nicht Shuffle ist

- **Anzeige:** "Triolen-Feeling Sechzehntel-Triolen: Vorgesehen ist nur Shuffle (Achtel-Triolen)."
- **Prüfung:** Ein Takt hat ein Triolen-Feeling außer "kein" und "Achtel-Triolen" (`TRIPLET_FEELS` in `notation.js`).
- **Warum ein Konflikt:** Das Gitarrenbuch kennt nur Shuffle (Knopf in der Leiste, Strg+/); ein anderes Feeling aus
  einem Import kann man dort nicht sehen oder ändern, der Knopf gilt dann als aus.
- **Lösung:** "Feeling entfernen" (`removeFeel`): das Triolen-Feeling im ganzen Song aus. Die Noten bleiben, wie sie
  sind; wer Shuffle will, schaltet es danach mit dem Knopf ein.

## 6. Akkorde stehen auch außerhalb der Akkordspur

- **Anzeige:** "Akkorde stehen auch außerhalb von „Gitarre“."
- **Prüfung:** Die Akkordspur ist die mit den meisten Akkorden (`chordsTrack()`); eine andere Spur hat auch Akkorde.
- **Warum ein Konflikt:** Jede Information steht an einer Stelle. Bis zur Lösung trägt der Player die Akkorde aller
  Spuren zusammen (`mergeChords()`, bei verschiedenen Akkorden an einer Stelle gewinnt die Akkordspur).
- **Lösung:** "Akkorde nach „Gitarre“ übertragen" (`mergeChords` → `moveContentTo('chords', …)`): Alle Akkorde ziehen
  in die Akkordspur (`moveContent()` in `notation.js`). Probehalber gerechnet: Ändert sich nichts an der Lage und fällt
  nichts weg, geschieht es ohne Rückfrage; sonst fragt ein Dialog, ob Schläge eingefügt (geteilt und angebunden, klingt
  gleich) oder Akkorde auf den Schlag davor gesetzt werden. Dasselbe geschieht über die Radiobuttons "Akkorde" im
  Dialog "Spuren".

## 7. Liedtext steht auch außerhalb der Textspur

- **Anzeige:** "Liedtext stehen auch außerhalb von „Vocal“." (Wortlaut wie bei den Akkorden; sprachlich zu glätten)
- **Prüfung:** Die Textspur ist die mit den meisten Silben (`lyricsTrack()`); eine andere Spur hat auch Silben.
- **Warum ein Konflikt:** wie bei den Akkorden; das Panel "Liedtext" bearbeitet nur die Textspur.
- **Lösung:** "Liedtext nach „Vocal“ übertragen" (`mergeLyrics` → `moveContentTo('lyrics', …)`), mit derselben Rückfrage
  wie bei den Akkorden. Ebenso über die Radiobuttons "Text" im Dialog "Spuren".

## 8. Unbekannte Akkordnamen

- **Anzeige:** "Unbekannte Akkordnamen: Gsus, H7b9 …" (bis zu acht, dann die Zahl); Tooltip mit dem Grund.
- **Prüfung:** `parseChord()` in `chordtheory.js` kann den Namen nicht lesen (Regeln in `docs/Musiktheorie.md`).
- **Warum ein Konflikt:** Ohne gelesenen Namen gibt es keine Töne: kein berechneter Griff, kein Transponieren des
  Namens, keine Prüfung des Griffs, keine Tonart-Erkennung aus diesem Akkord.
- **Lösung:** kein Knopf. Den Akkord am Schlag im linken Panel wählen und im Dialog "Akkord" (✎) umbenennen; der neue
  Name gilt für alle Stellen.
- **Offen:** Ein Knopf, der zu den Stellen springt, oder ein Vorschlag (z. B. "Gsus" → "Gsus4").

## 9. Der Griff passt nicht zum Namen

- **Anzeige:** "Der Griff passt nicht zum Namen: Am (xx0232, klingt wie D)." (bis zu acht, dann die Zahl)
- **Prüfung:** Für jeden Akkord mit mindestens drei gespielten Saiten: `gripToneProblem()` in `chordgrips.js` (die Töne
  des Griffs sind andere als die des Namens, im Tuning der Spur). "klingt wie" nennt `nameGrip()`.
- **Warum ein Konflikt:** Griffbild und Name widersprechen sich auf dem Blatt; der Akkordkatalog lernt den falschen
  Griff.
- **Lösung:** kein Knopf. Im Dialog "Akkord" Name oder Griff ändern (der Dialog zeigt die passenden Griffe und warnt
  ebenfalls).
- **Offen:** Ein Knopf "Name übernehmen" (den Namen, wie er klingt) bzw. "Standardgriff nehmen".

## Konflikte durch den Import

Die meisten Konflikte kommen aus Guitar-Pro-Dateien. Der Import löst nur Formales selbst; was den Inhalt ändern würde
(Takte, Capo, Tonart, Spuren), bleibt wie in der Datei und erscheint im Editor als Konflikt. So geht beim Import nichts
verloren, was man nicht gesehen hat.

### Guitar-Pro-Import (neuer Song)

Ablauf: Der Browser liest die Datei mit alphaTab (`readGpFile()` in `notation.js`), bereinigt sie
(`cleanImportedScore()`), schreibt sie als alphaTex und prüft das Ergebnis (`exportScore()`); der Server legt den Song
an (`api/import.php`).

**Direkt gelöst** (automatisch, ohne Rückfrage):

| Konflikt in der Datei                                                           | Lösung beim Import                                                                                                                                             |
|---------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Mehrere Akkorde gleichen Namens je Spur, Bruchstücke, ausgeblendete Griffbilder | `normalizeChords()`: je Spur und Name genau ein Akkord mit Griffbild (Griff aus dem Katalog, sonst der meistgenutzte eigene), mit Barré; ungenutzte fallen weg |
| Rhythmus-Schrägstriche (Slash-Notation an Schlägen)                             | entfernt (alphaTab 1.8.4 stürzt bei Tabs mit Schrägstrichen ab)                                                                                                |
| Anzeige je Spur (nur Tabs, nur Noten, Schrägstriche, Ziffern)                   | vereinheitlicht: Noten und Tabs (Tabs nur bei Saiten); was gezeigt wird, wählt der Player                                                                      |
| Name des Tunings mit Notizen ("Key: C (orig. D)")                               | nur der Name des bekannten Tunings, sonst keiner                                                                                                               |
| Systemtrenner zwischen den Notenzeilen                                          | aus                                                                                                                                                            |
| Doppelte Taktstriche an beliebigen Stellen                                      | nur noch am Ende des Takts vor einem Abschnitt (`applySectionBars()`)                                                                                          |
| Titel, Interpret, Album, Notizen usw. in den Noten                              | nach `song.json`, in den Noten geleert (eine Stelle je Information)                                                                                            |
| Eingebettete Audiospur                                                          | wird `audio.mp3` (Server); die Sync-Punkte bleiben im alphaTex                                                                                                 |

**Mit Rückfrage:** Kann alphaTex etwas nicht abbilden, findet die Prüfung danach Abweichungen (Takt für Takt verglichen,
`fingerprint()`). Der Import-Dialog nennt die Takte ("Abweichungen in 2 Takten (Takt 12, 30)") und fragt, ob trotzdem
übernommen wird; die Originaldatei bleibt unter `upload/` erhalten.

**Bleiben als Konflikt** (im Editor zu lösen):

| Nr. | Konflikt                                   | Typisch nach dem Import, weil …                                                 |
|-----|--------------------------------------------|---------------------------------------------------------------------------------|
| 1   | Song läuft nicht von oben nach unten durch | GP-Dateien sparen Platz mit Wiederholungen, Volta-Klammern und D.S./Coda        |
| 2   | Capo ungleich                              | Guitar Pro hat den Capo je Spur; Gesang oder Bass oft ohne                      |
| 3   | Tuning ungleich                            | Spuren aus verschiedenen Quellen, z. B. eine Gitarre einen Halbton tiefer       |
| 4   | Tonart weicht von der erkannten ab         | viele GP-Dateien haben gar keine Vorzeichen (C-Dur), obwohl der Song in A steht |
| 5   | Triolen-Feeling, das nicht Shuffle ist     | Guitar Pro kennt mehrere Feelings (Sechzehntel, punktiert, Scottish)            |
| 6   | Akkorde auch außerhalb der Akkordspur      | Akkorde stehen in GP oft an mehreren Spuren (Gitarre, Gesang)                   |
| 7   | Liedtext auch außerhalb der Textspur       | Text an einer Gitarrenspur und an der Gesangsspur                               |
| 8   | Unbekannte Akkordnamen                     | freie Namen aus Guitar Pro ("Gsus", "A2", Tippfehler)                           |
| 9   | Der Griff passt nicht zum Namen            | Griffbilder in GP sind frei gezeichnet und oft falsch benannt                   |

Dazu kommen oft Takte, deren Länge nicht zur Taktart passt (markiert in den Noten, siehe unten). Die API meldet nach
dem Import nur Fall 1 (nur Sprungzeichen `\jump`) und Fall 2 in der Übersicht (`read_score_issues()`).

### Andere Wege, auf denen Noten hereinkommen

- **Neuer Song ohne Datei** ("+ Neues Lied", `createScore()`): eine leere Gitarrenspur mit Tempo, Tuning, Capo und Tonart
  aus dem Formular; kein Konflikt.
- **Spur aus Guitar-Pro-Datei importieren** (Dialog "Spuren", `importTrackFile()` und `importTrack()`): Die Datei wird
  wie beim Import gelesen und bereinigt (direkt gelöst wie oben). Akkorde und Text der Spur kommen nicht mit, also
  keine Konflikte 6 und 7. Capo und Tuning der Spur bleiben, wie sie in der Datei sind: Weichen sie ab, entstehen die
  Konflikte 2 bzw. 3. Takte, deren Länge nicht passt, nennt der Hinweis danach.
- **Chord-Datei importieren** (ChordPro oder Akkorde über dem Text, Panel "Liedtext", `insertChordFileText()`):
  Akkordnamen, die der Katalog nicht kennt, werden direkt vereinfacht (`simplifyChord()`: "D/F#" → "D", "Am7b5" →
  "Am7" → "Am"); die Griffe kommen aus dem Katalog. Ein Name, für den es auch vereinfacht nichts gibt, bleibt und wird
  Konflikt 8. Zu viel Text für die Schläge markiert das Panel rot (siehe unten).

## Kein Konflikt, aber verwandt

- **Takt zu lang/kurz:** Takte, deren Schläge nicht zur Taktart passen, markiert der Editor in den Noten (rote Fläche,
  Zeichen oben links mit Tooltip, `barLengthProblems()` in `notation.js`); am Cursor sagt es die Statuszeile unten.
  Sie stehen nicht in der Liste, weil sie zur Stelle gehören und mit den Notenwerten gelöst werden.
- **Player (außerhalb des Bearbeitungsmodus):** Der Kopf des Songs warnt, wenn das notierte Tempo nicht zur Audiospur
  passt oder Sync-Punkte außerhalb der Audiospur liegen (`describeScoreInfo()` in `notation.js`), dazu die Meldungen
  der API (Fälle 1 und 2). Gelöst wird im Sync-Editor bzw. im Bearbeitungsmodus.
- **Liedtext zu lang:** Silben ohne Schlag markiert das Panel "Liedtext" rot (Tooltip mit der Zahl je Abschnitt).
