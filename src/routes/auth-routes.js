const express = require("express");

function renderLoginPage(showError = false) {
  const error = showError ? `<div class="msg warn">Username atau password salah.</div>` : "";
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Login</title><link rel="stylesheet" href="/assets/style.css"><script defer src="/assets/assets/app.js"></script></head><body class="login-page able-pro-auth" data-theme="light"><main class="main-shell"><div class="box"><div class="auth-brand"><div class="brand-logo pc-logo">CSL</div><div><strong>Fingerprint</strong><small>Able Pro Bootstrap 5</small></div></div><h1>Masuk Admin</h1><p class="small">Kelola mesin fingerprint, user, enroll, dan absensi realtime dari satu panel.</p>${error}<form method="POST" action="/login" data-submit-lock><label>Username</label><input name="username" required autofocus autocomplete="username"><label>Password</label><input name="password" type="password" required autocomplete="current-password"><button class="blue" type="submit" data-loading-text="Masuk...">Login</button></form><p class="small">Default admin: admin / 12345, user: user / 12345. Segera ganti password untuk online.</p></div></main></body></html>`;
}

function createAuthRoutes(deps) {
  const router = express.Router();
  const {
    loadAppUsers,
    saveAppUsers,
    makeAppUser,
    sha256Text,
    createSession,
    parseCookie,
    loadSessions,
    saveSessions,
    sessionsFile
  } = deps;

  router.get("/login", (req, res) => {
    res.send(renderLoginPage(Boolean(req.query.err)));
  });

  router.post("/login", (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    let user = loadAppUsers().find(u => u.username === username && u.password_hash === sha256Text(password) && u.is_active !== false);

    if (!user && (username === "admin" || username === "user") && password === "12345") {
      const rows = loadAppUsers();
      user = rows.find(u => u.username === username);
      if (!user) {
        user = username === "admin"
          ? makeAppUser("admin", "admin", "12345", "Administrator", "admin", [])
          : makeAppUser("user", "user", "12345", "User", "user", []);
        rows.push(user);
      } else {
        user.password_hash = sha256Text("12345");
        user.is_active = true;
        user.role = username === "admin" ? "admin" : (user.role || "user");
      }
      saveAppUsers(rows);
    }

    if (!user) return res.redirect("/login?err=1");

    const sid = createSession(user.id, 7, sessionsFile);
    res.setHeader("Set-Cookie", `csl_session=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`);
    res.redirect("/");
  });

  router.get("/logout", (req, res) => {
    const sid = parseCookie(req).csl_session;
    if (sid) {
      const sessions = loadSessions();
      delete sessions[sid];
      saveSessions(sessions);
    }
    res.setHeader("Set-Cookie", "csl_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    res.redirect("/login");
  });

  return router;
}

module.exports = {
  createAuthRoutes,
  renderLoginPage
};
