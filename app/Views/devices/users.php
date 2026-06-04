<?php if (!empty($message)): ?>
    <div class="alert alert-soft-success"><i class="bi bi-check-circle"></i> <?= e($message) ?></div>
<?php endif; ?>
<?php if (!empty($error)): ?>
    <div class="alert alert-soft-warning"><i class="bi bi-exclamation-triangle"></i> <?= e($error) ?></div>
<?php endif; ?>

<section class="panel">
    <div class="panel-heading">
        <div>
            <h2>User per Mesin</h2>
            <p>Data ini dibaca dari perangkat. Hapus user di sini hanya berlaku untuk mesin yang sedang dipilih.</p>
        </div>
        <a class="btn btn-sm btn-outline-primary" href="<?= e(url_to('/devices')) ?>">
            <i class="bi bi-router"></i> Mesin
        </a>
    </div>

    <form method="get" action="<?= e(url_to('/devices/users')) ?>" class="filter-bar">
        <div>
            <label>Mesin</label>
            <select class="form-select" name="device_code" onchange="this.form.submit()">
                <?php foreach ($devices as $item): ?>
                    <option value="<?= e($item['device_code']) ?>" <?= (string) $item['device_code'] === (string) $deviceCode ? 'selected' : '' ?>>
                        <?= e($item['name']) ?> - <?= e($item['serial_number'] ?: $item['device_code']) ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>
        <button class="btn btn-outline-primary" type="submit"><i class="bi bi-search"></i> Buka</button>
    </form>

    <?php if ($device): ?>
        <div class="device-summary">
            <div>
                <span class="small-label">Mesin aktif</span>
                <strong><?= e($device['name']) ?></strong>
                <span><?= e($device['host'] ?: '-') ?>:<?= e($device['port']) ?> - SN <?= e($device['serial_number'] ?: '-') ?></span>
            </div>
            <form method="post" action="<?= e(url_to('/devices/read-users')) ?>">
                <input type="hidden" name="device_code" value="<?= e($device['device_code']) ?>">
                <button class="btn btn-primary" type="submit"><i class="bi bi-cloud-download"></i> Baca User Live</button>
            </form>
        </div>

        <div class="enroll-panel">
            <form method="post" action="<?= e(url_to('/devices/enroll-finger')) ?>" class="toolbar-form" data-submit-lock>
                <input type="hidden" name="device_code" value="<?= e($device['device_code']) ?>">
                <select class="form-select" name="user_key" required>
                    <option value="">Pilih user untuk enroll</option>
                    <?php foreach ($rows as $row): ?>
                        <option value="<?= e($row['employee_code']) ?>">
                            <?= e($row['full_name'] ?: $row['employee_code']) ?> - ID <?= e($row['device_user_id'] ?: $row['employee_code']) ?> - UID <?= e($row['uid']) ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <select class="form-select" name="finger_index" required>
                    <?php for ($finger = 0; $finger <= 9; $finger++): ?>
                        <option value="<?= e($finger) ?>">Jari <?= e($finger) ?></option>
                    <?php endfor; ?>
                </select>
                <select class="form-select" name="identity_mode">
                    <option value="uid">Pakai UID internal</option>
                    <option value="pin">Pakai ID mesin/PIN</option>
                </select>
                <select class="form-select" name="hold_seconds">
                    <option value="30" selected>Tahan 30 detik</option>
                    <option value="45">Tahan 45 detik</option>
                    <option value="60">Tahan 60 detik</option>
                    <option value="15">Tahan 15 detik</option>
                </select>
                <button class="btn btn-primary" type="submit" data-loading-text="Membuka capture..."><i class="bi bi-fingerprint"></i> Buka Enroll</button>
            </form>
            <form method="post" action="<?= e(url_to('/devices/cancel-capture')) ?>">
                <input type="hidden" name="device_code" value="<?= e($device['device_code']) ?>">
                <button class="btn btn-outline-primary" type="submit"><i class="bi bi-x-circle"></i> Batalkan Enroll</button>
            </form>
        </div>

        <form method="post" action="<?= e(url_to('/devices/copy-users')) ?>">
            <input type="hidden" name="source_device_code" value="<?= e($device['device_code']) ?>">
            <input type="hidden" name="device_code" value="<?= e($device['device_code']) ?>">

            <div class="transfer-bar">
                <div>
                    <label>Aksi</label>
                    <select class="form-select" name="transfer_action">
                        <option value="copy">Salin user</option>
                        <option value="move">Pindahkan user</option>
                    </select>
                </div>
                <div class="target-checks">
                    <label>Mesin tujuan</label>
                    <div class="check-grid">
                        <?php $hasTarget = false; ?>
                        <?php foreach ($devices as $item): ?>
                            <?php if ((string) $item['device_code'] === (string) $device['device_code']) { continue; } ?>
                            <?php $hasTarget = true; ?>
                            <label class="check-tile">
                                <input class="form-check-input" type="checkbox" name="target_device_codes[]" value="<?= e($item['device_code']) ?>">
                                <span><?= e($item['name']) ?></span>
                            </label>
                        <?php endforeach; ?>
                        <?php if (!$hasTarget): ?>
                            <div class="empty-cell compact">Belum ada mesin tujuan lain.</div>
                        <?php endif; ?>
                    </div>
                </div>
                <button class="btn btn-primary" type="submit"><i class="bi bi-arrow-left-right"></i> Jalankan</button>
            </div>

            <div class="table-responsive">
                <table class="table table-clean align-middle">
                    <thead>
                    <tr>
                        <th class="check-col"><input class="form-check-input" type="checkbox" data-check-all></th>
                        <th>User di Mesin</th>
                        <th>UID</th>
                        <th>Kartu</th>
                        <th>Privilege</th>
                        <th>Sync</th>
                        <th class="text-end">Aksi</th>
                    </tr>
                    </thead>
                    <tbody>
                    <?php foreach ($rows as $row): ?>
                        <tr>
                            <td><input class="form-check-input" type="checkbox" name="user_rows[]" value="<?= e($row['row_id']) ?>"></td>
                            <td>
                                <?php $fingerCount = (int) ($row['fingerprint_count'] ?? 0); ?>
                                <strong>
                                    <?= e($row['full_name'] ?: $row['employee_code']) ?>
                                    <?php if ($fingerCount > 0): ?>
                                        <span class="finger-badge" title="<?= e($fingerCount) ?> sidik jari terdaftar di mesin ini">
                                            <i class="bi bi-fingerprint"></i><?= e($fingerCount) ?>
                                        </span>
                                    <?php endif; ?>
                                </strong>
                                <span><?= e($row['employee_code']) ?> - ID mesin <?= e($row['device_user_id'] ?: '-') ?></span>
                            </td>
                            <td><?= e($row['uid']) ?></td>
                            <td><?= e($row['card_number'] ?: '-') ?></td>
                            <td><?= e($row['privilege'] ?: '-') ?></td>
                            <td><?= e($row['synced_at'] ?: '-') ?></td>
                            <td class="text-end">
                                <button class="btn btn-sm btn-light-danger" type="submit" name="row_id" value="<?= e($row['row_id']) ?>" formaction="<?= e(url_to('/devices/delete-user')) ?>" onclick="return confirm('Hapus user ini hanya dari mesin <?= e($device['name']) ?>?')">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    <?php if (!$rows): ?>
                        <tr><td colspan="7" class="empty-cell">Belum ada user lokal untuk mesin ini. Klik Baca User Live.</td></tr>
                    <?php endif; ?>
                    </tbody>
                </table>
            </div>
        </form>
    <?php else: ?>
        <div class="empty-state">Pilih atau daftarkan mesin terlebih dahulu.</div>
    <?php endif; ?>
</section>
