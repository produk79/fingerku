#!/usr/bin/env node
"use strict";

const net = require("net");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const Zkteco = require("zkteco-js");
const { COMMANDS, REQUEST_DATA } = require("../node_modules/zkteco-js/src/helper/command");

const originalLog = console.log;
console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");

function argsMap(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith("--")) {
      out._.push(part);
      continue;
    }
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function jsonOut(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function errorText(err) {
  if (!err) return "-";
  if (typeof err === "string") return err;
  return err.message || JSON.stringify(err);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boolArg(value) {
  return value === true || value === "1" || value === "true" || value === "yes" || value === "on";
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)),
  ]);
}

function isTailscaleIp(host) {
  const parts = String(host || "").split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function tcpTimeoutMessage(host, port) {
  let message = `Timeout. Port ${port} tidak merespon di ${host}`;
  if (isTailscaleIp(host)) {
    message += ". IP Tailscale bisa aktif, tetapi port mesin fingerprint belum terbuka. Gunakan subnet route Tailscale atau portproxy dari PC Tailscale ke IP lokal mesin.";
  }
  return message;
}

function tcpPortCheck(host, port, timeout = 3000) {
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
    socket.once("timeout", () => finish(false, tcpTimeoutMessage(host, port)));
    socket.once("error", (err) => finish(false, errorText(err)));
    socket.connect(port, host);
  });
}

async function connectDevice(host, port, timeout) {
  const check = await tcpPortCheck(host, port, Math.min(timeout, 5000));
  if (!check.ok) throw new Error(check.message);
  const device = new Zkteco(host, port, timeout, 8000);
  await withTimeout(device.createSocket(), timeout, "Connect device");
  return device;
}

async function closeDevice(device, sendExit = true) {
  try {
    if (!device) return;
    if (sendExit && typeof device.disconnect === "function") {
      await device.disconnect();
      return;
    }
    if (device.connectionType === "tcp" && device.ztcp && device.ztcp.socket) {
      device.ztcp.socket.destroy();
      device.ztcp.socket = null;
      return;
    }
    if (device.connectionType === "udp" && device.zudp && device.zudp.socket) {
      device.zudp.socket.close();
      device.zudp.socket = null;
      return;
    }
    if (device.connectionType === "tcp" && device.ztcp && typeof device.ztcp.closeSocket === "function") {
      await device.ztcp.closeSocket();
      return;
    }
    if (device.connectionType === "udp" && device.zudp && typeof device.zudp.closeSocket === "function") {
      await device.zudp.closeSocket();
      return;
    }
    if (typeof device.disconnect === "function") await device.disconnect();
  } catch (_) {}
}

function normalizeUsers(result) {
  const rows = Array.isArray(result) ? result : (result && Array.isArray(result.data) ? result.data : []);
  return rows.map((u, index) => {
    const uid = u.uid ?? u.user_id ?? u.userId ?? u.userid ?? u.id ?? (index + 1);
    const userId = u.userId ?? u.userid ?? u.user_id ?? u.uid ?? uid;
    const fingerprintCount = Math.max(0, Math.min(10, Number(u.fingerprint_count ?? u.finger_count ?? u.fp_count ?? 0) || 0));
    return {
      uid: String(uid),
      employee_code: String(userId),
      device_user_id: String(userId),
      full_name: String(u.name ?? u.username ?? u.userName ?? ""),
      card_number: String(u.card ?? u.cardno ?? u.cardNo ?? ""),
      privilege: String(u.role ?? u.privilege ?? "0"),
      fingerprint_count: fingerprintCount,
      raw: u,
    };
  });
}

function decodeUserPacket72(packet) {
  const uid = packet.readUInt16LE(0);
  const role = packet.readUInt8(2);
  const password = packet.subarray(3, 11).toString("ascii").split("\0").shift() || "";
  const name = packet.subarray(11, 35).toString("ascii").split("\0").shift() || "";
  const cardno = packet.readUInt32LE(35);
  const userId = packet.subarray(48, 57).toString("ascii").split("\0").shift() || String(uid);
  const fingerprintCount = Math.max(0, Math.min(10, Number(packet.readUInt8(42)) || 0));

  return {
    uid,
    userId,
    name,
    role,
    password,
    cardno,
    fingerprint_count: fingerprintCount,
    raw_hex: packet.toString("hex"),
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
    raw_hex: packet.toString("hex"),
  };
}

async function readUsersDetailed(device) {
  if (device.connectionType === "tcp" && device.ztcp && device.ztcp.socket) {
    if (typeof device.ztcp.freeData === "function") await device.ztcp.freeData();
    const data = await device.ztcp.readWithBuffer(REQUEST_DATA.GET_USERS);
    if (typeof device.ztcp.freeData === "function") await device.ztcp.freeData();
    const buffer = data && data.data instanceof Buffer ? data.data.subarray(4) : Buffer.alloc(0);
    const users = [];
    let cursor = buffer;
    while (cursor.length >= 72) {
      users.push(decodeUserPacket72(cursor.subarray(0, 72)));
      cursor = cursor.subarray(72);
    }
    if (users.length > 0) return users;
  }

  if (device.connectionType === "udp" && device.zudp && device.zudp.socket) {
    if (typeof device.zudp.freeData === "function") await device.zudp.freeData();
    const data = await device.zudp.readWithBuffer(REQUEST_DATA.GET_USERS);
    if (typeof device.zudp.freeData === "function") await device.zudp.freeData();
    const buffer = data && data.data instanceof Buffer ? data.data.subarray(4) : Buffer.alloc(0);
    const users = [];
    let cursor = buffer;
    while (cursor.length >= 28) {
      users.push(decodeUserPacket28(cursor.subarray(0, 28)));
      cursor = cursor.subarray(28);
    }
    if (users.length > 0) return users;
  }

  return device.getUsers();
}

function normalizeLogs(result, deviceMeta) {
  const rows = Array.isArray(result)
    ? result
    : result && Array.isArray(result.data)
      ? result.data
      : result && Array.isArray(result.attendance)
        ? result.attendance
        : result && Array.isArray(result.logs)
          ? result.logs
          : [];

  return rows.map((r, index) => {
    const userId = r.user_id ?? r.userId ?? r.userid ?? r.uid ?? r.pin ?? r.id ?? "";
    const rawTime = r.time ?? r.recordTime ?? r.record_time ?? r.timestamp ?? r.attendance_time ??
      r.attTime ?? r.checkTime ?? r.check_time ?? r.punchTime ?? r.punch_time ??
      r.datetime ?? r.dateTime ?? r.date_time ?? r.logTime ?? r.log_time ?? r.DateTime ?? r.Time ?? "";
    const time = normalizeDateTime(rawTime);
    const state = firstDefined(
      r.state,
      r.status,
      r.verify_state,
      r.punch,
      r.punch_state,
      r.attendanceState,
      r.attState,
      r.type,
      "UNKNOWN"
    );
    const cleanState = state === undefined || state === null || state === "" ? "UNKNOWN" : String(state);
    const cleanTime = String(time || "");
    return {
      source_key: `${deviceMeta.serial_number || deviceMeta.device_code || "device"}-${userId}-${cleanTime || index}-${cleanState}`,
      employee_code: String(userId),
      check_time: cleanTime,
      punch_state: cleanState.toUpperCase(),
      raw: r,
    };
  }).filter((row) => row.employee_code && row.check_time);
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function normalizeDateTime(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatLocalDate(value);
  const raw = String(value).trim();
  if (!raw) return "";
  const isoish = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (isoish) return `${isoish[1]}-${isoish[2]}-${isoish[3]} ${isoish[4]}:${isoish[5]}:${isoish[6] || "00"}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return formatLocalDate(parsed);
  return raw;
}

function formatLocalDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function cleanOptionValue(keyword, data) {
  if (!data) return "";
  return data.slice(8).toString("utf8").replace(`${keyword}=`, "").replace(/\u0000/g, "").trim();
}

async function readOption(device, key) {
  try {
    const data = await device.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, key);
    return { ok: true, key, value: cleanOptionValue(key, data) };
  } catch (err) {
    return { ok: false, key, error: errorText(err) };
  }
}

async function writeOption(device, key, value) {
  const payload = `${key}=${value}`;
  const data = await device.executeCmd(COMMANDS.CMD_OPTIONS_WRQ, payload);
  return { key, value, raw_length: data ? data.length : 0 };
}

async function tryWriteOptions(device, pairs) {
  const writes = [];
  for (const [key, value] of pairs) {
    if (value === undefined || value === null || value === "") continue;
    try {
      writes.push({ ok: true, ...(await writeOption(device, key, value)) });
    } catch (err) {
      writes.push({ ok: false, key, value, error: errorText(err) });
    }
  }
  if (typeof device.executeCmd === "function") {
    try { await device.executeCmd(COMMANDS.CMD_REFRESHOPTION, ""); } catch (_) {}
  }
  return writes;
}

function localDateParts(value) {
  const input = String(value || "").trim();
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] || 0),
    };
  }

  const date = input ? new Date(input) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Format waktu tidak valid: ${input}`);
  }

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

function encodeZkTime(parts) {
  if (parts.year < 2000 || parts.year > 2099 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) {
    throw new Error("Waktu mesin di luar rentang yang didukung.");
  }

  return (
    (((parts.year % 100) * 12 * 31 + (parts.month - 1) * 31 + parts.day - 1) * 24 * 60 * 60) +
    ((parts.hour * 60 + parts.minute) * 60) +
    parts.second
  );
}

async function setDeviceTime(device, value) {
  const parts = localDateParts(value);
  const commandBuffer = Buffer.alloc(32);
  commandBuffer.writeUInt32LE(encodeZkTime(parts), 0);
  const result = await device.executeCmd(COMMANDS.CMD_SET_TIME, commandBuffer);
  return {
    datetime: `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`,
    raw_length: result ? result.length : 0,
  };
}

async function detect(device, host, port) {
  const info = {};
  const methods = [
    "getInfo", "getSerialNumber", "getDeviceVersion", "getFirmware",
    "getPlatform", "getOS", "getVendor", "getDeviceName", "getTime",
    "getMacAddress",
  ];
  for (const method of methods) {
    if (typeof device[method] !== "function") continue;
    try {
      const value = await withTimeout(device[method](), 10000, method);
      info[method] = { ok: true, value };
    } catch (err) {
      info[method] = { ok: false, error: errorText(err) };
    }
  }
  const serial = info.getSerialNumber && info.getSerialNumber.ok ? String(info.getSerialNumber.value || "").trim() : "";
  return { host, port, serial_number: serial, info };
}

async function setUser(device, input) {
  const uidRaw = input.uid || input.device_user_id || input.employee_code;
  const uid = Number(uidRaw);
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error("UID/ID mesin harus angka positif untuk setUser ZKTeco.");
  }
  const employeeCode = String(input.employee_code || uid).slice(0, 9);
  const name = String(input.full_name || input.name || `User ${employeeCode}`).slice(0, 24);
  const card = String(input.card_number || input.card || "0").replace(/\D/g, "").slice(0, 10) || "0";
  const privilege = Number(input.privilege || 0);
  await device.setUser(uid, employeeCode, name, "", privilege, card);
  return { uid: String(uid), employee_code: employeeCode, full_name: name, card_number: card, privilege };
}

async function deleteUser(device, identifier) {
  const users = normalizeUsers(await device.getUsers());
  const target = users.find((u) =>
    String(u.uid) === String(identifier) ||
    String(u.employee_code) === String(identifier) ||
    String(u.device_user_id) === String(identifier)
  );
  if (!target) throw new Error(`User ${identifier} tidak ditemukan di mesin target.`);
  await device.deleteUser(Number(target.uid));
  return target;
}

function commandName(commandId) {
  for (const [name, value] of Object.entries(COMMANDS)) {
    if (value === commandId) return name;
  }
  return `CMD_${commandId}`;
}

function commandReply(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    return { ok: false, raw_length: buffer ? buffer.length : 0, error: "Balasan mesin tidak lengkap." };
  }

  const commandId = buffer.readUInt16LE(0);
  const data = buffer.subarray(8);
  return {
    ok: [COMMANDS.CMD_ACK_OK, COMMANDS.CMD_ACK_DATA, COMMANDS.CMD_DATA].includes(commandId),
    command_id: commandId,
    command: commandName(commandId),
    raw_length: buffer.length,
    data_length: data.length,
  };
}

async function beginEnroll(device, input) {
  const uid = Number(input.uid || input.device_user_id || input.employee_code);
  const pin = Number(input.pin || input.device_user_id || input.employee_code || uid);
  const identityMode = String(input.identity_mode || input.identity || "uid").toLowerCase() === "pin" ? "pin" : "uid";
  const serial = identityMode === "pin" ? pin : uid;
  const fingerIndex = Number(input.finger_index ?? input.fid ?? 0);
  if (!Number.isInteger(serial) || serial <= 0 || serial > 65534) {
    throw new Error("UID/ID mesin harus angka 1 sampai 65534 untuk enroll sidik jari.");
  }
  if (!Number.isInteger(fingerIndex) || fingerIndex < 0 || fingerIndex > 9) {
    throw new Error("Index jari harus 0 sampai 9.");
  }

  try { await device.executeCmd(COMMANDS.CMD_CANCELCAPTURE, ""); } catch (_) {}
  const payload = Buffer.alloc(4);
  payload.writeUInt16LE(serial, 0);
  payload.writeUInt16LE(fingerIndex, 2);
  const reply = commandReply(await device.executeCmd(COMMANDS.CMD_STARTENROLL, payload));
  if (!reply.ok) {
    throw new Error(`Mesin menolak enroll: ${reply.command || reply.error}`);
  }

  return {
    uid,
    pin,
    serial_used: serial,
    identity_mode: identityMode,
    finger_index: fingerIndex,
    keep_session_state: true,
    ...reply,
  };
}

async function startEnroll(device, input) {
  const holdMs = clampNumber(input.hold_ms ?? 0, 0, 60000, 0);
  const result = await beginEnroll(device, input);
  if (holdMs > 0) {
    await sleep(holdMs);
  }
  return { ...result, hold_ms: holdMs };
}

async function cancelCapture(device) {
  const cancel = commandReply(await device.executeCmd(COMMANDS.CMD_CANCELCAPTURE, ""));
  try { await device.executeCmd(COMMANDS.CMD_STARTVERIFY, ""); } catch (_) {}
  return cancel;
}

function enrollResultPath() {
  const dir = path.resolve(__dirname, "..", "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `enroll-${Date.now()}-${process.pid}.json`);
}

function writeResultFile(file, payload) {
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify(payload), "utf8");
  } catch (_) {}
}

async function waitForResultFile(file, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, "utf8");
      try { fs.unlinkSync(file); } catch (_) {}
      return JSON.parse(content);
    }
    await sleep(100);
  }
  return null;
}

async function spawnEnrollWorker(args) {
  const resultFile = enrollResultPath();
  const holdMs = clampNumber(args.hold_ms ?? 30000, 3000, 60000, 30000);
  const waitMs = clampNumber(args.wait_ms ?? 3000, 500, 8000, 3000);
  const childArgs = [__filename, "start-enroll-worker"];

  for (const [key, value] of Object.entries(args)) {
    if (key === "_" || key === "background" || key === "result_file" || value === undefined || value === null || value === "") {
      continue;
    }
    childArgs.push(`--${key}`, String(value));
  }
  childArgs.push("--hold_ms", String(holdMs));
  childArgs.push("--result_file", resultFile);

  const child = spawn(process.execPath, childArgs, {
    cwd: path.resolve(__dirname, ".."),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const result = await waitForResultFile(resultFile, waitMs);
  if (result) {
    result.background = true;
    result.worker_pid = child.pid;
    return result;
  }

  return {
    ok: true,
    pending: true,
    background: true,
    worker_pid: child.pid,
    data: { hold_ms: holdMs },
    message: "Perintah enroll sedang dikirim ke mesin dan sesi capture ditahan di background.",
  };
}

async function main() {
  const args = argsMap(process.argv);
  const action = args._[0] || "";
  const host = String(args.host || args.ip || "").trim();
  const port = Number(args.port || 4370);
  const timeout = Number(args.timeout || 12000);

  if (!action) throw new Error("Action kosong.");
  if (action === "ping") {
    jsonOut(await tcpPortCheck(host, port, timeout));
    return;
  }
  if (action === "start-enroll" && boolArg(args.background)) {
    jsonOut(await spawnEnrollWorker(args));
    return;
  }
  if (!host) throw new Error("Host/IP kosong.");

  let device = null;
  let sendExitOnClose = true;
  try {
    device = await connectDevice(host, port, timeout);

    if (action === "detect") {
      jsonOut({ ok: true, data: await detect(device, host, port) });
    } else if (action === "read-users") {
      jsonOut({ ok: true, data: normalizeUsers(await withTimeout(readUsersDetailed(device), timeout * 2, "Read users")) });
    } else if (action === "add-user") {
      jsonOut({ ok: true, data: await setUser(device, args) });
    } else if (action === "delete-user") {
      jsonOut({ ok: true, data: await deleteUser(device, args.user || args.employee_code || args.uid) });
    } else if (action === "start-enroll" || action === "start-enroll-worker") {
      sendExitOnClose = false;
      const holdMs = clampNumber(args.hold_ms ?? 0, 0, 60000, 0);
      const payload = { ok: true, data: { ...(await beginEnroll(device, args)), hold_ms: holdMs }, message: "Mesin sudah dibuka untuk enroll sidik jari." };
      writeResultFile(args.result_file, payload);
      if (holdMs > 0) {
        await sleep(holdMs);
      }
      jsonOut(payload);
    } else if (action === "cancel-capture") {
      jsonOut({ ok: true, data: await cancelCapture(device), message: "Mode capture/enroll dibatalkan." });
    } else if (action === "read-logs") {
      const meta = {
        device_code: args.device_code || "",
        serial_number: args.serial_number || "",
      };
      const logs = await withTimeout(device.getAttendances(), timeout * 3, "Read attendance logs");
      jsonOut({ ok: true, data: normalizeLogs(logs, meta) });
    } else if (action === "reboot") {
      const result = await device.executeCmd(COMMANDS.CMD_RESTART, "");
      jsonOut({ ok: true, data: { raw_length: result ? result.length : 0 } });
    } else if (action === "get-adms") {
      const keys = ["ServerIP", "ServerPort", "ServerName", "PushServerURL", "PushCommKey", "PushVersion", "PushProtocolType", "PushEnable", "ADMS"];
      const values = [];
      for (const key of keys) values.push(await readOption(device, key));
      jsonOut({ ok: true, data: values });
    } else if (action === "set-adms") {
      const serverName = args.adms_domain || args.server_name || "";
      const writes = await tryWriteOptions(device, [
        ["ServerIP", args.adms_ip],
        ["ServerName", serverName],
        ["ServerPort", args.adms_port],
        ["PushServerURL", args.adms_url],
        ["PushCommKey", args.comm_key],
      ]);
      const failed = writes.filter((item) => !item.ok);
      jsonOut({
        ok: writes.length > 0 && failed.length === 0,
        data: writes,
        error: failed.length ? `Gagal menulis ${failed.length} opsi ADMS ke mesin.` : undefined,
      });
    } else if (action === "set-timezone") {
      const timezone = args.timezone || "Asia/Jakarta";
      const offset = args.offset_minutes || "420";
      const writes = await tryWriteOptions(device, [
        ["TimeZone", timezone],
        ["Timezone", timezone],
        ["TZ", timezone],
        ["TZOffset", offset],
        ["TimeZoneOffset", offset],
      ]);
      const failed = writes.filter((item) => !item.ok);
      jsonOut({
        ok: writes.length > 0 && failed.length === 0,
        data: writes,
        error: failed.length ? `Gagal menulis ${failed.length} opsi timezone ke mesin.` : undefined,
      });
    } else if (action === "set-time") {
      jsonOut({ ok: true, data: await setDeviceTime(device, args.local_datetime || args.datetime) });
    } else {
      throw new Error(`Action tidak dikenal: ${action}`);
    }
  } finally {
    await closeDevice(device, sendExitOnClose);
  }
}

main().catch((err) => {
  const args = argsMap(process.argv);
  const payload = { ok: false, error: errorText(err) };
  writeResultFile(args.result_file, payload);
  jsonOut(payload);
  process.exitCode = 1;
});
