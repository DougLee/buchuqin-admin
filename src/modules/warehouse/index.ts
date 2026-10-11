import InventoryTransactionPage from "./transactions/pages/InventoryTransactionPage.vue";
import InventoryPage from "./inventory/pages/InventoryPage.vue";
import LocationPage from "./locations/pages/LocationPage.vue";

export const warehouseViews = {
  inventory: InventoryPage,
  "inventory-txns": InventoryTransactionPage,
  locations: LocationPage,
};
