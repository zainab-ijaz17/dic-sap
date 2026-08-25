// Movement-type/default values for the mocked Warehouse Management flows.
// TODO: Confirm final values with SAP once the real OData/BAPI integration is wired up.
export const DEFAULT_MOVEMENT_TYPE_GR = "101";
export const DEFAULT_PLANT = "1134";
export const DEFAULT_PER_PALLET_QTY = 10;

// GR for STPO (../pages/GrStpoPage.js, ../pages/GrStpo2Page.js) reads/receives stock
// at a different plant than a regular Goods Receipt.
export const DEFAULT_PLANT_STPO = "1312";

// Issuance posting (see ../api/issuanceApi.js) — Goods Issue via a Storage Location
// to Storage Location transfer (311). Both values are hardcoded from the single
// sample payload given for this call; TODO: confirm whether
// IssuingOrReceivingStorageLoc is really fixed or varies per reservation/plant once
// more real payloads are seen.
export const DEFAULT_MOVEMENT_TYPE_ISSUANCE = "311";
export const DEFAULT_ISSUING_RECEIVING_STORAGE_LOCATION = "L001";
