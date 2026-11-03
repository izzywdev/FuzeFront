import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import router from '../src/routes/security'
import { setIdentityProvider } from '../src/providers/factory'
import { proveSessionTenant } from '../src/services/session-tenant'
jest.mock('../src/services/session-tenant', () => ({ ...jest.requireActual('../src/services/session-tenant'), proveSessionTenant: jest.fn() }))
const tenant = '0195a8f2-6c3d-7f11-8b2e-012345678901'
const subject = '0195a8f2-6c3d-7f11-8b2e-012345678902'
const key = 'unit-delegation-key-derived-without-live-credentials'
const info = jest.fn()
const proof = proveSessionTenant as jest.Mock
function token(claims: object) { return jwt.sign(claims, key, { expiresIn: 60 }) }
function exchange(body: object, actor = 'service:front') {
 const app = express(); app.use(express.json()); app.use(router)
 return request(app).post('/tokens/exchange').set('Authorization', 'Bearer ' + token({kind:'fuze-workload', sub:actor, aud:'fuzefront-services', scope:'connectors:metadata connectors:credentials:read'})).send({subjectToken:'session',audience:'service:fuzekeys',scope:'connectors:metadata',...body})
}
beforeEach(() => {
 process.env.DELEGATION_SIGNING_KEY = key
 proof.mockReset().mockResolvedValue(tenant)
 info.mockReset().mockResolvedValue({identity:{userId:subject}})
 setIdentityProvider({introspectToken:jest.fn().mockResolvedValue({active:true,subject}),getUserInfo:info} as any)
})
afterEach(() => {setIdentityProvider(null);delete process.env.DELEGATION_SIGNING_KEY})
test('proves explicit organization membership before signing', async () => {
 const r = await exchange({tenant}); expect(r.status).toBe(200)
 expect(proof).toHaveBeenCalledWith(subject,tenant)
 expect(jwt.verify(r.body.accessToken,key)).toMatchObject({tenantId:tenant,sub:subject})
 expect(info).toHaveBeenCalledWith('session')
})
test('missing tenant creates a user-only personal delegation without membership lookup', async () => {
 const r = await exchange({}); expect(r.status).toBe(200); expect(proof).not.toHaveBeenCalled()
 expect(jwt.verify(r.body.accessToken,key)).toMatchObject({tenantId:null,sub:subject})
})
test('inactive membership denies; SQL failure is unavailable', async () => {
 proof.mockResolvedValue(null);expect((await exchange({tenant})).status).toBe(403)
 proof.mockRejectedValue(new Error('private SQL'));expect((await exchange({tenant})).status).toBe(503)
})
test('revoked or mismatched session cannot sign', async () => {
 info.mockResolvedValue({identity:{userId:'other'}});expect((await exchange({tenant})).status).toBe(401)
 expect(proof).not.toHaveBeenCalled()
})
function continuation(aud='service:front',scope='connectors:metadata') {return token({kind:'fuze-delegation',sub:subject,aud,scope,tenantId:tenant,act:{sub:'service:previous'}})}
test('reexchange rechecks membership and preserves signed tenant', async () => {
 const r=await exchange({subjectToken:continuation()});expect(r.status).toBe(200)
 expect(proof).toHaveBeenCalledWith(subject,tenant);expect(info).not.toHaveBeenCalled()
})
test('reexchange cannot change tenant, audience actor or gain scopes', async () => {
 expect((await exchange({subjectToken:continuation(),tenant:'0195a8f2-6c3d-7f11-8b2e-012345678903'})).status).toBe(403)
 expect((await exchange({subjectToken:continuation('service:other')})).status).toBe(403)
 expect((await exchange({subjectToken:continuation(),scope:'connectors:credentials:read'})).status).toBe(403)
})
