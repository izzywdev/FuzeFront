const DEFAULT_API_ORIGIN = 'http://localhost:3001'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FUZE_PICKER_CONNECT') {
    chrome.storage.local.set({ fuzepickerToken: message.token, fuzepickerApiOrigin: message.apiOrigin || DEFAULT_API_ORIGIN }).then(() => sendResponse({ ok: true }))
    return true
  }
  if (message.type === 'FUZE_PICKER_CREATE_MENTION') {
    chrome.storage.local.get(['fuzepickerToken', 'fuzepickerApiOrigin']).then(async settings => {
      if (!settings.fuzepickerToken) return sendResponse({ ok: false, error: 'Connect FuzePicker to FuzeFront first.' })
      try {
        const response = await fetch(`${settings.fuzepickerApiOrigin || DEFAULT_API_ORIGIN}/api/fuzepicker/mentions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.fuzepickerToken}` },
          body: JSON.stringify(message.payload),
        })
        const data = await response.json().catch(() => ({}))
        sendResponse(response.ok ? { ok: true, mention: data.mention } : { ok: false, error: data.error || 'Could not send the mention.' })
      } catch { sendResponse({ ok: false, error: 'Could not reach FuzeFront.' }) }
    })
    return true
  }
})

chrome.action.onClicked.addListener(tab => { if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'FUZE_PICKER_TOGGLE' }) })
