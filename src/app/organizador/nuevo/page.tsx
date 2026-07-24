"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export default function NuevoPartidoPage() {
  console.log("[NuevoPartido] Render");
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [cantidadJugadores, setCantidadJugadores] = useState(10);
  const [costoTotal, setCostoTotal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    console.log("[NuevoPartido] useEffect - inicio", Date.now());
    const supabase = createClient();
    supabase.auth.getUser().then((result) => {
      const user = result.data.user;
      console.log("[NuevoPartido] getUser OK - user:", !!user, Date.now());
      if (!user) router.replace("/auth/login");
      else setUserId(user.id);
    }).catch((err) => {
      console.log("[NuevoPartido] getUser ERROR:", err?.message || err, Date.now());
      router.replace("/auth/login");
    });
  }, [router]);

  const generarSlug = () => {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let slug = "";
    for (let i = 0; i < 8; i++) {
      slug += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return slug;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    if (!fecha || !hora || !costoTotal) {
      setError("Completá todos los campos");
      return;
    }

    const costo = parseFloat(costoTotal);
    if (isNaN(costo) || costo <= 0) {
      setError("El costo total debe ser un número válido");
      return;
    }

    setSubmitting(true);
    setError("");

    const supabase = createClient();
    const fechaHora = new Date(`${fecha}T${hora}`);

    const { data, error: err } = await supabase
      .from("partidos")
      .insert({
        organizador_id: userId,
        fecha_hora: fechaHora.toISOString(),
        cantidad_jugadores: cantidadJugadores,
        costo_total: costo,
        link_slug: generarSlug(),
        estado: "abierto",
      })
      .select()
      .single();

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    router.push(`/organizador/${data.id}`);
  };

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      <button
        onClick={() => router.back()}
        className="text-[var(--texto)]/60 text-sm mb-6 hover:text-[var(--texto)] transition-colors"
      >
        ← Volver
      </button>

      <h1 className="text-2xl font-bold text-[var(--primario)] mb-6">
        Crear partido
      </h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm text-[var(--texto)]/70 mb-1">
            Fecha
          </label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="w-full bg-[var(--superficie)] text-[var(--texto)] rounded-xl px-4 py-3 border border-[var(--texto)]/10 focus:border-[var(--primario)] outline-none transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--texto)]/70 mb-1">
            Hora
          </label>
          <input
            type="time"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            className="w-full bg-[var(--superficie)] text-[var(--texto)] rounded-xl px-4 py-3 border border-[var(--texto)]/10 focus:border-[var(--primario)] outline-none transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm text-[var(--texto)]/70 mb-1">
            Jugadores por equipo (N vs N)
          </label>
          <select
            value={cantidadJugadores}
            onChange={(e) =>
              setCantidadJugadores(parseInt(e.target.value) * 2)
            }
            className="w-full bg-[var(--superficie)] text-[var(--texto)] rounded-xl px-4 py-3 border border-[var(--texto)]/10 focus:border-[var(--primario)] outline-none transition-colors"
          >
            {[4, 5, 6, 7, 8, 9, 11].map((n) => (
              <option key={n} value={n * 2}>
                {n} vs {n} ({n * 2} jugadores)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-[var(--texto)]/70 mb-1">
            Costo total de la cancha ($)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={costoTotal}
            onChange={(e) => setCostoTotal(e.target.value)}
            placeholder="Ej: 80000"
            className="w-full bg-[var(--superficie)] text-[var(--texto)] rounded-xl px-4 py-3 border border-[var(--texto)]/10 focus:border-[var(--primario)] outline-none transition-colors"
          />
          {costoTotal && parseFloat(costoTotal) > 0 && (
            <p className="text-[var(--texto)]/50 text-xs mt-1">
              ~${(parseFloat(costoTotal) / cantidadJugadores).toFixed(2)} por
              titular
            </p>
          )}
        </div>

        {error && (
          <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-[var(--primario)] text-[var(--fondo)] font-semibold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
        >
          {submitting ? "Creando..." : "Crear partido"}
        </button>
      </form>
    </div>
  );
}
