import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CharterField {
  label: string;
  value: string | null | undefined;
}

export interface ProjectCharterDetailsSectionProps {
  businessCase: string | null;
  successCriteria: string | null;
  completionCriteria: string | null;
  budgetNarrative: string | null;
  assumptions: string | null;
  constraints: string | null;
}

export function ProjectCharterDetailsSection({
  businessCase,
  successCriteria,
  completionCriteria,
  budgetNarrative,
  assumptions,
  constraints,
}: ProjectCharterDetailsSectionProps) {
  const fields: CharterField[] = [
    { label: "Business Case", value: businessCase },
    { label: "Success Criteria", value: successCriteria },
    { label: "Completion Criteria", value: completionCriteria },
    { label: "Budget Narrative", value: budgetNarrative },
    { label: "Assumptions", value: assumptions },
    { label: "Constraints", value: constraints },
  ];

  const populated = fields.filter((f) => f.value && f.value.trim().length > 0);

  if (populated.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No additional charter details have been captured yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {populated.map((f) => (
        <Card key={f.label}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{f.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{f.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
