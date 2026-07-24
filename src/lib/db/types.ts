export type PartidoEstado = "abierto" | "completo" | "cerrado";
export type JugadorRol = "titular" | "suplente";
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
  device_id: string;
  rol: JugadorRol;
  emoji_o_color: string | null;
  orden_ingreso: number;
  created_at: string;
}

export interface Pago {
  id: string;
  jugador_id: string;
  monto_esperado: number;
  comprobante_url: string | null;
  estado: PagoEstado;
  confirmado_por: string | null;
  confirmado_at: string | null;
  created_at: string;
}

export interface JugadorConPago extends Jugador {
  pago: Pago | null;
}
