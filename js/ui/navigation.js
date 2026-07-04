// js/ui/navigation.js

export function initNavigation(UI, state, callbacks) {
  return function navigateTo(screenId) {
    // Hide active screens
    Object.keys(UI.screens).forEach((key) => {
      UI.screens[key].className = "screen";
    });

    if (screenId !== "workout" && state.clockInterval) {
      clearInterval(state.clockInterval);
      state.clockInterval = null;
    }

    // Show target screen
    UI.screens[screenId].className = "screen active";

    // Screen entering callbacks
    if (callbacks[screenId]) {
      callbacks[screenId]();
    }
  };
}
