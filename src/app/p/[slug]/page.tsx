"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  obtenerVistaPartido,
  elegirEmoji,
  darseDeBaja,
  type VistaPartido,
} from "@/app/actions/jugadores";
import {
  declararPagoSinComprobante,
  subirComprobante,
} from "@/app/actions/pagos";
import { asegurarSesion } from "@/lib/supabase/ensure-session";
import { EMOJIS } from "@/lib/constants";

export default function PlayerViewPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState<VistaPartido | null>(null);
  const [error, setError] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [declarando, setDeclarando] = useState(false);

  const cargar = useCallback(async () => {
    const uid = await asegurarSesion();
    if (!uid) {
      setError("No se pudo iniciar la sesión. ¿Habilitaste anonymous sign-ins?");
      setCargando(false);
      return;
    }

    const res = await obtenerVistaPartido(slug);

    if (!res.ok) {
      setError(res.error);
      setCargando(false);
      return;
    }

    if (!res.data.yo) {
      router.replace(`/unirse/${slug}`);
      return;
    }

    setVista(res.data);
    setCargando(false);
  }, [slug, router]);

  useEffect(() => {
    // El await evita que el setState caiga sincrónico dentro del efecto.
    (async () => {
      await cargar();
    })();
  }, [cargar]);

  const handleSubirComprobante = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSubiendo(true);
    setError("");

    const formData = new FormData();
    formData.append("comprobante", file);

    const res = await subirComprobante(slug, formData);
    if (!res.ok) setError(res.error);

    if (fileInputRef.current) fileInputRef.current.value = "";
    setSubiendo(false);
    await cargar();
  };

  const handleElegirEmoji = async (emoji: string) => {
    const res = await elegirEmoji(slug, emoji);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await cargar();
  };

  const handleDeclararPago = async () => {
    if (!confirm("¿Confirmás que ya pagaste en efectivo?")) return;

    setDeclarando(true);
    setError("");

    const res = await declararPagoSinComprobante(slug);
    if (!res.ok) setError(res.error);

    setDeclarando(false);
    await cargar();
  };

  const handleDarseDeBaja = async () => {
    if (!confirm("¿Querés darte de baja del partido?")) return;

    const res = await darseDeBaja(slug);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.replace(`/unirse/${slug}`);
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin text-4xl">⚽</div>
      </div>
    );
  }

  if (!vista?.yo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6">
        <div className="text-5xl mb-4">🚫</div>
        <p className="text-[var(--texto)]/70 text-center">
          {error || "Partido no encontrado"}
        </p>
      </div>
    );
  }

  const { partido, jugadores, yo } = vista;
  const titulares = jugadores.filter((j) => j.rol === "titular");
  const suplentes = jugadores.filter((j) => j.rol === "suplente");
  const porEquipo = partido.cantidadJugadores / 2;

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      <div className="text-center mb-8">
        <div className="text-5xl mb-2">{yo.emoji ?? "⚽"}</div>
        <h1 className="text-2xl font-bold text-[var(--primario)]">
          ¡Hola, {yo.nombre}!
        </h1>
      </div>

      {error && (
        <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2 mb-4 text-center">
          {error}
        </p>
      )}

      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <p className="text-sm text-[var(--texto)]/70">
          {new Date(partido.fechaHora).toLocaleDateString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <p className="text-[var(--texto)]/50 text-xs">
          {new Date(partido.fechaHora).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          · {porEquipo} vs {porEquipo}
        </p>
        <div className="mt-2">
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${
              yo.rol === "titular"
                ? "bg-[var(--primario)]/20 text-[var(--primario)]"
                : "bg-[var(--pendiente)]/20 text-[var(--pendiente)]"
            }`}
          >
            {yo.rol === "titular" ? "Titular" : "Suplente"}
          </span>
        </div>
      </div>

      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">
          Elegí tu emoji
        </h2>
        <div className="flex flex-wrap gap-2">
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => handleElegirEmoji(e)}
              className={`text-2xl w-10 h-10 flex items-center justify-center rounded-lg transition-all ${
                yo.emoji === e
                  ? "bg-[var(--primario)]/20 ring-2 ring-[var(--primario)]"
                  : "hover:bg-[var(--primario)]/10"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {yo.rol === "titular" && (
        <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
          <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">
            {yo.pagoEstado === "confirmado"
              ? "✅ Pago confirmado"
              : yo.pagoEstado === "pendiente_confirmacion"
              ? "⏳ Pendiente de confirmación"
              : yo.pagoEstado === "rechazado"
              ? "❌ Comprobante rechazado"
              : "💰 Tu pago"}
          </h2>

          <p className="text-2xl font-bold text-[var(--primario)] mb-4">
            ${yo.montoEsperado.toFixed(2)}
          </p>

          {yo.pagoEstado !== "confirmado" && (
            <>
              {yo.pagoEstado === "pendiente_confirmacion" ? (
                <p className="text-[var(--texto)]/60 text-xs">
                  {yo.tieneComprobante
                    ? "⏳ Comprobante enviado. El organizador lo va a revisar."
                    : "⏳ Declaraste el pago. El organizador lo va a confirmar."}
                </p>
              ) : (
                <>
                  <p className="text-[var(--texto)]/60 text-xs mb-3">
                    {yo.pagoEstado === "rechazado"
                      ? "El pago fue rechazado. Podés subir comprobante o pagar en efectivo."
                      : "Subí un comprobante o decí que pagaste en efectivo."}
                  </p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleSubirComprobante}
                    className="hidden"
                  />

                  <div className="flex gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={subiendo}
                      className="flex-1 bg-[var(--primario)]/20 text-[var(--primario)] font-medium py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
                    >
                      {subiendo
                        ? "Subiendo..."
                        : "📸 Subir comprobante"}
                    </button>

                    <button
                      onClick={handleDeclararPago}
                      disabled={declarando}
                      className="flex-1 bg-[var(--primario)]/10 text-[var(--primario)] font-medium py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
                    >
                      {declarando
                        ? "Enviando..."
                        : "💵 Pagado en efectivo"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {yo.pagoEstado === "pendiente_confirmacion" && yo.tieneComprobante && (
            <p className="text-center text-[var(--texto)]/50 text-xs mt-3">
              Comprobante enviado. Solo el organizador puede verlo.
            </p>
          )}
        </div>
      )}

      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">
          Jugadores ({jugadores.length})
        </h2>

        <div className="space-y-2">
          {titulares.map((j) => (
            <div
              key={j.id}
              className={`flex items-center justify-between ${
                j.id === yo.id
                  ? "text-[var(--primario)] font-medium"
                  : "text-[var(--texto)]"
              }`}
            >
              <span>
                {j.emoji && <span className="mr-1.5">{j.emoji}</span>}
                {j.nombre}
                {j.id === yo.id && <span className="ml-1">(vos)</span>}
              </span>
              <span
                className={`text-xs ${
                  j.pagoEstado === "confirmado"
                    ? "text-[var(--confirmado)]"
                    : j.pagoEstado === "pendiente_confirmacion"
                    ? "text-[var(--pendiente)]"
                    : "text-[var(--texto)]/30"
                }`}
              >
                {j.pagoEstado === "confirmado"
                  ? "✓"
                  : j.pagoEstado === "pendiente_confirmacion"
                  ? "⏳"
                  : "—"}
              </span>
            </div>
          ))}
        </div>

        {suplentes.length > 0 && (
          <div className="border-t border-[var(--texto)]/10 my-3 pt-3">
            <p className="text-xs text-[var(--texto)]/50 mb-2">Suplentes</p>
            {suplentes.map((j) => (
              <div
                key={j.id}
                className={`flex items-center justify-between ${
                  j.id === yo.id
                    ? "text-[var(--primario)] font-medium"
                    : "text-[var(--texto)]"
                }`}
              >
                <span>
                  {j.emoji && <span className="mr-1.5">{j.emoji}</span>}
                  {j.nombre}
                  {j.id === yo.id && <span className="ml-1">(vos)</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={handleDarseDeBaja}
        className="w-full text-red-400/70 text-sm py-3 rounded-xl hover:text-red-400 hover:bg-red-500/5 transition-all"
      >
        Darme de baja del partido
      </button>
    </div>
  );
}
