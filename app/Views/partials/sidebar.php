<?php
$items = [
    ['dashboard', '/', 'bi-speedometer2', 'Dashboard'],
    ['devices', '/devices', 'bi-router', 'Mesin'],
    ['device-detect', '/devices/detect', 'bi-radar', 'Detek Mesin'],
    ['device-users', '/devices/users', 'bi-person-lines-fill', 'User Mesin'],
    ['users', '/users', 'bi-people', 'User'],
    ['attendance', '/attendance', 'bi-fingerprint', 'Absensi'],
    ['attendance-report', '/attendance/report', 'bi-calendar2-check', 'Laporan'],
    ['shifts', '/shifts', 'bi-clock-history', 'Shift'],
    ['backup', '/backup', 'bi-database-down', 'Backup'],
    ['settings', '/settings', 'bi-sliders', 'Pengaturan'],
];
?>
<aside class="app-sidebar" data-sidebar>
    <a class="brand" href="<?= e(url_to('/')) ?>">
        <span class="brand-mark">CF</span>
        <span>
            <strong><?= e($settings['app_name'] ?? 'CSL Fingerprint') ?></strong>
            <small>CI4 XAMPP Admin</small>
        </span>
    </a>

    <nav class="nav-list" aria-label="Navigasi utama">
        <?php foreach ($items as [$key, $href, $icon, $label]): ?>
            <a class="<?= active_nav($active, $key) ?>" href="<?= e(url_to($href)) ?>">
                <i class="bi <?= e($icon) ?>"></i>
                <span><?= e($label) ?></span>
            </a>
        <?php endforeach; ?>
    </nav>

    <div class="sidebar-footer">
        <span class="small-label">Database</span>
        <a href="<?= e(url_to('/database-schema')) ?>" target="_blank">Lihat schema SQL</a>
    </div>
</aside>
<div class="sidebar-backdrop" data-sidebar-backdrop></div>
