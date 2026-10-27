/**
 * EditableHint — the caller's access to a list, from `SelectionList.editable`
 * (frames 01, 02, 03).
 *
 * Three-valued: only a PRESENT `editable` renders. An absent value means a
 * 4.0.0-behaviour service and renders NOTHING — unknown is never read as
 * read-only, so the 4.0.0 affordances stay and each mutation's own
 * authorization answers.
 */

import { editableStateOf, type SharedList } from '../core'
import { ACCESS_LABEL } from './copy'
import { accessHint } from './styles'

export interface EditableHintProps {
  list: Pick<SharedList, 'editable'>
  /** `row` = the short index label; `detail` = "Read-only for you". */
  variant?: 'row' | 'detail'
}

export function EditableHint({ list, variant = 'row' }: EditableHintProps) {
  const state = editableStateOf(list as SharedList)
  if (state === 'unknown') return null
  const editable = state === 'editable'
  const copy = ACCESS_LABEL[state][variant]
  return (
    <span data-editable={editable ? 'true' : 'false'} style={accessHint}>
      <span aria-hidden="true">{editable ? '✎' : '🔒'}</span> {copy}
    </span>
  )
}
