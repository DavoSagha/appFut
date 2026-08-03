"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  esSlug,
  esUuid,
  fallo,
  falloDe,
  organizadorActual,
  usuarioActual,
} from "@/lib/auth-guard";
import {
  COMPROBANTE_MAX_BYTES,
  COMPROBANTE_MIMES,
  EXTENSION_POR_MIME,
} from "@/lib/constants";

const BUCKET = "comprobantes";

export async function declararPagoSinComprobante(slug: string) {
  if (!esSlug(slug)) return fallo("Link inválido");

  const usuario = await usuarioActual();
  if (!usuario) return fallo("No estás anotado en este partido");

  const supabase = await createClient();

  const { data: rawPartido } = await supabase.rpc("partido_por_slug", {
    p_slug: slug,
  });

  const p = (rawPartido as { id: string; estado: string }[] | null)?.[0];
  if (!p) return fallo("Partido no encontrado");
  if (p.estado === "cerrado") return fallo("El partido está cerrado");

  const { data: jugador } = await supabase
    .from("jugadores")
    .select("id, rol")
    .eq("partido_id", p.id)
    .eq("user_id", usuario.id)
    .single();

  if (!jugador) return fallo("No estás anotado en este partido");

  const { data: pagoActual } = await supabase
    .from("pagos")
    .select("estado")
    .eq("jugador_id", jugador.id)
    .single();

  if (pagoActual?.estado === "confirmado") {
    return fallo("Tu pago ya está confirmado");
  }

  const { error } = await supabase
    .from("pagos")
    .update({ estado: "pendiente_confirmacion" })
    .eq("jugador_id", jugador.id);

  if (error) return falloDe("declararPago", error);

  revalidatePath(`/p/${slug}`);
  return { ok: true as const };
}

export async function subirComprobante(slug: string, formData: FormData) {
  if (!esSlug(slug)) return fallo("Link inválido");

  const archivo = formData.get("comprobante");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return fallo("No llegó ninguna imagen");
  }

  // Validación real, del lado del servidor. accept="image/*" es solo decoración.
  if (archivo.size > COMPROBANTE_MAX_BYTES) {
    return fallo("La imagen supera los 5 MB");
  }
  if (!(COMPROBANTE_MIMES as readonly string[]).includes(archivo.type)) {
    return fallo("Solo se aceptan imágenes (jpg, png, webp o heic)");
  }

  const usuario = await usuarioActual();
  if (!usuario) return fallo("No estás anotado en este partido");

  const supabase = await createClient();

  const { data: rawPartido } = await supabase.rpc("partido_por_slug", {
    p_slug: slug,
  });

  const p = (rawPartido as { id: string; estado: string }[] | null)?.[0];
  if (!p) return fallo("Partido no encontrado");
  if (p.estado === "cerrado") return fallo("El partido está cerrado");

  const { data: jugador } = await supabase
    .from("jugadores")
    .select("id, rol")
    .eq("partido_id", p.id)
    .eq("user_id", usuario.id)
    .single();

  if (!jugador) return fallo("No estás anotado en este partido");

  const { data: pagoActual } = await supabase
    .from("pagos")
    .select("estado")
    .eq("jugador_id", jugador.id)
    .single();

  if (pagoActual?.estado === "confirmado") {
    return fallo("Tu pago ya está confirmado");
  }

  const ext = EXTENSION_POR_MIME[archivo.type] ?? "jpg";
  const ruta = `${p.id}/${jugador.id}/comprobante.${ext}`;

  const { error: errorUpload } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, archivo, { upsert: true, contentType: archivo.type });

  if (errorUpload) return falloDe("subirComprobante/storage", errorUpload);

  // Guardamos la RUTA, no una URL pública. La URL se firma al momento de verla.
  const { error: errorUpdate } = await supabase
    .from("pagos")
    .update({ comprobante_url: ruta, estado: "pendiente_confirmacion" })
    .eq("jugador_id", jugador.id);

  if (errorUpdate) return falloDe("subirComprobante/update", errorUpdate);

  revalidatePath(`/p/${slug}`);
  return { ok: true as const };
}

/** Signed URL de 60 segundos. Las policies de storage limitan quién puede pedirla. */
export async function verComprobante(jugadorId: string) {
  if (!esUuid(jugadorId)) return fallo("Jugador inválido");

  const supabase = await createClient();

  const { data: pago } = await supabase
    .from("pagos")
    .select("comprobante_url")
    .eq("jugador_id", jugadorId)
    .single();

  if (!pago?.comprobante_url) return fallo("Sin comprobante");

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pago.comprobante_url, 60);

  if (error || !data) return falloDe("verComprobante", error);

  return { ok: true as const, data: { url: data.signedUrl } };
}

export async function confirmarPago(jugadorId: string) {
  if (!esUuid(jugadorId)) return fallo("Jugador inválido");

  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const supabase = await createClient();

  // El trigger verifica que confirmado_por sea el organizador del partido.
  const { data, error } = await supabase
    .from("pagos")
    .update({ estado: "confirmado", confirmado_por: userId })
    .eq("jugador_id", jugadorId)
    .eq("estado", "pendiente_confirmacion")
    .select("id");

  if (error) return falloDe("confirmarPago", error);
  if (!data || data.length === 0) {
    return fallo("El pago ya no está pendiente de confirmación");
  }

  revalidatePath("/organizador");
  return { ok: true as const };
}

/** Deshace una confirmación por error: Pagado -> Sin pagar. Reversible, no destructivo con el comprobante. */
export async function revertirPago(jugadorId: string) {
  if (!esUuid(jugadorId)) return fallo("Jugador inválido");

  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("pagos")
    .update({
      estado: "sin_declarar",
      monto_pagado: null,
      confirmado_por: null,
      confirmado_at: null,
    })
    .eq("jugador_id", jugadorId)
    .eq("estado", "confirmado")
    .select("id");

  if (error) return falloDe("revertirPago", error);
  if (!data || data.length === 0) {
    return fallo("El pago no está confirmado");
  }

  revalidatePath("/organizador");
  return { ok: true as const };
}

export async function rechazarPago(jugadorId: string) {
  if (!esUuid(jugadorId)) return fallo("Jugador inválido");

  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const supabase = await createClient();

  const { data: pago } = await supabase
    .from("pagos")
    .select("comprobante_url")
    .eq("jugador_id", jugadorId)
    .single();

  const { data, error } = await supabase
    .from("pagos")
    .update({
      estado: "rechazado",
      comprobante_url: null,
      confirmado_por: userId,
    })
    .eq("jugador_id", jugadorId)
    .select("id");

  if (error) return falloDe("rechazarPago", error);
  if (!data || data.length === 0) {
    return fallo("No tenés permiso sobre este pago");
  }

  if (pago?.comprobante_url) {
    await supabase.storage.from(BUCKET).remove([pago.comprobante_url]);
  }

  revalidatePath("/organizador");
  return { ok: true as const };
}
