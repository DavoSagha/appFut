import { describe, it, expect } from "vitest";

import {
  calcularMontoPorJugador,
  montoDisponibleSegunEstado,
  MENSAJE_MONTO_PENDIENTE,
} from "@/lib/monto";

describe("montoDisponibleSegunEstado", () => {
  it("solo abierto lo oculta; completo y cerrado lo muestran", () => {
    expect(montoDisponibleSegunEstado("abierto")).toBe(false);
    expect(montoDisponibleSegunEstado("completo")).toBe(true);
    expect(montoDisponibleSegunEstado("cerrado")).toBe(true);
  });
});

describe("calcularMontoPorJugador", () => {
  it("no está disponible mientras el partido sigue abierto, aunque ya haya titulares", () => {
    expect(calcularMontoPorJugador(1000, 2, "abierto")).toEqual({ disponible: false });
  });

  it("está disponible cuando el partido está completo", () => {
    expect(calcularMontoPorJugador(1000, 4, "completo")).toEqual({
      disponible: true,
      monto: 250,
    });
  });

  it("está disponible cuando el partido está cerrado, incluso con menos titulares que el cupo", () => {
    expect(calcularMontoPorJugador(1200, 3, "cerrado")).toEqual({
      disponible: true,
      monto: 400,
    });
  });

  it("no está disponible si todavía no hay ningún titular", () => {
    expect(calcularMontoPorJugador(1000, 0, "completo")).toEqual({ disponible: false });
  });

  it("expone el mismo mensaje de espera para usar en toda la UI", () => {
    expect(MENSAJE_MONTO_PENDIENTE).toBe("Se calculará al completar el partido");
  });
});
