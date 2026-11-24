import {
  RemoteRoomClient,
  getRemoteRoomId,
  isRemoteAuthConfigured,
} from "./remoteRoom.js";
import { showConfirm } from "./toast.js";

export function initializeRemoteController() {
  document.documentElement.classList.add("remote-route");
  document.body.classList.add("remote-route");
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });
  document.getElementById("screen-remote")?.classList.add("active");

  // En el mando solo se controla la radio del host; ocultar el reproductor local
  // para evitar duplicar controles de radio en el mismo dispositivo.
  const localAudioWidget = document.getElementById("audio-player-widget");
  if (localAudioWidget) {
    localAudioWidget.hidden = true;
    localAudioWidget.style.display = "none";
  }

  const roomId = getRemoteRoomId();
  const status = document.getElementById("remote-status");
  const label = document.getElementById("remote-room-label");
  const reconnectButton = document.getElementById("btn-remote-reconnect");
  const authConfigured = isRemoteAuthConfigured();
  const client = roomId && authConfigured
    ? new RemoteRoomClient(roomId, "remote")
    : null;
  document.querySelectorAll("#remote-controls button").forEach((button) => {
    button.disabled = !client;
  });
  let isConnecting = false;
  let wasHidden = false;
  let connectionState = "initialized";
  let sessionFinished = false;
  let remoteWakeLock = null;
  const setRemoteStatus = (text, state = "") => {
    if (status) {
      status.textContent = text;
      if (state) connectionState = state;
      status.dataset.connectionState = connectionState;
    }
    if (reconnectButton) {
      reconnectButton.disabled = isConnecting || !client;
      reconnectButton.hidden = sessionFinished ||
        connectionState === "connected" ||
        connectionState === "connecting" ||
        connectionState === "initialized";
      reconnectButton.textContent = isConnecting ? "…" : "↻";
    }
  };
  const requestRemoteWakeLock = async () => {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try {
      remoteWakeLock = await navigator.wakeLock.request("screen");
      remoteWakeLock.addEventListener("release", () => {
        remoteWakeLock = null;
      }, { once: true });
    } catch (error) {
      console.warn("[Mando móvil] No se pudo mantener la pantalla activa:", error);
    }
  };
  void requestRemoteWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      wasHidden = true;
      return;
    }
    if (document.visibilityState === "visible") {
      void requestRemoteWakeLock();
      if (wasHidden && client) {
        wasHidden = false;
        void connectRemote(true);
      }
    }
  });
  const requestRemoteFullscreen = () => {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  };
  document.addEventListener("click", requestRemoteFullscreen, { once: true });

  if (label) {
    label.textContent = !roomId
      ? "Falta el identificador de sala"
      : authConfigured
        ? `Sala: ${roomId}`
        : "Mando no disponible";
  }
  setRemoteStatus(
    client
      ? "Mando preparado"
      : !authConfigured
        ? "Requiere un endpoint seguro de autenticación Ably"
        : "Enlace de sala no válido",
  );

  const emitGearCommand = async (eventName) => {
    if (!client) return;
    try {
      await client.emit(eventName, {});
      setRemoteStatus("Orden enviada a Ably");
    } catch (error) {
      console.error(`[Mando móvil] No se pudo enviar ${eventName}:`, error);
      setRemoteStatus(`No enviada: ${error.message}`, "disconnected");
    }
  };
  const emitGearChange = async (direction) => {
    if (!client) return;
    try {
      await client.emit("CHANGE_GEAR", { direction });
      setRemoteStatus(`Orden enviada a Ably: ${direction === "up" ? "subir" : "bajar"}`);
    } catch (error) {
      console.error("[Mando móvil] No se pudo enviar el cambio de marcha:", error);
      setRemoteStatus(`No enviada: ${error.message}`, "disconnected");
    }
  };

  const showRemoteSummary = (summary) => {
    const controls = document.getElementById("remote-controls");
    const panel = document.getElementById("remote-summary");
    if (!controls || !panel) return;
    controls.hidden = true;
    panel.hidden = false;
    sessionFinished = true;
    document.querySelector(".remote-controller")?.classList.add("remote-session-finished");
    const values = {
      "remote-summary-duration": summary.duration || "--",
      "remote-summary-distance": `${Number(summary.distance || 0).toFixed(2)} km`,
      "remote-summary-speed": `${Number(summary.avgSpeed || 0).toFixed(1)} km/h`,
      "remote-summary-max-speed": `${Number(summary.maxSpeed || 0).toFixed(1)} km/h`,
      "remote-summary-power": `${Math.round(Number(summary.avgPower || 0))} W`,
      "remote-summary-max-power": `${Math.round(Number(summary.maxPower || 0))} W`,
      "remote-summary-hr": `${Math.round(Number(summary.avgHr || 0))} bpm`,
      "remote-summary-max-hr": `${Math.round(Number(summary.maxHr || 0))} bpm`,
      "remote-summary-ascent": `${Math.round(Number(summary.ascent || 0))} m`,
      "remote-summary-calories": `${Math.round(Number(summary.calories || 0))} kcal`,
      "remote-summary-training-load": `${Math.round(Number(summary.np || 0))} W / ${Math.round(Number(summary.tss || 0))}`,
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    });
    setRemoteStatus("Sesión finalizada");
  };

  const showRemoteAccessDenied = (payload) => {
    if (payload?.targetSenderId &&
        payload.targetSenderId !== client?.getConnectionId()) {
      return;
    }
    document.getElementById("remote-controls")?.setAttribute("hidden", "");
    setRemoteStatus("Mando no autorizado: ya hay otro conectado", "failed");
  };

  const connectRemote = async (forceReconnect = false) => {
    if (!client || isConnecting) return;
    isConnecting = true;
    setRemoteStatus(forceReconnect ? "Reconectando con la sala..." : "Conectando con la sala...");
    try {
      if (forceReconnect) await client.reconnect();
      else await client.connect();
      setRemoteStatus("Conectado a la sala", "connected");
    } catch (error) {
      console.error("[Mando móvil] No se pudo conectar con Ably:", error);
      setRemoteStatus(
        error?.message?.includes("Falta configurar")
          ? "Ably no está configurado"
          : `Sin conexión: ${error?.message || "error de conexión"}`,
        "failed",
      );
    } finally {
      isConnecting = false;
      if (reconnectButton) reconnectButton.disabled = !client;
    }
  };

  client?.onConnectionStateChange((change) => {
    const stateMessages = {
      connecting: "Conectando con Ably...",
      connected: "Conectado a la sala",
      disconnected: "Conexión perdida. Reconectando...",
      suspended: "Conexión suspendida. Pulsa Reconectar.",
      closing: "Cerrando conexión...",
      closed: "Desconectado. Pulsa Reconectar.",
      failed: `Error de conexión: ${change.reason?.message || "Ably no disponible"}`,
    };
    connectionState = change.current;
    setRemoteStatus(
      stateMessages[change.current] || `Estado de conexión: ${change.current}`,
      "",
    );
  });
  document.getElementById("btn-remote-gear-up")?.addEventListener("click", () => emitGearChange("up"));
  document.getElementById("btn-remote-gear-down")?.addEventListener("click", () => emitGearChange("down"));
  document.getElementById("btn-remote-pause")?.addEventListener("click", () => emitGearCommand("TOGGLE_PAUSE"));
  document.getElementById("btn-remote-stop")?.addEventListener("click", async () => {
    if (await showConfirm("¿Finalizar la sesión?", "Finalizar", "danger")) void emitGearCommand("STOP_SESSION");
  });
  reconnectButton?.addEventListener("click", () => void connectRemote(true));

  // --- Panel flotante de control de radio ---
  const radioStyle = document.createElement("style");
  radioStyle.textContent = `
    .remote-radio-widget { position: fixed; right: 16px; bottom: 16px; z-index: 9999; touch-action: none; }
    .remote-radio-toggle { width: 52px; height: 52px; border-radius: 50%; border: none; background: #1f2937; color: #fff; font-size: 24px; cursor: grab; box-shadow: 0 4px 12px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; }
    .remote-radio-toggle:active { cursor: grabbing; }
    .remote-radio-panel { position: absolute; right: 0; bottom: 60px; width: 240px; background: #111827; color: #fff; border-radius: 12px; padding: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 8px; }
    .remote-radio-panel[hidden] { display: none; }
    .remote-radio-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.9; }
    .remote-radio-controls { display: flex; justify-content: space-between; gap: 8px; }
    .remote-radio-controls button, .remote-radio-volume button { background: #374151; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; font-size: 16px; cursor: pointer; }
    .remote-radio-controls button:active, .remote-radio-volume button:active { background: #4b5563; }
    .remote-radio-volume { display: flex; align-items: center; gap: 8px; }
    .remote-radio-volume input { flex: 1; }
    .remote-btn-pulse { animation: remoteBtnPulse 0.18s ease; }
    @keyframes remoteBtnPulse { 0% { transform: scale(1); } 50% { transform: scale(0.9); } 100% { transform: scale(1); } }
  `;
  document.head.appendChild(radioStyle);

  const radioWidget = document.createElement("div");
  radioWidget.className = "remote-radio-widget";
  radioWidget.innerHTML = `
    <button id="remote-radio-toggle" class="remote-radio-toggle" type="button" aria-label="Radio">📻</button>
    <div id="remote-radio-panel" class="remote-radio-panel" hidden>
      <div class="remote-radio-title" id="remote-radio-title">Radio</div>
      <div class="remote-radio-controls">
        <button id="remote-radio-prev" type="button" aria-label="Anterior">⏮</button>
        <button id="remote-radio-play" type="button" aria-label="Play/Pausa">▶</button>
        <button id="remote-radio-next" type="button" aria-label="Siguiente">⏭</button>
      </div>
      <div class="remote-radio-volume">
        <button id="remote-radio-mute" type="button" aria-label="Silenciar">🔊</button>
        <input id="remote-radio-volume" type="range" min="0" max="100" value="100" />
      </div>
    </div>
  `;
  document.body.appendChild(radioWidget);

  // Restaurar posición guardada
  try {
    const raw = localStorage.getItem("rodilloint_remote_radio_pos");
    if (raw) {
      const pos = JSON.parse(raw);
      if (pos && (pos.right || pos.bottom)) {
        radioWidget.style.right = pos.right || "16px";
        radioWidget.style.bottom = pos.bottom || "16px";
        radioWidget.style.left = "auto";
        radioWidget.style.top = "auto";
      }
    }
  } catch (e) { /* noop */ }

  const radioToggle = document.getElementById("remote-radio-toggle");
  const radioPanel = document.getElementById("remote-radio-panel");
  const radioTitle = document.getElementById("remote-radio-title");
  const radioPlay = document.getElementById("remote-radio-play");
  const radioPrev = document.getElementById("remote-radio-prev");
  const radioNext = document.getElementById("remote-radio-next");
  const radioMute = document.getElementById("remote-radio-mute");
  const radioVolume = document.getElementById("remote-radio-volume");

  // Minimizar/expandir
  let radioExpanded = false;
  const setRadioExpanded = (expanded) => {
    radioExpanded = expanded;
    radioPanel.hidden = !expanded;
  };
  radioToggle.addEventListener("click", (e) => {
    if (radioToggle.dataset.dragged === "true") { radioToggle.dataset.dragged = "false"; return; }
    setRadioExpanded(!radioExpanded);
  });

  // Draggable
  let dragging = false, moved = false, startX = 0, startY = 0, startRight = 0, startBottom = 0;
  radioToggle.style.touchAction = "none";
  radioToggle.addEventListener("pointerdown", (e) => {
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    const rect = radioWidget.getBoundingClientRect();
    startRight = window.innerWidth - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    const onMove = (ev) => {
      if (!dragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) { moved = true; radioToggle.dataset.dragged = "true"; }
      if (moved) {
        let newRight = startRight - dx;
        let newBottom = startBottom - dy;
        const w = radioWidget.offsetWidth, h = radioWidget.offsetHeight;
        const maxR = window.innerWidth - w, maxB = window.innerHeight - h;
        if (newRight < 0) newRight = 0;
        if (newBottom < 0) newBottom = 0;
        if (newRight > maxR) newRight = maxR;
        if (newBottom > maxB) newBottom = maxB;
        radioWidget.style.right = newRight + "px";
        radioWidget.style.bottom = newBottom + "px";
        radioWidget.style.left = "auto";
        radioWidget.style.top = "auto";
      }
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (moved) {
        setTimeout(() => { radioToggle.dataset.dragged = "false"; }, 300);
        try { localStorage.setItem("rodilloint_remote_radio_pos", JSON.stringify({ right: radioWidget.style.right, bottom: radioWidget.style.bottom })); } catch (e) { /* noop */ }
      }
      moved = false;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  // Enviar comandos
  const emitRadio = async (event, payload = {}) => {
    if (!client) return;
    try { await client.emit(event, payload); } catch (e) { console.error("[Mando Radio] No se pudo enviar:", e); }
  };

  radioPlay.addEventListener("click", () => emitRadio("RADIO_PLAY_PAUSE"));
  radioPrev.addEventListener("click", () => emitRadio("RADIO_PREV"));
  radioNext.addEventListener("click", () => emitRadio("RADIO_NEXT"));
  radioMute.addEventListener("click", () => emitRadio("RADIO_MUTE"));

  let volumeTimer = null;
  radioVolume.addEventListener("input", () => {
    if (volumeTimer) clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => {
      emitRadio("RADIO_VOLUME", { volume: Number(radioVolume.value) / 100 });
    }, 150);
  });

  // Recibir estado
  const updateRadioUI = (s) => {
    if (!s) return;
    if (radioTitle) radioTitle.textContent = s.title || (s.playing ? "Reproduciendo" : "Radio");
    if (radioPlay) radioPlay.textContent = s.playing ? "⏸" : "▶";
    if (typeof s.volume === "number") {
      radioVolume.value = Math.round(s.volume * 100);
      radioMute.textContent = s.volume <= 0 ? "🔇" : "🔊";
    }
  };
  if (client) {
    client.on("RADIO_STATE", updateRadioUI);
  }

  // Feedback háptico + visual en cualquier botón del mando
  document.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!btn) return;
    if (radioToggle && radioToggle.dataset.dragged === "true") return;
    try { navigator.vibrate?.(100); } catch (err) { /* noop */ }
    btn.classList.remove("remote-btn-pulse");
    void btn.offsetWidth;
    btn.classList.add("remote-btn-pulse");
    setTimeout(() => btn.classList.remove("remote-btn-pulse"), 200);
  }, { passive: true });

  if (client) {
    client.on("SESSION_SUMMARY", showRemoteSummary);
    client.on("REMOTE_ACCESS_DENIED", showRemoteAccessDenied);
    void connectRemote();
  }
}
