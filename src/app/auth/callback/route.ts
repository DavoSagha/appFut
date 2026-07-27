import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Solo aceptamos paths relativos de un nivel. Corta `//evil.com`,
 * `https://evil.com` y cualquier intento de redirigir afuera.
 */
function destinoSeguro(next: string | null): string {
  if (!next) return "/organizador";
  if (!next.startsWith("/") || next.startsWith("//")) return "/organizador";
  return next;
}

/**
 * x-forwarded-host lo pone el proxy, pero también lo puede mandar el cliente
 * si el proxy no lo limpia. Solo lo usamos si coincide con el host que
 * declaramos como nuestro.
 */
function baseSegura(request: Request, origin: string): string {
  const declarado = process.env.NEXT_PUBLIC_SITE_URL;
  if (!declarado) return origin;

  let hostDeclarado: string;
  try {
    hostDeclarado = new URL(declarado).host;
  } catch {
    return origin;
  }

  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded && forwarded === hostDeclarado) return `https://${forwarded}`;

  return declarado;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = destinoSeguro(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const base =
        process.env.NODE_ENV === "development"
          ? origin
          : baseSegura(request, origin);
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/?error=auth_failed`);
}
