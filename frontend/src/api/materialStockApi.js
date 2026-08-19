import axios from "axios";
import { getUserCredentials } from "../api";
import { getBackendBaseUrl } from "../config/servers";

// SAP's exact field names for API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod aren't
// confirmed yet, so quantity/unit are read defensively across the common naming
// variants — MatlWrhsStkQtyInMatlBaseUnit is the field inventoryReportRoutes.js's
// similar stock entity (C_STOCKQUANTITYVALUEBYTYPE) uses, so it's tried first. If the
// real field names differ, only this mapping needs updating (see the console.debug
// below for the raw shape).
// Bin doesn't live on this entity at all — it's the Bin Location batch characteristic
// (CharcInternalID 3942, see ../constants/batchClass.js), fetched separately via
// fetchBinsByMaterial (../api/batchClassApi.js) and merged in by IssuancePage2.js.
function mapBatchStock(raw) {
  return {
    batch: String(raw.Batch ?? raw.Charg ?? "").trim(),
    quantity: Number(raw.MatlWrhsStkQtyInMatlBaseUnit ?? raw.MatlWrhsStkQty ?? raw.Quantity ?? raw.Menge ?? 0),
    uom: String(raw.MaterialBaseUnit ?? raw.BaseUnit ?? raw.Meins ?? "").trim(),
    material: String(raw.Material ?? "").trim(),
    plant: String(raw.Plant ?? "").trim(),
    storageLocation: String(raw.StorageLocation ?? "").trim(),
  };
}

// Allocates a reservation's required quantity across batches already sorted
// ascending by Batch number (oldest first — see fetchMaterialBatchStock below): each
// batch is consumed in full before moving to the next, until the required quantity
// is met. The last batch used may only be partially consumed; whatever's left in it,
// and every batch after it, is untouched and left out of the returned list. This
// picking order is intentionally not what the user sees — IssuancePage2.js displays
// the picked batches sorted by Bin instead.
export function allocateBatchesForQuantity(batches, requiredQuantity) {
  let remaining = requiredQuantity;
  const picked = [];
  for (const batch of batches) {
    if (remaining <= 0) break;
    const pickedQty = Math.min(remaining, batch.quantity);
    picked.push({ ...batch, pickedQty });
    remaining -= pickedQty;
  }
  return picked;
}

// Looks up batch stock for a Material at a Storage Location via
// backend/routes/materialStockRoutes.js (API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod),
// sorted by Batch number ascending (oldest/lowest batch first). Used by
// IssuancePage2.js (step 2) to list the batches available to issue from, once the
// user has picked a reservation item on IssuancePage.js.
export async function fetchMaterialBatchStock(material, storageLocation) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const url = `${getBackendBaseUrl(creds.environment)}/api/material-stock/batches`;

  let response;
  try {
    response = await axios.get(url, {
      params: { material, storageLocation },
      headers: {
        "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
        "X-User-Environment": creds.environment,
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed while fetching batch stock. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the Material Stock service (network/CORS error).");
    }
    throw new Error(`Batch stock lookup failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "Batch stock lookup failed.");
  }

  const rawItems = data.items || [];
  if (rawItems.length === 0) {
    throw new Error(`No batch stock found for Material ${material} at Storage Location ${storageLocation}.`);
  }

  // eslint-disable-next-line no-console
  console.debug("Material Stock lookup raw item shape (first result):", rawItems[0]);

  const batches = rawItems
    .map(mapBatchStock)
    .filter((batch) => batch.quantity > 0)
    .sort((a, b) => Number(a.batch) - Number(b.batch));

  if (batches.length === 0) {
    throw new Error(`No batches with quantity greater than 0 found for Material ${material} at Storage Location ${storageLocation}.`);
  }

  return batches;
}

// Looks up current stock quantity for one Batch via
// backend/routes/materialStockRoutes.js (API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod,
// filtered by Batch instead of Storage Location) — used by LabelPrintingPage.js,
// which only has a Batch to work from. Summed across every Storage Location the
// batch is split across; UOM is taken from the first row since it's the same
// Material throughout.
export async function fetchBatchQuantity(material, batch) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const url = `${getBackendBaseUrl(creds.environment)}/api/material-stock/batch-quantity`;

  let response;
  try {
    response = await axios.get(url, {
      params: { material, batch },
      headers: {
        "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
        "X-User-Environment": creds.environment,
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed while fetching batch quantity. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the Material Stock service (network/CORS error).");
    }
    throw new Error(`Batch quantity lookup failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "Batch quantity lookup failed.");
  }

  const rows = (data.items || []).map(mapBatchStock);
  if (rows.length === 0) {
    return { quantity: 0, uom: "" };
  }

  return {
    quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    uom: rows[0].uom,
  };
}
