import CategoryPage from "./categories/pages/CategoryPage.vue";
import PlatformProductsPage from "./products/pages/PlatformProductsPage.vue";
import OrgProductsPage from "./products/pages/OrgProductsPage.vue";
import OfficialProductsPage from "./products/pages/OfficialProductsPage.vue";
import CampusProductsPage from "./products/pages/CampusProductsPage.vue";

export const catalogViews = {
  categories: CategoryPage,
  "platform-products": PlatformProductsPage,
  "org-products": OrgProductsPage,
  "official-products": OfficialProductsPage,
  products: CampusProductsPage,
};
