const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");

const directories = {
  uploads: path.join(ROOT_DIR, "uploads"),
  backups: path.join(ROOT_DIR, "backups"),
  databaseBackups: path.join(ROOT_DIR, "database-backups"),
  public: path.join(ROOT_DIR, "public"),
  bridge: path.join(ROOT_DIR, "bridge")
};

const dataFiles = {
  users: path.join(ROOT_DIR, "users.json"),
  config: path.join(ROOT_DIR, "config.json"),
  attendance: path.join(ROOT_DIR, "attendance.json"),
  shifts: path.join(ROOT_DIR, "shifts.json"),
  userShifts: path.join(ROOT_DIR, "user-shifts.json"),
  backupHistory: path.join(ROOT_DIR, "backup-history.json"),
  fingerprintTemplates: path.join(ROOT_DIR, "fingerprint-templates.json"),
  userNameCache: path.join(ROOT_DIR, "user-name-cache.json"),
  appUsers: path.join(ROOT_DIR, "app-users.json"),
  sessions: path.join(ROOT_DIR, "sessions.json"),
  appSettings: path.join(ROOT_DIR, "app-settings.json"),
  printerSettings: path.join(ROOT_DIR, "printer-settings.json"),
  status: path.join(ROOT_DIR, "device-status.json")
};

module.exports = {
  ROOT_DIR,
  directories,
  dataFiles
};
