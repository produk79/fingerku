<?php if (!empty($saved)): ?>
    <div class="alert alert-soft-success"><i class="bi bi-check-circle"></i> Pengaturan tersimpan.</div>
<?php endif; ?>

<div class="panel settings-panel">
    <div class="panel-heading">
        <div>
            <h2>Pengaturan Aplikasi</h2>
            <p>Konfigurasi dasar untuk tampilan, timezone, dan jam kerja utama.</p>
        </div>
    </div>

    <form method="post" action="<?= e(url_to('/settings')) ?>" class="settings-form">
        <div class="row g-3">
            <div class="col-md-6">
                <label>Nama Aplikasi</label>
                <input class="form-control" name="app_name" value="<?= e($settings['app_name'] ?? '') ?>">
            </div>
            <div class="col-md-6">
                <label>Nama Perusahaan</label>
                <input class="form-control" name="company_name" value="<?= e($settings['company_name'] ?? '') ?>">
            </div>
            <div class="col-md-6">
                <label>Timezone</label>
                <select class="form-select" name="timezone">
                    <?php foreach (($timezones ?? [['value' => 'Asia/Jakarta', 'label' => 'Asia/Jakarta (GMT+07:00)']]) as $timezone): ?>
                        <option value="<?= e($timezone['value']) ?>" <?= (string) ($settings['timezone'] ?? 'Asia/Jakarta') === (string) $timezone['value'] ? 'selected' : '' ?>>
                            <?= e($timezone['label']) ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="col-md-6">
                <label>Jam Masuk Default</label>
                <input class="form-control" type="time" name="work_start_time" value="<?= e($settings['work_start_time'] ?? '08:00') ?>">
            </div>
            <div class="col-12">
                <label>Catatan Footer</label>
                <textarea class="form-control" name="receipt_footer" rows="3"><?= e($settings['receipt_footer'] ?? '') ?></textarea>
            </div>
        </div>

        <button class="btn btn-primary mt-3" type="submit">
            <i class="bi bi-save"></i> Simpan Pengaturan
        </button>
    </form>
</div>
