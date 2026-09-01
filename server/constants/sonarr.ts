export const SONARR_MONITOR_TYPES = [
  'all',
  'future',
  'missing',
  'existing',
  'pilot',
  'firstSeason',
  'latestSeason',
  'none',
] as const;

export type SonarrMonitorType = (typeof SONARR_MONITOR_TYPES)[number];
