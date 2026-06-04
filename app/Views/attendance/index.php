<?php if (!empty($saved)): ?>
    <div class="alert alert-soft-success"><i class="bi bi-check-circle"></i> Log absensi tersimpan.</div>
<?php endif; ?>
<?php if (!empty($message)): ?>
    <div class="alert alert-soft-success"><i class="bi bi-info-circle"></i> <?= e($message) ?></div>
<?php endif; ?>
<?php if (!empty($error)): ?>
    <div class="alert alert-soft-warning"><i class="bi bi-exclamation-triangle"></i> <?= e($error) ?></div>
<?php endif; ?>

<section class="page-grid attendance-grid">
    <div class="panel form-panel">
        <div class="panel-heading compact">
            <div>
                <h2>Tarik Absensi Real</h2>
                <p>Ambil log langsung dari mesin. Aplikasi tidak membuat hasil absen palsu.</p>
            </div>
        </div>

        <form method="post" action="<?= e(url_to('/attendance/pull')) ?>" class="stack-form">
            <label>Mesin</label>
            <select class="form-select" name="device_code" required>
                <option value="">Pilih mesin</option>
                <?php foreach ($devices as $device): ?>
                    <option value="<?= e($device['device_code']) ?>"><?= e($device['name']) ?> - <?= e($device['host'] ?: '-') ?></option>
                <?php endforeach; ?>
            </select>
            <button class="btn btn-primary w-100" type="submit">
                <i class="bi bi-cloud-download"></i> Tarik dari Mesin
            </button>
        </form>

        <form method="post" action="<?= e(url_to('/attendance/pull-all')) ?>" class="mt-2">
            <button class="btn btn-outline-primary w-100" type="submit">
                <i class="bi bi-cloud-arrow-down"></i> Tarik Semua Mesin
            </button>
        </form>

        <label class="check-tile mt-2">
            <input class="form-check-input" type="checkbox" data-auto-pull data-url="<?= e(url_to('/attendance/realtime-pull')) ?>">
            <span>Auto realtime tiap 30 detik</span>
        </label>
        <div class="auto-status" data-auto-status>Auto realtime belum aktif.</div>

        <div class="section-divider"></div>
        <div class="panel-heading compact">
            <div>
                <h2>Koreksi Manual</h2>
                <p>Dipakai hanya untuk koreksi admin, bukan data otomatis.</p>
            </div>
        </div>
        <form method="post" action="<?= e(url_to('/attendance/store')) ?>" class="stack-form">
            <label>User</label>
            <select class="form-select" name="employee_code" required>
                <option value="">Pilih user</option>
                <?php foreach ($users as $user): ?>
                    <option value="<?= e($user['employee_code']) ?>"><?= e($user['employee_code']) ?> - <?= e($user['full_name']) ?></option>
                <?php endforeach; ?>
            </select>

            <label>Mesin</label>
            <select class="form-select" name="device_code">
                <option value="">Tanpa mesin</option>
                <?php foreach ($devices as $device): ?>
                    <option value="<?= e($device['device_code']) ?>"><?= e($device['name']) ?></option>
                <?php endforeach; ?>
            </select>

            <div class="row g-3">
                <div class="col-md-7">
                    <label>Waktu</label>
                    <input class="form-control" type="datetime-local" name="check_time" value="<?= e(app_now('Y-m-d\TH:i')) ?>">
                </div>
                <div class="col-md-5">
                    <label>Status</label>
                    <select class="form-select" name="punch_state">
                        <option value="IN">Masuk</option>
                        <option value="OUT">Pulang</option>
                        <option value="BREAK_OUT">Keluar Istirahat</option>
                        <option value="BREAK_IN">Masuk Istirahat</option>
                    </select>
                </div>
            </div>

            <button class="btn btn-outline-primary w-100" type="submit">
                <i class="bi bi-plus-lg"></i> Simpan Koreksi
            </button>
        </form>
    </div>

    <div class="panel">
        <div class="panel-heading">
            <div>
                <h2>Log Absensi</h2>
                <p>Log terbaru dari perangkat atau koreksi manual admin.</p>
            </div>
            <a class="btn btn-sm btn-outline-primary" href="<?= e(url_to('/attendance/report')) ?>">
                <i class="bi bi-calendar2-check"></i> Laporan
            </a>
        </div>
        <div class="table-responsive">
            <table class="table table-clean align-middle">
                <thead>
                <tr>
                    <th>Waktu</th>
                    <th>User</th>
                    <th>Mesin</th>
                    <th>Status</th>
                </tr>
                </thead>
                <tbody>
                <?php foreach ($rows as $row): ?>
                    <tr>
                        <td><?= e(str_replace('T', ' ', (string) ($row['time'] ?? ''))) ?></td>
                        <td>
                            <strong><?= e($row['name'] ?? $row['user_id']) ?></strong>
                            <span><?= e($row['user_id'] ?? '-') ?></span>
                        </td>
                        <td><?= e($row['device_name'] ?? '-') ?><span><?= e($row['device_sn'] ?? '') ?></span></td>
                        <td><span class="badge-soft info"><?= e($row['state'] ?? '-') ?></span></td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$rows): ?>
                    <tr><td colspan="4" class="empty-cell">Belum ada log. Jalankan tarik absensi dari mesin.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
        </div>
    </div>
</section>
