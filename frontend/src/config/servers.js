export const servers = [
  { label: "Development", value: "dev" },
  { label: "Production", value: "prd" },
];

export const apiEndpoints = {
  dev: 'https://sap-app.cfapps.eu10-004.hana.ondemand.com',
  dev2: 'https://sap-app.cfapps.eu10-004.hana.ondemand.com',
  prd: 'https://sap-app.cfapps.eu10-004.hana.ondemand.com'
};

export const localBackendUrl = 'http://localhost:5000';

export function getBackendBaseUrl(environment) {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return '';
    }
  }
  return apiEndpoints[environment] || apiEndpoints.dev;
}