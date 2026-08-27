const express = require('express');
const axios = require('axios');
const https = require('https');

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

const router = express.Router();

// GR for STPO — mirrors goodsReceiptRoutes.js. A Stock Transport Purchase Order is
// still a Purchase Order document in SAP (just a different document type), so the
// lookup reuses the same C_PurchaseOrderFs Fact Sheet service and the same
// A_MaterialDocumentHeader posting API as a regular Goods Receipt.
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

// Batch for GR for STPO isn't picked by the user — it's whatever Batch was actually
// shipped for this STPO, discoverable from the Material Document trail: Plant 1312 +
// GoodsMovementType 351 is the stock-transfer goods-issue posting at the supplying
// plant. A STPO can have more than one such posting (partial deliveries), so only
// the latest Material Document's Batches are current — picking the highest
// MaterialDocumentYear/MaterialDocument naturally supersedes an earlier posting that
// was later reversed (movement 352) once a corrected 351 is posted, without needing to
// inspect GoodsMovementIsCancelled: a still-cancelled-with-no-resend 351 is exactly
// the "latest" available data, and its Batch/Quantity are what's shown until SAP has
// something newer.
const STPO_BATCH_PLANT = '1312';
const STPO_BATCH_MOVEMENT_TYPE = '351';

// Looks up the Batch SAP actually shipped for each Material on a STPO, via
// API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem — used right when the user clicks
// Next on GrStpoPage, so GrStpo2Page opens with Batch already known instead of
// asking the user to pick one.
router.get('/stpo-batches/:stpoNumber', async (req, res) => {
  try {
    const { stpoNumber } = req.params;
    if (!stpoNumber) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'stpoNumber is required'
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
    const filter = `PurchaseOrder eq '${stpoNumber}'`;
    // Quantity was previously believed unavailable here — testing directly against the
    // SAP backend (bypassing this app's API Management proxy) confirmed
    // QuantityInBaseUnit/QuantityInEntryUnit ARE populated on A_MaterialDocumentItem.
    // Requesting them here lets fetchStpoBatchesByMaterial() (frontend/src/api/stpoGoodsReceiptApi.js)
    // use the exact quantity actually posted for each Batch instead of a separate
    // API_MATERIAL_STOCK_SRV lookup. TODO: if this app's API Management "material-document"
    // product still strips these fields (as it previously did even with $select omitted),
    // they'll simply come back empty and the frontend falls back to fetchBatchQuantity().
    const select = 'Material,Batch,MaterialDocumentYear,MaterialDocument,MaterialDocumentItem,GoodsMovementType,Plant,GoodsMovementIsCancelled,MaterialBaseUnit,QuantityInBaseUnit,EntryUnit,QuantityInEntryUnit';
    const url = `${baseUrl}/A_MaterialDocumentItem?$filter=${encodeURIComponent(filter)}&$select=${select}&$format=json`;

    console.log(`[${environment.toUpperCase()}] STPO existing-batches lookup URL:`, url);

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

    const allItems = response.data?.d?.results || response.data?.value || [];
    const relevant = allItems.filter(
      (item) => String(item.Plant).trim() === STPO_BATCH_PLANT && String(item.GoodsMovementType).trim() === STPO_BATCH_MOVEMENT_TYPE
    );

    if (relevant.length === 0) {
      return res.status(200).json({ success: true, items: [], materialDocument: null, materialDocumentYear: null });
    }

    const byDocument = new Map();
    relevant.forEach((item) => {
      const key = `${item.MaterialDocumentYear}-${item.MaterialDocument}`;
      if (!byDocument.has(key)) byDocument.set(key, []);
      byDocument.get(key).push(item);
    });

    const latestKey = Array.from(byDocument.keys()).sort((a, b) => {
      const [yearA, docA] = a.split('-');
      const [yearB, docB] = b.split('-');
      if (yearA !== yearB) return Number(yearB) - Number(yearA);
      return Number(docB) - Number(docA);
    })[0];

    const latestItems = byDocument.get(latestKey);
    const [materialDocumentYear, materialDocument] = latestKey.split('-');

    return res.status(200).json({
      success: true,
      items: latestItems,
      materialDocument,
      materialDocumentYear
    });

  } catch (error) {
    console.error('STPO existing-batches lookup error:', error.response?.data || error.message);
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

router.options('/stpo-batches/:stpoNumber', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');
  res.status(200).send();
});

// Looks up STPO line items via C_PurchaseOrderFs (PO Fact Sheet OData service) —
// used by GrStpoPage to populate Material/Quantity/UoM from a scanned/typed STPO
// number. Proxied through the backend, like every other SAP call here, so a
// handheld device on a different network never needs direct access to SAP API
// Management.
router.get('/stock-transport-order/:stpoNumber', async (req, res) => {
  try {
    const { stpoNumber } = req.params;
    if (!stpoNumber) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'stpoNumber is required'
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
    const url = `${baseUrl}/C_PurchaseOrderFs('${encodeURIComponent(stpoNumber)}')/to_PurchaseOrderItem`;

    console.log(`[${environment.toUpperCase()}] STPO lookup URL:`, url);

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
    console.error('STPO lookup error:', error.response?.data || error.message);
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

router.options('/stock-transport-order/:stpoNumber', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');
  res.status(200).send();
});

// Post a GR for STPO via API_MATERIAL_DOCUMENT_SRV (A_MaterialDocumentHeader). No
// test-run support on this API — Check on GrStpo2Page stays a client-side mock;
// this endpoint only handles the real Post.
// TODO: payload shape (buildStpoMaterialDocumentPayload in
// ../../frontend/src/api/stpoGoodsReceiptApi.js) is still a placeholder pending
// confirmation of the real GR-for-STPO posting fields (e.g. Batch).
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
      console.log('GR for STPO CSRF token obtained:', csrfToken);
    } catch (csrfError) {
      console.log('GR for STPO CSRF token fetch failed, trying without CSRF:', csrfError.message);
    }

    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    if (cookies) headers['Cookie'] = cookies;

    console.log(`[${environment.toUpperCase()}] GR for STPO Post URL:`, entityUrl);
    console.log('GR for STPO payload:', JSON.stringify(body, null, 2));

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
      message: 'GR for STPO posted successfully.',
      raw: response.data
    });

  } catch (error) {
    console.error('GR for STPO Post error:', error.response?.data || error.message);
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
