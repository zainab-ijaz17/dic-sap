import React from "react";

const PALETTE = {
  danger: "#dc3545",
  primary: "#3b82f6",
  success: "#22c55e",
};

// Generic confirm/info popup shared by every page (logout confirm, clear-all confirm,
// success dialogs, etc.) to avoid re-duplicating the same fixed-overlay markup per page.
function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  confirmVariant = "danger",
}) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: "white",
          padding: "2rem",
          borderRadius: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          maxWidth: "420px",
          width: "90%",
        }}
      >
        {title && <h3 style={{ margin: "0 0 1rem 0", color: "#333" }}>{title}</h3>}
        {message && <div style={{ margin: "0 0 1.5rem 0", color: "#555", whiteSpace: "pre-line" }}>{message}</div>}
        <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: "0.75rem 1.5rem",
                border: "1px solid #ddd",
                backgroundColor: "white",
                color: "#666",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              {cancelLabel}
            </button>
          )}
          {onConfirm && (
            <button
              onClick={onConfirm}
              style={{
                padding: "0.75rem 1.5rem",
                border: "none",
                backgroundColor: PALETTE[confirmVariant] || PALETTE.danger,
                color: "white",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
