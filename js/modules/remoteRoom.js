import * as Ably from "ably";

const ABLY_API_KEY = import.meta.env.VITE_ABLY_API_KEY || "";
const GEAR_EVENT = "CHANGE_GEAR";

/**
 * Ably-backed room client. The public browser key must be restricted in Ably
 * to publish/subscribe only on channels matching `rodilloint:*`.
 */
export class RemoteRoomClient {
  constructor(roomId) {
    this.roomId = roomId;
    this.client = null;
    this.channel = null;
    this.unsubscribe = null;
  }

  async connect() {
    if (!ABLY_API_KEY) {
      throw new Error("Falta configurar VITE_ABLY_API_KEY.");
    }

    this.client = new Ably.Realtime({ key: ABLY_API_KEY });
    this.channel = this.client.channels.get(`rodilloint:${this.roomId}`);

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
    });
  }

  on(eventName, handler) {
    if (eventName !== GEAR_EVENT || !this.channel) return () => {};
    this.channel.subscribe(eventName, (message) => handler(message.data));
    this.unsubscribe = () => this.channel?.unsubscribe(eventName);
    return this.unsubscribe;
  }

  async emit(eventName, payload) {
    if (eventName !== GEAR_EVENT || !this.channel) return;
    await this.channel.publish(eventName, payload);
  }

  disconnect() {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    this.channel?.detach();
    this.client?.close();
    this.channel = null;
    this.client = null;
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
