"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (session) {
          router.replace("/organizador");
        }
      })
      .catch(() => {});
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-7xl mb-6">⚽</div>
        <h1 className="text-4xl font-bold text-[var(--primario)]">appFut</h1>
        <p className="text-[var(--texto)]/70 mt-3 text-lg">
          Organiza partidos de fútbol entre amigos.
          <br />
          Gestiona pagos sin efectivo.
        </p>

        <div className="mt-10 space-y-4">
          <Link
            href="/auth/login"
            className="block w-full bg-[var(--primario)] text-[var(--fondo)] font-semibold py-3 px-4 rounded-xl text-center hover:brightness-110 transition-all"
          >
            Soy organizador
          </Link>

          <p className="text-[var(--texto)]/40 text-sm">
            ¿Te invitaron a un partido?
            <br />
            Usá el link que te enviaron para unirte.
          </p>
        </div>
      </div>
    </div>
  );
}
