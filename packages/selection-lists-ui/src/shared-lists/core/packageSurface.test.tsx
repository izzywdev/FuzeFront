/**
 * What a HOST gets from the package entry for shared lists — and that the 4.0.0
 * surface is still there, unchanged, beside it.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import * as pkg from '../../index'

function Probe() {
  const { enabled, isPlatformOrg } = pkg.useSharedLists()
  return <output data-testid="probe">{`${enabled}|${isPlatformOrg}`}</output>
}

describe('package entry — shared-lists host surface', () => {
  it('exports the provider, the hook and the flag key', () => {
    expect(typeof pkg.SharedListsFeatureProvider).toBe('function')
    expect(typeof pkg.useSharedLists).toBe('function')
    expect(pkg.SHARED_LISTS_FLAG_KEY).toBe(
      'fuzefront.selection-lists.shared-lists'
    )
  })

  it('a host without the provider sees OFF', () => {
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('false|false')
  })

  it('a host that passes the flag and the platform-org hint sees them', () => {
    render(
      <pkg.SharedListsFeatureProvider sharedLists isPlatformOrg>
        <Probe />
      </pkg.SharedListsFeatureProvider>
    )
    expect(screen.getByTestId('probe').textContent).toBe('true|true')
  })

  it('keeps the approved 4.0.0 surface', () => {
    for (const name of [
      'SelectionListManagementFlow',
      'TranslationWorkbenchFlow',
      'SelectionListAccessFlow',
      'SelectionListPickerHarness',
      'SelectionListPicker',
      'listSelectionLists',
      'resolveItems',
      'configureSelectionListsAuth',
    ]) {
      expect(pkg).toHaveProperty(name)
    }
  })

  it('does not leak internals (the raw request helper stays inside the package)', () => {
    expect(pkg).not.toHaveProperty('request')
    expect(pkg).not.toHaveProperty('SELECTION_LISTS_API_BASE')
  })
})
