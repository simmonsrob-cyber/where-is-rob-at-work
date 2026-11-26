/* Where Is Rob At Work? — configuration (v1)
 * WORKER_URL can also be pasted live in the ⚙ Settings drawer (saved in this browser's localStorage). */
window.ROB_CONFIG = {
  VERSION: 'v1',
  WORKER_URL: 'https://rob-flight-tracker-worker.simmons-rob.workers.dev',

  HOME_TIMEZONE: 'America/New_York',
  HOME_CITY: 'Charleston, SC',
  HOME_AIRPORT: 'CHS',
  BASE_AIRPORT: 'ATL',
  PRE_WORK_COMMUTE_HOURS: 4,
  STANDARD_HOTEL_DRIVE_MINUTES: 30,
  EARLY_WAKEUP_CUTOFF_HOUR: 7,
  TEMP_UNIT: 'F',

  // Timing rules for the state machine (minutes unless noted)
  BOARDING_MINUTES: 40,
  DEPLANING_MINUTES: 10,
  SHORT_TURN_MAX_MINUTES: 45,
  STANDBY_RUN_MINUTES: 30,
  ARRIVE_BEFORE_TAKEOFF_MINUTES: 60,
  LAYOVER_MIN_HOURS: 9,          // ground time that counts as a hotel layover
  COMMUTE_HOME_HOURS: 8,         // how long "Commuting home" shows before switching to "At Home"
  POLL_SECONDS: 60
};
