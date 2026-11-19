<?php
/**
 * CSW-Arcade - Proxy de streaming ROMs pour Hostinger (PHP)
 * Permet de contourner les limitations CORS et de streamer les ROMs volumineuses sans blocage mémoire.
 */

// En-têtes CORS universels
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, HEAD, OPTIONS");
header("Access-Control-Allow-Headers: *");
header("Access-Control-Expose-Headers: Content-Length, Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$file = isset($_GET['file']) ? trim($_GET['file']) : '';
$customUrl = isset($_GET['url']) ? trim($_GET['url']) : '';

if (empty($file) && empty($customUrl)) {
    http_response_code(400);
    header("Content-Type: application/json");
    echo json_encode(['error' => 'Paramètre file ou url requis']);
    exit;
}

// 1. Vérifier si la ROM existe localement dans public_html/roms/
if (!empty($file)) {
    $cleanName = basename($file);
    if (!preg_match('/\.zip$/i', $cleanName)) {
        $cleanName .= '.zip';
    }
    $localPath = __DIR__ . '/../roms/' . $cleanName;
    if (file_exists($localPath)) {
        header("Content-Type: application/zip");
        header("Content-Length: " . filesize($localPath));
        header("Cache-Control: public, max-age=31536000, immutable");
        if ($_SERVER['REQUEST_METHOD'] !== 'HEAD') {
            readfile($localPath);
        }
        exit;
    }
}

// 2. Miroirs Archive.org
$candidateUrls = [];
if (!empty($customUrl)) {
    $candidateUrls[] = $customUrl;
}
if (!empty($file)) {
    $zipName = strtolower(basename($file));
    if (!preg_match('/\.zip$/i', $zipName)) {
        $zipName .= '.zip';
    }
    $candidateUrls[] = "https://archive.org/download/neo-geo-mvs-romset/" . urlencode($zipName);
    $candidateUrls[] = "https://archive.org/download/fbnarcade-fullset/" . urlencode($zipName);
    $candidateUrls[] = "https://archive.org/download/NeoGeoRomCollectionByGhostware/" . urlencode($zipName);
    $candidateUrls[] = "https://archive.org/download/mame-merged/" . urlencode($zipName);
}

foreach ($candidateUrls as $url) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CSW-Arcade');
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_TIMEOUT, 300);

    if ($_SERVER['REQUEST_METHOD'] === 'HEAD') {
        curl_setopt($ch, CURLOPT_NOBODY, true);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $contentLength = curl_getinfo($ch, CURLINFO_CONTENT_LENGTH_DOWNLOAD);
        curl_close($ch);

        if ($httpCode >= 200 && $httpCode < 300) {
            header("Content-Type: application/zip");
            if ($contentLength > 0) {
                header("Content-Length: " . (int)$contentLength);
            }
            header("Cache-Control: public, max-age=31536000, immutable");
            http_response_code(200);
            exit;
        }
        continue;
    }

    // Streaming direct vers le client
    header("Content-Type: application/zip");
    header("Cache-Control: public, max-age=31536000, immutable");

    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function($curl, $header) {
        $len = strlen($header);
        $headerLower = strtolower($header);
        if (strpos($headerLower, 'content-length:') === 0) {
            header($header);
        }
        return $len;
    });

    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($curl, $data) {
        echo $data;
        if (ob_get_level() > 0) {
            @ob_flush();
        }
        flush();
        return strlen($data);
    });

    $success = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($success && $httpCode >= 200 && $httpCode < 300) {
        exit;
    }
}

http_response_code(404);
header("Content-Type: application/json");
echo json_encode([
    'error' => 'ROM introuvable sur les serveurs distants',
    'file' => $file
]);
