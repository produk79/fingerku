<?php
$data = is_array($result['data'] ?? null) ? $result['data'] : [];
$serial = (string) ($data['serial_number'] ?? '');
$info = is_array($data['info'] ?? null) ? $data['info'] : [];
$pingInput = is_array($pingInput ?? null) ? $pingInput : ['host' => ($input['host'] ?? ''), 'port' => ($input['port'] ?? 4370)];
$pingResult = is_array($pingResult ?? null) ? $pingResult : null;
?>
<?php if (!empty($message)): ?>
    <div class="alert alert-soft-success"><i class="bi bi-check-circle"></i> <?= e($message) ?></div>
<?php endif; ?>
<?php if (!empty($error)): ?>
    <div class="alert alert-soft-warning"><i class="bi bi-exclamation-triangle"></i> <?= e($error) ?></div>
<?php endif; ?>

<section class="page-grid">
    <div class="panel form-panel">
        <div class="panel-heading compact">
            <div>
                <h2>Detek Mesin</h2>
                <p>Masukkan IP publik, IP Tailscale, atau IP lokal yang bisa dijangkau dari XAMPP.</p>
            </div>
        </div>
        <form method="post" action="<?= e(url_to('/devices/detect')) ?>" class="stack-form">
            <label>Host / IP Mesin</label>
            <input class="form-control" name="host" value="<?= e($input['host'] ?? '') ?>" placeholder="100.x.x.x / 203.x.x.x / 192.168.x.x" required>

            <label>Port</label>
            <input class="form-control" name="port" value="<?= e($input['port'] ?? 4370) ?>" required>

            <button class="btn btn-primary w-100" type="submit">
                <i class="bi bi-radar"></i> Detek Sekarang
            </button>
        </form>
    </div>

    <div class="panel">
        <div class="panel-heading">
            <div>
                <h2>Hasil Deteksi</h2>
                <p>SN dari mesin akan dikunci readonly saat didaftarkan.</p>
            </div>
        </div>

        <?php if (!empty($result)): ?>
            <div class="result-strip <?= !empty($result['ok']) ? 'success' : 'danger' ?>">
                <i class="bi <?= !empty($result['ok']) ? 'bi-check-circle' : 'bi-exclamation-triangle' ?>"></i>
                <span><?= !empty($result['ok']) ? 'Koneksi berhasil' : e($error ?: 'Koneksi gagal') ?></span>
            </div>

            <?php if (!empty($result['ok'])): ?>
                <form method="post" action="<?= e(url_to('/devices/register-detected')) ?>" class="stack-form mt-3">
                    <div class="row g-3">
                        <div class="col-md-6">
                            <label>Kode Mesin</label>
                            <input class="form-control" name="device_code" value="<?= e($serial ? 'sn-' . strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $serial)) : 'mesin-baru') ?>" required>
                        </div>
                        <div class="col-md-6">
                            <label>Nama Mesin</label>
                            <input class="form-control" name="name" value="<?= e($serial ? 'Mesin SN ' . $serial : 'Mesin Fingerprint') ?>" required>
                        </div>
                    </div>

                    <label>Serial Number</label>
                    <input class="form-control readonly-field" name="serial_number" value="<?= e($serial) ?>" readonly>

                    <div class="row g-3">
                        <div class="col-md-8">
                            <label>IP Lokal</label>
                            <input class="form-control" name="ip_address" value="<?= e($input['host'] ?? '') ?>">
                        </div>
                        <div class="col-md-4">
                            <label>Port</label>
                            <input class="form-control" name="port" value="<?= e($input['port'] ?? 4370) ?>">
                        </div>
                    </div>

                    <label>IP Publik</label>
                    <input class="form-control" name="public_ip" placeholder="Isi jika host tadi adalah IP publik">

                    <label>IP Tailscale</label>
                    <input class="form-control" name="tailscale_ip" placeholder="Isi jika host tadi adalah IP Tailscale">

                    <label>Lokasi</label>
                    <input class="form-control" name="location" placeholder="Kantor / Cabang">

                    <input type="hidden" name="brand" value="ZKTeco Compatible">
                    <input type="hidden" name="protocol" value="zk-tcp">

                    <button class="btn btn-primary w-100" type="submit">
                        <i class="bi bi-save"></i> Simpan Mesin Ini
                    </button>
                </form>

                <div class="section-divider"></div>
                <div class="table-responsive">
                    <table class="table table-clean align-middle">
                        <thead><tr><th>Info</th><th>Nilai</th></tr></thead>
                        <tbody>
                        <?php foreach ($info as $key => $row): ?>
                            <tr>
                                <td><strong><?= e($key) ?></strong></td>
                                <td>
                                    <?php if (!empty($row['ok'])): ?>
                                        <?= e(is_scalar($row['value'] ?? null) ? (string) $row['value'] : json_encode($row['value'] ?? [], JSON_UNESCAPED_SLASHES)) ?>
                                    <?php else: ?>
                                        <span class="text-danger"><?= e($row['error'] ?? '-') ?></span>
                                    <?php endif; ?>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            <?php endif; ?>
        <?php else: ?>
            <div class="empty-state">Belum ada hasil deteksi. Jalankan deteksi dari form di kiri.</div>
        <?php endif; ?>
    </div>

    <div class="panel terminal-panel">
        <div class="panel-heading">
            <div>
                <h2>Ping Terminal</h2>
                <p>Cek IP dari server XAMPP: ping host dan tes port mesin fingerprint.</p>
            </div>
        </div>

        <form method="post" action="<?= e(url_to('/devices/ping-terminal')) ?>" class="toolbar-form terminal-form">
            <div>
                <label>Host / IP</label>
                <input class="form-control" name="ping_host" value="<?= e($pingInput['host'] ?? '') ?>" placeholder="100.x.x.x / 192.168.x.x" required>
            </div>
            <div>
                <label>Port</label>
                <input class="form-control" name="ping_port" value="<?= e($pingInput['port'] ?? 4370) ?>" required>
            </div>
            <button class="btn btn-primary" type="submit">
                <i class="bi bi-terminal"></i> Cek IP
            </button>
        </form>

        <?php if ($pingResult): ?>
            <pre class="terminal-output"><?= e((string) ($pingResult['output'] ?? '')) ?></pre>
        <?php else: ?>
            <div class="terminal-empty">
                <i class="bi bi-terminal"></i>
                <span>Belum ada hasil. Masukkan IP Tailscale, IP publik, atau IP lokal lalu klik Cek IP.</span>
            </div>
        <?php endif; ?>
    </div>
</section>
