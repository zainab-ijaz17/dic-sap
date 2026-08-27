import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import ConfirmModal from "../components/ConfirmModal";
import LineItemsTable from "../components/LineItemsTable";
import { fetchStpo, fetchStpoBatchesByMaterial } from "../api/stpoGoodsReceiptApi";

// GR for STPO — Page 1: fetch a Stock Transport Purchase Order. Based on
// GoodReceiptPage.js; the underlying API module differs (../api/stpoGoodsReceiptApi.js)
// since STPO posting uses a different payload. Every line item returned is forwarded
// to Page 2. If the user navigates Back from Page 2, prefillStpoNumber/prefillLineItems
// restore what was already fetched here instead of resetting to a blank form.
//
// Fetch itself already looks up the Batch(es) actually shipped for this STPO
// (fetchStpoBatchesByMaterial() in ../api/stpoGoodsReceiptApi.js) and shows each line
// item's Quantity as the sum of what was actually shipped across those batches —
// never the STPO line item's ordered quantity — since what was ordered can overstate
// what's actually available to receive. Clicking Next re-fetches the same batch data
// and expands each line item into one row per Batch found for that Material — a
// Material commonly ships as several batches — before handing off to GrStpo2Page,
// with each row's own quantity/uom from that specific Batch (so posting several
// batches for one material doesn't re-post the same total for every batch).
function GrStpoPage({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [stpoNumber, setStpoNumber] = useState(location.state?.prefillStpoNumber || "");
  const [lineItem, setLineItem] = useState("");
  const [lineItems, setLineItems] = useState(location.state?.prefillLineItems || []);
  const [previewItem, setPreviewItem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleFetch = async () => {
    setError("");
    setPreviewItem(null);
    setLineItems([]);

    if (!stpoNumber.trim()) {
      setError("Please enter a STPO Number.");
      return;
    }

    setLoading(true);
    try {
      const result = await fetchStpo(stpoNumber, lineItem);
      const batchesByMaterial = await fetchStpoBatchesByMaterial(stpoNumber);
      const lineItemsWithShippedQty = (result.lineItems || []).map((item) => {
        const batches = batchesByMaterial[item.materialNumber] || [];
        const shippedQty = batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
        return { ...item, quantity: shippedQty, uom: batches[0]?.uom || item.uom };
      });
      setLineItems(lineItemsWithShippedQty);
    } catch (err) {
      setError(err.message || "Failed to fetch STPO.");
    } finally {
      setLoading(false);
    }
  };

  const handleNext = async () => {
    if (lineItems.length === 0) {
      setError("Please fetch a STPO first.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const batchesByMaterial = await fetchStpoBatchesByMaterial(stpoNumber);
      const lineItemsWithBatch = lineItems.flatMap((item) => {
        const batches = batchesByMaterial[item.materialNumber] || [];
        if (batches.length === 0) return [{ ...item, batch: "" }];
        return batches.map(({ batch, quantity, uom }) => ({
          ...item,
          batch,
          quantity: quantity || item.quantity,
          uom: uom || item.uom,
        }));
      });
      navigate("/grstpo2", {
        state: { stpoNumber: stpoNumber.trim().toUpperCase(), lineItems: lineItemsWithBatch },
      });
    } catch (err) {
      setError(err.message || "Failed to fetch existing batches for this STPO.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveLineItem = (item) => {
    setLineItems((prev) => prev.filter((li) => li.lineItem !== item.lineItem));
    if (previewItem?.lineItem === item.lineItem) setPreviewItem(null);
  };

  const handleReset = () => {
    setStpoNumber("");
    setLineItem("");
    setLineItems([]);
    setPreviewItem(null);
    setError("");
  };

  const confirmClearAll = () => {
    handleReset();
    setShowClearConfirm(false);
  };

  return (
    <div className="app-container">
      <PageHeader user={user} onLogout={onLogout} />

      <div style={{ maxWidth: "600px", margin: "20px auto", padding: "1rem" }}>
        <div style={{ background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
          <h2 style={{ marginTop: 0 }}>GR for STPO</h2>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div className="form-group" style={{ flex: "3 1 0%" }}>
              <label>STPO Number</label>
              <input
                className="form-control"
                value={stpoNumber}
                onChange={(e) => setStpoNumber(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleFetch()}
                placeholder="Enter STPO Number"
                disabled={loading}
              />
            </div>

            <div className="form-group" style={{ flex: "1 1 0%" }}>
              <label>Item</label>
              <input
                className="form-control"
                value={lineItem}
                onChange={(e) => setLineItem(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleFetch()}
                placeholder="e.g. 010"
                maxLength={3}
                disabled={loading}
              />
            </div>
          </div>
          <div style={{ marginTop: "-0.5rem", marginBottom: "0.5rem", fontSize: "0.8rem", color: "#6b7280" }}>
            Line Item is optional — leave it blank to fetch all line items on the STPO.
          </div>

          {error && <div className="error">{error}</div>}

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "center" }}>
            <LoadingButton onClick={handleFetch} loading={loading}>Fetch</LoadingButton>
            <LoadingButton onClick={() => setShowClearConfirm(true)} variant="danger" disabled={loading}>Clear All</LoadingButton>
          </div>

          <LineItemsTable
            lineItems={lineItems}
            selectedLineItem={previewItem}
            onSelectLineItem={setPreviewItem}
            onRemoveLineItem={handleRemoveLineItem}
          />
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "20px", left: "20px" }}>
        <LoadingButton onClick={() => navigate("/main")} variant="neutral" disabled={loading}>Back</LoadingButton>
      </div>

      <div style={{ position: "fixed", bottom: "20px", right: "20px" }}>
        <LoadingButton onClick={handleNext} loading={loading} disabled={lineItems.length === 0}>Next</LoadingButton>
      </div>

      <ConfirmModal
        open={showClearConfirm}
        title="Clear All Entries"
        message="Are you sure you want to clear all entries? This action cannot be undone."
        confirmLabel="Yes, Clear All"
        cancelLabel="Cancel"
        confirmVariant="danger"
        onConfirm={confirmClearAll}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
}

export default GrStpoPage;
