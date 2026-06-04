<section class="metric-grid">
    <article class="metric-card">
        <span class="metric-icon text-primary"><i class="bi bi-router"></i></span>
        <div><p>Mesin</p><strong><?= e($stats['devices'] ?? 0) ?></strong></div>
    </article>
    <article class="metric-card">
        <span class="metric-icon text-success"><i class="bi bi-wifi"></i></span>
        <div><p>Online</p><strong><?= e($stats['online_devices'] ?? 0) ?></strong></div>
    </article>
    <article class="metric-card">
        <span class="metric-icon text-info"><i class="bi bi-people"></i></span>
        <div><p>User</p><strong><?= e($stats['users'] ?? 0) ?></strong></div>
    </article>
    <article class="metric-card">
        <span class="metric-icon text-warning"><i class="bi bi-calendar-check"></i></span>
        <div><p>Absensi Hari Ini</p><strong><?= e($stats['attendance_today'] ?? 0) ?></strong></div>
    </article>
</section>

<section class="content-grid">
    <div class="panel">
        <div class="panel-heading">
            <div>
                <h2>Status Mesin</h2>
                <p>Ringkasan koneksi mesin fingerprint yang terdaftar.</p>
            </div>
            <a class="btn btn-sm btn-primary" href="<?= e(url_to('/devices/detect')) ?>">
                <i class="bi bi-radar"></i> Detek Mesin
            </a>
        </div>
        <div class="table-responsive">
            <table class="table table-clean align-middle">
                <thead>
                <tr>
                    <th>Mesin</th>
                    <th>Alamat Aktif</th>
                    <th>Status</th>
                </tr>
                </thead>
                <tbody>
                <?php foreach ($devices as $device): ?>
                    <tr>
                        <td>
                            <strong><?= e($device['name']) ?></strong>
                            <span><?= e($device['serial_number'] ?: $device['device_code']) ?></span>
                        </td>
                        <td><?= e($device['host'] ?: $device['ip_address']) ?>:<?= e($device['port']) ?></td>
                        <td>
                            <span class="badge-soft <?= !empty($device['is_online']) ? 'success' : 'danger' ?>">
                                <?= !empty($device['is_online']) ? 'Online' : 'Offline' ?>
                            </span>
                        </td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$devices): ?>
                    <tr><td colspan="3" class="empty-cell">Belum ada mesin.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
        </div>
    </div>

    <div class="panel dashboard-side">
        <div class="panel-heading">
            <div>
                <h2>Tarik Data Cepat</h2>
                <p>Ambil log absensi langsung dari mesin yang terdaftar.</p>
            </div>
            <a class="btn btn-sm btn-outline-primary" href="<?= e(url_to('/attendance')) ?>">
                <i class="bi bi-arrow-right"></i> Buka
            </a>
        </div>

        <form method="post" action="<?= e(url_to('/attendance/pull')) ?>" class="quick-form">
            <label>Mesin</label>
            <select class="form-select" name="device_code" required>
                <option value="">Pilih mesin</option>
                <?php foreach ($devices as $device): ?>
                    <option value="<?= e($device['device_code']) ?>"><?= e($device['name']) ?> - <?= e($device['host'] ?: '-') ?></option>
                <?php endforeach; ?>
            </select>

            <button class="btn btn-primary w-100" type="submit">
                <i class="bi bi-cloud-download"></i> Tarik Absensi
            </button>
        </form>

        <div class="section-divider"></div>
        <div class="subheading">
            <h3>Log Terbaru</h3>
            <p>Aktivitas terakhir dari mesin atau koreksi manual.</p>
        </div>
        <div class="timeline-list">
            <?php foreach ($recentAttendance as $row): ?>
                <div class="timeline-item">
                    <span class="timeline-dot"></span>
                    <div>
                        <strong><?= e($row['name'] ?? $row['user_id']) ?></strong>
                        <p><?= e($row['user_id']) ?> - <?= e($row['state']) ?> - <?= e($row['time']) ?></p>
                    </div>
                </div>
            <?php endforeach; ?>
            <?php if (!$recentAttendance): ?>
                <div class="empty-state">Belum ada log absensi.</div>
            <?php endif; ?>
        </div>
    </div>
</section>
