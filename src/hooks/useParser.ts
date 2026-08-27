import { useMutation } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import { parseStatementResultSchema, type ParseStatementResult } from "@shared/contracts";

interface ParseStatementRequest {
  text: string;
  accountId: string;
}

export function useParser() {
  const parseStatement = useMutation({
    mutationFn: (data: ParseStatementRequest) =>
      apiPost<ParseStatementResult>(
        "/parser/parse-statement",
        data,
        parseStatementResultSchema,
      ),
  });

  return { parseStatement };
}
