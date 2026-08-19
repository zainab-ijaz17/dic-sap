import axios from "axios";
import { getUserCredentials } from "../api";
import { getBackendBaseUrl } from "../config/servers";

// SAP reservation numbers are 10-digit, zero-padded (e.g. 0000011005). Pad numeric
// input so a shorter user-typed number (e.g. "11005") still resolves the right
// reservation — same convention as normalizePoNumber in goodsReceiptApi.js.
function normalizeReservationNumber(reservationNumber) {
  const trimmed = reservationNumber.trim().toUpperCase();
  return /^\d+$/.test(trimmed) ? trimmed.padStart(10, "0") : trimmed;
}

// Confirmed against SAP (UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem):
// Product, ProductName, Plant, PlantName, StorageLocation, StorageLocationName,
// EntryUnit, ResvnItmRequiredQtyInEntryUnit. ReservationItem/Batch aren't confirmed
// yet, so those two stay defensive across common naming variants.
function mapReservationItem(raw) {
  return {
    lineItem: String(raw.ReservationItem ?? raw.ResItm ?? raw.ItemNumber ?? "").trim(),
    materialNumber: String(raw.Product ?? "").trim(),
    materialDescription: String(raw.ProductName ?? "").trim(),
    quantity: Number(raw.ResvnItmRequiredQtyInEntryUnit ?? 0),
    uom: String(raw.EntryUnit ?? "").trim(),
    plant: String(raw.Plant ?? "").trim(),
    plantName: String(raw.PlantName ?? "").trim(),
    storageLocation: String(raw.StorageLocation ?? "").trim(),
    storageLocationName: String(raw.StorageLocationName ?? "").trim(),
    batch: String(raw.Batch ?? raw.Charg ?? "").trim(),
  };
}

// Looks up reservation line items (Material, MaterialDescription, quantity, ...) via
// backend/routes/reservationRoutes.js (UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem).
// Used by IssuancePage.js as step 1: the user enters a Reservation number and every
// item on it is fetched and displayed before issuance.
export async function fetchReservationItems(reservationNumber) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const normalizedReservation = normalizeReservationNumber(reservationNumber);
  const url = `${getBackendBaseUrl(creds.environment)}/api/reservation/lookup`;

  let response;
  try {
    response = await axios.get(url, {
      params: { reservation: normalizedReservation },
      headers: {
        "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
        "X-User-Environment": creds.environment,
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed while fetching the Reservation. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the Reservation lookup service (network/CORS error).");
    }
    throw new Error(`Reservation lookup failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "Reservation lookup failed.");
  }

  const rawItems = data.items || [];
  if (rawItems.length === 0) {
    throw new Error(`No items found for Reservation ${normalizedReservation}.`);
  }

  // eslint-disable-next-line no-console
  console.debug("Reservation lookup raw item shape (first result):", rawItems[0]);

  return {
    reservationNumber: normalizedReservation,
    items: rawItems.map(mapReservationItem),
  };
}
