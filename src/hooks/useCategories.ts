import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type {
  Category,
  Subcategory,
  CreateCategoryData,
  CreateSubcategoryData,
} from '@/types/index';

export function useCategories() {
  const queryClient = useQueryClient();

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories.list(),
    queryFn: () => apiGet<Category[]>('/categories'),
    select: (res) => res.data ?? [],
  });

  const subcategoriesQuery = useQuery({
    queryKey: queryKeys.subcategories.list(),
    queryFn: () => apiGet<Subcategory[]>('/subcategories'),
    select: (res) => res.data ?? [],
  });

  const invalidateRelated = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.subcategories.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    ]);

  const createCategory = useMutation({
    mutationFn: (data: CreateCategoryData) =>
      apiPost<Category>('/categories', data),
    onSuccess: () => invalidateRelated(),
  });

  const updateCategory = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<CreateCategoryData>) =>
      apiPut<Category>(`/categories/${id}`, data),
    onSuccess: () => invalidateRelated(),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => apiDelete(`/categories/${id}`),
    onSuccess: () => invalidateRelated(),
  });

  const createSubcategory = useMutation({
    mutationFn: (data: CreateSubcategoryData) =>
      apiPost<Subcategory>('/subcategories', data),
    onSuccess: () => invalidateRelated(),
  });

  const updateSubcategory = useMutation({
    mutationFn: ({
      id,
      ...data
    }: { id: string } & Partial<CreateSubcategoryData>) =>
      apiPut<Subcategory>(`/subcategories/${id}`, data),
    onSuccess: () => invalidateRelated(),
  });

  const deleteSubcategory = useMutation({
    mutationFn: (id: string) => apiDelete(`/subcategories/${id}`),
    onSuccess: () => invalidateRelated(),
  });

  return {
    categories: categoriesQuery.data ?? [],
    subcategories: subcategoriesQuery.data ?? [],
    isLoading: categoriesQuery.isLoading || subcategoriesQuery.isLoading,
    createCategory,
    updateCategory,
    deleteCategory,
    createSubcategory,
    updateSubcategory,
    deleteSubcategory,
  };
}
