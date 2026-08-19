const express = require('express');
const axios = require('axios');
const https = require('https');

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

const router = express.Router();

// TODO: prd host not confirmed yet for this API package — mirrors the hostname
// pattern used by the other API Management packages until SAP confirms it.
const BASE_URLS = {
  dev: 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/hu-putaway',
  prd: 'https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com:443/hu-putaway'
};

const PUTAWAY_ENTITY_SET = 'PutawayRequestSet';
const WAREHOUSE_NUMBER = 'DIC';

// PutawayRequestSet is a function-import-style entity (deep insert, not plain CRUD),
// so — same as HuCreate/HuPack (handlingUnitRoutes.js) — the CSRF token has to be
// fetched against the service root, not the entity set itself.
async function fetchCsrfHeaders(baseUrl, username, password) {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const csrfResponse = await axiosInstance.get(baseUrl, {
      auth: { username, password },
      headers: {
        'X-CSRF-Token': 'Fetch',
        'Accept': 'application/json'
      }
    });
    const csrfToken = csrfResponse.headers['x-csrf-token'];
    const cookies = (csrfResponse.headers['set-cookie'] || [])
      .map((c) => c.split(';')[0])
      .join('; ');
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    if (cookies) headers['Cookie'] = cookies;
  } catch (csrfError) {
    console.log('Putaway CSRF token fetch failed, trying without CSRF:', csrfError.message);
  }
  return headers;
}

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

// Places one Handling Unit into a Storage Bin via Z_HU_PUTAWAY_SRV_SRV/PutawayRequestSet.
router.post('/place', async (req, res) => {
  try {
    const { huNumber, storageBin } = req.body || {};

    if (!huNumber || !storageBin) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'huNumber and storageBin are required'
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
    const entityUrl = `${baseUrl}/${PUTAWAY_ENTITY_SET}`;

    const headers = await fetchCsrfHeaders(baseUrl, username, password);

    const body = {
      Lgnum: WAREHOUSE_NUMBER,
      Exidv: String(huNumber).trim(),
      Nlpla: String(storageBin).trim()
    };

    console.log(`[${environment.toUpperCase()}] Putaway URL:`, entityUrl);
    console.log('Putaway payload:', JSON.stringify(body, null, 2));

    const response = await axiosInstance.post(entityUrl, body, {
      auth: { username, password },
      headers,
      validateStatus: () => true
    });

    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
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

    // PutawayRequestSet always answers HTTP 200 — the actual outcome is carried in the
    // body's Success/Message fields (e.g. Success: false, "No unrestricted stock found
    // for material ... batch ..." when the HU can't actually be placed).
    const result = response.data?.d || {};
    if (result.Success === false || result.Success === 'false') {
      return res.status(200).json({
        success: false,
        message: result.Message || 'Putaway failed.',
        raw: response.data
      });
    }

    return res.status(200).json({
      success: true,
      huNumber: result.Exidv || body.Exidv,
      storageBin: result.Nlpla || body.Nlpla,
      raw: response.data
    });

  } catch (error) {
    console.error('Putaway error:', error.response?.data || error.message);
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

router.options('/place', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');
  res.status(200).send();
});

module.exports = router;
