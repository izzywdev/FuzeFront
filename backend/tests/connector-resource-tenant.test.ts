import { connectorResourceTenant } from '../src/connector-platform/tenant'
afterEach(() => { delete process.env.FUZE_CONNECTOR_AUTHZ_TENANT })
test('configured organization overrides server environment without consulting request identity', () => {
 process.env.FUZE_CONNECTOR_AUTHZ_TENANT = 'server-org'
 expect(connectorResourceTenant('configured-org')).toBe('configured-org')
 expect(connectorResourceTenant()).toBe('server-org')
})
test.each([undefined, '', ' org', 'org ', 'a b', 'a'.repeat(256)])('missing or malformed organization %p fails closed', value => {
 expect(() => connectorResourceTenant(value)).toThrow('not configured')
})
test('an explicitly empty option cannot fall back to a different environment organization', () => {
 process.env.FUZE_CONNECTOR_AUTHZ_TENANT = 'server-org'
 expect(() => connectorResourceTenant('')).toThrow()
})
