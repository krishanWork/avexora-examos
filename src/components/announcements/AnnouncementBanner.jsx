import React from "react";
import AnnouncementCard from "@/components/announcements/AnnouncementCard";
import useAnnouncements from "@/components/announcements/useAnnouncements";
import useDismissedAnnouncements from "@/components/announcements/useDismissedAnnouncements";

// Compact, dismissible strip of the active notices a viewer is allowed to see.
// Role targeting is enforced server-side in readScope(), so this never filters
// by role itself — it only decides which collection to read.
export default function AnnouncementBanner({ userId, tenantId }) {
  const scope = tenantId ? "tenant" : "platform";
  const { announcements } = useAnnouncements({
    scope,
    tenantId: tenantId || null,
    activeOnly: true,
  });
  const { dismissed, dismiss } = useDismissedAnnouncements(userId, scope === "tenant" ? tenantId : null);

  const visible = announcements.filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 mb-6">
      {visible.map((a) => (
        <AnnouncementCard key={a.id} announcement={a} variant="banner" onDismiss={dismiss} />
      ))}
    </div>
  );
}
