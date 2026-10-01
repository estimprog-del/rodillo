import * as Ably from "ably";

const ABLY_API_KEY = import.meta.env.VITE_ABLY_API_KEY || "";
const SUPPORTED_EVENTS = new Set([
  "CHANGE_GEAR",
  "TOGGLE_PAUSE",
  "STOP_SESSION",
  "SESSION_SUMMARY",
  "REMOTE_ACCESS_DENIED",
]);

/**
 * Ably-backed room client. The public browser key must be restricted in Ably
 * to publish/subscribe only on channels matching `rodilloint:*`.
 */
export class RemoteRoomClient {
  constructor(roomId, clientId = "rodilloint-client") {
    this.roomId = roomId;
    this.clientId = clientId;
    this.client = null;
    this.channel = null;
    this.handlers = new Map();
    this.connectionStateHandlers = new Set();
    this.subscriptions = new Map();
  }

  async connect() {
    if (!ABLY_API_KEY) {
      throw new Error("Falta configurar VITE_ABLY_API_KEY.");
    }

    if (!this.client) {
      this.client = new Ably.Realtime({
        key: ABLY_API_KEY,
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

export function createRoomId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().split("-")[0].toUpperCase();
  }
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

export function getRemoteRoomId() {
  const hash = window.location.hash;
  const hashMatch = hash.match(/^#\/(?:mando|remote)(?:\?(.*))?$/i);
  const query = hashMatch ? new URLSearchParams(hashMatch[1] || "") : new URLSearchParams(window.location.search);
  return query.get("room") || "";
}

export function isRemoteRoute() {
  return /^\/(?:mando|remote)\/?$/i.test(window.location.pathname) ||
    /^#\/(?:mando|remote)(?:\?.*)?$/i.test(window.location.hash);
}

export function buildRemoteUrl(roomId) {
  const baseUrl = new URL(import.meta.env.BASE_URL || "./", window.location.href);
  return `${baseUrl.origin}${baseUrl.pathname}#/mando?room=${encodeURIComponent(roomId)}`;
}

export function buildQrUrl(value) {
  // Static-host compatible QR rendering without a bundled QR dependency.
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(value)}`;
}
