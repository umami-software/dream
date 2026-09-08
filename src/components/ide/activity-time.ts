export const formatLastActiveTime = (
  value: string | number,
  formatter: Intl.RelativeTimeFormat,
  now = Date.now(),
) => {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "";
  }

  const deltaSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (deltaSeconds < 60) {
    return formatter.format(0, "second");
  }

  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return formatter.format(-deltaMinutes, "minute");
  }

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return formatter.format(-deltaHours, "hour");
  }

  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 30) {
    return formatter.format(-deltaDays, "day");
  }

  const deltaMonths = Math.floor(deltaDays / 30);
  if (deltaMonths < 12) {
    return formatter.format(-deltaMonths, "month");
  }

  return formatter.format(-Math.floor(deltaMonths / 12), "year");
};
