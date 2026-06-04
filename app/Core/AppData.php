<?php
declare(strict_types=1);

namespace App\Core;

final class AppData
{
    /**
     * @return array<string, string>
     */
    public static function settings(?Database $db = null): array
    {
        $defaults = [
            'app_name' => 'CSL Fingerprint',
            'company_name' => 'CSL Digital',
            'timezone' => 'Asia/Jakarta',
            'work_start_time' => '08:00',
            'receipt_footer' => 'Data absensi tersimpan lokal di XAMPP.',
        ];

        $fileData = read_json_file(ROOTPATH . 'app-settings.json', []);
        foreach ($fileData as $key => $value) {
            if (array_key_exists((string) $key, $defaults)) {
                $defaults[(string) $key] = (string) $value;
            }
        }

        if ($db && $db->connected()) {
            $rows = $db->all('SELECT setting_key, setting_value FROM app_settings');
            foreach ($rows as $row) {
                $key = (string) ($row['setting_key'] ?? '');
                if ($key !== '' && array_key_exists($key, $defaults)) {
                    $defaults[$key] = (string) ($row['setting_value'] ?? '');
                }
            }
        }

        return $defaults;
    }

    /**
     * @return array<int, string>
     */
    public static function timezones(): array
    {
        return \DateTimeZone::listIdentifiers();
    }

    /**
     * @return array<int, array{value:string,label:string}>
     */
    public static function timezoneOptions(): array
    {
        return array_map(static function (string $zone): array {
            return [
                'value' => $zone,
                'label' => self::timezoneLabel($zone),
            ];
        }, self::timezones());
    }

    public static function timezoneLabel(string $zone): string
    {
        $zone = self::validTimezone($zone);
        $timezone = new \DateTimeZone($zone);
        $offset = $timezone->getOffset(new \DateTimeImmutable('now'));
        $sign = $offset >= 0 ? '+' : '-';
        $offset = abs($offset);
        $hours = intdiv($offset, 3600);
        $minutes = intdiv($offset % 3600, 60);

        return $zone . ' (GMT' . $sign . str_pad((string) $hours, 2, '0', STR_PAD_LEFT) . ':' . str_pad((string) $minutes, 2, '0', STR_PAD_LEFT) . ')';
    }

    /**
     * @param array<string, mixed> $values
     */
    public static function saveSettings(array $values, ?Database $db = null): void
    {
        $current = self::settings($db);
        foreach ($current as $key => $oldValue) {
            $current[$key] = trim((string) ($values[$key] ?? $oldValue));
        }
        if (!in_array($current['timezone'], self::timezones(), true)) {
            $current['timezone'] = 'Asia/Jakarta';
        }

        write_json_file(ROOTPATH . 'app-settings.json', $current);

        if ($db && $db->connected()) {
            foreach ($current as $key => $value) {
                $db->execute(
                    'INSERT INTO app_settings (setting_key, setting_value)
                     VALUES (:setting_key, :setting_value)
                     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()',
                    ['setting_key' => $key, 'setting_value' => $value]
                );
            }
        }
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function devices(?Database $db = null): array
    {
        if ($db && $db->connected()) {
            $rows = $db->all(
                'SELECT d.id, d.device_code, d.name, d.serial_number, d.ip_address, d.public_ip, d.tailscale_ip,
                        d.preferred_host, d.port, d.location, d.brand, d.protocol, d.timezone, d.adms_ip, d.adms_domain, d.adms_port, d.adms_url,
                        d.last_detected_at, d.is_active,
                        COALESCE(s.is_online, 0) AS is_online, s.message, s.checked_at
                 FROM devices d
                 LEFT JOIN device_status s ON s.device_id = d.id
                 WHERE d.is_active = 1
                 ORDER BY d.name'
            );
            if ($rows) {
                return array_map([self::class, 'mapDeviceRow'], $rows);
            }
        }

        return self::configDevices();
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function deviceByCode(string $deviceCode, ?Database $db = null): ?array
    {
        $deviceCode = trim($deviceCode);
        if ($deviceCode === '') {
            return null;
        }

        if ($db && $db->connected()) {
            $rows = $db->all(
                'SELECT d.id, d.device_code, d.name, d.serial_number, d.ip_address, d.public_ip, d.tailscale_ip,
                        d.preferred_host, d.port, d.location, d.brand, d.protocol, d.timezone, d.adms_ip, d.adms_domain, d.adms_port, d.adms_url,
                        d.last_detected_at, d.is_active,
                        COALESCE(s.is_online, 0) AS is_online, s.message, s.checked_at
                 FROM devices d
                 LEFT JOIN device_status s ON s.device_id = d.id
                 WHERE d.device_code = :code AND d.is_active = 1
                 LIMIT 1',
                ['code' => $deviceCode]
            );
            if ($rows) {
                return self::mapDeviceRow($rows[0]);
            }
        }

        foreach (self::configDevices() as $device) {
            if ((string) ($device['device_code'] ?? '') === $deviceCode) {
                return $device;
            }
        }

        return null;
    }

    public static function deviceDbId(string $deviceCode, ?Database $db = null): ?int
    {
        if (!$db || !$db->connected()) {
            return null;
        }

        $rows = $db->all('SELECT id FROM devices WHERE device_code = :code LIMIT 1', ['code' => $deviceCode]);
        return $rows ? (int) $rows[0]['id'] : null;
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public static function saveDevice(array $input, ?Database $db = null): array
    {
        $codeSource = (string) ($input['device_code'] ?? $input['serial_number'] ?? $input['name'] ?? 'mesin');
        $device = [
            'device_code' => self::slug($codeSource),
            'name' => trim((string) ($input['name'] ?? 'Mesin Fingerprint')),
            'serial_number' => self::nullIfEmpty($input['serial_number'] ?? null),
            'ip_address' => self::nullIfEmpty($input['ip_address'] ?? $input['ip'] ?? null),
            'public_ip' => self::nullIfEmpty($input['public_ip'] ?? null),
            'tailscale_ip' => self::nullIfEmpty($input['tailscale_ip'] ?? null),
            'preferred_host' => self::preferredHost((string) ($input['preferred_host'] ?? 'auto')),
            'port' => max(1, (int) clean_number($input['port'] ?? 4370)),
            'location' => self::nullIfEmpty($input['location'] ?? null),
            'brand' => trim((string) ($input['brand'] ?? 'ZKTeco Compatible')),
            'protocol' => trim((string) ($input['protocol'] ?? 'zk-tcp')),
            'timezone' => self::validTimezone((string) ($input['timezone'] ?? self::settings($db)['timezone'] ?? 'Asia/Jakarta')),
            'adms_ip' => self::nullIfEmpty($input['adms_ip'] ?? null),
            'adms_domain' => self::nullIfEmpty($input['adms_domain'] ?? null),
            'adms_port' => self::optionalInt($input['adms_port'] ?? null),
            'adms_url' => self::nullIfEmpty($input['adms_url'] ?? null),
        ];

        if ($device['name'] === '') {
            $device['name'] = 'Mesin Fingerprint';
        }

        if ($db && $db->connected()) {
            $db->execute(
                'INSERT INTO devices
                    (device_code, name, serial_number, ip_address, public_ip, tailscale_ip, preferred_host, port, location, brand, protocol, timezone, adms_ip, adms_domain, adms_port, adms_url, is_active, last_detected_at)
                 VALUES
                    (:device_code, :name, :serial_number, :ip_address, :public_ip, :tailscale_ip, :preferred_host, :port, :location, :brand, :protocol, :timezone, :adms_ip, :adms_domain, :adms_port, :adms_url, 1, NOW())
                 ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    serial_number = VALUES(serial_number),
                    ip_address = VALUES(ip_address),
                    public_ip = VALUES(public_ip),
                    tailscale_ip = VALUES(tailscale_ip),
                    preferred_host = VALUES(preferred_host),
                    port = VALUES(port),
                    location = VALUES(location),
                    brand = VALUES(brand),
                    protocol = VALUES(protocol),
                    timezone = VALUES(timezone),
                    adms_ip = VALUES(adms_ip),
                    adms_domain = VALUES(adms_domain),
                    adms_port = VALUES(adms_port),
                    adms_url = VALUES(adms_url),
                    is_active = 1,
                    last_detected_at = NOW(),
                    updated_at = NOW()',
                $device
            );
        }

        self::saveDeviceToConfig($device);
        return $device;
    }

    public static function deleteDevice(string $deviceCode, ?Database $db = null): void
    {
        $deviceCode = trim($deviceCode);
        if ($deviceCode === '') {
            return;
        }

        if ($db && $db->connected()) {
            $db->execute('UPDATE devices SET is_active = 0, updated_at = NOW() WHERE device_code = :code', ['code' => $deviceCode]);
        }

        $config = read_json_file(ROOTPATH . 'config.json', ['devices' => []]);
        $config['devices'] = array_values(array_filter($config['devices'] ?? [], static function (array $device) use ($deviceCode): bool {
            return (string) ($device['id'] ?? '') !== $deviceCode;
        }));
        write_json_file(ROOTPATH . 'config.json', $config);
    }

    /**
     * @param array<string, mixed> $result
     */
    public static function saveDeviceStatus(string $deviceCode, bool $online, string $message, ?Database $db = null, array $result = []): void
    {
        $deviceCode = trim($deviceCode);
        if ($deviceCode === '') {
            return;
        }

        $status = read_json_file(ROOTPATH . 'device-status.json', []);
        $status[$deviceCode] = [
            'online' => $online,
            'message' => $message,
            'checked_at' => app_now(),
            'result' => $result,
        ];
        write_json_file(ROOTPATH . 'device-status.json', $status);

        $deviceId = self::deviceDbId($deviceCode, $db);
        if ($db && $db->connected() && $deviceId) {
            $db->execute(
                'INSERT INTO device_status (device_id, is_online, message, checked_at)
                 VALUES (:device_id, :is_online, :message, NOW())
                 ON DUPLICATE KEY UPDATE
                    is_online = VALUES(is_online),
                    message = VALUES(message),
                    checked_at = VALUES(checked_at),
                    updated_at = NOW()',
                [
                    'device_id' => $deviceId,
                    'is_online' => $online ? 1 : 0,
                    'message' => $message,
                ]
            );
        }
    }

    /**
     * @param array<string, mixed> $payload
     */
    public static function logDeviceAction(string $deviceCode, string $action, bool $success, string $message, array $payload, ?Database $db = null): void
    {
        if (!$db || !$db->connected()) {
            return;
        }

        $payloadJson = self::compactPayload($payload);

        $db->execute(
            'INSERT INTO device_action_logs (device_id, action, is_success, message, payload)
             VALUES (:device_id, :action, :is_success, :message, :payload)',
            [
                'device_id' => self::deviceDbId($deviceCode, $db),
                'action' => $action,
                'is_success' => $success ? 1 : 0,
                'message' => $message,
                'payload' => $payloadJson,
            ]
        );
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function fingerprintUsers(?Database $db = null): array
    {
        if ($db && $db->connected()) {
            $rows = $db->all(
                'SELECT u.id, u.employee_code, u.full_name, u.card_number, u.device_user_id, u.department,
                        u.is_active, COUNT(du.id) AS device_count, COALESCE(MAX(du.fingerprint_count), 0) AS fingerprint_count
                 FROM fingerprint_users u
                 LEFT JOIN device_users du ON du.fingerprint_user_id = u.id
                 WHERE u.is_active = 1
                 GROUP BY u.id, u.employee_code, u.full_name, u.card_number, u.device_user_id, u.department, u.is_active
                 ORDER BY u.full_name, u.employee_code'
            );
            if ($rows) {
                return array_map(static function (array $row): array {
                    return [
                        'id' => (string) $row['id'],
                        'employee_code' => (string) $row['employee_code'],
                        'full_name' => (string) $row['full_name'],
                        'card_number' => (string) ($row['card_number'] ?? ''),
                        'device_user_id' => (string) ($row['device_user_id'] ?? ''),
                        'department' => (string) ($row['department'] ?? ''),
                        'device_count' => (int) ($row['device_count'] ?? 0),
                        'fingerprint_count' => (int) ($row['fingerprint_count'] ?? 0),
                        'is_active' => (int) ($row['is_active'] ?? 1) === 1,
                    ];
                }, $rows);
            }
        }

        $rows = read_json_file(ROOTPATH . 'users.json', []);
        return array_map(static function (array $row): array {
            return [
                'id' => (string) ($row['user_id'] ?? ''),
                'employee_code' => (string) ($row['user_id'] ?? ''),
                'full_name' => (string) ($row['name'] ?? ''),
                'card_number' => (string) ($row['card'] ?? ''),
                'device_user_id' => (string) ($row['uid'] ?? $row['user_id'] ?? ''),
                'department' => (string) ($row['department'] ?? ''),
                'device_count' => 0,
                'fingerprint_count' => (int) ($row['fingerprint_count'] ?? 0),
                'is_active' => (bool) ($row['is_active'] ?? true),
            ];
        }, is_array($rows) ? $rows : []);
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public static function saveFingerprintUser(array $input, ?Database $db = null): array
    {
        $employeeCode = trim((string) ($input['employee_code'] ?? ''));
        $user = [
            'employee_code' => $employeeCode,
            'full_name' => trim((string) ($input['full_name'] ?? $employeeCode)),
            'card_number' => self::nullIfEmpty($input['card_number'] ?? null),
            'device_user_id' => trim((string) ($input['device_user_id'] ?? $employeeCode)),
            'department' => self::nullIfEmpty($input['department'] ?? null),
        ];

        if ($user['employee_code'] === '' || $user['full_name'] === '') {
            return $user;
        }

        if ($user['device_user_id'] === '') {
            $user['device_user_id'] = $user['employee_code'];
        }

        if ($db && $db->connected()) {
            $db->execute(
                'INSERT INTO fingerprint_users (employee_code, full_name, card_number, device_user_id, department, is_active)
                 VALUES (:employee_code, :full_name, :card_number, :device_user_id, :department, 1)
                 ON DUPLICATE KEY UPDATE
                    full_name = VALUES(full_name),
                    card_number = VALUES(card_number),
                    device_user_id = VALUES(device_user_id),
                    department = VALUES(department),
                    is_active = 1,
                    updated_at = NOW()',
                $user
            );
        }

        $rows = read_json_file(ROOTPATH . 'users.json', []);
        $saved = [
            'user_id' => $user['employee_code'],
            'name' => $user['full_name'],
            'card' => (string) ($user['card_number'] ?? ''),
            'uid' => $user['device_user_id'],
            'department' => (string) ($user['department'] ?? ''),
            'is_active' => true,
        ];

        $found = false;
        foreach ($rows as &$row) {
            if ((string) ($row['user_id'] ?? '') === $user['employee_code']) {
                $row = $saved;
                $found = true;
                break;
            }
        }
        unset($row);

        if (!$found) {
            $rows[] = $saved;
        }

        write_json_file(ROOTPATH . 'users.json', $rows);
        return $user;
    }

    public static function deleteFingerprintUser(string $employeeCode, ?Database $db = null): void
    {
        $employeeCode = trim($employeeCode);
        if ($employeeCode === '') {
            return;
        }

        if ($db && $db->connected()) {
            $db->execute('UPDATE fingerprint_users SET is_active = 0, updated_at = NOW() WHERE employee_code = :code', ['code' => $employeeCode]);
        }

        $rows = read_json_file(ROOTPATH . 'users.json', []);
        $rows = array_values(array_filter($rows, static function (array $row) use ($employeeCode): bool {
            return (string) ($row['user_id'] ?? '') !== $employeeCode;
        }));
        write_json_file(ROOTPATH . 'users.json', $rows);
    }

    /**
     * @param array<int, array<string, mixed>> $users
     */
    public static function syncDeviceUsers(string $deviceCode, array $users, ?Database $db = null): int
    {
        if (!$db || !$db->connected()) {
            $all = read_json_file(ROOTPATH . 'device-users.json', []);
            $all[$deviceCode] = $users;
            write_json_file(ROOTPATH . 'device-users.json', $all);
            return count($users);
        }

        $deviceId = self::deviceDbId($deviceCode, $db);
        if (!$deviceId) {
            return 0;
        }

        $db->execute('DELETE FROM device_users WHERE device_id = :device_id', ['device_id' => $deviceId]);
        $count = 0;
        foreach ($users as $row) {
            if (self::saveDeviceUserLocal($deviceCode, $row, $db)) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function deviceUsers(string $deviceCode, ?Database $db = null): array
    {
        if ($db && $db->connected()) {
            $rows = $db->all(
                'SELECT du.id, du.uid, du.employee_code, du.device_user_id, du.full_name, du.card_number,
                        du.privilege, du.password_value, du.fingerprint_count, du.synced_at,
                        d.device_code, d.name AS device_name, d.serial_number
                 FROM device_users du
                 INNER JOIN devices d ON d.id = du.device_id
                 WHERE d.device_code = :device_code
                 ORDER BY CAST(du.uid AS UNSIGNED), du.employee_code',
                ['device_code' => $deviceCode]
            );
            return array_map(static function (array $row): array {
                return [
                    'row_id' => (int) $row['id'],
                    'uid' => (string) $row['uid'],
                    'employee_code' => (string) $row['employee_code'],
                    'device_user_id' => (string) ($row['device_user_id'] ?? ''),
                    'full_name' => (string) ($row['full_name'] ?? ''),
                    'card_number' => (string) ($row['card_number'] ?? ''),
                    'privilege' => (string) ($row['privilege'] ?? ''),
                    'password_value' => (string) ($row['password_value'] ?? ''),
                    'fingerprint_count' => (int) ($row['fingerprint_count'] ?? 0),
                    'synced_at' => (string) ($row['synced_at'] ?? ''),
                    'device_code' => (string) $row['device_code'],
                    'device_name' => (string) $row['device_name'],
                    'serial_number' => (string) ($row['serial_number'] ?? ''),
                ];
            }, $rows);
        }

        $all = read_json_file(ROOTPATH . 'device-users.json', []);
        return is_array($all[$deviceCode] ?? null) ? $all[$deviceCode] : [];
    }

    /**
     * @param array<int, mixed> $rowIds
     * @return array<int, array<string, mixed>>
     */
    public static function deviceUserRows(string $deviceCode, array $rowIds, ?Database $db = null): array
    {
        if (!$db || !$db->connected()) {
            $ids = array_map('strval', $rowIds);
            return array_values(array_filter(self::deviceUsers($deviceCode, $db), static function (array $row) use ($ids): bool {
                return in_array((string) ($row['row_id'] ?? ''), $ids, true);
            }));
        }

        $ids = array_values(array_filter(array_map('intval', $rowIds), static fn (int $id): bool => $id > 0));
        if (!$ids) {
            return [];
        }

        $params = ['device_code' => $deviceCode];
        $placeholders = [];
        foreach ($ids as $index => $id) {
            $key = 'id' . $index;
            $placeholders[] = ':' . $key;
            $params[$key] = $id;
        }

        $rows = $db->all(
            'SELECT du.id, du.uid, du.employee_code, du.device_user_id, du.full_name, du.card_number,
                    du.privilege, du.password_value, du.fingerprint_count, du.synced_at,
                    d.device_code, d.name AS device_name, d.serial_number
             FROM device_users du
             INNER JOIN devices d ON d.id = du.device_id
             WHERE d.device_code = :device_code AND du.id IN (' . implode(',', $placeholders) . ')
             ORDER BY CAST(du.uid AS UNSIGNED), du.employee_code',
            $params
        );

        return array_map(static function (array $row): array {
            return [
                'row_id' => (int) $row['id'],
                'uid' => (string) $row['uid'],
                'employee_code' => (string) $row['employee_code'],
                'device_user_id' => (string) ($row['device_user_id'] ?? ''),
                'full_name' => (string) ($row['full_name'] ?? ''),
                'card_number' => (string) ($row['card_number'] ?? ''),
                'privilege' => (string) ($row['privilege'] ?? ''),
                'password_value' => (string) ($row['password_value'] ?? ''),
                'fingerprint_count' => (int) ($row['fingerprint_count'] ?? 0),
                'synced_at' => (string) ($row['synced_at'] ?? ''),
                'device_code' => (string) $row['device_code'],
                'device_name' => (string) $row['device_name'],
                'serial_number' => (string) ($row['serial_number'] ?? ''),
            ];
        }, $rows);
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function saveDeviceUserLocal(string $deviceCode, array $row, ?Database $db = null): bool
    {
        $employeeCode = trim((string) ($row['employee_code'] ?? $row['device_user_id'] ?? $row['uid'] ?? ''));
        $uid = trim((string) ($row['uid'] ?? $row['device_user_id'] ?? $employeeCode));
        if ($deviceCode === '' || $employeeCode === '' || $uid === '') {
            return false;
        }

        if (!$db || !$db->connected()) {
            return true;
        }

        $deviceId = self::deviceDbId($deviceCode, $db);
        if (!$deviceId) {
            return false;
        }

        $fingerprintUserId = self::upsertFingerprintUserFromDevice($row, $db);
        $name = trim((string) ($row['full_name'] ?? $row['name'] ?? $employeeCode));
        $fingerprintCount = max(0, min(10, (int) ($row['fingerprint_count'] ?? $row['finger_count'] ?? 0)));

        $db->execute(
            'INSERT INTO device_users
                (device_id, fingerprint_user_id, uid, employee_code, device_user_id, full_name, card_number, privilege, password_value, fingerprint_count, raw_payload, synced_at)
             VALUES
                (:device_id, :fingerprint_user_id, :uid, :employee_code, :device_user_id, :full_name, :card_number, :privilege, :password_value, :fingerprint_count, :raw_payload, NOW())
             ON DUPLICATE KEY UPDATE
                fingerprint_user_id = VALUES(fingerprint_user_id),
                uid = VALUES(uid),
                employee_code = VALUES(employee_code),
                device_user_id = VALUES(device_user_id),
                full_name = VALUES(full_name),
                card_number = VALUES(card_number),
                privilege = VALUES(privilege),
                password_value = VALUES(password_value),
                fingerprint_count = VALUES(fingerprint_count),
                raw_payload = VALUES(raw_payload),
                synced_at = NOW(),
                updated_at = NOW()',
            [
                'device_id' => $deviceId,
                'fingerprint_user_id' => $fingerprintUserId,
                'uid' => $uid,
                'employee_code' => $employeeCode,
                'device_user_id' => trim((string) ($row['device_user_id'] ?? $employeeCode)),
                'full_name' => $name !== '' ? $name : $employeeCode,
                'card_number' => self::nullIfEmpty($row['card_number'] ?? null),
                'privilege' => self::nullIfEmpty($row['privilege'] ?? null),
                'password_value' => self::nullIfEmpty($row['password_value'] ?? null),
                'fingerprint_count' => $fingerprintCount,
                'raw_payload' => json_encode($row['raw'] ?? $row, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            ]
        );

        return true;
    }

    public static function deleteDeviceUserLocal(string $deviceCode, string $identifier, ?Database $db = null): void
    {
        $identifier = trim($identifier);
        if ($deviceCode === '' || $identifier === '') {
            return;
        }

        if ($db && $db->connected()) {
            $db->execute(
                'DELETE du FROM device_users du
                 INNER JOIN devices d ON d.id = du.device_id
                 WHERE d.device_code = :device_code
                   AND (du.id = :row_id OR du.uid = :identifier OR du.employee_code = :identifier OR du.device_user_id = :identifier)',
                [
                    'device_code' => $deviceCode,
                    'row_id' => (int) $identifier,
                    'identifier' => $identifier,
                ]
            );
        }
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function shifts(?Database $db = null): array
    {
        if ($db && $db->connected()) {
            $rows = $db->all(
                'SELECT id, shift_code, name, start_time, end_time, break_minutes, late_tolerance_minutes, is_active
                 FROM shifts
                 WHERE is_active = 1
                 ORDER BY start_time, name'
            );
            if ($rows) {
                return array_map(static function (array $row): array {
                    return [
                        'id' => (string) $row['shift_code'],
                        'shift_code' => (string) $row['shift_code'],
                        'name' => (string) $row['name'],
                        'start_time' => substr((string) $row['start_time'], 0, 5),
                        'end_time' => substr((string) $row['end_time'], 0, 5),
                        'break_minutes' => (int) ($row['break_minutes'] ?? 60),
                        'late_tolerance_minutes' => (int) ($row['late_tolerance_minutes'] ?? 5),
                        'is_active' => (int) ($row['is_active'] ?? 1) === 1,
                    ];
                }, $rows);
            }
        }

        $rows = read_json_file(ROOTPATH . 'shifts.json', []);
        return is_array($rows) ? $rows : [];
    }

    /**
     * @param array<string, mixed> $input
     */
    public static function saveShift(array $input, ?Database $db = null): void
    {
        $shift = [
            'shift_code' => self::slug((string) ($input['shift_code'] ?? $input['name'] ?? 'shift')),
            'name' => trim((string) ($input['name'] ?? 'Shift')),
            'start_time' => trim((string) ($input['start_time'] ?? '08:00')),
            'end_time' => trim((string) ($input['end_time'] ?? '17:00')),
            'break_minutes' => max(0, (int) clean_number($input['break_minutes'] ?? 60)),
            'late_tolerance_minutes' => max(0, (int) clean_number($input['late_tolerance_minutes'] ?? 5)),
        ];

        if ($db && $db->connected()) {
            $db->execute(
                'INSERT INTO shifts (shift_code, name, start_time, end_time, break_minutes, late_tolerance_minutes)
                 VALUES (:shift_code, :name, :start_time, :end_time, :break_minutes, :late_tolerance_minutes)
                 ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    start_time = VALUES(start_time),
                    end_time = VALUES(end_time),
                    break_minutes = VALUES(break_minutes),
                    late_tolerance_minutes = VALUES(late_tolerance_minutes),
                    updated_at = NOW()',
                $shift
            );
        }

        $rows = read_json_file(ROOTPATH . 'shifts.json', []);
        $saved = [
            'id' => $shift['shift_code'],
            'name' => $shift['name'],
            'start_time' => $shift['start_time'],
            'end_time' => $shift['end_time'],
            'break_minutes' => $shift['break_minutes'],
            'late_tolerance_minutes' => $shift['late_tolerance_minutes'],
            'is_active' => true,
        ];

        $found = false;
        foreach ($rows as &$row) {
            if ((string) ($row['id'] ?? '') === $shift['shift_code']) {
                $row = $saved;
                $found = true;
                break;
            }
        }
        unset($row);

        if (!$found) {
            $rows[] = $saved;
        }

        write_json_file(ROOTPATH . 'shifts.json', $rows);
    }

    public static function deleteShift(string $shiftCode, ?Database $db = null): void
    {
        $shiftCode = trim($shiftCode);
        if ($shiftCode === '') {
            return;
        }

        if ($db && $db->connected()) {
            $db->execute('UPDATE shifts SET is_active = 0, updated_at = NOW() WHERE shift_code = :code', ['code' => $shiftCode]);
        }

        $rows = read_json_file(ROOTPATH . 'shifts.json', []);
        $rows = array_values(array_filter($rows, static function (array $row) use ($shiftCode): bool {
            return (string) ($row['id'] ?? '') !== $shiftCode;
        }));
        write_json_file(ROOTPATH . 'shifts.json', $rows);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function attendanceRows(?Database $db = null, int $limit = 200): array
    {
        if ($db && $db->connected()) {
            $rows = $db->all(
                'SELECT l.id, l.check_time, l.employee_code, COALESCE(u.full_name, l.user_name, l.employee_code) AS full_name,
                        d.device_code, d.name AS device_name, d.serial_number, l.punch_state, l.source_key
                 FROM attendance_logs l
                 LEFT JOIN fingerprint_users u ON u.id = l.fingerprint_user_id
                 LEFT JOIN devices d ON d.id = l.device_id
                 ORDER BY l.check_time DESC
                 LIMIT ' . max(1, $limit)
            );
            if ($rows) {
                return array_map(static function (array $row): array {
                    return [
                        'id' => (string) $row['id'],
                        'time' => (string) $row['check_time'],
                        'user_id' => (string) $row['employee_code'],
                        'name' => (string) $row['full_name'],
                        'device_code' => (string) ($row['device_code'] ?? ''),
                        'device_name' => (string) ($row['device_name'] ?? ''),
                        'device_sn' => (string) ($row['serial_number'] ?? ''),
                        'state' => (string) $row['punch_state'],
                        'source_key' => (string) ($row['source_key'] ?? ''),
                    ];
                }, $rows);
            }
        }

        $rows = read_json_file(ROOTPATH . 'attendance.json', []);
        return array_slice(array_reverse(is_array($rows) ? $rows : []), 0, $limit);
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<int, array<string, mixed>>
     */
    public static function attendanceRowsFiltered(?Database $db = null, array $filters = [], int $limit = 10000): array
    {
        $start = trim((string) ($filters['start_date'] ?? ''));
        $end = trim((string) ($filters['end_date'] ?? ''));
        $deviceCodes = $filters['device_codes'] ?? [];
        if (!is_array($deviceCodes)) {
            $deviceCodes = [$deviceCodes];
        }
        $deviceCodes = array_values(array_filter(array_map('strval', $deviceCodes), static fn (string $code): bool => trim($code) !== ''));

        if ($db && $db->connected()) {
            $where = [];
            $params = [];
            if ($start !== '') {
                $where[] = 'DATE(l.check_time) >= :start_date';
                $params['start_date'] = $start;
            }
            if ($end !== '') {
                $where[] = 'DATE(l.check_time) <= :end_date';
                $params['end_date'] = $end;
            }
            if ($deviceCodes) {
                $holders = [];
                foreach ($deviceCodes as $index => $code) {
                    $key = 'device_code_' . $index;
                    $holders[] = ':' . $key;
                    $params[$key] = $code;
                }
                $where[] = 'd.device_code IN (' . implode(',', $holders) . ')';
            }

            $sql = 'SELECT l.id, l.check_time, l.employee_code,
                          COALESCE(du.full_name, u.full_name, l.user_name, l.employee_code) AS full_name,
                          d.device_code, d.name AS device_name, d.location AS device_location, d.serial_number,
                          l.punch_state, l.source_key
                   FROM attendance_logs l
                   LEFT JOIN devices d ON d.id = l.device_id
                   LEFT JOIN fingerprint_users u ON u.id = l.fingerprint_user_id
                   LEFT JOIN device_users du ON du.device_id = l.device_id AND du.employee_code = l.employee_code';
            if ($where) {
                $sql .= ' WHERE ' . implode(' AND ', $where);
            }
            $sql .= ' ORDER BY d.name, l.employee_code, l.check_time ASC LIMIT ' . max(1, $limit);

            return array_map(static function (array $row): array {
                return [
                    'id' => (string) $row['id'],
                    'time' => (string) $row['check_time'],
                    'user_id' => (string) $row['employee_code'],
                    'name' => (string) $row['full_name'],
                    'device_code' => (string) ($row['device_code'] ?? ''),
                    'device_name' => (string) ($row['device_name'] ?? ''),
                    'device_location' => (string) ($row['device_location'] ?? ''),
                    'device_sn' => (string) ($row['serial_number'] ?? ''),
                    'state' => (string) $row['punch_state'],
                    'source_key' => (string) ($row['source_key'] ?? ''),
                ];
            }, $db->all($sql, $params));
        }

        $rows = self::attendanceRows($db, $limit);
        return array_values(array_filter($rows, static function (array $row) use ($start, $end, $deviceCodes): bool {
            $date = substr((string) ($row['time'] ?? ''), 0, 10);
            if ($start !== '' && $date < $start) {
                return false;
            }
            if ($end !== '' && $date > $end) {
                return false;
            }
            return !$deviceCodes || in_array((string) ($row['device_code'] ?? $row['device_id'] ?? ''), $deviceCodes, true);
        }));
    }

    /**
     * @param array<string, mixed> $input
     */
    public static function saveAttendance(array $input, ?Database $db = null): void
    {
        $employeeCode = trim((string) ($input['employee_code'] ?? ''));
        $deviceCode = trim((string) ($input['device_code'] ?? ''));
        $checkTime = self::normalizeDateTime((string) ($input['check_time'] ?? app_now())) ?? app_now();
        $state = self::normalizePunchState((string) ($input['punch_state'] ?? 'IN'));

        if ($employeeCode === '') {
            return;
        }

        $users = self::fingerprintUsers($db);
        $userName = '';
        foreach ($users as $user) {
            if ((string) $user['employee_code'] === $employeeCode) {
                $userName = (string) $user['full_name'];
                break;
            }
        }

        $deviceName = '';
        $deviceSn = '';
        foreach (self::devices($db) as $device) {
            if ((string) $device['device_code'] === $deviceCode) {
                $deviceName = (string) $device['name'];
                $deviceSn = (string) $device['serial_number'];
                break;
            }
        }

        if ($db && $db->connected()) {
            $userId = self::fingerprintUserId($employeeCode, $db);
            $deviceId = self::deviceDbId($deviceCode, $db);

            $db->execute(
                'INSERT INTO attendance_logs (device_id, fingerprint_user_id, employee_code, user_name, check_time, punch_state, raw_payload, source_key)
                 VALUES (:device_id, :fingerprint_user_id, :employee_code, :user_name, :check_time, :punch_state, :raw_payload, :source_key)',
                [
                    'device_id' => $deviceId,
                    'fingerprint_user_id' => $userId,
                    'employee_code' => $employeeCode,
                    'user_name' => $userName,
                    'check_time' => $checkTime,
                    'punch_state' => $state,
                    'raw_payload' => json_encode(['source' => 'manual-xampp'], JSON_UNESCAPED_SLASHES),
                    'source_key' => 'manual-' . md5($deviceCode . '|' . $employeeCode . '|' . $checkTime . '|' . microtime(true)),
                ]
            );
        }

        $rows = read_json_file(ROOTPATH . 'attendance.json', []);
        $rows[] = [
            'id' => 'att-' . date('YmdHis') . '-' . random_int(100, 999),
            'time' => $checkTime,
            'user_id' => $employeeCode,
            'name' => $userName ?: $employeeCode,
            'device_id' => $deviceCode,
            'device_name' => $deviceName,
            'device_sn' => $deviceSn,
            'state' => $state,
        ];
        write_json_file(ROOTPATH . 'attendance.json', $rows);
    }

    /**
     * @param array<int, array<string, mixed>> $logs
     */
    public static function mergeAttendanceLogs(string $deviceCode, array $logs, ?Database $db = null): int
    {
        if (!$db || !$db->connected()) {
            $rows = read_json_file(ROOTPATH . 'attendance.json', []);
            foreach ($logs as $log) {
                $rows[] = [
                    'id' => (string) ($log['source_key'] ?? ('att-' . random_int(1000, 9999))),
                    'time' => (string) ($log['check_time'] ?? ''),
                    'user_id' => (string) ($log['employee_code'] ?? ''),
                    'name' => (string) ($log['employee_code'] ?? ''),
                    'device_id' => $deviceCode,
                    'state' => self::normalizePunchState((string) ($log['punch_state'] ?? 'UNKNOWN')),
                ];
            }
            write_json_file(ROOTPATH . 'attendance.json', $rows);
            return count($logs);
        }

        $device = self::deviceByCode($deviceCode, $db);
        $deviceId = $device ? (int) ($device['id'] ?? 0) : null;
        $inserted = 0;
        $userIdCache = [];
        $inTransaction = $db->begin();

        try {
            foreach ($logs as $log) {
                $employeeCode = trim((string) ($log['employee_code'] ?? ''));
                $checkTime = self::normalizeDateTime((string) ($log['check_time'] ?? ''));
                if ($employeeCode === '' || $checkTime === null) {
                    continue;
                }

                $sourceKey = trim((string) ($log['source_key'] ?? ''));
                if ($sourceKey === '') {
                    $sourceKey = md5($deviceCode . '|' . $employeeCode . '|' . $checkTime . '|' . ($log['punch_state'] ?? 'UNKNOWN'));
                }

                if (!array_key_exists($employeeCode, $userIdCache)) {
                    $fingerprintUserId = self::fingerprintUserId($employeeCode, $db);
                    if (!$fingerprintUserId) {
                        $fingerprintUserId = self::upsertFingerprintUserFromDevice([
                            'employee_code' => $employeeCode,
                            'full_name' => $employeeCode,
                            'device_user_id' => $employeeCode,
                        ], $db);
                    }
                    $userIdCache[$employeeCode] = $fingerprintUserId;
                }

                $db->execute(
                    'INSERT INTO attendance_logs
                        (device_id, fingerprint_user_id, employee_code, user_name, check_time, punch_state, raw_payload, source_key)
                     VALUES
                        (:device_id, :fingerprint_user_id, :employee_code, :user_name, :check_time, :punch_state, :raw_payload, :source_key)
                     ON DUPLICATE KEY UPDATE
                        fingerprint_user_id = VALUES(fingerprint_user_id),
                        user_name = VALUES(user_name),
                        punch_state = VALUES(punch_state),
                        raw_payload = VALUES(raw_payload)',
                    [
                        'device_id' => $deviceId ?: null,
                        'fingerprint_user_id' => $userIdCache[$employeeCode],
                        'employee_code' => $employeeCode,
                        'user_name' => (string) ($log['user_name'] ?? ''),
                        'check_time' => $checkTime,
                        'punch_state' => self::normalizePunchState((string) ($log['punch_state'] ?? 'UNKNOWN')),
                        'raw_payload' => json_encode($log['raw'] ?? $log, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                        'source_key' => $sourceKey,
                    ]
                );
                $inserted++;
            }

            if ($inTransaction) {
                $db->commit();
            }
        } catch (\Throwable $e) {
            if ($inTransaction) {
                $db->rollBack();
            }
            throw $e;
        }

        return $inserted;
    }

    /**
     * @return array<string, mixed>
     */
    public static function dashboardStats(?Database $db = null): array
    {
        $devices = self::devices($db);
        $users = self::fingerprintUsers($db);
        $attendance = self::attendanceRows($db, 500);
        $shifts = self::shifts($db);

        return [
            'devices' => count($devices),
            'online_devices' => count(array_filter($devices, static fn (array $device): bool => !empty($device['is_online']))),
            'users' => count($users),
            'attendance_today' => count(array_filter($attendance, static fn (array $row): bool => substr((string) ($row['time'] ?? ''), 0, 10) === app_now('Y-m-d'))),
            'shifts' => count($shifts),
            'mode' => $db && $db->connected() ? 'MySQL' : 'JSON Demo',
        ];
    }

    /**
     * @return array<int, array<string, string>>
     */
    public static function backupFiles(): array
    {
        $dir = ROOTPATH . 'database-backups';
        if (!is_dir($dir)) {
            return [];
        }

        $files = glob($dir . DIRECTORY_SEPARATOR . '*.sql') ?: [];
        rsort($files);

        return array_map(static function (string $file): array {
            return [
                'name' => basename($file),
                'size' => number_format((filesize($file) ?: 0) / 1024, 1) . ' KB',
                'created_at' => date('Y-m-d H:i:s', filemtime($file) ?: time()),
            ];
        }, $files);
    }

    public static function createSchemaBackup(): string
    {
        $source = ROOTPATH . 'database' . DIRECTORY_SEPARATOR . 'ci4_schema.sql';
        if (!is_file($source)) {
            $source = ROOTPATH . 'database.sql';
        }

        $dir = ROOTPATH . 'database-backups';
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        $filename = 'finger-ci4-schema-' . app_now('Ymd-His') . '.sql';
        copy($source, $dir . DIRECTORY_SEPARATOR . $filename);

        return $filename;
    }

    public static function recordAdmsRequest(string $serialNumber, string $remoteIp, string $method, string $uri, string $payload, ?Database $db = null): void
    {
        if ($db && $db->connected()) {
            $db->execute(
                'INSERT INTO adms_requests (serial_number, remote_ip, request_method, request_uri, payload)
                 VALUES (:serial_number, :remote_ip, :request_method, :request_uri, :payload)',
                [
                    'serial_number' => self::nullIfEmpty($serialNumber),
                    'remote_ip' => self::nullIfEmpty($remoteIp),
                    'request_method' => strtoupper($method),
                    'request_uri' => $uri,
                    'payload' => $payload,
                ]
            );
        }

        if ($serialNumber !== '') {
            self::upsertDeviceFromAdms($serialNumber, $remoteIp, $db);
        }
    }

    public static function upsertDeviceFromAdms(string $serialNumber, string $remoteIp, ?Database $db = null): void
    {
        $serialNumber = trim($serialNumber);
        if ($serialNumber === '' || !$db || !$db->connected()) {
            return;
        }

        $deviceCode = self::slug('sn-' . $serialNumber);
        $db->execute(
            'INSERT INTO devices (device_code, name, serial_number, public_ip, port, protocol, is_active, last_detected_at)
             VALUES (:device_code, :name, :serial_number, :public_ip, 4370, :protocol, 1, NOW())
             ON DUPLICATE KEY UPDATE
                public_ip = COALESCE(VALUES(public_ip), public_ip),
                protocol = VALUES(protocol),
                is_active = 1,
                last_detected_at = NOW(),
                updated_at = NOW()',
            [
                'device_code' => $deviceCode,
                'name' => 'ADMS ' . $serialNumber,
                'serial_number' => $serialNumber,
                'public_ip' => self::nullIfEmpty($remoteIp),
                'protocol' => 'adms',
            ]
        );
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function mapDeviceRow(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'device_code' => (string) $row['device_code'],
            'name' => (string) $row['name'],
            'serial_number' => (string) ($row['serial_number'] ?? ''),
            'ip_address' => (string) ($row['ip_address'] ?? ''),
            'public_ip' => (string) ($row['public_ip'] ?? ''),
            'tailscale_ip' => (string) ($row['tailscale_ip'] ?? ''),
            'preferred_host' => self::preferredHost((string) ($row['preferred_host'] ?? 'auto')),
            'host' => DeviceBridge::hostFor($row),
            'port' => (int) ($row['port'] ?? 4370),
            'location' => (string) ($row['location'] ?? ''),
            'brand' => (string) ($row['brand'] ?? 'ZKTeco Compatible'),
            'protocol' => (string) ($row['protocol'] ?? 'zk-tcp'),
            'timezone' => self::validTimezone((string) ($row['timezone'] ?? self::settings()['timezone'] ?? 'Asia/Jakarta')),
            'timezone_label' => self::timezoneLabel((string) ($row['timezone'] ?? self::settings()['timezone'] ?? 'Asia/Jakarta')),
            'adms_ip' => (string) ($row['adms_ip'] ?? ''),
            'adms_domain' => (string) ($row['adms_domain'] ?? ''),
            'adms_port' => (int) ($row['adms_port'] ?? 0),
            'adms_url' => (string) ($row['adms_url'] ?? ''),
            'last_detected_at' => (string) ($row['last_detected_at'] ?? ''),
            'is_active' => (int) ($row['is_active'] ?? 1) === 1,
            'is_online' => (int) ($row['is_online'] ?? 0) === 1,
            'message' => (string) ($row['message'] ?? ''),
            'checked_at' => (string) ($row['checked_at'] ?? ''),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private static function configDevices(): array
    {
        $config = read_json_file(ROOTPATH . 'config.json', []);
        $status = read_json_file(ROOTPATH . 'device-status.json', []);
        $devices = $config['devices'] ?? [];

        return array_map(static function (array $device) use ($status, $config): array {
            $code = (string) ($device['id'] ?? $device['sn'] ?? '');
            $state = is_array($status[$code] ?? null) ? $status[$code] : [];
            $mapped = [
                'id' => $code,
                'device_code' => $code,
                'name' => (string) ($device['name'] ?? 'Mesin Fingerprint'),
                'serial_number' => (string) ($device['sn'] ?? ''),
                'ip_address' => (string) ($device['ip'] ?? ''),
                'public_ip' => (string) ($device['public_ip'] ?? ''),
                'tailscale_ip' => (string) ($device['tailscale_ip'] ?? ''),
                'preferred_host' => self::preferredHost((string) ($device['preferred_host'] ?? 'auto')),
                'port' => (int) ($device['port'] ?? 4370),
                'location' => (string) ($device['location'] ?? ''),
                'brand' => (string) ($device['brand'] ?? 'ZKTeco Compatible'),
                'protocol' => (string) ($device['protocol'] ?? 'zk-tcp'),
                'timezone' => self::validTimezone((string) ($device['timezone'] ?? $config['timezone'] ?? 'Asia/Jakarta')),
                'timezone_label' => self::timezoneLabel((string) ($device['timezone'] ?? $config['timezone'] ?? 'Asia/Jakarta')),
                'adms_ip' => (string) ($device['adms_ip'] ?? $config['adms_ip'] ?? ''),
                'adms_domain' => (string) ($device['adms_domain'] ?? $config['adms_domain'] ?? ''),
                'adms_port' => (int) ($device['adms_port'] ?? $config['adms_port'] ?? 0),
                'adms_url' => (string) ($device['adms_url'] ?? $config['adms_url'] ?? ''),
                'last_detected_at' => (string) ($device['last_detected_at'] ?? ''),
                'is_active' => true,
                'is_online' => (bool) ($state['online'] ?? false),
                'message' => (string) ($state['message'] ?? ''),
                'checked_at' => (string) ($state['checked_at'] ?? ''),
            ];
            $mapped['host'] = DeviceBridge::hostFor($mapped);
            return $mapped;
        }, is_array($devices) ? $devices : []);
    }

    /**
     * @param array<string, mixed> $device
     */
    private static function saveDeviceToConfig(array $device): void
    {
        $config = read_json_file(ROOTPATH . 'config.json', ['devices' => []]);
        $rows = is_array($config['devices'] ?? null) ? $config['devices'] : [];
        $saved = [
            'id' => $device['device_code'],
            'name' => $device['name'],
            'ip' => (string) ($device['ip_address'] ?? ''),
            'public_ip' => (string) ($device['public_ip'] ?? ''),
            'tailscale_ip' => (string) ($device['tailscale_ip'] ?? ''),
            'preferred_host' => self::preferredHost((string) ($device['preferred_host'] ?? 'auto')),
            'port' => (int) ($device['port'] ?? 4370),
            'sn' => (string) ($device['serial_number'] ?? ''),
            'location' => (string) ($device['location'] ?? ''),
            'brand' => (string) ($device['brand'] ?? 'ZKTeco Compatible'),
            'protocol' => (string) ($device['protocol'] ?? 'zk-tcp'),
            'timezone' => self::validTimezone((string) ($device['timezone'] ?? 'Asia/Jakarta')),
            'adms_ip' => (string) ($device['adms_ip'] ?? ''),
            'adms_domain' => (string) ($device['adms_domain'] ?? ''),
            'adms_port' => (int) ($device['adms_port'] ?? 0),
            'adms_url' => (string) ($device['adms_url'] ?? ''),
            'last_detected_at' => app_now(),
        ];

        $found = false;
        foreach ($rows as &$row) {
            if ((string) ($row['id'] ?? '') === $device['device_code']) {
                $row = $saved;
                $found = true;
                break;
            }
        }
        unset($row);

        if (!$found) {
            $rows[] = $saved;
        }

        $config['devices'] = $rows;
        write_json_file(ROOTPATH . 'config.json', $config);
    }

    /**
     * @param array<string, mixed> $row
     */
    private static function upsertFingerprintUserFromDevice(array $row, Database $db): ?int
    {
        $employeeCode = trim((string) ($row['employee_code'] ?? $row['device_user_id'] ?? $row['uid'] ?? ''));
        if ($employeeCode === '') {
            return null;
        }

        $fullName = trim((string) ($row['full_name'] ?? $row['name'] ?? $employeeCode));
        $db->execute(
            'INSERT INTO fingerprint_users (employee_code, full_name, card_number, device_user_id, is_active)
             VALUES (:employee_code, :full_name, :card_number, :device_user_id, 1)
             ON DUPLICATE KEY UPDATE
                full_name = IF(VALUES(full_name) = employee_code OR VALUES(full_name) = "", full_name, VALUES(full_name)),
                card_number = COALESCE(VALUES(card_number), card_number),
                device_user_id = COALESCE(VALUES(device_user_id), device_user_id),
                is_active = 1,
                updated_at = NOW()',
            [
                'employee_code' => $employeeCode,
                'full_name' => $fullName !== '' ? $fullName : $employeeCode,
                'card_number' => self::nullIfEmpty($row['card_number'] ?? null),
                'device_user_id' => self::nullIfEmpty($row['device_user_id'] ?? $employeeCode),
            ]
        );

        return self::fingerprintUserId($employeeCode, $db);
    }

    private static function fingerprintUserId(string $employeeCode, ?Database $db = null): ?int
    {
        if (!$db || !$db->connected() || trim($employeeCode) === '') {
            return null;
        }

        $rows = $db->all('SELECT id FROM fingerprint_users WHERE employee_code = :code LIMIT 1', ['code' => $employeeCode]);
        return $rows ? (int) $rows[0]['id'] : null;
    }

    private static function normalizePunchState(string $state): string
    {
        $state = strtoupper(trim($state));
        if (in_array($state, ['IN', 'CHECK_IN', 'MASUK', '0'], true)) {
            return 'IN';
        }
        if (in_array($state, ['OUT', 'CHECK_OUT', 'PULANG', '1'], true)) {
            return 'OUT';
        }
        if (in_array($state, ['BREAK_OUT', 'ISTIRAHAT_KELUAR', '2'], true)) {
            return 'BREAK_OUT';
        }
        if (in_array($state, ['BREAK_IN', 'ISTIRAHAT_MASUK', '3'], true)) {
            return 'BREAK_IN';
        }
        return 'UNKNOWN';
    }

    private static function normalizeDateTime(string $value): ?string
    {
        $value = trim(str_replace('T', ' ', $value));
        if ($value === '') {
            return null;
        }

        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/', $value, $match)) {
            return $match[1] . '-' . $match[2] . '-' . $match[3] . ' ' . $match[4] . ':' . $match[5] . ':' . ($match[6] ?? '00');
        }

        if (preg_match('/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/', $value, $match)) {
            $months = [
                'JAN' => '01', 'FEB' => '02', 'MAR' => '03', 'APR' => '04',
                'MAY' => '05', 'JUN' => '06', 'JUL' => '07', 'AUG' => '08',
                'SEP' => '09', 'OCT' => '10', 'NOV' => '11', 'DEC' => '12',
            ];
            $month = $months[strtoupper($match[1])] ?? null;
            if ($month) {
                return $match[3] . '-' . $month . '-' . str_pad($match[2], 2, '0', STR_PAD_LEFT) . ' ' . $match[4] . ':' . $match[5] . ':' . $match[6];
            }
        }

        $time = strtotime($value);
        return $time ? date('Y-m-d H:i:s', $time) : null;
    }

    private static function validTimezone(string $timezone): string
    {
        $timezone = trim($timezone);
        return in_array($timezone, self::timezones(), true) ? $timezone : 'Asia/Jakarta';
    }

    private static function preferredHost(string $value): string
    {
        $value = strtolower(trim($value));
        return in_array($value, ['auto', 'local', 'public', 'tailscale'], true) ? $value : 'auto';
    }

    /**
     * @param array<string, mixed> $payload
     */
    private static function compactPayload(array $payload): string
    {
        $data = $payload;
        if (isset($data['data']) && is_array($data['data'])) {
            $count = count($data['data']);
            if ($count > 20) {
                $data['data_count'] = $count;
                $data['data_sample'] = array_slice($data['data'], 0, 5);
                unset($data['data']);
            }
        }

        $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '{}';
        if (strlen($json) > 60000) {
            $json = json_encode([
                'ok' => $payload['ok'] ?? null,
                'error' => $payload['error'] ?? null,
                'message' => $payload['message'] ?? null,
                'payload_truncated' => true,
                'original_bytes' => strlen($json),
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '{}';
        }

        return $json;
    }

    private static function optionalInt($value): ?int
    {
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        return max(0, (int) clean_number($value));
    }

    private static function nullIfEmpty($value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);
        return $value === '' ? null : $value;
    }

    private static function slug(string $value): string
    {
        $value = strtolower(trim($value));
        $value = preg_replace('/[^a-z0-9]+/', '-', $value) ?: 'item';
        $value = trim($value, '-');
        return $value !== '' ? $value : 'item';
    }
}
