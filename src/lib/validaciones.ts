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
