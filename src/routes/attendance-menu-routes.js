const express = require("express");

function createAttendanceMenuRoutes(deps) {
  const router = express.Router();
  const {
    loadAttendance,
    loadShifts,
    loadUsers,
    isAdminUser,
    canAccessAttendanceRow,
    htmlPage,
    iconSvg = () => "",
    escapeHtml
  } = deps;

  router.get("/absensi", (req, res) => {
    const user = req.currentUser || global.__cslCurrentUser || null;
    const isAdmin = isAdminUser(user);
    const attendanceRows = loadAttendance();
    const visibleAttendance = isAdmin
      ? attendanceRows
      : attendanceRows.filter(row => canAccessAttendanceRow(user, row));
    const shifts = loadShifts();
    const activeShiftCount = shifts.filter(shift => shift.is_active !== false).length;
    const users = loadUsers();

    res.send(htmlPage("Absensi", `
      <h1>Absensi Center</h1>
      <div class="msg">
        Menu ini menggabungkan data absensi, laporan, dan shift kerja agar navigasi lebih ringkas.
      </div>

      <div class="grid3">
        <div class="stat">Log Absensi <b>${escapeHtml(visibleAttendance.length)}</b></div>
        <div class="stat">User Lokal <b>${escapeHtml(users.length)}</b></div>
        <div class="stat">Shift Aktif <b>${escapeHtml(activeShiftCount)}</b></div>
      </div>

      <div class="grid" style="margin-top:16px;">
        <div class="card submenu-card">
          <div class="submenu-title"><span class="submenu-icon">${iconSvg("attendance")}</span><h3>Data Absensi</h3></div>
          <p class="small">Lihat record absensi, filter mesin/user/tanggal, dan tarik data manual jika diperlukan.</p>
          <a class="pill" href="/attendance">Buka Data Absensi</a>
        </div>

        <div class="card submenu-card">
          <div class="submenu-title"><span class="submenu-icon">${iconSvg("report")}</span><h3>Laporan Absensi</h3></div>
          <p class="small">Rekap masuk, istirahat, pulang, status hadir, telat, dan export CSV/Excel.</p>
          <a class="pill" href="/attendance-report">Buka Laporan</a>
        </div>

        ${isAdmin ? `
        <div class="card submenu-card">
          <div class="submenu-title"><span class="submenu-icon">${iconSvg("shift")}</span><h3>Shift Kerja</h3></div>
          <p class="small">Atur jam shift, toleransi telat, lembur, dan mapping user ke shift.</p>
          <a class="pill" href="/shifts">Buka Shift</a>
        </div>

        <div class="card submenu-card">
          <div class="submenu-title"><span class="submenu-icon">${iconSvg("pull")}</span><h3>Tarik Manual</h3></div>
          <p class="small">Ambil log nyata dari mesin sekarang. Data disimpan hanya jika ada log baru.</p>
          <form method="POST" action="/pull-attendance-all" data-submit-lock>
            <button class="orange" type="submit" data-loading-text="Menarik log...">Tarik Semua Mesin</button>
          </form>
        </div>` : ""}
      </div>
    `));
  });

  return router;
}

module.exports = {
  createAttendanceMenuRoutes
};
