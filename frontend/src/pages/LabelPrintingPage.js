import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import BarcodeInput from "../components/BarcodeInput";
import BarcodeDisplay from "../components/BarcodeDisplay";
import { fetchBatchInfo, fetchBatchDocumentInfo } from "../api/batchInfoApi";
import { fetchBatchQuantity } from "../api/materialStockApi";
import { fetchExpirationDate } from "../api/batchClassApi";
import { fetchPurchaseOrder } from "../api/goodsReceiptApi";
import { printLabel, reprintLabel } from "../api/labelPrintingApi";
import { BATCH_BARCODE_MAX_LENGTH } from "../constants/barcode";
import { validateBarcode } from "../utils/barcodeValidation";
import { splitMaterialDescription } from "../utils/materialDescription";

// Label Printing — scan (or type) a Batch, look up its Material/Description
// (../api/batchInfoApi.js), current stock Quantity (../api/materialStockApi.js),
// Expiration Date characteristic (../api/batchClassApi.js), and the Purchase
// Order/Material Document it was received against (../api/batchInfoApi.js's
// fetchBatchDocumentInfo, plus ../api/goodsReceiptApi.js's fetchPurchaseOrder for the
// description), then print a label carrying all of it plus a Code128 barcode of the
// Batch — see buildZplLabel in ../api/labelPrintingApi.js for the actual label layout.
// Printing sends the ZPL to a network Zebra printer via
// backend/routes/labelPrintingRoutes.js; set LABEL_PRINTER_HOST_DEV/PRD in
// backend/.env to the real printer IP once known.
function LabelPrintingPage({ user, onLogout }) {
  const navigate = useNavigate();
  const batchInputRef = useRef(null);

  const [batch, setBatch] = useState("");
  const [label, setLabel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");

  const fetchLabelData = async (batchValue) => {
    setError("");
    setLoading(true);
    try {
      const info = await fetchBatchInfo(batchValue);
      const [stock, expirationDate, docInfo] = await Promise.all([
        fetchBatchQuantity(info.material, batchValue),
        fetchExpirationDate(info.material, batchValue),
        fetchBatchDocumentInfo(batchValue),
      ]);

      // API_BATCH_SRV/Batch's MaterialDescription (info.materialDescription) comes
      // back blank in practice, so fall back to the Purchase Order Fact Sheet's item
      // text for the PO/Item this batch was received against — the same lookup
      // GoodReceiptPage.js already relies on (fetchPurchaseOrder, ../api/goodsReceiptApi.js)
      // and confirmed working there. Only attempted when a PO/Item is on record; a
      // failure here (or no PO/Item at all) just leaves whatever API_BATCH_SRV returned.
      let materialDescription = info.materialDescription;
      if (docInfo.purchaseOrder && docInfo.purchaseOrderItem) {
        try {
          const po = await fetchPurchaseOrder(docInfo.purchaseOrder, docInfo.purchaseOrderItem);
          materialDescription = po.lineItems[0]?.materialDescription || materialDescription;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.debug("Purchase Order Fact Sheet description lookup failed, keeping API_BATCH_SRV value:", err.message);
        }
      }

      // Plant/Storage Location: prefer the batch's current stock location
      // (fetchBatchQuantity), falling back to where the Material Document posted it
      // and then to API_BATCH_SRV's BatchIdentifyingPlant, in case any one source
      // comes back blank.
      const plant = stock.plant || docInfo.plant || info.plant || "";
      const storageLocation = stock.storageLocation || docInfo.storageLocation || "";
      setLabel({
        materialNumber: info.material,
        materialDescription,
        batch: batchValue,
        quantity: stock.quantity,
        uom: stock.uom,
        expirationDate,
        purchaseOrder: docInfo.purchaseOrder,
        purchaseOrderItem: docInfo.purchaseOrderItem,
        materialDocument: docInfo.materialDocument,
        location: plant && storageLocation ? `${plant}/${storageLocation}` : (plant || storageLocation || ""),
        printCount: 0,
        printedAt: null,
      });
    } catch (err) {
      setError(err.message || "Failed to fetch label data.");
    } finally {
      setLoading(false);
    }
  };

  const handleBatchComplete = (value) => {
    const validationError = validateBarcode(value, "Batch");
    if (validationError) {
      setError(validationError);
      return;
    }
    fetchLabelData(value.trim().toUpperCase());
  };

  const applyPrintResult = (result) => {
    setLabel((prev) => ({ ...prev, printedAt: result.printedAt, printCount: prev.printCount + 1 }));
  };

  const handlePrint = async () => {
    setError("");
    setPrinting(true);
    try {
      const result = await printLabel(label);
      applyPrintResult(result);
    } catch (err) {
      setError(err.message || "Print failed.");
    } finally {
      setPrinting(false);
    }
  };

  const handleReprint = async () => {
    setError("");
    setPrinting(true);
    try {
      const result = await reprintLabel(label);
      applyPrintResult(result);
    } catch (err) {
      setError(err.message || "Reprint failed.");
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintAnother = () => {
    setLabel(null);
    setBatch("");
    setError("");
    batchInputRef.current?.focus();
  };

  return (
    <div className="app-container">
      <PageHeader user={user} onLogout={onLogout} />

      <div style={{ maxWidth: "500px", margin: "20px auto", padding: "1rem" }}>
        <div style={{ background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
          <h2 style={{ marginTop: 0 }}>Label Printing</h2>

          {error && <div className="error">{error}</div>}

          {!label && (
            <div className="form-group">
              <label>Batch</label>
              <BarcodeInput
                ref={batchInputRef}
                value={batch}
                onChange={setBatch}
                onComplete={handleBatchComplete}
                maxLength={BATCH_BARCODE_MAX_LENGTH}
                placeholder="Scan or enter Batch"
                disabled={loading}
              />
              {loading && <div style={{ marginTop: "0.75rem", color: "#6b7280", fontSize: "0.85rem" }}>Looking up Batch…</div>}
            </div>
          )}

          {label && (() => {
            const { short: descShort, rest: descRest } = splitMaterialDescription(label.materialDescription);
            return (
              <div style={{ border: "2px dashed #9ca3af", borderRadius: "10px", padding: "1.25rem", background: "#fafafa" }}>
                <div style={{ margin: "0 0 0.5rem", textAlign: "center" }}>
                  <BarcodeDisplay value={label.batch} displayValue={false} />
                </div>
                <div style={{ textAlign: "center", fontSize: "2rem", fontWeight: 800, letterSpacing: "1px" }}>
                  {descShort}
                </div>
                <div style={{ textAlign: "center", color: "#374151", marginBottom: "0.75rem" }}>
                  {descRest}
                </div>
                <div style={{ borderTop: "1px solid #d1d5db", margin: "0.75rem 0" }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: "0.5rem", columnGap: "1rem", fontSize: "0.95rem" }}>
                  <div><strong>Pur. Doc.:</strong> {label.purchaseOrder || "-"}</div>
                  <div><strong>Pur. Item:</strong> {label.purchaseOrderItem || "-"}</div>
                  <div><strong>Material:</strong> {label.materialNumber}</div>
                  <div><strong>Batch:</strong> {label.batch}</div>
                  <div><strong>Mat. Doc.:</strong> {label.materialDocument || "-"}</div>
                  <div><strong>Location:</strong> {label.location || "-"}</div>
                  <div style={{ gridColumn: "1 / -1" }}><strong>Qty:</strong> {label.quantity} {label.uom}</div>
                </div>
                <div style={{ borderTop: "1px solid #d1d5db", margin: "0.75rem 0" }} />
                <div style={{ marginBottom: "0.5rem" }}><strong>Expiration Date:</strong> {label.expirationDate || "-"}</div>
                <div style={{ marginTop: "0.75rem", color: "#6b7280", fontSize: "0.9rem" }}>
                  {label.printCount > 0 ? `Printed ${label.printCount}x — last at ${label.printedAt}` : "Not printed yet"}
                </div>
              </div>
            );
          })()}

          {label && (
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem" }}>
              <LoadingButton onClick={handlePrint} loading={printing}>Print</LoadingButton>
              <LoadingButton onClick={handleReprint} loading={printing} disabled={label.printCount === 0} variant="neutral">
                Reprint
              </LoadingButton>
            </div>
          )}

          {label && (
            <div style={{ marginTop: "0.75rem" }}>
              <LoadingButton onClick={handlePrintAnother} disabled={printing} variant="neutral">
                Print Another
              </LoadingButton>
            </div>
          )}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "20px", left: "20px" }}>
        <LoadingButton onClick={() => navigate("/main")} variant="neutral" disabled={printing || loading}>
          Back
        </LoadingButton>
      </div>
    </div>
  );
}

export default LabelPrintingPage;
