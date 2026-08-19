import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { loginUser } from "../api";

export default function LoginPage({ onLogin }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [plant, setPlant] = useState("");
  const [environment, setEnvironment] = useState("dev");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const client = environment === "dev" ? "110" : "300";
      const normalizedPlant = plant.trim().toUpperCase();
      const result = await loginUser(username, password, environment, normalizedPlant);
      onLogin({
        ...result,
        client,
        plant: normalizedPlant,
        server: environment.toUpperCase(),
      });
    } catch (err) {
      console.error("Login page error:", err);
      setError(err.message || "Login failed");
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <h2>SAP Login</h2>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Server</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              required
            >
              <option value="dev">Development</option>
              <option value="prd">Production</option>
            </select>
          </div>

          <div className="form-group">
            <label>Plant</label>
            <input
              type="text"
              value={plant}
              placeholder="Enter plant (e.g. 1134)"
              onChange={(e) => setPlant(e.target.value.toUpperCase())}
              required
            />
          </div>

          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              placeholder="Enter username"
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              placeholder="Enter password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn">
            Login
          </button>

          {error && <div className="error-message">{error}</div>}
        </form>
      </div>
    </div>
  );
}
