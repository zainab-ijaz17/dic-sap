import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import LoadingButton from "./LoadingButton";

// Shown when postBatchCharacteristics fails for one or more batches right after a GR
// post (GoodReceipt2Page.js, GrStpo2Page.js). `failures` is a flat list of
// { materialNumber, materialDescription, batch } — one entry per batch that failed.
// Grouped here by Material with a Details drill-down listing that Material's failed
// Batches, plus a Try Again button that routes to AddBatchCharacteristicsPage
// (../pages/AddBatchCharacteristicsPage.js) — a page reachable only from here, not
// from MainPage — where the user can re-enter every classification field for the
// failed batches and resubmit.
function BatchClassificationFailurePopup({ failures, onClose }) {
  const navigate = useNavigate();
  const [detailsMaterial, setDetailsMaterial] = useState(null);

  const materials = [];
  const seen = new Set();
  failures.forEach((f) => {
    if (seen.has(f.materialNumber)) return;
    seen.add(f.materialNumber);
    materials.push({ materialNumber: f.materialNumber, materialDescription: f.materialDescription });
  });

  const batchesForMaterial = (materialNumber) =>
    failures.filter((f) => f.materialNumber === materialNumber).map((f) => f.batch);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 70 }}>
      <div style={{ width: "100%", maxWidth: "480px", background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>
        <h3 style={{ marginTop: 0 }}>Batch characteristics not added.</h3>

        <div style={{ marginTop: "0.75rem", maxHeight: "45vh", overflowY: "auto" }}>
          {materials.map((m) => (
            <div
              key={m.materialNumber}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", padding: "0.6rem 0", borderBottom: "1px solid #f1f5f9" }}
            >
              <div>
                <div style={{ fontWeight: 600, color: "#111827" }}>{m.materialNumber}</div>
                {m.materialDescription && <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{m.materialDescription}</div>}
              </div>
              <LoadingButton variant="neutral" onClick={() => setDetailsMaterial(m)}>
                Details
              </LoadingButton>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.25rem" }}>
          <LoadingButton variant="neutral" onClick={onClose}>
            Close
          </LoadingButton>
          <LoadingButton onClick={() => navigate("/add-batch-characteristics", { state: { failedItems: failures } })}>
            Try Again
          </LoadingButton>
        </div>
      </div>

      {detailsMaterial && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 80 }}>
          <div style={{ width: "100%", maxWidth: "420px", background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>
            <h3 style={{ marginTop: 0 }}>{detailsMaterial.materialNumber}</h3>
            {detailsMaterial.materialDescription && (
              <div style={{ color: "#6b7280", marginBottom: "0.75rem" }}>{detailsMaterial.materialDescription}</div>
            )}
            <div style={{ fontWeight: 600, marginBottom: "0.4rem", color: "#111827" }}>Batches</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: "35vh", overflowY: "auto" }}>
              {batchesForMaterial(detailsMaterial.materialNumber).map((batch, i) => (
                <div key={i} style={{ padding: "0.5rem 0.75rem", background: "#f1f5f9", borderRadius: "6px", color: "#374151" }}>
                  {batch}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <LoadingButton variant="neutral" onClick={() => setDetailsMaterial(null)}>
                Close
              </LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BatchClassificationFailurePopup;
