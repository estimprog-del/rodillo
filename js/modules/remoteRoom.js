import * as Ably from "ably";
import QRCode from "qrcode";

const ABLY_AUTH_URL = import.meta.env.VITE_ABLY_AUTH_URL || "";
const SUPPORTED_EVENTS = new Set([
  "CHANGE_GEAR",
  "TOGGLE_PAUSE",
  "STOP_SESSION",
  "SESSION_SUMMARY",
  "REMOTE_ACCESS_DENIED",
]);

/**
 * Ably tokens must be issued by a trusted server with room-scoped capabilities.
 */
export class RemoteRoomClient {
  constructor(roomId, clientId, hostSecret = null) {
    if (!/^[a-f0-9]{64}$/i.test(roomId) ||
        (clientId !== "host" && clientId !== "remote")) {
      throw new Error("Identificador o rol de sala no válido.");
    }
    this.roomId = roomId;
    this.clientId = clientId;
    this.hostSecret = hostSecret;
    this.client = null;
    this.channel = null;
    this.handlers = new Map();
    this.connectionStateHandlers = new Set();
    this.subscriptions = new Map();
  }

  async connect() {
    if (!isRemoteAuthConfigured()) {
      throw new Error("Falta configurar VITE_ABLY_AUTH_URL.");
    }

    if (!this.client) {
      const authUrl = new URL(ABLY_AUTH_URL, window.location.href);
      const isLocalhost = ["localhost", "127.0.0.1", "[::1]"]
        .includes(window.location.hostname);
      if (authUrl.protocol !== "https:" &&
          !(isLocalhost && authUrl.protocol === "http:")) {
        throw new Error("El endpoint de autenticación Ably debe usar HTTPS.");
      }
      this.client = new Ably.Realtime({
        authUrl: authUrl.toString(),
        authMethod: "POST",
        authParams: {
          roomId: this.roomId,
          role: this.clientId,
          ...(this.hostSecret ? { hostSecret: this.hostSecret } : {}),
        },
        clientId: this.clientId,
      });
      this.channel = this.client.channels.get(`rodilloint:${this.roomId}`);
      this.client.connection.on("state", (change) => {
        this.connectionStateHandlers.forEach((handler) => handler(change));
      });
    }

    if (this.client.connection.state === "connected") {
      await this.channel.attach();
      this.attachSubscriptions();
      return;
    }

    await new Promise((resolve, reject) => {
      const onConnected = () => {
        this.client.connection.off("failed", onFailed);
        resolve();
      };
      const onFailed = (stateChange) => {
        this.client.connection.off("connected", onConnected);
        reject(stateChange.reason || new Error("Ably rechazó la conexión."));
      };

      this.client.connection.once("connected", onConnected);
      this.client.connection.once("failed", onFailed);
      if (this.client.connection.state === "connected") onConnected();
    });

    await this.channel.attach();
    this.attachSubscriptions();
  }

  async reconnect() {
    this.closeConnection();
    await this.connect();
  }

  onConnectionStateChange(handler) {
    this.connectionStateHandlers.add(handler);
    return () => this.connectionStateHandlers.delete(handler);
  }

  on(eventName, handler) {
    if (!SUPPORTED_EVENTS.has(eventName)) return () => {};
    if (!this.handlers.has(eventName)) this.handlers.set(eventName, new Set());
    this.handlers.get(eventName).add(handler);
    this.attachEventSubscription(eventName);
    return () => {
      this.handlers.get(eventName)?.delete(handler);
      if (this.handlers.get(eventName)?.size === 0) {
        const listener = this.subscriptions.get(eventName);
        if (listener) this.channel?.unsubscribe(eventName, listener);
        this.subscriptions.delete(eventName);
        this.handlers.delete(eventName);
      }
    };
  }

  attachEventSubscription(eventName) {
    if (!this.channel || this.subscriptions.has(eventName)) return;
    const listener = (message) => {
      this.handlers.get(eventName)?.forEach((handler) => handler(message.data, message));
    };
    this.channel.subscribe(eventName, listener);
    this.subscriptions.set(eventName, listener);
  }

  attachSubscriptions() {
    this.handlers.forEach((_, eventName) => this.attachEventSubscription(eventName));
  }

  async emit(eventName, payload) {
    if (!SUPPORTED_EVENTS.has(eventName)) {
      throw new Error(`Evento remoto no permitido: ${eventName}`);
    }
    if (!this.channel || this.client?.connection?.state !== "connected") {
      throw new Error("El mando no está conectado. Pulsa Reconectar e inténtalo de nuevo.");
    }
    const senderId = this.client?.connection?.id || null;
    await this.channel.publish(eventName, { ...payload, senderId });
  }

  getConnectionId() {
    return this.client?.connection?.id || null;
  }

  getConnectionState() {
    return this.client?.connection?.state || "initialized";
  }

  closeConnection() {
    this.subscriptions.forEach((listener, eventName) => {
      this.channel?.unsubscribe(eventName, listener);
    });
    this.subscriptions.clear();
    this.channel?.detach();
    this.client?.close();
    this.channel = null;
    this.client = null;
  }

  disconnect() {
    this.closeConnection();
    this.handlers.clear();
    this.connectionStateHandlers.clear();
  }
}

export async function createRemoteRoom() {
  if (!isRemoteAuthConfigured()) {
    throw new Error("Falta configurar VITE_ABLY_AUTH_URL.");
  }
  const authUrl = new URL(ABLY_AUTH_URL, window.location.href);
  if (!authUrl.pathname.endsWith("/ably-auth")) {
    throw new Error("La URL de autenticación debe terminar en /ably-auth.");
  }
  authUrl.pathname = authUrl.pathname.replace(/\/ably-auth$/, "/ably-rooms");
  authUrl.search = "";
  authUrl.hash = "";

  const response = await fetch(authUrl, { method: "POST" });
  const room = await response.json().catch(() => null);
  if (!response.ok || !/^[a-f0-9]{64}$/i.test(room?.roomId) ||
      typeof room?.hostSecret !== "string") {
    throw new Error(room?.error || "No se pudo crear una sala de mando segura.");
  }
  if (typeof room.remoteOrigin !== "string" ||
      !/^https?:$/.test(new URL(room.remoteOrigin).protocol)) {
    throw new Error("El servidor local no devolvió una dirección accesible para el mando.");
  }
  return room;
}

export function createRoomId() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Este navegador no permite generar salas seguras.");
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getRemoteRoomId() {
  const hash = window.location.hash;
  const hashMatch = hash.match(/^#\/(?:mando|remote)(?:\?(.*))?$/i);
  const query = hashMatch ? new URLSearchParams(hashMatch[1] || "") : new URLSearchParams(window.location.search);
  const roomId = query.get("room") || "";
  return /^[a-f0-9]{64}$/i.test(roomId) ? roomId : "";
}

export function isRemoteRoute() {
  return /^\/(?:mando|remote)\/?$/i.test(window.location.pathname) ||
    /^#\/(?:mando|remote)(?:\?.*)?$/i.test(window.location.hash);
}

export function buildRemoteUrl(roomId, origin = window.location.origin) {
  const baseUrl = new URL(import.meta.env.BASE_URL || "./", origin);
  return `${baseUrl.origin}${baseUrl.pathname}#/mando?room=${encodeURIComponent(roomId)}`;
}

export function isRemoteAuthConfigured() {
  return Boolean(ABLY_AUTH_URL.trim());
}

export function buildQrUrl(value) {
  return QRCode.toDataURL(value, { width: 180, margin: 2 });
}
