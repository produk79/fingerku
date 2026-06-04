<?php if (!empty($saved)): ?>
    <div class="alert alert-soft-success"><i class="bi bi-check-circle"></i> Shift tersimpan.</div>
<?php endif; ?>

<section class="page-grid">
    <div class="panel form-panel">
        <div class="panel-heading compact">
            <div>
                <h2>Tambah Shift</h2>
                <p>Shift dipakai untuk membaca telat dan alpa di laporan.</p>
            </div>
        </div>
        <form method="post" action="<?= e(url_to('/shifts/store')) ?>" class="stack-form">
            <label>Kode Shift</label>
            <input class="form-control" name="shift_code" placeholder="shift-pagi" required>

            <label>Nama Shift</label>
            <input class="form-control" name="name" placeholder="Shift Pagi" required>

            <div class="row g-3">
                <div class="col-md-6">
                    <label>Mulai</label>
                    <input class="form-control" type="time" name="start_time" value="08:00">
                </div>
                <div class="col-md-6">
                    <label>Selesai</label>
                    <input class="form-control" type="time" name="end_time" value="17:00">
                </div>
            </div>

            <div class="row g-3">
                <div class="col-md-6">
                    <label>Istirahat</label>
                    <input class="form-control" name="break_minutes" value="60">
                </div>
                <div class="col-md-6">
                    <label>Toleransi Telat</label>
                    <input class="form-control" name="late_tolerance_minutes" value="5">
                </div>
            </div>

            <button class="btn btn-primary w-100" type="submit">
                <i class="bi bi-save"></i> Simpan Shift
            </button>
        </form>
    </div>

    <div class="panel">
        <div class="panel-heading">
            <div>
                <h2>Daftar Shift</h2>
                <p>Hanya satu menu shift agar pengaturan jadwal tidak tersebar.</p>
            </div>
        </div>
        <div class="table-responsive">
            <table class="table table-clean align-middle">
                <thead>
                <tr>
                    <th>Shift</th>
                    <th>Jam</th>
                    <th>Istirahat</th>
                    <th>Toleransi</th>
                    <th class="text-end">Aksi</th>
                </tr>
                </thead>
                <tbody>
                <?php foreach ($shifts as $shift): ?>
                    <tr>
                        <td>
                            <strong><?= e($shift['name']) ?></strong>
                            <span><?= e($shift['id'] ?? $shift['shift_code'] ?? '-') ?></span>
                        </td>
                        <td><?= e($shift['start_time']) ?> - <?= e($shift['end_time']) ?></td>
                        <td><?= e($shift['break_minutes']) ?> menit</td>
                        <td><?= e($shift['late_tolerance_minutes']) ?> menit</td>
                        <td class="text-end">
                            <form method="post" action="<?= e(url_to('/shifts/delete')) ?>" onsubmit="return confirm('Hapus shift ini?')" class="d-inline">
                                <input type="hidden" name="shift_code" value="<?= e($shift['id'] ?? $shift['shift_code']) ?>">
                                <button class="btn btn-sm btn-light-danger" type="submit" aria-label="Hapus shift">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </form>
                        </td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$shifts): ?>
                    <tr><td colspan="5" class="empty-cell">Belum ada shift.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
        </div>
    </div>
</section>
