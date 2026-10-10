import { api } from "../../../api";
import type { Category } from "../../../types";

export type CategoryInput = Pick<Category, "name" | "sort"> & { image?: string; hidden?: boolean };

/** Category module interface. The root request adapter remains internal during migration. */
export const categoryApi = {
  list: () => api.adminCategories(),
  create: (input: CategoryInput) => api.adminCreateCategory(input),
  update: (id: string, input: Partial<CategoryInput>) => api.adminUpdateCategory(id, input),
  remove: (id: string) => api.adminDeleteCategory(id),
};
