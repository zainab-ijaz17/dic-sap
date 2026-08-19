const express = require('express');
const axios = require('axios');
const https = require('https');

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

const router = express.Router();

// TODO: prd host/path not confirmed yet for this API package — mirrors the
// hostname pattern used by other API Management packages (goodsReceiptRoutes.js,
// handlingUnitRoutes.js) until SAP confirms it.
const BASE_URLS = {
  dev: 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/batch-class',
  prd: 'https://prdspace.prod01.apimanagement.eu10.hana.ondemand.com:443/batch-class'
};

// Confirmed against SAP: /sap/opu/odata/sap/API_BATCH_SRV/BatchCharcValue. The API
// Management proxy (BASE_URLS above) maps to the service root, so only the entity
// set name is appended here — same pattern as goodsReceiptRoutes.js/A_MaterialDocumentHeader.
const BATCH_CHARC_VALUE_PATH = '/BatchCharcValue';

// Bin Location characteristic — see BIN_CHARACTERISTIC in
// frontend/src/constants/batchClass.js, assigned during Putaway.
const BIN_CHARC_INTERNAL_ID = '3942';

function escapeODataKey(value) {
  return String(value ?? '').replace(/'/g, "''");
}

// BatchCharcValue's real key — confirmed against SAP's own error when the key predicate
// guessed CharcValueDependency instead: "Expected name(s): Material,
// BatchIdentifyingPlant, Batch, CharcInternalID, CharcValuePositionNumber".
// CharcValueDependency (sent in the POST create body — see buildCharcValueEntry() in
// frontend/src/api/batchClassApi.js) is a different field entirely and isn't part of
// the key. entry doesn't carry CharcValuePositionNumber at all, so it defaults to "1"
// here — every characteristic this app assigns is single-value, so there's only ever
// one position.
function buildEntityKeyUrl(entityUrl, entry) {
  const keyParts = [
    `Material='${escapeODataKey(entry.Material)}'`,
    `BatchIdentifyingPlant='${escapeODataKey(entry.BatchIdentifyingPlant || '')}'`,
    `Batch='${escapeODataKey(entry.Batch)}'`,
    `CharcInternalID='${escapeODataKey(entry.CharcInternalID)}'`,
    `CharcValuePositionNumber='${escapeODataKey(entry.CharcValuePositionNumber || '1')}'`,
  ].join(',');
  return `${entityUrl}(${keyParts})`;
}

// PATCH/MERGE only wants the changed property — sending the key fields (or
// CharcValueDependency, which isn't a real field on this entity at all, see
// buildEntityKeyUrl above) back in the body isn't needed since the key is already in
// the URL. Only one of these three value fields is ever set per entry (see
// buildCharcValueField() in frontend/src/api/batchClassApi.js).
function buildPatchBody(entry) {
  const body = {};
  if (entry.CharcValue !== undefined) body.CharcValue = entry.CharcValue;
  if (entry.CharcFromDate !== undefined) body.CharcFromDate = entry.CharcFromDate;
  if (entry.CharcFromNumericValue !== undefined) body.CharcFromNumericValue = entry.CharcFromNumericValue;
  return body;
}

// SAP rejects a second create on a single-value characteristic (e.g. Z_1300_BIN,
// used for Bin — BIN_CHARACTERISTIC) with NGC_API_BASE/028 "A value is already set
// for single value characteristic ...". That's not a real failure, just a signal to
// update instead of create — see the PATCH retry in /assign-values below.
function isAlreadySetError(responseData) {
  const sapCode = responseData?.error?.code;
  const sapMessage = responseData?.error?.message;
  const sapErrorText = typeof sapMessage === 'string' ? sapMessage : sapMessage?.value;
  return sapCode === 'NGC_API_BASE/028' || /already set for single value characteristic/i.test(sapErrorText || '');
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

// Assigns every batch characteristic value in `entries` via API_BATCH_SRV/BatchCharcValue,
// in one request from the frontend (see postBatchCharacteristics() in
// frontend/src/api/batchClassApi.js) — GoodReceipt2Page used to call an endpoint like
// this once per characteristic (7 characteristics x N batches = many sequential HTTP
// round trips from the browser); now it sends every characteristic for one Batch
// together, and this route fans them out into individual SAP calls SEQUENTIALLY.
//
// Sequential, not concurrent, is not optional here: SAP enqueue-locks a batch's
// classification object (class Z_1300_BATCH) for the duration of each BatchCharcValue
// write. Firing them concurrently made calls 2-7 fail with "class ... locked by user
// <the same user>" (CL/518) — the lock is held per in-flight change, not shared across
// simultaneous requests even from the same user/session, so overlapping writes to the
// same Batch's classification always collide. This still cuts the browser down to one
// HTTP call per batch; it just can't also parallelize the SAP-side writes.
//
// The CSRF token is fetched once and reused across all of them (SAP Gateway CSRF
// tokens are valid for the whole session, not per-request). Each entry is independent
// — one failing doesn't roll back the others — so the response reports a per-entry
// success/failure list rather than being all-or-nothing.
//
// Each entry is first tried as a create (POST). Single-value characteristics (e.g.
// Z_1300_BIN/Bin — see PutawayPage.js re-putting away an already-binned Batch) reject
// a second create with NGC_API_BASE/028 "A value is already set..."; that specific
// error is caught (isAlreadySetError) and retried as an update (PATCH against the
// existing entity instance — buildEntityKeyUrl) instead of being reported as a failure.
router.post('/assign-values', async (req, res) => {
  try {
    const { entries } = req.body || {};
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'entries (a non-empty array of BatchCharcValue payloads) is required'
      });
    }
    const missingKeyEntry = entries.find((entry) => !entry?.Material || !entry?.Batch || !entry?.CharcInternalID);
    if (missingKeyEntry) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Every entry requires Material, Batch, and CharcInternalID'
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
    const entityUrl = `${baseUrl}${BATCH_CHARC_VALUE_PATH}`;

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
    } catch (csrfError) {
      console.log('Batch Characteristic Value (bulk) CSRF token fetch failed, trying without CSRF:', csrfError.message);
    }

    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    if (cookies) headers['Cookie'] = cookies;

    console.log(`[${environment.toUpperCase()}] Batch Characteristic Value bulk POST URL:`, entityUrl, `(${entries.length} entries)`);
    console.log('Batch Characteristic Value bulk payload:', JSON.stringify(entries, null, 2));

    const results = [];
    for (const entry of entries) {
      try {
        let response = await axiosInstance.post(entityUrl, entry, {
          auth: { username, password },
          headers,
          validateStatus: () => true
        });

        let updated = false;
        if (response.status >= 400 && isAlreadySetError(response.data)) {
          updated = true;

          // Guessing CharcValuePositionNumber='1' for the key failed (NGC_RAP/016
          // "Characteristic value at position 001 does not exist") — the existing
          // record's real position isn't necessarily 1, so look it up via $filter
          // instead of assuming. Each OData V2 result also carries its own ETag in
          // __metadata.etag, which the PATCH needs as If-Match (CDS~A_BATCHCHARCVALUE
          // requires optimistic-concurrency — SADL_ENTITY_RUNTIME/004 otherwise).
          let existing;
          try {
            const filter = `Material eq '${entry.Material}' and Batch eq '${entry.Batch}' and CharcInternalID eq '${entry.CharcInternalID}'`;
            const lookupUrl = `${entityUrl}?$filter=${encodeURIComponent(filter)}`;
            const lookupResponse = await axiosInstance.get(lookupUrl, {
              auth: { username, password },
              headers: { ...headers, Accept: 'application/json' },
              validateStatus: () => true
            });
            existing = (lookupResponse.data?.d?.results || lookupResponse.data?.value || [])[0];
            console.log(`[${environment.toUpperCase()}] Existing Batch Characteristic Value:`, JSON.stringify(existing));
          } catch (lookupError) {
            console.log('Batch Characteristic Value existing-record lookup failed:', lookupError.message);
          }

          if (!existing) {
            results.push({
              success: false,
              charcInternalId: entry.CharcInternalID,
              message: 'A value is already set, but the existing Batch Characteristic Value record could not be found to update it.'
            });
            continue;
          }

          const keyUrl = buildEntityKeyUrl(entityUrl, { ...entry, CharcValuePositionNumber: existing.CharcValuePositionNumber });
          const patchHeaders = { ...headers, 'If-Match': existing.__metadata?.etag || '*' };
          const patchBody = buildPatchBody(entry);
          console.log(`[${environment.toUpperCase()}] Batch Characteristic Value already set — retrying as PATCH:`, keyUrl);
          console.log(`[${environment.toUpperCase()}] Batch Characteristic Value PATCH headers:`, JSON.stringify(patchHeaders));
          console.log(`[${environment.toUpperCase()}] Batch Characteristic Value PATCH body:`, JSON.stringify(patchBody));

          response = await axiosInstance.patch(keyUrl, patchBody, {
            auth: { username, password },
            headers: patchHeaders,
            validateStatus: () => true
          });
        }

        if (response.status >= 400) {
          const sapMessage = response.data?.error?.message;
          const sapErrorText = typeof sapMessage === 'string' ? sapMessage : sapMessage?.value;
          results.push({
            success: false,
            charcInternalId: entry.CharcInternalID,
            message: sapErrorText || `SAP returned ${response.status}`,
            details: response.data
          });
          continue;
        }
        results.push({ success: true, charcInternalId: entry.CharcInternalID, updated, raw: response.data });
      } catch (entryError) {
        results.push({ success: false, charcInternalId: entry.CharcInternalID, message: entryError.message });
      }
    }

    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');

    return res.status(200).json({ success: results.every((r) => r.success), results });

  } catch (error) {
    console.error('Batch Characteristic Value (bulk) error:', error.response?.data || error.message);
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

router.options('/assign-values', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');
  res.status(200).send();
});

// Looks up the Bin Location characteristic value (CharcInternalID 3942) for every
// Batch of a Material via API_BATCH_SRV/BatchCharcValue — used by Issuance step 3
// (frontend/src/pages/IssuancePage2.js) to sort/display batches by Bin instead of by
// Batch number. Filtering by Material + CharcInternalID only (no Batch) returns every
// batch's Bin in one call; the frontend matches them back to its batch stock list by
// Batch number (see fetchBinsByMaterial in frontend/src/api/batchClassApi.js).
router.get('/bin-lookup', async (req, res) => {
  try {
    const { material } = req.query;
    if (!material) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'material is required'
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
    const filter = `Material eq '${material}' and CharcInternalID eq '${BIN_CHARC_INTERNAL_ID}'`;
    const url = `${baseUrl}${BATCH_CHARC_VALUE_PATH}?$filter=${encodeURIComponent(filter)}`;

    console.log(`[${environment.toUpperCase()}] Bin characteristic lookup URL:`, url);

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
    console.error('Bin characteristic lookup error:', error.response?.data || error.message);
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

router.options('/bin-lookup', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');
  res.status(200).send();
});

// Looks up one characteristic's value for one specific Batch via
// API_BATCH_SRV/BatchCharcValue (same entity as /bin-lookup above, just filtered down
// to a single Batch instead of every Batch of a Material) — used by Label Printing to
// read back the Expiration Date (CharcInternalID 3932, see
// frontend/src/constants/batchClass.js) assigned during Goods Receipt.
router.get('/charc-value-lookup', async (req, res) => {
  try {
    const { material, batch, charcId } = req.query;
    if (!material || !batch || !charcId) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'material, batch, and charcId are required'
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
    const filter = `Material eq '${material}' and Batch eq '${batch}' and CharcInternalID eq '${charcId}'`;
    const url = `${baseUrl}${BATCH_CHARC_VALUE_PATH}?$filter=${encodeURIComponent(filter)}`;

    console.log(`[${environment.toUpperCase()}] Characteristic Value lookup URL:`, url);

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
    console.error('Characteristic Value lookup error:', error.response?.data || error.message);
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

router.options('/charc-value-lookup', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Auth, X-User-Environment');
  res.status(200).send();
});

module.exports = router;
