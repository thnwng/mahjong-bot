// Time-of-day greeting, keyed to the DEVICE's local hour (the phone's timezone
// via `new Date().getHours()`). Buckets: 04:00–11:59 morning, 12:00–17:59
// afternoon, 18:00–03:59 evening. Pure so the boundaries are unit-testable.
export function greeting(hour: number): string {
  if (hour >= 4 && hour < 12) return "Good Morning";
  if (hour >= 12 && hour < 18) return "Good Afternoon";
  return "Good Evening";
}
