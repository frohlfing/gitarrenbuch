# FFT

Die **FFT** (Fast Fourier Transform, schnelle Fourier-Transformation) zerlegt ein kurzes Stück Audio in die
Frequenzen, aus denen es besteht, und zeigt, wie stark jede vorkommt. Das Ergebnis heißt **Spektrum**. Das Gitarrenbuch
braucht sie für "Akkorde mithilfe der Audiospur korrigieren" und "Tonhöhe mithilfe der Audiospur korrigieren" (siehe
README).

## Die Idee

Eine Aufnahme ist für den Computer nur eine Folge von Lautstärkewerten über die Zeit (Wellenform). Daran sieht man
nicht, welche Töne klingen. Jeder Klang lässt sich aber als Summe vieler Sinusschwingungen verschiedener Frequenzen
darstellen; die Fourier-Transformation rechnet aus, wie stark jede dieser Frequenzen im Stück steckt.

Beispiele:

- Ein gesungenes A3 (220 Hz) zeigt im Spektrum eine Spitze bei 220 Hz und schwächere bei 440, 660, 880 Hz usw. (die
  Obertöne).
- Ein C-Dur-Akkord zeigt Spitzen bei den Frequenzen von C, E und G samt ihren Obertönen.

## Warum "schnell"

Die direkte Rechnung braucht bei N Messwerten etwa N² Schritte, die FFT nur etwa N · log₂ N. Bei 8192 Werten sind das
rund 100 000 statt 67 Millionen Schritte. Erst damit lässt sich ein ganzer Song im Browser auswerten.

## So nutzt das Gitarrenbuch sie

`spectrum()` in `public/js/lib/pitchdetect.js`, reines JavaScript ohne Bibliothek:

1. Die Audiospur wird in Mono mit 16 kHz dekodiert; das reicht für Gesang und Obertöne und spart Rechenzeit.
2. Der Zeitbereich (eine Silbe bzw. eine Zählzeit) wird in kurze, überlappende Fenster geschnitten: 2048 Samples
   (128 ms), alle 256 Samples ein neues. Für Akkorde sind die Fenster doppelt so lang, denn Akkorde klingen länger.
3. Jedes Fenster wird mit einem Hann-Fenster weich ein- und ausgeblendet. Harte Schnittkanten würden sonst Frequenzen
   vortäuschen, die gar nicht klingen.
4. Das Fenster wird mit Nullen auf 8192 Samples aufgefüllt. So liegen die Frequenzen im Spektrum rund 2 Hz auseinander
   statt 8 Hz; das ist wichtig, weil tiefe Töne nur wenige Hz auseinanderliegen (A2 = 110 Hz, B♭2 = 117 Hz).
5. Die Spektren aller Fenster des Zeitbereichs werden gemittelt.

Aus dem Spektrum liest das Gitarrenbuch dann ab:

- **Melodie:** welcher Ton mit seinen Obertönen am stärksten ist (`salience()`).
- **Akkorde:** welche Tonklassen (C, C#, …) zwischen 80 und 700 Hz am meisten Energie haben (`chroma()`).
