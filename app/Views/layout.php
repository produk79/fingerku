<?php
$active = $active ?? '';
$title = $title ?? 'CSL Fingerprint';
$settings = $settings ?? ['app_name' => 'CSL Fingerprint', 'company_name' => 'CSL Digital'];
?>
<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($title) ?> | <?= e($settings['app_name'] ?? 'CSL Fingerprint') ?></title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
    <link rel="stylesheet" href="<?= e(asset_url('app.css')) ?>">
</head>
<body>
<div class="app-shell">
    <?php require APPPATH . 'Views' . DIRECTORY_SEPARATOR . 'partials' . DIRECTORY_SEPARATOR . 'sidebar.php'; ?>

    <main class="app-main">
        <header class="topbar">
            <button class="btn btn-icon d-lg-none" type="button" data-mobile-nav aria-label="Buka menu">
                <i class="bi bi-list"></i>
            </button>
            <div>
                <p class="topbar-label mb-1"><?= e($settings['company_name'] ?? 'CSL Digital') ?></p>
                <h1><?= e($title) ?></h1>
            </div>
            <div class="topbar-status">
                <span class="status-dot <?= !empty($dbConnected) ? 'online' : 'offline' ?>"></span>
                <span><?= !empty($dbConnected) ? 'MySQL aktif' : 'Mode JSON demo' ?></span>
            </div>
        </header>

        <?php if (empty($dbConnected) && !empty($dbError)): ?>
            <div class="alert alert-soft-warning" role="alert">
                <i class="bi bi-database-exclamation"></i>
                Database MySQL belum tersambung. Aplikasi tetap berjalan memakai file JSON lokal. Import schema dari menu Backup saat database sudah dibuat.
            </div>
        <?php endif; ?>

        <?= $content ?? '' ?>
    </main>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="<?= e(asset_url('app.js')) ?>"></script>
</body>
</html>
