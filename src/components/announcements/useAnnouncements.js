import { useCallback, useEffect, useState } from "react";
import { appClient } from "@/api/appClient";

const COLLECTION_BY_SCOPE = {
  platform: "Announcement",
  tenant: "TenantAnnouncement",
};

const asList = (result) => (Array.isArray(result) ? result : []);

export default function useAnnouncements({ scope = "platform", tenantId = null, activeOnly = false } = {}) {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const collection = COLLECTION_BY_SCOPE[scope] || COLLECTION_BY_SCOPE.platform;

  const load = useCallback(async (signal) => {
    const entity = appClient.entities[collection];
    const query = {};
    if (scope === "tenant" && tenantId) query.tenant_id = tenantId;
    if (activeOnly) query.is_active = true;
    try {
      const result = await entity.filter(query, "-created_date");
      if (signal?.aborted) return;
      setAnnouncements(asList(result));
      setError(null);
    } catch (e) {
      if (signal?.aborted) return;
      setAnnouncements([]);
      setError(e);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [collection, scope, tenantId, activeOnly]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const withSaving = useCallback(async (mutate) => {
    setSaving(true);
    try {
      await mutate(appClient.entities[collection]);
      await load();
    } finally {
      setSaving(false);
    }
  }, [collection, load]);

  const create = useCallback(
    (data) =>
      withSaving((entity) =>
        entity.create(scope === "tenant" && tenantId ? { ...data, tenant_id: tenantId } : data)
      ),
    [withSaving, scope, tenantId]
  );

  const update = useCallback(
    (id, data) => withSaving((entity) => entity.update(id, data)),
    [withSaving]
  );

  const setActive = useCallback(
    (announcement, isActive) => withSaving((entity) => entity.update(announcement.id, { is_active: isActive })),
    [withSaving]
  );

  const remove = useCallback(
    (id) => withSaving((entity) => entity.delete(id)),
    [withSaving]
  );

  return {
    announcements,
    loading,
    error,
    saving,
    reload: () => load(),
    create,
    update,
    setActive,
    remove,
  };
}
