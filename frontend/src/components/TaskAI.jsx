import { useState } from "react";
import { fetchTaskPlan, fetchTaskGuide, fetchTaskBlockage } from "../services/api";

export default function TaskAI({ task, projectId }) {
  const [plan, setPlan] = useState(null);
  const [guide, setGuide] = useState(null);
  const [blockage, setBlockage] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);
  const [blockageLoading, setBlockageLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(null);
  const [error, setError] = useState(null);

  const C = {
    green: "#c2c395", greenLight: "#f5f6ec", greenMid: "#dfe0c0", greenDark: "#5a6332",
    pink: "#d4538a", pinkLight: "#fce7f3", pinkDark: "#7d1f52",
    blue: "#5a8ac4", blueLight: "#eaf2fb",
    orange: "#d4874a", orangeLight: "#fef3e8",
    red: "#b23a3a", redLight: "#fdecea",
    purple: "#9b8dc2", purpleLight: "#f3f0fa",
    text: "#2d2d2a", textMuted: "#6e6e68", textLight: "#aaaaaa",
    border: "#e8e8e0",
  };

  const btn = (active, activeColor, activeBg, inactiveBg, inactiveColor) => ({
    padding: "7px 14px", borderRadius: "999px", border: "none", cursor: "pointer",
    background: active ? activeColor : inactiveBg,
    color: active ? "#fff" : inactiveColor,
    fontSize: "12px", fontWeight: "700", transition: "all 0.18s ease",
  });

  const getDesc = () => {
    const d = task?.description;
    if (!d) return task?.subject || "";
    if (typeof d === "string") return d;
    return d.raw || d.html?.replace(/<[^>]*>/g, "") || task?.subject || "";
  };

  const loadPlan = async () => {
    if (plan) { setActiveTab("plan"); return; }
    setPlanLoading(true); setError(null);
    try {
      const res = await fetchTaskPlan({
        title: task.subject,
        description: getDesc(),
        type: task._links?.type?.title || "Développement",
        estimatedHours: task.estimatedTime || null,
      });
      setPlan(res.data);
      setActiveTab("plan");
    } catch (err) {
      setError(err.response?.data?.message || "Erreur IA. Réessaie.");
    } finally { setPlanLoading(false); }
  };

  const loadGuide = async () => {
    if (guide) { setActiveTab("guide"); return; }
    setGuideLoading(true); setError(null);
    try {
      const res = await fetchTaskGuide({
        title: task.subject,
        description: getDesc(),
      });
      setGuide(res.data);
      setActiveTab("guide");
    } catch (err) {
      setError(err.response?.data?.message || "Erreur IA. Réessaie.");
    } finally { setGuideLoading(false); }
  };

  const loadBlockage = async () => {
    if (blockage) { setActiveTab("blockage"); return; }
    setBlockageLoading(true); setError(null);
    try {
      const res = await fetchTaskBlockage({
        title: task.subject,
        description: getDesc(),
        status: task._links?.status?.title || "Nouveau",
        daysStuck: null,
      });
      setBlockage(res.data);
      setActiveTab("blockage");
    } catch (err) {
      setError(err.response?.data?.message || "Erreur IA. Réessaie.");
    } finally { setBlockageLoading(false); }
  };

  const urgencyStyle = (u) => {
    if (u === "haute") return { bg: C.redLight, color: C.red, border: "#f5c6c6" };
    if (u === "moyenne") return { bg: C.orangeLight, color: C.orange || "#7a4520", border: "#fdd9b5" };
    return { bg: C.greenLight, color: C.greenDark, border: C.greenMid };
  };

  const priorityStyle = (p) => {
    if (p === "haute") return C.red;
    if (p === "moyenne") return "#d4874a";
    return C.greenDark;
  };

  return (
    <div style={{ marginTop: "14px", borderTop: `1px solid ${C.border}`, paddingTop: "14px" }}>
      {/* BOUTONS IA */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" }}>
        <button onClick={loadPlan} disabled={planLoading}
          style={btn(activeTab==="plan", C.blue, C.blueLight, C.blueLight, C.blue)}>
          {planLoading ? "⏳ Génération..." : "📋 Plan de travail"}
        </button>
        <button onClick={loadGuide} disabled={guideLoading}
          style={btn(activeTab==="guide", C.purple, C.purpleLight, C.purpleLight, C.purple)}>
          {guideLoading ? "⏳ Génération..." : "🎓 Guide Q&R"}
        </button>
        <button onClick={loadBlockage} disabled={blockageLoading}
          style={btn(activeTab==="blockage", C.red, C.redLight, C.redLight, C.red)}>
          {blockageLoading ? "⏳ Analyse..." : "🚨 Détecter blocage"}
        </button>
        {activeTab && (
          <button onClick={() => setActiveTab(null)}
            style={{ padding:"7px 10px", borderRadius:"999px", border:`1px solid ${C.border}`, background:"#fff", color:C.textMuted, fontSize:"12px", cursor:"pointer" }}>
            ✕ Fermer
          </button>
        )}
      </div>

      {/* ERREUR */}
      {error && (
        <div style={{ background: C.redLight, color: C.red, border: "1px solid #f5c6c6", padding: "10px 14px", borderRadius: "12px", fontSize: "12px", marginBottom: "10px", fontWeight: "600" }}>
          ❌ {error}
        </div>
      )}

      {/* PLAN DE TRAVAIL */}
      {activeTab === "plan" && plan && (
        <div style={{ background: C.blueLight, borderRadius: "14px", padding: "14px", border: "1px solid #c5daf5" }}>
          <p style={{ fontWeight: "700", color: C.blue, marginBottom: "10px", fontSize: "13px" }}>
            📋 {plan.summary}
          </p>

          {plan.steps?.length > 0 && (
            <div style={{ marginBottom: "10px" }}>
              <p style={{ fontSize: "11px", color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: "700", marginBottom: "7px" }}>Étapes</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {plan.steps.map((step, i) => (
                  <div key={i} style={{ background: "#fff", borderRadius: "10px", padding: "10px 12px", borderLeft: `3px solid ${C.blue}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                      <p style={{ fontWeight: "700", fontSize: "12px", color: C.text, margin: 0 }}>
                        {step.order}. {step.title}
                      </p>
                      <span style={{ fontSize: "10px", color: C.textMuted, background: "#f0f0f0", padding: "2px 8px", borderRadius: "999px" }}>⏱ {step.duration}</span>
                    </div>
                    <p style={{ fontSize: "11px", color: C.textMuted, margin: 0, lineHeight: 1.5 }}>{step.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.tips?.length > 0 && (
            <div style={{ marginBottom: "10px" }}>
              <p style={{ fontSize: "11px", color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: "700", marginBottom: "6px" }}>💡 Conseils</p>
              {plan.tips.map((tip, i) => (
                <p key={i} style={{ fontSize: "11px", color: C.text, marginBottom: "3px", paddingLeft: "8px", borderLeft: `2px solid ${C.blue}` }}>• {tip}</p>
              ))}
            </div>
          )}

          {plan.tools?.length > 0 && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: "700", color: C.text }}>🛠 Outils :</span>
              {plan.tools.map((tool, i) => (
                <span key={i} style={{ background: "#fff", color: C.blue, border: "1px solid #c5daf5", fontSize: "10px", padding: "2px 9px", borderRadius: "999px", fontWeight: "600" }}>{tool}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* GUIDE Q&R */}
      {activeTab === "guide" && guide && (
        <div style={{ background: C.purpleLight, borderRadius: "14px", padding: "14px", border: "1px solid #d4c9f5" }}>
          <p style={{ fontWeight: "700", color: C.purple, marginBottom: "12px", fontSize: "13px" }}>
            🎓 {guide.introduction}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
            {guide.qna?.map((item, i) => (
              <div key={i} style={{ background: "#fff", borderRadius: "10px", padding: "10px 12px", borderLeft: `3px solid ${C.purple}` }}>
                <p style={{ fontWeight: "700", fontSize: "12px", color: "#4a3a7a", marginBottom: "5px" }}>❓ {item.question}</p>
                <p style={{ fontSize: "12px", color: C.text, lineHeight: 1.6, margin: 0 }}>💬 {item.answer}</p>
              </div>
            ))}
          </div>
          {guide.motivation && (
            <div style={{ background: "#fff", borderRadius: "10px", padding: "10px 12px", textAlign: "center", border: `1px solid #d4c9f5` }}>
              <p style={{ fontSize: "12px", color: C.purple, fontStyle: "italic", margin: 0, fontWeight: "600" }}>✨ {guide.motivation}</p>
            </div>
          )}
        </div>
      )}

      {/* DÉTECTION BLOCAGE */}
      {activeTab === "blockage" && blockage && (
        <div style={{ background: blockage.isBlocked ? C.redLight : C.greenLight, borderRadius: "14px", padding: "14px", border: `1px solid ${blockage.isBlocked ? "#f5c6c6" : C.greenMid}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
            <p style={{ fontWeight: "700", color: blockage.isBlocked ? C.red : C.greenDark, fontSize: "13px", margin: 0 }}>
              {blockage.isBlocked ? "🔴 Tâche potentiellement bloquée" : "🟢 Aucun blocage détecté"}
            </p>
            {blockage.urgency && (() => {
              const us = urgencyStyle(blockage.urgency);
              return (
                <span style={{ background: us.bg, color: us.color, border: `1px solid ${us.border}`, fontSize: "10px", padding: "2px 9px", borderRadius: "999px", fontWeight: "700" }}>
                  Urgence : {blockage.urgency}
                </span>
              );
            })()}
          </div>

          <div style={{ background: "#fff", borderRadius: "10px", padding: "10px 12px", marginBottom: "10px" }}>
            <p style={{ fontSize: "12px", color: C.text, margin: 0, lineHeight: 1.6 }}>
              📌 {blockage.reason}
            </p>
          </div>

          {blockage.solutions?.length > 0 && (
            <>
              <p style={{ fontSize: "11px", color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: "700", marginBottom: "7px" }}>💡 Solutions proposées</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {blockage.solutions.map((sol, i) => (
                  <div key={i} style={{ background: "#fff", borderRadius: "10px", padding: "10px 12px", borderLeft: `3px solid ${priorityStyle(sol.priority)}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                      <p style={{ fontWeight: "700", fontSize: "12px", color: C.text, margin: 0 }}>🔧 {sol.title}</p>
                      <span style={{ fontSize: "10px", color: priorityStyle(sol.priority), fontWeight: "700", background: "#f5f5f5", padding: "2px 8px", borderRadius: "999px" }}>
                        {sol.priority}
                      </span>
                    </div>
                    <p style={{ fontSize: "11px", color: C.textMuted, margin: 0, lineHeight: 1.5 }}>{sol.description}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}