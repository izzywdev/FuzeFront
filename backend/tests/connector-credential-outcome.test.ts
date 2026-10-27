import { credentialStoreOutcome } from '../src/connector-platform/credential-outcome'
test('staged authorization does not become a completed connection', () => {
 expect(credentialStoreOutcome({status:202,data:{status:'authorization_pending'}})).toBe('authorization_pending')
})
test('only confirmed credential storage is connected', () => {
 expect(credentialStoreOutcome({status:200,data:{status:'updated'}})).toBe('connected')
})
test.each([{status:202,data:{status:'updated'}},{status:200,data:{status:'authorization_pending'}},{status:200,data:{}},{status:204},{status:201,data:{status:'connected'}}])('unexpected response %p fails closed', response => {
 expect(() => credentialStoreOutcome(response)).toThrow('not confirmed')
})
