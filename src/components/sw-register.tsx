"use client";

import { useEffect } from "react";

/** Registers the minimal service worker so the site is installable (PWA). */
export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const BP = process.env.NEXT_PUBLIC_BASE_PATH || "";
    const onLoad = () => {
      navigator.serviceWorker
        .register(`${BP}/sw.js`, { scope: `${BP}/` })
        .catch(() => {
          /* registration is best-effort; app works fully without it */
        });
    };
    if (document.readyState === "complete") onLoad();
    else {
      window.addEventListener("load", onLoad);
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);
  return null;
}
