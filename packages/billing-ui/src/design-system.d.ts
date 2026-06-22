/**
 * Ambient typings for the @fuzefront/design-system package. The design system
 * ships token-styled React components as raw .jsx (consumed via a bundler), so
 * it has no emitted .d.ts. These minimal prop contracts let billing-ui
 * type-check against the design system's public surface without re-declaring
 * styles. Keep in sync with design-system/components/**.
 */
declare module '@fuzefront/design-system' {
  import type { ReactNode, CSSProperties, HTMLAttributes, ButtonHTMLAttributes } from 'react'

  export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md' | 'lg'
    withArrow?: boolean
    leadingIcon?: ReactNode
    fullWidth?: boolean
  }
  export function Button(props: ButtonProps): JSX.Element

  export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    children?: ReactNode
    tone?: string
  }
  export function Badge(props: BadgeProps): JSX.Element

  export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
    status?: 'online' | 'degraded' | 'offline'
    label?: ReactNode
  }
  export function StatusPill(props: StatusPillProps): JSX.Element

  export interface CardProps extends HTMLAttributes<HTMLDivElement> {
    children?: ReactNode
    seam?: boolean
    interactive?: boolean
    padded?: boolean
  }
  export function Card(props: CardProps): JSX.Element

  export interface ModalProps extends HTMLAttributes<HTMLDivElement> {
    open?: boolean
    title?: ReactNode
    onClose?: () => void
    children?: ReactNode
    footer?: ReactNode
    labelledById?: string
  }
  export function Modal(props: ModalProps): JSX.Element

  export interface ProgressMeterProps extends HTMLAttributes<HTMLDivElement> {
    value?: number
    max?: number
    label?: ReactNode
    valueLabel?: ReactNode
    tone?: 'seam' | 'warning' | 'danger'
  }
  export function ProgressMeter(props: ProgressMeterProps): JSX.Element

  export interface SeamDividerProps extends HTMLAttributes<HTMLDivElement> {
    style?: CSSProperties
  }
  export function SeamDivider(props: SeamDividerProps): JSX.Element
}
