<?php
declare(strict_types=1);

function e($value): string
{
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES, 'UTF-8');
}

function rupiah($value): string
{
    return 'Rp.' . number_format((float) $value, 0, ',', '.');
}

function url_to(string $path = ''): string
{
    $base = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? ''), '/\\');
    if ($base === '/' || $base === '.') {
        $base = '';
    }

    return $base . '/' . ltrim($path, '/');
}

function asset_url(string $path): string
{
    return url_to('public/assets/' . ltrim($path, '/'));
}

function active_nav(string $current, string $target): string
{
    return $current === $target ? 'active' : '';
}

function request_value(string $key, $default = '')
{
    return $_POST[$key] ?? $_GET[$key] ?? $default;
}

function app_now(string $format = 'Y-m-d H:i:s'): string
{
    $settings = read_json_file((defined('ROOTPATH') ? ROOTPATH : __DIR__ . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR) . 'app-settings.json', []);
    $timezone = (string) ($settings['timezone'] ?? 'Asia/Jakarta');
    try {
        $tz = new DateTimeZone($timezone);
    } catch (Throwable $e) {
        $tz = new DateTimeZone('Asia/Jakarta');
    }
    return (new DateTimeImmutable('now', $tz))->format($format);
}

function date_range_list(string $start, string $end): array
{
    try {
        $from = new DateTimeImmutable($start);
        $to = new DateTimeImmutable($end);
    } catch (Throwable $e) {
        $from = new DateTimeImmutable(app_now('Y-m-d'));
        $to = $from;
    }

    if ($to < $from) {
        $to = $from;
    }

    $days = [];
    for ($date = $from; $date <= $to; $date = $date->modify('+1 day')) {
        $days[] = $date->format('Y-m-d');
    }

    return $days;
}

function read_json_file(string $file, $fallback)
{
    if (!is_file($file)) {
        return $fallback;
    }

    $json = file_get_contents($file);
    $data = json_decode((string) $json, true);

    return is_array($data) ? $data : $fallback;
}

function write_json_file(string $file, array $data): void
{
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}

function clean_number($value): float
{
    if (is_array($value)) {
        return 0;
    }

    $normalized = preg_replace('/[^0-9\.\-]/', '', (string) $value);
    return (float) ($normalized === '' ? 0 : $normalized);
}

function transaction_number(): string
{
    return 'P' . app_now('Ymd') . '001';
}
