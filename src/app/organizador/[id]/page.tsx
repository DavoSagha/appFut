"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { cerrarPartido, reabrirPartido, guardarResultado } from "@/app/actions/partidos";
import { agregarJugador, eliminarJugador, guardarCambiosEquipos } from "@/app/actions/jugadores";
import { confirmarPago, rechazarPago, revertirPago, verComprobante } from "@/app/actions/pagos";
import type { Partido, JugadorRol, PagoEstado, Equipo } from "@/lib/db/types";
import {
  aplicarDraftEquipo,
  moverEnDraft,
  obtenerCambiosEquipo,
  reconciliarDraftEquipo,
  type EquipoDraft,
} from "@/lib/equipos-draft";
import { calcularMontoPorJugador, MENSAJE_MONTO_PENDIENTE } from "@/lib/monto";

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
  const [equiposDraft, setEquiposDraft] = useState<EquipoDraft>({});
  const [guardandoEquipos, setGuardandoEquipos] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [linkCopiado, setLinkCopiado] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");

  // — Resultado final: null = "mostrar lo guardado", no hace falta
  // useEffect para sincronizar con partido (eso es puro estado derivado).
  const [resultadoEditado, setResultadoEditado] = useState<{ team1: string; team2: string } | null>(null);
  const [guardandoResultado, setGuardandoResultado] = useState(false);

  // — BottomSheet de acciones ⋮
  const [accionJugador, setAccionJugador] = useState<JugadorConPago | null>(null);
  const abrirAccion = (j: JugadorConPago) => setAccionJugador(j);
  const cerrarAccion = () => setAccionJugador(null);

  // — Modal de revisión de pago
  const [pagoJugador, setPagoJugador] = useState<JugadorConPago | null>(null);
  const abrirPago = (j: JugadorConPago) => setPagoJugador(j);
  const cerrarPago = () => setPagoJugador(null);

  // Cada llamada se numera: si una más nueva ya arrancó, la respuesta de una
  // vieja que llega tarde se descarta en vez de pisar el estado más fresco.
  const cargaSeqRef = useRef(0);

  const cargarDatos = useCallback(async (): Promise<boolean> => {
    const seq = ++cargaSeqRef.current;
    const sigueVigente = () => cargaSeqRef.current === seq;

    try {
      const supabase = getSupabase();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!sigueVigente()) return false;
      if (!session) {
        router.replace("/auth/login");
        return false;
      }

      // Seqlock de lectura: versión -> roster -> versión. Si hubo una mutación
      // entre consultas, reintentamos y nunca asociamos un roster nuevo a una
      // versión vieja (ni al revés).
      for (let intento = 0; intento < 3; intento += 1) {
        const { data: rawPartido, error: errorPartido } = await supabase
          .from("partidos")
          .select("*")
          .eq("id", id)
          .single();

        if (!sigueVigente()) return false;
        if (errorPartido || !rawPartido) {
          setCargando(false);
          setError("No se pudo cargar el partido");
          return false;
        }

        const { data: jugs, error: errJugs } = await supabase
          .from("jugadores")
          .select(
            "id, nombre, rol, equipo, emoji_o_color, pago:pagos(estado, monto_esperado, monto_pagado, comprobante_url)",
          )
          .eq("partido_id", id)
          .order("orden_ingreso", { ascending: true })
          .returns<JugadorConPago[]>();

        if (!sigueVigente()) return false;
        if (errJugs) {
          setCargando(false);
          setError("No se pudieron cargar los jugadores");
          return false;
        }

        const { data: versionActual, error: errorVersion } = await supabase
          .from("partidos")
          .select("roster_version")
          .eq("id", id)
          .single();

        if (!sigueVigente()) return false;
        if (errorVersion || !versionActual) {
          setCargando(false);
          setError("No se pudo verificar la versión del plantel");
          return false;
        }

        const versionAntes = Number(rawPartido.roster_version);
        const versionDespues = Number(versionActual.roster_version);
        if (
          !Number.isSafeInteger(versionAntes) ||
          !Number.isSafeInteger(versionDespues) ||
          versionAntes < 0 ||
          versionDespues < 0
        ) {
          setCargando(false);
          setError("La versión del plantel es inválida");
          return false;
        }

        if (versionAntes !== versionDespues) continue;

        const siguientes = jugs ?? [];
        setPartido({
          ...(rawPartido as Partido),
          roster_version: versionDespues,
        });
        setJugadores(siguientes);
        setEquiposDraft((actual) =>
          reconciliarDraftEquipo(siguientes, actual),
        );
        setCargando(false);
        return true;
      }

      if (sigueVigente()) {
        setCargando(false);
        setError(
          "El plantel está cambiando. Esperá un instante y volvé a intentar.",
        );
      }
      return false;
    } catch {
      if (sigueVigente()) {
        setCargando(false);
        setError("No se pudo actualizar el plantel");
      }
      return false;
    }
  }, [id, router]);

  useEffect(() => {
    void (async () => {
      await cargarDatos();
    })();
  }, [cargarDatos]);

  const handleGuardarResultado = async (e: React.FormEvent, team1Str: string, team2Str: string) => {
    e.preventDefault();
    const t1 = Number(team1Str);
    const t2 = Number(team2Str);
    if (
      team1Str.trim() === "" || team2Str.trim() === "" ||
      !Number.isInteger(t1) || !Number.isInteger(t2) || t1 < 0 || t2 < 0
    ) {
      setError("El resultado debe ser un número entero no negativo para cada equipo");
      return;
    }

    setGuardandoResultado(true);
    setError("");
    const res = await guardarResultado(id, t1, t2);
    setGuardandoResultado(false);
    if (!res.ok) { setError(res.error); return; }
    setResultadoEditado(null);
    await cargarDatos();
  };

  const ejecutar = async (accion: () => Promise<{ ok: boolean; error?: string }>) => {
    if (guardandoEquipos) {
      setError("Esperá a que termine de guardarse el plantel.");
      return;
    }

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
    try { await navigator.clipboard.writeText(link); setLinkCopiado(true); setTimeout(() => setLinkCopiado(false), 2000); }
    catch { setError(`No se pudo copiar. El link es: ${link}`); }
  };

  const handleAgregar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardandoEquipos) return;
    await ejecutar(() => agregarJugador(id, nuevoNombre));
    setNuevoNombre("");
  };

  const handleEliminar = async (jugadorId: string) => {
    if (guardandoEquipos) return;
    if (!confirm("¿Eliminar este jugador del partido?")) return;
    await ejecutar(() => eliminarJugador(jugadorId));
    cerrarAccion();
  };

  const handleMover = (jugadorId: string, equipo: Equipo) => {
    if (!partido || guardandoEquipos) return;

    setError("");
    const resultado = moverEnDraft(
      jugadores,
      equiposDraft,
      jugadorId,
      equipo,
      partido.cantidad_jugadores,
    );

    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }

    setEquiposDraft(resultado.draft);
    cerrarAccion();
  };

  const handleDescartarEquipos = () => {
    if (guardandoEquipos) return;
    setEquiposDraft({});
    setError("");
  };

  const handleConfirmarEquipos = async () => {
    if (guardandoEquipos || !partido) return;

    const cambios = obtenerCambiosEquipo(jugadores, equiposDraft);
    if (cambios.length === 0) return;

    setGuardandoEquipos(true);
    setError("");
    try {
      const res = await guardarCambiosEquipos(
        id,
        cambios,
        partido.roster_version,
      );
      if (!res.ok) {
        const mensaje =
          res.error ?? "No se pudieron guardar los equipos";
        const recargado = await cargarDatos();
        setError(
          recargado
            ? mensaje
            : mensaje +
                " No pudimos actualizar la lista; conservamos tus cambios pendientes.",
        );
        return;
      }

      setPartido((actual) =>
        actual
          ? { ...actual, roster_version: res.data.rosterVersion }
          : actual,
      );

      const guardados = new Map(
        cambios.map((cambio) => [cambio.jugadorId, cambio.equipo]),
      );
      setJugadores((actuales) =>
        actuales.map((jugador) => {
          if (!guardados.has(jugador.id)) return jugador;
          const equipo = guardados.get(jugador.id) ?? null;
          return {
            ...jugador,
            equipo,
            rol: equipo ? "titular" : "suplente",
          };
        }),
      );
      setEquiposDraft({});
      await cargarDatos();
    } catch {
      const recargado = await cargarDatos();
      setError(
        recargado
          ? "No se pudieron guardar los equipos. Actualizamos la lista: revisá y probá de nuevo."
          : "No se pudieron guardar los equipos ni actualizar la lista. Conservamos tus cambios pendientes.",
      );
    } finally {
      setGuardandoEquipos(false);
    }
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

  const jugadoresEfectivos = aplicarDraftEquipo(jugadores, equiposDraft);
  const cambiosEquipo = obtenerCambiosEquipo(jugadores, equiposDraft);
  const team1 = jugadoresEfectivos.filter((j) => j.equipo === "team1");
  const team2 = jugadoresEfectivos.filter((j) => j.equipo === "team2");
  const reserva = jugadoresEfectivos.filter((j) => !j.equipo);
  const confirmados = jugadores.filter((j) => j.pago?.estado === "confirmado");
  const pendientes = jugadores.filter((j) => j.pago?.estado === "pendiente_confirmacion");
  // La reserva no reparte el costo: el divisor es Team1+Team2, nunca todos
  // los anotados. Y no se muestra nada hasta que el plantel esté completo.
  const infoMonto = calcularMontoPorJugador(
    partido.costo_total,
    team1.length + team2.length,
    partido.estado,
  );
  const totalRecaudado = confirmados.reduce((acc, j) => acc + (j.pago?.monto_pagado ?? j.pago?.monto_esperado ?? 0), 0);
  const maxPorEquipo = Math.ceil(partido.cantidad_jugadores / 2);
  const resultadoTeam1 = resultadoEditado?.team1 ?? (partido.resultado_team1 != null ? String(partido.resultado_team1) : "");
  const resultadoTeam2 = resultadoEditado?.team2 ?? (partido.resultado_team2 != null ? String(partido.resultado_team2) : "");

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
          placeholder="Nombre del jugador" maxLength={50} disabled={guardandoEquipos}
          className="flex-1 bg-[var(--superficie)] text-[var(--texto)] rounded-xl px-4 min-h-[44px] border border-[var(--texto)]/10 focus:border-[var(--primario)] outline-none transition-colors text-sm disabled:opacity-50"
        />
        <button type="submit" disabled={!nuevoNombre.trim() || guardandoEquipos}
          className="bg-[var(--primario)] text-[var(--fondo)] font-semibold px-5 min-h-[44px] rounded-xl hover:brightness-110 transition-all disabled:opacity-50 text-sm whitespace-nowrap">Agregar</button>
      </form>

      <div className="flex gap-2 mb-6">
        {partido.estado !== "cerrado" ? (
          <button onClick={() => ejecutar(() => cerrarPartido(id))} disabled={guardandoEquipos} className="flex-1 bg-red-500/10 text-red-400 min-h-[44px] rounded-xl text-sm hover:bg-red-500/20 transition-colors disabled:opacity-50">Cerrar partido</button>
        ) : (
          <button onClick={() => ejecutar(() => reabrirPartido(id))} disabled={guardandoEquipos} className="flex-1 bg-[var(--primario)]/10 text-[var(--primario)] min-h-[44px] rounded-xl text-sm hover:brightness-110 transition-colors disabled:opacity-50">Reabrir partido</button>
        )}
      </div>

      {cambiosEquipo.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-6">
          <button
            type="button"
            onClick={handleDescartarEquipos}
            disabled={guardandoEquipos}
            className="min-h-[44px] rounded-xl bg-[var(--superficie)] text-[var(--texto)]/70 text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50"
          >
            Descartar cambios
          </button>
          <button
            type="button"
            onClick={handleConfirmarEquipos}
            disabled={guardandoEquipos}
            className="min-h-[44px] rounded-xl bg-[var(--primario)] text-[var(--fondo)] text-sm font-semibold hover:brightness-110 transition-all disabled:opacity-50"
          >
            {guardandoEquipos ? "Guardando..." : `Confirmar cambios (${cambiosEquipo.length})`}
          </button>
        </div>
      )}

      {/* Payment summary */}
      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">Resumen de pagos</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><p className="text-2xl font-bold text-green-500">{confirmados.length}</p><p className="text-xs text-[var(--texto)]/50">Pagaron</p></div>
          <div><p className="text-2xl font-bold text-amber-400">{pendientes.length}</p><p className="text-xs text-[var(--texto)]/50">x revisar</p></div>
          <div><p className="text-2xl font-bold text-[var(--primario)]">${totalRecaudado.toFixed(0)}</p><p className="text-xs text-[var(--texto)]/50">de ${partido.costo_total.toFixed(0)}</p></div>
        </div>
      </div>

      {/* Resultado final: editable en cualquier momento por el organizador,
          solo lectura para el resto (ver p/[slug]/page.tsx). */}
      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">Resultado final</h2>
        <form
          onSubmit={(e) => handleGuardarResultado(e, resultadoTeam1, resultadoTeam2)}
          className="flex items-center justify-center gap-3"
        >
          <span className="text-xs text-[var(--texto)]/60 flex-1 text-right">Team 1</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={resultadoTeam1}
            onChange={(e) => setResultadoEditado({ team1: e.target.value, team2: resultadoTeam2 })}
            disabled={guardandoResultado}
            className="w-14 text-center bg-[var(--fondo)] text-[var(--texto)] rounded-lg px-2 min-h-[40px] border border-[var(--texto)]/10 focus:border-[var(--primario)] outline-none transition-colors disabled:opacity-50"
          />
          <span className="text-[var(--texto)]/40">-</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={resultadoTeam2}
            onChange={(e) => setResultadoEditado({ team1: resultadoTeam1, team2: e.target.value })}
            disabled={guardandoResultado}
            className="w-14 text-center bg-[var(--fondo)] text-[var(--texto)] rounded-lg px-2 min-h-[40px] border border-[var(--texto)]/10 focus:border-[var(--primario)] outline-none transition-colors disabled:opacity-50"
          />
          <span className="text-xs text-[var(--texto)]/60 flex-1">Team 2</span>
          <button
            type="submit"
            disabled={guardandoResultado}
            className="shrink-0 bg-[var(--primario)] text-[var(--fondo)] font-semibold px-4 min-h-[40px] rounded-lg hover:brightness-110 transition-all disabled:opacity-50 text-sm whitespace-nowrap"
          >
            {guardandoResultado ? "Guardando..." : partido.resultado_team1 != null ? "Corregir" : "Guardar"}
          </button>
        </form>
      </div>

      {/* Teams grid: una columna en mobile (si no, el panel queda tan angosto
          que el nombre se aprieta a cero antes que el badge de pago), dos
          columnas desde tablet. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <EquipoPanel nombre="Team 1" jugadores={team1} max={maxPorEquipo}
          onAccion={abrirAccion} onPago={abrirPago} />
        <EquipoPanel nombre="Team 2" jugadores={team2} max={maxPorEquipo}
          onAccion={abrirAccion} onPago={abrirPago} />
      </div>

      {/* Reserve */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">
          Reserva ({reserva.length}) ·{" "}
          {infoMonto.disponible ? (
            <span className="text-[var(--primario)]">${infoMonto.monto.toFixed(2)} c/u</span>
          ) : (
            <span className="text-[var(--texto)]/40 normal-case tracking-normal">{MENSAJE_MONTO_PENDIENTE}</span>
          )}
        </h2>
        <div className="space-y-1.5">
          {reserva.length === 0 && <p className="text-xs text-[var(--texto)]/30 text-center py-4 bg-[var(--superficie)] rounded-xl">Sin jugadores en reserva</p>}
          {reserva.map((j) => (
            <PlayerRow key={j.id} jugador={j} onAccion={abrirAccion} onPago={abrirPago} />
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
          partidoEstado={partido.estado}
          jugador={pagoJugador}
          onConfirmar={(jid) => ejecutar(() => confirmarPago(jid))}
          onRechazar={(jid) => ejecutar(() => rechazarPago(jid))}
          onRevertir={(jid) => ejecutar(() => revertirPago(jid))}
          onVerComprobante={handleVerComprobante}
        />
      )}
    </div>
  );
}

/* ── Sub-componentes ── */

function EquipoPanel({ nombre, jugadores, max, onAccion, onPago }: {
  nombre: string;
  jugadores: JugadorConPago[];
  max: number;
  onAccion: (j: JugadorConPago) => void;
  onPago: (j: JugadorConPago) => void;
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
          <PlayerRow key={j.id} jugador={j} onAccion={onAccion} onPago={onPago} />
        ))}
      </div>
    </div>
  );
}

// El comprobante NO se ve desde acá: se abre desde PaymentReviewModal, que
// tiene su propio botón. Por eso esta fila no recibe onVerComprobante.
function PlayerRow({ jugador, onAccion, onPago }: {
  jugador: JugadorConPago;
  onAccion: (j: JugadorConPago) => void;
  onPago: (j: JugadorConPago) => void;
}) {
  const estado = jugador.pago?.estado ?? "sin_declarar";
  // Pendiente: para confirmar/rechazar. Confirmado: para poder revertirlo
  // si se marcó como pagado por error. Sin declarar/rechazado no tienen
  // ninguna acción del organizador desde acá.
  const abrePago = estado === "pendiente_confirmacion" || estado === "confirmado";

  return (
    <div className="flex items-center gap-2 bg-[var(--fondo)] rounded-lg px-3 min-h-[44px]">
      <span className="text-sm shrink-0">{jugador.emoji_o_color ?? "⚽"}</span>

      <span className="text-xs truncate flex-1 min-w-0">{jugador.nombre}</span>

      <PagoBadge
        estado={estado}
        onClick={abrePago ? () => onPago(jugador) : undefined}
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
