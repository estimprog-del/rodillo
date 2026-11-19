export function createSessionTimerController(state) {
  function start(onTick) {
    if (state.timerInterval) clearInterval(state.timerInterval);

    const startTime = Date.now() - (state.elapsedSeconds || 0) * 1000;
    state.lastPauseTime = null;
    state.totalPausedDuration = 0;
    state.timerInterval = setInterval(() => {
      if (!state.isSessionActive || state.isPaused) return;

      const now = Date.now();
      state.elapsedSeconds = Math.floor(
        (now - startTime - (state.totalPausedDuration || 0)) / 1000,
      );
      onTick(now);
    }, 1000);
  }

  function pause() {
    state.isPaused = true;
    state.lastPauseTime = Date.now();
  }

  function resume() {
    state.isPaused = false;
    if (state.lastPauseTime) {
      state.totalPausedDuration += Date.now() - state.lastPauseTime;
      state.lastPauseTime = null;
    }
  }

  function stop() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  return { pause, resume, start, stop };
}
