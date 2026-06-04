var user = global.__cslCurrentUser || null;
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const net = require("net");
const http = require("http");
const os = require("os");
const { spawn, execFile } = require("child_process");
const crypto = require("crypto");
const paths = require("./src/config/paths");
const runtime = require("./src/config/runtime");
const jsonStore = require("./src/utils/json-store");
const textUtils = require("./src/utils/text");
const deviceAddressService = require("./src/services/device-address");
const rebootService = require("./src/services/reboot-service");
const appUserService = require("./src/services/app-user-service");
const accessService = require("./src/services/access-service");
const { createAuthRoutes } = require("./src/routes/auth-routes");
const { createAppUserRoutes } = require("./src/routes/app-user-routes");
const { createDeviceAdminRoutes } = require("./src/routes/device-admin-routes");
const { createLocalUserRoutes } = require("./src/routes/local-user-routes");
const { createSettingsRoutes } = require("./src/routes/settings-routes");
const { createAttendanceMenuRoutes } = require("./src/routes/attendance-menu-routes");
const accessMiddleware = require("./src/middleware/access-middleware");
global.__cslCurrentUser = global.__cslCurrentUser || null;

let Zkteco = null;
let ZktecoPackage = "";

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION DITAHAN:", err && err.stack ? err.stack : err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION DITAHAN:", err && err.stack ? err.stack : err);
});

try {
  Zkteco = require("zkteco-js");
  ZktecoPackage = "zkteco-js";
} catch (err) {
  console.warn("zkteco-js belum terinstall. Jalankan install-dan-jalankan.bat");
}

const app = express();
const server = http.createServer(app);

const { dataFiles, directories } = paths;
const PORT = runtime.PORT;
const DB_FILE = dataFiles.users;
const CONFIG_FILE = dataFiles.config;
const ATTENDANCE_FILE = dataFiles.attendance;
const SHIFTS_FILE = dataFiles.shifts;
const USER_SHIFTS_FILE = dataFiles.userShifts;
const BACKUP_HISTORY_FILE = dataFiles.backupHistory;
const FINGERPRINT_TEMPLATES_FILE = dataFiles.fingerprintTemplates;
const USER_NAME_CACHE_FILE = dataFiles.userNameCache;
const APP_USERS_FILE = dataFiles.appUsers;
const SESSIONS_FILE = dataFiles.sessions;
const APP_SETTINGS_FILE = dataFiles.appSettings;
const PRINTER_SETTINGS_FILE = dataFiles.printerSettings;
const STATUS_FILE = dataFiles.status;
const UPLOAD_DIR = directories.uploads;
const BACKUP_DIR = directories.backups;
// Semua backup database disimpan DI DALAM folder aplikasi.
const DB_BACKUP_DIR = directories.databaseBackups;
const PUBLIC_DIR = directories.public;
const BRIDGE_DIR = directories.bridge;

jsonStore.ensureDirectory(UPLOAD_DIR);
jsonStore.ensureDirectory(BACKUP_DIR);
jsonStore.ensureDirectory(DB_BACKUP_DIR);
jsonStore.ensureDirectory(PUBLIC_DIR);
ensureAppUsersFile();
if (!fs.existsSync(SESSIONS_FILE)) saveJson(SESSIONS_FILE, {});
if (!fs.existsSync(APP_SETTINGS_FILE)) saveAppSettings(defaultAppSettings());
if (!fs.existsSync(PRINTER_SETTINGS_FILE)) savePrinterSettings(defaultPrinterSettings());
jsonStore.ensureDirectory(BRIDGE_DIR);

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB
  }
});

// Body parser dibuat aman untuk upload file besar.
// Jangan parse multipart/form-data sebagai text/json, biarkan multer yang handle upload DAT.
app.use("/assets", express.static(PUBLIC_DIR));
app.use(express.urlencoded({ extended: true, limit: "200mb" }));
app.use(express.json({ limit: "200mb" }));

app.use((req, res, next) => {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("multipart/form-data")) return next();
  return express.text({
    type: ["text/plain", "application/octet-stream"],
    limit: "200mb"
  })(req, res, next);
});

// =======================
// UTIL
// =======================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout setelah ${ms}ms`)), ms))
  ]);
}

function isZkTimeoutError(err) {
  const msg = errorText(err);
  return /TIMEOUT|timeout|RECEIVING_RESPONSE|Cannot read properties of null|substring|subarray|reply/i.test(msg);
}

function escapeHtml(value) {
  return textUtils.escapeHtml(value);
}

function safeJson(value) {
  return textUtils.safeJson(value);
}

function errorText(err) {
  return textUtils.errorText(err);
}

function loadJson(file, fallback) {
  return jsonStore.loadJson(file, fallback);
}

function saveJson(file, data) {
  jsonStore.saveJson(file, data);
}

function sha256Text(text) {
  return textUtils.sha256Text(text);
}

function toIntOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function uniqStrings(values) {
  return [...new Set((values || []).map(v => String(v || "").trim()).filter(Boolean))];
}

function normalizeDeviceBrandId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "zkteco-compatible";
  const key = raw.toLowerCase();
  const alias = {
    "zkteco compatible": "zkteco-compatible",
    "zkteco-compatible": "zkteco-compatible",
    "solution x100c": "solution-x100c",
    "solution-x100c": "solution-x100c",
    "biofinger zk": "biofinger-zk",
    "biofinger-zk": "biofinger-zk",
    "fingerspot zk": "fingerspot-zk",
    "fingerspot-zk": "fingerspot-zk",
    "adms push": "adms-push",
    "adms-push": "adms-push",
    "sdk bridge": "sdk-bridge",
    "sdk-bridge": "sdk-bridge"
  };
  return alias[key] || raw;
}

function normalizeDeviceProtocol(value, brandId = "") {
  const raw = String(value || "").trim();
  if (raw) return raw;
  const found = supportedAdapters().find(a => a.id === brandId);
  return found?.protocol || "zk-tcp";
}

function normalizePreferredHost(value) {
  return deviceAddressService.normalizePreferredHost(value);
}

function normalizeLocalUsers(rows) {
  const input = Array.isArray(rows) ? rows : [];
  const merged = new Map();

  for (const row of input) {
    const userId = String(row?.user_id || row?.userId || "").trim();
    if (!userId) continue;
    const prev = merged.get(userId) || {};
    merged.set(userId, {
      user_id: userId,
      name: String(row?.name || prev.name || "").trim(),
      card: String(row?.card || prev.card || "").trim(),
      uid: String(row?.uid || prev.uid || userId).trim(),
      department: String(row?.department || prev.department || "").trim(),
      is_active: row?.is_active !== false
    });
  }

  return [...merged.values()];
}

function normalizeAppUsersRows(rows) {
  return appUserService.normalizeAppUsersRows(rows);
}

function makeAppUser(id, username, password, name, role, allowedDeviceIds = []) {
  return appUserService.makeAppUser(id, username, password, name, role, allowedDeviceIds);
}

function defaultAppUsers() {
  return appUserService.defaultAppUsers();
}

function ensureAppUsersFile() {
  return appUserService.ensureAppUsersFile(APP_USERS_FILE);
}

function loadAppUsers() {
  return appUserService.loadAppUsers(APP_USERS_FILE);
}

function saveAppUsers(rows) {
  appUserService.saveAppUsers(rows, APP_USERS_FILE);
}

function loadSessions() {
  return appUserService.loadSessions(SESSIONS_FILE);
}

function saveSessions(rows) {
  appUserService.saveSessions(rows, SESSIONS_FILE);
}

function parseCookie(req) {
  return appUserService.parseCookie(req);
}

function getCurrentUser(req) {
  return appUserService.getCurrentUser(req, {
    sessionsFile: SESSIONS_FILE,
    appUsersFile: APP_USERS_FILE
  });
}

function currentUser(req) {
  return getCurrentUser(req);
}

function isAdminUser(user) {
  return accessService.isAdminUser(user);
}

function visibleDevicesForUser(user, config = loadConfig()) {
  return accessService.visibleDevicesForUser(user, config);
}

function filterConfigForUser(config, user) {
  const cloned = JSON.parse(JSON.stringify(config || {}));
  cloned.devices = visibleDevicesForUser(user, config);
  return cloned;
}

function deviceAllowedForUser(device, user) {
  return accessService.canAccessDeviceRecord(user, device, (loadConfig().devices || []));
}

function userOptionsForAdmin(selectedUserId = "") {
  return loadAppUsers()
    .map(u => `<option value="${escapeHtml(u.id)}" ${String(selectedUserId) === String(u.id) ? "selected" : ""}>${escapeHtml(u.name || u.username)} (${escapeHtml(u.role)})</option>`)
    .join("");
}

function selectedRoleUserFromQuery(req) {
  const id = String(req.query.view_user_id || "").trim();
  return loadAppUsers().find(u => u.id === id) || null;
}

function allowedDeviceKeysForUser(user) {
  return accessService.allowedDeviceKeysForUser(user, loadConfig().devices || []);
}

function filterDevicesByAccess(devices, user) {
  return accessService.filterDevicesByAccess(devices, user);
}

function filteredConfigForRequest(req) {
  const current = req.currentUser || global.__cslCurrentUser || null;
  const base = loadConfig();

  if (isAdminUser(current)) {
    const selected = selectedRoleUserFromQuery(req);
    if (selected) {
      const cloned = JSON.parse(JSON.stringify(base));
      cloned.devices = filterDevicesByAccess(base.devices || [], selected);
      return cloned;
    }
    return base;
  }

  const cloned = JSON.parse(JSON.stringify(base));
  cloned.devices = filterDevicesByAccess(base.devices || [], current);
  return cloned;
}

function canAccessDeviceRecord(user, device) {
  return accessService.canAccessDeviceRecord(user, device, loadConfig().devices || []);
}

function canAccessAttendanceRow(user, row) {
  return accessService.canAccessAttendanceRow(user, row, loadConfig().devices || []);
}


function defaultAppSettings() {
  return {
    app_name: "CSL Fingerprint Server",
    company_name: "",
    timezone: "Asia/Jakarta",
    date_format: "YYYY-MM-DD",
    time_format: "HH:mm",
    online_mode: "local_or_vpn",
    public_base_url: "",
    session_days: 7,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function loadAppSettings() {
  return loadJson(APP_SETTINGS_FILE, defaultAppSettings());
}

function saveAppSettings(settings) {
  const merged = { ...defaultAppSettings(), ...(settings || {}), updated_at: new Date().toISOString() };
  saveJson(APP_SETTINGS_FILE, merged);
}

function defaultPrinterSettings() {
  return {
    enabled: false,
    printer_name: "",
    printer_type: "inkjet",
    paper_size: "A4",
    orientation: "portrait",
    copies: 1,
    server_side_print: false,
    auto_print_attendance: false,
    print_header: "Laporan Absensi",
    print_footer: "",
    receipt_width_mm: 58,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function loadPrinterSettings() {
  return loadJson(PRINTER_SETTINGS_FILE, defaultPrinterSettings());
}

function savePrinterSettings(settings) {
  const merged = { ...defaultPrinterSettings(), ...(settings || {}), updated_at: new Date().toISOString() };
  merged.enabled = Boolean(merged.enabled);
  merged.server_side_print = Boolean(merged.server_side_print);
  merged.auto_print_attendance = Boolean(merged.auto_print_attendance);
  merged.copies = Number(merged.copies || 1);
  merged.receipt_width_mm = Number(merged.receipt_width_mm || 58);
  saveJson(PRINTER_SETTINGS_FILE, merged);
}

function getTimeZoneOptions() {
  try {
    if (Intl && typeof Intl.supportedValuesOf === "function") {
      return Intl.supportedValuesOf("timeZone");
    }
  } catch (_) {}
  return [
    "Asia/Jakarta","Asia/Makassar","Asia/Jayapura","Asia/Singapore","Asia/Kuala_Lumpur",
    "Asia/Bangkok","Asia/Tokyo","Asia/Shanghai","Asia/Dubai",
    "UTC","Europe/London","Europe/Amsterdam","Europe/Berlin",
    "America/New_York","America/Los_Angeles","Australia/Sydney"
  ];
}

function psEscapeSingle(value) {
  return String(value || "").replace(/'/g, "''");
}

function platformLabel() {
  if (process.platform === "win32") return "Windows";
  if (process.platform === "darwin") return "macOS";
  if (process.platform === "linux") return "Linux";
  return process.platform;
}

function cleanPrinterNames(lines) {
  return uniqStrings((lines || [])
    .map(line => String(line || "").trim())
    .map(line => line.replace(/^\uFEFF/, "").trim())
    .map(line => line.replace(/^printer\s+/i, "").split(/\s+is\s+/i)[0].trim())
    .filter(line => line && !/^name$/i.test(line) && !/^-+$/.test(line)));
}

function runPrinterCommand(command) {
  return new Promise((resolve) => {
    execFile(command.file, command.args || [], { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, command, error: errorText(err), stdout, stderr });
      const printers = cleanPrinterNames(String(stdout || "").split(/\r?\n/));
      resolve({ ok: true, command, printers, error: "", stdout, stderr });
    });
  });
}

async function detectServerPrinters() {
  const windowsCommands = [
    {
      method: "PowerShell Win32_Printer",
      file: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Printer | Sort-Object Name | Select-Object -ExpandProperty Name"]
    },
    {
      method: "PowerShell Get-Printer",
      file: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Printer | Sort-Object Name | Select-Object -ExpandProperty Name"]
    },
    {
      method: "WMIC printer",
      file: "wmic.exe",
      args: ["printer", "get", "name"]
    }
  ];

  const unixCommands = [
    { method: "CUPS lpstat -e", file: "lpstat", args: ["-e"] },
    { method: "CUPS lpstat -p", file: "lpstat", args: ["-p"] }
  ];

  const commands = process.platform === "win32" ? windowsCommands : unixCommands;
  const attempts = [];

  for (const command of commands) {
    const result = await runPrinterCommand(command);
    attempts.push(result);
    if (result.ok) {
      return {
        ok: true,
        printers: result.printers || [],
        method: command.method,
        platform: process.platform,
        platform_label: platformLabel(),
        error: "",
        attempts
      };
    }
  }

  return {
    ok: false,
    printers: [],
    method: "",
    platform: process.platform,
    platform_label: platformLabel(),
    error: attempts.map(item => `${item.command.method}: ${item.error}`).join("\n") || "Command deteksi printer tidak tersedia.",
    attempts
  };
}

function detectWindowsPrinters() {
  return detectServerPrinters();
}

function serverPrintText(text, printerName = "") {
  return new Promise((resolve) => {
    const tmp = path.join(UPLOAD_DIR, `print-test-${Date.now()}.txt`);
    fs.writeFileSync(tmp, String(text || ""), "utf8");

    const isWindows = process.platform === "win32";
    const p = psEscapeSingle(tmp);
    const name = psEscapeSingle(printerName);
    const file = isWindows ? "powershell.exe" : "lp";
    const args = isWindows
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", printerName ? `Get-Content -LiteralPath '${p}' | Out-Printer -Name '${name}'` : `Get-Content -LiteralPath '${p}' | Out-Printer`]
      : (printerName ? ["-d", printerName, tmp] : [tmp]);

    execFile(file, args, { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmp); } catch (_) {}
      if (err) return resolve({ ok:false, error:errorText(err), stdout, stderr });
      resolve({ ok:true, error:"", stdout, stderr });
    });
  });
}




function makeId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// =======================
// CONFIG / DB
// =======================
function defaultConfig() {
  return {
    computer_ip: detectedLanIps()[0] || "127.0.0.1",
    local_server_port: 8080,
    adms_ip: "143.198.86.118",
    adms_port: 8000,
    adms_url: "/csl/login",

    auto_reconnect_enabled: true,
    auto_reconnect_interval_seconds: 30,

    auto_sync_enabled: false,
    auto_sync_interval_minutes: 10,
    auto_sync_source_device_id: "",
    auto_sync_target_device_ids: [],

    realtime_enabled: false,
    realtime_device_ids: [],

    auto_attendance_enabled: false,
    auto_attendance_interval_seconds: 60,
    auto_attendance_device_ids: [],
    auto_attendance_skip_offline: true,

    work_start_time: "08:00",

    devices: [
      {
        id: "mesin-1",
        name: "Absen Kantor",
        ip: "192.168.18.253",
        tailscale_ip: "",
        port: 4370,
        sn: "SN-MESIN-1",
        location: "",
        brand: "zkteco-compatible",
        protocol: "zk-tcp"
      }
    ]
  };
}

function normalizeConfig(config) {
  const def = defaultConfig();
  config = config || def;

  if (!Array.isArray(config.devices)) {
    config.devices = [
      {
        id: "mesin-1",
        name: "Mesin Utama",
        ip: config.device_ip || "192.168.18.253",
        tailscale_ip: "",
        port: Number(config.device_port || 4370),
        sn: "",
        location: ""
      }
    ];
  }

  config.computer_ip = config.computer_ip || def.computer_ip;
  config.local_server_port = PORT;
  config.adms_ip = config.adms_ip || def.adms_ip;
  config.adms_port = Number(config.adms_port || def.adms_port);
  config.adms_url = config.adms_url || def.adms_url;

  config.auto_reconnect_enabled = config.auto_reconnect_enabled !== false;
  config.auto_reconnect_interval_seconds = Number(config.auto_reconnect_interval_seconds || def.auto_reconnect_interval_seconds);

  config.auto_sync_enabled = Boolean(config.auto_sync_enabled);
  config.auto_sync_interval_minutes = Number(config.auto_sync_interval_minutes || def.auto_sync_interval_minutes);
  config.auto_sync_source_device_id = config.auto_sync_source_device_id || "";
  config.auto_sync_target_device_ids = Array.isArray(config.auto_sync_target_device_ids) ? config.auto_sync_target_device_ids : [];

  config.realtime_enabled = Boolean(config.realtime_enabled);
  config.realtime_device_ids = Array.isArray(config.realtime_device_ids) ? config.realtime_device_ids : [];

  config.auto_attendance_enabled = Boolean(config.auto_attendance_enabled);
  config.auto_attendance_interval_seconds = Math.max(30, Number(config.auto_attendance_interval_seconds || def.auto_attendance_interval_seconds));
  config.auto_attendance_device_ids = Array.isArray(config.auto_attendance_device_ids) ? config.auto_attendance_device_ids : [];
  config.auto_attendance_skip_offline = config.auto_attendance_skip_offline !== false;

  config.work_start_time = config.work_start_time || def.work_start_time;

  const normalizedDevices = [];
  for (let i = 0; i < config.devices.length; i++) {
    const d = config.devices[i] || {};
    const brand = normalizeDeviceBrandId(d.brand || "zkteco-compatible");
    const device = {
      id: String(d.id || `mesin-${i + 1}`).trim(),
      name: String(d.name || `Mesin ${i + 1}`).trim(),
      ip: String(d.ip || d.device_ip || "").trim(),
      public_ip: String(d.public_ip || d.publicIp || "").trim(),
      tailscale_ip: String(d.tailscale_ip || "").trim(),
      preferred_host: normalizePreferredHost(d.preferred_host || d.preferredHost || "auto"),
      port: toIntOr(d.port || d.device_port, 4370),
      sn: String(d.sn || "").trim(),
      location: String(d.location || "").trim(),
      brand,
      protocol: normalizeDeviceProtocol(d.protocol, brand),
      timezone: String(d.timezone || "Asia/Jakarta").trim(),
      adms_ip: String(d.adms_ip || "").trim(),
      adms_domain: String(d.adms_domain || "").trim(),
      adms_port: d.adms_port === "" || d.adms_port === null || typeof d.adms_port === "undefined" ? null : toIntOr(d.adms_port, null),
      adms_url: String(d.adms_url || "").trim(),
      last_detected_at: String(d.last_detected_at || "").trim()
    };

    const existing = normalizedDevices.find(x =>
      x.id === device.id ||
      (device.sn && x.sn && x.sn === device.sn)
    );

    if (!existing) {
      normalizedDevices.push(device);
      continue;
    }

    // Merge duplicate rows by preserving identity and filling missing values.
    existing.name = existing.name || device.name;
    existing.ip = existing.ip || device.ip;
    existing.public_ip = existing.public_ip || device.public_ip;
    existing.tailscale_ip = existing.tailscale_ip || device.tailscale_ip;
    existing.preferred_host = normalizePreferredHost(existing.preferred_host || device.preferred_host);
    existing.port = existing.port || device.port;
    existing.sn = existing.sn || device.sn;
    existing.location = existing.location || device.location;
    existing.brand = normalizeDeviceBrandId(existing.brand || device.brand);
    existing.protocol = normalizeDeviceProtocol(existing.protocol || device.protocol, existing.brand);
    existing.timezone = existing.timezone || device.timezone;
    existing.adms_ip = existing.adms_ip || device.adms_ip;
    existing.adms_domain = existing.adms_domain || device.adms_domain;
    existing.adms_port = existing.adms_port || device.adms_port;
    existing.adms_url = existing.adms_url || device.adms_url;
    existing.last_detected_at = existing.last_detected_at || device.last_detected_at;
  }

  config.devices = normalizedDevices;

  return config;
}

function loadConfig() { return normalizeConfig(loadJson(CONFIG_FILE, defaultConfig())); }
function saveConfig(config) { saveJson(CONFIG_FILE, normalizeConfig(config)); }

function loadUsers() { return normalizeLocalUsers(loadJson(DB_FILE, [])); }
function saveUsers(users) { saveJson(DB_FILE, normalizeLocalUsers(users)); }

function loadAttendance() { return loadJson(ATTENDANCE_FILE, []); }
function saveAttendance(rows) { saveJson(ATTENDANCE_FILE, rows); }

function defaultShifts() {
  return [
    { id:"shift-1", name:"Shift 1", start_time:"05:00", end_time:"15:00", break_minutes:60, late_tolerance_minutes:5, overtime_after_minutes:30, is_active:true },
    { id:"shift-2", name:"Shift 2", start_time:"14:00", end_time:"22:00", break_minutes:60, late_tolerance_minutes:5, overtime_after_minutes:30, is_active:true },
    { id:"shift-3", name:"Shift 3", start_time:"21:00", end_time:"04:00", break_minutes:60, late_tolerance_minutes:5, overtime_after_minutes:30, is_active:true }
  ];
}

function loadShifts() {
  const shifts = loadJson(SHIFTS_FILE, defaultShifts());
  const rows = Array.isArray(shifts) && shifts.length ? shifts : defaultShifts();
  return rows.map((shift, index) => ({
    id: String(shift.id || `shift-${index + 1}`),
    name: String(shift.name || `Shift ${index + 1}`),
    start_time: String(shift.start_time || "08:00"),
    end_time: String(shift.end_time || "17:00"),
    break_minutes: Number(shift.break_minutes || 60),
    late_tolerance_minutes: Number(shift.late_tolerance_minutes || 5),
    overtime_after_minutes: Math.max(0, Number(shift.overtime_after_minutes ?? 30)),
    is_active: shift.is_active !== false
  }));
}

function saveShifts(shifts) { saveJson(SHIFTS_FILE, shifts); }

function loadUserShifts() { return loadJson(USER_SHIFTS_FILE, {}); }
function saveUserShifts(map) { saveJson(USER_SHIFTS_FILE, map); }

function loadStatus() { return loadJson(STATUS_FILE, {}); }
function saveStatus(status) { saveJson(STATUS_FILE, status); }

function loadUserNameCache() { return loadJson(USER_NAME_CACHE_FILE, {}); }
function saveUserNameCache(map) { saveJson(USER_NAME_CACHE_FILE, map); }

function updateUserNameCacheFromUsers(users, deviceConfig = null) {
  const cache = loadUserNameCache();
  for (const u of users || []) {
    const userId = String(u.user_id || u.userId || u.userid || u.uid || "").trim();
    const name = String(u.name || u.username || u.userName || "").trim();
    if (!userId || !name) continue;
    cache[userId] = name;
    if (deviceConfig && deviceConfig.sn) cache[`${deviceConfig.sn}:${userId}`] = name;
  }
  saveUserNameCache(cache);
}

function resolveUserName(userId, deviceSn = "") {
  const id = String(userId || "").trim();
  const sn = String(deviceSn || "").trim();
  if (!id) return "";
  const local = loadUsers().find(u => String(u.user_id) === id);
  if (local && local.name) return local.name;
  const cache = loadUserNameCache();
  return (sn && cache[`${sn}:${id}`]) || cache[id] || "";
}
function loadBackupHistory() { return loadJson(BACKUP_HISTORY_FILE, []); }
function saveBackupHistory(rows) { saveJson(BACKUP_HISTORY_FILE, rows); }
function loadFingerprintTemplates() { return loadJson(FINGERPRINT_TEMPLATES_FILE, []); }
function saveFingerprintTemplates(rows) { saveJson(FINGERPRINT_TEMPLATES_FILE, rows); }

function getDeviceById(id) {
  const config = loadConfig();
  return config.devices.find(d => String(d.id) === String(id));
}

function firstValue(value) {
  if (Array.isArray(value)) return value.find(v => String(v || "").trim()) || "";
  return value || "";
}

function getDeviceBySn(sn) {
  const config = loadConfig();
  const key = String(firstValue(sn) || "").trim();
  if (!key) return null;
  return config.devices.find(d => String(d.sn || "").trim() === key);
}

function getDeviceIdentity(device) {
  return String(device?.sn || device?.id || "").trim();
}

function resolveDeviceFromBody(body) {
  const id = firstValue(body.device_id || body.deviceId || body.target_device_id || body.source_device_id || "");
  const sn = firstValue(body.device_sn || body.sn || body.device_identity || "");
  let device = null;

  if (sn) device = getDeviceBySn(sn);
  if (!device && id) device = getDeviceById(id);

  return device;
}

function resolveDeviceStrictSn(body) {
  const sn = String(firstValue(body.device_sn || body.sn || body.device_identity || "")).trim();
  if (!sn) return null;
  return getDeviceBySn(sn);
}

function resolveDeviceLocked(body) {
  const id = String(firstValue(body.device_id || body.deviceId || "")).trim();
  const sn = String(firstValue(body.device_sn || body.sn || "")).trim();
  const expectedAddress = String(firstValue(body.device_address || body.final_address || "")).trim();

  if (!id) return { ok:false, error:"device_id kosong. Target mesin tidak aman.", device:null };
  const device = getDeviceById(id);
  if (!device) return { ok:false, error:`device_id ${id} tidak ditemukan.`, device:null };

  if (sn && device.sn && sn !== device.sn) {
    return { ok:false, error:`SN tidak cocok. Form SN=${sn}, config SN=${device.sn}. Aksi dibatalkan agar tidak salah mesin.`, device };
  }

  const actualAddress = deviceAddress(device);
  if (expectedAddress && actualAddress && expectedAddress !== actualAddress) {
    if (sn && device.sn && sn === device.sn) {
      return {
        ok:true,
        error:"",
        warning:`Alamat form berbeda (${expectedAddress}), server memakai alamat aktif dari config (${actualAddress}) karena device_id dan SN cocok.`,
        device
      };
    }
    return { ok:false, error:`Alamat target berubah. Form address=${expectedAddress}, config address=${actualAddress}. Buka ulang halaman lalu ulangi aksi.`, device };
  }

  return { ok:true, error:"", warning:"", device };
}

function requireLockedDeviceOrPage(req, res, backUrl = "/") {
  const payload = { ...(req.query || {}), ...(req.body || {}) };
  const result = resolveDeviceLocked(payload);
  if (!result.ok) {
    res.send(htmlPage("Target mesin tidak aman", `
      <h3>Target mesin tidak aman</h3>
      <p>${escapeHtml(result.error)}</p>
      <h4>Data diterima server</h4>
      <pre>${escapeHtml(safeJson(payload))}</pre>
      <a href="${escapeHtml(backUrl)}">Kembali</a>
    `));
    return null;
  }

  const user = req.currentUser || global.__cslCurrentUser || null;
  if (user && !canAccessDeviceRecord(user, result.device)) {
    res.status(403).send(htmlPage("Akses ditolak", `
      <h3>Akses ditolak</h3>
      <p>User <b>${escapeHtml(user.username || user.id || "-")}</b> tidak punya akses ke mesin ini.</p>
      <p>Target mesin: <b>${escapeHtml(result.device.name || result.device.id || "-")}</b></p>
      <a class="pill" href="${escapeHtml(backUrl)}">Kembali</a>
    `));
    return null;
  }

  return result.device;
}

function deviceAddress(device) {
  return deviceAddressService.deviceAddress(device);
}

function supportedAdapters() {
  return [
    { id:"zkteco-compatible", name:"ZKTeco Compatible / Solution / BioFinger", protocol:"zk-tcp", ready:true },
    { id:"solution-x100c", name:"Solution X100C", protocol:"zk-tcp", ready:true },
    { id:"biofinger-zk", name:"BioFinger ZK Compatible", protocol:"zk-tcp", ready:true },
    { id:"fingerspot-zk", name:"FingerSpot ZK Compatible", protocol:"zk-tcp", ready:true },
    { id:"adms-push", name:"ADMS / Push SDK Mode", protocol:"adms-http", ready:"partial" },
    { id:"sdk-bridge", name:"SDK Bridge Official .NET/C++", protocol:"bridge-exe", ready:"bridge" }
  ];
}

function adapterLabel(device) {
  const found = supportedAdapters().find(a => a.id === (device.brand || "zkteco-compatible"));
  return found ? found.name : (device.brand || "ZK Compatible");
}

function protocolLabel(device) {
  const found = supportedAdapters().find(a => a.id === (device.brand || "zkteco-compatible"));
  return device.protocol || found?.protocol || "zk-tcp";
}

function adapterCanDirectTcp(device) {
  const p = protocolLabel(device);
  return p === "zk-tcp" || p === "tcp";
}



// =======================
// SHIFT / REPORT LOGIC
// =======================
function parseTimeToMinutes(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return (Number(h || 0) * 60) + Number(m || 0);
}

function minutesToHHMM(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function normalizeDateInput(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  return s;
}

function sameDeviceForAttendance(log, filterDevice) {
  const f = String(filterDevice || "").trim();
  if (!f) return true;
  return String(log.device_sn || "") === f ||
         String(log.device_id || "") === f ||
         String(log.device_name || "") === f;
}

function formatTimeOnly(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value).slice(11,16) || String(value);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function formatDateTimeIndo(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return `${d.toISOString().slice(0,10)} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

function sameTimestamp(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (!isNaN(da.getTime()) && !isNaN(db.getTime())) return da.getTime() === db.getTime();
  return String(a) === String(b);
}

function sameMinute(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (!isNaN(da.getTime()) && !isNaN(db.getTime())) {
    return Math.floor(da.getTime() / 60000) === Math.floor(db.getTime() / 60000);
  }
  return formatTimeOnly(a) === formatTimeOnly(b);
}

function validCheckoutTime(checkIn, checkOut) {
  if (!checkIn || !checkOut) return "";
  if (sameTimestamp(checkIn, checkOut) || sameMinute(checkIn, checkOut)) return "";
  return checkOut;
}

function pickRawLogTime(log) {
  const raw = log?.raw || log || {};
  const candidates = [
    log?.time,
    raw.time,
    raw.recordTime,
    raw.timestamp,
    raw.attendance_time,
    raw.attTime,
    raw.checkTime,
    raw.check_time,
    raw.punchTime,
    raw.punch_time,
    raw.datetime,
    raw.dateTime,
    raw.date_time
  ];
  for (const c of candidates) {
    if (!c) continue;
    const s = String(c).trim();
    if (!s || s === "0" || s.toLowerCase() === "null") continue;
    return s;
  }
  return "";
}


function getDeviceFilterValue(d) {
  return String(d.sn || d.id || d.name || "").trim();
}

function getDeviceByFilterValue(value) {
  const f = String(value || "").trim();
  if (!f) return null;
  const config = loadConfig();
  return config.devices.find(d => String(d.sn || "") === f || String(d.id || "") === f || String(d.name || "") === f) || null;
}

function userIdsForDeviceFromAttendance(filterDevice) {
  const ids = new Set();
  for (const r of loadAttendance()) {
    if (!sameDeviceForAttendance(r, filterDevice)) continue;
    if (r.user_id) ids.add(String(r.user_id));
  }
  return ids;
}

function buildTodayUserSummary(filterDevice = "") {
  const today = new Date().toISOString().slice(0,10);
  const logs = loadAttendance()
    .filter(r => (!filterDevice || sameDeviceForAttendance(r, filterDevice)))
    .filter(r => String(r.time || "").slice(0,10) === today)
    .sort((a,b) => String(a.time).localeCompare(String(b.time)));

  const grouped = new Map();
  for (const log of logs) {
    const key = `${log.device_sn || log.device_id || log.device_name}|${log.user_id}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        user_id: String(log.user_id || ""),
        user_name: resolveUserName(log.user_id, log.device_sn) || "",
        device_name: log.device_name || "",
        device_sn: log.device_sn || "",
        check_in: "",
        check_out: "",
        last_time: "",
        logs: []
      });
    }
    const item = grouped.get(key);
    item.logs.push(log);
    item.last_time = log.time;
  }

  for (const item of grouped.values()) {
    const real = getRealFirstLastTimesFromMachineLogs(item.logs);
    item.check_in = real.check_in;
    item.check_out = real.check_out;
    item.real_note = real.real_note || "";
  }

  return Array.from(grouped.values()).sort((a,b) => String(b.last_time).localeCompare(String(a.last_time)));
}

function greetingForSummary(item) {
  const name = item.user_name || "User";
  const id = item.user_id || "-";
  const masuk = formatTimeOnly(item.check_in);
  const pulang = formatTimeOnly(item.check_out);
  if (item.check_out) return `Halo kak ${name}/${id}, Hari ini kamu datang pukul ${masuk} dan pulang pukul ${pulang}. Sampai bertemu besok lagi ya...`;
  return `Halo kak ${name}/${id}, Hari ini kamu datang pukul ${masuk}`;
}



function getTimeMinutesFromDate(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function shiftDurationMinutes(shift) {
  const start = parseTimeToMinutes(shift.start_time);
  const end = parseTimeToMinutes(shift.end_time);
  return end >= start ? end - start : (1440 - start + end);
}

function shiftBreakRange(shift) {
  const start = parseTimeToMinutes(shift.start_time);
  const duration = shiftDurationMinutes(shift);
  const breakMinutes = Number(shift.break_minutes || 60);
  const mid = start + Math.floor(duration / 2) - Math.floor(breakMinutes / 2);
  return {
    break_start: minutesToHHMM(mid),
    break_end: minutesToHHMM(mid + breakMinutes)
  };
}

function isTimeInShift(date, shift, marginMinutes = 180) {
  const t = getTimeMinutesFromDate(date);
  const start = parseTimeToMinutes(shift.start_time) - marginMinutes;
  const duration = shiftDurationMinutes(shift) + (marginMinutes * 2);
  const normalizedT = t < ((start % 1440) + 1440) % 1440 ? t + 1440 : t;
  const normalizedStart = start < 0 ? start + 1440 : start;
  return normalizedT >= normalizedStart && normalizedT <= normalizedStart + duration;
}

function workDateForShift(date, shift) {
  const start = parseTimeToMinutes(shift.start_time);
  const end = parseTimeToMinutes(shift.end_time);
  const t = getTimeMinutesFromDate(date);
  const d = new Date(date);
  if (end < start && t <= end) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function detectStatusFromState(state) {
  const s = String(state ?? "").toLowerCase();
  if (["0", "checkin", "in", "masuk"].includes(s)) return "masuk";
  if (["1", "checkout", "out", "pulang"].includes(s)) return "pulang";
  if (["2", "breakout", "istirahat keluar", "istirahat_keluar"].includes(s)) return "istirahat_keluar";
  if (["3", "breakin", "istirahat masuk", "istirahat_masuk"].includes(s)) return "istirahat_masuk";
  if (s.includes("pulang")) return "pulang";
  if (s.includes("istirahat") && s.includes("keluar")) return "istirahat_keluar";
  if (s.includes("istirahat") && s.includes("masuk")) return "istirahat_masuk";
  return "masuk";
}

function getMachineLogState(log) {
  if (!log) return "";
  const raw = log.raw || {};
  return String(
    log.state ?? log.status ?? log.verify_state ??
    raw.state ?? raw.status ?? raw.verify_state ?? raw.punch ?? raw.punch_state ??
    raw.attendanceState ?? raw.attState ?? raw.type ?? ""
  ).trim();
}

function getRawStatusValue(log, idx) {
  const raw = log?.raw || {};
  const keys = [
    [`status${idx}`, `status_${idx}`, `Status${idx}`, `STATUS${idx}`],
    [`state${idx}`, `state_${idx}`, `State${idx}`, `STATE${idx}`],
    [`verify${idx}`, `verify_${idx}`, `Verify${idx}`, `VERIFY${idx}`],
    [`punch${idx}`, `punch_${idx}`, `Punch${idx}`, `PUNCH${idx}`]
  ].flat();

  for (const k of keys) {
    if (log && log[k] !== undefined && log[k] !== null && log[k] !== "") return log[k];
    if (raw && raw[k] !== undefined && raw[k] !== null && raw[k] !== "") return raw[k];
  }

  // Mapping umum dari mesin ZK:
  // status1 = state/punch status, status2 = verify/type jika tersedia.
  if (idx === 1) return getMachineLogState(log) || "";
  if (idx === 2) {
    return log?.verify_type ?? log?.verifyType ?? log?.type ??
      raw.verify_type ?? raw.verifyType ?? raw.verify ?? raw.type ?? "";
  }
  if (idx === 3) {
    return log?.work_code ?? log?.workCode ?? raw.work_code ?? raw.workCode ?? "";
  }
  if (idx === 4) {
    return log?.reserved1 ?? raw.reserved1 ?? raw.status4 ?? "";
  }
  if (idx === 5) {
    return log?.reserved2 ?? raw.reserved2 ?? raw.status5 ?? "";
  }
  return "";
}

function getAttendanceTimestamp(log) {
  return pickRawLogTime(log) || log?.time || "";
}

function normalizeUserId(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d+(\.0+)?$/.test(s)) return String(parseInt(s, 10));
  return s;
}

function attendanceUserMatches(log, filterUser) {
  const f = normalizeUserId(filterUser);
  if (!f) return true;
  const candidates = [
    log?.user_id,
    log?.uid,
    log?.pin,
    log?.employee_id,
    log?.raw?.user_id,
    log?.raw?.userId,
    log?.raw?.userid,
    log?.raw?.uid,
    log?.raw?.pin,
    log?.raw?.employee_id,
    log?.raw?.employeeId
  ].map(normalizeUserId);
  return candidates.includes(f);
}

function normalizeDateFromTimestamp(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  return "";
}

function attendanceDateMatches(log, start, end) {
  const d = normalizeDateFromTimestamp(getAttendanceTimestamp(log));
  const s = normalizeDateInput(start || "");
  const e = normalizeDateInput(end || "");
  if (!d) return false;
  if (s && d < s) return false;
  if (e && d > e) return false;
  return true;
}

function attendanceDeviceMatches(log, filterDevice) {
  const f = String(filterDevice || "").trim();
  if (!f) return true;

  const selectedDevice = getDeviceByFilterValue(f);
  const allowed = new Set([f]);
  if (selectedDevice) {
    [
      selectedDevice.id,
      selectedDevice.sn,
      selectedDevice.name,
      selectedDevice.ip,
      selectedDevice.tailscale_ip,
      deviceAddress(selectedDevice)
    ].forEach(v => {
      if (v !== undefined && v !== null && String(v).trim()) allowed.add(String(v).trim());
    });
  }

  const raw = log?.raw || {};
  const candidates = [
    log?.device_sn,
    log?.device_id,
    log?.device_name,
    log?.sn,
    raw.sn,
    raw.SN,
    raw.serialNumber,
    raw.device_sn,
    raw.deviceSN,
    raw.device_id,
    raw.deviceId,
    raw.deviceName,
    raw.ip,
    raw.IP
  ].filter(v => v !== undefined && v !== null).map(v => String(v).trim());

  for (const c of candidates) {
    if (allowed.has(c)) return true;
  }

  // Jika filter berupa SN mesin terdaftar, jangan cocokkan dengan sembarang raw text agar tidak false positive.
  const rawText = safeJson(raw);
  for (const a of allowed) {
    if (a && rawText.includes(a)) return true;
  }
  return false;
}


function attendanceRecordRows(filter = {}) {
  let rows = loadAttendance().slice();

  const device = String(filter.device_sn || "").trim();
  const user = String(filter.user_id || "").trim();
  const start = normalizeDateInput(filter.start_date || "");
  const end = normalizeDateInput(filter.end_date || "");

  rows = rows.filter(r => attendanceDeviceMatches(r, device));
  rows = rows.filter(r => attendanceUserMatches(r, user));
  rows = rows.filter(r => attendanceDateMatches(r, start, end));

  rows.sort((a,b) => String(getAttendanceTimestamp(b)).localeCompare(String(getAttendanceTimestamp(a))));
  return rows;
}

function attendanceDebugSummary() {
  const rows = loadAttendance();
  const byMonth = {};
  const byDevice = {};
  for (const r of rows) {
    const d = normalizeDateFromTimestamp(getAttendanceTimestamp(r)) || "tanggal_kosong";
    const month = d.length >= 7 ? d.slice(0,7) : d;
    byMonth[month] = (byMonth[month] || 0) + 1;

    const dev = r.device_sn || r.device_name || r.device_id || "device_kosong";
    byDevice[dev] = (byDevice[dev] || 0) + 1;
  }
  return { total: rows.length, byMonth, byDevice };
}

function attendanceFilterStepDebug(filters) {
  const all = loadAttendance();
  const byDevice = all.filter(r => attendanceDeviceMatches(r, filters.device_sn));
  const byUser = byDevice.filter(r => attendanceUserMatches(r, filters.user_id));
  const byDate = byUser.filter(r => attendanceDateMatches(r, filters.start_date, filters.end_date));
  return {
    total_raw: all.length,
    after_device_filter: byDevice.length,
    after_user_filter: byUser.length,
    after_date_filter: byDate.length,
    summary: attendanceDebugSummary(),
    sample_after_device: byDevice.slice(0, 5).map(r => ({
      sn: r.device_sn,
      device_id: r.device_id,
      device_name: r.device_name,
      user_id: r.user_id,
      time: getAttendanceTimestamp(r),
      date: normalizeDateFromTimestamp(getAttendanceTimestamp(r)),
      state: getMachineLogState(r)
    })),
    sample_raw: all.slice(0, 5).map(r => ({
      sn: r.device_sn,
      device_id: r.device_id,
      device_name: r.device_name,
      user_id: r.user_id,
      time: getAttendanceTimestamp(r),
      date: normalizeDateFromTimestamp(getAttendanceTimestamp(r)),
      state: getMachineLogState(r)
    }))
  };
}



function hasKnownState(log) {
  const s = getMachineLogState(log).toLowerCase();
  return s !== "" && s !== "undefined" && s !== "null";
}

function isMachineIn(log) {
  const s = getMachineLogState(log).toLowerCase();
  return ["0", "checkin", "check-in", "in", "masuk", "ci"].includes(s) || s.includes("masuk") || s.includes("checkin");
}

function isMachineOut(log) {
  const s = getMachineLogState(log).toLowerCase();
  return ["1", "checkout", "check-out", "out", "pulang", "co"].includes(s) || s.includes("pulang") || s.includes("checkout");
}

function isMachineBreakOut(log) {
  const s = getMachineLogState(log).toLowerCase();
  return ["2", "breakout", "break-out", "istirahat keluar", "istirahat_keluar"].includes(s) || (s.includes("istirahat") && s.includes("keluar"));
}

function isMachineBreakIn(log) {
  const s = getMachineLogState(log).toLowerCase();
  return ["3", "breakin", "break-in", "istirahat masuk", "istirahat_masuk"].includes(s) || (s.includes("istirahat") && s.includes("masuk"));
}

function getRealTimesFromMachineLogs(logs) {
  const sorted = (logs || [])
    .filter(l => l && pickRawLogTime(l))
    .map(l => ({ ...l, time: pickRawLogTime(l) }))
    .sort((a,b) => String(a.time).localeCompare(String(b.time)));

  const known = sorted.filter(hasKnownState);
  const inLogs = sorted.filter(isMachineIn);
  const outLogs = sorted.filter(isMachineOut);
  const breakOutLogs = sorted.filter(isMachineBreakOut);
  const breakInLogs = sorted.filter(isMachineBreakIn);

  let checkIn = "";
  let checkOut = "";

  if (inLogs.length) checkIn = inLogs[0].time;
  else if (!known.length && sorted.length) checkIn = sorted[0].time;

  if (outLogs.length) {
    const out = outLogs.find(l => !sameMinute(l.time, checkIn) && !sameTimestamp(l.time, checkIn));
    if (out) checkOut = out.time;
  }

  checkOut = validCheckoutTime(checkIn, checkOut);

  return {
    check_in: checkIn,
    check_out: checkOut,
    break_out: (breakOutLogs[0] || {}).time || "",
    break_in: (breakInLogs[breakInLogs.length - 1] || {}).time || "",
    has_known_state: known.length > 0,
    has_explicit_checkout: outLogs.length > 0 && Boolean(checkOut),
    ignored_same_time_checkout: outLogs.length > 0 && !checkOut,
    log_count: sorted.length
  };
}

function getRealFirstLastTimesFromMachineLogs(logs) {
  // Mode real mesin:
  // Untuk tiap user + tanggal + mesin:
  // log pertama = Jam Masuk, log terakhir yang berbeda = Jam Pulang.
  // Kalau cuma 1 log, Jam Pulang kosong.
  const sorted = (logs || [])
    .filter(l => l && pickRawLogTime(l))
    .map(l => ({ ...l, time: pickRawLogTime(l) }))
    .sort((a,b) => String(a.time).localeCompare(String(b.time)));

  const uniqueTimes = [];
  const seen = new Set();
  for (const l of sorted) {
    const key = String(l.time);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTimes.push(l);
    }
  }

  const checkIn = (uniqueTimes[0] || {}).time || "";
  const checkOutRaw = uniqueTimes.length >= 2 ? (uniqueTimes[uniqueTimes.length - 1] || {}).time || "" : "";
  const checkOut = validCheckoutTime(checkIn, checkOutRaw);

  const breakOutLogs = sorted.filter(isMachineBreakOut);
  const breakInLogs = sorted.filter(isMachineBreakIn);

  return {
    check_in: checkIn,
    check_out: checkOut,
    break_out: (breakOutLogs[0] || {}).time || "",
    break_in: (breakInLogs[breakInLogs.length - 1] || {}).time || "",
    log_count: uniqueTimes.length,
    real_note: uniqueTimes.length >= 2 ? "first log masuk, last log pulang" : "baru 1 log dari mesin"
  };
}



function isExplicitMasukState(state) {
  const s = String(state ?? "").toLowerCase().trim();
  return ["0", "checkin", "in", "masuk"].includes(s) || s.includes("masuk");
}

function isExplicitPulangState(state) {
  const s = String(state ?? "").toLowerCase().trim();
  return ["1", "checkout", "out", "pulang"].includes(s) || s.includes("pulang");
}

function isExplicitBreakOutState(state) {
  const s = String(state ?? "").toLowerCase().trim();
  return ["2", "breakout", "istirahat keluar", "istirahat_keluar"].includes(s) || (s.includes("istirahat") && s.includes("keluar"));
}

function isExplicitBreakInState(state) {
  const s = String(state ?? "").toLowerCase().trim();
  return ["3", "breakin", "istirahat masuk", "istirahat_masuk"].includes(s) || (s.includes("istirahat") && s.includes("masuk"));
}

function pickRealAttendanceTimes(sortedLogs) {
  return getRealTimesFromMachineLogs(sortedLogs || []);
}


function chooseShiftForLog(log, userShiftMap, shifts) {
  const assigned = userShiftMap[String(log.user_id)];
  if (assigned) {
    const found = shifts.find(s => s.id === assigned && s.is_active !== false);
    if (found) return found;
  }
  const date = new Date(log.time);
  const active = shifts.filter(s => s.is_active !== false);
  return active.find(s => isTimeInShift(date, s)) || active[0] || defaultShifts()[0];
}

function shiftEndCompareMinutes(shift) {
  const startMin = parseTimeToMinutes(shift.start_time);
  const endMin = parseTimeToMinutes(shift.end_time);
  return endMin < startMin ? endMin + 1440 : endMin;
}

function logTimeCompareMinutesForShift(date, shift) {
  const startMin = parseTimeToMinutes(shift.start_time);
  const endMin = parseTimeToMinutes(shift.end_time);
  const mins = getTimeMinutesFromDate(date);
  if (endMin < startMin && mins < startMin) return mins + 1440;
  return mins;
}

function buildAttendanceReport(filters = {}) {
  const rows = loadAttendance();
  const users = loadUsers();
  const shifts = loadShifts();
  const userShiftMap = loadUserShifts();
  const devices = loadConfig().devices;

  const userMap = new Map(users.map(u => [String(u.user_id), u.name]));
  const deviceMap = new Map(devices.map(d => [String(d.sn || d.id), d]));

  let startDate = normalizeDateInput(filters.start_date || "");
  let endDate = normalizeDateInput(filters.end_date || "");
  const filterUser = String(filters.user_id || "").trim();
  const filterDevice = String(filters.device_sn || "").trim();
  const filterShift = String(filters.shift_id || "").trim();
  const filterStatus = String(filters.status || "").trim();

  const grouped = new Map();

  for (const log of rows) {
    const shift = chooseShiftForLog(log, userShiftMap, shifts);
    if (!shift) continue;
    const dt = new Date(log.time);
    if (isNaN(dt.getTime())) continue;
    const dateWork = workDateForShift(dt, shift);
    if (startDate && dateWork < startDate) continue;
    if (endDate && dateWork > endDate) continue;
    if (filterUser && String(log.user_id) !== filterUser) continue;
    if (filterDevice && !sameDeviceForAttendance(log, filterDevice)) continue;
    if (filterShift && String(shift.id) !== filterShift) continue;

    const key = `${dateWork}|${log.device_sn || log.device_id}|${log.user_id}|${shift.id}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        date_work: dateWork,
        user_id: String(log.user_id),
        user_name: resolveUserName(log.user_id, log.device_sn) || userMap.get(String(log.user_id)) || "",
        device_sn: log.device_sn || "",
        device_name: log.device_name || "",
        shift_id: shift.id,
        shift_name: shift.name,
        shift_start: shift.start_time,
        shift_end: shift.end_time,
        break_range: shiftBreakRange(shift),
        check_in: "",
        check_out: "",
        break_out: "",
        break_in: "",
        status: "Tidak Hadir",
        late_minutes: 0,
        early_leave_minutes: 0,
        overtime_minutes: 0,
        logs: []
      });
    }
    grouped.get(key).logs.push(log);
  }

  const reports = [];
  for (const item of grouped.values()) {
    const shift = shifts.find(s => s.id === item.shift_id) || defaultShifts()[0];
    const sorted = item.logs.slice().sort((a,b) => String(a.time).localeCompare(String(b.time)));
    const statusLogs = sorted.map(l => ({...l, att_status: detectStatusFromState(l.state)}));

    const ins = statusLogs.filter(l => l.att_status === "masuk");
    const outs = statusLogs.filter(l => l.att_status === "pulang");
    const bout = statusLogs.filter(l => l.att_status === "istirahat_keluar");
    const bin = statusLogs.filter(l => l.att_status === "istirahat_masuk");

    const realTimes = getRealFirstLastTimesFromMachineLogs(statusLogs);
    item.check_in = realTimes.check_in;
    item.check_out = realTimes.check_out;
    item.break_out = realTimes.break_out;
    item.break_in = realTimes.break_in;
    item.real_note = realTimes.real_note || "";

    const startMin = parseTimeToMinutes(shift.start_time);
    const endMin = parseTimeToMinutes(shift.end_time);
    const tolerance = Number(shift.late_tolerance_minutes || 5);

    let statuses = [];
    if (item.check_in) {
      const inDate = new Date(item.check_in);
      let inMin = getTimeMinutesFromDate(inDate);
      let diff = inMin - startMin;
      if (diff < -720) diff += 1440;
      if (diff > tolerance) {
        item.late_minutes = diff;
        statuses.push("Terlambat");
      } else {
        statuses.push("Hadir");
      }
    } else {
      statuses.push("Tidak Hadir");
    }

    if (item.check_out) {
      const outDate = new Date(item.check_out);
      const outForCompare = logTimeCompareMinutesForShift(outDate, shift);
      const endForCompare = shiftEndCompareMinutes(shift);
      const overtimeAfter = Math.max(0, Number(shift.overtime_after_minutes || 0));
      if (outForCompare < endForCompare) {
        item.early_leave_minutes = endForCompare - outForCompare;
        statuses.push("Pulang Dulu");
      }
      if (outForCompare > endForCompare + overtimeAfter) {
        item.overtime_minutes = outForCompare - (endForCompare + overtimeAfter);
        if (item.overtime_minutes > 0) statuses.push("Lembur");
      }
    } else {
      statuses.push("Tidak Absen Pulang");
    }

    item.status = [...new Set(statuses)].join(", ");
    if (filterStatus && !item.status.toLowerCase().includes(filterStatus.toLowerCase())) continue;
    reports.push(item);
  }

  return reports.sort((a,b) => `${a.date_work}${a.user_id}`.localeCompare(`${b.date_work}${b.user_id}`));
}

function csvEscape(v) {
  return `"${String(v ?? "").replaceAll('"','""')}"`;
}

function sqlString(v) {
  if (v === null || v === undefined || v === "") return "NULL";
  return "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
}

function sqlNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(fallback);
}

function buildFullSqlDump() {
  const config = loadConfig();
  const users = loadUsers();
  const appUsers = loadAppUsers();
  const attendance = loadAttendance();
  const shifts = loadShifts();
  const nameCache = loadUserNameCache();
  const appSettings = loadAppSettings();
  const printerSettings = loadPrinterSettings();

  let sql = "";
  sql += "-- CSL Fingerprint Server relational database backup\n";
  sql += `-- Created at: ${new Date().toISOString()}\n\n`;
  sql += "CREATE DATABASE IF NOT EXISTS csl_fingerprint CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n";
  sql += "USE csl_fingerprint;\n\n";
  sql += "SET FOREIGN_KEY_CHECKS=0;\n\n";

  sql += `
CREATE TABLE IF NOT EXISTS app_users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(128) NOT NULL,
  name VARCHAR(150),
  role ENUM('admin','user') NOT NULL DEFAULT 'user',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  sn VARCHAR(100) UNIQUE,
  ip VARCHAR(80),
  tailscale_ip VARCHAR(80),
  port INT DEFAULT 4370,
  location VARCHAR(150),
  brand VARCHAR(80),
  protocol VARCHAR(80),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_device_access (
  app_user_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (app_user_id, device_id),
  CONSTRAINT fk_uda_user FOREIGN KEY (app_user_id) REFERENCES app_users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_uda_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fingerprint_users (
  user_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(150),
  card VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attendance_logs (
  id VARCHAR(255) PRIMARY KEY,
  device_id VARCHAR(64),
  device_sn VARCHAR(100),
  user_id VARCHAR(50),
  check_time DATETIME,
  state VARCHAR(50),
  status1 VARCHAR(50),
  status2 VARCHAR(50),
  status3 VARCHAR(50),
  status4 VARCHAR(50),
  status5 VARCHAR(50),
  raw_json LONGTEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_att_device_time (device_id, check_time),
  INDEX idx_att_sn_time (device_sn, check_time),
  INDEX idx_att_user_time (user_id, check_time),
  CONSTRAINT fk_att_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_att_user FOREIGN KEY (user_id) REFERENCES fingerprint_users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shifts (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100),
  start_time TIME,
  end_time TIME,
  break_minutes INT DEFAULT 60,
  late_tolerance_minutes INT DEFAULT 5,
  overtime_after_minutes INT DEFAULT 30,
  is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_shift_assignments (
  user_id VARCHAR(50) NOT NULL,
  shift_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  PRIMARY KEY (user_id, shift_id, device_id),
  CONSTRAINT fk_usa_user FOREIGN KEY (user_id) REFERENCES fingerprint_users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_usa_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_usa_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS printer_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_name_cache (
  cache_key VARCHAR(160) PRIMARY KEY,
  name VARCHAR(150)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
\n`;

  sql += "DELETE FROM user_device_access;\nDELETE FROM attendance_logs;\nDELETE FROM user_shift_assignments;\nDELETE FROM app_settings;\nDELETE FROM printer_settings;\nDELETE FROM user_name_cache;\nDELETE FROM shifts;\nDELETE FROM fingerprint_users;\nDELETE FROM devices;\nDELETE FROM app_users;\n\n";

  for (const u of appUsers) {
    sql += `INSERT INTO app_users (id,username,password_hash,name,role,is_active,created_at,updated_at) VALUES (${sqlString(u.id)},${sqlString(u.username)},${sqlString(u.password_hash)},${sqlString(u.name)},${sqlString(u.role)},${u.is_active === false ? 0 : 1},${sqlString(u.created_at)},${sqlString(u.updated_at)});\n`;
  }

  for (const d of config.devices || []) {
    sql += `INSERT INTO devices (id,name,sn,ip,tailscale_ip,port,location,brand,protocol) VALUES (${sqlString(d.id)},${sqlString(d.name)},${sqlString(d.sn)},${sqlString(d.ip)},${sqlString(d.tailscale_ip)},${sqlNumber(d.port,4370)},${sqlString(d.location)},${sqlString(d.brand || "zkteco-compatible")},${sqlString(d.protocol || "zk-tcp")});\n`;
  }

  for (const u of appUsers) {
    if (u.role === "admin") continue;
    for (const deviceId of (u.allowed_device_ids || [])) {
      const d = (config.devices || []).find(x => x.id === deviceId || x.sn === deviceId);
      if (d) sql += `INSERT INTO user_device_access (app_user_id,device_id) VALUES (${sqlString(u.id)},${sqlString(d.id)});\n`;
    }
  }

  for (const u of users || []) {
    sql += `INSERT INTO fingerprint_users (user_id,name,card) VALUES (${sqlString(u.user_id)},${sqlString(u.name)},${sqlString(u.card)});\n`;
  }

  for (const s of shifts || []) {
    sql += `INSERT INTO shifts (id,name,start_time,end_time,break_minutes,late_tolerance_minutes,overtime_after_minutes,is_active) VALUES (${sqlString(s.id)},${sqlString(s.name)},${sqlString(s.start_time)},${sqlString(s.end_time)},${sqlNumber(s.break_minutes,60)},${sqlNumber(s.late_tolerance_minutes,5)},${sqlNumber(s.overtime_after_minutes,30)},${s.is_active === false ? 0 : 1});\n`;
  }

  for (const a of attendance || []) {
    const raw = a.raw || {};
    sql += `INSERT INTO attendance_logs (id,device_id,device_sn,user_id,check_time,state,status1,status2,status3,status4,status5,raw_json) VALUES (${sqlString(a.id)},${sqlString(a.device_id)},${sqlString(a.device_sn)},${sqlString(a.user_id)},${sqlString(a.time)},${sqlString(a.state)},${sqlString(getRawStatusValue(a,1))},${sqlString(getRawStatusValue(a,2))},${sqlString(getRawStatusValue(a,3))},${sqlString(getRawStatusValue(a,4))},${sqlString(getRawStatusValue(a,5))},${sqlString(safeJson(raw || a))});\n`;
  }

  for (const [k,v] of Object.entries(appSettings || {})) {
    sql += `INSERT INTO app_settings (setting_key,setting_value) VALUES (${sqlString(k)},${sqlString(v)});\n`;
  }

  for (const [k,v] of Object.entries(printerSettings || {})) {
    sql += `INSERT INTO printer_settings (setting_key,setting_value) VALUES (${sqlString(k)},${sqlString(v)});\n`;
  }

  for (const [k,v] of Object.entries(nameCache || {})) {
    sql += `INSERT INTO user_name_cache (cache_key,name) VALUES (${sqlString(k)},${sqlString(v)});\n`;
  }

  sql += "\nSET FOREIGN_KEY_CHECKS=1;\n";
  return sql;
}

function normalizeSqlTextForImport(sqlText) {
  let text = String(sqlText || "");
  // Beberapa export lama tersimpan dengan literal "\\n". Ubah jadi newline asli.
  const literalCount = (text.match(/\\n/g) || []).length;
  const realCount = (text.match(/\n/g) || []).length;
  if (literalCount > realCount * 2) {
    text = text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  return text;
}

function parseSqlTupleValues(tupleText) {
  const vals = [];
  let cur = "";
  let quote = false;
  let escape = false;

  for (let i = 0; i < tupleText.length; i++) {
    const ch = tupleText[i];

    if (quote) {
      if (escape) {
        cur += ch;
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "'") {
        if (tupleText[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          quote = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === "'") quote = true;
      else if (ch === ",") {
        vals.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  vals.push(cur.trim());

  return vals.map(v => {
    const x = String(v || "").trim();
    if (/^NULL$/i.test(x)) return "";
    if (/^-?\d+(\.\d+)?$/.test(x)) return x;
    return x;
  });
}

function parseInsertRowsByRegex(sqlText) {
  const text = normalizeSqlTextForImport(sqlText);
  const rows = [];
  const re = /INSERT\s+INTO\s+`?([a-zA-Z0-9_]+)`?\s*(?:\(([^)]*)\))?\s+VALUES\s*\(([\s\S]*?)\)\s*;/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const table = m[1];
    const columns = m[2] ? m[2].split(",").map(c => c.replace(/[`"']/g, "").trim()) : [];
    const values = parseSqlTupleValues(m[3]);
    const row = {};
    columns.forEach((c, i) => row[c] = values[i] ?? "");
    rows.push({ table, columns, values, row });
  }
  return rows;
}

function getRowValue(parsed, name, fallbackIndex = -1) {
  if (parsed.row && Object.prototype.hasOwnProperty.call(parsed.row, name)) return parsed.row[name];
  if (fallbackIndex >= 0) return parsed.values[fallbackIndex] ?? "";
  return "";
}

function applyImportedSqlText(sqlText) {
  const text = normalizeSqlTextForImport(sqlText);
  const parsedRows = parseInsertRowsByRegex(text);

  const config = loadConfig();
  const devices = [];
  const users = [];
  const attendance = [];
  const shifts = [];
  const cache = {};

  const debug = {
    total_insert_statements: parsedRows.length,
    tables: {},
    sample: text.slice(0, 1200)
  };

  for (const parsed of parsedRows) {
    debug.tables[parsed.table] = (debug.tables[parsed.table] || 0) + 1;

    if (parsed.table === "devices") {
      devices.push({
        id: getRowValue(parsed, "id", 0),
        name: getRowValue(parsed, "name", 1),
        sn: getRowValue(parsed, "sn", 2),
        ip: getRowValue(parsed, "ip", 3),
        tailscale_ip: getRowValue(parsed, "tailscale_ip", 4),
        port: Number(getRowValue(parsed, "port", 5) || 4370),
        location: getRowValue(parsed, "location", 6),
        brand: getRowValue(parsed, "brand", 7) || "zkteco-compatible",
        protocol: getRowValue(parsed, "protocol", 8) || "zk-tcp"
      });
      continue;
    }

    if (parsed.table === "users") {
      users.push({
        user_id: getRowValue(parsed, "user_id", 0),
        name: getRowValue(parsed, "name", 1),
        card: getRowValue(parsed, "card", 2)
      });
      continue;
    }

    if (parsed.table === "attendance_logs") {
      const id = getRowValue(parsed, "id", 0);
      const device_id = getRowValue(parsed, "device_id", 1);
      const device_sn = getRowValue(parsed, "device_sn", 2);
      const device_name = getRowValue(parsed, "device_name", 3);
      const user_id = getRowValue(parsed, "user_id", 4);
      const user_name = getRowValue(parsed, "user_name", 5);
      const check_time = getRowValue(parsed, "check_time", 6);
      const state = getRowValue(parsed, "state", 7);
      attendance.push({ id, device_id, device_sn, device_name, user_id, time: check_time, state, raw: {} });
      if (user_id && user_name) {
        cache[user_id] = user_name;
        if (device_sn) cache[`${device_sn}:${user_id}`] = user_name;
      }
      continue;
    }

    if (parsed.table === "shifts") {
      const hasOvertimeColumn = parsed.columns.includes("overtime_after_minutes");
      shifts.push({
        id: getRowValue(parsed, "id", 0),
        name: getRowValue(parsed, "name", 1),
        start_time: getRowValue(parsed, "start_time", 2),
        end_time: getRowValue(parsed, "end_time", 3),
        break_minutes: Number(getRowValue(parsed, "break_minutes", 4) || 60),
        late_tolerance_minutes: Number(getRowValue(parsed, "late_tolerance_minutes", 5) || 5),
        overtime_after_minutes: Number(hasOvertimeColumn ? (getRowValue(parsed, "overtime_after_minutes", 6) || 30) : 30),
        is_active: String(getRowValue(parsed, "is_active", hasOvertimeColumn ? 7 : 6)) !== "0"
      });
      continue;
    }

    if (parsed.table === "user_name_cache") {
      const k = getRowValue(parsed, "cache_key", 0);
      const v = getRowValue(parsed, "name", 1);
      if (k) cache[k] = v;
    }
  }

  // Fallback produksi: kalau SQL tidak berisi INSERT devices, jangan kosongkan mesin.
  // Ambil mesin yang saat ini sudah terinput di list mesin aplikasi.
  let usedCurrentDevicesFallback = false;
  if (!devices.length && config.devices && config.devices.length) {
    usedCurrentDevicesFallback = true;
  }


  const importedAppSettings = {};
  const importedPrinterSettings = {};
  const importedAppUsers = [];
  for (const parsed of parsedRows || []) {
    if (parsed.table === "app_settings") {
      const k = getRowValue(parsed, "setting_key", 0);
      const v = getRowValue(parsed, "setting_value", 1);
      if (k) importedAppSettings[k] = v;
    }
    if (parsed.table === "printer_settings") {
      const k = getRowValue(parsed, "setting_key", 0);
      const v = getRowValue(parsed, "setting_value", 1);
      if (k) importedPrinterSettings[k] = v;
    }
    if (parsed.table === "app_users") {
      importedAppUsers.push({
        id: getRowValue(parsed, "id", 0),
        username: getRowValue(parsed, "username", 1),
        password_hash: getRowValue(parsed, "password_hash", 2),
        name: getRowValue(parsed, "name", 3),
        role: getRowValue(parsed, "role", 4) || "user",
        is_active: String(getRowValue(parsed, "is_active", 5)) !== "0",
        created_at: getRowValue(parsed, "created_at", 6),
        updated_at: getRowValue(parsed, "updated_at", 7)
      });
    }
  }
  if (Object.keys(importedAppSettings).length) saveAppSettings(importedAppSettings);
  if (Object.keys(importedPrinterSettings).length) savePrinterSettings({
    ...importedPrinterSettings,
    enabled: String(importedPrinterSettings.enabled) === "true" || String(importedPrinterSettings.enabled) === "1",
    auto_print_attendance: String(importedPrinterSettings.auto_print_attendance) === "true" || String(importedPrinterSettings.auto_print_attendance) === "1"
  });
  if (importedAppUsers.length) saveAppUsers(importedAppUsers);

  if (devices.length) { config.devices = devices; saveConfig(config); }
  if (users.length) saveUsers(users);
  if (attendance.length) saveAttendance(attendance);
  if (shifts.length) saveShifts(shifts);
  if (Object.keys(cache).length) saveUserNameCache({ ...loadUserNameCache(), ...cache });

  return {
    devices: devices.length || (usedCurrentDevicesFallback ? config.devices.length : 0),
    devices_imported: devices.length,
    devices_kept_from_current_list: usedCurrentDevicesFallback ? config.devices.length : 0,
    users: users.length,
    attendance: attendance.length,
    shifts: shifts.length,
    cache: Object.keys(cache).length,
    debug
  };
}




// =======================
// BACKUP / RESTORE / DAT INSPECTOR
// =======================
function sha256File(filePath) {
  const hash = require("crypto").createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function asciiPreview(buffer, limit = 6000) {
  return buffer.toString("latin1", 0, Math.min(buffer.length, limit))
    .replace(/[^\x20-\x7E\r\n\t]/g, ".")
    .slice(0, limit);
}

function extractAsciiStrings(buffer, minLen = 4, maxItems = 300) {
  const strings = [];
  let current = "";
  for (const b of buffer) {
    if (b >= 32 && b <= 126) current += String.fromCharCode(b);
    else {
      if (current.length >= minLen) strings.push(current);
      current = "";
      if (strings.length >= maxItems) break;
    }
  }
  if (current.length >= minLen && strings.length < maxItems) strings.push(current);
  return strings;
}

function inspectDatFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const strings = extractAsciiStrings(buffer, 4, 500);
  const preview = asciiPreview(buffer, 8000);
  const headerHex = buffer.subarray(0, Math.min(128, buffer.length)).toString("hex").match(/.{1,2}/g)?.join(" ") || "";
  const likelyZk = /ZK|ZKTECO|ZK format|BWXP|USER|FP|FACE|ATT/i.test(preview) || strings.some(s => /ZK|BWXP|backup|format/i.test(s));
  const templateHints = strings.filter(s => /template|finger|fp|bio|user|pin|uid|face|palm/i.test(s)).slice(0, 100);
  return {
    filename: path.basename(filePath),
    size_bytes: buffer.length,
    sha256: sha256File(filePath),
    header_hex: headerHex,
    likely_zk_format: likelyZk,
    ascii_strings_count: strings.length,
    strings_preview: strings.slice(0, 120),
    template_hints: templateHints,
    raw_preview: preview.slice(0, 2000),
    can_parse_full_fingerprint: false,
    note: "File DAT berhasil disimpan dan diinspeksi. Restore fingerprint binary penuh membutuhkan command template yang cocok dari firmware/SDK. Mode aman tidak menulis template jika parser belum valid."
  };
}

function saveBackupRecord(record) {
  const rows = loadBackupHistory();
  rows.unshift(record);
  saveBackupHistory(rows.slice(0, 1000));
}

async function readDeviceBundle(deviceConfig) {
  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    const users = await getUsersFromDevice(device).catch(err => ({ error: errorText(err), data: [] }));
    if (Array.isArray(users)) updateUserNameCacheFromUsers(users, deviceConfig);
    else if (Array.isArray(users.data)) updateUserNameCacheFromUsers(users.data, deviceConfig);
    const attendance = await getAttendanceFromDevice(device, deviceConfig).catch(err => ({ error: errorText(err), data: [] }));
    await closeDevice(device);
    return { ok:true, device: deviceConfig, users, attendance };
  } catch (err) {
    await closeDevice(device);
    return { ok:false, error:errorText(err), device: deviceConfig };
  }
}

function createJsonBackupFile(deviceConfig, bundle) {
  const filename = `backup-${(deviceConfig.sn || deviceConfig.id || "device").replace(/[^a-zA-Z0-9_-]/g,"_")}-${Date.now()}.json`;
  const filePath = path.join(BACKUP_DIR, filename);
  const data = { type: "CSL_JSON_BACKUP", version: "1.0", created_at: new Date().toISOString(), device: deviceConfig, bundle };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return { filename, filePath, sha256: sha256File(filePath), size_bytes: fs.statSync(filePath).size };
}

async function restoreUsersToDeviceFromJsonBackup(backupFilePath, targetDeviceConfig) {
  const raw = JSON.parse(fs.readFileSync(backupFilePath, "utf8"));
  let users = [];
  if (raw.bundle && raw.bundle.users) {
    if (Array.isArray(raw.bundle.users)) users = raw.bundle.users;
    else if (Array.isArray(raw.bundle.users.data)) users = raw.bundle.users.data;
  }
  let device = null;
  const sent = [], failed = [];
  try {
    device = await connectDevice(targetDeviceConfig);
    for (const u of users) {
      const user_id = String(u.user_id || u.userId || u.userid || u.uid || "").trim();
      const name = String(u.name || u.username || u.userName || `User ${user_id}`).trim();
      const card = String(u.card || u.cardno || u.cardNo || "").trim();
      if (!user_id) continue;
      try { await setUserToDevice(device, { user_id, name, card }); sent.push(`${user_id} - ${name}`); }
      catch (err) { failed.push(`${user_id} - ${name}: ${errorText(err)}`); }
    }
    await closeDevice(device);
    return { ok:true, sent, failed };
  } catch (err) {
    await closeDevice(device);
    return { ok:false, sent, failed, error:errorText(err) };
  }
}

// =======================
// HTML
// =======================
function htmlPageLegacyUnused(title, content, user = (global.__cslCurrentUser || null)) {
  const adminMenu = `
    <a href="/"><span>🏠</span><b>Admin</b></a>
    <a href="/live"><span>📡</span><b>Live</b></a>
    <a href="/absensi" data-active-paths="/absensi,/attendance,/attendance-report,/shifts"><span>📊</span><b>Absensi</b></a>
    <a href="/detect-machine"><span>🔎</span><b>Detek Mesin</b></a>
    <a href="/app-users"><span>👥</span><b>Role User</b></a>
    <a href="/settings" data-active-paths="/settings,/auto-sync,/backup-restore,/settings-printer,/advanced,/remote-enroll-center,/machine-adapters,/attendance-raw-debug,/online-access-guide,/tailscale-guide"><span>⚙️</span><b>Setting</b></a>
    <a href="/database-tools"><span>🗄️</span><b>Database</b></a>
    `;
  const userMenu = `
    <a href="/"><span>🏠</span><b>Dashboard</b></a>
    <a href="/live"><span>📡</span><b>Live</b></a>
    <a href="/absensi" data-active-paths="/absensi,/attendance,/attendance-report"><span>📊</span><b>Absensi</b></a>`;
  const menu = isAdminUser(user) ? adminMenu : userMenu;
  return `<!DOCTYPE html><html lang="id"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title><link rel="stylesheet" href="/assets/style.css"></head><body>
  <button class="hamburger" type="button" onclick="document.body.classList.toggle('sidebar-open')">☰</button>
  <aside class="sidebar"><div class="brand"><div class="brand-logo">CSL</div><div><strong>Fingerprint</strong><small>${escapeHtml(user ? `${user.name||user.username} • ${user.role}` : "Login")}</small></div></div><nav class="side-menu">${menu}${user?'<a href="/logout"><span>🚪</span><b>Logout</b></a>':''}</nav></aside>
  <div class="sidebar-backdrop" onclick="document.body.classList.remove('sidebar-open')"></div>
  <main class="main-shell"><div class="box">${content}</div></main>
  <nav class="mobile-bottom">${menu}${user?'<a href="/logout"><span>🚪</span><b>Logout</b></a>':''}</nav>
  <script>
    (function(){
      var path = window.location.pathname;
      document.querySelectorAll('.side-menu a, .mobile-bottom a').forEach(function(link){
        var href = link.getAttribute('href') || '';
        var groupedPaths = (link.getAttribute('data-active-paths') || '').split(',').filter(Boolean);
        var groupedActive = groupedPaths.some(function(prefix){
          return path === prefix || (prefix !== '/' && path.startsWith(prefix));
        });
        if (!href.startsWith('/')) return;
        if (groupedActive || href === path || (href !== '/' && path.startsWith(href))) {
          link.classList.add('active');
        }
        link.addEventListener('click', function(){
          document.body.classList.remove('sidebar-open');
        });
      });
      window.copyTextFromButton = function(btn) {
        var text = btn.getAttribute('data-copy-text') || '';
        function done() {
          var old = btn.innerText;
          btn.innerText = 'Copied';
          setTimeout(function(){ btn.innerText = old || 'Copy'; }, 1200);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function(){
            var temp = document.createElement('textarea');
            temp.value = text;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            document.body.removeChild(temp);
            done();
          });
          return;
        }
        var temp = document.createElement('textarea');
        temp.value = text;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
        done();
      };
    })();
  </script>
</body></html>`;
}

function iconSvg(name) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
  const icons = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect>',
    live: '<path d="M3 12h4l2-5 4 10 2-5h6"></path><circle cx="12" cy="12" r="9"></circle>',
    attendance: '<rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M8 2v4"></path><path d="M16 2v4"></path><path d="M3 10h18"></path><path d="m8 15 2 2 5-5"></path>',
    detect: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v4"></path><path d="M12 18v4"></path><path d="M2 12h4"></path><path d="M18 12h4"></path><path d="M5 5l3 3"></path><path d="M16 16l3 3"></path>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
    settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 4.1l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"></path>',
    logout: '<path d="M10 17l5-5-5-5"></path><path d="M15 12H3"></path><path d="M21 3v18"></path>',
    device: '<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8"></path><path d="M12 17v4"></path>',
    report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h5"></path>',
    shift: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    pull: '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
    port: '<path d="M7 7V3"></path><path d="M17 7V3"></path><path d="M6 7h12v5a6 6 0 0 1-12 0z"></path><path d="M12 18v3"></path>',
    test: '<path d="M3 12h4l2-6 4 12 2-6h6"></path>',
    reboot: '<path d="M21 12a9 9 0 1 1-3-6.7"></path><path d="M21 3v6h-6"></path>',
    send: '<path d="M22 2 11 13"></path><path d="m22 2-7 20-4-9-9-4z"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    print: '<path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 0 1-2-2v-5h20v5a2 2 0 0 1-2 2h-2"></path><path d="M6 14h12v8H6z"></path>',
    more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>'
  };
  return `<svg class="ui-icon ui-icon-${escapeHtml(name)}" ${common}>${icons[name] || icons.dashboard}</svg>`;
}

function htmlPage(title, content, user = (global.__cslCurrentUser || null)) {
  const navItems = isAdminUser(user)
    ? [
      { href:"/", icon:"dashboard", label:"Admin" },
      { href:"/live", icon:"live", label:"Live" },
      { href:"/absensi", icon:"attendance", label:"Absensi", paths:"/absensi,/attendance,/attendance-report,/laporan-absensi,/shifts" },
      { href:"/detect-machine", icon:"detect", label:"Detek Mesin" },
      { href:"/app-users", icon:"users", label:"Role User" },
      { href:"/settings", icon:"settings", label:"Setting", paths:"/settings,/auto-sync,/backup-restore,/settings-printer,/advanced,/remote-enroll-center,/machine-adapters,/attendance-raw-debug,/online-access-guide,/tailscale-guide" },
      { href:"/database-tools", icon:"database", label:"Database" }
    ]
    : [
      { href:"/", icon:"dashboard", label:"Dashboard" },
      { href:"/live", icon:"live", label:"Live" },
      { href:"/absensi", icon:"attendance", label:"Absensi", paths:"/absensi,/attendance,/attendance-report,/laporan-absensi" }
    ];
  if (user) navItems.push({ href:"/logout", icon:"logout", label:"Logout" });

  const menu = navItems.map(item => `
    <a href="${escapeHtml(item.href)}"${item.paths ? ` data-active-paths="${escapeHtml(item.paths)}"` : ""}>
      <span class="pc-micon" aria-hidden="true">${iconSvg(item.icon)}</span>
      <b>${escapeHtml(item.label)}</b>
    </a>
  `).join("");
  const displayName = user ? `${user.name || user.username || "User"} - ${user.role || "user"}` : "Login";
  const userInitials = String(user?.username || user?.name || "AD").slice(0, 2).toUpperCase();

  return `<!DOCTYPE html><html lang="id"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/assets/style.css">
  <script defer src="/assets/assets/app.js"></script>
</head><body class="able-pro-layout" data-theme="light">
  <button class="hamburger pc-mobile-toggle" type="button" data-mobile-nav aria-label="Buka menu"><span></span><span></span><span></span></button>
  <aside class="sidebar pc-sidebar">
    <div class="brand pc-brand">
      <div class="brand-logo pc-logo">CSL</div>
      <div><strong>Fingerprint</strong><small>Able Pro Bootstrap 5</small></div>
    </div>
    <div class="pc-nav-caption">Navigation</div>
    <nav class="side-menu pc-navbar">${menu}</nav>
  </aside>
  <div class="sidebar-backdrop" data-sidebar-backdrop></div>
  <main class="main-shell pc-main">
    <header class="pc-header">
      <div>
        <span class="pc-breadcrumb">CSL Digital / ${escapeHtml(title)}</span>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="pc-header-actions">
        <button class="pc-icon-btn" type="button" data-theme-toggle title="Theme mode">Auto</button>
        <div class="pc-user-chip"><span>${escapeHtml(userInitials)}</span><b>${escapeHtml(displayName)}</b></div>
      </div>
    </header>
    <section class="box pc-container">${content}</section>
  </main>
  <nav class="mobile-bottom pc-mobile-bottom">${menu}</nav>
</body></html>`;
}

function deviceSelect(name, devices, selected = "") {
  return `<select name="${escapeHtml(name)}" required>
    ${devices.map(d => `<option value="${escapeHtml(d.id)}" ${String(selected) === String(d.id) ? "selected" : ""}>${escapeHtml(d.name)} - SN:${escapeHtml(d.sn || "-")} - ${escapeHtml(deviceAddress(d))}:${escapeHtml(d.port)}</option>`).join("")}
  </select>`;
}

function checkedAttr(condition) {
  return condition ? "checked" : "";
}

function renderAddDeviceForm() {
  return `
    <form method="POST" action="/add-device">
      <label>Nama Mesin</label>
      <input name="name" placeholder="Contoh: Cabang Bandung" required>
      <label>IP Lokal Mesin</label>
      <input name="ip" placeholder="Opsional, contoh: 192.168.18.200">
      <label>Host Public / Domain</label>
      <input name="public_ip" placeholder="Opsional, contoh: cabang-a.ddns.net">
      <label>Tailscale IP / IP PC Cabang</label>
      <input name="tailscale_ip" placeholder="Contoh: 100.x.x.x">
      <label>Prioritas Host Koneksi</label>
      <select name="preferred_host">
        <option value="auto">Auto (Tailscale > Public > Lokal)</option>
        <option value="tailscale">Pakai Tailscale</option>
        <option value="public">Pakai Public/Domain</option>
        <option value="local">Pakai IP Lokal</option>
      </select>
      <label>Port Mesin</label>
      <input name="port" value="4370" required>
      <label>Serial Number / SN</label>
      <input name="sn" placeholder="Wajib jika IP lokal sama antar cabang">
      <label>Brand / Adapter Mesin</label>
      <select name="brand">
        ${supportedAdapters().map(adapter => `<option value="${escapeHtml(adapter.id)}">${escapeHtml(adapter.name)} - ${escapeHtml(adapter.protocol)}</option>`).join("")}
      </select>
      <label>Protocol</label>
      <select name="protocol">
        <option value="zk-tcp">ZK TCP / Pull SDK Compatible</option>
        <option value="adms-http">ADMS / Push HTTP</option>
        <option value="bridge-exe">SDK Bridge EXE</option>
      </select>
      <label>Lokasi</label>
      <input name="location" placeholder="Opsional">
      <button type="submit">Tambah Mesin</button>
    </form>
  `;
}

function normalizeBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replace(/\/+$/g, "") + "/";
}

function requestBaseUrl(req) {
  const host = String(req.headers.host || "").trim();
  if (!host) return "";
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim() || "http";
  return `${proto}://${host}/`;
}

function detectedLanIps() {
  const nets = os.networkInterfaces();
  const rows = [];
  for (const items of Object.values(nets)) {
    for (const item of items || []) {
      if (!item || item.family !== "IPv4" || item.internal) continue;
      if (!item.address || /^169\.254\./.test(item.address)) continue;
      rows.push(item.address);
    }
  }
  return uniqStrings(rows);
}

function detectedLanBaseUrls() {
  return detectedLanIps().map(ip => normalizeBaseUrl(`http://${ip}:${PORT}`));
}

function buildServerUrls(req, config = loadConfig(), appSettings = loadAppSettings()) {
  const lanBase = normalizeBaseUrl(`http://${config.computer_ip || "IP-SERVER"}:${PORT}`);
  const currentBase = normalizeBaseUrl(requestBaseUrl(req));
  const publicBase = normalizeBaseUrl(appSettings.public_base_url || "");
  const detectedBases = detectedLanBaseUrls();
  const admsPath = String(config.adms_url || "/csl/login").startsWith("/")
    ? String(config.adms_url || "/csl/login")
    : `/${String(config.adms_url || "csl/login")}`;

  return {
    lanBase,
    loginUrl: `${lanBase}login`,
    currentBase,
    publicBase,
    detectedBases,
    admsUrl: `${lanBase.replace(/\/$/, "")}${admsPath}`
  };
}

function copyUrlRow(label, value, note = "") {
  if (!value) return "";
  return `
    <label>${escapeHtml(label)}</label>
    <div class="copy-url-row">
      <input value="${escapeHtml(value)}" readonly onclick="this.select()">
      <button class="gray" type="button" data-copy-text="${escapeHtml(value)}" onclick="copyTextFromButton(this)">Copy</button>
    </div>
    ${note ? `<p class="small">${escapeHtml(note)}</p>` : ""}
  `;
}

function renderServerUrlCard(req, config = loadConfig(), appSettings = loadAppSettings()) {
  const urls = buildServerUrls(req, config, appSettings);
  const detectedRows = (urls.detectedBases || [])
    .filter(url => url && url !== urls.lanBase && url !== urls.currentBase)
    .map((url, index) => copyUrlRow(`URL LAN Terdeteksi ${index + 1}`, url, "Otomatis dari network interface PC server."))
    .join("");
  return `
    <div class="card">
      <h3>URL Server untuk Client</h3>
      <p class="small">Client cukup copy URL LAN ini. Format aktif aplikasi sekarang memakai <b>IP PC Server:Port</b>.</p>
      ${copyUrlRow("URL Client LAN", urls.lanBase, "Dipakai client di jaringan LAN/VPN/Tailscale.")}
      ${copyUrlRow("URL Login Client", urls.loginUrl)}
      ${copyUrlRow("URL Browser Saat Ini", urls.currentBase)}
      ${detectedRows}
      ${urls.publicBase ? copyUrlRow("Public / Domain URL", urls.publicBase, "Dipakai jika sudah ada domain, No-IP, IP public, atau reverse proxy.") : ""}
      ${copyUrlRow("URL ADMS Mesin", urls.admsUrl, "Dipakai mesin untuk mode ADMS/push jika diperlukan.")}
      <div class="msg warn">
        Jika ingin format <b>http://ip-server/namaaplikasi</b> tanpa port, perlu reverse proxy/alias ke port ${PORT}. Untuk kondisi sekarang, URL yang valid adalah <b>http://ip-server:${PORT}/</b>.
      </div>
    </div>
  `;
}

// =======================
// DEVICE CONNECTION
// =======================
function tcpPortCheck(host, port, timeout = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok, message) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, message });
    };

    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true, `Port ${port} terbuka di ${host}`));
    socket.once("timeout", () => finish(false, `Timeout. Port ${port} tidak merespon di ${host}`));
    socket.once("error", (err) => finish(false, errorText(err)));
    socket.connect(port, host);
  });
}

function newDevice(device) {
  if (!Zkteco) throw new Error("Library zkteco-js belum terinstall. Jalankan install-dan-jalankan.bat.");
  const host = deviceAddress(device);
  if (!host) throw new Error("IP / Tailscale IP mesin kosong.");
  // Timeout dibuat lebih longgar untuk mesin yang lambat/busy.
  return new Zkteco(host, Number(device.port), 10000, 8000);
}

async function closeDevice(device) {
  try { if (device && typeof device.disconnect === "function") await device.disconnect(); } catch (_) {}
}

async function connectDevice(deviceConfig) {
  const host = deviceAddress(deviceConfig);
  const port = Number(deviceConfig.port || 4370);
  const check = await tcpPortCheck(host, port, 3000);
  if (!check.ok) throw new Error(check.message);
  const device = newDevice(deviceConfig);
  await device.createSocket();
  return device;
}

async function tryDeviceMethod(device, methodName) {
  if (typeof device[methodName] !== "function") return { skipped:true };
  try {
    const value = await device[methodName]();
    return { ok:true, value };
  } catch (err) {
    return { ok:false, error:errorText(err) };
  }
}

async function detectDeviceInfoByAddress(address, port) {
  const tempDeviceConfig = {
    id: "detect-temp",
    name: "Detect Temp",
    ip: String(address || "").trim(),
    tailscale_ip: "",
    port: Number(port || 4370),
    sn: "",
    location: ""
  };

  let device = null;
  try {
    device = await connectDevice(tempDeviceConfig);

    const methodNames = [
      "getInfo",
      "getSerialNumber",
      "getDeviceSerialNumber",
      "getSN",
      "getDeviceSN",
      "getDeviceInfo",
      "getDeviceVersion",
      "getFirmware",
      "getPlatform",
      "getOS",
      "getVendor",
      "getProductCode",
      "getDeviceName",
      "getTime"
    ];

    const info = {};
    for (const method of methodNames) {
      const result = await tryDeviceMethod(device, method);
      if (!result.skipped) info[method] = result;
    }

    // Beberapa versi zkteco-js menyimpan info di properti internal.
    const internalCandidates = ["info", "deviceInfo", "session", "options", "parameters"];
    for (const key of internalCandidates) {
      try {
        if (device[key]) info[`internal_${key}`] = device[key];
      } catch (_) {}
    }

    let usersCount = "";
    try {
      if (typeof device.getUsers === "function") {
        const users = await getUsersFromDevice(device);
        usersCount = users.length;
      }
    } catch (errUsers) {
      info.users_count_error = errorText(errUsers);
    }

    await closeDevice(device);

    const sn = extractSerialNumber(info);
    const serialCandidates = extractSerialCandidates(info);

    return {
      ok: true,
      address: tempDeviceConfig.ip,
      port: tempDeviceConfig.port,
      sn,
      serial_candidates: serialCandidates,
      users_count: usersCount,
      info,
      note: sn
        ? "SN berhasil dibaca otomatis."
        : "Koneksi berhasil, tetapi SN tidak ditemukan dari method library. Lihat Raw Info/Serial Candidates; kemungkinan firmware/library tidak mengekspos SN via TCP."
    };
  } catch (err) {
    await closeDevice(device);
    return {
      ok: false,
      address: tempDeviceConfig.ip,
      port: tempDeviceConfig.port,
      sn: "",
      serial_candidates: [],
      error: errorText(err)
    };
  }
}

function stringifyDeep(value) {
  try {
    if (typeof value === "string") return value;
    if (Buffer.isBuffer(value)) return value.toString("latin1");
    return JSON.stringify(value);
  } catch (_) {
    return String(value || "");
  }
}

function flattenAny(value, prefix = "", out = []) {
  if (value === null || value === undefined) return out;
  if (Buffer.isBuffer(value)) {
    out.push([prefix, value.toString("latin1")]);
    return out;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.push([prefix, String(value)]);
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      flattenAny(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

function cleanSerialCandidate(v) {
  return String(v ?? "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^serial\s*(number)?\s*[:=]\s*/i, "")
    .replace(/^sn\s*[:=]\s*/i, "")
    .trim();
}

function isValidSerialCandidate(v) {
  const s = cleanSerialCandidate(v);
  if (!s) return false;

  // Jangan pernah jadikan boolean / status umum sebagai SN.
  const lower = s.toLowerCase();
  const blacklist = new Set([
    "true", "false", "ok", "success", "connected", "connect", "online",
    "null", "undefined", "nan", "yes", "no", "enabled", "disabled"
  ]);
  if (blacklist.has(lower)) return false;

  // Terlalu pendek biasanya bukan SN.
  if (s.length < 6 || s.length > 80) return false;

  // SN biasanya alphanumeric, kadang ada dash/underscore.
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return false;

  // Harus punya angka, dan idealnya bukan angka kecil seperti port/status.
  if (!/\d/.test(s)) return false;

  // Tolak angka terlalu pendek/angka umum.
  if (/^\d+$/.test(s) && s.length < 8) return false;

  const badExact = new Set(["00000000", "11111111", "12345678", "99999999", "FFFFFFFF"]);
  if (badExact.has(s.toUpperCase())) return false;

  return true;
}

function scoreSerialCandidate(key, value) {
  const k = String(key || "").toLowerCase();
  const v = cleanSerialCandidate(value);
  let score = 0;
  if (/serialnumber|serial_number|serial\.number/.test(k)) score += 100;
  if (/\bserial\b/.test(k)) score += 80;
  if (/\bsn\b|device.*sn|machine.*sn/.test(k)) score += 70;
  if (/device.*id|machine.*id/.test(k)) score += 25;
  if (/[A-Za-z]/.test(v) && /\d/.test(v)) score += 20;
  if (v.length >= 10) score += 10;
  if (/^[A-Z]{2,}[A-Z0-9_-]*\d/i.test(v)) score += 8;
  return score;
}

function extractSerialCandidates(info) {
  const flat = flattenAny(info);
  const candidates = [];

  for (const [key, value] of flat) {
    const k = String(key || "");
    const raw = cleanSerialCandidate(value);

    if (/serial|sn|device.*id|machine.*id/i.test(k) && isValidSerialCandidate(raw)) {
      candidates.push({ key:k, value:raw, score:scoreSerialCandidate(k, raw) });
    }

    const text = stringifyDeep(value);
    const patterns = [
      /serial\s*number\s*[:=]\s*([A-Za-z0-9_-]{6,80})/i,
      /\bSN\s*[:=]\s*([A-Za-z0-9_-]{6,80})/i,
      /device\s*sn\s*[:=]\s*([A-Za-z0-9_-]{6,80})/i,
      /machine\s*sn\s*[:=]\s*([A-Za-z0-9_-]{6,80})/i,
      /~SerialNumber=([A-Za-z0-9_-]{6,80})/i,
      /SerialNumber=([A-Za-z0-9_-]{6,80})/i
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1] && isValidSerialCandidate(m[1])) {
        candidates.push({ key:k || "text", value:cleanSerialCandidate(m[1]), score:scoreSerialCandidate(k || "text.serial", m[1]) + 20 });
      }
    }
  }

  const unique = [];
  const seen = new Set();
  for (const c of candidates.sort((a,b) => b.score - a.score)) {
    const val = cleanSerialCandidate(c.value);
    if (!isValidSerialCandidate(val) || seen.has(val)) continue;
    seen.add(val);
    unique.push({ key:c.key, value:val, score:c.score });
  }
  return unique.slice(0, 20);
}

function extractSerialNumber(info) {
  const candidates = extractSerialCandidates(info);
  if (candidates.length) return candidates[0].value;

  const allText = stringifyDeep(info);
  const loose = allText.match(/\b([A-Z0-9][A-Z0-9_-]{7,30})\b/g);
  if (loose) {
    const found = loose.find(x => isValidSerialCandidate(x));
    if (found) return found;
  }
  return "";
}

function isDetectedDeviceRegistered(detected) {
  const config = loadConfig();
  const sn = String(detected.sn || "").trim();
  const address = String(detected.address || "").trim();
  const port = Number(detected.port || 4370);
  return config.devices.find(d => {
    const sameSn = sn && String(d.sn || "").trim() === sn;
    const sameAddress = String(deviceAddress(d) || "").trim() === address && Number(d.port || 4370) === port;
    return sameSn || sameAddress;
  });
}


async function setUserToDevice(device, u) {
  const uid = Number(u.user_id);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error("User ID harus angka positif");
  await device.setUser(uid, String(u.user_id), String(u.name), "", 0);
}

function normalizeFingerprintCountValue(value) {
  if (Array.isArray(value)) return Math.max(0, Math.min(10, value.length));
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(10, Math.round(value)));
  if (typeof value === "string" && value.trim() !== "" && /^\d+$/.test(value.trim())) {
    return Math.max(0, Math.min(10, Number(value.trim())));
  }
  return null;
}

function firstFingerprintCount(...values) {
  for (const value of values) {
    const count = normalizeFingerprintCountValue(value);
    if (count !== null) return count;
  }
  return null;
}

function normalizeDeviceUsers(result) {
  let arr = [];
  if (Array.isArray(result)) arr = result;
  else if (result && Array.isArray(result.data)) arr = result.data;
  else if (result && Array.isArray(result.users)) arr = result.users;
  else arr = [];

  return arr.map((u, i) => {
    const uid = u.uid ?? u.user_id ?? u.userId ?? u.userid ?? u.id ?? (i + 1);
    const userId = u.employee_code ?? u.device_user_id ?? u.userId ?? u.userid ?? u.user_id ?? u.uid ?? uid;
    const name = u.full_name ?? u.name ?? u.username ?? u.userName ?? "";
    const card = u.card_number ?? u.card ?? u.cardno ?? u.cardNo ?? "";
    const raw = u.raw && typeof u.raw === "object" ? u.raw : u;
    const fingerprintCount = firstFingerprintCount(
      u.fingerprint_count,
      u.finger_count,
      u.fp_count,
      u.fingerCount,
      u.fpCount,
      u.templateCount,
      u.fingerprintCount,
      u.fingers,
      u.templates,
      raw.fingerprint_count,
      raw.finger_count,
      raw.fp_count,
      raw.fingerCount,
      raw.fpCount,
      raw.templateCount,
      raw.fingerprintCount,
      raw.fingers,
      raw.templates
    );
    return {
      raw,
      user_id: String(userId),
      uid: String(uid),
      name: String(name),
      card: String(card),
      fingerprint_count: fingerprintCount,
      fingerprint_source: u.fingerprint_source || u.source || ""
    };
  });
}

function inferFingerprintStatusFromUserRaw(u) {
  const raw = u.raw || {};
  const text = safeJson(raw).toLowerCase();
  const keys = Object.keys(raw).join(" ").toLowerCase();

  const possibleCount = firstFingerprintCount(
    u.fingerprint_count,
    u.finger_count,
    u.fp_count,
    u.fingerCount,
    u.fpCount,
    u.templateCount,
    u.fingerprintCount,
    u.fingers,
    u.templates,
    raw.fingerprint_count,
    raw.finger_count,
    raw.fp_count,
    raw.fingerCount,
    raw.fpCount,
    raw.templateCount,
    raw.fingerprintCount,
    raw.fingers,
    raw.templates
  );
  if (typeof possibleCount === "number") {
    return {
      status: possibleCount > 0 ? "ADA" : "KOSONG",
      count: possibleCount,
      source: u.fingerprint_source || raw.fingerprint_source || "user-count"
    };
  }

  if (/finger|template|fp|bio/.test(keys) && !/false|null|\[\]/.test(text)) {
    return { status:"MUNGKIN ADA", count:"?", source:"user-raw" };
  }
  return { status:"BELUM BISA DICEK", count:"?", source:"not-exposed" };
}

async function getFingerprintTemplateMap(device, users) {
  const map = {};
  for (const u of users) map[String(u.user_id)] = inferFingerprintStatusFromUserRaw(u);

  const methods = ["getTemplates", "getUserTemplate", "getUserTemplates", "getFingerTemplates", "getFingerprintTemplates", "getUserFingerprints"];
  const available = methods.filter(m => typeof device?.[m] === "function");
  if (!available.length) return { map, supported:false, method:"", error:"Library tidak expose method baca template fingerprint." };

  const method = available[0];
  try {
    // Coba baca semua template jika method mendukung tanpa argumen.
    const result = await withTimeout(device[method](), 30000, `Baca template ${method}`);
    const arr = Array.isArray(result) ? result : (result?.data || result?.templates || []);
    if (Array.isArray(arr)) {
      for (const t of arr) {
        const uid = String(t.user_id || t.userId || t.userid || t.uid || t.pin || "").trim();
        if (!uid) continue;
        if (!map[uid] || map[uid].status !== "ADA") map[uid] = { status:"ADA", count:0, source:method };
        if (typeof map[uid].count !== "number") map[uid].count = 0;
        map[uid].count += 1;
      }
    }
    return { map, supported:true, method, error:"" };
  } catch (err) {
    return { map, supported:true, method, error:errorText(err) };
  }
}

function fingerprintBadgeHtml(fp) {
  const status = fp?.status || "BELUM BISA DICEK";
  if (status === "ADA") return `<span class="finger-count-badge ok" title="Jumlah sidik jari terbaca dari mesin"><span>Sidik jari</span><b>${escapeHtml(fp.count)}</b><em>jari</em></span>`;
  if (status === "KOSONG") return `<span class="finger-count-badge empty" title="Mesin melaporkan belum ada sidik jari"><span>Sidik jari</span><b>0</b><em>jari</em></span>`;
  if (status === "MUNGKIN ADA") return `<span class="finger-count-badge warn" title="Ada field fingerprint/template, tetapi jumlahnya tidak dibuka firmware"><span>Sidik jari</span><b>?</b><em>mungkin</em></span>`;
  return `<span class="finger-count-badge muted" title="Firmware/library tidak membuka metadata sidik jari"><span>Sidik jari</span><b>?</b><em>unknown</em></span>`;
}

function fingerprintCommandConstants() {
  try {
    return require("zkteco-js/src/helper/command").COMMANDS || {};
  } catch (_) {
    return {};
  }
}

function fingerprintCommandModule() {
  try {
    return require("zkteco-js/src/helper/command") || {};
  } catch (_) {
    return {};
  }
}

function decodeUserPacket72(packet) {
  const uid = packet.readUInt16LE(0);
  const role = packet.readUInt8(2);
  const name = packet.subarray(11, 35).toString("ascii").split("\0").shift() || "";
  const cardno = packet.readUInt32LE(35);
  const userId = packet.subarray(48, 57).toString("ascii").split("\0").shift() || String(uid);
  const fingerprintCount = Math.max(0, Math.min(10, Number(packet.readUInt8(42)) || 0));

  return {
    uid,
    userId,
    name,
    role,
    cardno,
    fingerprint_count: fingerprintCount,
    raw_hex: packet.toString("hex")
  };
}

function decodeUserPacket28(packet) {
  const uid = packet.readUInt16LE(0);
  const role = packet.readUInt8(2);
  const name = packet.subarray(8, 16).toString("ascii").split("\0").shift() || "";
  const userId = packet.readUInt32LE(24);

  return {
    uid,
    userId,
    name,
    role,
    fingerprint_count: 0,
    raw_hex: packet.toString("hex")
  };
}

async function readDetailedUsersFromPacket(device) {
  const requestData = fingerprintCommandModule().REQUEST_DATA || {};
  const getUsersRequest = requestData.GET_USERS;
  if (!getUsersRequest) return { ok:false, users:[], source:"packet-user-record", error:"REQUEST_DATA.GET_USERS tidak tersedia." };

  try {
    if (device?.connectionType === "tcp" && device.ztcp && device.ztcp.socket && typeof device.ztcp.readWithBuffer === "function") {
      if (typeof device.ztcp.freeData === "function") await device.ztcp.freeData();
      const data = await withTimeout(device.ztcp.readWithBuffer(getUsersRequest), 18000, "Baca packet user TCP");
      if (typeof device.ztcp.freeData === "function") await device.ztcp.freeData();
      const buffer = data && data.data instanceof Buffer ? data.data.subarray(4) : Buffer.alloc(0);
      const users = [];
      let cursor = buffer;
      while (cursor.length >= 72) {
        users.push(decodeUserPacket72(cursor.subarray(0, 72)));
        cursor = cursor.subarray(72);
      }
      if (users.length) return { ok:true, users, source:"packet-user-record", error:"" };
    }

    if (device?.connectionType === "udp" && device.zudp && device.zudp.socket && typeof device.zudp.readWithBuffer === "function") {
      if (typeof device.zudp.freeData === "function") await device.zudp.freeData();
      const data = await withTimeout(device.zudp.readWithBuffer(getUsersRequest), 18000, "Baca packet user UDP");
      if (typeof device.zudp.freeData === "function") await device.zudp.freeData();
      const buffer = data && data.data instanceof Buffer ? data.data.subarray(4) : Buffer.alloc(0);
      const users = [];
      let cursor = buffer;
      while (cursor.length >= 28) {
        users.push(decodeUserPacket28(cursor.subarray(0, 28)));
        cursor = cursor.subarray(28);
      }
      if (users.length) return { ok:true, users, source:"packet-user-record", error:"" };
    }
  } catch (err) {
    return { ok:false, users:[], source:"packet-user-record", error:errorText(err) };
  }

  return { ok:false, users:[], source:"packet-user-record", error:"Packet user detail tidak terbaca dari koneksi mesin." };
}

function bufferSha256Prefix(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return "";
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

function summarizeFingerprintValue(value, source, fingerIndex = "") {
  if (Buffer.isBuffer(value)) {
    const commandId = value.length >= 2 ? value.readUInt16LE(0) : null;
    const commands = fingerprintCommandConstants();
    const ackOk = Number(commands.CMD_ACK_OK || 2000);
    const ackError = Number(commands.CMD_ACK_ERROR || 2001);
    const hasPayload = value.length > 8 && commandId !== ackOk && commandId !== ackError;
    return {
      source,
      finger_index: fingerIndex,
      status: hasPayload ? "ADA" : (commandId === ackError ? "TIDAK ADA / DITOLAK" : "ACK / BELUM ADA PAYLOAD"),
      size_bytes: value.length,
      ack: commandId || "",
      hash_prefix: hasPayload ? bufferSha256Prefix(value) : "",
      note: hasPayload
        ? "Payload template/record terbaca dari mesin. Raw template tidak disimpan."
        : "Mesin membalas command, tetapi tidak mengirim payload template."
    };
  }

  if (value && typeof value === "object") {
    const size = Buffer.byteLength(safeJson(value));
    return {
      source,
      finger_index: fingerIndex,
      status: "ADA / OBJEK TERBACA",
      size_bytes: size,
      ack: "",
      hash_prefix: "",
      note: "Object template/record terbaca dari method library. Raw object tidak disimpan."
    };
  }

  if (value !== null && typeof value !== "undefined" && String(value) !== "") {
    return {
      source,
      finger_index: fingerIndex,
      status: "ADA / VALUE TERBACA",
      size_bytes: Buffer.byteLength(String(value)),
      ack: "",
      hash_prefix: "",
      note: "Value template/record terbaca dari method library. Raw value tidak disimpan."
    };
  }

  return null;
}

function collectFingerprintRecordsFromValue(value, userId, source) {
  const records = [];
  const stack = Array.isArray(value) ? value.slice() : [value];
  const targetUserId = String(userId || "");

  while (stack.length) {
    const item = stack.shift();
    if (!item) continue;
    if (Array.isArray(item)) {
      stack.push(...item);
      continue;
    }
    if (Buffer.isBuffer(item)) {
      const summary = summarizeFingerprintValue(item, source);
      if (summary) records.push(summary);
      continue;
    }
    if (typeof item === "object") {
      const nested = item.data || item.templates || item.records || item.fingers || item.fingerprints;
      if (Array.isArray(nested)) stack.push(...nested);

      const uid = String(item.user_id || item.userId || item.userid || item.pin || item.uid || "").trim();
      const maybeFinger = item.finger_index ?? item.fingerIndex ?? item.fid ?? item.finger ?? item.template_id ?? item.templateId ?? "";
      const rawTemplate = item.template || item.data || item.buffer || item.payload || item.raw;
      const matches = !uid || uid === targetUserId;
      if (matches && (rawTemplate || /finger|template|fp|bio/i.test(Object.keys(item).join(" ")))) {
        records.push({
          source,
          finger_index: maybeFinger,
          status: "ADA / METADATA TERBACA",
          size_bytes: Buffer.isBuffer(rawTemplate) ? rawTemplate.length : Buffer.byteLength(safeJson(item)),
          ack: "",
          hash_prefix: Buffer.isBuffer(rawTemplate) ? bufferSha256Prefix(rawTemplate) : "",
          note: "Metadata template cocok/terkait user terbaca. Raw template tidak disimpan."
        });
      }
    }
  }

  return records;
}

function lowLevelFingerprintReadBuffers(uid, userId, fingerIndex) {
  const uidNumber = Number(uid || userId);
  const finger = Number(fingerIndex);
  const buffers = [];

  if (Number.isInteger(uidNumber) && uidNumber > 0) {
    const b3 = Buffer.alloc(3);
    b3.writeUInt16LE(uidNumber, 0);
    b3.writeUInt8(finger, 2);
    buffers.push({ label:"uid:uint16 + finger:uint8", data:b3 });

    const b4 = Buffer.alloc(4);
    b4.writeUInt16LE(uidNumber, 0);
    b4.writeUInt16LE(finger, 2);
    buffers.push({ label:"uid:uint16 + finger:uint16", data:b4 });
  }

  buffers.push({ label:"ascii userId TAB finger", data:Buffer.from(`${userId}\t${finger}\0`, "ascii") });
  return buffers;
}

async function readLowLevelFingerprintRecord(device, selectedUser, fingerIndex) {
  const commands = fingerprintCommandConstants();
  const cmd = Number(commands.CMD_USERTEMP_RRQ || 9);
  if (typeof device?.executeCmd !== "function") {
    return { ok:false, records:[], error:"executeCmd tidak tersedia untuk CMD_USERTEMP_RRQ." };
  }

  const attempts = [];
  const buffers = lowLevelFingerprintReadBuffers(selectedUser.uid, selectedUser.user_id, fingerIndex);
  for (const item of buffers) {
    try {
      const reply = await withTimeout(device.executeCmd(cmd, item.data), 6000, `Baca fingerprint ${item.label}`);
      const summary = summarizeFingerprintValue(reply, `CMD_USERTEMP_RRQ (${item.label})`, fingerIndex);
      attempts.push({ method:item.label, ok:true, size_bytes:Buffer.isBuffer(reply) ? reply.length : Buffer.byteLength(String(reply || "")), status:summary?.status || "UNKNOWN" });
      if (summary && (summary.status === "ADA" || summary.status.includes("ACK"))) {
        return { ok:true, records:[summary], attempts, error:"" };
      }
    } catch (err) {
      attempts.push({ method:item.label, ok:false, error:errorText(err) });
    }
  }

  return { ok:false, records:[], attempts, error:"Tidak ada payload fingerprint terbaca dari CMD_USERTEMP_RRQ." };
}

function latestFingerprintCacheRows(deviceConfig, userId) {
  const keyDevice = String(deviceConfig.id || deviceConfig.sn || "");
  return loadFingerprintTemplates()
    .filter(row => String(row.device_id || row.device_sn || "") === keyDevice || String(row.device_sn || "") === String(deviceConfig.sn || ""))
    .filter(row => String(row.user_id || "") === String(userId || ""))
    .sort((a, b) => String(b.read_at || "").localeCompare(String(a.read_at || "")))
    .slice(0, 20);
}

function fingerprintRecordSummaryHtml(records) {
  const rows = Array.isArray(records) ? records : [];
  if (!rows.length) {
    return `<span class="finger-record-chip muted">Record sidik: belum dibaca</span>`;
  }
  const latest = rows[0];
  const positive = rows.filter(row => /ADA|PAYLOAD|OBJEK/i.test(String(row.status || ""))).length;
  const finger = latest.finger_name || (latest.finger_index !== "" && typeof latest.finger_index !== "undefined" ? fingerName(Number(latest.finger_index)) : "");
  const hash = latest.hash_prefix ? ` #${latest.hash_prefix}` : "";
  return `
    <span class="finger-record-chip">
      Record sidik: ${escapeHtml(positive)} hasil
      <small>${escapeHtml(latest.status || "-")}${finger ? " - " + escapeHtml(finger) : ""}${escapeHtml(hash)}</small>
    </span>
  `;
}

function saveFingerprintRecordCache(deviceConfig, selectedUser, records, source = "read-machine") {
  if (!Array.isArray(records) || !records.length) return;
  const rows = loadFingerprintTemplates();
  const now = new Date().toISOString();
  const safeRecords = records.map(record => ({
    id: makeId("fp"),
    type: "fingerprint-record-metadata",
    read_at: now,
    source,
    device_id: deviceConfig.id || "",
    device_sn: deviceConfig.sn || "",
    device_name: deviceConfig.name || "",
    user_id: String(selectedUser.user_id || ""),
    uid: String(selectedUser.uid || ""),
    name: String(selectedUser.name || ""),
    finger_index: String(record.finger_index ?? ""),
    finger_name: record.finger_index !== "" && typeof record.finger_index !== "undefined" ? fingerName(Number(record.finger_index)) : "",
    status: record.status || "",
    size_bytes: record.size_bytes || 0,
    ack: record.ack || "",
    hash_prefix: record.hash_prefix || "",
    note: record.note || ""
  }));
  rows.unshift(...safeRecords);
  saveFingerprintTemplates(rows.slice(0, 1000));
}

async function readFingerprintRecordReport(device, deviceConfig, userId, fingerIndex = "") {
  const users = await getUsersFromDevice(device);
  const selectedUser = users.find(u => String(u.user_id) === String(userId) || String(u.uid) === String(userId));
  if (!selectedUser) throw new Error(`User ${userId} tidak ditemukan di mesin.`);

  const records = [];
  const diagnostics = [];
  const rawFp = inferFingerprintStatusFromUserRaw(selectedUser);
  diagnostics.push({ source:"user-raw", status:rawFp.status, count:rawFp.count, note:rawFp.source });

  const methods = ["getTemplates", "getUserTemplate", "getUserTemplates", "getFingerTemplates", "getFingerprintTemplates", "getUserFingerprints"];
  for (const method of methods.filter(name => typeof device?.[name] === "function")) {
    const argSets = [
      [],
      [Number(selectedUser.uid || userId)],
      [String(userId)],
      [Number(selectedUser.uid || userId), Number(fingerIndex || 0)],
      [String(userId), Number(fingerIndex || 0)]
    ];
    for (const args of argSets) {
      try {
        const value = await withTimeout(device[method](...args), 12000, `Baca ${method}`);
        const found = collectFingerprintRecordsFromValue(value, userId, `${method}(${args.map(String).join(",")})`);
        diagnostics.push({ source:method, args, ok:true, found:found.length });
        records.push(...found);
        if (found.length) break;
      } catch (err) {
        diagnostics.push({ source:method, args, ok:false, error:errorText(err) });
      }
    }
  }

  if (fingerIndex !== "" && Number.isInteger(Number(fingerIndex))) {
    const low = await readLowLevelFingerprintRecord(device, selectedUser, Number(fingerIndex));
    diagnostics.push({ source:"CMD_USERTEMP_RRQ", ok:low.ok, attempts:low.attempts || [], error:low.error || "" });
    records.push(...(low.records || []));
  }

  const inferredRecords = records.length ? [] : [{
    source:"user-raw",
    finger_index:fingerIndex,
    status:rawFp.status,
    size_bytes:0,
    ack:"",
    hash_prefix:"",
    note:`Belum ada payload template dari library. Status inferensi dari user raw: ${rawFp.status}.`
  }];

  return {
    ok:true,
    device: { id:deviceConfig.id, name:deviceConfig.name, sn:deviceConfig.sn, address:deviceAddress(deviceConfig), port:deviceConfig.port },
    user: selectedUser,
    finger_index: fingerIndex,
    records: records.length ? records : inferredRecords,
    diagnostics,
    cached: latestFingerprintCacheRows(deviceConfig, selectedUser.user_id)
  };
}

function renderFingerprintRecordTable(records) {
  return `
    <div class="table-scroll">
      <table>
        <tr><th>No</th><th>Jari</th><th>Status</th><th>Source</th><th>Ukuran</th><th>ACK</th><th>Catatan</th></tr>
        ${(records || []).map((record, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${record.finger_index !== "" && typeof record.finger_index !== "undefined" ? `${escapeHtml(record.finger_index)} - ${escapeHtml(fingerName(Number(record.finger_index)))}` : "-"}</td>
            <td>${escapeHtml(record.status || "-")}</td>
            <td>${escapeHtml(record.source || "-")}</td>
            <td>${escapeHtml(record.size_bytes || 0)} bytes</td>
            <td>${escapeHtml(record.ack || "-")}</td>
            <td>${escapeHtml(record.note || "-")}</td>
          </tr>`).join("") || '<tr><td colspan="7">Belum ada record terbaca.</td></tr>'}
      </table>
    </div>
  `;
}


async function getUsersFromDevice(device) {
  if (typeof device.getUsers !== "function") throw new Error("Library zkteco-js yang terinstall tidak punya fungsi getUsers");
  return normalizeDeviceUsers(await device.getUsers());
}

async function getUsersFromDeviceRawAware(device) {
  const detailed = await readDetailedUsersFromPacket(device);
  if (detailed.ok && Array.isArray(detailed.users) && detailed.users.length) {
    return {
      users: normalizeDeviceUsers(detailed.users).map(user => ({
        ...user,
        fingerprint_source: "packet-user-record",
        read_source: detailed.source
      })),
      source: detailed.source,
      warning: ""
    };
  }

  return {
    users: (await getUsersFromDevice(device)).map(user => ({
      ...user,
      read_source: "zkteco-js"
    })),
    source: "zkteco-js",
    warning: detailed.error || ""
  };
}

function runZkDeviceCli(action, deviceConfig, extraArgs = {}, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const script = path.join(BRIDGE_DIR, "zk_device_cli.js");
    const host = deviceAddress(deviceConfig);
    const port = String(deviceConfig.port || 4370);
    const cliTimeout = String(extraArgs.timeout || extraArgs.timeout_ms || 12000);

    if (!fs.existsSync(script)) {
      return resolve({ ok:false, data:null, error:`Bridge JS tidak ditemukan: ${script}`, stdout:"", stderr:"" });
    }
    if (!host) {
      return resolve({ ok:false, data:null, error:"Alamat mesin kosong.", stdout:"", stderr:"" });
    }

    const args = [script, action, "--host", host, "--port", port, "--timeout", cliTimeout];
    for (const [key, value] of Object.entries(extraArgs || {})) {
      if (["timeout", "timeout_ms"].includes(key) || value === undefined || value === null || value === "") continue;
      args.push(`--${key}`, String(value));
    }

    let child = null;
    try {
      child = spawn(process.execPath, args, { cwd: __dirname, windowsHide: true });
    } catch (err) {
      return resolve({ ok:false, data:null, error:errorText(err), stdout:"", stderr:"" });
    }
    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch (_) {}
      resolve({ ok:false, data:null, error:`Bridge JS timeout setelah ${timeoutMs}ms`, stdout, stderr });
    }, timeoutMs);

    child.stdout.on("data", chunk => stdout += chunk.toString());
    child.stderr.on("data", chunk => stderr += chunk.toString());
    child.on("error", err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok:false, data:null, error:errorText(err), stdout, stderr });
    });
    child.on("close", code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch (_) {}
      const ok = code === 0 && parsed && parsed.ok !== false;
      resolve({
        ok,
        code,
        data: parsed?.data,
        parsed,
        stdout,
        stderr,
        error: ok ? "" : (parsed?.error || stderr || stdout || `Bridge JS exit code ${code}`)
      });
    });
  });
}

async function readUsersFromDeviceViaBridge(deviceConfig) {
  const result = await runZkDeviceCli("read-users", deviceConfig, { timeout: 12000 }, 45000);
  if (!result.ok || !Array.isArray(result.data)) {
    return { ok:false, users:[], source:"bridge-raw-users", error: result.error || "Bridge JS tidak mengembalikan data user." };
  }
  return {
    ok:true,
    users: normalizeDeviceUsers(result.data).map(user => ({
      ...user,
      fingerprint_source: user.fingerprint_source || "bridge-raw-users",
      read_source: "bridge-raw-users"
    })),
    source:"bridge-raw-users",
    error:""
  };
}

async function deleteUserFromDevice(device, userId) {
  const users = await getUsersFromDevice(device);
  const target = users.find(u => String(u.user_id) === String(userId) || String(u.uid) === String(userId));
  if (!target) throw new Error(`User ${userId} tidak ditemukan di mesin`);

  const uid = Number(target.uid);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error(`UID mesin tidak valid: ${target.uid}`);

  if (typeof device.deleteUser === "function") return await device.deleteUser(uid);
  if (typeof device.removeUser === "function") return await device.removeUser(uid);
  throw new Error("Library zkteco-js tidak punya fungsi deleteUser/removeUser");
}

const REBOOT_METHOD_CANDIDATES = rebootService.REBOOT_METHOD_CANDIDATES;

function listRebootMethods(device) {
  return rebootService.listRebootMethods(device);
}

async function rebootDevice(device) {
  return await rebootService.rebootDevice(device, ZktecoPackage || "ZKTeco");
}

function listFingerprintMethods(device) {
  if (!device) return [];
  const proto = Object.getPrototypeOf(device) || {};
  return Object.getOwnPropertyNames(proto).concat(Object.keys(device))
    .filter((v, i, a) => a.indexOf(v) === i)
    .filter(v => /finger|template|enroll|fp|bio/i.test(v))
    .sort();
}

async function tryRemoteFingerEnroll(device, userId, fingerIndex) {
  const candidates = [
    ["startEnroll", [Number(userId), Number(fingerIndex)]],
    ["enrollUser", [Number(userId), Number(fingerIndex)]],
    ["enrollFinger", [Number(userId), Number(fingerIndex)]],
    ["startFingerprintEnroll", [Number(userId), Number(fingerIndex)]],
    ["beginEnroll", [Number(userId), Number(fingerIndex)]],
    ["setUserTemplate", [Number(userId), Number(fingerIndex)]],
    ["setTemplate", [Number(userId), Number(fingerIndex)]]
  ];

  const available = listFingerprintMethods(device);
  for (const [name, args] of candidates) {
    if (typeof device[name] === "function") {
      try {
        const result = await withTimeout(device[name](...args), 45000, `Remote enroll ${name}`);
        return { ok:true, method:name, result, available };
      } catch (err) {
        return { ok:false, method:name, error:errorText(err), available };
      }
    }
  }

  return {
    ok:false,
    method:"",
    error:"Library/firmware tidak menyediakan command remote enroll fingerprint. Enroll harus dilakukan dari panel mesin.",
    available
  };
}


function bridgeConfigPath() {
  return path.join(BRIDGE_DIR, "bridge-config.json");
}

function loadBridgeConfig() {
  const cfg = loadJson(bridgeConfigPath(), {
    enabled: false,
    executable: "bridge\\ZkEnrollBridge.exe",
    timeout_ms: 60000,
    mode: "exe",
    notes: "Isi executable dengan SDK Bridge resmi .NET/C++ jika sudah tersedia."
  });
  cfg.enabled = Boolean(cfg.enabled);
  cfg.executable = cfg.executable || "bridge\\ZkEnrollBridge.exe";
  cfg.timeout_ms = Number(cfg.timeout_ms || 60000);
  cfg.mode = cfg.mode || "exe";
  return cfg;
}

function saveBridgeConfig(cfg) {
  saveJson(bridgeConfigPath(), cfg);
}

function runBridgeCommand(args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const cfg = loadBridgeConfig();
    const exePath = path.isAbsolute(cfg.executable) ? cfg.executable : path.join(__dirname, cfg.executable);

    if (!cfg.enabled) {
      return resolve({ ok:false, error:"SDK Bridge belum diaktifkan. Aktifkan di menu Remote Enroll Center setelah file bridge tersedia.", exePath });
    }
    if (!fs.existsSync(exePath)) {
      return resolve({ ok:false, error:`File bridge tidak ditemukan: ${exePath}`, exePath });
    }

    const child = spawn(exePath, args, { cwd: __dirname, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch (_) {}
      resolve({ ok:false, error:`Bridge timeout setelah ${timeoutMs}ms`, stdout, stderr, exePath });
    }, timeoutMs);

    child.stdout.on("data", d => stdout += d.toString());
    child.stderr.on("data", d => stderr += d.toString());
    child.on("error", err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok:false, error:errorText(err), stdout, stderr, exePath });
    });
    child.on("close", code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch (_) {}
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        parsed,
        exePath,
        error: code === 0 ? "" : (stderr || stdout || `Bridge exit code ${code}`)
      });
    });
  });
}

async function tryBridgeRemoteEnroll(deviceConfig, userId, fingerIndex) {
  const cfg = loadBridgeConfig();
  const args = [
    "enroll",
    "--ip", deviceAddress(deviceConfig),
    "--port", String(deviceConfig.port || 4370),
    "--sn", String(deviceConfig.sn || ""),
    "--user", String(userId),
    "--finger", String(fingerIndex)
  ];
  return await runBridgeCommand(args, cfg.timeout_ms);
}

async function checkBridgeSupport(deviceConfig) {
  const cfg = loadBridgeConfig();
  const args = [
    "check",
    "--ip", deviceAddress(deviceConfig),
    "--port", String(deviceConfig.port || 4370),
    "--sn", String(deviceConfig.sn || "")
  ];
  return await runBridgeCommand(args, cfg.timeout_ms);
}

async function tryRemoteFingerEnrollCombined(device, deviceConfig, userId, fingerIndex) {
  const nodeResult = await tryRemoteFingerEnroll(device, userId, fingerIndex);
  if (nodeResult.ok) return { ...nodeResult, source:"node-library" };

  const bridge = await tryBridgeRemoteEnroll(deviceConfig, userId, fingerIndex);
  if (bridge.ok) return { ok:true, source:"sdk-bridge", method:"SDK Bridge", result: bridge };

  return {
    ok:false,
    source:"none",
    node_error: nodeResult.error,
    node_available: nodeResult.available,
    bridge_error: bridge.error,
    bridge_stdout: bridge.stdout,
    bridge_stderr: bridge.stderr,
    bridge_exe: bridge.exePath
  };
}

function fingerName(index) {
  const names = [
    "Jempol Kanan", "Telunjuk Kanan", "Tengah Kanan", "Manis Kanan", "Kelingking Kanan",
    "Jempol Kiri", "Telunjuk Kiri", "Tengah Kiri", "Manis Kiri", "Kelingking Kiri"
  ];
  return names[Number(index)] || `Jari ${index}`;
}


function normalizeAttendanceLogs(result, deviceConfig) {
  let arr = [];
  if (Array.isArray(result)) arr = result;
  else if (result && Array.isArray(result.data)) arr = result.data;
  else if (result && Array.isArray(result.attendance)) arr = result.attendance;
  else if (result && Array.isArray(result.logs)) arr = result.logs;
  else arr = [];

  return arr.map((r, i) => {
    const userId = r.user_id ?? r.userId ?? r.userid ?? r.uid ?? r.pin ?? r.id ?? "";
    const realTime =
      r.time ?? r.recordTime ?? r.record_time ?? r.timestamp ?? r.attendance_time ?? r.attTime ??
      r.checkTime ?? r.check_time ?? r.punchTime ?? r.punch_time ??
      r.datetime ?? r.dateTime ?? r.date_time ?? r.logTime ?? r.log_time ?? r["DateTime"] ?? r["Time"] ?? "";

    const state =
      r.state ?? r.status ?? r.verify_state ?? r.punch ?? r.punch_state ??
      r.attendanceState ?? r.attState ?? r.type ?? "";

    const time = realTime ? String(realTime) : "";

    return {
      id: `${deviceConfig.sn || deviceConfig.id || "device"}-${userId}-${time || i}-${state}`,
      device_id: deviceConfig.id,
      device_sn: deviceConfig.sn || "",
      device_name: deviceConfig.name,
      user_id: String(userId),
      time,
      state: String(state ?? ""),
      raw: r
    };
  }).filter(x => x.user_id && x.time);
}

async function getAttendanceFromDevice(device, deviceConfig) {
  // Banyak versi zkteco-js punya beberapa nama method, tapi tidak semuanya stabil.
  // Jangan coba method berikutnya di socket yang sama setelah timeout/null reply, karena socket biasanya sudah rusak.
  const methods = ["getAttendances", "getAttendanceLogs", "getAttLogs", "getAttendance", "getLogs"];
  let available = methods.filter(name => typeof device[name] === "function");
  if (!available.length) throw new Error("Library zkteco-js tidak punya fungsi tarik log attendance pada versi ini");

  const name = available[0];
  try {
    const result = await withTimeout(device[name](), 25000, `Tarik absensi ${name}`);
    return normalizeAttendanceLogs(result, deviceConfig);
  } catch (err) {
    const msg = errorText(err);
    if (isZkTimeoutError(err)) {
      throw new Error(`Mesin timeout/busy saat tarik absensi via ${name}. Tutup software lain yang konek ke mesin, tunggu 10 detik, lalu coba lagi. Detail: ${msg}`);
    }
    throw err;
  }
}

async function pullAttendanceFromDeviceConfig(deviceConfig) {
  let device = null;

  async function readOnce() {
    device = await connectDevice(deviceConfig);
    try {
      const deviceUsers = await getUsersFromDevice(device);
      updateUserNameCacheFromUsers(deviceUsers, deviceConfig);
    } catch (_) {}
    const logs = await getAttendanceFromDevice(device, deviceConfig);
    await closeDevice(device);
    device = null;
    return logs;
  }

  try {
    const logs = await readOnce();
    const result = mergeAttendance(logs, true);
    return {
      ok: true,
      device_id: deviceConfig.id,
      device_name: deviceConfig.name,
      device_sn: deviceConfig.sn || "",
      read_logs: logs.length,
      added: result.added,
      total: result.total,
      skipped_write: result.skipped_write === true,
      checked_at: new Date().toISOString()
    };
  } catch (firstErr) {
    await closeDevice(device);
    device = null;
    if (!isZkTimeoutError(firstErr)) throw firstErr;

    await delay(3500);
    const logs = await readOnce();
    const result = mergeAttendance(logs, true);
    return {
      ok: true,
      device_id: deviceConfig.id,
      device_name: deviceConfig.name,
      device_sn: deviceConfig.sn || "",
      read_logs: logs.length,
      added: result.added,
      total: result.total,
      skipped_write: result.skipped_write === true,
      checked_at: new Date().toISOString()
    };
  } finally {
    await closeDevice(device);
  }
}

function mergeAttendance(newRows, broadcast = true) {
  const old = loadAttendance();
  const map = new Map();
  for (const r of old) map.set(r.id, r);
  let addedRows = [];
  for (const r of newRows) {
    if (!map.has(r.id)) addedRows.push(r);
    map.set(r.id, r);
  }
  if (addedRows.length === 0) {
    return { added: 0, total: old.length, addedRows: [], skipped_write: true };
  }
  const rows = Array.from(map.values()).sort((a,b) => String(b.time).localeCompare(String(a.time)));
  saveAttendance(rows);
  if (broadcast) {
    for (const row of addedRows) broadcastEvent("attendance", row);
  }
  return { added: addedRows.length, total: rows.length, addedRows, skipped_write: false };
}

// =======================
// LIVE EVENTS
// =======================
const sseClients = new Set();

function broadcastEvent(type, payload) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (_) {}
  }
}

app.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ ok:true, time:new Date().toISOString() })}\n\n`);
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// =======================
// REALTIME MANAGER
// =======================
const realtimeSessions = new Map();

function findRealtimeMethod(device) {
  const names = ["getRealTimeLogs", "getRealTimeLog", "getRealTimeRecords", "getRealTime"];
  for (const name of names) if (typeof device[name] === "function") return name;
  return "";
}

async function startRealtimeForDevice(deviceConfig) {
  if (realtimeSessions.has(deviceConfig.id)) return { ok:true, message:"Realtime sudah berjalan" };

  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    const method = findRealtimeMethod(device);
    if (!method) {
      await closeDevice(device);
      return { ok:false, message:"Library zkteco-js tidak menyediakan fungsi realtime logs. Gunakan Tarik Absensi Semua Mesin sebagai fallback." };
    }

    const handler = (log) => {
      const rows = normalizeAttendanceLogs([log], deviceConfig);
      mergeAttendance(rows, true);
    };

    const maybe = device[method](handler);
    realtimeSessions.set(deviceConfig.id, { device, method, started_at: new Date().toISOString() });

    if (maybe && typeof maybe.catch === "function") {
      maybe.catch(async (err) => {
        console.log("Realtime error:", deviceConfig.name, errorText(err));
        realtimeSessions.delete(deviceConfig.id);
        await closeDevice(device);
      });
    }

    return { ok:true, message:`Realtime berjalan via ${method}` };
  } catch (err) {
    await closeDevice(device);
    return { ok:false, message:errorText(err) };
  }
}

async function stopRealtimeForDevice(deviceId) {
  const session = realtimeSessions.get(deviceId);
  if (!session) return;
  realtimeSessions.delete(deviceId);
  await closeDevice(session.device);
}

async function restartRealtimeFromConfig() {
  const config = loadConfig();
  for (const [id] of realtimeSessions) {
    if (!config.realtime_enabled || !config.realtime_device_ids.includes(id)) await stopRealtimeForDevice(id);
  }
  if (config.realtime_enabled) {
    for (const id of config.realtime_device_ids) {
      const d = getDeviceById(id);
      if (d && !realtimeSessions.has(id)) {
        const result = await startRealtimeForDevice(d);
        console.log("Realtime start:", d.name, result.message);
      }
    }
  }
}

// =======================
// AUTO RECONNECT / SYNC
// =======================
let autoReconnectTimer = null;
let autoSyncTimer = null;
let autoAttendanceTimer = null;
let autoAttendanceBusy = false;

async function checkDeviceStatusOnce() {
  const config = loadConfig();
  const status = loadStatus();

  for (const d of config.devices) {
    const host = deviceAddress(d);
    const port = Number(d.port || 4370);
    const result = await tcpPortCheck(host, port, 2500);
    status[d.id] = {
      id: d.id,
      sn: d.sn || "",
      name: d.name,
      address: host,
      port,
      online: result.ok,
      message: result.message,
      checked_at: new Date().toISOString()
    };
    broadcastEvent("device_status", status[d.id]);
  }

  saveStatus(status);
}

async function runAutoSyncOnce() {
  const config = loadConfig();
  if (!config.auto_sync_enabled || !config.auto_sync_source_device_id || config.auto_sync_target_device_ids.length === 0) return;

  const source = config.devices.find(d => d.id === config.auto_sync_source_device_id);
  const targets = config.devices.filter(d => config.auto_sync_target_device_ids.includes(d.id) && d.id !== source?.id);
  if (!source || targets.length === 0) return;

  let sourceDevice = null;
  let users = [];
  try {
    sourceDevice = await connectDevice(source);
    users = await getUsersFromDevice(sourceDevice);
    updateUserNameCacheFromUsers(users, source);
    await closeDevice(sourceDevice);
  } catch (err) {
    await closeDevice(sourceDevice);
    console.log("Auto sync gagal baca sumber:", errorText(err));
    return;
  }

  for (const target of targets) {
    let device = null;
    try {
      device = await connectDevice(target);
      for (const u of users) {
        try { await setUserToDevice(device, { user_id: u.user_id, name: u.name || `User ${u.user_id}`, card: u.card || "" }); }
        catch (err) { console.log("Auto sync gagal user:", target.name, u.user_id, errorText(err)); }
      }
      await closeDevice(device);
    } catch (err) {
      await closeDevice(device);
      console.log("Auto sync gagal target:", target.name, errorText(err));
    }
  }
}

async function autoPullAttendanceOnce(options = {}) {
  const force = options.force === true;
  const config = loadConfig();
  const checkedAt = new Date().toISOString();
  if (!force && !config.auto_attendance_enabled) {
    return { ok: true, disabled: true, checked_at: checkedAt, success: 0, failed: 0, skipped: 0, logs: 0, read_logs: 0, devices: [] };
  }
  if (autoAttendanceBusy) {
    return { ok: false, busy: true, checked_at: checkedAt, success: 0, failed: 0, skipped: 0, logs: 0, read_logs: 0, devices: [] };
  }

  autoAttendanceBusy = true;
  try {
    const selected = Array.isArray(config.auto_attendance_device_ids) && config.auto_attendance_device_ids.length
      ? new Set(config.auto_attendance_device_ids.map(String))
      : null;
    const devices = (config.devices || []).filter(d => !selected || selected.has(String(d.id)));
    const status = loadStatus();
    const summary = [];

    for (const deviceConfig of devices) {
      const host = deviceAddress(deviceConfig);
      const port = Number(deviceConfig.port || 4370);
      try {
        if (config.auto_attendance_skip_offline !== false) {
          const known = status[deviceConfig.id];
          let online = known ? known.online !== false : null;
          if (online === null) {
            const portResult = await tcpPortCheck(host, port, 1800);
            online = portResult.ok;
          }
          if (!online) {
            summary.push({
              ok: true,
              skipped: true,
              reason: "offline",
              device_id: deviceConfig.id,
              device_name: deviceConfig.name,
              device_sn: deviceConfig.sn || "",
              read_logs: 0,
              added: 0
            });
            continue;
          }
        }

        const result = await pullAttendanceFromDeviceConfig(deviceConfig);
        summary.push(result);
      } catch (err) {
        summary.push({
          ok: false,
          device_id: deviceConfig.id,
          device_name: deviceConfig.name,
          device_sn: deviceConfig.sn || "",
          read_logs: 0,
          added: 0,
          error: errorText(err)
        });
      }
      await delay(1500);
    }

    return {
      ok: true,
      checked_at: checkedAt,
      success: summary.filter(item => item.ok && !item.skipped).length,
      failed: summary.filter(item => !item.ok).length,
      skipped: summary.filter(item => item.skipped).length,
      logs: summary.reduce((sum, item) => sum + Number(item.added || 0), 0),
      read_logs: summary.reduce((sum, item) => sum + Number(item.read_logs || 0), 0),
      devices: summary
    };
  } finally {
    autoAttendanceBusy = false;
  }
}

function restartSchedulers() {
  if (autoReconnectTimer) clearInterval(autoReconnectTimer);
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  if (autoAttendanceTimer) clearInterval(autoAttendanceTimer);
  autoAttendanceTimer = null;

  const config = loadConfig();

  if (config.auto_reconnect_enabled) {
    autoReconnectTimer = setInterval(checkDeviceStatusOnce, Math.max(10, config.auto_reconnect_interval_seconds) * 1000);
    checkDeviceStatusOnce().catch(err => console.log("Status check error:", errorText(err)));
  }

  if (config.auto_sync_enabled) {
    autoSyncTimer = setInterval(runAutoSyncOnce, Math.max(1, config.auto_sync_interval_minutes) * 60 * 1000);
  }

  if (config.auto_attendance_enabled) {
    autoAttendanceTimer = setInterval(() => {
      autoPullAttendanceOnce().catch(err => console.log("Auto attendance error:", errorText(err)));
    }, Math.max(30, config.auto_attendance_interval_seconds) * 1000);
  }

  restartRealtimeFromConfig().catch(err => console.log("Realtime restart error:", errorText(err)));
}

// =======================
// ADMIN HOME
// =======================


// V40 override role filtering agar user hanya melihat mesin yang diizinkan.
visibleDevicesForUser = function(user, config = loadConfig()) {
  return filterDevicesByAccess(config.devices || [], user);
};

filterConfigForUser = function(config, user) {
  const cloned = JSON.parse(JSON.stringify(config || {}));
  cloned.devices = filterDevicesByAccess((config || {}).devices || [], user);
  return cloned;
};

deviceAllowedForUser = function(device, user) {
  return canAccessDeviceRecord(user, device);
};

app.use(createAuthRoutes({
  loadAppUsers,
  saveAppUsers,
  makeAppUser,
  sha256Text,
  createSession: appUserService.createSession,
  parseCookie,
  loadSessions,
  saveSessions,
  sessionsFile: SESSIONS_FILE
}));
app.use(accessMiddleware.createRequireLogin({ getCurrentUser }));
app.use(accessMiddleware.createRoleUserPostGuard({ isAdminUser, htmlPage }));
app.use(accessMiddleware.createAdminOnlyGuard({ isAdminUser, htmlPage }));
app.use(createAttendanceMenuRoutes({
  loadAttendance,
  loadShifts,
  loadUsers,
  isAdminUser,
  canAccessAttendanceRow,
  htmlPage,
  iconSvg,
  escapeHtml
}));
app.use(createSettingsRoutes({
  loadConfig,
  loadBackupHistory,
  loadAppSettings,
  loadPrinterSettings,
  htmlPage,
  escapeHtml,
  renderServerUrlCard,
  backupDir: BACKUP_DIR,
  databaseBackupDir: DB_BACKUP_DIR
}));

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

function machineActionMenuHtml(d) {
  const deviceId = escapeHtml(d.id);
  const deviceSn = escapeHtml(d.sn || "");
  const address = escapeHtml(deviceAddress(d));
  const name = escapeHtml(d.name);
  const lockedInputs = `
    <input type="hidden" name="device_id" value="${deviceId}">
    <input type="hidden" name="device_sn" value="${deviceSn}">
    <input type="hidden" name="device_address" value="${address}">
  `;

  return `
    <div class="machine-actions">
      <div class="machine-actions-primary">
        <form method="GET" action="/device-users">
          <input type="hidden" name="device_id" value="${deviceId}">
          <button class="blue icon-button" type="submit">${iconSvg("users")}<span>User</span></button>
        </form>
        <form method="POST" action="/pull-attendance">
          ${lockedInputs}
          <button class="orange icon-button" type="submit">${iconSvg("pull")}<span>Absensi</span></button>
        </form>
        <form method="GET" action="/edit-device">
          <input type="hidden" name="device_id" value="${deviceId}">
          <button class="gray icon-button" type="submit">${iconSvg("edit")}<span>Edit</span></button>
        </form>
        <details class="machine-more">
          <summary class="pill icon-button">${iconSvg("more")}<span>Lainnya</span></summary>
          <div class="machine-actions-panel">
            <form method="GET" action="/check-port">
              <input type="hidden" name="device_id" value="${deviceId}">
              <button class="orange icon-button" type="submit">${iconSvg("port")}<span>Cek Port</span></button>
            </form>
            <form method="GET" action="/test-device">
              <input type="hidden" name="device_id" value="${deviceId}">
              <button class="icon-button" type="submit">${iconSvg("test")}<span>Test Koneksi</span></button>
            </form>
            <form method="GET" action="/check-reboot-support">
              ${lockedInputs}
              <button class="gray icon-button" type="submit">${iconSvg("reboot")}<span>Cek Reboot</span></button>
            </form>
            <form method="POST" action="/send-users-to-device">
              ${lockedInputs}
              <button class="blue icon-button" type="submit">${iconSvg("send")}<span>Kirim User</span></button>
            </form>
            <form method="POST" action="/reboot-device" onsubmit="return confirm('Reboot mesin ${name}?')">
              ${lockedInputs}
              <button class="danger icon-button" type="submit">${iconSvg("reboot")}<span>Reboot</span></button>
            </form>
            <form class="machine-delete-user" method="POST" action="/delete-user-from-device">
              ${lockedInputs}
              <input name="user_id" placeholder="User ID">
              <button class="danger icon-button" type="submit">${iconSvg("trash")}<span>Hapus User</span></button>
            </form>
          </div>
        </details>
      </div>
    </div>
  `;
}

app.get("/", (req, res) => {
  const user = req.currentUser || global.__cslCurrentUser || null;
  const users = loadUsers();
  const config = filteredConfigForRequest(req);
  const canManageMachine = isAdminUser(user);
  const attendance = loadAttendance();
  const status = loadStatus();

  const deviceRows = config.devices.map((d, i) => {
    const st = status[d.id] || {};
    const onlineClass = st.online ? "online" : "offline";
    const onlineText = st.online ? "ONLINE" : "OFFLINE";
    const searchText = [
      d.name, d.id, d.sn, d.ip, d.public_ip, d.tailscale_ip, d.location,
      adapterLabel(d), protocolLabel(d), deviceAddress(d), d.port
    ].join(" ").toLowerCase();
    return `
    <tr data-device-row data-device-search-text="${escapeHtml(searchText)}">
      <td>${i + 1}</td>
      <td>
        <b>${escapeHtml(d.name)}</b><br>
        <span class="small">ID: ${escapeHtml(d.id)}<br>SN: ${escapeHtml(d.sn || "-")}<br>Brand: ${escapeHtml(adapterLabel(d))}<br>Protocol: ${escapeHtml(protocolLabel(d))}<br>Lokasi: ${escapeHtml(d.location || "-")}</span>
      </td>
      <td>
        IP Lokal: ${escapeHtml(d.ip || "-")}<br>
        Host Public: ${escapeHtml(d.public_ip || "-")}<br>
        Tailscale: <b>${escapeHtml(d.tailscale_ip || "-")}</b><br>
        Mode host: <b>${escapeHtml(normalizePreferredHost(d.preferred_host || "auto"))}</b><br>
        Aktif dipakai: <b>${escapeHtml(deviceAddress(d) || "-")}</b>
      </td>
      <td>${escapeHtml(d.port)}</td>
      <td><span class="pill ${onlineClass}">${onlineText}</span><br><span class="small">${escapeHtml(st.checked_at || "-")}</span></td>
      ${canManageMachine ? `
      <td>${machineActionMenuHtml(d)}</td>` : ""}
    </tr>`;
  }).join("");

  res.send(htmlPage("Webserver Mesin Absen", `
    <h1>Webserver Mesin Absen X100C - Final Fixed</h1>
    <div class="msg">
      Admin lokal: <b>http://${escapeHtml(config.computer_ip)}:${PORT}</b><br>
      Endpoint ADMS lokal: <b>http://${escapeHtml(config.computer_ip)}:${PORT}/csl/login</b><br>
      Library ZKTeco aktif: <b>${escapeHtml(ZktecoPackage || "belum terinstall")}</b><br>
      Identitas mesin: <b>SN/ID mesin</b>. Koneksi TCP/IP memakai <b>Tailscale IP</b> jika diisi, bukan IP lokal.
    </div>

    <div class="grid3">
      <div class="stat">Total Mesin <b>${config.devices.length}</b></div>
      <div class="stat">User Lokal <b>${users.length}</b></div>
      <div class="stat">Log Absensi <b>${attendance.length}</b></div>
    </div>

    <div class="msg warn" style="margin-top:16px;">
      <b>Safety Lock:</b> aksi kirim/hapus sekarang dikunci berdasarkan <b>device_id + SN + alamat final</b>.
      Jika mesin A dan B berbeda IP, pastikan kolom <b>IP Lokal</b> atau <b>Tailscale IP</b> tidak tertukar.
      Jika Tailscale IP diisi, sistem akan memakai Tailscale IP sebagai alamat koneksi.
    </div>

    <div class="card machine-search-card" style="margin-top:16px;">
      <div class="machine-search-head">
        <div>
          <h3>${iconSvg("search")} Cari Mesin</h3>
          <p class="small">Cari nama mesin, SN, ID mesin, IP lokal, public host, Tailscale, lokasi, brand, atau alamat aktif.</p>
        </div>
        <span class="record-pill" data-device-search-count>${escapeHtml(config.devices.length)} mesin</span>
      </div>
      <input type="search" data-device-search placeholder="Ketik nama mesin / SN / IP mesin..." aria-label="Cari mesin">
    </div>

    <h3 style="margin-top:18px;">Daftar Mesin</h3>
    <div class="table-scroll">
      <table>
        <tr><th>No</th><th>Mesin</th><th>Alamat Aktif</th><th>Port</th><th>Status</th>${(typeof canManageMachine !== 'undefined' && canManageMachine) ? "<th>Aksi</th>" : ""}</tr>
        ${deviceRows || `<tr><td colspan="${canManageMachine ? 6 : 5}">Belum ada mesin.</td></tr>`}
      </table>
    </div>

    ${canManageMachine ? `
    <div class="grid" style="margin-top:16px;">
      <div class="card">
        <h3>Clone User Mesin ke Mesin Lain</h3>
        <form method="POST" action="/clone-users" onsubmit="return confirm('Clone user terpilih ke mesin tujuan?')">
          <label>Dari Mesin</label>
          <select name="source_device_id" id="cloneSourceDevice" onchange="loadCloneUsers('source')">
            ${config.devices.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)} - SN:${escapeHtml(d.sn || "-")}</option>`).join("")}
          </select>

          <label>Search User di Mesin Asal</label>
          <input type="text" id="cloneSourceSearch" placeholder="Ketik nama / user id mesin asal..." onkeyup="renderCloneList('source')">

          <label>Multi pilih by nama / ID</label>
          <textarea id="cloneSourceBulkInput" placeholder="Ketik nama lalu Enter, nama kedua lalu Enter..."></textarea>
          <p class="small">Setiap Enter otomatis menjadi koma. User yang cocok otomatis dicentang.</p>
          <div id="cloneSourceSelectedPreview"><pre>Belum ada user dipilih.</pre></div>
          <div id="cloneSourceList" style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:12px;">Loading user mesin asal...</div>

          <label>Ke Mesin</label>
          <select name="target_device_id" id="cloneTargetDevice" onchange="loadCloneUsers('target')">
            ${config.devices.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)} - SN:${escapeHtml(d.sn || "-")}</option>`).join("")}
          </select>

          <div class="msg warn">
            Mesin tujuan hanya dipilih dari dropdown. Search user tujuan dihapus agar proses clone lebih jelas dan tidak membingungkan.
          </div>

          <button class="blue" type="submit">Clone User Terpilih</button>
        </form>
        <p class="small">Centang user dari mesin asal yang ingin diclone. Clone sidik jari/template belum didukung package Node standar.</p>
      </div>
    </div>` : ""}

    ${canManageMachine ? `
    <script>
      let cloneSourceUsers = [];
      let cloneTargetUsers = [];

      async function loadCloneUsers(type) {
        const deviceSelect = document.getElementById(type === 'source' ? 'cloneSourceDevice' : 'cloneTargetDevice');
        const box = document.getElementById(type === 'source' ? 'cloneSourceList' : 'cloneTargetList');
        if (!deviceSelect || !box) return;
        const deviceId = deviceSelect.value;
        box.innerHTML = 'Loading user dari mesin...';
        try {
          const res = await fetch('/api/device-users-live?device_id=' + encodeURIComponent(deviceId));
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || 'Gagal load user');
          if (type === 'source') cloneSourceUsers = data.users || [];
          else cloneTargetUsers = data.users || [];
          renderCloneList(type);
        } catch (err) {
          box.innerHTML = '<span style="color:#dc3545;">Gagal load: ' + String(err.message || err) + '</span>';
        }
      }

      function normalizeBulkText(el) {
        if (!el) return [];
        const original = el.value || '';
        const normalized = original.replace(/\\n+/g, ', ');
        if (original !== normalized) el.value = normalized;
        return normalized.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      }

      function userMatchesTerms(u, terms) {
        if (!terms.length) return false;
        const id = String(u.user_id || '').toLowerCase();
        const name = String(u.name || '').toLowerCase();
        return terms.some(t => id === t || name === t || id.includes(t) || name.includes(t));
      }

      function renderCloneList(type) {
        const users = type === 'source' ? cloneSourceUsers : cloneTargetUsers;
        const searchEl = document.getElementById(type === 'source' ? 'cloneSourceSearch' : 'cloneTargetSearch');
        const bulkEl = document.getElementById(type === 'source' ? 'cloneSourceBulkInput' : 'cloneTargetBulkInput');
        const box = document.getElementById(type === 'source' ? 'cloneSourceList' : 'cloneTargetList');
        if (!box) return;
        const q = ((searchEl && searchEl.value) || '').toLowerCase();
        const terms = normalizeBulkText(bulkEl);
        let filtered = users.filter(u => {
          const id = String(u.user_id || '').toLowerCase();
          const name = String(u.name || '').toLowerCase();
          const searchMatch = !q || id.startsWith(q) || name.startsWith(q) || id.includes(q) || name.includes(q);
          const bulkMatch = !terms.length || userMatchesTerms(u, terms);
          return searchMatch && bulkMatch;
        });
        if (q) {
          filtered = filtered.sort((a,b) => {
            const an = String(a.name || '').toLowerCase(), bn = String(b.name || '').toLowerCase();
            const ai = String(a.user_id || '').toLowerCase(), bi = String(b.user_id || '').toLowerCase();
            const ar = (an.startsWith(q) || ai.startsWith(q)) ? 0 : 1;
            const br = (bn.startsWith(q) || bi.startsWith(q)) ? 0 : 1;
            return ar - br || an.localeCompare(bn);
          });
        }

        if (!filtered.length) {
          box.innerHTML = 'Tidak ada user ditemukan.';
          if (type === 'source') updateCloneSourcePreview();
          return;
        }

        box.innerHTML = filtered.map(u => {
          const inputName = type === 'source' ? 'source_user_ids' : 'target_user_ids_preview';
          const checked = type === 'source' && terms.length && userMatchesTerms(u, terms) ? 'checked' : '';
          return '<label style="display:block;margin:5px 0;">' +
            '<input class="' + (type === 'source' ? 'clone-source-check' : 'clone-target-check') + '" type="checkbox" name="' + inputName + '" value="' + escapeHtmlJs(u.user_id) + '" style="width:auto;margin-right:8px;" ' + checked + ' onchange="updateCloneSourcePreview()">' +
            escapeHtmlJs(u.user_id) + ' - ' + escapeHtmlJs(u.name || '') +
            '</label>';
        }).join('');

        if (type === 'source') updateCloneSourcePreview();
      }

      function updateCloneSourcePreview() {
        const selected = [];
        document.querySelectorAll('.clone-source-check:checked').forEach(cb => {
          const txt = cb.parentElement ? cb.parentElement.innerText.trim() : cb.value;
          selected.push(txt);
        });
        const box = document.getElementById('cloneSourceSelectedPreview');
        if (box) box.innerHTML = '<pre>' + (selected.length ? escapeHtmlJs(selected.join('\\n')) : 'Belum ada user dipilih.') + '</pre>';
      }

      function escapeHtmlJs(v) {
        return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
      }

      setTimeout(() => {
        const srcBulk = document.getElementById('cloneSourceBulkInput');
        const tgtBulk = document.getElementById('cloneTargetBulkInput');
        if (srcBulk) srcBulk.addEventListener('keyup', function(){ normalizeBulkText(srcBulk); renderCloneList('source'); });
        const srcSearch = document.getElementById('cloneSourceSearch');
        if (srcSearch) {
          srcSearch.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              const first = document.querySelector('.clone-source-check');
              if (first) {
                first.checked = true;
                const bulk = document.getElementById('cloneSourceBulkInput');
                const text = first.parentElement ? first.parentElement.innerText.trim() : first.value;
                const namePart = text.replace(/^\s*[^-]+-\s*/, '').trim() || first.value;
                bulk.value = (bulk.value ? bulk.value.replace(/\s*$/, '') + ', ' : '') + namePart + ', ';
                srcSearch.value = '';
                renderCloneList('source');
                updateCloneSourcePreview();
              }
            }
          });
        }
        if (document.getElementById('cloneSourceDevice')) loadCloneUsers('source');
      }, 500);
    </script>` : ""}
  `));
});


// =======================
// DETECT MACHINE ROUTES
// =======================
app.get("/detect-machine", (req, res) => {
  const config = loadConfig();
  const lastResults = loadJson(path.join(__dirname, "detect-results.json"), []);

  const validDetectedCount = lastResults.filter(r => r.ok && r.sn && !r.registered_device).length;
  const registeredDetectedCount = lastResults.filter(r => r.ok && r.sn && r.registered_device).length;
  const connectedNoSnCount = lastResults.filter(r => r.ok && !r.sn).length;

  const resultRows = lastResults.slice(0, 30).map((r, i) => {
    const registered = r.registered_device;
    const detectedAddress = String(r.address || "").trim();
    const looksTailscale = /^100\./.test(detectedAddress);
    const looksPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(detectedAddress);
    const defaultLocalIp = String(r.local_machine_ip || (looksPrivate ? detectedAddress : "")).trim();
    const defaultTailscaleIp = looksTailscale ? detectedAddress : "";
    const defaultPublicHost = (!looksPrivate && !looksTailscale) ? detectedAddress : "";
    return `
      <tr>
        <td>${i+1}</td>
        <td>${r.ok ? '<span class="pill online">TERBACA</span>' : '<span class="pill offline">GAGAL</span>'}</td>
        <td>${escapeHtml(r.address)}:${escapeHtml(r.port)}</td>
        <td>
          <input value="${escapeHtml(r.sn || '')}" readonly placeholder="SN belum terbaca">
          ${(!r.sn && r.serial_candidates && r.serial_candidates.length) ? `<div class="small">Kandidat: ${escapeHtml(r.serial_candidates.map(x=>x.value).join(", "))}</div>` : ""}
          ${(!r.sn && r.ok) ? `<div class="small" style="color:#b45309;">Koneksi OK, SN belum diekspos library/firmware.</div>` : ""}
        </td>
        <td>${registered ? `<b>Sudah terdaftar</b><br>${escapeHtml(registered.name)}<br>SN:${escapeHtml(registered.sn || "-")}` : '<b>Belum terdaftar</b>'}</td>
        <td>
          ${!registered && r.ok ? `
            <details style="margin-bottom:10px;">
              <summary class="pill">Raw Info / Diagnosa SN</summary>
              <pre>${escapeHtml(JSON.stringify({note:r.note, serial_candidates:r.serial_candidates || [], info:r.info || {}}, null, 2))}</pre>
            </details>
            <form method="POST" action="/register-detected-machine">
              <input type="hidden" name="detected_address" value="${escapeHtml(r.address)}">
              <input type="hidden" name="detected_port" value="${escapeHtml(r.port)}">
              <input type="hidden" name="detected_sn" value="${escapeHtml(r.sn || "")}">
              <label>Nama Mesin</label>
              <input name="name" value="Mesin ${escapeHtml(r.sn || r.address)}" required>
              <label>IP Mesin Lokal</label>
              <input name="ip" value="${escapeHtml(defaultLocalIp)}">
              <label>Host Public / Domain</label>
              <input name="public_ip" value="${escapeHtml(defaultPublicHost)}">
              <label>IP Tailscale / IP Port Forwarding</label>
              <input name="tailscale_ip" value="${escapeHtml(defaultTailscaleIp)}">
              <label>Prioritas Host Koneksi</label>
              <select name="preferred_host">
                <option value="auto">Auto (Tailscale > Public > Lokal)</option>
                <option value="tailscale">Pakai Tailscale</option>
                <option value="public">Pakai Public/Domain</option>
                <option value="local">Pakai IP Lokal</option>
              </select>
              <label>Port</label>
              <input name="port" value="${escapeHtml(r.port)}">
              <label>SN Mesin</label>
              <input name="sn" value="${escapeHtml(r.sn || "")}" ${r.sn ? "readonly" : ""} placeholder="Jika kosong, library/firmware belum mengirim SN">
              ${!r.sn ? '<p class="small" style="color:#b45309;">SN belum terbaca otomatis. Cek Raw Info; isi manual hanya jika yakin.</p>' : ''}
              <label>Lokasi</label>
              <input name="location" placeholder="Contoh: Cabang A">
              <button class="blue" type="submit">Daftarkan Mesin Ini</button>
            </form>` : `<pre>${escapeHtml(r.error || JSON.stringify(r.info || {}, null, 2))}</pre>`}
        </td>
      </tr>`;
  }).join("");

  res.send(htmlPage("Detek Mesin", `
    <h1>Detek Mesin Fingerprint</h1>
    <div class="msg">
      Masukkan IP/port yang bisa dijangkau server. Jika beda jaringan, isi <b>IP Tailscale/IP Public Port Forwarding</b>.
      Sistem sekarang mencoba banyak method untuk membaca SN. Jika koneksi OK tapi SN kosong, kemungkinan firmware/library tidak mengekspos SN via TCP; buka Raw Info untuk diagnosa.
      Untuk koneksi lintas jaringan, setelah register isi juga <b>Host Public/Domain</b> dan pilih <b>Prioritas Host</b> di menu Edit Mesin.
    </div>

    <div class="grid">
      <div class="card">
        <h3>Tambah Mesin Manual</h3>
        <p class="small">Pakai ini jika mesin sudah diketahui IP/SN-nya, atau jika deteksi otomatis belum membaca SN.</p>
        ${renderAddDeviceForm()}
      </div>

      <div class="card">
        <h3>Detek 1 Mesin</h3>
        <form method="POST" action="/detect-machine-one">
          <label>IP / Host yang akan dites</label>
          <input name="address" placeholder="192.168.18.200 atau 100.x.x.x atau IP Public" required>
          <label>Port</label>
          <input name="port" value="4370" required>
          <label>IP Mesin Lokal sebenarnya</label>
          <input name="local_machine_ip" placeholder="Opsional, contoh 192.168.18.200">
          <button class="blue" type="submit">Detek Mesin</button>
        </form>
      </div>

      <div class="card">
        <h3>Detek Banyak Port</h3>
        <form method="POST" action="/detect-machine-scan">
          <label>IP / Host</label>
          <input name="address" placeholder="100.x.x.x atau IP Public cabang" required>
          <label>Port mulai</label>
          <input name="port_start" value="4370">
          <label>Port akhir</label>
          <input name="port_end" value="4380">
          <button class="orange" type="submit">Scan Port</button>
        </form>
        <p class="small">Contoh 1 lokasi dengan 2 mesin: 4370 → Mesin A, 4371 → Mesin B.</p>
      </div>
    </div>

    <div class="grid3" style="margin-top:16px;">
      <div class="stat">Mesin Baru Valid <b>${validDetectedCount}</b></div>
      <div class="stat">Sudah Terdaftar <b>${registeredDetectedCount}</b></div>
      <div class="stat">Koneksi OK, SN Kosong <b>${connectedNoSnCount}</b></div>
    </div>

    <h3 style="margin-top:18px;">Hasil Deteksi Terakhir</h3>
    <div class="table-scroll">
      <table>
        <tr><th>No</th><th>Status</th><th>Alamat</th><th>Serial Number</th><th>Daftar</th><th>Detail / Register</th></tr>
        ${resultRows || '<tr><td colspan="6">Belum ada hasil deteksi.</td></tr>'}
      </table>
    </div>
  `));
});


app.get("/api/detect-methods", async (req, res) => {
  const address = String(req.query.address || "").trim();
  const port = Number(req.query.port || 4370);
  if (!address) return res.json({ ok:false, error:"address kosong" });
  const detected = await detectDeviceInfoByAddress(address, port);
  res.json(detected);
});

app.post("/detect-machine-one", async (req, res) => {
  const address = String(req.body.address || "").trim();
  const port = Number(req.body.port || 4370);
  const localMachineIp = String(req.body.local_machine_ip || "").trim();
  const result = await detectDeviceInfoByAddress(address, port);
  result.local_machine_ip = localMachineIp;

  const registered = isDetectedDeviceRegistered(result);
  if (registered) result.registered_device = registered;

  const file = path.join(__dirname, "detect-results.json");
  const rows = loadJson(file, []);
  const dupIndex = rows.findIndex(x => String(x.address) === String(result.address) && Number(x.port) === Number(result.port) && String(x.sn || "") === String(result.sn || ""));
  if (dupIndex >= 0) rows.splice(dupIndex, 1);
  rows.unshift(result);
  saveJson(file, rows.slice(0, 100));

  res.redirect("/detect-machine");
});

app.post("/detect-machine-scan", async (req, res) => {
  const address = String(req.body.address || "").trim();
  let start = Number(req.body.port_start || 4370);
  let end = Number(req.body.port_end || start);
  if (end < start) [start, end] = [end, start];
  if (end - start > 50) end = start + 50;

  const file = path.join(__dirname, "detect-results.json");
  const rows = loadJson(file, []);

  for (let port = start; port <= end; port++) {
    const result = await detectDeviceInfoByAddress(address, port);
    result.local_machine_ip = "";
    const registered = isDetectedDeviceRegistered(result);
    if (registered) result.registered_device = registered;

    // Jangan masukkan hasil duplikat port+SN yang sama berulang-ulang di atas list.
    const dupIndex = rows.findIndex(x => String(x.address) === String(result.address) && Number(x.port) === Number(result.port) && String(x.sn || "") === String(result.sn || ""));
    if (dupIndex >= 0) rows.splice(dupIndex, 1);
    rows.unshift(result);
  }

  saveJson(file, rows.slice(0, 100));
  res.redirect("/detect-machine");
});

app.post("/register-detected-machine", (req, res) => {
  const config = loadConfig();
  const sn = cleanSerialCandidate(req.body.sn || req.body.detected_sn || "");
  if (sn && !isValidSerialCandidate(sn)) {
    return res.send(htmlPage("SN tidak valid", `<h3>SN tidak valid</h3><p>Nilai SN terbaca: <b>${escapeHtml(sn)}</b></p><p>Nilai seperti true/false/status tidak boleh dipakai sebagai serial number.</p><a href="/detect-machine">Kembali</a>`));
  }
  const existingBySn = sn ? config.devices.find(d => String(d.sn || "") === sn) : null;
  if (existingBySn) {
    return res.send(htmlPage("Sudah terdaftar", `<h3>Mesin sudah terdaftar</h3><p>${escapeHtml(existingBySn.name)} - SN:${escapeHtml(sn)}</p><a href="/detect-machine">Kembali</a>`));
  }

  const device = {
    id: makeId("mesin"),
    name: String(req.body.name || `Mesin ${sn || Date.now()}`).trim(),
    ip: String(req.body.ip || req.body.detected_address || "").trim(),
    public_ip: String(req.body.public_ip || "").trim(),
    tailscale_ip: String(req.body.tailscale_ip || "").trim(),
    preferred_host: normalizePreferredHost(req.body.preferred_host || "auto"),
    port: Number(req.body.port || req.body.detected_port || 4370),
    sn,
    location: String(req.body.location || "").trim()
  };

  if (!device.ip && !device.tailscale_ip && !device.public_ip) {
    return res.send(htmlPage("Host kosong", `<h3>Isi minimal salah satu host koneksi: IP Lokal, Host Public, atau Tailscale IP.</h3><a href="/detect-machine">Kembali</a>`));
  }

  config.devices.push(device);

  saveConfig(config);
  restartSchedulers();
  res.redirect("/");
});


// =======================
// DEVICE CRUD / SETTINGS
// =======================
app.post("/save-config", (req, res) => {
  const config = loadConfig();
  config.computer_ip = String(req.body.computer_ip || config.computer_ip).trim();
  config.local_server_port = PORT;
  config.adms_ip = String(req.body.adms_ip || config.adms_ip).trim();
  config.adms_port = Number(req.body.adms_port || config.adms_port || 8000);
  config.adms_url = String(req.body.adms_url || config.adms_url || "/csl/login").trim();
  config.work_start_time = String(req.body.work_start_time || config.work_start_time || "08:00").trim();
  saveConfig(config);
  res.redirect("/");
});

app.use(createDeviceAdminRoutes({
  loadConfig,
  saveConfig,
  makeId,
  normalizePreferredHost,
  normalizeDeviceBrandId,
  protocolLabel,
  supportedAdapters,
  htmlPage,
  escapeHtml,
  getDeviceById,
  restartSchedulers
}));

// =======================
// USER LOCAL
// =======================
app.use(createLocalUserRoutes({
  upload,
  loadUsers,
  saveUsers,
  loadConfig,
  filteredConfigForRequest,
  filterDevicesByAccess,
  connectDevice,
  setUserToDevice,
  closeDevice,
  errorText,
  htmlPage,
  escapeHtml,
  hasDeviceSdk: () => Boolean(Zkteco)
}));

// =======================
// DEVICE ACTIONS
// =======================
app.get("/check-port", async (req, res) => {
  const device = getDeviceById(req.query.device_id);
  if (!device) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><a href="/">Kembali</a>`));

  const host = deviceAddress(device);
  const result = await tcpPortCheck(host, Number(device.port), 3000);
  res.send(htmlPage(result.ok ? "Port Terbuka" : "Port Gagal", `
    <h3>${result.ok ? "Cek Port Berhasil" : "Cek Port Gagal"}</h3>
    <p>Mesin: <b>${escapeHtml(device.name)}</b></p>
    <p>SN: <b>${escapeHtml(device.sn || "-")}</b></p>
    <p>Alamat dipakai: <b>${escapeHtml(host)}:${escapeHtml(device.port)}</b></p>
    <pre>${escapeHtml(result.message)}</pre>
    <a href="/">Kembali</a>
  `));
});

app.get("/test-device", async (req, res) => {
  const deviceConfig = getDeviceById(req.query.device_id);
  if (!deviceConfig) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><a href="/">Kembali</a>`));

  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    let info = "Koneksi berhasil.";
    try {
      const deviceInfo = await device.getInfo();
      info += "\n" + safeJson(deviceInfo);
    } catch (errInfo) {
      info += "\nInfo mesin tidak terbaca, tapi socket berhasil.\n" + errorText(errInfo);
    }
    await closeDevice(device);
    res.send(htmlPage("Koneksi OK", `<h3>Test Koneksi Berhasil</h3><p>${escapeHtml(deviceConfig.name)} - SN:${escapeHtml(deviceConfig.sn || "-")}</p><pre>${escapeHtml(info)}</pre><a href="/">Kembali</a>`));
  } catch (err) {
    await closeDevice(device);
    res.send(htmlPage("Koneksi Gagal", `
      <h3>Test Koneksi Gagal</h3>
      <p>${escapeHtml(deviceConfig.name)} - SN:${escapeHtml(deviceConfig.sn || "-")}</p>
      <p>Alamat: ${escapeHtml(deviceAddress(deviceConfig))}:${escapeHtml(deviceConfig.port)}</p>
      <pre>${escapeHtml(errorText(err))}</pre>
      <a href="/">Kembali</a>
    `));
  }
});

app.post("/send-users-to-device", async (req, res) => {
  const deviceConfig = requireLockedDeviceOrPage(req, res, "/");
  if (!deviceConfig) return;
  const users = loadUsers();

  if (!deviceConfig) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><p>device_id/device_sn tidak terkirim.</p><pre>${escapeHtml(safeJson(req.body))}</pre><a href="/">Kembali</a>`));
  if (users.length === 0) return res.send(htmlPage("Tidak ada user", `<h3>Belum ada user untuk dikirim</h3><a href="/">Kembali</a>`));

  let device = null;
  const sent = [];
  const failed = [];

  try {
    device = await connectDevice(deviceConfig);

    // Push tanpa delay buatan. Tetap sequential agar socket mesin tidak crash.
    for (const u of users) {
      try {
        await setUserToDevice(device, u);
        sent.push(`${u.user_id} - ${u.name}`);
      } catch (err) {
        failed.push(`${u.user_id} - ${u.name}: ${errorText(err)}`);
      }
    }

    await closeDevice(device);

    res.send(htmlPage("Kirim User", `
      <h3>Proses kirim selesai</h3>
      <p>Tujuan: <b>${escapeHtml(deviceConfig.name)}</b> - SN:${escapeHtml(deviceConfig.sn || "-")}</p>
      <p>Berhasil: ${sent.length}</p>
      <p>Gagal: ${failed.length}</p>
      <h4>Berhasil</h4><pre>${escapeHtml(sent.join("\\n") || "-")}</pre>
      <h4>Gagal</h4><pre>${escapeHtml(failed.join("\\n") || "-")}</pre>
      <a href="/">Kembali</a>
    `));
  } catch (err) {
    await closeDevice(device);
    res.send(htmlPage("Gagal Kirim", `<h3>Gagal konek ke mesin</h3><pre>${escapeHtml(errorText(err))}</pre><a href="/">Kembali</a>`));
  }
});

app.post("/send-selected-users", async (req, res) => {
  let selectedUsers = req.body.selected_users;
  let targetDeviceIds = req.body.target_device_ids;

  if (!selectedUsers) return res.send(htmlPage("Tidak ada user", `<h3>Tidak ada user yang dipilih</h3><a href="/">Kembali</a>`));
  if (!targetDeviceIds) return res.send(htmlPage("Tidak ada mesin", `<h3>Tidak ada mesin tujuan yang dipilih</h3><a href="/">Kembali</a>`));

  if (!Array.isArray(selectedUsers)) selectedUsers = [selectedUsers];
  if (!Array.isArray(targetDeviceIds)) targetDeviceIds = [targetDeviceIds];

  const allUsers = loadUsers();
  const config = filteredConfigForRequest(req);
  const targetKeys = new Set(targetDeviceIds.map(v => String(v || "").trim()).filter(Boolean));
  const users = allUsers.filter(u => selectedUsers.includes(String(u.user_id)));
  const targets = config.devices.filter(d => targetKeys.has(String(d.id || "")) || targetKeys.has(String(d.sn || "")));
  if (targets.length === 0) {
    return res.status(403).send(htmlPage("Akses ditolak", `<h3>Tidak ada mesin tujuan yang bisa diakses user ini.</h3><a href="/">Kembali</a>`));
  }
  const summary = [];

  for (const deviceConfig of targets) {
    let device = null;
    const sent = [];
    const failed = [];
    try {
      device = await connectDevice(deviceConfig);
      for (const u of users) {
        try { await setUserToDevice(device, u); sent.push(`${u.user_id} - ${u.name}`); }
        catch (err) { failed.push(`${u.user_id} - ${u.name}: ${errorText(err)}`); }
      }
      await closeDevice(device);
      summary.push({ device: `${deviceConfig.name} SN:${deviceConfig.sn || "-"}`, ok: true, sent, failed });
    } catch (err) {
      await closeDevice(device);
      summary.push({ device: `${deviceConfig.name} SN:${deviceConfig.sn || "-"}`, ok: false, sent, failed: [`Koneksi gagal: ${errorText(err)}`] });
    }
  }

  const html = summary.map(item => `
    <div class="card" style="margin-top:14px;">
      <h3>${escapeHtml(item.device)}</h3>
      <p>Status: <b>${item.ok ? "Selesai" : "Gagal koneksi"}</b></p>
      <p>Berhasil: ${item.sent.length}</p>
      <p>Gagal: ${item.failed.length}</p>
      <h4>Berhasil</h4><pre>${escapeHtml(item.sent.join("\\n") || "-")}</pre>
      <h4>Gagal</h4><pre>${escapeHtml(item.failed.join("\\n") || "-")}</pre>
    </div>
  `).join("");

  res.send(htmlPage("Kirim User Terpilih", `<h2>Proses Kirim User Terpilih Selesai</h2><p>User dipilih: ${users.length}</p><p>Mesin tujuan: ${targets.length}</p>${html}<p><a href="/">Kembali</a></p>`));
});




app.get("/machine-adapters", (req, res) => {
  const adapters = supportedAdapters();
  res.send(htmlPage("Adapter Merk Mesin", `
    <h1>Adapter Multi Merk Mesin</h1>
    <div class="msg">
      Aplikasi dibuat dengan sistem adapter agar bisa dikembangkan untuk banyak merk. Merk seperti Solution, BioFinger, FingerSpot umumnya memakai protokol ZKTeco-compatible.
    </div>
    <div class="table-scroll">
      <table>
        <tr><th>No</th><th>Adapter</th><th>Protocol</th><th>Status</th><th>Keterangan</th></tr>
        ${adapters.map((a,i)=>`
          <tr>
            <td>${i+1}</td>
            <td><b>${escapeHtml(a.name)}</b><br><span class="small">${escapeHtml(a.id)}</span></td>
            <td>${escapeHtml(a.protocol)}</td>
            <td>${a.ready === true ? '<span class="pill online">READY</span>' : a.ready === "bridge" ? '<span class="pill">BRIDGE READY</span>' : '<span class="pill" style="background:#fef3c7;color:#92400e;">PARTIAL</span>'}</td>
            <td>${a.protocol === "zk-tcp" ? "Support koneksi TCP, user, hapus, attendance sesuai firmware." : a.protocol === "bridge-exe" ? "Butuh SDK resmi vendor .NET/C++." : "Butuh mode ADMS/push dari mesin."}</td>
          </tr>`).join("")}
      </table>
    </div>
  `));
});

// =======================
// REMOTE ENROLL CENTER / SDK BRIDGE
// =======================
app.get("/remote-enroll-center", (req, res) => {
  const config = loadConfig();
  const bridge = loadBridgeConfig();

  res.send(htmlPage("Remote Enroll Center", `
    <h1>Remote Enroll Center</h1>
    <div class="msg warn">
      <b>Remote Enroll Trigger</b> mencoba membuka proses enroll di mesin, tetapi user tetap scan jari langsung di mesin.
      Jika Node library tidak support, aktifkan SDK Bridge resmi .NET/C++.
    </div>

    <div class="grid">
      <div class="card">
        <h3>SDK Bridge Config</h3>
        <form method="POST" action="/save-bridge-config">
          <label><input type="checkbox" name="enabled" value="1" ${bridge.enabled ? "checked" : ""} style="width:auto;"> Aktifkan SDK Bridge</label>
          <label>Path EXE Bridge</label>
          <input name="executable" value="${escapeHtml(bridge.executable)}" placeholder="bridge\\ZkEnrollBridge.exe">
          <label>Timeout Bridge (ms)</label>
          <input name="timeout_ms" value="${escapeHtml(bridge.timeout_ms)}">
          <label>Catatan</label>
          <textarea name="notes">${escapeHtml(bridge.notes || "")}</textarea>
          <button class="blue" type="submit">Simpan Bridge Config</button>
        </form>
      </div>

      <div class="card">
        <h3>Cek Support Mesin</h3>
        <form method="POST" action="/check-remote-enroll-support">
          <label>Pilih Mesin</label>
          ${deviceSelect("device_id", config.devices)}
          <button class="orange" type="submit">Cek Remote Enroll Support</button>
        </form>
        <p class="small">Cek method Node library dan SDK Bridge.</p>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>Bridge Contract</h3>
      <p>Bridge EXE nanti harus support command:</p>
      <pre>ZkEnrollBridge.exe check --ip 192.168.18.200 --port 4370 --sn SERIAL
ZkEnrollBridge.exe enroll --ip 192.168.18.200 --port 4370 --sn SERIAL --user 1001 --finger 1</pre>
      <p>Output disarankan JSON:</p>
      <pre>{"ok":true,"message":"Enroll command sent","method":"StartEnroll"}</pre>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>Status Bridge</h3>
      <p>Enabled: <b>${bridge.enabled ? "YA" : "TIDAK"}</b></p>
      <p>Executable: <b>${escapeHtml(path.isAbsolute(bridge.executable) ? bridge.executable : path.join(__dirname, bridge.executable))}</b></p>
      <p>File ada: <b>${fs.existsSync(path.isAbsolute(bridge.executable) ? bridge.executable : path.join(__dirname, bridge.executable)) ? "YA" : "BELUM"}</b></p>
      <div class="msg warn">
        Jika muncul error <b>File bridge tidak ditemukan</b>, itu berarti file SDK Bridge resmi belum dipasang.
        Letakkan file <b>ZkEnrollBridge.exe</b> di folder <b>bridge</b>, atau matikan checklist SDK Bridge agar sistem memakai mode Node/fallback.
      </div>
    </div>
  `));
});

app.post("/save-bridge-config", (req, res) => {
  const cfg = {
    enabled: req.body.enabled === "1",
    executable: String(req.body.executable || "bridge\\ZkEnrollBridge.exe").trim(),
    timeout_ms: Number(req.body.timeout_ms || 60000),
    mode: "exe",
    notes: String(req.body.notes || "").trim()
  };
  saveBridgeConfig(cfg);
  res.redirect("/remote-enroll-center");
});

app.post("/check-remote-enroll-support", async (req, res) => {
  const deviceConfig = getDeviceById(req.body.device_id);
  if (!deviceConfig) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><a href="/remote-enroll-center">Kembali</a>`));

  let nodeMethods = [];
  let nodeError = "";
  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    nodeMethods = listFingerprintMethods(device);
    await closeDevice(device);
  } catch (err) {
    await closeDevice(device);
    nodeError = errorText(err);
  }

  const bridgeResult = await checkBridgeSupport(deviceConfig);

  res.send(htmlPage("Cek Remote Enroll", `
    <h1>Hasil Cek Remote Enroll</h1>
    <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p>
    <p>SN: <b>${escapeHtml(deviceConfig.sn || "-")}</b></p>
    <p>Alamat: <b>${escapeHtml(deviceAddress(deviceConfig))}:${escapeHtml(deviceConfig.port)}</b></p>

    <div class="grid">
      <div class="card">
        <h3>Node Library</h3>
        <p>Status koneksi: <b>${nodeError ? "GAGAL" : "OK"}</b></p>
        ${nodeError ? `<pre>${escapeHtml(nodeError)}</pre>` : ""}
        <h4>Method terkait finger/template/enroll</h4>
        <pre>${escapeHtml(nodeMethods.join("\\n") || "Tidak ada method remote enroll terdeteksi.")}</pre>
      </div>

      <div class="card">
        <h3>SDK Bridge</h3>
        <p>Status: <b>${bridgeResult.ok ? "OK" : "BELUM SIAP / TIDAK SUPPORT"}</b></p>
        <pre>${escapeHtml(safeJson(bridgeResult))}</pre>
      </div>
    </div>

    <a href="/remote-enroll-center">Kembali</a>
  `));
});

// =======================
// FINGER ENROLL ROUTES
// =======================
app.get("/finger-enroll", (req, res) => {
  const result = resolveDeviceLocked(req.query);
  const deviceConfig = result.device;
  if (!result.ok) {
    return res.send(htmlPage("Target mesin tidak aman", `<h3>Target mesin tidak aman</h3><p>${escapeHtml(result.error)}</p><pre>${escapeHtml(safeJson(req.query))}</pre><a href="/">Kembali</a>`));
  }

  const currentUserObj = req.currentUser || global.__cslCurrentUser || null;
  if (!canAccessDeviceRecord(currentUserObj, deviceConfig)) {
    return res.status(403).send(htmlPage("Akses ditolak", `<h3>User tidak punya akses ke mesin ini.</h3><a href="/">Kembali</a>`));
  }

  const userId = String(req.query.user_id || "").trim();
  const currentName = String(req.query.current_name || "").trim();
  if (!userId || !/^\d+$/.test(userId)) {
    return res.send(htmlPage("User ID tidak valid", `<h3>User ID wajib diisi angka dari list user mesin.</h3><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>`));
  }
  const cachedRecords = latestFingerprintCacheRows(deviceConfig, userId);

  res.send(htmlPage("Daftar Sidik Jari", `
    <h1>Daftar Sidik Jari User</h1>
    <div class="msg warn">
      <b>Catatan:</b> remote enroll hanya jalan jika firmware/library mendukung command enroll fingerprint via TCP/IP.
      Jika tidak, enroll harus dilakukan langsung di panel mesin.
    </div>

    <div class="grid">
      <div class="card">
        <h3>Target</h3>
        <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p>
        <p>SN: <b>${escapeHtml(deviceConfig.sn || "-")}</b></p>
        <p>Alamat: <b>${escapeHtml(deviceAddress(deviceConfig))}:${escapeHtml(deviceConfig.port)}</b></p>
        <p>User ID: <b>${escapeHtml(userId)}</b></p>
        <p>Nama: <b>${escapeHtml(currentName || "-")}</b></p>
      </div>

      <div class="card">
        <h3>Pilih Jari</h3>
        <form method="POST" action="/start-finger-enroll" onsubmit="return confirm('Mulai daftar sidik jari? User harus tempel jari di mesin 3x.')">
          <input type="hidden" name="device_id" value="${escapeHtml(deviceConfig.id)}">
          <input type="hidden" name="device_sn" value="${escapeHtml(deviceConfig.sn || "")}">
          <input type="hidden" name="device_address" value="${escapeHtml(deviceAddress(deviceConfig))}">
          <input type="hidden" name="user_id" value="${escapeHtml(userId)}">
          <input type="hidden" name="current_name" value="${escapeHtml(currentName)}">
          <label>Jari</label>
          <select name="finger_index">
            ${Array.from({length:10}).map((_,i)=>`<option value="${i}">${i} - ${escapeHtml(fingerName(i))}</option>`).join("")}
          </select>
          <button class="blue" type="submit">Mulai Enroll Finger</button>
        </form>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>Proses 3 Template</h3>
      <div class="finger-steps">
        <div class="finger-step">1<br><small>Tempel Jari</small></div>
        <div class="finger-step">2<br><small>Ulangi</small></div>
        <div class="finger-step">3<br><small>Simpan</small></div>
      </div>
      <p class="small">Sensor sidik jari tetap berada di mesin. Web tidak menerima gambar sidik jari, hanya mengirim perintah jika didukung mesin.</p>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>Baca Hasil Record Mesin</h3>
      <div class="msg">
        Fitur ini <b>read-only</b>: aplikasi hanya membaca metadata record/template dari mesin.
        Pendaftaran sidik jari tetap dilakukan di mesin, biasanya user tempel jari 3x sampai mesin menyimpan template akhir.
      </div>
      <form method="POST" action="/read-finger-record">
        <input type="hidden" name="device_id" value="${escapeHtml(deviceConfig.id)}">
        <input type="hidden" name="device_sn" value="${escapeHtml(deviceConfig.sn || "")}">
        <input type="hidden" name="device_address" value="${escapeHtml(deviceAddress(deviceConfig))}">
        <input type="hidden" name="user_id" value="${escapeHtml(userId)}">
        <input type="hidden" name="current_name" value="${escapeHtml(currentName)}">
        <label>Pilih Jari yang Dibaca</label>
        <select name="finger_index">
          ${Array.from({length:10}).map((_,i)=>`<option value="${i}">${i} - ${escapeHtml(fingerName(i))}</option>`).join("")}
        </select>
        <button class="orange" type="submit">Baca Record Finger dari Mesin</button>
      </form>
      <h4>Cache Record Terakhir di Aplikasi</h4>
      ${renderFingerprintRecordTable(cachedRecords)}
    </div>

    <p><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali ke List User Mesin</a></p>
  `));
});

app.post("/read-finger-record", async (req, res) => {
  const deviceConfig = requireLockedDeviceOrPage(req, res, "/");
  if (!deviceConfig) return;

  const userId = String(req.body.user_id || "").trim();
  const currentName = String(req.body.current_name || "").trim();
  const fingerIndex = String(req.body.finger_index ?? "").trim();

  if (!userId || !/^\d+$/.test(userId)) {
    return res.send(htmlPage("User ID tidak valid", `<h3>User ID harus angka dan wajib dipilih dari list user mesin.</h3><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>`));
  }
  if (fingerIndex !== "" && (!Number.isInteger(Number(fingerIndex)) || Number(fingerIndex) < 0 || Number(fingerIndex) > 9)) {
    return res.send(htmlPage("Jari tidak valid", `<h3>Finger index harus antara 0 sampai 9.</h3><a href="/finger-enroll?device_id=${encodeURIComponent(deviceConfig.id)}&device_sn=${encodeURIComponent(deviceConfig.sn || "")}&device_address=${encodeURIComponent(deviceAddress(deviceConfig))}&user_id=${encodeURIComponent(userId)}&current_name=${encodeURIComponent(currentName)}">Kembali</a>`));
  }

  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    const report = await readFingerprintRecordReport(device, deviceConfig, userId, fingerIndex);
    saveFingerprintRecordCache(deviceConfig, report.user, report.records, "read-finger-record");
    await closeDevice(device);

    const cached = latestFingerprintCacheRows(deviceConfig, report.user.user_id);
    res.send(htmlPage("Record Finger Mesin", `
      <h1>Hasil Baca Record Finger Mesin</h1>
      <div class="msg">
        Data di bawah adalah metadata baca-only dari mesin. Aplikasi tidak mendaftarkan sidik jari dan tidak menyimpan gambar fingerprint mentah.
      </div>
      <div class="grid">
        <div class="card">
          <h3>Target</h3>
          <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p>
          <p>SN: <b>${escapeHtml(deviceConfig.sn || "-")}</b></p>
          <p>Alamat: <b>${escapeHtml(deviceAddress(deviceConfig))}:${escapeHtml(deviceConfig.port)}</b></p>
          <p>User: <b>${escapeHtml(report.user.user_id)} - ${escapeHtml(report.user.name || currentName || "-")}</b></p>
          <p>UID Mesin: <b>${escapeHtml(report.user.uid || "-")}</b></p>
          <p>Jari dibaca: <b>${fingerIndex === "" ? "Auto/metadata" : `${escapeHtml(fingerIndex)} - ${escapeHtml(fingerName(Number(fingerIndex)))}`}</b></p>
        </div>
        <div class="card">
          <h3>3 Verifikasi Enroll</h3>
          <div class="finger-steps">
            <div class="finger-step">1<br><small>Tempel</small></div>
            <div class="finger-step">2<br><small>Ulangi</small></div>
            <div class="finger-step">3<br><small>Simpan</small></div>
          </div>
          <p class="small">Mesin biasanya hanya mengirim template akhir setelah proses 3x tempel selesai, bukan gambar tiap step.</p>
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <h3>Record Terbaca Sekarang</h3>
        ${renderFingerprintRecordTable(report.records)}
      </div>

      <div class="card" style="margin-top:16px;">
        <h3>Cache Record di Aplikasi</h3>
        ${renderFingerprintRecordTable(cached)}
      </div>

      <details class="card" style="margin-top:16px;">
        <summary class="pill">Diagnosa Baca Template</summary>
        <pre>${escapeHtml(safeJson(report.diagnostics))}</pre>
      </details>

      <p>
        <a class="pill" href="/finger-enroll?device_id=${encodeURIComponent(deviceConfig.id)}&device_sn=${encodeURIComponent(deviceConfig.sn || "")}&device_address=${encodeURIComponent(deviceAddress(deviceConfig))}&user_id=${encodeURIComponent(report.user.user_id)}&current_name=${encodeURIComponent(report.user.name || currentName || "")}">Kembali ke Finger</a>
        <a class="pill" href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">List User Mesin</a>
      </p>
    `));
  } catch (err) {
    await closeDevice(device);
    res.send(htmlPage("Gagal Baca Record Finger", `
      <h1>Gagal Baca Record Finger</h1>
      <div class="msg warn">Data mesin tidak diubah. Ini hanya proses baca.</div>
      <pre>${escapeHtml(errorText(err))}</pre>
      <a href="/finger-enroll?device_id=${encodeURIComponent(deviceConfig.id)}&device_sn=${encodeURIComponent(deviceConfig.sn || "")}&device_address=${encodeURIComponent(deviceAddress(deviceConfig))}&user_id=${encodeURIComponent(userId)}&current_name=${encodeURIComponent(currentName)}">Kembali</a>
    `));
  }
});

app.post("/start-finger-enroll", async (req, res) => {
  const deviceConfig = requireLockedDeviceOrPage(req, res, "/");
  if (!deviceConfig) return;

  const userId = String(req.body.user_id || "").trim();
  const currentName = String(req.body.current_name || "").trim();
  const fingerIndex = Number(req.body.finger_index || 0);
  if (!userId || !/^\d+$/.test(userId)) {
    return res.send(htmlPage("User ID tidak valid", `<h3>User ID harus angka dan wajib dipilih dari list user mesin.</h3><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>`));
  }
  if (!Number.isInteger(fingerIndex) || fingerIndex < 0 || fingerIndex > 9) {
    return res.send(htmlPage("Jari tidak valid", `<h3>Finger index harus antara 0 sampai 9.</h3><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>`));
  }

  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    const machineUsers = await getUsersFromDevice(device);
    const selectedUser = machineUsers.find(u => String(u.user_id) === userId || String(u.uid) === userId);
    if (!selectedUser) {
      await closeDevice(device);
      return res.send(htmlPage("User tidak ditemukan di mesin", `
        <h1>User tidak ditemukan di mesin target</h1>
        <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p>
        <p>User ID dipilih: <b>${escapeHtml(userId)}</b></p>
        <p>Silakan buka ulang list user mesin lalu pilih user yang benar.</p>
        <a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>
      `));
    }

    const selectedName = String(selectedUser.name || currentName || "").trim();
    const result = await tryRemoteFingerEnrollCombined(device, deviceConfig, userId, fingerIndex);
    await closeDevice(device);

    if (result.ok) {
      return res.send(htmlPage("Enroll Finger", `
        <h1>Perintah Enroll Dikirim</h1>
        <div class="msg">Perintah remote enroll berhasil dikirim. User harus menempelkan jari di mesin sampai selesai.</div>
        <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p>
        <p>User: <b>${escapeHtml(userId)} - ${escapeHtml(selectedName || "-")}</b></p>
        <p>Jari: <b>${escapeHtml(fingerIndex)} - ${escapeHtml(fingerName(fingerIndex))}</b></p>
        <p>Sumber: <b>${escapeHtml(result.source || "-")}</b></p>
        <p>Method: <b>${escapeHtml(result.method || "-")}</b></p>
        <pre>${escapeHtml(safeJson(result.result))}</pre>
        <a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>
      `));
    }

    return res.send(htmlPage("Remote Enroll Tidak Didukung", `
      <h1>Remote Enroll Finger Tidak Didukung</h1>
      <div class="msg warn">
        Library/firmware saat ini belum menyediakan command daftar sidik jari jarak jauh.
        Data mesin tidak diubah.
      </div>
      <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p>
      <p>User: <b>${escapeHtml(userId)} - ${escapeHtml(selectedName || "-")}</b></p>
      <p>Jari: <b>${escapeHtml(fingerIndex)} - ${escapeHtml(fingerName(fingerIndex))}</b></p>
      <h3>Detail</h3>
      <pre>${escapeHtml(result.error)}</pre>
      <h3>Method fingerprint yang ditemukan</h3>
      <pre>${escapeHtml((result.available || []).join("\\n") || "Tidak ada method finger/template/enroll terdeteksi.")}</pre>
      <div class="card">
        <h3>Solusi Aman</h3>
        <ol>
          <li>Buka menu user pada mesin.</li>
          <li>Pilih user ${escapeHtml(userId)}.</li>
          <li>Enroll sidik jari langsung di mesin 3x.</li>
          <li>Kembali ke web, refresh List User/Backup.</li>
        </ol>
      </div>
      <a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>
    `));
  } catch (err) {
    await closeDevice(device);
    res.send(htmlPage("Gagal Enroll Finger", `
      <h1>Gagal Enroll Finger</h1>
      <pre>${escapeHtml(errorText(err))}</pre>
      <a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>
    `));
  }
});

// =======================
// LIST / EDIT / DELETE USERS ON DEVICE
// =======================
app.get("/device-users", async (req, res) => {
  const currentUserObj = req.currentUser || global.__cslCurrentUser || null;
  const deviceConfig = getDeviceById(req.query.device_id);
  if (!deviceConfig) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><a href="/">Kembali</a>`));
  if (!canAccessDeviceRecord(currentUserObj, deviceConfig)) {
    return res.status(403).send(htmlPage("Akses ditolak", `<h3>User tidak punya akses ke mesin ini.</h3><a href="/">Kembali</a>`));
  }

  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    const userRead = await getUsersFromDeviceRawAware(device);
    const users = userRead.users;
    const readSource = userRead.source;
    const readWarning = userRead.warning;
    const fpResult = await getFingerprintTemplateMap(device, users);
    await closeDevice(device);
    device = null;

    updateUserNameCacheFromUsers(users, deviceConfig);

    const rows = users.map((u, i) => {
      const fp = fpResult.map[String(u.user_id)] || { status:"BELUM BISA DICEK", count:"?", source:"none" };
      const cachedRecords = latestFingerprintCacheRows(deviceConfig, u.user_id);
      const readRecordFormId = `read-fp-${i}`;
      return `
      <tr>
        <td><input class="device-user-check" type="checkbox" name="user_ids[]" value="${escapeHtml(u.user_id)}" style="width:auto;"></td>
        <td>${i + 1}</td>
        <td>${escapeHtml(u.uid)}</td>
        <td>${escapeHtml(u.user_id)}</td>
        <td class="user-name-cell">
          <strong>${escapeHtml(u.name || "(tanpa nama)")}</strong>
          <div class="finger-meta-row">
            ${fingerprintBadgeHtml(fp)}
            ${fingerprintRecordSummaryHtml(cachedRecords)}
          </div>
          <span class="small">Sumber sidik: ${escapeHtml(fp.source || "-")}</span>
        </td>
        <td>${escapeHtml(u.card)}</td>
        <td>
          <details class="user-action-menu">
            <summary class="pill">Aksi</summary>
            <div class="user-action-panel">
              <a class="pill" href="/edit-device-user?device_id=${encodeURIComponent(deviceConfig.id)}&device_sn=${encodeURIComponent(deviceConfig.sn || "")}&user_id=${encodeURIComponent(u.user_id)}&current_name=${encodeURIComponent(u.name)}&card=${encodeURIComponent(u.card)}">Edit Nama</a>
              <a class="pill enroll" href="/finger-enroll?device_id=${encodeURIComponent(deviceConfig.id)}&device_sn=${encodeURIComponent(deviceConfig.sn || "")}&device_address=${encodeURIComponent(deviceAddress(deviceConfig))}&user_id=${encodeURIComponent(u.user_id)}&current_name=${encodeURIComponent(u.name)}">Buka Enroll</a>
              <button class="mini gray" type="submit" form="${readRecordFormId}">Baca Record</button>
              <a class="pill danger-link" href="/delete-user-from-device-get?device_id=${encodeURIComponent(deviceConfig.id)}&device_sn=${encodeURIComponent(deviceConfig.sn || "")}&device_address=${encodeURIComponent(deviceAddress(deviceConfig))}&user_id=${encodeURIComponent(u.user_id)}" onclick="return confirm('Hapus user ini dari mesin?')">Hapus</a>
            </div>
          </details>
        </td>
      </tr>
    `}).join("");
    const readRecordForms = users.map((u, i) => `
      <form id="read-fp-${i}" method="POST" action="/read-finger-record" style="display:none;">
        <input type="hidden" name="device_id" value="${escapeHtml(deviceConfig.id)}">
        <input type="hidden" name="device_sn" value="${escapeHtml(deviceConfig.sn || "")}">
        <input type="hidden" name="device_address" value="${escapeHtml(deviceAddress(deviceConfig))}">
        <input type="hidden" name="user_id" value="${escapeHtml(u.user_id)}">
        <input type="hidden" name="current_name" value="${escapeHtml(u.name)}">
        <input type="hidden" name="finger_index" value="0">
      </form>
    `).join("");

    res.send(htmlPage("User Mesin", `
      <h3>List/Edit User Mesin</h3>
      <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p>
      <p>SN/ID: <b>${escapeHtml(getDeviceIdentity(deviceConfig) || "-")}</b></p>
      <p>Alamat: <b>${escapeHtml(deviceAddress(deviceConfig))}:${escapeHtml(deviceConfig.port)}</b></p>
      <p>Total: ${users.length}</p>
      <p class="small">Sumber user: <b>${escapeHtml(readSource)}</b>. Status sidik jari: ${fpResult.supported ? "method " + escapeHtml(fpResult.method) : "jumlah jari dari data user mesin / template tidak diexpose library"} ${fpResult.error ? "- " + escapeHtml(fpResult.error) : ""}</p>
      ${readWarning ? `<div class="msg warn">Raw packet user belum terbaca, aplikasi fallback ke zkteco-js: ${escapeHtml(readWarning)}</div>` : ""}

      <form method="POST" action="/delete-selected-users-from-device" onsubmit="return confirm('Hapus semua user yang dicentang dari mesin ini? Target: ${escapeHtml(deviceConfig.name)} SN:${escapeHtml(deviceConfig.sn || "-")} alamat:${escapeHtml(deviceAddress(deviceConfig))}')">
        <input type="hidden" name="device_id" value="${escapeHtml(deviceConfig.id)}">
        <input type="hidden" name="device_sn" value="${escapeHtml(deviceConfig.sn || "")}">
        <input type="hidden" name="device_address" value="${escapeHtml(deviceAddress(deviceConfig))}">

        <button type="button" class="gray" onclick="document.querySelectorAll('.device-user-check').forEach(x=>x.checked=true)">Select All</button>
        <button type="button" class="gray" onclick="document.querySelectorAll('.device-user-check').forEach(x=>x.checked=false)">Unselect All</button>
        <button class="danger" type="submit">Hapus User Terpilih dari Mesin</button>

        <div class="table-scroll">
          <table>
            <tr><th>Pilih</th><th>No</th><th>UID</th><th>User ID</th><th>Nama & Sidik</th><th>Card</th><th>Aksi</th></tr>
            ${rows || '<tr><td colspan="7">Tidak ada user terbaca.</td></tr>'}
          </table>
        </div>
      </form>
      ${readRecordForms}

      <p><a href="/">Kembali</a></p>
    `));
  } catch (err) {
    await closeDevice(device);
    res.send(htmlPage("Gagal List User", `<h3>Gagal membaca user dari mesin</h3><p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p><pre>${escapeHtml(errorText(err))}</pre><a href="/">Kembali</a>`));
  }
});

app.get("/edit-device-user", (req, res) => {
  const deviceConfig = getDeviceById(req.query.device_id) || getDeviceBySn(req.query.device_sn);
  if (!deviceConfig) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><a href="/">Kembali</a>`));

  const userId = String(req.query.user_id || "").trim();
  const currentName = String(req.query.current_name || "").trim();
  const card = String(req.query.card || "").trim();
  const cachedRecords = latestFingerprintCacheRows(deviceConfig, userId);

  res.send(htmlPage("Edit Nama User Mesin", `
    <h3>Edit Nama User di Mesin</h3>
    <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b> - SN:${escapeHtml(deviceConfig.sn || "-")}</p>
    <div class="grid">
      <div class="card">
        <h3>Edit Nama</h3>
        <form method="POST" action="/update-device-user">
          <input type="hidden" name="device_id" value="${escapeHtml(deviceConfig.id)}">
          <input type="hidden" name="device_sn" value="${escapeHtml(deviceConfig.sn || "")}">
          <input type="hidden" name="user_id" value="${escapeHtml(userId)}">
          <input type="hidden" name="card" value="${escapeHtml(card)}">
          <label>User ID</label>
          <input value="${escapeHtml(userId)}" readonly>
          <label>Nama Baru</label>
          <input name="name" value="${escapeHtml(currentName)}" required>
          <button class="blue" type="submit">Simpan Nama ke Mesin</button>
        </form>
      </div>
      <div class="card">
        <h3>Record Sidik Jari Read-only</h3>
        <p class="small">Baca hasil record/template dari mesin. Pendaftaran sidik jari tetap dilakukan di mesin.</p>
        <form method="POST" action="/read-finger-record">
          <input type="hidden" name="device_id" value="${escapeHtml(deviceConfig.id)}">
          <input type="hidden" name="device_sn" value="${escapeHtml(deviceConfig.sn || "")}">
          <input type="hidden" name="device_address" value="${escapeHtml(deviceAddress(deviceConfig))}">
          <input type="hidden" name="user_id" value="${escapeHtml(userId)}">
          <input type="hidden" name="current_name" value="${escapeHtml(currentName)}">
          <label>Jari</label>
          <select name="finger_index">
            ${Array.from({length:10}).map((_,i)=>`<option value="${i}">${i} - ${escapeHtml(fingerName(i))}</option>`).join("")}
          </select>
          <button class="orange" type="submit">Baca Record Mesin</button>
        </form>
        <a class="pill" href="/finger-enroll?device_id=${encodeURIComponent(deviceConfig.id)}&device_sn=${encodeURIComponent(deviceConfig.sn || "")}&device_address=${encodeURIComponent(deviceAddress(deviceConfig))}&user_id=${encodeURIComponent(userId)}&current_name=${encodeURIComponent(currentName)}">Buka Halaman Finger</a>
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <h3>Cache Record Finger Terakhir</h3>
      ${renderFingerprintRecordTable(cachedRecords)}
    </div>
    <a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>
  `));
});

app.post("/update-device-user", async (req, res) => {
  const deviceConfig = resolveDeviceFromBody(req.body);
  const userId = String(req.body.user_id || "").trim();
  const name = String(req.body.name || "").trim();
  const card = String(req.body.card || "").trim();

  if (!deviceConfig) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><pre>${escapeHtml(safeJson(req.body))}</pre><a href="/">Kembali</a>`));
  if (!userId || !name) return res.send(htmlPage("Data kurang", `<h3>User ID / nama kosong</h3><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>`));

  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    await setUserToDevice(device, { user_id: userId, name, card });
    await closeDevice(device);
    res.send(htmlPage("Edit User", `<h3>Nama user berhasil diperbarui di mesin</h3><p>${escapeHtml(userId)} - ${escapeHtml(name)}</p><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali ke List User Mesin</a>`));
  } catch (err) {
    await closeDevice(device);
    res.send(htmlPage("Gagal Edit User", `<h3>Gagal update nama user di mesin</h3><pre>${escapeHtml(errorText(err))}</pre><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>`));
  }
});


app.get("/delete-user-from-device-get", async (req, res) => {
  const result = resolveDeviceLocked(req.query);
  const deviceConfig = result.device;
  const userId = String(firstValue(req.query.user_id || "")).trim();

  if (!result.ok) return res.send(htmlPage("Target mesin tidak aman", `<h3>Target mesin tidak aman</h3><p>${escapeHtml(result.error)}</p><pre>${escapeHtml(safeJson(req.query))}</pre><a href="/">Kembali</a>`));
  if (!userId) return res.send(htmlPage("User kosong", `<h3>User ID belum diisi</h3><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>`));

  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    await deleteUserFromDevice(device, userId);
    await closeDevice(device);
    res.send(htmlPage("Hapus User", `<h3>User berhasil dihapus dari mesin</h3><p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p><p>SN: <b>${escapeHtml(deviceConfig.sn || "-")}</b></p><p>User ID: <b>${escapeHtml(userId)}</b></p><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali ke List User Mesin</a>`));
  } catch (err) {
    await closeDevice(device);
    res.send(htmlPage("Gagal Hapus User", `<h3>Gagal hapus user dari mesin</h3><p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p><p>User ID: <b>${escapeHtml(userId)}</b></p><pre>${escapeHtml(errorText(err))}</pre><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>`));
  }
});


app.post("/delete-user-from-device", async (req, res) => {
  const deviceConfig = requireLockedDeviceOrPage(req, res, "/");
  if (!deviceConfig) return;
  const userId = String(req.body.user_id || "").trim();

  if (!deviceConfig) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><p>device_id/device_sn tidak valid.</p><pre>${escapeHtml(safeJson(req.body))}</pre><a href="/">Kembali</a>`));
  if (!userId) return res.send(htmlPage("User kosong", `<h3>User ID belum diisi</h3><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>`));

  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    await deleteUserFromDevice(device, userId);
    await closeDevice(device);
    res.send(htmlPage("Hapus User", `<h3>User berhasil dihapus dari mesin</h3><p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p><p>User ID: <b>${escapeHtml(userId)}</b></p><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali ke List User Mesin</a>`));
  } catch (err) {
    await closeDevice(device);
    res.send(htmlPage("Gagal Hapus User", `<h3>Gagal hapus user dari mesin</h3><p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p><p>User ID: <b>${escapeHtml(userId)}</b></p><pre>${escapeHtml(errorText(err))}</pre><a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>`));
  }
});

app.post("/delete-selected-users-from-device", async (req, res) => {
  // FIX V8: hapus massal dikunci ke device_id + SN + alamat final.
  const deviceConfig = requireLockedDeviceOrPage(req, res, "/");
  if (!deviceConfig) return;

  let userIds = req.body.user_ids || req.body["user_ids[]"] || [];
  if (!Array.isArray(userIds)) userIds = userIds ? [userIds] : [];
  userIds = userIds.map(v => String(v || "").trim()).filter(Boolean);

  if (!deviceConfig.sn) {
    return res.send(htmlPage("SN kosong", `
      <h3>SN mesin kosong</h3>
      <p>Hapus massal harus memakai SN agar tidak salah mesin.</p>
      <a href="/edit-device?device_id=${encodeURIComponent(deviceConfig.id)}">Isi SN Mesin</a>
    `));
  }

  if (!userIds.length) {
    return res.send(htmlPage("Tidak ada user", `
      <h3>Tidak ada user yang dipilih</h3>
      <a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>
    `));
  }

  let device = null;
  const ok = [];
  const failed = [];

  try {
    device = await connectDevice(deviceConfig);

    for (const userId of userIds) {
      try {
        await deleteUserFromDevice(device, userId);
        ok.push(String(userId));
      } catch (err) {
        failed.push(`${userId}: ${errorText(err)}`);
      }
    }

    await closeDevice(device);

    res.send(htmlPage("Hapus Massal User Mesin", `
      <h3>Hapus massal selesai</h3>
      <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p>
      <p>SN: <b>${escapeHtml(deviceConfig.sn || "-")}</b></p>
      <p>Berhasil: ${ok.length}</p>
      <p>Gagal: ${failed.length}</p>
      <h4>Berhasil</h4><pre>${escapeHtml(ok.join("\\n") || "-")}</pre>
      <h4>Gagal</h4><pre>${escapeHtml(failed.join("\\n") || "-")}</pre>
      <a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali ke List User Mesin</a>
    `));
  } catch (err) {
    await closeDevice(device);
    res.send(htmlPage("Gagal Hapus Massal", `
      <h3>Gagal konek ke mesin</h3>
      <p>Mesin: ${escapeHtml(deviceConfig.name)} | SN: ${escapeHtml(deviceConfig.sn || "-")}</p>
      <pre>${escapeHtml(errorText(err))}</pre>
      <a href="/device-users?device_id=${encodeURIComponent(deviceConfig.id)}">Kembali</a>
    `));
  }
});

// =======================
// CLONE / REBOOT
// =======================
app.post("/clone-users", async (req, res) => {
  const source = getDeviceById(req.body.source_device_id);
  const target = getDeviceById(req.body.target_device_id);

  if (!source || !target) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin sumber/tujuan tidak ditemukan</h3><a href="/">Kembali</a>`));
  if (source.id === target.id) return res.send(htmlPage("Target sama", `<h3>Mesin sumber dan tujuan tidak boleh sama</h3><a href="/">Kembali</a>`));

  let sourceDevice = null;
  let targetDevice = null;
  let clonedUsers = [];
  const sent = [];
  const failed = [];

  try {
    sourceDevice = await connectDevice(source);
    clonedUsers = await getUsersFromDevice(sourceDevice);
    updateUserNameCacheFromUsers(clonedUsers, source);
    await closeDevice(sourceDevice);

    let selectedSourceIds = req.body.source_user_ids || [];
    if (!Array.isArray(selectedSourceIds)) selectedSourceIds = selectedSourceIds ? [selectedSourceIds] : [];
    if (selectedSourceIds.length > 0) clonedUsers = clonedUsers.filter(u => selectedSourceIds.includes(String(u.user_id)));

    if (clonedUsers.length === 0) {
      return res.send(htmlPage("Clone User", `<h3>Tidak ada user dipilih/terbaca dari mesin sumber</h3><a href="/">Kembali</a>`));
    }

    targetDevice = await connectDevice(target);

    // Push tanpa delay buatan.
    for (const u of clonedUsers) {
      try {
        await setUserToDevice(targetDevice, { user_id: u.user_id, name: u.name || `User ${u.user_id}`, card: u.card || "" });
        sent.push(`${u.user_id} - ${u.name || ""}`);
      } catch (err) {
        failed.push(`${u.user_id} - ${u.name || ""}: ${errorText(err)}`);
      }
    }

    await closeDevice(targetDevice);

    res.send(htmlPage("Clone User", `
      <h3>Clone user selesai</h3>
      <p>Dari: <b>${escapeHtml(source.name)}</b> SN:${escapeHtml(source.sn || "-")}</p>
      <p>Ke: <b>${escapeHtml(target.name)}</b> SN:${escapeHtml(target.sn || "-")}</p>
      <p>User diproses: ${clonedUsers.length}</p>
      <p>Berhasil: ${sent.length}</p>
      <p>Gagal: ${failed.length}</p>
      <h4>Berhasil</h4><pre>${escapeHtml(sent.join("\\n") || "-")}</pre>
      <h4>Gagal</h4><pre>${escapeHtml(failed.join("\\n") || "-")}</pre>
      <p class="small">Catatan: sidik jari/template belum ikut karena zkteco-js standar tidak menyediakan command template fingerprint.</p>
      <a href="/">Kembali</a>
    `));
  } catch (err) {
    await closeDevice(sourceDevice);
    await closeDevice(targetDevice);
    res.send(htmlPage("Gagal Clone", `<h3>Gagal clone user</h3><pre>${escapeHtml(errorText(err))}</pre><a href="/">Kembali</a>`));
  }
});

app.get("/check-reboot-support", async (req, res) => {
  const deviceConfig = requireLockedDeviceOrPage(req, res, "/");
  if (!deviceConfig) return;

  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    const methods = listRebootMethods(device);
    await closeDevice(device);

    res.send(htmlPage("Cek Reboot Mesin", `
      <h3>Cek Support Reboot Mesin</h3>
      <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b> - SN:${escapeHtml(deviceConfig.sn || "-")}</p>
      <p>Alamat dipakai: <b>${escapeHtml(deviceAddress(deviceConfig))}:${escapeHtml(deviceConfig.port)}</b></p>
      <p>Status support reboot: <b>${methods.length ? "TERSEDIA" : "TIDAK TERSEDIA"}</b></p>
      <h4>Method reboot terdeteksi</h4>
      <pre>${escapeHtml(methods.join("\n") || "Tidak ada method reboot/restart di library/firmware ini.")}</pre>
      <form method="POST" action="/reboot-device" onsubmit="return confirm('Kirim perintah reboot ke mesin ini?')">
        <input type="hidden" name="device_id" value="${escapeHtml(deviceConfig.id)}">
        <input type="hidden" name="device_sn" value="${escapeHtml(deviceConfig.sn || "")}">
        <input type="hidden" name="device_address" value="${escapeHtml(deviceAddress(deviceConfig))}">
        <button class="danger" type="submit" ${methods.length ? "" : "disabled"}>Reboot Sekarang</button>
      </form>
      <p><a href="/">Kembali</a></p>
    `));
  } catch (err) {
    await closeDevice(device);
    res.send(htmlPage("Cek Reboot Gagal", `
      <h3>Gagal cek support reboot</h3>
      <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b></p>
      <pre>${escapeHtml(errorText(err))}</pre>
      <p><a href="/">Kembali</a></p>
    `));
  }
});

app.post("/reboot-device", async (req, res) => {
  const deviceConfig = requireLockedDeviceOrPage(req, res, "/");
  if (!deviceConfig) return;
  if (!deviceConfig) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><pre>${escapeHtml(safeJson(req.body))}</pre><a href="/">Kembali</a>`));

  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    const result = await rebootDevice(device);
    await closeDevice(device);

    res.send(htmlPage("Reboot Mesin", `
      <h3>Perintah reboot dikirim</h3>
      <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b> - SN:${escapeHtml(deviceConfig.sn || "-")}</p>
      <p>Method: <b>${escapeHtml(result?.method || "-")}</b></p>
      ${result?.note ? `<pre>${escapeHtml(result.note)}</pre>` : ""}
      <p>Tunggu 1-2 menit sebelum test koneksi lagi.</p>
      <a href="/">Kembali</a>
    `));
  } catch (err) {
    await closeDevice(device);
    res.send(htmlPage("Gagal Reboot", `<h3>Gagal reboot mesin</h3><pre>${escapeHtml(errorText(err))}</pre><p>Firmware/library bisa saja tidak mendukung reboot TCP/IP.</p><a href="/">Kembali</a>`));
  }
});

// =======================
// ATTENDANCE
// =======================
app.post("/pull-attendance", async (req, res) => {
  const deviceConfig = requireLockedDeviceOrPage(req, res, "/");
  if (!deviceConfig) return;
  if (!deviceConfig) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><pre>${escapeHtml(safeJson(req.body))}</pre><a href="/">Kembali</a>`));

  try {
    const result = await pullAttendanceFromDeviceConfig(deviceConfig);

    res.send(htmlPage("Tarik Absensi", `
      <h3>Tarik absensi selesai</h3>
      <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b> - SN:${escapeHtml(deviceConfig.sn || "-")}</p>
      <p>Log terbaca dari mesin: ${escapeHtml(result.read_logs)}</p>
      <p>Log baru: ${result.added}</p>
      <p>Total tersimpan: ${result.total}</p>
      ${result.skipped_write ? `<div class="msg">Tidak ada log baru, database tidak ditulis ulang.</div>` : ""}
      <a href="/attendance">Lihat Dashboard</a>
    `));
  } catch (err) {
    res.send(htmlPage("Gagal Tarik Absensi", `
      <h3>Gagal tarik absensi</h3>
      <pre>${escapeHtml(errorText(err))}</pre>
      <div class="msg warn">
        <b>Solusi cepat:</b><br>
        1. Restart server Node dari file BAT.<br>
        2. Pastikan tidak ada software lain yang sedang konek ke mesin.<br>
        3. Jangan tarik absensi bersamaan dari 2 menu/2 browser.<br>
        4. Coba Test koneksi dulu, lalu tarik ulang setelah 10 detik.<br>
        5. Jika pakai port forwarding/Tailscale, pastikan port menuju mesin yang benar.
      </div>
      <a href="/">Kembali</a>
    `));
  }
});

app.post("/pull-attendance-all", async (req, res) => {
  const config = loadConfig();
  const summary = [];

  for (const deviceConfig of config.devices) {
    try {
      const result = await pullAttendanceFromDeviceConfig(deviceConfig);
      const savedNote = result.skipped_write ? ", tidak ada tulis ulang" : "";
      summary.push(`${deviceConfig.name} SN:${deviceConfig.sn || "-"}: terbaca ${result.read_logs}, baru ${result.added}${savedNote}`);
      await delay(2500);
    } catch (err) {
      summary.push(`${deviceConfig.name} SN:${deviceConfig.sn || "-"}: GAGAL - ${errorText(err)}`);
      await delay(2500);
    }
  }

  res.send(htmlPage("Tarik Semua Absensi", `<h3>Tarik semua absensi selesai</h3><pre>${escapeHtml(summary.join("\\n"))}</pre><a href="/attendance">Lihat Dashboard</a>`));
});

app.get("/attendance", (req, res) => {
  const currentUserObj = req.currentUser;
  const config = filteredConfigForRequest(req);
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.max(10, Math.min(100, Number(req.query.page_size || 15)));
  const filters = {
    device_sn: String(req.query.device_sn || ""),
    user_id: normalizeUserId(req.query.user_id || ""),
    start_date: normalizeDateInput(req.query.start_date || ""),
    end_date: normalizeDateInput(req.query.end_date || "")
  };

  let rowsAll = attendanceRecordRows(filters);
  if (!isAdminUser(currentUserObj)) { const allowedKeys = new Set(config.devices.flatMap(d => [String(d.id), String(d.sn), String(d.name)]).filter(Boolean)); rowsAll = rowsAll.filter(r => allowedKeys.has(String(r.device_id)) || allowedKeys.has(String(r.device_sn)) || allowedKeys.has(String(r.device_name))); }
  const total = rowsAll.length;
  const rawAttendanceCount = loadAttendance().length;
  const debugSample = total === 0 ? attendanceFilterStepDebug(filters) : null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = rowsAll.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const deviceOptions = config.devices.map(d => {
    const val = getDeviceFilterValue(d);
    return `<option value="${escapeHtml(val)}" ${filters.device_sn === val ? "selected" : ""}>${escapeHtml(d.name)} - SN:${escapeHtml(d.sn || "-")}</option>`;
  }).join("");

  function pageLink(p, label = p) {
    const qs = new URLSearchParams({
      ...filters,
      page: String(p),
      page_size: String(pageSize)
    });
    return `<a class="page-btn ${p === currentPage ? "active" : ""}" href="/attendance?${qs.toString()}">${escapeHtml(label)}</a>`;
  }

  const pageButtons = [];
  if (currentPage > 1) pageButtons.push(pageLink(currentPage - 1, "<"));
  for (let p = 1; p <= Math.min(totalPages, 10); p++) pageButtons.push(pageLink(p));
  if (totalPages > 12) pageButtons.push(`<span class="page-dot">...</span>`);
  if (totalPages > 10) {
    for (let p = Math.max(11, totalPages - 1); p <= totalPages; p++) pageButtons.push(pageLink(p));
  }
  if (currentPage < totalPages) pageButtons.push(pageLink(currentPage + 1, ">"));

  const tableRows = rows.map((r, idx) => {
    const no = total - ((currentPage - 1) * pageSize + idx);
    return `
      <tr>
        <td>${escapeHtml(no)}</td>
        <td><b>${escapeHtml(r.device_sn || "-")}</b></td>
        <td><span class="emp-badge">${escapeHtml(r.user_id || "-")}</span><br><span class="small">${escapeHtml(resolveUserName(r.user_id, r.device_sn) || "")}</span></td>
        <td>${escapeHtml(formatDateTimeIndo(getAttendanceTimestamp(r)))}</td>
        <td>${escapeHtml(getRawStatusValue(r, 1))}</td>
        <td>${escapeHtml(getRawStatusValue(r, 2))}</td>
        <td>${escapeHtml(getRawStatusValue(r, 3))}</td>
        <td>${escapeHtml(getRawStatusValue(r, 4))}</td>
        <td>${escapeHtml(getRawStatusValue(r, 5))}</td>
      </tr>`;
  }).join("");

  res.send(htmlPage("Attendance Records", `
    <h1>Attendance Records <span class="record-pill">${total} Records</span></h1>

    <div class="card record-filter">
      <div class="submenu-title">
        <span class="submenu-icon">${iconSvg("pull")}</span>
        <div>
          <h3>Tarik Data Manual</h3>
          <p class="small">Log diambil langsung dari mesin. Jika tidak ada log baru, database tidak ditulis ulang.</p>
        </div>
      </div>
      <form method="GET" action="/attendance">
        <div class="grid3">
          <div>
            <label>Mesin</label>
            <select name="device_sn">
              <option value="">Semua Mesin</option>
              ${deviceOptions}
            </select>
          </div>
          <div>
            <label>User ID</label>
            <input name="user_id" value="${escapeHtml(filters.user_id)}" placeholder="Contoh: 103">
          </div>
          <div>
            <label>Data per halaman</label>
            <select name="page_size">
              ${[15,25,50,100].map(n=>`<option value="${n}" ${pageSize===n?"selected":""}>${n}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="grid">
          <div><label>Tanggal Awal</label><input type="date" name="start_date" value="${escapeHtml(filters.start_date)}"></div>
          <div><label>Tanggal Akhir</label><input type="date" name="end_date" value="${escapeHtml(filters.end_date)}"></div>
        </div>
        <button class="blue" type="submit">Tampilkan Records</button>
      </form>
      <form method="POST" action="/pull-attendance" style="margin-top:8px;">
        <input type="hidden" name="device_id" value="${escapeHtml((getDeviceByFilterValue(filters.device_sn) || {}).id || "")}">
        <input type="hidden" name="device_sn" value="${escapeHtml(filters.device_sn || "")}">
        <input type="hidden" name="device_address" value="${escapeHtml(getDeviceByFilterValue(filters.device_sn) ? deviceAddress(getDeviceByFilterValue(filters.device_sn)) : "")}">
        <button class="orange icon-button" type="submit" ${filters.device_sn ? "" : "disabled"}>${iconSvg("pull")}<span>Tarik Mesin Terpilih</span></button>
      </form>
      <form method="POST" action="/pull-attendance-all" style="margin-top:8px;">
        <button class="gray icon-button" type="submit">${iconSvg("database")}<span>Tarik Semua Mesin</span></button>
      </form>
      ${isAdminUser(currentUserObj) ? `
        <label class="inline-check" style="margin-top:10px;">
          <input type="checkbox" data-auto-pull data-url="/api/auto-pull-attendance" style="width:auto;margin-right:8px;">
          Auto polling browser tiap 30 detik
        </label>
        <p class="small" data-auto-status>Auto polling browser belum aktif.</p>
      ` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <a class="pill icon-button" href="/attendance-report">${iconSvg("report")}<span>Laporan Khusus</span></a>
        <a class="pill icon-button" href="/auto-sync">${iconSvg("settings")}<span>Auto Tarik Berkala</span></a>
      </div>
    </div>

    <details class="card" style="margin-top:14px;">
      <summary>Ringkasan data tersimpan</summary>
      <pre>${escapeHtml(safeJson(attendanceDebugSummary()))}</pre>
    </details>

    <div class="attendance-dark-card">
      <div class="table-scroll dark-table-scroll">
        <table class="attendance-record-table">
          <thead>
            <tr>
              <th>#</th>
              <th>SN</th>
              <th>EMPLOYEE ID</th>
              <th>TIMESTAMP</th>
              <th>STATUS 1</th>
              <th>STATUS 2</th>
              <th>STATUS 3</th>
              <th>STATUS 4</th>
              <th>STATUS 5</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows || `<tr><td colspan="9">Tidak ada records untuk filter ini. Total raw attendance tersimpan: ${rawAttendanceCount}</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="record-footer">
        <div>Showing ${(currentPage - 1) * pageSize + (rows.length ? 1 : 0)} to ${(currentPage - 1) * pageSize + rows.length} of ${total} results</div>
        <div class="pagination">${pageButtons.join("")}</div>
      </div>
    </div>

    <div class="msg warn" style="margin-top:16px;">
      Status 1–5 diambil dari raw log mesin jika tersedia. Jika merk/firmware hanya mengirim sebagian status, kolom lain bisa kosong.
      Untuk cek detail mentah, buka <a href="/attendance-raw-debug">Debug Raw Attendance</a>.
    </div>
    ${total === 0 ? `
      <details class="card" style="margin-top:16px;">
        <summary>Debug filter attendance</summary>
        <pre>${escapeHtml(safeJson({ filters, rawAttendanceCount, debug: debugSample }))}</pre>
        <p class="small">Jika bulan Mei tidak ada di byMonth, berarti data Mei belum tertarik dari mesin atau tanggal di mesin tidak Mei. Klik Tarik Absensi Mesin Terpilih lalu cek lagi.</p>
      </details>
    ` : ""}
  `));
});

app.get("/live", (req, res) => {
  const currentUserObj = req.currentUser;
  const config = filteredConfigForRequest(req);
  const selectedDevice = String(req.query.device_sn || "").trim();
  let summaries = buildTodayUserSummary(selectedDevice);
  if (!isAdminUser(currentUserObj)) { const allowedKeys = new Set(config.devices.flatMap(d => [String(d.id), String(d.sn), String(d.name)]).filter(Boolean)); summaries = summaries.filter(r => allowedKeys.has(String(r.device_sn)) || allowedKeys.has(String(r.device_name))); }
  summaries = summaries.slice(0, 10);
  const newest = summaries[0] || null;

  const deviceOptions = config.devices.map(d => {
    const val = getDeviceFilterValue(d);
    return `<option value="${escapeHtml(val)}" ${selectedDevice === val ? "selected" : ""}>${escapeHtml(d.name)} - SN:${escapeHtml(d.sn || "-")}</option>`;
  }).join("");

  const rows = summaries.map((r, i) => `
    <tr>
      <td>${i+1}</td>
      <td><b>${escapeHtml(r.user_name || "-")}</b><br><span class="small">${escapeHtml(r.user_id)}</span></td>
      <td>${escapeHtml(r.device_name)}<br><span class="small">${escapeHtml(r.device_sn || "-")}</span></td>
      <td>${escapeHtml(formatTimeOnly(r.check_in))}</td>
      <td>${escapeHtml(formatTimeOnly(r.check_out))}<br><span class="small">${escapeHtml(r.real_note || "")}</span></td>
      <td>${escapeHtml(formatDateTimeIndo(r.last_time))}</td>
    </tr>
  `).join("");

  res.send(htmlPage("Live Dashboard", `
    <h1>Live Dashboard Absensi</h1>

    <div class="msg warn">
      Live memakai data real dari log mesin. Jam masuk = log pertama hari ini, jam pulang = log terakhir yang berbeda.
    </div>
    <div class="card live-hero">
      <form method="GET" action="/live" class="live-filter">
        <label>Tampilkan Mesin</label>
        <select name="device_sn" onchange="this.form.submit()">
          <option value="">Semua Mesin</option>
          ${deviceOptions}
        </select>
      </form>

      <div class="live-greeting">
        <div class="live-avatar">👋</div>
        <div>
          <p class="small">Log terbaru hari ini</p>
          <h2>${escapeHtml(newest ? greetingForSummary(newest) : "Belum ada absensi hari ini.")}</h2>
        </div>
      </div>
    </div>

    <div class="grid3" style="margin-top:16px;">
      <div class="stat">Tampil <b>${summaries.length}</b></div>
      <div class="stat">Sudah Pulang <b>${summaries.filter(x=>x.check_out).length}</b></div>
      <div class="stat">Belum Pulang <b>${summaries.filter(x=>!x.check_out).length}</b></div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>10 Orang Terbaru</h3>
      <p class="small">Yang terbaru muncul di atas. Absen lama otomatis turun ke bawah.</p>
      <div class="table-scroll">
        <table>
          <tr><th>No</th><th>User</th><th>Mesin</th><th>Jam Masuk</th><th>Jam Pulang</th><th>Update Terakhir</th></tr>
          ${rows || '<tr><td colspan="6">Belum ada data hari ini untuk mesin ini.</td></tr>'}
        </table>
      </div>
    </div>

    <script>setTimeout(() => location.reload(), 15000);</script>
  `));
});

app.post("/save-realtime", async (req, res) => {
  const config = loadConfig();
  let ids = req.body.realtime_device_ids || [];
  if (!Array.isArray(ids)) ids = ids ? [ids] : [];
  config.realtime_enabled = req.body.realtime_enabled === "1";
  config.realtime_device_ids = ids;
  saveConfig(config);
  await restartRealtimeFromConfig();
  res.redirect("/live");
});

app.post("/clear-attendance", (req, res) => {
  saveAttendance([]);
  res.redirect("/attendance");
});

// =======================
// AUTO SYNC / RECONNECT SETTINGS
// =======================
app.get("/auto-sync", (req, res) => {
  const config = loadConfig();

  res.send(htmlPage("Auto Sync", `
    <h1>Auto Sync Center</h1>
    <div class="msg warn">
      Auto Sync dibuat <b>OFF dan terkontrol</b> agar user mesin A tidak otomatis menyebar ke mesin B.
      Aktifkan hanya jika memang ingin menyamakan user antar mesin.
    </div>

    <div class="grid3">
      <div class="card">
        <h3>Sync User</h3>
        <form method="POST" action="/toggle-auto-sync">
          <input type="hidden" name="field" value="auto_sync_enabled">
          <input type="hidden" name="value" value="${config.auto_sync_enabled ? "0" : "1"}">
          <div class="stat">Status <b>${config.auto_sync_enabled ? "ON" : "OFF"}</b></div>
          <button class="${config.auto_sync_enabled ? "danger" : "blue"}" type="submit">${config.auto_sync_enabled ? "Matikan Sync User" : "Nyalakan Sync User"}</button>
        </form>
        <p class="small">Jika ON, user dari Master bisa dikirim ke mesin tujuan yang dipilih.</p>
      </div>

      <div class="card">
        <h3>Cek Status Mesin</h3>
        <form method="POST" action="/toggle-auto-sync">
          <input type="hidden" name="field" value="auto_reconnect_enabled">
          <input type="hidden" name="value" value="${config.auto_reconnect_enabled ? "0" : "1"}">
          <div class="stat">Status <b>${config.auto_reconnect_enabled ? "ON" : "OFF"}</b></div>
          <button class="${config.auto_reconnect_enabled ? "danger" : "blue"}" type="submit">${config.auto_reconnect_enabled ? "Matikan Cek Status" : "Nyalakan Cek Status"}</button>
        </form>
        <p class="small">Cek online/offline mesin otomatis.</p>
      </div>

      <div class="card">
        <h3>Realtime Attendance</h3>
        <form method="POST" action="/toggle-auto-sync">
          <input type="hidden" name="field" value="realtime_enabled">
          <input type="hidden" name="value" value="${config.realtime_enabled ? "0" : "1"}">
          <div class="stat">Status <b>${config.realtime_enabled ? "ON" : "OFF"}</b></div>
          <button class="${config.realtime_enabled ? "danger" : "blue"}" type="submit">${config.realtime_enabled ? "Matikan Realtime" : "Nyalakan Realtime"}</button>
        </form>
        <p class="small">Jika firmware tidak support realtime, gunakan tarik absensi manual.</p>
      </div>

      <div class="card">
        <h3>Auto Tarik Absensi</h3>
        <form method="POST" action="/toggle-auto-sync">
          <input type="hidden" name="field" value="auto_attendance_enabled">
          <input type="hidden" name="value" value="${config.auto_attendance_enabled ? "0" : "1"}">
          <div class="stat">Status <b>${config.auto_attendance_enabled ? "ON" : "OFF"}</b></div>
          <button class="${config.auto_attendance_enabled ? "danger" : "blue"} icon-button" type="submit">${iconSvg("pull")}<span>${config.auto_attendance_enabled ? "Matikan Auto Tarik" : "Nyalakan Auto Tarik"}</span></button>
        </form>
        <p class="small">Polling berkala. Mesin offline dilewati dan file attendance tidak ditulis jika tidak ada log baru.</p>
      </div>
    </div>

    <details class="card" style="margin-top:16px;">
      <summary>Pengaturan Lanjutan Sync User</summary>
      <form method="POST" action="/save-automation-center" style="margin-top:16px;">
        <div class="grid">
          <div>
            <h3>Mesin Master</h3>
            ${deviceSelect("auto_sync_source_device_id", config.devices, config.auto_sync_source_device_id)}
            <label>Interval sync user (menit)</label>
            <input name="auto_sync_interval_minutes" value="${escapeHtml(config.auto_sync_interval_minutes)}">
            <label>Interval cek status (detik)</label>
            <input name="auto_reconnect_interval_seconds" value="${escapeHtml(config.auto_reconnect_interval_seconds)}">
            <label>Interval tarik absensi berkala (detik)</label>
            <input name="auto_attendance_interval_seconds" value="${escapeHtml(config.auto_attendance_interval_seconds)}">
            <label style="margin-top:10px;">
              <input type="checkbox" name="auto_attendance_skip_offline" value="1" ${checkedAttr(config.auto_attendance_skip_offline !== false)} style="width:auto;margin-right:8px;">
              Lewati mesin yang sedang offline
            </label>
          </div>
          <div>
            <h3>Mesin Tujuan</h3>
            ${config.devices.map(d => `
              <label style="display:block;margin:8px 0;padding:8px;border:1px solid #e2e8f0;border-radius:12px;">
                <input type="checkbox" name="auto_sync_target_device_ids" value="${escapeHtml(d.id)}" ${checkedAttr(config.auto_sync_target_device_ids.includes(d.id))} style="width:auto;margin-right:8px;">
                ${escapeHtml(d.name)} - SN:${escapeHtml(d.sn || "-")}
              </label>`).join("")}
          </div>
        </div>
        <h3>Realtime Device</h3>
        ${config.devices.map(d => `
          <label style="display:inline-block;margin:6px 12px 6px 0;">
            <input type="checkbox" name="realtime_device_ids" value="${escapeHtml(d.id)}" ${checkedAttr(config.realtime_device_ids.includes(d.id))} style="width:auto;margin-right:8px;">
            ${escapeHtml(d.name)}
          </label>`).join("")}

        <h3>Mesin Auto Tarik Absensi</h3>
        <p class="small">Kosongkan semua untuk memakai semua mesin. Jika ada yang dicentang, polling hanya berjalan untuk mesin tersebut.</p>
        ${config.devices.map(d => `
          <label style="display:inline-block;margin:6px 12px 6px 0;">
            <input type="checkbox" name="auto_attendance_device_ids" value="${escapeHtml(d.id)}" ${checkedAttr(config.auto_attendance_device_ids.includes(d.id))} style="width:auto;margin-right:8px;">
            ${escapeHtml(d.name)}
          </label>`).join("")}

        <input type="hidden" name="auto_sync_enabled" value="${config.auto_sync_enabled ? "1" : "0"}">
        <input type="hidden" name="auto_reconnect_enabled" value="${config.auto_reconnect_enabled ? "1" : "0"}">
        <input type="hidden" name="realtime_enabled" value="${config.realtime_enabled ? "1" : "0"}">
        <input type="hidden" name="auto_attendance_enabled" value="${config.auto_attendance_enabled ? "1" : "0"}">
        <button class="blue" type="submit">Simpan Pengaturan Lanjutan</button>
      </form>
    </details>

    <div class="card" style="margin-top:16px;">
      <h3>Aksi Manual</h3>
      <div class="grid3">
        <form method="POST" action="/run-auto-sync-now" data-submit-lock><button class="blue icon-button" type="submit" data-loading-text="Sync user...">${iconSvg("send")}<span>Sync User Sekarang</span></button></form>
        <form method="POST" action="/run-auto-attendance-now" data-submit-lock><button class="orange icon-button" type="submit" data-loading-text="Tarik absensi...">${iconSvg("pull")}<span>Tarik Auto Sekarang</span></button></form>
        <form method="POST" action="/pull-attendance-all" data-submit-lock><button class="orange icon-button" type="submit" data-loading-text="Tarik semua...">${iconSvg("database")}<span>Tarik Absensi Semua</span></button></form>
        <form method="POST" action="/check-status-now" data-submit-lock><button class="gray icon-button" type="submit" data-loading-text="Cek status...">${iconSvg("test")}<span>Cek Status Mesin</span></button></form>
      </div>
    </div>
  `));
});

app.post("/toggle-auto-sync", (req, res) => {
  const config = loadConfig();
  const field = String(req.body.field || "");
  const allowed = ["auto_sync_enabled", "auto_reconnect_enabled", "realtime_enabled", "auto_attendance_enabled"];
  if (allowed.includes(field)) {
    config[field] = req.body.value === "1";
    saveConfig(config);
    restartSchedulers();
  }
  res.redirect("/auto-sync");
});

app.post("/save-automation-center", (req, res) => {
  const config = loadConfig();
  let syncTargets = req.body.auto_sync_target_device_ids || [];
  let realtimeIds = req.body.realtime_device_ids || [];
  let attendanceIds = req.body.auto_attendance_device_ids || [];
  if (!Array.isArray(syncTargets)) syncTargets = syncTargets ? [syncTargets] : [];
  if (!Array.isArray(realtimeIds)) realtimeIds = realtimeIds ? [realtimeIds] : [];
  if (!Array.isArray(attendanceIds)) attendanceIds = attendanceIds ? [attendanceIds] : [];

  config.auto_sync_enabled = req.body.auto_sync_enabled === "1";
  config.auto_sync_interval_minutes = Math.max(1, Number(req.body.auto_sync_interval_minutes || 10));
  config.auto_sync_source_device_id = String(req.body.auto_sync_source_device_id || "");
  config.auto_sync_target_device_ids = syncTargets;

  config.auto_reconnect_enabled = req.body.auto_reconnect_enabled === "1";
  config.auto_reconnect_interval_seconds = Math.max(10, Number(req.body.auto_reconnect_interval_seconds || 30));

  config.realtime_enabled = req.body.realtime_enabled === "1";
  config.realtime_device_ids = realtimeIds;

  config.auto_attendance_enabled = req.body.auto_attendance_enabled === "1";
  config.auto_attendance_interval_seconds = Math.max(30, Number(req.body.auto_attendance_interval_seconds || 60));
  config.auto_attendance_device_ids = attendanceIds;
  config.auto_attendance_skip_offline = req.body.auto_attendance_skip_offline === "1";

  saveConfig(config);
  restartSchedulers();
  res.redirect("/auto-sync");
});

app.post("/save-auto-attendance", (req, res) => {
  const config = loadConfig();
  let ids = req.body.auto_attendance_device_ids || [];
  if (!Array.isArray(ids)) ids = ids ? [ids] : [];
  config.auto_attendance_enabled = req.body.auto_attendance_enabled === "1";
  config.auto_attendance_interval_seconds = Math.max(30, Number(req.body.auto_attendance_interval_seconds || 60));
  config.auto_attendance_device_ids = ids;
  config.auto_attendance_skip_offline = req.body.auto_attendance_skip_offline !== "0";
  saveConfig(config);
  restartSchedulers();
  res.redirect("/auto-sync");
});

app.post("/run-auto-sync-now", async (req, res) => {
  try {
    await runAutoSyncOnce();
    res.send(htmlPage("Sync User", `<h3>Sync user selesai diproses</h3><p class="small">Jika auto sync OFF atau target belum dipilih, tidak ada user yang dikirim.</p><a class="pill" href="/auto-sync">Kembali</a>`));
  } catch (err) {
    res.send(htmlPage("Gagal Sync User", `<h3>Gagal sync user</h3><pre>${escapeHtml(errorText(err))}</pre><a class="pill" href="/auto-sync">Kembali</a>`));
  }
});

app.post("/check-status-now", async (req, res) => {
  try {
    await checkDeviceStatusOnce();
    res.send(htmlPage("Cek Status Mesin", `<h3>Cek status mesin selesai</h3><p>Status online/offline sudah diperbarui.</p><a class="pill" href="/">Dashboard</a> <a class="pill" href="/auto-sync">Auto Sync</a>`));
  } catch (err) {
    res.send(htmlPage("Gagal Cek Status", `<h3>Gagal cek status mesin</h3><pre>${escapeHtml(errorText(err))}</pre><a class="pill" href="/auto-sync">Kembali</a>`));
  }
});

app.post("/run-auto-attendance-now", async (req, res) => {
  const result = await autoPullAttendanceOnce({ force: true });
  const rows = (result.devices || []).map(item => `
    <tr>
      <td>${escapeHtml(item.device_name || "-")}</td>
      <td>${escapeHtml(item.device_sn || "-")}</td>
      <td>${item.skipped ? "Dilewati" : (item.ok ? "OK" : "Gagal")}</td>
      <td>${escapeHtml(item.read_logs || 0)}</td>
      <td>${escapeHtml(item.added || 0)}</td>
      <td>${escapeHtml(item.reason || item.error || (item.skipped_write ? "Tidak ada log baru" : "-"))}</td>
    </tr>`).join("");
  res.send(htmlPage("Tarik Auto Absensi", `
    <h3>Tarik absensi berkala dijalankan manual</h3>
    <div class="grid3">
      <div class="stat">Mesin sukses <b>${escapeHtml(result.success || 0)}</b></div>
      <div class="stat">Log baru <b>${escapeHtml(result.logs || 0)}</b></div>
      <div class="stat">Mesin dilewati/gagal <b>${escapeHtml((result.skipped || 0) + (result.failed || 0))}</b></div>
    </div>
    <div class="table-scroll" style="margin-top:16px;">
      <table>
        <tr><th>Mesin</th><th>SN</th><th>Status</th><th>Log Terbaca</th><th>Log Baru</th><th>Catatan</th></tr>
        ${rows || '<tr><td colspan="6">Tidak ada mesin yang diproses.</td></tr>'}
      </table>
    </div>
    <a class="pill" href="/attendance">Lihat Absensi</a>
    <a class="pill" href="/auto-sync">Kembali</a>
  `));
});

app.post("/api/auto-pull-attendance", async (req, res) => {
  const result = await autoPullAttendanceOnce({ force: true });
  res.json(result);
});

app.post("/save-auto-reconnect", (req, res) => {
  const config = loadConfig();
  config.auto_reconnect_enabled = req.body.auto_reconnect_enabled === "1";
  config.auto_reconnect_interval_seconds = Number(req.body.auto_reconnect_interval_seconds || 30);
  saveConfig(config);
  restartSchedulers();
  res.redirect("/auto-sync");
});

app.post("/save-auto-sync", (req, res) => {
  const config = loadConfig();
  let targets = req.body.auto_sync_target_device_ids || [];
  if (!Array.isArray(targets)) targets = targets ? [targets] : [];
  config.auto_sync_enabled = req.body.auto_sync_enabled === "1";
  config.auto_sync_interval_minutes = Number(req.body.auto_sync_interval_minutes || 10);
  config.auto_sync_source_device_id = String(req.body.auto_sync_source_device_id || "");
  config.auto_sync_target_device_ids = targets;
  saveConfig(config);
  restartSchedulers();
  res.redirect("/auto-sync");
});


// =======================
// SHIFT SETTINGS / REPORT
// =======================
app.get("/shifts", (req, res) => {
  const shifts = loadShifts();
  const users = loadUsers();
  const userShiftMap = loadUserShifts();

  const shiftRows = shifts.map((s, i) => {
    const br = shiftBreakRange(s);
    const duration = shiftDurationMinutes(s);
    const overtimeAfter = Math.max(0, Number(s.overtime_after_minutes || 0));
    return `
      <tr>
        <td>${i+1}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.start_time)} - ${escapeHtml(s.end_time)}</td>
        <td>${escapeHtml(duration)} menit<br><span class="small">Lembur setelah +${escapeHtml(overtimeAfter)} menit dari jam pulang</span></td>
        <td>${escapeHtml(br.break_start)} - ${escapeHtml(br.break_end)} (${escapeHtml(s.break_minutes)} menit)</td>
        <td>${escapeHtml(s.late_tolerance_minutes)} menit</td>
        <td>${s.is_active !== false ? "Aktif" : "Nonaktif"}</td>
        <td>
          <a class="pill" href="/edit-shift?id=${encodeURIComponent(s.id)}">Edit</a>
          <a class="pill" style="background:#fee2e2;color:#991b1b;" href="/delete-shift?id=${encodeURIComponent(s.id)}" onclick="return confirm('Hapus shift ini?')">Hapus</a>
        </td>
      </tr>`;
  }).join("");

  const userRows = users.map((u, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${escapeHtml(u.user_id)}</td>
      <td>${escapeHtml(u.name)}</td>
      <td>
        <form method="POST" action="/save-user-shift">
          <input type="hidden" name="user_id" value="${escapeHtml(u.user_id)}">
          <select name="shift_id">
            <option value="">Auto Deteksi</option>
            ${shifts.map(s => `<option value="${escapeHtml(s.id)}" ${userShiftMap[String(u.user_id)] === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
          </select>
          <button class="mini blue" type="submit">Simpan</button>
        </form>
      </td>
    </tr>`).join("");

  res.send(htmlPage("Shift Kerja", `
    <h1>Setting Shift Kerja</h1>
    <div class="msg">
      Atur jam masuk, istirahat, dan pulang dalam bentuk rentang shift. Staff tetap wajib pilih status di mesin: Masuk, Pulang, Istirahat Keluar, Istirahat Masuk.
    </div>

    <div class="grid">
      <div class="card">
        <h3>Tambah Shift</h3>
        <form method="POST" action="/save-shift">
          <label>Nama Shift</label>
          <input name="name" placeholder="Shift 1" required>
          <label>Jam Masuk</label>
          <input name="start_time" type="time" value="05:00" required>
          <label>Jam Pulang</label>
          <input name="end_time" type="time" value="15:00" required>
          <label>Durasi Istirahat (menit)</label>
          <input name="break_minutes" value="60" required>
          <label>Toleransi Telat (menit)</label>
          <input name="late_tolerance_minutes" value="5" required>
          <label>Ambang Lembur Setelah Jam Pulang (menit)</label>
          <input name="overtime_after_minutes" value="30" required>
          <label><input type="checkbox" name="is_active" value="1" checked style="width:auto;"> Aktif</label>
          <button class="blue" type="submit">Simpan Shift</button>
        </form>
      </div>

      <div class="card">
        <h3>Aturan Hitung</h3>
        <pre>Shift 1: 05:00 - 15:00
Shift 2: 14:00 - 22:00
Shift 3: 21:00 - 04:00

Istirahat default 1 jam, otomatis di tengah shift.
Toleransi telat default 5 menit.
Lembur dihitung dari log pulang nyata mesin
setelah melewati ambang lembur.</pre>
      </div>
    </div>

    <h3 style="margin-top:18px;">Daftar Shift</h3>
    <div class="table-scroll">
      <table>
        <tr><th>No</th><th>Nama</th><th>Masuk - Pulang</th><th>Durasi & Lembur</th><th>Istirahat</th><th>Toleransi</th><th>Status</th><th>Aksi</th></tr>
        ${shiftRows || '<tr><td colspan="8">Belum ada shift.</td></tr>'}
      </table>
    </div>

    <h3 style="margin-top:18px;">Mapping User ke Shift</h3>
    <div class="table-scroll">
      <table>
        <tr><th>No</th><th>User ID</th><th>Nama</th><th>Shift</th></tr>
        ${userRows || '<tr><td colspan="4">Belum ada user lokal.</td></tr>'}
      </table>
    </div>
  `));
});

app.post("/save-shift", (req, res) => {
  const shifts = loadShifts();
  const id = String(req.body.id || "").trim() || makeId("shift");
  const existing = shifts.find(s => s.id === id);
  const data = {
    id,
    name: String(req.body.name || "").trim(),
    start_time: String(req.body.start_time || "00:00").trim(),
    end_time: String(req.body.end_time || "00:00").trim(),
    break_minutes: Number(req.body.break_minutes || 60),
    late_tolerance_minutes: Number(req.body.late_tolerance_minutes || 5),
    overtime_after_minutes: Math.max(0, Number(req.body.overtime_after_minutes || 0)),
    is_active: req.body.is_active === "1"
  };
  if (existing) Object.assign(existing, data);
  else shifts.push(data);
  saveShifts(shifts);
  res.redirect("/shifts");
});

app.get("/edit-shift", (req, res) => {
  const shifts = loadShifts();
  const s = shifts.find(x => x.id === req.query.id);
  if (!s) return res.send(htmlPage("Shift tidak ada", `<h3>Shift tidak ditemukan</h3><a href="/shifts">Kembali</a>`));
  res.send(htmlPage("Edit Shift", `
    <h1>Edit Shift</h1>
    <form method="POST" action="/save-shift">
      <input type="hidden" name="id" value="${escapeHtml(s.id)}">
      <label>Nama Shift</label><input name="name" value="${escapeHtml(s.name)}" required>
      <label>Jam Masuk</label><input name="start_time" type="time" value="${escapeHtml(s.start_time)}" required>
      <label>Jam Pulang</label><input name="end_time" type="time" value="${escapeHtml(s.end_time)}" required>
      <label>Durasi Istirahat (menit)</label><input name="break_minutes" value="${escapeHtml(s.break_minutes)}" required>
      <label>Toleransi Telat (menit)</label><input name="late_tolerance_minutes" value="${escapeHtml(s.late_tolerance_minutes)}" required>
      <label>Ambang Lembur Setelah Jam Pulang (menit)</label><input name="overtime_after_minutes" value="${escapeHtml(s.overtime_after_minutes || 0)}" required>
      <label><input type="checkbox" name="is_active" value="1" ${s.is_active !== false ? "checked" : ""} style="width:auto;"> Aktif</label>
      <button class="blue" type="submit">Simpan</button>
    </form>
    <a href="/shifts">Kembali</a>
  `));
});

app.get("/delete-shift", (req, res) => {
  const shifts = loadShifts().filter(s => s.id !== req.query.id);
  saveShifts(shifts);
  res.redirect("/shifts");
});

app.post("/save-user-shift", (req, res) => {
  const map = loadUserShifts();
  const userId = String(req.body.user_id || "").trim();
  const shiftId = String(req.body.shift_id || "").trim();
  if (userId) {
    if (shiftId) map[userId] = shiftId;
    else delete map[userId];
  }
  saveUserShifts(map);
  res.redirect("/shifts");
});


async function getUsersForReportDropdown(filterDevice = "") {
  const userMap = new Map();
  const selectedIds = filterDevice ? userIdsForDeviceFromAttendance(filterDevice) : null;

  function allowUser(id) {
    if (!filterDevice) return true;
    if (!selectedIds || selectedIds.size === 0) return true;
    return selectedIds.has(String(id));
  }

  for (const r of loadAttendance()) {
    if (filterDevice && !sameDeviceForAttendance(r, filterDevice)) continue;
    if (r && r.user_id) {
      const id = String(r.user_id);
      userMap.set(id, resolveUserName(id, r.device_sn) || "");
    }
  }

  if (filterDevice) {
    const device = getDeviceByFilterValue(filterDevice);
    if (device) {
      let conn = null;
      try {
        conn = await connectDevice(device);
        const users = await getUsersFromDevice(conn);
        updateUserNameCacheFromUsers(users, device);
        for (const u of users) {
          if (u && u.user_id) userMap.set(String(u.user_id), u.name || resolveUserName(u.user_id, device.sn) || "");
        }
        await closeDevice(conn);
      } catch (err) {
        await closeDevice(conn);
      }
    }
  }

  for (const u of loadUsers()) {
    if (u && u.user_id && allowUser(u.user_id) && !userMap.has(String(u.user_id))) userMap.set(String(u.user_id), u.name || "");
  }

  const cache = loadUserNameCache();
  for (const [key, name] of Object.entries(cache)) {
    const parts = key.split(":");
    const userId = parts.pop();
    const snInKey = parts.length ? parts.join(":") : "";
    if (filterDevice && snInKey && snInKey !== filterDevice) continue;
    if (userId && allowUser(userId) && !userMap.has(String(userId))) userMap.set(String(userId), name || "");
  }

  return Array.from(userMap.entries())
    .map(([user_id, name]) => ({ user_id, name }))
    .sort((a,b) => String(a.user_id).localeCompare(String(b.user_id), undefined, { numeric:true }));
}

app.get("/attendance-report", async (req, res) => {
  const currentUserObj = req.currentUser;
  const config = filteredConfigForRequest(req);
  const shifts = loadShifts();
  const filters = {
    start_date: normalizeDateInput(req.query.start_date || new Date().toISOString().slice(0,10)),
    end_date: normalizeDateInput(req.query.end_date || new Date().toISOString().slice(0,10)),
    user_id: req.query.user_id || "",
    device_sn: req.query.device_sn || "",
    shift_id: req.query.shift_id || "",
    status: req.query.status || ""
  };
  const users = await getUsersForReportDropdown(filters.device_sn);
  let reports = buildAttendanceReport(filters);
  if (!isAdminUser(currentUserObj)) { const allowedKeys = new Set(config.devices.flatMap(d => [String(d.id), String(d.sn), String(d.name)]).filter(Boolean)); reports = reports.filter(r => allowedKeys.has(String(r.device_sn)) || allowedKeys.has(String(r.device_name))); }
  const selectedReportDevice = getDeviceByFilterValue(filters.device_sn);
  const reportTitle = selectedReportDevice
    ? `Laporan Absensi - ${selectedReportDevice.name}${selectedReportDevice.location ? " - " + selectedReportDevice.location : ""}`
    : "Laporan Absensi Semua Mesin";

  const rows = reports.map((r, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${escapeHtml(r.date_work)}</td>
      <td>${escapeHtml(r.user_id)}</td>
      <td>${escapeHtml(r.user_name)}</td>
      <td>${escapeHtml(r.device_name)}</td>
      <td>${escapeHtml(r.device_sn || "-")}</td>
      <td>${escapeHtml(r.shift_name)}<br><span class="small">${escapeHtml(r.shift_start)} - ${escapeHtml(r.shift_end)}</span></td>
      <td>${escapeHtml(formatTimeOnly(r.check_in))}</td>
      <td>${escapeHtml(formatTimeOnly(r.break_out))} / ${escapeHtml(formatTimeOnly(r.break_in))}</td>
      <td>${escapeHtml(formatTimeOnly(r.check_out))}</td>
      <td>${escapeHtml(r.status)}<br><span class="small">${escapeHtml(r.real_note || "")}</span></td>
      <td>${escapeHtml(r.late_minutes)}</td>
      <td>${escapeHtml(r.early_leave_minutes)}</td>
      <td>${escapeHtml(r.overtime_minutes || 0)}</td>
    </tr>`).join("");

  res.send(htmlPage("Laporan Absensi", `
    <h1>${escapeHtml(reportTitle)}</h1>
    <div class="msg warn">
      Mode real mesin aktif: untuk setiap user per tanggal, timestamp paling awal dari mesin dihitung sebagai <b>Jam Masuk</b>, dan timestamp paling akhir yang berbeda dihitung sebagai <b>Jam Pulang</b>. Kalau hanya ada 1 log, jam pulang dikosongkan.
    </div>
    <div class="card">
      <form method="GET" action="/attendance-report">
        <div class="grid3">
          <div><label>Tanggal Awal</label><input type="date" name="start_date" value="${escapeHtml(filters.start_date)}"></div>
          <div><label>Tanggal Akhir</label><input type="date" name="end_date" value="${escapeHtml(filters.end_date)}"></div>
          <div><label>Status</label>
            <select name="status">
              <option value="">Semua</option>
              ${["Hadir","Terlambat","Pulang Dulu","Lembur","Tidak Absen Pulang","Tidak Hadir"].map(s => `<option value="${s}" ${filters.status === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="grid3">
          <div><label>User</label>
            <select name="user_id">
              <option value="">Semua User</option>
              ${users.map(u => `<option value="${escapeHtml(u.user_id)}" ${filters.user_id === String(u.user_id) ? "selected" : ""}>${escapeHtml(u.user_id)}${u.name ? " - " + escapeHtml(u.name) : ""}</option>`).join("")}
            </select>
            <p class="small">User diambil dari database lokal dan log absensi yang sudah tertarik.</p>
          </div>
          <div><label>Mesin</label>
            <select name="device_sn">
              <option value="">Semua Mesin</option>
              ${config.devices.map(d => {
                const val = getDeviceFilterValue(d);
                return `<option value="${escapeHtml(val)}" ${filters.device_sn === String(val) ? "selected" : ""}>${escapeHtml(d.name)} - SN:${escapeHtml(d.sn || "-")}</option>`;
              }).join("")}
            </select>
          </div>
          <div><label>Shift</label>
            <select name="shift_id">
              <option value="">Semua Shift</option>
              ${shifts.map(s => `<option value="${escapeHtml(s.id)}" ${filters.shift_id === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
            </select>
          </div>
        </div>
        <button class="blue" type="submit">Tampilkan Laporan</button>
      </form>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <a class="pill icon-button" href="/attendance-report.xls?${new URLSearchParams(filters).toString()}">${iconSvg("report")}<span>Export Excel</span></a>
        <a class="pill icon-button" href="/attendance-report.csv?${new URLSearchParams(filters).toString()}">${iconSvg("database")}<span>Export CSV</span></a>
        <a class="pill icon-button" href="javascript:window.print()">${iconSvg("print")}<span>Print</span></a>
        <a class="pill icon-button" href="/attendance-raw-debug?device_sn=${encodeURIComponent(filters.device_sn)}&user_id=${encodeURIComponent(filters.user_id)}&date=${encodeURIComponent(filters.start_date)}">${iconSvg("test")}<span>Debug Raw</span></a>
      </div>
    </div>

    <div class="grid3" style="margin-top:16px;">
      <div class="stat">Total Baris <b>${reports.length}</b></div>
      <div class="stat">Terlambat <b>${reports.filter(r => r.status.includes("Terlambat")).length}</b></div>
      <div class="stat">Lembur <b>${reports.filter(r => Number(r.overtime_minutes || 0) > 0).length}</b></div>
    </div>

    <div class="table-scroll" style="margin-top:16px;">
      <table>
        <tr><th>No</th><th>Tanggal</th><th>User ID</th><th>Nama</th><th>Mesin</th><th>SN</th><th>Shift</th><th>Masuk</th><th>Istirahat</th><th>Pulang</th><th>Status</th><th>Telat</th><th>Pulang Dulu</th><th>Lembur</th></tr>
        ${rows || '<tr><td colspan="14">Tidak ada data. Pastikan sudah klik Tarik Absensi, tanggal sesuai, dan user/mesin tidak terlalu difilter.</td></tr>'}
      </table>
    </div>
  `));
});

app.get("/laporan-absensi", (req, res) => {
  const qs = new URLSearchParams(req.query || {}).toString();
  res.redirect(`/attendance-report${qs ? "?" + qs : ""}`);
});

app.get("/attendance-report.csv", (req, res) => {
  const reports = buildAttendanceReport(req.query);
  const header = ["Tanggal","User ID","Nama","Mesin","SN","Shift","Masuk","Istirahat Keluar","Istirahat Masuk","Pulang","Status","Telat Menit","Pulang Dulu Menit","Lembur Menit"];
  const csv = [header, ...reports.map(r => [r.date_work,r.user_id,r.user_name,r.device_name,r.device_sn,r.shift_name,formatTimeOnly(r.check_in),formatTimeOnly(r.break_out),formatTimeOnly(r.break_in),formatTimeOnly(r.check_out),r.status,r.late_minutes,r.early_leave_minutes,r.overtime_minutes || 0])]
    .map(row => row.map(csvEscape).join(",")).join("\\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=attendance-shift-report.csv");
  res.send(csv);
});

app.get("/attendance-report.xls", (req, res) => {
  const reports = buildAttendanceReport(req.query);
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table border="1">
    <tr><th>Tanggal</th><th>User ID</th><th>Nama</th><th>Mesin</th><th>SN</th><th>Shift</th><th>Masuk</th><th>Istirahat Keluar</th><th>Istirahat Masuk</th><th>Pulang</th><th>Status</th><th>Telat Menit</th><th>Pulang Dulu Menit</th><th>Lembur Menit</th></tr>
    ${reports.map(r => `<tr><td>${escapeHtml(r.date_work)}</td><td>${escapeHtml(r.user_id)}</td><td>${escapeHtml(r.user_name)}</td><td>${escapeHtml(r.device_name)}</td><td>${escapeHtml(r.device_sn)}</td><td>${escapeHtml(r.shift_name)}</td><td>${escapeHtml(formatTimeOnly(r.check_in))}</td><td>${escapeHtml(formatTimeOnly(r.break_out))}</td><td>${escapeHtml(formatTimeOnly(r.break_in))}</td><td>${escapeHtml(formatTimeOnly(r.check_out))}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.late_minutes)}</td><td>${escapeHtml(r.early_leave_minutes)}</td><td>${escapeHtml(r.overtime_minutes || 0)}</td></tr>`).join("")}
  </table></body></html>`;
  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=attendance-shift-report.xls");
  res.send(html);
});



// =======================
// BACKUP & RESTORE ROUTES
// =======================
app.get("/backup-restore", (req, res) => {
  const config = loadConfig();
  const history = loadBackupHistory();
  const templates = loadFingerprintTemplates();

  const historyRows = history.slice(0, 80).map((h, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${escapeHtml(h.created_at || "-")}</td>
      <td>${escapeHtml(h.type || "-")}</td>
      <td>${escapeHtml(h.machine_name || "-")}</td>
      <td>${escapeHtml(h.machine_sn || "-")}</td>
      <td>${escapeHtml(h.filename || "-")}</td>
      <td>${escapeHtml(h.size_bytes || "-")}</td>
      <td>
        ${h.filename ? `<a class="pill" href="/download-backup/${encodeURIComponent(h.filename)}">Download</a>` : ""}
        ${h.inspect_id ? `<a class="pill" href="/backup-inspect?id=${encodeURIComponent(h.inspect_id)}">Lihat Inspect</a>` : ""}
      </td>
    </tr>`).join("");

  res.send(htmlPage("Backup & Restore", `
    <h1>Backup & Restore Mesin Fingerprint</h1>
    <div class="msg warn">
      Mode aman: backup user/attendance ke JSON dan inspect file DAT. Restore fingerprint dari DAT hanya ditulis jika template binary sudah bisa diparse valid.
      <br><b>Lokasi default backup:</b> <code>${escapeHtml(BACKUP_DIR)}</code>
    </div>

    <div class="grid">
      <div class="card">
        <h3>1. Backup Mesin ke File JSON</h3>
        <form method="POST" action="/backup-device-json">
          <label>Pilih Mesin Sumber</label>
          ${deviceSelect("device_id", config.devices)}
          <button class="blue" type="submit">Backup Mesin Sekarang</button>
        </form>
      </div>

      <div class="card">
        <h3>2. Upload Backup DAT dari Mesin Lama</h3>
        <form method="POST" action="/upload-dat-backup" enctype="multipart/form-data">
          <label>SN Mesin Lama / Sumber</label>
          <input name="machine_sn" placeholder="Isi SN mesin lama jika tahu">
          <label>Nama Mesin Lama</label>
          <input name="machine_name" placeholder="Contoh: Mesin Lama Kantor">
          <input type="file" name="datfile" accept=".dat,.DAT" required>
          <button class="orange" type="submit">Upload & Inspect DAT</button>
        </form>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;">
      <div class="card">
        <h3>3. Restore User dari Backup JSON</h3>
        <form method="POST" action="/restore-json-users">
          <label>File Backup JSON</label>
          <select name="filename" required>
            ${history.filter(h => h.type === "json-device-backup").map(h => `<option value="${escapeHtml(h.filename)}">${escapeHtml(h.filename)} - ${escapeHtml(h.machine_name || h.machine_sn || "")}</option>`).join("")}
          </select>
          <label>Mesin Target</label>
          ${deviceSelect("target_device_id", config.devices)}
          <button class="blue" type="submit">Restore User ke Mesin Target</button>
        </form>
        <p class="small">Restore ini mengirim user ID/nama/card. Fingerprint template butuh dukungan command template firmware/library.</p>
      </div>

      <div class="card">
        <h3>4. Status Fingerprint Template</h3>
        <div class="stat">Template Tersimpan <b>${templates.length}</b></div>
        <p class="small">Jika parser DAT berhasil mendeteksi template fingerprint valid, data akan muncul di sini.</p>
      </div>
    </div>

    <h3 style="margin-top:18px;">Riwayat Backup / Upload</h3>
    <div class="table-scroll">
      <table>
        <tr><th>No</th><th>Waktu</th><th>Tipe</th><th>Mesin</th><th>SN</th><th>File</th><th>Size</th><th>Aksi</th></tr>
        ${historyRows || '<tr><td colspan="8">Belum ada backup.</td></tr>'}
      </table>
    </div>
  `));
});

app.post("/backup-device-json", async (req, res) => {
  const deviceConfig = getDeviceById(req.body.device_id);
  if (!deviceConfig) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><a href="/backup-restore">Kembali</a>`));
  const bundle = await readDeviceBundle(deviceConfig);
  const file = createJsonBackupFile(deviceConfig, bundle);
  saveBackupRecord({
    id: makeId("backup"), type: "json-device-backup", created_at: new Date().toISOString(),
    machine_name: deviceConfig.name, machine_sn: deviceConfig.sn || "", filename: file.filename,
    size_bytes: file.size_bytes, sha256: file.sha256, ok: bundle.ok, error: bundle.error || ""
  });
  res.send(htmlPage("Backup Mesin", `
    <h3>Backup selesai</h3>
    <p>Mesin: <b>${escapeHtml(deviceConfig.name)}</b> SN:${escapeHtml(deviceConfig.sn || "-")}</p>
    <p>File: <b>${escapeHtml(file.filename)}</b></p>
    <p>Status baca mesin: <b>${bundle.ok ? "OK" : "GAGAL"}</b></p>
    ${bundle.error ? `<pre>${escapeHtml(bundle.error)}</pre>` : ""}
    <a href="/download-backup/${encodeURIComponent(file.filename)}">Download Backup</a><br>
    <a href="/backup-restore">Kembali</a>
  `));
});

app.post("/upload-dat-backup", upload.single("datfile"), (req, res) => {
  if (!req.file) return res.redirect("/backup-restore");
  const original = req.file.originalname || "backup.dat";
  const safeName = `dat-${Date.now()}-${original.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
  const dest = path.join(BACKUP_DIR, safeName);
  fs.copyFileSync(req.file.path, dest);
  fs.unlinkSync(req.file.path);
  const inspect = inspectDatFile(dest);
  const inspectId = makeId("inspect");
  fs.writeFileSync(path.join(BACKUP_DIR, `${inspectId}.json`), JSON.stringify(inspect, null, 2));
  saveBackupRecord({
    id: makeId("backup"), inspect_id: inspectId, type: "dat-upload", created_at: new Date().toISOString(),
    machine_name: String(req.body.machine_name || "").trim(), machine_sn: String(req.body.machine_sn || "").trim(),
    filename: safeName, inspect_filename: `${inspectId}.json`, size_bytes: inspect.size_bytes,
    sha256: inspect.sha256, likely_zk_format: inspect.likely_zk_format
  });
  res.redirect(`/backup-inspect?id=${encodeURIComponent(inspectId)}`);
});

app.get("/backup-inspect", (req, res) => {
  const id = String(req.query.id || "").trim();
  const file = path.join(BACKUP_DIR, `${id}.json`);
  if (!id || !fs.existsSync(file)) return res.send(htmlPage("Inspect tidak ada", `<h3>Inspect tidak ditemukan</h3><a href="/backup-restore">Kembali</a>`));
  const inspect = loadJson(file, {});
  res.send(htmlPage("Inspect DAT", `
    <h1>Inspect Backup DAT</h1>
    <div class="grid3">
      <div class="stat">Ukuran <b>${escapeHtml(inspect.size_bytes || 0)}</b></div>
      <div class="stat">ZK Format <b>${inspect.likely_zk_format ? "YA" : "BELUM PASTI"}</b></div>
      <div class="stat">String <b>${escapeHtml(inspect.ascii_strings_count || 0)}</b></div>
    </div>
    <div class="card" style="margin-top:16px;"><h3>Kesimpulan Aman</h3><pre>${escapeHtml(inspect.note || "")}</pre><p><b>SHA256:</b> ${escapeHtml(inspect.sha256 || "")}</p></div>
    <div class="grid" style="margin-top:16px;">
      <div class="card"><h3>Header HEX</h3><pre>${escapeHtml(inspect.header_hex || "")}</pre></div>
      <div class="card"><h3>Hint Template/User</h3><pre>${escapeHtml((inspect.template_hints || []).join("\\n") || "-")}</pre></div>
    </div>
    <div class="card" style="margin-top:16px;"><h3>String Preview</h3><pre>${escapeHtml((inspect.strings_preview || []).join("\\n"))}</pre></div>
    <div class="card" style="margin-top:16px;"><h3>Raw Preview</h3><pre>${escapeHtml(inspect.raw_preview || "")}</pre></div>
    <a href="/backup-restore">Kembali</a>
  `));
});

app.post("/restore-json-users", async (req, res) => {
  const filename = String(req.body.filename || "").trim();
  const target = getDeviceById(req.body.target_device_id);
  if (!filename || !target) return res.send(htmlPage("Data kurang", `<h3>File/target tidak valid</h3><a href="/backup-restore">Kembali</a>`));
  const filePath = path.join(BACKUP_DIR, path.basename(filename));
  if (!fs.existsSync(filePath)) return res.send(htmlPage("File tidak ada", `<h3>File backup tidak ditemukan</h3><a href="/backup-restore">Kembali</a>`));
  const result = await restoreUsersToDeviceFromJsonBackup(filePath, target);
  res.send(htmlPage("Restore User", `
    <h3>Restore User Selesai</h3>
    <p>Target: <b>${escapeHtml(target.name)}</b> SN:${escapeHtml(target.sn || "-")}</p>
    <p>Status: <b>${result.ok ? "OK" : "GAGAL"}</b></p>
    ${result.error ? `<pre>${escapeHtml(result.error)}</pre>` : ""}
    <p>Berhasil: ${result.sent.length}</p><p>Gagal: ${result.failed.length}</p>
    <h4>Berhasil</h4><pre>${escapeHtml(result.sent.join("\\n") || "-")}</pre>
    <h4>Gagal</h4><pre>${escapeHtml(result.failed.join("\\n") || "-")}</pre>
    <a href="/backup-restore">Kembali</a>
  `));
});

app.get("/download-backup/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const file = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(file)) return res.status(404).send("File tidak ditemukan");
  res.download(file);
});




app.get("/attendance-raw-debug", (req, res) => {
  const device = String(req.query.device_sn || "").trim();
  const user = String(req.query.user_id || "").trim();
  const date = normalizeDateInput(req.query.date || new Date().toISOString().slice(0,10));
  const rows = loadAttendance()
    .filter(r => !device || sameDeviceForAttendance(r, device))
    .filter(r => !user || String(r.user_id) === user)
    .filter(r => !date || String(r.time || "").slice(0,10) === date)
    .sort((a,b) => String(a.time).localeCompare(String(b.time)));

  res.send(htmlPage("Debug Raw Attendance", `
    <h1>Debug Raw Attendance</h1>
    <form method="GET" action="/attendance-raw-debug" class="card">
      <label>Device SN / ID / Nama</label><input name="device_sn" value="${escapeHtml(device)}">
      <label>User ID</label><input name="user_id" value="${escapeHtml(user)}">
      <label>Tanggal</label><input name="date" value="${escapeHtml(date)}">
      <button class="blue" type="submit">Tampilkan Raw Log</button>
    </form>
    <p>Total: <b>${rows.length}</b></p>
    <div class="table-scroll">
      <table>
        <tr><th>No</th><th>Time</th><th>User</th><th>Device</th><th>State Terbaca</th><th>Raw</th></tr>
        ${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.user_id)}</td><td>${escapeHtml(r.device_name)}<br>${escapeHtml(r.device_sn)}</td><td>${escapeHtml(getMachineLogState(r) || "(kosong)")}</td><td><pre>${escapeHtml(safeJson(r.raw || r))}</pre></td></tr>`).join("") || '<tr><td colspan="6">Tidak ada data.</td></tr>'}
      </table>
    </div>
  `));
});



app.use(createAppUserRoutes({
  loadAppUsers,
  saveAppUsers,
  loadUsers,
  loadConfig,
  htmlPage,
  escapeHtml,
  uniqStrings,
  makeId,
  sha256Text
}));

app.get("/advanced",(req,res)=>{res.send(htmlPage("Advanced",`<h1>Advanced</h1><div class="grid"><div class="card"><h3>Remote Enroll</h3><p>Fitur advanced, tergantung firmware/SDK.</p><a class="pill" href="/remote-enroll-center">Buka</a></div><div class="card"><h3>Adapter Merk</h3><p>Konfigurasi multi merk.</p><a class="pill" href="/machine-adapters">Buka</a></div><div class="card"><h3>Debug Raw Attendance</h3><p>Cek data mentah.</p><a class="pill" href="/attendance-raw-debug">Buka</a></div><div class="card"><h3>Panduan Online</h3><p>No-IP, router, Tailscale.</p><a class="pill" href="/online-access-guide">Buka</a></div></div>`));});



async function autoPrintAttendanceSummary(deviceConfig, count) {
  const printer = loadPrinterSettings();
  if (!printer.enabled || !printer.server_side_print || !printer.auto_print_attendance) {
    return { skipped:true, reason:"Printer tidak aktif/server_side_print/auto_print_attendance off" };
  }
  const appSettings = loadAppSettings();
  const text = [
    printer.print_header || "Tarik Absensi",
    appSettings.company_name || appSettings.app_name || "CSL Fingerprint",
    "================================",
    `Mesin: ${deviceConfig ? deviceConfig.name : "-"}`,
    `SN: ${deviceConfig ? (deviceConfig.sn || "-") : "-"}`,
    `Jumlah log baru/terbaca: ${count}`,
    `Waktu: ${new Date().toISOString()}`,
    "================================",
    printer.print_footer || ""
  ].join("\\n");
  return await serverPrintText(text, printer.printer_name || "");
}

app.get("/settings-printer", async (req, res) => {
  const config = loadConfig();
  const appSettings = loadAppSettings();
  const printer = loadPrinterSettings();
  const detected = req.query.detect === "1" ? await detectWindowsPrinters() : null;
  const timezoneOptions = getTimeZoneOptions();
  const detectedOptions = detected && detected.printers.length
    ? detected.printers.map(p => `<option value="${escapeHtml(p)}" ${printer.printer_name === p ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")
    : "";
  const detectedPrinterButtons = detected && detected.ok && detected.printers.length
    ? `<div class="rowbtn" style="margin-top:8px;">${detected.printers.map(p => `<button class="gray" type="button" data-printer-name="${escapeHtml(p)}" onclick="document.querySelector('[name=printer_name]').value=this.getAttribute('data-printer-name')">${escapeHtml(p)}</button>`).join("")}</div>`
    : "";

  res.send(htmlPage("Pengaturan & Printer", `
    <h1>Pengaturan Aplikasi & Printer</h1>
    <div class="msg">
      <b>Public Base URL</b> boleh dikosongkan jika aplikasi belum online. Isi nanti jika sudah punya domain, No-IP, IP publik, atau Tailscale.
    </div>

    ${renderServerUrlCard(req, config, appSettings)}

    <form method="POST" action="/save-settings-printer">
      <div class="grid">
        <div class="card">
          <h3>Pengaturan Aplikasi</h3>
          <label>Nama Aplikasi</label>
          <input name="app_name" value="${escapeHtml(appSettings.app_name || "")}">

          <label>Nama Perusahaan / Client</label>
          <input name="company_name" value="${escapeHtml(appSettings.company_name || "")}">

          <label>Timezone</label>
          <select name="timezone">
            ${timezoneOptions.map(tz => `<option value="${escapeHtml(tz)}" ${appSettings.timezone === tz ? "selected" : ""}>${escapeHtml(tz)}</option>`).join("")}
          </select>

          <label>Format Tanggal</label>
          <select name="date_format">
            ${["YYYY-MM-DD","DD/MM/YYYY","DD-MM-YYYY"].map(v => `<option value="${v}" ${appSettings.date_format === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>

          <label>Format Jam</label>
          <select name="time_format">
            ${["HH:mm","HH:mm:ss"].map(v => `<option value="${v}" ${appSettings.time_format === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>

          <label>Mode Online</label>
          <select name="online_mode">
            ${[
              ["local_or_vpn","Local / VPN / Tailscale"],
              ["public_ddns","Public DDNS / No-IP"],
              ["public_static_ip","Public Static IP"],
              ["reverse_proxy","Domain + Reverse Proxy HTTPS"]
            ].map(([v,t]) => `<option value="${v}" ${appSettings.online_mode === v ? "selected" : ""}>${t}</option>`).join("")}
          </select>

          <label>IP PC Server / LAN</label>
          <input name="computer_ip" value="${escapeHtml(config.computer_ip || "")}" placeholder="Contoh: 192.168.1.10">

          <label>Port Aplikasi</label>
          <input name="local_server_port" value="${escapeHtml(PORT)}" readonly>

          <label>Public Base URL</label>
          <input name="public_base_url" value="${escapeHtml(appSettings.public_base_url || "")}" placeholder="Kosongkan dulu, atau isi http://namamu.ddns.net:8080">

          <label>Masa Session Login (hari)</label>
          <input name="session_days" type="number" min="1" value="${escapeHtml(appSettings.session_days || 7)}">
        </div>

        <div class="card">
          <h3>Pengaturan Printer</h3>
          <label>
            <input type="checkbox" name="printer_enabled" value="1" ${printer.enabled ? "checked" : ""} style="width:auto;margin-right:8px;">
            Aktifkan Printer
          </label>

          <label>Tipe Printer</label>
          <select name="printer_type">
            ${[
              ["inkjet","Ink Tank / Inkjet / Laser biasa"],
              ["thermal58","Thermal 58mm"],
              ["thermal80","Thermal 80mm"],
              ["dotmatrix","Dot Matrix"]
            ].map(([v,t]) => `<option value="${v}" ${printer.printer_type === v ? "selected" : ""}>${t}</option>`).join("")}
          </select>

          <label>Nama Printer Server / Windows</label>
          <input name="printer_name" list="printer-list" value="${escapeHtml(printer.printer_name || "")}" placeholder="Klik Detect Printer Server lalu pilih nama printer">
          <datalist id="printer-list">${detectedOptions}</datalist>

          <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px;">
            <a class="pill" href="/settings-printer?detect=1">Detect Printer Server</a>
            <a class="pill" href="/server-print-test">Test Server Print</a>
            <a class="pill" href="/print-test">Preview Print Browser</a>
          </div>

          ${detected ? `
            <div class="${detected.ok ? "msg" : "msg warn"}">
              <b>Hasil Detect Printer Server:</b><br>
              Platform server: <b>${escapeHtml(detected.platform_label || detected.platform || "-")}</b>${detected.method ? `, method: <b>${escapeHtml(detected.method)}</b>` : ""}<br>
              ${detected.ok ? (detected.printers.length ? detected.printers.map(p => `• ${escapeHtml(p)}`).join("<br>") : "Tidak ada printer terdeteksi di PC server.") : escapeHtml(detected.error).replace(/\n/g, "<br>")}
              ${detected.platform !== "win32" ? `<p class="small"><b>Catatan:</b> Detect Printer membaca printer di PC server tempat aplikasi Node berjalan. Untuk membaca printer Windows, jalankan aplikasi ini di PC Windows server atau install/share printer Windows itu ke server.</p>` : ""}
              ${detectedPrinterButtons}
            </div>
          ` : ""}

          <label>Ukuran Kertas</label>
          <select name="paper_size">
            ${["A4","A5","58mm","80mm"].map(v => `<option value="${v}" ${printer.paper_size === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>

          <label>Orientasi</label>
          <select name="orientation">
            ${["portrait","landscape"].map(v => `<option value="${v}" ${printer.orientation === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>

          <label>Jumlah Copy</label>
          <input name="copies" type="number" min="1" value="${escapeHtml(printer.copies || 1)}">

          <label>Lebar Receipt Thermal (mm)</label>
          <input name="receipt_width_mm" type="number" min="40" value="${escapeHtml(printer.receipt_width_mm || 58)}">

          <label>
            <input type="checkbox" name="server_side_print" value="1" ${printer.server_side_print ? "checked" : ""} style="width:auto;margin-right:8px;">
            Pakai Server-side Print Windows
          </label>

          <label>
            <input type="checkbox" name="auto_print_attendance" value="1" ${printer.auto_print_attendance ? "checked" : ""} style="width:auto;margin-right:8px;">
            Auto print setelah tarik absensi
          </label>

          <div class="msg warn">
            Auto print benar-benar jalan jika printer sudah terinstall di Windows server, nama printer benar, dan opsi Server-side Print aktif. Jika tidak, browser hanya bisa preview/print manual.
          </div>

          <label>Header Print</label>
          <input name="print_header" value="${escapeHtml(printer.print_header || "")}">

          <label>Footer Print</label>
          <textarea name="print_footer">${escapeHtml(printer.print_footer || "")}</textarea>
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <button class="blue" type="submit">Simpan Pengaturan</button>
      </div>
    </form>
  `));
});

app.post("/save-settings-printer", (req, res) => {
  const config = loadConfig();
  config.computer_ip = String(req.body.computer_ip || config.computer_ip || "").trim();
  config.local_server_port = PORT;
  saveConfig(config);

  saveAppSettings({
    app_name: String(req.body.app_name || "").trim(),
    company_name: String(req.body.company_name || "").trim(),
    timezone: String(req.body.timezone || "Asia/Jakarta").trim(),
    date_format: String(req.body.date_format || "YYYY-MM-DD").trim(),
    time_format: String(req.body.time_format || "HH:mm").trim(),
    online_mode: String(req.body.online_mode || "local_or_vpn").trim(),
    public_base_url: String(req.body.public_base_url || "").trim(),
    session_days: Number(req.body.session_days || 7)
  });

  savePrinterSettings({
    enabled: req.body.printer_enabled === "1",
    printer_type: String(req.body.printer_type || "inkjet").trim(),
    printer_name: String(req.body.printer_name || "").trim(),
    paper_size: String(req.body.paper_size || "A4").trim(),
    orientation: String(req.body.orientation || "portrait").trim(),
    copies: Number(req.body.copies || 1),
    receipt_width_mm: Number(req.body.receipt_width_mm || 58),
    server_side_print: req.body.server_side_print === "1",
    auto_print_attendance: req.body.auto_print_attendance === "1",
    print_header: String(req.body.print_header || "").trim(),
    print_footer: String(req.body.print_footer || "").trim()
  });

  res.redirect("/settings-printer");
});

app.get("/print-test", (req, res) => {
  const printer = loadPrinterSettings();
  const appSettings = loadAppSettings();
  res.send(htmlPage("Preview Print", `
    <h1>Preview Print</h1>
    <div class="print-preview">
      <h2>${escapeHtml(printer.print_header || "Laporan Absensi")}</h2>
      <p><b>${escapeHtml(appSettings.company_name || appSettings.app_name || "CSL Fingerprint")}</b></p>
      <hr>
      <p>Tanggal: ${escapeHtml(new Date().toISOString().slice(0,10))}</p>
      <p>Printer: ${escapeHtml(printer.printer_name || "-")}</p>
      <p>Kertas: ${escapeHtml(printer.paper_size)} / ${escapeHtml(printer.orientation)}</p>
      <table>
        <tr><th>User</th><th>Masuk</th><th>Pulang</th></tr>
        <tr><td>Contoh User</td><td>08:00</td><td>17:00</td></tr>
      </table>
      <hr>
      <p>${escapeHtml(printer.print_footer || "")}</p>
    </div>
    <button class="blue" onclick="window.print()">Print Browser</button>
    <a class="pill" href="/settings-printer">Kembali</a>
  `));
});



app.get("/server-print-test", async (req, res) => {
  const printer = loadPrinterSettings();
  const appSettings = loadAppSettings();

  if (!printer.enabled) {
    return res.send(htmlPage("Printer belum aktif", `
      <h1>Printer belum aktif</h1>
      <div class="msg warn">Aktifkan printer dulu di menu Pengaturan & Printer.</div>
      <a class="pill" href="/settings-printer">Kembali</a>
    `));
  }

  const text = [
    printer.print_header || "TEST PRINT",
    appSettings.company_name || appSettings.app_name || "CSL Fingerprint",
    "================================",
    "Test server-side print",
    `Waktu: ${new Date().toISOString()}`,
    `Printer: ${printer.printer_name || "(default)"}`,
    `Tipe: ${printer.printer_type || "-"}`,
    "================================",
    printer.print_footer || ""
  ].join("\\n");

  const result = await serverPrintText(text, printer.printer_name || "");

  res.send(htmlPage("Test Server Print", `
    <h1>Test Server Print</h1>
    <div class="${result.ok ? "msg" : "msg warn"}">
      ${result.ok ? "Perintah print sudah dikirim ke Windows." : "Gagal mengirim print ke Windows."}
    </div>
    <p>Printer: <b>${escapeHtml(printer.printer_name || "Default printer")}</b></p>
    <pre>${escapeHtml(safeJson(result))}</pre>
    <a class="pill" href="/settings-printer">Kembali</a>
  `));
});


app.get("/database-tools", (req, res) => {
  const dumps = fs.existsSync(DB_BACKUP_DIR) ? fs.readdirSync(DB_BACKUP_DIR).filter(f => f.endsWith(".sql")).sort().reverse() : [];
  res.send(htmlPage("Database Tools", `
    <h1>Database Tools</h1>
    <div class="msg">
      Data aplikasi saat ini tetap berjalan dari file JSON agar ringan. Menu ini membuat backup <b>.sql</b> berisi data mesin, user, absensi, shift, dan cache nama.
      File SQL bisa kamu import ke MySQL/phpMyAdmin/XAMPP, atau upload kembali ke aplikasi untuk restore JSON runtime. Pastikan yang di-import adalah hasil <b>Export Full Database SQL</b> atau <b>Export Data Mesin Saja</b>, bukan file schema kosong.
    </div>

    <div class="grid">
      <div class="card">
        <h3>Export Database SQL</h3>
        <p>Export semua data aplikasi ke file SQL relational dengan foreign key antar tabel.</p><p><a class="pill" href="/database-relational.sql">Download Relational SQL</a></p>
        <form method="POST" action="/export-full-database-sql">
          <button class="blue" type="submit">Export Full Database SQL</button>
        </form>
        <form method="POST" action="/export-devices-sql">
          <button class="gray" type="submit">Export Data Mesin Saja</button>
        </form>
        <p class="small">Folder default di dalam aplikasi: <b>database-backups</b><br><code>${escapeHtml(DB_BACKUP_DIR)}</code></p>
      </div>

      <div class="card">
        <h3>Import Database SQL</h3>
        <form method="POST" action="/import-full-database-sql" enctype="multipart/form-data" onsubmit="return confirm('Import SQL akan menimpa data mesin/user/attendance jika file berisi data tersebut. Lanjut?')">
          <input type="file" name="sqlfile" accept=".sql" required>
          <button class="orange" type="submit">Upload & Restore SQL</button>
        </form>
        <p class="small">Gunakan file SQL hasil export dari aplikasi ini.</p>
      </div>
    </div>

    <h3 style="margin-top:16px;">Riwayat SQL Backup</h3>
    <div class="table-scroll">
      <table>
        <tr><th>No</th><th>File</th><th>Aksi</th></tr>
        ${dumps.map((f,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(f)}</td><td><a class="pill" href="/download-db-backup/${encodeURIComponent(f)}">Download</a></td></tr>`).join("") || '<tr><td colspan="3">Belum ada backup SQL.</td></tr>'}
      </table>
    </div>
  `));
});


app.post("/export-devices-sql", (req, res) => {
  const config = loadConfig();
  let sql = "";
  sql += "-- CSL Fingerprint devices backup\n";
  sql += `-- Created at: ${new Date().toISOString()}\n\n`;
  sql += "CREATE DATABASE IF NOT EXISTS csl_fingerprint CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n";
  sql += "USE csl_fingerprint;\n\n";
  sql += `CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  sn VARCHAR(100),
  ip VARCHAR(80),
  tailscale_ip VARCHAR(80),
  port INTEGER DEFAULT 4370,
  location VARCHAR(150),
  brand VARCHAR(80),
  protocol VARCHAR(80),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);\n\n`;
  sql += "DELETE FROM devices;\n";
  for (const d of config.devices || []) {
    sql += `INSERT INTO devices (id,name,sn,ip,tailscale_ip,port,location,brand,protocol) VALUES (${sqlString(d.id)},${sqlString(d.name)},${sqlString(d.sn)},${sqlString(d.ip)},${sqlString(d.tailscale_ip)},${sqlNumber(d.port,4370)},${sqlString(d.location)},${sqlString(d.brand || "zkteco-compatible")},${sqlString(d.protocol || "zk-tcp")});\n`;
  }
  const filename = `csl-devices-backup-${Date.now()}.sql`;
  const filePath = path.join(DB_BACKUP_DIR, filename);
  fs.writeFileSync(filePath, sql, "utf8");
  res.send(htmlPage("Export Mesin SQL", `
    <h1>Export Mesin SQL Selesai</h1>
    <p>Jumlah mesin: <b>${config.devices.length}</b></p>
    <p>File: <b>${escapeHtml(filename)}</b></p>
    <a class="pill" href="/download-db-backup/${encodeURIComponent(filename)}">Download SQL</a>
    <a class="pill" href="/database-tools">Kembali</a>
  `));
});

app.post("/export-full-database-sql", (req, res) => {
  const sql = buildFullSqlDump();
  const filename = `csl-full-backup-${Date.now()}.sql`;
  const filePath = path.join(DB_BACKUP_DIR, filename);
  fs.writeFileSync(filePath, sql, "utf8");
  res.send(htmlPage("Export SQL", `
    <h1>Export SQL Selesai</h1>
    <p>File: <b>${escapeHtml(filename)}</b></p>
    <p>Lokasi: <code>${escapeHtml(filePath)}</code></p>
    <a class="pill" href="/download-db-backup/${encodeURIComponent(filename)}">Download SQL</a>
    <a class="pill" href="/database-tools">Kembali</a>
  `));
});

app.post("/import-full-database-sql", upload.single("sqlfile"), (req, res) => {
  if (!req.file) return res.redirect("/database-tools");
  const text = fs.readFileSync(req.file.path, "utf8");
  const result = applyImportedSqlText(text);
  fs.unlinkSync(req.file.path);
  restartSchedulers();
  res.send(htmlPage("Import SQL", `
    <h1>Import SQL Selesai</h1>
    <p>Devices: <b>${result.devices}</b></p>
    <p class="small">Imported: ${result.devices_imported || 0} | Tetap dari list mesin aplikasi: ${result.devices_kept_from_current_list || 0}</p>
    <p>Users: <b>${result.users}</b></p>
    <p>Attendance: <b>${result.attendance}</b></p>
    <p>Shifts: <b>${result.shifts || 0}</b></p>
    <p>Name Cache: <b>${result.cache}</b></p>
    ${(!result.devices && !result.users && !result.attendance) ? `
      <div class="msg warn">
        Data import masih 0 untuk user/attendance. Mesin yang sudah ada di list aplikasi tetap dipertahankan. Kemungkinan file SQL hanya berisi schema, bukan data INSERT. Klik Export Full Database SQL setelah data mesin/user/absensi sudah ada, lalu import file tersebut.
      </div>
      <h3>Debug SQL</h3>
      <pre>${escapeHtml(safeJson(result.debug))}</pre>
    ` : ""}
    <a class="pill" href="/">Dashboard</a>
    <a class="pill" href="/database-tools">Database Tools</a>
  `));
});

app.get("/download-db-backup/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const file = path.join(DB_BACKUP_DIR, filename);
  if (!fs.existsSync(file)) return res.status(404).send("File tidak ditemukan");
  res.download(file);
});


app.get("/online-access-guide", (req, res) => {
  const config = loadConfig();
  res.send(htmlPage("Akses Online", `
    <h1>Akses Website Online</h1>
    <div class="msg warn">
      Akses online bisa pakai <b>No-IP + port forwarding router Huawei</b>, tetapi lebih aman pakai <b>Tailscale / VPN</b>.
      Jika dibuka ke internet, aktifkan password/login sebelum public.
    </div>

    <div class="grid">
      <div class="card">
        <h3>Opsi A - No-IP + Huawei Port Forward</h3>
        <ol>
          <li>Buat akun di No-IP dan buat hostname, contoh <b>absenku.ddns.net</b>.</li>
          <li>Pasang No-IP DUC di komputer server, atau isi DDNS di router Huawei jika tersedia.</li>
          <li>Di router Huawei buka menu <b>NAT / Virtual Server / Port Mapping</b>.</li>
          <li>Forward port internet ke komputer server aplikasi.</li>
        </ol>
        <pre>WAN Port 8080 → IP Komputer ${escapeHtml(config.computer_ip || "192.168.x.x")}:8080
Protocol TCP</pre>
        <p>Setelah itu akses:</p>
        <pre>http://absenku.ddns.net:8080/</pre>
      </div>

      <div class="card">
        <h3>Opsi B - Tailscale / VPN</h3>
        <ol>
          <li>Install Tailscale di server atau router yang support.</li>
          <li>Login akun yang sama.</li>
          <li>Akses aplikasi lewat IP Tailscale server.</li>
          <li>Di menu Edit Mesin, isi <b>Tailscale IP</b> tiap cabang, lalu set <b>Prioritas Host = tailscale</b> atau <b>auto</b>.</li>
        </ol>
        <pre>http://100.x.x.x:8080/</pre>
        <p class="small">Ini lebih aman karena tidak membuka port publik ke internet.</p>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>Cek CGNAT Biznet / ISP</h3>
      <p>Port forwarding hanya jalan kalau WAN IP router sama dengan IP publik internet.</p>
      <ol>
        <li>Cek WAN IP di router Huawei.</li>
        <li>Buka website cek IP publik.</li>
        <li>Kalau beda, berarti CGNAT dan port forwarding tidak akan jalan.</li>
      </ol>
      <p>Jika CGNAT, minta <b>public IP/static IP</b> ke ISP atau pakai Tailscale.</p>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>Keamanan</h3>
      <ul>
        <li>Jangan public tanpa login/password.</li>
        <li>Lebih baik ganti port publik, contoh 18080 → 8080.</li>
        <li>Batasi IP sumber jika router mendukung.</li>
        <li>Gunakan Tailscale untuk produksi.</li>
      </ul>
    </div>
  `));
});


// =======================
// TAILSCALE GUIDE
// =======================
app.get("/tailscale-guide", (req, res) => {
  res.send(htmlPage("Setup Tailscale", `
    <h1>Setup Tailscale Step by Step</h1>
    <div class="msg">
      Untuk mesin beda lokasi yang IP lokalnya sama, contoh semua <b>192.168.18.200</b>, server pusat tidak bisa langsung membedakan lewat IP lokal.
      Solusinya: PC cabang dipasang Tailscale, lalu server pusat connect ke <b>IP Tailscale PC cabang</b>.
    </div>

    <div class="card">
      <h3>1. Install Tailscale di Server Pusat</h3>
      <p>Download Tailscale, login dengan akun yang sama.</p>
      <pre>https://tailscale.com/download</pre>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>2. Install Tailscale di PC Cabang</h3>
      <p>PC cabang harus satu jaringan lokal dengan mesin fingerprint.</p>
      <p>Login Tailscale dengan akun yang sama.</p>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>3. Cek IP Tailscale PC Cabang</h3>
      <pre>tailscale ip</pre>
      <p>Contoh hasil: <b>100.80.10.5</b></p>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>4. Forward Port dari PC Cabang ke Mesin Finger</h3>
      <p>Jalankan CMD sebagai Administrator di PC cabang.</p>
      <pre>netsh interface portproxy add v4tov4 listenport=4370 listenaddress=0.0.0.0 connectport=4370 connectaddress=192.168.18.200</pre>
      <p>Buka firewall port 4370 di PC cabang:</p>
      <pre>netsh advfirewall firewall add rule name="Finger 4370" dir=in action=allow protocol=TCP localport=4370</pre>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>5. Isi di Webserver Ini</h3>
      <p>Edit mesin cabang:</p>
      <pre>IP Lokal Mesin     : 192.168.18.200 (opsional)
Host Public/Domain : kosongkan jika tidak dipakai
Tailscale IP       : 100.80.10.5
Prioritas Host     : tailscale / auto
Port               : 4370
SN                 : isi serial number unik mesin</pre>
      <p>Jika ada cabang lain dengan IP lokal sama, Tailscale IP-nya tetap berbeda.</p>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>6. Test</h3>
      <p>Dari server pusat:</p>
      <pre>ping 100.80.10.5</pre>
      <p>Lalu di webserver klik <b>Cek Port</b> dan <b>Test</b>.</p>
    </div>
  `));
});

// =======================
// EXPORT
// =======================
function attendanceRowsForExport() {
  const rows = loadAttendance();
  const users = loadUsers();
  const userMap = new Map(users.map(u => [String(u.user_id), u.name]));
  return rows.map(r => ({
    time: r.time,
    device_name: r.device_name,
    device_sn: r.device_sn || "",
    user_id: r.user_id,
    name: resolveUserName(r.user_id, r.device_sn) || userMap.get(String(r.user_id)) || "",
    state: r.state || ""
  }));
}


app.get("/database-relational.sql", (req, res) => {
  const sql = buildFullSqlDump()
    .split("-- CSL Fingerprint Server relational database backup")[1] || buildFullSqlDump();
  res.setHeader("Content-Type", "application/sql; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=csl-relational-schema-and-data.sql");
  res.send(buildFullSqlDump());
});

app.get("/database.sql", (req, res) => { res.download(path.join(__dirname, "database.sql")); });

app.get("/export-attendance.csv", (req, res) => {
  const rows = attendanceRowsForExport();
  const header = ["Waktu","Mesin","SN","User ID","Nama","State"];
  const csv = [header, ...rows.map(r => [r.time, r.device_name, r.device_sn, r.user_id, r.name, r.state])]
    .map(row => row.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=attendance.csv");
  res.send(csv);
});

app.get("/export-attendance.xls", (req, res) => {
  const rows = attendanceRowsForExport();
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
    <table border="1">
      <tr><th>Waktu</th><th>Mesin</th><th>SN</th><th>User ID</th><th>Nama</th><th>State</th></tr>
      ${rows.map(r => `<tr><td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.device_name)}</td><td>${escapeHtml(r.device_sn)}</td><td>${escapeHtml(r.user_id)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.state)}</td></tr>`).join("")}
    </table>
  </body></html>`;

  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=attendance.xls");
  res.send(html);
});

// =======================
// ADMS AUTO DETECT BY SN
// =======================
app.all("/csl/login", (req, res) => {
  const config = loadConfig();
  const sn = String(req.query.sn || req.query.SN || req.body?.sn || req.body?.SN || "").trim();
  const remoteIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").replace("::ffff:", "");

  console.log("Mesin login ADMS:", { sn, remoteIp, query: req.query, body: req.body || "" });

  if (sn) {
    let existing = config.devices.find(d => String(d.sn || "") === sn);

    if (!existing) {
      const id = makeId("auto-sn");
      config.devices.push({
        id,
        name: `Mesin SN ${sn}`,
        ip: "",
        tailscale_ip: remoteIp || "",
        port: 4370,
        sn,
        location: "Auto ADMS"
      });
      saveConfig(config);
      broadcastEvent("device_auto_detect", { id, sn, remoteIp });
      console.log("Mesin baru dari ADMS ditambahkan:", sn, remoteIp);
    } else {
      // Auto mapping: update tailscale_ip/remote IP jika belum ada.
      if (!existing.tailscale_ip && remoteIp) existing.tailscale_ip = remoteIp;
      saveConfig(config);
    }
  }

  res.type("text/plain").send("OK");
});

// =======================
// API
// =======================
app.get("/api/device-users-live", async (req, res) => {
  const currentUserObj = req.currentUser || global.__cslCurrentUser || null;
  const deviceConfig = getDeviceById(req.query.device_id) || getDeviceBySn(req.query.sn);
  if (!deviceConfig) return res.json({ ok:false, error:"Mesin tidak ditemukan" });
  if (!canAccessDeviceRecord(currentUserObj, deviceConfig)) {
    return res.status(403).json({ ok:false, error:"Akses mesin ditolak" });
  }

  let device = null;
  try {
    device = await connectDevice(deviceConfig);
    const userRead = await getUsersFromDeviceRawAware(device);
    const users = userRead.users;
    await closeDevice(device);
    res.json({ ok:true, device_id: deviceConfig.id, device_sn: deviceConfig.sn || "", users, source: userRead.source, warning: userRead.warning });
  } catch (err) {
    await closeDevice(device);
    res.json({ ok:false, error:errorText(err), device_id: deviceConfig.id, device_sn: deviceConfig.sn || "" });
  }
});

app.get("/api/users", (req, res) => res.json(loadUsers()));
app.get("/api/devices", (req, res) => {
  const currentUserObj = req.currentUser || global.__cslCurrentUser || null;
  const config = loadConfig();
  const devices = filterDevicesByAccess(config.devices || [], currentUserObj);
  res.json(devices);
});
app.get("/api/attendance", (req, res) => {
  const currentUserObj = req.currentUser || global.__cslCurrentUser || null;
  const rows = loadAttendance().filter(r => canAccessAttendanceRow(currentUserObj, r));
  res.json(rows);
});
app.get("/api/status", (req, res) => res.json(loadStatus()));
app.get("/admin", (req, res) => res.redirect("/"));

// fallback mesin / request lain
app.use((req, res) => {
  console.log("Request lain:", req.method, req.originalUrl);
  res.status(200).type("text/plain").send("OK");
});



// V34 friendly error handler
app.use((err, req, res, next) => {
  console.error("APP ERROR:", err && err.stack ? err.stack : err);
  try {
    res.status(500).send(htmlPage("Server Error", `
      <h1>Server Error</h1>
      <pre>${escapeHtml(errorText(err))}</pre>
      <a class="pill" href="/">Dashboard</a>
      <a class="pill" href="/logout">Logout</a>
    `));
  } catch (_) {
    res.status(500).send("Server Error: " + (err && err.message ? err.message : err));
  }
});

// Friendly upload/body size error
app.use((err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.code === "LIMIT_FILE_SIZE")) {
    return res.status(413).send(htmlPage("File terlalu besar", `
      <h3>File terlalu besar</h3>
      <p>Upload DAT sekarang diset sampai 500MB. Jika masih muncul, cek ukuran file atau restart server setelah update.</p>
      <pre>${escapeHtml(errorText(err))}</pre>
      <a href="/backup-restore">Kembali ke Backup & Restore</a>
    `));
  }
  next(err);
});


// =======================
// START
// =======================
server.listen(PORT, "0.0.0.0", () => {
  const config = loadConfig();
  restartSchedulers();
  console.log("====================================");
  console.log("CSL Fingerprint Server FINAL FIXED jalan");
  console.log(`Buka admin lokal : http://localhost:${PORT}/`);
  console.log(`Buka admin LAN   : http://${config.computer_ip}:${PORT}/`);
  console.log(`Live Dashboard   : http://localhost:${PORT}/live`);
  console.log(`Dashboard        : http://localhost:${PORT}/attendance`);
  console.log(`ADMS URL mesin   : http://${config.computer_ip}:${PORT}/csl/login`);
  console.log("====================================");
});
