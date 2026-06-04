<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\AppData;
use App\Core\DeviceBridge;

final class AttendanceController extends BaseController
{
    public function index(): string
    {
        return $this->view('attendance/index', [
            'title' => 'Absensi',
            'active' => 'attendance',
            'rows' => AppData::attendanceRows($this->db, 200),
            'devices' => AppData::devices($this->db),
            'users' => AppData::fingerprintUsers($this->db),
            'saved' => request_value('saved', '') === '1',
            'message' => (string) request_value('message', ''),
            'error' => (string) request_value('error', ''),
        ]);
    }

    public function store(): string
    {
        AppData::saveAttendance($_POST, $this->db);
        return $this->redirect('/attendance?saved=1');
    }

    public function report(): string
    {
        $start = (string) request_value('start_date', app_now('Y-m-d'));
        $end = (string) request_value('end_date', app_now('Y-m-d'));
        $selectedDevices = $_GET['device_codes'] ?? [];
        if (!is_array($selectedDevices)) {
            $selectedDevices = [$selectedDevices];
        }
        $selectedDevices = array_values(array_filter(array_map('strval', $selectedDevices)));

        $devices = AppData::devices($this->db);
        if (!$selectedDevices) {
            $selectedDevices = array_map(static fn (array $device): string => (string) $device['device_code'], $devices);
        }
        $dates = date_range_list($start, $end);
        $rows = AppData::attendanceRowsFiltered($this->db, [
            'start_date' => $start,
            'end_date' => $end,
            'device_codes' => $selectedDevices,
        ], 50000);
        $settings = AppData::settings($this->db);
        $sections = [];
        foreach ($devices as $device) {
            if (!in_array((string) $device['device_code'], $selectedDevices, true)) {
                continue;
            }
            $deviceRows = array_values(array_filter($rows, static fn (array $row): bool => (string) ($row['device_code'] ?? '') === (string) $device['device_code']));
            $sections[] = [
                'device' => $device,
                'pivot' => $this->buildPivot($deviceRows, $dates, (string) ($settings['work_start_time'] ?? '08:00')),
            ];
        }

        return $this->view('attendance/report', [
            'title' => 'Laporan Absensi',
            'active' => 'attendance-report',
            'start' => $start,
            'end' => $end,
            'dates' => $dates,
            'devices' => $devices,
            'selectedDevices' => $selectedDevices,
            'sections' => $sections,
        ]);
    }

    public function pullDevice(): string
    {
        $deviceCode = (string) request_value('device_code', '');
        $device = AppData::deviceByCode($deviceCode, $this->db);
        if (!$device) {
            return $this->redirect('/attendance?error=' . rawurlencode('Mesin tidak ditemukan.'));
        }

        $result = DeviceBridge::run('read-logs', [
            'host' => DeviceBridge::hostFor($device),
            'port' => (int) ($device['port'] ?? 4370),
            'device_code' => (string) $device['device_code'],
            'serial_number' => (string) ($device['serial_number'] ?? ''),
        ], 90);

        if (!empty($result['ok'])) {
            $count = AppData::mergeAttendanceLogs((string) $device['device_code'], is_array($result['data'] ?? null) ? $result['data'] : [], $this->db);
            $message = 'Tarik absensi nyata selesai dari ' . $device['name'] . ': ' . $count . ' log diproses.';
            AppData::saveDeviceStatus((string) $device['device_code'], true, $message, $this->db, $result);
            AppData::logDeviceAction((string) $device['device_code'], 'read-logs', true, $message, $result, $this->db);
            return $this->redirect('/attendance?message=' . rawurlencode($message));
        }

        $message = (string) ($result['message'] ?? $result['error'] ?? 'Gagal tarik absensi dari mesin.');
        AppData::saveDeviceStatus((string) $device['device_code'], false, $message, $this->db, $result);
        AppData::logDeviceAction((string) $device['device_code'], 'read-logs', false, $message, $result, $this->db);
        return $this->redirect('/attendance?error=' . rawurlencode($message));
    }

    public function pullAll(): string
    {
        $summary = $this->pullDevicesFromMachines(90);

        return $this->redirect('/attendance?message=' . rawurlencode('Tarik semua selesai: ' . $summary['success'] . ' mesin sukses, ' . $summary['failed'] . ' gagal, ' . $summary['logs'] . ' log diproses.'));
    }

    public function realtimePull(): string
    {
        $summary = $this->pullDevicesFromMachines(90);
        header('Content-Type: application/json; charset=utf-8');
        return json_encode([
            'ok' => $summary['failed'] === 0,
            'success' => $summary['success'],
            'failed' => $summary['failed'],
            'logs' => $summary['logs'],
            'checked_at' => app_now(),
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '{"ok":false}';
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @param array<int, string> $dates
     * @return array<string, array<string, mixed>>
     */
    private function buildPivot(array $rows, array $dates, string $workStartTime = '08:00'): array
    {
        $pivot = [];
        $dateMap = array_flip($dates);

        foreach ($rows as $row) {
            $employeeCode = (string) ($row['user_id'] ?? '-');
            $name = (string) ($row['name'] ?? $employeeCode);
            $timeRaw = (string) ($row['time'] ?? '');
            $date = substr($timeRaw, 0, 10);

            if (!isset($dateMap[$date])) {
                continue;
            }

            if (!isset($pivot[$employeeCode])) {
                $pivot[$employeeCode] = [
                    'employee_code' => $employeeCode,
                    'name' => $name,
                    'days' => array_fill_keys($dates, ['in' => '', 'out' => '']),
                    'recap' => ['hadir' => 0, 'telat' => 0, 'alpa' => 0],
                ];
            }

            $hour = substr($timeRaw, 11, 5);
            $state = strtoupper((string) ($row['state'] ?? ''));
            $isOut = in_array($state, ['OUT', 'CHECK_OUT', 'PULANG'], true) || strpos($state, 'OUT') !== false;

            if ($isOut) {
                $pivot[$employeeCode]['days'][$date]['out'] = $hour;
            } elseif ($pivot[$employeeCode]['days'][$date]['in'] === '' || $hour < $pivot[$employeeCode]['days'][$date]['in']) {
                $pivot[$employeeCode]['days'][$date]['in'] = $hour;
            }
        }

        foreach ($pivot as &$user) {
            foreach ($dates as $date) {
                $in = $user['days'][$date]['in'];
                if ($in !== '') {
                    $user['recap']['hadir']++;
                    if ($in > $this->lateThreshold($workStartTime)) {
                        $user['recap']['telat']++;
                    }
                } else {
                    $user['recap']['alpa']++;
                }
            }
        }
        unset($user);

        return $pivot;
    }

    private function lateThreshold(string $workStartTime): string
    {
        $start = substr($workStartTime, 0, 5) ?: '08:00';
        $time = strtotime('2000-01-01 ' . $start);
        return $time ? date('H:i', $time + 300) : '08:05';
    }

    /**
     * @return array{success:int, failed:int, logs:int}
     */
    private function pullDevicesFromMachines(int $timeoutSeconds): array
    {
        $success = 0;
        $failed = 0;
        $logs = 0;

        foreach (AppData::devices($this->db) as $device) {
            $result = DeviceBridge::run('read-logs', [
                'host' => DeviceBridge::hostFor($device),
                'port' => (int) ($device['port'] ?? 4370),
                'device_code' => (string) $device['device_code'],
                'serial_number' => (string) ($device['serial_number'] ?? ''),
            ], $timeoutSeconds);

            if (!empty($result['ok'])) {
                $count = AppData::mergeAttendanceLogs((string) $device['device_code'], is_array($result['data'] ?? null) ? $result['data'] : [], $this->db);
                $logs += $count;
                $success++;
                AppData::saveDeviceStatus((string) $device['device_code'], true, 'Tarik absensi berhasil: ' . $count . ' log.', $this->db, $result);
                AppData::logDeviceAction((string) $device['device_code'], 'read-logs', true, 'Tarik absensi berhasil: ' . $count . ' log.', $result, $this->db);
            } else {
                $failed++;
                $message = (string) ($result['message'] ?? $result['error'] ?? 'Gagal tarik absensi.');
                AppData::saveDeviceStatus((string) $device['device_code'], false, $message, $this->db, $result);
                AppData::logDeviceAction((string) $device['device_code'], 'read-logs', false, $message, $result, $this->db);
            }
        }

        return ['success' => $success, 'failed' => $failed, 'logs' => $logs];
    }
}
