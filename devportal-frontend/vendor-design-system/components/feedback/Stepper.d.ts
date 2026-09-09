import * as React from "react";

export interface StepperStep {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** @default "pending" */
  status?: "done" | "current" | "pending";
}

export interface StepperProps extends React.HTMLAttributes<HTMLOListElement> {
  steps: StepperStep[];
}

/**
 * A vertical, ordered progress list (onboarding / setup checklist) — numbered
 * steps with `done` / `current` / `pending` state. The current step carries
 * `aria-current="step"`.
 */
export function Stepper(props: StepperProps): React.JSX.Element;
