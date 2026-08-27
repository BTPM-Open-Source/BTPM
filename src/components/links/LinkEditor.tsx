/**
 * Combined "People involved" + "Related work items" editor used by Blocker
 * and Risk dialogs.
 *
 *  - People are sourced from the project Stakeholders list (workspace members
 *    plus externals). Linking does not assign permissions or send notifications.
 *  - Related work items continue to come from the workspace-wide reference search.
 */
import { FieldLabel } from "@/components/ui/field-label";
import { StakeholderPicker } from "./StakeholderPicker";
import { WorkObjectPicker, makeObjectKey } from "./WorkObjectPicker";
import { DraftPersonChip, DraftObjectChip } from "./LinkChips";
import type { ReferenceTargetSearchResult } from "@/hooks/useExecutionData";
import { personDraftKey, type DraftObjectLink, type DraftPersonLink } from "@/lib/entityLinks";

// Re-export under historical names so existing dialog imports keep working.
export type DraftPerson = DraftPersonLink;
export type DraftObject = DraftObjectLink;

interface Props {
  projectId: string;
  workspaceId: string;
  people: DraftPerson[];
  objects: DraftObject[];
  onPeopleChange: (next: DraftPerson[]) => void;
  onObjectsChange: (next: DraftObject[]) => void;
  peopleLabel?: string;
  objectsLabel?: string;
  peopleHint?: string;
  objectsHint?: string;
}

export function LinkEditor({
  projectId,
  workspaceId,
  people,
  objects,
  onPeopleChange,
  onObjectsChange,
  peopleLabel = "People involved",
  objectsLabel = "Related work items",
  peopleHint = "Project stakeholders involved in this item (workspace members or externals). Linking does not assign permissions or send notifications. Manage the list in the project's Stakeholders panel.",
  objectsHint = "Other Project / Phase / Task items in this workspace this item relates to. Does not create dependencies.",
}: Props) {
  const objectKeys = new Set(objects.map(makeObjectKey));
  const selectedStakeholderIds = people
    .map((p) => p.stakeholder_id)
    .filter((id): id is string => !!id);

  const handleAddObject = (sel: ReferenceTargetSearchResult) => {
    onObjectsChange([
      ...objects,
      {
        referenced_type: sel.target_type,
        referenced_id: sel.target_id,
        workspace_id: sel.workspace_id,
        project_id: sel.project_id,
        phase_id: sel.phase_id,
        display_label: sel.display_label,
        context_label: sel.context_label,
      },
    ]);
  };

  return (
    <div className="space-y-3">
      <div>
        <FieldLabel hint={peopleHint}>{peopleLabel}</FieldLabel>
        <div className="flex flex-wrap items-center gap-1 mt-1">
          {people.map((p) => {
            const key = personDraftKey(p);
            return (
              <DraftPersonChip
                key={key}
                data={p}
                onRemove={() => onPeopleChange(people.filter((x) => personDraftKey(x) !== key))}
              />
            );
          })}
          <StakeholderPicker
            projectId={projectId}
            selectedStakeholderIds={selectedStakeholderIds}
            onAdd={(p) => onPeopleChange([...people, p])}
          />
        </div>
      </div>

      <div>
        <FieldLabel hint={objectsHint}>{objectsLabel}</FieldLabel>
        <div className="flex flex-wrap items-center gap-1 mt-1">
          {objects.map((o) => (
            <DraftObjectChip
              key={makeObjectKey(o)}
              data={o}
              onRemove={() =>
                onObjectsChange(objects.filter((x) => makeObjectKey(x) !== makeObjectKey(o)))
              }
            />
          ))}
          <WorkObjectPicker
            workspaceId={workspaceId}
            selectedKeys={objectKeys}
            onAdd={handleAddObject}
          />
        </div>
      </div>
    </div>
  );
}
