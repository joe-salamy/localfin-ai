export type CommandScope =
  | 'global'
  | 'dashboard'
  | 'transactionInput'
  | 'transactionInputGrid'
  | 'transactionHistory'
  | 'transactionHistoryTable'
  | 'transactionHistoryEdit'
  | 'setup'
  | 'setupAccounts'
  | 'setupCategories'
  | 'setupSubcategories'
  | 'settings'
  | 'settingsShortcuts'
  | 'assistant'
  | 'modal';

export type CommandCategory =
  | 'Global'
  | 'Dashboard'
  | 'Add Transactions'
  | 'Transaction History'
  | 'Setup'
  | 'Settings'
  | 'Modals';

export type CommandId =
  | 'global.dashboard'
  | 'global.setup'
  | 'global.addTransactions'
  | 'global.transactionHistory'
  | 'global.settings'
  | 'global.keyboardShortcuts'
  | 'global.toggleAssistant'
  | 'global.focusAssistant'
  | 'global.close'
  | 'assistant.send'
  | 'dashboard.applyDateRange'
  | 'dashboard.focusStartDate'
  | 'dashboard.focusEndDate'
  | 'dashboard.preset1'
  | 'dashboard.preset2'
  | 'dashboard.preset3'
  | 'dashboard.preset4'
  | 'dashboard.preset5'
  | 'dashboard.preset6'
  | 'transactionInput.addRow'
  | 'transactionInput.aiCategorize'
  | 'transactionInput.clearAll'
  | 'transactionInput.saveAll'
  | 'transactionInput.parseStatement'
  | 'transactionInput.focusStatementText'
  | 'transactionInput.focusStatementAccount'
  | 'transactionInput.focusGrid'
  | 'transactionInput.removeFocusedRow'
  | 'transactionInput.nextCell'
  | 'transactionInput.previousCell'
  | 'transactionHistory.applyFilters'
  | 'transactionHistory.focusSearch'
  | 'transactionHistory.focusStartDate'
  | 'transactionHistory.focusEndDate'
  | 'transactionHistory.focusAccount'
  | 'transactionHistory.preset1'
  | 'transactionHistory.preset2'
  | 'transactionHistory.preset3'
  | 'transactionHistory.preset4'
  | 'transactionHistory.preset5'
  | 'transactionHistory.preset6'
  | 'transactionHistory.selectAll'
  | 'transactionHistory.toggleFocusedRow'
  | 'transactionHistory.editFocusedRow'
  | 'transactionHistory.saveEdit'
  | 'transactionHistory.cancelEdit'
  | 'transactionHistory.deleteFocusedRow'
  | 'transactionHistory.bulkEdit'
  | 'transactionHistory.bulkDelete'
  | 'transactionHistory.sortDate'
  | 'transactionHistory.sortName'
  | 'transactionHistory.sortAmount'
  | 'transactionHistory.sortBalance'
  | 'transactionHistory.nextRow'
  | 'transactionHistory.previousRow'
  | 'transactionHistory.firstRow'
  | 'transactionHistory.lastRow'
  | 'setup.toggleAccounts'
  | 'setup.toggleCategories'
  | 'setup.toggleSubcategories'
  | 'setup.accounts.add'
  | 'setup.accounts.save'
  | 'setup.accounts.cancel'
  | 'setup.accounts.editFocused'
  | 'setup.accounts.deleteFocused'
  | 'setup.accounts.bulkDelete'
  | 'setup.accounts.selectAll'
  | 'setup.accounts.toggleFocused'
  | 'setup.accounts.sortName'
  | 'setup.accounts.sortType'
  | 'setup.accounts.sortBalance'
  | 'setup.categories.add'
  | 'setup.categories.save'
  | 'setup.categories.cancel'
  | 'setup.categories.editFocused'
  | 'setup.categories.deleteFocused'
  | 'setup.categories.bulkDelete'
  | 'setup.categories.selectAll'
  | 'setup.categories.toggleFocused'
  | 'setup.categories.sortName'
  | 'setup.categories.sortType'
  | 'setup.subcategories.add'
  | 'setup.subcategories.save'
  | 'setup.subcategories.cancel'
  | 'setup.subcategories.editFocused'
  | 'setup.subcategories.deleteFocused'
  | 'setup.subcategories.bulkDelete'
  | 'setup.subcategories.selectAll'
  | 'setup.subcategories.toggleFocused'
  | 'setup.subcategories.sortName'
  | 'setup.subcategories.sortCategory'
  | 'setup.subcategories.sortGoal'
  | 'modal.confirm'
  | 'modal.cancel'
  | 'settings.focusShortcuts'
  | 'settings.focusShortcutSearch'
  | 'settings.editSelectedShortcut'
  | 'settings.clearSelectedShortcut'
  | 'settings.resetSelectedShortcut'
  | 'settings.resetAllShortcuts';

export interface ShortcutBinding {
  key: string;
}

export interface CommandDefinition {
  id: CommandId;
  label: string;
  description: string;
  category: CommandCategory;
  scope: CommandScope;
  defaultBinding: ShortcutBinding | null;
  inputSafe?: boolean;
  preventDefault?: boolean;
}

function command(
  id: CommandId,
  label: string,
  description: string,
  category: CommandCategory,
  scope: CommandScope,
  key: string | null,
  options: Pick<CommandDefinition, 'inputSafe' | 'preventDefault'> = {},
): CommandDefinition {
  return {
    id,
    label,
    description,
    category,
    scope,
    defaultBinding: key ? { key } : null,
    preventDefault: true,
    ...options,
  };
}

export const DEFAULT_COMMANDS = [
  command('global.dashboard', 'Go to Dashboard', 'Navigate to the dashboard.', 'Global', 'global', 'Ctrl+Alt+D'),
  command('global.setup', 'Go to Setup', 'Navigate to accounts, categories, and subcategories setup.', 'Global', 'global', 'Ctrl+Alt+S'),
  command('global.addTransactions', 'Go to Add Transactions', 'Navigate to transaction entry.', 'Global', 'global', 'Ctrl+Alt+A'),
  command('global.transactionHistory', 'Go to Transaction History', 'Navigate to transaction history.', 'Global', 'global', 'Ctrl+Alt+H'),
  command('global.settings', 'Go to Settings', 'Navigate to settings.', 'Global', 'global', 'Ctrl+Alt+,'),
  command('global.keyboardShortcuts', 'Open Keyboard Shortcuts', 'Navigate to settings and focus keyboard shortcuts.', 'Global', 'global', 'Ctrl+Alt+K'),
  command('global.toggleAssistant', 'Toggle AI Assistant', 'Open or close the AI assistant side panel.', 'Global', 'global', 'Ctrl+Alt+I'),
  command('global.focusAssistant', 'Focus AI Assistant Input', 'Move focus to the assistant message box.', 'Global', 'global', 'Ctrl+Alt+.'),
  command('global.close', 'Close AI Assistant', 'Close the AI assistant side panel.', 'Global', 'assistant', 'Escape'),
  command('assistant.send', 'Send Assistant Message', 'Send the current assistant message.', 'Global', 'assistant', 'Ctrl+Enter', { inputSafe: true }),

  command('dashboard.applyDateRange', 'Apply Date Range', 'Apply the custom dashboard date range.', 'Dashboard', 'dashboard', 'Ctrl+Enter', { inputSafe: true }),
  command('dashboard.focusStartDate', 'Focus Start Date', 'Focus the dashboard start date.', 'Dashboard', 'dashboard', 'Alt+['),
  command('dashboard.focusEndDate', 'Focus End Date', 'Focus the dashboard end date.', 'Dashboard', 'dashboard', 'Alt+]'),
  command('dashboard.preset1', 'Dashboard Preset 1', 'Apply dashboard date preset 1.', 'Dashboard', 'dashboard', 'Ctrl+Alt+1'),
  command('dashboard.preset2', 'Dashboard Preset 2', 'Apply dashboard date preset 2.', 'Dashboard', 'dashboard', 'Ctrl+Alt+2'),
  command('dashboard.preset3', 'Dashboard Preset 3', 'Apply dashboard date preset 3.', 'Dashboard', 'dashboard', 'Ctrl+Alt+3'),
  command('dashboard.preset4', 'Dashboard Preset 4', 'Apply dashboard date preset 4.', 'Dashboard', 'dashboard', 'Ctrl+Alt+4'),
  command('dashboard.preset5', 'Dashboard Preset 5', 'Apply dashboard date preset 5.', 'Dashboard', 'dashboard', 'Ctrl+Alt+5'),
  command('dashboard.preset6', 'Dashboard Preset 6', 'Apply dashboard date preset 6.', 'Dashboard', 'dashboard', 'Ctrl+Alt+6'),

  command('transactionInput.addRow', 'Add Transaction Row', 'Add an empty transaction entry row.', 'Add Transactions', 'transactionInput', 'Ctrl+Alt+N'),
  command('transactionInput.aiCategorize', 'AI Categorize Rows', 'Categorize eligible rows with AI.', 'Add Transactions', 'transactionInput', 'Ctrl+Alt+G'),
  command('transactionInput.clearAll', 'Clear Transaction Rows', 'Clear all transaction entry rows.', 'Add Transactions', 'transactionInput', 'Ctrl+Alt+Backspace'),
  command('transactionInput.saveAll', 'Save Transaction Rows', 'Save all filled transaction entry rows.', 'Add Transactions', 'transactionInput', 'Ctrl+Enter', { inputSafe: true }),
  command('transactionInput.parseStatement', 'Parse Statement', 'Parse pasted statement text.', 'Add Transactions', 'transactionInput', 'Ctrl+Alt+P'),
  command('transactionInput.focusStatementText', 'Focus Statement Text', 'Focus the statement text box.', 'Add Transactions', 'transactionInput', 'Ctrl+Alt+T'),
  command('transactionInput.focusStatementAccount', 'Focus Statement Account', 'Focus the statement account selector.', 'Add Transactions', 'transactionInput', 'Ctrl+Alt+U'),
  command('transactionInput.focusGrid', 'Focus Transaction Grid', 'Focus the first transaction entry cell.', 'Add Transactions', 'transactionInput', 'Ctrl+Alt+F'),
  command('transactionInput.removeFocusedRow', 'Remove Focused Row', 'Remove the currently focused transaction entry row.', 'Add Transactions', 'transactionInputGrid', 'Ctrl+Alt+Delete'),
  command('transactionInput.nextCell', 'Next Transaction Cell', 'Move to the next transaction entry cell.', 'Add Transactions', 'transactionInputGrid', 'Ctrl+Alt+ArrowRight', { inputSafe: true }),
  command('transactionInput.previousCell', 'Previous Transaction Cell', 'Move to the previous transaction entry cell.', 'Add Transactions', 'transactionInputGrid', 'Ctrl+Alt+ArrowLeft', { inputSafe: true }),

  command('transactionHistory.applyFilters', 'Apply Transaction Filters', 'Apply transaction history filters.', 'Transaction History', 'transactionHistory', 'Ctrl+Enter', { inputSafe: true }),
  command('transactionHistory.focusSearch', 'Focus Transaction Search', 'Focus the transaction history search field.', 'Transaction History', 'transactionHistory', 'Ctrl+Alt+F'),
  command('transactionHistory.focusStartDate', 'Focus History Start Date', 'Focus the transaction history start date.', 'Transaction History', 'transactionHistory', 'Alt+['),
  command('transactionHistory.focusEndDate', 'Focus History End Date', 'Focus the transaction history end date.', 'Transaction History', 'transactionHistory', 'Alt+]'),
  command('transactionHistory.focusAccount', 'Focus History Account Filter', 'Focus the transaction history account filter.', 'Transaction History', 'transactionHistory', 'Ctrl+Alt+U'),
  command('transactionHistory.preset1', 'History Preset 1', 'Apply transaction history date preset 1.', 'Transaction History', 'transactionHistory', 'Ctrl+Alt+1'),
  command('transactionHistory.preset2', 'History Preset 2', 'Apply transaction history date preset 2.', 'Transaction History', 'transactionHistory', 'Ctrl+Alt+2'),
  command('transactionHistory.preset3', 'History Preset 3', 'Apply transaction history date preset 3.', 'Transaction History', 'transactionHistory', 'Ctrl+Alt+3'),
  command('transactionHistory.preset4', 'History Preset 4', 'Apply transaction history date preset 4.', 'Transaction History', 'transactionHistory', 'Ctrl+Alt+4'),
  command('transactionHistory.preset5', 'History Preset 5', 'Apply transaction history date preset 5.', 'Transaction History', 'transactionHistory', 'Ctrl+Alt+5'),
  command('transactionHistory.preset6', 'History Preset 6', 'Apply transaction history date preset 6.', 'Transaction History', 'transactionHistory', 'Ctrl+Alt+6'),
  command('transactionHistory.selectAll', 'Select All Visible Transactions', 'Select or clear all visible transactions.', 'Transaction History', 'transactionHistoryTable', 'Ctrl+Alt+X'),
  command('transactionHistory.toggleFocusedRow', 'Toggle Focused Transaction', 'Toggle selection for the focused transaction.', 'Transaction History', 'transactionHistoryTable', 'Space'),
  command('transactionHistory.editFocusedRow', 'Edit Focused Transaction', 'Edit the focused transaction.', 'Transaction History', 'transactionHistoryTable', 'Enter'),
  command('transactionHistory.saveEdit', 'Save Transaction Edit', 'Save the focused transaction edit.', 'Transaction History', 'transactionHistoryEdit', 'Ctrl+Enter', { inputSafe: true }),
  command('transactionHistory.cancelEdit', 'Cancel Transaction Edit', 'Cancel the focused transaction edit.', 'Transaction History', 'transactionHistoryEdit', 'Escape', { inputSafe: true }),
  command('transactionHistory.deleteFocusedRow', 'Delete Focused Transaction', 'Open delete confirmation for the focused transaction.', 'Transaction History', 'transactionHistoryTable', 'Delete'),
  command('transactionHistory.bulkEdit', 'Bulk Edit Transactions', 'Open bulk edit for selected transactions.', 'Transaction History', 'transactionHistory', 'Ctrl+Alt+E'),
  command('transactionHistory.bulkDelete', 'Bulk Delete Transactions', 'Open bulk delete for selected transactions.', 'Transaction History', 'transactionHistory', 'Ctrl+Alt+Backspace'),
  command('transactionHistory.sortDate', 'Sort Transactions By Date', 'Sort transaction history by date.', 'Transaction History', 'transactionHistoryTable', 'Alt+1'),
  command('transactionHistory.sortName', 'Sort Transactions By Name', 'Sort transaction history by name.', 'Transaction History', 'transactionHistoryTable', 'Alt+2'),
  command('transactionHistory.sortAmount', 'Sort Transactions By Amount', 'Sort transaction history by amount.', 'Transaction History', 'transactionHistoryTable', 'Alt+3'),
  command('transactionHistory.sortBalance', 'Sort Transactions By Balance', 'Sort transaction history by running balance.', 'Transaction History', 'transactionHistoryTable', 'Alt+4'),
  command('transactionHistory.nextRow', 'Next Transaction Row', 'Focus the next transaction row.', 'Transaction History', 'transactionHistoryTable', 'ArrowDown'),
  command('transactionHistory.previousRow', 'Previous Transaction Row', 'Focus the previous transaction row.', 'Transaction History', 'transactionHistoryTable', 'ArrowUp'),
  command('transactionHistory.firstRow', 'First Transaction Row', 'Focus the first transaction row.', 'Transaction History', 'transactionHistoryTable', 'Home'),
  command('transactionHistory.lastRow', 'Last Transaction Row', 'Focus the last transaction row.', 'Transaction History', 'transactionHistoryTable', 'End'),

  command('setup.toggleAccounts', 'Toggle Accounts Section', 'Expand or collapse accounts.', 'Setup', 'setup', 'Ctrl+Alt+1'),
  command('setup.toggleCategories', 'Toggle Categories Section', 'Expand or collapse categories.', 'Setup', 'setup', 'Ctrl+Alt+2'),
  command('setup.toggleSubcategories', 'Toggle Subcategories Section', 'Expand or collapse subcategories.', 'Setup', 'setup', 'Ctrl+Alt+3'),
  command('setup.accounts.add', 'Add Account', 'Open the account add form.', 'Setup', 'setupAccounts', 'Ctrl+Alt+N'),
  command('setup.accounts.save', 'Save Account Form', 'Save the active account add or edit form.', 'Setup', 'setupAccounts', 'Ctrl+Enter', { inputSafe: true }),
  command('setup.accounts.cancel', 'Cancel Account Form', 'Cancel account add or edit mode.', 'Setup', 'setupAccounts', 'Escape', { inputSafe: true }),
  command('setup.accounts.editFocused', 'Edit Focused Account', 'Edit the focused account.', 'Setup', 'setupAccounts', 'Enter'),
  command('setup.accounts.deleteFocused', 'Delete Focused Account', 'Open delete confirmation for the focused account.', 'Setup', 'setupAccounts', 'Delete'),
  command('setup.accounts.bulkDelete', 'Bulk Delete Accounts', 'Open bulk delete for selected accounts.', 'Setup', 'setupAccounts', 'Ctrl+Alt+Backspace'),
  command('setup.accounts.selectAll', 'Select All Accounts', 'Select or clear all visible accounts.', 'Setup', 'setupAccounts', 'Ctrl+Alt+X'),
  command('setup.accounts.toggleFocused', 'Toggle Focused Account', 'Toggle focused account selection.', 'Setup', 'setupAccounts', 'Space'),
  command('setup.accounts.sortName', 'Sort Accounts By Name', 'Sort accounts by name.', 'Setup', 'setupAccounts', 'Alt+1'),
  command('setup.accounts.sortType', 'Sort Accounts By Type', 'Sort accounts by type.', 'Setup', 'setupAccounts', 'Alt+2'),
  command('setup.accounts.sortBalance', 'Sort Accounts By Balance', 'Sort accounts by balance.', 'Setup', 'setupAccounts', 'Alt+3'),
  command('setup.categories.add', 'Add Category', 'Open the category add form.', 'Setup', 'setupCategories', 'Ctrl+Alt+N'),
  command('setup.categories.save', 'Save Category Form', 'Save the active category add or edit form.', 'Setup', 'setupCategories', 'Ctrl+Enter', { inputSafe: true }),
  command('setup.categories.cancel', 'Cancel Category Form', 'Cancel category add or edit mode.', 'Setup', 'setupCategories', 'Escape', { inputSafe: true }),
  command('setup.categories.editFocused', 'Edit Focused Category', 'Edit the focused category.', 'Setup', 'setupCategories', 'Enter'),
  command('setup.categories.deleteFocused', 'Delete Focused Category', 'Open delete confirmation for the focused category.', 'Setup', 'setupCategories', 'Delete'),
  command('setup.categories.bulkDelete', 'Bulk Delete Categories', 'Open bulk delete for selected categories.', 'Setup', 'setupCategories', 'Ctrl+Alt+Backspace'),
  command('setup.categories.selectAll', 'Select All Categories', 'Select or clear all visible categories.', 'Setup', 'setupCategories', 'Ctrl+Alt+X'),
  command('setup.categories.toggleFocused', 'Toggle Focused Category', 'Toggle focused category selection.', 'Setup', 'setupCategories', 'Space'),
  command('setup.categories.sortName', 'Sort Categories By Name', 'Sort categories by name.', 'Setup', 'setupCategories', 'Alt+1'),
  command('setup.categories.sortType', 'Sort Categories By Type', 'Sort categories by type.', 'Setup', 'setupCategories', 'Alt+2'),
  command('setup.subcategories.add', 'Add Subcategory', 'Open the subcategory add form.', 'Setup', 'setupSubcategories', 'Ctrl+Alt+N'),
  command('setup.subcategories.save', 'Save Subcategory Form', 'Save the active subcategory add or edit form.', 'Setup', 'setupSubcategories', 'Ctrl+Enter', { inputSafe: true }),
  command('setup.subcategories.cancel', 'Cancel Subcategory Form', 'Cancel subcategory add or edit mode.', 'Setup', 'setupSubcategories', 'Escape', { inputSafe: true }),
  command('setup.subcategories.editFocused', 'Edit Focused Subcategory', 'Edit the focused subcategory.', 'Setup', 'setupSubcategories', 'Enter'),
  command('setup.subcategories.deleteFocused', 'Delete Focused Subcategory', 'Open delete confirmation for the focused subcategory.', 'Setup', 'setupSubcategories', 'Delete'),
  command('setup.subcategories.bulkDelete', 'Bulk Delete Subcategories', 'Open bulk delete for selected subcategories.', 'Setup', 'setupSubcategories', 'Ctrl+Alt+Backspace'),
  command('setup.subcategories.selectAll', 'Select All Subcategories', 'Select or clear all visible subcategories.', 'Setup', 'setupSubcategories', 'Ctrl+Alt+X'),
  command('setup.subcategories.toggleFocused', 'Toggle Focused Subcategory', 'Toggle focused subcategory selection.', 'Setup', 'setupSubcategories', 'Space'),
  command('setup.subcategories.sortName', 'Sort Subcategories By Name', 'Sort subcategories by name.', 'Setup', 'setupSubcategories', 'Alt+1'),
  command('setup.subcategories.sortCategory', 'Sort Subcategories By Category', 'Sort subcategories by category.', 'Setup', 'setupSubcategories', 'Alt+2'),
  command('setup.subcategories.sortGoal', 'Sort Subcategories By Goal', 'Sort subcategories by monthly goal.', 'Setup', 'setupSubcategories', 'Alt+3'),

  command('modal.confirm', 'Confirm Modal', 'Confirm the active modal action.', 'Modals', 'modal', 'Ctrl+Enter', { inputSafe: true }),
  command('modal.cancel', 'Cancel Modal', 'Cancel or close the active modal.', 'Modals', 'modal', 'Escape', { inputSafe: true }),

  command('settings.focusShortcuts', 'Focus Keyboard Shortcuts Section', 'Move focus to the keyboard shortcuts settings section.', 'Settings', 'settings', null),
  command('settings.focusShortcutSearch', 'Focus Shortcut Search', 'Focus the shortcut command search field.', 'Settings', 'settings', 'Ctrl+Alt+F'),
  command('settings.editSelectedShortcut', 'Edit Selected Shortcut', 'Start editing the selected shortcut.', 'Settings', 'settingsShortcuts', 'Enter'),
  command('settings.clearSelectedShortcut', 'Clear Selected Shortcut', 'Clear the selected shortcut binding.', 'Settings', 'settingsShortcuts', 'Delete'),
  command('settings.resetSelectedShortcut', 'Reset Selected Shortcut', 'Reset the selected shortcut to its default.', 'Settings', 'settingsShortcuts', 'Ctrl+Alt+R'),
  command('settings.resetAllShortcuts', 'Reset All Shortcuts', 'Reset all shortcuts to defaults.', 'Settings', 'settings', 'Ctrl+Alt+Shift+R'),
] as const satisfies readonly CommandDefinition[];

export const COMMANDS_BY_ID = new Map<CommandId, CommandDefinition>(
  DEFAULT_COMMANDS.map((definition) => [definition.id, definition]),
);

export function getCommandDefinition(id: CommandId): CommandDefinition {
  const definition = COMMANDS_BY_ID.get(id);
  if (!definition) {
    throw new Error(`Unknown command: ${id}`);
  }
  return definition;
}
