# Gitarrenbuch

Ein persönliches Gitarrenbuch: die Sammlung der Songs, die ich allein mit der Gitarre spiele und singe, als kleine
PHP/JSON-API mit einem statischen Frontend. Songs kommen als Guitar-Pro-Datei (GP3 bis GP8, z. B. von Ultimate
Guitar) ins Gitarrenbuch und werden mit [alphaTab](https://alphatab.net) als Noten und Tabs angezeigt und
abgespielt, auch auf dem Smartphone am Notenständer. Das Cover holt sich das Gitarrenbuch selbst von Deezer oder
iTunes.

Das Gitarrenbuch ersetzt Guitar Pro: Bearbeitet wird nur noch in der App, Guitar-Pro-Dateien sind reines Import- und
Exportformat. Am Ende steht für jeden Song eine ausdruckbare DIN-A4-Seite zum Spielen am Lagerfeuer: Akkorde über dem
Text, Strumming Patterns, Griffe. Sie soll unterhaltsam und gut spielbar sein, nicht musikalisch ausgefeilt.

Dazu kommt die Audiospur von YouTube, die synchron zu den Noten mitläuft. Noten, Tabs, Text und Akkorde werden im
Bearbeitungsmodus direkt in der Liedansicht bearbeitet. Geplant sind KI-Funktionen wie "Fingerstyle-Fassung erzeugen" 
oder "Akkorde aus der Audiospur bestimmen" (siehe "Offene Punkte" und "Planung der offenen Phasen").

Grundsätze:

1. **Jeder Song hat Noten** (`score.atex`). Ein Song entsteht durch Import einer GP-Datei oder wird manuell
   angelegt; dann erzeugt die App ein Gerüst mit leeren Takten. Eine eingebettete Audiospur wird herausgelöst, die
   Angaben zum Song (Titel, Interpret, Beschreibung, …) kommen nach `song.json`.
2. **Jede Information steht an genau einer Stelle**: Angaben in `song.json`, alles Musikalische (auch Text, Akkorde,
   Abschnitte, Tempo, Tuning und die Sync-Punkte zur Audiospur) in den Noten, Audiospur und Cover als eigene Dateien.
3. **Anreichern mit einer Akkorddatei** (ChordPro oder Text): Sie wird in die Noten eingearbeitet, vorhandener Text
   hat Vorrang. Bis zum Editor wird sie nur als Rohmaterial abgelegt.
4. **Cover** von Deezer, iTunes oder als eigenes Bild.
5. **Audio** über eine YouTube-URL (`bin/audio.php`).
6. **Ziel: aufgeräumte Spuren je Song.** Übliche Namen sind `strumming`, `picking`, `percussion`, `fingerstyle`
   (Begleitung und Melodie zugleich auf der Gitarre, allein spielbar) und `vocal`; Namen und Reihenfolge legt man im
   Editor fest, Rollen gibt es keine. Akkorde und Text stehen je in genau einer Spur (im Editor per Radiobutton
   gewählt); einmal notiert, gelten sie für alle Spuren. Der Capo gilt für den
   ganzen Song, Akkorde sind Griffnamen relativ zum Capo (siehe "Spuren, Capo, Text und Akkorde"). Die meisten
   importierten Songs haben noch andere Spuren; umgebaut wird nach und nach mit dem Editor (und später der KI).

Wo was liegt (je Song unter `data/songs/<slug>/`):

| Datei            | Inhalt                                                                           |
|------------------|----------------------------------------------------------------------------------|
| `song.json`      | Titel, Interpret, Genres, weitere Angaben aus der GP-Datei, Notizen, Leadsheet   |
| `score.atex`     | Noten, Tabs, Text, Akkorde, Abschnitte, Tempo, Tuning, Capo, Tonart, Sync-Punkte |
| `audio.mp3`      | Audiospur                                                                        |
| `cover.jpg`      | Cover                                                                            |

## Voraussetzungen

- PHP 8.5+ mit aktivierter GD- und zip-Extension
- Ausgehende HTTPS-Verbindungen für die Cover-Suche bei Deezer und iTunes (über die curl-Extension oder, falls die
  fehlt, `allow_url_fopen`; beides ist bei XAMPP und Hetzner Standard)
- Die GD-Extension, um eigene Cover auf 500 × 500 px zuzuschneiden
- Ein Webserver mit `public/` als Document Root
- Kein Datenbankserver nötig – alle Daten liegen als Dateien unter `data/`, bewusst außerhalb des Document Root
  (Zugriff nur über die API wie `api/songs.php`, nicht direkt per URL)

## Setup

1. `config.example.php` nach **`config.php`** kopieren (liegt im Projekt-Root, nicht unter `public/`, damit es
   außerhalb des Document Root und damit nicht direkt aufrufbar ist).

2. In `config.php` ein echtes **`API_TOKEN`** eintragen, z. B.:
   ```
   php -r "echo bin2hex(random_bytes(32));"
   ```
3. Webserver mit **Document Root** `public/` auf ein Verzeichnis zeigen lassen (z. B. XAMPP-vHost).

4. **HTTP Basic Auth einrichten** (schützt zusätzlich zum API-Token auch die statische `index.html` selbst – ohne
   diese Auth wäre die leere Seiten-Hülle trotz Token-Schutz der API weiterhin für jeden abrufbar):
   ```
   C:\xampp\apache\bin\htpasswd -bcB .htpasswd <benutzername> <passwort>
   ```
   Die `.htpasswd`-Datei liegt im Projekt-Root (außerhalb des Document Root, neben `config.php`). Danach
   `public/.htaccess.example` nach `public/.htaccess` kopieren und den `AuthUserFile`-Pfad auf den tatsächlichen
   absoluten Pfad zur `.htpasswd` auf diesem Server anpassen. Beide Dateien (`.htpasswd`, `public/.htaccess`) sind
   gitignored und müssen auf jedem Rechner/Server separat eingerichtet werden.

   `public/.htaccess` meldet außerdem die MIME-Typen an, die alphaTab braucht (`.mjs`, `.woff2`, `.sf2`), falls
   der Server sie nicht kennt. Diese Zeilen stehen schon in `public/.htaccess.example` und kommen beim Kopieren mit.

5. **zip-Extension** für PHP aktivieren. Zur Prüfung gibt es `public/dev/info.php` (ruft `phpinfo()` auf, im Browser
   aufrufen und nach "zip" suchen).

   Unter XAMPP:
   - `C:\xampp\php\php.ini` öffnen und die Zeile `;extension=zip` zu `extension=zip` ändern.
   - Apache neu starten.

   Unter Hetzner-Webspace:
   - zip ist standardmäßig aktiviert. Falls nicht, kann dies per KonsoleH eingerichtet werden.

6. **GD-Extension** für PHP aktivieren (zum Zuschneiden eigener Cover). Zur Prüfung gibt es `public/dev/info.php` (ruft
   `phpinfo()` auf, im Browser aufrufen und nach "gd" suchen) – siehe auch Abschnitt "Admin-/Dev-Skripte" unter
   Projektstruktur.

   Unter XAMPP:
   - `C:\xampp\php\php.ini` öffnen und die Zeile `;extension=gd` zu `extension=gd` ändern.
   - Apache neu starten.

   Unter Hetzner-Webspace:
   - GD ist standardmäßig aktiviert. Falls nicht, kann dies per KonsoleH eingerichtet werden.

7. **yt-dlp, Deno und ffmpeg** für `bin/audio.php` (holt die Audiospur von YouTube). Sie laufen nur lokal auf dem
   Windows-Rechner, nicht auf dem Server, und müssen im `PATH` liegen:
   - yt-dlp: `yt-dlp.exe` aus dem offiziellen Release
     (`https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe`), z. B. nach `C:\Program Files\yt-dlp`.
     YouTube ändert sich häufig; aktualisiert wird mit `php bin/audio.php --update` (ruft `yt-dlp -U` auf).
   - Deno: `deno.exe` aus `https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip`,
     am besten neben `yt-dlp.exe`. yt-dlp braucht eine JavaScript-Laufzeit, um die Download-Adressen von YouTube zu
     entschlüsseln; ohne sie warnt es, und Formate fehlen. Node ginge auch, aber erst in neueren Versionen als 20.9.
   - ffmpeg (mit ffprobe): z. B. nach `C:\Program Files\ffmpeg\bin`.
     
8. **alphaTab** liegt fertig unter `public/vendor/alphatab/` (1.8.4 aus npm, siehe `VERSION.txt`), mit **vier
   eigenen Änderungen** in `alphaTab.core.mjs` (vermerkt als Kommentar ganz oben in der Datei). Bei
   einem Update von alphaTab prüfen, ob sie noch nötig sind, und sie sonst neu einfügen. Änderungen an alphaTab so
   wenige wie möglich: Was sich über Einstellungen lösen lässt, löst der Player.

   **1. Jede Art von Angabe in einer eigenen Zeile**
   - Stelle: `update(t)` der Effekt-Zeilen (im Quelltext `EffectBandSlot.update()`), minifiziert
     `update(t){t.info.canShareBand||(this.shared.uniqueEffectId=t.info.effectId),…`.
   - Geändert in `update(t){this.shared.uniqueEffectId=t.info.effectId,…`: Eine Zeile über bzw. unter den Noten gehört
     immer nur einer Art von Angabe (Akkordname, Abschnitt, Tempo, Text, Anschlagzeichen, …).
   - Grund: alphaTab packte verschiedene Angaben in dieselbe Zeile, solange sie sich nicht überschneiden. So standen
     die Akkorde einer Notenzeile auf verschiedenen Höhen ("Losing My Religion": Anschlagzeichen aus Takt 37 in der
     Höhe des Akkords aus Takt 38, "G" aus Takt 40 in der Höhe von "CHORUS" aus Takt 41), und auf demselben Schlag
     lagen Abschnitts- und Akkordname übereinander ("Junge", Takt 1).
   - Folge: In Zeilen mit vielen verschiedenen Angaben werden die Noten etwas höher.
   - Bei alphaTab ist das Überdecken auf demselben Schlag bekannt (Issue #2786, Duplikat von #2010) und mit PR #2750 
     ("skyline based effect placement") im Entwicklungszweig neu gelöst, erscheint mit 1.9. Mit 1.9 prüfen, ob die 
     Akkorde dann auf einer Höhe stehen.

   **2. Liedtext unter den Tabs**
   - Stelle: die Effekte der Tab-Zeile (minifiziert `new wu([{effect:new lo,mode:yh.SharedTop}`, `lo` ist der
     Liedtext, `LyricsEffectInfo`).
   - `SharedTop` → `SharedBottom`: Der Text steht unter den Tabs statt darüber, wie in Guitar Pro; in "Noten + Tabs"
     damit unter der ganzen Spur. In "Noten" (ohne Tabs) steht er unter den Noten.
   - Ohne diese Änderung steht der Text wieder über den Tabs, sonst geht nichts verloren.

   **3. Abstand der Angaben unter der Zeile davor statt danach**
   - Stelle: `bS()` des Effekt-Containers (im Quelltext `EffectBandContainer`, das Feld `pS` ist "oben"); dort
     werden die Angaben über bzw. unter einer Zeile gestapelt, mit `effectBandPaddingBottom` nach jeder.
   - Geändert: `this.pS||(e+=s),` vor `i.shared.y=e` und `e+=i.shared.height+(this.pS?s:0)` statt `+s`. Unter der
     Zeile kommt der Abstand so vor jede Angabe: Der Text klebt nicht an der E-Saite und hat darunter keinen
     überflüssigen Abstand (die Zeilen in "Noten" mit nur "Gesang" standen sonst weit auseinander). Über der Zeile
     bleibt alles wie in alphaTab.
   - Ohne diese Änderung klebt der Text wieder an der Zeile darüber.

   **4. Zeilenumbrüche im Liedtext nicht zeichnen**
   - Stelle: `createNewGlyph()` des Liedtexts (minifiziert `createNewGlyph(t,e){return new co(0,0,e.lyrics,…`, `lo`
     ist `LyricsEffectInfo`).
   - Geändert: `e.lyrics.map(l=>l&&l.replace(/\n/g,""))` statt `e.lyrics`. Ein Zeilenumbruch im Liedtext steht als
     `\n` am Ende der letzten Silbe einer Zeile (siehe "Text und Akkorde"); gezeichnet wird die Silbe ohne ihn.
   - Ohne diese Änderung zeichnet der Browser den Umbruch als Leerzeichen: nicht zu sehen, die Silbe steht aber gut
     1 px weiter links (sie wird mittig unter die Note gesetzt und ist breiter).

   **Für alle vier:**
   - Die unveränderte Datei liegt daneben als `alphaTab.core.mjs.orig`.
   - Der Browser hält `alphaTab.core.mjs` ohne Versionszähler im Cache; nach einer Änderung einmal mit Strg+F5 laden.

## Lokalen Testserver unter XAMPP (Windows) einrichten

1. URL in die Hosts-Datei eintragen

    `C:\Windows\System32\drivers\etc\hosts` als Administrator öffnen:
    
    ```
    127.0.0.1      gitarrenbuch.test
    ```

2. SSL-Zertifikat installieren
    ```shell
    cd C:\xampp\apache\bin
    
    .\openssl.exe req -x509 -nodes -newkey rsa:2048 -sha256 `
     -keyout "C:\xampp\apache\conf\ssl.key\gitarrenbuch.test.key" `
    -out "C:\xampp\apache\conf\ssl.crt\gitarrenbuch.test.crt" `
     -days 3650 `
    -config "C:\xampp\apache\conf\openssl.cnf" `
     -subj "/CN=gitarrenbuch.test" `
    -addext "basicConstraints=CA:FALSE" `
    -addext "subjectAltName=DNS:gitarrenbuch.test"
    ```

    Apache neu starten!

3. VirtualHost hinzufügen

    Datei `C:\xampp\apache\conf\extra\httpd-vhosts.conf` bearbeiten:
    
    ```
    <VirtualHost *:80>
        ServerName gitarrenbuch.test
    
        DocumentRoot "C:/Users/frank/Source/PhpStorm/gitarrenbuch/public"
    
        <Directory "C:/Users/frank/Source/PhpStorm/gitarrenbuch/public">
            AllowOverride All
            Require all granted
        </Directory>
    </VirtualHost>
    
    <VirtualHost *:443>
        ServerName gitarrenbuch.test
    
        DocumentRoot "C:/Users/frank/Source/PhpStorm/gitarrenbuch/public"
    
        SSLEngine on
        SSLCertificateFile "C:/xampp/apache/conf/ssl.crt/gitarrenbuch.test.crt"
        SSLCertificateKeyFile "C:/xampp/apache/conf/ssl.key/gitarrenbuch.test.key"
    
        <Directory "C:/Users/frank/Source/PhpStorm/gitarrenbuch/public">
            AllowOverride All
            Require all granted
        </Directory>
    </VirtualHost>
    ```
    
    Apache neu starten!

4. SSL-Zertifikat in den Browser-Zertifikatsspeicher importieren:

    Damit der Browser dem selbstsignierten Zertifikat vertraut, muss es in den Browser-Zertifikatsspeicher importiert
    werden:
    - Doppelklick auf `C:\xampp\apache\conf\ssl.crt\gitarrenbuch.test.crt`
        - Zertifikat installieren...,
            - Lokaler Computer
            - Zertifikatsspeicher: Vertrauenswürdige Stammzertifizierungsstellen
    
    Browser neu starten!
    
    Die Homepage ist jetzt erreichbar unter: https://gitarrenbuch.test/

## Projektstruktur

```
gitarrenbuch/                         # Projektroot
 ├── data/                            # Außerhalb des Document Root, kein direkter Browser-Zugriff möglich
 │    ├── test/                       # Testdateien für die Entwicklung (z. B. eine GP8-Datei mit Audiospur)
 │    ├── chords.json                 # Akkorde aus den Songs plus Standardakkorde (wird automatisch aktualisiert)
 │    ├── patterns.json               # Pattern-Katalog (Erstbefüllung: Standardpatterns, wird im Editor gepflegt)
 │    ├── songs/                      # Ein Unterordner pro Song
 │    │    └── <slug>/                # Slug aus Interpret + Titel, z. B. "bob-marley-three-little-birds"
 │    │         ├── song.json         # Angaben (Titel, Interpret, Tags, Notizen, Quellen-URLs, Leadsheet)
 │    │         ├── score.atex        # Noten, Tabs, Text, Akkorde, Abschnitte, Sync-Punkte (alphaTex)
 │    │         ├── audio.mp3         # Audiospur (beim Import aus der GP-Datei herausgelöst)
 │    │         ├── cover.jpg         # Albumcover, 500 px (Deezer, iTunes oder eigenes Bild)
 │    │         ├── upload/           # Hochgeladenes Rohmaterial (GP-, ChordPro-, Textdateien, PDFs); Angaben dazu: Feld uploads in song.json
 │    │         └── history/          # Die letzten Stände vor dem Überschreiben: score-<Zeit>.atex + .json (Leadsheet-Angaben); Anzahl: SCORE_HISTORY_KEEP in config.php
 │    └── backup/                     # Nur lokal: Rohmaterial je Song (<slug>/), u. a. die von YouTube geladene Spur
 ├── bin/
 │    ├── audio.php                   # YouTube → audio.mp3, lädt per API auf den Server hoch (läuft lokal)
 │    └── build_audio_portable.cmd    # audio.php samt PHP, yt-dlp, Deno und ffmpeg als Paket für einen anderen PC
 ├── docs/                            # Planung, Beschreibung des Editors und Notizen
 ├── public/                          # Document Root
 │    ├── api/                        # API-Endpunkte
 │    │    ├── lib/                   # Gemeinsam genutzte Hilfsfunktionen der API-Endpunkte
 │    │    │    ├── cover.php         # Cover suchen (Deezer, iTunes), übernehmen, speichern
 │    │    │    ├── chords.php        # Akkordkatalog: die Akkorde der Songs, nach Häufigkeit
 │    │    │    ├── crud.php          # Read/Write/Rename/Delete-Logik + Validierung
 │    │    │    ├── fetch.php         # http_get(): curl, sonst file_get_contents()-Fallback
 │    │    │    ├── file_store.php    # Noten und Rohmaterial ablegen, Dateien mit ETag ausliefern
 │    │    │    ├── gp_file.php       # GP-Format erkennen, Audiospur herauslösen
 │    │    │    ├── http.php          # JSON-Response-Helper, Token-Prüfung
 │    │    │    ├── slug.php          # slugify() + Eindeutigkeits-Check
 │    │    │    ├── uploads.php       # Uploads: Quelle und Beschreibung, Direktlink laden
 │    │    │    └── youtube.php       # Video-ID, Titel und Länge eines YouTube-Videos
 │    │    ├── audio.php              # Liefert audio.mp3 (z. B. für den GP-Export)
 │    │    ├── chords.php             # Akkordkatalog ausliefern
 │    │    ├── cover.php              # Cover ausliefern, suchen, übernehmen, hochladen, entfernen
 │    │    ├── leadsheet.php          # Angaben für das Leadsheet (Feld leadsheet in song.json) lesen und ersetzen (auch aus dem Verlauf)
 │    │    ├── import.php             # Neuen Song mit Noten anlegen (Import oder Gerüst, inkl. Cover)
 │    │    ├── patterns.php           # Pattern-Katalog lesen (mit Verwendung je Pattern) und ersetzen
 │    │    ├── score.php              # score.atex ausliefern (für alphaTab) und ersetzen (Bearbeitungsmodus)
 │    │    ├── songs.php              # Songs lesen, bearbeiten, löschen; Favorit und Einstufung setzen
 │    │    ├── uploads.php            # Hochgeladene Dateien eines Songs mit Quelle und Beschreibung
 │    │    └── youtube.php            # Titel und Länge eines YouTube-Videos (für das Formular)
 │    ├── dev/                        # Admin-/Wartungsskripte – NICHT dauerhaft auf dem Produktivserver lassen
 │    │    ├── prioritaeten.html      # vergleicht Einteilungen der Griffe in Prioritäten (Test)
 │    │    └── info.php               # phpinfo()
 │    ├── js/                         # ES-Module des Frontends (ohne Bundler, von app.js importiert)
 │    │    ├── base.js                # API-Zugriff, Akkorde und Griffe, Griffbilder (SVG), Griffbrett, Symbole, Marken
 │    │    ├── conflicts.js           # Konfliktlöser (Import, docs/Konflikte.md)
 │    │    ├── chordtheory.js         # Akkordname → Töne (Regeln aus docs/Musiktheorie.md)
 │    │    ├── chordgrips.js          # Töne → Griffe: sucht passende Griffe und ordnet sie (erst weniger Bünde, dann weniger Finger)
 │    │    ├── notation.js            # Noten: Spuren, Spielfolge, GP/alphaTex lesen und schreiben, Bearbeiten, Transponieren
 │    │    ├── textview.js            # Ansicht "Text & Akkorde"
│    │    ├── transposedialog.js     # Dialog Transponieren: Halbtöne, Capo, Tuning, Vorschau
 │    │    ├── rhythmdialog.js        # Dialog Rhythmus ableiten: Begleitspur mit Strumming aus einer Spur
 │    │    ├── sheet.js               # Leadsheet: Pattern-Katalog, Generator, Tab-Stellen, Dialog im Bearbeitungsmodus
 │    │    ├── library.js             # Kachelübersicht, Formulare (Song, Import, Cover, Text), Overlay
 │    │    ├── playback.js            # Player (alphaTab), Mixer mit Audiospur, Sync-Editor
 │    │    └── editor.js              # Bearbeitungsmodus: Leiste, Panels, Liedtext, Maus und Cursor, Tastenkürzel
 │    ├── vendor/alphatab/            # alphaTab 1.8.4 (MPL-2.0) mit Notenschrift und SoundFont, siehe "Lizenz"
 │    ├── vendor/qrcode/              # QR-Codes für das Leadsheet (MIT)
 │    ├── vendor/signalsmith/         # Zeitdehnung der Audiospur im Mixer (MIT)
 │    ├── .htaccess                   # Apache Zugriffsschutz
 │    ├── .htaccess.example           # Vorlage für Apache Zugriffsschutz
 │    ├── app.css                     # CSS-Styles für das Frontend
 │    ├── app.js                      # Einstieg des Frontends
 │    ├── favicon.svg                 # Browser-Tab-Icon (Gitarre)
 │    └── index.html                  # Frontend (lädt/schreibt ausschließlich über /api/*)
 ├── types/alphatab.d.ts              # Nur für die IDE: Typen von alphaTab (nicht deployen)
 ├── types/tsconfig.json              # Nur für die IDE: Sprachstand ES2022 für die alphaTab-Typen (flatMap, at, Map)
 ├── .gitignore                       # Vom Git-Repository auszuschließende Dateien
 ├── .htpasswd                        # Apache Passwortdatei (nicht im Git-Repository)
 ├── config.example.php               # Vorlage für config.php
 ├── config.php                       # Zentrale Konfigurationsdatei (nicht im Git-Repository)
 ├── LICENSE                          # Lizenzhinweis
 └── README.md                        # Landingpage für das Git-Repository
```

### Admin-/Dev-Skripte (`public/dev/`)

Wartungs- und Diagnose-Skripte, die (anders als die eigentliche App) direkt im Browser aufgerufen werden:

- `info.php` zeigt die PHP-Konfiguration (z. B. ob zip aktiv ist).
- `prioritaeten.html` vergleicht Einteilungen der Griffe in Prioritäten nebeneinander (`findGrips()` in `js/chordgrips.js`): heute
  und mit Priorität 3 und 4 zusammengelegt. Je Spalte steht oben, was der Akkorddialog ohne Katalog zeigen würde, darunter alle
  Gruppen; wer sich gegenüber "heute" verschiebt, ist farbig markiert. Weitere Varianten (Priorität und Reihenfolge je Griff) trägt
  man in `VARIANTS` ein.

**Wichtig:** `public/dev/` gehört **nicht dauerhaft** auf den Produktivserver. Nach Gebrauch dort löschen – ein
Server-Interna preisgebender `phpinfo()`-Endpunkt soll keine Dauereinrichtung sein.

## API

Alle schreibenden Endpunkte (`POST`/`PUT`/`DELETE`) erwarten den Header `X-API-Token: <token>`, sonst `401`. Lesende
Endpunkte (`GET`) sind ohne eigenes Token offen — Schutz vor öffentlichem Zugriff übernimmt stattdessen die HTTP Basic
Auth vor der gesamten `public/`-Domain (siehe Setup, Schritt 5), die auch die statische `index.html` selbst mit
abdeckt.

| Methode | Endpunkt                              | Beschreibung                                                                                                                                    |
|---------|---------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| GET     | `/api/songs.php`                      | Alle Songs, alphabetisch nach Titel (das Frontend sortiert ggf. um)                                                                             |
| GET     | `/api/songs.php?slug=xyz`             | Einzelner Song                                                                                                                                  |
| PUT     | `/api/songs.php?slug=xyz`             | Song bearbeiten (JSON-Body). Ändert sich der Slug (Interpret/Titel), wird der Ordner umbenannt                                                  |
| DELETE  | `/api/songs.php?slug=xyz`             | Song samt Ordner (Rohmaterial inklusive) löschen                                                                                                |
| POST    | `/api/import.php`                     | Neuen Song anlegen (`multipart/form-data`: `meta` = JSON wie bei PUT `songs.php`, `score` = alphaTex, `file` = Original-GP-Datei, optional)     |
| GET     | `/api/score.php?slug=xyz`             | Noten `score.atex` ausliefern (für alphaTab)                                                                                                    |
| GET     | `/api/score.php?slug=xyz&history=1`   | Liste der früheren Fassungen der Noten (id, time, size), die neueste zuerst (Knopf "Verlauf" im Bearbeitungsmodus)                              |
| GET     | `/api/score.php?slug=xyz&version=ID`  | Ein früherer Stand als alphaTex (id aus der Liste)                                                                                            |
| DELETE  | `/api/score.php?slug=xyz&version=ID`  | Einen früheren Stand löschen (Noten und Angaben für das Leadsheet); Antwort: die übrigen                                                        |
| PUT     | `/api/score.php?slug=xyz`             | Noten ersetzen (Body: alphaTex als `text/plain`; Bearbeitungsmodus), alte Fassung nach `history/`. Nur für Songs mit Noten                      |
| GET     | `/api/audio.php?slug=xyz`             | Audiospur `audio.mp3` ausliefern                                                                                                                |
| PUT     | `/api/audio.php?slug=xyz`             | Audiospur ersetzen (Body: die MP3 als `audio/mpeg`; nutzt `bin/audio.php`)                                                                      |
| GET     | `/api/cover.php?slug=xyz`             | Cover `cover.jpg` ausliefern                                                                                                                    |
| GET     | `/api/cover.php?artist=…&title=…`     | Cover bei Deezer und iTunes suchen (`{"results": [...]}`, Deezer zuerst)                                                                        |
| PUT     | `/api/cover.php?slug=xyz`             | Cover aus der Suche übernehmen (Body: `{"url": "…"}`, nur Bildserver von Deezer und iTunes)                                                     |
| POST    | `/api/cover.php?slug=xyz`             | Eigenes Cover hochladen (`multipart/form-data`: `file`, JPEG; der Browser verkleinert und wandelt vorher um)                                    |
| DELETE  | `/api/cover.php?slug=xyz`             | Cover entfernen                                                                                                                                 |
| GET     | `/api/youtube.php?url=…`              | Titel und Länge eines YouTube-Videos (`{"id", "title", "seconds"}`, gelesen aus der Videoseite)                                                 |
| GET     | `/api/uploads.php?slug=xyz`           | Uploads des Songs (`{"uploads": [{file, size, source, description, added}]}`)                                                                   |
| GET     | `/api/uploads.php?slug=xyz&file=name` | Eine hochgeladene Datei (PDF und Text im Browser, sonst Download)                                                                               |
| POST    | `/api/uploads.php?slug=xyz`           | Datei ablegen (`multipart/form-data`: `file` oder `url` für einen Direktlink, dazu `source`, `description`)                                     |
| PUT     | `/api/uploads.php?slug=xyz&file=name` | Quelle und Beschreibung ändern (Body: `{"source": "…", "description": "…"}`)                                                                    |
| DELETE  | `/api/uploads.php?slug=xyz&file=name` | Datei samt Angaben löschen (Papierkorb im Dialog "Uploads"); Antwort: die übrigen Uploads                                                       |

Jeder Song enthält zusätzlich das Feld `files`. Es listet, welche Dateien im Ordner liegen (`score`, `audio`, `cover`, 
z. B. `["score", "audio", "cover"]`), wird bei jedem Lesen aus dem Dateisystem bestimmt und nicht gespeichert.

`song.json`-Schema:

```json
{
  "title": "Three Little Birds",
  "artist": "Bob Marley",
  "tags": ["Reggae"],
  "subtitle": null,
  "album": "Exodus",
  "words": null,
  "music": null,
  "copyright": null,
  "tab": null,
  "instructions": null,
  "notes": "https://tabs.ultimate-guitar.com/tab/…\nBass:\nhttps://www.youtube.com/watch?v=…",
  "sources": { "youtube": "https://www.youtube.com/watch?v=…" },
  "youtubeSeconds": 180,
  "slug": "bob-marley-three-little-birds",
  "created": "2026-10-26T02:43:52+01:00",
  "updated": "2026-10-26T15:01:03+01:00",
  "leadsheet": { "patterns": [{ "id": "reggae", "when": "ganzer Song" }], "tabs": [], "chords": {}, "links": [], "instructions": "" }
}
```

`leadsheet` hält die Angaben für das Blatt (Patterns, Tab-Stellen, ersetzte Takte `cuts`, Griffbilder, Links, Hinweise 
zur Spielweise; Aufbau unter "DIN-A4-Seite (Leadsheet)" in docs/Planung.md). Es fehlt, solange es keine gibt. 
Geschrieben wird es nur über `PUT api/leadsheet.php` (vom Editor zusammen mit den Noten), "Song bearbeiten" lässt es 
unverändert. `leadsheet.instructions` (Spielweise für Seite 1) ist etwas anderes als `notes` (Notizen der Stammdaten); 
die Felder bleiben getrennt. Beim Import einer GP-Datei wird es mit deren Anweisungen vorbelegt (`instructions` oben, 
das bleibt daneben stehen).

`uploads` hält Quelle und Beschreibung der Dateien im Ordner `upload/` des Songs (Dateiname → `source`,
`description`, `added`). Die API liefert das Feld nicht mit dem Song aus, sondern über `api/uploads.php`.

`favorite` (`true`) und `level` (`"can"`, `"practice"`, `"cannot"`) stehen nur da, wenn der Song Favorit ist bzw.
eingestuft wurde (siehe "Übersicht"); fehlen sie in einem Request, bleiben die gespeicherten. 

`trackDefaults` ist eine Liste mit einem Eintrag je Spur (in der Reihenfolge der Spuren): `show` (in den Noten
angezeigt) und `mute` (stumm). Gesetzt wird sie mit Auge und Lautsprecher im Dialog "Spuren" des Bearbeitungsmodus und
mit "Speichern". Sie gilt als Vorgabe: Was ein Gerät im Mixer einstellt, wird dort gemerkt (`localStorage`) und hat
Vorrang. Fehlt sie in einem Request, bleibt die gespeicherte; eine leere Liste löscht sie.

**Instrument einer Spur:** eines von 13 aus einer festen Liste plus Schlagzeug (`INSTRUMENTS` in `js/notation.js`;
Liste, Regeln und Analyse der GP-Dateien in `docs/Instrumente.md`). Ein Instrument legt Klang (General-MIDI-Programm)
und Notenlage zusammen fest: Gitarre und Bass eine Oktave höher notiert, als sie klingen, alle anderen wie klingend
(`displayTranspositionPitch` von alphaTab, in alphaTex `\displaytranspose`, bei Guitar Pro "Oktave"). Gewählt wird es
im Dialog "Spuren"; beim Import ordnet der Konfliktlöser jeder Spur eines zu.

`tags` sind die Genres (in der Oberfläche "Genre"), mehrere je Song möglich, z. B. "Rock & Pop", "Folk",
"Weihnachtslied"; das Formular zeigt die vorhandenen zum An- und Abwählen. 
Tonart, Capo, Tuning und Tempo stehen nicht in `song.json`, sondern nur in den Noten; die Songansicht liest sie von 
dort. `subtitle` bis `instructions` sind die weiteren Angaben aus der GP-Datei, 1:1 übernommen (Untertitel, Album, 
Text, Musik, Copyright, Tab-Autor, Anweisungen); das Gitarrenbuch nutzt sie vorerst nicht, und "Song bearbeiten" lässt 
sie unverändert. `notes` sind freie, mehrzeilige Notizen. Interpret und Titel zusammen dürfen nur einmal vorkommen.

`sources` hält fest, woher die Audiospur stammt: `youtube` ist das Video, aus dem `bin/audio.php` die Audiospur holt 
(Feld "Quelle für Audio-Datei" im unteren Panel "Audio" des Bearbeitungsmodus, mit eigenem Knopf "Quelle speichern"). Neben 
dem Feld führt "Auf YouTube suchen" zur Suche nach Interpret und Titel. Ein eingefügter YouTube-Link wird sofort 
auf `https://www.youtube.com/watch?v=<ID>` gekürzt (Playlist, Startzeit usw. fallen weg); der Server kürzt beim 
Speichern noch einmal. Neben dem Feld stehen die Längen, damit man sieht, ob ein Clip passt: "Noten" (Spieldauer im 
eigenen Tempo mit Wiederholungen, ohne Sync-Punkte), "Clip" (Länge des eingetragenen Videos) und "MP3" (vorhandene 
`audio.mp3`). Die Clip-Länge steht als `youtubeSeconds` in `song.json`; YouTube wird nur gefragt, wenn sich die URL 
ändert oder die Länge noch fehlt (dann zeigt der Tooltip den Videotitel). Ohne YouTube-URL ist sie `null`. Regeln zu 
den einzelnen Feldern (Pflichtfelder, Wertebereiche, Dateien) stehen bei den Funktionen in `public/api/lib/crud.php`.

## Frontend / Arbeitsweise

### Request-Ablauf beim Seitenaufruf

1. **Statische Assets**: `favicon.svg`, `app.css` und `app.js`. `app.js` ist ein ES-Modul und importiert die Module
   aus `js/`. Alle tragen einen Versionszähler (`?v=…`) gegen alte Fassungen im Browser-Cache.
2. **`GET api/songs.php`** lädt alle Songs. Das ist der einzige Request beim Start; schlägt er fehl, erscheint eine
   Fehlermeldung.
3. In der Übersicht bekommt jeder Song mit Cover ein `<img src="api/cover.php?slug=…&v=…" loading="lazy">`. Der
   Browser lädt also nur die Cover, die (fast) im sichtbaren Bereich liegen. `v` ist das Änderungsdatum des Songs,
   damit ein neues Cover sofort erscheint.
4. Erst beim Öffnen eines Songs folgen `GET api/score.php` (die Noten als alphaTex), alphaTab (rund 1 MB), die
   Notenschrift und der SoundFont (Lazy Loading).

Kein Token-Request/Prompt beim Laden: Das Token wird ausschließlich bei schreibenden Aktionen abgefragt, siehe
"Token-Authentifizierung".

### Token-Authentifizierung

Für Änderungen (Song anlegen/bearbeiten/löschen, Import, Cover, Text) fragt das Frontend beim ersten Schreibversuch per
`prompt()` nach dem API-Token und legt es danach in `localStorage` unter dem Schlüssel `gitarrenbuch_api_token` ab.
Jeder weitere Schreibversuch liest das gespeicherte Token wieder aus und fragt nicht erneut nach.

Es wird nur dann wieder nachgefragt, wenn
a) der Server das gespeicherte Token ablehnt (401) – dann wird es automatisch aus `localStorage` gelöscht, oder
b) du es manuell löschst, z. B. in den Browser-DevTools mit `localStorage.removeItem('gitarrenbuch_api_token')` oder
   über "Website-Daten löschen".

### Übersicht

Die Songs erscheinen als Kacheln mit Cover, Titel, Interpret und Genres, wie im Kochbuch und in der Videothek. Ohne
Cover zeigt die Kachel einen Farbverlauf mit dem Anfangsbuchstaben des Titels; die Farbe ergibt sich aus dem Slug
und bleibt so für jeden Song gleich. Fehlt die Audiospur, steht auf dem Bild ein durchgestrichenes "Audio".

### Import-Funktion

Der normale Weg zu einem neuen Song:

1. **GP-Datei importieren**: "+ Neuer Song" öffnet den Dialog "Song importieren". Die Datei wird hineingezogen oder
   ausgewählt (GP3 bis GP8, z. B. von [Ultimate Guitar](https://www.ultimate-guitar.com/explore?type[]=Pro), Tabs
   vom Typ "Guitar Pro" über "Download"). Die Seite des Tabs lässt sich gleich als "Quelle für Guitar-Pro-Datei"
   eintragen und wird mit gespeichert.
2. **Audio hinzufügen**: YouTube-URL im Bearbeitungsmodus im unteren Panel "Audio" eintragen, dann lokal `bin/audio.php` 
   starten (siehe "Audio von YouTube").
3. **Bearbeiten und spielen.**

alphaTab liest die Datei im Browser, weil PHP die GP-Formate nicht selbst auswerten kann (`readGpFile()` in
`js/notation.js`):

- Titel, Interpret, Beschreibung (in Guitar Pro "Notices", oft Links zu Tabs und Videos) und die übrigen Angaben
  gehen nach `song.json`: die Beschreibung in die Notizen (`notes`), Untertitel, Album, Text, Musik, Copyright,
  Tab-Autor und Anweisungen 1:1 in eigene Felder. Fehlt der Titel, wird er aus dem Dateinamen gebildet ("Interpret -
  Titel.gp").
- Die Noten werden automatisch und ohne Rückfrage bereinigt (`cleanImportedScore()`, siehe "Akkorde und
  Griffbilder"): je Spur und Akkordname ein Griffbild aus dem Katalog, keine Rhythmus-Schrägstriche, keine
  Anzeige-Angaben je Spur. Tonart und Vorzeichen bleiben wie in der Datei, Korrekturen schlägt der Editor vor.
- Dann werden sie ohne die Angaben zu alphaTex (siehe "Notenformat"). Danach liest der Browser das Ergebnis wieder
  ein und vergleicht es Takt für Takt mit dem Modell (`exportScore()`). Geht dabei etwas verloren, warnt der Dialog
  mit den betroffenen Takten ("Abweichungen in 2 Takten (Takt 12, 30)"); der Benutzer wählt "Trotzdem übernehmen"
  oder "Abbrechen". Abgelehnt wird nur, wenn alphaTab das Ergebnis gar nicht lesen kann.
- Der Server prüft das Format am Dateiinhalt (nicht an der Endung), legt die GP-Datei unverändert unter `upload/` des Songs 
  ab und speichert die Noten als `score.atex`. Danach ändert sie nur noch der Bearbeitungsmodus.

Enthält eine GP8-Datei eine Audiospur (MP3), löst der Server sie aus dem Original heraus (`extract_gp_audio()`): Die
MP3 wird unverändert zu `audio.mp3` (auf dem Server gibt es kein ffmpeg zum Umwandeln). Die Sync-Punkte zwischen
Noten und Audiospur stehen danach in den Noten (`\sync` in alphaTex). Abgespielt wird `audio.mp3` vom Mixer
zusammen mit dem Synth (siehe "Notenansicht und Wiedergabe").

"Manuell" im selben Dialog ist für Songs ohne passende GP-Datei (wie "Manuell" im Import-Dialog der Videothek) und
öffnet das Formular "Neuer Song"; eine schon eingetragene Quelle geht mit. Weil jeder Song Noten hat, erzeugt der
Browser aus dem Formular ein Gerüst (`createScore()` in `js/notation.js`): eine Gitarrenspur mit vier leeren Takten, 
dazu Tempo (sonst 120), Tuning, Kapodaster und Tonart (die klingende, nicht die der Griffe). Diese vier Felder gibt es 
nur beim Anlegen; danach stehen sie in den Noten und werden im Editor geändert.

### Audio von YouTube

`bin/audio.php` läuft lokal, holt die Audiospur der Songs mit YouTube-URL (noch ohne `audio.mp3`), wandelt sie um und
lädt sie per `PUT api/audio.php` hoch. Ablauf, Optionen, Transponieren der Audiospur und das Verhalten bei einem
anderen Clip stehen im Kopf von `bin/audio.php` und in `php bin/audio.php --help`; das portable Paket für einen anderen
PC baut `bin/build_audio_portable.cmd` (Beschreibung im Kopf der Datei).

```
php bin/audio.php --password=… --dry-run    # nur zeigen, was zu tun ist
php bin/audio.php --password=…              # holen, umwandeln, hochladen
```

### GP-Export

Im Menü der Songansicht erzeugt "Guitar-Pro-Export" eine vollständige `.gp`-Datei (`exportGpFile()` in
`js/notation.js`): Noten aus `score.atex`, Titel, Interpret, Notizen und die weiteren Angaben aus `song.json`, dazu die
Audiospur mit den Sync-Punkten. Guitar Pro 7 und 8 öffnen sie; ein erneuter Import ergibt wieder dieselben Noten.
Verloren gehen dabei nur Layout-Feinheiten wie feste Taktbreiten.

### Leadsheet drucken

"Leadsheet drucken" im selben Menü druckt das Blatt (auch als PDF), ohne den Dialog "Leadsheet" zu öffnen
(`printSongLeadsheet()` in `js/sheet.js`): Es wird unsichtbar gesetzt wie in der Vorschau und dann gedruckt. Im
Bearbeitungsmodus gilt der Stand im Editor (auch ungespeichert), sonst der gespeicherte. Titel und Interpret im Kopf des
Blatts kommen aus `song.json`.

### Rohmaterial

Alles, was hochgeladen wird (GP-Datei beim Import, Dateien aus dem Dialog "Uploads": GP-, ChordPro-, Textdateien, PDFs,
Bilder, Power Tab, MusicXML), landet unverändert unter `data/songs/<slug>/upload/` (`store_original()` in
`api/lib/file_store.php`):

- Liegt dort schon eine Datei mit gleichem Inhalt (MD5-Hash), wird nichts abgelegt.
- Ist der Name schon vergeben, bekommt die neue Datei einen Zähler (`text.cho`, `text-2.cho`, …).
- Im Upload-Ordner wird nie etwas überschrieben oder verändert. Gelöscht wird nur auf Wunsch: mit dem Papierkorb am
  Eintrag im Dialog "Uploads" (nach Rückfrage) oder mit dem ganzen Song.
- Jede Datei hat eine **Quelle** (meist die URL der Seite, von der sie stammt) und eine **Beschreibung**. Sie stehen in
  Feld `uploads` in `song.json` (Dateiname → `source`, `description`, `added`; `api/lib/uploads.php`); auch Dateien ohne Angaben erscheinen in der Liste, das
  Datum der Aufnahme ist dann das der Datei. Nur diese Angaben lassen sich ändern.
- **Dialog "Uploads"** (Büroklammer in der Werkzeugleiste des Bearbeitungsmodus, `js/uploads.js`): Liste mit Name (Klick öffnet die Datei), Größe, Datum, Quelle und
  Beschreibung (Stift zum Ändern, Papierkorb zum Löschen), darunter das Formular "Datei hinzufügen": eine Datei oder ein **Direktlink**, von dem der 
  Server sie lädt (nur http/https, nur öffentliche Adressen, höchstens 32 MB, drei Weiterleitungen, 60 Sekunden; ohne 
  eigene Quelle gilt der Link). Angenommen werden GP-Dateien, `.ptb`, MusicXML, MIDI, ChordPro, Text, PDF und Bilder. 
  Die Knöpfe "Spur aus GuitarPro-Datei importieren" und "Chord-Datei importieren" öffnen denselben Dialog zur Auswahl 
  ("Wählen", nur passende Dateien).
- Beim Import trägt das Feld "Quelle der Datei" die Quelle der GP-Datei ein.
- Ändert sich der Slug, zieht der Upload-Ordner mit um.

Eigene Cover gehören nicht dazu: Hochgeladen wird nur die im Browser verkleinerte JPEG, und die ist `cover.jpg`.

### Guitar-Pro-Formate

| Version   | Endung                 | Aufbau                                                                           |
|-----------|------------------------|----------------------------------------------------------------------------------|
| GP3 – GP5 | `.gp3`, `.gp4`, `.gp5` | Binärformat; Kennung "FICHIER GUITAR PRO v…" am Anfang, danach Angaben und Noten |
| GP6       | `.gpx`                 | Eigenes komprimiertes Containerformat ("BCFZ")                                   |
| GP7, GP8  | `.gp`                  | ZIP-Archiv mit den Noten als XML in `Content/score.gpif`                         |

**GP7 und GP8 haben dasselbe Dateiformat.** Ein eigenes GP8-Format gibt es nicht: Guitar Pro 8 schreibt weiter `.gp`
und hat darin nur Neues ergänzt, vor allem die Audiospur (als Datei unter `Content/Assets/`) und die Sync-Punkte
zwischen Noten und Audio. Deshalb steht auch überall "GP7/GP8" bzw. "GP3 bis GP8", obwohl es nur fünf Formate gibt.

alphaTab liest alle Formate von GP3 bis GP8. Schreiben kann es nur `.gp`: Die Exportfunktion heißt zwar
`Gp7Exporter`, schreibt laut alphaTab aber "Guitar Pro 7+" und nimmt eine Audiospur mit. Power-Tab-Dateien (`.ptb`)
kann alphaTab nicht lesen.

### Notenformat (alphaTex)

Intern speichert das Gitarrenbuch die Noten als [alphaTex](https://alphatab.net/docs/alphatex/introduction), dem
Textformat von alphaTab, und nicht als GP-Datei:

- **Der Editor arbeitet ohnehin mit alphaTab.** alphaTab liest und schreibt alphaTex selbst, ohne Umweg über ein
  fremdes Format. Der Server muss nie in GP-Dateien schreiben.
- **Die Sync-Punkte stehen mit drin** (`\sync (Takt Wiederholung ms)`) und hängen an den Takten: Fügt der Editor einen
  Takt ein, wandern sie mit. Eine eigene `sync.json` gibt es deshalb nicht.
- **Es ist Klartext**: lesbar, von Hand änderbar, gut zu vergleichen und gut für die KI-Funktionen, die Noten lesen
  und neue Spuren schreiben sollen.
- **Geprüft am Archiv**: Alle 41 überarbeiteten Songs aus Guitar Pro kamen über alphaTex ohne Abweichung zurück
  (je Schlag Bund, Saite, Dauer, Text, Akkord und Effekte, dazu Tempowechsel, Abschnitte und Sync-Punkte). Rund
  100 KB je Song sind unkritisch. Zwei fremde GP5-Dateien mit Schlagzeugspuren schreibt alphaTab nicht verlustfrei
  als alphaTex; der Import warnt davor.
- **Risiko**: alphaTex kann sich mit neuen alphaTab-Versionen ändern. Vor einem Update werden deshalb alle Songs mit
  der alten Version geladen und mit der neuen gespeichert; die Originale in `upload/` und der GP-Export bleiben als
  Sicherung.

Eine reine JSON-Fassung der Noten (`JsonConverter` von alphaTab) kam nicht in Frage: rund 80-mal so groß wie die
GP-Datei und als Speicherformat nicht gedacht.

### Cover

Beim Import sucht der Server mit Interpret und Titel ein Albumcover, zuerst bei Deezer, dann bei iTunes (beide ohne
API-Schlüssel), und übernimmt den ersten Treffer. Findet er nichts oder ist keiner der Dienste erreichbar, läuft der
Import trotzdem durch und die Kachel zeigt den Platzhalter.

Ändern lässt sich das Cover im Dialog "Stammdaten" (Menü ⋮): Ein Klick auf das Cover öffnet den Cover-Dialog über
dem Dialog, dessen Eingaben bleiben erhalten. Der Dialog zeigt die Treffer beider Dienste zur Auswahl; gerade bei
Best-of-Alben oder Live-Versionen passt der erste Treffer nicht immer. Interpret und Titel lassen sich für eine neue
Suche ändern. Außerdem kann ein eigenes Bild hochgeladen oder das Cover entfernt werden; "Bilder bei DuckDuckGo
suchen" öffnet dafür die Bildersuche nach Interpret und Titel. Änderungen am Cover werden
sofort gespeichert.

Gespeichert wird das Cover als `cover.jpg` mit 500 × 500 px. Deezer und iTunes liefern diese Größe fertig. Eigene
Bilder verkleinert der Browser, bis die kürzere Seite 500 px misst, und wandelt sie in JPEG um; der Server schneidet
sie dann mittig quadratisch auf 500 × 500 px zu (GD, kleinere Bilder werden vergrößert). Laden darf der Server Cover
nur von den Bildservern von Deezer und iTunes.


### Text und Akkorde

Text, Akkorde und Abschnitte werden nur einmal gespeichert, in den Noten: Silben und Akkordsymbole hängen an den
Schlägen, haben also einen genauen Zeitpunkt, Abschnitte sind Marker an den Takten. So liegen sie auch in den
überarbeiteten GP-Dateien des Archivs. Ein `song.cho` gibt es nicht; ChordPro und die DIN-A4-Seite werden aus den
Noten erzeugt, nur Angaben für das Blatt (Patterns, Tab-Stellen …) kommen in `song.json` (Feld `leadsheet`); Randnotizen
sind Texte über den Schlägen in den Noten.
Umgekehrt ginge Information verloren: ChordPro kennt nur "Akkord vor dieser Silbe", Akkorde ohne Silbe (Intro,
Zwischenspiel) hätten keinen Schlag mehr.

**Zeilenumbrüche** des Liedtexts stehen ebenfalls in den Noten: als `\n` am Ende der letzten Silbe jeder Zeile, z. B.
`lyrics "Ber-lin,\n"` (`LYRICS_BREAK` in `js/notation.js`). alphaTab zeichnet das Zeichen nicht (Änderung 4 unter
"Setup", Punkt 8). Gesetzt werden sie im Panel "Liedtext" des Bearbeitungsmodus, dort bekommt jede Zeile ihren
Umbruch; hat eine Strophe keine, bricht die Ansicht selbst um (nach Satzzeichen, Pausen und Abschnitten). Guitar Pro
speichert den Text samt Umbrüchen als Fließtext, alphaTab verwirft sie beim Import.

**Liedtext auf die Schläge verteilen** (Panel "Liedtext", `setLyricsText()` und `placeSyllables()` in
`js/notation.js`):

- **Guitar Pro** verteilt den Fließtext bei jeder Änderung neu von vorn: jede Silbe auf die nächste Note, ein
  doppeltes Leerzeichen lässt eine aus. Ein zusätzliches Wort verschiebt alles dahinter; gehaltene Silben und Lücken
  muss man mit Leerzeichen nachbauen. Eine Silbe kann nur unter einer Note stehen, nicht unter einer Pause.
- **Wir** vergleichen alten und neuen Text des Felds (längste gemeinsame Folge der Silben) und ändern nur, was sich
  geändert hat:
  1. Gleich gebliebene Silben bleiben auf ihrem Schlag, Lücken (gehaltene Silben) bleiben erhalten.
  2. Geänderte oder neue Silben kommen auf die Schläge der alten an derselben Stelle, reichen die nicht, auf freie
     Schläge dahinter bis zur nächsten gleich gebliebenen Silbe.
  3. Passt es auch so nicht, rückt der Rest des Abschnitts Schlag für Schlag nach, bis zum Abschnittsende; was dann
     übrig bleibt, macht den Abschnitt rot. Ein Abschnitt verschiebt nie die folgenden.
  4. Verteilt wird immer vom Stand vor dem Schreiben aus: Wird ein zu langer Abschnitt wieder gekürzt, stehen die
     Silben wie vorher (das Nachrücken in 3 füllt Lücken).
- **Schlag, nicht Note:** Im Modell von alphaTab hängt die Silbe am Schlag (`beat.lyrics`), auch an einer Pause;
  alphaTab speichert und zeichnet sie dort (Test-Song, Takt 12: `r.4{lyrics "Ak-"}`). Beim Verteilen zählen aber nur
  Schläge, auf denen eine Note angeschlagen wird, also keine Pausen und keine übergebundenen Noten (dort klingt der
  Ton nur weiter). Ein Schlag, der schon eine Silbe hat, zählt auch als Pause mit, sonst ginge sie verloren.
- **Idee (nicht umgesetzt):** Im linken Panel beim Feld "Abschnitt" eine Checkbox "Silbe auch auf Pause". Ist sie
  gesetzt, zählen in diesem Abschnitt beim Verteilen auch die Pausen als Schläge (z. B. für gesprochenen Text oder
  einen Einsatz, der in den Noten auf einer Pause steht). Offen ist, wo die Einstellung gespeichert wird.

Im Bearbeitungsmodus übernimmt der Knopf "Chord-Datei importieren" im Panel "Liedtext" den Text einer hochgeladenen
ChordPro- (`.cho`, `.chopro`, `.crd`, `.pro`) oder Textdatei (`.txt`, z. B. Akkorde über den Zeilen): Er öffnet den
Dialog "Uploads" mit den passenden Dateien (siehe "Rohmaterial"). Den Knopf gibt es nur, solange der Text leer ist (Zeilen
mit Abschnittsnamen zählen nicht). Gelesen werden Text und Akkorde (`readChordFile()` in `js/chordfile.js`): bei ChordPro
ohne Angaben in `{…}` (`{start_of_verse: …}` wird zur Abschnittszeile) und mit den Akkorden in `[…]` vor ihrer Silbe, bei
Text mit den Akkordzeilen über den Zeilen (jeder Akkord gehört zur Silbe an seiner Spalte) und ohne den Kopf vor dem ersten
Abschnitt. Der Text kommt ins Feld und wird auf die Schläge verteilt (ein Wort je Schlag; mehrsilbige Wörter trennt man
danach mit Bindestrichen). Die Akkorde kommen an den Schlag ihrer Silbe in der Akkordspur, **nur wo dort noch kein Akkord
steht**; Akkorde, deren Silbe keinen Schlag bekam, werden gezählt und gemeldet. Kennt der Akkordkatalog einen Akkord
nicht (und `findGrips()` findet keinen Griff), steht ein einfacherer (`simplifyChord()`: ohne Basston, ohne
Erweiterungen: Am7b5 → Am7 → Am); die Griffe kommen aus dem Katalog (`normalizeChords()`).
Dasselbe gilt für "Spur aus GuitarPro-Datei importieren" im Dialog "Spuren": Sie nimmt eine hochgeladene GP-Datei.

### Spuren, Capo, Text und Akkorde

Konvention für alle Songs (Ziel, siehe Grundsatz 6). Der Import übernimmt einen Song, wie er ist; was abweicht, wird
markiert und im Editor korrigiert:

- **Keine Rollen, freie Namen** (`js/notation.js`). Spurnamen werden nicht übersetzt, gespeichert und angezeigt wird
  derselbe Name. Der Editor bietet sie als erweiterbare Auswahlliste an (`TRACK_NAMES`, dazu alle Namen aus der
  Bibliothek):

  | Name          | Inhalt                                                                     |
  |---------------|----------------------------------------------------------------------------|
  | `strumming`   | Akkorde geschlagen                                                         |
  | `picking`     | Akkorde gezupft (Picking Patterns)                                         |
  | `percussion`  | Perkussion: Klopfen auf die Gitarre, Händeklatschen (Schlagzeugspur)       |
  | `fingerstyle` | Begleitung und Melodie zugleich, allein spielbar                           |
  | `vocal`       | Melodie zum Singen                                                         |

  `voice` wäre missverständlich, so heißen in alphaTab die Stimmen eines Takts. Die **Reihenfolge** ist die der
  Datei; man legt sie im Editor fest (Dialog "Spuren", ↑/↓), der Player sortiert nicht um.
- **Akkorde und Text stehen je in genau einer Spur**, festgelegt im Editor über Radiobuttons (Dialog "Spuren",
  Spalten "Akkorde" und "Text"). Gespeichert wird die Wahl nicht eigens: Es ist die Spur, in der sie stehen
  (`chordsTrack()`, `lyricsTrack()`, je die mit den meisten). Eine zweite Angabe (Rolle, Feld in `song.json`) könnte
  den Noten widersprechen. Stellt man um, ziehen Akkorde bzw. Text ganz in die neue Spur (`moveContent()` in
  `js/notation.js`); hat die Spur an einer Stelle keinen Schlag, fragt der Editor, ob der klingende Schlag geteilt
  und angebunden (klingt gleich) oder der Akkord bzw. die Silbe auf diesen Schlag gesetzt werden soll, und ebenso,
  wenn dabei Akkorde oder Text wegfallen. Ältere Songs haben Akkorde oft in mehreren Spuren: Angezeigt werden sie
  zusammengetragen (`mergeChords()`: Stehen an einer Stelle verschiedene, gewinnt die Akkordspur, danach die Spuren in
  ihrer Reihenfolge); der Editor meldet sie und überträgt sie auf Knopfdruck. Kopierte und importierte Spuren
  bekommen weder Akkorde noch Text mit.
- **Der Capo gilt für den ganzen Song.** alphaTab speichert ihn je Spur (`\capo`), alle Gitarrenspuren haben
  denselben. Tab-Bünde zählen ab dem Capo. Ändert man den Capo im Editor, bleiben die Griffe (siehe "Transponieren"); 
  nur "Capo angleichen" (`unifyCapo()`) rechnet die Bünde der anderen Spuren um, damit sie gleich klingen (`moveToCapo()`).
  Liegt dabei eine Note unter dem Capo, kommt sie auf eine andere freie Saite; geht das nicht (die leere tiefe E-Saite 
  bei Capo 2), eine Oktave höher. An der Original-GP-Datei von "Stand By Me" geprüft: "Guitar No Capo" bekäme Capo 2 und 
  G Em C D statt A F#m D E, 97 Noten auf der leeren tiefen E-Saite kämen eine Oktave höher, alle anderen klingen gleich.
- **Akkorde sind Griffnamen relativ zum Capo**, also nicht klingend: Wer bei Capo 2 C greift, liest C. Klingend
  notiert sind nur die Noten; `\ks` ist die klingende Tonart. Der Kopf zeigt beides, etwa "Tonart D · Capo 2".
  Wechselt der Capo, bleiben die Griffe, nur die klingende Tonart wandert mit.
- **Ein Akkord ist Name plus Griff.** Am Schlag steht der Name, in der Akkorddefinition der Spur der Griff
  (`\chord ("Am" x 0 2 2 1 0)`), je Name genau einer; ohne eigene Definition gilt der Standardgriff des Katalogs.
  Nur über den Griff ginge nicht: `x02210` ist Am, aber auch C6/A, über dem Text soll "Am" stehen, und Tonart,
  Transponieren und ChordPro brauchen den Namen. Zwei Griffe desselben Akkords in einem Song bekommen zwei Namen
  ("G" und "G*", wie in "Kokain").

**Einhaltung:** Abweichungen von dieser Konvention (Konflikte) löst der Import ohne Rückfrage (`resolveConflicts()` in
`js/conflicts.js`, siehe unten und `docs/Konflikte.md`); im Editor entstehen keine. Eine Prüfung oder Anzeige von
Konflikten gibt es deshalb weder in der Übersicht noch im Song oder im Editor.

**Der Import** bereinigt Formales (`cleanImportedScore()` in `js/notation.js`, siehe "Akkorde und Griffbilder"):
Rhythmus-Schrägstriche (sonst stürzt alphaTab ab), Anzeige-Angaben je Spur, Notizen im Namen des Tunings und die
Griffbilder. Danach löst er alle Konflikte ohne Rückfrage (`resolveConflicts()` in `js/conflicts.js`): Wiederholungen
ausschreiben, Taktlängen, Triolen-Feeling, ein Capo und ein Tuning, Akkorde und Text in je einer Spur, unbekannte
Akkordnamen und unpassende Griffe. Liedtext, der nicht in die Textspur passt, kommt als Chord-Datei in den
Upload-Ordner. Regeln: `docs/Konflikte.md`.



### Akkorde und Griffbilder

**Begriffe:** Ein **Akkordgriff**, kurz **Griff**, ist die Schreibweise von der tiefen E-Saite aus, z. B. `xx023x`
("x" = nicht gespielt). **Akkordname mit Griff** ist beides zusammen, z. B. "D5: xx023x". Das **Griffbild** ist die
Zeichnung des Griffs (`chordDiagramSvg()` in `js/base.js`).

Der **Akkordkatalog** `data/chords.json` (`api/chords.php`, `js/base.js`) enthält die in den Songs verwendeten 
Akkorde mit ihren Griffen im Standard-Tuning, z. B. `"c": ["x32010", "xxx553"]`. Schlüssel ist der Akkordname in
Kleinbuchstaben, ein Griff steht von der tiefen E-Saite aus ("x" = nicht gespielt; ab Bund 10 mit "-" getrennt). Der
erste Griff ist der Standard, nämlich der in den Songs am häufigsten gespielte.
Das Menü ☰ oben rechts in der Songliste öffnet "Akkorde", "Patterns" und "Griffbrett" als Dialog (kein eigener Hash 
mehr). "Akkorde" zeigt alle Griffe zum Ansehen und Drucken (es wird nur der Dialog gedruckt), in aufklappbaren Gruppen 
je Grundton (gedruckt wird alles, auf weißem Grund). "Griffbrett" (`js/base.js`) zeigt das Griffbrett bis zum 15. Bund im
Standard-Tuning. In zwei Auswahllisten wählt man den Grundton und was gezeigt werden soll: ein einzelner Ton (vorbelegt: 
C), ein Akkord (Dur, Moll, 7, Major 7, Moll 7, sus2, sus4, vermindert, übermäßig) oder eine Tonleiter (Dur, natürlich 
und harmonisch Moll, Dur- und Moll-Pentatonik, Blues, dorisch, mixolydisch). Der Grundton ist dunkler hervorgehoben, 
leere Saiten stehen links vom Sattel; die Überschrift nennt die Töne ("A-Moll-Pentatonik: A C D E G"). Zum Ansehen und 
Drucken. Der Katalog baut sich aus den Songs **von allein auf** (`api/lib/chords.php`) und zeigt nur, was in den Songs 
vorkommt. Die Seite "Akkorde" zeigt nur diese Griffe. Der Akkorddialog im Editor ergänzt Griffe für Akkorde, die noch 
kein Song nutzt, aus dem Namen (`parseChord()` in `js/chordtheory.js`
zerlegt den Namen in Töne, `findGrips()` in `js/chordgrips.js` sucht dafür Griffe; die Regeln stehen in
`docs/Musiktheorie.md`). `api/chords.php` liest
die Akkorde aller `score.atex` (`\chord ("G" 3 0 0 0 2 3)` mit den Schlägen `ch "G"`), nur Spuren im Standard-Tuning 
und Griffe mit mindestens drei gespielten Saiten. Je Akkord steht der **am häufigsten gespielte Griff zuerst**, bei 
Gleichstand der weiter unten am Hals. `data/chords.json` ist nur der Zwischenspeicher: Er wird neu gebaut, wenn er fehlt 
oder eine Partitur bzw. der Liederordner oder `chords.php` neuer ist; von Hand eingetragene Änderungen gehen dabei 
verloren. `api/chords.php?usage=1` liefert die Zahl der Schläge je Griff (der Akkorddialog nutzt sie).
"Patterns" zeigt ebenso den Katalog der Strumming und Picking Patterns (nur Ansicht und Druck, in Gruppen je Technik, 
je Pattern Name, Taktart, Raster (nur Sechzehntel, Achtel ist der Normalfall) und Zahl der Songs); bearbeitet wird er im 
Leadsheet-Dialog des Bearbeitungsmodus ("Pattern-Katalog …"). Zwei Auswahlfelder filtern nach **Taktart** und **Genre**; 
die Strumming Patterns halten immer Platz für die Betonungszeichen frei, damit alle gleich hoch sind. Das Genre eines 
Patterns ist das Genre der Songs, die es verwenden (Tags der Songs; `api/patterns.php` liefert sie als `genres`
je Pattern-id); ein Pattern, das kein Song nutzt, hat keines und erscheint nur unter "Alle Genres".

In den Noten zeigt jede Spur **je angeschlagenem Akkordnamen genau ein Griffbild**, den Standardgriff des Katalogs
(`normalizeChords()`), mit Barré-Balken (`barreFret()`/`barreOf()`, Regeln in `docs/Akkorddialog.md`: F `133211`, 
Bm `x24432`, F#m `xx4222`; alphaTex `barre N`). Nur Akkorde, die der Katalog nicht kennt, behalten ihren meistgenutzten 
Griff aus der Datei, z. B. die Septakkorde "D7*", "D#7*", "E7*" in "Kokain", die in einer Lage hochrutschen. Ob GP ein 
Griffbild ein- oder ausblendet, zählt nicht. Hintergrund: alphaTex unterscheidet Akkorde nur nach dem Namen, und viele 
GP-Dateien hatten mehrere Varianten gleichen Namens, oft Bruchstücke mit ausgeblendetem Griffbild; in 12 Songs fehlten 
deshalb Griffbilder im Kopf.

**Über den Noten** zeichnet alphaTab nichts mehr (`HIDDEN_SCORE_ELEMENTS` in `js/playback.js`): Titel, Interpret usw.
stehen schon in der Kopfzeile der Seite, ebenso der Capo (dort fett, man übersieht ihn leicht; "Capo. fret 1" über dem 
ersten Takt drängte sich dort mit Tempo, Abschnitt und Akkordnamen) und das Tuning, wenn es nicht das Standard-Tuning 
ist: "Tuning **D** A D G B E", abweichende Saiten fett; unterscheiden sich nur die Oktaven, mit Oktaven ("Johnny 
Walker" steht auf E3 A3 D4 G4 B4 E5, eine Oktave über dem Standard-Tuning; das passt noch nicht in die Kopfzeile, 
offen). Wechselt das Tempo, steht der Bereich in der Kopfzeile ("89–96 BPM"). Das Tempo zählt immer in Vierteln: 
alphaTab rechnet beim GP-Import andere Bezugsnoten (Achtel, punktierte Viertel, …) um, alphaTex kennt nur Viertel; 
Kommazahlen (`\tempo 88.7`) sind erlaubt.

**Griffbilder** zeigt der Player nur für den Akkord, der gerade klingt (siehe "Leiste" unten).
Alle Griffbilder eines Songs auf einmal (`renderChordDiagrams()` in `js/textview.js`, in der Reihenfolge des ersten
Anschlags) bleiben für Leadsheet und Druck; Maße: 86 px breit (etwas größer als die von alphaTab), Akkordname im SVG 
auf 19 Einheiten, je Reihe gleich viele (passen höchstens m in eine Reihe, braucht es n = ⌈k / m⌉ Reihen für alle k, 
jede bekommt ⌈k / n⌉). Die Skalierung (Menü → Darstellung) wirkt in "Chords" nur auf den Inhalt (`--scale` in `app.css`); 
das Blatt behält Breite und Hintergrund.

Den **Systemtrenner** aus Guitar Pro (zwei schräge Striche zwischen den Notenzeilen, `\useSystemSignSeparator`)
entfernt der Import. Den Abstand zwischen den Zeilen setzt der Player (`SYSTEM_GAP`, 45 px bei 
mehreren angezeigten Spuren, damit man sieht, wo eine Zeile mit allen Spuren endet; `SYSTEM_GAP_SINGLE`, 20 px bei nur 
einer), ebenso den zwischen den Spuren einer Zeile (`TRACK_GAP`, 20 px statt 5; sonst klebte "Rhythm Guitar 1" in 
"Junge" an den Tabs der Spur darüber) und zwischen den Angaben über den Noten (`EFFECT_GAP`, 8 px statt 2: Tempo, 
Abschnitt, Text, Akkordname).

**Reihenfolge der Spuren und Liedtext** (`orderTracks()`, `applyLyrics()` in `js/playback.js`): Die Spuren stehen in
der Reihenfolge der Datei; sie wird im Editor festgelegt (Dialog "Spuren", ↑/↓). Früher sortierte der Player nach
Rollen (Begleitung oben, Gesang unten); das ist mit den Rollen weggefallen, damit jede Spur dort steht, wo man sie
hingestellt hat. Der Mixer zeigt die Spuren in derselben Reihenfolge. Den Text
zeigt nur eine Spur: die Spur mit dem Text, wenn sie angezeigt wird, sonst die unterste angezeigte Spur, je Silbe am
Schlag an derselben Stelle bzw. am Schlag, der dann klingt (`projectLyrics()`; nur zur Anzeige, gespeichert wird
nichts). Die Akkorde stehen immer über der obersten angezeigten Spur, auch wenn die Akkordspur ausgeblendet ist
(`applyChordNames()`).
In älteren Songs steht derselbe Text oft in mehreren Spuren; der Editor räumt das beim Umstellen auf (siehe
"Spuren, Capo, Text und Akkorde"). Unter den Tabs steht der Text dank der zweiten Änderung an alphaTab, mit Abstand
dank der dritten (siehe "Setup", Punkt 8).

**Alle Texte in den Noten** (Akkorde, Abschnitte, Liedtext, Tempo, Beat-Texte, Spurnamen, Taktnummern, …) stehen in der 
Schrift der Seite (`TEXT_FONT` in `js/playback.js`), Größe und Stil wie bei alphaTab; die Notenschrift selbst (Bravura) 
bleibt. Der Liedtext steht gerade statt kursiv, 13 px (`LYRICS_FONT_SIZE`). Leere Strophen am Ende eines Schlags
lässt der Player weg (`withoutTrailingEmpty()`): Aus Guitar Pro haben die Schläge oft fünf Strophen, meist nur die
erste mit Text, und alphaTab rechnet den Abstand zwischen Strophen auch für die leeren mit; der Text hatte darunter
gut 20 px zu viel.

**Spurnamen** stehen bei mehreren angezeigten Spuren senkrecht links neben jeder Spur, in jeder Notenzeile, mit dem
Namen aus den Noten, unübersetzt (ohne Namen "Spur 1" usw., `trackName()`); bei einer Spur keiner (`showTrackNames()`
in `js/playback.js`). Was die Dateien aus Guitar Pro vorgeben (in 40 Songs `\multiTrackTrackNamePolicy hidden`), gilt
im Player nicht.

**Akkordnamen** stehen über den Noten einmal, an der obersten angezeigten Spur (`applyChordNames()` in
`js/playback.js`). Zusammengetragen werden sie aus allen Spuren nach der Regel der Konvention (`mergeChords()` in
`js/notation.js`): Stehen an einer Stelle verschiedene Akkorde, gewinnt die Akkordspur (`chordsTrack()`), danach die
Spuren in ihrer Reihenfolge. Genau so schreibt der Editor die Akkorde in die Akkordspur (`moveContent()`). alphaTab 
hängt einen Akkordnamen an einen Schlag; hat die oberste Spur an der Stelle keinen (eine lange Note klingt), kommt er 
an die nächste angezeigte Spur, die dort einen hat. Dafür hängt der Player die Akkorde im geladenen Modell um 
(gespeichert wird es nie). In "Junge" steht so auch das Asus2 aus "Rhythm Guitar" (Takt 6) über "Gitarre". Die Ansicht 
"Chords" nimmt die Akkorde nach derselben Regel. Verschiedene Akkorde an derselben Stelle sind 
meist Varianten (D/A gegen D, Am7 gegen Am, F5 gegen F); echt verschieden ist z. B. "Ring of Fire", Takt 7 (C in 
"Guitar", D in "Vocal"). Das klärt der Editor.

Die Akkordnamen über den Noten stehen wie in der Ansicht "Chords" in der Schrift der Seite, fett, 16 px (`TEXT_FONT`,
`CHORD_FONT_SIZE` in `js/playback.js`, über `elementFonts` von alphaTab). Blau wie in "Chords" wären sie nur mit einer
Änderung an alphaTab (eine Farbe nur für Akkordnamen gibt es nicht, über den Stil des Schlags färben sich Tempo,
Abschnitt und Text mit); verworfen, damit alphaTab möglichst unverändert bleibt.

**Abschnittsnamen** über den Noten sehen aus wie die Überschriften in "Chords": ohne die eckigen Klammern aus Guitar
Pro, in Großbuchstaben, englisch wie in den Noten ("[Verse 1]" → "VERSE 1"), Schrift der Seite, fett, 13 px
(`showSectionNames()`, `SECTION_FONT_SIZE` in `js/playback.js`; geändert wird nur das geladene Modell). Eine Farbe, ein
Rahmen oder eine andere Lage gehen nicht ohne Änderung an alphaTab. In den Noten stehen sie meist als
`\section ("" "[Verse 1]")`, in vier Songs ohne Klammern, mal mit, mal ohne Nummer; 9 der 42 Songs haben keine
Abschnitte (Aufgabe für den Editor).

**Layout-Fehler in alphaTab 1.8.4:** Abschnittsname ("[Intro]") und Akkordname auf dem ersten Schlag eines Takts
landen in derselben Zeile übereinander, der Akkordname ist dann nicht zu sehen ("Junge", Takt 1). Ursache: Zwei
Angaben dürfen sich eine Zeile teilen, wenn die eine an dem Schlag endet, an dem die andere beginnt
(`canBeUsed()`: `this.shared.lastBeat===t.firstBeat`); das trifft auch zwei Angaben auf demselben Schlag.
Nachgestellt mit eigenen Testnoten im Browser. Behoben mit einer Änderung an der alphaTab-Datei (siehe "Setup",
Punkt 8); bei alphaTab bekannt und für 1.9 behoben.

Die **Vorzeichen** prüft `detectKeySignature()` (für den Editor, der Import ändert sie nicht): Akkorde (mit Capo
klingend gerechnet) und gespielte Töne gegen die notierte Tonleiter. Passt eine andere klar besser, schlägt sie diese
vor, mit dem Schlussakkord als Grundton, wenn dessen Tonart kaum schlechter passt ("Happy Xmas" mit G-Akkord in A
wird A-Dur, nicht D-Dur). 

Der Import bereinigt neue Songs nach diesen Regeln. Dabei fallen auch die
Rhythmus-Schrägstriche weg (die Schläge stehen als normale Akkordschläge da): alphaTab 1.8.4 stürzt an ihnen ab,
wenn eine Spur nur Tabs zeigt (`paintBeamingStem`), ganze Takte blieben leer. Ebenso die Anzeige-Angaben je Spur
(`\staff { score tabs }`): Noten und Tabs wählt der Player. Und die Tonart im Namen des Tunings ("Key: C (orig.
D)"), ein Notbehelf in Guitar Pro, teils im Widerspruch zu den Vorzeichen; sie steht schon in `\ks`. Der Import setzt 
als Namen des Tunings allgemein nur das Tuning selbst: den Namen, den alphaTab für die Tonhöhen kennt ("Guitar Standard 
Tuning", "Guitar Dropped D Tuning"), sonst keinen.


### Strumming und Picking Patterns

Patterns kommen aus einem **Katalog** wie die Griffe aus dem Akkordkatalog: `data/patterns.json` (`api/patterns.php`,
`js/sheet.js`); fehlt die Datei, legt `api/patterns.php` sie mit der eingebauten Erstbefüllung an. Ein Pattern 
beschreibt einen Takt im Raster (Achtel oder Sechzehntel), ein Zeichen bzw. Schritt je Rasterplatz:

```json
{"id": "folk", "name": "Folk", "technique": "strumming", "timeSignature": "4/4", "grid": 8, "strokes": "d.du.udu"}
{"id": "travis", "name": "Travis-Picking", "technique": "picking", "timeSignature": "4/4", "grid": 8,
 "steps": "p i q m p i q m"}
```

**Großbuchstabe = betont**: So steht alles in einem Feld und kann nicht
auseinanderlaufen. Üblich ist sonst ein ">" über dem Schlag; so zeigt es auch das Raster.

- **Strumming Patterns** (`strokes`): d Plektrum abwärts, u Plektrum aufwärts, x gedämpft, `.` klingen lassen; 
  `D.duD.du` ist Folk mit Betonung auf 1 und 3.
- **Picking Patterns** (`steps`, durch Leerzeichen getrennt) als **Fingersatz**. Die Saite
  folgt aus dem Finger nach der festen Regel aus den Gitarrenschulen: p = Daumen auf dem tiefen Bass (tiefste
  gegriffene Saite des Akkords), q = Daumen auf dem zweiten Bass (bei Bass auf der 6. Saite die 4., sonst die
  nächsthöhere), i = g-Saite, m = b-Saite, a = e-Saite. Ohne Leerzeichen zugleich (`pa`, `ima`), `.` klingen lassen,
  `x` Pause. Mit p und q gilt ein Pattern für jeden Akkord; einen Finger auf einer anderen Saite gibt es nicht.

Eingegeben wird im Feld oder per Klick ins Raster des Formulars (Strumming Patterns: nichts → ab → auf → gedämpft; 
Picking Patterns: Finger auf der Saite setzen/wegnehmen; Klick auf die Zählzeit betont, beim Picking Pattern an leerer 
Stelle Pause).

**Anzeige** als Raster (`patternGridHtml()` in `js/sheet.js`): ganz unten die Zählzeiten, berechnet aus Taktart
und Raster ("1 + 2 + …", "1 e + a …", in 6/8 "1 2 3 4 5 6"), betonte Schritte als fette Zählzeit, beim Strumming 
Pattern zusätzlich ">" über dem Zeichen. Strumming Patterns mit den Plektrumzeichen (abwärts, aufwärts) der Notenschrift 
(wie in den Noten), gedämpft ×. Picking Patterns wie eine kleine Tab: je Saite eine Zeile (e, b, g, B, zweite B-Zeile 
nur bei Bedarf), darauf der Finger (auf beiden Bass-Zeilen p); eine Pause steht als x auf den Saiten, die zuletzt 
angeschlagen wurden.

**Im Song** führt `song.json` (Feld `leadsheet`) die Patterns des Songs als Verweise auf die `id`, jedes mit Freitext, 
wann es gespielt wird ("ganzer Song", "Strophe"); gewählt wird im Dialog "Leadsheet". Eine Zuordnung je Takt gibt es 
nicht: Der Ablauf steht in den Noten, Zusammenhänge erkennt der Generator der Seite. Eine Änderung am Katalog-Pattern 
gilt für alle Songs, die es verwenden; die API zählt sie (`usage`), der Editor warnt davor. Pattern und Spur speichern 
nicht dasselbe: Die **Spur** ist die genaue Ausführung mit allen Ausnahmen, das **Pattern** die verallgemeinerte 
Beschreibung für das Blatt. Beide dürfen voneinander abweichen; die Knöpfe sind Hilfen beim Übertragen, keine Kopplung:

- **Aus Spur vorschlagen** (`suggestPatterns()`): je Abschnitt das häufigste Pattern der Takte einer Begleitspur
  (Richtung aus den Plektrumzeichen, sonst gerade Plätze abwärts, ungerade aufwärts; geschlagen ab drei Tönen je Anschlag),
  verglichen mit dem Katalog (Anteil gleicher Rasterplätze), gleiche zusammengefasst mit ihren Abschnitten als
  Vorschlag für "wann". Ohne Gegenstück lässt es sich gleich aufnehmen.
- **Auf Spur ausrollen** (`rollOut()`): Patterns × Akkorde in der Auswahl oder den angekreuzten Abschnitten (vorausgewählt
  die unter "wann" genannten); je Anschlag der Griff des dann klingenden Akkords aus der
  Akkordspur (Griff aus den Noten, sonst aus dem Katalog). Überschrieben werden nur leere Takte und Takte, die
  einem Katalog-Pattern entsprechen, damit Breaks und Schlüsse von Hand erhalten bleiben (außer auf Wunsch).

Songeigene Abwandlungen eines Katalog-Patterns (wie eigene Griffe) gibt es noch nicht.
### Notenansicht und Wiedergabe

alphaTab zeichnet Noten und Tabs und spielt sie mit dem eingebauten Synthesizer und einem SoundFont ab. Die 
Abspielleiste steht fest am unteren Rand und trägt alle Bedienelemente: Abspielen, Zeit,
Geschwindigkeit, Wiederholen (⟳), Ansicht, Mixer und das Menü ⋮ (siehe "Liedansicht"). Den Fortschritt zeigt eine Linie 
am oberen Rand der Leiste, gesprungen wird per Klick auf einen Takt bzw. eine Textstelle. Wer ohne Ton mitlesen will, 
schaltet im Mixer stumm. **Wiederholen per Klick:** Ist ⟳ an, wählt der erste Klick auf einen Takt den Anfang (er ist 
markiert), der zweite das Ende; wiederholt wird vom Anfang des früheren bis zum Ende des späteren Takts (`onLoopClick()`, 
in "Chords" `onLoopTick()` mit den Zeiten der Textstellen). Ein weiterer Klick beginnt eine neue Auswahl, Ausschalten 
hebt sie auf; ohne Auswahl wiederholt sich der ganze Song. Die **Geschwindigkeit** ist ein Knopf mit dem Material-Symbol 
"directions_run" (Läufer); unter 100 % steht der Wert daneben ("50 %"). Ein Klick öffnet darüber die Liste: 25 %, dann 
50 bis 100 % in Zehnerschritten (ein gespeicherter anderer Wert springt auf den nächsten in der Liste); ein Klick 
daneben schließt sie. Beim Abspielen folgt die Ansicht dem Cursor. Der Bildschirm bleibt an, solange ein Song offen ist 
(für das Smartphone am Notenständer; Text und Akkorde liest man auch ohne Abspielen). Gescrollt wird mit eigenem Handler 
(`scrollToSystem()` in `js/playback.js`): beim Wechsel in eine neue Notenzeile, die Zeile knapp unter der festen 
Kopfzeile; in der ersten Zeile ganz nach oben, damit Hinweise und Griffbilder zu sehen sind (alphaTab scrollte auch dort 
hin, schon beim Laden). Die Seite springt immer, auch beim Abspielen, statt gleitend zu scrollen. Die aktuelle Zeile 
kommt dabei ins obere Drittel (`scrollLineIntoView()`, `SCROLL_POSITION`), in "Chords" ebenso, sobald sie aus dem oberen 
Teil rutscht. "Noten werden gezeichnet" erscheint erst nach 0,4 s (`RENDER_STATUS_DELAY`), sonst blitzt es beim 
Umschalten auf.

Die Ansicht **Chords** (Umschalter in der Kopfzeile, siehe unten) zeigt statt der Noten den Songtext mit den Akkorden
(`js/textview.js`); die Wiedergabe läuft weiter. Je Abschnitt folgen die Zeilen, jeder Akkord genau über seiner Silbe 
(je Silbe ein Block, deshalb auch in Proportionalschrift und mit Umbruch auf dem Smartphone). Text und Akkorde kommen 
aus den Spuren nach "Spuren, Capo, Text und Akkorde" (Akkorde aus allen Spuren zusammengetragen, `mergeChords()`), in 
Abspielreihenfolge mit Wiederholungen und Strophen (ohne Sprünge wie D.S. al Coda). Zeilen enden an Satzzeichen, 
längeren Pausen und Abschnitten, nie mitten im Wort; ein Auftakt gehört zum folgenden Abschnitt.

**Jeder Takt kommt vor**, wie in den handgebauten Leadsheets (Vorbild: `leadsheet_manuell_erstellt.txt` von
"Junge"):

- In Abschnitten mit Text steht über der ersten Silbe jedes Takts ein Taktstrich `|`, mit dem Akkord, wenn dort einer
  angeschlagen wird (`|G`), sonst allein (`|`: der Akkord klingt weiter). Ein Akkordwechsel mitten im Takt steht ohne
  Strich über seiner Silbe.
- Ein Takt ohne eigene Silbe (oder deren erste erst in der zweiten Takthälfte beginnt) steht als leerer Teil in der
  Zeile, angehängt an ihr Ende: `gelernt? |Asus2 |Am`. Beginnt in dem Takt eine neue Zeile (Auftakt), steht er an
  deren Anfang: `|G  warum hast du …`.
- Nur Abschnitte ganz ohne Text (Intro, Solo) werden zu Taktzeilen, bis zu acht Takte je Zeile. Sie sehen aus wie die
  Akkordzeile einer Textzeile, nur ohne Text: `|F  |  |G  |  |`.
- **Strich am Zeilenende** (`closed` in `buildTextModel()`): Eine Zeile schließt mit `|`, wenn mit ihr ein Takt endet,
  also wenn die nächste Zeile mit einem Taktanfang beginnt (ihr erster Teil trägt selbst einen `|`), eine Taktzeile
  ist oder keine mehr folgt. Ein `|` am Ende und einer am Anfang der nächsten Zeile sind derselbe Taktstrich, zweimal
  gezeichnet; dazwischen liegt kein Takt.
- Beginnt die nächste Zeile mitten im Takt, endet die Zeile ohne `|`: Der Takt geht dort weiter. Typisch ist ein
  Auftakt, der wegen des Zeilenumbruchs schon in der nächsten Zeile steht, z. B. "No Woman No Cry", Bridge → Chorus 3:
  `… |Am Everything's gonna F be alright,` und darunter `so |C Woman, no G/B cry.`; "so" liegt noch im F-Takt. Der
  Auftakt gehört zum neuen Abschnitt, dessen Name steht schon über ihm.
- Verworfen wurde die Schreibweise ohne Taktstriche (`G  %  Am  Asus2`): Über dem Text sähe ein Wechsel mitten im
  Takt genauso aus wie ein neuer Takt.
- Ein Akkord gehört an die nächste Silbe bzw. den nächsten leeren Takt in seinem Takt, wenn bis dahin kein anderer
  angeschlagen wird, sonst an die Silbe, die gerade klingt. In "Junge" steht so Asus2 (Takt 16) im Intro und über
  "Jun-" (Takt 17) nur F, wie in Guitar Pro.

Für alle 42 Songs geprüft: Jeder gespielte Takt kommt genau einmal vor, in Abspielreihenfolge, und kein Akkord fehlt.

**Transponieren** (`js/notation.js`, nur im Bearbeitungsmodus): Es ändert die Noten und Tabs (aus C wird bei +2 ein D, 
die Griffe verschieben sich) und wird nicht getrennt gespeichert. Der Player zeigt und spielt immer die Datei; eine 
Tonhöhe je Song gibt es nicht.

Der Knopf **Transponieren** (Icon mit zwei Pfeilen) steht ganz links in der Leiste oben, weil Transponieren keine
Eigenschaft des Songs ist. Er öffnet den Dialog (`js/transposedialog.js`) mit drei Eingaben: **Halbtöne** (−12 bis +12),
**Capo** (absoluter Wert, vorbelegt mit dem jetzigen) und **Tuning** (Text wie "D A D G B E"). Halbtöne ändern Noten, Tabs,
Akkorde und Tonart; Capo und Tuning ändern nur die Noten (Bünde, Tabs, Akkordnamen und Griffe bleiben). Der Klang
verschiebt sich um Halbtöne + Capo + Tuning (bei gleichmäßig verschobenen Saiten); die Tonart aus dem Feld "Tonart" wandert
um diese Verschiebung. Mit −2 Halbtönen und Capo +2 bleibt der Klang, nur die Griffe sind andere. Der Dialog zeigt:

- **Tonart** über den Eingaben: "Aktuelle Tonart: Db", die notierte; von ihr aus wandert die Tonart.
- **Vorschau** untereinander, "Jetzt: Db" und "Danach: Eb": je die Griffbilder aller Akkorde des Songs und darunter alle
  gegriffenen Töne (jede Saite-Bund-Kombination einmal, von der tiefsten bis zur höchsten) mit Notenschlüssel, Vorzeichen
  und Tab (`renderMiniScore()` in `js/sheet.js`).
- **Leichteste Griffe:** Ein Vorschlag nennt das Capo (0 bis 9), bei dem die Akkorde am leichtesten zu greifen sind, wenn der
  Klang bleibt; "Vorschlag übernehmen" füllt Capo und Halbtöne. Bewertet wird der beste Griff je Akkord (`findGrips()`: Lage,
  Spanne, Finger, Barré), gewichtet mit der Zahl der Schläge.
- **Audio:** Ändert sich der Klang, bleibt die Audiospur unverändert. Der Dialog zeigt dann unten den Befehl
  `php bin/audio.php --password=… --only=<slug> --transponieren=+N --override` mit einem Knopf zum Kopieren.

Capo und Tuning stehen in der Leiste nur noch als Anzeige; ein Klick darauf öffnet den Dialog. "Anwenden" schreibt die Noten um
(`applyRetune()`, darin `transposeScore()`), als ein Schritt für "Rückgängig":

- **Töne und Tabs:** Jeder Ton wird um die Halbtöne verschoben und neu gegriffen. Gewählt wird Schlag für Schlag unter
  den möglichen Saiten und Bünden die Verteilung mit den geringsten Kosten: Hand höchstens vier Bünde breit, leere Saiten
  und tiefe Lagen günstig, die Lage soll sich gegenüber dem Schlag davor wenig ändern, die Töne bleiben möglichst auf
  ihrer Saite (ein Picking Pattern behält seine Saiten). Gebundene Noten folgen ihrer Ausgangsnote, Schlagzeug und
  Flageoletts bleiben. Passt ein Ton nicht auf das Griffbrett (z. B. unter die tiefe E-Saite) oder lassen sich die Töne
  eines Schlags sonst nicht alle greifen, kommt er eine Oktave näher; der Editor nennt die Zahl. Spuren ohne Saiten
  (Gesang, Klavier) verschieben Oktave und Ton.
- **Akkorde:** Die Griffnamen wandern um die Halbtöne (C → D bei +2). Den Griff liefert der Akkordkatalog, sonst
  der verschobene eigene (nur Barrés ohne leere Saite), sonst ein berechneter Griff (`findGrips()` in `js/chordgrips.js`).
- **Vorzeichen:** `transposeKeySignature()`.
- **Capo:** unverändert. Die Bünde zählen ab dem Capo; den Capo ändert man getrennt, und dabei bleiben die Griffe
  (die Noten ändern sich, Tabs und Griffbilder nicht; "Klang behalten" ist nicht nötig, das erreicht man mit 
  Transponieren). Beispiel: "−2" anwenden und danach Capo 2: gleiche Tonhöhe wie vorher, aber andere, leichtere Griffe. 
  Die Option "Klang behalten" gibt es weder beim Capo noch beim Tuning; ein geändertes Tuning lässt die Bünde stehen. 
  `moveToCapo()` und `setTuning(…, true)` dienen nur noch "Capo angleichen" und "Tuning angleichen".
- **Audio:** Die Audiospur verschiebt `bin/audio.php --transponieren` (siehe oben); im Editor lässt sie sich nicht verschieben.

Gespeichert wird keine Verschiebung: Nach "Anwenden" steht das Feld wieder auf 0, die neuen Noten gelten ab dem
Speichern. Die Kosten (`HAND_SPAN`, `POSITION_JUMP`, `STRING_MOVE` … in `js/notation.js`) sind Schätzwerte und lassen 
sich nachstellen.

**Beim Abspielen** (und beim Spulen) ist der aktuelle Takt hinterlegt und die aktuelle Silbe orange
(`highlightText()` in `js/playback.js`); die Stelle bleibt zwischen Kopfzeile und Abspielleiste im Blick. Dazu trägt
jeder Teil seine Zeit (`data-t`, Ticks in Abspielreihenfolge wie das MIDI von alphaTab), ein Taktanfang zusätzlich
`data-bar`. Hervorgehoben wird der zuletzt erreichte Teil, sein Takt reicht bis zum nächsten Taktanfang; eine Silbe
erst, wenn sie erreicht ist (im leeren Teil vor einem Auftakt keine). Sprünge wie D.S. al Coda kennt die Ansicht
nicht, dort liefe die Markierung falsch; solche Songs sind als "Sprungzeichen" markiert (alphaTab selbst spielt sie
richtig). Ein **Klick** auf eine Silbe, einen Akkord oder Taktstrich setzt die Wiedergabe dorthin (`onTextClick()`);
läuft sie, spielt sie von dort weiter. Die Noten werden in dieser Ansicht nur eingeklappt, damit alphaTab weiter die
Breite kennt. Die Zeilen kommen aus den gespeicherten Zeilenumbrüchen (siehe oben), sonst aus `splitPhrases()`.

Hat der Song eine `audio.mp3`, läuft sie gleichzeitig mit dem Synth (`Mixer` in `js/playback.js`). alphaTab kann beides
nicht zusammen abspielen, deshalb spielt der Mixer die Spur selbst und folgt der Position des Synths: Die Sync-Punkte in
den Noten rechnen sie in Audio-Zeit um. Abgespielt wird über Web Audio mit **Signalsmith Stretch**
(`public/vendor/signalsmith/`, Zeitdehnung im AudioWorklet): Die Audiospur wird ganz dekodiert (bei 16 kHz, wie
gespeichert) in den Knoten geladen und dort mit einer Rate gespielt, die Tonhöhe bleibt. Ein `<audio>`-Element mit
`preservesPitch` klingt bei langsamem Tempo deutlich schlechter. Der Synth folgt dem Tempo der Audiospur je Abschnitt
zwischen zwei Sync-Punkten: Beim Erzeugen des MIDI (Ereignis `midiLoad` von alphaTab) ersetzt der Player die notierten
Tempoangaben durch das Tempo der Audiospur (`applyRecordingTempo()` in `js/notation.js`). Ohne Sync-Punkte bleibt die
Audiospur stumm.

**Gleichlauf von Synth und Audiospur.** Der Synth folgt der Audiospur nicht über das Abspieltempo von alphaTab
(`playbackSpeed`): Jede Umstellung setzt den Synth in alphaTab neu an die Position, klingende Töne werden abgeschnitten,
und alphaTab meldet das als Spulen. Stattdessen gilt:

- **Tempo der Audiospur im MIDI:** Das Abspieltempo von alphaTab bleibt während der Wiedergabe gleich, der Synth folgt
  der Audiospur über die Tempoangaben im MIDI. Nur wenn Sync-Punkte im Sync-Editor während der Wiedergabe geändert
  werden, gleicht das Abspieltempo aus (ab 3 % Unterschied, kleinere Unterschiede holt die Audiospur auf). Das MIDI
  wird neu erzeugt, sobald die Wiedergabe anhält, im Stand sofort.
- **Tempo aus den Sync-Punkten:** Das Tempo je Abschnitt ergibt sich aus Ticks und Zeit bis zum nächsten Sync-Punkt
  (`playbackSyncPoints()` in `js/notation.js`). Synth und Audiospur kommen so gleichzeitig am Sync-Punkt an.
- **Seltene Korrektur der Audiospur:** Ihre Position ergibt sich aus der Uhr des AudioContext. Gemessen wird höchstens
  alle 25 ms, geglättet über 500 ms. Ab 40 ms Abweichung läuft die Audiospur fest 4 % schneller oder langsamer, bis die
  Abweichung unter 10 ms liegt (die Tonhöhe bleibt dabei). Ab 300 ms springt sie.
- **Kein unnötiges Neuansetzen:** Meldet alphaTab ein Spulen, die Audiospur liegt aber richtig, läuft sie weiter.

Passt das notierte Tempo nicht zur Audiospur, steht in der Kopfzeile dahinter rot das Tempo der Audiospur, z. B.
"105 BPM (⚠ Audio: 211 BPM)". Verglichen wird die notierte Dauer (mit allen Tempowechseln) mit der Dauer in der
Audiospur, jeweils vom ersten bis zum letzten Sync-Punkt (`recordingTempoFactor()` in `js/notation.js`); das Ergebnis
wird auf eine ganze Zahl gerundet. Markiert ist jeder Song, bei dem ein anderes ganzzahliges Tempo besser passt, also
auch kleine Abweichungen. Korrigiert wird im Sync-Editor ("Tempo … → … BPM").

Liegt der letzte Sync-Punkt hinter dem Ende der Audiospur, folgt in der Kopfzeile rot "(⚠ Sync-Punkte passen nicht zur
Audiospur)", sobald die Audiospur geladen ist (`isSyncOutsideAudio()` in `js/notation.js`). Das passiert z. B. nach dem
Wechsel auf einen kürzeren Clip. Ein negativer erster Sync-Punkt ist gewollt (Takt 1 beginnt vor der Audiospur).

Titel und Interpret setzt der Player aus `song.json` ein, Tonart, Capo, Tuning und Tempo liest er aus den Noten
und zeigt sie in der Kopfzeile, z. B. "Tonart Bbm · Capo 1 (Griffe Am)". Die Tonart (`\ks`) ist die klingende: Wie
Guitar Pro notiert alphaTab mit Capo klingend, jeder Bund hebt die Saiten um einen Halbton. Die Tonart der Griffe
liegt um so viele Halbtöne tiefer, wie der Capo Bünde hat (`shapeKey()` in `js/notation.js`). Wer nachträglich einen
Capo setzt (z. B. weil die Audiospur höher klingt als notiert), muss auch `\ks` mit anheben.

**Lage der Bedienelemente:**

- **Kopf:** Cover, daneben Titel, Interpret und eine Zeile Eckdaten ("Tonart G · 140 BPM · Capo 3 · DADGBE",
  `describeScoreInfo()`; das Tuning steht nur da, wenn es nicht EADGBE ist), jede mit "…" gekürzt, wenn sie nicht passt.
- **Streifen** (`.songstrip`, füllt der Player): der Akkord, der gerade klingt, mit Griffbild (ohne den Griff als
  Ziffern), daneben die Patterns des Leadsheets, gezeichnet wie dort (`patternGridHtml()`). Gezeigt wird je Technik
  das Pattern, das zum gespielten Takt passt (`loadStripPatterns()`: aus jeder Spur mit Saiten abgeleitet und
  verglichen, ab 75 % Ähnlichkeit); passt keines, bleibt das zuletzt gezeigte. Der Schlag, der gerade dran ist, läuft 
  mit (`showPatterns()`). Am PC stehen Strumming und Picking Patterns nebeneinander; am Handy eines, mit einem kleinen
  Umschalter, wenn der Song beide hat (je Song gemerkt). Alles steht senkrecht mittig. Ohne Akkorde und Patterns
  fehlt der Streifen. Die Bundangabe bei Griffen in höheren Lagen ist vergrößert (rund 15 px, `.fret-label`,
  `CHORD_NOW_FRET_SPACE`).
- **Was stehen bleibt:** Am Handy scrollt der Kopf weg, der Streifen bleibt oben. Am PC (ab 900 px) stehen Kopf
  links und Streifen rechts in einer Zeile, die ganz stehen bleibt (`.songtop`).
- **✕** schwebt oben rechts, unauffällig halbtransparent, und führt zur Songliste; immer erreichbar.
- **Abspielleiste unten:** Abspielen (so groß wie die anderen Knöpfe), Zeit (am Handy zweizeilig), Geschwindigkeit,
  Wiederholen, **Ansicht** (Notenlinien-Symbol; Liste Noten, Tabs, Noten + Tabs, Chords; gilt für alle Songs),
  **Mixer** (Regler-Symbol) und **⋮**.
- **Mixer:** je Spur ein Auge (in den Noten anzeigen; eine Spur bleibt immer an; je Song gemerkt), ein Lautsprecher
  (zu hören), der Name und darunter Regler und Wert; darunter Audiospur, Metronom und Vorzähler mit Lautsprecher.
  In "Chords" sind die Augen ohne Funktion. 
- **⋮** Menü: Bearbeiten (im Bearbeitungsmodus mit Häkchen; ein Klick beendet ihn), Stammdaten, Darstellung,
  GP-Export, Leadsheet drucken. **Stammdaten** öffnet den Dialog mit Cover, Titel, Interpret, Genre, Einstufung, Favorit und 
  Notizen, dazu "Song löschen …". Sync-Editor und Quelle der Audiodatei stehen im Bearbeitungsmodus.
  **Darstellung** öffnet einen kleinen Dialog mit der Skalierung (50 bis 150 %, gilt für Noten und Chords),
  übernommen mit OK, für alle Songs gemerkt (`openDisplayDialog()` in `app.js`, `Player.setDisplay()`).
- **Ansichten:** Noten und Tabs gelten für alle Spuren; was GP je Spur gespeichert hatte (39 der 75 Spuren auf "nur
  Tabs", bei "Noten + Tabs" fehlten deshalb die Noten), steht nicht in den Noten und zählt auch beim Import nicht. In 
  "Chords" werden die Noten nur eingeklappt (alphaTab braucht die Breite zum Zeichnen)
  und die Seite folgt beim Abspielen nicht dem Cursor.
- Im Bearbeitungsmodus sind Kopf, Streifen und ✕ ausgeblendet; `.songbar` ist nur noch der Platz für dessen
  Werkzeugleiste.

Verworfen: Spuren als Umschalt-Schaltflächen neben der Ansicht bzw. als Menü "Spuren ▾", Titel und
Eckdaten in einer Zeile in der Leiste, Größe und Loop-Bereich im Einstellungsfeld (Zahnrad), "M" für stumm, eine
Griffbild-Leiste mit allen Griffbildern über den Noten (ein/aus per Checkbox, Menüeintrag oder ×, ein- und
ausklappbar, eingeklappt klebend unter der Leiste).

Der **Lautsprecher** rechts in der Abspielleiste öffnet den **Mixer-Dialog** (`renderMixerDialog()` in
`js/playback.js`, `.mixer-dialog` in `app.css`), alle Regler untereinander, ohne Überschriften. Je Eintrag ein
**Lautsprecher**: normal = zu hören, durchgestrichen = stumm (wie beim durchgestrichenen Auge); was stumm ist, steht 
blass da. Ein Klick daneben schließt den Dialog wieder.

- **Spuren**: je Spur Lautsprecher und Regler, dazu die Audiospur, wenn der Song eine `audio.mp3` hat. Mit
  Audiospur beginnen die Spuren bei 50 % (der Synth klingt bei gleicher Einstellung deutlich lauter als eine
  Audiospur), sonst bei 100 %. Je Song gemerkt (`gitarrenbuch_mix_<slug>`). Stumm und Solo aus der Datei gelten nicht;
   Ein Solo gibt es nicht.
- Mit etwas Abstand darunter **Metronom** und **Vorzähler** mit eigenem Regler; vorgegeben ohne Haken (aus).

Den **Loop-Bereich** wählt man in den Notenansichten mit der Maus (bzw. dem Finger) im Notenblatt; ⟳ in der
Abspielleiste schaltet das Wiederholen ein. 

Ansicht, Größe, Metronom und Vorzähler gelten für alle Songs und werden im Browser gemerkt, Spuren und Lautstärken je
Song. Hinweis: Das alphaTab-Ereignis `midiLoaded` ruft sich in 1.8.4 endlos selbst auf; die Lautstärken werden
deshalb nach `midiLoad` und `playerReady` gesetzt.

### Sync-Editor

Die Sync-Punkte (`\sync` in `score.atex`) ordnen Takte der Noten Stellen in der Audiospur zu. Bei importierten
GP-Dateien übernimmt alphaTab sie beim Umwandeln. Bei YouTube-Audio und nach dem Wechsel auf einen anderen Clip
werden sie im Sync-Editor gesetzt bzw. nachgezogen (`js/playback.js`, Vorbild ist der "Media Sync Editor" im
alphaTab-Playground). Er steht im Bearbeitungsmodus unten im Panel "Audio", wenn der Song eine `audio.mp3` hat:
ohne eigenes Speichern, Schließen und Rückgängig, jede Änderung ist ein Schritt des Bearbeitungsmodus.

- **Wellenform** der Audiospur mit einem Marker je Sync-Punkt, beschriftet mit der Taktnummer (dazu "+ 50 %" für eine
  Stelle mitten im Takt, "⇥" für das Taktende und "(2.)" für die zweite Wiederholung). Die rote Linie ist die
  Wiedergabeposition; beim Abspielen blättert die Ansicht mit.
- **Marker ziehen**, oder anklicken und mit den Pfeiltasten verschieben (10 ms, mit Umschalt 1 ms). Ein Marker bleibt
  immer zwischen seinen Nachbarn. Entf löscht ihn, ein Klick daneben springt an diese Stelle der Audiospur.
- **Anfang erkennen:** Setzt den ersten Sync-Punkt auf die erste Note (im ersten Takt mit Noten, bei Pausen am
  Taktanfang also mitten im Takt) und dorthin, wo die Audiospur hörbar wird (−30 dB unter dem lautesten Stück).
  Punkte davor fallen weg. Danach bietet der Editor an, die übrigen Punkte um dieselbe Zeit zu verschieben, etwa
  nach dem Wechsel auf einen anders geschnittenen Clip. Das Ergebnis ist ein Vorschlag: Beginnt die Audiospur mit
  Sprechen oder Geräuschen, liegt er zu früh (getestet an 23 Songs: etwa die Hälfte auf ±100 ms genau, sonst bis zu
  8 s daneben).
- **Ende erkennen:** Setzt den letzten Sync-Punkt an das Ende des letzten Takts mit Noten (in seiner letzten
  Wiederholung), dorthin, wo die Audiospur verklingt. Punkte dahinter fallen weg.
- **+ Punkt:** Setzt einen Sync-Punkt an den Anfang des Takts, in dem der Wellenform-Cursor (rote Linie) steht, an
  die Stelle, die ihm schon entspricht. Danach lässt er sich an die richtige Stelle ziehen.
- **ms verschieben:** Verschiebt alle Sync-Punkte um eine feste Zeit (negativ: Audiospur früher).
- **Tempo … → … BPM** erscheint, wenn das notierte Tempo nicht zur Audiospur passt (siehe Kopfzeile). Der Button
  multipliziert alle Tempoangaben mit dem gemessenen Faktor (`recordingTempoFactor()` in `js/notation.js`), damit
  Tempowechsel im Verhältnis bleiben, gerundet auf ganze BPM. Die Sync-Punkte bleiben unverändert.
- **Mausrad** verschiebt den Ausschnitt, Strg+Mausrad
  bzw. − und + zoomen (5 s bis ganze Audiospur; beim Öffnen die ganze).


Jede Änderung wirkt sofort auf die Wiedergabe; gespeichert wird mit dem Bearbeitungsmodus (Sync-Punkte als `\sync (…)` 
und die Tempi als `\tempo …` in `score.atex`).

### Bearbeitungsmodus

Vorbild Guitar Pro: Noten, Tabs, Text und Akkorde direkt in der Liedansicht bearbeiten (`js/editor.js`, die
Schritte am Modell in `js/notation.js`, die Icons in `js/base.js`). Was wo steht, mit Tastenkürzeln und dem, was
noch fehlt, beschreibt `docs/Editor.md`; dort steht auch, was aus Guitar Pro nicht übernommen wird und warum.

- **Einschalten:** "Bearbeiten" im Menü ⋮ der Abspielleiste.
  Die Abspielleiste unten bleibt wie im Player; der Knopf "Ansicht" ist im Modus gesperrt (Noten ein/aus steht in
  der Werkzeugleiste).
  Der Kopf mit Cover und Eckdaten verschwindet; bearbeitet wird mit Tabs ("Noten + Tabs" oder "Tabs").
- **Verlassen:** ✕ oben rechts; fragt bei ungespeicherten Änderungen nach und zeigt den Song neu, wenn Noten oder
  Stammdaten gespeichert wurden.
- **Aufteilung:** oben die Werkzeugleiste mit allem, was am ganzen Song hängt (Tonart, Shuffle, Capo, Tuning), dazu 
  Speichern, Rückgängig, Wiederholen, Verlauf, Uploads, Spuren, Leadsheet, Transponieren, Hilfe, ✕; links "Am Cursor" mit allem zum Schlag (Notenwerte, 
  Einfügen/Löschen, Effekte, Akkord, Griff, Text; vom Takt Abschnitt, Taktart und Tempo), rechts "Liedtext"
  (oben das Textfeld, darunter die Vorschau "Text & Akkorde", die Linie dazwischen lässt sich ziehen), unten Audio
  (Sync-Editor, dazu das Tempo der Audiospur; Höhe ziehbar, Voreinstellung 200 px). Das rechte Panel ist in der Breite ziehbar, beim Abspielen
  läuft die Silbe in Textfeld und Vorschau mit; Eingabefelder, Auswahllisten und Knöpfe in Dialogen sind einheitlich 34 px hoch mit der Statuszeile. "Spuren" (samt Anzeigen/Ausblenden) und
  "Leadsheet" sind Dialoge, die die Knöpfe der Werkzeugleiste öffnen. Panels klappen mit F2 (links), F4 (rechts), F8
  (unten) bzw. dem Pfeil ein.
- **Dialog "Leadsheet"** (`js/sheet.js`): links
  die Patterns des Songs mit Freitext "wann", die Tab-Stellen (Takte, Spur, Beschriftung), die Griffbilder (je ein
  Häkchen), Links (als QR-Code oder Text) und Hinweise zur Spielweise in Markdown; rechts die Vorschau
  (`js/sheet.js`): Seite 1 "Spielanleitung", Seite 2 "Text & Akkorde", eine Seite, wenn alles passt. Den Akkord eines 
  Schlags wählt man links (Auswahlliste der Song-Akkorde, "+" für einen neuen mit Griff). Gespeichert in
  `song.json`, Feld `leadsheet` (siehe "Strumming und Picking Patterns" und docs/Planung.md, "DIN-A4-Seite"); die 
  Tab-Stellen wandern mit, wenn Takte eingefügt, gelöscht oder
  ausgeschrieben werden oder eine Spur umbenannt wird, und alles gehört zu jedem Schritt für "Rückgängig".
  **Takte ersetzen:** Unter "Takte ersetzen" stehen Bereiche von Takten, die auf dem Blatt nicht
  ausgeschrieben werden, in "Text & Akkorde" und in den Tabs (dort teilt der Bereich die Tab-Stelle, `tabPieces()`:
  Tab davor, Hinweis, Tab danach); an ihrer Stelle steht ein Hinweis ("→ wiederholen und leiser werden", "→ 2 mal 
  spielen"). Angelegt aus der Auswahl in den Noten ("+ Takt 89–108 durch Hinweis ersetzen"), gespeichert als
  `leadsheet.cuts` (`from`, `to`, `text`; leerer Text: die Takte fallen ohne Hinweis weg), die Bereiche wandern wie
  die Tab-Stellen mit. Der Generator rechnet in Zeit (`applyCuts()` in `js/sheet.js`): Was in den Takten
  beginnt (Silben, Akkorde, Takte), fällt weg; fällt ein Abschnitt ganz weg, schließt sein Hinweis ohne
  Überschrift an den Abschnitt davor an. Die Noten und die Ansicht "Chords" im Player bleiben, wie sie sind.
  Auf dem Blatt haben Patterns, Griffbilder und Tabs etwas Abstand zueinander (1,5 em).
  **Tabs von alphaTab** (`js/sheet.js`): Die Tab-Stellen auf dem Blatt zeichnet alphaTab, nicht
  mehr der Generator selbst. So steht alles da, was in den Noten steht: Notenhälse und Balken, Haltebögen,
  Hammer-on, Slide, Bending, Akkordnamen, Taktart. alphaTab zeichnet die Takte der Spur in einen unsichtbaren
  Behälter (800 px breit, nur Tab mit Notenhälsen); die Stücke werden unverändert zu einer SVG mit `viewBox`
  zusammengesetzt, die mit der Seitenbreite skaliert (Vorschau und Druck). Die Vorschau setzt das Blatt, füllt
  die Platzhalter (`.ls-at`), und misst erst danach, ob es passt; fertige Zeichnungen werden gemerkt, solange die
  Noten dieselben sind (rund 0,2 s je Tab-Stelle). Einzelheiten:
  - **Zusammenfassen:** Für "Tabs zusammenfassen" werden in einer Kopie der Noten die wiederholten Takte gelöscht
    und Wiederholungszeichen gesetzt. Die Taktnummern stimmen in der Kopie nicht mehr und sind ausgeblendet; die
    Spielfolge steht in Worten in der Überschrift ("Takt 17–24 zweimal").
  - **Zählzeiten** (Kästchen "Zählzeiten unter den Tabs", `layout.tabCounts`): kennt alphaTab nicht. Sie stehen
    als Text unter jeder Zeile, an den Stellen der Schläge (`boundsLookup`): Sechzehntel-Raster, wenn ein Anschlag
    auf einer Sechzehntel liegt, sonst Achtel, bei Triolen nur die Zahlen.
  - **Spur ohne Tab:** Eine Begleitspur, die in den Noten nur Schlagnotation zeigt, wird für das Blatt als Tab
    gezeichnet (alphaTab bricht sonst ab).
  - **Bögen über den Rand:** Halte- und Bindebögen, deren anderes Ende außerhalb der Tab-Stelle liegt, werden in
    der Kopie gelöst (alphaTab 1.8.4 bricht sonst ab); eine angebundene Note am Anfang steht als gewöhnliche da.
  - **Halbe und Viertel** sehen in den Notenhälsen von alphaTab gleich aus (ohne Notenkopf); die Zählzeiten zeigen
    den Unterschied.
  - **Dialog "Abschnitte vergleichen":** Auch dort zeichnet alphaTab, je abweichenden Takt eine
    Zeichnung (`fillCompareTabs()`, 360 px breit, über die ganze Breite, ohne Taktnummer und Akkordnamen; die stehen
    über bzw. unter der Zeichnung). Abweichende Bundzahlen sind rot (`NoteStyle` von alphaTab). Bei vielen
    abweichenden Takten dauert es ein paar Sekunden, bis alle stehen. Die eigene Zeichnung (`tabSvg()`) ist entfernt.
  Ab 900 px stehen die Seiten-Panels neben den Noten, darunter legen sie sich ausgeklappt darüber.
- **Tastenkürzel** wie in Guitar Pro 8, soweit der Browser sie nicht selbst belegt (`js/editor.js`, Übersicht
  über "?").
- **Maus:** Klick setzt den Cursor; eine Note lässt sich auf eine andere Saite oder einen anderen Schlag ziehen
  (gleicher Ton), ein Taktstrich in den Nachbartakt (die Schläge dazwischen wandern mit).

Bearbeitet werden frisch geladene Noten, nicht das Anzeige-Modell des Players; im Modus zeichnet alphaTab sie so,
wie sie gespeichert werden. Nach jeder Änderung wird das Modell als alphaTex geschrieben und neu eingelesen (der Text
davor ist der Schritt für "Rückgängig"). Gespeichert wird geprüft wie beim Import (`writeScoreChecked()`), die alte
Fassung kommt nach `history/`. Den Cursor setzt `boundsLookup` von alphaTab: Die Tab-Zeile eines Takts reicht genau
von der obersten bis zur untersten Saite. alphaTab zeichnet in einem Worker, dort bleibt `BarBounds.bar` leer; der
Takt einer Zeile kommt deshalb über ihre Schläge. Nach jedem Neuzeichnen setzt alphaTab die Abspielposition auf den
Anfang; damit die Seite nicht zu Takt 1 springt, rollt der Player im Modus nur beim Abspielen mit.

## Offene Punkte

- ❌ Offline nutzbar (am Lagerfeuer ohne Netz), mehrere Leadsheets als ein PDF, Tempo-Trainer
- ❌ Leadsheet: Kennzeichen "gängig" im Akkordkatalog (heute feste Liste in `sheet.js`), Drucken auch aus
  dem Player ohne Bearbeitungsmodus
- ❌ Übe-Hilfen in den Noten: Zählzeiten einblenden und je Takt vermerken, aus welcher Spur des Originals die Noten
  stammen ("Rhythm Guitar 1"). Bis dahin stehen beide als Beat-Texte in den Noten (`txt`, z. B. "1", "+", "Rhythm
  Guitar 1"); sie bleiben beim Import und in der Ansicht erhalten.
- ⏸ Range-Support in `api/audio.php`, damit der Mixer die MP3 streamen kann, statt sie ganz zu laden (zurückgestellt,
  bis die Ladezeit stört)
- ❌ KI-Funktionen: Fingerstyle- oder Anfängerfassung (Spur als alphaTex hinein, neue Spur als alphaTex heraus),
  Akkorde aus der Audiospur bestimmen (über die Sync-Punkte in Takte umgerechnet)

## Planung der offenen Phasen

Die Planung steht in [docs/Planung.md](docs/Planung.md): geplante Dateien, Editor, Aufbereitung des Rohmaterials,
ChordPro, DIN-A4-Seite (Leadsheet) samt Technik des Generators und des Vergleichs, offene Punkte.

## Rechtliche Hinweise

- **YouTube:** Die Kopien sind nur für den privaten Gebrauch bestimmt (§53 UrhG) und werden nicht weitergegeben oder
  öffentlich zugänglich gemacht. Basic Auth schützt die Audiodateien. Die Nutzungsbedingungen von YouTube schließen
  Downloads aus.
- **Ultimate Guitar:** GP-Dateien werden einzeln und manuell mit dem eigenen Pro-Abo für den Eigenbedarf
  heruntergeladen, ohne Weitergabe.

## Quellen

- [alphaTab – Audio & Video Sync](https://alphatab.net/docs/guides/audio-video-sync)
- [alphaTab – Release 1.6 (Backing Tracks)](https://alphatab.net/docs/releases/release1_6)
- [alphaTab – Media Sync Editor](https://alphatab.net/docs/guides/media-sync-editor)
- [alphaTab – Sync Points (alphaTex)](https://alphatab.net/docs/alphatex/sync-points)
- [ChordPro – Formatbeschreibung](https://www.chordpro.org/chordpro/)
- [frohlfing/kochbuch](https://github.com/frohlfing/kochbuch)
- [frohlfing/videothek](https://github.com/frohlfing/videothek)

## Lizenz

Dieses Projekt steht unter der [GPL-3.0-Lizenz](LICENSE).

Das bedeutet: Du darfst diesen Code nutzen, ändern und verbreiten. Wenn du die Software (oder eine modifizierte
Version davon) jedoch weitergibst, musst du deinen Quellcode ebenfalls unter derselben Lizenz offenlegen.

### Mitgelieferte Fremdbestandteile

Unter `public/vendor/alphatab/` liegen, bis auf vermerkte Änderungen in `alphaTab.core.mjs` (siehe "Setup",
Punkt 8; die MPL-2.0 erlaubt das, die geänderte Datei bleibt unter MPL-2.0):

| Bestandteil                                         | Lizenz                    | Lizenzdatei                  |
|-----------------------------------------------------|---------------------------|------------------------------|
| alphaTab 1.8.4 (Daniel Kuschny u. a.)               | MPL-2.0                   | `LICENSE`, Kopf jeder `.mjs` |
| TinySoundFont, SFZero u. a. (in alphaTab enthalten) | MIT                       | Kopf von `alphaTab.mjs`      |
| Notenschrift Bravura (Steinberg)                    | SIL Open Font License 1.1 | `font/Bravura-OFL.txt`       |
| SoundFont Sonivox (Sonic Network)                   | Apache 2.0                | `soundfont/LICENSE`          |

Unter `public/vendor/qrcode/` liegt `qrcode.mjs` aus qrcode-generator 2.0.4 (Kazuhiko Arase, MIT, Lizenz im Kopf
der Datei), unverändert; das Leadsheet zeichnet damit die QR-Codes der Links.

Unter `public/vendor/signalsmith/` liegt `SignalsmithStretch.mjs` aus signalsmith-stretch 1.3.2 (Signalsmith Audio, 
MIT, Lizenztext in `LICENSE` dort), unverändert; der Mixer dehnt damit die Audiospur ohne Tonhöhenänderung.

Dazu im Code die Pfade der Symbole "directions_run" (`js/playback.js`, `RUN_ICON`), "edit" (`app.js`) sowie "save",
"undo" und "redo" (`js/base.js`) aus Google Material Icons (Apache 2.0). Die übrigen Symbole in `js/base.js` sind
selbst gezeichnet.

Alle Lizenzen sind mit der GPL-3.0 vereinbar: Die MPL-2.0 erlaubt die Verbindung mit der GPL ausdrücklich
(alphaTab trägt nicht den Vermerk "Incompatible With Secondary Licenses"), MIT und Apache 2.0 lassen sich in
GPL-3.0-Software übernehmen, und die Schrift liegt als eigene Datei neben dem Programm. Die Fremdbestandteile
behalten ihre eigene Lizenz; die Lizenzdateien müssen beim Weitergeben dabeibleiben.

Die Cover gehören den jeweiligen Rechteinhabern und werden nur für die private Übersicht geladen.
