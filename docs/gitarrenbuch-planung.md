# Gitarrenbuch

> **Planungsstand.** Dieses Dokument ist als späteres `README.md` gegliedert, in derselben Kapitelreihenfolge wie bei [kochbuch](https://github.com/frohlfing/kochbuch) und [videothek](https://github.com/frohlfing/videothek). Planungsnotizen (Entscheidungen, offene Punkte, Quellen) stehen im Anhang am Ende.

Persönliches Gitarrenbuch: eine Sammlung von Liedern, die ich **allein mit der Gitarre** spiele und singe (nicht für Bandbesetzung). Das Projekt ist eine kleine PHP/JSON-API mit einem statischen Frontend und ohne Datenbankserver. Alle Daten liegen als Dateien unter `data/`.

Funktionen:
- GP-Files (Guitar Pro 3–8) anzeigen, abspielen und bearbeiten (mit [alphaTab](https://alphatab.net))
- Synth und Audiospur gleichzeitig hören, mit getrennter Lautstärke
- Noten und Audio synchronisieren
- Import von Ultimate Guitar (GP-Files und Akkordblätter) aus dem eingeloggten Browser
- Privatkopie von YouTube als Audio (lokal, portabel, mono komprimiert)
- Aufbereitetes Leadsheet zum Ausdrucken auf einer DIN-A4-Seite

URLs:
- Produktiv (Hetzner): `https://gitarrenbuch.frank-rohlfing.de/`
- Lokal (XAMPP): `https://gitarrenbuch.test/`

---

## Voraussetzungen

- PHP 8.5 oder neuer, mit `zip` (für GP-Dateien, das sind ZIP-Archive)
- Webserver mit `public/` als Document Root
- Kein Datenbankserver
- Optional curl (`fetch.php` nutzt curl, sonst `file_get_contents()` als Fallback)
- Nur lokal für die Audio-Werkzeuge in `bin/`: `yt-dlp` und `ffmpeg`. Beides ist im portablen Paket enthalten, siehe [Audio von YouTube holen](#audio-von-youtube-holen).
- Frontend: reines JavaScript mit ES-Modulen, ohne Bundler und ohne Build-Schritt. alphaTab liegt mitgeliefert unter `public/vendor/`.

---

## Setup

1. `config.example.php` nach `config.php` kopieren und anpassen.
2. API-Token erzeugen und in `config.php` als `API_TOKEN` eintragen, zum Beispiel mit `php -r "echo bin2hex(random_bytes(32));"`.
3. Webserver einrichten, mit `public/` als Document Root für `gitarrenbuch.frank-rohlfing.de`.
4. HTTP Basic Auth einrichten:
   - `.htpasswd` im Projektroot anlegen (`htpasswd -c .htpasswd frank`).
   - `public/.htaccess.example` nach `public/.htaccess` kopieren und den Pfad zur `.htpasswd` eintragen.
5. MIME-Typen sind in `.htaccess.example` bereits gesetzt: `.gp`, `.gp5`, `.gpx` und `.sf2` als `application/octet-stream`.
6. `https://gitarrenbuch.frank-rohlfing.de/` aufrufen.

`config.php`, `.htpasswd` und `public/.htaccess` sind gitignored und werden auf jedem Rechner separat angelegt.

---

## Lokalen Testserver unter XAMPP (Windows) einrichten

Das funktioniert wie beim Kochbuch, nur mit dem Hostnamen `gitarrenbuch.test`.

1. **Hosts-Datei:** Als Administrator `127.0.0.1 gitarrenbuch.test` in `C:\Windows\System32\drivers\etc\hosts` eintragen.
2. **SSL-Zertifikat:** Mit `openssl` im XAMPP-Apache-Ordner ein selbstsigniertes Zertifikat für `gitarrenbuch.test` erzeugen (10 Jahre gültig).
3. **VirtualHost:** In `httpd-vhosts.conf` je einen Block für Port 80 und Port 443 anlegen. `DocumentRoot` zeigt auf `…/gitarrenbuch/public`, dazu Zertifikat und Schlüssel sowie `AllowOverride All`. Optional die LAN-IP als `ServerAlias` eintragen, um vom Handy aus zu testen.
4. **Browser-Vertrauen:** Das Zertifikat in den Windows-Zertifikatsspeicher unter „Vertrauenswürdige Stammzertifizierungsstellen“ importieren, dann Apache und Browser neu starten.
5. `https://gitarrenbuch.test/` aufrufen.

HTTPS ist auch lokal nötig. Die Web-Audio-Funktionen und das Bookmarklet (Aufruf von der HTTPS-Seite von Ultimate Guitar) brauchen einen sicheren Kontext.

---

## Abgleich mit dem Server

Wie bei der Videothek gibt es auf dem Hosting kein Terminal. Audio entsteht lokal (YouTube, Extraktion aus GP-Dateien), deshalb gleicht `bin/remote.php` den Ordner `data/` per MD5-Vergleich ab:

```
php bin/remote.php --download-data   # Server → lokal
php bin/remote.php --upload-data     # lokal → Server (z. B. neue audio.mp3)
```

`orig/youtube.*` (unkomprimiertes Audio) wird nicht abgeglichen und bleibt nur lokal. Alle anderen Dateien in `orig/` sind klein und werden normal abgeglichen.

Auf dem Server antwortet `public/dev/sync.php` und ist durch API-Token und Basic Auth geschützt.

---

## Projektstruktur

```
gitarrenbuch/                         # Projektroot
 ├── data/                            # Außerhalb des Document Root, kein direkter Browser-Zugriff möglich
 │    ├── cache/sync_md5.json         # MD5 je Datei für den Abgleich
 │    ├── chords.json                 # Akkordbibliothek: Griffe + Kennzeichen „gängig“ (kein Diagramm im Leadsheet)
 │    └── songs/                      # Ein Unterordner pro Lied
 │         └── <slug>/                # Slug aus Interpret + Titel, z. B. "cat-stevens-father-and-son"
 │              ├── song.json         # Daten (Titel, Interpret, Tonart, Capo, Tags, Quellen-URLs, ...)
 │              ├── song.cho          # Text mit Akkorden, Abschnitte, Akkorddefinitionen (ChordPro, vom Editor geschrieben)
 │              ├── score.gp          # Noten, Tabs, Liedtext und Akkordsymbole an den Schlägen (vom Editor geschrieben, ohne Audiospur)
 │              ├── audio.mp3         # Begleitspur, mono komprimiert (optional)
 │              ├── sync.json         # Sync-Punkte Noten ↔ Audio
 │              ├── leadsheet.json    # Druckinfos: Begleitmuster, Tab-Verweise, Layout
 │              └── orig/             # Rohmaterial: beliebig viele Quelldateien, werden nie verändert
 │                   ├── score.gp     # z. B. Original-GP-Datei (ggf. mit Audiospur)
 │                   ├── ug.json      # z. B. UG-Akkordblatt vom Bookmarklet
 │                   ├── *.cho, *.txt # z. B. Text oder ChordPro aus anderen Quellen
 │                   └── youtube.<ext> # Unkomprimiertes YouTube-Audio (bleibt lokal, wird nicht abgeglichen)
 ├── bin/                             # Skripte für die Kommandozeile (lokal, php bin/…)
 │    ├── build_audio_portable.cmd    # audio.php samt PHP, yt-dlp und ffmpeg als Paket für einen anderen Rechner (<Zielordner>)
 │    ├── audio.php                   # YouTube → audio.mp3; eingebettete GP-Audiospur → audio.mp3 + sync.json
 │    └── remote.php                  # Abgleich mit dem Server: --download-data, --upload-data
 ├── public/                          # Document Root
 │    ├── api/                        # API-Endpunkte
 │    │    ├── lib/                   # Gemeinsam genutzte Hilfsfunktionen der API-Endpunkte
 │    │    │    ├── crud.php          # Read/Write/Rename/Delete-Logik + Validierung (create_song())
 │    │    │    ├── fetch.php         # http_get(): curl, sonst file_get_contents()-Fallback
 │    │    │    ├── file_store.php    # GP-/Audio-Dateien speichern und ausliefern (inkl. HTTP-Range)
 │    │    │    ├── gp_file.php       # GP-Datei (ZIP) prüfen, Audiospur + Sync-Punkte herauslösen
 │    │    │    ├── http.php          # JSON-Response-Helper
 │    │    │    ├── jsonfile.php      # Kleine JSON-Dateien lesen und unter Sperre ändern
 │    │    │    ├── slug.php          # slugify() + Eindeutigkeits-Check
 │    │    │    ├── sync.php          # Abgleich von data/: Dateiliste mit MD5, Datei schreiben
 │    │    │    └── importers/        # Registry für Rohmaterial (Muster wie parsers/ im Kochbuch): ablegen + Metadaten
 │    │    │         ├── SongImporterInterface.php
 │    │    │         ├── GpFileImporter.php           # GP-Datei ablegen, Audiospur + Sync-Punkte herauslösen
 │    │    │         ├── TextImporter.php             # .cho/.txt bzw. eingefügten Text ablegen
 │    │    │         └── UltimateGuitarImporter.php   # Daten vom Bookmarklet als ug.json ablegen
 │    │    ├── audio.php              # Liefert audio.mp3 (mit Range-Support für Seeking)
 │    │    ├── chords.php             # Akkordbibliothek lesen und schreiben
 │    │    ├── import.php             # Import über die Registry (Upload oder Bookmarklet, CORS für UG)
 │    │    ├── leadsheet.php          # leadsheet.json lesen und schreiben
 │    │    ├── lyrics.php             # song.cho lesen und schreiben (text/plain)
 │    │    ├── score.php              # GP-Datei lesen und schreiben (binär)
 │    │    ├── songs.php              # Lieder lesen, anlegen, bearbeiten, löschen
 │    │    ├── sync.php               # Sync-Punkte lesen und schreiben
 │    │    └── upload.php             # Rohmaterial-Upload nach orig/ (GP, ChordPro, Text, Audio)
 │    ├── dev/                        # Admin-/Wartungsskripte – NICHT dauerhaft auf dem Produktivserver lassen
 │    │    ├── info.php               # phpinfo()
 │    │    ├── mixer-test.html        # PoC: Synth + Audiospur parallel, Gleichlauf messen
 │    │    └── sync.php               # Für bin/remote.php: data/ abgleichen
 │    ├── js/                         # ES-Module des Frontends (ohne Bundler, von app.js importiert)
 │    │    ├── editor/                # Editor für Text, Akkorde, Noten und Tabs
 │    │    │    ├── editor.js         # Rahmen: Ansichten, Laden, Speichern, Undo/Redo
 │    │    │    ├── model.js          # Gemeinsames Song-Modell (Score + Abschnitte, Zeilen, Silben, Akkorde, Muster)
 │    │    │    ├── lyrics-view.js    # Ansicht Text & Akkorde (Akkorde über Silben, verschiebbar)
 │    │    │    ├── score-view.js     # Ansicht Noten & Tabs (Bearbeitung auf alphaTab)
 │    │    │    └── patterns-view.js  # Schlag-/Picking-Muster, Tab-Verweise
 │    │    ├── import/                # Aufbereitung des Rohmaterials (im Browser)
 │    │    │    ├── align.js          # Text/Akkorde aus Akkordblatt oder Textdatei den Noten zuordnen
 │    │    │    ├── chordpro.js       # ChordPro lesen und schreiben
 │    │    │    ├── gp.js             # GP-Datei (über alphaTab) → Teilmodell
 │    │    │    ├── merge.js          # Teilmodelle zusammenführen, unsichere Stellen markieren
 │    │    │    ├── text.js           # Akkordblatt-Text (Akkorde über Text) → Teilmodell
 │    │    │    └── ug.js             # ug.json → Teilmodell
 │    │    ├── leadsheet.js           # Leadsheet rendern + A4-Fit-Loop
 │    │    ├── library.js             # Liederliste, Suche, Tags
 │    │    ├── mixer.js               # Synth + Audiospur parallel, Gleichlauf über Sync-Punkte
 │    │    ├── player.js              # alphaTab-Wrapper: Transport, Tempo, Loop, Spuren
 │    │    ├── svg.js                 # Akkorddiagramm, Schlagmuster, Picking-Muster als SVG
 │    │    └── sync-editor.js         # Wellenform + verschiebbare Sync-Marker
 │    ├── templates/leadsheet.html    # <template>-Bausteine für das Leadsheet
 │    ├── vendor/alphatab/            # alphaTab (Coderline, MPL-2.0) inkl. Fonts und SoundFont
 │    ├── .htaccess                   # Apache Zugriffsschutz
 │    ├── .htaccess.example           # Vorlage für Apache Zugriffsschutz
 │    ├── app.css                     # CSS-Styles für das Frontend
 │    ├── app.js                      # JavaScript für das Frontend (Einstieg, Routing)
 │    ├── bookmarklet.js              # Läuft auf der Ultimate-Guitar-Seite, schickt Daten an /api/import.php
 │    ├── favicon.svg                 # Browser-Tab-Icon (Gitarre)
 │    ├── index.html                  # Frontend (lädt/schreibt ausschließlich über /api/*)
 │    └── print.css                   # Druck-Layout für das Leadsheet (@page A4)
 ├── .gitignore                       # Vom Git-Repository auszuschließende Dateien
 ├── .htpasswd                        # Apache Passwortdatei (nicht im Git-Repository)
 ├── types/alphatab.d.ts              # Nur für die IDE: Typen von alphaTab (nicht deployen)
 ├── config.example.php               # Vorlage für config.php
 ├── config.php                       # Zentrale Konfigurationsdatei (nicht im Git-Repository)
 ├── LICENSE                          # Lizenzhinweis
 └── README.md                        # Landingpage für das Git-Repository
```

> Abweichung von Kochbuch und Videothek: Neben `app.js` gibt es den Ordner `public/js/` mit ES-Modulen, weil Player, Mixer, Sync-Editor, Editor, Aufbereitung und Leadsheet zusammen zu groß für eine Datei werden. Einen Bundler braucht es nicht, die Browser laden die Module nativ.

### Admin-/Dev-Skripte (`public/dev/`)

Diese Skripte dienen der Wartung, Diagnose und Machbarkeitsprüfung. Nach Gebrauch werden sie vom Produktivserver gelöscht. `sync.php` bleibt nur, solange `bin/remote.php` gebraucht wird.

---

## API

Lesende Endpunkte sind offen und durch Basic Auth geschützt. Schreibende Endpunkte (`POST`/`PUT`/`DELETE`) verlangen zusätzlich den Header `X-API-Token`.

| Endpunkt | Methoden | Zweck |
|---|---|---|
| `api/songs.php` | GET, POST, PUT, DELETE | Lieder (Liste, einzeln, anlegen, ändern, löschen) |
| `api/score.php?slug=` | GET, PUT | GP-Datei (binär) |
| `api/audio.php?slug=` | GET | Audio mit Range-Support |
| `api/sync.php?slug=` | GET, PUT | Sync-Punkte |
| `api/lyrics.php?slug=` | GET, PUT | Text mit Akkorden (`song.cho`, `text/plain`) |
| `api/leadsheet.php?slug=` | GET, PUT | Druckinfos (Muster, Tab-Verweise, Layout) |
| `api/chords.php` | GET, PUT | Akkordbibliothek |
| `api/upload.php` | POST | GP- oder Audio-Upload |
| `api/import.php` | POST | Import über die Registry (Datei oder Bookmarklet-Daten) |

### Schema `song.json` (Entwurf)

```json
{
  "title": "Father and Son",
  "artist": "Cat Stevens",
  "key": "G",
  "capo": 0,
  "tuning": "E A D G B E",
  "tempo": 116,
  "technique": "strumming",
  "tags": ["70er", "Lagerfeuer"],
  "sources": {
    "ultimateGuitar": "https://tabs.ultimate-guitar.com/tab/…",
    "youtube": "https://www.youtube.com/watch?v=…"
  },
  "files": { "score": true, "audio": true, "sync": true, "leadsheet": true },
  "created": "2026-10-25",
  "updated": "2026-10-25"
}
```

### Schema `sync.json` (Entwurf)

Das Format folgt alphaTab: Takt (Masterbar), Wiederholung, relative Position im Takt und Millisekunde im Audio.

```json
{
  "audioOffsetMs": 0,
  "points": [
    { "bar": 0, "occurrence": 0, "ratio": 0,     "ms": 0 },
    { "bar": 1, "occurrence": 0, "ratio": 0.666, "ms": 4075 }
  ]
}
```

### Format `song.cho` (ChordPro)

Text, Akkorde und Abschnitte stehen im Standardformat [ChordPro](https://www.chordpro.org). Der Editor schreibt die Datei **bei jedem Speichern komplett neu** (siehe [Editor](#editor)). Weil es eine reine Textdatei ist, bleibt sie trotzdem lesbar, mit anderen Songbook-Apps austauschbar und notfalls von Hand änderbar. Der Editor erkennt solche Änderungen beim nächsten Öffnen.

```
{define: Fmaj7 base-fret 1 frets x x 3 2 1 0 fingers 0 0 3 2 1 0}

{start_of_tab: label="Intro" id="intro"}
{end_of_tab}

{start_of_verse: label="Strophe 1" id="s1"}
{x_pattern: strophe}
[Am]Erste Zeile mit [F]Text
[C]Zweite [G]Zeile
{end_of_verse}

{start_of_chorus: label="Refrain" id="r1"}
{x_pattern: refrain}
[F]Refrain[G]zeile [Am]eins
{end_of_chorus}

{start_of_verse: label="Strophe 2" id="s2"}
{x_pattern: strophe}
[Am]…
{end_of_verse}

{chorus: Refrain (2×)}

{start_of_tab: label="Solo" id="solo"}
{end_of_tab}

{start_of_grid: label="Outro" id="outro"}
| Am . . . | F . . . | C . . . | G . . . |
{end_of_grid}
```

- **Abschnitte** über die ChordPro-Direktiven `start_of_verse`, `start_of_chorus`, `start_of_tab`, `start_of_grid` mit `label`. Das Attribut `id` ist eine eigene Ergänzung und verknüpft den Abschnitt mit `leadsheet.json`.
- **`{chorus}`** wiederholt den letzten Refrain nur als Verweis. Das ist Standard-ChordPro und spart Platz auf dem Blatt.
- **`{define}`** enthält nur Griffe, die von `data/chords.json` abweichen oder dort fehlen.
- **`{x_pattern}`** ordnet einem Abschnitt ein Begleitmuster aus `leadsheet.json` zu. Eigene Direktiven beginnen laut ChordPro-Standard mit `x_` und werden von anderen Programmen ignoriert.
- **Tab-Abschnitte** bleiben leer, wenn die Takte aus der GP-Datei kommen (Verweis in `leadsheet.json`). Ein von Hand geschriebener ASCII-Tab darf aber auch direkt drinstehen.
- **Keine Metadaten-Direktiven** (`{title}`, `{capo}` …): Titel, Tonart, Capo usw. stehen nur in `song.json`. Beim Export einer `.cho`-Datei werden sie ergänzt.

### Schema `leadsheet.json` (Entwurf)

Enthält nur, was ChordPro nicht abbilden kann: Begleitmuster, Tab-Verweise auf die GP-Datei und das Layout.

```json
{
  "version": 1,
  "notes": "Strophe gedämpft, Refrain voll",
  "patterns": {
    "strophe": {
      "technique": "fingerpicking",
      "grid": "8",
      "steps": "B 3 B2 2 B 3 B2 2",
      "fingers": "p i p m p i p m"
    },
    "refrain": {
      "technique": "strumming",
      "grid": "8",
      "strokes": "D.DU.UDU",
      "accents": [0, 4]
    }
  },
  "tabs": {
    "intro": { "source": "gp", "track": 0, "startBar": 1, "barCount": 4 },
    "solo":  { "source": "alphatex", "code": "…" }
  },
  "layout": {
    "columns": "auto",
    "fontPt": { "max": 12, "min": 7 },
    "diagrams": "rare",
    "diagramPosition": "top",
    "showPatternsAt": "section",
    "collapseRepeats": true
  }
}
```

- Die Schlüssel in `tabs` sind die `id`s der Tab-Abschnitte in `song.cho`.
- `diagrams`: `"rare"` zeigt nur Akkorde, die nicht als gängig markiert sind, `"all"` zeigt alle, `"none"` keine.
- Wird ein Abschnitt umbenannt oder gelöscht, hält der Editor `tabs` und Musterzuordnungen konsistent und meldet Muster, die niemand nutzt.

---

## Frontend / Arbeitsweise

### Request-Ablauf beim Seitenaufruf

1. `index.html`, `app.css` und `app.js` werden geladen, `app.js` importiert die Module aus `js/`.
2. `GET api/songs.php` lädt die Liederliste.
3. Beim Öffnen eines Lieds folgen `GET api/score.php` und `GET api/sync.php`. Erst für die Leadsheet-Ansicht kommen `GET api/lyrics.php` und `GET api/leadsheet.php` dazu. Das Audio streamt das `<audio>`-Element selbst über `api/audio.php`, mit Range-Requests beim Spulen.
4. alphaTab und der SoundFont werden erst geladen, wenn ein Lied geöffnet wird (Lazy Loading). Der Browser cacht beides lange.

### Token-Authentifizierung

Wie bei Kochbuch und Videothek fragt das Frontend beim ersten Schreibzugriff nach dem API-Token und speichert es im `localStorage`. Lehnt der Server das Token ab, wird es gelöscht und erneut abgefragt. Das Bookmarklet bekommt das Token einmalig beim Erzeugen eingebaut.

### Notenansicht und Wiedergabe

- alphaTab rendert Noten und Tabs, der eingebaute Synthesizer spielt mit einem SoundFont ab.
- Übe-Funktionen: Tempo ändern, Loop über einen Taktbereich, Spuren stumm oder solo schalten, Metronom und Vorzähler.

### Mixer: Synth und Audiospur

In Guitar Pro 8 lassen sich Synth und Audiospur gleichzeitig hören. **alphaTab kann das nicht**, dort ersetzt die Audiospur den Synthesizer. Das Modul `mixer.js` löst das mit zwei parallelen Wiedergabewegen:
1. alphaTab läuft im normalen Synth-Modus.
2. `audio.mp3` läuft in einem eigenen `<audio>`-Element bzw. Web-Audio-Knoten.
3. Anhand der Sync-Punkte rechnet `mixer.js` die Synth-Zeit (Positionsereignis von alphaTab) in Audio-Zeit um. Weicht die Audiospur mehr als etwa 30–50 ms ab, wird nachjustiert.
4. Lautstärke ist für Synth und Audio getrennt regelbar, jeder Weg lässt sich stummschalten.
5. Langsamer üben: Das Audio läuft mit `playbackRate` und `preservesPitch` parallel zum alphaTab-Tempo.

Die Gleichlaufgenauigkeit wird zuerst mit `dev/mixer-test.html` geprüft.

### Audio-Sync

- Bei importierten GP-Files mit Audiospur werden die Sync-Punkte beim Import nach `sync.json` übernommen.
- Bei YouTube-Audio werden die Sync-Punkte im Sync-Editor gesetzt: Wellenform plus verschiebbare Marker. Als Vorbild dient der „Media Sync Editor“ im alphaTab-Playground. Beim Laden des Audios entstehen automatisch Startpunkt, Endpunkt und Punkte an Tempowechseln.

### Editor

Ein Editor für alles: **Text, Akkorde, Noten und Tabs** eines Lieds in einer Oberfläche.

**Ansichten** (umschaltbar oder nebeneinander):
- **Text & Akkorde:** Zeilen mit Akkorden über den Silben. Akkorde lassen sich per Drag & Drop verschieben und per Tastatur einfügen. Hier werden auch Abschnitte angelegt und Muster zugeordnet. Die Darstellung entspricht weitgehend dem späteren Leadsheet.
- **Noten & Tabs:** alphaTab-Darstellung mit Cursor. Bearbeitet werden Bünde, Dauer und Effekte, Takte lassen sich einfügen und löschen. alphaTab bringt keinen Editor mit, das ist der größte Eigenanteil.
- **Muster:** Schlag- und Picking-Muster sowie Tab-Verweise für Intro und Solo.

**Kopplung:** Sind Noten vorhanden, hängen Silben und Akkorde an Schlägen der GP-Datei. Ein Klick auf eine Silbe setzt den Cursor auf die zugehörige Note und umgekehrt. Ein geänderter Akkord erscheint sofort in beiden Ansichten, und beim Abspielen läuft die Markierung in beiden mit.

**Song-Modell (`model.js`):** Alle Ansichten arbeiten auf einem gemeinsamen Modell: der alphaTab-Score plus Abschnitte, Zeilen, Silben, Akkorde, Muster und Tab-Verweise. Undo/Redo läuft auf Modellebene, also über alle Ansichten hinweg.

**Laden:** Das Modell entsteht aus `score.gp`, `song.cho` und `leadsheet.json`.
- Text und Noten werden über die Reihenfolge verknüpft: Die n-te Silbe in `song.cho` gehört zur n-ten Liedtextsilbe in `score.gp`, gezählt in Abspielreihenfolge mit Wiederholungen. Dafür braucht es keine eigene Zuordnungsdatei.
- Passt das nicht mehr, etwa weil `song.cho` von Hand geändert wurde, richtet `align.js` neu aus und markiert die betroffenen Stellen.

**Speichern:** Alles wird aus dem Modell neu geschrieben, `orig/` bleibt immer unberührt.
- `score.gp`: Noten, Tabs, Liedtext und Akkordsymbole an den Schlägen, über den GP7-Exporter von alphaTab mit `PUT api/score.php`
- `song.cho`: komplett neu erzeugt, mit `PUT api/lyrics.php`
- `leadsheet.json`: mit `PUT api/leadsheet.php`

So sind GP-Datei und `song.cho` nach jedem Speichern auf demselben Stand.

**Lieder ohne Noten** (nur Akkordblatt): Das Modell hat dann nur die Ebene Text & Akkorde. `song.cho` ist die einzige Quelle, `score.gp` gibt es nicht. Kommt später eine GP-Datei als Rohmaterial dazu, wird der Text den Noten zugeordnet.

### Rohmaterial und Aufbereitung

Pro Lied können beliebig viele Quelldateien als **Rohmaterial** unter `orig/` liegen. Sie werden nie verändert.

| Quelle | Liefert |
|---|---|
| GP-Datei (Upload, Drag & Drop, UG-GP-Tab) | Noten, Tabs, Tempo, Marker, ggf. Liedtext, Akkordsymbole, Griffbilder, Audiospur mit Sync-Punkten |
| UG-Akkordblatt (Bookmarklet → `ug.json`) | Text, Akkorde, Abschnittsnamen, Capo, Tonart |
| ChordPro- oder Textdatei, eingefügter Text | Text, ggf. Akkorde und Abschnitte |
| YouTube (`bin/audio.php`) | Audio |

**Aufbereitung** (`js/import/`): Sie läuft im Browser, weil alphaTab die GP-Datei dort einliest.
1. Jede Quelle wird in ein Teilmodell übersetzt (`gp.js`, `ug.js`, `text.js`, `chordpro.js`).
2. `merge.js` führt die Teilmodelle zusammen, nach dieser Priorität:
   - **Noten:** nur aus GP
   - **Text:** GP-Liedtext vor UG-Akkordblatt vor Textdatei
   - **Akkorde:** GP-Akkordsymbole vor UG-Akkordblatt. Aus den Noten erkannte Akkorde gibt es nur als Vorschlag, weil das nicht eindeutig ist.
   - **Abschnitte:** Abschnittsnamen aus UG vor GP-Markern
3. `align.js` ordnet Text und Akkorde aus Akkordblatt oder Textdatei den Noten zu. Das geht per Wortvergleich mit dem GP-Liedtext oder, wenn der fehlt, per Verteilung über die Takte.
4. **Unsichere Stellen** werden im Editor farbig markiert: Zuordnungen, erkannte Akkorde, Zeilenumbrüche nach Heuristik.
5. Das Ergebnis öffnet sich im Editor. Erst beim Speichern entstehen `score.gp`, `song.cho` und `leadsheet.json`.

**Material nachreichen:** Kommt später eine weitere Quelle dazu, läuft die Aufbereitung erneut. Der Editor zeigt die Ergebnisse dann als **Vorschläge** pro Abschnitt zum Übernehmen oder Verwerfen, statt bereits Bearbeitetes zu überschreiben.

**Serverseitig** wird nur abgelegt. `api/upload.php` und `api/import.php` speichern das Rohmaterial über die Importer-Registry nach `orig/` und legen bzw. ergänzen `song.json` über `create_song()`. Die Registry ist nach dem Muster des Kochbuchs aufgebaut (dort `RecipeParserInterface`, hier `SongImporterInterface`).
- **`GpFileImporter`** löst zusätzlich Audiospur und Sync-Punkte heraus (siehe Anhang). Die Audiospur wird lokal mit `bin/audio.php --from-gp` mono komprimiert.
- **`UltimateGuitarImporter`:** Der Import läuft wie beim Chefkoch-Import über die Seite des Lieds, allerdings aus dem eingeloggten Browser statt vom Server:
  - Das **Bookmarklet** (`bookmarklet.js`) liest auf der geöffneten UG-Seite die eingebetteten Tab-Daten. Die genaue Struktur wird am Prototyp geprüft.
  - Es schickt die Daten per `POST` mit API-Token an `api/import.php`, abgelegt werden sie als `orig/ug.json`.
  - Bei GP-Tabs löst es den Download aus und lädt die Datei direkt hoch.
  - Gründe für den Browser-Weg: Der Server speichert keine Zugangsdaten, es gibt keine Probleme mit dem Bot-Schutz gegenüber Hetzner-IPs, und es funktioniert nur für Inhalte, auf die das eigene Pro-Abo ohnehin Zugriff hat.
  - `api/import.php` sendet CORS-Header für die UG-Domains. Wie die Basic Auth beim Cross-Origin-Request mitgeht, ist ein offener Punkt.
- **`TextImporter`** legt `.cho`- und `.txt`-Dateien oder eingefügten Text ab.

### Drucken (Leadsheet)

Das Leadsheet ist kein stumpfer Notenausdruck, sondern ein aufbereitetes Blatt für Solo-Gitarre und Gesang, möglichst auf **einer DIN-A4-Seite**.

**Inhalt:**
- Kopfzeile mit Titel, Interpret, Tonart, Capo, Stimmung, Tempo und Taktart.
- **Akkorde über dem Text**, an der richtigen Silbe. Gespeichert in `song.cho` (ChordPro, `[Am]Text`), gerendert als Inline-Block über der Silbe.
- **Akkorddiagramme nur für seltene Akkorde.** Gängige Griffe sind in `data/chords.json` als bekannt markiert und werden ausgeblendet.
- **Strumming:** Pfeile ↓ ↑ auf einem Zählraster („1 + 2 + …“), mit Pausen (·), Akzenten (>) und Chucks (×). Gespeichert als String, zum Beispiel `D.DU.UDU`.
- **Fingerpicking:** Daumen p und Finger i, m, a über einem kleinen Tab-Raster, **relativ zum Akkord** notiert. `B` ist der Grundton-Bass, `B2` der Wechselbass, `1`–`6` sind feste Saiten. Dadurch gilt ein Muster für alle Akkorde. Für Sonderfälle ist ein echter Tab als alphaTex möglich.
- **Tabs für Intro und Solo:** Taktbereich aus der GP-Datei (alphaTab rendert nur diese Takte, nur Tab-Zeile, verkleinert) oder ein eigener alphaTex-Schnipsel.
- Wiederholte Abschnitte erscheinen nur als Verweis („Refrain (2×)“).

**Technik:**
- `templates/leadsheet.html` enthält die `<template>`-Bausteine: Kopf, Akkorddiagramm, Schlagmuster, Picking-Muster, Abschnitt, Tab-Ausschnitt.
- `print.css` setzt `@page { size: A4 }`, Spalten und die Schriftgröße über CSS-Variablen.
- `svg.js` erzeugt Diagramme und Muster als SVG, ohne zusätzliche Bibliothek.
- Der **A4-Fit-Loop** in `leadsheet.js`:
  1. Rendern mit Maximalgröße in einer Spalte.
  2. Passt es nicht, wird die Schriftgröße in 0,5-pt-Schritten bis zum Minimum verkleinert.
  3. Passt es dann immer noch nicht: zwei Spalten und wieder ab Maximalgröße verkleinern.
  4. Passt es noch immer nicht: Wiederholungen einklappen und Diagramme verkleinern. Am Ende steht ein Hinweis statt eines unleserlichen Ausdrucks.

**Datenquellen:** Das Leadsheet liest `song.cho` und `leadsheet.json`, die beide vom Editor geschrieben werden. Tab-Ausschnitte kommen aus `score.gp`.

---

## Audio von YouTube holen

Das funktioniert analog zu „Videos für den Browser umwandeln“ in der Videothek. Das Skript `bin/audio.php` läuft lokal, alternativ als portables Paket auf einem beliebigen Windows-PC.

```
php bin/audio.php --youtube=<url> --slug=<slug>    # YouTube → data/songs/<slug>/audio.mp3
php bin/audio.php --queue=youtube-queue.txt        # mehrere: je Zeile "<slug> <url>"
php bin/audio.php --from-gp --slug=<slug>          # eingebettete Audiospur aus orig/score.gp komprimieren
php bin/audio.php --update                         # yt-dlp aktualisieren (yt-dlp -U)
bin\build_audio_portable.cmd D:\gitarrenbuch-audio # portables Paket: PHP + yt-dlp + ffmpeg + audio.php
```

- `yt-dlp` lädt nur die Audiospur, `ffmpeg` komprimiert sie einheitlich.
- **Format:** MP3 mono mit 80 kbit/s und 44,1 kHz, normalisiert, ohne Stille am Anfang und Ende. Ein Lied mit 4 Minuten belegt etwa 2,5 MB.
  ```
  ffmpeg -i in -ac 1 -ar 44100 -af "silenceremove=start_periods=1:start_threshold=-50dB,loudnorm" -b:a 80k audio.mp3
  ```
- Das unkomprimierte Original bleibt als `orig/youtube.<ext>` erhalten. So lässt sich später mit anderen Einstellungen neu komprimieren, ohne erneut herunterzuladen.
- `audio-log.jsonl` verhindert doppelte Downloads, wie `convert-log.jsonl` in der Videothek.
- Die Quell-URL wird in `song.json` eingetragen.
- Danach überträgt `php bin/remote.php --upload-data` die Dateien auf den Server.
- Nach Änderungen an `audio.php` muss das portable Paket neu gebaut werden.
- yt-dlp braucht regelmäßige Updates, weil YouTube sich häufig ändert.

---

## Stand / Roadmap

- ✅ PLanuung
- ❌ Grundgerüst und Mixer-Prototyp: Struktur, Konfiguration und Auth aus Kochbuch/Videothek, Liederliste, GP-Upload, Anzeigen und Abspielen, `dev/mixer-test.html`
- ❌ Audio: `bin/audio.php` und portables Paket, Herauslösen der GP-Audiospur, `api/audio.php`, `mixer.js`, Sync-Editor, `bin/remote.php`
- ❌ Editor (Text & Akkorde) und Aufbereitung: `model.js`, `lyrics-view.js`, `import/*` für GP- und Textdateien, Speichern von `score.gp` und `song.cho`
- ❌ Leadsheet: `chords.json`, Template, SVG-Bausteine, `patterns-view.js`, Fit-Loop
- ❌ Import von Ultimate Guitar: Bookmarklet, `UltimateGuitarImporter`, `ug.js`, Vorschläge beim Nachreichen
- ❌ Editor (Noten & Tabs): `score-view.js`

---

## Lizenz

GPL-3.0, siehe [LICENSE](LICENSE). Mitgelieferte Bibliothek: alphaTab (MPL-2.0).

---
---

# Anhang: Planungsnotizen

*(Gehört nicht ins spätere README.)*

## Entscheidungen

| Datum      | Thema        | Entscheidung                                                                                                                                                                                                                                                                    |
|------------|--------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 25.10.2026 | Audio        | Getrennt von der GP-Datei speichern (`audio.mp3` + `sync.json`)                                                                                                                                                                                                                 |
| 25.10.2026 | Originale    | Unterordner `data/songs/<slug>/orig/`. Ein Ordner pro Lied bleibt erhalten, und es ist Platz für mehrere Rohquellen.                                                                                                                                                            |
| 25.10.2026 | JSON-Dateien | Getrennt (`song.json`, `sync.json`, `leadsheet.json`), weil mehrere Editoren unabhängig schreiben und die Liederliste nur die kleinen `song.json` liest                                                                                                                         |
| 25.10.2026 | Text         | Eigene Datei `song.cho` im ChordPro-Format. `leadsheet.json` enthält nur Muster, Tab-Verweise und Layout.                                                                                                                                                                       |
| 25.10.2026 | Editor       | Ein gemeinsamer Editor für Text, Akkorde, Noten und Tabs auf einem Song-Modell. Rohmaterial (beliebige Quellen in `orig/`) wird bestmöglich aufbereitet. Beim Speichern werden `score.gp` (inkl. Liedtext und Akkordsymbolen), `song.cho` und `leadsheet.json` neu geschrieben. |

## Kernentscheidung: alphaTab

Einen eigenen GP-Parser, Notenrenderer und Synthesizer zu schreiben, wären jeweils Monate Arbeit. alphaTab (reines JS, Open Source, MPL-2.0) erledigt Lesen, Rendern und Abspielen von GP3–GP8. Das ist die einzige große Abhängigkeit.

## Audiospur in der GP-Datei einbetten oder getrennt speichern?

**Für getrennte Speicherung (`audio.mp3` + `sync.json`):**
- **Kleinere GP-Dateien:** Noten laden schnell, die Audiospur wird erst beim Abspielen gestreamt.
- **Mono-Komprimierung:** Die Audiospur lässt sich frei komprimieren. Eingebettete Spuren sind oft Stereo mit hoher Bitrate.
- **Streaming und Spulen** über HTTP-Range, ohne die ganze Datei vorher zu laden.
- **Der Mixer braucht ohnehin ein eigenes `<audio>`-Element.** Eingebettet müsste die Spur erst aus dem Datenmodell herausgelöst werden.
- **Unabhängig vom alphaTab-Exporter:** Ob der Exporter die Audiospur und Sync-Punkte beim Speichern mitschreibt, ist ungeklärt. Getrennt gespeichert kann beim Bearbeiten der Noten nichts verloren gehen.
- **Audio austauschbar:** zum Beispiel eine bessere YouTube-Version, ohne die GP-Datei anzufassen.
- **Sync-Punkte getrennt bearbeitbar** im Sync-Editor, ohne die GP-Datei neu zu schreiben.
- **Einheitlicher Weg** für YouTube-Audio und GP-Audiospuren.
- **Abgleich mit dem Server:** Eine Notenänderung überträgt nur die kleine GP-Datei, nicht jedes Mal mehrere MB Audio.

**Für Einbetten:**
- Eine Datei pro Lied, Noten und Audio können nicht auseinanderlaufen.
- Die Datei öffnet sich in **Guitar Pro 8 auf dem Desktop** direkt mit Audiospur und Sync.
- alphaTab liest Audio und Sync-Punkte aus GP8-Dateien selbst ein, ohne eigenes Format.
- Kein eigenes Herauslösen nötig.

**Entschieden (25.10.2026): getrennt speichern.**
- Beim Import bleibt `orig/score.gp` unverändert erhalten, mit Audiospur.
- `score.gp` ist die Arbeitsversion ohne Audiospur.
- Audio und Sync-Punkte liegen in `audio.mp3` und `sync.json`.
- Wer die Datei wieder in Guitar Pro öffnen will, bekommt später eine Export-Funktion „GP mit Audio“, die beides wieder einbettet. Das ist eine spätere Phase und hängt davon ab, ob sich das GP8-Format zuverlässig schreiben lässt.

**Zu prüfen:**
- Wo genau liegen Audiospur und Sync-Punkte im GP8-ZIP? Vermutlich als Datei unter `Content/` plus Einträge in `score.gpif`.
- Lässt sich die Spur sauber entfernen, ohne die Datei zu beschädigen?
- Hilfsweise: Sync-Punkte mit alphaTab im Browser auslesen und per API speichern.

## Offene Punkte / zu prüfen

- Gleichlaufgenauigkeit von Synth und Audiospur im Mixer-Prototyp
- Schreibt der alphaTab-GP7-Exporter Audiospur und Sync-Punkte mit? (Durch getrennte Speicherung entschärft)
- Herauslösen von Audiospur und Sync-Punkten aus GP8 in PHP (`gp_file.php`)
- Aktuelle Datenstruktur auf UG-Seiten (Akkordblatt, GP-Download) am Bookmarklet-Prototyp
- Basic Auth und CORS beim Bookmarklet-Import
- Erstbefüllung der Liste „gängige Akkorde“ in `data/chords.json`
- Umfang der ChordPro-Unterstützung in `chordpro.js` (nur die genutzten Direktiven, keine vollständige Implementierung)
- Schreibt der alphaTab-GP7-Exporter Liedtext, Akkordsymbole und Marker vollständig zurück? Bleiben Zeilenumbrüche im Liedtext erhalten?
- Silbenzählung in Abspielreihenfolge bei Wiederholungen, Sprüngen (D.S., Coda) und mehreren Liedtextzeilen in GP
- Qualität der automatischen Zuordnung in `align.js` an echten Beispielen

## Rechtliche Hinweise

- **YouTube:** Die Kopien sind nur für den privaten Gebrauch bestimmt (§53 UrhG) und werden nicht weitergegeben oder öffentlich zugänglich gemacht. Basic Auth schützt die Audiodateien. Die Nutzungsbedingungen von YouTube schließen Downloads aus.
- **Ultimate Guitar:** Es geht um einzelne, manuell angestoßene Importe mit dem eigenen Pro-Abo für den Eigenbedarf, ohne Weitergabe. Automatisierte Massenabrufe untersagen die Nutzungsbedingungen.

## Quellen

- [alphaTab – Audio & Video Sync](https://alphatab.net/docs/guides/audio-video-sync)
- [alphaTab – Release 1.6 (Backing Tracks)](https://alphatab.net/docs/releases/release1_6)
- [alphaTab – Media Sync Editor](https://alphatab.net/docs/guides/media-sync-editor)
- [alphaTab – Sync Points (alphaTex)](https://alphatab.net/docs/alphatex/sync-points)
- [ChordPro – Formatbeschreibung](https://www.chordpro.org/chordpro/)
- [frohlfing/kochbuch](https://github.com/frohlfing/kochbuch)
- [frohlfing/videothek](https://github.com/frohlfing/videothek)
