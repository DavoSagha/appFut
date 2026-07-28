import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Entorno de test contra la Supabase LOCAL (docker).
 *
 * Levantar con:  npm run db:start
 * Resetear con:  npm run db:reset   (reaplica todas las migraciones)
 */

type Config = { url: string; anon: string; service: string };
let cache: Config | null = null;

export function config(): Config {
  if (cache) return cache;

  if (process.env.SUPABASE_TEST_URL && process.env.SUPABASE_TEST_ANON_KEY) {
    cache = {
      url: process.env.SUPABASE_TEST_URL,
      anon: process.env.SUPABASE_TEST_ANON_KEY,
      service: process.env.SUPABASE_TEST_SERVICE_KEY ?? "",
    };
    return cache;
  }

  let salida: string;
  try {
    salida = execSync("npx supabase status -o json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(
      "No se pudo leer el estado de Supabase local.\n" +
        "¿Está Docker Desktop corriendo? Después: npm run db:start"
    );
  }

  const j = JSON.parse(salida) as Record<string, string>;
  cache = {
    url: j.API_URL,
    anon: j.ANON_KEY ?? j.PUBLISHABLE_KEY,
    service: j.SERVICE_ROLE_KEY ?? j.SECRET_KEY,
  };
  return cache;
}

const opciones = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

/** service_role: bypassea RLS. Solo para armar el escenario del test. */
export function admin(): SupabaseClient {
  const c = config();
  return createClient(c.url, c.service, opciones);
}

/** Cliente crudo, sin sesión. Representa a un visitante no autenticado. */
export function anonimoSinSesion(): SupabaseClient {
  const c = config();
  return createClient(c.url, c.anon, opciones);
}

/** Un jugador: usuario anónimo real de Supabase, con su JWT. */
export async function jugador(): Promise<SupabaseClient> {
  const c = config();
  const cli = createClient(c.url, c.anon, opciones);
  const { error } = await cli.auth.signInAnonymously();
  if (error) {
    throw new Error(
      `signInAnonymously falló: ${error.message}\n` +
        "¿Está enable_anonymous_sign_ins = true en supabase/config.toml?"
    );
  }
  return cli;
}

/** Un organizador: usuario real con email, como el que entra por Google. */
export async function organizador(): Promise<{
  cliente: SupabaseClient;
  id: string;
}> {
  const c = config();
  const email = `org-${randomUUID()}@test.local`;
  const password = randomUUID();

  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`No se pudo crear el organizador: ${error.message}`);

  const cliente = createClient(c.url, c.anon, opciones);
  const { error: errLogin } = await cliente.auth.signInWithPassword({
    email,
    password,
  });
  if (errLogin) throw new Error(`Login del organizador falló: ${errLogin.message}`);

  return { cliente, id: data.user!.id };
}

export function slugDeTest(): string {
  return randomUUID().replace(/[^a-z0-9]/g, "").slice(0, 12);
}

/** Crea un partido directo en la base, sin pasar por la app. */
export async function crearPartido(opts: {
  organizadorId: string;
  cupo?: number;
  costo?: number;
  /** true = el partido ya se jugó (fecha en el pasado). */
  jugado?: boolean;
}): Promise<{ id: string; slug: string }> {
  const slug = slugDeTest();
  const desplazamiento = opts.jugado ? -86_400_000 : 86_400_000;
  const { data, error } = await admin()
    .from("partidos")
    .insert({
      organizador_id: opts.organizadorId,
      fecha_hora: new Date(Date.now() + desplazamiento).toISOString(),
      cantidad_jugadores: opts.cupo ?? 2,
      costo_total: opts.costo ?? 1000,
      link_slug: slug,
      estado: "abierto",
    })
    .select("id")
    .single();

  if (error) throw new Error(`No se pudo crear el partido: ${error.message}`);
  return { id: data.id as string, slug };
}

/** Un jugador nuevo que se anota en el partido. Devuelve su cliente y su ficha. */
export async function anotarse(
  slug: string,
  nombre: string
): Promise<{ cliente: SupabaseClient; fichaId: string; accion: string }> {
  const cliente = await jugador();
  const { data, error } = await cliente.rpc("unirse_o_reclamar", {
    p_slug: slug,
    p_nombre: nombre,
  });
  if (error) throw new Error(`unirse_o_reclamar(${nombre}) falló: ${error.message}`);

  const fila = (data as { jugador_id: string; accion: string }[])[0];
  return { cliente, fichaId: fila.jugador_id, accion: fila.accion };
}

/** Lee una ficha con service_role, sin filtros de RLS. */
export async function leerFicha(fichaId: string) {
  const { data } = await admin()
    .from("jugadores")
    .select("id, nombre, rol, user_id, partido_id")
    .eq("id", fichaId)
    .single();
  return data;
}

export async function leerPago(fichaId: string) {
  const { data } = await admin()
    .from("pagos")
    .select("estado, monto_esperado, monto_pagado, comprobante_url")
    .eq("jugador_id", fichaId)
    .single();
  return data;
}

export async function leerPartido(partidoId: string) {
  const { data } = await admin()
    .from("partidos")
    .select("id, estado, costo_total, cantidad_jugadores")
    .eq("id", partidoId)
    .single();
  return data;
}
