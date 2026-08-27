import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users } from "lucide-react";

type TeamMember = {
  id: string;
  user_id: string;
  role_label: string | null;
  profiles: { display_name: string | null; email: string | null; avatar_url: string | null } | null;
};

function getInitials(name: string | null, email: string | null): string {
  if (name) return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  if (email) return email[0].toUpperCase();
  return "?";
}

export function TeamSummarySection({ members, isLoading }: { members: TeamMember[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Team</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Loading…</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Team
          <span className="text-sm font-normal text-muted-foreground">({members.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No team members assigned.</p>
        ) : (
          <div className="space-y-3">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {getInitials(m.profiles?.display_name ?? null, m.profiles?.email ?? null)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {m.profiles?.display_name || m.profiles?.email || "Unknown"}
                  </p>
                  {m.role_label && (
                    <p className="text-xs text-muted-foreground">{m.role_label}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
