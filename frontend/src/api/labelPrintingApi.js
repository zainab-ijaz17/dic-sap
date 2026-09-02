import axios from "axios";
import { getUserCredentials } from "../api";
import { getBackendBaseUrl } from "../config/servers";
import { splitMaterialDescription } from "../utils/materialDescription";

// Escapes ZPL's own control characters out of field data. ^ and ~ start ZPL commands
// even inside an ^FD...^FS field, so a Material Description containing either would
// otherwise corrupt the label; \ is escaped too since it's ZPL's own escape char.
function zplEscape(value) {
  return String(value ?? "").replace(/[\^~\\]/g, "");
}

// One grid field: its heading on one line, its value on the next — used for every
// field in the grid below instead of "Heading: value" on a single line.
function fieldLines(x, y, heading, value) {
  return [
    `^FO${x},${y}^A0N,22,22^FD${zplEscape(heading)}^FS`,
    `^FO${x},${y + 30}^A0N,28,28^FD${zplEscape(value)}^FS`,
  ];
}

// Builds the ZPL for one Handling Unit/Batch label — 4x6in @ 203dpi (812 x 1218 dots,
// the standard warehouse label size/resolution; adjust ^PW/^LL here if the real stock
// turns out to differ). Mirrors the warehouse's existing paper label layout: a Code128
// barcode of the Batch at the top (no interpretation line — the short description code
// right below it fills that visual role instead), the Material Description's short
// code large with the rest of the description wrapped underneath, then a two-column
// grid (Purchase Order/Item, Material/Batch, Material Document/Location, Qty/Pallet
// Qty) with each field's heading above its value.
export function buildZplLabel(label) {
  const { short: descShort, rest: descRest } = splitMaterialDescription(label.materialDescription);
  const palletQtyValue = label.palletQuantity != null ? `${label.palletQuantity} ${label.uom}` : "-";
  const lines = [
    "^XA",
    "^CI28",
    "^PW812",
    "^LL1218",
    `^FO40,40^BY3^BCN,120,N,N,N^FD${zplEscape(label.batch)}^FS`,
    `^FO40,180^A0N,50,50^FD${zplEscape(descShort)}^FS`,
    `^FO40,245^A0N,28,28^FB732,2,0,L,0^FD${zplEscape(descRest)}^FS`,
    "^FO40,325^GB732,2,2^FS",
    ...fieldLines(40, 345, "Pur. Doc.", label.purchaseOrder || "-"),
    ...fieldLines(420, 345, "Pur. Item", label.purchaseOrderItem || "-"),
    ...fieldLines(40, 415, "Material", label.materialNumber),
    ...fieldLines(420, 415, "Batch", label.batch),
    ...fieldLines(40, 485, "Mat. Doc.", label.materialDocument || "-"),
    ...fieldLines(420, 485, "Location", label.location || "-"),
    ...fieldLines(40, 555, "Qty", `${label.quantity} ${label.uom}`),
    ...fieldLines(420, 555, "Pallet Qty", palletQtyValue),
    "^FO40,625^GB732,2,2^FS",
    "^XZ",
  ];
  return lines.join("\n");
}

async function sendToPrinter(label) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const url = `${getBackendBaseUrl(creds.environment)}/api/label-printing/print`;

  let response;
  try {
    response = await axios.post(
      url,
      { zpl: buildZplLabel(label) },
      {
        headers: {
          "X-User-Environment": creds.environment,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
  } catch (err) {
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the print service (network/CORS error).");
    }
    throw new Error(`Print failed: ${err.response.status} ${err.response.statusText}`);
  }

  if (!response.data?.success) {
    throw new Error(response.data?.message || "Print failed.");
  }

  return { success: true, printedAt: new Date().toLocaleString() };
}

export async function printLabel(label) {
  return sendToPrinter(label);
}

export async function reprintLabel(label) {
  return sendToPrinter(label);
}
