import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { CreateTagData, Tag } from '@/types/index';

export function useTags() {
  const queryClient = useQueryClient();

  const tagsQuery = useQuery({
    queryKey: queryKeys.tags.list(),
    queryFn: () => apiGet<Tag[]>('/tags'),
    select: (res) => res.data ?? [],
    staleTime: Infinity,
  });

  const invalidateRelated = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tags.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    ]);

  const createTag = useMutation({
    mutationFn: (data: CreateTagData) => apiPost<Tag>('/tags', data),
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

  return {
    tags: tagsQuery.data ?? [],
    isLoading: tagsQuery.isLoading,
    createTag,
    updateTag,
    deleteTag,
  };
}
