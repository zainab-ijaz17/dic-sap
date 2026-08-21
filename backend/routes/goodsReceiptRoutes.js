const express = require('express');
const axios = require('axios');
const https = require('https');

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

const router = express.Router();

// TODO: prd host/path not confirmed yet for this API package — mirrors the
// hostname pattern used by migoRoutes.js/materialDocRoutes.js until SAP confirms it.
const BASE_URLS = {
  dev: 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/material-document',
  prd: 'https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com:443/material-document'
};

// TODO: prd host/path not confirmed yet for this API package — mirrors the
// hostname pattern used above until SAP confirms it.
const PO_BASE_URLS = {
  dev: 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/grp/po',
  prd: 'https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com:443/grp/po'
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

// Post a goods receipt via API_MATERIAL_DOCUMENT_SRV (A_MaterialDocumentHeader).
// No test-run support on this API (see A_MaterialDocumentHeader field list) — Check
// on GoodReceipt2Page stays a client-side mock; this endpoint only handles the real Post.
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
      console.log('Goods Receipt CSRF token obtained:', csrfToken);
    } catch (csrfError) {
      console.log('Goods Receipt CSRF token fetch failed, trying without CSRF:', csrfError.message);
    }

    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    if (cookies) headers['Cookie'] = cookies;

    console.log(`[${environment.toUpperCase()}] Goods Receipt Post URL:`, entityUrl);
    console.log('Goods Receipt payload:', JSON.stringify(body, null, 2));

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
      message: 'Goods receipt posted successfully.',
      raw: response.data
    });

  } catch (error) {
    console.error('Goods Receipt Post error:', error.response?.data || error.message);
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

// Looks up the line items (incl. Batch) SAP recorded against a posted material
// document, via API_MATERIAL_DOCUMENT_SRV (A_MaterialDocumentItem). Used on the HU
// Creation page to auto-fill the Batch field instead of having the user type it.
router.get('/material-document-items', async (req, res) => {
  try {
    const { materialDocNumber, materialDocYear } = req.query;

    if (!materialDocNumber || !materialDocYear) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'materialDocNumber and materialDocYear are required'
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
    const filter = `MaterialDocumentYear eq '${materialDocYear}' and MaterialDocument eq '${materialDocNumber}'`;
    const url = `${baseUrl}/A_MaterialDocumentItem?$filter=${encodeURIComponent(filter)}&$format=json`;

    console.log(`[${environment.toUpperCase()}] Material Document Items URL:`, url);

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
    console.error('Material Document Items error:', error.response?.data || error.message);
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

router.options('/material-document-items', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');
  res.status(200).send();
});

// Looks up Purchase Order line items via C_PurchaseOrderFs (PO Fact Sheet OData
// service) — used by GoodReceiptPage to populate Material/Quantity/UoM from a
// scanned/typed PO number. Proxied through the backend, like every other SAP call
// here, so a handheld device on a different network never needs direct access to
// SAP API Management.
router.get('/purchase-order/:poNumber', async (req, res) => {
  try {
    const { poNumber } = req.params;
    if (!poNumber) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'poNumber is required'
      });
    }

    const { username, password, environment } = getUserFromHeaders(req);
    if (!username || !password) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Valid user credentials are required'
      });
    }

    const sapClient = environment === 'prd' ? '300' : '110';
    const baseUrl = PO_BASE_URLS[environment];
    const url = `${baseUrl}/C_PurchaseOrderFs('${encodeURIComponent(poNumber)}')/to_PurchaseOrderItem`;

    console.log(`[${environment.toUpperCase()}] Purchase Order lookup URL:`, url);

    const response = await axiosInstance.get(url, {
      params: { 'sap-client': sapClient, '$format': 'json' },
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
    console.error('Purchase Order lookup error:', error.response?.data || error.message);
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

router.options('/purchase-order/:poNumber', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');
  res.status(200).send();
});

module.exports = router;
