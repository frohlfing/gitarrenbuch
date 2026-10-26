# Gitarrenbuch

## Voraussetzungen

- PHP 8.5+ mit aktivierter **GD**-Extension (für Thumbnails)
- Ein Webserver mit `public/` als Document Root
- Kein Datenbankserver nötig – alle Daten liegen als Dateien unter `data/`, bewusst außerhalb des Document Root
  (Zugriff nur über die API wie `api/songs.php`, nicht direkt per URL)

## Setup

1. `config.example.php` nach `config.php` kopieren (liegt im Projekt-Root, **nicht** unter `public/`, damit es
   außerhalb des Document Root und damit nicht direkt aufrufbar ist).

2. In `config.php` ein echtes `API_TOKEN` eintragen, z. B.:
   ```
   php -r "echo bin2hex(random_bytes(32));"
   ```
3. Webserver mit Document Root `public/` auf ein Verzeichnis zeigen lassen (z. B. XAMPP-vHost).

4. GD-Extension für PHP aktivieren. Zur Prüfung gibt es `public/dev/info.php` (ruft `phpinfo()` auf, im Browser
   aufrufen und nach "gd" suchen) – siehe auch Abschnitt "Admin-/Dev-Skripte" unter Projektstruktur.

   Unter XAMPP:
   - `C:\xampp\php\php.ini` öffnen und die Zeile `;extension=gd` zu `extension=gd` ändern.
   - Apache neu starten.

   Unter Hetzner-Webspace:
   - GD ist standardmäßig aktiviert. Falls nicht, kann dies per KonsoleH eingerichtet werden.

5. **HTTP Basic Auth einrichten** (schützt zusätzlich zum API-Token auch die statische `index.html` selbst – ohne
   diese Auth wäre die leere Seiten-Hülle trotz Token-Schutz der API weiterhin für jeden abrufbar):
   ```
   C:\xampp\apache\bin\htpasswd -bcB .htpasswd <benutzername> <passwort>
   ```
   Die `.htpasswd`-Datei liegt im Projekt-Root (außerhalb des Document Root, neben `config.php`). Danach
   `public/.htaccess.example` nach `public/.htaccess` kopieren und den `AuthUserFile`-Pfad auf den tatsächlichen
   absoluten Pfad zur `.htpasswd` auf diesem Server anpassen. Beide Dateien (`.htpasswd`, `public/.htaccess`) sind
   gitignored und müssen auf jedem Rechner/Server separat eingerichtet werden.

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

## Lizenz

Dieses Projekt steht unter der [GPL-3.0-Lizenz](LICENSE).

Das bedeutet: Du darfst diesen Code nutzen, ändern und verbreiten. Wenn du die Software (oder eine modifizierte
Version davon) jedoch weitergibst, musst du deinen Quellcode ebenfalls unter derselben Lizenz offenlegen.
