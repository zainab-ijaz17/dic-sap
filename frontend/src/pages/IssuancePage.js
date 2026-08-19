import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import ConfirmModal from "../components/ConfirmModal";
import { fetchReservationItems } from "../api/reservationApi";

// Issuance — Step 1: fetch one or more Reservations' items (Material, Description,
// Quantity) via UI_RESERVATION_ITM_MNG_V2 (see ../api/reservationApi.js), adding each
// to a running list — an issuance run isn't limited to a single Reservation. Add
// stashes the fetched Reservation's items (tagged with their own Reservation Number,
// since IssuancePage2.js needs it per line item to post against the right
// Reservation) rather than replacing what's already there. Next carries every item
// from every added Reservation to IssuancePage2.js (step 2), which runs the
// batch-picking flow for each as its own Line Item.
function IssuancePage({ user, onLogout }) {
  const navigate = useNavigate();
  const [reservationNumberInput, setReservationNumberInput] = useState("");
  const [reservations, setReservations] = useState([]);
  const [viewingReservation, setViewingReservation] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const resetScreen = () => {
    setReservationNumberInput("");
    setReservations([]);
    setViewingReservation(null);
  };

  const confirmClearAll = () => {
    resetScreen();
    setShowClearConfirm(false);
  };

  const handleAdd = async () => {
    const trimmed = reservationNumberInput.trim();
    if (!trimmed) {
      setError("Please enter a Reservation Number.");
      return;
    }
    setError("");
    setFetching(true);
    try {
      const result = await fetchReservationItems(trimmed);
      if (reservations.some((r) => r.reservationNumber === result.reservationNumber)) {
        setError(`Reservation ${result.reservationNumber} has already been added.`);
        return;
      }
      setReservations((prev) => [...prev, result]);
      setReservationNumberInput("");
    } catch (err) {
      setError(err.message || "Failed to fetch Reservation.");
    } finally {
      setFetching(false);
    }
  };

  const handleRemove = (reservationNumber) => {
    setReservations((prev) => prev.filter((r) => r.reservationNumber !== reservationNumber));
  };

  const handleNext = () => {
    if (reservations.length === 0) {
      setError("Please add at least one Reservation.");
      return;
    }
    const items = reservations.flatMap((r) => r.items.map((item) => ({ ...item, reservationNumber: r.reservationNumber })));
    navigate("/issuance2", { state: { items } });
  };

  return (
    <div className="app-container">
      <PageHeader user={user} onLogout={onLogout} />

      <div style={{ maxWidth: "600px", margin: "20px auto", padding: "1rem" }}>
        <div style={{ background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
          <h2 style={{ marginTop: 0 }}>Issuance</h2>

          {error && <div className="error">{error}</div>}

          <div className="form-group">
            <label>Reservation Number</label>
            <input
              className="form-control"
              value={reservationNumberInput}
              onChange={(e) => setReservationNumberInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="Enter Reservation Number"
              disabled={fetching}
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", marginTop: "0.75rem" }}>
            <LoadingButton onClick={handleAdd} loading={fetching}>Add</LoadingButton>
            <LoadingButton onClick={() => setShowClearConfirm(true)} variant="danger" disabled={fetching}>
              Clear All
            </LoadingButton>
          </div>

          {reservations.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              {reservations.map((r) => (
                <div
                  key={r.reservationNumber}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.75rem 0.9rem",
                    background: "#f9fafb",
                    borderRadius: "8px",
                    border: "1px solid #e5e7eb",
                    marginBottom: "0.5rem",
                  }}
                >
                  <div onClick={() => setViewingReservation(r)} style={{ cursor: "pointer" }}>
                    <strong>{r.reservationNumber}</strong> — {r.items.length} item{r.items.length === 1 ? "" : "s"}
                  </div>
                  <LoadingButton onClick={() => handleRemove(r.reservationNumber)} variant="danger">
                    Remove
                  </LoadingButton>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "20px", left: "20px" }}>
        <LoadingButton onClick={() => navigate("/main")} variant="neutral" disabled={fetching}>
          Back
        </LoadingButton>
      </div>

      <div style={{ position: "fixed", bottom: "20px", right: "20px" }}>
        <LoadingButton onClick={handleNext} disabled={reservations.length === 0 || fetching}>Next</LoadingButton>
      </div>

      {viewingReservation && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 60 }}
          onClick={() => setViewingReservation(null)}
        >
          <div
            style={{ width: "100%", maxWidth: "620px", background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.25)", maxHeight: "80vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Reservation Items — {viewingReservation.reservationNumber}</h3>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Material</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Description</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingReservation.items.map((item, index) => (
                    <tr key={item.lineItem || index} style={{ borderBottom: "12px solid #f3f4f6" }}>
                      <td style={{ padding: "0.5rem" }}>{item.materialNumber}</td>
                      <td style={{ padding: "0.5rem" }}>{item.materialDescription}</td>
                      <td style={{ padding: "0.5rem" }}>{item.quantity} {item.uom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <LoadingButton onClick={() => setViewingReservation(null)} variant="neutral">Close</LoadingButton>
            </div>
          </div>
        </div>
      )}

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

export default IssuancePage;
