<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\AppData;
use App\Core\DeviceBridge;

final class UserController extends BaseController
{
    public function index(): string
    {
        return $this->view('users/index', [
            'title' => 'User Fingerprint',
            'active' => 'users',
            'users' => AppData::fingerprintUsers($this->db),
            'devices' => AppData::devices($this->db),
            'saved' => request_value('saved', '') === '1',
            'message' => (string) request_value('message', ''),
            'error' => (string) request_value('error', ''),
        ]);
    }

    public function store(): string
    {
        $user = AppData::saveFingerprintUser($_POST, $this->db);
        $targets = $_POST['target_device_codes'] ?? [];
        $success = 0;
        $failed = 0;

        if (is_array($targets)) {
            foreach ($targets as $deviceCode) {
                $device = AppData::deviceByCode((string) $deviceCode, $this->db);
                if (!$device) {
                    $failed++;
                    continue;
                }

                $result = DeviceBridge::run('add-user', [
                    'host' => DeviceBridge::hostFor($device),
                    'port' => (int) ($device['port'] ?? 4370),
                    'uid' => $user['device_user_id'] ?: $user['employee_code'],
                    'employee_code' => $user['employee_code'],
                    'device_user_id' => $user['device_user_id'] ?: $user['employee_code'],
                    'full_name' => $user['full_name'],
                    'card_number' => (string) ($user['card_number'] ?? ''),
                    'privilege' => '0',
                ], 45);

                $message = (string) ($result['message'] ?? $result['error'] ?? (!empty($result['ok']) ? 'User dikirim ke mesin.' : 'Gagal kirim user.'));
                AppData::logDeviceAction((string) $device['device_code'], 'add-user', !empty($result['ok']), $message, $result, $this->db);
                if (!empty($result['ok'])) {
                    AppData::saveDeviceUserLocal((string) $device['device_code'], [
                        'uid' => $user['device_user_id'] ?: $user['employee_code'],
                        'employee_code' => $user['employee_code'],
                        'device_user_id' => $user['device_user_id'] ?: $user['employee_code'],
                        'full_name' => $user['full_name'],
                        'card_number' => (string) ($user['card_number'] ?? ''),
                        'privilege' => '0',
                    ], $this->db);
                    $success++;
                } else {
                    $failed++;
                }
            }
        }

        $message = $success || $failed
            ? 'User tersimpan. Sinkron mesin: ' . $success . ' sukses, ' . $failed . ' gagal.'
            : 'User tersimpan di database. Pilih mesin jika ingin langsung dikirim ke perangkat.';

        return $this->redirect('/users?saved=1&message=' . rawurlencode($message));
    }

    public function delete(): string
    {
        AppData::deleteFingerprintUser((string) request_value('employee_code', ''), $this->db);
        return $this->redirect('/users?message=' . rawurlencode('User master dinonaktifkan. Data user per mesin tidak ikut dihapus otomatis.'));
    }
}
