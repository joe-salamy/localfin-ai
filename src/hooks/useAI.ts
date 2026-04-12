import { useMutation } from '@tanstack/react-query';
import { apiPost } from '@/lib/api';

interface CategorizeTransaction {
  name: string;
  account_id: string;
  account_name: string;
  amount: number;
}

interface CategorizeResult {
  transaction_name: string;
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
  confidence: number;
  source: 'correction' | 'lookup' | 'ai' | 'none';
}

interface SaveCorrectionData {
  transaction_name: string;
  account_id: string;
  ai_suggested_subcategory_id?: string | null;
  user_corrected_subcategory_id: string;
}

export function useAI() {
  const categorize = useMutation({
    mutationFn: (transactions: CategorizeTransaction[]) =>
      apiPost<CategorizeResult[]>('/ai/categorize', { transactions }),
  });

  const saveCorrection = useMutation({
    mutationFn: (data: SaveCorrectionData) =>
      apiPost('/ai/corrections', data),
  });

  return {
    categorize,
    saveCorrection,
  };
}
