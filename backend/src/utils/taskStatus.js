"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  utils/taskStatus.js
//
//  POURQUOI CE FICHIER EXISTE ?
//  ─────────────────────────────────────────────────────────────────────────────
//  La fonction `isDone` était dupliquée dans deux services :
//    - services/dependencies.js
//    - services/riskAndProgress.js
//
//  Le commentaire dans dependencies.js reconnaissait la duplication et
//  l'expliquait par "éviter une dépendance circulaire entre services".
//
//  La vraie solution est d'extraire `isDone` dans un fichier utilitaire pur
//  (sans aucun import de services ni de DB), ce qui :
//    ✓ Casse le cycle proprement — utils/ ne dépend de rien d'autre
//    ✓ Garantit une source de vérité unique pour la logique "tâche terminée"
//    ✓ Facilite les tests unitaires isolés
//    ✓ Élimine le risque de divergence si un des deux fichiers est mis à jour
//
//  IMPORTS :
//    const { isDone } = require("../utils/taskStatus");
// ══════════════════════════════════════════════════════════════════════════════

// Ensemble des titres de statut considérés comme "terminé".
// Insensible à la casse — la normalisation est faite dans isDone().
const DONE_STATUSES = new Set([
  "done", "closed", "finished", "resolved", "rejected",
  "terminé", "terminée", "fermé", "fermée", "completed",
  "complete", "annulé", "annulée", "cancelled", "canceled",
]);

/**
 * isDone — détermine si une tâche OpenProject est dans un état terminal.
 *
 * Cascade de détection (ordre décroissant de fiabilité) :
 *   1. opTaskObject.isClosed === true          → booléen fourni directement par l'API OP
 *   2. percentageDone / percentComplete === 100 → progression à 100 %
 *   3. _links.status.title ou status.title      → titre du statut normalisé
 *   4. _links.status.href contient "closed" ou "done" → href de secours
 *
 * @param {object|null} opTaskObject - Objet tâche retourné par l'API OpenProject
 * @returns {boolean}
 */
function isDone(opTaskObject) {
  if (!opTaskObject) return false;

  // 1. Booléen isClosed fourni par OP (le plus fiable)
  if (opTaskObject.isClosed === true) return true;

  // 2. Progression à 100 %
  const pct = Number(opTaskObject.percentageDone ?? opTaskObject.percentComplete ?? -1);
  if (pct === 100) return true;

  // 3. Titre du statut (normalisé en minuscules, espaces rognés)
  const statusTitle = (
    opTaskObject._links?.status?.title ||
    opTaskObject.status?.title ||
    ""
  ).toLowerCase().trim();
  if (statusTitle && DONE_STATUSES.has(statusTitle)) return true;

  // 4. href du statut en fallback (contient parfois "closed" ou "done")
  const statusHref = (opTaskObject._links?.status?.href || "").toLowerCase();
  if (statusHref && (statusHref.includes("closed") || statusHref.includes("done"))) return true;

  return false;
}

module.exports = { isDone, DONE_STATUSES };