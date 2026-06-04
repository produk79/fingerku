<?php if (!empty($created)): ?>
    <div class="alert alert-soft-success"><i class="bi bi-check-circle"></i> Backup schema dibuat: <?= e($created) ?></div>
<?php endif; ?>

<section class="content-grid backup-grid">
    <div class="panel">
        <div class="panel-heading">
            <div>
                <h2>Backup Database</h2>
                <p>Schema MySQL sudah disesuaikan untuk aplikasi fingerprint CI4-style.</p>
            </div>
        </div>
        <div class="action-list">
            <form method="post" action="<?= e(url_to('/backup/database')) ?>">
                <button class="btn btn-primary" type="submit">
                    <i class="bi bi-database-down"></i> Buat Backup Schema
                </button>
            </form>
            <a class="btn btn-outline-primary" href="<?= e(url_to('/database-schema')) ?>" target="_blank">
                <i class="bi bi-filetype-sql"></i> Lihat SQL
            </a>
        </div>
    </div>

    <div class="panel">
        <div class="panel-heading">
            <div>
                <h2>File Backup</h2>
                <p>Tersimpan di folder <code>database-backups</code>.</p>
            </div>
        </div>
        <div class="table-responsive">
            <table class="table table-clean align-middle">
                <thead>
                <tr>
                    <th>File</th>
                    <th>Ukuran</th>
                    <th>Dibuat</th>
                </tr>
                </thead>
                <tbody>
                <?php foreach ($files as $file): ?>
                    <tr>
                        <td><strong><?= e($file['name']) ?></strong></td>
                        <td><?= e($file['size']) ?></td>
                        <td><?= e($file['created_at']) ?></td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$files): ?>
                    <tr><td colspan="3" class="empty-cell">Belum ada backup schema.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
        </div>
    </div>
</section>
