import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';
import { SetupPage } from '@/pages/SetupPage';
import { TransactionInputPage } from '@/pages/TransactionInputPage';
import { TransactionHistoryPage } from '@/pages/TransactionHistoryPage';
import { SettingsPage } from '@/pages/SettingsPage';

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/setup', element: <SetupPage /> },
      { path: '/transactions/input', element: <TransactionInputPage /> },
      { path: '/transactions/history', element: <TransactionHistoryPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
]);

export function Router() {
  return <RouterProvider router={router} />;
}
