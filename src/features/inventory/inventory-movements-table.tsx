import { Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { InventoryMovementRecord } from "@/lib/inventory-domain";
import { signedUnits } from "@/features/inventory/inventory-format";
import { useFormat } from "@/lib/i18n/locale-context";
import { EmptyState, MovementKindBadge } from "@/features/inventory/inventory-ui";
import { t } from "@/lib/i18n/t";

/**
 * The stock ledger.
 *
 * Unsettled rows (`pending`, `rejected`) are shown rather than filtered out.
 * A ledger that hides its failures is the one that quietly stops reconciling —
 * and a `rejected` row is exactly the evidence you want when a dispatcher says
 * they posted a shipment and the level did not move.
 */
export function InventoryMovementsTable({
  movements,
  filtered,
}: {
  movements: InventoryMovementRecord[];
  filtered: boolean;
}) {
  const format = useFormat();

  if (movements.length === 0) {
    return (
      <EmptyState
        icon={History}
        title={filtered ? "No movements match these filters" : "No stock has moved yet"}
        description={
          filtered
            ? "Widen the search, or clear the type filter to see the whole ledger."
            : "Every receipt, shipment, allocation and adjustment lands here with its actor, reason and resulting level."
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[140px] text-xs">{t("When")}</TableHead>
            <TableHead className="min-w-[110px] text-xs">{t("Type")}</TableHead>
            <TableHead className="min-w-[160px] text-xs">SKU</TableHead>
            <TableHead className="min-w-[92px] text-right text-xs">{t("Change")}</TableHead>
            <TableHead className="min-w-[100px] text-right text-xs">{t("Resulting")}</TableHead>
            <TableHead className="min-w-[140px] text-xs">{t("Reference")}</TableHead>
            <TableHead className="min-w-[200px] text-xs">{t("Reason")}</TableHead>
            <TableHead className="min-w-[120px] text-xs">{t("Posted by")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movements.map((movement) => {
            const settled = movement.postedState === "posted";
            const rejected = movement.postedState === "rejected";

            return (
              <TableRow
                key={movement.movementId}
                className={cn(!settled && "bg-muted/30", rejected && "bg-destructive/5")}
              >
                <TableCell>
                  <p className="text-sm">{format.dateTime(movement.createdAt)}</p>
                  {!settled ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "mt-1 inline-flex cursor-default items-center gap-1 text-[11px] font-medium",
                            rejected ? "text-destructive" : "text-warning-foreground",
                          )}
                        >
                          {rejected ? (
                            <AlertTriangle className="h-3 w-3" />
                          ) : (
                            <Clock className="h-3 w-3" />
                          )}
                          {rejected ? "Rejected" : "Unsettled"}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p className="max-w-[240px] text-xs">
                          {movement.rejectedReason ??
                            "This movement was recorded but never confirmed against the stock level. It did not change the on-hand quantity."}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </TableCell>

                <TableCell>
                  <MovementKindBadge kind={movement.kind} />
                </TableCell>

                <TableCell>
                  <p className="truncate font-medium text-foreground">{movement.sku}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {movement.itemName ?? "—"}
                    {movement.warehouse ? ` · ${movement.warehouse}` : ""}
                  </p>
                </TableCell>

                <TableCell className="text-right tabular-nums">
                  <span
                    className={cn(
                      "font-semibold",
                      movement.onHandDelta > 0 && "text-success",
                      movement.onHandDelta < 0 && "text-destructive",
                      movement.onHandDelta === 0 && "text-muted-foreground",
                    )}
                  >
                    {signedUnits(format, movement.onHandDelta)}
                  </span>
                  {movement.allocatedDelta !== 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      {signedUnits(format, movement.allocatedDelta)} alloc
                    </p>
                  ) : null}
                </TableCell>

                <TableCell className="text-right tabular-nums">
                  {settled ? (
                    <>
                      <p className="font-medium">{format.number(movement.resultingOnHand)}</p>
                      {movement.resultingAllocated > 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          {format.number(movement.resultingAllocated)} alloc
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell>
                  {movement.reference ? (
                    <Link
                      to="/loads/$loadId"
                      params={{ loadId: movement.reference }}
                      className="inline-flex"
                    >
                      <Badge
                        variant="secondary"
                        className="font-normal hover:bg-secondary/80 hover:underline"
                      >
                        {movement.reference}
                      </Badge>
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {movement.reason || movement.notes || "—"}
                  </p>
                </TableCell>

                <TableCell>
                  <p className="text-sm">{movement.actorRole ?? "—"}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {movement.createdBy ? `${movement.createdBy.slice(0, 8)}…` : "—"}
                  </p>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
