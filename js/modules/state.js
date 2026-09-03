/* state.js - Gestión del estado de la aplicación */

import { DEFAULT_VIRTUAL_GEAR } from "./virtualGears.js";

export const state = {
  currentUser: null,
  currentSessionId: null,
  lastSavedSessionId: null,
  summaryReturnScreen: "dashboard",
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
  mapViewMode: '3D_AEREO',
  workoutLayout: 'auto',
  workoutLayouts: {},
  workoutPanels: { virtual: true, progress: true, elevation: true, upcoming: true, remote: true },
  workoutPanelsByUser: {},
  fullscreenPreference: false,
  fullscreenByUser: {},
  fullscreenFilePickerActive: false,
  fontScale: 1.0,
  sensorSmoothing: 3000,
  powerZones: [55, 75, 88, 95, 106],
  countdownDuration: 3,
  startOnMovement: false,
  manualMode: 'SLOPE',
  targetWatts: 150,
  virtualGear: DEFAULT_VIRTUAL_GEAR,
  virtualGearByUser: {},
  virtualGearsEnabled: true,
  initialVirtualGear: DEFAULT_VIRTUAL_GEAR,
};

export function saveStateToLocalStorage() {
  const userKey = state.currentUser?.uuid || state.currentUser?.id;
  if (userKey) {
    state.workoutLayouts[userKey] = state.workoutLayout;
    state.workoutPanelsByUser[userKey] = state.workoutPanels;
    state.fullscreenByUser[userKey] = state.fullscreenPreference;
  }

  const persistableState = {
    currentUser: state.currentUser,
    currentMode: state.currentMode,
    realismFactor: state.realismFactor,
    mapType: state.mapType,
    mapViewMode: state.mapViewMode,
    workoutLayout: state.workoutLayout,
    workoutLayouts: state.workoutLayouts,
    workoutPanelsByUser: state.workoutPanelsByUser,
    fullscreenByUser: state.fullscreenByUser,
    fontScale: state.fontScale,
    sensorSmoothing: state.sensorSmoothing,
    powerZones: state.powerZones,
    powerZones: state.powerZones,
    countdownDuration: state.countdownDuration,
    startOnMovement: state.startOnMovement,
    manualMode: state.manualMode,
    targetWatts: state.targetWatts,
    virtualGearByUser: state.virtualGearByUser,
    virtualGearsEnabled: state.virtualGearsEnabled,
    initialVirtualGear: state.initialVirtualGear,
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
    state.mapViewMode = ['2D', '3D_AEREO', '3D_FPV'].includes(parsed.mapViewMode)
      ? parsed.mapViewMode
      : state.mapType === 'leaflet' ? '2D' : '3D_AEREO';
    state.workoutLayout = parsed.workoutLayout || 'auto';
    state.workoutLayouts = parsed.workoutLayouts || {};
    state.workoutPanelsByUser = parsed.workoutPanelsByUser || {};
    state.fullscreenByUser = parsed.fullscreenByUser || {};
    const userKey = state.currentUser?.uuid || state.currentUser?.id;
    if (userKey && state.workoutLayouts[userKey]) {
      state.workoutLayout = state.workoutLayouts[userKey];
    }
    if (userKey && state.workoutPanelsByUser[userKey]) {
      state.workoutPanels = {
        ...state.workoutPanels,
        ...state.workoutPanelsByUser[userKey],
      };
    }
    state.fullscreenPreference = userKey
      ? state.fullscreenByUser[userKey] === true
      : false;
    state.fontScale = parsed.fontScale || 1.0;
    state.sensorSmoothing = parsed.sensorSmoothing || 3000;
    state.powerZones = parsed.powerZones || [55, 75, 88, 95, 106];
    state.countdownDuration = parsed.countdownDuration || 3;
    state.startOnMovement = parsed.startOnMovement !== undefined ? parsed.startOnMovement : false;
    state.manualMode = parsed.manualMode || 'SLOPE';
    state.targetWatts = parsed.targetWatts || 150;
    state.virtualGearByUser = parsed.virtualGearByUser || {};
    state.virtualGearsEnabled = parsed.virtualGearsEnabled !== false;
    state.initialVirtualGear = Number.isFinite(Number(parsed.initialVirtualGear))
      ? Math.max(1, Math.min(24, Number(parsed.initialVirtualGear)))
      : DEFAULT_VIRTUAL_GEAR;
    state.virtualGear = state.virtualGearByUser[userKey] || DEFAULT_VIRTUAL_GEAR;
  }
}

export function loadWorkoutLayoutForUser(user) {
  const userKey = user?.uuid || user?.id;
  state.workoutLayout = (userKey && state.workoutLayouts[userKey]) || "auto";
  state.workoutPanels = {
    virtual: true,
    progress: true,
    elevation: true,
    upcoming: true,
    remote: true,
    ...((userKey && state.workoutPanelsByUser[userKey]) || {}),
  };
  state.fullscreenPreference = (userKey && state.fullscreenByUser[userKey]) === true;
  state.virtualGear = (userKey && state.virtualGearByUser[userKey]) || DEFAULT_VIRTUAL_GEAR;
}
