"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  obtenerVistaPartido,
  unirsePartido,
  type VistaPartido,
} from "@/app/actions/jugadores";
import { asegurarSesion } from "@/lib/supabase/ensure-session";
import { NOMBRE_MAX_LARGO } from "@/lib/constants";

export default function UnirsePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState<VistaPartido | null>(null);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      // Supabase le emite un usuario anónimo. El jugador no ve ningún login.
      const uid = await asegurarSesion();
      if (cancelado) return;

      if (!uid) {
        setError("No se pudo iniciar la sesión. ¿Habilitaste anonymous sign-ins?");
        setCargando(false);
        return;
      }

      const res = await obtenerVistaPartido(slug);
      if (cancelado) return;

      if (!res.ok) {
        setError(res.error);
        setCargando(false);
        return;
      }

      // La cookie firmada ya nos identifica: no hace falta preguntar nada.
      if (res.data.yo) {
        router.replace(`/p/${slug}`);
        return;
      }

      if (res.data.partido.estado === "cerrado") {
        setError("Este partido ya está cerrado");
      }

      setVista(res.data);
      setCargando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [slug, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return;

    setEnviando(true);
    setError("");

    const res = await unirsePartido(slug, nombre);
    if (!res.ok) {
      setError(res.error);
      setEnviando(false);
      return;
    }

    router.replace(`/p/${slug}`);
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin text-4xl">⚽</div>
      </div>
    );
  }

  if (!vista) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6">
        <div className="text-5xl mb-4">🚫</div>
        <p className="text-[var(--texto)]/70 text-center">
          {error || "Partido no encontrado"}
        </p>
      </div>
    );
  }

  const { partido, jugadores } = vista;
  const cerrado = partido.estado === "cerrado";
  const porEquipo = partido.cantidadJugadores / 2;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-sm mb-6 text-center">
        <div className="text-5xl mb-3">⚽</div>
        <h2 className="text-lg font-bold text-[var(--primario)]">
          {new Date(partido.fechaHora).toLocaleDateString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </h2>
        <p className="text-[var(--texto)]/60 text-sm">
          {new Date(partido.fechaHora).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          · {porEquipo} vs {porEquipo}
        </p>
      </div>

      {cerrado ? (
        <p className="text-[var(--texto)]/70 text-center max-w-sm">
          Este partido ya está cerrado.
        </p>
      ) : (
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold text-center mb-2">Te esperamos</h1>
          <p className="text-[var(--texto)]/60 text-sm text-center mb-6">
            Ingresá tu nombre para unirte al partido
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Tu nombre"
              autoFocus
              maxLength={NOMBRE_MAX_LARGO}
              className="w-full bg-[var(--superficie)] text-[var(--texto)] rounded-xl px-4 py-3 border border-[var(--texto)]/10 focus:border-[var(--primario)] outline-none transition-colors text-center text-lg"
            />

            {error && (
              <p className="text-red-400 text-sm text-center bg-red-400/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={enviando || !nombre.trim()}
              className="w-full bg-[var(--primario)] text-[var(--fondo)] font-semibold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
            >
              {enviando ? "Uniendo..." : "Unirme al partido"}
            </button>
          </form>

          {jugadores.length > 0 && (
            <div className="mt-8">
              <p className="text-[var(--texto)]/50 text-xs text-center mb-3">
                Ya anotados ({jugadores.length})
              </p>
              <div className="space-y-2">
                {jugadores.map((j) => (
                  <div
                    key={j.id}
                    className="w-full bg-[var(--superficie)] text-[var(--texto)]/70 py-2 px-4 rounded-xl text-center text-sm"
                  >
                    {j.emoji && <span className="mr-2">{j.emoji}</span>}
                    {j.nombre}
                    <span className="text-[var(--texto)]/40 text-xs ml-2">
                      {j.rol === "titular" ? "Titular" : "Suplente"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[var(--texto)]/40 text-xs text-center mt-4">
                ¿Perdiste la sesión? Volvé a anotarte con tu mismo nombre
                y recuperás tu lugar.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
