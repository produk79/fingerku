<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\AppData;
use App\Core\DeviceBridge;

final class DeviceController extends BaseController
{
    public function index(): string
    {
        return $this->view('devices/index', [
            'title' => 'Mesin Fingerprint',
            'active' => 'devices',
            'devices' => AppData::devices($this->db),
            'timezones' => AppData::timezoneOptions(),
            'saved' => request_value('saved', '') === '1',
            'message' => (string) request_value('message', ''),
            'error' => (string) request_value('error', ''),
        ]);
    }

    public function edit(): string
    {
        $device = AppData::deviceByCode((string) request_value('device_code', ''), $this->db);
        if (!$device) {
            return $this->redirect('/devices?error=' . rawurlencode('Mesin tidak ditemukan.'));
        }

        return $this->view('devices/edit', [
            'title' => 'Edit Mesin',
            'active' => 'devices',
            'device' => $device,
            'timezones' => AppData::timezoneOptions(),
        ]);
    }

    public function store(): string
    {
        $input = $_POST;
        $existing = AppData::deviceByCode((string) ($input['device_code'] ?? ''), $this->db);
        if ($existing && trim((string) ($existing['serial_number'] ?? '')) !== '') {
            $input['serial_number'] = (string) $existing['serial_number'];
        }

        AppData::saveDevice($input, $this->db);
        return $this->redirect('/devices?saved=1');
    }

    public function delete(): string
    {
        AppData::deleteDevice((string) request_value('device_code', ''), $this->db);
        return $this->redirect('/devices');
    }

    public function detect(): string
    {
        return $this->view('devices/detect', [
            'title' => 'Detek Mesin',
            'active' => 'device-detect',
            'input' => ['host' => '', 'port' => 4370],
            'result' => null,
            'pingInput' => ['host' => '', 'port' => 4370],
            'pingResult' => null,
            'message' => (string) request_value('message', ''),
            'error' => (string) request_value('error', ''),
        ]);
    }

    public function detectPost(): string
    {
        $host = trim((string) request_value('host', ''));
        $port = max(1, (int) clean_number(request_value('port', 4370)));
        $result = DeviceBridge::run('detect', ['host' => $host, 'port' => $port], 45);

        return $this->view('devices/detect', [
            'title' => 'Detek Mesin',
            'active' => 'device-detect',
            'input' => ['host' => $host, 'port' => $port],
            'result' => $result,
            'pingInput' => ['host' => $host, 'port' => $port],
            'pingResult' => null,
            'message' => !empty($result['ok']) ? 'Mesin terdeteksi. SN akan dikunci readonly saat disimpan.' : '',
            'error' => empty($result['ok']) ? self::bridgeMessage($result) : '',
        ]);
    }

    public function pingTerminal(): string
    {
        $host = trim((string) request_value('ping_host', request_value('host', '')));
        $port = max(1, min(65535, (int) clean_number(request_value('ping_port', request_value('port', 4370)))));
        $result = [
            'ok' => false,
            'host' => $host,
            'port' => $port,
            'output' => '',
        ];

        if (!self::validNetworkHost($host)) {
            $result['output'] = '> validasi host' . PHP_EOL . 'Host/IP tidak valid. Pakai IP, hostname, atau domain tanpa spasi/simbol command.';
        } else {
            $lines = [];
            $lines[] = '> target';
            $lines[] = $host . ':' . $port;
            $lines[] = '';
            $lines[] = '> dns';
            $resolved = gethostbyname($host);
            $lines[] = $resolved && $resolved !== $host ? $resolved : 'Tidak ada resolusi DNS tambahan atau input sudah berupa IP.';
            $lines[] = '';
            $lines[] = '> ping';
            $lines[] = self::runPingCommand($host);
            $lines[] = '';
            $lines[] = '> tcp port check';
            $tcp = DeviceBridge::run('ping', ['host' => $host, 'port' => $port, 'timeout' => 4000], 8);
            $lines[] = self::bridgeMessage($tcp);
            $lines[] = '';
            $lines[] = '> diagnosa';
            foreach (self::networkDiagnosis($host, $port, !empty($tcp['ok'])) as $line) {
                $lines[] = $line;
            }

            $result['ok'] = !empty($tcp['ok']);
            $result['output'] = implode(PHP_EOL, $lines);
        }

        return $this->view('devices/detect', [
            'title' => 'Detek Mesin',
            'active' => 'device-detect',
            'input' => ['host' => $host, 'port' => $port],
            'result' => null,
            'pingInput' => ['host' => $host, 'port' => $port],
            'pingResult' => $result,
            'message' => '',
            'error' => '',
        ]);
    }

    public function registerDetected(): string
    {
        AppData::saveDevice($_POST, $this->db);
        return $this->redirect('/devices?message=' . rawurlencode('Mesin hasil deteksi tersimpan.'));
    }

    public function ping(): string
    {
        $device = $this->deviceFromRequest();
        if (!$device) {
            return $this->redirect('/devices?error=' . rawurlencode('Mesin tidak ditemukan.'));
        }

        $result = DeviceBridge::run('ping', $this->bridgeParams($device), 10);
        $message = self::bridgeMessage($result);
        AppData::saveDeviceStatus((string) $device['device_code'], !empty($result['ok']), $message, $this->db, $result);
        AppData::logDeviceAction((string) $device['device_code'], 'ping', !empty($result['ok']), $message, $result, $this->db);

        return $this->redirect('/devices?' . (!empty($result['ok']) ? 'message=' : 'error=') . rawurlencode($message));
    }

    public function readUsers(): string
    {
        $device = $this->deviceFromRequest();
        if (!$device) {
            return $this->redirect('/devices?error=' . rawurlencode('Mesin tidak ditemukan.'));
        }

        $result = DeviceBridge::run('read-users', $this->bridgeParams($device), 60);
        if (!empty($result['ok'])) {
            $count = AppData::syncDeviceUsers((string) $device['device_code'], is_array($result['data'] ?? null) ? $result['data'] : [], $this->db);
            $message = 'Berhasil membaca ' . $count . ' user dari ' . $device['name'] . '.';
            AppData::saveDeviceStatus((string) $device['device_code'], true, $message, $this->db, $result);
            AppData::logDeviceAction((string) $device['device_code'], 'read-users', true, $message, $result, $this->db);
            return $this->redirect('/devices/users?device_code=' . rawurlencode((string) $device['device_code']) . '&message=' . rawurlencode($message));
        }

        $message = self::bridgeMessage($result);
        AppData::saveDeviceStatus((string) $device['device_code'], false, $message, $this->db, $result);
        AppData::logDeviceAction((string) $device['device_code'], 'read-users', false, $message, $result, $this->db);
        return $this->redirect('/devices/users?device_code=' . rawurlencode((string) $device['device_code']) . '&error=' . rawurlencode($message));
    }

    public function users(): string
    {
        $devices = AppData::devices($this->db);
        $deviceCode = trim((string) request_value('device_code', ''));
        if ($deviceCode === '' && $devices) {
            $deviceCode = (string) $devices[0]['device_code'];
        }

        $device = AppData::deviceByCode($deviceCode, $this->db);
        return $this->view('devices/users', [
            'title' => 'User per Mesin',
            'active' => 'device-users',
            'devices' => $devices,
            'device' => $device,
            'deviceCode' => $deviceCode,
            'rows' => $device ? AppData::deviceUsers($deviceCode, $this->db) : [],
            'message' => (string) request_value('message', ''),
            'error' => (string) request_value('error', ''),
        ]);
    }

    public function deleteDeviceUser(): string
    {
        $device = $this->deviceFromRequest();
        $rowId = trim((string) request_value('row_id', ''));
        if (!$device || $rowId === '') {
            return $this->redirect('/devices/users?error=' . rawurlencode('Mesin atau user tidak lengkap.'));
        }

        $rows = AppData::deviceUserRows((string) $device['device_code'], [$rowId], $this->db);
        $target = $rows[0] ?? null;
        $identifier = $target ? (string) ($target['uid'] ?: $target['employee_code']) : $rowId;

        $result = DeviceBridge::run('delete-user', $this->bridgeParams($device) + [
            'user' => $identifier,
            'timeout' => 5000,
        ], 15);
        $message = self::bridgeMessage($result);
        if (!empty($result['ok'])) {
            AppData::deleteDeviceUserLocal((string) $device['device_code'], $rowId, $this->db);
            AppData::logDeviceAction((string) $device['device_code'], 'delete-user', true, $message, $result, $this->db);
            return $this->redirect('/devices/users?device_code=' . rawurlencode((string) $device['device_code']) . '&message=' . rawurlencode('User dihapus hanya dari mesin ' . $device['name'] . '.'));
        }

        AppData::logDeviceAction((string) $device['device_code'], 'delete-user', false, $message, $result, $this->db);
        return $this->redirect('/devices/users?device_code=' . rawurlencode((string) $device['device_code']) . '&error=' . rawurlencode($message));
    }

    public function copyUsers(): string
    {
        $source = $this->deviceFromRequest('source_device_code');
        $rowIds = $_POST['user_rows'] ?? [];
        $targetCodes = $_POST['target_device_codes'] ?? [];
        $mode = (string) request_value('transfer_action', 'copy');

        if (!$source || !is_array($rowIds) || !is_array($targetCodes) || !$rowIds || !$targetCodes) {
            return $this->redirect('/devices/users?error=' . rawurlencode('Pilih user dan mesin tujuan dulu.'));
        }

        $sourceCode = (string) $source['device_code'];
        $rows = AppData::deviceUserRows($sourceCode, $rowIds, $this->db);
        $targetCodes = array_values(array_unique(array_filter(array_map('strval', $targetCodes), static fn (string $code): bool => $code !== $sourceCode)));
        if (!$targetCodes) {
            return $this->redirect('/devices/users?device_code=' . rawurlencode($sourceCode) . '&error=' . rawurlencode('Pilih mesin tujuan selain mesin sumber.'));
        }
        if (!$rows) {
            return $this->redirect('/devices/users?device_code=' . rawurlencode($sourceCode) . '&error=' . rawurlencode('User yang dipilih tidak ditemukan di data lokal mesin sumber. Klik Baca User Live lalu coba lagi.'));
        }

        $success = 0;
        $failed = 0;
        $details = [];
        $rowFullyCopied = [];
        foreach ($rows as $row) {
            $rowFullyCopied[(int) $row['row_id']] = true;
            foreach ($targetCodes as $targetCode) {
                $target = AppData::deviceByCode($targetCode, $this->db);
                if (!$target) {
                    $failed++;
                    $rowFullyCopied[(int) $row['row_id']] = false;
                    $details[] = 'Mesin tujuan ' . $targetCode . ' tidak ditemukan.';
                    continue;
                }

                $targetUid = $this->targetUidForCopy((string) $target['device_code'], $row);
                $result = DeviceBridge::run('add-user', $this->bridgeParams($target) + [
                    'uid' => $targetUid,
                    'employee_code' => $row['employee_code'],
                    'device_user_id' => $row['device_user_id'],
                    'full_name' => $row['full_name'],
                    'card_number' => $row['card_number'],
                    'privilege' => $row['privilege'] ?: '0',
                    'timeout' => 5000,
                ], 15);

                $message = self::bridgeMessage($result);
                AppData::logDeviceAction((string) $target['device_code'], 'copy-user-in', !empty($result['ok']), $message, $result, $this->db);
                if (!empty($result['ok'])) {
                    $targetRow = $row;
                    $targetRow['uid'] = (string) $targetUid;
                    $targetRow['fingerprint_count'] = 0;
                    AppData::saveDeviceUserLocal((string) $target['device_code'], $targetRow, $this->db);
                    $success++;
                } else {
                    $failed++;
                    $rowFullyCopied[(int) $row['row_id']] = false;
                    $details[] = ($target['name'] ?: $targetCode) . ' untuk ' . ($row['full_name'] ?: $row['employee_code']) . ': ' . $message;
                }
            }
        }

        if ($mode === 'move' && $targetCodes) {
            foreach ($rows as $row) {
                if (empty($rowFullyCopied[(int) $row['row_id']])) {
                    continue;
                }
                $delete = DeviceBridge::run('delete-user', $this->bridgeParams($source) + [
                    'user' => $row['uid'] ?: $row['employee_code'],
                    'timeout' => 5000,
                ], 15);
                if (!empty($delete['ok'])) {
                    AppData::deleteDeviceUserLocal($sourceCode, (string) $row['row_id'], $this->db);
                } else {
                    $failed++;
                    $details[] = 'Gagal hapus sumber ' . ($source['name'] ?: $sourceCode) . ' untuk ' . ($row['full_name'] ?: $row['employee_code']) . ': ' . self::bridgeMessage($delete);
                }
                AppData::logDeviceAction($sourceCode, 'move-user-delete-source', !empty($delete['ok']), self::bridgeMessage($delete), $delete, $this->db);
            }
        }

        $message = ($mode === 'move' ? 'Pindah' : 'Salin') . ' selesai: ' . $success . ' sukses, ' . $failed . ' gagal.';
        if ($details) {
            $message .= ' Detail: ' . implode(' | ', array_slice($details, 0, 4));
        }
        $statusKey = $success > 0 ? 'message' : 'error';
        return $this->redirect('/devices/users?device_code=' . rawurlencode($sourceCode) . '&' . $statusKey . '=' . rawurlencode($message));
    }

    public function enrollFinger(): string
    {
        $device = $this->deviceFromRequest();
        $userKey = trim((string) request_value('user_key', request_value('row_id', '')));
        $fingerIndex = (int) clean_number(request_value('finger_index', 0));
        if (!$device || $userKey === '') {
            return $this->redirect('/devices/users?error=' . rawurlencode('Mesin atau user belum dipilih.'));
        }
        if ($fingerIndex < 0 || $fingerIndex > 9) {
            return $this->redirect('/devices/users?device_code=' . rawurlencode((string) $device['device_code']) . '&error=' . rawurlencode('Index jari harus 0 sampai 9.'));
        }

        $target = null;
        foreach (AppData::deviceUsers((string) $device['device_code'], $this->db) as $row) {
            if ((string) ($row['row_id'] ?? '') === $userKey
                || (string) ($row['employee_code'] ?? '') === $userKey
                || (string) ($row['device_user_id'] ?? '') === $userKey
                || (string) ($row['uid'] ?? '') === $userKey) {
                $target = $row;
                break;
            }
        }
        if (!$target) {
            return $this->redirect('/devices/users?device_code=' . rawurlencode((string) $device['device_code']) . '&error=' . rawurlencode('User tidak ditemukan pada mesin ini.'));
        }

        $identityMode = strtolower(trim((string) request_value('identity_mode', 'uid')));
        if (!in_array($identityMode, ['uid', 'pin'], true)) {
            $identityMode = 'uid';
        }
        $holdSeconds = (int) clean_number(request_value('hold_seconds', 30));
        $holdSeconds = max(5, min(60, $holdSeconds));
        $pin = (string) ($target['device_user_id'] ?: $target['employee_code'] ?: $target['uid']);

        $result = DeviceBridge::run('start-enroll', $this->bridgeParams($device) + [
            'uid' => (string) ($target['uid'] ?: $pin),
            'pin' => $pin,
            'employee_code' => (string) $target['employee_code'],
            'identity_mode' => $identityMode,
            'finger_index' => (string) $fingerIndex,
            'timeout' => 2000,
            'hold_ms' => (string) ($holdSeconds * 1000),
            'background' => '1',
            'wait_ms' => '3500',
        ], 8);
        $message = self::bridgeMessage($result);
        AppData::logDeviceAction((string) $device['device_code'], 'start-enroll', !empty($result['ok']), $message, $result, $this->db);

        if (!empty($result['ok'])) {
            $resultData = is_array($result['data'] ?? null) ? $result['data'] : [];
            $serialUsed = (string) ($resultData['serial_used'] ?? ($identityMode === 'pin' ? $pin : $target['uid']));
            $message = 'Mesin ' . $device['name'] . ' sudah dibuka untuk daftar sidik jari ' . ($target['full_name'] ?: $target['employee_code']) . ' pada slot ' . $fingerIndex . ' memakai ' . strtoupper($identityMode) . ' ' . $serialUsed . '. Setelah selesai, klik Baca User Live untuk update icon.';
        }

        return $this->redirect('/devices/users?device_code=' . rawurlencode((string) $device['device_code']) . '&' . (!empty($result['ok']) ? 'message=' : 'error=') . rawurlencode($message));
    }

    public function cancelCapture(): string
    {
        $device = $this->deviceFromRequest();
        if (!$device) {
            return $this->redirect('/devices/users?error=' . rawurlencode('Mesin tidak ditemukan.'));
        }

        $result = DeviceBridge::run('cancel-capture', $this->bridgeParams($device) + ['timeout' => 1000], 5);
        $message = self::bridgeMessage($result);
        AppData::logDeviceAction((string) $device['device_code'], 'cancel-capture', !empty($result['ok']), $message, $result, $this->db);

        return $this->redirect('/devices/users?device_code=' . rawurlencode((string) $device['device_code']) . '&' . (!empty($result['ok']) ? 'message=' : 'error=') . rawurlencode($message));
    }

    public function reboot(): string
    {
        $device = $this->deviceFromRequest();
        if (!$device) {
            return $this->redirect('/devices?error=' . rawurlencode('Mesin tidak ditemukan.'));
        }

        $result = DeviceBridge::run('reboot', $this->bridgeParams($device), 20);
        $message = self::bridgeMessage($result);
        AppData::logDeviceAction((string) $device['device_code'], 'reboot', !empty($result['ok']), $message, $result, $this->db);

        return $this->redirect('/devices?' . (!empty($result['ok']) ? 'message=' : 'error=') . rawurlencode($message));
    }

    public function readAdms(): string
    {
        $device = $this->deviceFromRequest();
        if (!$device) {
            return $this->redirect('/devices?error=' . rawurlencode('Mesin tidak ditemukan.'));
        }

        $result = DeviceBridge::run('get-adms', $this->bridgeParams($device), 45);
        AppData::logDeviceAction((string) $device['device_code'], 'read-adms', !empty($result['ok']), self::bridgeMessage($result), $result, $this->db);
        $message = !empty($result['ok']) ? self::formatAdms($result['data'] ?? []) : self::bridgeMessage($result);

        return $this->redirect('/devices?' . (!empty($result['ok']) ? 'message=' : 'error=') . rawurlencode($message));
    }

    public function setAdms(): string
    {
        $device = $this->deviceFromRequest();
        if (!$device) {
            return $this->redirect('/devices?error=' . rawurlencode('Mesin tidak ditemukan.'));
        }

        $result = DeviceBridge::run('set-adms', $this->bridgeParams($device) + [
            'adms_ip' => (string) request_value('adms_ip', ''),
            'adms_domain' => (string) request_value('adms_domain', ''),
            'adms_port' => (string) request_value('adms_port', ''),
            'adms_url' => (string) request_value('adms_url', ''),
            'comm_key' => (string) request_value('comm_key', ''),
        ], 45);
        AppData::logDeviceAction((string) $device['device_code'], 'set-adms', !empty($result['ok']), self::bridgeMessage($result), $result, $this->db);
        if (!empty($result['ok'])) {
            AppData::saveDevice($this->mergedDeviceInput($device, [
                'adms_ip' => (string) request_value('adms_ip', $device['adms_ip'] ?? ''),
                'adms_domain' => (string) request_value('adms_domain', $device['adms_domain'] ?? ''),
                'adms_port' => (string) request_value('adms_port', $device['adms_port'] ?? ''),
                'adms_url' => (string) request_value('adms_url', $device['adms_url'] ?? ''),
            ]), $this->db);
        }

        return $this->redirect('/devices?' . (!empty($result['ok']) ? 'message=' : 'error=') . rawurlencode(self::bridgeMessage($result)));
    }

    public function setTime(): string
    {
        $device = $this->deviceFromRequest();
        if (!$device) {
            return $this->redirect('/devices?error=' . rawurlencode('Mesin tidak ditemukan.'));
        }

        $timezone = (string) ($device['timezone'] ?? AppData::settings($this->db)['timezone'] ?? 'Asia/Jakarta');
        $now = new \DateTimeImmutable('now', new \DateTimeZone($timezone));
        $result = DeviceBridge::run('set-time', $this->bridgeParams($device) + [
            'local_datetime' => $now->format('Y-m-d H:i:s'),
            'timezone' => $timezone,
        ], 30);
        AppData::logDeviceAction((string) $device['device_code'], 'set-time', !empty($result['ok']), self::bridgeMessage($result), $result, $this->db);

        return $this->redirect('/devices?' . (!empty($result['ok']) ? 'message=' : 'error=') . rawurlencode(self::bridgeMessage($result)));
    }

    public function setTimezone(): string
    {
        $device = $this->deviceFromRequest();
        if (!$device) {
            return $this->redirect('/devices?error=' . rawurlencode('Mesin tidak ditemukan.'));
        }

        $timezone = (string) request_value('timezone', $device['timezone'] ?? 'Asia/Jakarta');
        if (!in_array($timezone, AppData::timezones(), true)) {
            return $this->redirect('/devices?error=' . rawurlencode('Timezone tidak valid.'));
        }

        $offsetMinutes = (new \DateTimeImmutable('now', new \DateTimeZone($timezone)))->getOffset() / 60;
        $result = DeviceBridge::run('set-timezone', $this->bridgeParams($device) + [
            'timezone' => $timezone,
            'offset_minutes' => (string) $offsetMinutes,
        ], 30);
        AppData::logDeviceAction((string) $device['device_code'], 'set-timezone', !empty($result['ok']), self::bridgeMessage($result), $result, $this->db);
        if (!empty($result['ok'])) {
            AppData::saveDevice($this->mergedDeviceInput($device, ['timezone' => $timezone]), $this->db);
        }

        return $this->redirect('/devices?' . (!empty($result['ok']) ? 'message=' : 'error=') . rawurlencode(self::bridgeMessage($result)));
    }

    /**
     * @return array<string, mixed>|null
     */
    private function deviceFromRequest(string $field = 'device_code'): ?array
    {
        return AppData::deviceByCode((string) request_value($field, ''), $this->db);
    }

    /**
     * @param array<string, mixed> $device
     * @return array<string, mixed>
     */
    private function bridgeParams(array $device): array
    {
        return [
            'host' => DeviceBridge::hostFor($device),
            'port' => (int) ($device['port'] ?? 4370),
        ];
    }

    /**
     * @param array<string, mixed> $device
     * @param array<string, mixed> $changes
     * @return array<string, mixed>
     */
    private function mergedDeviceInput(array $device, array $changes): array
    {
        $input = $device + [
            'timezone' => 'Asia/Jakarta',
            'adms_domain' => '',
            'preferred_host' => 'auto',
        ];
        foreach ($changes as $key => $value) {
            if ($value !== '') {
                $input[$key] = $value;
            }
        }

        return $input;
    }

    /**
     * @param array<string, mixed> $sourceRow
     */
    private function targetUidForCopy(string $targetDeviceCode, array $sourceRow): int
    {
        $sourceUid = (int) ($sourceRow['uid'] ?? 0);
        $employeeCode = (string) ($sourceRow['employee_code'] ?? '');
        $used = [];

        foreach (AppData::deviceUsers($targetDeviceCode, $this->db) as $targetRow) {
            $uid = (int) ($targetRow['uid'] ?? 0);
            if ($uid > 0) {
                $used[$uid] = true;
            }
            if ($employeeCode !== '' && (string) ($targetRow['employee_code'] ?? '') === $employeeCode) {
                return max(1, $uid);
            }
        }

        if ($sourceUid > 0 && $sourceUid <= 3000 && empty($used[$sourceUid])) {
            return $sourceUid;
        }

        for ($uid = 1; $uid <= 3000; $uid++) {
            if (empty($used[$uid])) {
                return $uid;
            }
        }

        return max(1, min(3000, $sourceUid ?: 1));
    }

    /**
     * @param array<string, mixed> $result
     */
    private static function bridgeMessage(array $result): string
    {
        if (!empty($result['message'])) {
            return (string) $result['message'];
        }
        if (!empty($result['error'])) {
            return (string) $result['error'];
        }
        return !empty($result['ok']) ? 'Perintah berhasil dijalankan.' : 'Perintah gagal dijalankan.';
    }

    private static function validNetworkHost(string $host): bool
    {
        if ($host === '' || strlen($host) > 253) {
            return false;
        }

        return (bool) preg_match('/^[a-zA-Z0-9][a-zA-Z0-9.:-]*[a-zA-Z0-9]$/', $host);
    }

    private static function runPingCommand(string $host): string
    {
        $command = PHP_OS_FAMILY === 'Windows'
            ? 'ping -n 4 -w 1000 ' . escapeshellarg($host)
            : 'ping -c 4 -W 1 ' . escapeshellarg($host);

        $descriptor = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $process = proc_open($command, $descriptor, $pipes, ROOTPATH);
        if (!is_resource($process)) {
            return 'Gagal menjalankan ping dari server XAMPP.';
        }

        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        $output = '';
        $error = '';
        $start = time();
        while (true) {
            $output .= stream_get_contents($pipes[1]) ?: '';
            $error .= stream_get_contents($pipes[2]) ?: '';
            $status = proc_get_status($process);
            if (!$status['running']) {
                break;
            }
            if ((time() - $start) > 8) {
                proc_terminate($process);
                $output .= PHP_EOL . 'Ping timeout dari aplikasi.';
                break;
            }
            usleep(100000);
        }

        $output .= stream_get_contents($pipes[1]) ?: '';
        $error .= stream_get_contents($pipes[2]) ?: '';
        foreach ($pipes as $pipe) {
            if (is_resource($pipe)) {
                fclose($pipe);
            }
        }
        proc_close($process);

        $text = trim($output . ($error !== '' ? PHP_EOL . $error : ''));
        return $text !== '' ? $text : 'Ping tidak menghasilkan output.';
    }

    /**
     * @return array<int, string>
     */
    private static function networkDiagnosis(string $host, int $port, bool $tcpOpen): array
    {
        if ($tcpOpen) {
            return ['IP bisa dijangkau dan port ' . $port . ' terbuka. Detek mesin seharusnya bisa lanjut.'];
        }

        $lines = ['IP/host bisa saja hidup, tetapi port ' . $port . ' belum terbuka dari PC XAMPP ini.'];
        if (self::isTailscaleIp($host)) {
            $lines[] = 'IP ini termasuk range Tailscale 100.64.0.0/10. Kalau IP ini milik PC, bukan mesin fingerprint, aktifkan portproxy atau subnet route ke IP lokal mesin.';
            $lines[] = 'Jika jaringan kantor memakai subnet sama dengan kantor ini, portproxy lebih aman daripada subnet route.';
        }
        $lines[] = 'Cek di PC lokasi mesin: Test-NetConnection IP_LOKAL_MESIN -Port ' . $port . '.';

        return $lines;
    }

    private static function isTailscaleIp(string $host): bool
    {
        $parts = array_map('intval', explode('.', $host));
        return count($parts) === 4 && $parts[0] === 100 && $parts[1] >= 64 && $parts[1] <= 127;
    }

    private static function formatAdms($rows): string
    {
        if (!is_array($rows)) {
            return 'ADMS terbaca.';
        }

        $pairs = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $pairs[] = (string) ($row['key'] ?? '-') . '=' . (string) ($row['value'] ?? ($row['error'] ?? '-'));
        }

        return $pairs ? 'ADMS: ' . implode(', ', array_slice($pairs, 0, 8)) : 'ADMS terbaca.';
    }
}
