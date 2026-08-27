import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Crumb {
  label: string;
  to?: string;
}

interface Props {
  title: string;
  crumbs?: Crumb[];
  scope: "platform" | "tenant" | "organization";
  contextLabel?: string | null;
  children: ReactNode;
}

export function SaasAdminShell({ title, crumbs = [], scope, contextLabel, children }: Props) {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/admin/hub" className="hover:text-foreground">Admin</Link>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <ChevronRight className="h-3 w-3" />
            {c.to ? (
              <Link to={c.to} className="hover:text-foreground">{c.label}</Link>
            ) : (
              <span className="text-foreground">{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <Badge
          variant="outline"
          className={cn(
            "font-normal",
            scope === "platform"
              ? "border-primary/50 text-primary bg-primary/5"
              : "border-border text-muted-foreground",
          )}
        >
          {scope === "platform"
            ? "Platform-level"
            : scope === "organization"
              ? contextLabel
                ? `Organization · ${contextLabel}`
                : "Organization scope"
              : contextLabel
                ? `Tenant · ${contextLabel}`
                : "Tenant scope"}
        </Badge>
      </div>
      {children}
    </div>
  );
}

export function AdminEmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <Card>
      <CardContent className="py-10 flex flex-col items-center text-center gap-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-xs text-muted-foreground max-w-md">{description}</p>}
      </CardContent>
    </Card>
  );
}

export function AdminLoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

export function AdminNoAccess({ message }: { message: string }) {
  return (
    <div className="max-w-3xl mx-auto p-8">
      <Card>
        <CardContent className="py-12 flex flex-col items-center text-center gap-3">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">No admin access</h2>
          <p className="text-sm text-muted-foreground max-w-md">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
