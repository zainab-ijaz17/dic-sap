import React from "react";

const PALETTE = {
  primary: "#3b82f6",
  success: "#22c55e",
  danger: "#ef4444",
  neutral: "#6b7280",
};

function LoadingButton({ loading, disabled, onClick, children, variant = "primary", style, type = "button" }) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      style={{
        padding: "0.85rem 2rem",
        background: PALETTE[variant] || PALETTE.primary,
        color: "#fff",
        border: "none",
        borderRadius: "8px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        opacity: isDisabled ? 0.7 : 1,
        cursor: isDisabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >
      {loading && <span className="loading-spinner" />}
      {children}
    </button>
  );
}

export default LoadingButton;
