import React, { useState, useEffect, useCallback } from "react";
import {
  fetchBudgetSummary,
  fetchBudgetByTask,
  fetchBudgetTimeline,
  updateBudget,
  setTaskEstimatedHours,
  setTaskMemberRate,
} from "../services/api";

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function fmtDA(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("fr-DZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " DA";
}

function pct(used, total) {
  if (!total || total === 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function statusColor(status) {
  if (status === "danger")   return "#F76C6C";
  if (status === "warning")  return "#F8E9A1";
  if (status === "ok")       return "#6dc87a";
  return "rgba(255,255,255,0.2)";
}

function statusLabel(status) {
  if (status === "danger")   return "⚠️ Dépassé";
  if (status === "warning")  return "🟡 À surveiller";
  if (status === "ok")       return "✅ OK";
  return "—";
}

// ─────────────────────────────────────────────
//  Mini sparkline SVG (timeline)
// ─────────────────────────────────────────────
function Sparkline({ data, color = "#6dc87a", budgetTotal }) {
  if (!data || data.length < 2) return null;
  const max    = Math.max(...data.map((d) => d.cumulativeCost), budgetTotal || 0, 1);
  const W      = 400;
  const H      = 80;
  const pts    = data.map((d, i) => [
    (i / (data.length - 1)) * W,
    H - (d.cumulativeCost / max) * H * 0.9,
  ]);
  const path   = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area   = `${path} L${W},${H} L0,${H} Z`;
  const budgetY = budgetTotal ? H - (budgetTotal / max) * H * 0.9 : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-grad)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {budgetY !== null && (
        <line x1="0" y1={budgetY} x2={W} y2={budgetY}
          stroke="#F76C6C" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7" />
      )}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={color} opacity="0.8" />
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
//  BUDGET PANEL — vue membre
// ═══════════════════════════════════════════════════════════════
export function MemberBudgetPanel({ projectId, tasks, userId }) {
  const [taskBudgets,  setTaskBudgets]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [rateInputs,   setRateInputs]   = useState({});
  const [savingRate,   setSavingRate]   = useState(null);
  const [saveMsg,      setSaveMsg]      = useState({});

  const myTasks = tasks.filter((t) =>
    t._links?.assignee?.href?.endsWith(`/${userId}`)
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchBudgetByTask(projectId);
      setTaskBudgets(data || []);
    } catch {
      setTaskBudgets([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function handleSaveRate(taskId) {
    const rate = Number(rateInputs[taskId]);
    if (!rate || rate <= 0) return;
    setSavingRate(taskId);
    try {
      await setTaskMemberRate(projectId, taskId, rate);
      setSaveMsg((p) => ({ ...p, [taskId]: "✅ Taux enregistré" }));
      setTimeout(() => setSaveMsg((p) => ({ ...p, [taskId]: null })), 3000);
      await load();
    } catch (err) {
      setSaveMsg((p) => ({ ...p, [taskId]: `⚠️ ${err.message}` }));
    } finally {
      setSavingRate(null);
    }
  }

  if (loading) return <div style={styles.loading}>Chargement…</div>;

  return (
    <div style={styles.panel}>
      <div style={styles.sectionTitle}>💰 Mon taux horaire par tâche</div>
      <p style={styles.hint}>
        Déclarez votre taux horaire (DA/h) pour chaque tâche qui vous est assignée.
        Le coût estimé et réel sera calculé automatiquement.
      </p>

      {myTasks.length === 0 ? (
        <div style={styles.empty}>Aucune tâche assignée.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {myTasks.map((task) => {
            const ext = taskBudgets.find((b) => String(b.taskId) === String(task.id));
            const currentRate    = ext?.memberRate    ?? null;
            const estimatedCost  = ext?.estimatedCost ?? null;
            const actualCost     = ext?.actualCost    ?? null;
            const hoursLogged    = ext?.hoursLogged   ?? 0;
            const estimatedHours = ext?.estimatedHours ?? null;
            const inputVal = rateInputs[task.id] ?? (currentRate ?? "");

            return (
              <div key={task.id} style={styles.taskCard}>
                <div style={styles.taskCardHeader}>
                  <span style={styles.taskCardTitle}>{task.subject}</span>
                  {currentRate && (
                    <span style={styles.ratePill}>{currentRate} DA/h</span>
                  )}
                </div>
                <div style={styles.taskCardGrid}>
                  <div style={styles.taskCardStat}>
                    <span style={styles.statLabel}>Heures estimées</span>
                    <span style={styles.statVal}>{estimatedHours ? `${estimatedHours}h` : "—"}</span>
                  </div>
                  <div style={styles.taskCardStat}>
                    <span style={styles.statLabel}>Heures loggées</span>
                    <span style={styles.statVal}>{hoursLogged ? `${hoursLogged}h` : "—"}</span>
                  </div>
                  <div style={styles.taskCardStat}>
                    <span style={styles.statLabel}>Coût estimé</span>
                    <span style={styles.statVal}>{fmtDA(estimatedCost)}</span>
                  </div>
                  <div style={styles.taskCardStat}>
                    <span style={styles.statLabel}>Coût réel</span>
                    <span style={styles.statVal}>{fmtDA(actualCost)}</span>
                  </div>
                </div>
                <div style={styles.rateRow}>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    placeholder="Taux DA/h"
                    value={inputVal}
                    onChange={(e) =>
                      setRateInputs((p) => ({ ...p, [task.id]: e.target.value }))
                    }
                    style={styles.rateInput}
                  />
                  <button
                    style={styles.saveBtn}
                    onClick={() => handleSaveRate(task.id)}
                    disabled={savingRate === task.id}
                  >
                    {savingRate === task.id ? "…" : "Enregistrer"}
                  </button>
                  {saveMsg[task.id] && (
                    <span style={{ fontSize: 12, color: "#6dc87a" }}>{saveMsg[task.id]}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  BUDGET PANEL — vue manager / admin
//  ✅ FIX : le manager peut déclarer son taux pour ses propres tâches
// ═══════════════════════════════════════════════════════════════
export function ManagerBudgetPanel({ projectId, isAdmin, tasks, userId }) {
  // ↑ userId est maintenant passé depuis ProjectDetailPage

  const [summary,     setSummary]     = useState(null);
  const [taskBudgets, setTaskBudgets] = useState([]);
  const [timeline,    setTimeline]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState("summary");

  // Budget total (admin)
  const [budgetInput,  setBudgetInput]  = useState("");
  const [savingBudget, setSavingBudget] = useState(false);
  const [budgetMsg,    setBudgetMsg]    = useState(null);

  // Heures estimées par tâche (manager)
  const [hoursInputs, setHoursInputs] = useState({});
  const [savingHours, setSavingHours] = useState(null);
  const [hoursMsg,    setHoursMsg]    = useState({});

  // ✅ Taux horaire — pour les tâches assignées au manager lui-même
  const [rateInputs, setRateInputs] = useState({});
  const [savingRate, setSavingRate] = useState(null);
  const [rateMsg,    setRateMsg]    = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, tl] = await Promise.all([
        fetchBudgetSummary(projectId),
        fetchBudgetByTask(projectId),
        fetchBudgetTimeline(projectId),
      ]);
      setSummary(s);
      setTaskBudgets(t || []);
      setTimeline(tl || []);
      if (s?.budgetTotal) setBudgetInput(s.budgetTotal);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function handleSaveBudget() {
    const val = Number(budgetInput);
    if (isNaN(val) || val < 0) return;
    setSavingBudget(true);
    try {
      await updateBudget(projectId, val);
      setBudgetMsg("✅ Budget mis à jour");
      setTimeout(() => setBudgetMsg(null), 3000);
      await load();
    } catch (err) {
      setBudgetMsg(`⚠️ ${err.message}`);
    } finally {
      setSavingBudget(false);
    }
  }

  async function handleSaveHours(taskId) {
    const hours = Number(hoursInputs[taskId]);
    if (!hours || hours <= 0) return;
    setSavingHours(taskId);
    try {
      await setTaskEstimatedHours(projectId, taskId, hours);
      setHoursMsg((p) => ({ ...p, [taskId]: "✅ Enregistré" }));
      setTimeout(() => setHoursMsg((p) => ({ ...p, [taskId]: null })), 3000);
      await load();
    } catch (err) {
      setHoursMsg((p) => ({ ...p, [taskId]: `⚠️ ${err.message}` }));
    } finally {
      setSavingHours(null);
    }
  }

  // ✅ NOUVEAU : enregistrer le taux du manager pour sa propre tâche
  async function handleSaveRate(taskId) {
    const rate = Number(rateInputs[taskId]);
    if (!rate || rate <= 0) return;
    setSavingRate(taskId);
    try {
      await setTaskMemberRate(projectId, taskId, rate);
      setRateMsg((p) => ({ ...p, [taskId]: "✅ Taux enregistré" }));
      setTimeout(() => setRateMsg((p) => ({ ...p, [taskId]: null })), 3000);
      await load();
    } catch (err) {
      setRateMsg((p) => ({ ...p, [taskId]: `⚠️ ${err.message}` }));
    } finally {
      setSavingRate(null);
    }
  }

  if (loading) return <div style={styles.loading}>Chargement du budget…</div>;
  if (!summary) return <div style={styles.empty}>Impossible de charger le budget.</div>;

  const color     = statusColor(summary.status);
  const consumed  = pct(summary.actualCost, summary.budgetTotal);
  const estimated = pct(summary.estimatedCost, summary.budgetTotal);

  return (
    <div style={styles.panel}>

      {/* ── TABS ── */}
      <div style={styles.tabs}>
        {["summary", "tasks", "timeline"].map((tab) => (
          <button
            key={tab}
            style={{ ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) }}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "summary"  && "📊 Résumé"}
            {tab === "tasks"    && "📋 Par tâche"}
            {tab === "timeline" && "📈 Timeline"}
          </button>
        ))}
      </div>

      {/* ══ RÉSUMÉ ══ */}
      {activeTab === "summary" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          <div style={{ ...styles.statusBanner, borderColor: color + "55", background: color + "0f" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color }}>
              {statusLabel(summary.status)}
            </span>
            {summary.consumedPct !== null && (
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
                {summary.consumedPct}% du budget consommé
              </span>
            )}
          </div>

          {summary.budgetTotal && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                <span>Coût estimé vs budget</span>
                <span>{estimated}%</span>
              </div>
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressFill, width: `${estimated}%`, background: "#A8D0E6", opacity: 0.5 }} />
                <div style={{ ...styles.progressFill, width: `${consumed}%`, background: color, position: "absolute" }} />
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                <span style={{ color: "#A8D0E6" }}>■ Estimé : {fmtDA(summary.estimatedCost)}</span>
                <span style={{ color }}>■ Réel : {fmtDA(summary.actualCost)}</span>
              </div>
            </div>
          )}

          <div style={styles.statsGrid}>
            {[
              { label: "Budget total",  val: fmtDA(summary.budgetTotal),   icon: "🎯" },
              { label: "Coût estimé",   val: fmtDA(summary.estimatedCost), icon: "📐" },
              { label: "Coût réel",     val: fmtDA(summary.actualCost),    icon: "⏱" },
              { label: "Restant",       val: fmtDA(summary.remaining),     icon: "💰", color: summary.remaining > 0 ? "#6dc87a" : "#F76C6C" },
              { label: "Dépassement",   val: fmtDA(summary.overrun),       icon: "🔥", color: summary.overrun > 0 ? "#F76C6C" : "#6dc87a" },
            ].map(({ label, val, icon, color: c }) => (
              <div key={label} style={styles.statCard}>
                <span style={styles.statCardIcon}>{icon}</span>
                <span style={styles.statCardLabel}>{label}</span>
                <span style={{ ...styles.statCardVal, ...(c ? { color: c } : {}) }}>{val}</span>
              </div>
            ))}
          </div>

          {isAdmin && (
            <div style={styles.adminSection}>
              <div style={styles.adminTitle}>🔧 Modifier le budget total</div>
              <div style={styles.rateRow}>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  placeholder="Budget en DA"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  style={styles.rateInput}
                />
                <button style={styles.saveBtn} onClick={handleSaveBudget} disabled={savingBudget}>
                  {savingBudget ? "…" : "Enregistrer"}
                </button>
                {budgetMsg && <span style={{ fontSize: 12, color: "#6dc87a" }}>{budgetMsg}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ PAR TÂCHE ══ */}
      {activeTab === "tasks" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={styles.hint}>
            Définissez les heures estimées par tâche. Si une tâche vous est assignée, vous pouvez aussi y déclarer votre taux horaire.
          </p>

          {taskBudgets.length === 0 ? (
            <div style={styles.empty}>Aucune donnée budgétaire par tâche.</div>
          ) : (
            taskBudgets.map((tb) => {
              const task = tasks?.find((t) => String(t.id) === String(tb.taskId));
              const taskName   = task?.subject || `Tâche #${tb.taskId}`;
              const hasOverrun = tb.actualCost > 0 && tb.estimatedCost > 0 && tb.actualCost > tb.estimatedCost;

              // ✅ Vérifier si cette tâche est assignée au manager connecté
              const assigneeHref = task?._links?.assignee?.href || "";
              const isAssignedToMe = userId && assigneeHref.endsWith(`/${userId}`);

              const hoursInputVal = hoursInputs[tb.taskId] ?? (tb.estimatedHours ?? "");
              const rateInputVal  = rateInputs[tb.taskId]  ?? (tb.memberRate     ?? "");

              return (
                <div key={tb.taskId} style={{ ...styles.taskCard, ...(hasOverrun ? { borderColor: "#F76C6C44" } : {}) }}>
                  <div style={styles.taskCardHeader}>
                    <span style={styles.taskCardTitle}>{taskName}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {/* ✅ Badge "Ma tâche" si assignée au manager */}
                      {isAssignedToMe && (
                        <span style={styles.myTaskBadge}>👤 Ma tâche</span>
                      )}
                      {hasOverrun && <span style={{ fontSize: 11, color: "#F76C6C" }}>⚠️ Dépassement</span>}
                    </div>
                  </div>

                  <div style={styles.taskCardGrid}>
                    <div style={styles.taskCardStat}>
                      <span style={styles.statLabel}>Heures estimées</span>
                      <span style={styles.statVal}>{tb.estimatedHours ? `${tb.estimatedHours}h` : "—"}</span>
                    </div>
                    <div style={styles.taskCardStat}>
                      <span style={styles.statLabel}>Heures loggées</span>
                      <span style={styles.statVal}>{tb.hoursLogged ? `${tb.hoursLogged}h` : "—"}</span>
                    </div>
                    <div style={styles.taskCardStat}>
                      <span style={styles.statLabel}>Taux membre</span>
                      <span style={styles.statVal}>{tb.memberRate ? `${tb.memberRate} DA/h` : "—"}</span>
                    </div>
                    <div style={styles.taskCardStat}>
                      <span style={styles.statLabel}>Coût estimé</span>
                      <span style={styles.statVal}>{fmtDA(tb.estimatedCost || null)}</span>
                    </div>
                    <div style={styles.taskCardStat}>
                      <span style={styles.statLabel}>Coût réel</span>
                      <span style={{ ...styles.statVal, color: hasOverrun ? "#F76C6C" : "inherit" }}>
                        {fmtDA(tb.actualCost || null)}
                      </span>
                    </div>
                  </div>

                  {/* ── Fixer heures estimées (manager) ── */}
                  <div style={styles.actionBlock}>
                    <span style={styles.actionLabel}>Heures estimées</span>
                    <div style={styles.rateRow}>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="Heures estimées"
                        value={hoursInputVal}
                        onChange={(e) =>
                          setHoursInputs((p) => ({ ...p, [tb.taskId]: e.target.value }))
                        }
                        style={styles.rateInput}
                      />
                      <button
                        style={styles.saveBtn}
                        onClick={() => handleSaveHours(tb.taskId)}
                        disabled={savingHours === tb.taskId}
                      >
                        {savingHours === tb.taskId ? "…" : "Fixer heures"}
                      </button>
                      {hoursMsg[tb.taskId] && (
                        <span style={{ fontSize: 12, color: "#6dc87a" }}>{hoursMsg[tb.taskId]}</span>
                      )}
                    </div>
                  </div>

                  {/* ✅ Fixer taux horaire — UNIQUEMENT si la tâche est assignée au manager */}
                  {isAssignedToMe && (
                    <div style={{ ...styles.actionBlock, borderTop: "1px solid rgba(168,208,230,0.12)", paddingTop: 10 }}>
                      <span style={{ ...styles.actionLabel, color: "#A8D0E6" }}>
                        💰 Mon taux horaire (DA/h)
                      </span>
                      <div style={styles.rateRow}>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          placeholder="Taux DA/h"
                          value={rateInputVal}
                          onChange={(e) =>
                            setRateInputs((p) => ({ ...p, [tb.taskId]: e.target.value }))
                          }
                          style={{ ...styles.rateInput, borderColor: "rgba(168,208,230,0.25)" }}
                        />
                        <button
                          style={{ ...styles.saveBtn, background: "rgba(168,208,230,0.2)", borderColor: "rgba(168,208,230,0.35)" }}
                          onClick={() => handleSaveRate(tb.taskId)}
                          disabled={savingRate === tb.taskId}
                        >
                          {savingRate === tb.taskId ? "…" : "Enregistrer taux"}
                        </button>
                        {rateMsg[tb.taskId] && (
                          <span style={{ fontSize: 12, color: "#6dc87a" }}>{rateMsg[tb.taskId]}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══ TIMELINE ══ */}
      {activeTab === "timeline" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {timeline.length < 2 ? (
            <div style={styles.empty}>
              Pas assez de données pour afficher la timeline.<br />
              <span style={{ fontSize: 12, opacity: 0.5 }}>
                Les logs de temps avec taux déclaré alimentent ce graphe.
              </span>
            </div>
          ) : (
            <>
              <div style={styles.sparklineWrap}>
                <Sparkline
                  data={timeline}
                  color={statusColor(summary?.status)}
                  budgetTotal={summary?.budgetTotal}
                />
                <div style={styles.sparklineLegend}>
                  <span style={{ color: statusColor(summary?.status) }}>── Coût cumulé réel</span>
                  {summary?.budgetTotal && (
                    <span style={{ color: "#F76C6C", opacity: 0.7 }}>- - Budget total</span>
                  )}
                </div>
              </div>

              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Coût du jour</th>
                    <th style={styles.th}>Coût cumulé</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((row, i) => (
                    <tr key={i} style={i % 2 === 0 ? styles.trEven : {}}>
                      <td style={styles.td}>{row.date}</td>
                      <td style={styles.td}>{fmtDA(row.dailyCost)}</td>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{fmtDA(row.cumulativeCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────
const styles = {
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: "0 0 24px",
  },
  loading: {
    padding: 24,
    color: "rgba(255,255,255,0.4)",
    fontSize: 14,
    textAlign: "center",
  },
  empty: {
    padding: 24,
    color: "rgba(255,255,255,0.3)",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 1.8,
  },
  hint: {
    fontSize: 12,
    color: "rgba(255,255,255,0.35)",
    margin: "0 0 4px",
    lineHeight: 1.6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "rgba(255,255,255,0.85)",
    marginBottom: 4,
  },
  tabs: {
    display: "flex",
    gap: 4,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    paddingBottom: 1,
  },
  tab: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "8px 14px",
    fontSize: 13,
    color: "rgba(255,255,255,0.4)",
    fontWeight: 500,
    borderBottom: "2px solid transparent",
    transition: "all 0.2s",
  },
  tabActive: {
    color: "#A8D0E6",
    borderBottom: "2px solid #A8D0E6",
  },
  statusBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderRadius: 8,
    border: "1px solid",
  },
  progressTrack: {
    position: "relative",
    height: 8,
    borderRadius: 10,
    background: "rgba(255,255,255,0.07)",
    overflow: "hidden",
  },
  progressFill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    borderRadius: 10,
    transition: "width 0.8s ease",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: 10,
  },
  statCard: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px 14px",
    background: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.07)",
  },
  statCardIcon:  { fontSize: 16 },
  statCardLabel: { fontSize: 11, color: "rgba(255,255,255,0.4)" },
  statCardVal:   { fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.85)" },
  adminSection: {
    padding: "14px 16px",
    background: "rgba(255,255,255,0.03)",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.07)",
  },
  adminTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "rgba(255,255,255,0.6)",
    marginBottom: 10,
  },
  taskCard: {
    padding: "14px 16px",
    background: "rgba(255,255,255,0.03)",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  taskCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  taskCardTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "rgba(255,255,255,0.8)",
  },
  taskCardGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px 24px",
  },
  taskCardStat: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  statLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.35)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  statVal: {
    fontSize: 12,
    fontWeight: 600,
    color: "rgba(255,255,255,0.75)",
  },
  ratePill: {
    fontSize: 11,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 20,
    background: "rgba(168,208,230,0.15)",
    color: "#A8D0E6",
    border: "1px solid rgba(168,208,230,0.2)",
  },
  // ✅ Badge "Ma tâche"
  myTaskBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 20,
    background: "rgba(109,200,122,0.15)",
    color: "#6dc87a",
    border: "1px solid rgba(109,200,122,0.25)",
  },
  actionBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  actionLabel: {
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  rateRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  rateInput: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 7,
    padding: "6px 10px",
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    width: 160,
    outline: "none",
  },
  saveBtn: {
    background: "rgba(168,208,230,0.15)",
    border: "1px solid rgba(168,208,230,0.25)",
    borderRadius: 7,
    padding: "6px 14px",
    color: "#A8D0E6",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  sparklineWrap: {
    background: "rgba(255,255,255,0.03)",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.07)",
    padding: "16px 16px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  sparklineLegend: {
    display: "flex",
    gap: 16,
    fontSize: 11,
    color: "rgba(255,255,255,0.35)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: "8px 12px",
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  td: {
    padding: "8px 12px",
    color: "rgba(255,255,255,0.7)",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  trEven: {
    background: "rgba(255,255,255,0.02)",
  },
};