function isAdminUser(user) {
  return Boolean(user && user.role === "admin");
}

function allowedDeviceKeysForUser(user, devices = []) {
  if (!user) return new Set();
  if (isAdminUser(user)) {
    return new Set((devices || []).flatMap(d => [String(d.id || ""), String(d.sn || "")]).filter(Boolean));
  }
  return new Set((user.allowed_device_ids || []).map(v => String(v || "").trim()).filter(Boolean));
}

function filterDevicesByAccess(devices, user) {
  if (!user) return [];
  if (isAdminUser(user)) return devices || [];
  const allowed = allowedDeviceKeysForUser(user, devices);
  return (devices || []).filter(d => allowed.has(String(d.id || "")) || allowed.has(String(d.sn || "")));
}

function visibleDevicesForUser(user, config = {}) {
  return filterDevicesByAccess(config.devices || [], user);
}

function canAccessDeviceRecord(user, device, devices = []) {
  if (!user || !device) return false;
  if (isAdminUser(user)) return true;
  const allowed = allowedDeviceKeysForUser(user, devices);
  return allowed.has(String(device.id || "")) || allowed.has(String(device.sn || ""));
}

function canAccessAttendanceRow(user, row, devices = []) {
  if (!user || !row) return false;
  if (isAdminUser(user)) return true;
  const allowed = allowedDeviceKeysForUser(user, devices);
  return allowed.has(String(row.device_id || "")) || allowed.has(String(row.device_sn || ""));
}

module.exports = {
  isAdminUser,
  allowedDeviceKeysForUser,
  filterDevicesByAccess,
  visibleDevicesForUser,
  canAccessDeviceRecord,
  canAccessAttendanceRow
};
