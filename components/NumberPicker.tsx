"use client";

// A compact 0..max dropdown number picker (dora, honba, ...). Replaces long
// chip rows where the value is just an integer count.

import { haptic } from "@/lib/telegram";

export function NumberPicker({
  value,
  onChange,
  min = 0,
  max,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max: number;
}) {
  return (
    <select
      className="text-input"
      value={value}
      onChange={(e) => { haptic("selection"); onChange(parseInt(e.target.value, 10)); }}
    >
      {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
    </select>
  );
}
