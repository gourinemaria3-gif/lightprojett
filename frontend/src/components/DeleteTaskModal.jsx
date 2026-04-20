// src/components/DeleteTaskModal.jsx
import React from "react";
import "./DeleteTaskModal.css";

/**
 * Modale de confirmation simple pour la suppression d'une tâche.
 * Visible uniquement pour le manager du projet.
 *
 * Props:
 *  - task       : objet tâche (id, subject)
 *  - onConfirm() : appelé quand confirmé
 *  - onCancel()  : appelé quand annulé
 *  - loading    : bool
 */
export default function DeleteTaskModal({ task, onConfirm, onCancel, loading }) {
  function handleOverlayClick(e) {
    if (e.target === e.currentTarget && !loading) onCancel();
  }

  return (
    <div className="dtm-overlay" onClick={handleOverlayClick}>
      <div className="dtm-modal">

        <div className="dtm-icon-wrap">
          <span className="dtm-icon">🗑️</span>
        </div>

        <h2 className="dtm-title">Supprimer la tâche ?</h2>

        <p className="dtm-subtitle">
          Vous êtes sur le point de supprimer la tâche :
        </p>

        <div className="dtm-task-name">
          {task.subject || "Sans titre"}
        </div>

        <p className="dtm-warning">
          ⚠️ Cette action est <strong>irréversible</strong>.
          La tâche, ses commentaires et son historique seront définitivement supprimés.
        </p>

        <div className="dtm-actions">
          <button
            className="dtm-cancel-btn"
            onClick={onCancel}
            disabled={loading}
          >
            Annuler
          </button>
          <button
            className="dtm-delete-btn"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <span className="dtm-btn-loading">
                <span className="dtm-btn-spinner" />
                Suppression...
              </span>
            ) : (
              "Supprimer"
            )}
          </button>
        </div>

      </div>
    </div>
  );
}