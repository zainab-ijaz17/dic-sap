import React, { useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import MainPage from "./pages/MainPage";
import LabelPrintingPage from "./pages/LabelPrintingPage";
import PutawayPage from "./pages/PutawayPage";
import GoodReceiptPage from "./pages/GoodReceiptPage";
import GoodReceipt2Page from "./pages/GoodReceipt2Page";
import GrStpoPage from "./pages/GrStpoPage";
import GrStpo2Page from "./pages/GrStpo2Page";
import ScanPage from "./pages/ScanPage";
import SplashScreen from "./pages/SplashScreen";
import WarehouseReportPage from "./pages/WarehouseReportPage";
import ReportPage from "./pages/ReportPage";
import IssuancePage from "./pages/IssuancePage";
import IssuancePage2 from "./pages/IssuancePage2";
import StoreReturnPage from "./pages/StoreReturnPage";


function SplashScreenWrapper() {
  const navigate = useNavigate();
  
  const handleFinish = () => {
    navigate("/login");
  };

  return <SplashScreen onFinish={handleFinish} />;
}

function App() {
  const [user, setUser] = useState(null);

  const handleLogout = () => setUser(null);

  const ProtectedRoute = ({ children }) => {
    if (!user) {
      return <Navigate to="/login" replace />;
    }
    return children;
  };

  return (
    <Router>
      <div className="app-background">
        <Routes>
          <Route path="/" element={<SplashScreenWrapper />} />

          <Route
            path="/login"
            element={
              user ? (
                <Navigate to="/main" replace />
              ) : (
                <LoginPage
                  onLogin={(userData) =>
                    setUser({
                      ...userData,
                      loginTime: new Date().toLocaleString(),
                    })
                  }
                />
              )
            }
          />

          <Route
            path="/main"
            element={
              <ProtectedRoute>
                <MainPage user={user} onLogout={handleLogout} />
              </ProtectedRoute>
            }
          />

            <Route
              path="/labelprinting"
              element={
                <ProtectedRoute>
                  <LabelPrintingPage user={user} onLogout={handleLogout} />
                </ProtectedRoute>
              }
            />


          <Route
            path="/goodreceipt"
            element={
              <ProtectedRoute>
                <GoodReceiptPage user={user} onLogout={handleLogout} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/goodreceipt2"
            element={
              <ProtectedRoute>
                <GoodReceipt2Page user={user} onLogout={handleLogout} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/grstpo"
            element={
              <ProtectedRoute>
                <GrStpoPage user={user} onLogout={handleLogout} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/grstpo2"
            element={
              <ProtectedRoute>
                <GrStpo2Page user={user} onLogout={handleLogout} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/scan"
            element={
              <ProtectedRoute>
                <ScanPage user={user} onLogout={handleLogout} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/putaway"
            element={
              <ProtectedRoute>
                <PutawayPage user={user} onLogout={handleLogout} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/warehousereport"
            element={
              <ProtectedRoute>
                <WarehouseReportPage user={user} onLogout={handleLogout} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/report"
            element={
              <ProtectedRoute>
                <ReportPage user={user} onLogout={handleLogout} />
              </ProtectedRoute>
            }
          />

            <Route
              path="/issuance"
              element={
                <ProtectedRoute>
                  <IssuancePage user={user} onLogout={handleLogout} />
                </ProtectedRoute>
              }
            />

            <Route
              path="/issuance2"
              element={
                <ProtectedRoute>
                  <IssuancePage2 user={user} onLogout={handleLogout} />
                </ProtectedRoute>
              }
            />

            <Route
              path="/storereturn"
              element={
                <ProtectedRoute>
                  <StoreReturnPage user={user} onLogout={handleLogout} />
                </ProtectedRoute>
              }
            />

        </Routes>
      </div>
    </Router>
  );
}

export default App;