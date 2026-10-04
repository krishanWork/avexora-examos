import { useCallback, useEffect, useState } from "react";

const storageKey = (userId, tenantId) =>
  tenantId ? `dismissed_tenant_announcements_${userId || "anon"}` : `dismissed_announcements_${userId || "anon"}`;

const read = (userId, tenantId) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId, tenantId)) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export default function useDismissedAnnouncements(userId, tenantId) {
  const [dismissed, setDismissed] = useState(() => read(userId, tenantId));

  useEffect(() => {
    setDismissed(read(userId, tenantId));
  }, [userId, tenantId]);

  const dismiss = useCallback(
    (id) => {
      setDismissed((prev) => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        try {
          localStorage.setItem(storageKey(userId, tenantId), JSON.stringify(next));
        } catch {
          /* storage full or blocked — dismissal stays session-only */
        }
        return next;
      });
    },
    [userId, tenantId]
  );

  const restore = useCallback(() => {
    setDismissed([]);
    try {
      localStorage.removeItem(storageKey(userId, tenantId));
    } catch {
      /* ignore */
    }
  }, [userId, tenantId]);

  return { dismissed, dismiss, restore };
}
