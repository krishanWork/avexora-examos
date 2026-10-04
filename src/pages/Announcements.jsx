import React from "react";
import useCurrentUser from "@/hooks/useCurrentUser";
import { APP_ROLES, hasAnyRole, isFamilyRole } from "@/lib/roles";
import useAnnouncements from "@/components/announcements/useAnnouncements";
import useDismissedAnnouncements from "@/components/announcements/useDismissedAnnouncements";
import PlatformAnnouncementsLayout from "@/components/announcements/layouts/PlatformAnnouncementsLayout";
import InstituteAnnouncementsLayout from "@/components/announcements/layouts/InstituteAnnouncementsLayout";
import StaffAnnouncementsLayout from "@/components/announcements/layouts/StaffAnnouncementsLayout";
import FamilyAnnouncementsLayout from "@/components/announcements/layouts/FamilyAnnouncementsLayout";

// The three predicates below take the USER, not a role, because they are
// capability questions and a multi-role account answers them with the union of
// what it holds. They are deliberately not `getAppRole(user) === x`: a teacher
// who is also an exam coordinator is entitled to see every tenant notice, and
// reading the primary role alone would hide them notices they are entitled to.
//
// Authoring is the platform owner's own surface. `employee` used to qualify here
// through isPlatformRole(), which granted it a platform-scope read (a scope its
// assigned-tenant boundary no longer admits, since platform notices carry no
// tenant) plus create/update controls the server refuses. The route gate no
// longer admits the role either; this stays explicit so the two cannot drift.
const AUTHOR_ROLES = [APP_ROLES.SUPER_ADMIN, APP_ROLES.SCHOOL_ADMIN];
const isAuthorRole = (user) => hasAnyRole(user, AUTHOR_ROLES);
// Mirrors PRIVILEGED_TENANT_ROLES on the server, which is what actually scopes
// the read: an exam-workflow role sees every tenant announcement.
const EVERY_TENANT_NOTICE_ROLES = [APP_ROLES.SCHOOL_ADMIN, APP_ROLES.PRINCIPAL, APP_ROLES.EXAM_COORDINATOR];
const seesEveryTenantNotice = (user) => hasAnyRole(user, EVERY_TENANT_NOTICE_ROLES);

export default function Announcements() {
  const { user, loading: userLoading } = useCurrentUser();

  // Explicitly the platform owner rather than isPlatformRole(): employee is a
  // platform role with no institution of its own, and asking it for platform
  // scope produced a query its assigned-tenant boundary rejects outright. The
  // route gate keeps it off this page; naming the owner here means a later edit
  // that re-admits the role cannot quietly restore the wrong scope.
  const platformScope = hasAnyRole(user, [APP_ROLES.SUPER_ADMIN]);
  const tenantId = platformScope ? null : user?.tenant_id || null;

  const { announcements, loading, saving, create, update, setActive, remove } = useAnnouncements({
    scope: platformScope ? "platform" : "tenant",
    tenantId,
    activeOnly: !isAuthorRole(user),
  });

  const { dismissed, dismiss, restore } = useDismissedAnnouncements(
    user?.id,
    platformScope ? null : tenantId
  );

  if (userLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8">
        <div className="h-8 w-56 bg-stone-200 rounded-lg animate-pulse mb-6" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-stone-200/70 rounded-2xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-stone-200/70 rounded-xl animate-pulse" />
      </div>
    );
  }

  const isFamilyUser = isFamilyRole(user);
  const width = isFamilyUser ? "max-w-2xl" : "max-w-7xl";
  const busy = loading;

  const authorProps = {
    announcements,
    loading: busy,
    saving,
    onSave: async (data, editing) => {
      if (editing?.id) await update(editing.id, data);
      else await create(data);
    },
    onToggle: (announcement) => setActive(announcement, !announcement.is_active),
    onDelete: (announcement) => remove(announcement.id),
  };

  let body = null;
  if (isFamilyUser) {
    body = (
      <FamilyAnnouncementsLayout
        user={user}
        announcements={announcements}
        loading={busy}
        dismissed={dismissed}
        onDismiss={dismiss}
        onRestore={restore}
      />
    );
  } else if (platformScope) {
    body = <PlatformAnnouncementsLayout {...authorProps} />;
  } else if (hasAnyRole(user, [APP_ROLES.SCHOOL_ADMIN])) {
    body = <InstituteAnnouncementsLayout {...authorProps} />;
  } else {
    body = (
      <StaffAnnouncementsLayout
        announcements={announcements}
        loading={busy}
        showTargets={seesEveryTenantNotice(user)}
        dismissed={dismissed}
        onDismiss={dismiss}
        onRestore={restore}
      />
    );
  }

  return (
    <div className={`mx-auto px-4 sm:px-6 py-6 md:py-8 ${width}`}>
      {body}
    </div>
  );
}
