/**
 * VisibilityFilter — Any · Private · Organization · Common (frame 01).
 *
 * Present ONLY while "Include common lists" is ON (the caller omits it
 * otherwise — absent, not disabled): a choice other than `any` sends
 * `include_shared=true&visibility=…`, which the service treats as "show me
 * exactly these" and stops hiding common lists behind forks.
 */

import { SegmentedControl } from '@fuzefront/design-system'
import type { VisibilityFilter as VisibilityFilterValue } from '../core'
import { INDEX_COPY, VISIBILITY_FILTER_OPTIONS } from './copy'

export interface VisibilityFilterProps {
  value: VisibilityFilterValue
  onChange: (next: VisibilityFilterValue) => void
}

export function VisibilityFilter({ value, onChange }: VisibilityFilterProps) {
  return (
    <SegmentedControl
      ariaLabel={INDEX_COPY.visibilityGroupLabel}
      data-filter="visibility"
      value={value}
      onChange={next => onChange(next as VisibilityFilterValue)}
      options={VISIBILITY_FILTER_OPTIONS.map(option => ({
        value: option.value,
        label: option.label,
        'data-visibility-filter': option.value,
      }))}
    />
  )
}
