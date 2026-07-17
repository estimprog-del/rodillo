/* state.js - Gestión del estado de la aplicación */

export const state = {
  currentUser: null,
  currentSessionId: null,
  currentMode: "ROUTE", // 'ROUTE' | 'MANUAL' | 'TRADITIONAL'
  isMapFollowingRoute: false,
  telemetryBuffer: [],

  isSessionActive: false,
  isPaused: false,
  isAutoPaused: false,
  sessionStartTime: 0,
  elapsedSeconds: 0,
  timerInterval: null,

  currentPower: 0,
  powerBuffer: [],
  power3s: 0,
  currentHr: 0,
  currentCadence: 0,
  currentSpeed: 0.0,
  currentSlope: 0.0,
  targetSlope: 0.0,
  lastSlopeRampTime: 0,
  totalDistance: 0.0,
  totalAscent: 0.0,
  calories: 0,

  powerHistory: [],
  hrHistory: [],
  speedHistory: [],
  elevationHistory: [],
  lastSpeedUpdateTime: 0,
  lastMovementTime: 0,

  timeInPowerZones: [0, 0, 0, 0, 0, 0],

  routePoints: [],
  routeElevations: [],
  routeDistances: [],
  routeTotalAscent: 0,
  currentRouteIndex: 0,
  map: null,
  clockInterval: null,
  realismFactor: 1.0,
  mapType: 'maplibre',
  fontScale: 1.0,
  sensorSmoothing: 500,
  powerZones: [55, 75, 88, 95, 106],
};

export function saveStateToLocalStorage() {
  const persistableState = {
    currentUser: state.currentUser,
    currentMode: state.currentMode,
    realismFactor: state.realismFactor,
    mapType: state.mapType,
    fontScale: state.fontScale,
    sensorSmoothing: state.sensorSmoothing,
    powerZones: state.powerZones,
  };
  localStorage.setItem("rodilloint_state", JSON.stringify(persistableState));
}

export function loadStateFromLocalStorage() {
  const saved = localStorage.getItem("rodilloint_state");
  if (saved) {
    const parsed = JSON.parse(saved);
    state.currentUser = parsed.currentUser;
    state.currentMode = parsed.currentMode;
    state.realismFactor = parsed.realismFactor || 1.0;
    state.mapType = parsed.mapType || 'maplibre';
    state.fontScale = parsed.fontScale || 1.0;
    state.sensorSmoothing = parsed.sensorSmoothing || 500;
    state.powerZones = parsed.powerZones || [55, 75, 88, 95, 106];
  }
}
