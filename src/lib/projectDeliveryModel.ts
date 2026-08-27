// Project delivery model — controlled classification (not a workflow status).

export const PROJECT_DELIVERY_MODEL_VALUES = [
  "internal_delivery",
  "vendor_delivery",
  "co_delivery",
] as const;

export type ProjectDeliveryModel = (typeof PROJECT_DELIVERY_MODEL_VALUES)[number];

export const PROJECT_DELIVERY_MODEL_LABELS: Record<ProjectDeliveryModel, string> = {
  internal_delivery: "Internal Delivery",
  vendor_delivery: "Vendor Delivery",
  co_delivery: "Co-delivery",
};

export const UNCLASSIFIED_LABEL = "Unclassified";

/** UI sentinel for shadcn Select (cannot use empty string). Maps to NULL on save. */
export const DELIVERY_MODEL_UNCLASSIFIED_SENTINEL = "__unclassified__";

export function projectDeliveryModelLabel(
  value: ProjectDeliveryModel | null | undefined,
): string {
  if (!value) return UNCLASSIFIED_LABEL;
  return PROJECT_DELIVERY_MODEL_LABELS[value] ?? UNCLASSIFIED_LABEL;
}

export function projectDeliveryModelBadgeLabel(
  value: ProjectDeliveryModel | null | undefined,
): string {
  return `Delivery: ${projectDeliveryModelLabel(value)}`;
}

export function deliveryModelFromSelectValue(
  raw: string,
): ProjectDeliveryModel | null {
  if (!raw || raw === DELIVERY_MODEL_UNCLASSIFIED_SENTINEL) return null;
  return (PROJECT_DELIVERY_MODEL_VALUES as readonly string[]).includes(raw)
    ? (raw as ProjectDeliveryModel)
    : null;
}

export function deliveryModelToSelectValue(
  value: ProjectDeliveryModel | null | undefined,
): string {
  return value ?? DELIVERY_MODEL_UNCLASSIFIED_SENTINEL;
}
