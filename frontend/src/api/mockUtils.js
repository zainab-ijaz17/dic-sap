// Shared helpers for the mock service layer (frontend/src/api/*Api.js).
// Every mock*Api.js file returns Promises with a simulated delay so the UI can
// later swap these for real axios/fetch calls without touching page components.

export function simulateDelay(ms = 600) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Deterministic pseudo-random index derived from a seed string, so the same
// scanned barcode/PO number always returns the same mock data during a demo.
export function randomFromSeed(seed, max) {
  let hash = 0;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % max;
}
