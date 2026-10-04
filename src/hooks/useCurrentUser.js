import { useState, useEffect, useCallback } from "react";
import { appClient } from "@/api/appClient";
import { applyImpersonation } from "@/lib/impersonation";

export default function useCurrentUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const me = await appClient.auth.me();
      setUser(applyImpersonation(me));
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { user, loading, refresh };
}