// src/components/DeleteProjectModal.jsx
import React, { useState, useEffect } from "react";
import "./DeleteProjectModal.css";

/**
 * Modale de confirmation de suppression de projet.
 * L'utilisateur doit taper le nom exact du projet pour confirmer.
 *
 * Props:
 *  - project      : objet projet (id, name, identifier)
 *  - onConfirm()  : appelé quand la suppression est confirmée
 *  - onCancel()   : appelé quand l'utilisateur annule
 *  - loading      : bool — affiche un état "Suppression..."
 */
export default function DeleteProjectModal({ project, onConfirm, onCancel, loading }) {
  const [inputValue, setInputValue] = useState("");
  const [shake, setShake]           = useState(false);

  // Réinitialiser l'input à chaque ouverture
  useEffect(() => { setInputValue(""); }, [project]);

  const isMatch   = inputValue.trim() === project.name.trim();
  const canDelete = isMatch && !loading;

  function handleConfirm() {
    if (!canDelete) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }
    onConfirm();
  }

  // Fermer sur clic overlay
  function handleOverlayClick(e) {
    if (e.target === e.currentTarget && !loading) onCancel();
  }

  return (
    <div className="dpm-overlay" onClick={handleOverlayClick}>
      <div className={`dpm-modal ${shake ? "dpm-shake" : ""}`}>

        {/* Icône danger */}
        <div className="dpm-icon-wrap">
          <div className="dpm-icon-ring" />
          <span className="dpm-icon">⚠️</span>
        </div>

        {/* Titre */}
        <h2 className="dpm-title">Supprimer le projet</h2>
        <p className="dpm-subtitle">
          Cette action est <strong>irréversible</strong>. Toutes les tâches,
          fichiers et données associés à ce projet seront définitivement supprimés.
        </p>

        {/* Conséquences */}
        <div className="dpm-consequences">
          <div className="dpm-consequence-title">Ce qui sera supprimé :</div>
          <ul className="dpm-consequence-list">
            <li>🗂️ Toutes les tâches du projet</li>
            <li>📎 Tous les fichiers et pièces jointes</li>
            <li>💬 Tous les commentaires et l'historique</li>
            <li>📊 Toutes les statistiques et données Gantt</li>
          </ul>
        </div>

        {/* Champ confirmation */}
        <div className="dpm-confirm-field">
          <label className="dpm-confirm-label">
            Pour confirmer, tapez le nom du projet :{" "}
            <strong className="dpm-project-name">{project.name}</strong>
          </label>
          <input
            className={`dpm-confirm-input ${
              inputValue.length > 0
                ? isMatch ? "dpm-input-ok" : "dpm-input-error"
                : ""
            }`}
            type="text"
            placeholder={`Tapez "${project.name}"`}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
            autoFocus
            disabled={loading}
          />
          {inputValue.length > 0 && !isMatch && (
            <p className="dpm-input-hint">Le nom ne correspond pas.</p>
          )}
          {isMatch && (
            <p className="dpm-input-hint ok">✓ Nom confirmé</p>
          )}
        </div>

        {/* Actions */}
        <div className="dpm-actions">
          <button
            className="dpm-cancel-btn"
            onClick={onCancel}
            disabled={loading}
          >
            Annuler
          </button>
          <button
            className="dpm-delete-btn"
            onClick={handleConfirm}
            disabled={!canDelete}
          >
            {loading ? (
              <span className="dpm-btn-loading">
                <span className="dpm-btn-spinner" />
                Suppression...
              </span>
            ) : (
              "🗑️ Supprimer définitivement"
            )}
          </button>
        </div>

      </div>
    </div>
  );
}