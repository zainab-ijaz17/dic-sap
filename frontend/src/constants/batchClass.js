// Optional batch classification characteristics entered on GoodReceipt2Page before
// posting, but only sent to API_BATCH_SRV/BatchCharcValue (see ../api/batchClassApi.js
// and backend/routes/batchClassRoutes.js) after the GR is posted and SAP has assigned
// a real Batch. Every field is optional — a GR can be posted without any of them.
//
// `type` decides both the input control rendered and which value field the API call
// uses: "date" -> CharcFromDate ("/Date(ms)/"), "numeric" -> CharcFromNumericValue,
// "char" -> CharcValue. CharcInternalID 869 (Z_FIFO) is a leftover from an earlier
// classification class and is intentionally not included here.
//
// IMPORTANT: `type` reflects each characteristic's actual data type as configured in
// SAP (CT04), which the "numeric vs char" guess in the original field list got wrong
// more than once — both 3935 (Packing Size) and 3936 (Shelf Life) were assumed
// numeric but SAP rejected CharcFromNumericValue with "Invalid property filled for
// characteristic value" (NGC_RAP/054) regardless of the value sent, confirming a
// property-type mismatch rather than a value/length problem; both switched to "char".
// 3937 (Number of Pallets) is still unverified against live SAP — given two of three
// "numeric" guesses were wrong, treat it as equally suspect until tested the same way.
export const BATCH_CHARACTERISTICS = [
  { id: "3932", key: "expirationDate", label: "Expiration Date", type: "date" },
  { id: "3934", key: "extensionLot", label: "Extension Lot Number", type: "char" },
  { id: "3935", key: "packingSize", label: "Packing Size", type: "char" },
  { id: "3936", key: "shelfLife", label: "Shelf Life", type: "char" },
  { id: "3937", key: "numberOfPallets", label: "Number of Pallets", type: "numeric" },
  { id: "3938", key: "ec6AgingDate", label: "EC6 Aging Date", type: "date" },
  { id: "3939", key: "dateOfManufacturing", label: "Date of Manufacturing", type: "date" },
];

export function emptyBatchCharacteristicValues() {
  return BATCH_CHARACTERISTICS.reduce((acc, charc) => ({ ...acc, [charc.key]: "" }), {});
}

// Bin. Defaulted to "floor" for every batch at GR time (GoodReceipt2Page.js and
// GrStpo2Page.js — newly received stock lives on the floor until it's actually put
// away) and later overwritten with the real Bin during Putaway (../pages/PutawayPage.js).
// Kept separate from BATCH_CHARACTERISTICS so it doesn't show up as a user-editable
// field on GoodReceipt2Page's per-item characteristics grid — both GR's "floor"
// default and Putaway's real value are assigned programmatically, never typed in by
// the user at GR time. "char" is a starting guess (the sample payload we were given
// reused a placeholder date value from an earlier characteristic's example, and a
// Bin is a location code, not a date) — confirm against a live SAP response the same
// way 3935/3936 got corrected above, and fix here if SAP disagrees.
export const BIN_CHARACTERISTIC = { id: "3942", key: "bin", label: "Bin", type: "char" };
