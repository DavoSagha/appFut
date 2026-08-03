"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { crearPartido } from "@/app/actions/partidos";
import { validarFechaPartido } from "@/lib/validaciones";

export default function NuevoPartidoPage() {
  const router = useRouter();

  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [cantidadJugadores, setCantidadJugadores] = useState(10);
  const [costoTotal, setCostoTotal] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fecha || !hora || !costoTotal) {
      setError("Completá todos los campos");
      return;
    }

    const costo = parseFloat(costoTotal);
    if (Number.isNaN(costo) || costo <= 0) {
      setError("El costo total debe ser un número válido");
      return;
    }

    const fechaHoraIso = new Date(`${fecha}T${hora}`).toISOString();
    const validacionFecha = validarFechaPartido(fechaHoraIso);
    if (!validacionFecha.ok) {
      setError(validacionFecha.error);
      return;
    }

    setEnviando(true);
    setError("");

    const res = await crearPartido({
      fechaHora: fechaHoraIso,
      cantidadJugadores,
      costoTotal: costo,
    });

    if (!res.ok) {
      setError(res.error);
      setEnviando(false);
      return;
    }

    router.push(`/organizador/${res.data.id}`);
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
            onChange={(e) => setCantidadJugadores(parseInt(e.target.value, 10))}
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
          disabled={enviando}
          className="w-full bg-[var(--primario)] text-[var(--fondo)] font-semibold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
        >
          {enviando ? "Creando..." : "Crear partido"}
        </button>
      </form>
    </div>
  );
}
