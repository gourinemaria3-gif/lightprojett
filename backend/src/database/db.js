"use strict";

const Database = require("better-sqlite3");
const path     = require("path");
const crypto   = require("crypto");

const db = new Database(path.join(__dirname, "lightproject.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ══════════════════════════════════════════════════════════════════════════════
//  CHIFFREMENT AES-256-GCM du op_token
//  ENCRYPTION_KEY = 64 caractères hex dans .env
//  Générer : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// ══════════════════════════════════════════════════════════════════════════════

const ALGO           = "aes-256-gcm";
const KEY_HEX        = process.env.ENCRYPTION_KEY || "";
const ENCRYPTION_KEY = KEY_HEX ? Buffer.from(KEY_HEX, "hex") : null;

function encryptToken(token) {
  if (!ENCRYPTION_KEY)
    throw new Error("ENCRYPTION_KEY manquante dans .env");
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, ENCRYPTION_KEY, iv);
  const enc    = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

function decryptToken(stored) {
  if (!ENCRYPTION_KEY)
    throw new Error("ENCRYPTION_KEY manquante dans .env");
  const [ivHex, tagHex, dataHex] = stored.split(":");
  const decipher = crypto.createDecipheriv(ALGO, ENCRYPTION_KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

// ══════════════════════════════════════════════════════════════════════════════
//  CRÉATION DES TABLES
// ══════════════════════════════════════════════════════════════════════════════

db.exec(`

  -- ──────────────────────────────────────────────────────────────────────────
  --  1. USERS
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS users (
    op_user_id  INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    email       TEXT    NOT NULL UNIQUE,
    is_admin    INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ──────────────────────────────────────────────────────────────────────────
  --  2. CURRENT_SESSION — multi-appareil
  --     Une ligne par (utilisateur × appareil).
  --     device_id : 'web' | 'mobile' | 'pwa'
  --     op_token stocké CHIFFRÉ (format "iv:tag:ciphertext").
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS current_session (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    op_user_id    INTEGER NOT NULL REFERENCES users(op_user_id),
    op_token      TEXT    NOT NULL,
    fcm_token     TEXT,
    is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    device_id     TEXT    NOT NULL DEFAULT 'web',
    last_login_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (op_user_id, device_id)
  );

  -- ──────────────────────────────────────────────────────────────────────────
  --  3. PROJECTS_META
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS projects_meta (
    op_project_id  INTEGER PRIMARY KEY,
    start_date     TEXT,
    end_date       TEXT,
    workload       REAL,
    progress       INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    risk_score     REAL    NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
    late_tasks     INTEGER NOT NULL DEFAULT 0,
    blocked_tasks  INTEGER NOT NULL DEFAULT 0,
    ai_summary     TEXT,
    budget_total   REAL,
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ──────────────────────────────────────────────────────────────────────────
  --  4. PROJECT_MEMBERS
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS project_members (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    op_user_id     INTEGER NOT NULL REFERENCES users(op_user_id),
    op_project_id  INTEGER NOT NULL,
    role           TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'member')),
    hourly_rate    REAL,
    joined_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (op_user_id, op_project_id)
  );

  -- ──────────────────────────────────────────────────────────────────────────
  --  5. TASK_EXTENSIONS
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS task_extensions (
    op_task_id      INTEGER PRIMARY KEY,
    is_blocked      INTEGER NOT NULL DEFAULT 0 CHECK (is_blocked IN (0, 1)),
    estimated_cost  REAL,
    actual_cost     REAL,
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ──────────────────────────────────────────────────────────────────────────
  --  6. TASK_DEPENDENCIES
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS task_dependencies (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    task_op_id             INTEGER NOT NULL,
    depends_on_task_op_id  INTEGER NOT NULL,
    UNIQUE (task_op_id, depends_on_task_op_id),
    CHECK (task_op_id != depends_on_task_op_id)
  );

  -- ──────────────────────────────────────────────────────────────────────────
  --  7. TIME_LOGS
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS time_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    op_task_id    INTEGER NOT NULL,
    op_user_id    INTEGER NOT NULL REFERENCES users(op_user_id),
    hours_worked  REAL    NOT NULL CHECK (hours_worked > 0),
    logged_date   TEXT    NOT NULL DEFAULT (date('now')),
    note          TEXT,
    hourly_rate   REAL,    
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ──────────────────────────────────────────────────────────────────────────
  --  8. NOTIFICATION_SETTINGS
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS notification_settings (
    op_user_id     INTEGER PRIMARY KEY REFERENCES users(op_user_id),
    enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    reminder_days  INTEGER NOT NULL DEFAULT 3
  );

  -- ──────────────────────────────────────────────────────────────────────────
  --  9. NOTIFICATIONS
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    op_user_id  INTEGER NOT NULL REFERENCES users(op_user_id),
    type        TEXT    NOT NULL CHECK (type IN (
      'assigned', 'due_soon', 'overdue',
      'blocked', 'unblocked', 'danger', 'budget_alert'
    )),
    message     TEXT    NOT NULL,
    is_read     INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ──────────────────────────────────────────────────────────────────────────
  --  10. AI_REPORTS
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS ai_reports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    op_project_id  INTEGER NOT NULL,
    content        TEXT    NOT NULL,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ──────────────────────────────────────────────────────────────────────────
  --  11. OFFLINE_CHANGES
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS offline_changes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type   TEXT    NOT NULL CHECK (entity_type IN ('task', 'project')),
    entity_op_id  INTEGER NOT NULL,
    payload       TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    synced        TEXT    NOT NULL DEFAULT 'pending'
      CHECK (synced IN ('pending', 'done', 'error'))
  );

  -- ══════════════════════════════════════════════════════════════════════════
  --  INDEX
  -- ══════════════════════════════════════════════════════════════════════════
  CREATE INDEX IF NOT EXISTS idx_session_user         ON current_session(op_user_id);
  CREATE INDEX IF NOT EXISTS idx_project_members_proj ON project_members(op_project_id);
  CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(op_user_id);
  CREATE INDEX IF NOT EXISTS idx_task_deps_task       ON task_dependencies(task_op_id);
  CREATE INDEX IF NOT EXISTS idx_task_deps_depends    ON task_dependencies(depends_on_task_op_id);
  CREATE INDEX IF NOT EXISTS idx_time_logs_task       ON time_logs(op_task_id);
  CREATE INDEX IF NOT EXISTS idx_time_logs_user       ON time_logs(op_user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(op_user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_ai_reports_project   ON ai_reports(op_project_id);
  CREATE INDEX IF NOT EXISTS idx_offline_synced       ON offline_changes(synced);

`);


// ══════════════════════════════════════════════════════════════════════════════
//  USERS
// ══════════════════════════════════════════════════════════════════════════════

function upsertUser(opUserId, { name, email, isAdmin = false }) {
  db.prepare(`
    INSERT INTO users (op_user_id, name, email, is_admin, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(op_user_id) DO UPDATE SET
      name       = excluded.name,
      email      = excluded.email,
      is_admin   = excluded.is_admin,
      updated_at = excluded.updated_at
  `).run(opUserId, name, email, isAdmin ? 1 : 0);
}

function getUserById(opUserId) {
  return db.prepare(`SELECT * FROM users WHERE op_user_id = ?`).get(opUserId);
}

function getAllUsers() {
  return db.prepare(`SELECT * FROM users ORDER BY name`).all();
}


// ══════════════════════════════════════════════════════════════════════════════
//  CURRENT SESSION — multi-appareil (web / mobile / pwa)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Sauvegarde ou met à jour la session d'un utilisateur sur un appareil.
 * Le op_token est chiffré avant d'être stocké.
 *
 * @param {number} opUserId
 * @param {{ opToken, fcmToken?, isAdmin?, deviceId? }} opts
 *   deviceId : 'web' | 'mobile' | 'pwa'  (défaut = 'web')
 */
function saveSession(opUserId, { opToken, fcmToken = null, isAdmin = false, deviceId = "web" }) {
  const encryptedToken = encryptToken(opToken);
  db.prepare(`
    INSERT INTO current_session (op_user_id, op_token, fcm_token, is_admin, device_id, last_login_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(op_user_id, device_id) DO UPDATE SET
      op_token      = excluded.op_token,
      fcm_token     = excluded.fcm_token,
      is_admin      = excluded.is_admin,
      last_login_at = excluded.last_login_at
  `).run(opUserId, encryptedToken, fcmToken, isAdmin ? 1 : 0, deviceId);
}

/**
 * Retourne la session la plus récente d'un utilisateur (tous appareils).
 * Le op_token retourné est déjà DÉCHIFFRÉ.
 *
 * @param {number} opUserId
 * @param {string} [deviceId]  — si fourni, filtre par appareil spécifique
 * @returns {object|null}
 */
function getSessionByUser(opUserId, deviceId = null) {
  const row = deviceId
    ? db.prepare(`
        SELECT * FROM current_session
        WHERE op_user_id = ? AND device_id = ?
      `).get(opUserId, deviceId)
    : db.prepare(`
        SELECT * FROM current_session
        WHERE op_user_id = ?
        ORDER BY last_login_at DESC
        LIMIT 1
      `).get(opUserId);

  if (!row) return null;

  try {
    return { ...row, op_token: decryptToken(row.op_token) };
  } catch {
    // Token corrompu ou clé changée — session invalide
    return null;
  }
}

/**
 * Retourne toutes les sessions actives d'un utilisateur (tous appareils).
 * Utile pour afficher "connecté sur X appareils".
 *
 * @param {number} opUserId
 * @returns {object[]}
 */
function getAllSessionsByUser(opUserId) {
  return db.prepare(`
    SELECT id, op_user_id, fcm_token, is_admin, device_id, last_login_at
    FROM current_session
    WHERE op_user_id = ?
    ORDER BY last_login_at DESC
  `).all(opUserId);
  // On ne retourne PAS op_token ici — jamais exposer les tokens chiffrés inutilement
}

/**
 * Supprime la session d'un utilisateur sur un appareil spécifique (logout).
 * Si deviceId est omis, supprime TOUTES les sessions (logout global).
 *
 * @param {number} opUserId
 * @param {string} [deviceId]
 */
function clearSession(opUserId, deviceId = null) {
  if (deviceId) {
    db.prepare(`
      DELETE FROM current_session WHERE op_user_id = ? AND device_id = ?
    `).run(opUserId, deviceId);
  } else {
    // Logout global — déconnecte tous les appareils
    db.prepare(`
      DELETE FROM current_session WHERE op_user_id = ?
    `).run(opUserId);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  PROJECTS META
// ══════════════════════════════════════════════════════════════════════════════

function upsertProjectMeta(opProjectId, {
  startDate, endDate, workload,
  progress = 0, riskScore = 0, lateTasks = 0, blockedTasks = 0,
  aiSummary = null, budgetTotal = null
}) {
  db.prepare(`
    INSERT INTO projects_meta (
      op_project_id, start_date, end_date, workload,
      progress, risk_score, late_tasks, blocked_tasks,
      ai_summary, budget_total, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(op_project_id) DO UPDATE SET
      start_date    = excluded.start_date,
      end_date      = excluded.end_date,
      workload      = excluded.workload,
      progress      = excluded.progress,
      risk_score    = excluded.risk_score,
      late_tasks    = excluded.late_tasks,
      blocked_tasks = excluded.blocked_tasks,
      ai_summary    = excluded.ai_summary,
      budget_total  = excluded.budget_total,
      updated_at    = excluded.updated_at
  `).run(
    opProjectId,
    startDate    || null,
    endDate      || null,
    workload     != null ? Number(workload) : null,
    progress, riskScore, lateTasks, blockedTasks,
    aiSummary,
    budgetTotal  != null ? Number(budgetTotal) : null
  );
}

function getProjectMeta(opProjectId) {
  return db.prepare(`SELECT * FROM projects_meta WHERE op_project_id = ?`).get(opProjectId);
}

function getAllProjectsMeta() {
  return db.prepare(`SELECT * FROM projects_meta ORDER BY updated_at DESC`).all();
}

function getProjectManager(opProjectId) {
  return db.prepare(`
    SELECT u.*
    FROM project_members pm
    JOIN users u ON u.op_user_id = pm.op_user_id
    WHERE pm.op_project_id = ? AND pm.role = 'manager'
    LIMIT 1
  `).get(opProjectId);
}

function deleteProjectMeta(opProjectId) {
  db.prepare(`DELETE FROM projects_meta WHERE op_project_id = ?`).run(opProjectId);
}


// ══════════════════════════════════════════════════════════════════════════════
//  PROJECT MEMBERS
// ══════════════════════════════════════════════════════════════════════════════

function upsertProjectMember(opUserId, opProjectId, { role = "member", hourlyRate = null }) {
  db.prepare(`
    INSERT INTO project_members (op_user_id, op_project_id, role, hourly_rate)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(op_user_id, op_project_id) DO UPDATE SET
      role        = excluded.role,
      hourly_rate = excluded.hourly_rate
  `).run(opUserId, opProjectId, role, hourlyRate != null ? Number(hourlyRate) : null);
}

function getProjectMembers(opProjectId) {
  return db.prepare(`
    SELECT pm.*, u.name, u.email
    FROM project_members pm
    JOIN users u ON u.op_user_id = pm.op_user_id
    WHERE pm.op_project_id = ?
    ORDER BY pm.role DESC, u.name
  `).all(opProjectId);
}

function getMemberRole(opUserId, opProjectId) {
  return db.prepare(`
    SELECT role, hourly_rate
    FROM project_members
    WHERE op_user_id = ? AND op_project_id = ?
  `).get(opUserId, opProjectId);
}

function removeProjectMember(opUserId, opProjectId) {
  db.prepare(`
    DELETE FROM project_members WHERE op_user_id = ? AND op_project_id = ?
  `).run(opUserId, opProjectId);
}


// ══════════════════════════════════════════════════════════════════════════════
//  TASK EXTENSIONS
// ══════════════════════════════════════════════════════════════════════════════

function upsertTaskExtension(opTaskId, { isBlocked = false, estimatedCost = null, actualCost = null }) {
  db.prepare(`
    INSERT INTO task_extensions (op_task_id, is_blocked, estimated_cost, actual_cost, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(op_task_id) DO UPDATE SET
      is_blocked     = excluded.is_blocked,
      estimated_cost = excluded.estimated_cost,
      actual_cost    = excluded.actual_cost,
      updated_at     = excluded.updated_at
  `).run(opTaskId, isBlocked ? 1 : 0, estimatedCost, actualCost);
}

function getTaskExtension(opTaskId) {
  return db.prepare(`SELECT * FROM task_extensions WHERE op_task_id = ?`).get(opTaskId);
}

function setTaskBlocked(opTaskId, isBlocked) {
  db.prepare(`
    UPDATE task_extensions SET is_blocked = ?, updated_at = datetime('now')
    WHERE op_task_id = ?
  `).run(isBlocked ? 1 : 0, opTaskId);
}

function refreshActualCost(opTaskId) {
  const result = db.prepare(`
    SELECT SUM(hours_worked * hourly_rate) AS total
    FROM time_logs
    WHERE op_task_id = ? AND hourly_rate IS NOT NULL
  `).get(opTaskId);

  db.prepare(`
    UPDATE task_extensions
    SET actual_cost = ?, updated_at = datetime('now')
    WHERE op_task_id = ?
  `).run(result?.total ?? 0, opTaskId);
}

// ══════════════════════════════════════════════════════════════════════════════
//  TASK DEPENDENCIES
// ══════════════════════════════════════════════════════════════════════════════

function addDependency(taskOpId, dependsOnTaskOpId) {
  db.prepare(`
    INSERT OR IGNORE INTO task_dependencies (task_op_id, depends_on_task_op_id)
    VALUES (?, ?)
  `).run(taskOpId, dependsOnTaskOpId);
}

function removeDependency(taskOpId, dependsOnTaskOpId) {
  db.prepare(`
    DELETE FROM task_dependencies
    WHERE task_op_id = ? AND depends_on_task_op_id = ?
  `).run(taskOpId, dependsOnTaskOpId);
}

function getDependenciesOf(taskOpId) {
  return db.prepare(`
    SELECT depends_on_task_op_id FROM task_dependencies WHERE task_op_id = ?
  `).all(taskOpId);
}

function getDependents(taskOpId) {
  return db.prepare(`
    SELECT task_op_id FROM task_dependencies WHERE depends_on_task_op_id = ?
  `).all(taskOpId);
}


// ══════════════════════════════════════════════════════════════════════════════
//  TIME LOGS
// ══════════════════════════════════════════════════════════════════════════════

function addTimeLog(opTaskId, opUserId, { hoursWorked, loggedDate = null, note = null, hourlyRate = null }) {
  const result = db.prepare(`
    INSERT INTO time_logs (op_task_id, op_user_id, hours_worked, logged_date, note, hourly_rate)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    opTaskId, opUserId,
    Number(hoursWorked),
    loggedDate || new Date().toISOString().slice(0, 10),
    note || null,
    hourlyRate != null ? Number(hourlyRate) : null   // ← AJOUTE ÇA
  );
  return result.lastInsertRowid;
}

function getTimeLogsForTask(opTaskId) {
  return db.prepare(`
    SELECT tl.*, u.name
    FROM time_logs tl
    JOIN users u ON u.op_user_id = tl.op_user_id
    WHERE tl.op_task_id = ?
    ORDER BY tl.logged_date DESC
  `).all(opTaskId);
}

function getTimeLogsForUser(opUserId) {
  return db.prepare(`
    SELECT * FROM time_logs WHERE op_user_id = ? ORDER BY logged_date DESC
  `).all(opUserId);
}

function deleteTimeLog(id) {
  db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(id);
}


// ══════════════════════════════════════════════════════════════════════════════
//  NOTIFICATION SETTINGS
// ══════════════════════════════════════════════════════════════════════════════

function upsertNotificationSettings(opUserId, { enabled = true, reminderDays = 3 }) {
  db.prepare(`
    INSERT INTO notification_settings (op_user_id, enabled, reminder_days)
    VALUES (?, ?, ?)
    ON CONFLICT(op_user_id) DO UPDATE SET
      enabled       = excluded.enabled,
      reminder_days = excluded.reminder_days
  `).run(opUserId, enabled ? 1 : 0, reminderDays);
}

function getNotificationSettings(opUserId) {
  return db.prepare(`
    SELECT * FROM notification_settings WHERE op_user_id = ?
  `).get(opUserId);
}


// ══════════════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════════════

const VALID_NOTIF_TYPES = [
  "assigned", "due_soon", "overdue",
  "blocked", "unblocked", "danger", "budget_alert"
];

function createNotification(opUserId, type, message) {
  if (!VALID_NOTIF_TYPES.includes(type))
    throw new Error(`Type de notification invalide : ${type}`);
  return db.prepare(`
    INSERT INTO notifications (op_user_id, type, message)
    VALUES (?, ?, ?)
  `).run(opUserId, type, message).lastInsertRowid;
}

function getNotifications(opUserId, { unreadOnly = false } = {}) {
  const query = unreadOnly
    ? `SELECT * FROM notifications WHERE op_user_id = ? AND is_read = 0 ORDER BY created_at DESC`
    : `SELECT * FROM notifications WHERE op_user_id = ? ORDER BY created_at DESC`;
  return db.prepare(query).all(opUserId);
}

function markNotificationRead(id) {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ?`).run(id);
}

function markAllNotificationsRead(opUserId) {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE op_user_id = ?`).run(opUserId);
}


// ══════════════════════════════════════════════════════════════════════════════
//  AI REPORTS
// ══════════════════════════════════════════════════════════════════════════════

function saveAiReport(opProjectId, content) {
  return db.prepare(`
    INSERT INTO ai_reports (op_project_id, content) VALUES (?, ?)
  `).run(opProjectId, content).lastInsertRowid;
}

function getAiReports(opProjectId) {
  return db.prepare(`
    SELECT * FROM ai_reports WHERE op_project_id = ? ORDER BY created_at DESC
  `).all(opProjectId);
}

function getLatestAiReport(opProjectId) {
  return db.prepare(`
    SELECT * FROM ai_reports WHERE op_project_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(opProjectId);
}


// ══════════════════════════════════════════════════════════════════════════════
//  OFFLINE CHANGES
// ══════════════════════════════════════════════════════════════════════════════

function queueOfflineChange(entityType, entityOpId, payload) {
  if (!["task", "project"].includes(entityType))
    throw new Error(`entityType invalide : ${entityType}`);
  db.prepare(`
    INSERT INTO offline_changes (entity_type, entity_op_id, payload)
    VALUES (?, ?, ?)
  `).run(entityType, entityOpId, JSON.stringify(payload));
}

function getPendingChanges() {
  return db.prepare(`
    SELECT * FROM offline_changes WHERE synced = 'pending' ORDER BY created_at ASC
  `).all().map(row => ({ ...row, payload: JSON.parse(row.payload) }));
}

function markChangeSynced(id) {
  db.prepare(`UPDATE offline_changes SET synced = 'done' WHERE id = ?`).run(id);
}

function markChangeError(id) {
  db.prepare(`UPDATE offline_changes SET synced = 'error' WHERE id = ?`).run(id);
}

function clearSyncedChanges() {
  db.prepare(`DELETE FROM offline_changes WHERE synced = 'done'`).run();
}


// ══════════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  db,

  // Users
  upsertUser,
  getUserById,
  getAllUsers,

  // Session — multi-appareil
  saveSession,
  getSessionByUser,
  getAllSessionsByUser,
  clearSession,

  // Projects meta
  upsertProjectMeta,
  getProjectMeta,
  getAllProjectsMeta,
  getProjectManager,
  deleteProjectMeta,

  // Project members
  upsertProjectMember,
  getProjectMembers,
  getMemberRole,
  removeProjectMember,

  // Task extensions
  upsertTaskExtension,
  getTaskExtension,
  setTaskBlocked,
  refreshActualCost,

  // Task dependencies
  addDependency,
  removeDependency,
  getDependenciesOf,
  getDependents,

  // Time logs
  addTimeLog,
  getTimeLogsForTask,
  getTimeLogsForUser,
  deleteTimeLog,

  // Notification settings
  upsertNotificationSettings,
  getNotificationSettings,

  // Notifications
  createNotification,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,

  // AI reports
  saveAiReport,
  getAiReports,
  getLatestAiReport,

  // Offline changes
  queueOfflineChange,
  getPendingChanges,
  markChangeSynced,
  markChangeError,
  clearSyncedChanges,
};