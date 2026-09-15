"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EstadoChip } from "@/components/admin/estado-chip";
import { CuentaAcciones } from "@/components/admin/cuenta-acciones";
import type { Cuenta } from "@/lib/admin/subscriptions";

function fecha(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Caracas",
  }).format(new Date(iso));
}

// La lista de cuentas como tabla, con filtros y orden.
//
// POR QUÉ UNA TABLA Y NO LAS TARJETAS DE ANTES. Con 24 negocios una lista se
// lee bien; con 200 no. Una tabla deja comparar dos filas de un vistazo —
// quién paga más, a quién le queda menos demo— y eso es lo que se hace aquí.
//
// Se ordena y se filtra EN EL NAVEGADOR, no en la base. Son 24 filas y la
// pantalla ya las tiene todas: pedirle a Postgres que ordene obligaría a un
// viaje de ida y vuelta por cada clic en una cabecera. Cuando sean miles, el
// cambio es mover el ordenamiento a la función y paginar — no reescribir esto.
export function CuentasTabla({ cuentas }: { cuentas: Cuenta[] }) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState<string>("todos");
  const [plan, setPlan] = useState<string>("todos");

  const columnas = useMemo<ColumnDef<Cuenta>[]>(
    () => [
      {
        accessorKey: "business_name",
        header: ({ column }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2.5"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Negocio
            <ArrowUpDown className="size-3.5" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="font-medium">{row.original.business_name || "(sin nombre)"}</span>
            <span className="truncate text-xs text-muted-foreground">
              {row.original.email ?? "sin correo"}
            </span>
          </div>
        ),
      },
      {
        id: "estado",
        header: "Estado",
        accessorFn: (c) => c.estado,
        cell: ({ row }) => <EstadoChip cuenta={row.original} />,
      },
      {
        accessorKey: "country",
        header: "País",
        cell: ({ row }) => <span className="text-xs">{row.original.country}</span>,
      },
      {
        accessorKey: "clientes",
        header: ({ column }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2.5"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Clientes
            <ArrowUpDown className="size-3.5" />
          </Button>
        ),
        cell: ({ row }) => <span className="tabular-nums">{row.original.clientes}</span>,
      },
      {
        id: "precio",
        accessorFn: (c) => c.precio_pactado_usd ?? 0,
        header: ({ column }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2.5"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Precio
            <ArrowUpDown className="size-3.5" />
          </Button>
        ),
        cell: ({ row }) =>
          row.original.precio_pactado_usd != null ? (
            <span className="tabular-nums">
              ${row.original.precio_pactado_usd}
              {row.original.periodicidad ? (
                <span className="text-xs text-muted-foreground">/{row.original.periodicidad}</span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "vence",
        // Se ordena por los días que quedan, no por el texto. Ordenar
        // "venció hace 3 días" alfabéticamente no significa nada.
        accessorFn: (c) => c.dias_restantes ?? 9999,
        header: ({ column }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2.5"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Vence
            <ArrowUpDown className="size-3.5" />
          </Button>
        ),
        cell: ({ row }) => {
          const d = row.original.dias_restantes;
          if (row.original.estado === "demo" && d !== null) {
            return (
              <span className={`text-xs tabular-nums ${d < 0 ? "text-destructive" : ""}`}>
                {d < 0 ? `venció hace ${Math.abs(d)} d.` : d === 0 ? "hoy" : `${d} d.`}
              </span>
            );
          }
          return (
            <span className="text-xs text-muted-foreground">
              {row.original.periodo_termina_el ? fecha(row.original.periodo_termina_el) : "—"}
            </span>
          );
        },
      },
      {
        id: "acciones",
        header: "",
        cell: ({ row }) => (
          // stopPropagation: sin esto, pulsar "Dar demo" abriría ADEMÁS la
          // ficha, y el diálogo se montaría sobre una página que ya se está
          // yendo. Mismo patrón y mismo motivo que en papelera-table.
          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            <CuentaAcciones cuenta={row.original} />
          </div>
        ),
      },
      {
        id: "abrir",
        header: "",
        // La flecha no navega por su cuenta: la fila entera ya lo hace. Está
        // para que se vea QUE se puede abrir, que es lo que faltaba cuando el
        // enlace vivía escondido en el nombre.
        cell: () => <ChevronRight className="size-4 text-muted-foreground" />,
      },
    ],
    [],
  );

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return cuentas.filter((c) => {
      if (estado !== "todos") {
        const vencida = c.estado === "demo" && (c.dias_restantes ?? 0) < 0;
        if (estado === "vencida" ? !vencida : c.estado !== estado || vencida) return false;
      }
      if (plan !== "todos" && c.plan_code !== plan) return false;
      if (!q) return true;
      return (
        c.business_name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [cuentas, busqueda, estado, plan]);

  // El aviso de react-hooks/incompatible-library es correcto y no tiene
  // arreglo: useReactTable devuelve funciones nuevas en cada render por
  // diseño, que es como la tabla expone su estado, y el compilador de React no
  // podría memorizarlas sin romperlas.
  //
  // Hoy da igual —el compilador ni siquiera está activado en next.config.ts—
  // pero el aviso saldría en cada build, y un aviso que siempre está deja de
  // leerse. Se silencia aquí con su motivo al lado en vez de dejarlo sonando.
  //
  // Probé antes la directiva "use no memo" que documenta TanStack: con el
  // compilador apagado no cambia nada, así que era código muerto.
  //
  // Si algún día se activa el compilador, esta línea es el sitio donde mirar.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtradas,
    columns: columnas,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar por nombre o correo…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-full sm:w-64"
        />
        <Select value={estado} onValueChange={setEstado}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="vencida">Demo vencida</SelectItem>
            <SelectItem value="demo">Demo</SelectItem>
            <SelectItem value="activa">Activa</SelectItem>
            <SelectItem value="bloqueada">Bloqueada</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <Select value={plan} onValueChange={setPlan}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todo plan</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {filtradas.length} de {cuentas.length}
        </span>
      </div>

      {/* overflow-x en su propio contenedor, nunca en la página: una tabla
          ancha se desplaza dentro de sí misma. Regla de DESIGN-SYSTEM.md. */}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="whitespace-nowrap">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnas.length} className="h-20 text-center text-muted-foreground">
                  Ningún negocio con esos filtros.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/admin/cuentas/${row.original.owner_id}`)}
                  onKeyDown={(e) => {
                    // Enter y espacio, como cualquier enlace. Una fila que solo
                    // responde al ratón deja fuera a quien navega con teclado —
                    // y el anillo de foco que arreglamos ayer existe justo para
                    // que se vea dónde está.
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/admin/cuentas/${row.original.owner_id}`);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
