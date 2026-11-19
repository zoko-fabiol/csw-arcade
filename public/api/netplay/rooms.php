<?php
/**
 * CSW-Arcade - Gestion des salons Netplay multijoueur (PHP / Hostinger)
 * Enregistrement temporaire des salons dans un fichier JSON local avec purge automatique.
 */

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$storageFile = sys_get_temp_dir() . '/csw_arcade_rooms.json';

function getRooms($file) {
    if (!file_exists($file)) return [];
    $data = @json_decode(@file_get_contents($file), true);
    return is_array($data) ? $data : [];
}

function saveRooms($file, $rooms) {
    @file_put_contents($file, json_encode($rooms), LOCK_EX);
}

function purgeRooms(&$rooms) {
    $now = round(microtime(true) * 1000);
    foreach ($rooms as $code => $room) {
        $lastActive = $now - ($room['updatedAt'] ?? $room['createdAt'] ?? $now);
        $age = $now - ($room['createdAt'] ?? $now);
        if ($lastActive > 90000 || $age > 7200000 || (($room['gameState'] ?? '') === 'closed')) {
            unset($rooms[$code]);
        }
    }
}

$rooms = getRooms($storageFile);
purgeRooms($rooms);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $list = array_values($rooms);
    usort($list, function($a, $b) {
        return ($b['createdAt'] ?? 0) - ($a['createdAt'] ?? 0);
    });
    echo json_encode([
        'success' => true,
        'rooms' => $list,
        'timestamp' => round(microtime(true) * 1000)
    ]);
    saveRooms($storageFile, $rooms);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = file_get_contents('php://input');
    $body = json_decode($input, true) ?? [];
    $action = $body['action'] ?? 'create';

    if ($action === 'create' || $action === 'update') {
        $room = $body['room'] ?? null;
        if (!$room || empty($room['code'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Données de salon invalides']);
            exit;
        }
        $code = $room['code'];
        $room['createdAt'] = $room['createdAt'] ?? round(microtime(true) * 1000);
        $room['updatedAt'] = round(microtime(true) * 1000);
        $rooms[$code] = $room;
        saveRooms($storageFile, $rooms);
        echo json_encode(['success' => true, 'roomCode' => $code]);
        exit;
    }

    if ($action === 'heartbeat') {
        $code = $body['roomCode'] ?? null;
        if ($code && isset($rooms[$code])) {
            $rooms[$code]['updatedAt'] = round(microtime(true) * 1000);
            if (isset($body['players'])) $rooms[$code]['players'] = $body['players'];
            if (isset($body['currentPlayers'])) $rooms[$code]['currentPlayers'] = $body['currentPlayers'];
            saveRooms($storageFile, $rooms);
            echo json_encode(['success' => true, 'updated' => true]);
            exit;
        }
        echo json_encode(['success' => true, 'updated' => false]);
        exit;
    }

    if ($action === 'close') {
        $code = $body['roomCode'] ?? null;
        if ($code && isset($rooms[$code])) {
            unset($rooms[$code]);
            saveRooms($storageFile, $rooms);
        }
        echo json_encode(['success' => true, 'closed' => true]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Action non reconnue']);
    exit;
}
