import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import ConfirmModal from "../components/ConfirmModal";
import BarcodeInput from "../components/BarcodeInput";
import { fetchStoreReturnItem, postStoreReturn } from "../api/storeReturnApi";
import { HU_BARCODE_MAX_LENGTH } from "../constants/barcode";
import { validateBarcode } from "../utils/barcodeValidation";

// Store Return — scan an HU/material barcode, fetch its mock issued stock info,
// enter the quantity + reason to return, then reset.
// TODO: fetchStoreReturnItem()/postStoreReturn() are mocked (frontend/src/api/storeReturnApi.js).
// Swap them for real material lookup / store-return posting calls once available.
function StoreReturnPage({ user, onLogout }) {
  const navigate = useNavigate();
  const [barcode, setBarcode] = useState("");
  const [itemInfo, setItemInfo] = useState(null);
  const [returnQuantity, setReturnQuantity] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [fetching, setFetching] = useState(false);
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const barcodeInputRef = useRef(null);

  const resetScreen = () => {
    setBarcode("");
    setItemInfo(null);
    setReturnQuantity("");
    setReturnReason("");
    setTimeout(() => barcodeInputRef.current?.focus(), 0);
  };

  const confirmClearAll = () => {
    resetScreen();
    setShowClearConfirm(false);
  };

  const handleFetch = async (barcodeValue) => {
    const value = (barcodeValue ?? barcode).trim().toUpperCase();
    const validationError = validateBarcode(value, "HU/Material Barcode");
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setSuccessMessage("");
    setFetching(true);
    try {
      const info = await fetchStoreReturnItem(value);
      setItemInfo(info);
      setReturnQuantity(String(info.issuedQuantity));
    } catch (err) {
      setError(err.message || "Failed to fetch item.");
    } finally {
      setFetching(false);
    }
  };

  const handleReturn = async () => {
    if (!itemInfo) {
      setError("Please fetch an item first.");
      return;
    }
    if (!String(returnQuantity).trim() || Number(returnQuantity) <= 0) {
      setError("Please enter a valid Return Quantity.");
      return;
    }
    if (!returnReason.trim()) {
      setError("Please enter a Return Reason.");
      return;
    }
    setError("");
    setReturning(true);
    try {
      const result = await postStoreReturn(itemInfo, returnQuantity, returnReason.trim());
      setSuccessMessage(result.message);
      resetScreen();
    } catch (err) {
      setError(err.message || "Store return failed.");
    } finally {
      setReturning(false);
    }
  };

  return (
    <div className="app-container">
      <PageHeader user={user} onLogout={onLogout} />

      <div style={{ maxWidth: "600px", margin: "20px auto", padding: "1rem" }}>
        <div style={{ background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
          <h2 style={{ marginTop: 0 }}>Store Return</h2>

          {error && <div className="error">{error}</div>}
          {successMessage && (
            <div style={{ background: "#dcfce7", color: "#166534", padding: "0.75rem", borderRadius: "8px", marginBottom: "0.75rem" }}>
              {successMessage}
            </div>
          )}

          <div className="form-group">
            <label>HU/Material Barcode</label>
            <BarcodeInput
              ref={barcodeInputRef}
              value={barcode}
              onChange={setBarcode}
              onComplete={handleFetch}
              maxLength={HU_BARCODE_MAX_LENGTH}
              placeholder="Scan or enter barcode"
              disabled={fetching || returning}
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", marginTop: "0.75rem" }}>
            <LoadingButton onClick={() => handleFetch()} loading={fetching} disabled={returning}>Fetch</LoadingButton>
            <LoadingButton onClick={() => setShowClearConfirm(true)} variant="danger" disabled={fetching || returning}>
              Clear All
            </LoadingButton>
          </div>

          {itemInfo && (
            <>
              <div style={{ padding: "0.9rem", background: "#f9fafb", borderRadius: "8px", border: "1px solid #e5e7eb", marginTop: "0.75rem" }}>
                <div><strong>Material:</strong> {itemInfo.materialNumber} — {itemInfo.materialDescription}</div>
                <div><strong>Issued Quantity:</strong> {itemInfo.issuedQuantity} {itemInfo.uom}</div>
                <div><strong>Plant:</strong> {itemInfo.plant}</div>
                <div><strong>Storage Location:</strong> {itemInfo.storageLocation}</div>
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label>Return Quantity</label>
                <input
                  className="form-control"
                  type="number"
                  value={returnQuantity}
                  onChange={(e) => setReturnQuantity(e.target.value)}
                  disabled={returning}
                />
              </div>

              <div className="form-group">
                <label>Return Reason</label>
                <input
                  className="form-control"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="Enter Return Reason"
                  disabled={returning}
                />
              </div>

              <LoadingButton onClick={handleReturn} loading={returning} variant="success">Return</LoadingButton>
            </>
          )}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "20px", left: "20px" }}>
        <LoadingButton onClick={() => navigate("/main")} variant="neutral" disabled={fetching || returning}>
          Back
        </LoadingButton>
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

export default StoreReturnPage;
