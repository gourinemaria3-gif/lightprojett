"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Service — riskAndProgress.js  (v5)
//
//  CORRECTIONS vs v4 :
//    1. getEstimatedHours : supporte P2DT2h (jours + heures ISO 8601)
//    2. computeRiskScore  : blockedTasks = blockedNotLate seulement
//       (était : blockedNotLate + lateCount → comptait les retards 2 fois)
//    3. syncOneProject    : aiSummary persisté avec stats.explanation
//       (était : meta.ai_summary → l'ancienne valeur, jamais rafraîchie)
// ══════════════════════════════════════════════════════════════════════════════
const { isDone: isTaskDone, DONE_STATUSES } = require("../utils/taskStatus");

// ──────────────────────────────────────────────────────────────────────────────
//  todayStr — date locale au format "YYYY-MM-DD" (pas de décalage UTC)
// ──────────────────────────────────────────────────────────────────────────────
function todayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}


// ──────────────────────────────────────────────────────────────────────────────
//  getEstimatedHours — CORRECTION 1
//
//  OpenProject peut retourner des durées en format ISO 8601 mixte :
//    "PT8H"     → 8h
//    "PT1.5H"   → 1.5h
//    "P2DT2H"   → 2 jours × 8h + 2h = 18h  ← était raté par l'ancienne regex
//    "P1D"      → 1 jour × 8h = 8h
//
//  On extrait séparément les jours (D) et les heures (H après T).
// ──────────────────────────────────────────────────────────────────────────────
function getEstimatedHours(task) {
  const raw = task.estimatedTime || task.derivedEstimatedTime;
  if (!raw) return 0;
  const str   = String(raw).toUpperCase();
  const days  = Number(str.match(/(\d+(?:\.\d+)?)D/)?.[1]  ?? 0);
  const hours = Number(str.match(/T(\d+(?:\.\d+)?)H/)?.[1] ?? 0);
  return days * 8 + hours;
}

// ──────────────────────────────────────────────────────────────────────────────
//  isTaskLate — comparaison string "YYYY-MM-DD" sans parsing UTC
// ──────────────────────────────────────────────────────────────────────────────
function isTaskLate(task, today) {
  if (!task.dueDate) return false;
  const due = String(task.dueDate).slice(0, 10);
  return due < today;
}

// ──────────────────────────────────────────────────────────────────────────────
//  computeProgress — mode "tout ou rien" sur les estimations
// ──────────────────────────────────────────────────────────────────────────────
function computeProgress(tasks) {
  if (!tasks || tasks.length === 0) {
    return { progress: 0, estimatesComplete: true, missingEstimates: 0 };
  }

  const tasksWithEstimate = tasks.filter(t => getEstimatedHours(t) > 0);
  const missingEstimates  = tasks.length - tasksWithEstimate.length;
  const estimatesComplete = missingEstimates === 0;

  let totalWeight = 0;
  let doneWeight  = 0;

  for (const task of tasks) {
    const weight = estimatesComplete ? getEstimatedHours(task) : 1;
    totalWeight += weight;

    if (isTaskDone(task)) {
      doneWeight += weight;
    } else {
      const pct = Number(task.percentageDone ?? task.percentComplete ?? 0);
      if (pct > 0 && pct < 100) {
        doneWeight += weight * (pct / 100);
      }
    }
  }

  if (totalWeight === 0) {
    return { progress: 0, estimatesComplete, missingEstimates };
  }

  return {
    progress:          Math.min(100, Math.round((doneWeight / totalWeight) * 100)),
    estimatesComplete,
    missingEstimates,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  computeElapsedPercent — % du temps projet écoulé
// ──────────────────────────────────────────────────────────────────────────────
function computeElapsedPercent(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate).getTime();
  const end   = new Date(endDate).getTime();
  const now   = Date.now();
  const total = end - start;
  if (total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round(((now - start) / total) * 100)));
}

// ──────────────────────────────────────────────────────────────────────────────
//  inferProjectDates — déduit min/max depuis les tâches si projet sans dates
// ──────────────────────────────────────────────────────────────────────────────
function inferProjectDates(tasks) {
  const timestamps = tasks
    .flatMap(t => [t.startDate, t.dueDate])
    .filter(Boolean)
    .map(d => new Date(d).getTime())
    .filter(n => !isNaN(n));

  if (timestamps.length === 0) return null;
  return {
    inferredStart: new Date(Math.min(...timestamps)).toISOString(),
    inferredEnd:   new Date(Math.max(...timestamps)).toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  computeRiskScore — CORRECTION 2
//
//  blockedTasks retourne désormais blockedNotLate seulement.
//  Avant : blockedNotLate + lateCount → les tâches en retard étaient
//  comptées dans lateTasks ET dans blockedTasks, d'où l'affichage "2 bloquées"
//  alors qu'une seule tâche était réellement bloquée.
// ──────────────────────────────────────────────────────────────────────────────
function computeRiskScore({ tasks, taskExtensions = [], startDate, endDate, progress }) {
  if (!tasks || tasks.length === 0) {
    return {
      score: 0, lateTasks: 0, blockedTasks: 0,
      isPartial: false,
      explanation: "Aucune tâche dans le projet.",
      debug: {},
    };
  }

  const today = todayStr();

  const activeTasks = tasks.filter(t => !isTaskDone(t));
  const activeOrOne = Math.max(activeTasks.length, 1);

  // Index des tâches bloquées (depuis DB locale)
  const blockedSet = new Set(
    (taskExtensions || [])
      .filter(e => e.is_blocked === 1 || e.is_blocked === true)
      .map(e => Number(e.op_task_id))
  );

  // ── A : tâches en retard ─────────────────────────────────────────────────
  let lateCount      = 0;
  let blockedNotLate = 0;

  for (const task of activeTasks) {
    const late      = isTaskLate(task, today);
    const isBlocked = blockedSet.has(Number(task.id));

    if (late) {
      lateCount++;
      // Anti double-peine : tâche en retard non comptée dans B
    } else if (isBlocked) {
      blockedNotLate++;
    }
  }

  const scoreA = Math.min(40, Math.round((lateCount      / activeOrOne) * 40));
  const scoreB = Math.min(30, Math.round((blockedNotLate / activeOrOne) * 30));

  // ── C : avancement vs temps écoulé ───────────────────────────────────────
  let scoreC       = 0;
  let elapsedPct   = null;
  let usedInferred = false;
  let isPartial    = false;

  if (startDate && endDate) {
    elapsedPct = computeElapsedPercent(startDate, endDate);
  }
  if (elapsedPct === null) {
    const inferred = inferProjectDates(tasks);
    if (inferred) {
      elapsedPct   = computeElapsedPercent(inferred.inferredStart, inferred.inferredEnd);
      usedInferred = true;
    }
  }

  if (elapsedPct !== null) {
    const retard = elapsedPct - (progress || 0);
    if (retard > 0) {
      scoreC = Math.min(30, Math.round((retard / 100) * 30));
    }
  } else {
    isPartial = true;
  }

  // ── Score final ───────────────────────────────────────────────────────────
  const totalScore = Math.min(100, scoreA + scoreB + scoreC);

  // ── Explication lisible ───────────────────────────────────────────────────
  const parts = [];
  if (lateCount > 0)
    parts.push(`${lateCount} tâche(s) en retard (${scoreA}/40)`);
  if (blockedNotLate > 0)
    parts.push(`${blockedNotLate} tâche(s) bloquée(s) (${scoreB}/30)`);
  if (scoreC > 0)
    parts.push(`avancement ${progress}% vs ${elapsedPct}% écoulé${usedInferred ? " [dates inférées]" : ""} (${scoreC}/30)`);
  if (isPartial)
    parts.push("score partiel — aucune date de projet ni de tâche disponible (max 70/100)");
  if (parts.length === 0)
    parts.push("projet dans les temps, aucun signal d'alerte");

  return {
    score:        totalScore,
    lateTasks:    lateCount,
    blockedTasks: blockedNotLate, // ✅ CORRECTION 2 : était blockedNotLate + lateCount
    isPartial,
    explanation:  parts.join(" | "),
    debug: {
      scoreA, scoreB, scoreC,
      lateCount, blockedNotLate,
      activeTasks: activeTasks.length,
      elapsedPct, progress, usedInferred,
      today,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  computeProjectStats — point d'entrée principal
// ──────────────────────────────────────────────────────────────────────────────
function computeProjectStats(tasks, projectMeta = {}, taskExtensions = []) {
  const progressResult = computeProgress(tasks);

  const riskResult = computeRiskScore({
    tasks,
    taskExtensions,
    startDate: projectMeta.start_date,
    endDate:   projectMeta.end_date,
    progress:  progressResult.progress,
  });

  return {
    progress:          progressResult.progress,
    estimatesComplete: progressResult.estimatesComplete,
    missingEstimates:  progressResult.missingEstimates,
    riskScore:         riskResult.score,
    lateTasks:         riskResult.lateTasks,
    blockedTasks:      riskResult.blockedTasks,
    isPartial:         riskResult.isPartial,
    explanation:       riskResult.explanation,
    debug:             riskResult.debug,
  };
}

module.exports = {
  computeProgress,
  computeRiskScore,
  computeElapsedPercent,
  computeProjectStats,
  getEstimatedHours,
  inferProjectDates,
  isTaskDone,
  isTaskLate,
  todayStr,
};