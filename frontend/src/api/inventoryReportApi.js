import axios from "axios";
import { apiEndpoints } from "../config/servers";
import { INVENTORY_REPORT_PLANT } from "../constants/inventoryReport";

/** Only used when REACT_APP_INVENTORY_REPORT_MOCK=true */
export function getMockInventoryReport(materialNumber, sloc) {
  return {
    materialNumber: materialNumber.trim().toUpperCase(),
    plant: INVENTORY_REPORT_PLANT,
    sloc: sloc.trim().toUpperCase(),

    unrestrictedQuantity: 250,
    qualityQuantity: 40,
    reservedQuantity: 15,

    transferSloc: "SF03",
  };
}

const useClientMock =
  process.env.REACT_APP_INVENTORY_REPORT_MOCK === "true";

function getApiBaseUrl(environment) {
  return apiEndpoints[environment] || apiEndpoints.dev;
}

export async function fetchInventoryReport(
  materialNumber,
  sloc,
  creds
) {
  if (useClientMock) {
    await new Promise((resolve) => setTimeout(resolve, 400));

    return getMockInventoryReport(
      materialNumber,
      sloc
    );
  }

  const normalizedEnvironment =
    creds.environment === "300" ||
    creds.environment === "prd"
      ? "prd"
      : "dev";

  const baseUrl = getApiBaseUrl(
    normalizedEnvironment
  );

  const response = await axios.post(
    `${baseUrl}/api/inventory-report`,
    {
      username: creds.username,
      password: creds.password,

      environment: normalizedEnvironment,

      materialNumber:
        materialNumber.trim(),

      sloc: sloc.trim(),
    },
    {
      headers: {
        "Content-Type": "application/json",
      },

      timeout: 60000,
    }
  );

  return response.data;
}

export const isInventoryReportMockEnabled =
  useClientMock;
