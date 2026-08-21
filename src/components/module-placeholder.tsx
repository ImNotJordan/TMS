import { type LucideIcon, Filter, Plus, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { t } from "@/lib/i18n/t";

export function ModulePlaceholder({
  icon: Icon,
  title,
  description,
  panels,
  showWorkspaceCard = true,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  panels: { label: string; value: string; tone?: "default" | "success" | "warning" | "info" }[];
  showWorkspaceCard?: boolean;
}) {
  const toneClass = {
    default: "bg-muted text-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    info: "bg-info/15 text-info",
  } as const;

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" /> {t("Filters")}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Download className="h-4 w-4" /> {t("Export")}
            </Button>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> {t("New")}
            </Button>
          </>
        }
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {panels.map((p) => (
            <Card key={p.label} className="border-border/70 shadow-sm">
              <CardContent className="p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {p.label}
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <div className="text-2xl font-semibold tracking-tight text-foreground">
                    {p.value}
                  </div>
                  <Badge variant="secondary" className={toneClass[p.tone ?? "default"]}>
                    {t("Live")}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {showWorkspaceCard ? (
          <Card className="mt-6 border-border/70 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-6 w-6" />
              </div>
              <div className="max-w-md">
                <h3 className="text-base font-semibold text-foreground">{title} workspace</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(
                    "Connected to your live operations data. Tables, filters, and bulk actions appear\r\n                  here. Use the quick create button above to populate this module.",
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">
                  {t("View documentation")}
                </Button>
                <Button size="sm">{t("Get started")}</Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
