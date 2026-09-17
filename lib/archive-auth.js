const crypto = require("node:crypto");

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,40}$/;

function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) throw new Error("用户名仅支持 3-40 位字母、数字、点、下划线或连字符");
  return username;
}

function validatePassword(value) {
  const password = typeof value === "string" ? value : "";
  if (password.length < 12 || password.length > 200) throw new Error("密码长度必须为 12-200 位");
  return password;
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return salt + ":" + crypto.scryptSync(password, salt, 64).toString("hex");
}

function passwordMatches(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cookieValue(request, name) {
  const pairs = String(request.headers.cookie || "").split(";");
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(pair.slice(separator + 1).trim()); } catch (_error) { return ""; }
  }
  return "";
}

function createArchiveAuth(db, options = {}) {
  const enabled = options.enabled === true;
  const adminUsername = normalizeUsername(options.adminUsername || "admin");
  const adminPassword = options.adminPassword || "";
  const secureCookie = options.secureCookie !== false;
  const sessionHours = Math.min(24 * 31, Math.max(1, Number(options.sessionHours) || 12));

  db.exec(`
    CREATE TABLE IF NOT EXISTS archive_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS archive_sessions (
      token_hash TEXT PRIMARY KEY,
      csrf_token TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES archive_users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_archive_sessions_expiry ON archive_sessions(expires_at);
  `);

  const getUserByUsername = db.prepare("SELECT id, username, password_hash, role, created_at, updated_at FROM archive_users WHERE username = ?");
  const getUserById = db.prepare("SELECT id, username, role, created_at, updated_at FROM archive_users WHERE id = ?");
  const insertUser = db.prepare("INSERT INTO archive_users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
  const getSession = db.prepare("SELECT s.token_hash, s.csrf_token, s.expires_at, u.id, u.username, u.role FROM archive_sessions s JOIN archive_users u ON u.id = s.user_id WHERE s.token_hash = ?");
  const insertSession = db.prepare("INSERT INTO archive_sessions (token_hash, csrf_token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)");
  const deleteSession = db.prepare("DELETE FROM archive_sessions WHERE token_hash = ?");
  const deleteExpiredSessions = db.prepare("DELETE FROM archive_sessions WHERE expires_at <= ?");

  if (enabled) {
    validatePassword(adminPassword);
    if (!getUserByUsername.get(adminUsername)) {
      const now = new Date().toISOString();
      insertUser.run(adminUsername, hashPassword(adminPassword), "admin", now, now);
    }
  }

  function publicUser(row) {
    return row ? { id: Number(row.id), username: row.username, role: row.role } : null;
  }

  function createUser({ username, password, role = "member" }) {
    const normalized = normalizeUsername(username);
    const selectedRole = role === "admin" ? "admin" : role === "member" ? "member" : "";
    if (!selectedRole) throw new Error("role 仅允许 admin 或 member");
    const validPassword = validatePassword(password);
    if (getUserByUsername.get(normalized)) throw new Error("用户名已存在");
    const now = new Date().toISOString();
    const info = insertUser.run(normalized, hashPassword(validPassword), selectedRole, now, now);
    return publicUser(getUserById.get(Number(info.lastInsertRowid)));
  }

  function authenticate(request) {
    if (!enabled) return null;
    const token = cookieValue(request, "gameops_session");
    if (!token || token.length < 32) return null;
    const row = getSession.get(hashToken(token));
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
      deleteSession.run(row.token_hash);
      return null;
    }
    return { tokenHash: row.token_hash, csrfToken: row.csrf_token, user: publicUser(row) };
  }

  function login({ username, password }) {
    const user = getUserByUsername.get(normalizeUsername(username));
    if (!user || !passwordMatches(typeof password === "string" ? password : "", user.password_hash)) return null;
    deleteExpiredSessions.run(new Date().toISOString());
    const token = crypto.randomBytes(32).toString("base64url");
    const csrfToken = crypto.randomBytes(24).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionHours * 3600000).toISOString();
    insertSession.run(hashToken(token), csrfToken, user.id, expiresAt, now.toISOString());
    return { token, csrfToken, user: publicUser(user), expiresAt };
  }

  function matchesCsrf(request, session) {
    const supplied = String(request.headers["x-csrf-token"] || "");
    const expected = String(session?.csrfToken || "");
    if (!supplied || !expected || supplied.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  }

  function sessionCookie(token, expiresAt) {
    const maxAge = Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
    return "gameops_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + maxAge + (secureCookie ? "; Secure" : "");
  }

  function clearSessionCookie() {
    return "gameops_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + (secureCookie ? "; Secure" : "");
  }

  return {
    enabled,
    secureCookie,
    adminUsername,
    adminUserId: Number(getUserByUsername.get(adminUsername)?.id || 0),
    authenticate,
    createUser,
    login,
    matchesCsrf,
    sessionCookie,
    clearSessionCookie,
    deleteSession
  };
}

module.exports = { createArchiveAuth };
