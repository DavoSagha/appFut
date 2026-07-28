import { WebSocket as WsWebSocket } from "ws";

/**
 * Node 20 no trae WebSocket global (llegó en Node 22), y supabase-js arma un
 * RealtimeClient apenas creás el cliente, aunque nunca lo uses. Sin esto,
 * createClient() explota antes de correr un solo test.
 *
 * Solo tiene que existir: los tests no usan Realtime.
 */
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = WsWebSocket;
}
