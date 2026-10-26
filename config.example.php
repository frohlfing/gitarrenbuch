<?php

// Vorlage für config.php

/**
 * Daten-Ordner. Der Zugriff läuft ausschließlich über die API.
 *
 * @var string Absoluter Pfad, ohne abschließenden Slash
 */
const DATA_DIR = __DIR__ . '/data';

/**
 * Unterordner für Songs.
 *
 * @var string Absoluter Pfad, ohne abschließenden Slash
 */
const SONGS_DIR = DATA_DIR . '/songs';

/**
 * Muss im Header X-API-Token mitgeschickt werden, wenn Daten geändert werden.
 *
 * @var string Geheimes Token
 */
const API_TOKEN = 'CHANGE_ME';

/**
 * Maximal erlaubte Upload-Größe einer Rohmaterial-Datei in Bytes (GP-Dateien mit eingebetteter Audiospur
 * sind schnell einige MB groß). upload_max_filesize und post_max_size in der php.ini müssen mindestens so groß sein.
 *
 * @var int Bytes
 */
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
