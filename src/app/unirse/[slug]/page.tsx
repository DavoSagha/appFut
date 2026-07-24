"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSavedJugadorId, getOrCreateDeviceId, saveJugadorId } from "@/lib/device";
import type { Partido, Jugador } from "@/lib/db/types";

export const dynamic = "force-dynamic";

type Paso = "cargando" | "nombre" | "seleccionar" | "redirigiendo";

export default function UnirsePage() {
  const { slug } = useParams<{ slug: string }>();
  console.log("[Unirse] Render - slug:", slug);
  const router = useRouter();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const getSupabase = () => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  };

  const [paso, setPaso] = useState<Paso>("cargando");
  const [partido, setPartido] = useState<Partido | null>(null);
  const [jugadores, setJugadores] = useState<Jugador[]>([]);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const cargarPartido = async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("partidos")
        .select("*")
        .eq("link_slug", slug)
        .single();

      if (!data) {
        setError("Partido no encontrado");
        setPaso("nombre");
        return;
      }

      const p = data as Partido;
      if (!cancelled) setPartido(p);

      if (p.estado === "cerrado") {
        setError("Este partido ya está cerrado");
        setPaso("nombre");
        return;
      }

      const { data: jugs } = await supabase
        .from("jugadores")
        .select("*")
        .eq("partido_id", p.id)
        .order("orden_ingreso", { ascending: true });

      const todosJugadores = (jugs as Jugador[]) ?? [];
      if (!cancelled) setJugadores(todosJugadores);

      const savedJugadorId = getSavedJugadorId(p.id);
      if (savedJugadorId) {
        const existe = todosJugadores.some((j) => j.id === savedJugadorId);
        if (existe) {
          if (!cancelled) router.replace(`/p/${slug}`);
          return;
        }
      }

      const deviceId = getOrCreateDeviceId();
      const existente = todosJugadores.find((j) => j.device_id === deviceId);
      if (existente) {
        saveJugadorId(p.id, existente.id);
        if (!cancelled) router.replace(`/p/${slug}`);
        return;
      }

      if (!cancelled) setPaso("nombre");
    };

    cargarPartido();
    return () => { cancelled = true; };
  }, [slug, router]);

  const handleSubmitNombre = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim() || !partido) return;

    setSubmitting(true);
    setError("");

    const supabase = getSupabase();
    const deviceId = getOrCreateDeviceId();
    const { data, error: err } = await supabase
      .from("jugadores")
      .insert({
        partido_id: partido.id,
        nombre: nombre.trim(),
        device_id: deviceId,
      })
      .select()
      .single();

    if (err) {
      if (err.message.includes("duplicate")) {
        // El device_id ya existe - mostrar selección
        setPaso("seleccionar");
        setSubmitting(false);
        return;
      }
      setError(err.message);
      setSubmitting(false);
      return;
    }

    saveJugadorId(partido.id, data.id);
    router.replace(`/p/${slug}`);
  };

  const handleSeleccionarJugador = async (jugador: Jugador) => {
    if (!partido) return;
    const deviceId = getOrCreateDeviceId();
    const supabase = getSupabase();

    const { error: err } = await supabase
      .from("jugadores")
      .update({ device_id: deviceId })
      .eq("id", jugador.id);

    if (err) {
      setError(err.message);
      return;
    }

    saveJugadorId(partido.id, jugador.id);
    router.replace(`/p/${slug}`);
  };

  if (partido && paso === "cargando") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin text-4xl">⚽</div>
      </div>
    );
  }

  if (error && paso === "cargando") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6">
        <div className="text-5xl mb-4">🚫</div>
        <p className="text-[var(--texto)]/70 text-center">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      {partido && (
        <div className="w-full max-w-sm mb-6 text-center">
          <div className="text-5xl mb-3">⚽</div>
          <h2 className="text-lg font-bold text-[var(--primario)]">
            {new Date(partido.fecha_hora).toLocaleDateString("es-AR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h2>
          <p className="text-[var(--texto)]/60 text-sm">
            {new Date(partido.fecha_hora).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · {partido.cantidad_jugadores / 2} vs {partido.cantidad_jugadores / 2}
          </p>
        </div>
      )}

      {paso === "nombre" && !error && (
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold text-center mb-2">Te esperamos</h1>
          <p className="text-[var(--texto)]/60 text-sm text-center mb-6">
            Ingresá tu nombre para unirte al partido
          </p>

          <form onSubmit={handleSubmitNombre} className="space-y-4">
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Tu nombre"
              autoFocus
              maxLength={50}
              className="w-full bg-[var(--superficie)] text-[var(--texto)] rounded-xl px-4 py-3 border border-[var(--texto)]/10 focus:border-[var(--primario)] outline-none transition-colors text-center text-lg"
            />

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !nombre.trim()}
              className="w-full bg-[var(--primario)] text-[var(--fondo)] font-semibold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
            >
              {submitting ? "Uniendo..." : "Unirme al partido"}
            </button>
          </form>

          {jugadores.length > 0 && (
            <div className="mt-8">
              <p className="text-[var(--texto)]/50 text-xs text-center mb-3">
                ¿Ya estás en la lista? Tocá tu nombre
              </p>
              <div className="space-y-2">
                {jugadores.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => handleSeleccionarJugador(j)}
                    className="w-full bg-[var(--superficie)] text-[var(--texto)] py-2 px-4 rounded-xl text-center hover:brightness-110 transition-all"
                  >
                    {j.emoji_o_color && (
                      <span className="mr-2">{j.emoji_o_color}</span>
                    )}
                    {j.nombre}
                    <span className="text-[var(--texto)]/40 text-xs ml-2">
                      {j.rol === "titular" ? "Titular" : "Suplente"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {paso === "seleccionar" && (
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold text-center mb-2">
            ¿Ya estás registrado?
          </h1>
          <p className="text-[var(--texto)]/60 text-sm text-center mb-6">
            Este dispositivo no está vinculado a tu cuenta. Tocá tu nombre para
            identificarte.
          </p>

          <div className="space-y-2">
            {jugadores.map((j) => (
              <button
                key={j.id}
                onClick={() => handleSeleccionarJugador(j)}
                className="w-full bg-[var(--superficie)] text-[var(--texto)] py-3 px-4 rounded-xl text-center hover:brightness-110 transition-all"
              >
                {j.emoji_o_color && (
                  <span className="mr-2">{j.emoji_o_color}</span>
                )}
                {j.nombre}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
