const DEVICE_ID_KEY = "appfut_device_id";

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";

  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(DEVICE_ID_KEY);
}

export function getPartidoDeviceKey(partidoId: string): string {
  return `appfut_partido_${partidoId}_jugador_id`;
}

export function getSavedJugadorId(partidoId: string): string | null {
  if (typeof window === "undefined") return null;
  const key = getPartidoDeviceKey(partidoId);
  return localStorage.getItem(key);
}

export function saveJugadorId(partidoId: string, jugadorId: string) {
  if (typeof window === "undefined") return;
  const key = getPartidoDeviceKey(partidoId);
  localStorage.setItem(key, jugadorId);
}
