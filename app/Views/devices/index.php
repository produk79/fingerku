<?php if (!empty($saved)): ?>
    <div class="alert alert-soft-success"><i class="bi bi-check-circle"></i> Data mesin tersimpan.</div>
<?php endif; ?>
<?php if (!empty($message)): ?>
    <div class="alert alert-soft-success"><i class="bi bi-info-circle"></i> <?= e($message) ?></div>
<?php endif; ?>
<?php if (!empty($error)): ?>
    <div class="alert alert-soft-warning"><i class="bi bi-exclamation-triangle"></i> <?= e($error) ?></div>
<?php endif; ?>

<section class="page-grid devices-grid">
    <div class="panel form-panel">
        <div class="panel-heading compact">
            <div>
                <h2>Tambah Mesin</h2>
                <p>Simpan mesin dari IP lokal, IP publik, atau Tailscale. Deteksi SN ada di menu Detek Mesin.</p>
            </div>
        </div>
        <form method="post" action="<?= e(url_to('/devices/store')) ?>" class="stack-form">
            <label>Kode Mesin</label>
            <input class="form-control" name="device_code" placeholder="mesin-kantor" required>

            <label>Nama Mesin</label>
            <input class="form-control" name="name" placeholder="Absen Kantor" required>

            <label>Serial Number</label>
            <input class="form-control" name="serial_number" placeholder="SN dari hasil deteksi">

            <div class="row g-3">
                <div class="col-md-8">
                    <label>IP Lokal</label>
                    <input class="form-control" name="ip_address" placeholder="192.168.18.253">
                </div>
                <div class="col-md-4">
                    <label>Port</label>
                    <input class="form-control" name="port" value="4370">
                </div>
            </div>

            <label>IP Publik</label>
            <input class="form-control" name="public_ip" placeholder="203.0.113.10">

            <label>IP Tailscale</label>
            <input class="form-control" name="tailscale_ip" placeholder="100.x.x.x">

            <label>Prioritas Koneksi</label>
            <select class="form-select" name="preferred_host">
                <option value="auto">Auto: Tailscale, Publik, Lokal</option>
                <option value="local">IP Lokal</option>
                <option value="tailscale">IP Tailscale</option>
                <option value="public">IP Publik</option>
            </select>

            <label>Lokasi</label>
            <input class="form-control" name="location" placeholder="Kantor Utama">

            <div class="row g-3">
                <div class="col-md-6">
                    <label>Brand</label>
                    <input class="form-control" name="brand" value="ZKTeco Compatible">
                </div>
                <div class="col-md-6">
                    <label>Protocol</label>
                    <input class="form-control" name="protocol" value="zk-tcp">
                </div>
            </div>

            <label>Timezone Mesin</label>
            <select class="form-select" name="timezone">
                <?php foreach (($timezones ?? [['value' => 'Asia/Jakarta', 'label' => 'Asia/Jakarta (GMT+07:00)']]) as $timezone): ?>
                    <option value="<?= e($timezone['value']) ?>" <?= $timezone['value'] === 'Asia/Jakarta' ? 'selected' : '' ?>><?= e($timezone['label']) ?></option>
                <?php endforeach; ?>
            </select>

            <div class="row g-3">
                <div class="col-md-7">
                    <label>IP ADMS</label>
                    <input class="form-control" name="adms_ip" placeholder="143.198.86.118">
                </div>
                <div class="col-md-5">
                    <label>Port ADMS</label>
                    <input class="form-control" name="adms_port" placeholder="8000">
                </div>
            </div>

            <label>Domain ADMS</label>
            <input class="form-control" name="adms_domain" placeholder="adms.domainmu.com">

            <label>URL ADMS</label>
            <input class="form-control" name="adms_url" value="<?= e(url_to('/csl/login')) ?>">

            <button class="btn btn-primary w-100" type="submit">
                <i class="bi bi-save"></i> Simpan Mesin
            </button>
            <a class="btn btn-outline-primary w-100" href="<?= e(url_to('/devices/detect')) ?>">
                <i class="bi bi-radar"></i> Detek Mesin Lewat IP
            </a>
        </form>
    </div>

    <div class="panel">
        <div class="panel-heading">
            <div>
                <h2>Daftar Mesin</h2>
                <p>Semua aksi di bawah dikirim ke perangkat nyata melalui IP yang aktif.</p>
            </div>
        </div>
        <div class="table-responsive">
            <table class="table table-clean align-middle devices-table">
                <thead>
                <tr>
                    <th>Mesin</th>
                    <th>Koneksi</th>
                    <th>ADMS</th>
                    <th>Status</th>
                    <th class="text-end">Aksi</th>
                </tr>
                </thead>
                <tbody>
                <?php foreach ($devices as $device): ?>
                    <tr>
                        <td>
                            <strong><?= e($device['name']) ?></strong>
                            <span><?= e($device['device_code']) ?> - SN <?= e($device['serial_number'] ?: '-') ?></span>
                            <span><?= e($device['location'] ?: '-') ?></span>
                        </td>
                        <td>
                            <strong><?= e($device['host'] ?: '-') ?>:<?= e($device['port']) ?></strong>
                            <span>Lokal: <?= e($device['ip_address'] ?: '-') ?></span>
                            <span>Publik: <?= e($device['public_ip'] ?: '-') ?></span>
                            <span>Tailscale: <?= e($device['tailscale_ip'] ?: '-') ?></span>
                            <span>Prioritas: <?= e($device['preferred_host'] ?? 'auto') ?></span>
                        </td>
                        <td>
                            <strong><?= e($device['adms_ip'] ?: '-') ?><?= !empty($device['adms_port']) ? ':' . e($device['adms_port']) : '' ?></strong>
                            <span>Domain: <?= e($device['adms_domain'] ?: '-') ?></span>
                            <span><?= e($device['adms_url'] ?: '-') ?></span>
                            <span>TZ: <?= e($device['timezone_label'] ?? $device['timezone'] ?? 'Asia/Jakarta') ?></span>
                        </td>
                        <td>
                            <span class="badge-soft <?= !empty($device['is_online']) ? 'success' : 'danger' ?>">
                                <?= !empty($device['is_online']) ? 'Online' : 'Offline' ?>
                            </span>
                            <span><?= e($device['checked_at'] ?: 'Belum dicek') ?></span>
                            <?php if (!empty($device['message'])): ?><span><?= e($device['message']) ?></span><?php endif; ?>
                        </td>
                        <td class="text-end">
                            <div class="action-grid">
                                <form method="post" action="<?= e(url_to('/devices/ping')) ?>">
                                    <input type="hidden" name="device_code" value="<?= e($device['device_code']) ?>">
                                    <button class="btn btn-sm btn-outline-primary" type="submit" title="Tes ping"><i class="bi bi-wifi"></i></button>
                                </form>
                                <form method="post" action="<?= e(url_to('/devices/read-users')) ?>">
                                    <input type="hidden" name="device_code" value="<?= e($device['device_code']) ?>">
                                    <button class="btn btn-sm btn-outline-primary" type="submit" title="Baca user mesin"><i class="bi bi-people"></i></button>
                                </form>
                                <a class="btn btn-sm btn-outline-primary" href="<?= e(url_to('/devices/users?device_code=' . rawurlencode((string) $device['device_code']))) ?>" title="Kelola user per mesin"><i class="bi bi-person-lines-fill"></i></a>
                                <a class="btn btn-sm btn-outline-primary" href="<?= e(url_to('/devices/edit?device_code=' . rawurlencode((string) $device['device_code']))) ?>" title="Edit mesin" aria-label="Edit mesin"><i class="bi bi-pencil-square"></i></a>
                                <form method="post" action="<?= e(url_to('/attendance/pull')) ?>">
                                    <input type="hidden" name="device_code" value="<?= e($device['device_code']) ?>">
                                    <button class="btn btn-sm btn-outline-primary" type="submit" title="Tarik absensi nyata"><i class="bi bi-cloud-download"></i></button>
                                </form>
                                <form method="post" action="<?= e(url_to('/devices/read-adms')) ?>">
                                    <input type="hidden" name="device_code" value="<?= e($device['device_code']) ?>">
                                    <button class="btn btn-sm btn-outline-primary" type="submit" title="Baca ADMS"><i class="bi bi-hdd-network"></i></button>
                                </form>
                                <form method="post" action="<?= e(url_to('/devices/set-time')) ?>">
                                    <input type="hidden" name="device_code" value="<?= e($device['device_code']) ?>">
                                    <button class="btn btn-sm btn-outline-primary" type="submit" title="Set waktu mesin"><i class="bi bi-clock"></i></button>
                                </form>
                                <form method="post" action="<?= e(url_to('/devices/reboot')) ?>" onsubmit="return confirm('Reboot mesin ini?')">
                                    <input type="hidden" name="device_code" value="<?= e($device['device_code']) ?>">
                                    <button class="btn btn-sm btn-light-danger" type="submit" title="Reboot"><i class="bi bi-arrow-clockwise"></i></button>
                                </form>
                                <form method="post" action="<?= e(url_to('/devices/delete')) ?>" onsubmit="return confirm('Hapus mesin dari daftar aplikasi?')">
                                    <input type="hidden" name="device_code" value="<?= e($device['device_code']) ?>">
                                    <button class="btn btn-sm btn-light-danger" type="submit" title="Hapus daftar"><i class="bi bi-trash"></i></button>
                                </form>
                            </div>
                        </td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$devices): ?>
                    <tr><td colspan="5" class="empty-cell">Belum ada mesin terdaftar.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
        </div>

        <div class="section-divider"></div>
        <div class="panel-heading compact">
            <div>
                <h2>Atur ADMS Mesin</h2>
                <p>Pilih mesin, lalu kirim konfigurasi ADMS ke perangkat.</p>
            </div>
        </div>
        <form method="post" action="<?= e(url_to('/devices/set-adms')) ?>" class="toolbar-form">
            <select class="form-select" name="device_code" required>
                <option value="">Pilih mesin</option>
                <?php foreach ($devices as $device): ?>
                    <option value="<?= e($device['device_code']) ?>"><?= e($device['name']) ?> - <?= e($device['serial_number'] ?: $device['device_code']) ?></option>
                <?php endforeach; ?>
            </select>
            <input class="form-control" name="adms_ip" placeholder="IP ADMS">
            <input class="form-control" name="adms_domain" placeholder="Domain ADMS">
            <input class="form-control" name="adms_port" placeholder="Port">
            <input class="form-control" name="adms_url" placeholder="<?= e(url_to('/csl/login')) ?>">
            <input class="form-control" name="comm_key" placeholder="Comm key">
            <button class="btn btn-primary" type="submit"><i class="bi bi-send"></i> Kirim</button>
        </form>

        <div class="section-divider"></div>
        <div class="panel-heading compact">
            <div>
                <h2>Atur Timezone Mesin</h2>
                <p>Kirim timezone ke mesin dan simpan timezone per mesin di database.</p>
            </div>
        </div>
        <form method="post" action="<?= e(url_to('/devices/set-timezone')) ?>" class="toolbar-form">
            <select class="form-select" name="device_code" required>
                <option value="">Pilih mesin</option>
                <?php foreach ($devices as $device): ?>
                    <option value="<?= e($device['device_code']) ?>"><?= e($device['name']) ?> - <?= e($device['serial_number'] ?: $device['device_code']) ?></option>
                <?php endforeach; ?>
            </select>
            <select class="form-select" name="timezone" required>
                <?php foreach (($timezones ?? [['value' => 'Asia/Jakarta', 'label' => 'Asia/Jakarta (GMT+07:00)']]) as $timezone): ?>
                    <option value="<?= e($timezone['value']) ?>" <?= $timezone['value'] === 'Asia/Jakarta' ? 'selected' : '' ?>><?= e($timezone['label']) ?></option>
                <?php endforeach; ?>
            </select>
            <button class="btn btn-primary" type="submit"><i class="bi bi-globe2"></i> Set Timezone</button>
        </form>
    </div>
</section>
