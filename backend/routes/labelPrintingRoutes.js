const express = require('express');
const net = require('net');

const router = express.Router();

// Sends raw ZPL to a network-attached Zebra printer over its raw TCP port (9100 by
// default on virtually all Zebra Link-OS printers — no driver needed, the printer just
// treats whatever bytes arrive as ZPL). This assumes one shared printer per environment
// reachable from wherever this backend runs; it does NOT support a printer wired to an
// individual handheld device (that would be Zebra Browser Print, a different integration
// living entirely on the frontend). Swap LABEL_PRINTER_HOST_DEV/PRD in backend/.env for
// the real printer IPs once known.
const PRINTER_CONFIG = {
  dev: {
    host: process.env.LABEL_PRINTER_HOST_DEV,
    port: Number(process.env.LABEL_PRINTER_PORT_DEV) || 9100
  },
  prd: {
    host: process.env.LABEL_PRINTER_HOST_PRD,
    port: Number(process.env.LABEL_PRINTER_PORT_PRD) || 9100
  }
};

const SOCKET_TIMEOUT_MS = 5000;

function getEnvironmentFromHeaders(req) {
  const environmentHeader = req.headers['x-user-environment'] || 'dev';
  return (environmentHeader === 'prd' || environmentHeader === '300') ? 'prd' : 'dev';
}

function sendZplToPrinter(host, port, zpl) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    socket.setTimeout(SOCKET_TIMEOUT_MS);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`Timed out connecting to label printer at ${host}:${port}`));
    });
    socket.once('error', (err) => {
      reject(new Error(`Unable to reach label printer at ${host}:${port} (${err.message})`));
    });

    socket.connect(port, host, () => {
      socket.end(zpl, 'utf8', () => resolve());
    });
  });
}

// Prints one label's worth of ZPL. The frontend (labelPrintingApi.js) builds the ZPL
// from the label's fields — this route only relays the raw bytes to the printer.
router.post('/print', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Environment');

  const { zpl } = req.body || {};
  if (!zpl || typeof zpl !== 'string') {
    return res.status(400).json({ error: 'Invalid request', message: 'zpl (string) is required' });
  }

  const environment = getEnvironmentFromHeaders(req);
  const { host, port } = PRINTER_CONFIG[environment];

  if (!host) {
    return res.status(500).json({
      error: 'Printer not configured',
      message: `No label printer configured for ${environment.toUpperCase()}. Set LABEL_PRINTER_HOST_${environment.toUpperCase()} in backend/.env.`
    });
  }

  try {
    await sendZplToPrinter(host, port, zpl);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Label print error:', error.message);
    return res.status(502).json({ error: 'Printer error', message: error.message });
  }
});

router.options('/print', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Environment');
  res.status(200).send();
});

module.exports = router;
