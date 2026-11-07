import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

/** Single shared Socket.IO connection (auth = the same httpOnly cookie as the REST API). */
export function getSocket(): Socket {
  if (!socket) {
    const { protocol, hostname, origin } = window.location;
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    // Hosted (Render etc.) only exposes 443 — never append :4000 there. Set NEXT_PUBLIC_SOCKET_URL to the API service URL.
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || (isLocal ? `${protocol}//${hostname}:4000` : origin);
    socket = io(url, {
      withCredentials: true,
      // cookie isn't sent cross-origin, so fetch a token via the same-origin /api proxy
      auth: (cb) => { fetch("/api/auth/socket-token", { credentials: "include" }).then((r) => r.json()).then((d) => cb({ token: d.token })).catch(() => cb({})); }, transports: ["websocket", "polling"], autoConnect: false, reconnectionDelayMax: 3000 });
  }
  if (!socket.connected && !socket.active) socket.connect();
  return socket;
}

/** emit with ack → promise (rejects on timeout so the UI never hangs). */
export function emitAck<T = any>(event: string, payload?: unknown, timeoutMs = 6000): Promise<T> {
  const s = getSocket();
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Server did not answer")), timeoutMs);
    s.emit(event, payload, (r: T) => { clearTimeout(t); resolve(r); });
  });
}
