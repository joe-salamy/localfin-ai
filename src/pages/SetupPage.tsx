import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { TagManager } from "@/components/features/TagManager";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useTags } from "@/hooks/useTags";
import { useShortcut, useShortcutScope } from "@/features/shortcuts/hooks";
import { useSuccessToast } from "@/features/display-settings/hooks";
import { CollapsibleSection } from "@/components/features/setup/SetupSection";
import { AccountsSection } from "@/components/features/setup/AccountsSection";
import { CategoriesSection } from "@/components/features/setup/CategoriesSection";
import { SubcategoriesSection } from "@/components/features/setup/SubcategoriesSection";

export function SetupPage() {
  const { accounts } = useAccounts();
  const { categories, subcategories } = useCategories();
  const { tags } = useTags();
  const [accountsOpen, setAccountsOpen] = useState(true);
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const [subcategoriesOpen, setSubcategoriesOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const successToast = useSuccessToast();
  const activeTagCount = useMemo(
    () => tags.filter((tag) => !tag.deleted_at).length,
    [tags],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("provider") !== "akoya") return;

    const status = params.get("status");
    if (status === "connected") {
      successToast("Akoya account connected");
    } else if (status === "error") {
      toast.error(params.get("message") || "Akoya connection failed");
    }

    window.history.replaceState(null, "", "/setup");
  }, [successToast]);
  useShortcutScope("setup");
  useShortcut(
    "setup.toggleAccounts",
    useCallback(() => setAccountsOpen((open) => !open), []),
  );
  useShortcut(
    "setup.toggleCategories",
    useCallback(() => setCategoriesOpen((open) => !open), []),
  );
  useShortcut(
    "setup.toggleSubcategories",
    useCallback(() => setSubcategoriesOpen((open) => !open), []),
  );
  useShortcut(
    "setup.toggleTags",
    useCallback(() => setTagsOpen((open) => !open), []),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Setup</h1>

      <CollapsibleSection
        title="Accounts"
        count={accounts?.length ?? 0}
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
      >
        <AccountsSection />
      </CollapsibleSection>

      <CollapsibleSection
        title="Categories"
        count={categories?.length ?? 0}
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
      >
        <CategoriesSection />
      </CollapsibleSection>

      <CollapsibleSection
        title="Subcategories"
        count={subcategories?.length ?? 0}
        open={subcategoriesOpen}
        onOpenChange={setSubcategoriesOpen}
      >
        <SubcategoriesSection />
      </CollapsibleSection>

      <CollapsibleSection
        title="Tags"
        count={activeTagCount}
        open={tagsOpen}
        onOpenChange={setTagsOpen}
      >
        <TagManager />
      </CollapsibleSection>
    </div>
  );
}
