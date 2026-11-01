# Bearbeitungsmodus

Funktionen, wo und in welcher Reihenfolge sie angezeigt werden, mit Tastenkürzel (Stand 31.10.2026). Alle Felder und
Knöpfe sind umgesetzt; was noch fehlt, steht beim jeweiligen Punkt.

Aufteilung: In der **Werkzeugleiste** steht, was man beim Eintippen ständig braucht. **Links** steht alles, was an der
Position des Cursors hängt und nicht in der Werkzeugleiste liegt (wie die Palette in Guitar Pro). **Rechts** steht, was
am ganzen Song hängt und nicht unten platziert ist. **Unten** stehen Liedtext, Akkord-Editor, Spuren und Audio
(Sync-Editor), also was sich über den ganzen Song erstreckt.

Einschalten: Stift rechts in der Leiste, immer direkt (den Dialog "Vor dem Bearbeiten" gibt es nicht mehr).

**Meldungen** unter der Werkzeugleiste, je Abweichung eine Zeile mit Knopf, der sie behebt (nach jeder Änderung neu,
Rückgängig mit Strg+Z):
- Sprungzeichen (D.S., D.C., Coda, Fine) – "Wiederholungen und Sprünge ausschreiben"
- Capo ungleich (je Spur genannt) – "Capo angleichen": alle auf den Capo der Begleitspur, Klang bleibt
- Tonart: notiert X, erkannt Y – "Erkannte übernehmen"
- Akkorde auch außerhalb der Begleitspur – "Akkorde nach „…“ übertragen" (wie im Struktur-Editor)
- Spur ohne Rolle – "Spuren zeigen" (Reiter unten)

Zum Ausprobieren: Song "Test Struktur-Editor" (ungleicher Capo, Wiederholung mit Volta-Klammern, Segno, To Coda,
D.S. al Coda, Coda, D.C. al Fine, Fine; ausgeschrieben 13 → 25 Takte).

Icons: selbst gezeichnet (`public/js/icons.js`) oder Zeichen der Notenschrift Bravura, die alphaTab mitbringt
(Notenwerte, Vorzeichen, Ab-/Aufschlag, Violinschlüssel). Speichern, Rückgängig, Wiederholen: Material Icons.

## Werkzeugleiste (Toolbar)

### Ansicht
- Noten ein-/ausblenden (Violinschlüssel) – Tabs sind immer zu sehen

### Bearbeitung
- Speichern (Strg+S) – blau, solange etwas ungespeichert ist
- Rückgängig (Strg+Z)
- Wiederholen (Strg+Y)

### Noten
- Ganze bis 32tel (+ kürzer, - länger)
- Punktiert (.)
- Doppelt punktiert (Strg+.)
- Triole (/)
- Pause (R)
- Haltebogen (L)

### Schlag und Takt (Icons)
- Schlag einfügen (Strg+Einfg)
- Schlag löschen (Umschalt+Entf)
- Takt einfügen (Einfg)
- Takt löschen (Strg+Entf)

### Sonstiges
- Hilfe (?) – zeigt die Tastenkürzel
- Fertig – beendet den Bearbeitungsmodus (fragt bei Ungespeichertem nach)

## Linkes Panel "Am Cursor" (F2)

### Note
- Hammer-on / Pull-off (H)
- Slide (S)
- Bend (B) – Ganzton hochziehen und halten; nochmal entfernt ihn
- Vibrato (V)
- Saite dämpfen (X) (in Guitar Pro "Dead Note")

### Tonhöhe
- Kreuz (Strg+9)
- Be (Strg+7)
- Auflösungszeichen (Strg+8)
- Halbton höher (Alt+Umschalt+↑)
- Halbton tiefer (Alt+Umschalt+↓)

### Anschlag
- Abschlag (Umschalt+D)
- Aufschlag (Umschalt+U)
- Anschlagpfeil abwärts (Strg+D) – Pfeil nach oben: abwärts geschlagen heißt von der tiefen zur hohen Saite, und die
  hohe Saite steht oben
- Anschlagpfeil aufwärts (Strg+U) – Pfeil nach unten
- Arpeggio abwärts (Strg+Umschalt+D) – Wellenlinie, Pfeil nach oben
- Arpeggio aufwärts (Strg+Umschalt+U) – Wellenlinie, Pfeil nach unten

### Schlag
- Akkord (A) – Name, z. B. "C"
- Griff – z. B. "x32010", tiefe Saite zuerst; gilt für den Akkord in dieser Spur (eigene Griffe gehen beim Speichern
  der Bibliothek vor)
- (Das Feld "Liedtext-Silbe" ist entfallen: Der Text wird nur unten unter "Liedtext" geschrieben, dort ist die Silbe
  am Cursor hinterlegt.)
- Text über dem Schlag (T) – freier Text, z. B. "Picking Pattern"
- (Das Feld "Anschlag" ist entfallen, es gibt ihn schon unter "Anschlag".)

### Takt
- Abschnitt (Umschalt+Einfg), z. B. "Verse"
- Taktart ab diesem Takt, z. B. "3" / "4"
- Tonartwechsel ab diesem Takt – für Lieder, die mittendrin die Tonart wechseln (z. B. einen Halbton höher im letzten
  Refrain); die Tonart des ganzen Songs steht rechts
- Tempowechsel ab diesem Takt (BPM)
- Triolen-Feeling ab diesem Takt – alle sieben Arten wie in Guitar Pro (siehe rechts)
- Doppelter Taktstrich – zwei Striche am Ende des Takts, üblich am Ende eines Abschnitts (4 Songs haben welche)

## Rechtes Panel "Song" (F6)

### Noten
- Tonart – alle 15 Dur- und 15 Moll-Tonarten (Cb bis C#, Abm bis A#m)
- Erkannte Tonart übernehmen – Button; die erkannte steht darüber ("passt", wenn die notierte stimmt)
- Taktart – z. B. "4" / "4"
- Tempo (BPM)
- Tempo aus der Audiospur ermitteln – Button; braucht Sync-Punkte, rechnet alle Tempi im Verhältnis um
- Triolen-Feeling (Strg+/) – kein, Sechzehntel-Triolen, Achtel-Triolen (Shuffle), punktierte Sechzehntel, punktierte
  Achtel, Scottish Sechzehntel, Scottish Achtel (alle Arten von alphaTab und Guitar Pro)
- Capo (alle Spuren) – mit "Klang behalten" / "Griffe behalten"; bei ungleichem Capo darunter je Spur ein Feld und
  "Capo angleichen"
- Wiederholungen ausschreiben – Wiederholungen, Volta-Klammern, Sprungzeichen (D.C., D.S., D.S.S., al Coda,
  al Fine) und Takt-Wiederholungszeichen (Simile); mehrere Strophen an wiederholten Takten verteilen sich auf die
  Durchgänge, Sync-Punkte kommen an ihren Durchgang. Nach einem Sprung wird nicht mehr wiederholt, von
  Volta-Klammern gilt die letzte (wie üblich). Beispiel: "Für Elise" 25 → 45 Takte

### Songdaten
Das Formular "Songdaten" direkt im Panel (statt als Dialog), mit "Speichern" und "Zurücksetzen":
- Cover
- Titel
- Interpret
- Genre
- Quelle für Guitar-Pro-Datei
- Quelle für Audio-Datei (YouTube-Link)
- Notizen
- Akkorddatei (hochladen)

Ändern sich Titel oder Interpret, ändert sich der Slug; der Editor arbeitet mit dem neuen weiter.

## Unteres Panel (F8)

Die Höhe lässt sich am oberen Rand ziehen (gilt danach für alle Songs).

### Liedtext
- Textfeld mit dem Liedtext der Spur mit dem Text (Silben mit Bindestrich, z. B. "Frank-furt"); die Spur nennt der
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
  Akkorde" zeigen genau diese Zeilen. Vorher (und in Strophen ohne Umbrüche) ergeben sich die Zeilen aus Satzzeichen,
  Pausen und Abschnitten. Steht der ganze Text in einer Zeile ohne Abschnitte, gibt es keine Umbrüche mehr, und es
  wird wieder automatisch umbrochen.

### Akkorde
- Knöpfe für die Akkorde des Songs: Klick setzt den Akkord an den Schlag am Cursor
- Neuer Akkord: Name und Griff eingeben, "+ Akkord" legt ihn an und setzt ihn an den Cursor

### Spuren
Je Spur eine Zeile:
- Zeigen (Checkbox) – welche Spuren im Notenblatt stehen (vorher in der Leiste)
- Name – bei einer Rolle der Name der Rolle
- Rolle – keine, Gesang, Schlagbegleitung, Zupfbegleitung, Fingerstyle (jede nur einmal)
- Stimmung, z. B. "D A D G B E"; darunter "Klang behalten" (Bünde werden umgerechnet) / "Griffe behalten"
- Instrument (MIDI)
- Nach oben, nach unten, löschen (mit Rückfrage)
- Spur hinzufügen – Gitarrenspur in Standardstimmung mit leeren Takten

### Audio
- Der Sync-Editor wie außerhalb des Modus (Wellenform, Marker ziehen, Anfang/Ende erkennen, + Punkt, Punkt löschen,
  alle verschieben, Tempo anpassen, Zoom), aber im Panel und ohne eigenes Speichern, Schließen und Rückgängig: Jede
  Änderung ist ein Schritt im Bearbeitungsmodus (Strg+Z, Speichern oben). Ohne Audiospur steht dort ein Hinweis.

Rechts in der Kopfzeile des Panels die Statuszeile: "Takt zu lang" bzw. "Takt zu kurz" für den Takt am Cursor, sonst
leer. Ungespeicherte Änderungen zeigt der Speichern-Knopf: hervorgehoben und aktiv, ohne Änderung ausgegraut.

---

## Nur über die Tastatur bzw. Maus im Notenblatt, kein eigenes Bedienelement

- Cursor: Klick ins Notenblatt, ←/→ Schlag, ↑/↓ Saite, Pos1, Strg+Pos1, Ende, Strg+↑/↓ Spur
- Bund: Ziffern 0–24 (zwei Ziffern rasch nacheinander = zweistellig)
- Note löschen (Rücktaste)
- Auswahl: Umschalt+←/→ (taktweise), Strg+A alle Takte, Esc hebt sie auf; orange Flächen über den Takten
- Takt kopieren (Strg+C), ausschneiden (Strg+X, die Takte werden zu Ganztaktpausen), einfügen (Strg+V, ersetzt ab dem
  Takt am Cursor in dessen Spur, auch in einen anderen Song)
- Note auf eine andere Saite, gleicher Ton: Strg+Alt+↑/↓ oder mit der Maus senkrecht ziehen
- Note an eine andere Stelle ziehen (waagerecht, auch in einen anderen Takt der Spur): gleicher Ton, die Saite ist
  die, auf der man loslässt; der leere Schlag wird zur Pause
- Taktstrich ziehen (Zeiger ⇔ über dem Strich): in den Takt links oder rechts; die Schläge dazwischen wandern in den
  Nachbartakt (mit Silben und Akkorden), "Takt zu lang/kurz" zeigt die Statuszeile

---

## Shortcuts

Übernommen aus Guitar Pro 8 (https://www.guitar-pro.com/docs/gp8/appendix/shortcuts), soweit der Editor die Funktion
hat und der Browser die Taste nicht selbst belegt. Liste: `public/js/shortcuts.js`, Übersicht über "?".

Abweichungen:
- Taktart: ohne Tastenkürzel statt Strg+T (Strg+T öffnet im Browser einen Tab)
- Rechtes Panel (Song): F6 statt F5 (F5 lädt die Seite im Browser neu)
- Unteres Panel: F8 (in Guitar Pro die Gesamtansicht)
- Strg+Tab, Strg+W, Strg+N entfallen (belegt der Browser)
- Strg+D und Strg+U (Anschlagpfeile) belegt der Browser auch (Lesezeichen, Quelltext); im Bearbeitungsmodus fängt der
  Editor sie ab

---

## Nicht aus Guitar Pro übernehmen

Geprüft an den 42 Songs (30./31.10.2026). Was ein Song verwendet, bleibt beim Bearbeiten erhalten (alphaTex speichert
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

Im Editor statt in dieser Liste: Doppelter Taktstrich (links, Takt), Triolen-Feeling (links und rechts), Anschlagpfeile
und Arpeggio (links), Dead Note als "Saite dämpfen" (links).

---

## Bugs

1. ~~Wenn irgendetwas in der Partitur verändert wird, springt der Cursor zum Takt 1, Schlag 1.~~ Behoben (31.10.2026):
   Der Cursor des Editors blieb stehen, aber nach jedem Neuzeichnen setzte alphaTab die Abspielposition auf den Anfang,
   und der Player rollte dorthin. Im Bearbeitungsmodus rollt der Player jetzt nur noch beim Abspielen.
2. ~~Der Lautstärke-Dialog positioniert sich über das untere Bearbeitungspanel statt direkt über den
   Lautstärke-Knopf.~~ Behoben (31.10.2026): Er steht wieder direkt über dem Knopf (über dem Panel).
