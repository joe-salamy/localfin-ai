import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateFinanceQueries } from "@/lib/queryInvalidation";
import type { CreateTagData, Tag } from "@shared/contracts"

export function useTags() {
  const queryClient = useQueryClient();

  const tagsQuery = useQuery({
    queryKey: queryKeys.tags.list(),
    queryFn: () => apiGet<Tag[]>("/tags"),
    select: (res) => res.data ?? [],
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const invalidateRelated = () => invalidateFinanceQueries(queryClient, "tags");

  const createTag = useMutation({
    mutationFn: (data: CreateTagData) => apiPost<Tag>("/tags", data),
    onSuccess: () => invalidateRelated(),
  });

  const updateTag = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<CreateTagData>) =>
      apiPut<Tag>(`/tags/${id}`, data),
    onSuccess: () => invalidateRelated(),
  });

  const deleteTag = useMutation({
    mutationFn: (id: string) => apiDelete(`/tags/${id}`),
    onSuccess: () => invalidateRelated(),
  });

  const restoreTag = useMutation({
    mutationFn: (id: string) => apiPost<Tag>(`/tags/${id}/restore`, {}),
    onSuccess: () => invalidateRelated(),
  });

  return {
    tags: tagsQuery.data ?? [],
    isLoading: tagsQuery.isLoading,
    createTag,
    updateTag,
    deleteTag,
    restoreTag,
  };
}
