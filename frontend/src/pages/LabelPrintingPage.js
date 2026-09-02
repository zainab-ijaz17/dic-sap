import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import LoadingButton from "../components/LoadingButton";
import BarcodeInput from "../components/BarcodeInput";
import BarcodeDisplay from "../components/BarcodeDisplay";
import { fetchPurchaseOrder, fetchMaterialDocumentItems } from "../api/goodsReceiptApi";
import { splitMaterialDescription } from "../utils/materialDescription";
import { buildLabelsPdfBlobUrl } from "../utils/labelsPdf";

function normalizeKey(value) {
  return String(value ?? "").trim();
}

function normalizeMaterial(value) {
  return String(value || "").trim().replace(/^0+(?=\d)/, "");
}

// Heading on one line, value on the next — used for every field in the label's grid
// below instead of "Heading: value" on a single line.
function LabelField({ heading, value }) {
  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{heading}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

// Label Printing — enter a Material Document Number (+ Year), fetch every line SAP
// posted against it via API_MATERIAL_DOCUMENT_SRV (fetchMaterialDocumentItems,
// ../api/goodsReceiptApi.js — the same call GoodReceipt2Page.js already relies on to
// find the Batch(es) it just created), and build one label per distinct Batch found.
// One PO line item commonly posts as several such lines, one per pallet, with SAP
// assigning either a shared Batch across all of them or a separate Batch per line
// depending on batch determination config — so a 10-pallet receipt typically means 10
// Batches, i.e. 10 labels here.
//
// A_MaterialDocumentItem has no Material Description field at all, so it's fetched
// once per distinct Purchase Order/Item via the PO Fact Sheet (fetchPurchaseOrder,
// already confirmed working via GoodReceiptPage.js) and reused across every Batch
// that shares it, rather than once per Batch.
//
// Reachable either by entering a Material Document Number directly, or via the
// "Print Label" button on GoodReceipt2Page.js's post-success popup, which routes here
// with { materialDocNumber, materialDocYear } already known.
function LabelPrintingPage({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [materialDocNumber, setMaterialDocNumber] = useState(location.state?.materialDocNumber || "");
  const [materialDocYear, setMaterialDocYear] = useState(
    location.state?.materialDocYear || String(new Date().getFullYear())
  );
  const [labels, setLabels] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [error, setError] = useState("");

  const fetchLabels = async (docNumber, docYear) => {
    const trimmedDocNumber = docNumber.trim();
    const trimmedDocYear = docYear.trim();
    if (!trimmedDocNumber || !trimmedDocYear) {
      setError("Please enter both Material Document Number and Year.");
      return;
    }

    setError("");
    setLoading(true);
    setLabels([]);
    try {
      const rawItems = await fetchMaterialDocumentItems(trimmedDocNumber, trimmedDocYear);
      const batchItems = rawItems.filter((item) => normalizeKey(item.Batch));
      if (batchItems.length === 0) {
        throw new Error(`No Batch was found on Material Document ${trimmedDocNumber}/${trimmedDocYear}.`);
      }

      // Pallet Qty groups every line by PurchaseOrderItem across the WHOLE document,
      // regardless of which Batch it ended up under — mirrors how GoodReceipt2Page
      // posts one PO line item as several pallet-lines (buildMaterialDocumentPayload,
      // ../api/goodsReceiptApi.js). Falls back to grouping by Material when
      // PurchaseOrderItem isn't present on the returned doc items.
      const palletQtyByKey = new Map();
      batchItems.forEach((item) => {
        const key = normalizeKey(item.PurchaseOrderItem) || `material:${normalizeMaterial(item.Material)}`;
        const qty = Number(item.QuantityInEntryUnit ?? item.QuantityInBaseUnit ?? 0);
        palletQtyByKey.set(key, (palletQtyByKey.get(key) || 0) + qty);
      });

      // Group lines by Batch — each distinct Batch becomes its own label. A Batch can
      // span more than one line (shared-Batch-across-pallets config), so its own Qty
      // sums every line under it rather than assuming exactly one line per Batch.
      const itemsByBatch = new Map();
      batchItems.forEach((item) => {
        const batch = normalizeKey(item.Batch);
        if (!itemsByBatch.has(batch)) itemsByBatch.set(batch, []);
        itemsByBatch.get(batch).push(item);
      });

      const descriptionByPoItem = new Map();
      const builtLabels = [];
      for (const [batch, group] of itemsByBatch) {
        const first = group[0];
        const material = String(first.Material ?? "").trim();
        const purchaseOrder = String(first.PurchaseOrder ?? "").trim();
        const purchaseOrderItem = String(first.PurchaseOrderItem ?? "").trim();
        const plant = String(first.Plant ?? "").trim();
        const storageLocation = String(first.StorageLocation ?? "").trim();
        const uom = String(first.EntryUnit || first.MaterialBaseUnit || "").trim();
        const quantity = group.reduce((sum, d) => sum + Number(d.QuantityInEntryUnit ?? d.QuantityInBaseUnit ?? 0), 0);

        const palletKey = normalizeKey(purchaseOrderItem) || `material:${normalizeMaterial(material)}`;
        const palletQuantity = palletQtyByKey.get(palletKey) ?? null;

        let materialDescription = "";
        if (purchaseOrder && purchaseOrderItem) {
          const poKey = `${purchaseOrder}|${purchaseOrderItem}`;
          if (!descriptionByPoItem.has(poKey)) {
            try {
              const po = await fetchPurchaseOrder(purchaseOrder, purchaseOrderItem);
              descriptionByPoItem.set(poKey, po.lineItems[0]?.materialDescription || "");
            } catch (err) {
              descriptionByPoItem.set(poKey, "");
              // eslint-disable-next-line no-console
              console.debug("Purchase Order Fact Sheet description lookup failed for", poKey, err.message);
            }
          }
          materialDescription = descriptionByPoItem.get(poKey);
        }

        builtLabels.push({
          materialNumber: material,
          materialDescription,
          batch,
          quantity,
          uom,
          palletQuantity,
          purchaseOrder,
          purchaseOrderItem,
          materialDocument: trimmedDocNumber,
          location: plant && storageLocation ? `${plant}/${storageLocation}` : (plant || storageLocation || ""),
        });
      }

      setLabels(builtLabels);
      setActiveIndex(0);
    } catch (err) {
      setError(err.message || "Failed to fetch labels.");
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch when routed here from GoodReceipt2Page's "Print Label" button with the
  // Material Document already known.
  useEffect(() => {
    if (location.state?.materialDocNumber && location.state?.materialDocYear) {
      fetchLabels(location.state.materialDocNumber, location.state.materialDocYear);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revokes whatever blob: URL is current on unmount (e.g. navigating away via Back
  // while the preview is still open) — handlePreviewPdf/closePdfPreview below already
  // revoke on every other path (replacing or explicitly closing the preview). Reads
  // through a ref rather than closing over pdfPreviewUrl, since a state update in an
  // unmount cleanup accomplishes nothing (the component is already gone).
  const pdfPreviewUrlRef = useRef(null);
  pdfPreviewUrlRef.current = pdfPreviewUrl;
  useEffect(() => {
    return () => {
      if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
    };
  }, []);

  const handleFetch = () => fetchLabels(materialDocNumber, materialDocYear);

  // Builds one PDF with every label side by side (buildLabelsPdfBlobUrl,
  // ../utils/labelsPdf.js) and previews it in-app via an <iframe> — the browser's own
  // PDF viewer supplies print/download from there, so there's no separate physical-
  // printer round trip (or per-label print state) to track anymore.
  const handlePreviewPdf = () => {
    setError("");
    setGeneratingPdf(true);
    try {
      setPdfPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return buildLabelsPdfBlobUrl(labels);
      });
    } catch (err) {
      setError(err.message || "Failed to generate the PDF preview.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  const closePdfPreview = () => {
    setPdfPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const handleReset = () => {
    setLabels([]);
    setMaterialDocNumber("");
    setMaterialDocYear(String(new Date().getFullYear()));
    setError("");
  };

  const busy = loading || generatingPdf;
  const activeLabel = labels[activeIndex];

  return (
    <div className="app-container">
      <PageHeader user={user} onLogout={onLogout} />

      <div style={{ maxWidth: "500px", margin: "20px auto", padding: "1rem" }}>
        <div style={{ background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
          <h2 style={{ marginTop: 0 }}>Label Printing</h2>

          {error && <div className="error">{error}</div>}

          {labels.length === 0 && (
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <div className="form-group" style={{ flex: "2 1 0%" }}>
                <label>Material Document Number</label>
                <BarcodeInput
                  value={materialDocNumber}
                  onChange={setMaterialDocNumber}
                  onComplete={() => handleFetch()}
                  placeholder="Scan or enter Material Document"
                  disabled={loading}
                />
              </div>
              <div className="form-group" style={{ flex: "1 1 0%" }}>
                <label>Year</label>
                <input
                  className="form-control"
                  value={materialDocYear}
                  onChange={(e) => setMaterialDocYear(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFetch()}
                  placeholder="YYYY"
                  maxLength={4}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          {labels.length === 0 && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: "0.75rem" }}>
              <LoadingButton onClick={handleFetch} loading={loading}>Fetch</LoadingButton>
            </div>
          )}

          {loading && labels.length === 0 && (
            <div style={{ marginTop: "0.75rem", color: "#6b7280", fontSize: "0.85rem", textAlign: "center" }}>
              Looking up Material Document…
            </div>
          )}

          {labels.length > 0 && activeLabel && (() => {
            const { short: descShort, rest: descRest } = splitMaterialDescription(activeLabel.materialDescription);
            return (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                  <LoadingButton
                    onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                    variant="neutral"
                    disabled={activeIndex === 0 || busy}
                    style={{ padding: "0.6rem 1rem", fontSize: "1.2rem", borderRadius: "999px" }}
                  >
                    ←
                  </LoadingButton>
                  <div style={{ fontSize: "0.9rem", color: "#374151" }}>
                    Label {activeIndex + 1} of {labels.length}
                  </div>
                  <LoadingButton
                    onClick={() => setActiveIndex((i) => Math.min(labels.length - 1, i + 1))}
                    variant="neutral"
                    disabled={activeIndex === labels.length - 1 || busy}
                    style={{ padding: "0.6rem 1rem", fontSize: "1.2rem", borderRadius: "999px" }}
                  >
                    →
                  </LoadingButton>
                </div>

                <div style={{ border: "2px dashed #9ca3af", borderRadius: "10px", padding: "1.25rem", background: "#fafafa" }}>
                  <div style={{ margin: "0 0 0.5rem", textAlign: "center" }}>
                    <BarcodeDisplay value={activeLabel.batch} displayValue={false} />
                  </div>
                  <div style={{ textAlign: "center", fontSize: "2rem", fontWeight: 800, letterSpacing: "1px" }}>
                    {descShort}
                  </div>
                  <div style={{ textAlign: "center", color: "#374151", marginBottom: "0.75rem" }}>
                    {descRest}
                  </div>
                  <div style={{ borderTop: "1px solid #d1d5db", margin: "0.75rem 0" }} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: "0.75rem", columnGap: "1rem", fontSize: "0.95rem" }}>
                    <LabelField heading="Pur. Doc." value={activeLabel.purchaseOrder || "-"} />
                    <LabelField heading="Pur. Item" value={activeLabel.purchaseOrderItem || "-"} />
                    <LabelField heading="Material" value={activeLabel.materialNumber} />
                    <LabelField heading="Batch" value={activeLabel.batch} />
                    <LabelField heading="Mat. Doc." value={activeLabel.materialDocument || "-"} />
                    <LabelField heading="Location" value={activeLabel.location || "-"} />
                    <LabelField heading="Qty" value={`${activeLabel.quantity} ${activeLabel.uom}`} />
                    <LabelField
                      heading="Pallet Qty"
                      value={activeLabel.palletQuantity != null ? `${activeLabel.palletQuantity} ${activeLabel.uom}` : "-"}
                    />
                  </div>
                </div>

                <div style={{ marginTop: "0.75rem" }}>
                  <LoadingButton onClick={handleReset} disabled={busy} variant="neutral">
                    New Material Document
                  </LoadingButton>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "20px", left: "20px" }}>
        <LoadingButton onClick={() => navigate("/main")} variant="neutral" disabled={busy}>
          Back
        </LoadingButton>
      </div>

      {labels.length > 0 && (
        <div style={{ position: "fixed", bottom: "20px", right: "20px" }}>
          <LoadingButton onClick={handlePreviewPdf} loading={generatingPdf} disabled={loading}>
            Print
          </LoadingButton>
        </div>
      )}

      {pdfPreviewUrl && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0.75rem 1rem", background: "#111827" }}>
            <LoadingButton onClick={closePdfPreview} variant="neutral">Close</LoadingButton>
          </div>
          <iframe
            src={pdfPreviewUrl}
            title="Labels PDF Preview"
            style={{ flex: 1, border: "none", background: "white" }}
          />
        </div>
      )}
    </div>
  );
}

export default LabelPrintingPage;
