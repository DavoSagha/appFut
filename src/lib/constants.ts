/** Emojis que puede elegir un jugador. El servidor valida contra esta lista. */
export const EMOJIS = [
  "⚡",
  "🔥",
  "💪",
  "🦊",
  "🐺",
  "🦅",
  "🐂",
  "🐐",
  "⭐",
  "🎯",
] as const;

export type Emoji = (typeof EMOJIS)[number];

export const COMPROBANTE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const COMPROBANTE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/** Extensión canónica por MIME. Nunca confiamos en el nombre del archivo. */
export const EXTENSION_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export const NOMBRE_MAX_LARGO = 50;
