const ROLE_USER_POST_ALLOWED = new Set([
  "/add-user",
  "/upload-csv",
  "/update-local-user",
  "/read-finger-record",
  "/send-selected-users"
]);

const ADMIN_ONLY_PATHS = [
  "/app-users",
  "/save-app-user",
  "/delete-app-user",
  "/detect-machine",
  "/settings",
  "/backup-restore",
  "/database-tools",
  "/settings-printer",
  "/save-settings-printer",
  "/export-full-database-sql",
  "/export-devices-sql",
  "/import-full-database-sql",
  "/auto-sync",
  "/toggle-auto-sync",
  "/save-automation-center",
  "/save-auto-attendance",
  "/run-auto-sync-now",
  "/run-auto-attendance-now",
  "/check-status-now",
  "/api/auto-pull-attendance",
  "/remote-enroll-center",
  "/machine-adapters",
  "/advanced",
  "/shifts",
  "/add-device",
  "/edit-device",
  "/save-device",
  "/delete-device",
  "/tailscale-guide",
  "/online-access-guide",
  "/attendance-raw-debug"
];

function createRequireLogin({ getCurrentUser }) {
  return (req, res, next) => {
    if (req.path.startsWith("/assets") || req.path === "/login") return next();

    const user = getCurrentUser(req);
    if (!user) return res.redirect("/login");

    req.currentUser = user;
    global.__cslCurrentUser = user;
    global.user = user;
    next();
  };
}

function createRoleUserPostGuard({ isAdminUser, htmlPage }) {
  return (req, res, next) => {
    if (!req.currentUser) return next();
    if (!isAdminUser(req.currentUser) && req.method !== "GET") {
      if (req.method === "POST" && ROLE_USER_POST_ALLOWED.has(req.path)) return next();
      return res.status(403).send(htmlPage("Akses ditolak", `
        <h1>Akses ditolak</h1>
        <p>Role user hanya boleh melihat dashboard, live, dan Absensi dari mesin yang diizinkan.</p>
        <a class="pill" href="/">Dashboard</a>
      `));
    }
    next();
  };
}

function createAdminOnlyGuard({ isAdminUser, htmlPage, paths = ADMIN_ONLY_PATHS }) {
  return (req, res, next) => {
    const adminOnly = paths.some(p => req.path === p || req.path.startsWith(`${p}/`));
    if (adminOnly && (!req.currentUser || !isAdminUser(req.currentUser))) {
      return res.status(403).send(htmlPage("Akses ditolak", `<h1>Akses ditolak</h1><p>Menu ini hanya untuk admin.</p><a class="pill" href="/">Dashboard</a>`));
    }
    next();
  };
}

module.exports = {
  ROLE_USER_POST_ALLOWED,
  ADMIN_ONLY_PATHS,
  createRequireLogin,
  createRoleUserPostGuard,
  createAdminOnlyGuard
};
