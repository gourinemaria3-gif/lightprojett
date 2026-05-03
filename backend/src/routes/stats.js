"use strict";

const express = require("express");
const router  = express.Router({ mergeParams: true });
const { getTasks, getMembers } = require("../services/openproject");
const { getProjectMeta }       = require("../database/db");

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

// ── CORRECTION 1 : isTaskDone vérifie isClosed ET percentageDone=100 ─────────
//  Avant : seulement le titre du statut → ratait les tâches fermées dont
//  le titre ne contient pas "done/closed/terminé" (ex: "Résolu", "Rejeté"…)
const DONE_STATUS_KEYWORDS = [
  "closed", "done", "terminé", "terminée", "fermé", "fermée",
  "résolu", "resolved", "finished", "rejected", "rejeté",
];

function isTaskDone(task) {
  // 1. OpenProject marque isClosed sur les statuts finaux
  if (task.isClosed === true) return true;
  // 2. Fallback sur le titre du statut
  const s = (task._links?.status?.title || "").toLowerCase();
  if (DONE_STATUS_KEYWORDS.some(kw => s.includes(kw))) return true;
  // 3. percentageDone = 100 (tâche complète même si statut mal configuré)
  if (Number(task.percentageDone ?? task.percentComplete ?? 0) === 100) return true;
  return false;
}

// ── CORRECTION 2 : isTaskLate compare les dates en string "YYYY-MM-DD" ───────
//  Avant : new Date(task.dueDate) < new Date()
//  Problème : new Date("2026-04-13") = minuit UTC, décalage selon fuseau.
//  Fix : comparaison purement string après normalisation, sans parsing UTC.
function todayLocalStr() {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, "0");
  const d   = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isTaskLate(task) {
  if (!task.dueDate)      return false;
  if (isTaskDone(task))   return false;
  const due   = String(task.dueDate).slice(0, 10); // "YYYY-MM-DD"
  const today = todayLocalStr();
  return due < today; // comparaison lexicographique fiable sur ISO dates
}

/** PT8H → 8  |  P2DT2H → 18  |  null → 0 */
function parseHours(iso) {
  if (!iso) return 0;
  const str  = String(iso).toUpperCase();
  const days = Number(str.match(/(\d+(?:\.\d+)?)D/)?.[1]  ?? 0);
  const hrs  = Number(str.match(/T(\d+(?:\.\d+)?)H/)?.[1] ?? 0);
  return days * 8 + hrs;
}

/** "2024-03-01" → timestamp ms */
function toMs(dateStr) {
  return dateStr ? new Date(dateStr).getTime() : null;
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/projects/:projectId/stats
// ══════════════════════════════════════════════════════════════════════════════
router.get("/", async (req, res) => {
  const { projectId } = req.params;
  const opToken = req.opToken;

  try {
    const [tasks, members] = await Promise.all([
      getTasks(projectId, opToken),
      getMembers(opToken),
    ]);

    const meta = getProjectMeta(projectId) || {};

    // ── 1. KPIs de base ────────────────────────────────────────────────────
    const total      = tasks.length;
    const done       = tasks.filter(isTaskDone).length;
    const late       = tasks.filter(isTaskLate).length;
    const inProgress = tasks.filter(t => {
      const s = (t._links?.status?.title || "").toLowerCase();
      return !isTaskDone(t) && (s.includes("progress") || s.includes("cours"));
    }).length;

    // ── 2. Progression par heures ──────────────────────────────────────────
    const totalHours    = tasks.reduce((s, t) => s + parseHours(t.estimatedTime), 0);
    const doneHours     = tasks.filter(isTaskDone).reduce((s, t) => s + parseHours(t.estimatedTime), 0);
    const progressCount = total > 0 ? Math.round((done / total) * 100) : 0;
    const progressHours = totalHours > 0 ? Math.round((doneHours / totalHours) * 100) : 0;

    // ── 3. Charge par membre ───────────────────────────────────────────────
    const memberMap = {};
    members.forEach(m => { memberMap[String(m.id)] = m.name; });

    const workloadByMember = {};
    tasks.forEach(t => {
      const assigneeHref = t._links?.assignee?.href || "";
      const memberId     = assigneeHref.split("/").pop();
      const name         = memberMap[memberId] || "Non assigné";
      if (!workloadByMember[name]) workloadByMember[name] = { estimated: 0, done: 0, late: 0, count: 0 };
      workloadByMember[name].estimated += parseHours(t.estimatedTime);
      workloadByMember[name].count     += 1;
      if (isTaskDone(t)) workloadByMember[name].done += parseHours(t.estimatedTime);
      if (isTaskLate(t)) workloadByMember[name].late += 1;
    });

    // ── 4. Distribution par statut ─────────────────────────────────────────
    const statusDist = {};
    tasks.forEach(t => {
      const label = t._links?.status?.title || "Inconnu";
      statusDist[label] = (statusDist[label] || 0) + 1;
    });

    // ── 5. Tâches en retard (détail) ───────────────────────────────────────
    const lateTasks = tasks
      .filter(isTaskLate)
      .map(t => {
        const assigneeHref = t._links?.assignee?.href || "";
        const memberId     = assigneeHref.split("/").pop();
        // Calcul jours de retard sans parsing UTC
        const dueMs  = new Date(t.dueDate).getTime();
        const nowMs  = Date.now();
        const daysLate = Math.ceil((nowMs - dueMs) / 86400000);
        return {
          id:       t.id,
          subject:  t.subject,
          dueDate:  t.dueDate,
          daysLate: Math.max(1, daysLate),
          assignee: memberMap[memberId] || null,
          hours:    parseHours(t.estimatedTime),
        };
      })
      .sort((a, b) => b.daysLate - a.daysLate);

    // ── 6. Données Gantt ───────────────────────────────────────────────────
    const today = todayLocalStr();

    const ganttTasks = tasks
      .filter(t => t.startDate || t.dueDate)
      .map(t => {
        const assigneeHref = t._links?.assignee?.href || "";
        const memberId     = assigneeHref.split("/").pop();
        const isDoneTask   = isTaskDone(t);
        const isLateTask   = isTaskLate(t);

        // Calcul retard en jours (pour affichage dans le Gantt)
        let daysLate = 0;
        if (isLateTask && t.dueDate) {
          daysLate = Math.max(1, Math.ceil(
            (Date.now() - new Date(t.dueDate).getTime()) / 86400000
          ));
        }

        return {
          id:              t.id,
          subject:         t.subject,
          startDate:       t.startDate || t.dueDate,
          dueDate:         t.dueDate   || t.startDate,
          done:            isDoneTask,
          late:            isLateTask,
          daysLate,
          assignee:        memberMap[memberId] || null,
          hours:           parseHours(t.estimatedTime),
          status:          t._links?.status?.title || "",
          percentageDone:  Number(t.percentageDone ?? t.percentComplete ?? 0),
          // ── Champs supplémentaires pour le Gantt enrichi ─────────────────
          type:            t._links?.type?.title   || "",
          priority:        t._links?.priority?.title || "",
          version:         t._links?.version?.title  || "",
          isClosed:        t.isClosed === true,
        };
      })
      .sort((a, b) => toMs(a.startDate) - toMs(b.startDate));

    // ── 7. Vélocité hebdomadaire ───────────────────────────────────────────
    const weeklyVelocity = {};
    tasks.filter(isTaskDone).forEach(t => {
      const ref = t.updatedAt || t.dueDate;
      if (!ref) return;
      const d   = new Date(ref);
      const mon = new Date(d);
      mon.setDate(d.getDate() - d.getDay() + 1);
      const key = mon.toISOString().slice(0, 10);
      weeklyVelocity[key] = (weeklyVelocity[key] || 0) + 1;
    });

    return res.json({
      projectId:      Number(projectId),
      computedAt:     new Date().toISOString(),
      kpis: {
        total,
        done,
        late,
        inProgress,
        todo:          total - done - inProgress,
        totalHours:    Math.round(totalHours * 10) / 10,
        doneHours:     Math.round(doneHours  * 10) / 10,
        progressCount,
        progressHours,
        workload:      meta.workload    || null,
        startDate:     meta.startDate   || null,
        endDate:       meta.endDate     || null,
      },
      statusDist,
      workloadByMember,
      lateTasks,
      ganttTasks,
      weeklyVelocity,
    });

  } catch (err) {
    console.error("Erreur stats projet:", err.response?.data || err.message);
    return res.status(500).json({
      message: "Erreur lors du calcul des statistiques.",
      detail:  err.response?.data || err.message,
    });
  }
});

module.exports = router;