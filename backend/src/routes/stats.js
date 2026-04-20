const express = require("express");
const router  = express.Router({ mergeParams: true });
const { getTasks, getMembers } = require("../services/openproject");
const { getProjectMeta }       = require("../database/db");

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════

function isTaskDone(task) {
  const s = (task._links?.status?.title || "").toLowerCase();
  return s.includes("closed") || s.includes("terminé") || s.includes("done");
}

function isTaskLate(task) {
  if (!task.dueDate || isTaskDone(task)) return false;
  return new Date(task.dueDate) < new Date();
}

/** PT8H → 8  |  null/undefined → 0 */
function parseHours(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT([\d.]+)H/);
  return m ? parseFloat(m[1]) : 0;
}

/** "2024-03-01" → timestamp ms (midnight UTC) */
function toMs(dateStr) {
  return dateStr ? new Date(dateStr).getTime() : null;
}

// ══════════════════════════════════════════════════════════════
//  GET /api/projects/:projectId/stats
// ══════════════════════════════════════════════════════════════
router.get("/", async (req, res) => {
  const { projectId } = req.params;
  const opToken       = req.user.opToken;

  try {
    const [tasks, members] = await Promise.all([
      getTasks(projectId, opToken),
      getMembers(opToken),
    ]);

    const meta = getProjectMeta(projectId) || {};

    // ── 1. KPIs de base ────────────────────────────────────────
    const total    = tasks.length;
    const done     = tasks.filter(isTaskDone).length;
    const late     = tasks.filter(isTaskLate).length;
    const inProgress = tasks.filter(t => {
      const s = (t._links?.status?.title || "").toLowerCase();
      return !isTaskDone(t) && (s.includes("progress") || s.includes("cours"));
    }).length;

    // ── 2. Progression par heures (plus précise que par count) ─
    const totalHours    = tasks.reduce((s, t) => s + parseHours(t.estimatedTime), 0);
    const doneHours     = tasks.filter(isTaskDone).reduce((s, t) => s + parseHours(t.estimatedTime), 0);
    const progressCount = total > 0 ? Math.round((done  / total) * 100) : 0;
    const progressHours = totalHours > 0 ? Math.round((doneHours / totalHours) * 100) : 0;

    // ── 3. Charge par membre ────────────────────────────────────
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

    // ── 4. Distribution par statut ─────────────────────────────
    const statusDist = {};
    tasks.forEach(t => {
      const label = t._links?.status?.title || "Inconnu";
      statusDist[label] = (statusDist[label] || 0) + 1;
    });

    // ── 5. Tâches en retard (détail pour alertes) ───────────────
    const lateTasks = tasks
      .filter(isTaskLate)
      .map(t => {
        const assigneeHref = t._links?.assignee?.href || "";
        const memberId     = assigneeHref.split("/").pop();
        const daysLate     = Math.ceil((new Date() - new Date(t.dueDate)) / 86400000);
        return {
          id:        t.id,
          subject:   t.subject,
          dueDate:   t.dueDate,
          daysLate,
          assignee:  memberMap[memberId] || null,
          hours:     parseHours(t.estimatedTime),
        };
      })
      .sort((a, b) => b.daysLate - a.daysLate);

    // ── 6. Données Gantt ────────────────────────────────────────
    const ganttTasks = tasks
      .filter(t => t.startDate || t.dueDate)
      .map(t => {
        const assigneeHref = t._links?.assignee?.href || "";
        const memberId     = assigneeHref.split("/").pop();
        return {
          id:        t.id,
          subject:   t.subject,
          startDate: t.startDate || t.dueDate,
          dueDate:   t.dueDate   || t.startDate,
          done:      isTaskDone(t),
          late:      isTaskLate(t),
          assignee:  memberMap[memberId] || null,
          hours:     parseHours(t.estimatedTime),
          status:    t._links?.status?.title || "",
        };
      })
      .sort((a, b) => toMs(a.startDate) - toMs(b.startDate));

    // ── 7. Vélocité hebdomadaire (tâches closes par semaine) ────
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

    // ── Réponse ────────────────────────────────────────────────
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
        workload:      meta.workload || null,
        startDate:     meta.startDate || null,
        endDate:       meta.endDate   || null,
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