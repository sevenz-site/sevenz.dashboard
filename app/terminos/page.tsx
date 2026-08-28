import Image from "next/image";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Términos y condiciones — Sevenz" };

export default function TerminosPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Image src="/logo.svg" alt="Sevenz" width={120} height={37} className="mb-2" />
          <CardTitle className="text-xl">Términos y condiciones</CardTitle>
          <CardDescription>Contenido próximamente.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Estamos preparando el texto completo de los términos y condiciones de Sevenz. Esta
            página quedará actualizada antes de que se te pida aceptarlos formalmente.
          </p>
          <Link
            href="/signup"
            className="mt-4 inline-block text-sm font-medium text-foreground underline underline-offset-4"
          >
            Volver al registro
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
