export function shouldRefreshAnalytics(
  visibilityState: string,
  requestInFlight: boolean,
): boolean {
  return visibilityState === "visible" && !requestInFlight;
}
