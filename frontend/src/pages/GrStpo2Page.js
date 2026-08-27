import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import { checkGrStpo, postGrStpo } from "../api/stpoGoodsReceiptApi";
import { postBatchCharacteristics, fetchBin } from "../api/batchClassApi";
import { BIN_CHARACTERISTIC } from "../constants/batchClass";
import { DEFAULT_MOVEMENT_TYPE_GR } from "../constants/warehouse";

// Assigning Bin right after posting hits SAP again immediately on the heels of a
// live post, so a transient failure there (network blip, momentary lock contention)
// shouldn't immediately surface as a failure — retry once before giving up. Mirrors
// retryOnce() in GoodReceipt2Page.js.
async function retryOnce(fn) {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

// GR for STPO — Page 2: Storage Location/Movement Type/Delivery Note on top, then a
// scan-and-match step modeled on ScanPage.js instead of per-item quantity/batch
// editing. The line items forwarded from GrStpoPage.js are already expanded to one
// row per Batch actually shipped for this STPO (fetchStpoBatchesByMaterial(), called
// when the user clicked Next on Page 1 — see ../api/stpoGoodsReceiptApi.js) — a
// Material with 3 shipped batches arrives here as 3 rows, one per Batch; scanning is
// just physically confirming which of those Batches are present before posting.
// Only matched line items get sent to Check/Post — an item whose Batch was never
// scanned doesn't get received.
//
// Unlike GoodReceipt2Page.js, Batch is already known here before posting (it's the
// Batch that was actually shipped, not SAP-assigned at GR time), so Post can assign
// Bin = "floor" to every matched Batch directly, without a fetch-Batch-back step.
function GrStpo2Page({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const stpoNumber = location.state?.stpoNumber;
  const items = location.state?.lineItems || [];

  const [storageLocation, setStorageLocation] = useState(location.state?.storageLocation || "");
  const [movementType, setMovementType] = useState(location.state?.movementType || DEFAULT_MOVEMENT_TYPE_GR);
  const [deliveryNote, setDeliveryNote] = useState(location.state?.deliveryNote || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validationPassed, setValidationPassed] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [showPostSuccessPopup, setShowPostSuccessPopup] = useState(false);
  const [postSuccessData, setPostSuccessData] = useState(null);
  const [progress, setProgress] = useState("");
  const [batchWarning, setBatchWarning] = useState("");

  const [scannedBatch, setScannedBatch] = useState("");
  const [matchedBatches, setMatchedBatches] = useState([]); // { ...item, isMatched, scannedBatch }
  const [finishOffloadingClicked, setFinishOffloadingClicked] = useState(false);
  const [showLeftovers, setShowLeftovers] = useState(false);
  const [showFullInfoPopup, setShowFullInfoPopup] = useState(false);
  const [selectedFullInfoBatch, setSelectedFullInfoBatch] = useState(null);
  const inputRef = useRef(null);

  const matchedCount = matchedBatches.filter((b) => b.isMatched).length;
  const totalCount = items.length;

  useEffect(() => {
    if (!location.state?.lineItems?.length) {
      navigate("/grstpo", { replace: true });
    }
  }, [location.state, navigate]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const extractBatchNumber = (barcode) => {
    if (!barcode) return "";
    return barcode.trim().toUpperCase();
  };

  const handleScan = () => {
    if (!scannedBatch.trim()) {
      return;
    }

    const batchNumber = extractBatchNumber(scannedBatch);
    if (!batchNumber) {
      return;
    }

    const matchedItem = items.find((item) => (item.batch || "").trim().toUpperCase() === batchNumber);

    if (matchedItem) {
      const newMatch = { ...matchedItem, isMatched: true, scannedBatch: batchNumber };
      setMatchedBatches((prev) => {
        const exists = prev.some((b) => b.batch === matchedItem.batch && b.isMatched === true);
        if (exists) return prev;
        return [...prev, newMatch];
      });
    } else {
      const notMatched = {
        materialNumber: "Not in Document",
        materialDescription: "Not in Document",
        batch: batchNumber,
        quantity: "",
        uom: "",
        isMatched: false,
        scannedBatch: batchNumber,
      };
      setMatchedBatches((prev) => {
        const exists = prev.some((b) => b.scannedBatch === batchNumber && b.isMatched === false);
        if (exists) return prev;
        return [...prev, notMatched];
      });
    }

    setScannedBatch("");
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleManualEntry = (e) => {
    if (e.key === "Enter") {
      handleScan();
    } else {
      setScannedBatch(e.target.value);
    }
  };

  const getLeftoverBatches = () => {
    const scannedBatchNumbers = matchedBatches.filter((b) => b.isMatched).map((b) => (b.batch || "").trim().toUpperCase());
    return items.filter((item) => {
      const batchNum = (item.batch || "").trim().toUpperCase();
      return batchNum && !scannedBatchNumbers.includes(batchNum);
    });
  };

  const leftoverBatches = getLeftoverBatches();

  const formatMaterialNumber = (material) => {
    if (!material) return "-";
    return String(material).replace(/^0+/, "");
  };

  const openFullInfoPopup = (batch) => {
    setSelectedFullInfoBatch(batch);
    setShowFullInfoPopup(true);
  };

  const closeFullInfoPopup = () => {
    setSelectedFullInfoBatch(null);
    setShowFullInfoPopup(false);
  };

  const handleFinishOffloading = () => {
    setShowLeftovers(true);
    setFinishOffloadingClicked(true);
  };

  const validate = () => {
    if (!storageLocation.trim()) {
      return "Please enter a Storage Location.";
    }
    if (matchedCount === 0) {
      return "Please scan at least one matching Batch before proceeding.";
    }
    return "";
  };

  const handleCheck = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setValidationPassed(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const matchedItems = matchedBatches.filter((b) => b.isMatched);
      await checkGrStpo({ stpoNumber, items: matchedItems, storageLocation, movementType, deliveryNote });
      setValidationPassed(true);
      setShowSuccessPopup(true);
    } catch (err) {
      setError(err.message || "Posting failed.");
      setValidationPassed(false);
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async () => {
    setError("");
    setBatchWarning("");
    setLoading(true);

    const matchedItems = matchedBatches.filter((b) => b.isMatched);
    let result;
    try {
      result = await postGrStpo({ stpoNumber, items: matchedItems, storageLocation, movementType, deliveryNote });
    } catch (err) {
      setError(`Post failed: ${err.message || "Unknown error."}`);
      setLoading(false);
      return;
    }

    // The GR is posted at this point — anything past here (assigning Bin) must never
    // be reported as "Post failed", since that would wrongly suggest no Material
    // Document was created and risk a duplicate post.
    setShowSuccessPopup(false);
    setPostSuccessData({ materialDocNumber: result.materialDocNumber, message: result.message });
    setShowPostSuccessPopup(true);

    try {
      // Every matched Batch gets Bin defaulted to "floor" — newly received stock
      // lives on the floor until Putaway (../pages/PutawayPage.js) assigns a real
      // Bin. But a Batch coming through GR for STPO may already carry a Bin value
      // (e.g. it was received before) — fetch it first: if it's already "floor",
      // skip the write entirely; otherwise assign "floor" as usual (postBatchCharacteristics
      // → backend/routes/batchClassRoutes.js already falls back from create to a PATCH
      // update on its own when a value already exists, so no other value needs special
      // handling here). Independent batches are independent SAP lock objects, so this
      // runs in parallel — see the matching comment in GoodReceipt2Page.js.
      let completed = 0;
      setProgress(`Assigning Bin… (0 of ${matchedItems.length} batches)`);
      const binResults = await Promise.allSettled(
        matchedItems.map((item) =>
          retryOnce(async () => {
            const currentBin = await fetchBin(item.materialNumber, item.batch);
            if (currentBin.trim().toLowerCase() === "floor") {
              return { skipped: true };
            }
            return postBatchCharacteristics({
              material: item.materialNumber,
              batch: item.batch,
              values: { bin: "floor" },
              characteristics: [BIN_CHARACTERISTIC],
            });
          }).finally(() => {
            completed += 1;
            setProgress(`Assigning Bin… (${completed} of ${matchedItems.length} batches)`);
          })
        )
      );

      const failures = binResults
        .map((settled, i) => ({ settled, batch: matchedItems[i].batch }))
        .filter(({ settled }) => settled.status === "rejected");

      if (failures.length > 0) {
        setBatchWarning(
          failures.map(({ settled, batch }) => `Batch ${batch}: ${settled.reason?.message || "Unknown error."}`).join(" | ")
        );
      } else {
        setPostSuccessData((prev) => ({ ...prev, classificationApplied: true }));
      }
    } catch (err) {
      setBatchWarning(err.message || "Failed to assign Bin after posting.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  if (items.length === 0) {
    return <div>Loading...</div>;
  }

  return (
    <div className="app-container">
      <PageHeader user={user} onLogout={onLogout} />

      <div style={{ maxWidth: "900px", margin: "20px auto", padding: "1rem" }}>
        <div style={{ background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
          <h2 style={{ marginTop: 0 }}>GR for STPO Details</h2>

          {error && <div className="error">{error}</div>}

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div className="form-group" style={{ flex: "1 1 0%" }}>
              <label style={{ display: "block", marginBottom: "6px" }}>Storage Location</label>
              <input
                type="text"
                value={storageLocation}
                onChange={(e) => { setStorageLocation(e.target.value.toUpperCase()); setValidationPassed(false); }}
                className="form-control"
                placeholder="Enter Storage Location"
                disabled={loading}
              />
            </div>

            <div className="form-group" style={{ flex: "1 1 0%" }}>
              <label style={{ display: "block", marginBottom: "6px" }}>Movement Type</label>
              <input
                type="text"
                value={movementType}
                onChange={(e) => setMovementType(e.target.value)}
                className="form-control"
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label style={{ display: "block", marginBottom: "6px" }}>Delivery Note</label>
            <input
              type="text"
              value={deliveryNote}
              onChange={(e) => setDeliveryNote(e.target.value)}
              className="form-control"
              placeholder="Enter Delivery Note"
              disabled={loading}
            />
          </div>

          {/* Scan Input Section */}
          <div style={{ marginTop: "1.5rem", marginBottom: "1.5rem" }}>
            <input
              ref={inputRef}
              type="text"
              value={scannedBatch}
              onChange={handleManualEntry}
              onKeyDown={handleManualEntry}
              placeholder="Scan barcode or enter batch number"
              style={{
                width: "100%",
                padding: "0.85rem",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                fontSize: "1rem",
                marginBottom: "0.75rem",
              }}
              disabled={loading}
              autoFocus
            />
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={handleScan}
                disabled={!scannedBatch.trim() || loading}
                style={{
                  flex: 1,
                  padding: "0.85rem 2rem",
                  background: scannedBatch.trim() ? "#3b82f6" : "#9ca3af",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: scannedBatch.trim() ? "pointer" : "not-allowed",
                }}
              >
                Scan
              </button>
              <button
                onClick={handleFinishOffloading}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "0.85rem 2rem",
                  background: "#10b981",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                Finish
              </button>
            </div>
          </div>

          {/* Progress Counter */}
          <div
            style={{
              marginTop: "0.75rem",
              marginBottom: "0.75rem",
              textAlign: "center",
              fontWeight: "600",
              color: "#374151",
              padding: "0.75rem",
              background: "#f3f4f6",
              borderRadius: "8px",
            }}
          >
            Scanned batches: {matchedCount} / {totalCount}
          </div>

          {/* Leftover Batches */}
          {showLeftovers && leftoverBatches.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ marginBottom: "0.75rem", color: "#000000" }}>Leftover Batches</h3>
              <div style={{ overflowX: "auto" }}>
                {leftoverBatches.map((item, index) => (
                  <div
                    key={index}
                    onClick={() => openFullInfoPopup(item)}
                    style={{
                      marginBottom: "1rem",
                      padding: "1rem",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      backgroundColor: "#fef3c7",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                      <strong style={{ minWidth: "120px" }}>Material:</strong>
                      <span>{formatMaterialNumber(item.materialNumber)}</span>
                    </div>
                    <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                      <strong style={{ minWidth: "120px" }}>Description:</strong>
                      <span>{item.materialDescription || "-"}</span>
                    </div>
                    <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                      <strong style={{ minWidth: "120px" }}>Batch:</strong>
                      <span>{item.batch || "-"}</span>
                    </div>
                    <div style={{ display: "flex" }}>
                      <strong style={{ minWidth: "120px" }}>Quantity:</strong>
                      <span>{item.quantity ? `${item.quantity} ${item.uom || ""}` : "-"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Matched Batches */}
          {matchedCount > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ marginBottom: "0.75rem" }}>Matched Batches</h3>
              <div style={{ overflowX: "auto" }}>
                {matchedBatches.filter((b) => b.isMatched).map((batch, index) => (
                  <div
                    key={index}
                    onClick={() => openFullInfoPopup(batch)}
                    style={{
                      marginBottom: "1rem",
                      padding: "1rem",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      backgroundColor: "#f0fdf4",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                      <strong style={{ minWidth: "120px" }}>Material:</strong>
                      <span>{formatMaterialNumber(batch.materialNumber)}</span>
                    </div>
                    <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                      <strong style={{ minWidth: "120px" }}>Description:</strong>
                      <span>{batch.materialDescription || "-"}</span>
                    </div>
                    <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                      <strong style={{ minWidth: "120px" }}>Batch:</strong>
                      <span>{batch.batch || batch.scannedBatch || "-"}</span>
                    </div>
                    <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                      <strong style={{ minWidth: "120px" }}>Quantity:</strong>
                      <span>{batch.quantity ? `${batch.quantity} ${batch.uom || ""}` : "-"}</span>
                    </div>
                    <div style={{ display: "flex" }}>
                      <strong style={{ minWidth: "120px" }}>Status:</strong>
                      <span style={{ color: "#10b981", fontWeight: 600 }}>✓ Matched</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unmatched Batches */}
          {matchedBatches.filter((b) => !b.isMatched).length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ marginBottom: "0.75rem" }}>Unmatched Batches</h3>
              <div style={{ overflowX: "auto" }}>
                {matchedBatches.filter((b) => !b.isMatched).map((batch, index) => (
                  <div
                    key={index}
                    onClick={() => openFullInfoPopup(batch)}
                    style={{
                      marginBottom: "1rem",
                      padding: "1rem",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      backgroundColor: "#fef2f2",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                      <strong style={{ minWidth: "120px" }}>Material:</strong>
                      <span>{formatMaterialNumber(batch.materialNumber)}</span>
                    </div>
                    <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                      <strong style={{ minWidth: "120px" }}>Description:</strong>
                      <span>{batch.materialDescription || "-"}</span>
                    </div>
                    <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                      <strong style={{ minWidth: "120px" }}>Batch:</strong>
                      <span>{batch.batch || batch.scannedBatch || "-"}</span>
                    </div>
                    <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                      <strong style={{ minWidth: "120px" }}>Quantity:</strong>
                      <span>{batch.quantity ? `${batch.quantity} ${batch.uom || ""}` : "-"}</span>
                    </div>
                    <div style={{ display: "flex" }}>
                      <strong style={{ minWidth: "120px" }}>Status:</strong>
                      <span style={{ color: "#ef4444", fontWeight: 600 }}>✗ Not Matched</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "20px", left: "20px" }}>
        <LoadingButton
          onClick={() => navigate("/grstpo", { state: { prefillStpoNumber: stpoNumber, prefillLineItems: items } })}
          variant="neutral"
          disabled={loading}
        >
          Back
        </LoadingButton>
      </div>

      <div style={{ position: "fixed", bottom: "20px", right: "20px" }}>
        <LoadingButton onClick={handleCheck} loading={loading} disabled={matchedCount === 0 || !finishOffloadingClicked}>
          Check
        </LoadingButton>
      </div>

      {/* Full Information Popup */}
      {showFullInfoPopup && selectedFullInfoBatch && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "white",
              padding: "2rem",
              borderRadius: "12px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              maxWidth: "500px",
              width: "90%",
              maxHeight: "80vh",
              overflowY: "auto",
            }}
          >
            <h3 style={{ margin: "0 0 1rem 0", color: "#333" }}>Full Batch Information</h3>

            <div style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                <strong style={{ minWidth: "140px" }}>Material:</strong>
                <span>{formatMaterialNumber(selectedFullInfoBatch.materialNumber)}</span>
              </div>
              <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                <strong style={{ minWidth: "140px" }}>Description:</strong>
                <span>{selectedFullInfoBatch.materialDescription || "-"}</span>
              </div>
              <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                <strong style={{ minWidth: "140px" }}>Batch:</strong>
                <span>{selectedFullInfoBatch.batch || selectedFullInfoBatch.scannedBatch || "-"}</span>
              </div>
              <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                <strong style={{ minWidth: "140px" }}>Quantity:</strong>
                <span>{selectedFullInfoBatch.quantity ? `${selectedFullInfoBatch.quantity} ${selectedFullInfoBatch.uom || ""}` : "-"}</span>
              </div>
              <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                <strong style={{ minWidth: "140px" }}>Status:</strong>
                <span>
                  {selectedFullInfoBatch.isMatched !== undefined ? (
                    selectedFullInfoBatch.isMatched ? (
                      <span style={{ color: "#10b981", fontWeight: 600 }}>✓ Matched</span>
                    ) : (
                      <span style={{ color: "#ef4444", fontWeight: 600 }}>✗ Not Matched</span>
                    )
                  ) : (
                    <span style={{ color: "#f59e0b", fontWeight: 600 }}>⚠ Left Over</span>
                  )}
                </span>
              </div>
              <div style={{ display: "flex", marginBottom: "0.5rem" }}>
                <strong style={{ minWidth: "140px" }}>Line Item:</strong>
                <span>{selectedFullInfoBatch.lineItem || "-"}</span>
              </div>
              <div style={{ display: "flex" }}>
                <strong style={{ minWidth: "140px" }}>Plant:</strong>
                <span>{selectedFullInfoBatch.plant || "-"}</span>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button
                onClick={closeFullInfoPopup}
                style={{
                  padding: "0.75rem 1.5rem",
                  border: "1px solid #ddd",
                  backgroundColor: "white",
                  color: "#666",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessPopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 50 }}>
          <div style={{ width: "100%", maxWidth: "520px", background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>
            <h3 style={{ marginTop: 0 }}>{error ? "Posting Failed" : "Validation Successful"}</h3>
            {error ? (
              <div className="error" style={{ marginTop: "0.5rem" }}>{error}</div>
            ) : (
              <div style={{ background: "#dcfce7", color: "#166534", padding: "0.75rem", borderRadius: "8px", marginTop: "0.5rem" }}>
                Your data has been validated successfully. You can now post.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: error ? "flex-start" : "space-between", marginTop: "1.25rem" }}>
              <LoadingButton onClick={() => setShowSuccessPopup(false)} variant="neutral" disabled={loading}>
                Back
              </LoadingButton>

              {!error && (
                <LoadingButton onClick={handlePost} loading={loading} disabled={!validationPassed} variant="success">
                  Post
                </LoadingButton>
              )}
            </div>
          </div>
        </div>
      )}

      {showPostSuccessPopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 60 }}>
          <div style={{ width: "100%", maxWidth: "520px", background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>
            <h3 style={{ marginTop: 0 }}>Posted Successfully</h3>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "0.9rem", background: "#f9fafb" }}>
              <div style={{ fontWeight: 600, color: "#111827" }}>Material Document Number</div>
              <div style={{ marginTop: "0.25rem", fontSize: "1.1rem", color: "#111827" }}>
                {postSuccessData?.materialDocNumber || "-"}
              </div>
              {postSuccessData?.message && (
                <div style={{ marginTop: "0.75rem", color: "#374151" }}>{postSuccessData.message}</div>
              )}
            </div>

            {progress && (
              <div style={{ marginTop: "0.75rem", color: "#6b7280", fontSize: "0.85rem" }}>{progress}</div>
            )}
            {batchWarning && (
              <div className="error" style={{ marginTop: "0.75rem" }}>{batchWarning}</div>
            )}
            {!progress && !batchWarning && postSuccessData?.classificationApplied && (
              <div style={{ background: "#dcfce7", color: "#166534", padding: "0.6rem", borderRadius: "8px", marginTop: "0.75rem" }}>
                Bin assigned successfully.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <LoadingButton onClick={() => navigate("/main")} disabled={loading}>Done</LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GrStpo2Page;
