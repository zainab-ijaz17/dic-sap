import axios from "axios";
import { getUserCredentials } from "../api";
import { getBackendBaseUrl } from "../config/servers";
import { BATCH_CHARACTERISTICS, BIN_CHARACTERISTIC } from "../constants/batchClass";

const EXPIRATION_DATE_CHARACTERISTIC = BATCH_CHARACTERISTICS.find((c) => c.key === "expirationDate");

// "date" -> CharcFromDate ("/Date(ms)/"), "numeric" -> CharcFromNumericValue,
// "char" -> CharcValue. See ../constants/batchClass.js for which characteristics use
// which — confirmed against live SAP responses, not just the original sample payloads.
function buildCharcValueField(type, rawValue) {
  if (type === "date") {
    return { CharcFromDate: `/Date(${new Date(rawValue).getTime()})/` };
  }
  if (type === "numeric") {
    return { CharcFromNumericValue: Number(rawValue) };
  }
  return { CharcValue: String(rawValue) };
}

function buildCharcValueEntry({ material, batch, charcId, type, value }) {
  return {
    Material: material,
    BatchIdentifyingPlant: "",
    Batch: batch,
    CharcInternalID: charcId,
    CharcValueDependency: "1",
    ...buildCharcValueField(type, value),
  };
}

// Assigns every filled-in characteristic for one Batch in a single request — the
// backend (backend/routes/batchClassRoutes.js POST /assign-values) fans this out into
// one API_BATCH_SRV/BatchCharcValue call per characteristic (sequentially — SAP
// enqueue-locks a batch's classification object per write, so concurrent writes to
// the same Batch collide even from the same user). This used to be one HTTP round
// trip per characteristic per batch; now it's one round trip per batch.
//
// `characteristics` defaults to the 7 GR-time fields (BATCH_CHARACTERISTICS) but any
// list of {id, key, type} entries works — PutawayPage.js passes just [BIN_CHARACTERISTIC]
// to assign the Bin. `values` is keyed by each characteristic's `key`; blank/unentered
// fields are skipped since every characteristic is optional.
export async function postBatchCharacteristics({ material, batch, values, characteristics = BATCH_CHARACTERISTICS }) {
  const entries = characteristics.filter((charc) => {
    const raw = values?.[charc.key];
    return raw !== undefined && raw !== null && String(raw).trim() !== "";
  }).map((charc) => buildCharcValueEntry({ material, batch, charcId: charc.id, type: charc.type, value: values[charc.key] }));

  if (entries.length === 0) return { success: true, results: [] };

  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const url = `${getBackendBaseUrl(creds.environment)}/api/batch-class/assign-values`;

  let response;
  try {
    response = await axios.post(url, { entries }, {
      headers: {
        "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
        "X-User-Environment": creds.environment,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed while assigning batch characteristics. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the Batch Characteristic Value service (network/CORS error).");
    }
    throw new Error(`Batch characteristic assignment failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  const failures = (data?.results || []).filter((r) => !r.success);
  if (failures.length > 0) {
    const failedIds = failures.map((f) => f.charcInternalId).join(", ");
    throw new Error(`Failed to assign characteristic(s) ${failedIds}: ${failures[0].message || "Unknown error."}`);
  }

  return data;
}

// BatchCharcValue stores a "char"-type value in CharcValue, but since BIN_CHARACTERISTIC's
// type is still an unconfirmed guess (see ../constants/batchClass.js), the numeric/date
// value fields are read defensively too in case SAP disagrees the same way it did for
// 3935/3936.
function extractCharcValue(raw) {
  if (raw.CharcValue !== undefined && raw.CharcValue !== null && String(raw.CharcValue).trim() !== "") {
    return String(raw.CharcValue).trim();
  }
  if (raw.CharcFromNumericValue !== undefined && raw.CharcFromNumericValue !== null) {
    return String(raw.CharcFromNumericValue).trim();
  }
  // CharcFromDate carries an OData V2 "/Date(ms)/" string (see buildCharcValueField
  // above) — extract the epoch ms and format as a plain date for display/printing.
  if (raw.CharcFromDate !== undefined && raw.CharcFromDate !== null) {
    const match = /\/Date\((\d+)\)\//.exec(raw.CharcFromDate);
    if (match) {
      const date = new Date(Number(match[1]));
      if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
    }
  }
  return "";
}

// Looks up the Bin Location characteristic (CharcInternalID 3942 — BIN_CHARACTERISTIC,
// assigned during Putaway) for every Batch of a Material, via
// backend/routes/batchClassRoutes.js (API_BATCH_SRV/BatchCharcValue). Used by
// IssuancePage2.js to sort/display batches by Bin instead of by Batch number. Returns
// a { [batch]: bin } map so the caller can merge it into its own batch stock list.
export async function fetchBinsByMaterial(material) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const url = `${getBackendBaseUrl(creds.environment)}/api/batch-class/bin-lookup`;

  let response;
  try {
    response = await axios.get(url, {
      params: { material },
      headers: {
        "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
        "X-User-Environment": creds.environment,
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed while fetching Bin locations. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the Batch Characteristic Value service (network/CORS error).");
    }
    throw new Error(`Bin lookup failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "Bin lookup failed.");
  }

  const items = data.items || [];
  if (items.length > 0) {
    // eslint-disable-next-line no-console
    console.debug("Bin characteristic lookup raw item shape (first result):", items[0]);
  }

  const binsByBatch = {};
  items.forEach((raw) => {
    const batch = String(raw.Batch ?? "").trim();
    if (batch) binsByBatch[batch] = extractCharcValue(raw);
  });
  return binsByBatch;
}

// Shared by fetchExpirationDate/fetchBin below — looks up one characteristic's value
// for one specific Batch via backend/routes/batchClassRoutes.js's /charc-value-lookup.
// Returns "" if the batch has no value on record for it (every characteristic here is
// optional at GR time) rather than throwing, since a missing value on one field
// shouldn't block printing the rest of the label.
async function fetchCharcValueForBatch(material, batch, charcId, fieldLabel) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const url = `${getBackendBaseUrl(creds.environment)}/api/batch-class/charc-value-lookup`;

  let response;
  try {
    response = await axios.get(url, {
      params: { material, batch, charcId },
      headers: {
        "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
        "X-User-Environment": creds.environment,
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error(`SAP authentication failed while fetching the ${fieldLabel}. Please log in again.`);
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the Batch Characteristic Value service (network/CORS error).");
    }
    throw new Error(`${fieldLabel} lookup failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || `${fieldLabel} lookup failed.`);
  }

  // An empty items array here can mean either "this batch genuinely has no
  // ${fieldLabel} on record" or "the Material/Batch filter didn't match anything
  // (e.g. a leading-zero/format mismatch against how it was originally written)" —
  // logged so the two can be told apart against a real response instead of guessed at.
  // eslint-disable-next-line no-console
  console.debug(`${fieldLabel} lookup raw items for Material=${material} Batch=${batch}:`, data.items);

  const record = (data.items || [])[0];
  return record ? extractCharcValue(record) : "";
}

// Looks up the Expiration Date characteristic (CharcInternalID 3932, assigned during
// Goods Receipt — see BATCH_CHARACTERISTICS in ../constants/batchClass.js) for one
// specific Batch. Used by LabelPrintingPage.js.
export async function fetchExpirationDate(material, batch) {
  return fetchCharcValueForBatch(material, batch, EXPIRATION_DATE_CHARACTERISTIC.id, "Expiration Date");
}

// Looks up the Bin Location characteristic (CharcInternalID 3942 — BIN_CHARACTERISTIC,
// assigned during Putaway) for one specific Batch. Used by LabelPrintingPage.js to
// print the Bin's barcode alongside the Batch's. Unlike fetchBinsByMaterial above
// (every batch of a Material, used by Issuance), this is scoped to one Batch since
// Label Printing only ever has one Batch in hand.
export async function fetchBin(material, batch) {
  return fetchCharcValueForBatch(material, batch, BIN_CHARACTERISTIC.id, "Bin");
}
