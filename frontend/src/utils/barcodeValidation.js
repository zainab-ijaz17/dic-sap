import { BARCODE_PATTERN, BARCODE_MIN_LENGTH } from "../constants/barcode";

export function validateBarcode(value, label = "Barcode", minLength = BARCODE_MIN_LENGTH) {
  const trimmed = (value || "").trim();
  if (!trimmed) return `Please scan or enter a ${label}.`;
  if (trimmed.length < minLength || !BARCODE_PATTERN.test(trimmed)) {
    return `Invalid ${label} format.`;
  }
  return "";
}
