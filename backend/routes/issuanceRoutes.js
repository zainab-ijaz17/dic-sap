const express = require('express');
const axios = require('axios');
const https = require('https');

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

const router = express.Router();

// API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader — the same entity
// goodsReceiptRoutes.js posts Goods Receipts through, posted here instead as a Goods
// Issue (GoodsMovementType 311, storage-location-to-storage-location transfer) for
// Issuance step 4 (frontend/src/pages/IssuancePage2.js), once every picked batch has
// been scanned and confirmed.
// TODO: prd host/path not confirmed yet for this API package — mirrors the hostname
// pattern used by goodsReceiptRoutes.js until SAP confirms it (same base URL given
// for both dev calls, so likely identical, but not verified against a real prd call).
const BASE_URLS = {
  dev: 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/material-document',
  prd: 'https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com:443/material-document'
};

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

function extractDocumentNumber(sapData) {
  const props = sapData?.d || sapData || {};
  return {
    materialDocNumber: props.MaterialDocument || props.MatDoc || null,
    materialDocYear: props.MaterialDocumentYear || props.MatDocYear || null
  };
}

// Posts a Goods Issue (one to_MaterialDocumentItem line per picked batch, see
// buildMaterialDocumentPayload in frontend/src/api/issuanceApi.js) via
// API_MATERIAL_DOCUMENT_SRV. Same CSRF-then-POST shape as
// goodsReceiptRoutes.js's /post — this is the same entity, just a different
// GoodsMovementType.
router.post('/post', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.to_MaterialDocumentItem?.results?.length) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'to_MaterialDocumentItem.results is required'
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
    const entityUrl = `${baseUrl}/A_MaterialDocumentHeader`;

    let csrfToken, cookies;
    try {
      const csrfResponse = await axiosInstance.get(entityUrl, {
        params: { '$top': 1 },
        auth: { username, password },
        headers: {
          'X-CSRF-Token': 'Fetch',
          'Accept': 'application/json'
        }
      });
      csrfToken = csrfResponse.headers['x-csrf-token'];
      cookies = (csrfResponse.headers['set-cookie'] || [])
        .map(c => c.split(';')[0])
        .join('; ');
      console.log('Issuance CSRF token obtained:', csrfToken);
    } catch (csrfError) {
      console.log('Issuance CSRF token fetch failed, trying without CSRF:', csrfError.message);
    }

    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    if (cookies) headers['Cookie'] = cookies;

    console.log(`[${environment.toUpperCase()}] Issuance Post URL:`, entityUrl);
    console.log('Issuance payload:', JSON.stringify(body, null, 2));

    const response = await axiosInstance.post(entityUrl, body, {
      auth: { username, password },
      headers
    });

    const { materialDocNumber, materialDocYear } = extractDocumentNumber(response.data);

    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');

    res.status(200).json({
      success: true,
      materialDocNumber,
      materialDocYear,
      message: 'Issuance posted successfully.',
      raw: response.data
    });

  } catch (error) {
    console.error('Issuance Post error:', error.response?.data || error.message);
    res.header('Access-Control-Allow-Origin', '*');

    // SAP OData errors nest the human-readable text at error.message.value — surface
    // that instead of the generic axios "Request failed with status code 400".
    const sapMessage = error.response?.data?.error?.message;
    const sapErrorText = typeof sapMessage === 'string' ? sapMessage : sapMessage?.value;

    if (error.response?.status === 401) {
      res.status(401).json({ error: 'Authentication failed', message: 'Invalid credentials for SAP system' });
    } else if (error.response?.status === 403) {
      res.status(403).json({ error: 'Access forbidden', message: 'CSRF token validation failed or insufficient permissions' });
    } else {
      res.status(error.response?.status || 500).json({
        error: 'Proxy server error',
        message: sapErrorText || error.message,
        details: error.response?.data
      });
    }
  }
});

router.options('/post', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');
  res.status(200).send();
});

module.exports = router;
