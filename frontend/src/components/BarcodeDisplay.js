import React, { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

// Renders a scannable Code128 barcode to a canvas — same symbology buildZplLabel
// (../api/labelPrintingApi.js) encodes into the printed ZPL via ^BCN, so what's shown
// here on screen matches what actually comes out of the printer.
function BarcodeDisplay({ value, height = 60, width = 2, fontSize = 14, displayValue = true }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !value) return;
    JsBarcode(canvasRef.current, String(value), {
      format: "CODE128",
      height,
      width,
      fontSize,
      margin: 4,
      displayValue,
    });
  }, [value, height, width, fontSize, displayValue]);

  if (!value) return null;

  return <canvas ref={canvasRef} />;
}

export default BarcodeDisplay;
