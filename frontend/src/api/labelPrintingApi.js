import axios from "axios";
import { getUserCredentials } from "../api";
import { getBackendBaseUrl } from "../config/servers";

// Escapes ZPL's own control characters out of field data. ^ and ~ start ZPL commands
// even inside an ^FD...^FS field, so a Material Description containing either would
// otherwise corrupt the label; \ is escaped too since it's ZPL's own escape char.
function zplEscape(value) {
  return String(value ?? "").replace(/[\^~\\]/g, "");
}

// Builds the ZPL for one Handling Unit/Batch label — 4x6in @ 203dpi (812 x 1218 dots,
// the standard warehouse label size/resolution; adjust ^PW/^LL here if the real stock
// turns out to differ). Layout: Material Number + Description, Batch (as both a
// Code128 barcode and human-readable text), Quantity/UOM, Expiration Date, then Bin
// (also as both a barcode and human-readable text).
export function buildZplLabel(label) {
  const lines = [
    "^XA",
    "^CI28",
    "^PW812",
    "^LL1218",
    `^FO40,40^A0N,40,40^FD${zplEscape(label.materialNumber)}^FS`,
    `^FO40,90^A0N,30,30^FD${zplEscape(label.materialDescription)}^FS`,
    "^FO40,150^GB732,2,2^FS",
    `^FO40,180^A0N,30,30^FDBatch^FS`,
    `^FO40,215^BY3^BCN,120,Y,N,N^FD${zplEscape(label.batch)}^FS`,
    `^FO40,360^A0N,30,30^FDQty: ${zplEscape(label.quantity)} ${zplEscape(label.uom)}^FS`,
    `^FO40,400^A0N,30,30^FDExpiration Date: ${zplEscape(label.expirationDate || "-")}^FS`,
    "^FO40,450^GB732,2,2^FS",
    `^FO40,480^A0N,30,30^FDBin^FS`,
    `^FO40,515^BY3^BCN,120,Y,N,N^FD${zplEscape(label.bin || "-")}^FS`,
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
