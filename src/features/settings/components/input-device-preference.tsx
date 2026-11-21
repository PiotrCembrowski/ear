"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DevicePicker } from "@/features/listen/components/device-picker";
import { INPUT_DEVICE_STORAGE_KEY } from "@/lib/audio-browser/constants";
import { listInputDevices, type InputDevice } from "@/lib/audio-browser/microphone";

/**
 * Default microphone FOR THIS BROWSER. Device ids are specific to each
 * browser and site, so this is stored locally rather than in the profile.
 * The Listen screen uses (and updates) the same setting.
 */
export function InputDevicePreference() {
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void listInputDevices()
      .then((list) => {
        if (!current) return;
        setDevices(list);
        try {
          setSelected(window.localStorage.getItem(INPUT_DEVICE_STORAGE_KEY));
        } catch {
          // Storage blocked: fall back to the default device.
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);

  function choose(deviceId: string | null) {
    setSelected(deviceId);
    try {
      if (deviceId) window.localStorage.setItem(INPUT_DEVICE_STORAGE_KEY, deviceId);
      else window.localStorage.removeItem(INPUT_DEVICE_STORAGE_KEY);
      setMessage("Saved for this browser.");
    } catch {
      setMessage("This browser blocks site storage, so the choice can't be remembered.");
    }
  }

  /** Browsers hide device names until the site has had microphone access once. */
  async function revealNames() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop(); // released immediately
      setDevices(await listInputDevices());
      setMessage(null);
    } catch {
      setMessage("Microphone access was not allowed, so device names can't be shown.");
    }
  }

  const unlabelled = devices.length > 0 && devices.every((d) => /^Microphone \d+$/.test(d.label));
  return (
    <div className="flex max-w-md flex-col gap-3">
      <DevicePicker devices={devices} selectedDeviceId={selected} onChange={choose} />
      {unlabelled && (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => void revealNames()}>
          Show device names
        </Button>
      )}
      <p className="text-xs text-ink-muted">
        Stored only in this browser. {unlabelled && "Showing names asks for microphone access once and turns the microphone off straight away."}
      </p>
      {message && (
        <p role="status" className="text-sm text-ink-muted">
          {message}
        </p>
      )}
    </div>
  );
}
