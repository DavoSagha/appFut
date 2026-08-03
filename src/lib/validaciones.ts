import { randomBytes } from "node:crypto";

/**
 * Lógica pura, sin dependencias de Next ni de Supabase.
 * Vive acá para poder testearse: los archivos "use server" no se pueden
 * importar desde un test.
 */

export function esUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export function esSlug(v: unknown): v is string {
  return typeof v === "string" && /^[a-z0-9]{6,16}$/.test(v);
}

/** Recorta y colapsa espacios. Lo que se guarda y lo que se compara. */
export function normalizarNombre(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export const ANTICIPACION_MINIMA_HORAS = 2;

type ResultadoFecha = { ok: true } | { ok: false; error: string };

/** No se puede crear un partido en el pasado ni con menos de 2hs de aviso. */
export function validarFechaPartido(
  fechaHoraIso: string,
  ahora: Date = new Date(),
): ResultadoFecha {
  const fecha = new Date(fechaHoraIso);
  if (Number.isNaN(fecha.getTime())) {
    return { ok: false, error: "Fecha u hora inválida" };
  }

  const minimo = ahora.getTime() + ANTICIPACION_MINIMA_HORAS * 60 * 60 * 1000;
  if (fecha.getTime() < minimo) {
    return {
      ok: false,
      error: `El partido debe crearse con al menos ${ANTICIPACION_MINIMA_HORAS} horas de anticipación`,
    };
  }

  return { ok: true };
}

type ResultadoValidacionGoles =
  | { ok: true; team1: number; team2: number }
  | { ok: false; error: string };

/** Resultado final del partido: dos enteros, ninguno negativo. */
export function validarResultado(team1: unknown, team2: unknown): ResultadoValidacionGoles {
  for (const valor of [team1, team2]) {
    if (typeof valor !== "number" || !Number.isInteger(valor)) {
      return { ok: false, error: "El resultado debe ser un número entero" };
    }
  }
  if ((team1 as number) < 0 || (team2 as number) < 0) {
    return { ok: false, error: "El resultado no puede ser negativo" };
  }
  return { ok: true, team1: team1 as number, team2: team2 as number };
}

// Sin l/1/0/o: el link se dicta por teléfono.
export const ALFABETO_SLUG = "abcdefghijkmnpqrstuvwxyz23456789";
export const LARGO_SLUG = 10;

export function generarSlug(): string {
  const bytes = randomBytes(LARGO_SLUG);
  let slug = "";
  for (let i = 0; i < LARGO_SLUG; i++) {
    // 256 % 32 === 0 -> sin sesgo de módulo.
    slug += ALFABETO_SLUG[bytes[i] % ALFABETO_SLUG.length];
  }
  return slug;
}
