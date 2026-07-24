"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getSavedJugadorId,
  getOrCreateDeviceId,
  saveJugadorId,
} from "@/lib/device";
import type { Partido, Jugador, Pago } from "@/lib/db/types";

export const dynamic = "force-dynamic";

interface JugadorConPago extends Jugador {
  pago: Pago | null;
}

const EMOJIS = ["⚡", "🔥", "💪", "🦊", "🐺", "🦅", "🐂", "🐐", "⭐", "🎯"];

export default function PlayerViewPage() {
  const { slug } = useParams<{ slug: string }>();
  console.log("[PlayerView] Render - slug:", slug);
  const router = useRouter();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const getSupabase = () => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [partido, setPartido] = useState<Partido | null>(null);
  const [jugador, setJugador] = useState<JugadorConPago | null>(null);
  const [todosJugadores, setTodosJugadores] = useState<JugadorConPago[]>([]);
  const [error, setError] = useState("");
  const [subiendo, setSubiendo] = useState(false);

  const cargarDatos = useCallback(async () => {
    const supabase = getSupabase();
    const { data: p } = await supabase
      .from("partidos")
      .select("*")
      .eq("link_slug", slug)
      .single();

    if (!p) {
      setError("Partido no encontrado");
      setLoading(false);
      return;
    }

    const partidoData = p as Partido;
    setPartido(partidoData);

    const { data: jugs } = await supabase
      .from("jugadores")
      .select("*, pago:pagos(*)")
      .eq("partido_id", partidoData.id)
      .order("orden_ingreso", { ascending: true });

    const todos = (jugs as unknown as JugadorConPago[]) ?? [];
    setTodosJugadores(todos);

    const savedId = getSavedJugadorId(partidoData.id);
    const deviceId = getOrCreateDeviceId();

    let miJugador = savedId
      ? todos.find((j) => j.id === savedId)
      : null;

    if (!miJugador) {
      miJugador = todos.find((j) => j.device_id === deviceId) ?? null;
    }

    if (miJugador) {
      saveJugadorId(partidoData.id, miJugador.id);
      setJugador(miJugador);
    } else {
      router.replace(`/unirse/${slug}`);
      return;
    }

    setLoading(false);
  }, [slug, router]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const handleSubirComprobante = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const supabase = getSupabase();
    const file = e.target.files?.[0];
    if (!file || !partido || !jugador) return;

    setSubiendo(true);

    const fileExt = file.name.split(".").pop();
    const filePath = `${partido.id}/${jugador.id}/comprobante.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("comprobantes")
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      alert("Error al subir: " + uploadError.message);
      setSubiendo(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from("comprobantes")
      .getPublicUrl(filePath);

    const { error: updateError } = await supabase
      .from("pagos")
      .update({
        comprobante_url: urlData.publicUrl,
        estado: "pendiente_confirmacion",
      })
      .eq("jugador_id", jugador.id);

    if (updateError) {
      alert("Error al actualizar: " + updateError.message);
    }

    setSubiendo(false);
    cargarDatos();
  };

  const handleElegirEmoji = async (emoji: string) => {
    if (!jugador) return;
    const supabase = getSupabase();
    await supabase
      .from("jugadores")
      .update({ emoji_o_color: emoji })
      .eq("id", jugador.id);
    cargarDatos();
  };

  const handleDarseDeBaja = async () => {
    if (!jugador || !confirm("¿Querés darte de baja del partido?")) return;
    const supabase = getSupabase();
    await supabase.from("jugadores").delete().eq("id", jugador.id);
    const key = `appfut_partido_${jugador.partido_id}_jugador_id`;
    localStorage.removeItem(key);
    router.replace(`/unirse/${slug}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin text-4xl">⚽</div>
      </div>
    );
  }

  if (error || !partido || !jugador) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6">
        <div className="text-5xl mb-4">🚫</div>
        <p className="text-[var(--texto)]/70 text-center">{error}</p>
      </div>
    );
  }

  const miPago = jugador.pago;
  const titulares = todosJugadores.filter((j) => j.rol === "titular");
  const suplentes = todosJugadores.filter((j) => j.rol === "suplente");
  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      <div className="text-center mb-8">
        <div className="text-5xl mb-2">
          {jugador.emoji_o_color ?? "⚽"}
        </div>
        <h1 className="text-2xl font-bold text-[var(--primario)]">
          ¡Hola, {jugador.nombre}!
        </h1>
      </div>

      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <p className="text-sm text-[var(--texto)]/70">
          {new Date(partido.fecha_hora).toLocaleDateString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <p className="text-[var(--texto)]/50 text-xs">
          {new Date(partido.fecha_hora).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          · {partido.cantidad_jugadores / 2} vs{" "}
          {partido.cantidad_jugadores / 2}
        </p>
        <div className="mt-2">
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${
              jugador.rol === "titular"
                ? "bg-[var(--primario)]/20 text-[var(--primario)]"
                : "bg-[var(--pendiente)]/20 text-[var(--pendiente)]"
            }`}
          >
            {jugador.rol === "titular" ? "Titular" : "Suplente"}
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
                jugador.emoji_o_color === e
                  ? "bg-[var(--primario)]/20 ring-2 ring-[var(--primario)]"
                  : "hover:bg-[var(--primario)]/10"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {jugador.rol === "titular" && (
        <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
          <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">
            {miPago?.estado === "confirmado"
              ? "✅ Pago confirmado"
              : miPago?.estado === "pendiente_confirmacion"
              ? "⏳ Comprobante enviado"
              : miPago?.estado === "rechazado"
              ? "❌ Comprobante rechazado"
              : "💰 Tu pago"}
          </h2>

          <p className="text-2xl font-bold text-[var(--primario)] mb-4">
            ${miPago?.monto_esperado.toFixed(2) ?? "0.00"}
          </p>

          {miPago?.estado !== "confirmado" && (
            <>
              <p className="text-[var(--texto)]/60 text-xs mb-3">
                {miPago?.estado === "rechazado"
                  ? "El comprobante fue rechazado. Podés subir otro."
                  : "Subí una foto del comprobante de transferencia."}
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleSubirComprobante}
                className="hidden"
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={subiendo}
                className="w-full bg-[var(--primario)]/20 text-[var(--primario)] font-medium py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
              >
                {subiendo
                  ? "Subiendo..."
                  : miPago?.estado === "rechazado"
                  ? "Subir nuevo comprobante"
                  : "📸 Subir comprobante"}
              </button>
            </>
          )}

          {miPago?.comprobante_url && miPago?.estado !== "rechazado" && (
            <a
              href={miPago.comprobante_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-[var(--primario)] text-sm mt-2 hover:underline"
            >
              Ver comprobante subido
            </a>
          )}
        </div>
      )}

      <div className="bg-[var(--superficie)] rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-[var(--texto)]/70 mb-3 uppercase tracking-wider">
          Jugadores ({todosJugadores.length})
        </h2>

        <div className="space-y-2">
          {titulares.map((j) => (
            <div
              key={j.id}
              className={`flex items-center justify-between ${
                j.id === jugador.id
                  ? "text-[var(--primario)] font-medium"
                  : "text-[var(--texto)]"
              }`}
            >
              <span>
                {j.emoji_o_color && <span className="mr-1.5">{j.emoji_o_color}</span>}
                {j.nombre}
                {j.id === jugador.id && <span className="ml-1">(vos)</span>}
              </span>
              <span
                className={`text-xs ${
                  j.pago?.estado === "confirmado"
                    ? "text-[var(--confirmado)]"
                    : j.pago?.estado === "pendiente_confirmacion"
                    ? "text-[var(--pendiente)]"
                    : "text-[var(--texto)]/30"
                }`}
              >
                {j.pago?.estado === "confirmado"
                  ? "✓"
                  : j.pago?.estado === "pendiente_confirmacion"
                  ? "⏳"
                  : "—"}
              </span>
            </div>
          ))}
        </div>

        {suplentes.length > 0 && (
          <>
            <div className="border-t border-[var(--texto)]/10 my-3 pt-3">
              <p className="text-xs text-[var(--texto)]/50 mb-2">
                Suplentes
              </p>
              {suplentes.map((j) => (
                <div
                  key={j.id}
                  className={`flex items-center justify-between ${
                    j.id === jugador.id
                      ? "text-[var(--primario)] font-medium"
                      : "text-[var(--texto)]"
                  }`}
                >
                  <span>
                    {j.emoji_o_color && <span className="mr-1.5">{j.emoji_o_color}</span>}
                    {j.nombre}
                    {j.id === jugador.id && <span className="ml-1">(vos)</span>}
                  </span>
                </div>
              ))}
            </div>
          </>
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
