const crypto = require("crypto");
const { dataFiles } = require("../config/paths");
const jsonStore = require("../utils/json-store");
const { sha256Text } = require("../utils/text");

function uniqStrings(values) {
  return [...new Set((values || []).map(v => String(v || "").trim()).filter(Boolean))];
}

function normalizeAppUsersRows(rows) {
  const input = Array.isArray(rows) ? rows : [];
  const normalized = [];
  const idSet = new Set();
  const usernameSet = new Set();

  for (const row of input) {
    const id = String(row?.id || "").trim();
    const username = String(row?.username || "").trim();
    if (!id || !username) continue;

    const idKey = id.toLowerCase();
    const usernameKey = username.toLowerCase();
    if (idSet.has(idKey) || usernameSet.has(usernameKey)) continue;

    const role = String(row?.role || "user").trim() === "admin" ? "admin" : "user";
    const createdAt = String(row?.created_at || new Date().toISOString());
    const updatedAt = String(row?.updated_at || createdAt);
    const passwordHash = String(row?.password_hash || "").trim();
    if (!passwordHash) continue;

    normalized.push({
      id,
      username,
      password_hash: passwordHash,
      name: String(row?.name || username).trim(),
      role,
      allowed_device_ids: uniqStrings(row?.allowed_device_ids || []),
      is_active: row?.is_active !== false,
      created_at: createdAt,
      updated_at: updatedAt
    });

    idSet.add(idKey);
    usernameSet.add(usernameKey);
  }

  return normalized;
}

function makeAppUser(id, username, password, name, role, allowedDeviceIds = []) {
  return {
    id,
    username,
    password_hash: sha256Text(password),
    name,
    role,
    allowed_device_ids: allowedDeviceIds,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function defaultAppUsers() {
  return [
    makeAppUser("admin", "admin", "12345", "Administrator", "admin", []),
    makeAppUser("user", "user", "12345", "User", "user", [])
  ];
}

function ensureAppUsersFile(file = dataFiles.appUsers) {
  let rows = jsonStore.loadJson(file, []);

  if (!Array.isArray(rows) || rows.length === 0) {
    rows = defaultAppUsers();
    jsonStore.saveJson(file, rows);
    return normalizeAppUsersRows(rows);
  }

  let changed = false;
  if (!rows.some(u => u.username === "admin")) {
    rows.push(makeAppUser("admin", "admin", "12345", "Administrator", "admin", []));
    changed = true;
  }
  if (!rows.some(u => u.username === "user")) {
    rows.push(makeAppUser("user", "user", "12345", "User", "user", []));
    changed = true;
  }

  const normalized = normalizeAppUsersRows(rows);
  if (changed || normalized.length !== rows.length) jsonStore.saveJson(file, normalized);
  return normalized;
}

function loadAppUsers(file = dataFiles.appUsers) {
  return ensureAppUsersFile(file);
}

function saveAppUsers(rows, file = dataFiles.appUsers) {
  jsonStore.saveJson(file, normalizeAppUsersRows(rows || []));
}

function loadSessions(file = dataFiles.sessions) {
  return jsonStore.loadJson(file, {});
}

function saveSessions(rows, file = dataFiles.sessions) {
  jsonStore.saveJson(file, rows || {});
}

function parseCookie(req) {
  const raw = String(req?.headers?.cookie || "");
  const out = {};
  raw.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function getCurrentUser(req, options = {}) {
  const sessionsFile = options.sessionsFile || dataFiles.sessions;
  const appUsersFile = options.appUsersFile || dataFiles.appUsers;

  try {
    const sid = parseCookie(req).csl_session;
    if (!sid) return null;

    const sessions = loadSessions(sessionsFile);
    const sess = sessions[sid];
    if (!sess) return null;

    if (sess.expires_at && new Date(sess.expires_at).getTime() < Date.now()) {
      delete sessions[sid];
      saveSessions(sessions, sessionsFile);
      return null;
    }

    return loadAppUsers(appUsersFile).find(u => u.id === sess.user_id && u.is_active !== false) || null;
  } catch (err) {
    console.error("getCurrentUser error:", err);
    return null;
  }
}

function createSession(userId, days = 7, file = dataFiles.sessions) {
  const sid = crypto.randomBytes(32).toString("hex");
  const sessions = loadSessions(file);
  sessions[sid] = {
    user_id: userId,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * days).toISOString()
  };
  saveSessions(sessions, file);
  return sid;
}

module.exports = {
  normalizeAppUsersRows,
  makeAppUser,
  defaultAppUsers,
  ensureAppUsersFile,
  loadAppUsers,
  saveAppUsers,
  loadSessions,
  saveSessions,
  parseCookie,
  getCurrentUser,
  createSession
};
