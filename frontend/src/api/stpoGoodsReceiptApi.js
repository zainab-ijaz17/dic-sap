import axios from "axios";
import { simulateDelay, randomFromSeed } from "./mockUtils";
import { DEFAULT_PLANT_STPO } from "../constants/warehouse";
import { getUserCredentials } from "../api";

// TODO: temporary — the backend routes these calls hit (backend/routes/
// stpoGoodsReceiptRoutes.js) haven't been pushed to git / deployed to CF yet, so
// point at the local backend instead of getBackendBaseUrl()'s deployed CF app.
// Switch back to getBackendBaseUrl(creds.environment) once those routes are live.
const STPO_BACKEND_BASE_URL = "http://localhost:3000";

// GR for STPO service layer. The STPO lookup and posting payload shapes are
// placeholders pending confirmation.
// TODO: confirm real STPO lookup + GR posting payload fields (including where
// Batch — see fetchStpoBatchesByMaterial() below — belongs in the posting payload),
// then update buildStpoMaterialDocumentPayload() and the backend route it hits.
const useClientMock = process.env.REACT_APP_STPO_LOOKUP_MOCK === "true";

const MOCK_MATERIALS = [
  { materialNumber: "MAT100234", materialDescription: "Steel Rod 12mm", uom: "KG" },
  { materialNumber: "MAT100567", materialDescription: "Aluminium Sheet 2mm", uom: "EA" },
  { materialNumber: "MAT100890", materialDescription: "Copper Wire Coil", uom: "EA" },
  { materialNumber: "MAT101123", materialDescription: "PVC Pipe 1 inch", uom: "MTR" },
];

// Only used when REACT_APP_STPO_LOOKUP_MOCK=true. When lineItem is provided, only
// that single line item is returned. When left blank, every line item is returned.
function getMockStpo(stpoNumber, lineItem) {
  const normalizedStpo = stpoNumber.trim().toUpperCase();
  const trimmedLineItem = (lineItem || "").trim().toUpperCase();

  if (trimmedLineItem) {
    const material = MOCK_MATERIALS[randomFromSeed(`${normalizedStpo}-${trimmedLineItem}`, MOCK_MATERIALS.length)];
    return {
      stpoNumber: normalizedStpo,
      plant: DEFAULT_PLANT_STPO,
      lineItems: [
        {
          lineItem: trimmedLineItem,
          materialNumber: material.materialNumber,
          materialDescription: material.materialDescription,
          quantity: 50 + randomFromSeed(`${normalizedStpo}-${trimmedLineItem}-qty`, 20) * 5,
          uom: material.uom,
          plant: DEFAULT_PLANT_STPO,
        },
      ],
    };
  }

  const startIndex = randomFromSeed(normalizedStpo, MOCK_MATERIALS.length);
  const lineItemCount = 3;
  const lineItems = Array.from({ length: lineItemCount }, (_, i) => {
    const material = MOCK_MATERIALS[(startIndex + i) % MOCK_MATERIALS.length];
    return {
      lineItem: String((i + 1) * 10).padStart(4, "0"),
      materialNumber: material.materialNumber,
      materialDescription: material.materialDescription,
      quantity: 50 + randomFromSeed(`${normalizedStpo}-${i}`, 20) * 5,
      uom: material.uom,
      plant: DEFAULT_PLANT_STPO,
    };
  });

  return { stpoNumber: normalizedStpo, plant: DEFAULT_PLANT_STPO, lineItems };
}

// SAP STPO numbers are 10-digit, zero-padded (e.g. 4500000215). Pad numeric input
// so a shorter user-typed number (e.g. "215") still resolves the right STPO.
function normalizeStpoNumber(stpoNumber) {
  const trimmed = stpoNumber.trim().toUpperCase();
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

// SAP's exact field names for this lookup aren't confirmed yet, so every field is
// read defensively across the common naming variants used by SAP's standard
// Purchase Order APIs/CDS views. If the real field names differ, only this mapping
// needs updating (see the console.warn below for the raw shape).
function mapStpoItem(raw) {
  return {
    lineItem: String(raw.PurchaseOrderItem ?? raw.EbelP ?? raw.ItemNumber ?? raw.Item ?? "").trim(),
    materialNumber: String(raw.Material ?? raw.Matnr ?? raw.MaterialNumber ?? "").trim(),
    materialDescription: String(
      raw.PurchaseOrderItemText ?? raw.ShortText ?? raw.MaterialDescription ?? raw.Txz01 ?? raw.ItemText ?? ""
    ).trim(),
    quantity: Number(raw.OrderQuantity ?? raw.PurchaseOrderQuantity ?? raw.Menge ?? raw.Quantity ?? 0),
    uom: String(raw.PurchaseOrderQuantityUnit ?? raw.OrderQuantityUnit ?? raw.Meins ?? raw.UnitOfMeasure ?? "").trim(),
    plant: String(raw.Plant ?? raw.Werks ?? DEFAULT_PLANT_STPO).trim(),
  };
}

async function fetchStpoLive(stpoNumber, lineItem) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const normalizedStpo = normalizeStpoNumber(stpoNumber);
  const url = `${STPO_BACKEND_BASE_URL}/api/stpo-goods-receipt/stock-transport-order/${normalizedStpo}`;

  let response;
  try {
    response = await axios.get(url, {
      headers: {
        "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
        "X-User-Environment": creds.environment,
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed for the STPO lookup. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the STPO lookup service (network/CORS error).");
    }
    throw new Error(`STPO lookup failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "STPO lookup failed.");
  }

  const rawItems = data.items || [];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error(`No line items found for STPO ${normalizedStpo}.`);
  }

  // eslint-disable-next-line no-console
  console.debug("STPO lookup raw item shape (first result):", rawItems[0]);

  let lineItems = rawItems.map(mapStpoItem);

  const trimmedLineItem = (lineItem || "").trim();
  if (trimmedLineItem) {
    lineItems = lineItems.filter((item) => lineItemsMatch(item.lineItem, trimmedLineItem));
    if (lineItems.length === 0) {
      throw new Error(`Line item ${trimmedLineItem} not found on STPO ${normalizedStpo}.`);
    }
  }

  return {
    stpoNumber: normalizedStpo,
    plant: lineItems[0]?.plant || DEFAULT_PLANT_STPO,
    lineItems,
  };
}

export async function fetchStpo(stpoNumber, lineItem) {
  if (useClientMock) {
    await simulateDelay(700);
    return getMockStpo(stpoNumber, lineItem);
  }
  return fetchStpoLive(stpoNumber, lineItem);
}

export const isStpoLookupMockEnabled = useClientMock;

// TODO: Check still simulates, mirroring checkGoodsReceipt() in goodsReceiptApi.js
// until/unless SAP exposes a validate-only option for this posting API.
export async function checkGrStpo(payload) {
  await simulateDelay(500);
  return { success: true, message: "Validation successful. Ready to post." };
}

// TODO: placeholder payload — pending confirmation of the real GR-for-STPO posting
// fields/API. Currently mirrors buildMaterialDocumentPayload() in goodsReceiptApi.js.
function buildStpoMaterialDocumentPayload({ stpoNumber, items, storageLocation, movementType, deliveryNote }) {
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
          PurchaseOrder: stpoNumber,
          PurchaseOrderItem: item.lineItem,
          Plant: item.plant || DEFAULT_PLANT_STPO,
          StorageLocation: storageLocation,
          Batch: item.batch,
          EntryUnit: item.uom,
          QuantityInEntryUnit: String(pallet.quantity),
        }));
      }),
    },
  };
}

export async function postGrStpo({ stpoNumber, items, storageLocation, movementType, deliveryNote }) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const payload = buildStpoMaterialDocumentPayload({ stpoNumber, items, storageLocation, movementType, deliveryNote });
  const url = `${STPO_BACKEND_BASE_URL}/api/stpo-goods-receipt/post`;

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
      throw new Error("SAP authentication failed while posting the GR for STPO. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the GR for STPO posting service (network/CORS error).");
    }
    throw new Error(`GR for STPO posting failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "GR for STPO posting failed.");
  }

  return {
    success: true,
    materialDocNumber: data.materialDocNumber,
    materialDocYear: data.materialDocYear,
    message: data.message || "GR for STPO posted successfully.",
  };
}

// SAP's exact field names for A_MaterialDocumentItem's $select list aren't
// confirmed yet, so every field is read defensively across common naming variants,
// same approach as mapStpoItem() above.
function mapMaterialDocumentItem(raw) {
  return {
    material: String(raw.Material ?? raw.Matnr ?? "").trim(),
    batch: String(raw.Batch ?? raw.Charg ?? "").trim(),
  };
}

// Batch for GR for STPO isn't picked by the user — it's whatever Batch was actually
// shipped for this STPO. Looks up A_MaterialDocumentItem for the STPO (backend
// filters to Plant 1312 + GoodsMovementType 351 — the supplying plant's
// stock-transfer goods-issue posting — and picks the latest Material Document if
// there's more than one) and returns a Material -> Batch map. GrStpoPage calls this
// when the user clicks Next, so GrStpo2Page opens with Batch already known.
export async function fetchStpoBatchesByMaterial(stpoNumber) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const normalizedStpo = normalizeStpoNumber(stpoNumber);
  const url = `${STPO_BACKEND_BASE_URL}/api/stpo-goods-receipt/stpo-batches/${normalizedStpo}`;

  let response;
  try {
    response = await axios.get(url, {
      headers: {
        "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
        "X-User-Environment": creds.environment,
      },
      timeout: 30000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed while fetching existing batches. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the existing-batches lookup service (network/CORS error).");
    }
    throw new Error(`Existing batches lookup failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "Existing batches lookup failed.");
  }

  const rawItems = data.items || [];
  if (rawItems.length > 0) {
    // eslint-disable-next-line no-console
    console.debug("STPO existing-batches raw item shape (first result):", rawItems[0]);
  }

  const batchesByMaterial = {};
  rawItems.map(mapMaterialDocumentItem).forEach(({ material, batch }) => {
    if (material && batch && !batchesByMaterial[material]) {
      batchesByMaterial[material] = batch;
    }
  });

  return batchesByMaterial;
}
