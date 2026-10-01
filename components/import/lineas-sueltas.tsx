"use client";

import { useState } from "react";
import { HelpCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fechaDeLaLibreta } from "@/lib/fecha-de-libreta";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { formatCurrency } from "@/lib/format";
import type { NombreDisponible } from "@/lib/lineas-sueltas";
import type { ExtractedMovement, LedgerCurrency } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────
// "LÍNEAS SIN CLIENTE" — CT-25
//
// La sección que resuelve lo que antes se tiraba en silencio. Va ARRIBA DE TODO
// en la revisión, antes de las tarjetas, porque bloquea la subida entera: una
// línea sin dueño no pertenece a ninguna tarjeta todavía, así que no hay otro
// sitio donde enseñarla, y dejarla para el final es dejar que nadie la vea.
//
// TRES SALIDAS, Y SOLO TRES. Asignarla a alguien que ya está en la libreta o en
// Sevenz, escribir un nombre nuevo, o quitarla. No hay cuarta: "dejarla así" es
// exactamente lo que hacía la versión vieja.
//
// EL NOMBRE COMPLETO, NO UNA INICIAL. El menú enseña nombre y apellido tal como
// están escritos, y dice de dónde sale cada uno: "en esta libreta" cuando el
// nombre aparece en alguna de las fotos de esta tanda —que es el caso corriente,
// el renglón huérfano es de alguien que está dos líneas más abajo o en la foto
// siguiente— y "ya en Sevenz" cuando es un cliente guardado. Son dos motivos
// distintos para elegirlo y el dueño necesita distinguirlos.

const NUEVO = "__nuevo__";

// Quitar una clave sin destructurar a una variable que no se usa.
function sinLaClave(mapa: Record<string, string>, clave: string): Record<string, string> {
  const copia = { ...mapa };
  delete copia[clave];
  return copia;
}

function importeDe(n: number, currency: LedgerCurrency | null): string {
  return currency ? formatDisplayCurrency(n, currency) : formatCurrency(n);
}

export function LineasSueltas({
  lineas,
  quitadas,
  nombres,
  onAsignar,
  onAsignarTodas,
  onQuitar,
  onRecuperar,
}: {
  lineas: ExtractedMovement[];
  // Las que el dueno descarto. Siguen a la vista, en gris, con su boton de
  // recuperar — igual que un renglon quitado dentro de una tarjeta. Sin esto
  // seria el unico borrado sin rastro de la pantalla, y encima el de la linea
  // que ya era dificil de ver.
  quitadas: ExtractedMovement[];
  nombres: NombreDisponible[];
  onAsignar: (uid: string, nombre: string) => void;
  onAsignarTodas: (nombre: string) => void;
  onQuitar: (uid: string) => void;
  onRecuperar: (uid: string) => void;
}) {
  // El nombre que se está escribiendo a mano, por fila. Vive aquí y no en el
  // movimiento porque hasta que no se confirma no es el nombre de nadie:
  // escribirlo tecla a tecla en `client_name` haría aparecer y desaparecer
  // tarjetas con nombres a medio escribir — "C", "Ca", "Car".
  const [escribiendo, setEscribiendo] = useState<Record<string, string>>({});
  const [todasA, setTodasA] = useState("");

  if (lineas.length === 0 && quitadas.length === 0) return null;

  const hayVarias = lineas.length > 1;

  return (
    <section
      className={
        lineas.length > 0
          ? "flex flex-col gap-3 rounded-lg border border-destructive bg-destructive/5 p-4"
          : "flex flex-col gap-3 rounded-lg border p-4"
      }
      aria-label="Líneas sin cliente"
    >
      <div className="flex items-start gap-1.5">
        <HelpCircle
          className={
            lineas.length > 0
              ? "mt-0.5 size-4 shrink-0 text-destructive"
              : "mt-0.5 size-4 shrink-0 text-muted-foreground"
          }
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">
            {lineas.length === 0
              ? quitadas.length === 1
                ? "1 línea sin cliente, quitada"
                : `${quitadas.length} líneas sin cliente, quitadas`
              : lineas.length === 1
                ? "1 línea sin cliente"
                : `${lineas.length} líneas sin cliente`}
          </h2>
          {/* Se dice POR QUÉ pasa, no solo que pasa. Un dueño que entiende que
              la página empieza a media cuenta sabe de quién son sin pensarlo;
              uno que solo lee "no pudimos leer el nombre" sospecha de la app. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {lineas.length === 0
              ? "No se van a subir. Si te equivocaste, puedes recuperarlas aquí mientras sigas en esta revisión."
              : "Tu página empieza con renglones que vienen de la hoja anterior, así que el nombre no está en esta foto. Dinos de quién es cada uno, o quítalos. No se sube nada hasta entonces."}
          </p>
        </div>
      </div>

      {/* El atajo del caso corriente: los huérfanos de una página son casi
          siempre del MISMO cliente, el de la hoja de antes. Pedirlos uno a uno
          sería repetir la misma decisión. Solo sale con más de una. */}
      {hayVarias ? (
        <div className="flex flex-col gap-2 rounded-md border bg-background p-3">
          <Label htmlFor="sueltas-todas" className="text-xs font-medium">
            ¿Son todas del mismo cliente?
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={todasA || undefined} onValueChange={setTodasA}>
              <SelectTrigger id="sueltas-todas" className="flex-1">
                <SelectValue placeholder="Elige un cliente" />
              </SelectTrigger>
              <SelectContent>
                {nombres.map((n) => (
                  <SelectItem key={n.nombre} value={n.nombre}>
                    {n.nombre}
                    <span className="text-muted-foreground">
                      {n.origen === "libreta" ? " · en esta libreta" : " · ya en Sevenz"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              disabled={!todasA}
              onClick={() => {
                onAsignarTodas(todasA);
                setTodasA("");
              }}
            >
              Asignar las {lineas.length}
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {lineas.map((m) => {
          const uid = m.uid!;
          const fecha = fechaDeLaLibreta(m.date);
          const enEdicion = escribiendo[uid] !== undefined;
          return (
            <li key={uid} className="flex flex-col gap-2 rounded-md border bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {m.type === "payment" ? "Abono" : "Fiado"}
                    {m.description ? ` · ${m.description}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {fecha ?? "Sin fecha"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">
                    {m.type === "payment" ? "−" : "+"}
                    {importeDe(m.amount, m.currency)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Quitar esta línea"
                    onClick={() => onQuitar(uid)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              {enEdicion ? (
                // Escribir un nombre que no está en ninguna lista. Pasa de
                // verdad: la hoja anterior puede ser de alguien que todavía no
                // existe en Sevenz y que no aparece en ninguna de estas fotos.
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    autoFocus
                    placeholder="Nombre y apellido"
                    aria-label="Nombre del cliente de esta línea"
                    value={escribiendo[uid]}
                    onChange={(e) => setEscribiendo((p) => ({ ...p, [uid]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      className="flex-1"
                      disabled={!escribiendo[uid]?.trim()}
                      onClick={() => {
                        onAsignar(uid, escribiendo[uid]);
                        setEscribiendo((p) => sinLaClave(p, uid));
                      }}
                    >
                      Guardar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setEscribiendo((p) => sinLaClave(p, uid))}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Select
                  value={undefined}
                  onValueChange={(v) => {
                    if (v === NUEVO) setEscribiendo((p) => ({ ...p, [uid]: "" }));
                    else onAsignar(uid, v);
                  }}
                >
                  <SelectTrigger aria-label="Cliente de esta línea">
                    <SelectValue placeholder="¿De quién es?" />
                  </SelectTrigger>
                  <SelectContent>
                    {nombres.map((n) => (
                      <SelectItem key={n.nombre} value={n.nombre}>
                        {n.nombre}
                        <span className="text-muted-foreground">
                          {n.origen === "libreta" ? " · en esta libreta" : " · ya en Sevenz"}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value={NUEVO}>Otro cliente…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </li>
          );
        })}
      </ul>

      {quitadas.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {quitadas.map((m) => (
            <li
              key={m.uid}
              className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3 text-muted-foreground"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm line-through">
                  {m.type === "payment" ? "Abono" : "Fiado"}
                  {m.description ? ` · ${m.description}` : ""}
                </span>
                <span className="text-xs">{fechaDeLaLibreta(m.date) ?? "Sin fecha"}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm tabular-nums line-through">
                  {importeDe(m.amount, m.currency)}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => onRecuperar(m.uid!)}>
                  Recuperar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
