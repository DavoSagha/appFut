"use client";

import { useState } from "react";
import BottomSheet from "./BottomSheet";
import PagoBadge from "./PagoBadge";
import type { PagoEstado, Equipo, PartidoEstado } from "@/lib/db/types";
import { montoDisponibleSegunEstado, MENSAJE_MONTO_PENDIENTE } from "@/lib/monto";

type Props = {
  onCerrar: () => void;
  partidoEstado: PartidoEstado;
  jugador: {
    id: string;
    nombre: string;
    equipo: Equipo;
    emoji_o_color: string | null;
    pago: {
      estado: PagoEstado;
      monto_esperado: number;
      monto_pagado: number | null;
      comprobante_url: string | null;
    } | null;
  };
  onConfirmar: (id: string) => void;
  onRechazar: (id: string) => void;
  onRevertir: (id: string) => void;
  onVerComprobante: (id: string) => void;
};

export default function PaymentReviewModal({
  onCerrar,
  partidoEstado,
  jugador,
  onConfirmar,
  onRechazar,
  onRevertir,
  onVerComprobante,
}: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [revirtiendo, setRevirtiendo] = useState(false);

  const pago = jugador.pago;
  const estado = pago?.estado ?? "sin_declarar";

  const handleConfirmar = async () => {
    setConfirmando(true);
    await onConfirmar(jugador.id);
    setConfirmando(false);
    onCerrar();
  };

  const handleRechazar = async () => {
    setRechazando(true);
    await onRechazar(jugador.id);
    setRechazando(false);
    onCerrar();
  };

  const handleRevertir = async () => {
    setRevirtiendo(true);
    await onRevertir(jugador.id);
    setRevirtiendo(false);
    onCerrar();
  };

  return (
    <BottomSheet abierto={true} onCerrar={onCerrar} titulo="Revisar pago">
      <div className="space-y-5">
        <div className="flex items-center gap-3 bg-[var(--fondo)] rounded-xl p-4">
          <span className="text-2xl">{jugador.emoji_o_color ?? "⚽"}</span>
          <div>
            <p className="font-semibold text-[var(--texto)]">{jugador.nombre}</p>
            <p className="text-sm text-[var(--texto)]/50">
              {jugador.equipo === "team1" ? "Team 1" : jugador.equipo === "team2" ? "Team 2" : "Reserva"}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between bg-[var(--fondo)] rounded-xl px-4 py-3">
          <span className="text-sm text-[var(--texto)]/60">Monto</span>
          {/* Un pago ya confirmado es un hecho histórico: se muestra igual
              aunque el partido haya vuelto a abierto después. Si todavía no
              se confirmó, sigue la misma regla que el resto de la UI. */}
          {estado === "confirmado" || montoDisponibleSegunEstado(partidoEstado) ? (
            <span className="text-lg font-bold text-[var(--primario)]">
              ${(estado === "confirmado" ? (pago?.monto_pagado ?? pago?.monto_esperado ?? 0) : (pago?.monto_esperado ?? 0)).toFixed(2)}
            </span>
          ) : (
            <span className="text-sm text-[var(--texto)]/40">{MENSAJE_MONTO_PENDIENTE}</span>
          )}
        </div>

        <div className="flex items-center justify-between bg-[var(--fondo)] rounded-xl px-4 py-3">
          <span className="text-sm text-[var(--texto)]/60">Estado</span>
          <PagoBadge estado={estado} />
        </div>

        {pago?.comprobante_url && (
          <button
            onClick={() => onVerComprobante(jugador.id)}
            className="w-full flex items-center justify-center gap-2 bg-[var(--fondo)] rounded-xl px-4 py-3 text-sm text-[var(--primario)] hover:brightness-110 transition-all"
          >
            📎 Ver comprobante
          </button>
        )}

        {estado === "pendiente_confirmacion" && (
          <div className="flex flex-col gap-3 pt-2">
            <button
              onClick={handleConfirmar}
              disabled={confirmando}
              className="w-full min-h-[48px] bg-green-600 text-white font-semibold rounded-xl hover:bg-green-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {confirmando ? "Confirmando..." : "✅ Confirmar Pago"}
            </button>
            <button
              onClick={handleRechazar}
              disabled={rechazando}
              className="w-full min-h-[48px] bg-red-600/20 text-red-400 font-semibold rounded-xl hover:bg-red-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {rechazando ? "Rechazando..." : "❌ Rechazar"}
            </button>
          </div>
        )}

        {estado === "confirmado" && (
          <div className="flex flex-col gap-3 pt-2">
            <p className="text-center text-sm text-[var(--texto)]/40">
              Este pago ya fue confirmado
            </p>
            <button
              onClick={handleRevertir}
              disabled={revirtiendo}
              className="w-full min-h-[48px] bg-[var(--superficie)] text-[var(--texto)]/80 font-semibold rounded-xl hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {revirtiendo ? "Revirtiendo..." : "↩️ Marcar como sin pagar"}
            </button>
          </div>
        )}

        {estado !== "pendiente_confirmacion" && estado !== "confirmado" && (
          <p className="text-center text-sm text-[var(--texto)]/40 pt-2">
            {estado === "rechazado"
              ? "Este pago fue rechazado"
              : "Este jugador aún no declaró su pago"}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
