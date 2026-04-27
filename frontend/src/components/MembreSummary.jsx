import { useState } from 'react'
import { fetchMemberSummary } from '../services/api'

export default function MemberSummary({ member }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)

  const loadSummary = async () => {
    if (summary) { setOpen(!open); return }
    setLoading(true); setError(null)
    try {
      const data = await fetchMemberSummary( {
        name: member.name,
        totalTasks: member.totalTasks || 0,
        doneTasks: member.doneTasks || 0,
        lateTasks: member.lateTasks || 0,
        inProgressTasks: member.inProgressTasks || 0,
        tasks: member.tasks || []
      })
      setSummary(data)
      setOpen(true)
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur IA')
    }
    setLoading(false)
  }

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <button onClick={loadSummary} disabled={loading} style={{
        padding: '5px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
        background: open ? '#059669' : '#ecfdf5', color: open ? 'white' : '#059669',
        fontSize: '12px', fontWeight: '600'
      }}>
        {loading ? '⏳...' : '👤 Résumé IA personnalisé'}
      </button>

      {error && <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>❌ {error}</p>}

      {open && summary && (
        <div style={{ background: '#ecfdf5', borderRadius: '8px', padding: '1rem', marginTop: '0.5rem' }}>
          <p style={{ fontWeight: '600', color: '#065f46', fontSize: '14px', marginBottom: '0.8rem' }}>
            👋 {summary.greeting}
          </p>
          <div style={{ display: 'grid', gap: '6px' }}>
            {summary.accomplished && (
              <div style={{ background: 'white', padding: '8px', borderRadius: '6px', borderLeft: '3px solid #22c55e' }}>
                <p style={{ fontSize: '12px', color: '#374151' }}>✅ <strong>Accompli :</strong> {summary.accomplished}</p>
              </div>
            )}
            {summary.inProgress && (
              <div style={{ background: 'white', padding: '8px', borderRadius: '6px', borderLeft: '3px solid #f59e0b' }}>
                <p style={{ fontSize: '12px', color: '#374151' }}>🔄 <strong>En cours :</strong> {summary.inProgress}</p>
              </div>
            )}
            {summary.nextPriority && (
              <div style={{ background: 'white', padding: '8px', borderRadius: '6px', borderLeft: '3px solid #3b82f6' }}>
                <p style={{ fontSize: '12px', color: '#374151' }}>🎯 <strong>Priorité :</strong> {summary.nextPriority}</p>
              </div>
            )}
            {summary.alert && (
              <div style={{ background: '#fee2e2', padding: '8px', borderRadius: '6px', borderLeft: '3px solid #ef4444' }}>
                <p style={{ fontSize: '12px', color: '#991b1b' }}>⚠️ <strong>Alerte :</strong> {summary.alert}</p>
              </div>
            )}
          </div>
          <div style={{ marginTop: '0.8rem', background: '#d1fae5', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
            <p style={{ fontSize: '12px', color: '#065f46', fontStyle: 'italic' }}>✨ {summary.encouragement}</p>
          </div>
        </div>
      )}
    </div>
  )
}