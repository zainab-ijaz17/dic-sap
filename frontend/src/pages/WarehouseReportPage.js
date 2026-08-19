import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUserCredentials } from "../api";
import {
  fetchInventoryReport,
  isInventoryReportMockEnabled,
} from "../api/inventoryReportApi";
import { INVENTORY_REPORT_PLANT } from "../constants/inventoryReport";

function InventoryReportPage({ user, onLogout }) {
  const navigate = useNavigate();

  const [materialNumber, setMaterialNumber] = useState("");
  const [sloc, setSloc] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleFetchReport = async (e) => {
    e?.preventDefault();

    setError("");

    const matnr = materialNumber.trim();
    const storageLoc = sloc.trim();

    if (!matnr) {
      setError("Material Number is required.");
      return;
    }

    if (!storageLoc) {
      setError("Storage Location is required.");
      return;
    }

    setLoading(true);

    try {
      const creds = getUserCredentials();

      if (!creds) {
        throw new Error("User not authenticated. Please log in again.");
      }

      // Force correct backend environment selection
      // 110 -> dev
      // 300 -> prd
      const credsWithEnv = {
        ...creds,

        environment:
          user?.client === "300"
            ? "prd"
            : "dev",
      };

      const data = await fetchInventoryReport(
        matnr,
        storageLoc,
        credsWithEnv
      );

      navigate("/report", {
        state: {
          reportData: data,
        },
      });

    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error?.message?.value ||
        err.response?.data?.error ||
        err.message ||
        "Failed to fetch inventory report.";

      setError(message);

      if (err.response?.status === 401) {
        navigate("/login");
      }

    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    navigate("/main");
  };

  return (
    <div className="app-container inventory-report-page">
      <header className="app-header">
        <div className="user-info">
          <div className="user-details">
            <span className="username">
              {user?.username || "User"}
            </span>

            <span className="server-info">
              Server {user?.server || "DEV"} • Client{" "}
              {user?.client || "110"}
            </span>
          </div>

          <button
            type="button"
            className="logout-btn"
            onClick={() => setShowLogoutConfirm(true)}
          >
            Logout
          </button>
        </div>
      </header>

      {showLogoutConfirm && (
        <div className="inventory-report-overlay">
          <div className="inventory-report-dialog">
            <h3>Confirm Logout</h3>

            <p>Are you sure you want to logout?</p>

            <div className="inventory-report-dialog-actions">
              <button
                type="button"
                className="inventory-report-btn-secondary"
                onClick={() => setShowLogoutConfirm(false)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="inventory-report-btn-danger"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  onLogout();
                }}
              >
                Yes, Logout
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="inventory-report-main">
        <section className="inventory-report-card">
          <h2 className="inventory-report-title">
            MMBE Inventory Report
          </h2>

          <p className="inventory-report-subtitle">
            Enter material number and storage location.
          </p>

          {isInventoryReportMockEnabled && (
            <p
              className="inventory-report-mock-badge"
              role="status"
            >
              Demo mode — mock API will be used
            </p>
          )}

          <form
            onSubmit={handleFetchReport}
            className="inventory-report-form"
          >
            <div className="form-group">
              <label htmlFor="materialNumber">
                Material Number
              </label>

              <input
                id="materialNumber"
                type="text"
                value={materialNumber}
                onChange={(e) =>
                  setMaterialNumber(
                    e.target.value.toUpperCase()
                  )
                }
                placeholder="e.g. 1000000062"
                disabled={loading}
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label htmlFor="storageLocation">
                Storage Location
              </label>

              <input
                id="storageLocation"
                type="text"
                value={sloc}
                onChange={(e) =>
                  setSloc(
                    e.target.value.toUpperCase()
                  )
                }
                placeholder="e.g. CP04"
                disabled={loading}
                autoComplete="off"
              />
            </div>

            <input
              type="hidden"
              name="plant"
              value={INVENTORY_REPORT_PLANT}
            />

            <button
              type="submit"
              className="inventory-report-fetch-btn"
              disabled={loading}
            >
              {loading ? (
                <span className="inventory-report-btn-content">
                  <span
                    className="loading-spinner"
                    aria-hidden="true"
                  />

                  Fetching…
                </span>
              ) : (
                "Fetch Report"
              )}
            </button>
          </form>

          {error && !loading && (
            <div
              className="inventory-report-error"
              role="alert"
            >
              {error}
            </div>
          )}

          {loading && (
            <div
              className="inventory-report-loading"
              aria-live="polite"
            >
              <span className="loading-spinner loading-spinner-lg" />

              <p>Loading inventory report…</p>
            </div>
          )}
        </section>
      </main>

      <div className="inventory-report-footer">
        <button
          type="button"
          className="inventory-report-back-btn"
          onClick={handleBack}
          disabled={loading}
        >
          Back
        </button>
      </div>
    </div>
  );
}

export default InventoryReportPage;