import type { RefObject } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ShortcutHint } from "@/features/shortcuts/ShortcutHint";

interface AccountOption {
  value: string;
  label: string;
}

interface StatementImportPanelProps {
  accountOptions: readonly AccountOption[];
  accountId: string;
  text: string;
  parseSummary: string | null;
  lastRunId: string | null;
  parsing: boolean;
  accountRef: RefObject<HTMLSelectElement | null>;
  textRef: RefObject<HTMLTextAreaElement | null>;
  onAccountChange(value: string): void;
  onTextChange(value: string): void;
  onParse(): void;
}

export function StatementImportPanel({
  accountOptions,
  accountId,
  text,
  parseSummary,
  lastRunId,
  parsing,
  accountRef,
  textRef,
  onAccountChange,
  onTextChange,
  onParse,
}: StatementImportPanelProps) {
  return (
    <Card className="p-3">
      <CardHeader className="mb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4" />
          Statement Import
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <select
            ref={accountRef}
            value={accountId}
            onChange={(event) => onAccountChange(event.target.value)}
            className="h-8 rounded border border-border bg-input px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select account</option>
            {accountOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            onClick={onParse}
            loading={parsing}
          >
            Parse Statement
            <ShortcutHint commandId="transactionInput.parseStatement" />
          </Button>
          {lastRunId && (
            <span className="self-center text-xs text-muted-foreground">
              log: logs/jsonl/*-{lastRunId}.jsonl
            </span>
          )}
        </div>
        <textarea
          ref={textRef}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Paste statement lines here"
          className="min-h-20 w-full rounded border border-border bg-input px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {parseSummary && (
          <p className="text-xs text-muted-foreground">{parseSummary}</p>
        )}
      </CardContent>
    </Card>
  );
}
