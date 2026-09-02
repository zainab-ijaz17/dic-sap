// Warehouse Material Descriptions here are conventionally written as a short
// fixed-length code (e.g. "DP930") immediately followed by the descriptive text, with
// no separator — LabelPrintingPage.js and buildZplLabel (../api/labelPrintingApi.js)
// both print the short code large and the rest of the description smaller underneath,
// mirroring the warehouse's existing paper label layout.
export function splitMaterialDescription(description, shortLength = 5) {
  const trimmed = String(description ?? "").trim();
  return {
    short: trimmed.slice(0, shortLength),
    rest: trimmed.slice(shortLength).trim(),
  };
}
