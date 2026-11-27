# Gitarrenbuch

Ein persönliches Gitarrenbuch: Die Sammlung der Songs, die ich allein mit der Gitarre spiele und singe, als kleine
PHP/JSON-API mit einem statischen One-Page-Frontend. 

Die Partitur (Noten und Tabs) wird mit [alphaTab](https://alphatab.net) angezeigt und abgespielt. 

## Setup

### Voraussetzungen

- PHP 8.5+ mit aktivierter GD- und zip-Extension
- Ein Webserver mit `public/` als Document Root
- Kein Datenbankserver nötig – alle Daten liegen als Dateien unter `data/`, bewusst außerhalb des Document Root
  (Zugriff nur über die API wie `api/songs.php`, nicht direkt per URL)

### Installatiosschritte

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

7. **yt-dlp, Deno und ffmpeg** für `bin/fetchaudio.php` (holt die Audiospur von YouTube). Sie laufen nur lokal auf dem
   Windows-Rechner, nicht auf dem Server, und müssen im `PATH` liegen:
   - yt-dlp: `yt-dlp.exe` aus dem offiziellen Release
     (`https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe`), z. B. nach `C:\Program Files\yt-dlp`.
     YouTube ändert sich häufig; aktualisiert wird mit `php bin/fetchaudio.php --update` (ruft `yt-dlp -U` auf).
   - Deno: `deno.exe` aus `https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip`,
     am besten neben `yt-dlp.exe`. yt-dlp braucht eine JavaScript-Laufzeit, um die Download-Adressen von YouTube zu
     entschlüsseln; ohne sie warnt es, und Formate fehlen. Node ginge auch, aber erst in neueren Versionen als 20.9.
   - ffmpeg (mit ffprobe): z. B. nach `C:\Program Files\ffmpeg\bin`.
     
8. **alphaTab** für die Partitur. Liegt fertig unter `public/vendor/alphatab/` (1.8.4 aus npm, siehe `VERSION.txt`).   
   **ACHTUNG:** `alphaTab.core.mjs` ist angepasst (siehe Kommentar ganz oben in der Datei). Bei einem Update von 
   alphaTab prüfen, ob die Änderungen noch nötig sind, und sie sonst neu einfügen.

### Lokalen Testserver unter XAMPP (Windows) einrichten

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
 │    ├── patterns.json               # Pattern-Katalog
 │    ├── songs/                      # Ein Unterordner pro Song
 │    │    └── <slug>/                # Slug aus Interpret + Titel, z. B. "bob-marley-three-little-birds"
 │    │         ├── song.json         # Stammdaten (Titel, Interpret, Tags, Notizen, Quellen-URLs)
 │    │         ├── score.atex        # AlphaTex-Datei (Partitur) 
 │    │         ├── score.json        # Ergänzende Angaben, die alphaTex nicht kennt
 │    │         ├── audio.mp3         # Audiospur
 │    │         ├── cover.jpg         # Albumcover (500 px)
 │    │         ├── upload/           # Hochgeladenes Rohmaterial (GP-, ChordPro-, Textdateien, PDFs)
 │    │         └── history/          # Speicherhistorie (Backup beim Speichern)
 │    └── backup/                     # Nur lokal: Die von bin/fetchaudio.php heruntergeladenen YouTube-Dateien
 ├── bin/                             # Skripte für die Kommandozeile (lokal, php bin/…)
 │    ├── build_fetchaudio_portable.cmd # fetchaudio.php samt PHP, yt-dlp, Deno und ffmpeg als Paket
 │    └── fetchaudio.php              # YouTube → audio.mp3, lädt per API auf den Server hoch (läuft lokal)
 ├── docs/                            # Projektdokumentation (Markdown)
 ├── public/                          # Document Root
 │    ├── api/                        # API-Endpunkte
 │    │    ├── lib/                   # Gemeinsam genutzte Hilfsfunktionen der API-Endpunkte
 │    │    │    ├── chordcatalog.php  # Akkord-Katalog (die Akkorde der Songs)
 │    │    │    ├── coverstore.php    # Cover suchen, übernehmen, speichern
 │    │    │    ├── crud.php          # Read/Write/Rename/Delete-Logik + Validierung
 │    │    │    ├── fetch.php         # http_get(): curl, sonst file_get_contents()-Fallback
 │    │    │    ├── file_store.php    # Noten und Rohmaterial ablegen, Dateien mit ETag ausliefern
 │    │    │    ├── gp_file.php       # GP-Format erkennen, Audiospur herauslösen
 │    │    │    ├── http.php          # JSON-Response-Helper, Token-Prüfung
 │    │    │    ├── slug.php          # slugify() + Eindeutigkeits-Check
 │    │    │    ├── uploadstore.php   # Uploads (Quelle und Beschreibung, Direktlink laden)
 │    │    │    └── youtubeinfo.php   # Video-ID, Titel und Länge eines YouTube-Videos
 │    │    ├── audio.php              # audio.mp3 ausliefern
 │    │    ├── chords.php             # Akkord-Katalog ausliefern
 │    │    ├── cover.php              # Cover ausliefern, suchen, übernehmen, hochladen, entfernen
 │    │    ├── import.php             # Neuen Song mit Noten anlegen
 │    │    ├── leadsheet.php          # Angaben für das Leadsheet
 │    │    ├── patterns.php           # Pattern-Katalog lesen und ersetzen
 │    │    ├── score.php              # score.atex ausliefern und ersetzen
 │    │    ├── songs.php              # Songs lesen, bearbeiten, löschen; Favorit und Einstufung setzen
 │    │    ├── uploads.php            # Hochgeladene Dateien eines Songs mit Quelle und Beschreibung
 │    │    └── youtube.php            # Titel und Länge eines YouTube-Videos (für das Formular)
 │    ├── dev/                        # Admin-/Wartungsskripte – NICHT dauerhaft auf dem Produktivserver lassen
 │    │    ├── info.php               # phpinfo()
 │    │    ├── instruments.html       # Hörprobe aller 128 General-MIDI-Instrumente mit dem SoundFont
 │    │    └── prioritaeten.html      # Vergleicht Einteilungen der Griffe in Prioritäten
 │    ├── css/                        # Stylesheets, je Seite eins
 │    │    ├── base.css               # Farben, Schrift, Knöpfe, Formulare, Overlay, Dialoge, Menüs, Reiter
 │    │    ├── editor.css             # Bearbeitungsseite und seine Dialoge (erst mit dem Stift geladen)
 │    │    ├── overview.css           # Übersichtsseite mit Akkord-Katalog, Pattern-Katalog und Griffbrett
 │    │    └── player.css             # Player und alles, was von dort erreichbar ist (Stammdaten, Leadsheet, Druck)
 │    ├── js/                         # ES-Module des Frontends (ohne Bundler, von app.js importiert)
 │    │    ├── lib/                   # Ohne DOM (darf nur lib/ importieren)
 │    │    │    ├── api.js            # Zugriff auf die API, Token, Marken der Übersichtsseite
 │    │    │    ├── chordcheck.js     # Funktion "Bereinigen/Griffe prüfen"
 │    │    │    ├── chorddetect.js    # Akkorde aus einer Spur und der Audiospur ableiten
 │    │    │    ├── chordfile.js      # Liedtext und Akkorde aus einer Chord-Datei lesen
 │    │    │    ├── chordgrips.js     # Sucht passende Griffe zu einem Akkordnamen
 │    │    │    ├── chords.js         # Akkorde und Griffe, Transponieren von Namen und Tonarten, Tonart-Erkennung
 │    │    │    ├── chordtheory.js    # Zerlegt einen Akkordnamen in seine Töne (Regeln aus docs/Musiktheorie.md)
 │    │    │    ├── conflicts.js      # Konfliktlöser für den Importer (Regeln im Kopf der Datei)
 │    │    │    ├── format.js         # HTML maskieren, Zeiten formatieren
 │    │    │    ├── notation.js       # Noten lesen und schreiben, Bearbeiten, Transponieren
 │    │    │    ├── patterns.js       # Strumming und Picking Patterns
 │    │    │    ├── pitchdetect.js    # Tonhöhe der Melodie aus der Audiospur erkennen
 │    │    │    ├── rhythmhint.js     # Regelwerk für Rhythmushinweis-Generierung
 │    │    │    ├── sheetmodel.js     # Angaben für das Leadsheet (score.json), Abschnitte der Noten
 │    │    │    ├── songs.js          # Bestand aller Songs im Browser (SONGS), Stammdaten ändern
 │    │    │    └── textmodel.js      # Inhalt der Ansicht "Text & Akkorde"
 │    │    ├── ui/                    # Bausteine der Oberfläche (darf lib/ und ui/ importieren)
 │    │    │    ├── chorddiagram.js   # Griffbilder (SVG)
 │    │    │    ├── credit.js         # Hinweis auf alphaTab mit Logo
 │    │    │    ├── fbdiagram.js      # Griffbrett als SVG (fretboard diagram)
 │    │    │    ├── form.js           # Helfer für Formulare in Dialogen
 │    │    │    ├── icons.js          # Symbole (SVG) und Zeichen der Notenschrift
 │    │    │    ├── overlay.js        # Overlay für alle Dialoge: öffnen, stapeln, schließen
 │    │    │    ├── sheetview.js      # Leadsheet-Generator (HTML), Einpassen, Drucken, Tabs von alphaTab
 │    │    │    └── textview.js       # Ansicht "Text & Akkorde" als HTML
 │    │    ├── pages/                 # Alle Seiten (darf alles importieren)
 │    │    │    ├── editor.js         # Bearbeitungsseite: Toolbar, Panels, Maus, Cursor, Tastenkürzel (nachgeladen)
 │    │    │    ├── overview.js       # Übersichtsseite: Kachelraster, Suche, Filter, Sortierung
 │    │    │    └── player.js         # Playerseite: Mixer mit Audiospur, Sync-Editor (nachgeladen)
 │    │    └── dialogs/               # Alle Dialoge (werden beim Öffnen nachgeladen; darf alles importieren)
 │    │         ├── brush.js          # "Kopieren" (Pinsel)
 │    │         ├── chord.js          # "Akkord" (Name und Griff)
 │    │         ├── chordcatalog.js   # "Akkorde" (Menü ☰ der Übersichtsseite): Akkord-Katalog
 │    │         ├── cover.js          # "Cover" (aus den Stammdaten)
 │    │         ├── display.js        # "Darstellung" (Player)
 │    │         ├── fretboard.js      # "Griffbrett" (Menü ☰ der Übersichtsseite)
 │    │         ├── gripcheck.js      # "Griffe prüfen" (Menü Bereinigen)
 │    │         ├── history.js        # "Verlauf"
 │    │         ├── import.js         # "Song importieren"
 │    │         ├── leadsheet.js      # "Leadsheet" mit Pattern-Katalog und Abschnittsvergleich
 │    │         ├── melody.js         # "Melodie ableiten"
 │    │         ├── movecontent.js    # "Akkorde/Liedtext nach …" (Spuren)
 │    │         ├── patterncatalog.js # "Patterns" (Menü ☰ der Übersichtsseite): Pattern-Katalog
 │    │         ├── rhythm.js         # "Rhythmus ableiten"
 │    │         ├── save.js           # "Speichern", "Änderungen speichern?", "Speichern nicht möglich"
 │    │         ├── shortcuts.js      # "Tastenkürzel"
 │    │         ├── songform.js       # "Stammdaten" bzw. "Neuer Song"
 │    │         ├── timing.js         # "Metrum umschreiben"
 │    │         ├── trackimport.js    # "Spur aus Guitar-Pro-Datei importieren"
 │    │         ├── tracks.js         # "Spuren"
 │    │         ├── transpose.js      # "Transponieren"
 │    │         └── uploads.js        # "Uploads"
 │    ├── vendor/                     # JS-Bibliotheken von anderen Autoren
 │    │    ├── alphatab/              # alphaTab 1.8.4 (MPL-2.0), alphaTab.core.mjs angepasst, s. Kommentar in Datei
 │    │    ├── qrcode/                # QR-Codes für das Leadsheet (MIT)
 │    │    └── signalsmith/           # Zeitdehnung der Audiospur im Mixer (MIT)
 │    ├── .htaccess                   # Apache Zugriffsschutz
 │    ├── .htaccess.example           # Vorlage für Apache Zugriffsschutz
 │    ├── app.js                      # Einstieg des Frontends
 │    ├── favicon.svg                 # Browser-Tab-Icon (Gitarre)
 │    └── index.html                  # Frontend (lädt/schreibt ausschließlich über /api/*)
 ├── types/                           # Type-Declaration (nur für die IDE, nicht deployen!)
 │    ├── alphatab.d.ts               # Typen von alphaTab
 │    └── tsconfig.json               # Sprachstand ES2022 für die alphaTab-Typen (flatMap, at, Map)
 ├── .gitignore                       # Vom Git-Repository auszuschließende Dateien
 ├── .htpasswd                        # Apache Passwortdatei (nicht im Git-Repository)
 ├── config.example.php               # Vorlage für config.php
 ├── config.php                       # Zentrale Konfigurationsdatei (nicht im Git-Repository)
 ├── LICENSE                          # Lizenzhinweis
 └── README.md                        # Landingpage für das Git-Repository
```

### Admin-/Dev-Skripte (`public/dev/`)

Wartungs- und Diagnose-Skripte, die (anders als die eigentliche App) direkt im Browser aufgerufen werden. Gehört nicht 
zur Anwendung.
 
- `info.php`: Zeigt die PHP-Konfiguration (z. B. ob zip aktiv ist).
- `instruments.html`: Hörprobe aller 128 General-MIDI-Instrumente, siehe auch `docs/Instrumente.md`.
- `prioritaeten.html`: Zeigt die Prioritäten der Griffe.

**Wichtig:** `public/dev/` gehört **nicht dauerhaft** auf den Produktivserver. Nach Gebrauch dort löschen – ein
Server-Interna preisgebender `phpinfo()`-Endpunkt soll keine Dauereinrichtung sein.

## API

### Endpunkte

Alle schreibenden Endpunkte (`POST`/`PUT`/`DELETE`) erwarten den Header `X-API-Token: <token>`, sonst `401`. Lesende
Endpunkte (`GET`) sind ohne eigenes Token offen — Schutz vor öffentlichem Zugriff übernimmt stattdessen die HTTP Basic
Auth vor der gesamten `public/`-Domain (siehe Setup, Schritt 5), die auch die statische `index.html` selbst mit
abdeckt.

| Methode | Endpunkt                              | Beschreibung                                                                                                                                |
|---------|---------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| GET     | `/api/songs.php`                      | Alle Songs, alphabetisch nach Titel (das Frontend sortiert ggf. um)                                                                         |
| GET     | `/api/songs.php?slug=xyz`             | Einzelner Song                                                                                                                              |
| PUT     | `/api/songs.php?slug=xyz`             | Song bearbeiten (JSON-Body). Ändert sich der Slug (Interpret/Titel), wird der Ordner umbenannt                                              |
| DELETE  | `/api/songs.php?slug=xyz`             | Song samt Ordner (Rohmaterial inklusive) löschen                                                                                            |
| POST    | `/api/import.php`                     | Neuen Song anlegen (`multipart/form-data`: `meta` = JSON wie bei PUT `songs.php`, `score` = alphaTex, `file` = Original-GP-Datei, optional) |
| GET     | `/api/score.php?slug=xyz`             | Noten `score.atex` ausliefern (für alphaTab)                                                                                                |
| GET     | `/api/score.php?slug=xyz&history=1`   | Liste der früheren Fassungen der Noten (id, time, size), die neueste zuerst (Knopf "Verlauf" auf der Bearbeitungsseite)                          |
| GET     | `/api/score.php?slug=xyz&version=ID`  | Ein früherer Stand als alphaTex (id aus der Liste)                                                                                          |
| DELETE  | `/api/score.php?slug=xyz&version=ID`  | Einen früheren Stand löschen (Noten und Angaben für das Leadsheet); Antwort: die übrigen                                                    |
| PUT     | `/api/score.php?slug=xyz`             | Noten ersetzen (Body: alphaTex als `text/plain`; Bearbeitungsseite), alte Fassung nach `history/`. Nur für Songs mit Noten                  |
| GET     | `/api/audio.php?slug=xyz`             | Audiospur `audio.mp3` ausliefern                                                                                                            |
| PUT     | `/api/audio.php?slug=xyz`             | Audiospur ersetzen (Body: die MP3 als `audio/mpeg`; nutzt `bin/fetchaudio.php`)                                                                  |
| GET     | `/api/cover.php?slug=xyz`             | Cover `cover.jpg` ausliefern                                                                                                                |
| GET     | `/api/cover.php?artist=…&title=…`     | Cover bei Deezer und iTunes suchen (`{"results": [...]}`, Deezer zuerst)                                                                    |
| PUT     | `/api/cover.php?slug=xyz`             | Cover aus der Suche übernehmen (Body: `{"url": "…"}`, nur Bildserver von Deezer und iTunes)                                                 |
| POST    | `/api/cover.php?slug=xyz`             | Eigenes Cover hochladen (`multipart/form-data`: `file`, JPEG; der Browser verkleinert und wandelt vorher um)                                |
| DELETE  | `/api/cover.php?slug=xyz`             | Cover entfernen                                                                                                                             |
| GET     | `/api/youtube.php?url=…`              | Titel und Länge eines YouTube-Videos (`{"id", "title", "seconds"}`, gelesen aus der Videoseite)                                             |
| GET     | `/api/uploads.php?slug=xyz`           | Uploads des Songs (`{"uploads": [{file, size, source, description, added}]}`)                                                               |
| GET     | `/api/uploads.php?slug=xyz&file=name` | Eine hochgeladene Datei (PDF und Text im Browser, sonst Download)                                                                           |
| POST    | `/api/uploads.php?slug=xyz`           | Datei ablegen (`multipart/form-data`: `file` oder `url` für einen Direktlink, dazu `source`, `description`)                                 |
| PUT     | `/api/uploads.php?slug=xyz&file=name` | Quelle und Beschreibung ändern (Body: `{"source": "…", "description": "…"}`)                                                                |
| DELETE  | `/api/uploads.php?slug=xyz&file=name` | Datei samt Angaben löschen (Papierkorb im Dialog "Uploads"); Antwort: die übrigen Uploads                                                   |

### Datenschema

#### `score.atex` - alphatab-Datei

Dokumentation siehe https://alphatab.net/docs/alphatex/syntax.

#### `song.json` - Stammdaten eines Songs

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
  "favorite": true,
  "level": "practice",
  "trackDefaults": [{ "show": true, "mute": false }],
  "wip": { 
    "reason": "Bass fehlt noch", 
    "tracks": ["Bass"], 
    "audio": true
  },
  "uploads": {
    "three-little-birds.gp": {
      "source": "https://tabs.ultimate-guitar.com/tab/…",
      "description": "",
      "added": "2026-10-26T02:43:52+01:00"
    }
  }
}
```

- `title`: Titel, als einziges Feld Pflicht.
- `artist`: Interpret. Aus Interpret und Titel entsteht der Slug (Standard: `null`).
- `tags`: Liste von Tags; leere und doppelte fallen weg (Standard: `[]`).
- `subtitle`, `album`, `words`, `music`, `copyright`, `tab`, `instructions`: Angaben aus der GP-Datei (Untertitel,
  Album, Text, Musik, Copyright, Tab-Autor, Anweisungen).
- `notes`: Notizen der Stammdaten, Freitext (Standard: `null`).
- `sources`: Herkunft des Rohmaterials (`youtube`, `https://www.youtube.com/watch?v=<ID>`).
  Ändert sich die Adresse, wird `audio.mp3` entfernt, damit bin/fetchaudio.php die Änderung erkennt und eine neue audio.mp3 
  erzeugt. Wird sie nur gelöscht, bleibt die Audiospur stehen (Standard: `{}`).
- `youtubeSeconds`: Länge des YouTube-Clips in Sekunden. Das Formular ermittelt sie nur, wenn sich die Adresse ändert
  (Standard: `null`, immer ohne YouTube-Quelle).
- `slug`: Name des Songordners. Ändern sich Interpret oder Titel, wird der Ordner umbenannt.
- `created`, `updated`: Zeitpunkt des Anlegens und der letzten Änderung (ISO 8601).
- `favorite`: `true`, wenn der Song Favorit ist (siehe "Übersichtsseite") (Standard: fehlt, kein Favorit).
- `level`: Einstufung `"can"`, `"practice"` oder `"cannot"` (kann ich, übe ich gerade, kann ich nicht) (Standard:
  fehlt, nicht eingestuft).
- `trackDefaults`: Vorgaben für "Spur anzeigen" und "Lautsprecher aus" je Spur in der Reihenfolge der Spuren. 
- `wip`: Schalter "Baustelle" (Standard: fehlt, keine Baustelle).
- `uploads`: Quelle und Beschreibung der Dateien im Ordner `upload/`. Die API liefert das Feld nicht mit dem Song aus, 
  sondern über `api/uploads.php` (Standard: fehlt, keine Uploads).

`favorite`, `level`, `trackDefaults`, `wip` und `uploads` stehen nur da, wenn es welche gibt. 

Fehlen `favorite`, `level`, `trackDefaults` oder `wip` in einem Request, bleiben die gespeicherten; `false`, `null` 
bzw. eine leere Liste löscht sie.

Beim Lesen ergänzt die API berechnete Felder (`with_file_flags()`), die nicht gespeichert werden:

- `files`: welche der Dateien `score.atex`, `audio.mp3`, `cover.jpg` im Ordner liegen, als Liste der Schlüssel
  (z. B. `["score", "cover"]` ohne Audiospur). Bei jedem Lesen aus dem Dateisystem bestimmt, damit es nicht veraltet.
- `tracks`: Namen der Spuren aus `score.atex`.
- `leadsheet`: Inhalt von `score.json` (siehe unten), fehlt ohne die Datei.

#### `score.json` - Ergänzende Angaben, die alphaTex nicht kennt

```json
{
  "patterns": [{ "id": "folk", "when": "Strophe und Refrain" }],
  "tabs": [{ "from": 0, "to": 3, "track": "Picking", "label": "Intro" }],
  "cuts": [{ "from": 40, "to": 47, "text": "wiederholen und leiser werden" }],
  "chords": { "G": false, "G*": true },
  "links": [{ "label": "Original", "url": "https://www.youtube.com/watch?v=…", "qr": true }],
  "instructions": "Markdown",
  "layout": { 
    "twoPages": true, 
    "columns": false, 
    "font": 12, 
    "compactTabs": false, 
    "smallChords": false,
    "tabCounts": false, 
    "mergeSections": true
  },
  "barsPerRow": 4
}
```

- `patterns`: Patterns des Songs (`id` aus `data/patterns.json`) mit Freitext `when`, wann sie gespielt werden
  (Standard: `[]`).
- `tabs`: Takte, die als Tab auf das Blatt kommen. `from`/`to` sind Indizes der Takte (0 = erster Takt), `track` ist
  der Name der Spur, `label` die Beschriftung (Standard: `[]`).
- `cuts`: Takte, die in "Text & Akkorde" nicht ausgeschrieben werden; an ihrer Stelle steht `text` (leer: nichts)
  (Standard: `[]`).
- `chords`: Griffbilder, die von der Regel abweichen (`true` zeigen, `false` ausblenden) (Standard: `{}`).
- `links`: auf dem Blatt als QR-Code (`qr`, Standard `true`) oder als Text. Links ohne Adresse fallen beim Speichern
  weg (Standard: `[]`).
- `instructions`: Hinweise zur Spielweise für Seite 1 (Markdown, höchstens 5000 Zeichen) (Standard: `""`).
- `layout`: wie das Leadsheet gesetzt wird (Kontrollkästchen im Reiter "Leadsheet"):
   - `twoPages`: zwei Seiten (Standard: `false`)
   - `columns`: Text zweispaltig (Standard: `false`)
   - `font`: Schrift in pt, `12`, `11`, `10` oder `9` (Standard: `12`)
   - `compactTabs`: Tabs zusammenfassen (Standard: `false`)
   - `smallChords`: Griffbilder klein (Standard: `false`)
   - `tabCounts`: Zählzeiten unter den Tabs (Standard: `false`)
   - `mergeSections`: gleiche Abschnitte nur einmal (Standard: `true`)
- `barsPerRow`: Takte pro Zeile in den Noten, gezählt ab jedem Abschnitt (1 bis 12) (Standard: `0`, Umbruch nur an
  den Abschnitten).

`cuts`, `layout` und `barsPerRow` stehen nur da, wenn es welche gibt bzw. das Layout von der Vorgabe abweicht. 

Sind alle Angaben leer, fällt die Datei weg.

Die Regeln zu den Feldern (Pflichtfelder, Wertebereiche) stehen in `public/api/lib/crud.php` und
`public/api/leadsheet.php`.

## Frontend

### Ladevorgang

1. **Statische Assets**: `favicon.svg`, die Stylesheets `css/base.css`, `css/overview.css` und `css/player.css`
   (`css/editor.css` erst mit dem Stift) und `app.js`. `app.js` ist ein ES-Modul und importiert die Module
   aus `js/`. Alle tragen einen Versionszähler (`?v=…`) gegen alte Fassungen im Browser-Cache; für die Module unter
   `js/` hängt ihn die Import-Map in `index.html` an (ein neues Modul dort eintragen).
2. **`GET api/songs.php`** lädt alle Songs. Das ist der einzige Request beim Start; schlägt er fehl, erscheint eine
   Fehlermeldung.
3. Beim Rendern der Übersichtsseite bekommt jeder Song mit Cover ein `<img src="api/cover.php?slug=…&v=…" loading="lazy">`. 
   Dadurch fordert der Browser die Covers an, aber wegen `loading="lazy"` nur die, die tatsächlich (nahe) im sichtbaren 
   Viewport liegen; der Rest folgt erst beim Scrollen. 
4. Beim Öffnen eines Songs folgen `GET api/score.php` (die Noten als alphaTex), alphaTab, die Notenschrift und der 
   SoundFont (Lazy Loading).
5. Die Übersichtsseite lädt nur, was sie braucht (rund 190 KB JavaScript). Player und Noten (`pages/player.js`,
   `lib/notation.js`) kommen erst mit dem ersten Song, die Bearbeitungsseite (`pages/editor.js`) lädt erst der Stift,
   die Dialoge in `dialogs/` erst ihr Knopf (`import()`). Ein Modul lädt der Browser je Seitenaufruf nur einmal.
   Regel für die Ordner: `lib/` importiert nur `lib/`, `ui/` nur `lib/` und `ui/`; `pages/` und `dialogs/` dürfen
   alles.

### Zugriffsschutz 

#### Schutz vor öffentlichem Zugriff

Schutz vor öffentlichem Zugriff übernimmt die HTTP Basic Auth vor der gesamten `public/`-Domain (siehe Setup).

#### Token-Authentifizierung

Das Token wird ausschließlich bei schreibenden Aktionen abgefragt.

Für Änderungen (Song anlegen/bearbeiten/löschen, Import, Cover, Text) fragt das Frontend beim ersten Schreibversuch per
`prompt()` nach dem API-Token und legt es danach in `localStorage` unter dem Schlüssel `gitarrenbuch_api_token` ab.
Jeder weitere Schreibversuch liest das gespeicherte Token wieder aus und fragt nicht erneut nach.

Es wird nur dann wieder nachgefragt, wenn
a) der Server das gespeicherte Token ablehnt (401) – dann wird es automatisch aus `localStorage` gelöscht, oder
b) du es manuell löschst, z. B. in den Browser-DevTools mit `localStorage.removeItem('gitarrenbuch_api_token')` oder
   über "Website-Daten löschen".

### Übersichtsseite

#### Importer

Der normale Weg zu einem neuen Song:

1. **GP-Datei importieren**: "+ Neuer Song" öffnet den Dialog "Song importieren". Die Datei wird hineingezogen oder
   ausgewählt (GP3 bis GP8, z. B. von [Ultimate Guitar](https://www.ultimate-guitar.com/explore?type[]=Pro), Tabs
   vom Typ "Guitar Pro" über "Download"). Die Seite des Tabs lässt sich gleich als "Quelle für Guitar-Pro-Datei"
   eintragen und wird mit gespeichert.
2. **Audio hinzufügen**: YouTube-URL auf der Bearbeitungsseite im unteren Panel "Audio" eintragen, dann lokal `bin/fetchaudio.php`
   starten (siehe "Audio von YouTube").
3. **Bearbeiten und spielen.**

**Unterstützte Guitar-Pro-Formate:**

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

##### Cover suchen

Beim Import sucht der Server mit Interpret und Titel ein Albumcover, zuerst bei Deezer, dann bei iTunes (beide ohne
API-Schlüssel), und übernimmt den ersten Treffer. Findet er nichts oder ist keiner der Dienste erreichbar, läuft der
Import trotzdem durch und die Kachel zeigt den Platzhalter.

Gespeichert wird das Cover als `cover.jpg` mit 500 × 500 px. Deezer und iTunes liefern diese Größe fertig. Eigene
Bilder verkleinert der Browser, bis die kürzere Seite 500 px misst, und wandelt sie in JPEG um; der Server schneidet
sie dann mittig quadratisch auf 500 × 500 px zu (GD, kleinere Bilder werden vergrößert). 

##### Audiospur

Enthält eine GP8-Datei eine Audiospur (MP3), löst der Server sie aus dem Original heraus (`extract_gp_audio()`): Die
MP3 wird unverändert zu `audio.mp3` (auf dem Server gibt es kein ffmpeg zum Umwandeln). Die Sync-Punkte zwischen
Noten und Audiospur stehen danach in den Noten (`\sync` in alphaTex). Abgespielt wird `audio.mp3` vom Mixer
zusammen mit dem Synth.

##### Bereinigung / Konfliktlöser 

Die Noten werden beim Import automatisch und ohne Rückfrage bereinigt. Was das Gitarrenbuch bewusst nicht unterstützt,
wird umgewandelt oder fällt weg. Im Editor entstehen solche Abweichungen nicht, deshalb gibt es nirgends eine Anzeige
dafür. Das gilt auch für "Spur aus Guitar-Pro-Datei importieren". Wie die Regeln im Einzelnen arbeiten und in welcher
Reihenfolge, steht im Kopf von `conflicts.js` und bei `cleanImportedScore()`.

- **Von oben nach unten:** Wiederholungen, Volta-Klammern, Sprungzeichen (D.C., D.S., Coda) und
  Takt-Wiederholungszeichen werden ausgeschrieben. Nur so sind Takt, Silbe, Akkord und Sync-Punkt eindeutig.
- **Ein Capo für den ganzen Song:** Alle Spuren bekommen den kleinsten Capo, die Bünde der anderen werden umgerechnet,
  sodass sie gleich klingen. Akkorde sind Griffnamen relativ zum Capo: Wer bei Capo 2 C greift, liest C. Klingend
  notiert sind nur die Noten.
- **Ein Tuning für alle Spuren:** das tiefste, die anderen werden umgerechnet. Ein Bass mit anderer Saitenzahl behält
  sein Tuning. Ein Tuning eine Oktave neben der üblichen Lage (Oktav-Trick aus Guitar Pro) wird in die übliche Lage
  gebracht.
- **Jede Spur ist Gitarren-Tab:** Spuren ohne Saiten (Gesang, Klavier) werden Tab mit Standard-Tuning. Jede Spur
  bekommt ein Instrument aus der festen Liste (`docs/Instrumente.md`); es legt nur den Klang fest.
- **Akkorde und Text je in genau einer Spur:** Akkorde aus anderen Spuren kommen in die Akkordspur. Text außerhalb der
  Textspur fällt weg; weicht er ab, kommt er als Chord-Datei in den Upload-Ordner.
- **Ein Akkord ist Name plus Griff, je Name ein Griff:** Passen beide nicht zusammen, gewinnt der Name, denn ein Griff
  allein ist mehrdeutig (`x02210` ist Am, aber auch C6/A). Unbekannte Namen werden aus dem Griff bestimmt oder
  vereinfacht. Zwei Griffe desselben Akkords heißen z. B. "G" und "G*". Jede Spur hat je Akkordname ein Griffbild,
  den Standardgriff des Akkord-Katalogs; nur Akkorde, die der Katalog nicht kennt, behalten ihren Griff aus der Datei.
- **Triolen-Feeling nur als Shuffle:** Achtel-Varianten werden Shuffle, Sechzehntel-Varianten fallen weg.
- **Volle Takte:** Zu kurze Takte werden mit Pausen aufgefüllt, zu lange gekürzt.
- **Gleiche Lautstärke:** Alle Spuren sind gleich laut, ohne Dynamik und Automationen; den Rest regelt der Mixer.
  Starke Betonung wird zur einfachen.
- **Auftakt:** Ein Auftakt, der als kurzer Takt mit eigener Taktart oder mit Pausen am Anfang notiert ist, wird zum
  Auftakt in der Taktart des Songs.
- **Ganzzahlige Tempi, Sync-Punkte am Tempowechsel:** Tempi werden auf ganze BPM gerundet, versteckte Tempoangaben
  werden sichtbar (sie gelten ja trotzdem). Mit Audiospur bekommen
  vorher Takt 1 und jeder Tempowechsel einen Sync-Punkt, wenn er fehlt (siehe "Taktangaben in der Partitur").
- **Formales:** Rhythmus-Schrägstriche (sonst stürzt alphaTab ab), Anzeige-Angaben je Spur, Notizen im Namen des
  Tunings, Systemtrenner, Griffbilder in den Noten, Fingerangaben und die Zeilenaufteilung aus Guitar Pro fallen weg.
  Doppelte Taktstriche stehen nur noch vor Abschnitten. Wie der Song aussieht, bestimmt der Player.
- **Eine Stelle je Information:** Titel, Interpret, Album und Notizen kommen nach `song.json` und werden in den Noten
  geleert.

Spurnamen, die Reihenfolge der Spuren, Tonart und Vorzeichen bleiben, wie sie in der Datei stehen.

Der Import fragt bei all dem nicht nach und speichert keinen Bericht; die Änderungen stehen in der Konsole des
Browsers, solche mit Datenverlust (Noten fallen weg, werden versetzt oder klingen anders) mit "⚠". Nachgefragt wird
nur, wenn alphaTex etwas aus der Datei nicht abbilden kann: Dann nennt der Import-Dialog die betroffenen Takte und
fragt, ob trotzdem übernommen wird. Die Originaldatei bleibt im Upload-Ordner.

#### Akkord-Katalog

Der Katalog zeigt alle vewendeten Akkorde des Giarrenbuchs. Der Katalog wird automatisch generiert und aktualisiert.

#### ❌ Patterns-Katalog 

❌ Noch nicht vollständig umgesetzt! 

Der Katalog zeigt alle vewendeten Pattern des Giarrenbuchs.

Ein Pattern beschreibt einen Takt im Raster (Achtel oder Sechzehntel), ein Zeichen bzw. Schritt je Rasterplatz.
Großbuchstabe = betont.

- **Strumming Patterns:** d Plektrum abwärts, u Plektrum aufwärts, x gedämpft, `.` klingen lassen;
  `D.duD.du` ist Folk mit Betonung auf 1 und 3.
- **Picking Patterns** (durch Leerzeichen getrennt) als **Fingersatz**. Die Saite folgt aus dem Finger nach der festen
  Regel aus den Gitarrenschulen: p = Daumen auf dem tiefen Bass (tiefste gegriffene Saite des Akkords), q = Daumen auf
  dem zweiten Bass (bei Bass auf der 6. Saite die 4., sonst die nächsthöhere), i = g-Saite, m = b-Saite, a = e-Saite.
  Ohne Leerzeichen zugleich (`pa`, `ima`), `.` klingen lassen, `x` Pause. `p i q m p i q m` ist Travis-Picking. Mit p
  und q gilt ein Pattern für jeden Akkord.

#### Griffbrett

Das Griffbrett zeigt bis zum 15. Bund, wo die Töne eines Tons, eines Akkords oder einer Tonleiter liegen. Die Punkte
tragen Notennamen oder Intervalle und sind je Intervall eingefärbt; Klammern fassen sie zu Griffen bzw. Lagen zusammen.

Die Ansicht dientss dazu, das Griffbrett kennenzulernen.

### Playerseite

#### Bildschirmsperre deaktivieren

Solange abgespielt wird, hält der Player den Bildschirm an (Wake Lock), damit das Handy am Notenständer nicht dunkel
wird. Bei Pause gibt er die Sperre wieder frei. Technisch geht das mit der Screen Wake Lock API des Browsers:

```js
let lock = null;

// Beim Start der Wiedergabe (eine Nutzeraktion; manche Browser verlangen das)
lock = await navigator.wakeLock?.request('screen');

// Bei Pause
await lock?.release();
lock = null;

// Im Hintergrund gibt der Browser die Sperre selbst frei; beim Zurückkehren neu anfordern
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && isPlaying) lock = await navigator.wakeLock.request('screen');
});
```

Die API gibt es nur über HTTPS (oder `localhost`); ohne sie bleibt der Bildschirm wie eingestellt.

#### Stammdaten-Dialog

Die Stammdaten sind Titel, Interpret, Cover, Genre, Bewertung, Baustelle und Notizen; hier lässt sich der Song auch
löschen. Tonart, Capo, Tempo und Tuning stehen in den Noten und werden auf der Bearbeitungsseite geändert. Nur beim
Anlegen eines Songs fragt der Dialog sie ab und legt damit leere Noten an. Ändern sich Titel oder Interpret, ändert
sich auch der Slug.

#### Darstellung-Dialog

Der Dialog stellt die Größe der Noten ein; sie gilt für alle Songs.

#### GP-Export

Der Export erzeugt eine Guitar-Pro-Datei (`.gp`, Guitar Pro 7 und 8) mit den Noten, den Angaben aus `song.json` und
der Audiospur samt Sync-Punkten. So lässt sich der Song in Guitar Pro öffnen und weitergeben.

#### Leadsheet drucken

Gedruckt wird das Leadsheet so, wie es im Leadsheet-Dialog der Bearbeitungsseite eingerichtet ist, auch als PDF.

### Bearbeitungsseite

Die Bearbeitungsseite ist erst ab 1080 px Fensterbreite vorgesehen (kleiner Laptop, Surface, Tablet quer), denn neben
den Noten brauchen die Panels links, rechts und unten Platz. Geöffnet wird er mit dem Stift oben rechts neben ✕;
für Tablet hochkant oder Handy ist der Stift ausgeblendet.

#### Rückgängig und Wiederholen (Toolbar)

Jede Änderung auf der Bearbeitungsseite ist ein Schritt für "Rückgängig" (Strg+Z) und "Wiederholen" (Strg+Y), auch die
aus Dialogen (Transponieren, Spuren, Leadsheet, Sync-Editor, Laden einer früheren Fassung aus dem Verlauf). Ein Schritt
merkt sich den ganzen Stand davor: die Noten als alphaTex-Text, die Angaben für das Leadsheet, den Cursor und die
gezeigten Spuren. Rückgängig liest diesen Text einfach wieder ein; eine eigene Umkehrung je Änderung gibt es nicht.
Was eng zusammengehört, ist ein Schritt:

- alle Änderungen in Folge über das linke Panel "Am Cursor" im selben Takt;
- die zwei Ziffern eines Bunds;
- alles Tippen im Liedtext-Editor bis zum Verlassen des Felds;
- mehrere Eingaben im Zahlenfeld des Sync-Editors.

Jeder Schritt trägt einen kurzen Hinweis, was sich geändert hat ("Takt 12 geändert", "Spur hinzugefügt",
"Transponiert"); die Knöpfe Rückgängig und Wiederholen zeigen ihn als Tooltip. Gehalten werden höchstens 200 Schritte.
Nach dem Speichern werden beide Stapel geleert, denn der gespeicherte Stand ist der neue Anfang (frühere Fassungen
stehen im Verlauf). Eine neue Änderung nach Rückgängig verwirft die Schritte zum Wiederholen.

**Technisch** hält der Editor zwei Stapel (`undoStack`, `redoStack`) mit Schnappschüssen (`UndoStep`: `tex`, `sheet`,
`pos`, `tracks`, `label`). Eine Änderung läuft immer gleich ab (`change()`):

1. Die Leadsheet-Angaben werden als JSON-Text gemerkt (`sheetJson()`), bevor sich etwas ändert.
2. Die Änderung arbeitet direkt am alphaTab-Modell der Noten.
3. Das Modell wird als alphaTex geschrieben. Ist der Text derselbe wie vorher, war es keine Änderung: Es entsteht kein
   Schritt, und das Modell wird aus dem alten Text neu eingelesen (eine halb ausgeführte Änderung verschwindet so).
4. Sonst kommt der Stand davor (`snapshot()`) mit seinem Hinweis auf `undoStack` (`pushUndo()`), `redoStack` wird
   geleert, und der neue Text wird eingelesen und gezeichnet (`setTex()`). Mit `merge` entfällt der Schnappschuss,
   die Änderung gehört dann zum letzten Schritt.

Weil jeder Schritt den ganzen Text speichert, ist das einfach und sicher, braucht aber Speicher: Ein `score.atex`
hat im Schnitt rund 60 KB, der größte rund 175 KB; 200 Schritte wären also etwa 12 bzw. 35 MB Text im Browser.
Zusammenfassen im Takt und Leeren nach dem Speichern halten die Stapel meist deutlich kleiner.

#### Upload-Dialog (Toolbar)

Alles, was hochgeladen wird (GP-Datei beim Import und Dateien aus dem Dialog "Uploads"), landet unverändert unter 
`data/songs/<slug>/upload/`.

- Liegt dort schon eine Datei mit gleichem Inhalt (MD5-Hash), wird nichts abgelegt.
- Ist der Name schon vergeben, bekommt die neue Datei einen Zähler (`text.cho`, `text-2.cho`, …).
- Akzeptiert werden GP-Dateien, `.ptb`, MusicXML, MIDI, ChordPro, Text, PDF und Bilder. 

Eigene Cover gehören nicht dazu: Hochgeladen wird nur die im Browser verkleinerte JPEG, und die ist `cover.jpg`.

#### Transponieren-Dialog (Toolbar)

Transponieren ändert die Noten selbst; eine eigene Tonhöhe je Song wird nicht gespeichert. Der Dialog im
Bearbeitungsseite hat drei Eingaben:

- **Halbtöne** verschieben alles: Noten, Tabs, Akkordnamen samt Griffen und die Tonart. Aus C wird bei +2 ein D.
- **Capo** ändert die Noten und die Tonart. Tabs, Akkordnamen und Griffe bleiben.
- **Tuning** ändert die Noten auf den geänderten Saiten; Tabs, Akkordnamen und Griffe bleiben. Die Tonart wandert nur
  mit, wenn alle Saiten gleich weit verstimmt werden.

Ändert man Halbtöne und Capo gegenläufig gleichermaßen, lassen sich die Griffe ändern, ohne den Klang zu ändern:
Mit −2 Halbtönen und Capo 2 klingt der Song wie vorher, wird aber mit anderen Griffen gespielt.

Der Dialog schlägt das Capo vor, bei dem die Akkorde am leichtesten zu greifen sind. Dazu probiert er Capo 0 bis 9 mit
den gegenläufigen Halbtönen (der Klang bleibt) und bewertet je Akkord den besten Griff:

- Kosten = Lage · 0,8 + Spanne · 0,5 + Finger · 0,6, dazu +3 bei Barré und +2, wenn der Griff nicht Priorität 1 hat
  (siehe "Akkord-Dialog"); ohne Griff 14.
- Die Kosten werden nach Häufigkeit des Akkords im Song gewichtet und gemittelt; das Capo mit den geringsten Kosten
  gewinnt. Ist das aktuelle Capo schon am leichtesten, entfällt der Vorschlag.

Die Audiospur bleibt, wie sie ist. Klingt der Song danach anders, zeigt der Dialog den Befehl, mit dem `bin/fetchaudio.php`
sie passend verschiebt.

#### Metrum-Dialog (Toolbar)

Der Dialog "Metrum umschreiben" ist das Gegenstück zum Transponieren für die Zeit: Er rechnet Notenwerte, Tempo,
Taktart und Takte um, ohne dass der Song anders klingt (z. B. 6/8 in Achteln → 6/4 in Vierteln bei doppeltem Tempo).
Sync-Punkte, Tempowechsel und Abschnitte behalten ihre Stelle in der Musik.

#### Bereinigen-Menü (Toolbar)

"Akkorde" entfernt doppelte Akkorde und setzt an jeden Abschnittsanfang den Akkord, der dort klingt. "Griffe prüfen"
zeigt, wo die Noten der Akkordspur nicht zu ihrem Akkord passen, und ersetzt sie auf Wunsch durch den Griff des Akkords.

#### Spuren-Dialog (Toolbar)

Je Spur lassen sich Name, Instrument, Sichtbarkeit und Hören einstellen und festlegen, welche Spur die Akkorde und
welche den Text trägt. Wechselt die Akkord- oder Textspur, wandern Akkorde bzw. Silben mit; liegen sie dort mitten in
einem Schlag, fragt ein Dialog, ob der Schlag geteilt oder der Akkord bzw. die Silbe auf den Schlag davor gesetzt wird.
Außerdem lassen sich Spuren hinzufügen, aus einer anderen Guitar-Pro-Datei übernehmen oder aus einer vorhandenen
ableiten (siehe "Rhythmus ableiten" und "Melodie ableiten", im nachfolgenden Kapitel):

#### "Rhythmus ableiten"-Dialog (Toolbar/Spuren-Dialog)

Aus den Anschlägen einer Spur entsteht eine Begleitspur mit Strumming. Der Dialog zeigt dazu alle Rhythmen des Songs 
nach Häufigkeit und wo sie vorkommen. Man kann diese zusammenfassen und ändern.

##### Akkorde mithilfe der Audiospur korrigieren

Mit "Akkorde aus den Tönen der Spur bestimmen" leitet der Dialog die Akkorde des ganzen Songs neu ab; sie ersetzen beim
Übernehmen die bisherigen. Der Schalter darunter nimmt zusätzlich die Audiospur dazu. Er geht nur, wenn die Audiospur
Sync-Punkte hat, denn über sie wird jede Stelle der Noten zu einer Zeit in der Aufnahme. Ohne Audiospur wird eine Spur
abgelehnt, in der meist nur ein Ton klingt (z. B. die Melodie): Aus Melodietönen allein trafen die Proben nur 24 bis
42 % der Akkorde.

1. **Raster:** Je Zählzeit gibt es einen Platz (Nenner der Taktart; bei 6/8, 9/8 und 12/8 die punktierte Viertel).
2. **Kandidaten:** die Dreiklänge der Tonart und die Akkorde, die der Song schon hat.
3. **Bewertung je Platz und Kandidat** aus zwei Teilen:
    - **Noten:** Die Töne der Spur, die auf dem Platz klingen, werden nach ihrer Dauer gewichtet. Ein Kandidat
      bekommt den Anteil des Klangs, den seine Töne abdecken; Abzüge gibt es für fehlende Akkordtöne und einen
      fehlenden Grundton, Zuschläge, wenn der Bass der Grundton ist und der Akkord im Song schon vorkommt. In einer
      einstimmigen Spur zählt das nur 0,3fach, denn Melodietöne sind oft keine Akkordtöne.
    - **Audiospur:** Der Abschnitt der Aufnahme wird per FFT ([docs/FFT.md](docs/FFT.md)) in ein Spektrum zerlegt.
      Von 80 bis 700 Hz, wo die Grundtöne der Begleitung liegen, zählen die Spitzen je Tonklasse (C, C#, …) zu einem
      Tonklassen-Spektrum (Chroma). Es wird mit der Schablone jedes Kandidaten verglichen (Kosinus-Ähnlichkeit;
      Grundton und Terz voll, die Quinte 0,8, denn sie steckt als Oberton in jedem Ton). Die Audiospur zählt doppelt
      so viel wie die Noten.
4. **Folge:** Gewählt wird die Akkordfolge mit der höchsten Summe über alle Plätze (Viterbi). Jeder Wechsel kostet
   einen Abzug, auf der Eins wenig (0,15), mitten im Takt viel (0,6). So wechselt ein Akkord auch auf Schlag 4, aber
   nur, wenn Noten und Aufnahme klar dafür sprechen. Plätze ohne Töne behalten den Akkord davor, vor den ersten Tönen
   steht keiner.

Die Akkorde bekommen ihre Griffe so: Akkorde, die der Song schon hat, behalten ihren Griff; neue bekommen den ersten
aus dem Akkord-Katalog, sonst den ersten berechneten (siehe "Akkord-Dialog"). Mehrstimmige Begleitspuren trafen in den
Proben 90 bis 100 % der Akkorde (je Viertel).

#### "Melodie ableiten"-Dialog (Toolbar/Spuren-Dialog)

Die höchsten Töne mit Liedtext werden zur Melodiespur.

##### Tonhöhe mithilfe der Audiospur korrigieren

Der Rhythmus der Melodie kommt aus den Noten (eine Silbe je Note), die Tonhöhe jeder Silbe aus dem Gesang in der
Aufnahme. Der Schalter geht nur, wenn die Audiospur Sync-Punkte hat. Gerechnet wird im Browser, in reinem JavaScript
ohne Bibliothek; die MP3 wird dazu in Mono mit 16 kHz dekodiert.

1. **Zeit jeder Silbe:** Über die Sync-Punkte bekommt jede Silbe ihren Abschnitt in der Aufnahme, vom Anschlag bis zum
   Ende ihrer angebundenen Noten. Stellen ohne Melodienote ab 250 ms sind Gesangspausen.
2. **Stimme freistellen:** Über die Silbe wird das Betragsspektrum gemittelt (FFT mit 2048 Samples, auf 8192
   aufgefüllt, siehe [docs/FFT.md](docs/FFT.md)). Davon wird das Spektrum der nächsten Gesangspause abgezogen,
   möglichst einer mit demselben Akkord; liegen zwei gleich weit entfernt, wird über beide gemittelt. Was übrig bleibt,
   ist vor allem die Stimme, denn die Begleitung klingt in der Pause genauso.
3. **Kandidaten:** Für jeden Ton im Stimmumfang (A2 bis E5) werden die Spitzen bei Grundton und zehn Obertönen
   summiert, jeder Oberton um den Faktor 0,85 schwächer als der davor. Der Ton mit der größten Summe ist der Kandidat,
   die übrigen bleiben als Alternativen.
4. **Nachbearbeitung mit Musiktheorie und Wiederholung:**
    - **Chorus:** Alle Durchgänge stimmen an derselben Stelle gemeinsam über den Ton ab, denn der Chorus wird jedes Mal
      gleich gesungen.
    - **Sonst** bleibt ein Ton, der in der Tonart liegt und nicht mehr als sieben Halbtöne von der Lage seiner Zeile
      (Median bis zum nächsten Satzzeichen) abweicht. Ein Ton außerhalb der Tonart oder ein Oktav-Ausreißer ist eher
      Rauschen: Er wird neu bestimmt aus seinen Alternativen und denen derselben Stelle in den anderen Durchgängen des
      Abschnitts (Verse 1 und Verse 2). Töne der Tonart zählen dabei voll, andere 0,75fach, Töne des Akkords, der dort
      klingt, 1,1fach. Die Oktave folgt der Lage der Zeile.
5. **Lage auf der Gitarre:** Die ganze Melodie wird um Oktaven verschoben, bis ihre Mitte (Median) bei den hohen Saiten
   liegt (H3 bis H4). Jeder Ton kommt auf die Saite mit dem kleinsten Bund.

#### ❌ Leadsheet-Dialog (Toolbar)

❌ Noch nicht vollständig umgesetzt!

Links stehen die Angaben für das Blatt: Patterns mit "wann", Tab-Stellen, Griffbilder, Links, Hinweise zur Spielweise
und Takte, die auf dem Blatt durch einen Hinweis ersetzt werden ("→ 2 mal spielen"). Rechts steht die Vorschau der
A4-Seiten. Gespeichert wird alles in `score.json`; Tab-Stellen und ersetzte Takte wandern mit, wenn Takte eingefügt
oder gelöscht werden. Dazu gehören drei Dialoge:

- **Patterns aus Spur vorschlagen:** leitet je Abschnitt das häufigste Pattern einer Begleitspur ab.
- **Pattern auf Spur ausrollen:** schreibt ein Pattern mit den Akkorden in eine Spur; überschrieben werden nur leere
  Takte.
- **Abschnitte vergleichen:** zeigt wie ein Diff-Editor die Takte, in denen sich zwei Abschnitte unterscheiden.

#### Verlauf-Dialog (Toolbar)

Beim Speichern kopiert der Server die vorige Fassung nach `data/songs/<slug>>/upload`. Der Verlauf zeigt sie mit
Zeitpunkt und Notiz; jede lässt sich laden oder löschen. Das Laden wird als ein Bearbeitugsschritt in der Undo-Liste 
vermerkt.

#### Kopier-Dialog (linker Panel "Am Cursor")

Der Dialog "Kopieren" (Pinsel, Alt+C) kopiert ausgewählte Eigenschaften der Schläge am Cursor bzw. in der Auswahl:
Akkorde, Anschlag, Notenwerte und Töne, Text über dem Schlag, Liedtext-Silbe. Alt+V überträgt sie ab dem Cursor bzw.
in eine gleich lange Auswahl, auch in einen anderen Song; nur die gewählten Eigenschaften ändern sich. Passt das Ziel
nicht, z. B. weil ein Schlag über den Taktstrich ginge, ändert sich nichts und eine Meldung nennt den Grund.

#### Auftakt (linker Panel "Am Cursor")

Ein Auftakt ist ein unvollständiger Takt 1 vor dem ersten vollen Takt, z. B. eine Viertel vor einem 4/4-Takt. Schaltet
man ihn ein, bekommt Takt 1 die Taktart von Takt 2, und Pausen am Anfang, die alle Spuren gemeinsam haben, fallen weg.
Die Sync-Punkte rücken dabei so, dass die Audiospur weiter passt. Schaltet man ihn aus, wird Takt 1 ein gewöhnlicher
Takt mit der Taktart, die zu seiner Länge passt (z. B. 1/4).

#### Akkord-Dialog (linker Panel "Am Cursor")

Auf der Bearbeitungsseite setzt man einen Akkord im Akkord-Dialog. Man tippt den Namen, und der Dialog liest ihn nach den
Regeln der Musiktheorie (`docs/Musiktheorie.md`): Er zerlegt ihn in seine Töne ("F#m7": F# A C# E) und schlägt die
Griffe vor, die genau diese Töne spielen. Einen unbekannten Namen kann man nicht übernehmen. Passt der Griff im Feld
nicht zum Namen, warnt der Dialog und nennt, wie der Griff klingt.

Die Vorschläge kommen in dieser Reihenfolge:

1. **Aus dem Song:** der Griff, den der Song für diesen Namen schon hat.
2. **Aus dem Akkord-Katalog:** die Griffe, die die Songs für diesen Namen spielen, der häufigste zuerst. Der Katalog
   wird bei jedem Aufruf aus den Noten aller Songs gezählt (nur Standard-Tuning, rund 20 ms) und bis zum nächsten
   Speichern im Browser gehalten.
3. **Berechnet, nach Priorität:**
    1. Grundstellung (die tiefste gespielte Saite spielt den Grundton bzw. den Basston), aufsteigend und bis zur e-Saite
       durchschlagbar, mindestens vier Saiten
    2. Grundstellung und aufsteigend, ohne Lücke, aber die e-Saite schweigt oder es klingen weniger als vier Saiten
    3. Umkehrung oder nicht aufsteigend, ohne Lücke
    4. Eine Saite zwischen den gespielten ist abgedämpft

   Innerhalb einer Priorität geht vor: näher am Sattel, kleinere Spanne, weniger Finger, mehr Saiten.

Berechnet werden nur greifbare Griffe: höchstens drei Bünde Spanne und vier Finger, ein Barré zählt als einer.
Findet sich so keiner, lockert die Suche die Bedingungen schrittweise; zu jedem Namen gibt es also einen Griff.

#### Liedtext-Editor (rechtes Panel)

##### Wo steht der Text?

Text, Akkorde und Abschnitte stehen in den Noten: Silben und Akkorde hängen an den Schlägen, Abschnitte sind Marker an 
den Takten, ein Zeilenumbruch ist ein `\n` am Ende der letzten Silbe einer Zeile. Der Liedtext-Editor im 
Bearbeitungsseite zeigt diesen Text als Fließtext mit Abschnittszeilen (`[Verse]`).  

##### Liedtext auf die Schläge verteilen

Guitar Pro verteilt den Text bei jeder Änderung neu von vorn, ein zusätzliches Wort verschiebt alles dahinter. Das
Gitarrenbuch vergleicht beim Tippen im Liedtext-Editor den alten mit dem neuen Text und ändert nur, was sich geändert 
hat:

- Gleich gebliebene Silben bleiben auf ihrem Schlag, auch mit Lücken dazwischen (gehaltene Silben).
- Eine neue oder geänderte Silbe kommt auf den Schlag der alten an derselben Stelle, sonst auf einen freien Schlag bis
  zur nächsten gleich gebliebenen Silbe. Reicht das nicht, rücken die Silben dahinter Schlag für Schlag nach.
- Eine gelöschte Silbe gibt ihren Schlag frei, die übrigen bleiben stehen.
- Verteilt wird immer vom Stand vor dem Schreiben aus: Wird ein zu langer Text wieder gekürzt, stehen die Silben wie
  vorher.
- Eine Silbe kommt nur auf einen Schlag, an dem eine Note angeschlagen wird, nicht auf Pausen und übergebundene
  Noten. 
- Ein Unterstrich wird nicht gezeigt. Sind zwei Silben mit erinem Unterstrich verbunden, werden sie zusammen auf einen 
  Schlag gebunden. Ein Unterstrich alleinstehen lässt eine Note frei.

**Abschnitte:**   
Der Text unter einer Abschnittszeile gehört zu dem Abschnitt gleichen Namens in den Noten (in deren Reihenfolge) und 
wird nur auf dessen Takte verteilt. Ein Abschnitt verschiebt nie den nächsten. Hat der Text keine Abschnittszeilen, 
gilt er für den ganzen Song. **Außnahme:** Wenn ein Text für einen Abschnitt zu kurz ist, und daher die letzten Noten 
im letzten Takt des Abschnitts keien Silbe haben, werden die ersten Silben des nächsten Abschnitts vorgezogen. 

**Neu zuordnen:**   
Der Button neben "Liedtext-Silbe" im linken Panel verteilt den Text des Abschnitts am Cursor neu, eine Silbe je Note 
der Reihe nach (wie Guitar Pro). Lücken und gehaltene Silben gehen dabei verloren.

**Silbe direkt am Schlag:**   
Im linken Panel setzt oder löscht man die Silbe am Cursor, mit T→ und ←T zieht man die nächste Silbe heran. 
Der Liedtext-Editor wird dabei automatisch aktualisiert.

**Und wenn der im Editor eingegebene Text zu lang ist?**  
Findet ein Abschnitt im Liedtext-Editor nicht genug Noten (oder gibt es ihn in den Noten nicht), wird er im 
rot, und der Tooltip nennt die Silben ohne Schlag. Die Noten bekommen, was passt; im Editor bleibt der Text stehen, wie 
er geschrieben wurde, auch nach dem Verlassen. Abhilfe: Text kürzen, Noten ergänzen oder Silben direkt am Schlag setzen 
bzw. verschieben. Nach jeder solchen Änderung prüft der Editor, ob der Text jetzt passt; dann ist er nicht mehr rot, 
und das Feld zeigt wieder den Text der Noten.

##### Chord-Datei importieren

Solange der Text im Liedtext-Editor leer ist, kann der Text und die Akkorde einer hochgeladenen ChordPro-Datei, oder einer 
Textdatei im Format "Akkorde über Text", importtiert werden (über den Button "Chord-Datei importieren" ). Zugeordnet 
wird, soweit die Datei die Angaben hat:

1. **Nach Abschnitt:** Die Abschnitte der Datei gehen über ihren Namen auf die Abschnitte der Noten. Ohne Abschnitte
   gilt der Text für den ganzen Song.
2. **Nach Akkord:** Innerhalb eines Abschnitts liegen die Silben an Ankern: an den Taktstrichen der Datei (n-ter Strich
   = n-ter Takt), sonst an den Akkordwechseln, wenn die Folge der Akkorde zu den Noten passt. Zwischen zwei Ankern
   verteilen sich die Silben gleichmäßig. Silben einer neuen Zeile vor ihrem ersten Akkord sind ein Auftakt und liegen
   auf den letzten Schlägen davor, am Anfang eines Abschnitts auch im letzten Takt des vorigen.
3. **Der Reihe nach:** Abschnitte ohne passende Anker werden verteilt wie beim Tippen.

Die Akkorde kommen an den Schlag ihrer Silbe in der Akkordspur, nur wo dort noch keiner steht. Akkorde ohne Schlag
werden gemeldet; einen unbekannten Akkord ersetzt ein einfacherer (Am7b5 → Am7 → Am).

[ChordPro – Formatbeschreibung](https://www.chordpro.org/chordpro/)

#### Sync-Editor (unteres Panel)

##### Sync-Punkte

Die Sync-Punkte des Sync-Editors markieren Taktanfänge in der Audiospur. Ein Sync-Punkt im ersten Takt mit Noten kommt
dorthin, wo die Audiospur hörbar wird (beginnt der Takt mit Pausen, um deren Dauer davor); Punkte davor fallen weg.
Weitere Sync-Punkte kommen dorthin, wo die vorhandenen den Takt erwarten: zwischen zwei Punkten linear, hinter dem
letzten mit dessen Tempo. Gibt es nur den ersten Punkt, ist das das notierte Tempo. Wer einen Sync-Punkt verschiebt,
staucht bzw. dehnt die Wiedergabe in den beiden angrenzenden Abschnitten.

##### Taktangaben in der Partitur

Die Tempoangaben in der Partitur (♩=…) sollen zum Tempo der Audiospur passen, damit auch ohne Audiospur im richtigen
Tempo gespielt wird. Sync-Punkte in Takten mit Tempoangabe sind markiert, rot, wenn die Angabe vom Tempo der
Audiospur bis zur nächsten Angabe abweicht. Mit ausgewähltem Sync-Punkt setzt der Tempo-Knopf dort das Tempo der
Audiospur in die Partitur, ohne Auswahl korrigiert er alle Angaben.

**Wofür die Tempoangaben mit Audiospur noch zählen:** Zwischen zwei Sync-Punkten folgt die Wiedergabe dem Tempo der
Aufnahme, das sich aus Ticks und Zeit der beiden Punkte ergibt; die notierte Zahl selbst spielt dort keine Rolle.
Liegt aber ein Tempowechsel zwischen zwei Sync-Punkten, teilt die Wiedergabe die Zeit dazwischen nach dem Verhältnis
der notierten Tempi auf. Stimmt das Verhältnis nicht, verrutscht alles bis zum nächsten Sync-Punkt. Deshalb bekommt
jeder neue Tempowechsel (Tempo-Feld im linken Panel, Tempo-Knopf im Sync-Editor) in jedem Durchgang seines Takts einen
Sync-Punkt, und zwar an der Stelle, an der der Takt in der Audiospur gerade beginnt; danach beginnt dort ein eigener
Abschnitt. Ohne Sync-Punkte im Song und im ersten Takt (Anfangstempo) entsteht keiner. "Alle Tempoangaben korrigieren"
setzt keine neuen Wechsel und braucht daher auch keine neuen Sync-Punkte.

Tempi sind immer ganze Zahlen: Die Eingabefelder nehmen nur ganze BPM, der Metrum-Dialog rundet nach dem Umrechnen,
der Import rundet die Tempi aus der Datei. Mit Audiospur ergänzt der Import vorher die fehlenden Sync-Punkte, einen
am Anfang von Takt 1 und einen an jedem Tempowechsel, jeweils dort, wo die Wiedergabe den Takt ohnehin erwartet. So
ändert das Runden beim Abspielen mit Audiospur nichts; ohne Audiospur wird der Song nur um Bruchteile eines Prozents
schneller oder langsamer.

## Audio von YouTube bereitstellen

`bin/fetchaudio.php` läuft lokal, holt die Audiospur der Songs mit YouTube-URL (noch ohne `audio.mp3`), wandelt sie um und
lädt sie per `PUT api/audio.php` hoch. Ablauf, Optionen, Transponieren der Audiospur und das Verhalten bei einem
anderen Clip stehen im Kopf von `bin/fetchaudio.php` und in `php bin/fetchaudio.php --help`; das portable Paket für einen anderen
PC baut `bin/build_fetchaudio_portable.cmd` (Beschreibung im Kopf der Datei).

```
php bin/fetchaudio.php --password=… --dry-run    # nur zeigen, was zu tun ist
php bin/fetchaudio.php --password=…              # holen, umwandeln, hochladen
```

## Offene Punkte

- ❌ Leadsheet bauen
- ❌ Zählzeiten Im Darstellung-Dialog ein-/ausblendnen lassen
- ❌ Plektrum-Anschlagzeichen nicht manuell eintragen lassen. Sie können automatisch gesetzt werden. 
  Im Darstellung-Dialog ein-/ausblendne lassen.

## Rechtliche Hinweise

- **YouTube:** Die Kopien sind nur für den privaten Gebrauch bestimmt (§53 UrhG) und werden nicht weitergegeben oder
  öffentlich zugänglich gemacht. Basic Auth schützt die Audiodateien. Die Nutzungsbedingungen von YouTube schließen
  Downloads aus.
- **Ultimate Guitar:** GP-Dateien werden einzeln und manuell mit dem eigenen Pro-Abo für den Eigenbedarf
  heruntergeladen, ohne Weitergabe.

## Lizenz

Dieses Projekt steht unter der [GPL-3.0-Lizenz](LICENSE).

Das bedeutet: Du darfst diesen Code nutzen, ändern und verbreiten. Wenn du die Software (oder eine modifizierte
Version davon) jedoch weitergibst, musst du deinen Quellcode ebenfalls unter derselben Lizenz offenlegen.

### Mitgelieferte Fremdbestandteile

Unter `public/vendor/alphatab/` liegen, bis auf vermerkte Änderungen in `alphaTab.core.mjs` (Kommentar oben in
der Datei; die MPL-2.0 erlaubt das, die geänderte Datei bleibt unter MPL-2.0):

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

Dazu im Code die Pfade der Symbole "directions_run" (`js/pages/player.js`, `RUN_ICON`), "edit" (`app.js`) sowie "save",
"undo" und "redo" (`js/ui/icons.js`) aus Google Material Icons (Apache 2.0). Die übrigen Symbole in `js/ui/icons.js` sind
selbst gezeichnet.

Alle Lizenzen sind mit der GPL-3.0 vereinbar: Die MPL-2.0 erlaubt die Verbindung mit der GPL ausdrücklich
(alphaTab trägt nicht den Vermerk "Incompatible With Secondary Licenses"), MIT und Apache 2.0 lassen sich in
GPL-3.0-Software übernehmen, und die Schrift liegt als eigene Datei neben dem Programm. Die Fremdbestandteile
behalten ihre eigene Lizenz; die Lizenzdateien müssen beim Weitergeben dabeibleiben.

Die Cover gehören den jeweiligen Rechteinhabern und werden nur für die private Übersicht geladen.
