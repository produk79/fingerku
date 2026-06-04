<?php
declare(strict_types=1);

$host = (string) ($_SERVER['HTTP_HOST'] ?? '127.0.0.1');
$host = preg_replace('/:\d+$/', '', $host) ?: '127.0.0.1';
$target = 'http://' . $host . ':8080/';

header('Location: ' . $target, true, 302);
?><!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0;url=<?= htmlspecialchars($target, ENT_QUOTES, 'UTF-8') ?>">
    <title>CSL Fingerprint JS</title>
</head>
<body>
    <p>Aplikasi sekarang berjalan di JavaScript. Buka <a href="<?= htmlspecialchars($target, ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($target, ENT_QUOTES, 'UTF-8') ?></a>.</p>
</body>
</html>
