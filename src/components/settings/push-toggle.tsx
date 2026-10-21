"use client";

import { Loader2Icon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { deletePushSubscription, savePushSubscription, sendTestPushNotification } from "@/actions/push";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/overlays";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type State = "loading" | "unsupported" | "ios-home-screen" | "unconfigured" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

function save(sub: PushSubscription) {
  const json = sub.toJSON();
  return savePushSubscription({
    endpoint: json.endpoint ?? "",
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    userAgent: navigator.userAgent.slice(0, 400),
  });
}

/** Turns browser/phone push notifications on or off for this device. */
export function PushToggle() {
  const [state, setState] = React.useState<State>("loading");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      let next: State;
      if (!supported) next = isIos() && !isStandalone() ? "ios-home-screen" : "unsupported";
      else if (!VAPID_PUBLIC_KEY) next = "unconfigured";
      else if (Notification.permission === "denied") next = "denied";
      else {
        const reg = await registration();
        const sub = await reg.pushManager.getSubscription();
        // Re-save so the server keeps it if it was signed in as someone else before.
        if (sub) await save(sub);
        next = sub ? "on" : "off";
      }
      if (!cancelled) setState(next);
    })().catch(() => {
      if (!cancelled) setState("unsupported");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState(permission === "denied" ? "denied" : "off");
      return;
    }
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
      }));
    const res = await save(sub);
    if (!res.ok) {
      await sub.unsubscribe();
      return void toast.error(res.error);
    }
    setState("on");
    toast.success("Notifications are on for this device");
  };

  const disable = async () => {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await deletePushSubscription(sub.endpoint);
      await sub.unsubscribe();
    }
    setState("off");
  };

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await (on ? enable() : disable());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change notifications on this device.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    const res = await sendTestPushNotification();
    setBusy(false);
    if (!res.ok) toast.error(res.error);
  };

  const hint: Record<State, string> = {
    loading: "Checking this device…",
    unsupported: "This browser doesn't support notifications.",
    "ios-home-screen":
      "On iPhone or iPad: tap Share, then “Add to Home Screen”, open Saunf from there and turn this on.",
    unconfigured: "Not set up on this server yet. Ask your admin.",
    denied: "Notifications are blocked for this site. Allow them in your browser's site settings, then reload.",
    off: "Get a pop-up on this computer or phone when you're assigned a task, or a task you're on gets a comment or change.",
    on: "This device gets a pop-up for your notifications, even when Saunf is closed.",
  };
  const canToggle = state === "on" || state === "off";

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-4">
        <label htmlFor="push_notifications" className="text-sm">
          <span className="font-medium">Notifications on this device</span>
          <span className="block text-xs text-muted-foreground">{hint[state]}</span>
        </label>
        <div className="flex items-center gap-2">
          {busy || state === "loading" ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
          <Switch
            id="push_notifications"
            checked={state === "on"}
            disabled={!canToggle || busy}
            onCheckedChange={(c) => void toggle(c)}
          />
        </div>
      </div>
      {state === "on" ? (
        <div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void test()}>
            Send a test notification
          </Button>
        </div>
      ) : null}
    </div>
  );
}
