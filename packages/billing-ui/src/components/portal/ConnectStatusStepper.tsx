import { Stepper } from '@fuzefront/design-system';
import type { ConnectStepState } from '../../api/portalBillingClient';

export interface ConnectStatusStepperProps {
  steps: ConnectStepState[];
}

/**
 * The Connect onboarding checklist (design/frames 08-billing, 09-portal-
 * states i8). A thin adapter over the design-system `Stepper` primitive —
 * `Stepper` was built for exactly this checklist (see its own doc comment)
 * so this composes it rather than hand-rolling a parallel stepper
 * (design-system-conformance: reuse over reinvent). The one gap against the
 * approval frame's literal `[data-step]`/`[data-done]` hooks is `Stepper`'s
 * own instrumentation (`data-step-status`, `aria-current="step"`) — forking
 * the primitive to add frame-literal attributes would violate "extend the
 * base, don't fork it"; `data-list="connect-steps"` (the frame's container
 * hook) is preserved here.
 */
export function ConnectStatusStepper({ steps }: ConnectStatusStepperProps) {
  return (
    <div data-list="connect-steps">
      <Stepper
        steps={steps.map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          status: s.status,
        }))}
      />
    </div>
  );
}
