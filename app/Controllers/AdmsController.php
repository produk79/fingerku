<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\AppData;

final class AdmsController extends BaseController
{
    public function login(): string
    {
        $serial = trim((string) (
            $_GET['sn']
            ?? $_GET['SN']
            ?? $_GET['SerialNumber']
            ?? $_POST['sn']
            ?? $_POST['SN']
            ?? $_POST['SerialNumber']
            ?? ''
        ));
        $remoteIp = trim(str_replace('::ffff:', '', (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '')));
        $payload = json_encode([
            'query' => $_GET,
            'post' => $_POST,
            'raw' => file_get_contents('php://input') ?: '',
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        AppData::recordAdmsRequest(
            $serial,
            $remoteIp,
            (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'),
            (string) ($_SERVER['REQUEST_URI'] ?? '/csl/login'),
            (string) $payload,
            $this->db
        );

        header('Content-Type: text/plain; charset=utf-8');
        return 'OK';
    }
}
