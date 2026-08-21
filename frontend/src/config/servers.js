export const servers = [
  { label: "Development", value: "dev" },
  { label: "Production", value: "prd" },
];

export const apiEndpoints = {
  dev: 'https://sap-app-dic.cfapps.eu10-004.hana.ondemand.com',
  dev2: 'https://sap-app-dic.cfapps.eu10-004.hana.ondemand.com',
  prd: 'https://sap-app-dic.cfapps-dic.eu10-004.hana.ondemand.com'
};

export const localBackendUrl = process.env.REACT_APP_API_URL ?? apiEndpoints.dev;

export function getBackendBaseUrl(environment) {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return localBackendUrl;
    }
  }
  return apiEndpoints[environment] || apiEndpoints.dev;
}