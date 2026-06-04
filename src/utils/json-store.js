const fs = require("fs");
const path = require("path");

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function saveJson(file, data) {
  ensureDirectory(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 4));
}

module.exports = {
  ensureDirectory,
  loadJson,
  saveJson
};
