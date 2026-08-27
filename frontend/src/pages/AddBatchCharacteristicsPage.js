import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import { postBatchCharacteristics } from "../api/batchClassApi";
import { BATCH_CHARACTERISTICS, BIN_CHARACTERISTIC, emptyBatchCharacteristicValues } from "../constants/batchClass";

// Add Batch Characteristics — retry screen for batches whose classification failed
// right after a GR post (GoodReceipt2Page.js, GrStpo2Page.js). Reachable only via the
// "Try Again" button on BatchClassificationFailurePopup.js — deliberately not linked
// from MainPage, since it only makes sense with a specific list of failed
// { materialNumber, materialDescription, batch } entries passed via router state.
// Each failed batch gets its own card so the user can re-enter every characteristic
// (incl. Bin, defaulted back to "floor") and resubmit — same postBatchCharacteristics
// call GR itself made, just retried with values the user can now edit.
function AddBatchCharacteristicsPage({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const failedItems = location.state?.failedItems || [];

  const [entries, setEntries] = useState(() =>
    failedItems.map((item) => ({
      materialNumber: item.materialNumber,
      materialDescription: item.materialDescription,
      batch: item.batch,
      values: { ...emptyBatchCharacteristicValues(), bin: "floor" },
      status: "idle", // idle | posting | success | error
      errorMessage: "",
    }))
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (failedItems.length === 0) {
      navigate("/main", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleValueChange = (index, key, value) => {
    setEntries((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, values: { ...entry.values, [key]: value } } : entry))
    );
  };

  const allSucceeded = entries.length > 0 && entries.every((entry) => entry.status === "success");

  const handlePostAll = async () => {
    setLoading(true);
    setEntries((prev) => prev.map((entry) => (entry.status === "success" ? entry : { ...entry, status: "posting", errorMessage: "" })));

    await Promise.allSettled(
      entries.map(async (entry, index) => {
        if (entry.status === "success") return;
        try {
          await postBatchCharacteristics({
            material: entry.materialNumber,
            batch: entry.batch,
            values: entry.values,
            characteristics: [...BATCH_CHARACTERISTICS, BIN_CHARACTERISTIC],
          });
          setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, status: "success", errorMessage: "" } : e)));
        } catch (err) {
          setEntries((prev) =>
            prev.map((e, i) => (i === index ? { ...e, status: "error", errorMessage: err.message || "Unknown error." } : e))
          );
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
            Re-enter and resubmit classification for the batch(es) that failed after posting.
          </div>

          {entries.map((entry, index) => (
            <div
              key={`${entry.materialNumber}-${entry.batch}-${index}`}
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

              <div style={{ display: "flex", flexDirection: "column", marginBottom: "12px" }}>
                <label style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>Batch</label>
                <div
                  className="form-control"
                  style={{ backgroundColor: "#f1f5f9", color: "#64748b" }}
                >
                  {entry.batch}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "10px" }}>
                <div className="form-group">
                  <label style={{ fontSize: "11px", color: "#64748b" }}>{BIN_CHARACTERISTIC.label}</label>
                  <input
                    type="text"
                    className="form-control"
                    value={entry.values.bin}
                    onChange={(e) => handleValueChange(index, "bin", e.target.value)}
                    disabled={loading}
                  />
                </div>
                {BATCH_CHARACTERISTICS.map((charc) => (
                  <div className="form-group" key={charc.id}>
                    <label style={{ fontSize: "11px", color: "#64748b" }}>{charc.label}</label>
                    <input
                      type={charc.type === "date" ? "date" : charc.type === "numeric" ? "number" : "text"}
                      className="form-control"
                      value={entry.values[charc.key]}
                      onChange={(e) => handleValueChange(index, charc.key, e.target.value)}
                      disabled={loading}
                    />
                  </div>
                ))}
              </div>

              <div style={{ marginTop: "10px" }}>
                {entry.status === "posting" && <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>Posting…</div>}
                {entry.status === "success" && (
                  <div style={{ color: "#166534", fontSize: "0.85rem" }}>✓ Batch characteristics added.</div>
                )}
                {entry.status === "error" && (
                  <div className="error" style={{ marginTop: "4px" }}>{entry.errorMessage}</div>
                )}
              </div>
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
