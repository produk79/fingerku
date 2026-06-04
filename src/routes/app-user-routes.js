const express = require("express");

function selectedValues(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function validDeviceKeys(config) {
  return new Set((config.devices || []).flatMap(d => [String(d.id || ""), String(d.sn || "")]).filter(Boolean));
}

function createAppUserRoutes(deps) {
  const router = express.Router();
  const {
    loadAppUsers,
    saveAppUsers,
    loadUsers,
    loadConfig,
    htmlPage,
    escapeHtml,
    uniqStrings,
    makeId,
    sha256Text
  } = deps;

  router.get("/app-users", (req, res) => {
    const appUsers = loadAppUsers();
    const localUsers = loadUsers();
    const config = loadConfig();

    const rows = appUsers.map(u => {
      const deviceNames = u.role === "admin"
        ? "Semua Mesin"
        : (u.allowed_device_ids || []).map(id => {
            const d = config.devices.find(x => x.id === id || x.sn === id);
            return d ? `${d.name} (${d.sn || "-"})` : id;
          }).join(", ");

      return `
        <tr>
          <td><b>${escapeHtml(u.username)}</b><br><span class="small">ID: ${escapeHtml(u.id)}</span></td>
          <td>${escapeHtml(u.name || "")}</td>
          <td>${escapeHtml(u.role)}</td>
          <td>${escapeHtml(deviceNames || "-")}</td>
          <td>
            <a class="pill" href="/edit-app-user?id=${encodeURIComponent(u.id)}">Edit</a>
            <form method="POST" action="/delete-app-user" onsubmit="return confirm('Hapus user aplikasi ini?')" style="display:inline;">
              <input type="hidden" name="id" value="${escapeHtml(u.id)}">
              <button class="danger mini" ${u.id === "admin" ? "disabled" : ""}>Hapus</button>
            </form>
          </td>
        </tr>`;
    }).join("");

    res.send(htmlPage("Kelola User Login", `
      <h1>Kelola User Login & Akses Mesin</h1>
      <div class="msg warn">
        Default login: <b>admin / 12345</b> dan <b>user / 12345</b>. Untuk online/public, segera ganti password.
      </div>

      <div class="grid">
        <div class="card">
          <h3>Tambah User</h3>
          <form method="POST" action="/save-app-user">
            <label>Username / ID Login</label>
            <input name="username" required placeholder="contoh: cabang1">

            <label>Nama</label>
            <input name="name" required placeholder="contoh: Operator Cabang 1">

            <label>Password</label>
            <input type="password" name="password" required placeholder="minimal 5 karakter">

            <label>Role</label>
            <select name="role">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>

            <label>Mesin yang masuk kelompok user ini</label>
            <div class="machine-check-list">
              ${config.devices.map(d => `
                <label style="display:block;margin:7px 0;padding:7px;border:1px solid #e2e8f0;border-radius:10px;">
                  <input type="checkbox" name="allowed_device_ids" value="${escapeHtml(d.id)}" style="width:auto;margin-right:8px;">
                  ${escapeHtml(d.name)} - SN:${escapeHtml(d.sn || "-")}
                </label>`).join("") || "<p>Belum ada mesin.</p>"}
            </div>

            <button class="blue" type="submit">Simpan User</button>
          </form>
        </div>

        <div class="card">
          <h3>Aturan Akses</h3>
          <p><b>Admin</b>: bisa melihat semua mesin dan semua menu.</p>
          <p><b>User</b>: hanya bisa melihat Live dan Absensi dari mesin yang dicentang.</p>
        </div>
      </div>

      <div class="grid" style="margin-top:16px;">
        <div class="card">
          <h3>Tambah User Lokal</h3>
          <p class="small">User lokal dipakai untuk kirim massal ke mesin.</p>
          <form method="POST" action="/add-user">
            <label>User ID</label>
            <input name="user_id" placeholder="Contoh: 1001" required>
            <label>Nama</label>
            <input name="name" placeholder="Contoh: Budi" required>
            <label>Card / PIN</label>
            <input name="card" placeholder="Opsional">
            <button class="blue" type="submit">Simpan User Lokal</button>
          </form>
        </div>
        <div class="card">
          <h3>Upload CSV User Lokal</h3>
          <p class="small">Format: <code>user_id,name,card</code>. Total user lokal saat ini: <b>${localUsers.length}</b>.</p>
          <form method="POST" action="/upload-csv" enctype="multipart/form-data">
            <input type="file" name="csvfile" accept=".csv" required>
            <button class="orange" type="submit">Upload CSV</button>
          </form>
          <pre>user_id,name,card
1001,Budi,123456
1002,Siti,654321</pre>
        </div>
      </div>

      <h3 style="margin-top:16px;">Daftar User Login</h3>
      <div class="table-scroll">
        <table>
          <tr><th>Username</th><th>Nama</th><th>Role</th><th>Mesin User</th><th>Aksi</th></tr>
          ${rows || '<tr><td colspan="5">Belum ada user.</td></tr>'}
        </table>
      </div>
    `));
  });

  router.get("/edit-app-user", (req, res) => {
    const id = String(req.query.id || "").trim();
    const appUsers = loadAppUsers();
    const user = appUsers.find(u => u.id === id);
    const config = loadConfig();

    if (!user) {
      return res.send(htmlPage("User tidak ditemukan", `<h1>User tidak ditemukan</h1><a class="pill" href="/app-users">Kembali</a>`));
    }

    const allowed = new Set((user.allowed_device_ids || []).map(String));

    res.send(htmlPage("Edit User Login", `
      <h1>Edit User Login</h1>
      <form method="POST" action="/update-app-user" class="card">
        <input type="hidden" name="id" value="${escapeHtml(user.id)}">

        <label>Username / ID Login</label>
        <input name="username" value="${escapeHtml(user.username)}" required>

        <label>Nama</label>
        <input name="name" value="${escapeHtml(user.name || "")}" required>

        <label>Password Baru</label>
        <input type="password" name="password" placeholder="Kosongkan jika tidak diganti">

        <label>Role</label>
        <select name="role">
          <option value="user" ${user.role === "user" ? "selected" : ""}>User</option>
          <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
        </select>

        <label>Status</label>
        <select name="is_active">
          <option value="1" ${user.is_active !== false ? "selected" : ""}>Aktif</option>
          <option value="0" ${user.is_active === false ? "selected" : ""}>Nonaktif</option>
        </select>

        <label>Mesin yang masuk kelompok user ini</label>
        <div class="machine-check-list">
          ${config.devices.map(d => `
            <label style="display:block;margin:7px 0;padding:7px;border:1px solid #e2e8f0;border-radius:10px;">
              <input type="checkbox" name="allowed_device_ids" value="${escapeHtml(d.id)}" ${allowed.has(String(d.id)) || allowed.has(String(d.sn)) ? "checked" : ""} style="width:auto;margin-right:8px;">
              ${escapeHtml(d.name)} - SN:${escapeHtml(d.sn || "-")}
            </label>`).join("") || "<p>Belum ada mesin.</p>"}
        </div>

        <button class="blue" type="submit">Update User</button>
        <a class="pill" href="/app-users">Batal</a>
      </form>
    `));
  });

  router.post("/save-app-user", (req, res) => {
    const rows = loadAppUsers();
    const config = loadConfig();
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const name = String(req.body.name || username).trim();

    if (!username || !password || password.length < 5) return res.redirect("/app-users");

    if (rows.some(u => u.username === username)) {
      return res.send(htmlPage("Username sudah ada", `<h1>Username sudah ada</h1><a class="pill" href="/app-users">Kembali</a>`));
    }

    const allowed = uniqStrings(selectedValues(req.body.allowed_device_ids)).filter(v => validDeviceKeys(config).has(v));
    const role = String(req.body.role || "user") === "admin" ? "admin" : "user";

    if (role === "user" && allowed.length === 0) {
      return res.send(htmlPage("Mesin belum dipilih", `<h1>User role wajib punya minimal 1 mesin.</h1><a class="pill" href="/app-users">Kembali</a>`));
    }

    rows.push({
      id: makeId("appuser"),
      username,
      password_hash: sha256Text(password),
      name,
      role,
      allowed_device_ids: allowed,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    saveAppUsers(rows);
    res.redirect("/app-users");
  });

  router.post("/update-app-user", (req, res) => {
    const rows = loadAppUsers();
    const config = loadConfig();
    const id = String(req.body.id || "").trim();
    const user = rows.find(u => u.id === id);

    if (!user) return res.redirect("/app-users");

    const newUsername = String(req.body.username || "").trim();
    if (!newUsername) return res.redirect(`/edit-app-user?id=${encodeURIComponent(id)}`);

    if (rows.some(u => u.id !== id && u.username === newUsername)) {
      return res.send(htmlPage("Username sudah dipakai", `<h1>Username sudah dipakai</h1><a class="pill" href="/edit-app-user?id=${encodeURIComponent(id)}">Kembali</a>`));
    }

    user.username = newUsername;
    user.name = String(req.body.name || newUsername).trim();
    user.role = String(req.body.role || "user") === "admin" ? "admin" : "user";
    user.is_active = req.body.is_active === "1";
    user.updated_at = new Date().toISOString();

    const password = String(req.body.password || "");
    if (password) user.password_hash = sha256Text(password);

    const allowed = uniqStrings(selectedValues(req.body.allowed_device_ids)).filter(v => validDeviceKeys(config).has(v));
    if (user.role === "user" && allowed.length === 0) {
      return res.send(htmlPage("Mesin belum dipilih", `<h1>User role wajib punya minimal 1 mesin.</h1><a class="pill" href="/edit-app-user?id=${encodeURIComponent(id)}">Kembali</a>`));
    }
    user.allowed_device_ids = allowed;

    saveAppUsers(rows);
    res.redirect("/app-users");
  });

  router.post("/delete-app-user", (req, res) => {
    const id = String(req.body.id || "");
    if (id === "admin") return res.redirect("/app-users");
    saveAppUsers(loadAppUsers().filter(u => u.id !== id));
    res.redirect("/app-users");
  });

  return router;
}

module.exports = {
  createAppUserRoutes
};
