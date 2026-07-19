import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RotateCcw, Save, Search, Trash2 } from "lucide-react";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { ColorPicker } from "@/components/ui/ColorPicker";
import type {
  CommandDefinition,
  CommandId,
  ShortcutBinding,
} from "@/features/shortcuts/commands";
import { ShortcutHint } from "@/features/shortcuts/ShortcutHint";
import {
  useShortcut,
  useShortcutScope,
  useShortcuts,
} from "@/features/shortcuts/hooks";
import {
  displayShortcut,
  displayShortcutList,
  isSingleCharacterShortcut,
  normalizeKeyboardEvent,
  shortcutBindingsMatch,
  validateShortcut,
} from "@/features/shortcuts/normalize";
import { useDisplaySettings } from "@/features/display-settings/hooks";
import { useAssistantSettings } from "@/features/assistant-settings/hooks";
import {
  MAX_MAX_ASSISTANT_TURNS,
  MIN_MAX_ASSISTANT_TURNS,
} from "@/features/assistant-settings/storage";
import { useFlaggedWords } from "@/features/flagged-words/hooks";
import {
  DEFAULT_FLAGGED_WORDS,
  normalizeFlaggedWords,
} from "@/features/flagged-words/storage";
import {
  useResizableColumns,
  type ResizableColumnDef,
} from "@/features/table-layout/useResizableColumns";
import { resetAllTableColumnWidths } from "@/features/table-layout/storage";

const SHORTCUT_COLUMNS: ResizableColumnDef[] = [
  { id: "command", defaultWidth: 320 },
  { id: "scope", defaultWidth: 140 },
  { id: "default", defaultWidth: 140 },
  { id: "changed", defaultWidth: 180 },
  { id: "actions", defaultWidth: 128 },
];


export function SettingsPage() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const {
    commands,
    getShortcuts,
    setShortcut,
    resetShortcut,
    resetAllShortcuts,
    getConflicts,
    showShortcutHints,
    setShowShortcutHints,
    disableSingleKeyShortcuts,
    setDisableSingleKeyShortcuts,
  } = useShortcuts();
  const displaySettings = useDisplaySettings();
  const assistantSettings = useAssistantSettings();
  const flaggedWords = useFlaggedWords();

  const [query, setQuery] = useState("");
  const [selectedCommandId, setSelectedCommandId] =
    useState<CommandId>("global.dashboard");
  const [capturingCommandId, setCapturingCommandId] =
    useState<CommandId | null>(null);
  const [message, setMessage] = useState("");
  const [flaggedWordsDraft, setFlaggedWordsDraft] = useState(() =>
    flaggedWords.words.join("\n"),
  );
  const [flaggedWordsMessage, setFlaggedWordsMessage] = useState("");
  const [tableLayoutMessage, setTableLayoutMessage] = useState("");
  const [shortcutsTableFocused, setShortcutsTableFocused] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(true);
  const [interfaceOpen, setInterfaceOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [flaggedWordsOpen, setFlaggedWordsOpen] = useState(true);
  const [amountColorsOpen, setAmountColorsOpen] = useState(true);
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(true);
  const {
    columns,
    totalWidth,
    getColStyle,
    getHeaderStyle,
    getResizeHandleProps,
  } = useResizableColumns("settings.shortcuts", SHORTCUT_COLUMNS);

  useShortcutScope("settings");
  useShortcutScope(
    "settingsShortcuts",
    shortcutsTableFocused || capturingCommandId !== null,
  );

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;

    return commands.filter((command) => {
      const bindings = getShortcuts(command.id);
      return [
        command.label,
        command.description,
        command.category,
        command.scope,
        displayShortcutList(bindings),
      ].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [commands, getShortcuts, query]);

  const selectedCommand =
    commands.find((command) => command.id === selectedCommandId) ?? commands[0];
  const groupedCommands = useMemo(() => {
    return filteredCommands.reduce<
      Array<{ category: string; commands: CommandDefinition[] }>
    >((groups, command) => {
      const existing = groups.find(
        (group) => group.category === command.category,
      );
      if (existing) {
        existing.commands.push(command);
        return groups;
      }

      groups.push({ category: command.category, commands: [command] });
      return groups;
    }, []);
  }, [filteredCommands]);

  const focusSection = useCallback(() => {
    setKeyboardShortcutsOpen(true);
    window.setTimeout(() => {
      sectionRef.current?.focus();
      sectionRef.current?.scrollIntoView({ block: "start" });
    }, 0);
  }, []);

  const focusShortcutSearch = useCallback(() => {
    setKeyboardShortcutsOpen(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (window.location.hash === "#keyboard-shortcuts") {
      window.setTimeout(focusSection, 0);
    }
  }, [focusSection]);

  const saveFlaggedWords = useCallback(() => {
    const normalizedWords = normalizeFlaggedWords(
      flaggedWordsDraft.split(/\r?\n/),
    );
    flaggedWords.setFlaggedWords(normalizedWords);
    setFlaggedWordsDraft(normalizedWords.join("\n"));
    setFlaggedWordsMessage("Flagged transaction words saved.");
  }, [flaggedWords, flaggedWordsDraft]);

  const resetFlaggedWords = useCallback(() => {
    const defaultWords = normalizeFlaggedWords(DEFAULT_FLAGGED_WORDS);
    flaggedWords.resetFlaggedWords();
    setFlaggedWordsDraft(defaultWords.join("\n"));
    setFlaggedWordsMessage("Flagged transaction words reset to defaults.");
  }, [flaggedWords]);

  const resetColumnWidths = useCallback(() => {
    resetAllTableColumnWidths();
    setTableLayoutMessage("Column widths reset to defaults.");
  }, []);

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

  useShortcut("settings.focusShortcuts", focusSection);
  useShortcut("settings.focusShortcutSearch", focusShortcutSearch);
  useShortcut(
    "settings.editSelectedShortcut",
    useCallback(() => {
      if (selectedCommand) setCapturingCommandId(selectedCommand.id);
    }, [selectedCommand]),
  );
  useShortcut("settings.clearSelectedShortcut", clearSelected, {
    enabled: Boolean(selectedCommand),
  });
  useShortcut("settings.resetSelectedShortcut", resetSelected, {
    enabled: Boolean(selectedCommand),
  });
  useShortcut(
    "settings.resetAllShortcuts",
    useCallback(() => {
      resetAllShortcuts();
      setMessage("All shortcuts reset to defaults.");
    }, [resetAllShortcuts]),
  );

  const commitCapturedShortcut = (
    commandId: CommandId,
    binding: ShortcutBinding | null,
  ) => {
    const command = commands.find((item) => item.id === commandId);
    if (!command) return;

    const validation = validateShortcut(binding, command.scope);
    if (!validation.ok) {
      setMessage(validation.message ?? "Shortcut is not valid.");
      return;
    }

    const conflicts = getConflicts(commandId, binding ? [binding] : []);
    if (conflicts.length > 0) {
      setMessage(
        `${displayShortcut(binding)} already belongs to ${conflicts.map((conflict) => conflict.command.label).join(", ")}.`,
      );
      return;
    }

    setShortcut(commandId, binding);
    setCapturingCommandId(null);
    setMessage(`${command.label} set to ${displayShortcut(binding)}.`);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>

      <CollapsibleCard
        title="API Key (OpenRouter)"
        open={apiKeyOpen}
        onOpenChange={setApiKeyOpen}
      >
          <p className="text-sm text-muted-foreground">
            The OpenRouter API key is configured via the{" "}
            <code className="bg-secondary px-1 py-0.5 rounded text-xs font-mono">
              OPENROUTER_API_KEY
            </code>{" "}
            environment variable in your{" "}
            <code className="bg-secondary px-1 py-0.5 rounded text-xs font-mono">
              .env
            </code>{" "}
            file in the project root.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            To update it, edit{" "}
            <code className="bg-secondary px-1 py-0.5 rounded text-xs font-mono">
              .env
            </code>{" "}
            and restart the server.
          </p>
      </CollapsibleCard>

      <CollapsibleCard
        title="Interface"
        open={interfaceOpen}
        onOpenChange={setInterfaceOpen}
        contentClassName="space-y-3"
      >
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={displaySettings.successConfirmationPopupsEnabled}
              onChange={(event) =>
                displaySettings.setSuccessConfirmationPopupsEnabled(
                  event.target.checked,
                )
              }
            />
            Show success confirmation popups
          </label>
          <p className="text-sm text-muted-foreground">
            When off, successful save/create/update/delete popups are hidden.
            Errors, warnings, and destructive confirmations still appear.
          </p>
          <div className="space-y-2 rounded-md border border-border bg-secondary/20 px-3 py-2">
            <div>
              <div className="text-sm font-medium text-foreground">
                Table column widths
              </div>
              <p className="text-sm text-muted-foreground">
                Restore all resizable tables to their default column widths.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={resetColumnWidths}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reset Column Widths
            </Button>
          </div>
          {tableLayoutMessage && (
            <p
              className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
              aria-live="polite"
            >
              {tableLayoutMessage}
            </p>
          )}
      </CollapsibleCard>

      <CollapsibleCard
        title="Assistant"
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        contentClassName="space-y-3"
      >
          <Input
            type="number"
            min={MIN_MAX_ASSISTANT_TURNS}
            max={MAX_MAX_ASSISTANT_TURNS}
            step={1}
            label="Max LLM turns per request"
            value={assistantSettings.maxAssistantTurns}
            onChange={(event) =>
              assistantSettings.setMaxAssistantTurns(Number(event.target.value))
            }
            helperText="Controls how many times the assistant can continue after tool results. Default is 5."
          />
          <Button
            type="button"
            variant="secondary"
            onClick={assistantSettings.resetAssistantSettings}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Reset
          </Button>
      </CollapsibleCard>


      <CollapsibleCard
        title={
          <>
            <AlertTriangle className="mr-2 h-4 w-4 text-red-300" />
            Flagged Transaction Words
          </>
        }
        open={flaggedWordsOpen}
        onOpenChange={setFlaggedWordsOpen}
        contentClassName="space-y-3"
      >
          <label className="block space-y-1">
            <span className="text-sm font-medium text-muted-foreground">
              Words or phrases
            </span>
            <textarea
              value={flaggedWordsDraft}
              onChange={(event) => {
                setFlaggedWordsDraft(event.target.value);
                setFlaggedWordsMessage("");
              }}
              rows={4}
              placeholder="interest&#10;fee"
              className="min-h-24 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Save All warns when a transaction name contains one of these
            entries. Matching rows are highlighted in transaction history.
          </p>
          {flaggedWordsMessage && (
            <p
              className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
              aria-live="polite"
            >
              {flaggedWordsMessage}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={saveFlaggedWords}>
              <Save className="mr-1 h-3.5 w-3.5" />
              Save Words
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={resetFlaggedWords}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
      </CollapsibleCard>

      <CollapsibleCard
        title="Transaction Amount Colors"
        open={amountColorsOpen}
        onOpenChange={setAmountColorsOpen}
        contentClassName="space-y-3"
      >
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={displaySettings.amountGradientEnabled}
              onChange={(event) =>
                displaySettings.setAmountGradientEnabled(event.target.checked)
              }
            />
            Color transaction rows by amount
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                Negative
              </div>
              <ColorPicker
                value={displaySettings.negativeColor}
                onChange={(color) =>
                  color &&
                  displaySettings.setGradientColor("negativeColor", color)
                }
                label="Negative amount color"
                allowClear={false}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                Neutral
              </div>
              <ColorPicker
                value={displaySettings.neutralColor}
                onChange={(color) =>
                  color &&
                  displaySettings.setGradientColor("neutralColor", color)
                }
                label="Neutral amount color"
                allowClear={false}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                Positive
              </div>
              <ColorPicker
                value={displaySettings.positiveColor}
                onChange={(color) =>
                  color &&
                  displaySettings.setGradientColor("positiveColor", color)
                }
                label="Positive amount color"
                allowClear={false}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/20 px-3 py-2 text-sm">
            <div className="grid flex-1 grid-cols-3 overflow-hidden rounded border border-border text-center font-mono text-xs">
              <span
                style={{
                  backgroundColor: `${displaySettings.negativeColor}24`,
                }}
                className="px-2 py-1"
              >
                -$500.00
              </span>
              <span
                style={{ backgroundColor: `${displaySettings.neutralColor}24` }}
                className="px-2 py-1"
              >
                $0.00
              </span>
              <span
                style={{
                  backgroundColor: `${displaySettings.positiveColor}24`,
                }}
                className="px-2 py-1"
              >
                $500.00
              </span>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={displaySettings.resetAmountGradientSettings}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
      </CollapsibleCard>

      <CollapsibleCard
        title="Keyboard Shortcuts"
        open={keyboardShortcutsOpen}
        onOpenChange={setKeyboardShortcutsOpen}
        contentClassName="space-y-4"
      >
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
              <Checkbox
                checked={showShortcutHints}
                onChange={(event) => setShowShortcutHints(event.target.checked)}
              />
              Show shortcut hints
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={disableSingleKeyShortcuts}
                onChange={(event) =>
                  setDisableSingleKeyShortcuts(event.target.checked)
                }
              />
              Disable single-key shortcuts
            </label>
            <Button
              type="button"
              variant="secondary"
              onClick={resetAllShortcuts}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reset All
              <ShortcutHint commandId="settings.resetAllShortcuts" />
            </Button>
          </div>

          {message && (
            <p
              className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
              aria-live="polite"
            >
              {message}
            </p>
          )}

          <div
            className="overflow-x-auto rounded-md border border-border"
            onFocus={() => setShortcutsTableFocused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setShortcutsTableFocused(false);
              }
            }}
          >
            <table
              className="w-full text-sm"
              style={{ minWidth: totalWidth, tableLayout: "fixed" }}
            >
              <colgroup>
                {columns.map((column) => (
                  <col key={column.id} style={getColStyle(column.id)} />
                ))}
              </colgroup>
              <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th
                    className="relative px-3 py-2 font-medium"
                    style={getHeaderStyle("command")}
                  >
                    Command
                    <span
                      {...getResizeHandleProps("command")}
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                    />
                  </th>
                  <th
                    className="relative px-3 py-2 font-medium"
                    style={getHeaderStyle("scope")}
                  >
                    Scope
                    <span
                      {...getResizeHandleProps("scope")}
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                    />
                  </th>
                  <th
                    className="relative px-3 py-2 font-medium"
                    style={getHeaderStyle("default")}
                  >
                    Default
                    <span
                      {...getResizeHandleProps("default")}
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                    />
                  </th>
                  <th
                    className="relative px-3 py-2 font-medium"
                    style={getHeaderStyle("changed")}
                  >
                    Changed
                    <span
                      {...getResizeHandleProps("changed")}
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                    />
                  </th>
                  <th
                    className="relative px-3 py-2 text-right font-medium"
                    style={getHeaderStyle("actions")}
                  >
                    Actions
                    <span
                      {...getResizeHandleProps("actions")}
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                    />
                  </th>
                </tr>
              </thead>
              {groupedCommands.map((group) => (
                <tbody key={group.category} className="divide-y divide-border">
                  <tr>
                    <th
                      colSpan={5}
                      scope="colgroup"
                      className="bg-secondary/30 px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground"
                    >
                      {group.category}
                    </th>
                  </tr>
                  {group.commands.map((command) => {
                    const current = getShortcuts(command.id);
                    const changed = shortcutBindingsMatch(
                      current,
                      command.defaultBindings,
                    )
                      ? null
                      : current;
                    const conflicts = getConflicts(command.id, current);
                    const isCapturing = capturingCommandId === command.id;
                    return (
                      <tr
                        key={command.id}
                        tabIndex={0}
                        onFocus={() => setSelectedCommandId(command.id)}
                        className={`outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring ${
                          selectedCommandId === command.id
                            ? "bg-secondary/20"
                            : ""
                        }`}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground">
                            {command.label}
                          </div>
                          <div className="max-w-md text-xs text-muted-foreground">
                            {command.description}
                          </div>
                          {conflicts.length > 0 && (
                            <div className="mt-1 text-xs text-destructive">
                              Conflicts with{" "}
                              {conflicts
                                .map((conflict) => conflict.command.label)
                                .join(", ")}
                            </div>
                          )}
                          {current.some(isSingleCharacterShortcut) && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Single-key scoped shortcut
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {command.scope}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {displayShortcutList(command.defaultBindings)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {isCapturing ? (
                            <button
                              type="button"
                              autoFocus
                              className="rounded border border-ring bg-input px-2 py-1 text-foreground"
                              onKeyDown={(event) => {
                                event.preventDefault();
                                if (event.key === "Escape") {
                                  setCapturingCommandId(null);
                                  setMessage("Shortcut edit canceled.");
                                  return;
                                }
                                commitCapturedShortcut(
                                  command.id,
                                  normalizeKeyboardEvent(event),
                                );
                              }}
                            >
                              Press keys...
                            </button>
                          ) : changed ? (
                            displayShortcutList(changed)
                          ) : (
                            <span className="text-muted-foreground">—</span>
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
                                setMessage(
                                  `Editing ${command.label}. Press Escape to cancel.`,
                                );
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
                                setMessage(
                                  `${command.label} reset to default.`,
                                );
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
              ))}
            </table>
          </div>
      </CollapsibleCard>
    </div>
  );
}
