// index.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const sapRoutes = require("./routes/sapRoutes");
const migoRoutes = require("./routes/migoRoutes");
const materialDocRoutes = require("./routes/materialDocRoutes");
const materialCheckRoutes = require("./routes/materialCheckRoutes");
const migoTransferRoutes = require("./routes/migoTransferRoutes");
const inventoryReportRoutes = require("./routes/inventoryReportRoutes");
const goodsReceiptRoutes = require("./routes/goodsReceiptRoutes");
const stpoGoodsReceiptRoutes = require("./routes/stpoGoodsReceiptRoutes");
const putawayRoutes = require("./routes/putawayRoutes");
const batchClassRoutes = require("./routes/batchClassRoutes");
const batchInfoRoutes = require("./routes/batchInfoRoutes");
const reservationRoutes = require("./routes/reservationRoutes");
const materialStockRoutes = require("./routes/materialStockRoutes");
const issuanceRoutes = require("./routes/issuanceRoutes");
const labelPrintingRoutes = require("./routes/labelPrintingRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

/**
 * CORS
 * Allow frontend + Zebra devices
 * (Can be restricted later if needed)
 */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-User-Auth", "X-User-Environment", "X-User-Plant"],
    credentials: false
  })
);

// Middleware
app.use(express.json());

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.json({ message: "SAP Integration Backend is running" });
});

/**
 * Routes
 */
app.use("/api/auth", authRoutes);
app.use("/api", sapRoutes);
app.use("/api/migo", migoRoutes);
app.use("/api/material-doc", materialDocRoutes);
app.use("/api/MaterialDocument", materialCheckRoutes);
app.use("/api/migo-transfer", migoTransferRoutes);
app.use("/api", inventoryReportRoutes);
app.use("/api/goods-receipt", goodsReceiptRoutes);
app.use("/api/stpo-goods-receipt", stpoGoodsReceiptRoutes);
app.use("/api/putaway", putawayRoutes);
app.use("/api/batch-class", batchClassRoutes);
app.use("/api/batch-info", batchInfoRoutes);
app.use("/api/reservation", reservationRoutes);
app.use("/api/material-stock", materialStockRoutes);
app.use("/api/issuance", issuanceRoutes);
app.use("/api/label-printing", labelPrintingRoutes);

/**
 * Error handling (must be last)
 */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong" });
});

/**
 * Start server
 * IMPORTANT:
 * - Do NOT log IPs
 * - Do NOT assume network interfaces
 */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Login endpoint: POST /api/auth/Login");
  console.log("MIGO Check endpoint: POST /api/migo/check");
  console.log("MIGO Post endpoint: POST /api/migo/post");
  console.log("Material Doc endpoint: POST /api/material-doc/fetch");
  console.log("Material Check endpoint: POST /api/MaterialDocument/check");
  console.log("MIGO Transfer endpoint: POST /api/migo-transfer/transfer");
  console.log("Inventory Report endpoint: POST /api/inventory-report");
  console.log("Goods Receipt Post endpoint: POST /api/goods-receipt/post");
  console.log("Material Document Items endpoint: GET /api/goods-receipt/material-document-items");
  console.log("STPO lookup endpoint: GET /api/stpo-goods-receipt/stock-transport-order/:stpoNumber");
  console.log("STPO existing-batches endpoint: GET /api/stpo-goods-receipt/stpo-batches/:stpoNumber");
  console.log("GR for STPO Post endpoint: POST /api/stpo-goods-receipt/post");
  console.log("Putaway endpoint: POST /api/putaway/place");
  console.log("Batch Characteristic Value endpoint: POST /api/batch-class/assign-values");
  console.log("Bin characteristic lookup endpoint: GET /api/batch-class/bin-lookup");
  console.log("Batch Info lookup endpoint: GET /api/batch-info/lookup");
  console.log("Reservation lookup endpoint: GET /api/reservation/lookup");
  console.log("Material Stock batches endpoint: GET /api/material-stock/batches");
  console.log("Issuance Post endpoint: POST /api/issuance/post");
  console.log("Label Print endpoint: POST /api/label-printing/print");
});

// Utility function to log your local IP

function getLocalIP() {
    const os = require('os');
    const ifaces = os.networkInterfaces();
    for (const iface of Object.values(ifaces)) {
        for (const alias of iface) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
      }
    }