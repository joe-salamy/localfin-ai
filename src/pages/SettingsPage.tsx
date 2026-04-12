import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

export function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>

      <Card>
        <CardHeader className="mb-2">
          <CardTitle>Manage Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-2">
            Add, edit, or delete accounts and set initial balances.
          </p>
          <Link
            to="/setup"
            className="text-sm font-medium text-blue-400 hover:text-blue-300 underline"
          >
            Go to Setup page
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="mb-2">
          <CardTitle>Manage Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-2">
            Add, edit, or delete categories and subcategories. Set spending goals.
          </p>
          <Link
            to="/setup"
            className="text-sm font-medium text-blue-400 hover:text-blue-300 underline"
          >
            Go to Setup page
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="mb-2">
          <CardTitle>API Key (OpenRouter)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The OpenRouter API key is configured via the <code className="bg-secondary px-1 py-0.5 rounded text-xs font-mono">OPENROUTER_API_KEY</code> environment variable in your <code className="bg-secondary px-1 py-0.5 rounded text-xs font-mono">.env</code> file in the project root.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            To update it, edit <code className="bg-secondary px-1 py-0.5 rounded text-xs font-mono">.env</code> and restart the server.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
