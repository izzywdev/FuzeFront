import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConnectorsPage from '../pages/ConnectorsPage'
vi.mock('../lib/accounts', () => ({getActiveAuthToken: () => 'synthetic'}))
const staged = () => ({ok:true,status:202,json:async()=>({status:'authorization_pending',provider:'stripe',retry_after_authorization:true})})
function mockFetch() { vi.stubGlobal('fetch',vi.fn(async (url:string, init?:RequestInit) => {
 if(url.endsWith('/catalog'))return {ok:true,json:async()=>({connectors:[{id:'stripe',name:'Stripe',authentication:'api-key',configured:true}]})}
 if(url.endsWith('/google-gmail'))return {ok:true,json:async()=>({provider:'google-gmail',status:'disconnected'})}
 if(init?.method==='POST')return staged()
 return {ok:false,status:403,json:async()=>({detail:'denied'})}
})) }
beforeEach(()=>{window.history.replaceState({},'', '/connectors');mockFetch()})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
test('OAuth pending redirect remains pending even when status is denied before approval',async()=>{
 window.history.replaceState({},'', '/connectors?authorization_pending=stripe')
 render(<ConnectorsPage/>);
 expect(await screen.findByText('Awaiting approval — connect again after approval')).toBeTruthy()
 expect(screen.getByRole('status').textContent).toContain('Contact your administrator')
 expect(screen.queryByText(/^Connected/)).toBeNull()
})
test('staged key response clears secret input and never shows connected',async()=>{
 // The initial status can be disconnected, then pending status reads can deny.
 const original = fetch
 vi.stubGlobal('fetch',vi.fn(async(url:string, init?:RequestInit)=> url.endsWith('/stripe') && !init?.method ? {ok:true,json:async()=>({status:'disconnected'})} : original(url,init)))
 render(<ConnectorsPage/>);
 const input=await screen.findByLabelText('Stripe API key');fireEvent.change(input,{target:{value:'synthetic-user-key'}})
 fireEvent.click(screen.getByText('Save key'))
 await waitFor(()=>expect((input as HTMLInputElement).value).toBe(''))
 expect(screen.getByRole('status').textContent).toContain('awaiting approval')
 expect(screen.queryByText(/^Connected/)).toBeNull()
})
