import axios from "axios";
import { getUserCredentials } from "../api";
import { getBackendBaseUrl } from "../config/servers";
import { DEFAULT_MOVEMENT_TYPE_ISSUANCE, DEFAULT_ISSUING_RECEIVING_STORAGE_LOCATION } from "../constants/warehouse";

// Builds the API_MATERIAL_DOCUMENT_SRV (A_MaterialDocumentHeader) create payload —
// one to_MaterialDocumentItem line per batch picked on IssuancePage2.js, across every
// Line Item from every Reservation added on IssuancePage.js (an issuance run isn't
// limited to one Reservation, so each item carries its own reservationNumber rather
// than sharing a single one — see handleNext there), each batch with its own confirmed
// pickedQty. GoodsMovementCode "04" and GoodsMovementType 311 (Storage Location to
// Storage Location transfer) plus IssuingOrReceivingStorageLoc are all fixed per the
// one sample payload we were given for this call.
function buildMaterialDocumentPayload({ lineItems }) {
  return {
    GoodsMovementCode: "04",
    to_MaterialDocumentItem: {
      results: lineItems.flatMap(({ item, batches }) =>
        batches.map((batch) => ({
          Material: item.materialNumber,
          Plant: item.plant,
          StorageLocation: item.storageLocation,
          Batch: batch.batch,
          GoodsMovementType: DEFAULT_MOVEMENT_TYPE_ISSUANCE,
          QuantityInEntryUnit: String(batch.pickedQty),
          EntryUnit: item.uom,
          IssuingOrReceivingStorageLoc: DEFAULT_ISSUING_RECEIVING_STORAGE_LOCATION,
          Reservation: item.reservationNumber,
          ReservationItem: item.lineItem,
        }))
      ),
    },
  };
}

// Posts every Line Item's picked batches together as a single Goods Issue via
// backend/routes/issuanceRoutes.js (API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader).
// Called from IssuancePage2.js's Post button, which only enables once every row across
// every Line Item has been scanned and confirmed (matched).
export async function postIssuance({ lineItems }) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const payload = buildMaterialDocumentPayload({ lineItems });
  const url = `${getBackendBaseUrl(creds.environment)}/api/issuance/post`;

  let response;
  try {
    response = await axios.post(url, payload, {
      headers: {
        "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
        "X-User-Environment": creds.environment,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed while posting the issuance. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the Issuance posting service (network/CORS error).");
    }
    throw new Error(`Issuance posting failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "Issuance posting failed.");
  }

  return {
    success: true,
    materialDocNumber: data.materialDocNumber,
    materialDocYear: data.materialDocYear,
    message: data.message || "Issuance posted successfully.",
  };
}
