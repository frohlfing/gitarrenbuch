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
- Speichern (Strg+S) – blau, solange etwas ungespeichert ist (Noten und die Angaben aus dem Dialog "Leadsheet"). Legt
  das Speichern einen Stand in den Verlauf, fragt erst ein Dialog nach einer Änderungsnotiz (Feld optional, Enter
  speichert; steht im Verlauf). Dasselbe Feld hat der Dialog "Änderungen speichern?" beim Beenden. Die Notiz merkt
  sich der Browser je Song bei "Speichern", "Ja, speichern" und "Nein, verwerfen" (überschreibt die vorige; nicht bei
  "Abbrechen" und ✕) und schlägt sie beim nächsten Mal vor; ein leeres Feld löscht den Vorschlag (`keepLastNote()` in
  `editor.js`)
- Rückgängig (Strg+Z)
- Wiederholen (Strg+Y)

### Sonstiges
- Hilfe (?) – zeigt die Tastenkürzel
- ✕ – beendet den Bearbeitungsmodus (fragt bei Ungespeichertem nach)

## Linkes Panel "Am Cursor" (F2)

Das Panel ist so breit, dass acht Knöpfe nebeneinander passen. Reihenfolge von oben: Note, Einfügen/löschen,
Tonhöhe, Anschlag, Takt, Abschnitt, Akkord, Text über dem Schlag, Liedtext-Silbe.

Die Eingabefelder (Taktart, Tempo, Abschnitt, Text über dem Schlag, Liedtext-Silbe) übernehmen ihren Wert mit Enter
und verlassen das Feld, danach gehören die Tasten wieder den Noten (`leaveFieldOnEnter()` in `editor.js`). Ein Klick
in die Noten verlässt ein Feld ebenfalls; ein getippter, noch nicht bestätigter Wert gilt dann noch für den alten
Schlag.

### Note
Erste Reihe:
- Ganze bis 32tel (+ kürzer, - länger); sind Schläge ausgewählt (Umschalt+←/→), gilt es für alle
- Triole (/)
- Pause (R)

Zweite Reihe:
- Punktiert (.)
- Doppelt punktiert (Strg+.)
- Haltebogen (L)

### Tonhöhe
- Kreuz (Strg+9)
- Be (Strg+7)
- Auflösungszeichen (Strg+8)
- Tonleiterschritt höher / tiefer (Umschalt+↑/↓) – zum nächsten Ton der Tonart (Vorzeichnung des Takts; Dur und
  parallele Moll haben dieselben Töne), von D in D-Dur also nach E bzw. C#. Mit Alt (Alt-Klick, Alt+Umschalt+↑/↓) ein
  Halbton (`stepPitch()`, `shiftToPitch()`)
- Akkordton höher / tiefer (Strg+Umschalt+↑/↓) – zum nächsten Ton des Akkords, der dort klingt (Akkordspur), über D:
  D → F# → A → D und weiter durch die Oktaven. Auf betonten Silben ist das meist der richtige Melodieton
- Die Note bleibt auf ihrer Saite; geht der Bund dort nicht weiter, sagt ein Hinweis es

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

### Effekt
- Hammer-on / Pull-off (H)
- Slide (S)
- Bend (B) – hochziehen und halten; jeder Druck eine Stufe weiter: ½ → full → 1½ → kein Bend
- Vibrato (V)
- Ghost-Note (O) – leise angedeuteter Ton, in Klammern (in der Gitarre oft leise Anschläge)
- Saite dämpfen (X) (in Guitar Pro "Dead Note")

Mit Auswahl (Umschalt+←/→) gelten Ghost und Dead, Pause, Haltebogen, alle Knöpfe unter "Anschlag" und die Notenwerte
für alle ausgewählten Schläge, und zwar gleich: Was der Schlag bzw. die Note am Cursor schon hat, geht überall weg,
sonst kommt es überall dazu (`toggleSelectedNotes()`, `toggleSelectedBeats()`, `tieSelected()`). Der Haltebogen gilt
an der Saite am Cursor, jeder Schlag hält die Note des Schlags davor. Die Knöpfe unter "Tonhöhe" gelten nur am Cursor.

### Einfügen, löschen (Icons)
Mit Alt-Klick fügen "Schlag einfügen" und "Takt einfügen" rechts neben dem Cursor ein (wie Alt+Einfg).
- Schlag einfügen (Einfg): eine Pause mit der Dauer des Schlags am Cursor, links neben ihm; Alt+Einfg fügt sie rechts neben ihm ein (auch am Taktende)
- Entf: löscht die Zahl (Note) am Cursor; ist der Schlag leer (Pause), den Schlag; sind Schläge ausgewählt (Umschalt+←/→), alle ausgewählten. Der letzte Schlag eines Takts bleibt als Pause. Der Button "Schlag löschen" löscht den Schlag am Cursor immer
- Takt einfügen (Strg+Einfg): ein leerer Takt links neben dem am Cursor; Strg+Alt+Einfg fügt ihn rechts daneben ein
  (auch hinter dem letzten Takt)
- Takt löschen (Strg+Entf)
- Pinsel (Alt+C) – Dialog "Kopieren" mit der Länge der Auswahl in Takten und Rest (z. B. "2 Takte und 3 Achtel
  ausgewählt"): welche Eigenschaften der Schläge am Cursor bzw. in der Auswahl (Schläge oder Takte) kopiert werden,
  der Tooltip jeder Art sagt, was sie im Ziel ändert: Akkorde, Anschlag (Plektrum, Anschlagpfeil, Arpeggio, Ausblenden,
  Betonung), Notenwerte und Töne (mit Haltebogen, Hammer-on, Slide, Bend, Vibrato, gedämpft), Text über dem Schlag,
  Liedtext-Silbe. Anfangs ist alles gewählt; die Auswahl merkt sich der Dialog, solange die Seite offen ist
- Übertragen (Farbroller, Alt+V; aktiv nach dem Pinsel) – ein Schritt für Rückgängig. Maßgeblich ist die Dauer: Eine
  Auswahl muss so lang sein wie das Kopierte, ohne Auswahl gilt es ab dem Cursor. Mit Notenwerten ersetzen die
  kopierten Schläge die dort (vier Viertel auf eine ganze Note; Instrumentwechsel und Dynamik der ersetzten Schläge
  bleiben); das Kopierte muss dann an einer Schlaggrenze enden, und kein Schlag darf über einen Taktstrich gehen.
  Anschlag und Text kommen an die Schläge, die an derselben Stelle beginnen, Akkorde und Silben wie beim Eingeben an
  die Stelle in der Akkord- bzw. Textspur; auch ein leerer Wert überschreibt. Was nicht angehakt ist, bleibt
  unverändert: Ersetzen die Notenwerte die Schläge, behalten die neuen Schläge Akkord, Silben, Text und Anschlag des
  alten Schlags an derselben Stelle. Bei einem Konflikt bricht das Übertragen ohne Änderung mit Meldung ab: Eine nicht
  kopierte Angabe steht an einer Stelle, an der im Kopierten kein Schlag beginnt; für kopierten Anschlag oder Text
  beginnt dort kein Schlag; eine Stelle für Akkord oder Silbe lässt sich nicht teilen (Triole, Vorschlag)
  (`brushRange()`, `applyBrush()`, `brushKept()`)

### Takt
- Takt – Knopf "Auftakt" (Startflagge, nur an Takt 1, gedrückt bei einem Auftakt): macht Takt 1 zum Auftakt in der
  Taktart von Takt 2 und rechnet um: Pausen am Anfang, die alle Spuren mit Inhalt gemeinsam haben, fallen weg (Sync-Punkte in Takt 1
  rücken mit), Spuren ohne Inhalt bekommen Pausen so lang wie der Auftakt. Ein Auftakt ist so lang wie seine längste
  Spur, höchstens ein voller Takt; ein voller Takt 1 wird kein Auftakt. Nochmal drücken: voller Takt mit der Taktart,
  die zu seiner Länge passt (z. B. 7/16). Kommt ein Takt vor den Auftakt, ist er ein gewöhnlicher (zu kurzer) Takt
  (`setAnacrusis()` in `notation.js`, in alphaTex `\ac`). Daneben Taktart und Tempo (BPM), als Werte am Takt des
  Cursors. Die Taktart hat eine Auswahlliste (4/4, 3/4, 2/4, 6/8,
  12/8, 2/2, 5/4, 7/8, 9/8), erweiterbar durch Eintippen. Eine Änderung gilt ab diesem Takt bis zum nächsten Wechsel; am ersten
  Takt ist das Tempo das des Songs, danach ein Tempowechsel. Tempi sind ganze Zahlen. Ist der Wert gleich dem davor,
  gibt es keinen Wechsel (einen Wechsel
  entfernt man, indem man das Feld leert oder den Wert davor einträgt); macht eine Änderung den Wechsel im Takt dahinter überflüssig,
  fällt der auch weg (`removeRedundantTempos()`, ebenso beim Import). Hat der Song Sync-Punkte, bekommt ein
  Tempowechsel automatisch einen am Anfang seines Takts (in jeder Wiederholung), an der Stelle, an der der Takt in der
  Audiospur gerade beginnt (`syncTempoBar()`): So verrutscht durch den Wechsel nichts, und im Sync-Editor zeigt die
  Fahne ihn an (schwarz). Weicht das Tempo der Audiospur im Abschnitt am Cursor ab (aus den Sync-Punkten,
  `recordingTempoRegion()`), steht wie bei der Tonart ein rotes "!" daneben, Tooltip z. B. "Tempo in der Partitur
  ungenau (bis zum Ende 173 BPM)" bzw. "(bis zur nächsten Tempoangabe …)". Weicht irgendwo im Song ein Abschnitt ab,
  steht ein "!" auch am Label "Audio" des unteren Panels (Tooltip "Tempo in der Partitur ungenau"), ein Klick springt
  zum ersten

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
- Zauberstab daneben – "Passenden Akkord erkennen und einfügen" (`detectChord()`): sammelt die Töne, die ab dem Schlag
  am Cursor bis zum nächsten Akkordwechsel klingen (höchstens bis zum Taktende; alle Spuren außer Schlagzeug, gewichtet
  nach Klingdauer, der tiefste als Bass), und setzt den passendsten Akkord aus den Dreiklängen der Tonart (D-Dur: D, Em,
  F#m, G, A, Bm, C#dim; `scaleTriads()`) und den Akkorden des Songs (`rankChords()` in `chordtheory.js`): Anteil des
  Klangs, den seine Töne abdecken, Abzug für fehlende Akkordtöne und fehlenden Grundton, Zuschlag für den Bass als
  Grundton und für Akkorde, die im Song schon vorkommen. Ein Akkord des Songs behält seinen Griff, ein neuer bekommt den
  ersten des Katalogs, ohne den den einfachsten berechneten, wie im Dialog "Akkord". Akkordnamen sind Griffnamen: Die
  klingenden Töne werden um den Capo der Akkordspur zurückgerechnet, ebenso die Tonart. Nichts ändert sich (nur ein
  Hinweis), wenn dort schon derselbe Akkord klingt (gleiche Töne, "D7" und "D7*" sind derselbe), wenn am Schlag schon
  ein Akkord steht (der Knopf ergänzt, er ersetzt nicht; "erkannt wäre …") oder wenn nur eine Stimme klingt (nie zwei
  Töne zugleich, z. B. nur die Melodie): Melodietöne sind oft keine Akkordtöne (Probe an Kokain, nur Gesangsspur: ein
  Drittel richtig); der Hinweis nennt dann die Vermutung. Probe mit Begleitung an den Akkordstellen von drei Songs:
  317 von 319 wiedererkannt
- Ein Name hat im Song genau einen Griff (alphaTab unterscheidet Akkorde nur nach dem Namen): Ein neuer Griff gilt für
  alle Stellen und alle Spuren mit gleich vielen Saiten; setzt man einen Akkord, den eine andere Spur schon hat,
  bekommt er deren Griff. In den Katalog kommt ein Griff mit dem Speichern des Songs (der Akkordkatalog baut sich aus
  den Songs auf); eigene Griffe gehen beim Speichern dem Katalog vor

- Text über dem Schlag (T) – freier Text, z. B. "leise"; erscheint auch als Randnotiz auf dem Leadsheet
- Liedtext-Silbe (Umschalt+L) – die Silbe an der Stelle des Cursors, immer in der Textspur (wie der Akkord in der
  Akkordspur; beginnt dort kein Schlag, wird der klingende geteilt und angebunden). So kommt eine Silbe genau auf einen
  Schlag, ohne dass sich andere verschieben, z. B. auf den ersten Schlag eines Takts, der bisher keine hatte; leer
  entfernt sie. Die Silbe wird ohne Trennstrich eingetragen (z. B. "ja"). Ein
  Zeilenumbruch an der Silbe bleibt; wird die letzte Silbe einer Zeile gelöscht, geht ihr Umbruch auf die Silbe davor
  (sonst verschmölze die Zeile mit der nächsten). Das Panel "Liedtext" zeigt den Text danach neu, außer er ist dort zu
  lang (rot): Dann prüft der Editor nach jeder Änderung an den Silben im linken Panel (setzen, löschen, T→/←T), ob er
  jetzt passt (`recheckLyrics()`). Erst dann ist das Feld nicht mehr rot und zeigt wieder den Text der Noten; weiteres
  Schreiben im Feld rechnet ab der Änderung vom neuen Stand aus.
  Daneben "Linke Silbe auf diesen Schlag ziehen" (Symbol T→) und "Rechte Silbe auf diesen Schlag ziehen" (←T,
  `pullSyllable()`): Die nächste Silbe links bzw. rechts vom Cursor kommt auf den Schlag am Cursor, mit ihrem
  Zeilenumbruch; die Reihenfolge des Texts bleibt. Steht am Cursor schon eine Silbe, rückt sie zur anderen Seite weiter
  (bei T→ nach rechts, bei ←T nach links), eine Silbe dort ebenso, bis zum nächsten freien Schlag. Gibt es auf der
  Seite keine Silbe oder dahinter keinen freien Schlag, sagt ein Hinweis es. Ein Schritt für "Rückgängig". So lassen sich Silben nach dem Import Schlag für Schlag an ihre
  Stelle schieben.
  Dann der Knopf "Liedtext im Abschnitt neu zuordnen" (Symbol ↻): Der Text des Abschnitts am Cursor aus dem Panel
  "Liedtext" kommt neu auf seine Noten, eine Silbe je Note der Reihe nach (`applyLyrics()` mit reflow,
  `clearLyrics()` in `notation.js`). Lücken und über mehrere Noten gehaltene Silben gehen dabei verloren, "_" lässt eine
  Note frei. Gedacht nach dem Zusammenziehen von Silben: Beim Schreiben bleibt die frei gewordene Note leer (die Silbe
  davor gilt als gehalten), der Rest rückt erst mit dem Knopf auf. Ein Schritt für "Rückgängig".


## Werkzeugleiste: der ganze Song

- Tonart – alle 15 Dur- und 15 Moll-Tonarten (Cb bis C#, Abm bis A#m); gilt immer für den ganzen Song (die Songs im
  Gitarrenbuch wechseln die Tonart nicht). Strg+K setzt den Cursor ins Feld. Weicht die aus Akkorden und Tönen
  erkannte Tonart ab, steht ein rotes "!" daneben, der Tooltip nennt sie (kein Konflikt: die notierte muss nicht zu allen
  Akkorden passen, siehe docs/Konflikte.md)
- Shuffle – ein Knopf links neben "Transponieren", der den Zustand als Symbol zeigt (zwei Achtel = zwei gebalkte Achtel: gerade;
  zwei gebalkte Achtel = Triole aus Viertel und Achtel: Shuffle); ein Klick (oder Strg+/) schaltet um, für den ganzen Song. Mehr
  braucht das Gitarrenbuch nicht (die Songs nutzen nur Shuffle, `\tf triplet8th`); ein anderes Feeling aus einer GP-Datei löst
  der Import (`docs/Konflikte.md`)
- Metrum umschreiben (Metronom rechts neben Shuffle) – Dialog, der die zeitliche Einteilung umrechnet, ohne dass
  sich der Klang ändert (`js/timingdialog.js`, `retime()`), aufgebaut wie "Transponieren":
  - Erst wählt man, was sich ändern soll, in einem von drei Reitern: "Notenwerte ändern" (dritteln, halbieren,
    um ein Drittel kürzen, um die Hälfte verlängern, verdoppeln, verdreifachen; "um die Hälfte verlängern" macht
    aus Triolen gerade Noten, z. B. 2/4 mit Achteltriolen → 3/4 mit Achteln), "Taktart ändern" (alle erreichbaren, die üblichen zuerst) oder "Taktanzahl ändern" (je
    2 oder 3 zusammenfassen, jeden in 2 oder 3 teilen). Darunter stehen alle Varianten, die gleich klingen, als
    Tabelle (Taktart und nur die Spalten von Notenwerte, Tempo, Takte, die sich zwischen den Varianten
    unterscheiden; übliche Taktarten zuerst, nicht umrechenbare durchgestrichen); eine Zeile anklicken wählt sie. Das
    Tempo ist keine Eingabe: Es ändert sich immer mit den Notenwerten. Weitere Taktarten im Song folgen demselben
    Faktor im Nenner. Hinweise und Warnungen stehen über die ganze Breite des Dialogs unter Auswahl und Vorschau.
  - Shuffle bleibt auf den Achteln (Sechzehntel-Shuffle kennt das Gitarrenbuch nicht, der Import macht es zu geraden
    Sechzehnteln); ändern sich die Notenwerte, sagt ein roter Hinweis, welche Noten jetzt geswingt werden.
  - Betonung (nach der Musiklehre: betont die 1; halbstark die 3 im 4/4, die 4 im 6/8, die 7 im 12/8; Taktarten mit
    Dreiergruppen wie 6/8 haben Schläge zu je drei Zählzeiten): Verglichen wird die Betonung im Takt, relativ zur 1;
    wie schnell der Fuß wippt, zählt nicht (4/4 bei 170 und 4/4 bei 85 sind gleich). Wechselt die Gruppierung
    (Zweier- gegen Dreiergruppen, z. B. 6/8 gegen 3/4), warnt der Dialog rot; ändern sich nur die Stufen (z. B. 4/4 →
    2/4), gelb. Der Hinweis nennt beide Taktarten mit Schlägen und Betonung.
  - Was nicht als ein Notenwert geht, wird angebunden (eine Ganze verdoppelt: zwei angebundene Ganze; ein Schlag
    über einer neuen Taktgrenze: geteilt und angebunden); gedrittelt entstehen Triolen. Sync-Punkte, Tempowechsel und
    Fermaten behalten ihre Stelle in der Musik, Abschnitte, Wiederholungen und Taktstriche wandern mit ihrem Takt; ein
    Auftakt bleibt für sich. Ein Abschnitt, der beim Zusammenfassen in die Mitte eines Takts fiele, rückt an dessen
    Anfang (Hinweis); der letzte Takt wird bei Bedarf mit Pausen aufgefüllt.
  - Rot und ohne "Anwenden": verschiedene Taktarten in einem zusammengefassten Takt, zwei Abschnitte in einem Takt,
    eine Wiederholung mitten im Takt, eine Triole über einer neuen Taktgrenze, Notenwerte, die sich so nicht umrechnen
    lassen.
  - Vorschau (gleich beim Öffnen fertig, der Dialog hat eine feste Breite): oben eine Tabelle mit Taktart, Tempo,
    Takten und Notenwerten, "Jetzt" und "Danach"; darunter die häufigsten Rhythmen der Akkordspur als Reiter, der
    gewählte mit "Jetzt" über "Danach" (Akkorde, Betonungen, Anschläge, Zählzeiten). "▶ Metronom" spielt erst
    "Jetzt", nach einer kurzen Pause "Danach", im Tempo des Songs: Klick auf jedem Schlag (betonte höher und lauter)
    und die Anschläge (ab tiefer als auf); die Spalte, die gerade klingt, ist markiert. Die
    Spalten sind das feinste gemeinsame Zeitraster beider Zeilen (punktierte Linien, Taktstriche durchgezogen), in
    allen Rhythmen gleich breit; jedes Zeichen steht am Anfang seiner Dauer, so steht gleichzeitig Gespieltes
    untereinander (ein Takt über seinen geteilten Takten, zusammengefasste Takte über dem neuen). Ein Rhythmus sind
    gleiche Anschlagstellen; Richtung, Betonung und Akkorde zählen nicht, und fehlen einem nur Anschläge eines
    anderen, zählt er zu diesem. Die Richtung wird berechnet wie bei "Rhythmus ableiten". Über dem Rhythmus stehen
    alle Stellen, an denen in einem seiner Takte ein Akkord wechselt, mit dem Akkord vom ersten Vorkommen.
  - Für die Wahl der Einteilung: Passt die Betonung der Taktart zum Song? Wippt der Fuß auf den Grundschlägen? Ist das
    Pattern genau einen Takt lang (und wiederholt sich nicht im Takt)? Abschläge auf den Zählzeiten, Aufschläge auf "+"?
  - "Anwenden" gibt es nur mit einer gewählten, umrechenbaren Variante; es prüft erst an einer Kopie und rechnet dann
    um, als ein Schritt für "Rückgängig".
- Capo und Tuning – rechts neben dem Knopf "Transponieren" nur als Anzeige wie im Kopf des Players ("**Capo 3** · **D**ADGBE": der Capo nur bei Capo > 0, das Tuning nur bei Abweichung vom Standard, abweichende Saiten fett); ändern lassen sie sich nur im Dialog Transponieren. Capo (alle Spuren): die Griffe bleiben (Tabs und Griffbilder ändern sich nicht, die Noten klingen um den Capo höher). Bei
  ungleichem Capo (gibt es nach dem Import nicht mehr) zeigt die Anzeige den Capo der ersten Spur
- Tuning (alle Spuren; Textfeld im Dialog), z. B. "D A D G B E"; beim Verlassen wird die Eingabe korrigiert: Großbuchstaben, Leerzeichen
  zwischen den Tönen (auch "dadgbe" geht), zu viele Töne fallen weg, fehlende und ungültige werden durch die Saiten des Standards
  ersetzt (`normalizeTuningText()` in `notation.js`). Das Standard-Tuning zeigt das Feld als "Standard"; beim Bearbeiten stehen
  die Töne da (E A D G B E). Es gilt für alle Spuren mit so vielen Saiten wie die Akkordspur; die Bünde
  bleiben, nur die Noten ändern sich (wie beim Capo). Ist das Tuning in den Spuren ungleich, ist das Feld leer, oben steht rot
  "Tuning ungleich: …" mit "Tuning angleichen" (auf die der Akkordspur, die anderen klingen gleich). Eine Spur mit anderer Saitenzahl
  (Bass) behält ihr Tuning; sie steht im Tooltip des Felds
- Verlauf (Uhr-Icon neben Rückgängig/Wiederholen) – Dialog mit den Fassungen, je mit Zeitpunkt und Notiz des Speicherns,
  das sie angelegt hat, und Größe: oben die aktuelle Fassung (weder zu laden noch zu löschen), darunter die früheren,
  neueste zuerst, mit "Laden" und Papierkorb. Unter `history/` heißt jede Fassung `score-<Zeitpunkt des Speicherns>`:
  `.txt` ist die Notiz, `.atex` und `.json` sind `score.atex` und `score.json` unverändert; die aktuelle Fassung hat nur
  die `.txt`, ihre Noten kommen beim nächsten Speichern dazu (`keep_score_history()`). Geladen werden
  immer die Noten samt allen Angaben für das Leadsheet, in den Editor als ein Schritt für "Rückgängig" und noch nicht
  gespeichert. Importierte, noch nie gespeicherte Noten stehen mit dem Zeitpunkt ihrer Datei als aktuelle Fassung da.
- Bereinigen (Besen hinter "Transponieren") – Menü für Aufräumarbeiten am ganzen Song, je ein Schritt für
  "Rückgängig"; gibt es nichts zu tun, sagt es ein Hinweis und nichts ändert sich:
  - Akkorde – entfernt Akkorde, die nur den klingenden wiederholen (gleicher Name wie der davor, in allen Spuren), und
    setzt an jeden Abschnittsanfang ohne Akkord den klingenden (in die Akkordspur); dort bleiben auch Wiederholungen
    stehen (`chordCleanup()` in `notation.js`)
  - Griffe prüfen – je Akkord der Akkordspur die Schläge bis zum nächsten Akkord oder bis zum Taktende (ein Takt mit
    fremden Tönen macht die davor nicht falsch): gemeldet wird ein Ton, der nicht zum Akkord gehört, und bei vollen
    Anschlägen (ab 4 Saiten) ein fehlender nötiger Ton; dieselbe Prüfung wie im Akkorddialog (`parseChord()`,
    `gripToneProblem()`, `nameGrip()`). Ein Dialog listet die Funde zusammengefasst nach Akkord und Klang: Akkord, wie
    es klingt, Takte (Klick setzt den Cursor dorthin); gespielter Griff und Griff zum Ersetzen (Griffbild, sonst
    Katalog) stehen im Tooltip der Zeile. "Angehakte ersetzen" ist ein Schritt für Rückgängig: angeschlagene Griffe bekommen den Griff über
    dieselben Saiten, einzelne Töne den Bund des Griffs auf ihrer Saite, Haltebögen ziehen mit (`js/chordcheck.js`).
    Verglichen wird wie bei "Rhythmus ableiten" ohne Capo (Griffe sind Formen). Zupf-Abschnitte melden auch Läufe und
    Durchgangstöne, die bleiben einfach ohne Haken
- Takte pro Zeile – Feld links neben "Bereinigen", leer mit Platzhalter "auto": Zahl (1 bis 12) und Enter setzen alle
  so viele Takte einen Zeilenumbruch, gezählt ab jedem Abschnitt; jeder Abschnitt beginnt ohnehin eine neue Zeile
  (`rowBreaks()` in `notation.js`, `Player.applyBarsLayout()`). Ein Auftakt vor dem ersten Abschnitt steht so in einer
  Zeile allein. Reicht der Platz nicht (alphaTab bricht vor einem gesetzten Umbruch um), gelten still nur die Umbrüche
  an den Abschnitten, bis sich Breite, Größe oder Spuren ändern (`Player.checkBarsPerRow()`). Die Zahl steht als
  `barsPerRow` in den Angaben für das Leadsheet und gehört zu Speichern, Rückgängig und Verlauf. Auch die letzte Zeile
  steht auf voller Breite (`justifyLastSystem`)
- Gehe zu (Alt+G) – Feld rechts vor "?", leer mit Platzhalter "Takt": Zahl und Enter setzt den Cursor auf den ersten Schlag
  dieses Takts (Spur bleibt), danach ist das Feld wieder leer und die Tasten gehören wieder den Noten
- Abschnitte (Listen-Icon rechts neben "Gehe zu", Alt+Umschalt+G) – Menü wie "Bereinigen" mit allen Abschnitten und
  ihrem ersten Takt; ein Eintrag setzt den Cursor auf dessen ersten Schlag, der Abschnitt am Cursor ist markiert.
  Per Tastenkürzel steht der Fokus im Menü: ↑/↓ (Pos1/Ende) wählen, Enter springt, Esc schließt. Strg+Alt+←/→
  springt zum vorigen bzw. nächsten Abschnitt
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
- Baustelle (Schalter, mit 🚧) – eingeschaltet ein Feld für den Grund und die Spuren des Songs sowie "Audio" zum
  Ankreuzen (alles optional; "Audio": 🚧 an der Audiospur im Mixer und am Panel "Audio" im Bearbeitungsmodus). Wirkung: 🚧 an der Kachel (Tooltip: der Grund) und hinter den Namen der angekreuzten Spuren (links neben
  den Noten im Editor und im Player, im Mixer); diese Spuren liefern keine Patterns und Tab-Stellen fürs Leadsheet
  (Tab-Stellen auf ihnen fehlen auf dem Blatt, in der Spurauswahl der Tab-Stelle mit Hinweis; kein Vorschlag aus
  ihnen; der Pattern-Streifen im Player leitet aus ihnen nichts ab); die Bibliothek filtert unter "Alle Songs" → "🚧
  Mit Baustelle". Gespeichert in `song.json` (`wip`, siehe README). Der Editor führt die Spurnamen mit
  (`Sheet.wip`, `captureTabs()`, `remapTabs()`): Benennt er eine um oder löscht sie, trägt "Speichern" das in
  `song.json` nach
- Notizen

Die Quelle für die Audio-Datei (YouTube-Link, "Auf YouTube suchen", Längen von Noten, Clip und MP3) steht im unteren
Panel "Audio". Dateien mit ihrer Quelle (GP-, ChordPro-, Textdateien, PDFs) stehen im Dialog "Uploads"
(Menü ⋮); "Chord-Datei importieren" im Panel "Liedtext" und "Spur aus GuitarPro-Datei importieren" im Dialog "Spuren" wählen daraus.

"Chord-Datei importieren" (nur bei leerem Liedtext; `insertChordFileText()`, `readChordFile()` in `chordfile.js`,
`anchorLyrics()` in `notation.js`):
1. Abschnitte – Hat die Datei mindestens einen Abschnitt ("[Verse 1]", ChordPro `{start_of_verse}`), geht der Text
   nach Namen in die Abschnitte der Noten; sonst gilt er für den ganzen Song. "-/-" und ein leerer Abschnitt, dessen
   Name schon mit Inhalt vorkam, wiederholen den letzten Abschnitt dieses Namens.
2. Anker – Ist es nicht nur Text, legt der Import den Text an die Akkorde: Mit Taktstrichen ("|D" über dem Text) ist
   der n-te Strich eines Abschnitts der Anfang seines n-ten Takts; ohne Striche (ChordPro, Akkorde über dem Text) liegt
   die Silbe des k-ten Akkords am k-ten Akkordwechsel der Noten, wenn die Folge der Datei der Anfang der Folge in den
   Noten ist (gleiche hintereinander zählen einmal, ohne Basston verglichen). Striche bzw. Akkorde hinter dem Text oder
   in einer Akkordzeile ohne Text sind Takte ohne Silbe ("|G |G"). Passt die Folge nicht, nennt die Meldung den
   Abschnitt, und sein Text geht der Reihe nach auf die Schläge.
3. Silben – Zwischen zwei Ankern verteilen sich die Silben der Zeile gleichmäßig auf die Schläge der Textspur (hinter
   dem letzten Anker so weit wie der Bereich davor). Silben einer neuen Zeile vor ihrem ersten Anker sind ein Auftakt
   ("Du willst |im-mer"): Sie liegen auf den letzten Schlägen davor, am Abschnittsanfang im letzten Takt des Abschnitts
   davor. Was keinen Schlag findet, ist im Feld rot.

Die Akkorde kommen an ihren Anker bzw. an den Schlag ihrer Silbe, nicht dorthin, wo schon einer steht oder derselbe
klingt. Mehrsilbige Wörter trennt die Datei mit Bindestrich ("Lie-bes-paar"); ohne Trennung geht ein Wort auf einen
Schlag, und die Meldung erinnert daran.

Die Meldung danach (`chordFileReport()`) nennt nur, was nicht aufging, je eine Zeile: "Takt 68: Silbe „gehn!“ nicht
zugeordnet", Abschnitte, die in den Noten fehlen oder deren Akkorde nicht passen, Akkorde ohne Schlag oder unbekannte.
Dann ist sie eine Warnung: rötlich, sie bleibt, bis man auf ihr × klickt. Andere Hinweise unter der Werkzeugleiste
stehen so lange, wie man zum Lesen braucht (70 ms je Zeichen, 2,2 bis 20 s), mit der Maus darauf länger; ein Klick
schließt sie.

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
(im Druckdialog auch "Als PDF speichern"). Gespeichert wird in `score.json`
(`api/leadsheet.php`), mit dem Speichern-Knopf; jede Änderung ist ein Schritt für Strg+Z.

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
  Abschnitts nach. Die Abschnittszeilen ordnen den Text den Abschnitten der Noten zu, nach Namen
  (`lyricsBlockRanges()` in `notation.js`): Der Text unter "[Verse 2]" kommt in die Takte von Verse 2, gleiche Namen
  ("[Chorus]") der Reihe nach, Text vor der ersten Abschnittszeile vor den ersten Abschnitt. Ohne Abschnittszeile
  darüber wird Text nicht zugeordnet. Abschnitte der Noten ohne Zeile im Text verlieren ihre Silben. Steht im Text ein
  Abschnitt, den die Noten nicht haben, ist er rot, Hinweis "Abschnitt Bridge fehlt in den Noten". Ein zu langer
  Abschnitt verschiebt nicht die folgenden, sondern wird rot markiert; wie viele Silben je Abschnitt keinen Schlag
  haben, sagt der Hinweis. Der Text bleibt dann im Feld stehen, bis er passt (oder bis "Rückgängig").
  Die letzten Noten im Takt vor einem Abschnitt bekommen schon dessen Text, wenn davor im selben Takt eine Pause oder
  das Textende des Abschnitts davor steht (`pickupBeats()`), z. B. "Greif" in Takt 28 vor "[Chorus 1]" in
  Nussschüsselblues. Das wird bei jeder Übernahme neu bestimmt: Wird der Text des Abschnitts davor länger, bekommt er
  die Noten zurück. Verteilt wird dabei immer vom Stand vor dem Schreiben aus: Ein zu langer Abschnitt rückt seine
  Silben Schlag für Schlag nach und füllt Lücken, wird er wieder gekürzt, stehen sie wie vorher.
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
- Instrument – Auswahlliste mit 13 Instrumenten (Schlagzeug nur bei einer Schlagzeugspur, nicht änderbar); es legt den
  Klang fest, die Notenlage ist für alle Spuren gleich (Tab, eine Oktave höher notiert). Der Tooltip nennt die
  Instrumente der Gruppe (z. B. Flöte: Querflöte, Blockflöte, Panflöte …). Liste: `docs/Instrumente.md`
- ↑/↓ – Reihenfolge der Spuren; so stehen sie im Notenblatt und im Player (der sortiert nicht um)
- ⧉ Spur duplizieren – Kopie direkt dahinter ("picking 2"), ohne Akkorde und Text
- ♪ Melodie ableiten – neue Spur "Melodie" (Instrument Gesang) als letzte Spur, aus dieser Spur, z. B. aus dem Fingerstyle: Wo
  in der Textspur eine Silbe steht, bleibt der höchste Ton des Schlags mit seiner Dauer; klingt er per Haltebogen in
  Schläge ohne Silbe weiter, bleibt die Fortsetzung. Alle anderen Schläge werden Pausen; aufeinanderfolgende Pausen werden zu möglichst wenigen zusammengefasst (in Takten mit Triolen oder
  Vorschlägen nicht), weitere Stimmen werden Pausen; Ghost Notes werden normale Töne. Der Text zieht in die neue Spur
  (`deriveMelodyTrack()` und `mergeRests()` in `js/notation.js`). Vorher fragt ein Dialog ("Höchste Töne mit Liedtext
  werden übernommen") mit dem Schalter "Tonhöhe mit Hilfe der Audiospur korrigieren" (an, wenn der Song eine Audiospur
  mit Sync-Punkten hat, sonst gesperrt, der Grund im Tooltip) und wie bei "Rhythmus ableiten" den Radiobuttons "Spur
  neu anlegen" (Vorgabe, als letzte Spur) bzw. "Spur überschreiben" (die Quellspur; Stelle, Name und Instrument bleiben,
  trug sie die Akkorde, ziehen sie mit). Mit Schalter behält die Melodie ihren Rhythmus, die Tonhöhe jeder
  Silbe kommt aus dem Gesang (`js/pitchdetect.js`, Ablauf dort im Kopf): Spektrum der Silbe minus Spektrum der
  nächsten Gesangspause mit demselben Akkord, Oberton-Summe im Stimmumfang; im Chorus stimmen alle Durchgänge an
  derselben Stelle ab; sonst werden nur Töne außerhalb der Tonart und Oktav-Ausreißer neu bestimmt, mit derselben
  Stelle der anderen Strophen. Die Melodie liegt auf den hohen Saiten (Mitte zwischen H3 und H4, jeder Ton auf der
  Saite mit dem kleinsten Bund). Ein Schritt für Rückgängig. Danach steht kurz "Melodie erfolgreich abgeleitet.";
  ging die Erkennung nicht ganz, eine Warnung mit dem Grund (die Spur bleibt), ohne Spur eine Warnung, warum keine
  angelegt wurde. Ohne Audiospur heißt der Grund beim Schalter "Keine Audiospur vorhanden.", ohne Sync-Punkte "Die
  Audiospur ist noch nicht mit den Noten synchronisiert." Das Auswerten dauert einige Sekunden
- Akkorde ableiten steckt im Dialog "Rhythmus ableiten": Schalter "Die Akkorde werden aus den Tönen der Spur
  bestimmt; sie ersetzen die bisherigen.", ist er an, darunter "Akkorde mit Hilfe der Audiospur korrigieren" (an, wenn
  der Song eine Audiospur mit Sync-Punkten hat, sonst gesperrt, der Grund im Tooltip). Beim Einschalten werden die
  Akkorde gleich abgeleitet (`songChordsFrom()` in `editor.js`); die Rhythmen richten sich dann nach ihnen (Teilen
  nach Akkorden, Warnungen) und beginnen wieder, wie sie in der Spur stehen. Übernehmen ersetzt zuerst alle Akkorde
  des Songs durch die abgeleiteten (`placeSongChords()`), dann folgt der Rhythmus, ein Schritt für Rückgängig.
  Akkorde, die der Song schon hatte, behalten ihren Griff, neue bekommen den einfachsten wie im Dialog "Akkord".
  Ablauf (`js/chorddetect.js`, im Kopf dort):
  je Zählzeit die Bewertung des Zauberstabs (Töne der Spur, Capo, Dreiklänge der Tonart und Akkorde des Songs), mit
  Audiospur dazu der Vergleich ihres Tonklassen-Spektrums (80 bis 700 Hz, nur Spitzen) mit der Schablone jedes
  Akkords; dann die beste Folge für den ganzen Song, jeder Wechsel kostet einen Abzug (auf der Eins weniger), so
  findet es auch Wechsel auf Schlag 4. Eine einstimmige Spur (weniger als ein Fünftel der Schläge mit mehreren Tönen,
  z. B. die Melodie) wird ohne Audiospur abgelehnt; mit Audiospur zählen ihre Töne weniger. Proben je Viertel (gleiche
  Töne = gleich): Begleitspuren 90 bis 100 %, mit Audiospur aus der Melodie 63 bis 80 %, ohne Audiospur aus der
  Melodie 27 bis 42 %.
- Rhythmus ableiten (Slash-Note) – Dialog (`js/rhythmdialog.js`): alle Rhythmen, die in dieser Spur vorkommen (je Takt
  aus den Anschlägen, gedämpft als x; die Richtung kommt nicht aus den Noten, sondern aus der Lage
  (`strumDirections()`), auch beim Shuffle: Die Hand pendelt, ab auf den Zählzeiten (Nenner der Taktart, bei 4/8 also
  jede Achtel), auf auf "+"; liegt ein Anschlag auf "e" oder "a", ab auf Zählzeit und "+", auf auf "e" und "a".
  Taktarten mit Dreiergruppen (6/8, 12/8): je Gruppe ab, ab, auf; mit Sechzehnteln dazwischen ab auf jeder Achtel,
  auf dazwischen), gleiche zusammengefasst,
  nummeriert, häufigste zuerst, je mit Rhythmushinweis, wo er gespielt wird (siehe "Regelwerk für
  Rhythmushinweis-Generierung" unten). Anschläge neben dem
  Sechzehntelraster (32tel, Triolen) fallen beim Ableiten ungefragt weg, der Rhythmus heißt dann "vereinfacht".
  - Jeder Rhythmus ist änderbar: Feld oder Klick ins Raster; ein Knopf wechselt das Raster ("in Sechzehnteln", "in
    Achteln"), liegen Anschläge auf Sechzehnteln dazwischen, heißt er "auf Achtel vereinfachen" und lässt sie weg.
    Wird er dabei gleich einem anderen, bleiben beide stehen (zusammengefasst wird nur beim Öffnen, mit dem Kreispfeil
    und ausdrücklich: "Rhythmus N übernehmen", "Ähnliche zusammenfassen").
  - "Rhythmen anhand der Abschnitte unterscheiden" (Schalter unter dem Infotext, beim Öffnen aus) teilt jeden Rhythmus
    nach Abschnittsgruppen ("Verse 1" und "Verse 2" sind "Verse", "Refrain" ist "Chorus"; Takte vor dem ersten
    Abschnitt: "Anfang";
    `splitBySections()`). Die Liste zeigt je Gruppe eine Überschrift mit Durchgängen und Takten, in der Reihenfolge
    des Songs, darunter ihre Rhythmen, häufigste zuerst; die Nummern laufen durch. So lässt sich der Rhythmus je
    Abschnitt ändern. Hinweis, "Ähnliche zusammenfassen" und "Rhythmus N übernehmen" gelten nur innerhalb der Gruppe.
    Lässt sich mit "Rhythmen anhand der Akkorde unterscheiden" kombinieren; Ausschalten fasst gleiche Rhythmen wieder
    zusammen. Eine Nummer am Namensende zählt als Wiederholung: "Pre-Chorus 1" und "Pre-Chorus 2" sind eine Gruppe
  - "Rhythmen anhand der Akkorde unterscheiden" (Schalter unter dem Infotext) teilt jeden Rhythmus nach den Akkorden im
    Takt, Namen und Stellen (`splitByChords()`); die Akkorde stehen über dem Raster an ihrem Platz, eine Zeile je
    Akkordfolge (nach "übernehmen" können es mehrere sein). Die Teile behalten ihren Rhythmus und lassen sich einzeln
    ändern.
    Zusammengefasst und verteilt wird dann nur bei gleichen Akkorden; "Rhythmus N übernehmen" legt die Takte immer in
    den anderen Rhythmus (angeboten werden die ähnlichsten, ein gleicher zuerst). Ausschalten fasst gleiche Rhythmen
    wieder zusammen. Ablauf: erst zusammenfassen, dann nach Akkorden unterscheiden und einzelne Teile ändern
    (Redemption Song: Takte mit einem Akkord "d.du.udu", mit Wechsel "d.dud.du")
  - "Ähnliche zusammenfassen": Jeder Rhythmus übernimmt den ersten häufigeren, dem er zu mindestens 75 % gleicht
    (gleiche Rasterplätze) und bei dem kein Anschlag eines Akkordwechsels wegfällt (`mergeSimilar()`); ausgegraut,
    wenn es nichts zusammenzufassen gibt.
  - "Rhythmus N übernehmen" bei ähnlichen (ab 75 % gleicher Rasterplätze), nur wo dabei kein Anschlag eines
    Akkordwechsels wegfällt; der Kreispfeil zeigt nach einer Änderung wieder die Rhythmen, wie sie in der Spur
    stehen.
  - Wechselt ein Akkord an einer Stelle, an der die Spur anschlägt, der Rhythmus aber nicht: rote Warnung, "Übernehmen"
    gesperrt (Akkorde werden nie verschoben). Schlägt auch die Spur dort nicht an (Haltebogen, Pause), ist es kein
    Fehler.
  - Übernehmen legt die Spur "Rhythmus" als erste Spur an (die Akkorde stehen oben; Akustikgitarre, Capo und Tuning
    der Spur) oder überschreibt die Spur, aus der er abgeleitet ist (Radiobuttons über "Übernehmen": "Spur neu
    anlegen", Vorgabe, oder "Spur überschreiben"). Die überschriebene behält Stelle, Name (damit Baustelle und Tab-Stellen),
    Instrument und Mixer-Einstellung; trug sie den Liedtext, zieht er mit. Je Anschlag der Griff des klingenden
    Akkords; beginnt ein Takt ohne Anschlag, klingt der letzte Anschlag davor übergebunden weiter (keine Pause); Ein-
    und Ausblenden der Quellspur kommen mit (an den Anschlag, der dort klingt); die Akkorde ziehen in diese Spur. Ein
    Schritt für Rückgängig. Ohne Katalog
- × löschen (mit Rückfrage; die letzte Spur bleibt)
- Spur hinzufügen – Gitarrenspur mit Tuning und Capo des Songs, mit leeren Takten
- Spur aus GuitarPro-Datei importieren – Datei wählen (gelesen und bereinigt wie beim Import), dann Spur, "Ab Takt der Datei" und "Auf
  Takt des Songs" (für ein anderes Intro). Die Spur kommt ans Ende, ohne Akkorde und Text; Taktart, Tempo,
  Vorzeichen, Capo, Tuning und Abschnitte bleiben die des Songs (die Spur wird umgerechnet, klingt gleich). Takte davor werden Pausen, was über das Ende hinausgeht, fällt weg; Takte, deren
  Länge nicht zur Taktart passt, nennt der Hinweis danach (am Cursor zeigt sie die Statuszeile: "Takt zu lang" bzw.
  "Takt zu kurz").

### Regelwerk für Rhythmushinweis-Generierung
Der Rhythmushinweis sagt, wo ein Rhythmus gespielt wird: im Dialog "Rhythmus ableiten" unter jedem Rhythmus, später
auch im Leadsheet. Die Regeln gelten in dieser Reihenfolge; die erste, die genau die Takte des Rhythmus trifft, liefert
den Text (`rhythmHint()` in `js/rhythmhint.js`, dort mit denselben Nummern). Ist der Rhythmus vereinfacht (Anschläge
neben dem Sechzehntelraster weggelassen), steht "vereinfacht" fett dabei. Mit "Rhythmen anhand der Abschnitte
unterscheiden" gelten die Regeln innerhalb der Abschnittsgruppe: Ihr häufigster Rhythmus mit Anschlägen heißt "Grundrhythmus für Verse" (auch als
einziger), sonst "ganzer Abschnitt" statt 1 und 2, der Rand als "letzter Takt jedes Durchgangs" bzw. "letzter Takt",
Anteile als "12 von 48 Takten".

1. Ganzer Song – alle Takte: "ganzer Song"
2. Abschnittsgruppen – alle Abschnitte der Gruppen, in denen er vorkommt, ganz ("Verse 1" und "Verse 2" sind "Verse"):
   "Verse, Chorus"
3. Taktmerkmale – alle Merkmale, die in seinen Takten gleich sind und zusammen genau sie treffen: Akkord am
   Taktanfang, Akkordwechsel mit Stelle (und Akkord, wenn er überall gleich ist), die Taktart nur, wenn sie zur
   Unterscheidung nötig ist; ein Takt ohne Wechsel wird nicht eigens erwähnt: "Takte mit C, Akkordwechsel zu G/B auf
   3", "Takte mit G", "Takt mit C, Akkordwechsel zu D auf 2+"
4. Abschnittsrand – erster bzw. letzter Takt der Abschnitte einer Gruppe: "letzter Takt jedes Abschnitts Chorus",
   "letzter Takt im Abschnitt Outro"
5. Grundrhythmus – der häufigste von mehreren Rhythmen, wenn er Anschläge hat: "Grundrhythmus"
6. Anteile – sonst die Gruppen, in denen er vorkommt, mit Anteil, wo er nur in einem Teil der Takte gilt: "Verse (12
   von 48 Takten), Chorus"

### Audio
- Der Sync-Editor (Wellenform mit Markern, Werkzeugleiste mit Icon-Knöpfen: Zoom, Sync-Punkt setzen, löschen,
  Zahlenfeld, Tempo bis zum nächsten Sync-Punkt, Tempo in der Partitur, unnötige Sync-Punkte entfernen, am Ende die
  Quelle) im Panel, ohne eigenes Speichern, Schließen und Rückgängig: Jede Änderung ist ein
  Schritt im Bearbeitungsmodus (Strg+Z, Speichern oben). Ohne Audiospur steht dort ein Hinweis. Abspielen beginnt am
  Cursor; beim Anhalten geht die Abspielposition (rote Linie in der Wellenform) gleich dorthin zurück. Der Knopf
  "Wiederholen" des Players wiederholt beim Bearbeiten die ausgewählten Takte (Strg+Umschalt+←/→, auch die Takte
  ausgewählter Schläge), ohne Auswahl den Takt am Cursor; der Bereich gilt ab dem nächsten "Play" bzw. der Leertaste
  (`applyLoop()`). Steht der Cursor darin, beginnt es am Cursor, sonst am Anfang des Bereichs. Zum Heraushören der
  Melodie: Takt auswählen, Tempo des Players herunter, Melodie- und Audiospur zusammen hören. Ein Klick in
  die Wellenform setzt den Cursor an diese Stelle, ebenso das Auswählen eines Markers (rote Linie und Cursor springen
  an seinen Takt). Zoomen stellt die rote Linie in die Mitte.
- Quelle – YouTube-URL ("Quelle", Tooltip "YouTube-URL"), Speichern-Knopf und "Clip suchen" (YouTube-Suche nach
  Interpret und Titel) stehen am Ende der Werkzeugleiste (`renderAudioSource()` in `library.js`, vom Bearbeitungsmodus
  mit `embed()` hineingesetzt); ohne Audiospur in einer eigenen Zeile. Gespeichert wird sofort, unabhängig von den
  Noten.
- Statuszeile – links Meldungen, rechts die Längen und der sichtbare Ausschnitt ("Partitur: 3:34 · Audiospur: 3:39 ·
  Zoom: 0:40"; Zoomstufen 5, 10, 20, 40 und 80 s und die ganze Audiospur). Die Länge der Partitur folgt jeder
  Änderung (auch Rückgängig), noch ungespeichert.
- Fahnen – jeder Marker hat oben eine Fahne mit der Taktnummer; ein Klick darauf wählt ihn aus. Die Fahne ist
  dunkelblau, ausgewählt gelb. Hat der Takt eine Tempoangabe in der Partitur (Takt 1 immer), ist sie schwarz, rot, wenn
  die Angabe nicht zum Tempo der Audiospur bis zur nächsten Tempoangabe passt (Mittel vom ersten bis zum letzten
  Sync-Punkt des Abschnitts, `recordingTempoRegion()` in `notation.js`). Tooltip "Takt 1: 00:35.205", bei
  Tempoangabe darunter "Tempo in der Partitur angegeben" bzw. "Tempo in der Partitur ungenau (bis zum Ende 173 BPM)"
  (mitten im Song "bis zur nächsten Tempoangabe"), wie am "!" neben dem Tempo im linken Panel.
- Sync-Punkt setzen – jeder Sync-Punkt markiert einen Taktanfang. Gesetzt wird er am Takt des Cursors, an der Stelle,
  die ihm gerade entspricht; danach schiebt man ihn zurecht. Im ersten Takt mit Noten kommt er dorthin, wo die
  Audiospur hörbar wird, Punkte davor fallen weg. Beginnt dieser Takt mit Pausen (kein Auftakt), liegt der Taktanfang
  um deren Dauer davor, gerechnet mit dem Tempo der Audiospur dort (ohne Sync-Punkte mit dem notierten;
  `firstBarStart()` in `playback.js`). Macht man Takt 1 später zum Auftakt, rückt sein Sync-Punkt mit an die erste
  Note (`shiftFirstSyncPoints()` in `notation.js`). Beginnt die Aufnahme mit Sprechen oder Geräuschen, liegt der Punkt
  zu früh und wird verschoben. Für das Ende setzt man einen Punkt im letzten Takt.
- Verschieben – ein Klick wählt einen Marker nur aus; ziehen lässt er sich mit gedrückter Umschalttaste (sonst
  verschöbe schon das Anklicken ihn). Ausgewählt verschieben ihn ←/→ um 10 ms, mit Umschalt um 1 ms.
- Zahlenfeld – mit ausgewähltem Marker "Takt 61 [11] ms": Ohne diesen Sync-Punkt begänne der Takt 11 ms früher (aus
  den anderen Punkten und dem notierten Tempo, wie die Wiedergabe rechnet; `fieldBase()`). Kleine Werte heißen: Der
  Punkt ist unnötig. Ändern verschiebt ihn sofort (höchstens bis an die Nachbarn). Ohne Auswahl "Spur [4760] ms", die
  Stelle des ersten Sync-Punkts; ändern verschiebt alle um die Differenz (etwa nach dem Wechsel auf einen anders
  geschnittenen Clip). Die Pfeile im Feld wirken sofort (100 ms), Getipptes mit Enter oder beim Verlassen.
  Aufeinanderfolgende Änderungen im Feld sind ein Schritt für Rückgängig. Die Beschriftung hat eine feste Breite,
  damit beim Wechsel des Markers nichts springt.
- Tempo bis zum nächsten Sync-Punkt – hinter dem Feld ("169 BPM", Viertel je Minute in der Audiospur): vom
  ausgewählten Sync-Punkt, ohne Auswahl vom letzten vor der roten Linie; leer am letzten Punkt.
- Tempo in der Partitur – ein Knopf, je nach Auswahl:
  - Sync-Punkt ohne Tempoangabe ausgewählt: "Tempo in der Partitur angeben" setzt in seinem Takt das Tempo der
    Audiospur bis zur nächsten Tempoangabe (`setRecordedTempo()` in `notation.js`). Ist es dasselbe wie davor,
    entsteht kein Wechsel. Der Abschnitt davor endet dann hier; passt seine Angabe nicht mehr, wird seine Fahne rot.
  - Sync-Punkt mit ungenauer Angabe (rote Fahne): "Tempo in der Partitur korrigieren", ebenso für diesen Abschnitt.
    Mit passender Angabe ist der Knopf gesperrt.
  - Nichts ausgewählt: "Alle Tempoangaben in der Partitur korrigieren" setzt jedes notierte Tempo auf das der
    Audiospur (je Abschnitt zwischen zwei Tempowechseln; `fitRecordedTempos()` in `notation.js`). Neue Tempowechsel
    setzt es nicht.
- Unnötige Sync-Punkte entfernen – lässt die Sync-Punkte weg, die die Wiedergabe mit den notierten Tempi auch so
  höchstens um 25 ms verfehlt (`TOLERANCE_MS` in `playback.js`); erster und letzter bleiben (`removeSyncPoints()` in
  `notation.js`). Die Statuszeile meldet z. B. "5 Sync-Punkte entfernt (größte Abweichung 24 ms)".

Rechts in der Kopfzeile des Panels die Statuszeile: "Takt zu lang" bzw. "Takt zu kurz" für den Takt am Cursor, sonst
leer. Ungespeicherte Änderungen zeigt der Speichern-Knopf: hervorgehoben und aktiv, ohne Änderung ausgegraut.

---

## Nur über die Tastatur bzw. Maus im Notenblatt, kein eigenes Bedienelement

- Cursor: Klick ins Notenblatt, ←/→ Schlag, ↑/↓ Saite, Pos1, Strg+Pos1, Ende, Strg+↑/↓ Spur
- Bund: Ziffern 0–24 (zwei Ziffern rasch nacheinander = zweistellig)
- Note löschen (Rücktaste)
- Auswahl von Takten: Strg+Umschalt+←/→ (taktweise), Strg+A alle Takte, Esc hebt sie auf; orange Flächen über den Takten (für Kopieren, Ausschneiden, Leadsheet-Tabs)
- Auswahl von Schlägen: Umschalt+←/→ (der Cursor geht mit), Umschalt+Klick (Umschalt halten, Anfang und Ende anklicken); Esc oder ein Klick hebt sie auf; orange Spalten. Notenwert, "+"/"-", Punktierung und Triole gelten dann für alle ausgewählten Schläge (bei Punkt und Triole bekommen alle den Zustand des Schlags am Cursor)
- Takte, deren Schläge nicht zur Taktart passen (je Stimme geprüft, leere Takte nicht; ein Auftakt gegen seine längste Spur, höchstens die Taktart), sind rot hinterlegt; das "!" oben links nennt beim Darüberfahren, wie viel fehlt oder zu viel ist, z. B. "1 Achtelschlag zu wenig" (`barLengthProblems()` in `notation.js`)
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
