import { simulateDelay, randomFromSeed } from "./mockUtils";
import { DEFAULT_PLANT } from "../constants/warehouse";

const MOCK_MATERIALS = [
  { materialNumber: "MAT400111", materialDescription: "Finished Goods Carton", uom: "EA" },
  { materialNumber: "MAT400222", materialDescription: "Retail Pack - Assorted", uom: "EA" },
];

// TODO: Replace with a real material/HU lookup call for store returns.
export async function fetchStoreReturnItem(barcode) {
  await simulateDelay(700);

  const material = MOCK_MATERIALS[randomFromSeed(barcode, MOCK_MATERIALS.length)];
  return {
    huNumber: barcode,
    materialNumber: material.materialNumber,
    materialDescription: material.materialDescription,
    issuedQuantity: 5 + randomFromSeed(`${barcode}-qty`, 30),
    uom: material.uom,
    plant: DEFAULT_PLANT,
    storageLocation: "3PW1",
  };
}

// TODO: Replace with a real store-return posting call (e.g. MIGO 202/262 movement).
export async function postStoreReturn(itemInfo, returnQuantity, returnReason) {
  await simulateDelay(800);
  return { success: true, message: "Store Return Completed Successfully.", returnQuantity, returnReason };
}
