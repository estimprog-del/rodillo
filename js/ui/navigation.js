// js/ui/navigation.js

export function initNavigation(UI, state, callbacks) {
  return function navigateTo(screenId) {
    const targetScreen = UI.screens?.[screenId];
    if (!targetScreen) {
      console.warn(`[Navigation] Pantalla no encontrada: ${screenId}`);
      return;
    }
    state.currentScreen = screenId;

    // Asegurarse de que el body puede hacer scroll al cambiar de pantalla
    document.body.style.overflow = '';

    // Hide active screens
    Object.keys(UI.screens).forEach((key) => {
      const screen = UI.screens[key];
      if (screen) screen.className = "screen";
    });

    if (screenId !== "workout" && state.clockInterval) {
      clearInterval(state.clockInterval);
      state.clockInterval = null;
    }

    // Show target screen
    targetScreen.className = "screen active";

    // Ocultar el pie "Ver todas las apps de estimprog" durante las sesiones
    // (mapa, manual, ERG y rodillo tradicional comparten la pantalla "workout")
    const devFooter = document.querySelector(".dev-footer");
    if (devFooter) {
      devFooter.style.display =
        screenId === "workout" || screenId === "remote" ? "none" : "";
    }

    // Scroll al inicio de la nueva pantalla
    window.scrollTo({ top: 0, behavior: "instant" });

    // Screen entering callbacks
    if (callbacks[screenId]) {
      callbacks[screenId]();
    }

    // Permitir actualizaciones PWA diferidas cuando se vuelve a una pantalla segura
    if (typeof window.checkPendingSwUpdate === "function") {
      window.checkPendingSwUpdate();
    }
  };
}
