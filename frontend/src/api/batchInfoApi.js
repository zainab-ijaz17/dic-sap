import axios from "axios";
import { getUserCredentials } from "../api";
import { getBackendBaseUrl } from "../config/servers";

// Response is a filtered OData V2 collection ({ d: { results: [...] } }), matching
// every other API_BATCH_SRV call in this codebase, but every common shape is checked
// defensively anyway in case that's ever not true (see mapPurchaseOrderItem in
// ./goodsReceiptApi.js for the same approach elsewhere).
function extractBatchRecord(raw) {
  if (Array.isArray(raw)) return raw[0] || null;
  if (Array.isArray(raw?.d?.results)) return raw.d.results[0] || null;
  if (Array.isArray(raw?.value)) return raw.value[0] || null;
  if (raw?.d && typeof raw.d === "object") return raw.d;
  if (raw && typeof raw === "object") return raw;
  return null;
}

// Looks up the Material and other batch master data for a Batch via
// backend/routes/batchInfoRoutes.js (API_BATCH_SRV/Batch) — used by PutawayPage.js to
// resolve the Material needed for the BatchCharcValue create payload
// (../api/batchClassApi.js), since Putaway only collects Batch + Bin from the user,
// not Material. Field names match API_BATCH_SRV's convention (Material,
// BatchIdentifyingPlant, Batch — same as BatchCharcValue), not the ABAP-technical-name
// style (MATNR, Werks, ...) two earlier, abandoned lookup attempts used.
export async function fetchBatchInfo(batch) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const url = `${getBackendBaseUrl(creds.environment)}/api/batch-info/lookup`;

  let response;
  try {
    response = await axios.get(url, {
      params: { batch },
      headers: {
        "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
        "X-User-Environment": creds.environment,
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed while looking up the Batch. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the Batch lookup service (network/CORS error).");
    }
    throw new Error(`Batch lookup failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "Batch lookup failed.");
  }

  const record = extractBatchRecord(data.raw);
  if (!record || !record.Material) {
    throw new Error(`Batch ${batch} was not found, or has no Material on record.`);
  }

  // MaterialDescription (unlike Material/BatchIdentifyingPlant/Batch) was never
  // confirmed against a live SAP response — API_BATCH_SRV/Batch may not carry
  // Material master text at all. Logged so a blank Description on
  // LabelPrintingPage.js can be diagnosed against the real field names SAP returns,
  // instead of guessed at.
  // eslint-disable-next-line no-console
  console.debug("Batch Info lookup raw record:", record);

  return {
    material: record.Material,
    materialDescription: record.MaterialDescription || "",
    plant: record.BatchIdentifyingPlant || "",
  };
}
