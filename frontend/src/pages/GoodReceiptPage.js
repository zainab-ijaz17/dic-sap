import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import ConfirmModal from "../components/ConfirmModal";
import LineItemsTable from "../components/LineItemsTable";
import { fetchPurchaseOrder } from "../api/goodsReceiptApi";

// Goods Receipt — Page 1: fetch a Purchase Order. Every line item returned is
// forwarded to Page 2, where the user picks exactly one to continue with.
// If the user navigates Back from Page 2, prefillPoNumber/prefillLineItems restore
// what was already fetched here instead of resetting to a blank form.
// TODO: fetchPurchaseOrder() is mocked (frontend/src/api/goodsReceiptApi.js).
// Swap it for a real SAP/OData Purchase Order lookup once the backend is ready.
function GoodReceiptPage({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [poNumber, setPoNumber] = useState(location.state?.prefillPoNumber || "");
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

    if (!poNumber.trim()) {
      setError("Please enter a Purchase Order Number.");
      return;
    }

    setLoading(true);
    try {
      const result = await fetchPurchaseOrder(poNumber, lineItem);
      setLineItems(result.lineItems || []);
    } catch (err) {
      setError(err.message || "Failed to fetch Purchase Order.");
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    if (lineItems.length === 0) {
      setError("Please fetch a Purchase Order first.");
      return;
    }
    navigate("/goodreceipt2", {
      state: { poNumber: poNumber.trim().toUpperCase(), lineItems },
    });
  };

  const handleRemoveLineItem = (item) => {
    setLineItems((prev) => prev.filter((li) => li.lineItem !== item.lineItem));
    if (previewItem?.lineItem === item.lineItem) setPreviewItem(null);
  };

  const handleReset = () => {
    setPoNumber("");
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
          <h2 style={{ marginTop: 0 }}>Goods Receipt</h2>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div className="form-group" style={{ flex: "3 1 0%" }}>
              <label>Purchase Order Number</label>
              <input
                className="form-control"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleFetch()}
                placeholder="Enter Purchase Order Number"
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
            Line Item is optional — leave it blank to fetch all line items on the PO.
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
        <LoadingButton onClick={handleNext} disabled={lineItems.length === 0 || loading}>Next</LoadingButton>
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

export default GoodReceiptPage;
