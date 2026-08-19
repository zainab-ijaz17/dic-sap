const express = require('express');
const axios = require('axios');
const https = require('https');

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

const router = express.Router();

// API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod — standard API Management dev/prd
// host-swap pattern, standard Basic Auth, standard $filter (same shape as
// batchInfoRoutes.js/goodsReceiptRoutes.js).
// TODO: prd host not confirmed yet for this API package — mirrors the hostname
// pattern used by the other API Management packages until SAP confirms it.
const BASE_URLS = {
  dev: 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/fetch-stock',
  prd: 'https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com:443/fetch-stock'
};

const STOCK_ENTITY_PATH = '/A_MatlStkInAcctMod';

function getUserFromHeaders(req) {
  const authHeader = req.headers['x-user-auth'];
  let username, password;

  if (authHeader) {
    try {
      const decoded = Buffer.from(authHeader, 'base64').toString('utf-8');
      [username, password] = decoded.split(':');
    } catch (error) {
      console.error('Error decoding auth header:', error);
    }
  }

  const environmentHeader = req.headers['x-user-environment'] || 'dev';
  const environment = (environmentHeader === 'prd' || environmentHeader === '300') ? 'prd' : 'dev';

  return { username, password, environment };
}

// Looks up batch stock (Batch + quantity) for a Material at a Storage Location —
// used by Issuance step 2 to list the batches available to issue from, once the
// user has picked a reservation item on IssuancePage.js.
router.get('/batches', async (req, res) => {
  try {
    const { material, storageLocation } = req.query;
    if (!material || !storageLocation) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'material and storageLocation are required'
      });
    }

    const { username, password, environment } = getUserFromHeaders(req);
    if (!username || !password) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Valid user credentials are required'
      });
    }

    const baseUrl = BASE_URLS[environment];
    const filter = `Material eq '${material}' and StorageLocation eq '${storageLocation}'`;
    const url = `${baseUrl}${STOCK_ENTITY_PATH}?$filter=${encodeURIComponent(filter)}`;

    console.log(`[${environment.toUpperCase()}] Material Stock lookup URL:`, url);

    const response = await axiosInstance.get(url, {
      auth: { username, password },
      headers: { Accept: 'application/json' },
      validateStatus: () => true
    });

    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');

    if (response.status >= 400) {
      const sapMessage = response.data?.error?.message;
      const sapErrorText = typeof sapMessage === 'string' ? sapMessage : sapMessage?.value;
      return res.status(response.status).json({
        error: 'SAP API error',
        message: sapErrorText || `SAP returned ${response.status}`,
        details: response.data
      });
    }

    const items = response.data?.d?.results || response.data?.value || [];
    return res.status(200).json({ success: true, items });

  } catch (error) {
    console.error('Material Stock lookup error:', error.response?.data || error.message);
    res.header('Access-Control-Allow-Origin', '*');

    if (error.response?.status === 401) {
      return res.status(401).json({ error: 'Authentication failed', message: 'Invalid credentials for SAP system' });
    }

    return res.status(error.response?.status || 500).json({
      error: 'Proxy server error',
      message: error.message,
      details: error.response?.data
    });
  }
});

router.options('/batches', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');
  res.status(200).send();
});

// Looks up current stock quantity for one specific Batch (summed across whatever
// Storage Locations it's split across, same entity as /batches above, just filtered
// by Batch instead of StorageLocation) — used by Label Printing, which only has a
// Batch to work from, not a Storage Location.
router.get('/batch-quantity', async (req, res) => {
  try {
    const { material, batch } = req.query;
    if (!material || !batch) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'material and batch are required'
      });
    }

    const { username, password, environment } = getUserFromHeaders(req);
    if (!username || !password) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Valid user credentials are required'
      });
    }

    const baseUrl = BASE_URLS[environment];
    const filter = `Material eq '${material}' and Batch eq '${batch}'`;
    const url = `${baseUrl}${STOCK_ENTITY_PATH}?$filter=${encodeURIComponent(filter)}`;

    console.log(`[${environment.toUpperCase()}] Batch Quantity lookup URL:`, url);

    const response = await axiosInstance.get(url, {
      auth: { username, password },
      headers: { Accept: 'application/json' },
      validateStatus: () => true
    });

    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');

    if (response.status >= 400) {
      const sapMessage = response.data?.error?.message;
      const sapErrorText = typeof sapMessage === 'string' ? sapMessage : sapMessage?.value;
      return res.status(response.status).json({
        error: 'SAP API error',
        message: sapErrorText || `SAP returned ${response.status}`,
        details: response.data
      });
    }

    const items = response.data?.d?.results || response.data?.value || [];
    return res.status(200).json({ success: true, items });

  } catch (error) {
    console.error('Batch Quantity lookup error:', error.response?.data || error.message);
    res.header('Access-Control-Allow-Origin', '*');

    if (error.response?.status === 401) {
      return res.status(401).json({ error: 'Authentication failed', message: 'Invalid credentials for SAP system' });
    }

    return res.status(error.response?.status || 500).json({
      error: 'Proxy server error',
      message: error.message,
      details: error.response?.data
    });
  }
});

router.options('/batch-quantity', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');
  res.status(200).send();
});

module.exports = router;
