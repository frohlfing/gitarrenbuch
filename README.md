# Gitarrenbuch

Ein persönliches Gitarrenbuch: die Sammlung der Songs, die ich allein mit der Gitarre spiele und singe, als kleine
PHP/JSON-API mit einem statischen Frontend. Songs kommen als Guitar-Pro-Datei (GP3 bis GP8, z. B. von Ultimate
Guitar) ins Gitarrenbuch und werden mit [alphaTab](https://alphatab.net) als Noten und Tabs angezeigt und
abgespielt, auch auf dem Smartphone am Notenständer. Das Cover holt sich das Gitarrenbuch selbst von Deezer oder
iTunes.

Das Gitarrenbuch ersetzt Guitar Pro: Bearbeitet wird nur noch in der App, Guitar-Pro-Dateien sind reines Import- und
Exportformat. Am Ende steht für jeden Song eine ausdruckbare DIN-A4-Seite zum Spielen am Lagerfeuer: Akkorde über dem
Text, Anschlagmuster, Griffe. Sie soll unterhaltsam und gut spielbar sein, nicht musikalisch ausgefeilt.

Dazu kommt die Aufnahme von YouTube, die synchron zu den Noten mitläuft. Geplant sind ein Editor für Noten, Text und
Akkorde und später KI-Funktionen wie "Fingerstyle-Fassung erzeugen" oder "Akkorde aus der Aufnahme bestimmen" (siehe
"Stand / Roadmap" und "Planung der offenen Phasen").

Grundsätze:

1. **Jeder Song hat Noten** (`score.atex`). Ein Song entsteht durch Import einer GP-Datei oder wird manuell
   angelegt; dann erzeugt die App ein Gerüst mit leeren Takten. Eine eingebettete Audiospur wird herausgelöst, die
   Angaben zum Song (Titel, Interpret, Beschreibung, …) kommen nach `song.json`.
2. **Jede Information steht an genau einer Stelle**: Angaben in `song.json`, alles Musikalische (auch Text, Akkorde,
   Abschnitte, Tempo, Stimmung und die Sync-Punkte zur Audiospur) in den Noten, Aufnahme und Cover als eigene Dateien.
3. **Anreichern mit einer Akkorddatei** (ChordPro oder Text): Sie wird in die Noten eingearbeitet, vorhandener Text
   hat Vorrang. Bis zum Editor wird sie nur als Rohmaterial abgelegt.
4. **Cover** von Deezer, iTunes oder als eigenes Bild.
5. **Audio** über eine YouTube-URL (`bin/audio.php`).

Wo was liegt (je Song unter `data/songs/<slug>/`):

| Datei            | Inhalt                                                                              |
|------------------|-------------------------------------------------------------------------------------|
| `song.json`      | Titel, Interpret, Spieltechnik, Genres, weitere Angaben aus der GP-Datei, Notizen   |
| `score.atex`     | Noten, Tabs, Text, Akkorde, Abschnitte, Tempo, Stimmung, Capo, Tonart, Sync-Punkte  |
| `audio.mp3`      | Aufnahme                                                                            |
| `cover.jpg`      | Cover                                                                               |
| `leadsheet.json` | nur Layout der DIN-A4-Seite (Zeilenumbrüche, Anschlagmuster, Randnotizen), geplant  |
| `orig/`          | alle Uploads unverändert                                                            |

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
 │    ├── chords.json                 # Akkordbibliothek: Griffe je Akkordname, Standardgriff zuerst
 │    └── songs/                      # Ein Unterordner pro Song
 │         └── <slug>/                # Slug aus Interpret + Titel, z. B. "bob-marley-three-little-birds"
 │              ├── song.json         # Angaben (Titel, Interpret, Spieltechnik, Tags, Notizen, Quellen-URLs)
 │              ├── score.atex        # Noten, Tabs, Text, Akkorde, Abschnitte, Sync-Punkte (alphaTex)
 │              ├── audio.mp3         # Audiospur (beim Import aus der GP-Datei herausgelöst)
 │              ├── cover.jpg         # Albumcover, 500 px (Deezer, iTunes oder eigenes Bild)
 │              └── orig/             # Hochgeladenes Rohmaterial (GP-, ChordPro-, Textdateien), nie überschrieben
 │    └── backup/                     # Nur lokal: Rohmaterial je Song (<slug>/), u. a. die von YouTube geladene Spur
 ├── bin/
 │    ├── audio.php                   # YouTube → audio.mp3, lädt per API auf den Server hoch (läuft lokal)
 │    └── build_audio_portable.cmd    # audio.php samt PHP, yt-dlp, Deno und ffmpeg als Paket für einen anderen PC
 ├── docs/
 │    └── nachlieferung.md            # Was nach der Archiv-Übernahme nachzuliefern oder zu prüfen ist
 ├── public/                          # Document Root
 │    ├── api/                        # API-Endpunkte
 │    │    ├── lib/                   # Gemeinsam genutzte Hilfsfunktionen der API-Endpunkte
 │    │    │    ├── cover.php         # Cover suchen (Deezer, iTunes), übernehmen, speichern
 │    │    │    ├── crud.php          # Read/Write/Rename/Delete-Logik + Validierung
 │    │    │    ├── fetch.php         # http_get(): curl, sonst file_get_contents()-Fallback
 │    │    │    ├── file_store.php    # Noten und Rohmaterial ablegen, Dateien mit ETag ausliefern
 │    │    │    ├── gp_file.php       # GP-Format erkennen, Audiospur herauslösen
 │    │    │    ├── lyrics_store.php  # Akkorddatei (ChordPro, Text) als Rohmaterial ablegen
 │    │    │    ├── http.php          # JSON-Response-Helper, Token-Prüfung
 │    │    │    ├── slug.php          # slugify() + Eindeutigkeits-Check
 │    │    │    └── youtube.php       # Video-ID, Titel und Länge eines YouTube-Videos
 │    │    ├── audio.php              # Liefert audio.mp3 (z. B. für den GP-Export)
 │    │    ├── chords.php             # Akkordbibliothek ausliefern
 │    │    ├── cover.php              # Cover ausliefern, suchen, übernehmen, hochladen, entfernen
 │    │    ├── import.php             # Neuen Song mit Noten anlegen (Import oder Gerüst, inkl. Cover)
 │    │    ├── lyrics.php             # Akkorddatei hochladen (landet unter orig/)
 │    │    ├── score.php              # score.atex ausliefern (für alphaTab) und ersetzen (Sync-Editor)
 │    │    ├── songs.php              # Songs lesen, bearbeiten, löschen
 │    │    └── youtube.php            # Titel und Länge eines YouTube-Videos (für das Formular)
 │    ├── dev/                        # Admin-/Wartungsskripte – NICHT dauerhaft auf dem Produktivserver lassen
 │    │    └── info.php               # phpinfo()
 │    ├── js/                         # ES-Module des Frontends (ohne Bundler, von app.js importiert)
 │    │    ├── api.js                 # API-Zugriff, Token-Abfrage, gemeinsame Typen (Song, CoverHit)
 │    │    ├── chords.js              # Akkordbibliothek: Griffe, Griffbilder vereinheitlichen, Tonart erkennen
 │    │    ├── library.js             # Kachelübersicht, Formulare (Song, Import, Cover, Text), Overlay
 │    │    ├── mixer.js               # Audiospur parallel zum Synth, Gleichlauf über die Sync-Punkte
 │    │    ├── player.js              # alphaTab-Wrapper: Notenansicht, Abspielleiste, Einstellungen
 │    │    ├── score.js               # Notenformat: GP lesen, bereinigen und prüfen, Gerüst, GP-Export, Eckdaten
 │    │    ├── svg.js                 # Griffbild als SVG
 │    │    └── sync-editor.js         # Sync-Editor: Wellenform, Sync-Punkte setzen, verschieben, speichern
 │    ├── vendor/alphatab/            # alphaTab 1.8.4 (MPL-2.0) mit Notenschrift und SoundFont, siehe "Lizenz"
 │    ├── .htaccess                   # Apache Zugriffsschutz
 │    ├── .htaccess.example           # Vorlage für Apache Zugriffsschutz
 │    ├── app.css                     # CSS-Styles für das Frontend
 │    ├── app.js                      # Einstieg des Frontends: Routing zwischen Übersicht, Songansicht und Griffbildern
 │    ├── favicon.svg                 # Browser-Tab-Icon (Gitarre)
 │    └── index.html                  # Frontend (lädt/schreibt ausschließlich über /api/*)
 ├── types/alphatab.d.ts              # Nur für die IDE: Typen von alphaTab (nicht deployen)
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

**Wichtig:** `public/dev/` gehört **nicht dauerhaft** auf den Produktivserver. Nach Gebrauch dort löschen – ein
Server-Interna preisgebender `phpinfo()`-Endpunkt soll keine Dauereinrichtung sein.

## API

Alle schreibenden Endpunkte (`POST`/`PUT`/`DELETE`) erwarten den Header `X-API-Token: <token>`, sonst `401`. Lesende
Endpunkte (`GET`) sind ohne eigenes Token offen — Schutz vor öffentlichem Zugriff übernimmt stattdessen die HTTP Basic
Auth vor der gesamten `public/`-Domain (siehe Setup, Schritt 5), die auch die statische `index.html` selbst mit
abdeckt.

| Methode | Endpunkt                          | Beschreibung                                                                                                                                  |
|---------|-----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| GET     | `/api/songs.php`                  | Alle Songs, alphabetisch nach Titel (das Frontend sortiert ggf. um)                                                                           |
| GET     | `/api/songs.php?slug=xyz`         | Einzelner Song                                                                                                                                |
| PUT     | `/api/songs.php?slug=xyz`         | Song bearbeiten (JSON-Body). Ändert sich der Slug (Interpret/Titel), wird der Ordner umbenannt                                                |
| DELETE  | `/api/songs.php?slug=xyz`         | Song samt Ordner (Rohmaterial inklusive) löschen                                                                                              |
| POST    | `/api/import.php`                 | Neuen Song anlegen (`multipart/form-data`: `meta` = JSON wie bei PUT `songs.php`, `score` = alphaTex, `file` = Original-GP-Datei, optional)   |
| GET     | `/api/score.php?slug=xyz`         | Noten `score.atex` ausliefern (für alphaTab)                                                                                                  |
| PUT     | `/api/score.php?slug=xyz`         | Noten ersetzen (Body: alphaTex als `text/plain`; nutzt der Sync-Editor). Nur für Songs, die schon Noten haben                                 |
| GET     | `/api/audio.php?slug=xyz`         | Audiospur `audio.mp3` ausliefern                                                                                                              |
| PUT     | `/api/audio.php?slug=xyz`         | Audiospur ersetzen (Body: die MP3 als `audio/mpeg`; nutzt `bin/audio.php`)                                                                    |
| GET     | `/api/cover.php?slug=xyz`         | Cover `cover.jpg` ausliefern                                                                                                                  |
| GET     | `/api/cover.php?artist=…&title=…` | Cover bei Deezer und iTunes suchen (`{"results": [...]}`, Deezer zuerst)                                                                      |
| PUT     | `/api/cover.php?slug=xyz`         | Cover aus der Suche übernehmen (Body: `{"url": "…"}`, nur Bildserver von Deezer und iTunes)                                                   |
| POST    | `/api/cover.php?slug=xyz`         | Eigenes Cover hochladen (`multipart/form-data`: `file`, JPEG; der Browser verkleinert und wandelt vorher um)                                  |
| DELETE  | `/api/cover.php?slug=xyz`         | Cover entfernen                                                                                                                               |
| GET     | `/api/youtube.php?url=…`          | Titel und Länge eines YouTube-Videos (`{"id", "title", "seconds"}`, gelesen aus der Videoseite)                                               |
| POST    | `/api/lyrics.php?slug=xyz`        | Akkorddatei hochladen (`multipart/form-data`: `file`, ChordPro oder `.txt`); landet unter `orig/`                                             |

Jeder Song enthält zusätzlich das Feld `files`. Es listet, welche Dateien im Ordner liegen (`score`, `audio`,
`leadsheet`, `cover`, z. B. `["score", "audio", "cover"]`), wird bei jedem Lesen aus dem Dateisystem bestimmt und
nicht gespeichert.

`song.json`-Schema:

```json
{
  "title": "Three Little Birds",
  "artist": "Bob Marley",
  "technique": null,
  "tags": ["Reggae"],
  "subtitle": null,
  "album": "Exodus",
  "words": null,
  "music": null,
  "copyright": null,
  "tab": null,
  "instructions": null,
  "notes": "https://tabs.ultimate-guitar.com/tab/…\nBass:\nhttps://www.youtube.com/watch?v=…",
  "sources": { "ultimateGuitar": "https://…", "youtube": "https://www.youtube.com/watch?v=…" },
  "youtubeSeconds": 180,
  "slug": "bob-marley-three-little-birds",
  "created": "2026-10-26T02:43:52+01:00",
  "updated": "2026-10-26T15:01:03+01:00"
}
```

`technique` ist `strumming`, `fingerpicking` oder `null`. `tags` sind die Genres (in der Oberfläche "Genre"),
mehrere je Song möglich, z. B. "Rock & Pop", "Folk", "Weihnachtslied"; das Formular zeigt die vorhandenen zum An- und
Abwählen. Tonart, Capo, Stimmung und Tempo stehen nicht in `song.json`, sondern nur in den Noten; die Songansicht liest sie von dort. `subtitle` bis `instructions` sind die
weiteren Angaben aus der GP-Datei, 1:1 übernommen (Untertitel, Album, Text, Musik, Copyright, Tab-Autor,
Anweisungen); das Gitarrenbuch nutzt sie vorerst nicht, und "Song bearbeiten" lässt sie unverändert. `notes` sind freie, mehrzeilige Notizen. Interpret und
Titel zusammen dürfen nur einmal vorkommen.

`sources` hält fest, woher das Rohmaterial stammt (im Formular "Quelle für Guitar-Pro-Datei" und "Quelle für
Audio-Datei"): `ultimateGuitar` ist die Seite des Tabs bei Ultimate Guitar (von dort manuell heruntergeladen),
`youtube` das Video, aus dem `bin/audio.php` die Audiospur holt. Beide werden von Hand eingetragen. Unter dem YouTube-Feld führt "Auf YouTube suchen" zur Suche nach Interpret und Titel.
Ein eingefügter YouTube-Link wird sofort auf `https://www.youtube.com/watch?v=<ID>` gekürzt (Playlist, Startzeit
usw. fallen weg); der Server kürzt beim Speichern noch einmal.
Neben den Feldern stehen die Längen, damit man sieht, ob ein Clip passt: "Noten" (Spieldauer im eigenen Tempo mit
Wiederholungen, ohne Sync-Punkte), "Clip" (Länge des eingetragenen Videos) und "MP3"
(vorhandene `audio.mp3`). Die Clip-Länge steht als `youtubeSeconds` in `song.json`; YouTube wird nur gefragt, wenn
sich die URL ändert oder die Länge noch fehlt (dann zeigt der Tooltip den Videotitel). Ohne YouTube-URL ist sie
`null`.
Regeln zu den einzelnen Feldern (Pflichtfelder, Wertebereiche, Dateien) stehen bei den Funktionen in
`public/api/lib/crud.php`.

## Frontend / Arbeitsweise

### Request-Ablauf beim Seitenaufruf

1. **Statische Assets**: `favicon.svg`, `app.css` und `app.js`. `app.js` ist ein ES-Modul und importiert die Module
   aus `js/`.
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

Über den Kacheln gibt es eine Suche (Titel, Interpret, Genre), einen Genre-Filter und die Sortierung nach Titel,
Interpret, zuletzt geändert oder zuletzt angelegt. Suchbegriff, Filter und Sortierung merkt sich der Browser.

### Import-Funktion

Der normale Weg zu einem neuen Song:

1. **GP-Datei importieren**: "+ Neuer Song" öffnet den Dialog "Song importieren". Die Datei wird hineingezogen oder
   ausgewählt (GP3 bis GP8, z. B. von [Ultimate Guitar](https://www.ultimate-guitar.com/explore?type[]=Pro), Tabs
   vom Typ "Guitar Pro" über "Download"). Die Seite des Tabs lässt sich gleich als "Quelle für Guitar-Pro-Datei"
   eintragen und wird mit gespeichert.
2. **Audio hinzufügen**: YouTube-URL im Formular eintragen, dann lokal `bin/audio.php` starten (siehe "Audio von
   YouTube").
3. **Bearbeiten und spielen.**

alphaTab liest die Datei im Browser, weil PHP die GP-Formate nicht selbst auswerten kann (`readGpFile()` in
`js/score.js`):

- Titel, Interpret, Beschreibung (in Guitar Pro "Notices", oft Links zu Tabs und Videos) und die übrigen Angaben
  gehen nach `song.json`: die Beschreibung in die Notizen (`notes`), Untertitel, Album, Text, Musik, Copyright,
  Tab-Autor und Anweisungen 1:1 in eigene Felder. Fehlt der Titel, wird er aus dem Dateinamen gebildet ("Interpret -
  Titel.gp").
- Die Noten werden automatisch und ohne Rückfrage bereinigt (`cleanImportedScore()`, siehe "Akkorde und
  Griffbilder"): je Spur und Akkordname ein Griffbild aus der Bibliothek, keine Rhythmus-Schrägstriche, keine
  Anzeige-Angaben je Spur. Tonart und Vorzeichen bleiben wie in der Datei, Korrekturen schlägt der Editor vor.
- Dann werden sie ohne die Angaben zu alphaTex (siehe "Notenformat"). Danach liest der Browser das Ergebnis wieder
  ein und vergleicht es Schlag für Schlag mit dem Modell; geht dabei etwas verloren, lehnt er den Import ab.
- Der Server prüft das Format am Dateiinhalt (nicht an der Endung), legt die GP-Datei unverändert unter `orig/` ab
  und speichert die Noten als `score.atex`. Noten lassen sich nur beim Anlegen speichern; ändern wird sie der
  geplante Editor.

Enthält eine GP8-Datei eine Audiospur (MP3), löst der Server sie aus dem Original heraus (`extract_gp_audio()`): Die
MP3 wird unverändert zu `audio.mp3` (auf dem Server gibt es kein ffmpeg zum Umwandeln). Die Sync-Punkte zwischen
Noten und Audiospur stehen danach in den Noten (`\sync` in alphaTex). Abgespielt wird `audio.mp3` vom Mixer
zusammen mit dem Synth (siehe "Notenansicht und Wiedergabe").

### Audio von YouTube

`bin/audio.php` läuft lokal (auf dem Server fehlen yt-dlp und ffmpeg). Es lädt die Songliste vom Server und
bearbeitet jeden Song mit YouTube-URL, der noch keine `audio.mp3` hat:

1. yt-dlp lädt die beste Audiospur nach `data/backup/<slug>/youtube-<Video-ID>.<ext>` (liegt sie dort
   schon, wird nicht erneut geladen).
2. ffmpeg wandelt sie in eine MP3 um: Stereo, 56 kbit/s, 16 kHz, so wie Guitar Pro eingebettetes Audio oft speichert
   (rund 2 MB für 5 Minuten). Die Lautstärke wird als Ganzes auf −16 LUFS gebracht, höchstens bis −1,5 dBTP
   Spitzenpegel; die Dynamik bleibt unverändert. Am Anfang wird nichts abgeschnitten, damit die Sync-Punkte passen.
3. Das Ergebnis landet in `data/songs/<slug>/audio.mp3` und wird per `PUT api/audio.php` hochgeladen.

```
php bin/audio.php --password=… --dry-run    # nur zeigen, was zu tun ist
php bin/audio.php --password=…              # holen, umwandeln, hochladen
php bin/audio.php --update                  # yt-dlp aktualisieren
```

Das API-Token kommt aus `config.php` (oder `--api-token`). Die Server-Adresse ist
`https://gitarrenbuch.frank-rohlfing.de`, zum lokalen Testen `--remote=https://gitarrenbuch.test`. Der Datenordner
ist `--data`, sonst `DATA_DIR` aus `config.php`, sonst `data\` neben `bin\`; er wird bei Bedarf angelegt. Weitere
Optionen zeigt `php bin/audio.php --help`.

**Portables Paket** für einen anderen Windows-PC (PHP-Minimum aus XAMPP, yt-dlp und Deno aus
`C:\Program Files\yt-dlp`, ffmpeg aus `C:\Program Files\ffmpeg\bin`):

```
bin\build_audio_portable.cmd D:\gitarrenbuch-audio                 # ohne config.php: --api-token beim Aufruf
bin\build_audio_portable.cmd D:\gitarrenbuch-audio --with-config   # config.php mit API_TOKEN und DATA_DIR
D:\gitarrenbuch-audio\start.cmd --password=… --dry-run
```

`--with-config` schreibt nur `API_TOKEN` und `DATA_DIR` (als absoluten Pfad) aus der eigenen `config.php` ins Paket.
Das Paket enthält dann das Token und darf nicht weitergegeben werden. Ohne `config.php` landen die Daten im Ordner
`data\` des Pakets. Nach Änderungen an `bin/audio.php` oder `public/api/lib` das Paket neu bauen.

**Anderer Clip:** Wird im Formular eine andere YouTube-URL gespeichert, entfernt der Server die bisherige
`audio.mp3` (`delete_audio()` in `api/lib/crud.php`); ein Backup auf dem Server gibt es nicht. Das YouTube-Original
liegt lokal bei `bin/audio.php` in `data/backup/<slug>/`, daraus lässt sich die alte Fassung wieder erzeugen. Der Song
hat dann keine Audiospur mehr, und der nächste Lauf von `bin/audio.php` holt die neue. Wird die URL nur
gelöscht, bleibt die Audiospur. Unter dem YouTube-Feld weist das Formular darauf hin. Die Sync-Punkte passen danach
oft nicht mehr genau und müssen im Sync-Editor nachgezogen werden.

"Manuell" im selben Dialog ist für Songs ohne passende GP-Datei (wie "Manuell" im Import-Dialog der Videothek) und
öffnet das Formular "Neuer Song"; eine schon eingetragene Quelle geht mit. Weil jeder Song Noten hat, erzeugt der
Browser aus dem Formular ein Gerüst (`createScore()` in `js/score.js`): eine Gitarrenspur mit vier leeren Takten,
dazu Tempo (sonst 120), Stimmung, Kapodaster und Tonart (die klingende, nicht die der Griffe). Diese vier Felder gibt es nur beim Anlegen; danach stehen sie in den Noten und werden
im Editor geändert.

### GP-Export

Im Menü der Songansicht erzeugt "Exportieren" eine vollständige `.gp`-Datei (`exportGpFile()` in
`js/score.js`): Noten aus `score.atex`, Titel, Interpret, Notizen und die weiteren Angaben aus `song.json`, dazu die
Audiospur mit den Sync-Punkten. Guitar Pro 7 und 8 öffnen sie; ein erneuter Import ergibt wieder dieselben Noten.
Verloren gehen dabei nur Layout-Feinheiten wie feste Taktbreiten.

### Rohmaterial

Alles, was hochgeladen wird (GP-Datei beim Import, ChordPro- und Textdateien), landet unverändert unter `orig/`
(`store_original()` in `api/lib/file_store.php`):

- Liegt dort schon eine Datei mit gleichem Inhalt (MD5-Hash), wird nichts abgelegt.
- Ist der Name schon vergeben, bekommt die neue Datei einen Zähler (`text.cho`, `text-2.cho`, …).
- In `orig/` wird nie etwas überschrieben, verändert oder gelöscht (außer mit dem ganzen Song).

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
  100 KB je Song sind unkritisch. Zwei fremde GP5-Dateien mit Schlagzeugspuren lehnt der Import ab, weil alphaTab
  sie nicht als alphaTex schreiben kann.
- **Risiko**: alphaTex kann sich mit neuen alphaTab-Versionen ändern. Vor einem Update werden deshalb alle Songs mit
  der alten Version geladen und mit der neuen gespeichert; die Originale in `orig/` und der GP-Export bleiben als
  Sicherung.

Eine reine JSON-Fassung der Noten (`JsonConverter` von alphaTab) kam nicht in Frage: rund 80-mal so groß wie die
GP-Datei und als Speicherformat nicht gedacht.

### Cover

Beim Import sucht der Server mit Interpret und Titel ein Albumcover, zuerst bei Deezer, dann bei iTunes (beide ohne
API-Schlüssel), und übernimmt den ersten Treffer. Findet er nichts oder ist keiner der Dienste erreichbar, läuft der
Import trotzdem durch und die Kachel zeigt den Platzhalter.

Ändern lässt sich das Cover im Formular "Song bearbeiten": Ein Klick auf das Cover öffnet den Cover-Dialog über
dem Formular, dessen Eingaben bleiben erhalten. Der Dialog zeigt die Treffer beider Dienste zur Auswahl; gerade bei
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
Noten erzeugt, nur Layout-Angaben (Zeilenumbrüche, Anschlagmuster, Randnotizen) kommen nach `leadsheet.json`.
Umgekehrt ginge Information verloren: ChordPro kennt nur "Akkord vor dieser Silbe", Akkorde ohne Silbe (Intro,
Zwischenspiel) hätten keinen Schlag mehr.

Im Formular "Song bearbeiten" lässt sich unter "Akkorddatei" eine ChordPro- (`.cho`, `.chopro`, `.crd`, `.pro`) oder
Textdatei (`.txt`, z. B. Akkorde über den Zeilen) hineinziehen oder auswählen. Wie beim Cover wird sofort gespeichert,
unabhängig vom Formular. Die Datei kommt unverändert nach `orig/` (siehe "Rohmaterial"). In die Noten eingearbeitet
wird sie mit dem geplanten Editor: Vorhandener Text hat Vorrang, fehlt er, wird der Text aus der Akkorddatei
bestmöglich übernommen.

### Akkorde und Griffbilder

Die **Akkordbibliothek** `data/chords.json` (`api/chords.php`, `js/chords.js`) enthält alle Akkorde aus den Songs
mit ihren Griffen in Standardstimmung, z. B. `"c": ["x32010", "xxx553"]`. Schlüssel ist der Akkordname in
Kleinbuchstaben, ein Griff steht von der tiefen E-Saite aus ("x" = nicht gespielt; ab Bund 10 mit "-" getrennt). Der
erste Griff ist der Standard: offen bzw. am einfachsten zu greifen, für Anfänger möglichst in der ersten Lage (Bm als
`xx4432`; F aber bewusst als volles Barré `133211`). Weitere Griffe kommen aus den Songs, geprüft gegen die
Akkordtöne; Griffe, die nur Saiten eines anderen weglassen, fallen weg. "Griffbilder" in der Songliste (`#/akkorde`)
zeigt alle zum Ansehen und Drucken, in aufklappbaren Gruppen je Grundton (gedruckt wird alles, auf weißem Grund).

In den Noten zeigt jede Spur **je angeschlagenem Akkordnamen genau ein Griffbild**, den Standardgriff der Bibliothek
(`normalizeChords()`), mit Barré-Balken für volle und kleine Barrés (`barreFret()`: F `133211`, F#m `xx4222`; alphaTex
`barre N`). Nur Akkorde, die die Bibliothek nicht kennt, behalten ihren meistgenutzten Griff aus der Datei,
z. B. die Septakkorde "D7*", "D#7*", "E7*" in "Kokain", die in einer Lage hochrutschen. Ob GP ein Griffbild ein- oder
ausblendet, zählt nicht. Hintergrund: alphaTex unterscheidet Akkorde nur nach dem Namen, und viele GP-Dateien hatten
mehrere Varianten gleichen Namens, oft Bruchstücke mit ausgeblendetem Griffbild; in 12 Songs fehlten deshalb
Griffbilder im Kopf.

Die **Vorzeichen** prüft `detectKeySignature()` (für den Editor, der Import ändert sie nicht): Akkorde (mit Capo
klingend gerechnet) und gespielte Töne gegen die notierte Tonleiter. Passt eine andere klar besser, schlägt sie diese
vor, mit dem Schlussakkord als Grundton, wenn dessen Tonart kaum schlechter passt ("Happy Xmas" mit G-Akkord in A
wird A-Dur, nicht D-Dur). An den 42 Songs vor der Korrektur schlug sie genau Chasing Cars (A), Happy Xmas (A) und
Drunken Sailor (Em) vor; diese drei sind von Hand korrigiert.

Bereinigt wurden die 42 Songs am 29.10.2026 (Sicherung jeweils `data/backup/<slug>/score-vor-griffbilder.atex`);
neue Songs bereinigt der Import nach denselben Regeln. Dabei fallen auch die
Rhythmus-Schrägstriche weg (die Schläge stehen als normale Akkordschläge da): alphaTab 1.8.4 stürzt an ihnen ab,
wenn eine Spur nur Tabs zeigt (`paintBeamingStem`), ganze Takte blieben leer. Ebenso die Anzeige-Angaben je Spur
(`\staff { score tabs }`): Noten und Tabs wählt der Player. Und die Tonart, die GP oft in den Namen der Stimmung
schreibt ("Key: C (orig. D)"), teils im Widerspruch zu den Vorzeichen; sie steht schon in `\ks` (Sicherung
`score-vor-stimmungsnamen.atex`).

### Notenansicht und Wiedergabe

alphaTab zeichnet Noten und Tabs und spielt sie mit dem eingebauten Synthesizer und einem SoundFont ab. Die
Abspielleiste steht fest am unteren Rand: Abspielen, zum Anfang, Positionsregler, Tempo (30 bis 100 % in Zehnerschritten) und Loop.
Beim Abspielen folgt die Ansicht dem Cursor, und der Bildschirm bleibt an (für das Smartphone am Notenständer).

Hat der Song eine `audio.mp3`, läuft sie gleichzeitig mit dem Synth (`js/mixer.js`). alphaTab kann beides nicht
zusammen abspielen, deshalb spielt ein eigenes `<audio>`-Element die Spur und folgt der Position des Synths: Die
Sync-Punkte in den Noten rechnen sie in Audio-Zeit um. Der Synth folgt dem Tempo der Aufnahme je Abschnitt zwischen
zwei Sync-Punkten: Beim Erzeugen des MIDI (Ereignis `midiLoad` von alphaTab) ersetzt der Player die notierten
Tempoangaben durch das Tempo der Aufnahme (`applyRecordingTempo()` in `js/score.js`). Beim langsameren Tempo läuft
auch die Audiospur langsamer, ohne dass sich die Tonhöhe ändert. Ohne Sync-Punkte bleibt die Audiospur stumm.

**Gegen Haken und Ruckeln** (Oktober 2026). Die Wiedergabe hakte und ruckelte bei allen Songs mit Audiospur. Gemessen
wurde an "Geiler is schon" und "Nussschüsselblues", es gab drei Ursachen:

1. **Abspielrate der Audiospur ständig geändert:** Der Mixer führte die Audiospur stufenlos nach. Die gemessene
   Abweichung schwankt um einige Millisekunden, also kam fast bei jeder Messung eine neue Rate heraus (462 Änderungen
   in 30 s). Bei jeder Änderung stellt der Browser seine Tonhöhenkorrektur neu ein, das ist hörbar.
2. **Tempo des Synths an jedem Sync-Punkt umgestellt:** Der Synth folgte der Aufnahme über das Abspieltempo von
   alphaTab (`playbackSpeed`), meist um 1 bis 2 %. Jede Umstellung setzt den Synth in alphaTab neu an die Position,
   dabei werden klingende Töne abgeschnitten. alphaTab meldet das außerdem als Spulen, und der Mixer hat die Audiospur
   daraufhin angehalten und neu angesetzt.
3. **Ungenaues Tempo je Abschnitt:** alphaTab berechnet das Tempo der Aufnahme je Abschnitt leicht ungenau. Bei "Geiler
   is schon" kam der Synth 13 ms zu spät am nächsten Sync-Punkt an, die Audiospur sprang dort.

Maßnahmen:

- **Tempo der Aufnahme im MIDI:** Das Abspieltempo von alphaTab bleibt während der Wiedergabe gleich, der Synth folgt
  der Aufnahme über die Tempoangaben im MIDI. Nur wenn Sync-Punkte im Sync-Editor während der Wiedergabe geändert
  werden, gleicht das Abspieltempo aus (ab 3 % Unterschied, kleinere Unterschiede holt die Audiospur auf). Das MIDI wird
  neu erzeugt, sobald die Wiedergabe anhält, im Stand sofort.
- **Tempo aus den Sync-Punkten:** Das Tempo je Abschnitt ergibt sich aus Ticks und Zeit bis zum nächsten Sync-Punkt
  (`playbackSyncPoints()` in `js/score.js`). Synth und Audiospur kommen so gleichzeitig am Sync-Punkt an.
- **Seltene Korrektur der Audiospur:** Gemessen wird höchstens alle 25 ms, geglättet über 500 ms. Ab 40 ms Abweichung
  läuft die Audiospur fest 4 % schneller oder langsamer, bis die Abweichung unter 10 ms liegt. Ab 300 ms springt sie.
- **Kein unnötiges Neuansetzen:** Meldet alphaTab ein Spulen, die Audiospur liegt aber richtig, läuft sie weiter.
- **Verzögerung beim Start:** Die Audiospur läuft nach `play()` einige Dutzend Millisekunden verspätet los. Der Mixer
  misst das beim Start und setzt sie beim nächsten Start um so viel weiter hinten an.

Ergebnis beim Nussschüsselblues (Tempo der Aufnahme schwankt je Abschnitt um bis zu 7 %): Über 32 s und 8 Sync-Punkte
änderte sich weder das Abspieltempo des Synths noch die Rate der Audiospur. Die Abweichung blieb konstant bei −29 ms
(±1 ms).

Passt das notierte Tempo nicht zur Aufnahme, steht in der Kopfzeile dahinter rot das Tempo der Audiospur, z. B.
"105 BPM (⚠ Audio: 211 BPM)". Verglichen wird die notierte Dauer (mit allen Tempowechseln) mit der Dauer in der
Aufnahme, jeweils vom ersten bis zum letzten Sync-Punkt (`recordingTempoFactor()` in `js/score.js`); das Ergebnis
wird auf eine ganze Zahl gerundet. Markiert ist jeder Song, bei dem ein anderes ganzzahliges Tempo besser passt, also
auch kleine Abweichungen. Korrigiert wird im Sync-Editor ("Tempo … → … BPM").

Liegt der letzte Sync-Punkt hinter dem Ende der Audiospur, folgt in der Kopfzeile rot "(⚠ Sync-Punkte passen nicht zur
Audiospur)", sobald die Audiospur geladen ist (`isSyncOutsideAudio()` in `js/score.js`). Das passiert z. B. nach dem
Wechsel auf einen kürzeren Clip. Ein negativer erster Sync-Punkt ist gewollt (Takt 1 beginnt vor der Aufnahme).

Titel und Interpret setzt der Player aus `song.json` ein, Tonart, Capo, Stimmung und Tempo liest er aus den Noten
und zeigt sie in der Kopfzeile, z. B. "Tonart Bbm · Capo 1 (Griffe Am)". Die Tonart (`\ks`) ist die klingende: Wie
Guitar Pro notiert alphaTab mit Capo klingend, jeder Bund hebt die Saiten um einen Halbton. Die Tonart der Griffe
liegt um so viele Halbtöne tiefer, wie der Capo Bünde hat (`shapeKey()` in `js/score.js`). Wer nachträglich einen
Capo setzt (z. B. weil die Aufnahme höher klingt als notiert), muss auch `\ks` mit anheben.

Das Zahnrad öffnet die Einstellungen:

- **Spuren**: welche Spuren angezeigt werden (je Song gemerkt), dazu stumm (M) und solo (S). Hat der Song eine
  `audio.mp3`, steht dort auch die Audiospur mit M und S (anzeigen lässt sie sich nicht, sie hat keine Noten). Solo
  auf der Audiospur lässt die Spuren des Synths schweigen, Solo auf einer Synth-Spur die Audiospur; das Metronom
  bleibt hörbar.
- **Üben**: Metronom und Vorzähler
- **Loop-Bereich**: von Takt bis Takt, oder im Notenblatt über die Takte ziehen
- **Lautstärke**: Synth, Audiospur und Metronom (auch für den Vorzähler) mit eigenen Reglern untereinander. Ein
  Audio-Versatz aus der Zeit vor dem Sync-Editor wirkt weiter und wird hier genannt, bis er im Sync-Editor in die
  Sync-Punkte übernommen ist.
- **Darstellung**: Noten + Tabs, nur Tabs oder nur Noten (gilt für alle Spuren); Größe. Was GP je Spur gespeichert
  hatte (39 der 75 Spuren auf "nur Tabs", bei "Noten + Tabs" fehlten deshalb die Noten), steht seit 29.10.2026
  nicht mehr in den Noten und zählt auch beim Import nicht.

Die Einstellungen (außer den Spuren) gelten für alle Songs und werden im Browser gemerkt.

### Sync-Editor

Die Sync-Punkte (`\sync` in `score.atex`) ordnen Takte der Noten Stellen in der Audiospur zu. Bei importierten
GP-Dateien übernimmt alphaTab sie beim Umwandeln. Bei YouTube-Audio und nach dem Wechsel auf einen anderen Clip
werden sie im Sync-Editor gesetzt bzw. nachgezogen (`js/sync-editor.js`, Vorbild ist der "Media Sync Editor" im
alphaTab-Playground). Er öffnet sich über das Menü der Songansicht, wenn der Song eine `audio.mp3` hat, und liegt fest
über der Abspielleiste. Noten, Cursor und Wiedergabe bleiben dabei bedienbar.

- **Wellenform** der Audiospur mit einem Marker je Sync-Punkt, beschriftet mit der Taktnummer (dazu "+ 50 %" für eine
  Stelle mitten im Takt, "⇥" für das Taktende und "(2.)" für die zweite Wiederholung). Die rote Linie ist die
  Wiedergabeposition; beim Abspielen blättert die Ansicht mit.
- **Marker ziehen**, oder anklicken und mit den Pfeiltasten verschieben (10 ms, mit Umschalt 1 ms). Ein Marker bleibt
  immer zwischen seinen Nachbarn. Entf löscht ihn, ein Klick daneben springt an diese Stelle der Aufnahme.
- **Anfang erkennen:** Setzt den ersten Sync-Punkt auf die erste Note (im ersten Takt mit Noten, bei Pausen am
  Taktanfang also mitten im Takt) und dorthin, wo die Aufnahme hörbar wird (−30 dB unter dem lautesten Stück).
  Punkte davor fallen weg. Danach bietet der Editor an, die übrigen Punkte um dieselbe Zeit zu verschieben, etwa
  nach dem Wechsel auf einen anders geschnittenen Clip. Das Ergebnis ist ein Vorschlag: Beginnt die Aufnahme mit
  Sprechen oder Geräuschen, liegt er zu früh (getestet an 23 Songs: etwa die Hälfte auf ±100 ms genau, sonst bis zu
  8 s daneben).
- **Ende erkennen:** Setzt den letzten Sync-Punkt an das Ende des letzten Takts mit Noten (in seiner letzten
  Wiederholung), dorthin, wo die Aufnahme verklingt. Punkte dahinter fallen weg.
- **+ Punkt:** Setzt einen Sync-Punkt an den Anfang des Takts, in dem der Wellenform-Cursor (rote Linie) steht, an
  die Stelle, die ihm schon entspricht. Danach lässt er sich an die richtige Stelle ziehen.
- **ms verschieben:** Verschiebt alle Sync-Punkte um eine feste Zeit (negativ: Audiospur früher).
- **Tempo … → … BPM** erscheint, wenn das notierte Tempo nicht zur Aufnahme passt (siehe Kopfzeile). Der Button
  multipliziert alle Tempoangaben mit dem gemessenen Faktor (`recordingTempoFactor()` in `js/score.js`), damit
  Tempowechsel im Verhältnis bleiben, gerundet auf ganze BPM. Die Sync-Punkte bleiben unverändert.
- **Rückgängig** (auch Strg+Z) für jede Änderung bis zum Speichern; Mausrad verschiebt den Ausschnitt, Strg+Mausrad
  bzw. − und + zoomen (5 s bis ganze Aufnahme; beim Öffnen die ganze).
- Ein **Audio-Versatz** aus der Zeit vor dem Sync-Editor (früher im Einstellungsfeld des Players) lässt sich mit
  einem Klick in die Sync-Punkte übernehmen; nach dem Speichern ist er im Player wieder 0.

Jede Änderung wirkt sofort auf die Wiedergabe. **Speichern** schreibt mit `PUT api/score.php` nur die Zeilen
`\sync (…)` (an der Stelle der bisherigen, sonst am Ende) und die Zahlen in den Zeilen `\tempo …`; alles andere in
`score.atex` bleibt Zeichen für Zeichen erhalten (`writeSyncAndTempo()` in `js/score.js`). Vorher wird das Ergebnis
eingelesen und mit dem Erwarteten verglichen. Den alphaTex-Exporter von alphaTab zu nehmen, kommt nicht in Frage: Er
schreibt nur 6 der 42 Songs unverändert zurück (siehe "Offene Punkte"). "Schließen" fragt bei ungespeicherten
Änderungen nach und setzt sie im Player zurück.

## Stand / Roadmap

- ✅ Projekt aus dem Kochbuch abgeleitet (gleiche Architektur: PHP/JSON-API ohne Datenbank, statisches Frontend)
- ✅ Song-Datenmodell (Titel, Interpret, Spieltechnik, Genres, Notizen, Quellen-URLs, weitere Angaben aus der GP-Datei)
- ✅ JSON-API (CRUD, Import, Auslieferung von Noten, Audiospur und Cover)
- ✅ Übersicht als Kacheln mit Suche, Genre-Filter und Sortierung
- ✅ Import von GP3 bis GP8 per Drag & Drop, Angaben aus der Datei übernommen
- ✅ Cover von Deezer bzw. iTunes, auswählbar, eigenes Bild möglich
- ✅ Notenansicht und Wiedergabe mit alphaTab (Tempo, Loop, Spuren, Metronom, Vorzähler, Darstellung)
- ✅ Prototyp für Synth und Audiospur im Gleichlauf (26.10.2026, aufgegangen in `js/mixer.js`)
- ✅ Audiospur einer GP8-Datei beim Import herauslösen (`audio.mp3`, Sync-Punkte in den Noten)
- ✅ Akkorddateien (ChordPro, Text) im Formular als Rohmaterial hochladen
- ✅ Noten intern als alphaTex, GP-Import mit Prüfung, GP-Export mit Audiospur
- ✅ "+ Neuer Song" mit Import oder "Manuell" (erzeugt ein Gerüst, jeder Song hat Noten)
- ✅ `bin/audio.php`: YouTube → `audio.mp3`, Upload auf den Server über `api/audio.php`, portables Paket
- ✅ Mixer für Synth und Audiospur (`js/mixer.js`), Kennzeichnung eines Tempos, das nicht zur Audiospur passt, und
  von Sync-Punkten außerhalb der Audiospur
- ✅ Sync-Editor (28.10.2026): Wellenform, verschiebbare Marker, Anfang und Ende erkennen, alle verschieben, Tempo
  an die Aufnahme anpassen, Speichern der Sync-Punkte und Tempi (`PUT api/score.php`)
- ✅ Haken und Ruckeln der Wiedergabe behoben (28.10.2026, siehe "Notenansicht und Wiedergabe")
- ✅ Tonart mit Capo (28.10.2026): `\ks` ist die klingende Tonart, die Kopfzeile rechnete umgekehrt ("Junge" zeigte
  "Griffe Bbm" statt Am); `\ks` der vier Songs mit nachträglich gesetztem Capo angehoben
- ✅ Akkordbibliothek und Griffbilder (29.10.2026): `data/chords.json`, Seite "Griffbilder" zum Drucken, je Spur
  und Akkord ein Griffbild, Rhythmus-Schrägstriche und Anzeige-Angaben entfernt, auch automatisch beim Import;
  Vorzeichen von drei Songs korrigiert, Tonart aus den Stimmungsnamen entfernt (siehe "Akkorde und Griffbilder")
- ❌ Editor für Text und Akkorde samt Aufbereitung: Song-Modell, Ansicht Text & Akkorde, Speichern der ganzen
  Noten, Einarbeiten von Akkorddateien (Grundsatz 3), eingefügter Text, Vorschläge beim Nachreichen von Material,
  Export als `.cho`
  - TODO: Drag-&-Drop-Feld "Akkorddatei" aus dem Formular "Song bearbeiten" in den Editor verschieben
- ❌ DIN-A4-Seite zum Spielen am Lagerfeuer: Kennzeichen "gängig" in der Akkordbibliothek, `leadsheet.json`,
  Muster, SVG-Bausteine, A4-Fit-Loop (Zielstil: die handgebauten Seiten in `data/archiv/Leadsheets/`)
- ❌ Editor für Noten und Tabs
- ⏸ Range-Support in `api/audio.php`, damit der Mixer die MP3 streamen kann, statt sie ganz zu laden (zurückgestellt,
  bis die Ladezeit stört)
- ❌ KI-Funktionen: Fingerstyle- oder Anfängerfassung (Spur als alphaTex hinein, neue Spur als alphaTex heraus),
  Akkorde aus der Aufnahme bestimmen (über die Sync-Punkte in Takte umgerechnet)

Was beim Übernehmen des Archivs noch nachzuliefern oder zu prüfen ist, steht in `docs/nachlieferung.md`.

## Planung der offenen Phasen

Übernommen aus dem früheren Planungsdokument; was schon umgesetzt ist, steht in den Kapiteln oben.

### Geplante Dateien

```
 └── public/
      ├── api/
      │    └── leadsheet.php          # leadsheet.json lesen und schreiben
      ├── js/
      │    ├── editor/                # Editor für Text, Akkorde, Noten und Tabs
      │    │    ├── editor.js         # Rahmen: Ansichten, Laden, Speichern, Undo/Redo
      │    │    ├── model.js          # Gemeinsames Song-Modell (Score + Abschnitte, Zeilen, Silben, Akkorde, Muster)
      │    │    ├── lyrics-view.js    # Ansicht Text & Akkorde (Akkorde über Silben, verschiebbar)
      │    │    ├── score-view.js     # Ansicht Noten & Tabs (Bearbeitung auf alphaTab)
      │    │    └── patterns-view.js  # Schlag-/Picking-Muster, Tab-Verweise
      │    ├── import/                # Aufbereitung des Rohmaterials (im Browser)
      │    │    ├── align.js          # Text/Akkorde aus Akkordblatt oder Textdatei den Noten zuordnen
      │    │    ├── chordpro.js       # ChordPro lesen und schreiben
      │    │    ├── gp.js             # Noten → Teilmodell
      │    │    ├── merge.js          # Teilmodelle zusammenführen, unsichere Stellen markieren
      │    │    └── text.js           # Akkordblatt-Text (Akkorde über Text) → Teilmodell
      │    ├── leadsheet.js           # Leadsheet rendern + A4-Fit-Loop
      │    ├── svg.js                 # dazu Schlagmuster, Picking-Muster als SVG (Griffbild gibt es schon)
      ├── templates/leadsheet.html    # <template>-Bausteine für das Leadsheet
      └── print.css                   # Druck-Layout für das Leadsheet (@page A4)
```

API-Erweiterungen (`PUT api/score.php` gibt es schon, siehe Sync-Editor):

| Endpunkt                  | Methoden | Zweck                                                                         |
|---------------------------|----------|-------------------------------------------------------------------------------|
| `api/leadsheet.php?slug=` | GET, PUT | Druckinfos (Muster, Tab-Verweise, Layout)                                     |
| `api/chords.php`          | PUT      | Akkordbibliothek schreiben (GET gibt es schon)                                |

### Editor

Ein Editor für alles: **Text, Akkorde, Noten und Tabs** eines Lieds in einer Oberfläche.

**Ansichten** (umschaltbar oder nebeneinander):

- **Text & Akkorde:** Zeilen mit Akkorden über den Silben. Akkorde lassen sich per Drag & Drop verschieben und per
  Tastatur einfügen. Hier werden auch Abschnitte angelegt und Muster zugeordnet. Die Darstellung entspricht
  weitgehend dem späteren Leadsheet.
- **Noten & Tabs:** alphaTab-Darstellung mit Cursor. Bearbeitet werden Bünde, Dauer und Effekte, Takte lassen sich
  einfügen und löschen. alphaTab bringt keinen Editor mit, das ist der größte Eigenanteil.
- **Muster:** Schlag- und Picking-Muster sowie Tab-Verweise für Intro und Solo.

**Kopplung:** Silben und Akkorde hängen an Schlägen in den Noten. Ein Klick auf eine Silbe setzt den Cursor auf die
zugehörige Note und umgekehrt. Ein geänderter Akkord erscheint sofort in beiden Ansichten, und beim Abspielen läuft
die Markierung in beiden mit.

**Song-Modell (`model.js`):** Alle Ansichten arbeiten auf einem gemeinsamen Modell: der alphaTab-Score plus
Abschnitte, Zeilen, Silben, Akkorde, Muster und Tab-Verweise. Undo/Redo läuft auf Modellebene, also über alle
Ansichten hinweg.

**Laden:** Das Modell entsteht aus `score.atex` (Noten, Silben und Akkorde an den Schlägen, Abschnitte als Marker)
und `leadsheet.json` (Zeilenumbrüche, Art und Muster der Abschnitte).

- Zeilenumbrüche und Abschnittsdaten verweisen über Silbennummern (Abspielreihenfolge mit Wiederholungen) bzw. Takte
  auf die Noten. Fügt der Editor Takte ein oder löscht welche, zieht er diese Verweise nach (die Sync-Punkte in den
  Noten wandern selbst mit). Dafür braucht es keine eigene Zuordnungsdatei.
- Passt das nicht mehr, etwa weil sich die Noten geändert haben, markiert der Editor die betroffenen Stellen.

**Prüfen und Vorschläge:** Was der Import automatisch bereinigt (Griffbilder, siehe "Akkorde und Griffbilder"),
hält der Editor beim Bearbeiten aktuell. Dazu, jeweils als Vorschlag, den der Benutzer übernimmt oder nicht:

- **Tonart und Vorzeichen** aus `detectKeySignature()` vorschlagen, Kirchentonarten benennen (A-Mixolydisch in
  "Happy Xmas", E-Dorisch in "Drunken Sailor").
- **Auffällige Akkorde markieren**, die nicht zur Tonart passen (leiterfremd, unlesbarer Name).
- **Griffbilder:** einen anderen Griff aus der Bibliothek wählen oder einen neuen in die Bibliothek aufnehmen
  (`PUT api/chords.php`).

**Speichern:** Alles wird aus dem Modell neu geschrieben, `orig/` bleibt immer unberührt.

- `score.atex`: Noten, Tabs, Liedtext und Akkordsymbole an den Schlägen, Abschnitte als Marker, Sync-Punkte, mit
  `PUT api/score.php`. Der alphaTex-Exporter von alphaTab taugt dafür erst, wenn er verlustfrei schreibt (siehe
  "Offene Punkte").
- `leadsheet.json`: mit `PUT api/leadsheet.php`, inklusive Zeilenumbrüchen und Abschnittsdaten

**Manuell angelegte Songs** haben ein erzeugtes Gerüst, anfangs mit leeren Takten. Text und Akkorde aus einer
Akkorddatei werden auch dort den Takten zugeordnet, bestmöglich verteilt (z. B. ein Akkordwechsel je Takt), bis
Noten dazukommen.

### Aufbereitung des Rohmaterials

| Quelle                                     | Liefert                                                               |
|--------------------------------------------|-----------------------------------------------------------------------|
| GP-Datei (Import)                          | Noten, Tabs, Tempo, Marker, ggf. Liedtext, Akkordsymbole, Griffbilder |
| ChordPro- oder Textdatei, eingefügter Text | Text, ggf. Akkorde und Abschnitte                                     |
| YouTube (`bin/audio.php`)                  | Audio                                                                 |

**Aufbereitung** (`js/import/`), im Browser, weil dort alphaTab die Noten liest:

1. Jede Quelle wird in ein Teilmodell übersetzt (`gp.js`, `text.js`, `chordpro.js`).
2. `merge.js` führt die Teilmodelle zusammen, nach dieser Priorität:
   - **Noten:** nur aus GP bzw. den vorhandenen Noten
   - **Text:** GP-Liedtext vor Akkord- bzw. Textdatei
   - **Akkorde:** GP-Akkordsymbole vor Akkorddatei. Aus den Noten erkannte Akkorde gibt es nur als Vorschlag, weil
     das nicht eindeutig ist.
   - **Abschnitte:** Abschnittsnamen aus der Akkorddatei vor GP-Markern
3. `align.js` ordnet Text und Akkorde aus Akkordblatt oder Textdatei den Noten zu, per Wortvergleich mit dem
   GP-Liedtext oder, wenn der fehlt, per Verteilung über die Takte.
4. **Unsichere Stellen** werden im Editor farbig markiert: Zuordnungen, erkannte Akkorde, Zeilenumbrüche nach
   Heuristik.
5. Das Ergebnis öffnet sich im Editor. Erst beim Speichern werden `score.atex` und `leadsheet.json` geschrieben.

**Material nachreichen:** Kommt später eine weitere Quelle dazu, läuft die Aufbereitung erneut. Der Editor zeigt die
Ergebnisse dann als **Vorschläge** pro Abschnitt zum Übernehmen oder Verwerfen, statt bereits Bearbeitetes zu
überschreiben.

**Serverseitig** wird das Rohmaterial nur unter `orig/` abgelegt. Dazu kommt **eingefügter Text**: Akkordblatt oder
Liedtext per Zwischenablage statt als Datei (bisher nur Datei-Upload über `api/lyrics.php`).

### Format ChordPro (Export und Akkorddateien)

ChordPro ([chordpro.org](https://www.chordpro.org)) ist das **Exportformat** für Text, Akkorde und Abschnitte und das
Format, in dem Akkorddateien hochgeladen werden. Gespeichert wird kein `song.cho`: Beim Export entsteht die Datei aus
`score.atex`, `leadsheet.json` und den Angaben in `song.json`. So sieht sie aus:

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

{chorus: Refrain (2×)}

{start_of_grid: label="Outro" id="outro"}
| Am . . . | F . . . | C . . . | G . . . |
{end_of_grid}
```

- **Abschnitte** über die ChordPro-Direktiven `start_of_verse`, `start_of_chorus`, `start_of_tab`, `start_of_grid`
  mit `label`. Das Attribut `id` ist eine eigene Ergänzung und verknüpft den Abschnitt mit `leadsheet.json`.
- **`{chorus}`** wiederholt den letzten Refrain nur als Verweis. Das ist Standard-ChordPro und spart Platz.
- **`{define}`** enthält nur Griffe, die von `data/chords.json` abweichen oder dort fehlen.
- **`{x_pattern}`** ordnet einem Abschnitt ein Begleitmuster aus `leadsheet.json` zu. Eigene Direktiven beginnen
  laut ChordPro-Standard mit `x_` und werden von anderen Programmen ignoriert.
- **Tab-Abschnitte** bleiben leer, wenn die Takte aus den Noten kommen (Verweis in `leadsheet.json`). Ein von Hand
  geschriebener ASCII-Tab darf aber auch direkt drinstehen.
- **Keine Metadaten-Direktiven** (`{title}`, `{capo}` …) im Modell; beim Export einer `.cho`-Datei werden sie aus
  `song.json` und den Noten ergänzt.
- Unterstützt werden nur die genutzten Direktiven, keine vollständige ChordPro-Implementierung.

### DIN-A4-Seite (Leadsheet)

Das Leadsheet ist kein stumpfer Notenausdruck, sondern ein aufbereitetes Blatt für Solo-Gitarre und Gesang,
möglichst auf **einer DIN-A4-Seite**, zum Spielen **am Lagerfeuer**: unterhaltsam und gut spielbar, nicht
musikalisch ausgefeilt.

**Vorbild** sind die 33 handgebauten Seiten in `data/archiv/Leadsheets` (`_Vorlage.txt`, Consolas 9 pt, 74 Zeilen ×
103 Spalten): Kopf "Titel by Künstler" mit Capo, Tonart (auch "C (orig: D)"), Tempo und Taktart; Strumming- und
Picking-Muster mit Zählzeile; Akkordtabelle `E A D G B e`; Abschnitte in eckigen Klammern; Akkorde mit `|` am
Taktanfang über dem Text; `-/-` für einen wiederholten Abschnitt, `|: … :| x4`; Randnotizen.

**Inhalt:**

- Kopfzeile mit Titel, Interpret, Tonart, Capo, Stimmung, Tempo und Taktart.
- **Akkorde über dem Text**, an der richtigen Silbe. Gespeichert an den Schlägen in den Noten, gerendert als
  Inline-Block über der Silbe.
- **Akkorddiagramme nur für seltene Akkorde.** Gängige Griffe sind in `data/chords.json` als bekannt markiert und
  werden ausgeblendet. Die Liste muss einmal erstbefüllt werden.
- **Strumming:** Pfeile ↓ ↑ auf einem Zählraster ("1 + 2 + …"), mit Pausen (·), Akzenten (>) und Chucks (×).
  Gespeichert als String, zum Beispiel `D.DU.UDU`.
- **Fingerpicking:** Daumen p und Finger i, m, a über einem kleinen Tab-Raster, **relativ zum Akkord** notiert. `B`
  ist der Grundton-Bass, `B2` der Wechselbass, `1`–`6` sind feste Saiten. Dadurch gilt ein Muster für alle Akkorde.
  Für Sonderfälle ist ein echter Tab als alphaTex möglich.
- **Tabs für Intro und Solo:** Taktbereich aus den Noten (alphaTab rendert nur diese Takte, nur Tab-Zeile,
  verkleinert) oder ein eigener alphaTex-Schnipsel.
- Wiederholte Abschnitte erscheinen nur als Verweis ("Refrain (2×)").

**Technik:**

- `templates/leadsheet.html` enthält die `<template>`-Bausteine: Kopf, Akkorddiagramm, Schlagmuster,
  Picking-Muster, Abschnitt, Tab-Ausschnitt.
- `print.css` setzt `@page { size: A4 }`, Spalten und die Schriftgröße über CSS-Variablen.
- `svg.js` erzeugt Diagramme und Muster als SVG, ohne zusätzliche Bibliothek.
- Der **A4-Fit-Loop** in `leadsheet.js`:
  1. Rendern mit Maximalgröße in einer Spalte.
  2. Passt es nicht, wird die Schriftgröße in 0,5-pt-Schritten bis zum Minimum verkleinert.
  3. Passt es dann immer noch nicht: zwei Spalten und wieder ab Maximalgröße verkleinern.
  4. Passt es noch immer nicht: Wiederholungen einklappen und Diagramme verkleinern. Am Ende steht ein Hinweis statt
     eines unleserlichen Ausdrucks.

**Datenquellen:** Das Leadsheet liest das Modell des Editors (aus `score.atex`) und `leadsheet.json`.

**Schema `leadsheet.json`** (Entwurf, wird mit dem Editor festgelegt). Es enthält, was die Noten nicht abbilden:
Begleitmuster, Tab-Verweise, Layout, dazu Art, `id` und Muster der Abschnitte sowie die Zeilenumbrüche des Texts.

```json
{
  "version": 1,
  "notes": "Strophe gedämpft, Refrain voll",
  "sections": {
    "5":  { "id": "r1", "type": "chorus", "pattern": "refrain" },
    "13": { "id": "s1", "type": "verse",  "pattern": "strophe" }
  },
  "lineBreaks": [8, 17, 25],
  "patterns": {
    "strophe": {
      "technique": "fingerpicking", "grid": "8", "steps": "B 3 B2 2 B 3 B2 2", "fingers": "p i p m p i p m"
    },
    "refrain": { "technique": "strumming", "grid": "8", "strokes": "D.DU.UDU", "accents": [0, 4] }
  },
  "tabs": {
    "intro": { "source": "score", "track": 0, "startBar": 1, "barCount": 4 },
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

- `sections` ist nach dem Takt (Masterbar-Index) des Markers geordnet, `lineBreaks` sind Silbennummern in
  Abspielreihenfolge, vor denen eine neue Zeile beginnt.
- Die Schlüssel in `tabs` sind die `id`s der Tab-Abschnitte in `sections`.
- `diagrams`: `"rare"` zeigt nur Akkorde, die nicht als gängig markiert sind, `"all"` zeigt alle, `"none"` keine.
- Wird ein Abschnitt umbenannt oder gelöscht, hält der Editor `tabs` und Musterzuordnungen konsistent und meldet
  Muster, die niemand nutzt.

### Offene Punkte / zu prüfen

- Erstbefüllung der Liste "gängige Akkorde" in `data/chords.json`
- Akkorddatei einarbeiten: Akkordfolge der Datei mit der Akkordfolge in den Noten abgleichen; Text ohne passende Noten
  auf eine Text- oder Slash-Spur legen
- Silbenzählung in Abspielreihenfolge bei Wiederholungen, Sprüngen (D.S., Coda) und mehreren Liedtextzeilen
- Qualität der automatischen Zuordnung in `align.js` an echten Beispielen
- Mixer auf dem Smartphone, Ausgabe-Latenz des Synths
- Der alphaTex-Exporter schreibt nur 6 der 42 Songs unverändert zurück (u. a. zusätzliche `\scale`-Angaben)
- Klang: Der mitgelieferte SoundFont (Sonivox, rund 1 MB) klingt eher nach Computer; bessere sind 30–150 MB groß
- alphaTab-Updates: Die alphaTex-Syntax kann sich ändern. Vor einem Update alle Songs mit der alten Version laden und
  mit der neuen speichern.

### Rechtliche Hinweise

- **YouTube:** Die Kopien sind nur für den privaten Gebrauch bestimmt (§53 UrhG) und werden nicht weitergegeben oder
  öffentlich zugänglich gemacht. Basic Auth schützt die Audiodateien. Die Nutzungsbedingungen von YouTube schließen
  Downloads aus.
- **Ultimate Guitar:** GP-Dateien werden einzeln und manuell mit dem eigenen Pro-Abo für den Eigenbedarf
  heruntergeladen, ohne Weitergabe.

### Quellen

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

Unter `public/vendor/alphatab/` liegen unverändert:

| Bestandteil                                         | Lizenz                    | Lizenzdatei                  |
|-----------------------------------------------------|---------------------------|------------------------------|
| alphaTab 1.8.4 (Daniel Kuschny u. a.)               | MPL-2.0                   | `LICENSE`, Kopf jeder `.mjs` |
| TinySoundFont, SFZero u. a. (in alphaTab enthalten) | MIT                       | Kopf von `alphaTab.mjs`      |
| Notenschrift Bravura (Steinberg)                    | SIL Open Font License 1.1 | `font/Bravura-OFL.txt`       |
| SoundFont Sonivox (Sonic Network)                   | Apache 2.0                | `soundfont/LICENSE`          |

Alle vier Lizenzen sind mit der GPL-3.0 vereinbar: Die MPL-2.0 erlaubt die Verbindung mit der GPL ausdrücklich
(alphaTab trägt nicht den Vermerk "Incompatible With Secondary Licenses"), MIT und Apache 2.0 lassen sich in
GPL-3.0-Software übernehmen, und die Schrift liegt als eigene Datei neben dem Programm. Die Fremdbestandteile
behalten ihre eigene Lizenz; die Lizenzdateien müssen beim Weitergeben dabeibleiben.

Die Cover gehören den jeweiligen Rechteinhabern und werden nur für die private Übersicht geladen.
