// ─────────────────────────────────────────────────────────────
//  CustomSelect — remplace le <select> natif qui a des problèmes
//  de couleur dans les dark themes (options blanches sur fond blanc)
//
//  Usage :
//    <CustomSelect
//      value={addingId}
//      onChange={(val) => setAddingId(val)}
//      options={[{ value: "1", label: "Tâche #1 — Analyse" }]}
//      placeholder="— Sélectionner une tâche —"
//      disabled={saving}
//    />
// ─────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from "react";

export default function CustomSelect({ value, onChange, options = [], placeholder = "— Choisir —", disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref  = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));

  // Ferme si clic extérieur
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position:  "relative",
        flex:       1,
        minWidth:  "200px",
        userSelect: "none",
      }}
    >
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          width:           "100%",
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "space-between",
          gap:             "8px",
          background:      "rgba(255,255,255,0.05)",
          border:          `1px solid ${open ? "rgba(168,208,230,0.5)" : "rgba(168,208,230,0.18)"}`,
          borderRadius:    "7px",
          padding:         "7px 12px",
          color:           selected ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
          fontSize:        "13px",
          fontFamily:      "'DM Sans', sans-serif",
          cursor:          disabled ? "not-allowed" : "pointer",
          opacity:         disabled ? 0.5 : 1,
          transition:      "border-color 0.15s",
          textAlign:       "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{
          fontSize:   "10px",
          opacity:    0.5,
          flexShrink: 0,
          transform:  open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.2s",
        }}>▼</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position:        "absolute",
          top:             "calc(100% + 4px)",
          left:            0,
          right:           0,
          zIndex:          9999,
          background:      "#1a2540",
          border:          "1px solid rgba(168,208,230,0.2)",
          borderRadius:    "8px",
          boxShadow:       "0 8px 32px rgba(0,0,0,0.45)",
          overflow:        "hidden",
          maxHeight:       "220px",
          overflowY:       "auto",
        }}>
          {options.length === 0 ? (
            <div style={{
              padding:   "12px 14px",
              color:     "rgba(255,255,255,0.3)",
              fontSize:  "13px",
              fontStyle: "italic",
            }}>
              Aucune tâche disponible
            </div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(String(opt.value)); setOpen(false); }}
                style={{
                  width:       "100%",
                  display:     "block",
                  textAlign:   "left",
                  padding:     "9px 14px",
                  background:  String(opt.value) === String(value)
                    ? "rgba(168,208,230,0.12)"
                    : "transparent",
                  border:       "none",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  color:        String(opt.value) === String(value)
                    ? "#A8D0E6"
                    : "rgba(255,255,255,0.8)",
                  fontSize:    "13px",
                  fontFamily:  "'DM Sans', sans-serif",
                  cursor:      "pointer",
                  transition:  "background 0.12s",
                  whiteSpace:  "nowrap",
                  overflow:    "hidden",
                  textOverflow:"ellipsis",
                }}
                onMouseEnter={(e) => {
                  if (String(opt.value) !== String(value))
                    e.currentTarget.style.background = "rgba(168,208,230,0.07)";
                }}
                onMouseLeave={(e) => {
                  if (String(opt.value) !== String(value))
                    e.currentTarget.style.background = "transparent";
                }}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}