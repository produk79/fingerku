function normalizePreferredHost(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  return ["auto", "local", "public", "tailscale"].includes(normalized) ? normalized : "auto";
}

function deviceAddress(device) {
  const ipLocal = String(device?.ip || "").trim();
  const ipPublic = String(device?.public_ip || "").trim();
  const ipTailscale = String(device?.tailscale_ip || "").trim();
  const preferred = normalizePreferredHost(device?.preferred_host || "auto");

  if (preferred === "tailscale" && ipTailscale) return ipTailscale;
  if (preferred === "public" && ipPublic) return ipPublic;
  if (preferred === "local" && ipLocal) return ipLocal;

  return ipTailscale || ipPublic || ipLocal;
}

module.exports = {
  normalizePreferredHost,
  deviceAddress
};
