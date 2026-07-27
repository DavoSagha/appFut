import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { pathname } = request.nextUrl;
  const esZonaOrganizador = pathname.startsWith("/organizador");

  if (!esZonaOrganizador && !pathname.startsWith("/auth/callback")) {
    return supabaseResponse;
  }

  // getUser() valida el JWT contra Supabase; getSession() solo lee la cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // El gating deja de ser un if de React: si no hay sesión, no entrás.
  // Un jugador anónimo tiene sesión válida, pero no es organizador.
  if (esZonaOrganizador && (!user || user.is_anonymous === true)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
