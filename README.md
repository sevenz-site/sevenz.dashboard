# Sevenz — fiado sin disputas

MVP: el dueño y el cliente ven el mismo saldo en tiempo real. Next.js (App Router) + Supabase + OpenRouter (Gemini) para OCR de libreta.

## Setup

1. **Supabase**: crea un proyecto en [supabase.com](https://supabase.com), abre el SQL editor y corre [`supabase/schema.sql`](supabase/schema.sql) completo. Esto crea las tablas (`owners`, `clients`, `movements`, `share_links`), las políticas RLS, el trigger que calcula `running_balance`, la vista `client_summary` y la función pública `get_shared_balance`.
2. **Variables de entorno**: copia `.env.local.example` a `.env.local` y llena:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project Settings → API en Supabase.
   - `OPENROUTER_API_KEY` — desde [openrouter.ai/keys](https://openrouter.ai/keys), usado para extraer movimientos de las fotos de la libreta (`google/gemini-3-flash-preview`).
3. **Confirmación de correo**: si tu proyecto de Supabase tiene "Confirm email" activado, el registro pedirá revisar el correo antes de poder entrar. Puedes desactivarlo en Auth → Providers → Email mientras pruebas.
4. Instala y corre:

```bash
npm install
npm run dev
```

## Cómo está armado

- `supabase/schema.sql` — todo el esquema, RLS y la función pública para el link de cliente. `running_balance` siempre lo calcula un trigger en el insert (nunca el cliente), y es el mecanismo de reconciliación.
- `app/(app)/*` — vistas del dueño (requieren sesión): `dashboard` (cartera + tabla ordenada por mora) e `import` (fotos → revisión → confirmación).
- `app/api/extract/route.ts` — llama a OpenRouter con la foto de la libreta y devuelve movimientos estructurados; nunca escribe en la base directamente.
- `lib/reconcile.ts` — compara el saldo leído en la foto contra el saldo calculado y marca `needs_review` cuando no cuadra o la confianza es baja.
- `app/s/[token]/page.tsx` — vista pública del cliente, sin login, vía `get_shared_balance` (RPC `SECURITY DEFINER`, no expone el resto de la cartera).
- `public/manifest.json` + `public/sw.js` — PWA instalable; el service worker es network-first a propósito para que el saldo nunca se muestre desde caché viejo.

## Qué falta verificar con datos reales

No hay proyecto de Supabase real conectado en este entorno, así que quedó verificado hasta donde se pudo sin credenciales: build, lint, type-check y navegación de páginas (login/signup/dashboard-redirect/404 público) sin errores. Antes de dar el MVP por probado, con un proyecto real:

- Crear dos cuentas de dueño y confirmar que una no puede ver clientes/movimientos de la otra (RLS).
- Subir 5–10 fotos reales de una libreta y revisar que la extracción + reconciliación se comporten como se espera.
- Confirmar que el link `/s/[token]` carga rápido en una conexión simulada 3G/4G.
