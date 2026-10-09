import {
  Button,
  IconButton,
  type ButtonAsButtonProps,
  type IconButtonProps,
} from '@fuzefront/design-system'

/**
 * FuzeQuality's local action vocabulary. Shared behavior, focus treatment,
 * spacing and themes remain owned by the FuzeFront Design System; this adapter
 * only maps product intent onto those exported primitives.
 */
export function QualityAction({
  intent = 'primary',
  ...props
}: ButtonAsButtonProps & {
  intent?: 'primary' | 'secondary' | 'danger' | 'quiet'
}) {
  const variant = intent === 'quiet' ? 'ghost' : intent
  return <Button size="sm" variant={variant} {...props} />
}

/** Product-local name for the shared accessible icon-only control. */
export function QualityIconAction(props: IconButtonProps) {
  return <IconButton size="sm" {...props} />
}
