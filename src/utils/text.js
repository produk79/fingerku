const crypto = require("crypto");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value);
  }
}

function errorText(err) {
  if (!err) return "-";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  return safeJson(err);
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

module.exports = {
  escapeHtml,
  safeJson,
  errorText,
  sha256Text
};
