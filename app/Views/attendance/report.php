<div class="panel no-print">
    <div class="panel-heading">
        <div>
            <h2>Laporan Absensi</h2>
            <p>Filter tanggal dan pilih mesin yang akan dicetak.</p>
        </div>
        <button class="btn btn-primary" type="button" onclick="window.print()">
            <i class="bi bi-printer"></i> Print Laporan
        </button>
    </div>

    <form method="get" action="<?= e(url_to('/attendance/report')) ?>" class="report-filter">
        <div>
            <label>Tanggal awal</label>
            <input class="form-control" type="date" name="start_date" value="<?= e($start) ?>">
        </div>
        <div>
            <label>Tanggal akhir</label>
            <input class="form-control" type="date" name="end_date" value="<?= e($end) ?>">
        </div>
        <div class="report-device-filter">
            <label>Pilih mesin yang dicetak</label>
            <div class="check-grid">
                <?php foreach ($devices as $device): ?>
                    <label class="check-tile">
                        <input class="form-check-input" type="checkbox" name="device_codes[]" value="<?= e($device['device_code']) ?>" <?= in_array((string) $device['device_code'], $selectedDevices ?? [], true) ? 'checked' : '' ?>>
                        <span><?= e($device['name']) ?></span>
                    </label>
                <?php endforeach; ?>
            </div>
        </div>
        <button class="btn btn-primary" type="submit"><i class="bi bi-search"></i> Tampilkan</button>
    </form>
</div>

<?php foreach ($sections as $section): ?>
    <?php $device = $section['device']; $pivot = $section['pivot']; ?>
    <div class="panel report-panel">
        <div class="report-title">
            <h2><?= e($device['name']) ?></h2>
            <p>
                Lokasi: <?= e($device['location'] ?: '-') ?> |
                SN: <?= e($device['serial_number'] ?: '-') ?> |
                Periode: <?= e($start) ?> sampai <?= e($end) ?>
            </p>
        </div>

        <div class="table-responsive">
            <table class="table table-clean table-report align-middle">
                <thead>
                <tr>
                    <th>User</th>
                    <?php foreach ($dates as $date): ?>
                        <th><?= e(date('d M', strtotime($date))) ?></th>
                    <?php endforeach; ?>
                    <th>Hadir</th>
                    <th>Telat</th>
                    <th>Alpa</th>
                </tr>
                </thead>
                <tbody>
                <?php foreach ($pivot as $user): ?>
                    <tr>
                        <td>
                            <strong><?= e($user['name']) ?></strong>
                            <span><?= e($user['employee_code']) ?></span>
                        </td>
                        <?php foreach ($dates as $date): ?>
                            <?php $day = $user['days'][$date]; ?>
                            <td>
                                <span class="report-time"><?= e($day['in'] ?: '-') ?></span>
                                <span class="report-time muted"><?= e($day['out'] ?: '-') ?></span>
                            </td>
                        <?php endforeach; ?>
                        <td><span class="badge-soft success"><?= e($user['recap']['hadir']) ?></span></td>
                        <td><span class="badge-soft warning"><?= e($user['recap']['telat']) ?></span></td>
                        <td><span class="badge-soft danger"><?= e($user['recap']['alpa']) ?></span></td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$pivot): ?>
                    <tr><td colspan="<?= e(count($dates) + 4) ?>" class="empty-cell">Tidak ada data pada periode ini untuk mesin <?= e($device['name']) ?>.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
        </div>
    </div>
<?php endforeach; ?>

<?php if (!$sections): ?>
    <div class="panel"><div class="empty-state">Pilih minimal satu mesin untuk laporan.</div></div>
<?php endif; ?>
