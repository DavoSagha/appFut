import "server-only";

import { createClient } from "@/lib/supabase/server";

export function fallo(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Falla registrando la causa real.
 * El detalle SIEMPRE va a la terminal del servidor. Al navegador solo llega
 * en desarrollo: en producción un mensaje de error de Postgres le cuenta al
 * atacante cómo está armada la base.
 */
export function falloDe(
  contexto: string,
  causa: unknown
): { ok: false; error: string } {
  console.error(`[appFut] ${contexto} falló:`, causa);

  let detalle = "error desconocido";
  if (causa instanceof Error) {
    detalle = causa.message;
  } else if (causa && typeof causa === "object") {
    const e = causa as { message?: unknown; code?: unknown; hint?: unknown };
    detalle = [e.code, e.message, e.hint].filter(Boolean).join(" · ");
  }

  return {
    ok: false,
    error:
      process.env.NODE_ENV === "development"
        ? `${contexto}: ${detalle}`
        : "No se pudo completar la operación. Probá de nuevo.",
  };
}

/**
 * Usuario de la request. Puede ser anónimo (un jugador) o real (el organizador).
 * getUser() valida el JWT contra Supabase; getSession() solo leería la cookie.
 */
export async function usuarioActual(): Promise<{
  id: string;
  esAnonimo: boolean;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  return { id: user.id, esAnonimo: user.is_anonymous === true };
}

/** Solo el organizador logueado con Google. Un anónimo no califica. */
export async function organizadorActual(): Promise<string | null> {
  const u = await usuarioActual();
  return u && !u.esAnonimo ? u.id : null;
}

// Definidos en @/lib/validaciones (sin "server-only") para poder testearlos.
export { esUuid, esSlug, normalizarNombre } from "@/lib/validaciones";
