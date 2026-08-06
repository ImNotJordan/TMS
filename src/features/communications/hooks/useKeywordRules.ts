import * as React from "react";

import { appendAuditEvent } from "../lib/communications-store";
import { validateRegexTerm } from "../lib/keywordEngine";
import type { KeywordRule } from "../types";
import { useCommunicationsData } from "./useCommunicationsData";
import { useCommsAccess } from "./useCommsAccess";

export function useKeywordRules() {
  const { data, isLoading, persist } = useCommunicationsData();
  const { canEditRules, userId } = useCommsAccess();

  const saveRule = React.useCallback(
    async (rule: KeywordRule, previous?: KeywordRule) => {
      if (!canEditRules) throw new Error("You do not have permission to edit keyword rules.");
      if (rule.matchType === "regex") {
        for (const term of rule.terms) {
          const result = validateRegexTerm(term);
          if (!result.ok) throw new Error(result.reason);
        }
      }

      const exists = data.keywordRules.some((r) => r.id === rule.id);
      const keywordRules = exists
        ? data.keywordRules.map((r) => (r.id === rule.id ? rule : r))
        : [...data.keywordRules, rule];

      let payload = { ...data, keywordRules };
      payload = appendAuditEvent(payload, {
        actorId: userId ?? "unknown",
        action: "rule.updated",
        targetType: "rule",
        targetId: rule.id,
        metadata: {
          before: previous ?? null,
          after: rule,
        },
      });
      await persist(payload);
    },
    [canEditRules, data, persist, userId],
  );

  const removeRule = React.useCallback(
    async (ruleId: string) => {
      if (!canEditRules) throw new Error("You do not have permission to edit keyword rules.");
      const previous = data.keywordRules.find((r) => r.id === ruleId);
      let payload = {
        ...data,
        keywordRules: data.keywordRules.filter((r) => r.id !== ruleId),
      };
      payload = appendAuditEvent(payload, {
        actorId: userId ?? "unknown",
        action: "rule.updated",
        targetType: "rule",
        targetId: ruleId,
        metadata: { before: previous ?? null, after: null },
      });
      await persist(payload);
    },
    [canEditRules, data, persist, userId],
  );

  return {
    rules: data.keywordRules,
    isLoading,
    saveRule,
    removeRule,
    canEdit: canEditRules,
  };
}
