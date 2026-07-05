/**
 * @fuzefront/billing-ui — design-system-first React billing UI for the
 * FuzeFront billing-service.
 *
 * Consumers must also import the stylesheet once:
 *   import '@fuzefront/billing-ui/styles.css';
 * and wrap the tree (or the FuzeFront shell already does) so the
 * @fuzefront/design-system token CSS variables are in scope.
 *
 * All request/response shapes come from the generated @fuzefront/billing-client
 * (source of truth: services/billing-service/openapi.yaml) — never hand-written.
 */

// i18n / direction
export {
  BillingI18nProvider,
  useBillingI18n,
  defaultStrings,
  type BillingStrings,
  type Direction,
  type I18nContextValue,
  type BillingI18nProviderProps,
} from './i18n';

// Status helpers (re-exported for consumers building custom chrome)
export { statusTone, statusLabel, isEntitled, type StatusTone } from './lib/status';

// Primitives
export {
  Button,
  Spinner,
  StatusPill,
  Notice,
  type ButtonProps,
  type ButtonVariant,
} from './components/primitives';

// Dialog
export { Modal, type ModalProps } from './components/Modal';

// Plan selection
export { PlanCard, type PlanCardProps } from './components/PlanCard';
export {
  PlanPicker,
  type PlanPickerProps,
  type BillingInterval,
} from './components/PlanPicker';

// Checkout (Stripe Payment Element)
export {
  CheckoutModal,
  type CheckoutModalProps,
  type CheckoutMode,
} from './components/CheckoutModal';

// Subscription management
export {
  SubscriptionManager,
  type SubscriptionManagerProps,
} from './components/SubscriptionManager';

// Usage / credits
export { UsagePanel, type UsagePanelProps } from './components/UsagePanel';

// Payment methods
export {
  PaymentMethodPanel,
  type PaymentMethodPanelProps,
  type CardSummary,
} from './components/PaymentMethodPanel';

// Re-export the contract types consumers will need alongside the components.
export type {
  Plan,
  BillingSubscription,
  SubscriptionStatus,
  PlanTier,
  EntityType,
} from '@fuzefront/billing-client';
