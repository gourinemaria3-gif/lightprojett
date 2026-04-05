// Importer la librairie better-sqlite3 pour gérer SQLite
const Database = require("better-sqlite3");
// Importer le module path pour gérer les chemins de fichiers
const path = require("path");

// Créer/ouvrir la base de données
const db = new Database(path.join(__dirname, "lightproject.db"));

// Créer la table si elle n'existe pas
db.exec(`
  CREATE TABLE IF NOT EXISTS projects_meta (
    project_id    INTEGER PRIMARY KEY,
    end_date      TEXT,
    workload      REAL,
    manager_id    INTEGER,
    created_at    TEXT DEFAULT (datetime('now'))
  )
`);

// Sauvegarder les métadonnées d'un projet
function saveProjectMeta(projectId, { endDate, workload, managerId }) {
  const stmt = db.prepare(`
    INSERT INTO projects_meta (project_id, end_date, workload, manager_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      end_date   = excluded.end_date,
      workload   = excluded.workload,
      manager_id = excluded.manager_id
  `);
  stmt.run(projectId, endDate || null, workload || null, managerId || null);
}

// Récupérer les métadonnées d'un projet
function getProjectMeta(projectId) {
  return db.prepare(`
    SELECT * FROM projects_meta WHERE project_id = ?
  `).get(projectId);
}

// Récupérer toutes les métadonnées
function getAllProjectsMeta() {
  return db.prepare(`SELECT * FROM projects_meta`).all();
}

module.exports = { saveProjectMeta, getProjectMeta, getAllProjectsMeta };