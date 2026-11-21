# Bearbeitungsmodus

Funktionen, wo und in welcher Reihenfolge sie angezeigt werden, mit Tastenkürzel. Alle Felder und
Knöpfe sind umgesetzt; was noch fehlt, steht beim jeweiligen Punkt.

Aufteilung: In der **Werkzeugleiste** steht, was am ganzen Song hängt (Tonart, Shuffle, Capo, Tuning), dazu Speichern,
Rückgängig, Verlauf, Uploads, Transponieren, Hilfe, ✕. **Links** steht alles, was den Schlag bzw. die Note am Cursor betrifft, auch Notenwerte und
Einfügen/Löschen (wie die Palette in Guitar Pro), zuletzt vom Takt am Cursor Abschnitt, Taktart und Tempo. **Rechts**
steht der Liedtext (oben das Textfeld, darunter die Vorschau, die Linie dazwischen lässt sich ziehen), **unten** Audio
(Sync-Editor, Höhe ziehbar). Spuren und Leadsheet öffnen als Dialoge über die Knöpfe der Werkzeugleiste. Der Akkord eines Schlags wird links gewählt (Auswahlliste, "+" für einen neuen mit Griff), die Griffbilder für das Blatt im Dialog "Leadsheet". Auf schmalen Bildschirmen ist das linke Panel anfangs zu; die
Notenwerkzeuge erreicht man dann über F2 bzw. die Tastenkürzel.

Einschalten: "Bearbeiten" im Menü ⋮ der Abspielleiste, immer direkt.

**Konflikte** (Abweichungen von der Form des Gitarrenbuchs: Wiederholungen, Capo oder Tuning ungleich, Akkorde oder
Text in mehreren Spuren, unbekannte Akkordnamen, unpassende Griffe …) gibt es im Editor nicht: Der Import löst sie
(`docs/Konflikte.md`), und beim Bearbeiten entstehen keine. Ein Akkord am Cursor kommt immer in die Akkordspur; beginnt
dort an der Stelle kein Schlag, wird der klingende geteilt und angebunden (klingt gleich).

Zum Ausprobieren: Song "Test Struktur-Editor" (ungleicher Capo, Wiederholung mit Volta-Klammern, Segno, To Coda,
D.S. al Coda, Coda, D.C. al Fine, Fine; ausgeschrieben 13 → 25 Takte).

Icons: selbst gezeichnet (`public/js/base.js`) oder Zeichen der Notenschrift Bravura, die alphaTab mitbringt
(Notenwerte, Vorzeichen, Plektrum abwärts/aufwärts, Violinschlüssel). Speichern, Rückgängig, Wiederholen: Material Icons.

## Werkzeugleiste (Toolbar)

### Ansicht
Die Ansicht wählt man im Menü "Ansicht" der Leiste unten: Im Bearbeitungsmodus stehen dort nur "Tabs" und "Noten + Tabs"
("Noten" und "Chords" fehlen); Tabs sind immer zu sehen.

### Bearbeitung
- Speichern (Strg+S) – blau, solange etwas ungespeichert ist (Noten und die Angaben aus dem Dialog "Leadsheet")
- Rückgängig (Strg+Z)
- Wiederholen (Strg+Y)

### Sonstiges
- Hilfe (?) – zeigt die Tastenkürzel
- ✕ – beendet den Bearbeitungsmodus (fragt bei Ungespeichertem nach)

## Linkes Panel "Am Cursor" (F2)

Das Panel ist so breit, dass acht Knöpfe nebeneinander passen. Reihenfolge von oben: Note, Einfügen/löschen,
Tonhöhe, Anschlag, Takt, Abschnitt, Akkord, Text über dem Schlag, Liedtext-Silbe.

### Note
Erste Reihe:
- Ganze bis 32tel (+ kürzer, - länger); sind Schläge ausgewählt (Umschalt+←/→), gilt es für alle
- Triole (/)
- Pause (R)

Zweite Reihe:
- Punktiert (.)
- Doppelt punktiert (Strg+.)
- Haltebogen (L)
- Hammer-on / Pull-off (H)
- Slide (S)
- Bend (B) – hochziehen und halten; jeder Druck eine Stufe weiter: ½ → full → 1½ → kein Bend
- Vibrato (V)
- Saite dämpfen (X) (in Guitar Pro "Dead Note")

### Einfügen, löschen (Icons)
- Schlag einfügen (Einfg): eine Pause mit der Dauer des Schlags am Cursor, links neben ihm; Alt+Einfg fügt sie rechts neben ihm ein (auch am Taktende)
- Entf: löscht die Zahl (Note) am Cursor; ist der Schlag leer (Pause), den Schlag; sind Schläge ausgewählt (Umschalt+←/→), alle ausgewählten. Der letzte Schlag eines Takts bleibt als Pause. Der Button "Schlag löschen" löscht den Schlag am Cursor immer
- Takt einfügen (Strg+Einfg)
- Takt löschen (Strg+Entf)

### Tonhöhe
- Kreuz (Strg+9)
- Be (Strg+7)
- Auflösungszeichen (Strg+8)
- Halbton höher (Alt+Umschalt+↑)
- Halbton tiefer (Alt+Umschalt+↓)

### Anschlag
- Plektrum abwärts (Umschalt+D)
- Plektrum aufwärts (Umschalt+U)
- Anschlag abwärts (Strg+D) – Pfeil nach oben: abwärts geschlagen heißt von der tiefen zur hohen Saite, und die
  hohe Saite steht oben
- Anschlag aufwärts (Strg+U) – Pfeil nach unten
- Arpeggio abwärts (Strg+Umschalt+D) – Wellenlinie, Pfeil nach oben
- Arpeggio aufwärts (Strg+Umschalt+U) – Wellenlinie, Pfeil nach unten
- Betonung – Akzent (>) an allen Noten des Schlags, ein zweiter Klick nimmt ihn weg
- Ausblenden (Fade-out) – Decrescendo-Gabel; der Schlag klingt leiser werdend aus, z. B. der Schlussakkord

### Takt
- Takt – Taktart und Tempo (BPM) nebeneinander, als Werte am Takt des Cursors. Die Taktart hat eine Auswahlliste (4/4, 3/4, 2/4, 6/8,
  12/8, 2/2, 5/4, 7/8, 9/8), erweiterbar durch Eintippen. Eine Änderung gilt ab diesem Takt bis zum nächsten Wechsel; am ersten
  Takt ist das Tempo das des Songs, danach ein Tempowechsel. Ist der Wert gleich dem davor, gibt es keinen Wechsel (einen Wechsel
  entfernt man, indem man den Wert davor einträgt). Weicht das Tempo der Audiospur im Abschnitt am Cursor ab (aus den
  Sync-Punkten, `recordingTempoRegion()`), steht wie bei der Tonart ein rotes "!" daneben, Tooltip z. B. "Tempo der
  Audiospur ab Takt 1 bis 42: 177 BPM". Weicht irgendwo im Song ein Abschnitt ab, steht ein "!" auch am Label "Audio"
  des unteren Panels; der Tooltip listet alle Abschnitte, ein Klick springt zum ersten

### Abschnitt
- Abschnitt (Umschalt+Einfg) – am Takt des Cursors; Auswahlliste (Intro, Verse, Pre-Chorus, Chorus, Bridge, Solo,
  Interlude, Outro und die des Songs), erweiterbar; leer oder × entfernt ihn. Vor jedem Abschnitt steht automatisch ein
  doppelter Taktstrich (am Ende des Takts davor, `applySectionBars()` in `js/notation.js`); beim Import und nach jeder
  Änderung gilt nur diese Regel, doppelte Striche anderer Herkunft fallen weg

(Eine Tabelle je Takt gibt es nicht: Taktart, Tempo und Abschnitt stehen hier, die Randnotiz ist der Text über dem Schlag.)

### Schlag
- Akkord (A) – Auswahlliste mit den Akkorden des Songs (in der Reihenfolge ihres ersten Auftretens, je Eintrag Name und
  Griff, z. B. "D  xx0232"; "–" nimmt den Akkord weg); steht in der Akkordspur (Dialog "Spuren") am Schlag, der an
  derselben Stelle beginnt, auch wenn der Cursor in einer anderen Spur steht; beginnt dort keiner, am Schlag am Cursor
  (dann meldet der Editor Akkorde außerhalb der Akkordspur). Ein Griff wird hier nicht eingegeben.
- "+" neben der Liste (ist am Schlag ein Akkord gewählt, steht dort "✎") – Dialog "Akkord": Name, darunter die Griffe zu diesem
  Namen als Griffbilder zur Auswahl, dazu ein Feld für einen eigenen Griff (z. B. "x32010", tiefe Saite zuerst; ab Bund 10 mit
  "-" trennen). "Übernehmen" setzt den Akkord an den Schlag. "✎" öffnet denselben Dialog für den Akkord am Cursor, mit seinem
  Namen und Griff. Welche Namen und Griffe vorgeschlagen werden, wie sie geordnet sind und wann die rote Warnung erscheint, steht
  in `docs/Akkorddialog.md`.
- Ein Name hat im Song genau einen Griff (alphaTab unterscheidet Akkorde nur nach dem Namen): Ein neuer Griff gilt für
  alle Stellen und alle Spuren mit gleich vielen Saiten; setzt man einen Akkord, den eine andere Spur schon hat,
  bekommt er deren Griff. In den Katalog kommt ein Griff mit dem Speichern des Songs (der Akkordkatalog baut sich aus
  den Songs auf); eigene Griffe gehen beim Speichern dem Katalog vor

- Text über dem Schlag (T) – freier Text, z. B. "leise"; erscheint auch als Randnotiz auf dem Leadsheet
- Liedtext-Silbe (Umschalt+L) – die Silbe an der Stelle des Cursors, immer in der Textspur (wie der Akkord in der
  Akkordspur; beginnt dort kein Schlag, wird der klingende geteilt und angebunden). So kommt eine Silbe genau auf einen
  Schlag, ohne dass sich andere verschieben, z. B. auf den ersten Schlag eines Takts, der bisher keine hatte; leer
  entfernt sie. Die Silbe wird ohne Trennstrich eingetragen (z. B. "ja"). Ein
  Zeilenumbruch an der Silbe bleibt. Das Panel "Liedtext" zeigt den Text danach neu


## Werkzeugleiste: der ganze Song

- Tonart – alle 15 Dur- und 15 Moll-Tonarten (Cb bis C#, Abm bis A#m); gilt immer für den ganzen Song (die Songs im
  Gitarrenbuch wechseln die Tonart nicht). Strg+K setzt den Cursor ins Feld. Weicht die aus Akkorden und Tönen
  erkannte Tonart ab, steht ein rotes "!" daneben, der Tooltip nennt sie (kein Konflikt: die notierte muss nicht zu allen
  Akkorden passen, siehe docs/Konflikte.md)
- Shuffle – ein Knopf links neben "Transponieren", der den Zustand als Symbol zeigt (zwei Achtel = zwei gebalkte Achtel: gerade;
  zwei gebalkte Achtel = Triole aus Viertel und Achtel: Shuffle); ein Klick (oder Strg+/) schaltet um, für den ganzen Song. Mehr
  braucht das Gitarrenbuch nicht (die Songs nutzen nur Shuffle, `\tf triplet8th`); ein anderes Feeling aus einer GP-Datei löst
  der Import (`docs/Konflikte.md`)
- Capo und Tuning – rechts neben dem Knopf "Transponieren" nur als Anzeige wie im Kopf des Players ("**Capo 3** · **D**ADGBE": der Capo nur bei Capo > 0, das Tuning nur bei Abweichung vom Standard, abweichende Saiten fett); ändern lassen sie sich nur im Dialog Transponieren. Capo (alle Spuren): die Griffe bleiben (Tabs und Griffbilder ändern sich nicht, die Noten klingen um den Capo höher). Bei
  ungleichem Capo (gibt es nach dem Import nicht mehr) zeigt die Anzeige den Capo der ersten Spur
- Tuning (alle Spuren; Textfeld im Dialog), z. B. "D A D G B E"; beim Verlassen wird die Eingabe korrigiert: Großbuchstaben, Leerzeichen
  zwischen den Tönen (auch "dadgbe" geht), zu viele Töne fallen weg, fehlende und ungültige werden durch die Saiten des Standards
  ersetzt (`normalizeTuningText()` in `notation.js`). Das Standard-Tuning zeigt das Feld als "Standard"; beim Bearbeiten stehen
  die Töne da (E A D G B E). Es gilt für alle Spuren mit so vielen Saiten wie die Akkordspur; die Bünde
  bleiben, nur die Noten ändern sich (wie beim Capo). Ist das Tuning in den Spuren ungleich, ist das Feld leer, oben steht rot
  "Tuning ungleich: …" mit "Tuning angleichen" (auf die der Akkordspur, die anderen klingen gleich). Eine Spur mit anderer Saitenzahl
  (Bass) behält ihr Tuning; sie steht im Tooltip des Felds
- Verlauf (Uhr-Icon neben Rückgängig/Wiederholen) – Dialog mit den aufgehobenen Ständen (jedes Speichern hebt den vorigen
  unter `history/` auf: die Noten als `score-<Zeitstempel>.atex`, die Angaben für das Leadsheet daneben als `.json`),
  neueste zuerst, je mit Zeitpunkt, Größe, "Laden" und Papierkorb (löscht den Stand). Geladen wird in den Editor als ein
  Schritt für "Rückgängig" und noch nicht gespeichert; das Häkchen "Angaben für das Leadsheet mit laden" ist an (ohne
  bleiben die jetzigen Angaben). Importierte Noten sind kein Stand: Der Verlauf beginnt mit dem ersten Überschreiben.
- Transponieren (Icon ganz links in der Leiste) – Dialog mit Halbtönen (−12 bis +12), Capo und Tuning, Vorschau vorher/nachher
  und "Anwenden". Halbtöne schreiben Noten, Tabs (neu gegriffen, mit Blick auf Lage der Greifhand und Saiten), Akkordnamen samt
  Griffen und Vorzeichen um; Capo und Tuning ändern nur die Noten. Die Tonart wandert mit dem Klang, ein Vorschlag nennt das
  Capo mit den leichtesten Griffen, bei Klangänderung steht der Befehl `bin/audio.php --transponieren` zum Kopieren da. Ein Schritt "Rückgängig"
  nimmt es zurück. Es wird keine Verschiebung gespeichert. Die Audiospur wird dabei nicht verändert; sie lässt sich lokal mit `php bin/audio.php --only=SLUG --transponieren=N` verschieben (siehe README).

### Stammdaten
Der Dialog "Stammdaten" im Menü ⋮ (auch außerhalb des Bearbeitungsmodus), mit "Speichern" und "Abbrechen" und
"Song löschen …" (mit Rückfrage):
- Cover
- Titel
- Interpret
- Genre
- Wie gut kann ich den Song? – "Kann ich", "Übe ich gerade", "Kann ich nicht" oder nichts; dazu "Favorit". Beides
  steht auf der Kachel der Übersicht und dient dort als Filter
- Notizen

Die Quelle für die Audio-Datei (YouTube-Link, "Auf YouTube suchen", Längen von Noten, Clip und MP3) steht im unteren
Panel "Audio". Dateien mit ihrer Quelle (GP-, ChordPro-, Textdateien, PDFs) stehen im Dialog "Uploads"
(Menü ⋮); "Chord-Datei importieren" im Panel "Liedtext" und "Spur aus GuitarPro-Datei importieren" im Dialog "Spuren" wählen daraus.

Ändern sich Titel oder Interpret, ändert sich der Slug; der Editor arbeitet mit dem neuen weiter.

## Rechtes Panel "Liedtext" (F4), unteres Panel "Audio" (F8), Dialoge

Rechts steht oben das Textfeld, darunter die Vorschau "Text & Akkorde"; die Linie dazwischen lässt sich ziehen (gilt
danach für alle Songs). Die Breite des rechten Panels lässt sich am linken Rand ziehen (gilt ebenfalls für alle Songs). Beim Abspielen wandert die Silbe im Textfeld und in der Vorschau mit. Unten steht Audio; die Höhe lässt sich am oberen Rand ziehen (Voreinstellung 200 px, gilt für alle Songs), die Wellenform passt sich an. Alle Eingabefelder, Auswahllisten und Knöpfe in Dialogen sind 34 px hoch wie in den Panels (die Aktionsknöpfe unten ausgenommen). "Spuren" und "Leadsheet" öffnen als Dialoge (Knöpfe in der
Werkzeugleiste); aus dem Leadsheet gelegte Dialoge (Vergleichen, Pattern-Katalog …) liegen darüber, Schließen zeigt das
Leadsheet wieder.

### Leadsheet
Dialog der Werkzeugleiste (`sheet.js`): links die Eingaben für das Blatt, rechts die Vorschau
(`sheet.js`). Das Blatt hat Seite 1 "Spielanleitung" (Kopf mit Capo, Tuning, Tonart, Taktart, Tempo und
QR-Codes, Patterns, Griffbilder, Tabs, Spielweise, Hinweise) und Seite 2 "Text & Akkorde"; passt beides auf eine Seite,
bleibt es eine. Das Tuning steht nur da, wenn es abweicht (abweichende Saiten fett), beim
Capo die Tonart der Griffe (der Capo der Akkordspur; ist er in den Spuren ungleich, steht das rot unter der Vorschau),
bei Tempowechseln der Bereich. Gedacht sind zwei Blätter nebeneinander auf dem Notenständer.

Seite – wie das Blatt gesetzt wird, mit Kontrollkästchen ganz oben im Dialog (gespeichert mit den Angaben): "Auf 2
Seiten drucken" (Seite 1 Spielanleitung, Seite 2 Text & Akkorde; sonst alles auf einer), "Text zweispaltig", "Tabs
zusammenfassen" (Wiederholungszeichen, "Takt 81–88 zweimal"), "Griffbilder klein", "Gleiche Abschnitte nur einmal"
("Chorus – wie oben", Vorgabe an) und die Schrift (12, 11, 10 oder 9 pt). Der Generator entscheidet davon nichts
selbst. Die Vorschau zeigt das Blatt genau so; darunter steht "Passt auf zwei Seiten." oder rot, welche Seite wie
lang ist und welche Kästchen helfen, z. B. "Passt nicht: Seite 2 ist etwa 1,1 Seiten lang. Abhilfe: Text
zweispaltig, kleinere Schrift, …". Eine
gestrichelte rote Linie zeigt das Seitenende. Drucken – druckt das Blatt wie in der Vorschau, je Seite ein A4-Blatt
(im Druckdialog auch "Als PDF speichern"). Gespeichert wird in `song.json`, Feld
`leadsheet` (`api/leadsheet.php`), mit dem Speichern-Knopf; jede Änderung ist ein Schritt für Strg+Z.

Vergleichen – zwei Abschnitte wie in einem Diff-Editor. Weicht ein Vorkommen ab (z. B. der zweite Chorus hat ein
anderes Wort), steht in der Meldung unter der Vorschau "Chorus vergleichen …", das öffnet beide schon ausgewählt;
sonst lassen sich oben in den Auswahllisten beliebige zwei Abschnitte wählen. Darunter stehen nur die Takte, die sich
unterscheiden (der erste Takt des einen Abschnitts mit dem ersten des anderen usw.), je Spur links und rechts als Tab
mit Akkorden und Text; rot ist, was anders ist. → übernimmt den linken Takt nach rechts, ← den rechten nach links,
und zwar den ganzen Takt der Spur (Noten, Text, Akkorde). Weichen in einem Takt mehrere Spuren ab, hat jede eigene
Pfeile, die Pfeile am Taktpaar übernehmen alle; die Pfeile zwischen den Auswahllisten übernehmen alle verschiedenen
Takte auf einmal. "Rückgängig" im Dialog nimmt die letzte Übernahme zurück (Strg+Z wirkt erst nach dem Schließen).

Patterns – die Strumming bzw. Picking Patterns des Songs, meist eins oder zwei, je als Raster mit Zählzeile:
- Wann – Freitext, z. B. "ganzer Song", "Strophe", "Refrain ab dem 2. Mal"
- ↑ ↓ – Reihenfolge auf dem Blatt; × nimmt das Pattern aus dem Song (im Katalog bleibt es)
- "+ Pattern aus dem Katalog …" – nur Patterns mit einer Taktart des Songs
- Aus Spur vorschlagen … – Begleitspur wählen; je Abschnitt das häufigste Pattern der Takte, gleiche in einer Zeile mit
  den Abschnitten und "54 von 108 Takten", vorgewählt das passende Katalog-Pattern oder "neu in den Katalog …" mit
  Namen (Songtitel). "Wann" ist mit den Abschnitten vorbelegt ("ganzer Song", wenn es nur ein Pattern ist).
- Auf Spur ausrollen … – ein Pattern des Songs, Zielspur (oder neue Spur "strumming" bzw. "picking"), Takte: die
  Auswahl in den Noten oder Abschnitte zum Ankreuzen (vorausgewählt die, die unter "wann" genannt sind, sonst alle).
  Je Anschlag der Griff des dann klingenden Akkords (aus den Noten, sonst aus dem Akkordkatalog), Strumming Patterns mit
  Plektrumzeichen. Überschrieben werden nur leere Takte und Takte, die einem Katalog-Pattern entsprechen; andere
  (Breaks, Schluss) bleiben und werden genannt, außer mit Häkchen "Auch Takte überschreiben, die abweichen".
- Pattern-Katalog … – alle Patterns nach Technik, mit Zahl der Songs, die sie verwenden; neu aufnehmen, ändern (Warnung,
  wenn mehrere Songs es verwenden), löschen. Gespeichert über `PUT api/patterns.php`.

Tabs – Takte, die als Tab auf das Blatt kommen (Intro, Licks, besondere Übergänge):
- Takt von – bis (Klick auf "Takt" setzt den Cursor), Spur, Beschriftung (z. B. "Intro", "Lick nach der Strophe");
  × entfernt die Stelle
- "+ Takt 5–8 als Tab" – die markierten Takte (Strg+Umschalt+←/→), ohne Auswahl der Takt am Cursor; Spur ist die der
  Auswahl (Gesangsspuren nicht), beschriftet mit dem Abschnitt, wenn die Stelle an seinem Anfang beginnt
- Werden Takte eingefügt, gelöscht oder ausgeschrieben oder Spuren umbenannt, wandern die Angaben mit

Griffbilder – je Akkord des Songs das Griffbild mit Häkchen (ausgeblendete sind blass). Vorbelegt: Akkorde, die nicht gängig
sind (gängig: C, D, E, G, A, Am, Dm, Em und ihre 7er), und gängige mit eigenem Griff; gespeichert wird nur, was davon
abweicht. Ohne Griff in den Noten gilt der Standardgriff des Katalogs.

Links – Bezeichnung, Adresse, Häkchen "QR-Code" (sonst als Text auf dem Blatt), ×; "+ Link", "+ YouTube-Link aus den
Stammdaten". Die QR-Codes stehen rechts im Kopf von Seite 1.

Spielweise – Hinweise für Seite 1, Markdown: # Überschrift, **fett**, *kursiv*, - Aufzählung, 1. Liste, [Text](https://…). Die
Vorschau folgt beim Tippen, übernommen wird beim Verlassen des Felds.

Vorschau: Tabs mit Bundzahlen ohne Rhythmus; Einpassen, Zusammenfassen und Druck siehe oben.

Eingabe der Patterns im Feld oder per Klick ins Raster des Formulars, Großbuchstabe = betont. Strumming Patterns d, u, x, .
(z. B. `d.du.udu`, `D.duD.du`); Klick wechselt nichts → ab → auf → gedämpft, Klick auf die Zählzeit betont. Picking Patterns als Fingersatz, die Saite folgt
aus dem Finger: p tiefer Bass, q zweiter Bass, i g-, m b-, a e-Saite; ohne Leerzeichen zugleich, . klingen lassen,
x Pause (z. B. `p i q m p i q m`, `p . ima . q . ima .`); Klick setzt/nimmt den Finger auf der Saite, Klick auf die
Zählzeit betont (fett) bzw. setzt eine Pause.

Patterns erscheinen überall als Raster (`patternGridHtml()`): Plektrumzeichen (abwärts, aufwärts) der Notenschrift (wie in den Noten; × gedämpft) bzw. beim Picking Pattern eine kleine Tab (je Saite eine
Zeile e, b, g, B, zweite B-Zeile bei Bedarf; darauf der Finger, eine Pause als x auf den zuletzt gespielten Saiten), betonte Schritte als fette Zählzeit (beim Strumming Pattern
zusätzlich ">"), ganz unten die **Zählzeiten**, berechnet aus Taktart und
Raster (4/4 in Achteln "1 + 2 + 3 + 4 +", in Sechzehnteln "1 e + a …", 6/8 "1 2 3 4 5 6"; senkrechte Linie je Schlag,
in 6/8 je drei Achtel). Im Formular zeigt eine Vorschau das Raster beim Tippen.

### Liedtext
- Textfeld mit dem Liedtext der Spur mit dem Text (Radiobutton "Text" im Dialog "Spuren"; Silben mit Bindestrich,
  z. B. "Frank-furt"); die Spur nennt der
  Hinweis beim Darüberfahren. Rechts daneben die Ansicht "Text & Akkorde" der bearbeiteten Noten als Vorschau, mit
  jeder Übernahme neu (etwa 6 ms bei Stairway to Heaven).
  Klick oder Pfeil-, Bild-, Pos1- und Ende-Taste im Feld setzen den Cursor in den Noten auf die Silbe dort (rollt
  hin; ist die Spur mit dem Text ausgeblendet, in ihren Takt) und heben sie in der Vorschau hervor wie beim Abspielen.
  Umgekehrt ist die Silbe zum Cursor in den Noten im Feld und in der Vorschau hinterlegt und ins Bild gerollt (Klick oder
  Taste in den Noten, auch in einer anderen Spur: die letzte Silbe, die spätestens dort beginnt); das Feld bekommt dabei
  nicht den Fokus, die Tastenkürzel der Noten bleiben.
  Die Zeilen sind umbrochen wie in der Ansicht "Text & Akkorde". Vor jedem Abschnitt steht sein Name, z. B. "[Verse]"
  (auch ohne Text, z. B. "[Intro]"), davor eine Leerzeile; diese Zeilen zählen beim Verteilen nicht
- Beim Schreiben steht der Text sofort in den Noten (kurz nach dem letzten Tastendruck), eine Silbe je Schlag mit
  Note. Geändert wird nur, was sich am Text geändert hat: Gleich gebliebene Silben bleiben auf ihrem Schlag (auch mit
  Lücken, z. B. gehaltene Silben); geänderte kommen auf die Schläge der alten, passt es nicht, rückt der Rest des
  Abschnitts nach. Jeder Abschnitt ("[Verse]") kommt in seine Takte; ein zu langer verschiebt nicht die folgenden,
  sondern wird rot markiert; wie viele Silben je Abschnitt keinen Schlag haben, sagt der Hinweis. Der Text bleibt dann im Feld stehen,
  bis er passt (oder bis "Rückgängig"). Verteilt wird dabei immer vom Stand vor dem Schreiben aus: Ein zu langer
  Abschnitt rückt seine Silben Schlag für Schlag nach und füllt Lücken, wird er wieder gekürzt, stehen sie wie vorher.
- Ein einzelnes "_" lässt einen Schlag aus, "mir_zu." setzt zwei Wörter auf einen Schlag. Weitere Strophen bleiben
  unverändert. Eine Bearbeitung des Felds ist ein Schritt für "Rückgängig".
- Zeilenumbrüche werden gespeichert: als `\n` an der letzten Silbe jeder Zeile (im alphaTex `lyrics "Ber-lin,\n"`,
  alphaTab zeichnet es nicht). Nach der ersten Änderung im Feld hat jede Zeile ihren Umbruch, das Feld und "Text &
  Akkorde" zeigen genau diese Zeilen.  Ohne gespeicherte Umbrüche (und in Strophen ohne Umbrüche) ergeben sich die Zeilen aus Satzzeichen,
  Pausen und Abschnitten. Steht der ganze Text in einer Zeile ohne Abschnitte, gibt es keine Umbrüche mehr, und es
  wird wieder automatisch umbrochen.

### Spuren
Je Spur eine Zeile:
- Zeigen (Checkbox) – welche Spuren im Notenblatt stehen. Im Bearbeitungsmodus stehen Text und Akkorde nur an ihrer
  eigenen Spur: Ist die Text- bzw. Akkordspur ausgeblendet, sind sie nicht zu sehen. Erst der Player hängt sie zur
  Anzeige an die unterste bzw. oberste sichtbare Spur (applyLyrics(), applyChordNames() in playback.js)
- Name – frei, unübersetzt; Auswahlliste mit strumming, picking, percussion, fingerstyle, vocal und allen Namen aus
  der Bibliothek, erweiterbar durch Eintippen. Nur leer geht nicht. 
- Akkorde, Text (je ein Radiobutton über alle Spuren) – in welcher Spur die Akkorde bzw. der Liedtext stehen. Es ist
  die Spur, in der sie stehen (die mit den meisten); gespeichert wird nichts zusätzlich. Umstellen zieht sie ganz in
  die gewählte Spur (`moveContent()` in `notation.js`). Beginnt dort an einer Stelle kein Schlag, fragt ein Dialog:
  "Schläge einfügen" teilt den klingenden Schlag und bindet an (klingt gleich; Triolen lassen sich nicht teilen, ihr
  Akkord bzw. ihre Silbe kommt auf den Schlag davor), "Auf den Schlag davor" setzt Akkord bzw. Silbe auf den
  klingenden Schlag (Silben auf einem Schlag werden zusammengefasst, im Liedtext-Feld mit "_"). Der Dialog kommt auch,
  wenn etwas wegfällt: ein Akkord, wo in der Zielspur schon ein anderer steht, oder Text in einer dritten Spur (der Text
  kommt aus der Spur mit dem meisten, er steht danach nur noch in einer). Ohne Akkorde bzw. Text merkt sich der Editor
  nur die Wahl; ohne Wahl kommen Akkorde in die erste Spur, Text in "vocal", sonst in die letzte.
- Instrument – Auswahlliste mit 13 Instrumenten (Schlagzeug nur bei einer Schlagzeugspur, nicht änderbar); es legt Klang
  und Notenlage zusammen fest (Gitarre und Bass eine Oktave höher notiert, alle anderen wie klingend). Der Tooltip nennt
  die Instrumente der Gruppe (z. B. Flöte: Querflöte, Blockflöte, Panflöte …). Liste: `docs/Instrumente.md`
- ↑/↓ – Reihenfolge der Spuren; so stehen sie im Notenblatt und im Player (der sortiert nicht um)
- ⧉ Spur duplizieren – Kopie direkt dahinter ("picking 2"), ohne Akkorde und Text
- ♪ Melodie ableiten – neue Spur "Melodie" (Instrument Gesang) als letzte Spur, aus dieser Spur, z. B. aus dem Fingerstyle: Wo
  in der Textspur eine Silbe steht, bleibt der höchste Ton des Schlags mit seiner Dauer, alle anderen Schläge werden
  Pausen; aufeinanderfolgende Pausen werden zu möglichst wenigen zusammengefasst (in Takten mit Triolen oder
  Vorschlägen nicht), weitere Stimmen werden Pausen. Der Text zieht in die neue Spur (`deriveMelodyTrack()` und
  `mergeRests()` in `js/notation.js`)
- ⇅ Rhythmus ableiten – Dialog (`js/rhythmdialog.js`): alle Rhythmen, die in dieser Spur vorkommen (je Takt aus den
  Anschlägen, ab auf geraden, auf auf ungeraden Rasterplätzen, gedämpft als x), gleiche zusammengefasst, häufigste
  zuerst, mit Ort ("ganzer Song", "Verse, Chorus", "Takte in 2/4", "Takte mit C", "letzter Takt jedes Abschnitts
  Chorus", sonst die Takte). Jeder Rhythmus ist änderbar (Feld oder Klick ins Raster, Raster Achtel/Sechzehntel);
  Rhythmen sind nummeriert; "Rhythmus 1 übernehmen" bei ähnlichen (ab 75 % gleicher Rasterplätze), "Ähnliche
  zusammenfassen" für alle (ausgegraut, wenn es nichts zusammenzufassen gibt), der Kreispfeil daneben zeigt nach
  einer Änderung wieder die Rhythmen, wie sie in der Spur stehen. Der Ort steht als Abschnitte mit Anteil da
  ("Verse (14 von 32 Takten), Chorus"). Anschläge neben dem Sechzehntelraster (32tel, Triolen) fallen beim Ableiten
  ungefragt weg, der Rhythmus heißt dann "vereinfacht". Je Rhythmus wechselt ein Knopf das Raster ("in Sechzehnteln",
  "in Achteln"); liegen Anschläge auf Sechzehnteln dazwischen, heißt er "auf Achtel vereinfachen" und lässt sie weg. Wechselt ein Akkord an einer Stelle ohne Anschlag: rote Warnung, "Übernehmen" gesperrt
  (Akkorde werden nie verschoben). Übernehmen legt die Spur "Rhythmus" als erste Spur an (die Akkorde stehen oben) (Akustikgitarre, Capo und
  Tuning der Spur), je Anschlag der Griff des klingenden Akkords; Ein- und Ausblenden der Spur kommen mit (an den
  Anschlag, der dort klingt); die Akkorde ziehen in die neue Spur. Ohne Katalog
- × löschen (mit Rückfrage; die letzte Spur bleibt)
- Spur hinzufügen – Gitarrenspur mit Tuning und Capo des Songs, mit leeren Takten
- Spur aus GuitarPro-Datei importieren – Datei wählen (gelesen und bereinigt wie beim Import), dann Spur, "Ab Takt der Datei" und "Auf
  Takt des Songs" (für ein anderes Intro). Die Spur kommt ans Ende, ohne Akkorde und Text; Taktart, Tempo,
  Vorzeichen, Capo, Tuning und Abschnitte bleiben die des Songs (die Spur wird umgerechnet, klingt gleich). Takte davor werden Pausen, was über das Ende hinausgeht, fällt weg; Takte, deren
  Länge nicht zur Taktart passt, nennt der Hinweis danach (am Cursor zeigt sie die Statuszeile: "Takt zu lang" bzw.
  "Takt zu kurz").

### Audio
- Der Sync-Editor wie außerhalb des Modus (Wellenform, Marker ziehen, Anfang/Ende erkennen, + Punkt, Punkt löschen,
  alle verschieben, Tempo anpassen, Zoom), aber im Panel und ohne eigenes Speichern, Schließen und Rückgängig: Jede
  Änderung ist ein Schritt im Bearbeitungsmodus (Strg+Z, Speichern oben). Ohne Audiospur steht dort ein Hinweis.
- Tempo der Audiospur – steht im Sync-Editor neben "ms verschieben" ("Tempo der Audiospur ab Takt 1 bis 42: 97 BPM"), berechnet aus den Sync-Punkten
  im Mittel vom ersten bis zum letzten Sync-Punkt des Abschnitts ohne notierten Tempowechsel, in dem der gewählte Punkt bzw. die
  Abspielposition liegt (ohne Tempowechsel ist das der ganze Song). Weicht es vom notierten Tempo ab, erscheint daneben der Knopf
  "Tempo 90 → 97 BPM", der nur das Tempo dieses Abschnitts anpasst (`recordingTempoRegion()` in `notation.js`)

Rechts in der Kopfzeile des Panels die Statuszeile: "Takt zu lang" bzw. "Takt zu kurz" für den Takt am Cursor, sonst
leer. Ungespeicherte Änderungen zeigt der Speichern-Knopf: hervorgehoben und aktiv, ohne Änderung ausgegraut.

---

## Nur über die Tastatur bzw. Maus im Notenblatt, kein eigenes Bedienelement

- Cursor: Klick ins Notenblatt, ←/→ Schlag, ↑/↓ Saite, Pos1, Strg+Pos1, Ende, Strg+↑/↓ Spur
- Bund: Ziffern 0–24 (zwei Ziffern rasch nacheinander = zweistellig)
- Note löschen (Rücktaste)
- Auswahl von Takten: Strg+Umschalt+←/→ (taktweise), Strg+A alle Takte, Esc hebt sie auf; orange Flächen über den Takten (für Kopieren, Ausschneiden, Leadsheet-Tabs)
- Auswahl von Schlägen: Umschalt+←/→ (der Cursor geht mit), Umschalt+Klick (Umschalt halten, Anfang und Ende anklicken); Esc oder ein Klick hebt sie auf; orange Spalten. Notenwert, "+"/"-", Punktierung und Triole gelten dann für alle ausgewählten Schläge (bei Punkt und Triole bekommen alle den Zustand des Schlags am Cursor)
- Takte, deren Schläge nicht zur Taktart passen (je Stimme geprüft; leere Takte und ein Auftakt nicht), sind rot hinterlegt; das "!" oben links nennt beim Darüberfahren, wie viel fehlt oder zu viel ist, z. B. "1 Achtelschlag zu wenig" (`barLengthProblems()` in `notation.js`)
- Takt kopieren (Strg+C), ausschneiden (Strg+X, die Takte werden zu Ganztaktpausen), einfügen (Strg+V, ersetzt ab dem
  Takt am Cursor in dessen Spur, auch in einen anderen Song)
- Note auf eine andere Saite, gleicher Ton: Strg+Alt+↑/↓

---

## Shortcuts

Übernommen aus Guitar Pro 8 (https://www.guitar-pro.com/docs/gp8/appendix/shortcuts), soweit der Editor die Funktion
hat und der Browser die Taste nicht selbst belegt. Liste: `public/js/editor.js`, Übersicht über "?".

Abweichungen:
- Taktart: ohne Tastenkürzel statt Strg+T (Strg+T öffnet im Browser einen Tab)
- Rechtes Panel: F4; unteres Panel: F8 (in Guitar Pro die Gesamtansicht)
- Strg+Tab, Strg+W, Strg+N entfallen (belegt der Browser)
- Strg+D und Strg+U (Anschlagpfeile) belegt der Browser auch (Lesezeichen, Quelltext); im Bearbeitungsmodus fängt der
  Editor sie ab

---

## Nicht aus Guitar Pro übernehmen

Was ein Song verwendet, bleibt beim Bearbeiten erhalten (alphaTex speichert
es), bekommt aber kein Bedienelement.

| Option                          | Songs                                                                       | Anmerkung                                                     |
|---------------------------------|-----------------------------------------------------------------------------|---------------------------------------------------------------|
| Mehrfach-Stimme                 | 0                                                                           |                                                               |
| Freier Takt                     | 0                                                                           |                                                               |
| 8va, 8vb, 15ma, 15mb            | 0                                                                           |                                                               |
| Crescendo                       | 0                                                                           |                                                               |
| Fermate                         | 1 ("Du willst immer nur ficken")                                            | fehlte in der ersten Liste                                    |
| Dynamik ppp bis fff             | 40, fast alle aus dem GP-Import                                             | wirkt nur auf die Lautstärke der Wiedergabe                   |
| Ghost Note                      | 11                                                                          |                                                               |
| Betonte Note (Akzent)           | 7                                                                           |                                                               |
| Dead-Slapped                    | 0                                                                           |                                                               |
| Staccato                        | 1 ("Wish You Were Here")                                                    |                                                               |
| Let Ring                        | 1 ("Happy Xmas")                                                            | lässt die Noten bei der Wiedergabe ausklingen                 |
| Sustainpedal                    | 0                                                                           |                                                               |
| Palm Mute (P.M.)                | 2 ("Alles aus Liebe", "Zombie")                                             | bei Bedarf später                                             |
| Legato                          | 3 ("Blowin' in the Wind", "Knockin' on Heaven's Door", "Tennessee Whiskey") |                                                               |
| Oberton (Flageolett)            | 0                                                                           |                                                               |
| Tremolo-Arm                     | 0                                                                           |                                                               |
| Plectrum-Scrape                 | 0                                                                           |                                                               |
| Tap, Slap, Pop                  | Slap 1 ("Redemption Song")                                                  | "auf die Saite schlagen" später                               |
| Tapping                         | 0                                                                           |                                                               |
| Linker/rechter Fingersatz       | 3 bzw. 2                                                                    |                                                               |
| Saitennummer                    | 0                                                                           |                                                               |
| Rasgueado                       | 0                                                                           |                                                               |
| Vorschlagsnote                  | 3 ("Stairway", "Wish You Were Here", "Tennessee Whiskey")                   |                                                               |
| Triller                         | 0                                                                           |                                                               |
| Tremolo-Picking                 | 0                                                                           |                                                               |
| Praller, Doppelschlag           | 0                                                                           |                                                               |
| Einblenden, Ausblenden          | 18 (aus GP)                                                                 |                                                               |
| Lautstärkezunahme               | 0                                                                           |                                                               |
| Wah offen/geschlossen           | 0                                                                           |                                                               |
| Golpe-Finger, Golpe-Daumen      | 0                                                                           |                                                               |
| Tonleiterdiagramm               | 0                                                                           |                                                               |
| Slash-Note                      | 0 (entfernt der Import)                                                     |                                                               |
| BV (Barré-Angabe)               | 0                                                                           |                                                               |
| Balken                          | 1 ("Happy Xmas")                                                            | alphaTab setzt das selbst                                     |
| Notenhals oben/unten/auto       | 27 (aus GP)                                                                 | alphaTab setzt das selbst                                     |
| Triolenklammer erzwingen        | 0                                                                           | alphaTab setzt das selbst                                     |
| Lautstärke automatisch einfügen | 0 (nur der Instrumentwechsel am Anfang, in allen Songs)                     |                                                               |

Korrekturen gegenüber der ersten Fassung: Dynamik 40 statt 38 Songs, Notenhals 27 statt 26; bei Balken und
Triolenklammer stand versehentlich die Zahl der Notenhälse; Fermate ergänzt; "Let Ring klingt ohnehin immer aus"
stimmte nicht (ohne Let Ring endet eine Note bei der Wiedergabe mit ihrer Dauer); Lautstärke geprüft.

Wird nicht gesetzt, nur ausgeschrieben:
- Wiederholungszeichen ("Schlaflied", "Für Elise", "Fröhliche Weihnacht", "Drunken Sailor", "Kol Dodie", "Kommet ihr
  Hirten")
- Volta-Klammern ("Für Elise", "Kol Dodie")
- Sprünge (D.S., D.C., Coda, Fine) – derzeit in keinem Song
- Takt-Wiederholungszeichen (Simile) ("Chasing Cars")

Im Editor statt in dieser Liste: Shuffle (Werkzeugleiste, mehr Triolen-Feelings braucht das Gitarrenbuch nicht), Anschlagpfeile
und Arpeggio (links), Dead Note als "Saite dämpfen" (links).
