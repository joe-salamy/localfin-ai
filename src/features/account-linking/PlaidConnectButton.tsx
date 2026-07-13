import { useEffect, useState } from "react";
import { toast } from "sonner";
import { usePlaidLink } from "react-plaid-link";
import type {
  PlaidLinkError,
  PlaidLinkOnSuccessMetadata,
} from "react-plaid-link";
import { Button } from "@/components/ui/Button";
import { useSuccessToast } from "@/features/display-settings/hooks";
import {
  clearStoredPlaidOAuthLinkToken,
  readStoredPlaidOAuthLinkToken,
  storePlaidOAuthLinkToken,
  type PlaidTargetInstitution,
} from "./plaidOAuthStorage";

interface PlaidConnectButtonProps {
  targetInstitution: PlaidTargetInstitution;
  label: string;
  createLinkToken(input: {
    targetInstitution: PlaidTargetInstitution;
  }): Promise<{ data?: { link_token: string | null } }>;
  exchangePublicToken(input: {
    publicToken: string;
    targetInstitution: PlaidTargetInstitution;
    metadata: unknown;
  }): Promise<unknown>;
  loading?: boolean;
}

export function PlaidConnectButton({
  targetInstitution,
  label,
  createLinkToken,
  exchangePublicToken,
  loading,
}: PlaidConnectButtonProps) {
  const successToast = useSuccessToast();
  const [linkToken, setLinkToken] = useState<string | null>(() =>
    readStoredPlaidOAuthLinkToken(targetInstitution),
  );
  const [shouldOpen, setShouldOpen] = useState(
    () => readStoredPlaidOAuthLinkToken(targetInstitution) !== null,
  );
  const receivedRedirectUri =
    typeof window !== "undefined" &&
    window.location.href.includes("oauth_state_id")
      ? window.location.href
      : undefined;

  const { open, ready } = usePlaidLink({
    token: linkToken,
    ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
    onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      void exchangePublicToken({ publicToken, targetInstitution, metadata })
        .then(() => {
          successToast("Plaid account connected");
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to connect Plaid account",
          );
        })
        .finally(() => {
          clearStoredPlaidOAuthLinkToken();
          setLinkToken(null);
          setShouldOpen(false);
        });
    },
    onExit: (error: PlaidLinkError | null) => {
      if (error) {
        toast.error(
          error.display_message || error.error_message || "Plaid Link exited",
        );
      }
      clearStoredPlaidOAuthLinkToken();
      setShouldOpen(false);
    },
  });

  useEffect(() => {
    if (!shouldOpen || !ready || !linkToken) return;
    open();
    setShouldOpen(false);
  }, [linkToken, open, ready, shouldOpen]);

  async function handleClick() {
    try {
      const result = await createLinkToken({ targetInstitution });
      const nextToken = result.data?.link_token;
      if (!nextToken) throw new Error("Plaid Link token was not returned.");
      storePlaidOAuthLinkToken(targetInstitution, nextToken);
      setLinkToken(nextToken);
      setShouldOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to start Plaid Link",
      );
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={handleClick}
      loading={loading || (shouldOpen && !ready)}
    >
      {label}
    </Button>
  );
}
