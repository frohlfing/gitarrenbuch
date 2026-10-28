@echo off
rem Stellt bin\audio.php als portables Paket für einen anderen Rechner zusammen: PHP-Minimum aus XAMPP (mit openssl
rem für HTTPS), yt-dlp und Deno, ffmpeg/ffprobe, bin\audio.php, public\api\lib (youtube_id() usw.) und start.cmd
rem (mit der Beschreibung des Aufrufs). Ohne config.php gibt man das API-Token beim Aufruf an (--api-token=…), die
rem Daten landen dann im Ordner data\ des Pakets.
rem
rem   bin\build_audio_portable.cmd D:\gitarrenbuch-audio [--with-config]
rem
rem   --with-config: zusätzlich eine config.php nur mit API_TOKEN und DATA_DIR (absoluter Pfad zum data-Ordner) aus
rem                  der eigenen, dann entfallen --api-token und --data beim Aufruf (das Paket enthält dann das Token:
rem                  nicht weitergeben)
rem
rem Nach Änderungen an bin\audio.php oder public\api\lib erneut ausführen (überschreibt alles im Ziel außer data\).
setlocal
chcp 65001 >nul
if "%~1"=="" (
    echo Aufruf: %~nx0 ^<Zielordner^> [--with-config]   z. B. %~nx0 D:\gitarrenbuch-audio
    exit /b 1
)
set "WITHCONFIG="
if /i "%~2"=="--with-config" set "WITHCONFIG=1"
if not "%~2"=="" if not defined WITHCONFIG (
    echo Unbekannte Option: %~2
    exit /b 1
)
set "DEST=%~1"
set "DEST=%DEST:/=\%"
if "%DEST:~-1%"=="\" set "DEST=%DEST:~0,-1%"
set "SRC=%~dp0.."
set "PHPSRC=C:\xampp\php"
set "FFSRC=C:\Program Files\ffmpeg\bin"
set "YTSRC=C:\Program Files\yt-dlp"

for %%d in ("php\ext" "ffmpeg" "yt-dlp" "bin" "public\api\lib") do (
    if not exist "%DEST%\%%~d" mkdir "%DEST%\%%~d" || goto :error
)
copy /y "%PHPSRC%\php.exe" "%DEST%\php\" >nul || goto :error
copy /y "%PHPSRC%\php8ts.dll" "%DEST%\php\" >nul || goto :error
copy /y "%PHPSRC%\libcrypto-3-x64.dll" "%DEST%\php\" >nul || goto :error
copy /y "%PHPSRC%\libssl-3-x64.dll" "%DEST%\php\" >nul || goto :error
copy /y "%PHPSRC%\ext\php_mbstring.dll" "%DEST%\php\ext\" >nul || goto :error
copy /y "%PHPSRC%\ext\php_openssl.dll" "%DEST%\php\ext\" >nul || goto :error
copy /y "%FFSRC%\ffmpeg.exe" "%DEST%\ffmpeg\" >nul || goto :error
copy /y "%FFSRC%\ffprobe.exe" "%DEST%\ffmpeg\" >nul || goto :error
copy /y "%YTSRC%\yt-dlp.exe" "%DEST%\yt-dlp\" >nul || goto :error
copy /y "%YTSRC%\deno.exe" "%DEST%\yt-dlp\" >nul || goto :error
copy /y "%SRC%\bin\audio.php" "%DEST%\bin\" >nul || goto :error
copy /y "%SRC%\public\api\lib\youtube.php" "%DEST%\public\api\lib\" >nul || goto :error
copy /y "%SRC%\public\api\lib\fetch.php" "%DEST%\public\api\lib\" >nul || goto :error

rem config.php nur auf Wunsch, und dann nur mit API_TOKEN und DATA_DIR (kein Basic-Auth-Passwort usw.); ohne: eine
rem alte aus einem früheren Lauf entfernen. DATA_DIR steht als absoluter Pfad drin (in der eigenen config.php ist er
rem relativ zu ihr angegeben).
if not defined WITHCONFIG (
    if exist "%DEST%\config.php" del "%DEST%\config.php" || goto :error
    goto :configdone
)
"%PHPSRC%\php.exe" -r "require $argv[1]; file_put_contents($argv[2], sprintf('<?php // nur für bin/audio.php (build_audio_portable.cmd)%%sconst API_TOKEN = %%s;%%sconst DATA_DIR = %%s;%%s', PHP_EOL, var_export(API_TOKEN, true), PHP_EOL, var_export(str_replace('\\', '/', realpath(DATA_DIR) ?: DATA_DIR), true), PHP_EOL));" "%SRC%\config.php" "%DEST%\config.php" || goto :error
:configdone

(
    echo ; Minimale Konfiguration nur für audio.php
    echo extension_dir = "ext"
    echo extension = mbstring
    echo extension = openssl
    echo memory_limit = 512M
    echo date.timezone = Europe/Berlin
) > "%DEST%\php\php.ini"

(
    echo @echo off
    echo rem Startet bin\audio.php mit PHP, yt-dlp, Deno und ffmpeg aus diesem Ordner, mit niedriger Priorität.
    echo rem Ohne Angaben: Hilfe mit allen Optionen. Abbruch mit Strg+C, erneuter Aufruf setzt fort.
    echo rem
    echo rem   start.cmd --password=... --api-token=... --dry-run
    echo rem   start.cmd --password=... --api-token=...
    echo rem   start.cmd --update   ^(yt-dlp aktualisieren, YouTube ändert sich häufig^)
    echo rem
    echo rem Weitere Optionen: --only=a,b ^(nur diese Slugs^), --data=DIR, --yes, --user=frank, --remote=https://...
    echo rem Passwort und Token auch als Umgebungsvariablen statt in der Befehlszeile:
    echo rem   set GITARRENBUCH_PASSWORD=...
    echo rem   set GITARRENBUCH_API_TOKEN=...
    echo rem Mit config.php in diesem Ordner ^(Paket mit --with-config gebaut^) entfallen --api-token und --data;
    echo rem ohne sie landen die Daten im Ordner data\ dieses Pakets.
    echo rem Braucht nur die "Microsoft Visual C++ Redistributable" ^(x64^); fehlt sie, meldet Windows vcruntime140.dll.
    echo setlocal
    echo set PATH=%%~dp0php;%%~dp0ffmpeg;%%~dp0yt-dlp;%%SystemRoot%%\system32;%%SystemRoot%%
    echo start "" /low /b /wait "%%~dp0php\php.exe" -c "%%~dp0php\php.ini" "%%~dp0bin\audio.php" %%*
    echo pause
) > "%DEST%\start.cmd"

echo Fertig: %DEST%
exit /b 0

:error
echo Fehler beim Zusammenstellen nach %DEST%
exit /b 1
