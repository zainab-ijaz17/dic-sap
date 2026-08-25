import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import { checkGoodsReceipt, postGoodsReceipt, fetchMaterialDocumentItems, matchBatchesToItems } from "../api/goodsReceiptApi";
import { postBatchCharacteristics } from "../api/batchClassApi";
import { DEFAULT_MOVEMENT_TYPE_GR } from "../constants/warehouse";
import { BATCH_CHARACTERISTICS, emptyBatchCharacteristicValues } from "../constants/batchClass";
import {
  computeStandardizedPalletQuantities,
  resizeCustomQuantities,
  summarizeCustomQuantities,
  roundQty,
  toPalletObjects,
} from "../utils/palletUtils";

// Fetching the Batch right after posting and assigning its characteristics
// (fetchMaterialDocumentItems / postBatchCharacteristics below) both hit SAP again
// immediately on the heels of a live post, so a transient failure there (network
// blip, momentary lock contention) shouldn't immediately surface as a failure — retry
// once before giving up.
async function retryOnce(fn) {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

// Goods Receipt — Page 2: every line item forwarded from Page 1 gets its own
// editable card (Description/UOM read-only, Quantity editable). Storage Location
// and Certificate Enclosed (Yes/No, sent as the Material Document header text) are
// shared across all items, then Check/Post posts them together. Movement Type is no
// longer user-editable — it's always DEFAULT_MOVEMENT_TYPE_GR.
// checkGoodsReceipt() stays a client-side mock (A_MaterialDocumentHeader has no
// TestRun/simulate field to validate against). postGoodsReceipt() is real — it posts
// to API_MATERIAL_DOCUMENT_SRV via backend/routes/goodsReceiptRoutes.js.
//
// Pallet split (formerly decided on a separate Pallet Making screen, after posting)
// now happens here, before posting: each item picks Standardized (fixed pallet size,
// rounded up, last pallet partial) or Custom (user enters every pallet's quantity,
// which must sum exactly to the item's quantity). The resolved pallets become
// separate to_MaterialDocumentItem lines in the posting payload — see
// buildMaterialDocumentPayload() in ../api/goodsReceiptApi.js.
//
// Batch classification characteristics (Expiration Date, Shelf Life, etc. — see
// ../constants/batchClass.js) are entered here too, before posting, but can't be sent
// until a Batch exists — Batch is SAP-assigned only once the GR is posted. So Post
// does three things in sequence: post the GR, fetch the Batch(es) SAP just assigned
// (fetchMaterialDocumentItems + matchBatchesToItems, ../api/goodsReceiptApi.js), then
// fire the batch-class API calls (../api/batchClassApi.js) for whatever the user filled in.
function GoodReceipt2Page({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const poNumber = location.state?.poNumber;

  const [items, setItems] = useState(() =>
    (location.state?.lineItems || []).map((li) => ({
      ...li,
      standardizedPallets: true,
      numberOfPallets: "",
      customQuantities: [],
      batch: "",
      batches: [],
      batchCharacteristics: emptyBatchCharacteristicValues(),
    }))
  );
  const [storageLocation, setStorageLocation] = useState(location.state?.storageLocation || "");
  const movementType = DEFAULT_MOVEMENT_TYPE_GR;
  const [certificateEnclosed, setCertificateEnclosed] = useState(location.state?.certificateEnclosed || "No");
  const [deliveryNote, setDeliveryNote] = useState(location.state?.deliveryNote || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validationPassed, setValidationPassed] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [showPostSuccessPopup, setShowPostSuccessPopup] = useState(false);
  const [postSuccessData, setPostSuccessData] = useState(null);
  const [progress, setProgress] = useState("");
  const [batchWarning, setBatchWarning] = useState("");

  useEffect(() => {
    if (!location.state?.lineItems?.length) {
      navigate("/goodreceipt", { replace: true });
    }
  }, [location.state, navigate]);

  const handleQuantityChange = (index, value) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, quantity: value } : item)));
    setValidationPassed(false);
  };

  const handleStandardizedChange = (index, standardized) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, standardizedPallets: standardized } : item)));
    setValidationPassed(false);
  };

  // Number of Pallets doubles as a batch classification characteristic (CharcInternalID
  // 3937 — see BATCH_CHARACTERISTICS in ../constants/batchClass.js), so it's mirrored
  // into batchCharacteristics.numberOfPallets here instead of making the user type the
  // same value twice. batchCharacteristics.numberOfPallets is rendered read-only below
  // to keep the two from drifting apart.
  const handlePalletCountChange = (index, value) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              numberOfPallets: value,
              customQuantities: resizeCustomQuantities(value, item.customQuantities),
              batchCharacteristics: { ...item.batchCharacteristics, numberOfPallets: value },
            }
          : item
      )
    );
    setValidationPassed(false);
  };

  const handleCustomQuantityChange = (index, palletIndex, value) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, customQuantities: item.customQuantities.map((q, pi) => (pi === palletIndex ? value : q)) }
          : item
      )
    );
    setValidationPassed(false);
  };

  const handleCharcChange = (index, key, value) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, batchCharacteristics: { ...item.batchCharacteristics, [key]: value } } : item
      )
    );
    setValidationPassed(false);
  };

  // Resolves each item's pallet breakdown from its current config (standardized vs
  // custom) — recomputed on every render so it can never go stale against edits to
  // Quantity, Number of Pallets, or the per-pallet custom quantities.
  const derivedPallets = items.map((item) => {
    const qty = Number(item.quantity) || 0;
    if (item.standardizedPallets) {
      const { perPallet, quantities, valid } = computeStandardizedPalletQuantities(qty, item.numberOfPallets);
      return { perPallet, quantities, valid };
    }
    const { quantities, sum, valid } = summarizeCustomQuantities(item.customQuantities, qty);
    return { perPallet: null, quantities, sum, valid };
  });

  const validate = () => {
    if (items.some((item) => !String(item.quantity).trim() || Number(item.quantity) <= 0)) {
      return "Please enter a valid Quantity for every line item.";
    }
    if (!storageLocation.trim()) {
      return "Please enter a Storage Location.";
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const derived = derivedPallets[i];
      const count = Math.floor(Number(item.numberOfPallets)) || 0;
      const qty = roundQty(Number(item.quantity) || 0);

      if (count <= 0) {
        return `Please enter a valid Number of Pallets for line item ${item.lineItem}.`;
      }

      if (item.standardizedPallets) {
        if (!derived.valid) {
          return `Number of Pallets is too high for line item ${item.lineItem}'s quantity (${qty} ${item.uom}). Please reduce the count.`;
        }
      } else if (!derived.valid) {
        if (derived.sum !== qty) {
          const diff = roundQty(Math.abs(derived.sum - qty));
          const diffLabel = derived.sum > qty ? "Excess" : "Remaining";
          return `Line item ${item.lineItem}: GR Quantity ${qty} ${item.uom}, Assigned Pallet Quantity ${derived.sum} ${item.uom}, ${diffLabel} ${diff} ${item.uom}. Pallet quantities must sum exactly to the GR quantity.`;
        }
        return `Please enter a quantity for every pallet of line item ${item.lineItem}.`;
      }

      const filledCharcs = BATCH_CHARACTERISTICS.filter(
        (charc) => String(item.batchCharacteristics?.[charc.key] ?? "").trim() !== ""
      );
      for (const charc of filledCharcs) {
        if (charc.type === "numeric" && !Number.isFinite(Number(item.batchCharacteristics[charc.key]))) {
          return `Please enter a valid number for ${charc.label} on line item ${item.lineItem}.`;
        }
      }
    }

    return "";
  };

  const buildItemsWithPallets = () =>
    items.map((item, i) => ({ ...item, pallets: toPalletObjects(derivedPallets[i].quantities) }));

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
      const itemsWithPallets = buildItemsWithPallets();
      await checkGoodsReceipt({ poNumber, items: itemsWithPallets, storageLocation, movementType, certificateEnclosed, deliveryNote });
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

    let result;
    try {
      const itemsWithPallets = buildItemsWithPallets();
      result = await postGoodsReceipt({ poNumber, items: itemsWithPallets, storageLocation, movementType, certificateEnclosed, deliveryNote });
    } catch (err) {
      setError(`Post failed: ${err.message || "Unknown error."}`);
      setLoading(false);
      return;
    }

    // The GR is posted at this point — anything past here (fetching Batch, assigning
    // characteristics) must never be reported as "Post failed", since that would wrongly
    // suggest no Material Document was created and risk a duplicate post.
    setShowSuccessPopup(false);
    setPostSuccessData({ materialDocNumber: result.materialDocNumber, message: result.message });
    setShowPostSuccessPopup(true);

    const anyCharcFilled = items.some((item) =>
      BATCH_CHARACTERISTICS.some((charc) => String(item.batchCharacteristics?.[charc.key] ?? "").trim() !== "")
    );
    if (!anyCharcFilled) {
      setLoading(false);
      return;
    }

    try {
      setProgress("Fetching Batch from the posted Material Document…");
      const docItems = await retryOnce(() => fetchMaterialDocumentItems(result.materialDocNumber, result.materialDocYear));
      const itemsWithBatches = matchBatchesToItems(items, docItems);
      setItems(itemsWithBatches);

      const classificationTasks = [];
      itemsWithBatches.forEach((item) => {
        const hasCharcValue = BATCH_CHARACTERISTICS.some(
          (charc) => String(item.batchCharacteristics?.[charc.key] ?? "").trim() !== ""
        );
        if (!hasCharcValue) return;
        const batches = item.batches?.length > 0 ? item.batches : item.batch ? [item.batch] : [];
        batches.forEach((batch) => classificationTasks.push({ item, batch }));
      });

      if (classificationTasks.length === 0) {
        setBatchWarning("No Batch was found on the posted Material Document, so batch characteristics were not assigned.");
        return;
      }

      // Different batches are independent SAP lock objects (the enqueue lock that
      // forces sequential writes within one batch — see backend/routes/batchClassRoutes.js
      // — is scoped to that specific Material+Batch), so batches can be classified in
      // parallel even though each batch's own characteristics can't be.
      let completed = 0;
      setProgress(`Assigning batch characteristics… (0 of ${classificationTasks.length} batches)`);
      const classificationResults = await Promise.allSettled(
        classificationTasks.map(({ item, batch }) =>
          retryOnce(() => postBatchCharacteristics({ material: item.materialNumber, batch, values: item.batchCharacteristics })).finally(() => {
            completed += 1;
            setProgress(`Assigning batch characteristics… (${completed} of ${classificationTasks.length} batches)`);
          })
        )
      );

      const failures = classificationResults
        .map((settled, i) => ({ settled, batch: classificationTasks[i].batch }))
        .filter(({ settled }) => settled.status === "rejected");

      if (failures.length > 0) {
        setBatchWarning(
          failures.map(({ settled, batch }) => `Batch ${batch}: ${settled.reason?.message || "Unknown error."}`).join(" | ")
        );
      } else {
        setPostSuccessData((prev) => ({ ...prev, classificationApplied: true }));
      }
    } catch (err) {
      setBatchWarning(err.message || "Failed to assign batch characteristics after posting.");
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

      <div style={{ maxWidth: "600px", margin: "20px auto", padding: "1rem" }}>
        <div style={{ background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
          <h2 style={{ marginTop: 0 }}>Goods Receipt Details</h2>

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
              <label style={{ display: "block", marginBottom: "6px" }}>Certificate Enclosed</label>
              <select
                value={certificateEnclosed}
                onChange={(e) => { setCertificateEnclosed(e.target.value); setValidationPassed(false); }}
                className="form-control"
                disabled={loading}
              >
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
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

          {items.map((item, index) => {
            const derived = derivedPallets[index];
            const qty = roundQty(Number(item.quantity) || 0);
            const diff = roundQty(qty - (derived.sum ?? 0));

            return (
              <div
                key={item.lineItem || index}
                style={{
                  background: "#fcfcfd",
                  border: "1px solid #eef2f6",
                  borderRadius: "8px",
                  padding: "16px",
                  marginBottom: "16px",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
                }}
              >
                <h4 style={{ margin: "0 0 16px 0", color: "#111827", fontSize: "14px", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px" }}>
                  Line Item #{item.lineItem || index + 1}
                </h4>

                <div style={{ display: "flex", flexDirection: "column", marginBottom: "14px" }}>
                  <label style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>Description</label>
                  <div
                    className="form-control"
                    style={{
                      backgroundColor: "#f1f5f9",
                      color: "#64748b",
                      whiteSpace: "normal",
                      wordBreak: "break-word",
                      minHeight: "2.5rem",
                      lineHeight: 1.4,
                    }}
                  >
                    {item.materialDescription}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px", alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <label style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px", fontWeight: 600 }}>Quantity</label>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => handleQuantityChange(index, e.target.value)}
                      className="form-control"
                      disabled={loading}
                      style={{ borderColor: "#bae6fd" }}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <label style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>UOM</label>
                    <input
                      type="text"
                      value={item.uom}
                      readOnly
                      className="form-control"
                      style={{ backgroundColor: "#f1f5f9", cursor: "not-allowed", color: "#64748b" }}
                    />
                  </div>
                </div>

                <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #f1f5f9" }}>
                  <label style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px", fontWeight: 600, display: "block" }}>
                    Standardized Pallets?
                  </label>
                  <div style={{ display: "flex", gap: "1.25rem", marginBottom: "0.75rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name={`standardized-${index}`}
                        checked={item.standardizedPallets}
                        onChange={() => handleStandardizedChange(index, true)}
                        disabled={loading}
                      />
                      Yes
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name={`standardized-${index}`}
                        checked={!item.standardizedPallets}
                        onChange={() => handleStandardizedChange(index, false)}
                        disabled={loading}
                      />
                      No
                    </label>
                  </div>

                  <div className="form-group" style={{ maxWidth: "220px" }}>
                    <label style={{ fontSize: "12px", color: "#64748b" }}>Number of Pallets</label>
                    <input
                      type="number"
                      className="form-control"
                      value={item.numberOfPallets}
                      onChange={(e) => handlePalletCountChange(index, e.target.value)}
                      placeholder="Enter Number of Pallets"
                      disabled={loading}
                    />
                  </div>

                  {item.standardizedPallets ? (
                    item.numberOfPallets && (
                      <div style={{ marginTop: "10px" }}>
                        <div style={{ fontSize: "0.78rem", color: "#6b7280", marginBottom: "6px" }}>
                          Quantity per Pallet: {derived.perPallet || "-"} {item.uom}
                        </div>
                        {derived.quantities.length > 0 && (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: "8px" }}>
                            {derived.quantities.map((q, pi) => (
                              <div
                                key={pi}
                                style={{ padding: "6px 8px", background: "#f1f5f9", borderRadius: "6px", fontSize: "0.78rem", textAlign: "center", color: "#374151" }}
                              >
                                Pallet {pi + 1}: {q} {item.uom}
                              </div>
                            ))}
                          </div>
                        )}
                        {!derived.valid && (
                          <div className="error" style={{ marginTop: "8px" }}>
                            Number of Pallets is too high for this quantity ({qty} {item.uom}). Please reduce the count.
                          </div>
                        )}
                      </div>
                    )
                  ) : (
                    item.customQuantities.length > 0 && (
                      <div style={{ marginTop: "10px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "10px" }}>
                          {item.customQuantities.map((q, pi) => (
                            <div className="form-group" key={pi}>
                              <label style={{ fontSize: "11px", color: "#64748b" }}>Pallet {pi + 1} Quantity</label>
                              <input
                                type="number"
                                className="form-control"
                                value={q}
                                onChange={(e) => handleCustomQuantityChange(index, pi, e.target.value)}
                                disabled={loading}
                              />
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: "0.78rem", marginTop: "8px", color: derived.valid ? "#16a34a" : "#dc2626" }}>
                          GR Quantity: {qty} {item.uom} &nbsp;|&nbsp; Assigned Pallet Quantity: {derived.sum} {item.uom} &nbsp;|&nbsp;{" "}
                          {diff === 0 ? "Matched" : diff > 0 ? `Remaining: ${diff} ${item.uom}` : `Excess: ${Math.abs(diff)} ${item.uom}`}
                        </div>
                      </div>
                    )
                  )}
                </div>

                <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #f1f5f9" }}>
                  <label style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px", fontWeight: 600, display: "block" }}>
                    Batch Classification (Optional)
                  </label>

                  <div className="form-group" style={{ maxWidth: "320px" }}>
                    <label style={{ fontSize: "12px", color: "#64748b" }}>Batch</label>
                    <input
                      type="text"
                      className="form-control"
                      value={item.batches?.length > 0 ? item.batches.join(", ") : ""}
                      readOnly
                      placeholder="Assigned automatically by SAP after Post"
                      style={{ backgroundColor: "#f1f5f9", cursor: "not-allowed", color: "#64748b" }}
                    />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "10px", marginTop: "10px" }}>
                    {BATCH_CHARACTERISTICS.map((charc) => {
                      const isNumberOfPallets = charc.key === "numberOfPallets";
                      return (
                        <div className="form-group" key={charc.id}>
                          <label style={{ fontSize: "11px", color: "#64748b" }}>{charc.label}</label>
                          <input
                            type={charc.type === "date" ? "date" : charc.type === "numeric" ? "number" : "text"}
                            className="form-control"
                            value={item.batchCharacteristics[charc.key]}
                            onChange={(e) => handleCharcChange(index, charc.key, e.target.value)}
                            disabled={loading}
                            readOnly={isNumberOfPallets}
                            placeholder={isNumberOfPallets ? "Set via Number of Pallets above" : undefined}
                            style={isNumberOfPallets ? { backgroundColor: "#f1f5f9", cursor: "not-allowed", color: "#64748b" } : undefined}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "20px", left: "20px" }}>
        <LoadingButton
          onClick={() => navigate("/goodreceipt", { state: { prefillPoNumber: poNumber, prefillLineItems: items } })}
          variant="neutral"
          disabled={loading}
        >
          Back
        </LoadingButton>
      </div>

      <div style={{ position: "fixed", bottom: "20px", right: "20px" }}>
        <LoadingButton onClick={handleCheck} loading={loading}>Check</LoadingButton>
      </div>

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
                Batch characteristics assigned successfully.
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

export default GoodReceipt2Page;
