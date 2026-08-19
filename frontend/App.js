// App.js
import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import SplashScreen from './src/pages/SplashScreen';
import MainPage from './src/pages/MainPage';
import LoginPage from './src/pages/LoginPage';
import HandlingUnitPage from './src/pages/HandlingUnitPage';
import BinToBinPage from './src/pages/BinToBinPage';
import GoodReceiptPage from './src/pages/GoodReceiptPage';
import LabelPrintingPage from './src/pages/LabelPrintingPage';
import PutawayPage from './src/pages/PutawayPage';
import WarehouseReportPage from './src/pages/WarehouseReportPage';
import StoreReturnPage from './src/pages/StoreReturnPage';
import IssuancePage from './src/pages/IssuancePage';




import './src/index.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleLogin = (userData) => {
    setUser(userData);
    setLoading(false);
  };

  const handleLogout = () => {
    setUser(null);
  };

  if (loading) {
    return <SplashScreen onFinish={() => setLoading(false)} />;
  }

  return (
    <Router>
      <Routes>
        <Route 
          path="/login" 
          element={user ? <Navigate to="/main" /> : <LoginPage onLogin={handleLogin} />} 
        />
        <Route 
          path="/main" 
          element={user ? <MainPage user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/goodreceipt" 
          element={user ? <GoodReceiptPage user={user} /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/handlingunit" 
          element={user ? <HandlingUnitPage user={user} /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/labelprinting" 
          element={user ? <LabelPrintingPage user={user} /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/putaway" 
          element={user ? <PutawayPage user={user} /> : <Navigate to="/login" />} 
        />

        <Route 
          path="/bintobin" 
          element={user ? <BinToBinPage user={user} /> : <Navigate to="/login" />} 
        />

          <Route 
          path="/warehousereport" 
          element={user ? <WarehouseReportPage user={user} /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/storeretrun" 
          element={user ? <StoreReturnPage user={user} /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/issuance" 
          element={user ? <IssuancePage user={user} /> : <Navigate to="/login" />} 
        />


        <Route path="/" element={<Navigate to="/login" />} />
      </Routes>
    </Router>
  );
}

export default App;