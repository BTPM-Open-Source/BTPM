import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function NarrativeBlock({ title, content }: { title: string; content: string | null }) {
  if (!content) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{content}</p>
      </CardContent>
    </Card>
  );
}

export function ProjectNarrativeSection({
  description,
  charter,
  goals,
  scopeIn,
  scopeOut,
}: {
  description: string | null;
  charter: string | null;
  goals: string | null;
  scopeIn: string | null;
  scopeOut: string | null;
}) {
  const hasContent = description || charter || goals || scopeIn || scopeOut;
  if (!hasContent) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No project narrative has been defined yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <NarrativeBlock title="Charter" content={charter} />
      <NarrativeBlock title="Description" content={description} />
      <NarrativeBlock title="Goals" content={goals} />
      <NarrativeBlock title="In Scope" content={scopeIn} />
      <NarrativeBlock title="Out of Scope" content={scopeOut} />
    </div>
  );
}
