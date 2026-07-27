"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { cerrarPartido, reabrirPartido } from "@/app/actions/partidos";
import { eliminarJugador } from "@/app/actions/jugadores";
import { confirmarPago, rechazarPago, verComprobante } from "@/app/actions/pagos";
import type { Partido, JugadorRol, PagoEstado } from "@/lib/db/types";

type JugadorConPago = {
  id: string;
  nombre: string;
  rol: JugadorRol;
  emoji_o_color: string | null;
  pago: {
    estado: PagoEstado;
    monto_esperado: number;
    monto_pagado: number | null;
    comprobante_url: string | null;
  } | null;
};

export default function PartidoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const getSupabase = () => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  };

  const [partido, setPartido] = useState<Partido | null>(null);
  const [jugadores, setJugadores] = useState<JugadorConPago[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [linkCopiado, setLinkCopiado] = useState(false);

  const cargarDatos = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/auth/login");
        return;
      }

      // RLS ya limita el SELECT al organizador dueño: si no es suyo, no hay fila.
      const { data: p } = await supabase
        .from("partidos")
        .select("*")
        .eq("id", id)
        .single();

      if (!p) {
        router.replace("/organizador");
        return;
      }

      setPartido(p as Partido);

      const { data: jugs, error: errJugs } = await supabase
        .from("jugadores")
        .select(
          "id, nombre, rol, emoji_o_color, pago:pagos(estado, monto_esperado, monto_pagado, comprobante_url)"
        )
        .eq("partido_id", id)
        .order("orden_ingreso", { ascending: true })
        .returns<JugadorConPago[]>();

      if (errJugs) setError("No se pudieron cargar los jugadores");
      else setJugadores(jugs ?? []);

      setCargando(false);
    } catch {
      router.replace("/auth/login");
    }
  }, [id, router]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  /** Corre una acción, muestra el error si falla y recarga si sale bien. */
  const ejecutar = async (accion: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    const res = await accion();
    if (!res.ok) {
      setError(res.error ?? "No se pudo completar la acción");
      return;
    }
    await cargarDatos();
  };

  const copiarLink = async () => {
    if (!partido) return;
    const link = `${window.location.origin}/unirse/${partido.link_slug}`;
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopiado(true);
      setTimeout(() => setLinkCopiado(false), 2000);
    } catch {
      setError(`No se pudo copiar. El link es: ${link}`);
    }
  };

  const handleEliminar = async (jugadorId: string) => {
    if (!confirm("¿Eliminar este jugador del partido?")) return;
    await ejecutar(() => eliminarJugador(jugadorId));
  };

  const handleVerComprobante = async (jugadorId: string) => {
    setError("");
    const res = await verComprobante(jugadorId);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    window.open(res.data.url, "_blank", "noopener,noreferrer");
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin text-4xl">⚽</div>
      </div>
    );
  }

  if (!partido) return null;

  const titulares = jugadores.filter((j) => j.rol === "titular");
  const suplentes = jugadores.filter((j) => j.rol === "suplente");
  const confirmados = jugadores.filter((j) => j.pago?.estado === "confirmado");
  const pendientes = jugadores.filter(
    (j) => j.pago?.estado === "pendiente_confirmacion"
  );
  const montoPorJugador =
    titulares.length > 0
      ? (partido.costo_total / titulares.length).toFixed(2)
      : "0";

  // Se suma lo que realmente entró, no lo que se espera.
  const totalRecaudado = confirmados.reduce(
    (acc, j) => acc + (j.pago?.monto_pagado ?? j.pago?.monto_esperado ?? 0),
    0
  );

  const porEquipo = partido.cantidad_jugadores / 2;

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      <button
        onClick={() => router.push("/organizador")}
        className="text-[var(--texto)]/60 text-sm mb-4 hover:text-[var(--texto)] transition-colors"
      >
        ← Mis partidos
      </button>

      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold text-[var(--primario)]">
            {new Date(partido.fecha_hora).toLocaleDateString("es-AR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h1>
          <span
            className={`text-sm font-medium px-2 py-1 rounded-full ${
              partido.estado === "abierto"
                ? "bg-[var(--primario)]/20 text-[var(--primario)]"
                : partido.estado === "completo"
                ? "bg-blue-500/20 text-blue-400"
                : "bg-[var(--inactivo)]/20 text-[var(--inactivo)]"
            }`}
          >
            {partido.estado}
          </span>
        </div>
        <p className="text-[var(--texto)]/70 text-sm">
          {new Date(partido.fecha_hora).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          · {porEquipo} vs {porEquipo} · ${partido.costo_total.toFixed(2)}
        </p>
      </div>

      {error && (
        <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}

      <button
        onClick={copiarLink}
        className="w-full bg-[var(--superficie)] text-[var(--primario)] font-medium py-3 px-4 rounded-xl hover:brightness-110 transition-all mb-6 flex items-center justify-center gap-2"
      >
        {linkCopiado ? "✓ Link copiado" : "🔗 Copiar link de invitación"}
      </button>

      <div className="flex gap-2 mb-6">
        {partido.estado !== "cerrado" ? (
          <button
            onClick={() => ejecutar(() => cerrarPartido(id))}
            className="flex-1 bg-red-500/10 text-red-400 py-2 rounded-xl text-sm hover:bg-red-500/20 transition-colors"
          >
            Cerrar partido
          </button>
        ) : (
          <button
            onClick={() => ejecutar(() => reabrirPartido(id))}
            className="flex-1 bg-[var(--primario)]/10 text-[var(--primario)] py-2 rounded-xl text-sm hover:brightness-110 transition-colors"
          >
            Reabrir partido
          </button>
        )}
      </div>

      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">
          Resumen de pagos
        </h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-bold text-[var(--confirmado)]">
              {confirmados.length}
            </p>
            <p className="text-xs text-[var(--texto)]/50">Pagaron</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--pendiente)]">
              {pendientes.length}
            </p>
            <p className="text-xs text-[var(--texto)]/50">Pendientes</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--texto)]">
              ${totalRecaudado.toFixed(0)}
            </p>
            <p className="text-xs text-[var(--texto)]/50">
              de ${partido.costo_total.toFixed(0)}
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">
          Titulares (${montoPorJugador} c/u)
        </h2>
        <div className="space-y-2">
          {titulares.length === 0 && (
            <p className="text-[var(--texto)]/40 text-sm text-center py-4">
              Sin titulares todavía
            </p>
          )}
          {titulares.map((j) => (
            <JugadorCard
              key={j.id}
              jugador={j}
              onConfirmar={(jid) => ejecutar(() => confirmarPago(jid))}
              onRechazar={(jid) => ejecutar(() => rechazarPago(jid))}
              onEliminar={handleEliminar}
              onVerComprobante={handleVerComprobante}
            />
          ))}
        </div>
      </div>

      {suplentes.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">
            Suplentes ({suplentes.length})
          </h2>
          <div className="space-y-2">
            {suplentes.map((j) => (
              <JugadorCard
                key={j.id}
                jugador={j}
                onConfirmar={(jid) => ejecutar(() => confirmarPago(jid))}
                onRechazar={(jid) => ejecutar(() => rechazarPago(jid))}
                onEliminar={handleEliminar}
                onVerComprobante={handleVerComprobante}
              />
            ))}
          </div>
        </div>
      )}

      <div className="text-center text-[var(--texto)]/30 text-xs py-4">
        {jugadores.length} jugadores unidos ·{" "}
        {Math.max(0, partido.cantidad_jugadores - titulares.length)} cupos
        titulares libres
      </div>
    </div>
  );
}

function JugadorCard({
  jugador,
  onConfirmar,
  onRechazar,
  onEliminar,
  onVerComprobante,
}: {
  jugador: JugadorConPago;
  onConfirmar: (id: string) => void;
  onRechazar: (id: string) => void;
  onEliminar: (id: string) => void;
  onVerComprobante: (id: string) => void;
}) {
  const estadoPago = jugador.pago?.estado ?? "sin_declarar";

  return (
    <div className="bg-[var(--superficie)] rounded-xl p-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            {jugador.emoji_o_color && (
              <span className="text-lg">{jugador.emoji_o_color}</span>
            )}
            <span className="font-medium">{jugador.nombre}</span>
            {jugador.rol === "suplente" && (
              <span className="text-xs bg-[var(--inactivo)]/20 text-[var(--inactivo)] px-1.5 py-0.5 rounded">
                SUP
              </span>
            )}
          </div>
          {jugador.pago && (
            <p className="text-xs text-[var(--texto)]/50">
              $
              {(estadoPago === "confirmado"
                ? jugador.pago.monto_pagado ?? jugador.pago.monto_esperado
                : jugador.pago.monto_esperado
              ).toFixed(2)}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {jugador.pago?.comprobante_url && (
          <button
            onClick={() => onVerComprobante(jugador.id)}
            className="text-[var(--primario)] text-sm hover:underline"
          >
            📎 Ver
          </button>
        )}

        {estadoPago === "pendiente_confirmacion" && (
          <>
            <button
              onClick={() => onConfirmar(jugador.id)}
              className="bg-[var(--confirmado)]/20 text-[var(--confirmado)] px-2 py-1 rounded-lg text-xs font-medium hover:brightness-110"
            >
              Confirmar
            </button>
            <button
              onClick={() => onRechazar(jugador.id)}
              className="bg-red-500/20 text-red-400 px-2 py-1 rounded-lg text-xs font-medium hover:brightness-110"
            >
              Rechazar
            </button>
          </>
        )}

        {estadoPago === "confirmado" && (
          <span className="bg-[var(--confirmado)]/20 text-[var(--confirmado)] px-2 py-1 rounded-lg text-xs font-medium">
            ✓ Pagó
          </span>
        )}

        {estadoPago === "rechazado" && (
          <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded-lg text-xs font-medium">
            Rechazado
          </span>
        )}

        <button
          onClick={() => onEliminar(jugador.id)}
          aria-label={`Eliminar a ${jugador.nombre}`}
          className="text-[var(--texto)]/30 hover:text-red-400 text-sm ml-1 transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
