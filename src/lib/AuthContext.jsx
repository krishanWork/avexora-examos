import React, { createContext, useContext, useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
const AuthContext = createContext();
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  const checkUserAuth = async () => {
    try {
      setIsLoadingAuth(true);
      const me = await appClient.auth.me();
      setUser(me);
      setAuthError(null);
    } catch (error) {
      setUser(null);
      // A role-less account is a real, actionable state — the token is valid but
      // carries no entitlements. Keep the session (so "retry" and "sign out"
      // work) and surface it distinctly instead of tearing down the token and
      // reporting it as a failed authentication.
      if (error.data?.code === "NO_ASSIGNED_ROLE") {
        setAuthError({ type: "no_assigned_role", message: error.message });
        return;
      }
      // Same reasoning for an unverified address, and keeping the token is not
      // merely convenient here: /api/auth/resend-verification is authenticated,
      // so discarding the session would remove the only way the user can ask for
      // another link. Dropping it would strand the account permanently.
      if (error.data?.code === "EMAIL_UNVERIFIED") {
        setAuthError({
          type: "email_unverified",
          message: error.message,
          email: error.data?.email || null,
        });
        return;
      }
      localStorage.removeItem("avexora_examos_token");
      if (error.status === 401) {
        setAuthError({ type: "auth_required", message: error.message });
      } else {
        setAuthError({ type: "user_not_registered", message: error.message || "Authentication failed" });
      }
    } finally {
      setIsLoadingAuth(false);
    }
  };

  useEffect(() => {
    checkUserAuth();
  }, []);

  const logout = async (redirect = true) => {
    setUser(null);
    await appClient.auth.logout(redirect ? "/login" : undefined);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: Boolean(user),
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      appPublicSettings: null,
      authChecked: !isLoadingAuth,
      logout,
      navigateToLogin: () => appClient.auth.redirectToLogin(),
      checkUserAuth,
      checkAppState: checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
export const useAuth = () => { const context = useContext(AuthContext); if (!context) throw new Error("useAuth must be used within an AuthProvider"); return context; };