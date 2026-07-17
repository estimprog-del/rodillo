
// --- Countdown Timer ---
function startCountdown(onComplete) {
  const countdownOverlay = document.getElementById("workout-countdown-overlay");
  const countdownText = document.getElementById("countdown-text");

  if (!countdownOverlay || !countdownText) {
    console.error("Countdown elements not found!");
    if (onComplete) onComplete();
    return;
  }

  let count = 3;
  countdownOverlay.style.display = "flex";
  countdownText.textContent = count;

  // Audio context for simple beep sounds
  let audioContext = null;
  const playBeep = () => {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.00001,
      audioContext.currentTime + 0.1,
    );
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.1);
  };

  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      countdownText.textContent = count;
      playBeep();
    } else {
      clearInterval(timer);
      countdownText.textContent = "¡Listo!";
      playBeep();
      setTimeout(() => {
        countdownOverlay.style.display = "none";
        if (onComplete) onComplete();
      }, 1000);
    }
  }, 1000);
}

// --- WORKOUT SCREEN ACTIVATION ---
function enterWorkoutScreen() {
  state.powerBuffer = [];
  state.powerHistory = [];
  state.hrHistory = [];
  state.speedHistory = [];
  state.elapsedSeconds = 0;
  state.totalDistance = 0.0;
  state.totalAscent = 0.0;
  state.currentRouteIndex = 0;
  state.currentSlope = 0.0;
  state.targetSlope = 0.0;
  state.lastSlopeRampTime = 0;
  state.timeInPowerZones = [0, 0, 0, 0, 0, 0];
  state.isPaused = false;
  state.isAutoPaused = false;
  state.isSessionActive = false;
  state.routeTotalAscent = 0;

  setElText("workout-timer", "00:00:00");
  setElText("metrics-power", "0");
  setElText("metrics-hr", "0");
  setElText("metrics-cadence", "0");
  setElText("metrics-speed", "0.0");
  setElText("metrics-power-avg", "0 Ø");
  setElText("metrics-hr-avg", "0 Ø");
  setElText("metrics-speed-avg", "0.0 Ø");
  setElText("submetrics-distance", "0.00 km");
  setElText("submetrics-ascent", "0 m");
  setElText("submetrics-remaining", "--");
  setElText("submetrics-remaining-ascent", "--");
  setElDisplay("workout-autopause-label", "none");

  updateClock();
  if (state.clockInterval) clearInterval(state.clockInterval);
  state.clockInterval = setInterval(updateClock, 30000);

  onStatusChanged("TRAINER", BleManager.connections.TRAINER.status);
  onStatusChanged("HRM", BleManager.connections.HRM.status);
  onStatusChanged("POWER", BleManager.connections.POWER.status);
  onStatusChanged("CSC", BleManager.connections.CSC.status);

  if (BleManager.simulator.isActive) {
    setElDisplay("virtual-trainer-panel", "block");

    // Lógica para el slider de realismo en sesión
    const realismSliderSession = document.getElementById("realism-slider-session");
    const realismValueSession = document.getElementById("realism-value-session");

    if (realismSliderSession && realismValueSession) {
      realismSliderSession.value = Math.round((state.realismFactor || 1.0) * 100);
      realismValueSession.textContent = `${realismSliderSession.value}%`;

      realismSliderSession.oninput = (e) => {
        const value = e.target.value;
        realismValueSession.textContent = `${value}%`;
        state.realismFactor = parseFloat(value) / 100;
        saveStateToLocalStorage();
      };
    }
  } else {
    setElDisplay("virtual-trainer-panel", "none");
  }

  configureWorkoutHudForMode();

  const isRouteMode = state.currentMode === "ROUTE";
  const ghostBanner = document.getElementById("ghost-banner");
  if (ghostBanner) ghostBanner.classList.remove("visible");

  if (isRouteMode) {
    initLeafletMap();
    ChartsManager.initUpcomingChart("upcoming-chart-inner");

    // Mostrar footer de elevación y cargar gráfico si hay puntos
    if (state.routePoints.length > 0) {
      setElDisplay("hud-elevation-footer", "block");
      ChartsManager.initElevationChart(
        "elevation-chart",
        state.routeDistances,
        state.routeElevations,
      );
    }

    setTimeout(() => {
      if (state.map) state.map.invalidateSize();
      if (state.routePoints.length > 0) {
        drawRouteOnMap();
        refreshUpcomingPreview(0);
        updateRouteProgressHud();
      }
    }, 150);
  }

  updatePauseButton("▶ Empezar");
}
