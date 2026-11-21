# Akkorddialog

Das ist das Regelwerk für den Akkorddialog, geprüft gegen chordgrips.js, chordtheory.js und editor.js. 

## 1. Name

- Gültigkeit: Der Name muss sich nach den Regeln der Akkordtheorie lesen lassen (parseChord(), Tabellen in        
  docs/Musiktheorie.md). Sonst steht „Dieser Akkordname ist unbekannt.“ und „Übernehmen“ ist aus.
- Stern: Ein Stern am Ende wird ignoriert (zweite Griffvariante im Song).
- Vorschläge: Beim Tippen entstehen sie nur aus den Regeln (alle Akkordarten, nicht nur die gängigen), nie aus    
  Song oder Katalog. Vor dem ersten Zeichen ist die Liste leer. Nach einem „/“ kommen zuerst die Basstöne, die zum
  Akkord passen.
- Töne: Unter dem Namen stehen die Töne des Akkords in der richtigen Schreibweise („Töne: F# A C# E“).

## 2. Die Griffe zum Namen, in dieser Reihenfolge

1. Katalog, so wie er nach dem Speichern wäre: Häufigkeit aus den Songs, dazu der Griff, den dieser Song für den  
   Namen hat (er zählt mit seinen Schlägen). Bei Gleichstand der weiter unten am Hals. Nur im Standard-Tuning.
2. Berechnete Griffe (findGrips()) nach Priorität, mit Priorität 1 und 2 immer.
3. Priorität 3 und 4 nur, um die erste Reihe von sechs Diagrammen zu füllen: erst Priorität 3, dann 4 (nicht      
   zusammengelegt).
4. Mindestens 6, höchstens 24 Griffe (vier Reihen). Die letzte Reihe muss nicht voll sein.

## 3. Was für jeden berechneten Griff gilt

- Es klingen nur Töne des Akkords, die nötigen kommen vor. Bei einem Slash-Akkord ist der Basston der Ton der     
  tiefsten gespielten Saite.
- Höchstens drei Bünde Spanne (Bund 2 bis 4), höchstens vier Finger.
- Barré: ab vier gegriffenen Saiten. Der Zeigefinger liegt im tiefsten gegriffenen Bund und deckt von seiner      
  tiefsten Saite an alle höheren bis einschließlich der e-Saite ab. Er zählt als ein Finger. Bei mehr als vier    
  Saiten ist es nötig, bei genau vier wird es angewendet, wenn es möglich ist. Eine leere oder abgedämpfte Saite  
  über dem Barré gibt es dabei nicht. Das Griffbild zeichnet den Balken genauso.
- Gibt es so keinen Griff, wird gelockert: erst vier, dann fünf Bünde, dann ohne die Töne, die den Akkord nicht   
  bestimmen (Quinte, Sexte, Erweiterungen, zusätzliche Töne). So gibt es immer mindestens einen Griff.            

## 4. Die Prioritäten

1. Priorität 1: ohne Umkehrung (Grundstellung, also der Ton der tiefsten gespielten Saite ist der Grundton, bei einem 
   Slash-Akkord der Basston), aufsteigend (die Tonhöhe fällt von der tiefsten zur höchsten gespielten Saite nie), 
   durchschlagbar von der tiefsten gespielten Saite bis einschließlich der e-Saite, mindestens vier Saiten. Bei 
   Zweiklängen wie C5 genügen drei Saiten ohne Lücke, die hohen Saiten dürfen schweigen.
2. Priorität 2: ohne Umkehrung, aufsteigend und ohne Lücke (zwischen den gespielten Saiten fehlt keine), aber Prio 1 
   nicht erfüllt, weil die e-Saite schweigt oder weniger als vier Saiten klingen.
3. Priorität 3: Umkehrung oder nicht aufsteigend, ohne Lücke.
4. Priorität 4: eine Saite zwischen den gespielten ist abgedämpft.

## 5. Reihenfolge innerhalb einer Priorität

1. je näher am Bund 0 (tiefster gegriffener Bund), desto besser,
2. weniger Bünde (Spanne),
3. weniger Finger (vier Finger ohne Barré zuletzt),
4. mehr gespielte Saiten.

## 6. Griff im Feld und Warnung

- Das Griffbild zeigt immer den Griff im Feld. Bei jeder Namensänderung wird der erste Griff der Liste eingetragen, die 
  weiteren sind anklickbar. Ein Griff muss genau so viele Angaben haben wie die Spur Saiten, Bünde 0 bis 24 oder x, 
  mindestens eine gespielte Saite.
- Rote Warnung, wenn der Griff im Feld nicht zum Namen passt: „Der Griff passt nicht zu Am. Er klingt wie A6sus4/D.“ 
  Bis zu drei Namen, rot als Knöpfe, ein Klick übernimmt den Namen. Solange die Warnung steht, ist „Übernehmen“
  gesperrt: Ein Griff muss zu seinem Namen passen.
- Hat der Name im Song schon einen anderen Griff, steht rot „Der neue Griff gilt für alle Stellen“.
- Überschrift: „Akkord hinzufügen“ bzw. „Akkord bearbeiten“.

## 7. Außerhalb des Dialogs

Die Hinweisliste im Editor meldet unbekannte Akkordnamen und Griffe, die nicht zum Namen passen, auch nach einem 
Import.

