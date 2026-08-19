import React, { useState } from "react";
import ConfirmModal from "./ConfirmModal";

// Shared top bar (user info + logout) reused by every page instead of duplicating
// the header markup and logout-confirm dialog in each page component.
function PageHeader({ user, onLogout }) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  return (
    <>
      <header className="app-header">
        <div className="user-info">
          <div className="user-details">
            <span className="username">{user?.username || "s.ashraf"}</span>
            <span className="server-info">
              Server {user?.server || "DEV"} • Client {user?.client || "110"}
            </span>
          </div>
          <button className="logout-btn" onClick={() => setShowLogoutConfirm(true)}>
            Logout
          </button>
        </div>
      </header>

      <ConfirmModal
        open={showLogoutConfirm}
        title="Confirm Logout"
        message="Are you sure you want to logout?"
        confirmLabel="Yes, Logout"
        cancelLabel="Cancel"
        onConfirm={() => {
          setShowLogoutConfirm(false);
          onLogout();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </>
  );
}

export default PageHeader;
