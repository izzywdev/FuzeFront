import { createDelegationClient } from '../src/delegation';
test.each([undefined, 'organization-proof-selector'])('forwards optional tenant %p', async tenant => {
 const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({accessToken:'synthetic',actor:{sub:'service:front'},audience:'service:keys',subject:'user'}) });
 const client = createDelegationClient({baseUrl:'https://security.invalid',serviceAuth:{getToken:async ()=>'synthetic-workload'} as any,fetch});
 await client.exchange({subjectToken:'synthetic-session',audience:'service:keys',scopes:['read'],tenant});
 const body=JSON.parse(fetch.mock.calls[0][1].body);
 expect(body).toEqual({subjectToken:'synthetic-session',audience:'service:keys',scope:'read',...(tenant === undefined ? {} : {tenant})});
});
