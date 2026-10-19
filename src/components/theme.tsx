"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import * as React from "react";
import { Toaster } from "sonner";

import { Button } from "@/components/ui/button";

export type Theme = "light" | "dark";

const STORAGE_KEY = "saunf-theme";

/**
 * Runs before first paint (inlined in <head>) so a saved dark theme never flashes light.
 * Without a saved choice it follows the device setting.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const read = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = React.useSyncExternalStore(subscribe, read, () => "light" as Theme);
  const set = React.useCallback((t: Theme) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Private mode or blocked storage: the choice lasts for this page only.
    }
  }, []);
  return [theme, set];
}

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

export function ThemedToaster() {
  const [theme] = useTheme();
  return <Toaster position="bottom-right" richColors closeButton theme={theme} />;
}
