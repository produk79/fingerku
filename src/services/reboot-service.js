const REBOOT_METHOD_CANDIDATES = [
  "restartDevice",
  "rebootDevice",
  "restart",
  "reboot",
  "restartMachine",
  "restart_device"
];

function commandConstants() {
  try {
    return require("zkteco-js/src/helper/command").COMMANDS || {};
  } catch (_) {
    return {};
  }
}

const COMMANDS = commandConstants();
const CMD_RESTART = Number(COMMANDS.CMD_RESTART || 1004);
const CMD_ACK_OK = Number(COMMANDS.CMD_ACK_OK || 2000);
const CMD_ACK_ERROR = Number(COMMANDS.CMD_ACK_ERROR || 2001);
const LOW_LEVEL_REBOOT_METHOD = `executeCmd(CMD_RESTART=${CMD_RESTART})`;

function listRebootMethods(device) {
  const methods = REBOOT_METHOD_CANDIDATES.filter(name => typeof device?.[name] === "function");
  if (
    typeof device?.executeCmd === "function" ||
    typeof device?.ztcp?.executeCmd === "function" ||
    typeof device?.zudp?.executeCmd === "function"
  ) {
    methods.push(LOW_LEVEL_REBOOT_METHOD);
  }
  return methods;
}

function ackCommandId(reply) {
  if (!Buffer.isBuffer(reply) || reply.length < 2) return null;
  try {
    return reply.readUInt16LE(0);
  } catch (_) {
    return null;
  }
}

function likelyRebootDisconnectError(err) {
  const msg = err && err.message ? err.message : String(err || "");
  return /TIMEOUT|timeout|SOCKET|socket|disconnect|disconnected|ECONNRESET|EPIPE|closed|Cannot read properties of null|RECEIVING_RESPONSE|NO_REPLY/i.test(msg);
}

async function executeRestartCommand(device) {
  const data = Buffer.alloc(0);

  if (typeof device?.executeCmd === "function") {
    return await device.executeCmd(CMD_RESTART, data);
  }

  if (device?.connectionType === "udp" && typeof device?.zudp?.executeCmd === "function") {
    return await device.zudp.executeCmd(CMD_RESTART, data);
  }

  if (typeof device?.ztcp?.executeCmd === "function") {
    return await device.ztcp.executeCmd(CMD_RESTART, data);
  }

  if (typeof device?.zudp?.executeCmd === "function") {
    return await device.zudp.executeCmd(CMD_RESTART, data);
  }

  throw new Error("Library tidak expose executeCmd untuk CMD_RESTART.");
}

async function rebootWithLowLevelCommand(device) {
  try {
    const reply = await executeRestartCommand(device);
    const commandId = ackCommandId(reply);

    if (commandId === CMD_ACK_ERROR) {
      throw new Error("Mesin menolak CMD_RESTART (ACK_ERROR).");
    }

    return {
      ok: true,
      method: LOW_LEVEL_REBOOT_METHOD,
      command: CMD_RESTART,
      ack: commandId || "",
      note: commandId === CMD_ACK_OK
        ? "CMD_RESTART diterima mesin (ACK_OK)."
        : "CMD_RESTART dikirim. Mesin mungkin langsung restart atau firmware tidak mengirim ACK standar."
    };
  } catch (err) {
    if (likelyRebootDisconnectError(err)) {
      return {
        ok: true,
        method: LOW_LEVEL_REBOOT_METHOD,
        command: CMD_RESTART,
        ack: "",
        note: `Socket putus/timeout setelah CMD_RESTART dikirim. Ini sering terjadi saat mesin mulai reboot. Detail: ${err.message || err}`
      };
    }
    throw err;
  }
}

async function rebootDevice(device, packageName = "ZKTeco") {
  const highLevelMethods = REBOOT_METHOD_CANDIDATES.filter(name => typeof device?.[name] === "function");
  if (highLevelMethods.length) {
    const method = highLevelMethods[0];
    const reply = await device[method]();
    return { ok: true, method, reply, note: "Reboot dikirim melalui method high-level library." };
  }

  if (listRebootMethods(device).includes(LOW_LEVEL_REBOOT_METHOD)) {
    return await rebootWithLowLevelCommand(device);
  }

  throw new Error(`Fungsi reboot/restart tidak tersedia pada ${packageName}; executeCmd CMD_RESTART juga tidak tersedia.`);
}

module.exports = {
  REBOOT_METHOD_CANDIDATES,
  CMD_RESTART,
  LOW_LEVEL_REBOOT_METHOD,
  listRebootMethods,
  rebootDevice,
  likelyRebootDisconnectError
};
