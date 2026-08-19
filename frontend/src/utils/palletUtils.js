import { DEFAULT_PER_PALLET_QTY } from "../constants/warehouse";

// Standard pallet quantities are rounded up to the nearest multiple of this step
// (e.g. total 53 / 6 pallets => 53/6 = 8.83, rounded up to 10 per pallet, last
// pallet takes whatever remains: 5 pallets of 10 + one partial pallet of 3).
const ROUND_STEP = DEFAULT_PER_PALLET_QTY;

export function roundQty(value) {
  return Math.round(value * 1000) / 1000;
}

// Standardized mode: every pallet but the last is the same size — rounded up to the
// nearest ROUND_STEP from the naive average — and the last pallet absorbs whatever
// quantity remains. Invalid (last pallet <= 0) when the count is too high for the
// quantity at that rounding step.
export function computeStandardizedPalletQuantities(quantity, count) {
  const qty = Number(quantity) || 0;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (qty <= 0 || n <= 0) return { perPallet: 0, quantities: [], valid: false };

  if (n === 1) {
    return { perPallet: roundQty(qty), quantities: [roundQty(qty)], valid: true };
  }

  const perPallet = Math.ceil(qty / n / ROUND_STEP) * ROUND_STEP;
  const lastPallet = roundQty(qty - perPallet * (n - 1));
  return { perPallet, quantities: Array(n - 1).fill(perPallet).concat([lastPallet]), valid: lastPallet > 0 };
}

// Keeps a manually-entered quantity array in sync with a changed pallet count,
// preserving already-entered values and padding/truncating with blanks.
export function resizeCustomQuantities(count, existing) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return Array.from({ length: n }, (_, i) => existing[i] ?? "");
}

// Custom mode: every pallet quantity is user-entered and must sum exactly to the
// target quantity (e.g. the GR quantity being posted). Uses an epsilon comparison
// to avoid floating-point rounding issues.
export function summarizeCustomQuantities(customQuantities, targetQuantity) {
  const quantities = customQuantities.map((v) => Number(v) || 0);
  const sum = roundQty(quantities.reduce((a, b) => a + b, 0));
  const allFilled = quantities.length > 0 && quantities.every((v) => v > 0);
  const matches = Math.abs(sum - roundQty(Number(targetQuantity) || 0)) < 0.001;
  return { quantities, sum, valid: allFilled && matches };
}

// Converts a flat quantity array into the { palletNumber, quantity } shape used
// in GR item state and in the Material Document posting payload.
export function toPalletObjects(quantities) {
  return quantities.map((quantity, i) => ({ palletNumber: i + 1, quantity }));
}
