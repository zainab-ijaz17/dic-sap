import axios from "axios";
import { getBackendBaseUrl } from "./config/servers";

export const loginUser = async (username, password, environment, plant = "") => {
  try {
    const loginClient = axios.create({
      baseURL: `${getBackendBaseUrl(environment)}/api/auth`,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      withCredentials: false,
    });

    const response = await loginClient.post('/Login', {
      username,
      password,
      environment
    });

    const result = response.data?.["ns0:Z_WM_HANDHELD_LOGINResponse"];

    if (result?.E_TYPE === "S") {
      const token = btoa(`${username}:${password}`);
      const normalizedPlant = plant.trim().toUpperCase();
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify({ username, environment, plant: normalizedPlant }));
      return {
        success: true,
        username,
        environment,
        plant: normalizedPlant,
        token
      };
    } else {
      throw new Error(result?.E_MESSAGE || "Authentication failed");
    }
  } catch (error) {
    console.error("Login failed:", error);
    console.error("Error details:", {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      headers: error.response?.headers
    });

    const errorMessage = error.response?.data?.["ns0:Z_WM_HANDHELD_LOGINResponse"]?.E_MESSAGE || 
                        error.message || 
                        "Authentication failed";
    throw new Error(errorMessage);
  }
};

// Helper to decode user credentials from token for SAP auth
export const getUserCredentials = () => {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const decoded = atob(token);
    const idx = decoded.indexOf(':');
    const username = idx > 0 ? decoded.slice(0, idx) : null;
    const password = idx > 0 ? decoded.slice(idx + 1) : null;
    if (!username || !password) return null;
    const userStr = localStorage.getItem('user');
    const user = userStr ? JSON.parse(userStr) : {};
    return { username, password, environment: user.environment, plant: user.plant };
  } catch {
    return null;
  }
};

