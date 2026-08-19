import React from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";

function MainPage({ user, onLogout }) {
  const navigate = useNavigate();
  
  const navTiles = [
    {
      id: "grn",
      title: "Goods Receipt",
      path: "/goodreceipt"
    },
        {
      id: "lp",
      title: "Label Printing",
      path: "/labelprinting"
    },
        {
      id: "put",
      title: "Putaway",
      path: "/putaway"
    },
        {
      id: "iss",
      title: "Issuance",
      path: "/issuance"
    },

  ];

  const handleTileClick = (path) => {
    navigate(path);
  };

  return (
    <div className="app-container">
      <div className="main-content">
        <PageHeader user={user} onLogout={onLogout} />
        <section className="tiles-container">
          {navTiles.map(tile => (
            <div 
              key={tile.id} 
              className="nav-tile text-tile hover:bg-gray-100 cursor-pointer transition-colors duration-200"
              onClick={() => handleTileClick(tile.path)}
            >
              <span className="tile-title">{tile.title}</span>
            </div>
          ))}
        </section>
        <section className="dashboard-content">
        </section>
      </div>
    </div>
  );
}

export default MainPage;