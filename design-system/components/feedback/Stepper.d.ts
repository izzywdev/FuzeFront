import * as React from "react";

export type StepperStatus = "done" | "current" | "failed" | "cancelled" | "pending";

export interface StepperStep {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** @default "pending" (also used for any unrecognised value) */
  status?: StepperStatus;
}

export interface StepperProps extends React.HTMLAttributes<HTMLOListElement> {
  steps: StepperStep[];
  /**
   * `vertical` — a card list (onboarding checklist). `horizontal` — equal-width
   * status-coloured bars over their titles (pipeline / wizard header), wrapping
   * on narrow screens.
   * @default "vertical"
   */
  orientation?: "vertical" | "horizontal";
  /**
   * Visually-hidden status words read by assistive tech. Override any subset to
   * localise; defaults are English: Completed / Current step / Failed /
   * Cancelled / Not started.
   */
  statusLabels?: Partial<Record<StepperStatus, string>>;
}

/**
 * An ordered progress indicator with `done` / `current` / `failed` /
 * `cancelled` / `pending` steps, in a vertical card list or a horizontal
 * segmented bar. The current step carries `aria-current="step"`; every step's
 * status is also exposed as visually-hidden text.
 */
export function Stepper(props: StepperProps): React.JSX.Element;
