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

  if (client) {
    client.on("SESSION_SUMMARY", showRemoteSummary);
    client.on("REMOTE_ACCESS_DENIED", showRemoteAccessDenied);
    void connectRemote();
  }
}
