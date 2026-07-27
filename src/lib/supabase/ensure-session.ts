"use client";

import { createClient } from "./client";

/**
 * Garantiza que el navegador tenga una sesión de Supabase antes de tocar nada.
 *
 * El jugador no se registra ni ve un login: Supabase le emite un usuario
 * anónimo con su JWT firmado. Eso es lo que hace que `auth.uid()` exista del
 * lado de Postgres y que RLS pueda enforcar de verdad — cosa que un UUID
 * guardado en localStorage nunca pudo hacer.
 */
export async function asegurarSesion(): Promise<string | null> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error("[appFut] no se pudo crear la sesión anónima:", error.message);
    return null;
  }

  return data.user?.id ?? null;
}
