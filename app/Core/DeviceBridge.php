<?php
declare(strict_types=1);

namespace App\Core;

final class DeviceBridge
{
    /**
     * @param array<string, mixed> $params
     * @return array<string, mixed>
     */
    public static function run(string $action, array $params = [], int $timeoutSeconds = 45): array
    {
        $script = ROOTPATH . 'bridge' . DIRECTORY_SEPARATOR . 'zk_device_cli.js';
        if (!is_file($script)) {
            return ['ok' => false, 'error' => 'Bridge Node tidak ditemukan.'];
        }

        $parts = [PHP_OS_FAMILY === 'Windows' ? 'node.exe' : 'node', $script, $action];
        foreach ($params as $key => $value) {
            if ($value === null || $value === '') {
                continue;
            }
            $parts[] = '--' . preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $key);
            $parts[] = (string) $value;
        }

        $descriptor = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $process = proc_open($parts, $descriptor, $pipes, ROOTPATH);
        if (!is_resource($process)) {
            return ['ok' => false, 'error' => 'Gagal menjalankan bridge Node.'];
        }

        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        $stdout = '';
        $stderr = '';
        $start = time();

        while (true) {
            $stdout .= stream_get_contents($pipes[1]) ?: '';
            $stderr .= stream_get_contents($pipes[2]) ?: '';
            $status = proc_get_status($process);

            if (!$status['running']) {
                break;
            }

            if ((time() - $start) > $timeoutSeconds) {
                proc_terminate($process);
                foreach ($pipes as $pipe) {
                    if (is_resource($pipe)) {
                        fclose($pipe);
                    }
                }
                proc_close($process);
                return ['ok' => false, 'error' => 'Bridge timeout setelah ' . $timeoutSeconds . ' detik.', 'stderr' => $stderr];
            }

            usleep(100000);
        }

        $stdout .= stream_get_contents($pipes[1]) ?: '';
        $stderr .= stream_get_contents($pipes[2]) ?: '';
        foreach ($pipes as $pipe) {
            if (is_resource($pipe)) {
                fclose($pipe);
            }
        }
        proc_close($process);

        $decoded = json_decode(trim($stdout), true);
        if (!is_array($decoded)) {
            return [
                'ok' => false,
                'error' => 'Output bridge bukan JSON valid.',
                'stdout' => $stdout,
                'stderr' => $stderr,
            ];
        }

        if ($stderr !== '') {
            $decoded['stderr'] = trim($stderr);
        }

        return $decoded;
    }

    /**
     * @param array<string, mixed> $device
     */
    public static function hostFor(array $device): string
    {
        $preferred = strtolower(trim((string) ($device['preferred_host'] ?? 'auto')));
        $preferredMap = [
            'local' => 'ip_address',
            'public' => 'public_ip',
            'tailscale' => 'tailscale_ip',
        ];
        if (isset($preferredMap[$preferred])) {
            $value = trim((string) ($device[$preferredMap[$preferred]] ?? ''));
            if ($value !== '') {
                return $value;
            }
        }

        foreach (['tailscale_ip', 'public_ip', 'ip_address'] as $key) {
            $value = trim((string) ($device[$key] ?? ''));
            if ($value !== '') {
                return $value;
            }
        }

        return '';
    }
}
