"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  obtenerVistaPartido,
  elegirEmoji,
  darseDeBaja,
  cambiarEquipo,
  type VistaPartido,
} from "@/app/actions/jugadores";
import {
  declararPagoSinComprobante,
  subirComprobante,
} from "@/app/actions/pagos";
import { asegurarSesion } from "@/lib/supabase/ensure-session";
import { EMOJIS } from "@/lib/constants";
import { montoDisponibleSegunEstado, MENSAJE_MONTO_PENDIENTE } from "@/lib/monto";
import type { Equipo } from "@/lib/db/types";

import BottomSheet from "@/components/BottomSheet";
import PagoBadge from "@/components/PagoBadge";

export default function PlayerViewPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState<VistaPartido | null>(null);
  const [error, setError] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [declarando, setDeclarando] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const cerrarMenu = () => setMenuAbierto(false);

  const cargar = useCallback(async () => {
    const uid = await asegurarSesion();
    if (!uid) { setError("No se pudo iniciar la sesión."); setCargando(false); return; }
    const res = await obtenerVistaPartido(slug);
    if (!res.ok) { setError(res.error); setCargando(false); return; }
    if (!res.data.yo) { router.replace(`/unirse/${slug}`); return; }
    setVista(res.data); setCargando(false);
  }, [slug, router]);

  useEffect(() => { (async () => { await cargar(); })(); }, [cargar]);

  const handleSubirComprobante = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setSubiendo(true); setError("");
    const fd = new FormData(); fd.append("comprobante", file);
    const res = await subirComprobante(slug, fd);
    if (!res.ok) setError(res.error);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setSubiendo(false); await cargar();
  };

  const handleElegirEmoji = async (emoji: string) => {
    const res = await elegirEmoji(slug, emoji);
    if (!res.ok) { setError(res.error); return; }
    await cargar();
  };

  const handleCambiarEquipo = async (equipo: Equipo) => {
    setError("");
    const res = await cambiarEquipo(slug, equipo);
    if (!res.ok) setError(res.error); else await cargar();
    cerrarMenu();
  };

  const handleDeclararPago = async () => {
    if (!confirm("¿Confirmás que ya pagaste?")) return;
    setDeclarando(true); setError("");
    const res = await declararPagoSinComprobante(slug);
    if (!res.ok) setError(res.error);
    setDeclarando(false); await cargar();
  };

  const handleDarseDeBaja = async () => {
    if (!confirm("¿Querés darte de baja del partido?")) return;
    const res = await darseDeBaja(slug);
    if (!res.ok) { setError(res.error); return; }
    router.replace(`/unirse/${slug}`);
  };

  if (cargando) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin text-4xl">⚽</div></div>;
  if (!vista?.yo) return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="text-5xl mb-4">🚫</div>
      <p className="text-[var(--texto)]/70 text-center">{error || "Partido no encontrado"}</p>
    </div>
  );

  const { partido, jugadores, yo } = vista;
  const team1 = jugadores.filter((j) => j.equipo === "team1");
  const team2 = jugadores.filter((j) => j.equipo === "team2");
  const reserva = jugadores.filter((j) => !j.equipo);
  const maxPorEquipo = partido.cantidadJugadores / 2;

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      <div className="text-center mb-6">
        <div className="text-5xl mb-2">{yo.emoji ?? "⚽"}</div>
        <h1 className="text-2xl font-bold text-[var(--primario)]">¡Hola, {yo.nombre}!</h1>
      </div>

      {error && <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2 mb-4 text-center">{error}</p>}

      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <p className="text-sm text-[var(--texto)]/70">
          {new Date(partido.fechaHora).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <p className="text-[var(--texto)]/50 text-xs">
          {new Date(partido.fechaHora).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit"})} · {maxPorEquipo} vs {maxPorEquipo}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            yo.equipo === "team1" ? "bg-[var(--primario)]/20 text-[var(--primario)]" :
            yo.equipo === "team2" ? "bg-blue-500/20 text-blue-400" : "bg-gray-500/20 text-gray-400"
          }`}>{yo.equipo === "team1" ? "Team 1" : yo.equipo === "team2" ? "Team 2" : "Reserva"}</span>
          <PagoBadge estado={yo.pagoEstado} />
        </div>
      </div>

      {partido.resultadoTeam1 != null && partido.resultadoTeam2 != null && (
        <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6 text-center">
          <h2 className="text-xs font-semibold text-[var(--texto)]/50 mb-2 uppercase tracking-wider">Resultado final</h2>
          <p className="text-2xl font-bold text-[var(--texto)]">
            Team 1 <span className="text-[var(--primario)]">{partido.resultadoTeam1}</span>
            {" - "}
            <span className="text-[var(--primario)]">{partido.resultadoTeam2}</span> Team 2
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-6">
        <TeamCard nombre="Team 1" jugadores={team1} max={maxPorEquipo} yoId={yo.id}
          onElegir={() => handleCambiarEquipo("team1")} />
        <TeamCard nombre="Team 2" jugadores={team2} max={maxPorEquipo} yoId={yo.id}
          onElegir={() => handleCambiarEquipo("team2")} />
      </div>

      {reserva.length > 0 && (
        <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
          <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">Reserva ({reserva.length})</h2>
          <div className="space-y-1">
            {reserva.map((j) => (
              <div key={j.id} className="flex items-center gap-2 bg-[var(--fondo)] rounded-lg px-3 min-h-[40px]">
                <span className="text-xs shrink-0">{j.emoji ?? "⚽"}</span>
                <span className={`text-xs truncate flex-1 ${j.id === yo.id ? "text-[var(--primario)] font-medium" : "text-[var(--texto)]"}`}>
                  {j.nombre}{j.id === yo.id && <span className="ml-1">(vos)</span>}
                </span>
                {j.pagoEstado && <PagoBadge estado={j.pagoEstado} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {!yo.equipo && (
        <div className="text-center mb-6">
          <p className="text-sm text-[var(--texto)]/50 mb-2">Elegí un equipo para jugar</p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => handleCambiarEquipo("team1")}
              className="min-h-[44px] px-6 bg-[var(--primario)]/20 text-[var(--primario)] font-medium rounded-xl hover:brightness-110 transition-all active:scale-95">⚽ Team 1</button>
            <button onClick={() => handleCambiarEquipo("team2")}
              className="min-h-[44px] px-6 bg-[var(--primario)]/20 text-[var(--primario)] font-medium rounded-xl hover:brightness-110 transition-all active:scale-95">⚽ Team 2</button>
          </div>
        </div>
      )}

      {yo.equipo && (
        <div className="text-center mb-6">
          <button onClick={() => setMenuAbierto(true)}
            className="min-h-[44px] px-6 bg-gray-500/15 text-gray-400 font-medium rounded-xl hover:brightness-110 transition-all active:scale-95">📋 Ir a reserva</button>
        </div>
      )}

      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">
          {yo.pagoEstado === "confirmado" ? "✅ Pago confirmado" :
           yo.pagoEstado === "pendiente_confirmacion" ? "⏳ Pendiente de confirmación" :
           yo.pagoEstado === "rechazado" ? "❌ Pago rechazado" : "💰 Tu pago"}
        </h2>
        {/* Si todavía no sos titular no pagás nada (0 real, no "pendiente").
            Si ya sos titular pero el partido sigue armándose, el monto
            puede cambiar con cada alta: se oculta hasta que esté fijo. */}
        {yo.equipo && !montoDisponibleSegunEstado(partido.estado) ? (
          <p className="text-sm text-[var(--texto)]/50 mb-4">{MENSAJE_MONTO_PENDIENTE}</p>
        ) : (
          <p className="text-2xl font-bold text-[var(--primario)] mb-4">${yo.montoEsperado.toFixed(2)}</p>
        )}

        {yo.pagoEstado !== "confirmado" && (
          <>
            {yo.pagoEstado === "pendiente_confirmacion" ? (
              <p className="text-[var(--texto)]/60 text-xs">
                {yo.tieneComprobante ? "⏳ Comprobante enviado. El organizador lo va a revisar." : "⏳ Declaraste el pago. El organizador lo va a confirmar."}
              </p>
            ) : (
              <>
                <p className="text-[var(--texto)]/60 text-xs mb-3">
                  {yo.pagoEstado === "rechazado" ? "El pago fue rechazado. Podés subir comprobante o pagar en efectivo." : "Subí un comprobante o decí que pagaste."}
                </p>
                <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleSubirComprobante} className="hidden" />
                <div className="flex gap-2">
                  <button onClick={() => fileInputRef.current?.click()} disabled={subiendo}
                    className="flex-1 min-h-[44px] bg-[var(--primario)]/20 text-[var(--primario)] font-medium rounded-xl hover:brightness-110 transition-all disabled:opacity-50 active:scale-[0.98]">
                    {subiendo ? "Subiendo..." : "📸 Subir comprobante"}
                  </button>
                  <button onClick={handleDeclararPago} disabled={declarando}
                    className="flex-1 min-h-[44px] bg-[var(--primario)]/10 text-[var(--primario)] font-medium rounded-xl hover:brightness-110 transition-all disabled:opacity-50 active:scale-[0.98]">
                    {declarando ? "Enviando..." : "💵 Pagado"}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {yo.pagoEstado === "pendiente_confirmacion" && yo.tieneComprobante && (
          <p className="text-center text-[var(--texto)]/50 text-xs mt-3">Comprobante enviado.</p>
        )}
      </div>

      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">Elegí tu emoji</h2>
        <div className="flex flex-wrap gap-2">
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => handleElegirEmoji(e)}
              className={`text-2xl w-10 h-10 flex items-center justify-center rounded-lg transition-all ${
                yo.emoji === e ? "bg-[var(--primario)]/20 ring-2 ring-[var(--primario)]" : "hover:bg-[var(--primario)]/10"
              }`}>{e}</button>
          ))}
        </div>
      </div>

      <button onClick={handleDarseDeBaja} className="w-full text-red-400/70 text-sm min-h-[44px] rounded-xl hover:text-red-400 hover:bg-red-500/5 transition-all">
        Darme de baja del partido
      </button>

      <BottomSheet abierto={menuAbierto} onCerrar={cerrarMenu} titulo="Opciones">
        {yo.equipo !== "team1" && <MenuBtn icon="⚽" label="Unirme a Team 1" onClick={() => handleCambiarEquipo("team1")} />}
        {yo.equipo !== "team2" && <MenuBtn icon="⚽" label="Unirme a Team 2" onClick={() => handleCambiarEquipo("team2")} />}
        {yo.equipo && <MenuBtn icon="📋" label="Ir a reserva" onClick={() => handleCambiarEquipo(null)} />}
      </BottomSheet>
    </div>
  );
}

// Si estoy en este equipo se deduce de `jugadores` + `yoId` (estoyAca), así
// que no hace falta pasar miEquipo por separado.
function TeamCard({ nombre, jugadores, max, yoId, onElegir }: {
  nombre: string; jugadores: VistaPartido["jugadores"]; max: number;
  yoId: string; onElegir: () => void;
}) {
  const estoyAca = jugadores.some((j) => j.id === yoId);
  return (
    <div className="bg-[var(--superficie)] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-[var(--texto)]/70">{nombre}</h3>
        <span className="text-[10px] text-[var(--texto)]/40">{jugadores.length}/{max}</span>
      </div>
      <div className="space-y-1 mb-2 min-h-[48px]">
        {jugadores.length === 0 && <p className="text-[10px] text-[var(--texto)]/30 text-center py-2">Vacío</p>}
        {jugadores.map((j) => (
          <div key={j.id} className={`text-xs truncate ${j.id === yoId ? "text-[var(--primario)] font-medium" : "text-[var(--texto)]"}`}>
            {j.emoji && <span className="mr-0.5">{j.emoji}</span>}{j.nombre}{j.id === yoId && <span className="ml-0.5">(vos)</span>}
          </div>
        ))}
      </div>
      <button onClick={onElegir} disabled={!estoyAca && jugadores.length >= max}
        className="w-full min-h-[36px] text-[10px] bg-[var(--primario)]/20 text-[var(--primario)] font-medium rounded-md hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]">
        {estoyAca ? "Salir del equipo" : "Unirme aquí"}
      </button>
    </div>
  );
}

function MenuBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-4 min-h-[48px] rounded-xl text-sm font-medium text-[var(--texto)] hover:bg-[var(--primario)]/10 transition-all active:scale-[0.98]">
      <span className="text-lg">{icon}</span>{label}
    </button>
  );
}
