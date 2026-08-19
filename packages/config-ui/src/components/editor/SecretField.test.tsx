import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigI18nProvider } from '../../i18n/ConfigI18nProvider'
import { SecretField } from './SecretField'

function renderField(props: Partial<ComponentProps<typeof SecretField>> = {}) {
  const onReplace = vi.fn()
  const onClear = vi.fn()
  render(
    <ConfigI18nProvider>
      <SecretField
        keyName="notifications.provider.apiKey"
        isSet={false}
        onReplace={onReplace}
        onClear={onClear}
        {...props}
      />
    </ConfigI18nProvider>
  )
  return { onReplace, onClear }
}

describe('<SecretField>', () => {
  it('isSet=false renders "No value set" in words, never a mask', () => {
    renderField({ isSet: false })
    expect(screen.getByText(/no value set/i)).toBeInTheDocument();
    expect(screen.queryByText('••••••••••••••••')).not.toBeInTheDocument()
  })

  it('isSet=true renders a mask with NO show/reveal toggle on the field itself (no plaintext ever received)', () => {
    renderField({ isSet: true })
    expect(screen.getByText('••••••••••••••••')).toBeInTheDocument()
    // No plaintext value is ever rendered for a "set" secret.
    expect(screen.queryByDisplayValue(/./)).not.toBeInTheDocument()
  })

  it('never renders a Reveal action unless BOTH canReveal and onReveal are supplied', () => {
    renderField({ isSet: true, canReveal: true }) // onReveal omitted
    expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument()

    renderField({ isSet: true, canReveal: false, onReveal: vi.fn() }) // canReveal false
    expect(screen.queryByRole('button', { name: /^reveal$/i })).not.toBeInTheDocument()
  })

  it('renders Reveal when both canReveal and onReveal are supplied, and shows the value exactly once', async () => {
    const user = userEvent.setup()
    const onReveal = vi.fn().mockResolvedValue('sk_live_EXAMPLE')
    renderField({ isSet: true, canReveal: true, onReveal })

    await user.click(screen.getByRole('button', { name: /^reveal$/i }))
    await user.type(screen.getByLabelText(/why do you need to see this/i), 'rotating creds')
    await user.click(screen.getByRole('button', { name: /^reveal$/i }))

    expect(onReveal).toHaveBeenCalledWith('rotating creds')
    expect(await screen.findByText('sk_live_EXAMPLE')).toBeInTheDocument()

    // Dismissing removes the plaintext — no re-open from this dialog.
    await user.click(screen.getByRole('button', { name: /hide it/i }))
    expect(screen.queryByText('sk_live_EXAMPLE')).not.toBeInTheDocument()
  })

  it('replacing starts with an empty field, not pre-filled with anything', async () => {
    const user = userEvent.setup()
    renderField({ isSet: true })
    await user.click(screen.getByRole('button', { name: /replace/i }))
    const input = screen.getByPlaceholderText(/paste the new value/i) as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('calls onReplace with the typed value on save, and onClear (never onReplace) for Clear', async () => {
    const user = userEvent.setup()
    const { onReplace, onClear } = renderField({ isSet: true })
    await user.click(screen.getByRole('button', { name: /replace/i }))
    await user.type(screen.getByPlaceholderText(/paste the new value/i), 'sk_new_value')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(onReplace).toHaveBeenCalledWith('sk_new_value')

    await user.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onReplace).toHaveBeenCalledTimes(1)
  })

  it('SECRET_UNAVAILABLE renders distinctly from "not set" — never claims the credential is unset', () => {
    renderField({ isSet: true, unavailable: true })
    expect(screen.getByText(/cannot be read right now/i)).toBeInTheDocument()
    expect(screen.queryByText(/no value set/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^reveal$/i })).toBeDisabled()
  })

  it('renders a distinct "may replace but not reveal" notice when canReveal is explicitly false', () => {
    renderField({ isSet: true, canReveal: false })
    expect(screen.getByText(/can replace this credential but not view it/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /replace/i })).toBeEnabled()
  })
})
