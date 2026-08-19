import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import ConfirmModal from "../components/ConfirmModal";
import { fetchMaterialBatchStock, allocateBatchesForQuantity } from "../api/materialStockApi";
import { fetchBinsByMaterial } from "../api/batchClassApi";
import { postIssuance } from "../api/issuanceApi";

// Sorts by a numeric-looking field ascending, falling back to a plain string compare
// if either side isn't purely numeric (e.g. Bin values with letters).
function sortByField(list, field) {
  return [...list].sort((a, b) => {
    const numA = Number(a[field]);
    const numB = Number(b[field]);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
    return String(a[field]).localeCompare(String(b[field]));
  });
}

// Issuance — Step 3: every item on the Reservation (picked up in full from
// IssuancePage.js — a Reservation with several Materials is issued for all of them
// together, not one at a time) becomes its own Line Item. For each, we fetch every
// batch of that Material at that Storage Location (../api/materialStockApi.js,
// already sorted ascending by Batch number) plus each batch's Bin Location
// characteristic (fetchBinsByMaterial, ../api/batchClassApi.js — CharcInternalID
// 3942), merge Bin onto each batch, then allocate that Line Item's required quantity
// across them oldest-batch-first (allocateBatchesForQuantity) — that picking order is
// never shown to the user. What IS shown is every Line Item's picked batches merged
// into one list and sorted by Bin (displayRows below) exactly like the single-Material
// version did, so the user still works bin-by-bin even when several Materials are
// involved — Material A's Bin 12 sits next to Material B's Bin 12, not grouped apart
// by Material. Clicking a row opens a scan popup: the user scans/enters a Batch, and
// if it matches that row's Batch the row turns green; otherwise it's flagged as the
// wrong batch. Post only enables once every row across every Line Item is matched, and
// submits all of them together as one Goods Issue.
function IssuancePage2({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const items = location.state?.items;

  const [lineItemGroups, setLineItemGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [activeGroupIndex, setActiveGroupIndex] = useState(null);
  const [activeRow, setActiveRow] = useState(null);
  const [scanValue, setScanValue] = useState("");
  const [scanQty, setScanQty] = useState("");
  const [scanError, setScanError] = useState("");
  const [showLessConfirm, setShowLessConfirm] = useState(false);
  const [pendingQty, setPendingQty] = useState(null);

  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [postResult, setPostResult] = useState(null);

  useEffect(() => {
    if (!items?.length) {
      navigate("/issuance", { replace: true });
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all(
      items.map((item) =>
        Promise.all([
          fetchMaterialBatchStock(item.materialNumber, item.storageLocation),
          fetchBinsByMaterial(item.materialNumber),
        ]).then(([batches, binsByBatch]) => {
          const batchesWithBin = batches.map((b) => ({ ...b, bin: binsByBatch[b.batch] || "" }));
          // pickedQty starts as the plan allocateBatchesForQuantity computed from this
          // Line Item's required quantity. It only changes once the user scans this row
          // and enters a quantity via the popup (commitPick) — see handleScanSubmit.
          const rows = allocateBatchesForQuantity(batchesWithBin, item.quantity).map((b) => ({ ...b, matched: false }));
          return { item, rows };
        })
      )
    )
      .then((groups) => {
        if (cancelled) return;
        setLineItemGroups(groups);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to fetch batch stock.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!items?.length) {
    return null;
  }

  const allMatched =
    lineItemGroups.length > 0 && lineItemGroups.every((group) => group.rows.length > 0 && group.rows.every((row) => row.matched));

  const activeGroupItem = activeGroupIndex !== null ? lineItemGroups[activeGroupIndex].item : null;

  const reservationNumbers = [...new Set(items.map((item) => item.reservationNumber))];

  // Flattened across every Line Item and sorted by Bin — same as the single-Material
  // view used to do — so a Reservation with several Materials still gets worked
  // bin-by-bin: Material 1/Batch 1 next to Material 2/Batch 1 if they share a Bin,
  // rather than grouped by Material.
  const displayRows = sortByField(
    lineItemGroups.flatMap((group, groupIndex) => group.rows.map((row) => ({ ...row, groupIndex }))),
    "bin"
  );

  const handlePost = async () => {
    setPostError("");
    setPosting(true);
    try {
      const result = await postIssuance({
        lineItems: lineItemGroups.map(({ item, rows }) => ({ item, batches: rows })),
      });
      setPostResult(result);
    } catch (err) {
      setPostError(err.message || "Issuance posting failed.");
    } finally {
      setPosting(false);
    }
  };

  const handleRowClick = (groupIndex, row) => {
    setActiveGroupIndex(groupIndex);
    setActiveRow(row);
    setScanValue("");
    setScanQty("");
    setScanError("");
  };

  // Commits a verified pick: marks the row green and records the quantity actually
  // entered (which may be less than the row's originally-planned Picked Qty — see
  // the "less than batch qty" confirmation below).
  const commitPick = (qty) => {
    setLineItemGroups((prev) =>
      prev.map((group, gi) =>
        gi !== activeGroupIndex
          ? group
          : { ...group, rows: group.rows.map((b) => (b.batch === activeRow.batch ? { ...b, matched: true, pickedQty: qty } : b)) }
      )
    );
    setActiveGroupIndex(null);
    setActiveRow(null);
    setShowLessConfirm(false);
    setPendingQty(null);
  };

  const handleScanSubmit = () => {
    const batchValue = scanValue.trim().toUpperCase();
    const qtyValue = scanQty.trim();

    if (!batchValue) {
      setScanError("Please scan or enter a Batch.");
      return;
    }
    if (!qtyValue || Number(qtyValue) <= 0) {
      setScanError("Please enter a valid Quantity.");
      return;
    }
    if (batchValue !== activeRow.batch.toUpperCase()) {
      setScanError("Wrong batch. Please scan the correct batch.");
      return;
    }

    const enteredQty = Number(qtyValue);
    if (enteredQty > activeRow.quantity) {
      setScanError("Exceeded existing batch qty.");
      return;
    }

    setScanError("");
    if (enteredQty < activeRow.quantity) {
      setPendingQty(enteredQty);
      setShowLessConfirm(true);
      return;
    }

    commitPick(enteredQty);
  };

  const handleLessConfirmYes = () => commitPick(pendingQty);
  const handleLessConfirmNo = () => {
    setShowLessConfirm(false);
    setPendingQty(null);
  };

  return (
    <div className="app-container">
      <PageHeader user={user} onLogout={onLogout} />

      <div style={{ maxWidth: "700px", margin: "20px auto", padding: "1rem" }}>
        <div style={{ background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
          <h2 style={{ marginTop: 0 }}>Issuance — Batches</h2>

          <div style={{ padding: "0.9rem", background: "#f9fafb", borderRadius: "8px", border: "1px solid #e5e7eb", marginBottom: "1rem" }}>
            <div><strong>Reservation Number{reservationNumbers.length === 1 ? "" : "s"}:</strong> {reservationNumbers.join(", ")}</div>
          </div>

          {error && <div className="error">{error}</div>}
          {postError && <div className="error">{postError}</div>}
          {loading && <div>Loading batches…</div>}

          {!loading && !error && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Bin</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Material</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Batch</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Qty</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Picked</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => (
                    <tr
                      key={`${row.material}-${row.batch}`}
                      onClick={() => handleRowClick(row.groupIndex, row)}
                      style={{
                        cursor: "pointer",
                        background: row.matched ? "#dcfce7" : "white",
                        borderBottom: "12px solid #f3f4f6",
                      }}
                    >
                      <td style={{ padding: "0.5rem" }}>{row.bin}</td>
                      <td style={{ padding: "0.5rem" }}>{row.material}</td>
                      <td style={{ padding: "0.5rem" }}>{row.batch}</td>
                      <td style={{ padding: "0.5rem" }}>{row.quantity}</td>
                      <td style={{ padding: "0.5rem" }}>{row.pickedQty ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "20px", left: "20px" }}>
        <LoadingButton onClick={() => navigate("/issuance")} variant="neutral" disabled={loading || posting}>
          Back
        </LoadingButton>
      </div>

      <div style={{ position: "fixed", bottom: "20px", right: "20px" }}>
        <LoadingButton onClick={handlePost} loading={posting} disabled={!allMatched}>Post</LoadingButton>
      </div>

      {activeRow && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 60 }}
          onClick={() => { setActiveRow(null); setActiveGroupIndex(null); }}
        >
          <div
            style={{ width: "100%", maxWidth: "420px", background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>
              Verify Batch — {activeGroupItem?.materialNumber} — Bin {activeRow.bin}
            </h3>

            {scanError && <div className="error">{scanError}</div>}

            <div className="form-group">
              <label>Scan Batch</label>
              <input
                className="form-control"
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleScanSubmit()}
                placeholder="Scan or enter Batch"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>Qty</label>
              <input
                className="form-control"
                type="number"
                value={scanQty}
                onChange={(e) => setScanQty(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleScanSubmit()}
                placeholder="Enter Quantity"
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.25rem" }}>
              <LoadingButton onClick={() => { setActiveRow(null); setActiveGroupIndex(null); }} variant="neutral">Cancel</LoadingButton>
              <LoadingButton onClick={handleScanSubmit}>Fetch</LoadingButton>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={showLessConfirm}
        title="Confirm Pick Quantity"
        message={`Quantity entered (${pendingQty}) is less than this batch's available quantity (${activeRow?.quantity}). Are you sure you want to pick this?`}
        confirmLabel="Yes"
        cancelLabel="No"
        confirmVariant="success"
        onConfirm={handleLessConfirmYes}
        onCancel={handleLessConfirmNo}
      />

      {postResult && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 60 }}>
          <div style={{ width: "100%", maxWidth: "480px", background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>
            <h3 style={{ marginTop: 0 }}>Issuance Posted Successfully</h3>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "0.9rem", background: "#f9fafb" }}>
              <div style={{ fontWeight: 600, color: "#111827" }}>Material Document Number</div>
              <div style={{ marginTop: "0.25rem", fontSize: "1.1rem", color: "#111827" }}>
                {postResult.materialDocNumber || "-"}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <LoadingButton onClick={() => navigate("/main")}>Done</LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default IssuancePage2;
