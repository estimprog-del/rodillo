/* state.js - Gestión del estado de la aplicación */

export const state = {
  currentUser: null,
  currentSessionId: null,
  currentMode: "ROUTE", // 'ROUTE' | 'MANUAL' | 'TRADITIONAL'
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
  clockInterval: null
};

export function saveStateToLocalStorage() {
  const persistableState = {
    currentUser: state.currentUser,
    currentMode: state.currentMode,
  };
  localStorage.setItem("rodilloint_state", JSON.stringify(persistableState));
}

export function loadStateFromLocalStorage() {
  const saved = localStorage.getItem("rodilloint_state");
  if (saved) {
    const parsed = JSON.parse(saved);
    state.currentUser = parsed.currentUser;
    state.currentMode = parsed.currentMode;
  }
}
