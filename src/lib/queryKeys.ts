export const queryKeys = {
  accounts: {
    all: ['accounts'] as const,
    list: () => [...queryKeys.accounts.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.accounts.all, 'detail', id] as const,
  },
  categories: {
    all: ['categories'] as const,
    list: () => [...queryKeys.categories.all, 'list'] as const,
  },
  subcategories: {
    all: ['subcategories'] as const,
    list: () => [...queryKeys.subcategories.all, 'list'] as const,
  },
  transactions: {
    all: ['transactions'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...queryKeys.transactions.all, 'list', filters] as const,
    detail: (id: string) =>
      [...queryKeys.transactions.all, 'detail', id] as const,
    recentActivity: () =>
      [...queryKeys.transactions.all, 'recent-activity'] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    accountSummary: (startDate: string, endDate: string) =>
      [...queryKeys.dashboard.all, 'account-summary', startDate, endDate] as const,
    categorySummary: (startDate: string, endDate: string) =>
      [...queryKeys.dashboard.all, 'category-summary', startDate, endDate] as const,
    metrics: (startDate: string, endDate: string) =>
      [...queryKeys.dashboard.all, 'metrics', startDate, endDate] as const,
    netWorthChart: (startDate: string, endDate: string) =>
      [...queryKeys.dashboard.all, 'charts', 'net-worth', startDate, endDate] as const,
    sankeyChart: (startDate: string, endDate: string) =>
      [...queryKeys.dashboard.all, 'charts', 'sankey', startDate, endDate] as const,
  },
} as const;
