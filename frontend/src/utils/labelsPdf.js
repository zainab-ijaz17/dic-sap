import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";
import { splitMaterialDescription } from "./materialDescription";

// A4 sheet, 2 label cards per row, wrapping to as many rows/pages as needed — "one
// next to each other" rather than one label per page. All measurements in mm.
const PAGE_MARGIN = 10;
const CARD_WIDTH = 90;
const CARD_HEIGHT = 80;
const COL_GAP = 10;
const ROW_GAP = 8;
const COLUMNS = 2;

// JsBarcode needs a real canvas to draw into — BarcodeDisplay.js uses one already
// mounted in the DOM (for on-screen display); this one is thrown away right after
// its PNG is read out, since a PDF page needs the barcode as an image, not a canvas.
function renderBarcodeDataUrl(value) {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, String(value ?? ""), {
    format: "CODE128",
    displayValue: false,
    margin: 4,
    height: 60,
    width: 3,
  });
  return canvas.toDataURL("image/png");
}

// One grid field: heading above value, same convention as LabelField in
// ../pages/LabelPrintingPage.js.
function drawField(doc, x, y, heading, value) {
  doc.setFontSize(6.5);
  doc.setTextColor(107, 114, 128);
  doc.text(heading, x, y);
  doc.setFont(undefined, "bold");
  doc.setFontSize(9);
  doc.setTextColor(17, 24, 39);
  doc.text(String(value), x, y + 4.5);
  doc.setFont(undefined, "normal");
}

// Draws one label card — mirrors LabelPrintingPage.js's on-screen card and
// buildZplLabel's printed layout: Batch barcode, the Material Description's short
// code large with the rest underneath, then the Pur. Doc./Item, Material/Batch, Mat.
// Doc./Location, Qty/Pallet Qty grid.
function drawLabelCard(doc, label, x, y) {
  doc.setDrawColor(156, 163, 175);
  doc.rect(x, y, CARD_WIDTH, CARD_HEIGHT);

  const barcodeWidth = 55;
  const barcodeHeight = 14;
  doc.addImage(renderBarcodeDataUrl(label.batch), "PNG", x + (CARD_WIDTH - barcodeWidth) / 2, y + 3, barcodeWidth, barcodeHeight);

  const { short: descShort, rest: descRest } = splitMaterialDescription(label.materialDescription);
  doc.setFont(undefined, "bold");
  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text(descShort || "-", x + CARD_WIDTH / 2, y + 24, { align: "center" });
  doc.setFont(undefined, "normal");

  doc.setFontSize(7.5);
  doc.setTextColor(55, 65, 81);
  const descLines = doc.splitTextToSize(descRest || "", CARD_WIDTH - 6).slice(0, 2);
  doc.text(descLines, x + CARD_WIDTH / 2, y + 29, { align: "center" });

  doc.setDrawColor(209, 213, 219);
  doc.line(x + 3, y + 36, x + CARD_WIDTH - 3, y + 36);

  const col1X = x + 4;
  const col2X = x + CARD_WIDTH / 2 + 2;
  const [row1Y, row2Y, row3Y, row4Y] = [y + 43, y + 52, y + 61, y + 70];

  drawField(doc, col1X, row1Y, "Pur. Doc.", label.purchaseOrder || "-");
  drawField(doc, col2X, row1Y, "Pur. Item", label.purchaseOrderItem || "-");
  drawField(doc, col1X, row2Y, "Material", label.materialNumber || "-");
  drawField(doc, col2X, row2Y, "Batch", label.batch || "-");
  drawField(doc, col1X, row3Y, "Mat. Doc.", label.materialDocument || "-");
  drawField(doc, col2X, row3Y, "Location", label.location || "-");
  drawField(doc, col1X, row4Y, "Qty", `${label.quantity} ${label.uom}`);
  drawField(doc, col2X, row4Y, "Pallet Qty", label.palletQuantity != null ? `${label.palletQuantity} ${label.uom}` : "-");
}

function buildLabelsPdf(labels) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageHeight = doc.internal.pageSize.getHeight();
  const rowsPerPage = Math.max(1, Math.floor((pageHeight - PAGE_MARGIN * 2 + ROW_GAP) / (CARD_HEIGHT + ROW_GAP)));
  const perPage = COLUMNS * rowsPerPage;

  labels.forEach((label, index) => {
    const posOnPage = index % perPage;
    if (index > 0 && posOnPage === 0) doc.addPage();
    const col = posOnPage % COLUMNS;
    const row = Math.floor(posOnPage / COLUMNS);
    drawLabelCard(
      doc,
      label,
      PAGE_MARGIN + col * (CARD_WIDTH + COL_GAP),
      PAGE_MARGIN + row * (CARD_HEIGHT + ROW_GAP)
    );
  });

  return doc;
}

// Builds a one-page-or-more PDF with every label laid out side by side and returns a
// blob: URL for it — pass straight to an <iframe src> for an in-app preview (the
// browser's built-in PDF viewer supplies the print/download controls). Caller owns
// the URL and should URL.revokeObjectURL it once no longer shown, same as any other
// object URL.
export function buildLabelsPdfBlobUrl(labels) {
  return buildLabelsPdf(labels).output("bloburl");
}
