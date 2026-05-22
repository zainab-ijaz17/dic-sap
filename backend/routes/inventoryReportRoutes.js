const express = require("express");
const axios = require("axios");
const https = require("https");

const router = express.Router();

console.log("Inventory report routes loaded");

const PLANT = "1134";

const STOCK_CONFIG = {
  dev: {
    integrationUrl:
      process.env.SAP_STOCK_INTEGRATION_URL_DEV ||
      "https://devspace.test.apimanagement.eu10.hana.ondemand.com/cpd/stock110",
  },

  prd: {
    integrationUrl:
      process.env.SAP_STOCK_INTEGRATION_URL_PRD ||
      "https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com/cpd/stock300",
  },
};

function normalizeEnvironment(env) {
  const value = String(env || "dev").toLowerCase();

  if (value === "110" || value === "dev") return "dev";
  if (value === "300" || value === "prd") return "prd";

  return "dev";
}

function getStockConfig(environment) {
  return STOCK_CONFIG[normalizeEnvironment(environment)] || STOCK_CONFIG.dev;
}

const sapHttp = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false,
  }),
  timeout: 60000,
});

function getUserFromBody(req) {
  const { username, password, environment } = req.body || {};
  if (!username || !password) return null;

  return {
    username: String(username),
    password: String(password),
    environment: environment || "dev",
  };
}

// safer OData filter builder
function buildFilter(materialNumber, sloc) {
  return [
    `Material eq '${materialNumber}'`,
    `Plant eq '${PLANT}'`,
    `StorageLocation eq '${sloc}'`,
  ].join(" and ");
}

function parseStockResponse(data, materialNumber, sloc) {
  const results = data?.d?.results ?? data?.value ?? [];

  if (!Array.isArray(results) || results.length === 0) {
    throw Object.assign(new Error("Empty SAP response"), { status: 502 });
  }

  const first = results[0];

  return {
    materialNumber: first.Material || materialNumber,
    materialType: first.MaterialType || "",
    plant: PLANT,
    sloc: first.StorageLocation || sloc,

    unrestrictedQuantity:
      results.find(r => r.InventoryStockType === "01")?.MatlWrhsStkQtyInMatlBaseUnit || 0,

    qualityQuantity:
      results.find(r => r.InventoryStockType === "02")?.MatlWrhsStkQtyInMatlBaseUnit || 0,

    reservedQuantity:
      results.find(r => r.InventoryStockType === "03")?.MatlWrhsStkQtyInMatlBaseUnit || 0,

    transferSloc:
      results.find(r => r.InventoryStockType === "04")?.StorageLocation || "",
  };
}

function throwSapHttpError(response) {
  const err = new Error(
    response.data?.error?.message?.value ||
    response.data?.error ||
    `SAP returned ${response.status}`
  );

  err.status = response.status;
  err.sapResponseData = response.data;

  throw err;
}

async function fetchFromIntegrationSuite(
  integrationUrl,
  materialNumber,
  sloc,
  username,
  password
) {
  const url = `${integrationUrl}/$metadata`;

  const filter = buildFilter(materialNumber, sloc);

  console.log("➡️ SAP CALL:", url);
  console.log("➡️ FILTER:", filter);

  const response = await sapHttp.get(url, {
    params: {
      $format: "json",
      $filter: filter,
    },
    auth: { username, password },
    headers: {
      Accept: "application/json",
    },
    validateStatus: () => true,
  });

  console.log("⬅️ SAP STATUS:", response.status);

  if (response.status >= 400) {
    console.log("❌ SAP ERROR BODY:", response.data);
    throwSapHttpError(response);
  }

  return parseStockResponse(response.data, materialNumber, sloc);
}

async function fetchStock(materialNumber, sloc, username, password, environment) {
  const cfg = getStockConfig(environment);

  return fetchFromIntegrationSuite(
    cfg.integrationUrl,
    materialNumber,
    sloc,
    username,
    password
  );
}

router.post("/inventory-report", async (req, res) => {
  try {
    console.log("Inventory report endpoint hit");

    const materialNumber = (req.body?.materialNumber || "").trim();
    const sloc = (req.body?.sloc || "").trim();

    if (!materialNumber || !sloc) {
      return res.status(400).json({
        error: "Validation error",
        message: "materialNumber and sloc are required",
      });
    }

    const user = getUserFromBody(req);

    if (!user) {
      return res.status(401).json({
        error: "Auth required",
        message: "Missing credentials",
      });
    }

    const report = await fetchStock(
      materialNumber,
      sloc,
      user.username,
      user.password,
      user.environment
    );

    return res.json(report);

  } catch (err) {
    console.error("❌ Inventory report error:", err.message);

    return res.status(err.status || 500).json({
      error: "Server error",
      message: err.message,
      sap: err.sapResponseData || null,
    });
  }
});

module.exports = router;