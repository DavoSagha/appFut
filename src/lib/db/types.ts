export type PartidoEstado = "abierto" | "completo" | "cerrado";
export type JugadorRol = "titular" | "suplente";
export type Equipo = "team1" | "team2" | null;
export type PagoEstado =
  | "sin_declarar"
  | "pendiente_confirmacion"
  | "confirmado"
  | "rechazado";

export interface Partido {
  id: string;
  organizador_id: string;
  fecha_hora: string;
  cantidad_jugadores: number;
  costo_total: number;
  estado: PartidoEstado;
  link_slug: string;
  created_at: string;
}

export interface Jugador {
  id: string;
  partido_id: string;
  nombre: string;
  user_id: string;
  rol: JugadorRol;
  equipo: Equipo;
  emoji_o_color: string | null;
  orden_ingreso: number;
  created_at: string;
}

export interface Pago {
  id: string;
  jugador_id: string;
  monto_esperado: number;
  /** Congelado al confirmar. Ningún recálculo lo toca. */
  monto_pagado: number | null;
  /** Ruta dentro del bucket privado, NO una URL pública. */
  comprobante_url: string | null;
  estado: PagoEstado;
  confirmado_por: string | null;
  confirmado_at: string | null;
  created_at: string;
}

export interface JugadorConPago extends Jugador {
  pago: Pago | null;
}
