"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { cerrarPartido, reabrirPartido } from "@/app/actions/partidos";
import { agregarJugador, eliminarJugador, moverJugador } from "@/app/actions/jugadores";
import { confirmarPago, rechazarPago, verComprobante } from "@/app/actions/pagos";
import type { Partido, JugadorRol, PagoEstado, Equipo } from "@/lib/db/types";

import BottomSheet from "@/components/BottomSheet";
import PagoBadge from "@/components/PagoBadge";
import PaymentReviewModal from "@/components/PaymentReviewModal";

type JugadorConPago = {
  id: string;
  nombre: string;
  rol: JugadorRol;
  equipo: Equipo;
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
  const [nuevoNombre, setNuevoNombre] = useState("");

  // — BottomSheet de acciones ⋮
  const [accionJugador, setAccionJugador] = useState<JugadorConPago | null>(null);
  const abrirAccion = (j: JugadorConPago) => setAccionJugador(j);
  const cerrarAccion = () => setAccionJugador(null);

  // — Modal de revisión de pago
  const [pagoJugador, setPagoJugador] = useState<JugadorConPago | null>(null);
  const abrirPago = (j: JugadorConPago) => setPagoJugador(j);
  const cerrarPago = () => setPagoJugador(null);

  const cargarDatos = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/auth/login"); return; }

      const { data: p } = await supabase.from("partidos").select("*").eq("id", id).single();
      if (!p) { router.replace("/organizador"); return; }

      setPartido(p as Partido);

      const { data: jugs, error: errJugs } = await supabase
        .from("jugadores")
        .select("id, nombre, rol, equipo, emoji_o_color, pago:pagos(estado, monto_esperado, monto_pagado, comprobante_url)")
        .eq("partido_id", id)
        .order("orden_ingreso", { ascending: true })
        .returns<JugadorConPago[]>();

      if (errJugs) setError("No se pudieron cargar los jugadores");
      else setJugadores(jugs ?? []);

      setCargando(false);
    } catch { router.replace("/auth/login"); }
  }, [id, router]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const ejecutar = async (accion: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    const res = await accion();
    if (!res.ok) { setError(res.error ?? "No se pudo completar la acción"); return; }
    await cargarDatos();
  };

  const copiarLink = async () => {
    if (!partido) return;
    const link = `${window.location.origin}/unirse/${partido.link_slug}`;
    try { await navigator.clipboard.writeText(link); setLinkCopiado(true); setTimeout(() => setLinkCopiado(false), 2000); }
    catch { setError(`No se pudo copiar. El link es: ${link}`); }
  };

  const handleAgregar = async (e: React.FormEvent) => {
    e.preventDefault();
    await ejecutar(() => agregarJugador(id, nuevoNombre));
    setNuevoNombre("");
  };

  const handleEliminar = async (jugadorId: string) => {
    if (!confirm("¿Eliminar este jugador del partido?")) return;
    await ejecutar(() => eliminarJugador(jugadorId));
    cerrarAccion();
  };

  const handleMover = async (jugadorId: string, equipo: Equipo) => {
    await ejecutar(() => moverJugador(jugadorId, equipo));
    cerrarAccion();
  };

  const handleVerComprobante = async (jugadorId: string) => {
    const res = await verComprobante(jugadorId);
    if (!res.ok) { setError(res.error); return; }
    window.open(res.data.url, "_blank", "noopener,noreferrer");
  };

  if (cargando) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin text-4xl">⚽</div>
    </div>
  );

  if (!partido) return null;

  const team1 = jugadores.filter((j) => j.equipo === "team1");
  const team2 = jugadores.filter((j) => j.equipo === "team2");
  const reserva = jugadores.filter((j) => !j.equipo);
  const confirmados = jugadores.filter((j) => j.pago?.estado === "confirmado");
  const pendientes = jugadores.filter((j) => j.pago?.estado === "pendiente_confirmacion");
  const montoPorJugador = jugadores.length > 0 ? (partido.costo_total / jugadores.length).toFixed(2) : "0";
  const totalRecaudado = confirmados.reduce((acc, j) => acc + (j.pago?.monto_pagado ?? j.pago?.monto_esperado ?? 0), 0);
  const maxPorEquipo = partido.cantidad_jugadores / 2;

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      {/* Header */}
      <button onClick={() => router.push("/organizador")} className="text-[var(--texto)]/60 text-sm mb-4 hover:text-[var(--texto)] transition-colors">← Mis partidos</button>

      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold text-[var(--primario)]">
            {new Date(partido.fecha_hora).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
          </h1>
          <span className={`text-sm font-medium px-2.5 py-1 rounded-full min-h-[28px] flex items-center ${
            partido.estado === "abierto" ? "bg-[var(--primario)]/20 text-[var(--primario)]" :
            partido.estado === "completo" ? "bg-blue-500/20 text-blue-400" : "bg-gray-500/20 text-gray-400"
          }`}>{partido.estado}</span>
        </div>
        <p className="text-[var(--texto)]/70 text-sm">
          {new Date(partido.fecha_hora).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit"})} · {maxPorEquipo} vs {maxPorEquipo} · ${partido.costo_total.toFixed(2)}
        </p>
      </div>

      {error && <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2 mb-4">{error}</p>}

      {/* Actions row */}
      <button onClick={copiarLink} className="w-full bg-[var(--superficie)] text-[var(--primario)] font-medium min-h-[44px] rounded-xl hover:brightness-110 transition-all mb-4 flex items-center justify-center gap-2">
        {linkCopiado ? "✓ Link copiado" : "🔗 Copiar link de invitación"}
      </button>

      <form onSubmit={handleAgregar} className="flex gap-2 mb-6">
        <input type="text" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)}
          placeholder="Nombre del jugador" maxLength={50}
          className="flex-1 bg-[var(--superficie)] text-[var(--texto)] rounded-xl px-4 min-h-[44px] border border-[var(--texto)]/10 focus:border-[var(--primario)] outline-none transition-colors text-sm"
        />
        <button type="submit" disabled={!nuevoNombre.trim()}
          className="bg-[var(--primario)] text-[var(--fondo)] font-semibold px-5 min-h-[44px] rounded-xl hover:brightness-110 transition-all disabled:opacity-50 text-sm whitespace-nowrap">Agregar</button>
      </form>

      <div className="flex gap-2 mb-6">
        {partido.estado !== "cerrado" ? (
          <button onClick={() => ejecutar(() => cerrarPartido(id))} className="flex-1 bg-red-500/10 text-red-400 min-h-[44px] rounded-xl text-sm hover:bg-red-500/20 transition-colors">Cerrar partido</button>
        ) : (
          <button onClick={() => ejecutar(() => reabrirPartido(id))} className="flex-1 bg-[var(--primario)]/10 text-[var(--primario)] min-h-[44px] rounded-xl text-sm hover:brightness-110 transition-colors">Reabrir partido</button>
        )}
      </div>

      {/* Payment summary */}
      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">Resumen de pagos</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><p className="text-2xl font-bold text-green-500">{confirmados.length}</p><p className="text-xs text-[var(--texto)]/50">Pagaron</p></div>
          <div><p className="text-2xl font-bold text-amber-400">{pendientes.length}</p><p className="text-xs text-[var(--texto)]/50">x revisar</p></div>
          <div><p className="text-2xl font-bold text-[var(--primario)]">${totalRecaudado.toFixed(0)}</p><p className="text-xs text-[var(--texto)]/50">de ${partido.costo_total.toFixed(0)}</p></div>
        </div>
      </div>

      {/* Teams grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <EquipoPanel nombre="Team 1" jugadores={team1} max={maxPorEquipo}
          onAccion={abrirAccion} onPago={abrirPago} onVerComprobante={handleVerComprobante} />
        <EquipoPanel nombre="Team 2" jugadores={team2} max={maxPorEquipo}
          onAccion={abrirAccion} onPago={abrirPago} onVerComprobante={handleVerComprobante} />
      </div>

      {/* Reserve */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">
          Reserva ({reserva.length}) · <span className="text-[var(--primario)]">${montoPorJugador}</span> c/u
        </h2>
        <div className="space-y-1.5">
          {reserva.length === 0 && <p className="text-xs text-[var(--texto)]/30 text-center py-4 bg-[var(--superficie)] rounded-xl">Sin jugadores en reserva</p>}
          {reserva.map((j) => (
            <PlayerRow key={j.id} jugador={j} onAccion={abrirAccion} onPago={abrirPago} onVerComprobante={handleVerComprobante} />
          ))}
        </div>
      </div>

      <div className="text-center text-[var(--texto)]/30 text-xs py-4">
        {jugadores.length} jugadores · {Math.max(0, maxPorEquipo - team1.length)} cupo T1 · {Math.max(0, maxPorEquipo - team2.length)} cupo T2
      </div>

      {/* ⋮ Action BottomSheet */}
      <BottomSheet abierto={!!accionJugador} onCerrar={cerrarAccion} titulo={accionJugador?.nombre ?? ""}>
        {accionJugador && (
          <div className="space-y-2">
            {accionJugador.equipo !== "team1" && (
              <AccionBtn icon="⚽" label="Mover a Team 1" onClick={() => handleMover(accionJugador.id, "team1")} />
            )}
            {accionJugador.equipo !== "team2" && (
              <AccionBtn icon="⚽" label="Mover a Team 2" onClick={() => handleMover(accionJugador.id, "team2")} />
            )}
            {accionJugador.equipo && (
              <AccionBtn icon="📋" label="Mover a Reserva" onClick={() => handleMover(accionJugador.id, null)} />
            )}
            <AccionBtn icon="🗑️" label="Eliminar del partido" onClick={() => handleEliminar(accionJugador.id)} peligro />
          </div>
        )}
      </BottomSheet>

      {/* Payment review modal */}
      {pagoJugador && (
        <PaymentReviewModal
          onCerrar={cerrarPago}
          jugador={pagoJugador}
          onConfirmar={(jid) => ejecutar(() => confirmarPago(jid))}
          onRechazar={(jid) => ejecutar(() => rechazarPago(jid))}
          onVerComprobante={handleVerComprobante}
        />
      )}
    </div>
  );
}

/* ── Sub-componentes ── */

function EquipoPanel({ nombre, jugadores, max, onAccion, onPago, onVerComprobante }: {
  nombre: string;
  jugadores: JugadorConPago[];
  max: number;
  onAccion: (j: JugadorConPago) => void;
  onPago: (j: JugadorConPago) => void;
  onVerComprobante: (id: string) => void;
}) {
  return (
    <div className="bg-[var(--superficie)] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-[var(--texto)]/70">{nombre}</h3>
        <span className="text-[10px] text-[var(--texto)]/40">{jugadores.length}/{max}</span>
      </div>
      <div className="space-y-1">
        {jugadores.length === 0 && <p className="text-[10px] text-[var(--texto)]/30 text-center py-3">Vacío</p>}
        {jugadores.map((j) => (
          <PlayerRow key={j.id} jugador={j} onAccion={onAccion} onPago={onPago} onVerComprobante={onVerComprobante} />
        ))}
      </div>
    </div>
  );
}

function PlayerRow({ jugador, onAccion, onPago, onVerComprobante }: {
  jugador: JugadorConPago;
  onAccion: (j: JugadorConPago) => void;
  onPago: (j: JugadorConPago) => void;
  onVerComprobante: (id: string) => void;
}) {
  const estado = jugador.pago?.estado ?? "sin_declarar";
  const esPendiente = estado === "pendiente_confirmacion";

  return (
    <div className="flex items-center gap-2 bg-[var(--fondo)] rounded-lg px-3 min-h-[44px]">
      <span className="text-sm shrink-0">{jugador.emoji_o_color ?? "⚽"}</span>

      <span className="text-xs truncate flex-1 min-w-0">{jugador.nombre}</span>

      <PagoBadge
        estado={estado}
        onClick={esPendiente ? () => onPago(jugador) : undefined}
      />

      <button
        onClick={() => onAccion(jugador)}
        className="shrink-0 p-2 rounded-lg hover:bg-[var(--texto)]/10 transition-colors active:scale-90"
        aria-label="Acciones"
      >
        <svg className="w-4 h-4 text-[var(--texto)]/40" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
        </svg>
      </button>
    </div>
  );
}

function AccionBtn({ icon, label, onClick, peligro }: {
  icon: string;
  label: string;
  onClick: () => void;
  peligro?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 min-h-[48px] rounded-xl text-sm font-medium transition-all active:scale-[0.98] ${
        peligro
          ? "text-red-400 hover:bg-red-500/10"
          : "text-[var(--texto)] hover:bg-[var(--primario)]/10"
      }`}
    >
      <span className="text-lg">{icon}</span>
      {label}
    </button>
  );
}
