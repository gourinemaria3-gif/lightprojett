"use strict";

const Database = require("better-sqlite3");
const path     = require("path");
const crypto   = require("crypto");

const db = new Database(path.join(__dirname, "lightproject.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ══════════════════════════════════════════════════════════════════════════════
//  CHIFFREMENT AES-256-GCM du op_token
// ══════════════════════════════════════════════════════════════════════════════

const ALGO           = "aes-256-gcm";
const KEY_HEX        = process.env.ENCRYPTION_KEY || "";
const ENCRYPTION_KEY = KEY_HEX ? Buffer.from(KEY_HEX, "hex") : null;

function encryptToken(token) {
  if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY manquante dans .env");
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, ENCRYPTION_KEY, iv);
  const enc    = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

function decryptToken(stored) {
  if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY manquante dans .env");
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

  CREATE TABLE IF NOT EXISTS users (
    op_user_id  INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    email       TEXT    NOT NULL UNIQUE,
    is_admin    INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

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

  CREATE TABLE IF NOT EXISTS projects_meta (
    op_project_id          INTEGER PRIMARY KEY,
    start_date             TEXT,
    end_date               TEXT,
    workload               REAL,
    progress               INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    risk_score             REAL    NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
    late_tasks             INTEGER NOT NULL DEFAULT 0,
    blocked_tasks          INTEGER NOT NULL DEFAULT 0,
    ai_summary             TEXT,
    budget_total           REAL,
    estimates_complete     INTEGER NOT NULL DEFAULT 1,
    missing_estimates      INTEGER NOT NULL DEFAULT 0,
    risk_is_partial        INTEGER NOT NULL DEFAULT 0,
    budget_alerted_warning INTEGER NOT NULL DEFAULT 0,
    budget_alerted_danger  INTEGER NOT NULL DEFAULT 0,
    updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_members (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    op_user_id     INTEGER NOT NULL REFERENCES users(op_user_id),
    op_project_id  INTEGER NOT NULL,
    role           TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'member')),
    joined_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (op_user_id, op_project_id)
  );

  -- ─────────────────────────────────────────────────────────────────────────
  --  task_extensions — table centrale du budget
  --
  --  estimated_hours  : fixé par le chef de projet
  --  member_rate      : taux horaire déclaré par le membre pour CETTE tâche
  --  estimated_cost   : calculé = estimated_hours × member_rate
  --  actual_cost      : calculé = SUM(time_logs.hours_worked × rate_snapshot)
  --  op_project_id    : pour filtrer les tâches par projet efficacement
  -- ─────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS task_extensions (
    op_task_id      INTEGER PRIMARY KEY,
    op_project_id   INTEGER,
    is_blocked      INTEGER NOT NULL DEFAULT 0 CHECK (is_blocked IN (0, 1)),
    estimated_hours REAL,
    member_rate     REAL,
    estimated_cost  REAL,
    actual_cost     REAL,
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_dependencies (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    task_op_id             INTEGER NOT NULL,
    depends_on_task_op_id  INTEGER NOT NULL,
    UNIQUE (task_op_id, depends_on_task_op_id),
    CHECK (task_op_id != depends_on_task_op_id)
  );

  -- ─────────────────────────────────────────────────────────────────────────
  --  time_logs
  --
  --  rate_snapshot : taux horaire capturé AU MOMENT du log.
  --                  Protège l'historique si member_rate change plus tard.
  --                  COALESCE(rate_snapshot, member_rate_courant) utilisé
  --                  en fallback pour les anciens logs sans snapshot.
  -- ─────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS time_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    op_task_id    INTEGER NOT NULL,
    op_user_id    INTEGER NOT NULL REFERENCES users(op_user_id),
    hours_worked  REAL    NOT NULL CHECK (hours_worked > 0),
    logged_date   TEXT    NOT NULL DEFAULT (date('now')),
    note          TEXT,
    rate_snapshot REAL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notification_settings (
    op_user_id     INTEGER PRIMARY KEY REFERENCES users(op_user_id),
    enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    reminder_days  INTEGER NOT NULL DEFAULT 3
  );

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

  CREATE TABLE IF NOT EXISTS ai_reports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    op_project_id  INTEGER NOT NULL,
    content        TEXT    NOT NULL,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS offline_changes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type   TEXT    NOT NULL CHECK (entity_type IN ('task', 'project')),
    entity_op_id  INTEGER NOT NULL,
    payload       TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    synced        TEXT    NOT NULL DEFAULT 'pending'
      CHECK (synced IN ('pending', 'done', 'error'))
  );

  CREATE INDEX IF NOT EXISTS idx_session_user         ON current_session(op_user_id);
  CREATE INDEX IF NOT EXISTS idx_project_members_proj ON project_members(op_project_id);
  CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(op_user_id);
  CREATE INDEX IF NOT EXISTS idx_task_ext_project     ON task_extensions(op_project_id);
  CREATE INDEX IF NOT EXISTS idx_task_deps_task       ON task_dependencies(task_op_id);
  CREATE INDEX IF NOT EXISTS idx_task_deps_depends    ON task_dependencies(depends_on_task_op_id);
  CREATE INDEX IF NOT EXISTS idx_time_logs_task       ON time_logs(op_task_id);
  CREATE INDEX IF NOT EXISTS idx_time_logs_user       ON time_logs(op_user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(op_user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_ai_reports_project   ON ai_reports(op_project_id);
  CREATE INDEX IF NOT EXISTS idx_offline_synced       ON offline_changes(synced);

`);

// ══════════════════════════════════════════════════════════════════════════════
//  MIGRATIONS — colonnes ajoutées progressivement (protégées par try/catch)
// ══════════════════════════════════════════════════════════════════════════════

const migrations = [
  // projects_meta
  `ALTER TABLE projects_meta ADD COLUMN estimates_complete     INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE projects_meta ADD COLUMN missing_estimates      INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE projects_meta ADD COLUMN risk_is_partial        INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE projects_meta ADD COLUMN budget_alerted_warning INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE projects_meta ADD COLUMN budget_alerted_danger  INTEGER NOT NULL DEFAULT 0`,

  // task_extensions — nouvelles colonnes du modèle budget
  `ALTER TABLE task_extensions ADD COLUMN op_project_id   INTEGER`,
  `ALTER TABLE task_extensions ADD COLUMN estimated_hours REAL`,
  `ALTER TABLE task_extensions ADD COLUMN member_rate     REAL`,

  // ── CORRECTION CRITIQUE : snapshot du taux au moment du log ──────────────
  // Protège l'historique financier si member_rate change ultérieurement.
  // Les anciens logs auront rate_snapshot = NULL → fallback sur member_rate courant.
  `ALTER TABLE time_logs ADD COLUMN rate_snapshot REAL`,

  // project_members — suppression hourly_rate (remplacé par member_rate dans task_extensions)
  // SQLite ne supporte pas DROP COLUMN avant 3.35 — on laisse la colonne si elle existe
  // Elle sera simplement ignorée dans le code
];

for (const sql of migrations) {
  try { db.prepare(sql).run(); } catch (_) { /* colonne déjà existante */ }
}


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
//  CURRENT SESSION — multi-appareil
// ══════════════════════════════════════════════════════════════════════════════

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

function getSessionByUser(opUserId, deviceId = null) {
  const row = deviceId
    ? db.prepare(`SELECT * FROM current_session WHERE op_user_id = ? AND device_id = ?`).get(opUserId, deviceId)
    : db.prepare(`SELECT * FROM current_session WHERE op_user_id = ? ORDER BY last_login_at DESC LIMIT 1`).get(opUserId);

  if (!row) return null;
  try {
    return { ...row, op_token: decryptToken(row.op_token) };
  } catch {
    return null;
  }
}

function getAllSessionsByUser(opUserId) {
  return db.prepare(`
    SELECT id, op_user_id, fcm_token, is_admin, device_id, last_login_at
    FROM current_session WHERE op_user_id = ?
    ORDER BY last_login_at DESC
  `).all(opUserId);
}

function clearSession(opUserId, deviceId = null) {
  if (deviceId) {
    db.prepare(`DELETE FROM current_session WHERE op_user_id = ? AND device_id = ?`).run(opUserId, deviceId);
  } else {
    db.prepare(`DELETE FROM current_session WHERE op_user_id = ?`).run(opUserId);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  PROJECTS META
// ══════════════════════════════════════════════════════════════════════════════

function upsertProjectMeta(opProjectId, {
  startDate, endDate, workload,
  progress = 0, riskScore = 0, lateTasks = 0, blockedTasks = 0,
  aiSummary = null, budgetTotal = null,
  estimatesComplete = true,
  missingEstimates  = 0,
  riskIsPartial     = false,
}) {
  // Préserve les flags d'alerte budget existants — ne jamais les écraser ici
  const existing       = db.prepare(`SELECT budget_alerted_warning, budget_alerted_danger FROM projects_meta WHERE op_project_id = ?`).get(opProjectId);
  const alertedWarning = existing?.budget_alerted_warning ?? 0;
  const alertedDanger  = existing?.budget_alerted_danger  ?? 0;

  db.prepare(`
    INSERT INTO projects_meta (
      op_project_id, start_date, end_date, workload,
      progress, risk_score, late_tasks, blocked_tasks,
      ai_summary, budget_total,
      estimates_complete, missing_estimates, risk_is_partial,
      budget_alerted_warning, budget_alerted_danger,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(op_project_id) DO UPDATE SET
      start_date             = excluded.start_date,
      end_date               = excluded.end_date,
      workload               = excluded.workload,
      progress               = excluded.progress,
      risk_score             = excluded.risk_score,
      late_tasks             = excluded.late_tasks,
      blocked_tasks          = excluded.blocked_tasks,
      ai_summary             = excluded.ai_summary,
      budget_total           = excluded.budget_total,
      estimates_complete     = excluded.estimates_complete,
      missing_estimates      = excluded.missing_estimates,
      risk_is_partial        = excluded.risk_is_partial,
      budget_alerted_warning = excluded.budget_alerted_warning,
      budget_alerted_danger  = excluded.budget_alerted_danger,
      updated_at             = excluded.updated_at
  `).run(
    opProjectId,
    startDate   || null,
    endDate     || null,
    workload    != null ? Number(workload)    : null,
    progress, riskScore, lateTasks, blockedTasks,
    aiSummary,
    budgetTotal != null ? Number(budgetTotal) : null,
    estimatesComplete ? 1 : 0,
    missingEstimates,
    riskIsPartial ? 1 : 0,
    alertedWarning,
    alertedDanger,
  );
}

function setBudgetAlertedFlags(opProjectId, { warning = false, danger = false }) {
  db.prepare(`
    UPDATE projects_meta
    SET budget_alerted_warning = ?,
        budget_alerted_danger  = ?,
        updated_at             = datetime('now')
    WHERE op_project_id = ?
  `).run(warning ? 1 : 0, danger ? 1 : 0, opProjectId);
}

function resetBudgetAlertedFlags(opProjectId) {
  db.prepare(`
    UPDATE projects_meta
    SET budget_alerted_warning = 0,
        budget_alerted_danger  = 0,
        updated_at             = datetime('now')
    WHERE op_project_id = ?
  `).run(opProjectId);
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
//  NOTE : hourly_rate retiré — le taux est maintenant dans task_extensions
// ══════════════════════════════════════════════════════════════════════════════

function upsertProjectMember(opUserId, opProjectId, { role = "member" }) {
  db.prepare(`
    INSERT INTO project_members (op_user_id, op_project_id, role)
    VALUES (?, ?, ?)
    ON CONFLICT(op_user_id, op_project_id) DO UPDATE SET
      role = excluded.role
  `).run(opUserId, opProjectId, role);
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
    SELECT role
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
//
//  Logique budget :
//    1. Le chef fixe estimated_hours
//    2. Le membre fixe member_rate (taux pour CETTE tâche uniquement)
//    3. estimated_cost = estimated_hours × member_rate  (recalculé auto)
//    4. actual_cost    = SUM(time_logs.hours_worked × rate_snapshot)
// ══════════════════════════════════════════════════════════════════════════════

function upsertTaskExtension(opTaskId, {
  opProjectId   = null,
  isBlocked     = false,
  estimatedHours = null,
  memberRate    = null,
}) {
  // Récupère les valeurs actuelles pour ne pas écraser ce qui existe
  const existing = db.prepare(
    `SELECT estimated_hours, member_rate FROM task_extensions WHERE op_task_id = ?`
  ).get(opTaskId);

  const finalEstimatedHours = estimatedHours != null ? Number(estimatedHours) : (existing?.estimated_hours ?? null);
  const finalMemberRate     = memberRate     != null ? Number(memberRate)     : (existing?.member_rate     ?? null);

  // Calcul automatique du coût estimé si les deux valeurs sont connues
  const estimatedCost = (finalEstimatedHours != null && finalMemberRate != null)
    ? Math.round(finalEstimatedHours * finalMemberRate * 100) / 100
    : null;

  db.prepare(`
    INSERT INTO task_extensions
      (op_task_id, op_project_id, is_blocked, estimated_hours, member_rate, estimated_cost, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(op_task_id) DO UPDATE SET
      op_project_id   = COALESCE(excluded.op_project_id, op_project_id),
      is_blocked      = excluded.is_blocked,
      estimated_hours = excluded.estimated_hours,
      member_rate     = excluded.member_rate,
      estimated_cost  = excluded.estimated_cost,
      updated_at      = excluded.updated_at
  `).run(
    opTaskId,
    opProjectId,
    isBlocked ? 1 : 0,
    finalEstimatedHours,
    finalMemberRate,
    estimatedCost,
  );
}

/**
 * Chef de projet — fixe les heures estimées d'une tâche.
 * Recalcule estimated_cost si member_rate est déjà défini.
 */
function setEstimatedHours(opTaskId, estimatedHours, opProjectId = null) {
  const hours    = Number(estimatedHours);
  const existing = db.prepare(
    `SELECT member_rate, op_project_id FROM task_extensions WHERE op_task_id = ?`
  ).get(opTaskId);

  const memberRate     = existing?.member_rate ?? null;
  const estimatedCost  = (memberRate != null)
    ? Math.round(hours * memberRate * 100) / 100
    : null;
  const finalProjectId = opProjectId ?? existing?.op_project_id ?? null;

  db.prepare(`
    INSERT INTO task_extensions (op_task_id, op_project_id, estimated_hours, estimated_cost, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(op_task_id) DO UPDATE SET
      op_project_id   = COALESCE(excluded.op_project_id, op_project_id),
      estimated_hours = excluded.estimated_hours,
      estimated_cost  = excluded.estimated_cost,
      updated_at      = excluded.updated_at
  `).run(opTaskId, finalProjectId, hours, estimatedCost);
}

/**
 * Membre — déclare son taux horaire pour cette tâche.
 * Recalcule estimated_cost et actual_cost immédiatement.
 *
 * IMPORTANT : actual_cost est recalculé en utilisant rate_snapshot de chaque
 * log existant (COALESCE avec le nouveau taux en fallback pour les anciens logs).
 * Les nouveaux logs utiliseront ce taux comme snapshot dès leur création.
 */
function setMemberRate(opTaskId, memberRate, opProjectId = null) {
  const rate     = Number(memberRate);
  const existing = db.prepare(
    `SELECT estimated_hours, op_project_id FROM task_extensions WHERE op_task_id = ?`
  ).get(opTaskId);

  const estimatedHours = existing?.estimated_hours ?? null;
  const estimatedCost  = (estimatedHours != null)
    ? Math.round(estimatedHours * rate * 100) / 100
    : null;
  const finalProjectId = opProjectId ?? existing?.op_project_id ?? null;

  db.prepare(`
    INSERT INTO task_extensions
      (op_task_id, op_project_id, member_rate, estimated_cost, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(op_task_id) DO UPDATE SET
      op_project_id  = COALESCE(excluded.op_project_id, op_project_id),
      member_rate    = excluded.member_rate,
      estimated_cost = excluded.estimated_cost,
      updated_at     = excluded.updated_at
  `).run(opTaskId, finalProjectId, rate, estimatedCost);

  // Recalcule actual_cost en respectant les snapshots historiques.
  // Les logs avec rate_snapshot gardent leur taux d'origine.
  // Les anciens logs sans snapshot utilisent le nouveau taux en fallback.
  refreshActualCost(opTaskId);
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

/**
 * Recalcule actual_cost après ajout/suppression d'un time_log.
 *
 * Formule :
 *   actual_cost = SUM(hours_worked × COALESCE(rate_snapshot, member_rate_courant))
 *
 * - rate_snapshot : taux figé au moment de la saisie (protège l'historique)
 * - fallback member_rate : pour les anciens logs sans snapshot
 * - Si aucun taux n'est disponible → actual_cost reste null
 */
function refreshActualCost(opTaskId) {
  const ext = db.prepare(
    `SELECT member_rate FROM task_extensions WHERE op_task_id = ?`
  ).get(opTaskId);

  // Pas d'extension du tout → rien à faire
  if (!ext) return;

  const currentRate = ext.member_rate ?? 0;

  // SUM utilise rate_snapshot si présent, sinon member_rate courant en fallback.
  // Si ni snapshot ni taux courant → la ligne contribue 0 (pas de coût calculable).
  const row = db.prepare(`
    SELECT COALESCE(SUM(hours_worked * COALESCE(rate_snapshot, ?)), 0) AS total
    FROM time_logs
    WHERE op_task_id = ?
  `).get(currentRate, opTaskId);

  // Si member_rate est null ET aucun log n'a de snapshot → actual_cost = null
  const hasAnyRate = ext.member_rate != null || db.prepare(`
    SELECT 1 FROM time_logs WHERE op_task_id = ? AND rate_snapshot IS NOT NULL LIMIT 1
  `).get(opTaskId);

  if (!hasAnyRate) {
    // Pas de taux du tout → on ne stocke rien (reste null)
    return;
  }

  const actualCost = Math.round(Number(row?.total ?? 0) * 100) / 100;

  db.prepare(`
    UPDATE task_extensions
    SET actual_cost = ?, updated_at = datetime('now')
    WHERE op_task_id = ?
  `).run(actualCost, opTaskId);
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
//
//  CORRECTION CRITIQUE — rate_snapshot :
//    Le taux membre est capturé au moment de la saisie depuis task_extensions.
//    Si member_rate change plus tard, les anciens logs conservent leur coût
//    d'origine grâce au snapshot. Les nouveaux logs utilisent le taux actuel.
// ══════════════════════════════════════════════════════════════════════════════

function addTimeLog(opTaskId, opUserId, { hoursWorked, loggedDate = null, note = null }) {
  // Capture du taux courant au moment de la saisie
  const ext          = db.prepare(
    `SELECT member_rate FROM task_extensions WHERE op_task_id = ?`
  ).get(opTaskId);
  const rateSnapshot = ext?.member_rate ?? null;

  const result = db.prepare(`
    INSERT INTO time_logs (op_task_id, op_user_id, hours_worked, logged_date, note, rate_snapshot)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    opTaskId,
    opUserId,
    Number(hoursWorked),
    loggedDate || new Date().toISOString().slice(0, 10),
    note || null,
    rateSnapshot,
  );

  // Recalcul automatique du coût réel après chaque log
  refreshActualCost(opTaskId);

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
  // Récupère le taskId avant suppression pour recalculer après
  const log = db.prepare(`SELECT op_task_id FROM time_logs WHERE id = ?`).get(id);
  db.prepare(`DELETE FROM time_logs WHERE id = ?`).run(id);
  if (log) refreshActualCost(log.op_task_id);
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
  return db.prepare(`SELECT * FROM notification_settings WHERE op_user_id = ?`).get(opUserId);
}


// ══════════════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════════════

const VALID_NOTIF_TYPES = [
  "assigned", "due_soon", "overdue",
  "blocked", "unblocked", "danger", "budget_alert",
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
  upsertUser, getUserById, getAllUsers,

  // Session
  saveSession, getSessionByUser, getAllSessionsByUser, clearSession,

  // Projects meta
  upsertProjectMeta, getProjectMeta, getAllProjectsMeta,
  getProjectManager, deleteProjectMeta,
  setBudgetAlertedFlags, resetBudgetAlertedFlags,

  // Project members
  upsertProjectMember, getProjectMembers, getMemberRole, removeProjectMember,

  // Task extensions
  upsertTaskExtension, getTaskExtension, setTaskBlocked,
  setEstimatedHours, setMemberRate, refreshActualCost,

  // Task dependencies
  addDependency, removeDependency, getDependenciesOf, getDependents,

  // Time logs
  addTimeLog, getTimeLogsForTask, getTimeLogsForUser, deleteTimeLog,

  // Notification settings
  upsertNotificationSettings, getNotificationSettings,

  // Notifications
  createNotification, getNotifications, markNotificationRead, markAllNotificationsRead,

  // AI reports
  saveAiReport, getAiReports, getLatestAiReport,

  // Offline changes
  queueOfflineChange, getPendingChanges, markChangeSynced, markChangeError, clearSyncedChanges,
};