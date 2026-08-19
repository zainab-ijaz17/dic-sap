import React, { forwardRef, useEffect, useRef } from "react";

// Reusable keyboard-wedge barcode field: auto-focuses on mount, and auto-fires
// onComplete once the configured maxLength is reached (mirrors how a hardware
// barcode scanner "types" the code and sends Enter). Enter key is a manual fallback.
const BarcodeInput = forwardRef(function BarcodeInput(
  { value, onChange, onComplete, maxLength, placeholder, disabled, autoFocus = true, style },
  forwardedRef
) {
  const localRef = useRef(null);

  const setRefs = (node) => {
    localRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  useEffect(() => {
    if (autoFocus && localRef.current) {
      localRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e) => {
    const next = e.target.value.toUpperCase();
    onChange(next);
    if (maxLength && next.length >= maxLength && onComplete) {
      onComplete(next);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && onComplete) {
      e.preventDefault();
      onComplete(value);
    }
  };

  return (
    <input
      ref={setRefs}
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      style={{ flex: 1, padding: "0.85rem", borderRadius: "8px", border: "1px solid #d1d5db", ...style }}
    />
  );
});

export default BarcodeInput;
