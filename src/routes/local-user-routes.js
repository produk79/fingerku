const express = require("express");
const fs = require("fs");

function selectedValues(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function renderEditLocalUserPage(deps, user, config) {
  const { htmlPage, escapeHtml } = deps;

  return htmlPage("Edit User Lokal", `
    <h3>Edit User Lokal + Sync ke Mesin</h3>
    <form method="POST" action="/update-local-user">
      <label>User ID</label>
      <input value="${escapeHtml(user.user_id)}" readonly>
      <input type="hidden" name="user_id" value="${escapeHtml(user.user_id)}">
      <label>Nama</label>
      <input name="name" value="${escapeHtml(user.name)}" required>
      <label>Card / PIN</label>
      <input name="card" value="${escapeHtml(user.card || "")}">
      <h4>Sync perubahan ke mesin</h4>
      ${config.devices.map(device => `
        <label style="display:block;margin:6px 0;">
          <input type="checkbox" name="sync_device_ids" value="${escapeHtml(device.id)}" style="width:auto;margin-right:8px;">
          ${escapeHtml(device.name)} - SN:${escapeHtml(device.sn || "-")}
        </label>
      `).join("")}
      <button class="blue" type="submit">Simpan User</button>
    </form>
    <p class="small">User ID readonly. Jika mesin dicentang, nama di mesin ikut berubah.</p>
    <a href="/">Kembali</a>
  `);
}

function createLocalUserRoutes(deps) {
  const router = express.Router();
  const {
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
    hasDeviceSdk
  } = deps;

  router.post("/add-user", (req, res) => {
    const users = loadUsers();
    const user = {
      user_id: String(req.body.user_id || "").trim(),
      name: String(req.body.name || "").trim(),
      card: String(req.body.card || "").trim()
    };

    if (!user.user_id || !user.name) return res.redirect("/");

    const exists = users.find(row => String(row.user_id) === user.user_id);
    if (exists) {
      exists.name = user.name;
      exists.card = user.card;
    } else {
      users.push(user);
    }

    saveUsers(users);
    res.redirect("/");
  });

  router.get("/edit-local-user", (req, res) => {
    const userId = String(req.query.user_id || "").trim();
    const users = loadUsers();
    const user = users.find(row => String(row.user_id) === userId);
    const config = filteredConfigForRequest(req);

    if (!user) return res.send(htmlPage("User tidak ada", `<h3>User lokal tidak ditemukan</h3><a href="/">Kembali</a>`));

    res.send(renderEditLocalUserPage(deps, user, config));
  });

  router.post("/update-local-user", async (req, res) => {
    const currentUserObj = req.currentUser || global.__cslCurrentUser || null;
    const userId = String(req.body.user_id || "").trim();
    const name = String(req.body.name || "").trim();
    const card = String(req.body.card || "").trim();
    const syncDeviceIds = selectedValues(req.body.sync_device_ids);

    const users = loadUsers();
    const user = users.find(row => String(row.user_id) === userId);
    if (!user) return res.send(htmlPage("User tidak ada", `<h3>User lokal tidak ditemukan</h3><a href="/">Kembali</a>`));
    if (!name) return res.send(htmlPage("Nama kosong", `<h3>Nama tidak boleh kosong</h3><a href="/edit-local-user?user_id=${encodeURIComponent(userId)}">Kembali</a>`));

    user.name = name;
    user.card = card;
    saveUsers(users);

    const config = loadConfig();
    const visibleDevices = filterDevicesByAccess(config.devices || [], currentUserObj);
    const targets = visibleDevices.filter(device => syncDeviceIds.includes(String(device.id)) || syncDeviceIds.includes(String(device.sn || "")));
    const results = [];

    if (targets.length && hasDeviceSdk()) {
      for (const deviceConfig of targets) {
        let device = null;
        try {
          device = await connectDevice(deviceConfig);
          await setUserToDevice(device, user);
          await closeDevice(device);
          results.push(`${deviceConfig.name}: OK`);
        } catch (err) {
          await closeDevice(device);
          results.push(`${deviceConfig.name}: GAGAL - ${errorText(err)}`);
        }
      }
    }

    res.send(htmlPage("Update User", `
      <h3>User lokal berhasil disimpan</h3>
      <p>User ID: <b>${escapeHtml(user.user_id)}</b></p>
      <p>Nama: <b>${escapeHtml(user.name)}</b></p>
      <h4>Hasil Sync Mesin</h4>
      <pre>${escapeHtml(results.join("\\n") || "Tidak ada mesin dipilih untuk sync.")}</pre>
      <a href="/">Kembali</a>
    `));
  });

  router.post("/upload-csv", upload.single("csvfile"), (req, res) => {
    if (!req.file) return res.redirect("/");

    const users = loadUsers();
    const csv = fs.readFileSync(req.file.path, "utf8");
    const lines = csv.split(/\r?\n/).filter(Boolean);

    lines.slice(1).forEach(line => {
      const [user_id, name, card] = line.split(",");
      if (!user_id || !name) return;

      const clean = {
        user_id: user_id.trim(),
        name: name.trim(),
        card: card ? card.trim() : ""
      };
      const existing = users.find(row => String(row.user_id) === clean.user_id);
      if (existing) {
        existing.name = clean.name;
        existing.card = clean.card;
      } else {
        users.push(clean);
      }
    });

    fs.unlinkSync(req.file.path);
    saveUsers(users);
    res.redirect("/");
  });

  router.get("/delete/:user_id", (req, res) => {
    const userId = req.params.user_id;
    const users = loadUsers().filter(user => String(user.user_id) !== String(userId));
    saveUsers(users);
    res.redirect("/");
  });

  return router;
}

module.exports = {
  createLocalUserRoutes,
  renderEditLocalUserPage
};
