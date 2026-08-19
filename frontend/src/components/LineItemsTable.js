import React, { useState } from "react";
import LoadingButton from "./LoadingButton";

const FIELD_LABELS = {
  lineItem: "Line Item",
  materialNumber: "Material Number",
  materialDescription: "Material Description",
  quantity: "Quantity",
  uom: "UOM",
  plant: "Plant",
};

// Shared line-item table used on both Goods Receipt pages: renders Line Item /
// Material Number / Short Description / Quantity, and clicking a row opens a
// details popup with every field. onSelectLineItem (optional) fires on row click
// so the parent can decide what "selecting" a row means for that page.
// onRemoveLineItem (optional) adds a per-row Remove button — e.g. GoodReceiptPage.js
// uses it to drop one line item a user doesn't want to receive from a fetched
// Purchase Order while keeping the rest.
function LineItemsTable({ lineItems, selectedLineItem, onSelectLineItem, onRemoveLineItem }) {
  const [detailsItem, setDetailsItem] = useState(null);

  if (!lineItems || lineItems.length === 0) return null;

  const handleRowClick = (item) => {
    onSelectLineItem?.(item);
    setDetailsItem(item);
  };

  const handleRemoveClick = (e, item) => {
    e.stopPropagation();
    onRemoveLineItem(item);
  };

  return (
    <>
      <div style={{ overflowX: "auto", marginTop: "1rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Line Item</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Material Number</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Short Description</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Quantity</th>
              {onRemoveLineItem && <th style={{ padding: "0.5rem" }}></th>}
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item) => (
              <tr
                key={item.lineItem}
                onClick={() => handleRowClick(item)}
                style={{
                  cursor: "pointer",
                  background: selectedLineItem?.lineItem === item.lineItem ? "#e0f2fe" : "white",
                  borderBottom: "12px solid #f3f4f6",
                }}
              >
                <td style={{ padding: "0.5rem" }}>{item.lineItem}</td>
                <td style={{ padding: "0.5rem" }}>{item.materialNumber}</td>
                <td style={{ padding: "0.5rem" }}>{item.materialDescription}</td>
                <td style={{ padding: "0.5rem" }}>{item.quantity}</td>
                {onRemoveLineItem && (
                  <td style={{ padding: "0.5rem", textAlign: "right" }}>
                    <LoadingButton onClick={(e) => handleRemoveClick(e, item)} variant="danger">
                      Remove
                    </LoadingButton>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detailsItem && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 60 }}
          onClick={() => setDetailsItem(null)}
        >
          <div
            style={{ width: "100%", maxWidth: "620px", background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.25)", maxHeight: "80vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Line Item Details</h3>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {Object.entries(FIELD_LABELS).map(([key, label]) => (
                    <tr key={key} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "0.75rem", width: "45%", color: "#374151", fontWeight: 600, background: "#f9fafb" }}>
                        {label}
                      </td>
                      <td style={{ padding: "0.75rem", color: "#111827" }}>{String(detailsItem[key] ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <LoadingButton onClick={() => setDetailsItem(null)} variant="neutral">Close</LoadingButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default LineItemsTable;
