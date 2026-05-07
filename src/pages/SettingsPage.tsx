import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Search, Trash2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { CommandId, ShortcutBinding } from '@/features/shortcuts/commands';
import { ShortcutHint } from '@/features/shortcuts/ShortcutHint';
import { useShortcut, useShortcutScope, useShortcuts } from '@/features/shortcuts/hooks';
import { displayShortcut, isSingleCharacterShortcut, normalizeKeyboardEvent, validateShortcut } from '@/features/shortcuts/normalize';

export function SettingsPage() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const {
    commands,
    getShortcut,
    setShortcut,
    resetShortcut,
    resetAllShortcuts,
    getConflicts,
    disableSingleKeyShortcuts,
    setDisableSingleKeyShortcuts,
  } = useShortcuts();

  const [query, setQuery] = useState('');
  const [selectedCommandId, setSelectedCommandId] = useState<CommandId>('global.dashboard');
  const [capturingCommandId, setCapturingCommandId] = useState<CommandId | null>(null);
  const [message, setMessage] = useState('');

  useShortcutScope('settings');
  useShortcutScope('settingsShortcuts');

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;

    return commands.filter((command) => {
      const binding = getShortcut(command.id);
      return [
        command.label,
        command.description,
        command.category,
        command.scope,
        displayShortcut(binding),
      ].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [commands, getShortcut, query]);

  const selectedCommand = commands.find((command) => command.id === selectedCommandId) ?? commands[0];

  const focusSection = useCallback(() => {
    sectionRef.current?.focus();
    sectionRef.current?.scrollIntoView({ block: 'start' });
  }, []);

  useEffect(() => {
    if (window.location.hash === '#keyboard-shortcuts') {
      window.setTimeout(focusSection, 0);
    }
  }, [focusSection]);

  const clearSelected = useCallback(() => {
    if (!selectedCommand) return;
    setShortcut(selectedCommand.id, null);
    setMessage(`${selectedCommand.label} cleared.`);
  }, [selectedCommand, setShortcut]);

  const resetSelected = useCallback(() => {
    if (!selectedCommand) return;
    resetShortcut(selectedCommand.id);
    setMessage(`${selectedCommand.label} reset to default.`);
  }, [resetShortcut, selectedCommand]);

  useShortcut('settings.focusShortcuts', focusSection);
  useShortcut('settings.focusShortcutSearch', useCallback(() => searchRef.current?.focus(), []));
  useShortcut('settings.editSelectedShortcut', useCallback(() => {
    if (selectedCommand) setCapturingCommandId(selectedCommand.id);
  }, [selectedCommand]));
  useShortcut('settings.clearSelectedShortcut', clearSelected, { enabled: Boolean(selectedCommand) });
  useShortcut('settings.resetSelectedShortcut', resetSelected, { enabled: Boolean(selectedCommand) });
  useShortcut('settings.resetAllShortcuts', useCallback(() => {
    resetAllShortcuts();
    setMessage('All shortcuts reset to defaults.');
  }, [resetAllShortcuts]));

  const commitCapturedShortcut = (commandId: CommandId, binding: ShortcutBinding | null) => {
    const command = commands.find((item) => item.id === commandId);
    if (!command) return;

    const validation = validateShortcut(binding, command.scope);
    if (!validation.ok) {
      setMessage(validation.message ?? 'Shortcut is not valid.');
      return;
    }

    const conflicts = getConflicts(commandId, binding);
    if (conflicts.length > 0) {
      setMessage(`${displayShortcut(binding)} already belongs to ${conflicts.map((conflict) => conflict.command.label).join(', ')}.`);
      return;
    }

    setShortcut(commandId, binding);
    setCapturingCommandId(null);
    setMessage(`${command.label} set to ${displayShortcut(binding)}.`);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>

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

      <Card>
        <CardHeader className="mb-2">
          <CardTitle>
            Keyboard Shortcuts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            id="keyboard-shortcuts"
            ref={sectionRef}
            tabIndex={-1}
            className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="sr-only" aria-live="polite">
            Keyboard shortcuts settings focused.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-72 flex-1">
              <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search commands, scopes, or keys"
                className="pl-8"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={disableSingleKeyShortcuts}
                onChange={(event) => setDisableSingleKeyShortcuts(event.target.checked)}
                className="h-4 w-4 rounded border-border bg-background"
              />
              Disable single-key shortcuts
            </label>
            <Button type="button" variant="secondary" onClick={resetAllShortcuts}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reset All
              <ShortcutHint commandId="settings.resetAllShortcuts" />
            </Button>
          </div>

          {message && (
            <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground" aria-live="polite">
              {message}
            </p>
          )}

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Command</th>
                  <th className="px-3 py-2 font-medium">Scope</th>
                  <th className="px-3 py-2 font-medium">Default</th>
                  <th className="px-3 py-2 font-medium">Current</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredCommands.map((command) => {
                  const current = getShortcut(command.id);
                  const conflicts = getConflicts(command.id, current);
                  const isCapturing = capturingCommandId === command.id;

                  return (
                    <tr
                      key={command.id}
                      tabIndex={0}
                      onFocus={() => setSelectedCommandId(command.id)}
                      className={`outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring ${
                        selectedCommandId === command.id ? 'bg-secondary/20' : ''
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{command.label}</div>
                        <div className="max-w-md text-xs text-muted-foreground">{command.description}</div>
                        {conflicts.length > 0 && (
                          <div className="mt-1 text-xs text-destructive">
                            Conflicts with {conflicts.map((conflict) => conflict.command.label).join(', ')}
                          </div>
                        )}
                        {current && isSingleCharacterShortcut(current) && (
                          <div className="mt-1 text-xs text-muted-foreground">Single-key scoped shortcut</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{command.category} / {command.scope}</td>
                      <td className="px-3 py-2 font-mono text-xs">{displayShortcut(command.defaultBinding)}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {isCapturing ? (
                          <button
                            type="button"
                            autoFocus
                            className="rounded border border-ring bg-input px-2 py-1 text-foreground"
                            onKeyDown={(event) => {
                              event.preventDefault();
                              if (event.key === 'Escape') {
                                setCapturingCommandId(null);
                                setMessage('Shortcut edit canceled.');
                                return;
                              }
                              commitCapturedShortcut(command.id, normalizeKeyboardEvent(event));
                            }}
                          >
                            Press keys...
                          </button>
                        ) : (
                          displayShortcut(current)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setSelectedCommandId(command.id);
                              setCapturingCommandId(command.id);
                              setMessage(`Editing ${command.label}. Press Escape to cancel.`);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedCommandId(command.id);
                              setShortcut(command.id, null);
                              setMessage(`${command.label} cleared.`);
                            }}
                            aria-label={`Clear ${command.label}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedCommandId(command.id);
                              resetShortcut(command.id);
                              setMessage(`${command.label} reset to default.`);
                            }}
                            aria-label={`Reset ${command.label}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
