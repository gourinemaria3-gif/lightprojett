import { useState } from 'react'
import { fetchTaskPlan, fetchTaskGuide, fetchTaskBlockage } from '../services/api'
export default function TaskAI({ task }) {
  const [plan, setPlan] = useState(null)
  const [guide, setGuide] = useState(null)
  const [blockage, setBlockage] = useState(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [guideLoading, setGuideLoading] = useState(false)
  const [blockageLoading, setBlockageLoading] = useState(false)
  const [activeTab, setActiveTab] = useState(null)
  const [error, setError] = useState(null)

  const loadPlan = async () => {
    if (plan) { setActiveTab('plan'); return }
    setPlanLoading(true); setError(null)
    try {
      const data = await fetchTaskPlan({
        title: task.subject,
        description: task.description?.raw || task.subject,
        type: task._links?.type?.title || 'Développement',
        estimatedHours: task.estimatedTime || null
      })
      setPlan(data)
      setActiveTab('plan')
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur IA')
    }
    setPlanLoading(false)
  }

  const loadGuide = async () => {
    if (guide) { setActiveTab('guide'); return }
    setGuideLoading(true); setError(null)
    try {
      const data = await fetchTaskGuide({
       title: task.subject,
       description: task.description?.raw || task.subject,
      })
      setGuide(data)
      setActiveTab('guide')
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur IA')
    }
    setGuideLoading(false)
  }

  const loadBlockage = async () => {
    if (blockage) { setActiveTab('blockage'); return }
    setBlockageLoading(true); setError(null)
    try {
      const data = await fetchTaskBlockage({
       title: task.subject,
       description: task.description?.raw || task.subject,
       status: task._links?.status?.title || 'Nouveau',
       daysStuck: null
      })
setBlockage(data)
      setActiveTab('blockage')
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur IA')
    }
    setBlockageLoading(false)
  }

  const urgencyColor = { 'faible': '#22c55e', 'moyenne': '#f59e0b', 'haute': '#ef4444' }
  const priorityColor = { 'haute': '#ef4444', 'moyenne': '#f59e0b', 'faible': '#22c55e' }

  return (
    <div style={{ marginTop: '1rem', borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button onClick={loadPlan} disabled={planLoading} style={{
          padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
          background: activeTab === 'plan' ? '#2563eb' : '#eff6ff',
          color: activeTab === 'plan' ? 'white' : '#2563eb', fontSize: '13px', fontWeight: '600'
        }}>
          {planLoading ? '⏳...' : '📋 Plan de travail'}
        </button>
        <button onClick={loadGuide} disabled={guideLoading} style={{
          padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
          background: activeTab === 'guide' ? '#7c3aed' : '#f5f3ff',
          color: activeTab === 'guide' ? 'white' : '#7c3aed', fontSize: '13px', fontWeight: '600'
        }}>
          {guideLoading ? '⏳...' : '🎓 Guide Q&R'}
        </button>
        <button onClick={loadBlockage} disabled={blockageLoading} style={{
          padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
          background: activeTab === 'blockage' ? '#dc2626' : '#fef2f2',
          color: activeTab === 'blockage' ? 'white' : '#dc2626', fontSize: '13px', fontWeight: '600'
        }}>
          {blockageLoading ? '⏳...' : '🚨 Détecter blocage'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px', borderRadius: '6px', fontSize: '13px', marginBottom: '1rem' }}>
          ❌ {error}
        </div>
      )}

      {activeTab === 'plan' && plan && (
        <div style={{ background: '#eff6ff', borderRadius: '8px', padding: '1rem' }}>
          <p style={{ fontWeight: '600', color: '#1d4ed8', marginBottom: '0.8rem' }}>📋 {plan.summary}</p>
          <h4 style={{ fontSize: '13px', color: '#374151', marginBottom: '0.5rem' }}>Étapes :</h4>
          {plan.steps?.map((step, i) => (
            <div key={i} style={{ background: 'white', borderRadius: '6px', padding: '10px', marginBottom: '6px', borderLeft: '3px solid #2563eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p style={{ fontWeight: '600', fontSize: '13px' }}>{step.order}. {step.title}</p>
                <span style={{ fontSize: '11px', color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: '10px' }}>⏱ {step.duration}</span>
              </div>
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '3px' }}>{step.description}</p>
            </div>
          ))}
          {plan.tips?.length > 0 && (
            <div style={{ marginTop: '0.8rem' }}>
              <h4 style={{ fontSize: '13px', color: '#374151', marginBottom: '4px' }}>💡 Conseils :</h4>
              {plan.tips.map((tip, i) => <p key={i} style={{ fontSize: '12px', color: '#6b7280', marginBottom: '3px' }}>• {tip}</p>)}
            </div>
          )}
          {plan.tools?.length > 0 && (
            <div style={{ marginTop: '0.8rem', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>🛠 Outils :</span>
              {plan.tools.map((tool, i) => (
                <span key={i} style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: '11px', padding: '2px 8px', borderRadius: '10px' }}>{tool}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'guide' && guide && (
        <div style={{ background: '#f5f3ff', borderRadius: '8px', padding: '1rem' }}>
          <p style={{ fontWeight: '600', color: '#7c3aed', marginBottom: '1rem', fontSize: '14px' }}>🎓 {guide.introduction}</p>
          {guide.qna?.map((item, i) => (
            <div key={i} style={{ background: 'white', borderRadius: '6px', padding: '10px', marginBottom: '8px', borderLeft: '3px solid #7c3aed' }}>
              <p style={{ fontWeight: '600', fontSize: '13px', color: '#4c1d95', marginBottom: '4px' }}>❓ {item.question}</p>
              <p style={{ fontSize: '13px', color: '#374151', lineHeight: '1.5' }}>💬 {item.answer}</p>
            </div>
          ))}
          {guide.motivation && (
            <div style={{ marginTop: '0.8rem', background: '#ede9fe', borderRadius: '6px', padding: '10px', textAlign: 'center' }}>
              <p style={{ fontSize: '13px', color: '#5b21b6', fontStyle: 'italic' }}>✨ {guide.motivation}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'blockage' && blockage && (
        <div style={{ background: '#fef2f2', borderRadius: '8px', padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.8rem' }}>
            <p style={{ fontWeight: '600', color: '#dc2626', fontSize: '14px' }}>
              {blockage.isBlocked ? '🔴 Tâche potentiellement bloquée' : '🟢 Aucun blocage détecté'}
            </p>
            <span style={{ background: urgencyColor[blockage.urgency] || '#6b7280', color: 'white', fontSize: '11px', padding: '2px 8px', borderRadius: '10px', fontWeight: '600' }}>
              Urgence : {blockage.urgency}
            </span>
          </div>
          <p style={{ fontSize: '13px', color: '#374151', marginBottom: '0.8rem', background: 'white', padding: '8px', borderRadius: '6px' }}>
            📌 {blockage.reason}
          </p>
          <h4 style={{ fontSize: '13px', color: '#374151', marginBottom: '0.5rem' }}>💡 Solutions proposées :</h4>
          {blockage.solutions?.map((sol, i) => (
            <div key={i} style={{ background: 'white', borderRadius: '6px', padding: '10px', marginBottom: '6px', borderLeft: `3px solid ${priorityColor[sol.priority] || '#6b7280'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontWeight: '600', fontSize: '13px' }}>🔧 {sol.title}</p>
                <span style={{ fontSize: '11px', background: '#f3f4f6', padding: '2px 8px', borderRadius: '10px', color: priorityColor[sol.priority] || '#6b7280', fontWeight: '600' }}>
                  {sol.priority}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '3px' }}>{sol.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}