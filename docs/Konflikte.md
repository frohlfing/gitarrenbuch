# Konflikte

Ein **Konflikt** ist eine Abweichung der Noten von der Form, die das Gitarrenbuch erwartet (eine Stelle je Information,
Song von oben nach unten, ein Capo und ein Tuning für alle Spuren …). Ein Song hat keine Konflikte: Der Import löst sie
ohne Rückfrage (`resolveConflicts()` in `public/js/conflicts.js`, siehe "Konfliktlöser: die Regeln"), und beim
Bearbeiten entstehen keine (siehe "Konflikte durch Bearbeiten"). Eine Anzeige von Konflikten gibt es deshalb nirgends, weder in der Übersicht noch im Song oder im Editor.

## Übersicht

| Nr. | Konflikt                                     | Lösung (Konfliktlöser)                                                     |
|-----|----------------------------------------------|----------------------------------------------------------------------------|
| 1   | Song läuft nicht von oben nach unten durch   | ausschreiben                                                               |
| 2   | Capo ungleich                                | kleinster Capo für alle, die anderen umgerechnet                           |
| 3   | Tuning ungleich                              | tiefstes Tuning für alle, die anderen umgerechnet                          |
| 4   | Triolen-Feeling, das nicht Shuffle ist       | Achtel-Varianten werden Shuffle, Sechzehntel-Varianten fallen weg          |
| 5   | Akkorde stehen auch außerhalb der Akkordspur | in die Akkordspur; an derselben Stelle gewinnt die Akkordspur              |
| 6   | Liedtext steht auch außerhalb der Textspur   | entfernt; abweichender Text als Chord-Datei in den Upload-Ordner           |
| 7   | Unbekannte Akkordnamen                       | Name aus dem Griff, sonst vereinfacht, sonst entfernt                      |
| 10  | Der Griff passt nicht zum Namen              | der Name gewinnt, Griff = erster Vorschlag der Griffsuche                  |

## 1. Song läuft nicht von oben nach unten durch

- **Was:** Wiederholungszeichen, Volta-Klammern, Sprungzeichen (D.C., D.S., D.S.S., Coda, Fine) oder
  Takt-Wiederholungszeichen (Simile); `playOrder()` in `notation.js` ergibt eine andere Folge als die der Takte.
- **Warum ein Konflikt:** Im Gitarrenbuch steht jeder gespielte Takt genau einmal da. Sonst sind Takt, Silbe,
  Akkord und Sync-Punkt nicht eindeutig.
- **Lösung:** `unrollRepeats()` in `notation.js`: Jeder Takt steht so oft da, wie er gespielt wird, die Zeichen fallen
  weg. Der Liedtext mehrerer Strophen an einem mehrfach gespielten Takt verteilt sich auf die Durchgänge, Sync-Punkte
  kommen an ihren Durchgang.

## 2. Capo ungleich

- **Was:** Die Spuren mit Saiten (`stringedStaves()`) haben nicht alle denselben Capo.
- **Warum ein Konflikt:** Akkordnamen und Leadsheet gehen von einem Capo aus.
- **Lösung:** der kleinste Capo aller Spuren; die anderen werden umgerechnet (`moveToCapo()`), sie klingen gleich.
  Noten, die unter dem Capo lägen, kommen auf eine andere Saite oder eine Oktave höher (Datenverlust, im Protokoll).

## 3. Tuning ungleich

- **Was:** Die Spuren mit so vielen Saiten wie die Akkordspur (`tuningStaves()`) sind verschieden gestimmt
  (`sameTuning()`). Spuren mit anderer Saitenzahl (Bass) zählen nicht.
- **Warum ein Konflikt:** Ein Song hat ein Tuning (Anzeige in der Leiste, Dialog "Transponieren", Kopf des Blatts).
- **Lösung:** das tiefste Tuning, das eine Spur verwendet; die anderen werden auf derselben Saite umgerechnet
  (`setTuning(…, true)`) und klingen gleich. Noten, deren Bund unter 0 oder über 24 läge, bleiben stehen
  (Datenverlust, im Protokoll).

## 4. Triolen-Feeling, das nicht Shuffle ist

- **Was:** Ein Takt hat ein Triolen-Feeling außer "kein" und "Achtel-Triolen" (`TRIPLET_FEELS` in `notation.js`).
- **Warum ein Konflikt:** Das Gitarrenbuch kennt nur Shuffle (Knopf in der Leiste, Strg+/).
- **Lösung:** punktierte Achtel und Scottish (Achtel) werden Shuffle, die Sechzehntel-Varianten fallen weg; die Noten
  bleiben, wie sie sind.

## 5. Akkorde stehen auch außerhalb der Akkordspur

- **Was:** Die Akkordspur ist die mit den meisten Akkorden (`chordsTrack()`); eine andere Spur hat auch Akkorde.
- **Warum ein Konflikt:** Jede Information steht an einer Stelle.
- **Lösung:** `moveContent()` in `notation.js` (Modus "insert"): Alle Akkorde ziehen in die Akkordspur; fehlt dort an
  der Stelle ein Schlag, wird der klingende geteilt und angebunden (klingt gleich). Zwei verschiedene Akkorde an
  derselben Stelle: Die Akkordspur gewinnt, der andere fällt weg (Datenverlust, im Protokoll mit Takt und Namen).

## 6. Liedtext steht auch außerhalb der Textspur

- **Was:** Die Textspur ist die mit den meisten Silben (`lyricsTrack()`); eine andere Spur hat auch Silben.
- **Warum ein Konflikt:** wie bei den Akkorden; das Panel "Liedtext" bearbeitet nur die Textspur.
- **Lösung:** Nur die Textspur behält ihren Text. Der Text jeder anderen Spur wird Wort für Wort mit ihm verglichen
  (ohne Trennstriche, Satzzeichen, Groß- und Kleinschreibung; Anteil gleicher Wörter über die längste gemeinsame
  Folge). Mindestens 90 % gleich (dieselben Strophen, nur in einem anderen Rhythmus, z. B. "Christmas" auf den Schlägen
  der Gitarre und "Christ-ma-s" auf denen der Melodie): Er fällt einfach weg. Weniger: Er fällt ebenfalls weg und kommt
  als ganzer Text der Spur als Chord-Datei in den Upload-Ordner (Datenverlust in den Noten, im Protokoll); übernehmen
  lässt er sich mit "Chord-Datei importieren". Silben in Lücken der Textspur zu setzen, taugt nicht: Aus einem anderen
  Rhythmus stünden sie dort doppelt oder verrutscht.

## 7. Unbekannte Akkordnamen

- **Was:** `parseChord()` in `chordtheory.js` kann den Namen nicht lesen (Regeln in `docs/Musiktheorie.md`).
- **Warum ein Konflikt:** Ohne gelesenen Namen gibt es keine Töne: kein berechneter Griff, kein Transponieren des
  Namens, keine Prüfung des Griffs, keine Tonart-Erkennung aus diesem Akkord.
- **Lösung:** mit Griff (mindestens drei Saiten) der Name aus dem Griff (`nameGrip()`), sonst vereinfacht
  (`simplifyChord()`: "Dsus2/4" → "Dsus2"); bleibt er unbekannt ("N.C."), fällt der Akkord weg (Datenverlust).

## 8. Der Griff passt nicht zum Namen

- **Was:** Für jeden Akkord mit mindestens drei gespielten Saiten: `gripToneProblem()` in `chordgrips.js` (die Töne
  des Griffs sind andere als die des Namens, im Tuning der Spur).
- **Warum ein Konflikt:** Griffbild und Name widersprechen sich auf dem Blatt; der Akkordkatalog lernt den falschen
  Griff.
- **Lösung:** Der Name gewinnt, der Griff wird der erste Vorschlag der Griffsuche (`findGrips()`). Die Noten ändern
  sich nicht, nur das Griffbild.

## Konflikte durch den Import

Die Konflikte kommen aus Guitar-Pro-Dateien. Ziel: Ein Song hat nie Konflikte. Der Import löst sie deshalb selbst, ohne
Rückfrage (Konfliktlöser, siehe unten).

### Guitar-Pro-Import (neuer Song)

Ablauf: Der Browser liest die Datei mit alphaTab (`readGpFile()` in `notation.js`), bereinigt sie
(`cleanImportedScore()`), löst die Konflikte (`resolveConflicts()` in `conflicts.js`), schreibt sie als alphaTex und
prüft das Ergebnis (`exportScore()`); der Server legt den Song an (`api/import.php`).

**Bereinigt** (Formales, vor dem Konfliktlöser):

| In der Datei                                                                    | Beim Import                                                                                                                                                    |
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

**Typisch für Guitar-Pro-Dateien** (warum die Konflikte entstehen):

| Nr. | Konflikt                                   | Typisch, weil …                                                                 |
|-----|--------------------------------------------|---------------------------------------------------------------------------------|
| 1   | Song läuft nicht von oben nach unten durch | GP-Dateien sparen Platz mit Wiederholungen, Volta-Klammern und D.S./Coda        |
| 2   | Capo ungleich                              | Guitar Pro hat den Capo je Spur; Gesang oder Bass oft ohne                      |
| 3   | Tuning ungleich                            | Spuren aus verschiedenen Quellen, z. B. eine Gitarre einen Halbton tiefer       |
| 4   | Triolen-Feeling, das nicht Shuffle ist     | GP5 kennt auch Sechzehntel-Triolen, GP6 bis GP8 dazu punktiert und Scottish (Achtel und Sechzehntel); GP3/GP4 nur Achtel-Triolen (im alphaTab-Importer nachgesehen) |
| 5   | Akkorde auch außerhalb der Akkordspur      | Akkorde stehen in GP oft an mehreren Spuren (Gitarre, Gesang)                   |
| 6   | Liedtext auch außerhalb der Textspur       | Text an einer Gitarrenspur und an der Gesangsspur                               |
| 7   | Unbekannte Akkordnamen                     | freie Namen aus Guitar Pro ("N.C.", "Dsus2/4", "Em/", Tippfehler)               |
| 10  | Der Griff passt nicht zum Namen            | Griffbilder in GP sind frei gezeichnet und oft falsch benannt                   |
| –   | Takte mit falscher Länge                   | GP erlaubt unvollständige Takte                                                 |

### Konfliktlöser: die Regeln

`resolveConflicts()` in `public/js/conflicts.js`, beim Import und für die vorhandenen Songs. Begriffe: **Akkordspur** ist
die Spur mit den meisten Akkorden (`chordsTrack()`), **Textspur** die mit den meisten Silben (`lyricsTrack()`). Die
Schritte in dieser Reihenfolge:

| Schritt | Konflikt                          | Regel                                                                                                                                                                  |
|---------|-----------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1       | Wiederholungen und Sprünge (1)    | ausschreiben (`unrollRepeats()`): jeder Takt so oft, wie er gespielt wird; Text mehrerer Strophen und Sync-Punkte auf die Durchgänge verteilt                          |
| 2       | Takte mit falscher Länge          | zu kurz: am Ende mit Pausen auffüllen; zu lang: von hinten den letzten Schlag verkürzen, notfalls Schläge löschen (und die Lücke mit Pausen füllen)                    |
| 3       | Triolen-Feeling (4)               | punktierte Achtel und Scottish (Achtel) werden Shuffle (Achtel-Triolen); Sechzehntel-Triolen, punktierte Sechzehntel und Scottish (Sechzehntel) fallen weg             |
| 4       | Tuning in falscher Oktave         | liegt das Tuning eine oder mehrere Oktaven neben der üblichen Lage (Gitarre um E2, Bass um E1; Grenze: tiefe Saite mehr als eine Quinte daneben), wird es um die Oktaven verschoben (`normalizeTuningOctave()`); die Bünde bleiben, der Klang wandert mit (Datenverlust). Das ist der Oktav-Trick aus Guitar Pro |
| 5       | Instrument und Notenlage          | jede Spur bekommt ihr Instrument aus der festen Liste (`instrumentOf()`, `docs/Instrumente.md`) mit dessen Klang und Notenlage; weder ein anderer Klang noch eine andere Notenlage ist Datenverlust (Noten, Tabs und Akkorde bleiben) |
| 6       | Capo ungleich (2)                 | der kleinste Capo aller Spuren mit Saiten; die anderen werden umgerechnet (`moveToCapo()`, klingt gleich, kein Bund rutscht unter 0)                                    |
| 7       | Tuning ungleich (3)               | das tiefste Tuning, das eine Spur verwendet (kleinste Summe der Tonhöhen), unter den Spuren mit so vielen Saiten wie die Akkordspur; die anderen werden umgerechnet (`setTuning(…, true)`, klingt gleich) |
| 8       | Akkorde außerhalb der Akkordspur (5) | in die Akkordspur (`moveContent()`, Modus "insert": fehlt dort ein Schlag, wird der klingende geteilt und angebunden, klingt gleich); zwei verschiedene Akkorde an derselben Stelle: die Akkordspur gewinnt |
| 9       | Liedtext außerhalb der Textspur (6) | nur die Textspur behält ihren Text; der Text anderer Spuren fällt weg. Ist er derselbe (mindestens 90 % gleiche Wörter, z. B. dieselben Strophen in einem anderen Rhythmus), ohne Weiteres; weicht er ab, kommt er als Chord-Datei in den Upload-Ordner ("<Spur> – Liedtext.txt", Datenverlust) |
| 10      | Unbekannte Akkordnamen (7)        | hat der Akkord einen Griff (mindestens drei Saiten), der Name aus dem Griff (`nameGrip()`); sonst vereinfacht (`simplifyChord()`); ist er dann noch unbekannt ("N.C."), fällt der Akkord weg |
| 11      | Griff passt nicht zum Namen (8)   | der Name gewinnt; der Griff wird der erste Vorschlag der Griffsuche (`findGrips()`, wie im Dialog "Akkord", ohne den Katalog)                                           |
| 12      | Griffbilder                       | `normalizeChords(…, true)`: eigene Griffe bleiben, fehlende kommen aus dem Katalog                                                                                     |

Der Import fragt nicht nach und speichert keinen Bericht; die Änderungen stehen nur in der Konsole, solche mit
**Datenverlust** mit "⚠" (`critical` in `conflicts.js`). Als Datenverlust gelten: zu lange Takte (letzter Schlag
verkürzt, Schläge gelöscht), geändertes Triolen-Feeling, beim Capo eine Oktave versetzte Noten, beim Tuning Noten, die
sich nicht umrechnen ließen, weggefallene Akkorde (mit Takt, Name, Herkunftsspur und dem Akkord, der bleibt, z. B. "Takt 3: Am7 aus „Guitar (Picking)“ entfällt, Am bleibt"), nicht übernommener
Liedtext und entfernte unbekannte Akkorde. Ein anderer Klang (Schritt 5) ist kein Datenverlust.

### Andere Wege, auf denen Noten hereinkommen

- **Neuer Song ohne Datei** ("+ Neues Lied", `createScore()`): eine leere Gitarrenspur mit Tempo, Tuning, Capo und Tonart
  aus dem Formular; kein Konflikt.
- **Spur aus Guitar-Pro-Datei importieren** (Dialog "Spuren", `importTrackFile()` und `importTrack()`): Die Datei wird
  wie beim Import gelesen, bereinigt und gelöst (also auch ausgeschrieben). Akkorde und Text der Spur kommen nicht mit.
  Capo, Tuning und Vorzeichen übernimmt die Spur vom Song (umgerechnet, klingt gleich), so entsteht kein Konflikt.
  Takte, deren Länge nicht zur Taktart des Songs passt, nennt die Meldung nach dem Übernehmen ("Spur „…“
  übernommen: 32 Takte; Länge passt nicht zur Taktart in Takt 5, 9"); in den Noten sind sie rot markiert, speichern
  lässt sich erst nach dem Korrigieren.
- **Chord-Datei importieren** (ChordPro oder Akkorde über dem Text, Panel "Liedtext", `insertChordFileText()`):
  Ein Akkordname bleibt, wie er ist, wenn der Katalog einen Griff für ihn hat oder die Akkorderkennung einen findet
  (`findGrips()`); das gilt für fast alle Namen, auch "D/F#", "Am7b5", "Cmaj9", "A2", "H7" oder "Bbmaj7#11". Nur Namen,
  die die Erkennung nicht lesen kann, werden direkt vereinfacht (`simplifyChord()`): ohne Basston, dann ohne
  Erweiterungen, z. B. "Dsus2/4" → "Dsus2", "Em/" → "Em", "G/B/D" → "G". Was danach immer noch unbekannt ist (ein
  Name ohne erkennbaren Grundton wie "N.C."), wird nicht übernommen; die Meldung danach nennt es ("Nicht übernommen
  (unbekannt): N.C."). Zu viel Text für die Schläge markiert das Panel rot (siehe unten).

### Akkorde in den Guitar-Pro-Dateien (Analyse vom 20.11.2026)

Alle 31 GP-Dateien in den Upload-Ordnern (`data/songs/<slug>/upload/`) mit alphaTab gelesen: 733 Akkorde in den Spuren,
60 verschiedene Namen, 25 ohne Griff (nur Name), 4 an keinem Schlag verwendet. **Alle 60 Namen erkennt `parseChord()`**;
der Parser musste für diesen Bestand nicht geschärft werden.

Namen: A, A#7M, A7sus4, Aadd9, Am, Am7, Am7M, Asus2, Asus4, Bm, Bm/F#, Bm7, Bsus2, Bsus4, C, C/D, C/E, C/G, C5, Cadd9,
Cadd9#11, Cmaj7, D, D/A, D/E, D/F#, D5, D5/E, Dadd6add9/F#, Ddim/E, Dm, Dm6add9, Dsus2, Dsus4, E, E+5/G#, E5, E5+/G#,
E7, Eadd9, Em, Em/A, Em/D, Em7, Emadd9, Esus4, F, F#, F/A, F/C, FM7, G, G#dim, G/B, G/D, G5, G6, G7, GM7/B, Gadd6.

Auffällig, aber erkannt: "M7" als maj7 ("A#7M", "Am7M", "FM7", "GM7/B"), gestapelte Erweiterungen ("Dadd6add9/F#",
"Dm6add9", "Cadd9#11"), Basstöne an Powerchords und übermäßigen Akkorden ("D5/E", "E+5/G#", "E5+/G#", "Ddim/E", "Em/A").

**Griff passt nicht zum Namen** (9, alle an einem Schlag verwendet; löst Schritt 9):

| Song                     | Name   | Griff  | klingt wie                 | Bemerkung                                  |
|--------------------------|--------|--------|----------------------------|--------------------------------------------|
| Blowin' in the Wind      | G/D    | xx0033 | Dsus4                      |                                            |
| Blowin' in the Wind      | G/D    | xx6787 | G#dimmaj7                  | wohl Lage des Griffbilds falsch gelesen    |
| Blowin' in the Wind      | G/B    | 7x6787 | G#dimmaj7/B                | wohl Lage des Griffbilds falsch gelesen    |
| Geboren um zu leben      | Em     | 0xxx52 | Esus2                      |                                            |
| Happy Xmas               | Aadd9  | x02200 | Asus2                      | Terz C# fehlt                              |
| House of the Rising Sun  | Am     | x47555 | –                          | wohl Lage des Griffbilds falsch gelesen    |
| House of the Rising Sun  | Am7M   | x36554 | Caug                       |                                            |
| Stairway to Heaven       | E5+/G# | xx6557 | Cmaj7#5/Ab                 |                                            |
| Stairway to Heaven       | FM7    | xx321x | F                          | Septime E fehlt                            |

Bei den Griffen um den 6. bis 7. Bund liest alphaTab die Startposition (firstFret) der GPX-Griffbilder womöglich nicht
richtig; für den Import ist das gleich, Schritt 9 ersetzt sie.

## Konflikte durch Bearbeiten

Im Editor entstehen keine Konflikte:

| Nr. | Im Editor …                                                                                                |
|-----|------------------------------------------------------------------------------------------------------------|
| 1   | kann man keine Wiederholungen oder Sprünge setzen                                                          |
| 2   | übernimmt "Spur hinzufügen" Capo und Tuning des Songs, "Spur aus Guitar-Pro-Datei importieren" rechnet die Spur um  |
| 3   | ebenso                                                                                                     |
| 4   | kennt der Knopf in der Leiste nur Shuffle                                                                  |
| 5   | kommen neue Akkorde immer in die Akkordspur                                                                |
| 6   | schreibt das Panel "Liedtext" immer in die Textspur                                                        |
| 7   | übernimmt "Chord-Datei importieren" unbekannte Namen nicht, der Dialog "Akkord" lässt sie nicht zu         |
| 8   | übernimmt der Dialog "Akkord" nur Griffe, die zum Namen passen                                             |

Ein Akkord am Cursor kommt immer in die Akkordspur: Beginnt dort an der Stelle kein Schlag, wird der klingende geteilt
und angebunden (`chordBeat(…, true)` in `editor.js`, klingt gleich). Nur ein älterer Stand aus dem Verlauf, der vor dem
Konfliktlöser gespeichert wurde, kann noch Konflikte haben.

## Kein Konflikt, aber verwandt

- **Tempo weicht von der Audiospur ab:** Neben dem Tempo im linken Panel steht ein rotes "!", wenn das Tempo der
  Audiospur im Abschnitt am Cursor (aus den Sync-Punkten, `recordingTempoRegion()` in `notation.js`) ein anderes ist
  als das notierte; der Tooltip nennt es ("Tempo der Audiospur ab Takt 1 bis 42: 177 BPM"). Angepasst wird im Sync-Editor.
  Weil man das "!" nur am Takt des Cursors sieht, steht ein zweites am Label "Audio" des unteren Panels, sobald irgendwo
  ein Abschnitt abweicht: Der Tooltip listet alle ("Takt 116–117: notiert 153, Audiospur 156 BPM"), ein Klick setzt den
  Cursor (und die Abspielposition) auf den ersten (`showTempoMismatches()`, `gotoTempoMismatch()` in `editor.js`). Die
  Abschnitte reichen von einem notierten Tempowechsel zum nächsten, nicht von Sync-Punkt zu Sync-Punkt: Gefragt ist, ob
  die notierte Zahl im Mittel zur Aufnahme passt; je Sync-Punkt ein eigenes Tempo wäre nur Rauschen.
- **Tonart weicht von der erkannten ab:** Erkennt `detectKeySignature()` in `base.js` aus Akkorden (klingend, mit Capo)
  und gespielten Tönen eine andere Tonart als die notierte, steht neben dem Feld "Tonart" in der Leiste ein rotes "!",
  der Tooltip nennt die erkannte. Kein Konflikt, weil die notierte Tonart nicht zu allen Akkorden passen muss:
  Zwischendominanten (D7 in C), entlehnte Akkorde (Bb in C), Blues (A7, D7, E7 in A), die Dur-Dominante in Moll
  (E in a-Moll), modale Songs (D – C – G in D-Mixolydisch), Rückungen. Die Erkennung ist eine Schätzung (Tonleiter,
  die am besten passt; Grundton ist der Schlussakkord, wenn dessen Tonart kaum schlechter passt). Sie hilft vor allem
  bei GP-Dateien ganz ohne Vorzeichen. Geändert wird die Tonart im Feld; im Dialog "Transponieren" wandert sie von der
  notierten aus.

- **Takt zu lang/kurz:** Takte, deren Schläge nicht zur Taktart passen, markiert der Editor in den Noten (rote Fläche,
  Zeichen oben links mit Tooltip, `barLengthProblems()` in `notation.js`); am Cursor sagt es die Statuszeile unten.
  Sie stehen nicht in der Liste, weil sie zur Stelle gehören und mit den Notenwerten gelöst werden. Gespeichert
  werden sie aber nicht: Gibt es solche Takte, öffnet "Speichern" (auch Strg+S und "Ja, speichern" beim Beenden) statt
  zu speichern den Dialog "Speichern nicht möglich" mit den Takten, einem Knopf zum ersten davon und "Abbrechen"
  (`refuseSave()` in `editor.js`). Gilt nur, wenn sich die Noten geändert haben; Angaben fürs Leadsheet allein werden
  gespeichert. Entstehen können sie beim Bearbeiten (Notenwert, Punktierung, Triole, Schlag einfügen oder löschen,
  Taktart ändern) und mit "Spur aus Guitar-Pro-Datei importieren", wenn die Taktart des Songs eine andere ist; der
  Import selbst korrigiert sie (Konfliktlöser, Schritt 2).
- **Liedtext zu lang:** Silben ohne Schlag markiert das Panel "Liedtext" rot (Tooltip mit der Zahl je Abschnitt).
