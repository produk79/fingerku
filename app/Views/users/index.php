<?php if (!empty($saved)): ?>
    <div class="alert alert-soft-success"><i class="bi bi-check-circle"></i> Data user tersimpan.</div>
<?php endif; ?>
<?php if (!empty($message)): ?>
    <div class="alert alert-soft-success"><i class="bi bi-info-circle"></i> <?= e($message) ?></div>
<?php endif; ?>
<?php if (!empty($error)): ?>
    <div class="alert alert-soft-warning"><i class="bi bi-exclamation-triangle"></i> <?= e($error) ?></div>
<?php endif; ?>

<section class="page-grid users-grid">
    <div class="panel form-panel">
        <div class="panel-heading compact">
            <div>
                <h2>Tambah User</h2>
                <p>Simpan user master, lalu pilih mesin jika ingin langsung dikirim ke perangkat.</p>
            </div>
        </div>
        <form method="post" action="<?= e(url_to('/users/store')) ?>" class="stack-form">
            <label>Kode Karyawan</label>
            <input class="form-control" name="employee_code" placeholder="1 atau EMP001" required>

            <label>Nama Lengkap</label>
            <input class="form-control" name="full_name" placeholder="Nama user" required>

            <div class="row g-3">
                <div class="col-md-6">
                    <label>ID di Mesin</label>
                    <input class="form-control" name="device_user_id" inputmode="numeric" placeholder="1">
                </div>
                <div class="col-md-6">
                    <label>Nomor Kartu</label>
                    <input class="form-control" name="card_number" placeholder="Opsional">
                </div>
            </div>

            <label>Departemen</label>
            <input class="form-control" name="department" placeholder="Produksi / Admin">

            <div>
                <label>Kirim ke Mesin</label>
                <div class="check-grid single-col">
                    <?php foreach ($devices as $device): ?>
                        <label class="check-tile">
                            <input class="form-check-input" type="checkbox" name="target_device_codes[]" value="<?= e($device['device_code']) ?>">
                            <span><?= e($device['name']) ?></span>
                        </label>
                    <?php endforeach; ?>
                    <?php if (!$devices): ?>
                        <div class="empty-cell compact">Belum ada mesin.</div>
                    <?php endif; ?>
                </div>
            </div>

            <button class="btn btn-primary w-100" type="submit">
                <i class="bi bi-save"></i> Simpan User
            </button>
        </form>
    </div>

    <div class="panel">
        <div class="panel-heading">
            <div>
                <h2>Daftar User Master</h2>
                <p>Jumlah mesin menunjukkan user ini sudah pernah terbaca atau dikirim ke mesin mana saja.</p>
            </div>
            <a class="btn btn-sm btn-outline-primary" href="<?= e(url_to('/devices/users')) ?>">
                <i class="bi bi-person-lines-fill"></i> User Mesin
            </a>
        </div>
        <div class="table-responsive">
            <table class="table table-clean align-middle">
                <thead>
                <tr>
                    <th>User</th>
                    <th>ID Mesin</th>
                    <th>Kartu</th>
                    <th>Departemen</th>
                    <th>Mesin</th>
                    <th class="text-end">Aksi</th>
                </tr>
                </thead>
                <tbody>
                <?php foreach ($users as $user): ?>
                    <tr>
                        <td>
                            <?php $fingerCount = (int) ($user['fingerprint_count'] ?? 0); ?>
                            <strong>
                                <?= e($user['full_name']) ?>
                                <?php if ($fingerCount > 0): ?>
                                    <span class="finger-badge" title="<?= e($fingerCount) ?> sidik jari terdeteksi dari mesin">
                                        <i class="bi bi-fingerprint"></i><?= e($fingerCount) ?>
                                    </span>
                                <?php endif; ?>
                            </strong>
                            <span><?= e($user['employee_code']) ?></span>
                        </td>
                        <td><?= e($user['device_user_id'] ?: '-') ?></td>
                        <td><?= e($user['card_number'] ?: '-') ?></td>
                        <td><?= e($user['department'] ?: '-') ?></td>
                        <td><span class="badge-soft info"><?= e($user['device_count'] ?? 0) ?> mesin</span></td>
                        <td class="text-end">
                            <form method="post" action="<?= e(url_to('/users/delete')) ?>" onsubmit="return confirm('Nonaktifkan user master ini? Data user di mesin tidak ikut dihapus otomatis.')" class="d-inline">
                                <input type="hidden" name="employee_code" value="<?= e($user['employee_code']) ?>">
                                <button class="btn btn-sm btn-light-danger" type="submit" aria-label="Hapus user">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </form>
                        </td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$users): ?>
                    <tr><td colspan="6" class="empty-cell">Belum ada user fingerprint.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
        </div>
    </div>
</section>
