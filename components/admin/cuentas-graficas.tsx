"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { Cuenta } from "@/lib/admin/subscriptions";

export type IngresoMes = { mes: string; total_usd: number; pagos: number };

const config = {
  valor: { label: "Negocios", color: "var(--chart-2)" },
  total_usd: { label: "Cobrado", color: "var(--chart-2)" },
} satisfies ChartConfig;

function Tarjeta({
  titulo,
  explica,
  children,
}: {
  titulo: string;
  explica?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-col">
        <h3 className="text-sm font-medium">{titulo}</h3>
        {explica ? <p className="text-xs text-muted-foreground">{explica}</p> : null}
      </div>
      {children}
    </div>
  );
}

// Las tres gráficas de Cuentas.
//
// LAS DOS PRIMERAS SON UNA FOTO DE HOY, no una serie. Con 24 negocios, cuántos
// están en demo y cuántos pagan ya dice algo; una línea de cómo evolucionó eso
// necesitaría meses de historia que todavía no existen.
//
// LA TERCERA SÍ ES HISTÓRICA y va a empezar casi vacía: el historial de cobros
// nació el 2026-09-15, así que solo cuenta lo que se registre de aquí en
// adelante. Está dicho en su propio subtítulo, porque una gráfica plana sin
// explicación se lee como "no se está cobrando" en vez de "todavía no hay
// datos", y esas dos cosas no se parecen en nada.
export function CuentasGraficas({
  cuentas,
  ingresos,
}: {
  cuentas: Cuenta[];
  ingresos: IngresoMes[];
}) {
  const vencidas = cuentas.filter(
    (c) => c.estado === "demo" && (c.dias_restantes ?? 0) < 0,
  ).length;

  const porEstado = [
    { nombre: "Activa", valor: cuentas.filter((c) => c.estado === "activa").length },
    {
      nombre: "Demo",
      valor: cuentas.filter((c) => c.estado === "demo" && (c.dias_restantes ?? 0) >= 0).length,
    },
    { nombre: "Vencida", valor: vencidas },
    { nombre: "Bloqueada", valor: cuentas.filter((c) => c.estado === "bloqueada").length },
    { nombre: "Cancelada", valor: cuentas.filter((c) => c.estado === "cancelada").length },
  ];

  const porPlan = [
    { nombre: "Free", valor: cuentas.filter((c) => c.plan_code === "free").length },
    { nombre: "Pro", valor: cuentas.filter((c) => c.plan_code === "pro").length },
  ];

  const hayCobros = ingresos.some((i) => Number(i.total_usd) > 0);

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Tarjeta titulo="Por estado" explica="Cuántos negocios hay en cada situación, hoy.">
        <ChartContainer config={config} className="h-[180px] w-full">
          <BarChart data={porEstado} margin={{ left: -20, right: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="nombre" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} fontSize={11} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="valor" fill="var(--color-valor)" radius={4} />
          </BarChart>
        </ChartContainer>
      </Tarjeta>

      <Tarjeta titulo="Por plan" explica="Free es un regalo deliberado, no un nivel gratuito.">
        <ChartContainer config={config} className="h-[180px] w-full">
          <BarChart data={porPlan} margin={{ left: -20, right: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="nombre" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} fontSize={11} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="valor" fill="var(--color-valor)" radius={4} />
          </BarChart>
        </ChartContainer>
      </Tarjeta>

      <Tarjeta
        titulo="Cobrado por mes (USD)"
        explica={
          hayCobros
            ? "Solo pagos registrados, no precios pactados."
            : "Vacía todavía: el historial de cobros empezó el 15 de septiembre y solo cuenta lo que registres desde entonces."
        }
      >
        <ChartContainer config={config} className="h-[180px] w-full">
          <BarChart data={ingresos} margin={{ left: -20, right: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="mes"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              // "2026-09" cabe mal cinco veces seguidas; el mes solo, sí.
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis tickLine={false} axisLine={false} fontSize={11} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="total_usd" fill="var(--color-total_usd)" radius={4} />
          </BarChart>
        </ChartContainer>
      </Tarjeta>
    </div>
  );
}
