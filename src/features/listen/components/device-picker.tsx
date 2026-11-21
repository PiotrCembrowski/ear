"use client";

import { useId } from "react";
import { cx } from "@/components/ui/cx";
import { inputClasses } from "@/components/ui/text-field";
import type { InputDevice } from "@/lib/audio-browser/microphone";

export function DevicePicker({
  devices,
  selectedDeviceId,
  onChange,
  disabled,
}: {
  devices: InputDevice[];
  selectedDeviceId: string | null;
  onChange(deviceId: string | null): void;
  disabled?: boolean;
}) {
  const id = useId();
  const unlabelled = devices.length > 0 && devices.every((d) => /^Microphone \d+$/.test(d.label));
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        Input device
      </label>
      <select
        id={id}
        value={selectedDeviceId ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        aria-describedby={unlabelled ? `${id}-hint` : undefined}
        className={cx(inputClasses, "border-line-control pr-8")}
      >
        <option value="">Default microphone</option>
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>
      {unlabelled && (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          Device names appear after you allow microphone access once.
        </p>
      )}
    </div>
  );
}
