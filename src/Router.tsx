import {
  createBrowserRouter,
  isRouteErrorResponse,
  RouterProvider,
  useRouteError,
} from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';
import { SetupPage } from '@/pages/SetupPage';
import { TransactionInputPage } from '@/pages/TransactionInputPage';
import { TransactionHistoryPage } from '@/pages/TransactionHistoryPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { Button } from '@/components/ui/Button';

function RouteErrorFallback() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Something went wrong.';

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page hit an unexpected error. You can retry from here without leaving the app.
        </p>
        <pre className="mt-4 overflow-auto rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
          {message}
        </pre>
        <div className="mt-4 flex gap-2">
          <Button type="button" onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button type="button" variant="secondary" onClick={() => window.location.assign('/')}>
            Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <RouteErrorFallback />,
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
