const express = require("express");

function statusPill(escapeHtml, label, enabled) {
  return `<span class="pill ${enabled ? "online" : "offline"}">${escapeHtml(label)}: ${enabled ? "ON" : "OFF"}</span>`;
}

function createSettingsRoutes(deps) {
  const router = express.Router();
  const {
    loadConfig,
    loadBackupHistory,
    loadAppSettings,
    loadPrinterSettings,
    htmlPage,
    escapeHtml,
    renderServerUrlCard,
    backupDir,
    databaseBackupDir
  } = deps;

  router.get("/settings", (req, res) => {
    const config = loadConfig();
    const history = loadBackupHistory();
    const appSettings = loadAppSettings();
    const printer = loadPrinterSettings();

    res.send(htmlPage("Setting", `
      <h1>Setting Center</h1>
      <div class="msg">
        Menu ini menggabungkan Auto Sync, Backup, Advanced, dan Setting Printer agar navigasi lebih ringkas.
      </div>

      ${renderServerUrlCard ? renderServerUrlCard(req, config, appSettings) : ""}

      <div class="grid">
        <div class="card">
          <h3>Auto Sync & Realtime</h3>
          <p class="small">Atur sync user, cek status mesin otomatis, dan realtime attendance.</p>
          <div class="rowbtn">
            ${statusPill(escapeHtml, "Sync User", Boolean(config.auto_sync_enabled))}
            ${statusPill(escapeHtml, "Cek Status", Boolean(config.auto_reconnect_enabled))}
            ${statusPill(escapeHtml, "Realtime", Boolean(config.realtime_enabled))}
          </div>
          <a class="pill" href="/auto-sync">Buka Auto Sync</a>
        </div>

        <div class="card">
          <h3>Backup & Restore</h3>
          <p class="small">Backup JSON mesin, upload DAT, restore user, dan riwayat backup.</p>
          <div class="stat">Riwayat Backup <b>${escapeHtml(history.length)}</b></div>
          <p class="small">Folder backup: <code>${escapeHtml(backupDir)}</code></p>
          <a class="pill" href="/backup-restore">Buka Backup</a>
        </div>

        <div class="card">
          <h3>Printer & Aplikasi</h3>
          <p class="small">Nama aplikasi, public URL, timezone, dan printer server-side.</p>
          <div class="rowbtn">
            ${statusPill(escapeHtml, "Printer", Boolean(printer.enabled))}
            ${statusPill(escapeHtml, "Auto Print", Boolean(printer.auto_print_attendance))}
          </div>
          <p class="small">Aplikasi: <b>${escapeHtml(appSettings.app_name || "CSL Fingerprint")}</b></p>
          <a class="pill" href="/settings-printer">Buka Setting Printer</a>
        </div>

        <div class="card">
          <h3>Advanced Tools</h3>
          <p class="small">Remote enroll, adapter mesin, debug raw attendance, dan panduan online.</p>
          <a class="pill" href="/advanced">Buka Advanced</a>
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <h3>Database Tools</h3>
        <p class="small">Backup SQL dan import database tetap disediakan sebagai tool admin.</p>
        <p class="small">Folder SQL backup: <code>${escapeHtml(databaseBackupDir)}</code></p>
        <a class="pill" href="/database-tools">Buka Database Tools</a>
      </div>
    `));
  });

  return router;
}

module.exports = {
  createSettingsRoutes
};
