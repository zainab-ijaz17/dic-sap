import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import ConfirmModal from "../components/ConfirmModal";
import BarcodeInput from "../components/BarcodeInput";
import { fetchBatchInfo } from "../api/batchInfoApi";
import { postBatchCharacteristics } from "../api/batchClassApi";
import { BIN_CHARACTERISTIC } from "../constants/batchClass";
import { BATCH_BARCODE_MAX_LENGTH, BIN_BARCODE_MAX_LENGTH, BIN_MIN_LENGTH } from "../constants/barcode";
import { validateBarcode } from "../utils/barcodeValidation";

// Putaway — scan (or type) a Batch and a Bin, then Putaway assigns the Bin to that
// Batch via the same batch classification mechanism used on GoodReceipt2Page
// (API_BATCH_SRV/BatchCharcValue, CharcInternalID 3942 — see ../constants/batchClass.js
// and ../api/batchClassApi.js), rather than the old Handling-Unit-based
// Z_HU_PUTAWAY_SRV_SRV placement. Since this screen only collects Batch + Bin (not
// Material, which BatchCharcValue's key requires), Putaway first resolves the Material
// for the scanned Batch via ../api/batchInfoApi.js, then assigns the Bin.
// Completing the Batch field moves focus to Bin; completing Bin fires Putaway directly,
// so a scan-scan sequence needs no button press — the on-screen button is a manual
// fallback for typed entry.
function PutawayPage({ user, onLogout }) {
  const navigate = useNavigate();

  const [batch, setBatch] = useState("");
  const [bin, setBin] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [successData, setSuccessData] = useState(null);

  const binInputRef = useRef(null);
  const batchInputRef = useRef(null);

  const handleBatchComplete = (value) => {
    const validationError = validateBarcode(value, "Batch");
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    binInputRef.current?.focus();
  };

  const handleBinComplete = (value) => {
    handlePutaway(value);
  };

  const handlePutaway = async (binOverride) => {
    const batchValue = batch.trim().toUpperCase();
    const binValue = (binOverride ?? bin).trim().toUpperCase();

    const batchError = validateBarcode(batchValue, "Batch");
    if (batchError) {
      setError(batchError);
      return;
    }
    const binError = validateBarcode(binValue, "Bin", BIN_MIN_LENGTH);
    if (binError) {
      setError(binError);
      return;
    }

    setError("");
    setLoading(true);
    try {
      setProgress("Looking up Batch…");
      const info = await fetchBatchInfo(batchValue);

      setProgress("Assigning Bin…");
      await postBatchCharacteristics({
        material: info.material,
        batch: batchValue,
        values: { bin: binValue },
        characteristics: [BIN_CHARACTERISTIC],
      });

      setSuccessData({
        batch: batchValue,
        bin: binValue,
        material: info.material,
        materialDescription: info.materialDescription,
      });
    } catch (err) {
      setError(err.message || "Putaway failed.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  const handleFetchAgain = () => {
    setSuccessData(null);
    setBatch("");
    setBin("");
    setError("");
    batchInputRef.current?.focus();
  };

  const handleDone = () => {
    navigate("/main");
  };

  return (
    <div className="app-container">
      <PageHeader user={user} onLogout={onLogout} />

      <div style={{ maxWidth: "500px", margin: "20px auto", padding: "1rem" }}>
        <div style={{ background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
          <h2 style={{ marginTop: 0 }}>Putaway</h2>

          {error && <div className="error">{error}</div>}
          {progress && <div style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "0.75rem" }}>{progress}</div>}

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
          </div>

          <div className="form-group">
            <label>Bin</label>
            <BarcodeInput
              ref={binInputRef}
              value={bin}
              onChange={setBin}
              onComplete={handleBinComplete}
              maxLength={BIN_BARCODE_MAX_LENGTH}
              placeholder="Scan or enter Bin"
              disabled={loading}
              autoFocus={false}
            />
          </div>
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "20px", left: "20px" }}>
        <LoadingButton onClick={() => navigate("/main")} variant="neutral" disabled={loading}>
          Back
        </LoadingButton>
      </div>

      <div style={{ position: "fixed", bottom: "20px", right: "20px" }}>
        <LoadingButton onClick={() => handlePutaway()} loading={loading}>
          Putaway
        </LoadingButton>
      </div>

      <ConfirmModal
        open={!!successData}
        title="Putaway Successful"
        message={
          successData
            ? `Batch ${successData.batch} → Bin ${successData.bin}\nMaterial: ${successData.material}${
                successData.materialDescription ? ` — ${successData.materialDescription}` : ""
              }`
            : ""
        }
        confirmLabel="Fetch Again"
        cancelLabel="Done"
        confirmVariant="primary"
        onConfirm={handleFetchAgain}
        onCancel={handleDone}
      />
    </div>
  );
}

export default PutawayPage;
