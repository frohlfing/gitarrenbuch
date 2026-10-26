<?php

/**
 * Transliteriert Umlaute/Akzente, kleinschreibt und ersetzt alles Nicht-a-z0-9 durch Bindestriche.
 *
 * @param string $title beliebiger Text, z. B. "Cat Stevens Father and Son"
 * @return string Slug, z. B. "cat-stevens-father-and-son" (leer, wenn nichts Verwertbares übrig bleibt)
 */
function slugify(string $title): string
{
    $map = [
        'ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'Ä' => 'Ae', 'Ö' => 'Oe', 'Ü' => 'Ue', 'ß' => 'ss',
        'é' => 'e', 'è' => 'e', 'ê' => 'e', 'à' => 'a', 'â' => 'a', 'ô' => 'o', 'î' => 'i', 'ç' => 'c', 'ñ' => 'n',
    ];
    $s = strtr(trim($title), $map);
    $s = strtolower($s);
    $s = preg_replace('/[^a-z0-9]+/', '-', $s);
    return trim($s, '-');
}

/**
 * Liefert einen im SONGS_DIR eindeutigen Slug. Hängt bei Kollision -2, -3, ... an.
 *
 * @param string $baseSlug gewünschter Slug
 * @param string|null $excludeSlug wird ignoriert (nötig beim Rename, wenn der alte Ordner noch existiert)
 * @return string freier Slug
 */
function unique_slug(string $baseSlug, ?string $excludeSlug = null): string
{
    $slug = $baseSlug;
    $n = 2;
    while (is_dir(SONGS_DIR . '/' . $slug) && $slug !== $excludeSlug) {
        $slug = $baseSlug . '-' . $n;
        $n++;
    }
    return $slug;
}

/**
 * Prüft, ob $slug als Ordnername taugt (verhindert Pfad-Tricks wie "../" in Query-Parametern).
 *
 * @param string $slug zu prüfender Slug
 * @return bool true, wenn gültig
 */
function is_valid_slug(string $slug): bool
{
    return preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug) === 1;
}
