import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import { postBatchCharacteristics } from "../api/batchClassApi";
import { BATCH_CHARACTERISTICS, emptyBatchCharacteristicValues } from "../constants/batchClass";

// Add Batch Characteristics — retry screen for batches whose classification failed
// right after a GR post (GoodReceipt2Page.js, GrStpo2Page.js). Reachable only via the
// "Try Again" button on BatchClassificationFailurePopup.js — deliberately not linked
// from MainPage, since it only makes sense with a specific list of failed
// { materialNumber, materialDescription, batch } entries passed via router state.
// One card per Material rather than per Batch — packaging size, lot number, etc. are
// the same for every Batch of a Material received together, so the user enters them
// once and Post fires one postBatchCharacteristics call per Batch of that Material
// using those same values, tracking each Batch's own success/error underneath.
function AddBatchCharacteristicsPage({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const failedItems = location.state?.failedItems || [];

  const [entries, setEntries] = useState(() => {
    const entriesByMaterial = [];
    const indexByMaterial = new Map();
    failedItems.forEach((item) => {
      if (!indexByMaterial.has(item.materialNumber)) {
        indexByMaterial.set(item.materialNumber, entriesByMaterial.length);
        entriesByMaterial.push({
          materialNumber: item.materialNumber,
          materialDescription: item.materialDescription,
          values: emptyBatchCharacteristicValues(),
          batches: [],
        });
      }
      entriesByMaterial[indexByMaterial.get(item.materialNumber)].batches.push({
        batch: item.batch,
        status: "idle", // idle | posting | success | error
        errorMessage: "",
      });
    });
    return entriesByMaterial;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (failedItems.length === 0) {
      navigate("/main", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleValueChange = (materialIndex, key, value) => {
    setEntries((prev) =>
      prev.map((entry, i) => (i === materialIndex ? { ...entry, values: { ...entry.values, [key]: value } } : entry))
    );
  };

  const setBatchStatus = (materialIndex, batchIndex, status, errorMessage = "") => {
    setEntries((prev) =>
      prev.map((entry, i) =>
        i === materialIndex
          ? { ...entry, batches: entry.batches.map((b, bi) => (bi === batchIndex ? { ...b, status, errorMessage } : b)) }
          : entry
      )
    );
  };

  const allSucceeded =
    entries.length > 0 && entries.every((entry) => entry.batches.every((b) => b.status === "success"));

  const handlePostAll = async () => {
    setLoading(true);
    setEntries((prev) =>
      prev.map((entry) => ({
        ...entry,
        batches: entry.batches.map((b) => (b.status === "success" ? b : { ...b, status: "posting", errorMessage: "" })),
      }))
    );

    const tasks = [];
    entries.forEach((entry, materialIndex) => {
      entry.batches.forEach((b, batchIndex) => {
        if (b.status === "success") return;
        tasks.push({ materialIndex, batchIndex, materialNumber: entry.materialNumber, batch: b.batch, values: entry.values });
      });
    });

    await Promise.allSettled(
      tasks.map(async ({ materialIndex, batchIndex, materialNumber, batch, values }) => {
        try {
          await postBatchCharacteristics({
            material: materialNumber,
            batch,
            values,
            characteristics: BATCH_CHARACTERISTICS,
          });
          setBatchStatus(materialIndex, batchIndex, "success");
        } catch (err) {
          setBatchStatus(materialIndex, batchIndex, "error", err.message || "Unknown error.");
        }
      })
    );

    setLoading(false);
  };

  if (entries.length === 0) {
    return <div>Loading...</div>;
  }

  return (
    <div className="app-container">
      <PageHeader user={user} onLogout={onLogout} />

      <div style={{ maxWidth: "600px", margin: "20px auto", padding: "1rem" }}>
        <div style={{ background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
          <h2 style={{ marginTop: 0 }}>Add Batch Characteristics</h2>
          <div style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "1rem" }}>
            Re-enter and resubmit classification for the batch(es) that failed after posting. One set of values per
            Material is applied to every Batch of that Material listed below it.
          </div>

          {entries.map((entry, materialIndex) => (
            <div
              key={`${entry.materialNumber}-${materialIndex}`}
              style={{
                background: "#fcfcfd",
                border: "1px solid #eef2f6",
                borderRadius: "8px",
                padding: "16px",
                marginBottom: "16px",
                boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
              }}
            >
              <h4 style={{ margin: "0 0 12px 0", color: "#111827", fontSize: "14px", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px" }}>
                {entry.materialNumber}
                {entry.materialDescription ? ` — ${entry.materialDescription}` : ""}
              </h4>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
                {entry.batches.map((b) => (
                  <span
                    key={b.batch}
                    title={b.status === "error" ? b.errorMessage : undefined}
                    style={{
                      fontSize: "11px",
                      padding: "3px 8px",
                      borderRadius: "999px",
                      background: b.status === "success" ? "#dcfce7" : b.status === "error" ? "#fee2e2" : "#f1f5f9",
                      color: b.status === "success" ? "#166534" : b.status === "error" ? "#991b1b" : "#64748b",
                    }}
                  >
                    {b.batch}
                    {b.status === "success" ? " ✓" : b.status === "error" ? " ✗" : b.status === "posting" ? " …" : ""}
                  </span>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "10px" }}>
                {BATCH_CHARACTERISTICS.map((charc) => (
                  <div className="form-group" key={charc.id}>
                    <label style={{ fontSize: "11px", color: "#64748b" }}>{charc.label}</label>
                    <input
                      type={charc.type === "date" ? "date" : charc.type === "numeric" ? "number" : "text"}
                      className="form-control"
                      value={entry.values[charc.key]}
                      onChange={(e) => handleValueChange(materialIndex, charc.key, e.target.value)}
                      disabled={loading}
                    />
                  </div>
                ))}
              </div>

              {entry.batches.some((b) => b.status === "error") && (
                <div style={{ marginTop: "10px" }}>
                  {entry.batches
                    .filter((b) => b.status === "error")
                    .map((b) => (
                      <div key={b.batch} className="error" style={{ marginTop: "4px" }}>
                        Batch {b.batch}: {b.errorMessage}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "20px", left: "20px" }}>
        <LoadingButton onClick={() => navigate("/main")} variant="neutral" disabled={loading}>
          Back
        </LoadingButton>
      </div>

      <div style={{ position: "fixed", bottom: "20px", right: "20px" }}>
        {allSucceeded ? (
          <LoadingButton onClick={() => navigate("/main")} variant="success">
            Done
          </LoadingButton>
        ) : (
          <LoadingButton onClick={handlePostAll} loading={loading}>
            Post
          </LoadingButton>
        )}
      </div>
    </div>
  );
}

export default AddBatchCharacteristicsPage;
