const express = require("express");

function renderEditDevicePage(deps, device) {
  const {
    normalizePreferredHost,
    protocolLabel,
    supportedAdapters,
    htmlPage,
    escapeHtml
  } = deps;

  return htmlPage("Edit Mesin", `
    <h3>Edit Mesin</h3>
    <form method="POST" action="/update-device">
      <input type="hidden" name="device_id" value="${escapeHtml(device.id)}">
      <label>Nama Mesin</label>
      <input name="name" value="${escapeHtml(device.name)}" required>
      <label>IP Lokal Mesin</label>
      <input name="ip" value="${escapeHtml(device.ip)}">
      <label>Host Public / Domain</label>
      <input name="public_ip" value="${escapeHtml(device.public_ip || "")}" placeholder="contoh: cabang-a.ddns.net">
      <label>Tailscale IP / IP PC Cabang</label>
      <input name="tailscale_ip" value="${escapeHtml(device.tailscale_ip || "")}" placeholder="100.x.x.x">
      <label>Prioritas Host Koneksi</label>
      <select name="preferred_host">
        ${[
          { id: "auto", label: "Auto (Tailscale > Public > Lokal)" },
          { id: "tailscale", label: "Pakai Tailscale" },
          { id: "public", label: "Pakai Public/Domain" },
          { id: "local", label: "Pakai IP Lokal" }
        ].map(mode => `<option value="${mode.id}" ${normalizePreferredHost(device.preferred_host || "auto") === mode.id ? "selected" : ""}>${mode.label}</option>`).join("")}
      </select>
      <label>Port Mesin</label>
      <input name="port" value="${escapeHtml(device.port)}" required>
      <label>Serial Number / SN</label>
      <input name="sn" value="${escapeHtml(device.sn || "")}" placeholder="Wajib jika IP sama antar cabang">
      <label>Brand / Adapter Mesin</label>
      <select name="brand">
        ${supportedAdapters().map(adapter => `<option value="${escapeHtml(adapter.id)}" ${device.brand === adapter.id ? "selected" : ""}>${escapeHtml(adapter.name)} - ${escapeHtml(adapter.protocol)}</option>`).join("")}
      </select>
      <label>Protocol</label>
      <select name="protocol">
        ${["zk-tcp", "adms-http", "bridge-exe"].map(protocol => `<option value="${protocol}" ${protocolLabel(device) === protocol ? "selected" : ""}>${protocol}</option>`).join("")}
      </select>
      <label>Lokasi</label>
      <input name="location" value="${escapeHtml(device.location || "")}">
      <button type="submit">Simpan Perubahan</button>
    </form>

    <form method="POST" action="/delete-device" onsubmit="return confirm('Hapus mesin ini dari daftar?')">
      <input type="hidden" name="device_id" value="${escapeHtml(device.id)}">
      <button class="danger" type="submit">Hapus Mesin dari Daftar</button>
    </form>

    <p><a href="/">Kembali</a></p>
  `);
}

function createDeviceAdminRoutes(deps) {
  const router = express.Router();
  const {
    loadConfig,
    saveConfig,
    makeId,
    normalizePreferredHost,
    normalizeDeviceBrandId,
    htmlPage,
    getDeviceById,
    restartSchedulers
  } = deps;

  router.post("/add-device", (req, res) => {
    const config = loadConfig();
    const ip = String(req.body.ip || "").trim();
    const public_ip = String(req.body.public_ip || "").trim();
    const tailscale_ip = String(req.body.tailscale_ip || "").trim();
    const preferred_host = normalizePreferredHost(req.body.preferred_host || "auto");
    const port = Number(req.body.port || 4370);
    const name = String(req.body.name || "").trim();
    const sn = String(req.body.sn || "").trim();
    const location = String(req.body.location || "").trim();
    const brand = normalizeDeviceBrandId(req.body.brand || "zkteco-compatible");
    const protocol = String(req.body.protocol || "zk-tcp").trim();

    if (!name || (!ip && !tailscale_ip && !public_ip)) return res.redirect("/");

    config.devices.push({
      id: makeId("mesin"),
      name,
      ip,
      public_ip,
      tailscale_ip,
      preferred_host,
      port,
      sn,
      location,
      brand,
      protocol
    });
    saveConfig(config);
    res.redirect("/");
  });

  router.get("/edit-device", (req, res) => {
    const device = getDeviceById(req.query.device_id);
    if (!device) return res.send(htmlPage("Mesin tidak ada", `<h3>Mesin tidak ditemukan</h3><a href="/">Kembali</a>`));

    res.send(renderEditDevicePage(deps, device));
  });

  router.post("/update-device", (req, res) => {
    const config = loadConfig();
    const device = config.devices.find(d => String(d.id) === String(req.body.device_id));
    if (!device) return res.redirect("/");

    device.name = String(req.body.name || device.name).trim();
    device.ip = String(req.body.ip || "").trim();
    device.public_ip = String(req.body.public_ip || "").trim();
    device.tailscale_ip = String(req.body.tailscale_ip || "").trim();
    device.preferred_host = normalizePreferredHost(req.body.preferred_host || device.preferred_host || "auto");
    device.port = Number(req.body.port || device.port || 4370);
    device.sn = String(req.body.sn || "").trim();
    device.location = String(req.body.location || "").trim();
    device.brand = normalizeDeviceBrandId(req.body.brand || device.brand || "zkteco-compatible");
    device.protocol = String(req.body.protocol || device.protocol || "zk-tcp").trim();

    if (!device.ip && !device.tailscale_ip && !device.public_ip) {
      return res.send(htmlPage("Data kurang", `<h3>Isi minimal salah satu host koneksi: IP Lokal, Host Public, atau Tailscale IP.</h3><a href="/edit-device?device_id=${encodeURIComponent(device.id)}">Kembali</a>`));
    }

    saveConfig(config);
    restartSchedulers();
    res.redirect("/");
  });

  router.post("/delete-device", (req, res) => {
    const config = loadConfig();
    config.devices = config.devices.filter(d => String(d.id) !== String(req.body.device_id));
    saveConfig(config);
    restartSchedulers();
    res.redirect("/");
  });

  return router;
}

module.exports = {
  createDeviceAdminRoutes,
  renderEditDevicePage
};
