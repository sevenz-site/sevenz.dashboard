"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Filters live in the URL, not in component state, so a filtered view is
// bookmarkable and shareable — the same pattern as ?historial=todo and
// ?nuevo=1 elsewhere in this app. It also means the page stays a server
// component: changing a filter is a navigation, not a refetch.
export function MetricFilters({
  owners,
}: {
  owners: { id: string; business_name: string; country: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  // "all" rather than "" as the cleared value: a Select cannot hold an empty
  // string as an item value, and the server maps it back to no filter.
  const current = (key: string) => params.get(key) ?? "all";

  function apply(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    router.push(`/admin?${next.toString()}`, { scroll: false });
  }

  const hasFilters = ["country", "currency", "owner", "from", "to", "bucket"].some((k) => params.get(k));

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">País</Label>
          <Select value={current("country")} onValueChange={(v) => apply("country", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="CO">Colombia</SelectItem>
              <SelectItem value="VE">Venezuela</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Moneda</Label>
          <Select value={current("currency")} onValueChange={(v) => apply("currency", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="COP">COP</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
          <Label className="text-xs text-muted-foreground">Negocio</Label>
          <Select value={current("owner")} onValueChange={(v) => apply("owner", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.business_name || "(sin nombre)"} · {o.country}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground" htmlFor="from">Desde</Label>
          <Input
            id="from"
            type="date"
            defaultValue={params.get("from") ?? ""}
            onChange={(e) => apply("from", e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground" htmlFor="to">Hasta</Label>
          <Input
            id="to"
            type="date"
            defaultValue={params.get("to") ?? ""}
            onChange={(e) => apply("to", e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Agrupar por</Label>
          <Select value={params.get("bucket") ?? "week"} onValueChange={(v) => apply("bucket", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Día</SelectItem>
              <SelectItem value="week">Semana</SelectItem>
              <SelectItem value="month">Mes</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {hasFilters ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => router.push("/admin", { scroll: false })}>
            Limpiar filtros
          </Button>
        </div>
      ) : null}
    </div>
  );
}
