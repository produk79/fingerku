<?php $preferred = (string) ($device['preferred_host'] ?? 'auto'); ?>

<section class="panel">
    <div class="panel-heading">
        <div>
            <h2>Edit Mesin</h2>
            <p>Informasi ini tersimpan di database dan dipakai untuk ping, tarik data, ADMS, waktu, reboot, dan enroll.</p>
        </div>
        <a class="btn btn-sm btn-outline-primary" href="<?= e(url_to('/devices')) ?>">
            <i class="bi bi-arrow-left"></i> Daftar Mesin
        </a>
    </div>

    <form method="post" action="<?= e(url_to('/devices/store')) ?>" class="settings-form">
        <div class="row g-3">
            <div class="col-md-4">
                <label>Kode Mesin</label>
                <input class="form-control readonly-field" name="device_code" value="<?= e($device['device_code']) ?>" readonly>
            </div>
            <div class="col-md-4">
                <label>Nama Mesin</label>
                <input class="form-control" name="name" value="<?= e($device['name']) ?>" required>
            </div>
            <div class="col-md-4">
                <label>Serial Number</label>
                <input class="form-control readonly-field" name="serial_number" value="<?= e($device['serial_number']) ?>" readonly>
            </div>

            <div class="col-md-4">
                <label>IP Lokal</label>
                <input class="form-control" name="ip_address" value="<?= e($device['ip_address']) ?>">
            </div>
            <div class="col-md-4">
                <label>IP Publik</label>
                <input class="form-control" name="public_ip" value="<?= e($device['public_ip']) ?>">
            </div>
            <div class="col-md-4">
                <label>IP Tailscale</label>
                <input class="form-control" name="tailscale_ip" value="<?= e($device['tailscale_ip']) ?>">
            </div>

            <div class="col-md-3">
                <label>Port</label>
                <input class="form-control" name="port" value="<?= e($device['port']) ?>">
            </div>
            <div class="col-md-3">
                <label>Prioritas Koneksi</label>
                <select class="form-select" name="preferred_host">
                    <option value="auto" <?= $preferred === 'auto' ? 'selected' : '' ?>>Auto: Tailscale, Publik, Lokal</option>
                    <option value="local" <?= $preferred === 'local' ? 'selected' : '' ?>>IP Lokal</option>
                    <option value="tailscale" <?= $preferred === 'tailscale' ? 'selected' : '' ?>>IP Tailscale</option>
                    <option value="public" <?= $preferred === 'public' ? 'selected' : '' ?>>IP Publik</option>
                </select>
            </div>
            <div class="col-md-3">
                <label>Brand</label>
                <input class="form-control" name="brand" value="<?= e($device['brand']) ?>">
            </div>
            <div class="col-md-3">
                <label>Protocol</label>
                <input class="form-control" name="protocol" value="<?= e($device['protocol']) ?>">
            </div>

            <div class="col-md-6">
                <label>Lokasi</label>
                <input class="form-control" name="location" value="<?= e($device['location']) ?>">
            </div>
            <div class="col-md-6">
                <label>Timezone Mesin</label>
                <select class="form-select" name="timezone">
                    <?php foreach (($timezones ?? [['value' => 'Asia/Jakarta', 'label' => 'Asia/Jakarta (GMT+07:00)']]) as $timezone): ?>
                        <option value="<?= e($timezone['value']) ?>" <?= (string) $device['timezone'] === (string) $timezone['value'] ? 'selected' : '' ?>>
                            <?= e($timezone['label']) ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </div>

            <div class="col-md-4">
                <label>IP ADMS</label>
                <input class="form-control" name="adms_ip" value="<?= e($device['adms_ip']) ?>">
            </div>
            <div class="col-md-4">
                <label>Domain ADMS</label>
                <input class="form-control" name="adms_domain" value="<?= e($device['adms_domain']) ?>">
            </div>
            <div class="col-md-4">
                <label>Port ADMS</label>
                <input class="form-control" name="adms_port" value="<?= e($device['adms_port'] ?: '') ?>">
            </div>
            <div class="col-12">
                <label>URL ADMS</label>
                <input class="form-control" name="adms_url" value="<?= e($device['adms_url']) ?>">
            </div>
        </div>

        <div class="form-actions">
            <button class="btn btn-primary" type="submit"><i class="bi bi-save"></i> Simpan Perubahan</button>
            <a class="btn btn-outline-primary" href="<?= e(url_to('/devices/users?device_code=' . rawurlencode((string) $device['device_code']))) ?>">
                <i class="bi bi-fingerprint"></i> User dan Enroll
            </a>
        </div>
    </form>
</section>
