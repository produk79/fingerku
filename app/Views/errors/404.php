<div class="panel not-found-panel">
    <div class="empty-icon"><i class="bi bi-compass"></i></div>
    <h2>Halaman tidak ditemukan</h2>
    <p>URL <code><?= e($path ?? '-') ?></code> tidak tersedia di routing aplikasi.</p>
    <a class="btn btn-primary" href="<?= e(url_to('/')) ?>">
        <i class="bi bi-arrow-left"></i> Kembali ke Dashboard
    </a>
</div>
