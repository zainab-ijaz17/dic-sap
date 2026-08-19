import axios from "axios";
import { getUserCredentials } from "../api";
import { getBackendBaseUrl } from "../config/servers";

// Places one Handling Unit into a Storage Bin via Z_HU_PUTAWAY_SRV_SRV/PutawayRequestSet
// (see backend/routes/putawayRoutes.js). Lgnum is fixed ("DIC"); huNumber gets
// zero-padded to CHAR20 server-side. Used by the list-based Putaway flow reached from
// Label Printing, where huNumber is a real HU created earlier in the GR pipeline.
export async function placeHandlingUnitInStorageBin({ huNumber, storageBin }) {
  const creds = getUserCredentials();
  if (!creds?.username || !creds?.password) {
    throw new Error("User not authenticated. Please log in again.");
  }

  const url = `${getBackendBaseUrl(creds.environment)}/api/putaway/place`;

  let response;
  try {
    response = await axios.post(
      url,
      {
        huNumber: String(huNumber).trim(),
        storageBin: String(storageBin).trim(),
      },
      {
        headers: {
          "X-User-Auth": btoa(`${creds.username}:${creds.password}`),
          "X-User-Environment": creds.environment,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error("SAP authentication failed while placing the Handling Unit. Please log in again.");
    }
    const backendMessage = err.response?.data?.message;
    if (backendMessage) {
      throw new Error(backendMessage);
    }
    if (!err.response) {
      throw new Error("Unable to reach the Putaway service (network/CORS error).");
    }
    throw new Error(`Putaway failed: ${err.response.status} ${err.response.statusText}`);
  }

  const data = response.data;
  if (!data?.success) {
    throw new Error(data?.message || "Putaway failed.");
  }

  return data;
}
