import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SetupNotice() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Falta configurar Supabase</CardTitle>
          <CardDescription>
            Copia <code>.env.local.example</code> a <code>.env.local</code>, completa
            NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY con los datos de tu proyecto
            (Supabase → Project Settings → API), corre <code>supabase/schema.sql</code> y reinicia
            el servidor.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Instrucciones completas en el README del proyecto.
        </CardContent>
      </Card>
    </div>
  );
}
