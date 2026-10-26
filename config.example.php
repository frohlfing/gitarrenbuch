<?php

// Vorlage für config.php

// Daten-Ordner. Der Zugriff läuft ausschließlich über die API.
const DATA_DIR = __DIR__ . '/data';

// Unterordner für Songs.
const SONGS_DIR = DATA_DIR . '/songs';

// Muss im Header X-API-Token mitgeschickt werden, wenn Daten geändert werden.
const API_TOKEN = 'CHANGE_ME';

// Zielmaße für automatisch generierte Thumbnails (Center-Crop, siehe api/lib/thumbnail.php)
const THUMB_WIDTH = 480;
const THUMB_HEIGHT = 360;

// Erlaubte Datei-Endung => erwarteter MIME-Type, geprüft beim Bild-Upload
const ALLOWED_IMAGE_TYPES = [
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
];

// Maximal erlaubte Upload-Größe eines Rezeptbilds in Bytes
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
