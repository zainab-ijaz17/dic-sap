const express = require("express");
const axios = require("axios");
const https = require("https");
 
const router = express.Router();
 
/* =====================================================
   CONFIG
===================================================== */
 
const API_URL_DEV = "https://devspace.test.apimanagement.eu10.hana.ondemand.com/cpd/batch";
const API_URL_PRD = "https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com:443/grp/batch";
 
const SAP_USER = process.env.SAP_USER;
const SAP_PASS = process.env.SAP_PASS;
 
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
 
const SAP_ACCEPT_ENCODING = "identity";
 
/* =====================================================
   CORS (EXPRESS 5 SAFE)
===================================================== */
 
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-CSRF-Token, X-User-Auth, X-User-Environment, X-User-Plant",
};
 
router.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.set(corsHeaders).sendStatus(200);
  } else {
    next();
  }
});
 
/* =====================================================
   HELPERS
===================================================== */
 
function decodeBasicAuth(encoded) {
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const [username, password] = decoded.split(":");
  if (!username || !password) {
    throw new Error("Invalid Authorization header");
  }
  return { username, password };
}

function parseBatchResults(data) {
  if (!data) return [];
  if (Array.isArray(data.value)) return data.value;
  if (Array.isArray(data.d?.results)) return data.d.results;
  if (data.d && typeof data.d === "object" && !Array.isArray(data.d.results)) {
    return [data.d];
  }
  if (data.Charg || data.Batch || data.BatchNumber) return [data];
  return [];
}

function normalizeBatchRecord(record) {
  if (!record) return null;
  const qty = record.QTY ?? record.Qty ?? record.Quantity ?? 0;
  return {
    ...record,
    Charg: record.Charg || record.Batch || record.BatchNumber || "",
    Werks: record.Werks || record.Plant || record.WERKS || "",
    QTY: qty,
    Qty: qty,
  };
}

async function requestBatchInfo(url, username, password) {
  const response = await axios.get(url, {
    auth: { username, password },
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "Accept-Encoding": SAP_ACCEPT_ENCODING,
    },
    httpsAgent,
    timeout: 30000,
    validateStatus: () => true,
  });

  console.log("Batch API request:", url);
  console.log("Batch API status:", response.status);

  if (response.status >= 400) {
    return { error: response.data, status: response.status };
  }

  const results = parseBatchResults(response.data);
  if (!results.length) {
    return { error: "No batch records in response", status: 404, data: response.data };
  }

  return { batch: normalizeBatchRecord(results[0]) };
}

async function fetchBatchFromGateway({ baseUrl, batchNumber, plant, sapClient, username, password }) {
  const urls = [
    `${baseUrl}/BatchInfoSet?$filter=${encodeURIComponent(
      `Charg eq '${batchNumber}' and Werks eq '${plant}'`
    )}&$format=json&sap-client=${sapClient}`,
    `${baseUrl}/BatchInfoSet?$filter=${encodeURIComponent(
      `Charg eq '${batchNumber}' and Werks eq '${plant}'`
    )}&$format=json`,
    `${baseUrl}?$filter=${encodeURIComponent(
      `BatchNumber eq '${batchNumber}' and Werks eq '${plant}'`
    )}&$format=json&sap-client=${sapClient}`,
    `${baseUrl}?$filter=${encodeURIComponent(
      `BatchNumber eq '${batchNumber}' and Werks eq '${plant}'`
    )}&$format=json`,
    `${baseUrl}?$filter=${encodeURIComponent(
      `BatchNumber eq '${batchNumber}'`
    )}&$format=json&sap-client=${sapClient}`,
  ];

  let lastError = { error: "Batch not found", status: 404 };

  for (const url of urls) {
    const result = await requestBatchInfo(url, username, password);
    if (result.batch) return result.batch;
    lastError = result;
    if (result.status && result.status !== 404) break;
  }

  throw Object.assign(new Error("Batch not found"), lastError);
}
 
/* =====================================================
   RMV (110/DEV) - CHECK NAME / REMOVE API
===================================================== */
 
router.post("/rmv", async (req, res) => {
  try {
    const environment = req.headers["x-user-environment"];
    if (!environment) {
      return res
        .status(400)
        .json({ error: "X-User-Environment header required (dev, 110, prd, or 300)" });
    }
 
    if (!["dev", "110"].includes(environment)) {
      return res
        .status(400)
        .json({ error: "RMV endpoint is only configured for dev/110" });
    }
 
    const authHeader = req.headers["x-user-auth"];
    if (!authHeader) {
      return res.status(401).json({
        error: "X-User-Auth header required - must be base64 encoded username:password",
      });
    }
 
    const { username, password } = decodeBasicAuth(authHeader);
 
    const response = await axios.post(API_URL_DEV, req.body, {
      auth: { username, password },
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Encoding": SAP_ACCEPT_ENCODING,
      },
      httpsAgent,
      timeout: 30000,
      validateStatus: () => true,
    });
 
    res.set(corsHeaders);
    return res.status(response.status).json(response.data);
  } catch (err) {
    console.error("RMV error:", err.message);
    res.set(corsHeaders);
    return res.status(500).json({ error: "RMV request failed" });
  }
});
 
/* =====================================================
   300 LEVEL DIRECT API
===================================================== */
 
router.get("/batch/300/:batchNumber", async (req, res) => {
  try {
    const { batchNumber } = req.params;
    const authHeader = req.headers["x-user-auth"];
 
    if (!authHeader) {
      return res.status(401).json({ error: "User credentials required" });
    }
 
    const url = `${API_URL_DEV}?$filter=BatchNumber eq '${batchNumber}'`;
 
    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${authHeader}`,
        Accept: "application/json",
        "Accept-Encoding": SAP_ACCEPT_ENCODING,
      },
      httpsAgent,
      validateStatus: () => true,
    });
 
    return res.status(response.status).json(response.data);
  } catch (err) {
    console.error("300 batch fetch error:", err.message);
    return res.status(500).json({ error: "Failed to fetch batch" });
  }
});
 
/* =====================================================
   MAIN BATCH INFO (BTP / API MGMT)
===================================================== */
 
router.get("/BatchInfo/:batchNumber", async (req, res) => {
  try {
    const { batchNumber } = req.params;
    const { werks = "1134" } = req.query;
 
    const authHeader = req.headers["x-user-auth"];
    const environment = req.headers["x-user-environment"] || "dev";
 
    if (!authHeader) {
      return res.status(401).json({ error: "User credentials required" });
    }
 
    const { username, password } = decodeBasicAuth(authHeader);
    const sapClient = environment === "prd" ? "300" : "110";
 
    const filter = `Charg eq '${batchNumber}' and Werks eq '${werks}'`;
 
    const isPrd = environment === "prd" || environment === "300";
    const baseUrl = isPrd ? API_URL_PRD : API_URL_DEV;
 
    const url = isPrd
      ? `${baseUrl}/BatchInfoSet?$filter=${encodeURIComponent(filter)}&$format=json`
      : `${baseUrl}/BatchInfoSet?$filter=${encodeURIComponent(filter)}&$format=json&sap-client=${sapClient}`;
 
    const response = await axios.get(url, {
      auth: { username, password },
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Encoding": SAP_ACCEPT_ENCODING,
      },
      httpsAgent,
      timeout: 30000,
      validateStatus: () => true,
    });
 
    if (response.status >= 400) {
      return res.status(response.status).json({
        error: "SAP API error",
        status: response.status,
        data: response.data,
      });
    }
 
    const results = response.data?.d?.results;
    if (!results || !results.length) {
      return res.status(404).json({ error: "Batch not found" });
    }
 
    res.set(corsHeaders).json(results[0]);
  } catch (err) {
    console.error("BatchInfo error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});
 
/* =====================================================
   API MGMT GATEWAY (PRD ONLY)
===================================================== */
 
router.get("/BatchInfoGateway/:batchNumber", async (req, res) => {
  try {
    const { batchNumber } = req.params;
    const environment = req.headers["x-user-environment"] || "dev";
 
    if (!["dev", "110", "prd", "300"].includes(environment)) {
      return res
        .status(400)
        .json({ error: "X-User-Environment must be 'dev', '110', 'prd', or '300'" });
    }
 
    const authHeader = req.headers["x-user-auth"];
    if (!authHeader) {
      return res.status(401).json({
        error: "X-User-Auth header required - must be base64 encoded username:password"
      });
    }
 
    const { username, password } = decodeBasicAuth(authHeader);
    const plant = (req.headers["x-user-plant"] || "1134").trim();

    const isDev = environment === "dev" || environment === "110";
    const sapClient = isDev ? "110" : "300";
    const baseUrl = isDev ? API_URL_DEV : API_URL_PRD;

    const batch = await fetchBatchFromGateway({
      baseUrl,
      batchNumber,
      plant,
      sapClient,
      username,
      password,
    });

    return res.set(corsHeaders).json(batch);
  } catch (err) {
    console.error("Gateway error:", err.message);
    if (err.status === 401) {
      return res.status(401).json({ error: "Authentication failed" });
    }
    if (err.status && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({
        error: err.message || "Batch not found",
        details: err.error,
      });
    }
    return res.status(500).json({ error: "Gateway failure" });
  }
});
 
module.exports = router;
 