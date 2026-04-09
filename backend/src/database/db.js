const Database = require("better-sqlite3");
const path     = require("path");

const db = new Database(path.join(__dirname, "lightproject.db"));

// ══════════════════════════════════════════════════════════════
//  SCHÉMA
// ══════════════════════════════════════════════════════════════
db.exec(`
  CREATE TABLE IF NOT EXISTS projects_meta (
    project_id    INTEGER PRIMARY KEY,
    start_date    TEXT,
    end_date      TEXT,
    workload      REAL,
    manager_id    INTEGER,
    created_at    TEXT DEFAULT (datetime('now'))
  )
`);

// Migration douce : ajoute start_date si la table existait avant cette modification
try {
  db.exec(`ALTER TABLE projects_meta ADD COLUMN start_date TEXT`);
} catch (_) {
  // Colonne déjà présente — on ignore silencieusement
}

// ══════════════════════════════════════════════════════════════
//  FONCTIONS
// ══════════════════════════════════════════════════════════════

/**
 * Insère ou met à jour les métadonnées d'un projet.
 * better-sqlite3 est synchrone — les erreurs sont des exceptions JS normales.
 */
function saveProjectMeta(projectId, { startDate, endDate, workload, managerId }) {
  db.prepare(`
    INSERT INTO projects_meta (project_id, start_date, end_date, workload, manager_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      start_date = excluded.start_date,
      end_date   = excluded.end_date,
      workload   = excluded.workload,
      manager_id = excluded.manager_id
  `).run(
    projectId,
    startDate || null,
    endDate   || null,
    workload  ? Number(workload) : null,
    managerId || null
  );
}

function getProjectMeta(projectId) {
  return db.prepare(
    `SELECT * FROM projects_meta WHERE project_id = ?`
  ).get(projectId);
}

function getAllProjectsMeta() {
  return db.prepare(`SELECT * FROM projects_meta`).all();
}

/**
 * Supprime les métadonnées d'un projet.
 * Appelée lors du rollback si la création OpenProject échoue après sauvegarde SQLite.
 */
function deleteProjectMeta(projectId) {
  db.prepare(
    `DELETE FROM projects_meta WHERE project_id = ?`
  ).run(projectId);
}

module.exports = {
  saveProjectMeta,
  getProjectMeta,
  getAllProjectsMeta,
  deleteProjectMeta,
};