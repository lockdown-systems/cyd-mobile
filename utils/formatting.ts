export function formatTimestampFull(
  value?: string | number | Date | null
): string {
  if (value == null) return "";

  // Accept ISO strings, epoch milliseconds, or Date objects
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function formatNumber(num: number | null | undefined): string {
  if (num == null) return "0";
  return num.toLocaleString();
}
