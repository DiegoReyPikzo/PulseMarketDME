export type LastQueryTimePresentation = {
  text: string;
  timeZoneLabel: string;
};

export function formatLastQueryTime(
  instant: string,
  timeZone: string | null,
): LastQueryTimePresentation {
  if (timeZone === null) {
    return {
      text: `${instant.slice(0, 10)} ${instant.slice(11, 19)} UTC`,
      timeZoneLabel: "UTC",
    };
  }

  return {
    text: new Intl.DateTimeFormat("es", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone,
    }).format(new Date(instant)),
    timeZoneLabel: timeZone,
  };
}
