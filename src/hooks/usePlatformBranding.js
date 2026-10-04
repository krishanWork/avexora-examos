import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";

// Loads the platform (Avexora) branding record and applies the favicon.
export default function usePlatformBranding() {
  const [branding, setBranding] = useState(null);

  useEffect(() => {
    appClient.entities.PlatformBranding.list("-updated_date", 1)
      .then((rows) => {
        const b = rows[0] || null;
        setBranding(b);
        if (b?.favicon_url) {
          let link = document.querySelector("link[rel~='icon']");
          if (!link) {
            link = document.createElement("link");
            link.rel = "icon";
            document.head.appendChild(link);
          }
          link.href = b.favicon_url;
        }
      })
      .catch(() => {});
  }, []);

  return branding;
}