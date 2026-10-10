import OrderListPage from "./orders/pages/OrderListPage.vue";
import PickingPage from "./picking/pages/PickingPage.vue";

export const fulfillmentViews = {
  orders: OrderListPage,
  "warehouse-orders": PickingPage,
};
