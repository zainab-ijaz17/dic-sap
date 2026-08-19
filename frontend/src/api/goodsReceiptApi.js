import axios from "axios";
import { simulateDelay, randomFromSeed } from "./mockUtils";
import { DEFAULT_PLANT } from "../constants/warehouse";
import { getUserCredentials } from "../api";
import { getBackendBaseUrl } from "../config/servers";

// Goods Receipt service layer.
// fetchPurchaseOrder() hits the real SAP OData Purchase Order Fact Sheet endpoint by
// default. Set REACT_APP_PO_LOOKUP_MOCK=true (see .env.development) to fall back to
// local mock data for offline UI work — mirrors the toggle used by inventoryReportApi.js.
const useClientMock = process.env.REACT_APP_PO_LOOKUP_MOCK === "true";

// TODO: this is the devspace/test instance provided for the PO Fact Sheet lookup.
// Confirm/replace with the correct per-environment (dev/prd) API Management host
// once available, the same way apiEndpoints in config/servers.js does for other calls.
const PO_API_BASE_URL = "https://devspace.test.apimanagement.eu10.hana.ondemand.com/grp/po";
const PO_API_SAP_CLIENT = "110";

const MOCK_MATERIALS = [
  { materialNumber: "MAT100234", materialDescription: "Steel Rod 12mm", uom: "KG" },
  { materialNumber: "MAT100567", materialDescription: "Aluminium Sheet 2mm", uom: "EA" },
  { materialNumber: "MAT100890", materialDescription: "Copper Wire Coil", uom: "EA" },
  { materialNumber: "MAT101123", materialDescription: "PVC Pipe 1 inch", uom: "MTR" },
];

// Only used when REACT_APP_PO_LOOKUP_MOCK=true. When lineItem is provided, only
// that single line item is returned. When left blank, every line item is returned.
function getMockPurchaseOrder(poNumber, lineItem) {
  const normalizedPo = poNumber.trim().toUpperCase();
  const trimmedLineItem = (lineItem || "").trim().toUpperCase();

  if (trimmedLineItem) {
    const material = MOCK_MATERIALS[randomFromSeed(`${normalizedPo}-${trimmedLineItem}`, MOCK_MATERIALS.length)];
    return {
      poNumber: normalizedPo,
      plant: DEFAULT_PLANT,
      lineItems: [
        {
          lineItem: trimmedLineItem,
          materialNumber: material.materialNumber,
          materialDescription: material.materialDescription,
          quantity: 50 + randomFromSeed(`${normalizedPo}-${trimmedLineItem}-qty`, 20) * 5,
          uom: material.uom,
          plant: DEFAULT_PLANT,
        },
      ],
    };
  }

  const startIndex = randomFromSeed(normalizedPo, MOCK_MATERIALS.length);
  const lineItemCount = 3;
  const lineItems = Array.from({ length: lineItemCount }, (_, i) => {
    const material = MOCK_MATERIALS[(startIndex + i) % MOCK_MATERIALS.length];
    return {
      lineItem: String((i + 1) * 10).padStart(4, "0"),
      materialNumber: material.materialNumber,
      materialDescription: material.materialDescription,
      quantity: 50 + randomFromSeed(`${normalizedPo}-${i}`, 20) * 5,
      uom: material.uom,
      plant: DEFAULT_PLANT,
    };
  });

  return { poNumber: normalizedPo, plant: DEFAULT_PLANT, lineItems };
}

// SAP PO numbers are 10-digit, zero-padded (e.g. 4500000215). Pad numeric input
// so a shorter user-typed number (e.g. "215") still resolves the right PO.
function normalizePoNumber(poNumber) {
  const trimmed = poNumber.trim().toUpperCase();
  return /^\d+$/.test(trimmed) ? trimmed.padStart(10, "0") : trimmed;
}

// Line item numbers may come back zero-padded (e.g. "00010") while the user types
// "10" or "010" — compare numerically so either form matches.
function lineItemsMatch(a, b) {
  const numA = parseInt(String(a).replace(/\D/g, ""), 10);
  const numB = parseInt(String(b).replace(/\D/g, ""), 10);
  if (Number.isNaN(numA) || Number.isNaN(numB)) {
    return String(a).trim() === String(b).trim();
  }
  return numA === numB;
}

// SAP's exact field names for this Fact Sheet OData service aren't confirmed yet,
// so every field is read defensively across the common naming variants used by
// SAP's standard Purchase Order APIs/CDS views. If the real field names differ,
// only this mapping needs updating (see the console.warn below for the raw shape).
function mapPurchaseOrderItem(raw) {
  return {
    lineItem: String(raw.PurchaseOrderItem ?? raw.EbelP ?? raw.ItemNumber ?? raw.Item ?? "").trim(),
    materialNumber: String(raw.Material ?? raw.Matnr ?? raw.MaterialNumber ?? "").trim(),
    materialDescription: String(
      raw.PurchaseOrderItemText ?? raw.ShortText ?? raw.MaterialDescription ?? raw.Txz01 ?? raw.ItemText ?? ""
    ).trim(),
    quantity: Number(raw.OrderQuantity ?? raw.PurchaseOrderQuantity ?? raw.Menge ?? raw.Quantity ?? 0),
    uom: String(raw.PurchaseOrderQuantityUnit ?? raw.OrderQuantityUnit ?? raw.Meins ?? raw.UnitOfMeasure ?? "").trim(),
    plant: String(raw.Plant ?? raw.Werks ?? DEFAULT_PLANT).trim(),
  };
}

async function fetchPurchaseOrderLive(poNumber, lineItem) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const normalizedPo = normalizePoNumber(poNumber);
  const url = `${PO_API_BASE_URL}/C_PurchaseOrderFs('${normalizedPo}')/to_PurchaseOrderItem`;

  let response;
  try {
    response = await axios.get(url, {
      params: { "sap-client": PO_API_SAP_CLIENT, "$format": "json" },
      headers: {
        Authorization: `Basic ${btoa(`${creds.username}:${creds.password}`)}`,
        Accept: "application/json",
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed for the Purchase Order lookup. Please log in again.");
    }
    if (!err.response) {
      throw new Error("Unable to reach the SAP Purchase Order service (network/CORS error).");
    }
    throw new Error(`Purchase Order lookup failed: ${err.response.status} ${err.response.statusText}`);
  }

  const rawItems = response.data?.d?.results || response.data?.value || [];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error(`No line items found for Purchase Order ${normalizedPo}.`);
  }

  // eslint-disable-next-line no-console
  console.debug("PO lookup raw item shape (first result):", rawItems[0]);

  let lineItems = rawItems.map(mapPurchaseOrderItem);

  const trimmedLineItem = (lineItem || "").trim();
  if (trimmedLineItem) {
    lineItems = lineItems.filter((item) => lineItemsMatch(item.lineItem, trimmedLineItem));
    if (lineItems.length === 0) {
      throw new Error(`Line item ${trimmedLineItem} not found on Purchase Order ${normalizedPo}.`);
    }
  }

  return {
    poNumber: normalizedPo,
    plant: lineItems[0]?.plant || DEFAULT_PLANT,
    lineItems,
  };
}

export async function fetchPurchaseOrder(poNumber, lineItem) {
  if (useClientMock) {
    await simulateDelay(700);
    return getMockPurchaseOrder(poNumber, lineItem);
  }
  return fetchPurchaseOrderLive(poNumber, lineItem);
}

export const isPoLookupMockEnabled = useClientMock;

// TODO: Check still simulates. A_MaterialDocumentHeader (used by postGoodsReceipt below)
// has no TestRun/simulate field, so there is no real SAP call to make for Check — this
// stays a client-side mock until/unless SAP exposes a validate-only option.
export async function checkGoodsReceipt(payload) {
  await simulateDelay(500);
  return { success: true, message: "Validation successful. Ready to post." };
}

// Builds the API_MATERIAL_DOCUMENT_SRV (A_MaterialDocumentHeader) create payload.
// Quantity comes from each item as edited on GoodReceipt2Page — it already reflects
// the user's override of the value fetched from the PO on GoodReceiptPage.
//
// Each item's pallet split (decided on GoodReceipt2Page — see ../pages/GoodReceipt2Page.js
// and ../utils/palletUtils.js) becomes its own to_MaterialDocumentItem line: every SAP
// field stays identical to the parent item, only QuantityInEntryUnit differs per pallet.
// A PO item split into 5 pallets therefore appears 5 times in the payload. Items without
// a resolved pallets array (defensive — GoodReceipt2Page always provides one) fall back
// to a single line using the item's total quantity.
function buildMaterialDocumentPayload({ poNumber, items, storageLocation, movementType, deliveryNote }) {
  const nowMs = Date.now();
  return {
    PostingDate: `/Date(${nowMs})/`,
    DocumentDate: `/Date(${nowMs})/`,
    GoodsMovementCode: "01",
    ReferenceDocument: deliveryNote.trim(),
    to_MaterialDocumentItem: {
      results: items.flatMap((item) => {
        const pallets = item.pallets?.length > 0 ? item.pallets : [{ quantity: item.quantity }];
        return pallets.map((pallet) => ({
          GoodsMovementType: movementType,
          GoodsMovementRefDocType: "B",
          PurchaseOrder: poNumber,
          PurchaseOrderItem: item.lineItem,
          Plant: item.plant || DEFAULT_PLANT,
          StorageLocation: storageLocation,
          EntryUnit: item.uom,
          QuantityInEntryUnit: String(pallet.quantity),
        }));
      }),
    },
  };
}

export async function postGoodsReceipt({ poNumber, items, storageLocation, movementType, deliveryNote }) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const payload = buildMaterialDocumentPayload({ poNumber, items, storageLocation, movementType, deliveryNote });
  const url = `${getBackendBaseUrl(creds.environment)}/api/goods-receipt/post`;

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
      throw new Error("SAP authentication failed while posting the goods receipt. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the Goods Receipt posting service (network/CORS error).");
    }
    throw new Error(`Goods receipt posting failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "Goods receipt posting failed.");
  }

  return {
    success: true,
    materialDocNumber: data.materialDocNumber,
    materialDocYear: data.materialDocYear,
    message: data.message || "Goods receipt posted successfully.",
  };
}

// Looks up the line items (incl. Batch) SAP recorded against a posted material
// document, via API_MATERIAL_DOCUMENT_SRV (A_MaterialDocumentItem). GoodReceipt2Page
// calls this right after Post to auto-fill Batch instead of having the user type it in
// — batch classification (../pages/GoodReceipt2Page.js, ../api/batchClassApi.js) needs
// a real Batch, which only exists once SAP has assigned one at posting time.
export async function fetchMaterialDocumentItems(materialDocNumber, materialDocYear) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const url = `${getBackendBaseUrl(creds.environment)}/api/goods-receipt/material-document-items`;

  let response;
  try {
    response = await axios.get(url, {
      params: { materialDocNumber, materialDocYear },
      headers: {
        "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
        "X-User-Environment": creds.environment,
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed while fetching the Material Document. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the Material Document service (network/CORS error).");
    }
    throw new Error(`Material Document lookup failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "Material Document lookup failed.");
  }

  return data.items || [];
}

function normalizeKey(value) {
  return String(value ?? "").trim();
}

function normalizeMaterial(value) {
  return String(value || "").trim().replace(/^0+(?=\d)/, "");
}

// Matches each GR item to the Batch(es) SAP auto-generated for it on the posted
// Material Document. Since one GR item can post as several to_MaterialDocumentItem
// lines (one per pallet — see buildMaterialDocumentPayload above), match by
// PurchaseOrderItem rather than by position or Material alone: every pallet-line for
// the same GR item carries the same PurchaseOrderItem. Falls back to matching by
// Material when PurchaseOrderItem isn't present on the returned doc items.
// All distinct Batch values found are kept in `batches` — SAP may assign one shared
// batch across every pallet-line of an item, or a separate batch per line, depending
// on batch determination config — `batch` is the first one, for display.
export function matchBatchesToItems(items, docItems) {
  return items.map((item) => {
    let matches = docItems.filter((d) => normalizeKey(d.PurchaseOrderItem) === normalizeKey(item.lineItem));
    if (matches.length === 0) {
      matches = docItems.filter((d) => normalizeMaterial(d.Material) === normalizeMaterial(item.materialNumber));
    }
    const batches = Array.from(new Set(matches.map((d) => d.Batch).filter(Boolean)));
    return { ...item, batches, batch: batches[0] || "" };
  });
}
