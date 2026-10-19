"use client";

import { BellOffIcon, BellRingIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { chatPulse } from "@/actions/messages";
import { Button } from "@/components/ui/button";

const SOUND_KEY = "saunf-chat-sound";
const SOUND_EVENT = "saunf-chat-sound-change";
const PULSE_MS = 8000;

function soundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

let audio: AudioContext | null = null;

/** A short two-note chime, generated in the browser so no audio file is needed. */
export function playMessageSound() {
  if (!soundEnabled()) return;
  try {
    audio ??= new AudioContext();
    const start = audio.currentTime;
    for (const [freq, delay] of [
      [880, 0],
      [1320, 0.12],
    ]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + delay);
      gain.gain.exponentialRampToValueAtTime(0.25, start + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.3);
      osc.connect(gain).connect(audio.destination);
      osc.start(start + delay);
      osc.stop(start + delay + 0.35);
    }
  } catch {
    // Audio unavailable (old browser or blocked): stay silent.
  }
}

/**
 * Mounted once in the app shell. Checks for new chat messages every few seconds on
 * every page; when one arrives from someone else it plays the chime, refreshes the
 * Chat badge and shows the unread count in the tab title.
 */
export function ChatNotifier() {
  const router = useRouter();
  const lastSeen = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    // Browsers only allow sound after the person has interacted with the page.
    const unlock = () => {
      audio ??= new AudioContext();
      void audio.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    let stopped = false;
    const check = async () => {
      const res = await chatPulse();
      if (stopped || !res.ok) return;
      const { latestIncoming, unread } = res.data;
      if (lastSeen.current !== undefined && latestIncoming && latestIncoming !== lastSeen.current) {
        playMessageSound();
        router.refresh();
      }
      lastSeen.current = latestIncoming;
      const title = document.title.replace(/^\(\d+\) /, "");
      document.title = unread > 0 ? `(${unread}) ${title}` : title;
    };
    void check();
    const timer = window.setInterval(check, PULSE_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [router]);

  return null;
}

function subscribe(onChange: () => void) {
  window.addEventListener(SOUND_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SOUND_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Turns the new-message sound on or off for this browser. */
export function ChatSoundToggle() {
  const on = React.useSyncExternalStore(subscribe, soundEnabled, () => true);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="w-full justify-start text-muted-foreground"
      aria-pressed={on}
      onClick={() => {
        try {
          localStorage.setItem(SOUND_KEY, on ? "off" : "on");
        } catch {
          // Storage blocked: the setting can't be saved.
        }
        window.dispatchEvent(new Event(SOUND_EVENT));
        if (!on) playMessageSound();
      }}
    >
      {on ? <BellRingIcon /> : <BellOffIcon />}
      {on ? "Message sound on" : "Message sound off"}
    </Button>
  );
}
