import {
  GraphCreateError,
  graphCreate,
  idMapOf,
  resolveGraph,
} from '../../src/identity/graph-create'
import type { GraphRequestLike, GraphResponseLike } from '../../src/identity/graph-create'
import { entityTypeOf, parseId } from '../../src/identity/id'
import type { EntityType } from '../../src/identity/registry'

const AGGREGATE = new Set<EntityType>(['customer', 'invoice', 'payment', 'subscription'])
const opts = { aggregate: AGGREGATE }

/** Minimal Express-shaped double; the adapter is typed structurally. */
function makeRes(): GraphResponseLike & { statusCode?: number; payload?: unknown } {
  const res: GraphResponseLike & { statusCode?: number; payload?: unknown } = {
    locals: {},
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.payload = payload
      return payload
    },
  }
  return res
}

describe('resolveGraph — id allocation', () => {
  it('mints an id per lid node and reports them all in idMap', () => {
    const { body, idMap } = resolveGraph(
      {
        type: 'customer',
        lid: '1',
        name: 'Acme',
        invoices: [
          { type: 'invoice', lid: '2', customerId: 'lid:1' },
          { type: 'invoice', lid: '3', customerId: 'lid:1' },
        ],
      },
      opts
    )

    expect(Object.keys(idMap).sort()).toEqual(['1', '2', '3'])
    expect(entityTypeOf(idMap['1'])).toBe('customer')
    expect(entityTypeOf(idMap['2'])).toBe('invoice')

    const out = body as any
    expect(out.id).toBe(idMap['1'])
    expect(out.invoices[0].customerId).toBe(idMap['1'])
    expect(out.invoices[1].customerId).toBe(idMap['1'])
    expect(out.invoices[0].id).toBe(idMap['2'])
  })

  it('strips lid from the body the handler sees', () => {
    const { body } = resolveGraph({ type: 'customer', lid: '1', name: 'Acme' }, opts)
    expect(body).not.toHaveProperty('lid')
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('name', 'Acme')
  })

  it('leaves a graph with no lid nodes completely untouched', () => {
    const input = { name: 'Acme', tags: ['a', 'b'], nested: { n: 1 } }
    const { body, idMap } = resolveGraph(input, opts)
    expect(body).toEqual(input)
    expect(idMap).toEqual({})
  })

  it('resolves references at any depth and inside arrays', () => {
    const { body, idMap } = resolveGraph(
      {
        type: 'customer',
        lid: 'c',
        deep: { deeper: { refs: ['lid:c', 'literal'] } },
      },
      opts
    )
    expect((body as any).deep.deeper.refs).toEqual([idMap['c'], 'literal'])
  })

  it('produces ids that pass parseId for their declared type', () => {
    const { idMap } = resolveGraph(
      { type: 'customer', lid: '1', subs: [{ type: 'subscription', lid: '2' }] },
      opts
    )
    expect(parseId('customer', idMap['1'])).toBeDefined()
    expect(parseId('subscription', idMap['2'])).toBeDefined()
  })
})

describe('resolveGraph — cycles', () => {
  it('resolves mutually-referencing nodes', () => {
    // The payoff of minting up front: post-substitution cannot do this without
    // a deferred second write, because neither id exists when the other is written.
    const { body, idMap } = resolveGraph(
      {
        type: 'customer',
        lid: 'a',
        primaryInvoiceId: 'lid:b',
        invoices: [{ type: 'invoice', lid: 'b', customerId: 'lid:a' }],
      },
      opts
    )
    const out = body as any
    expect(out.primaryInvoiceId).toBe(idMap['b'])
    expect(out.invoices[0].customerId).toBe(idMap['a'])
  })

  it('resolves a forward reference declared after its use', () => {
    const { body, idMap } = resolveGraph(
      {
        type: 'customer',
        lid: 'a',
        laterId: 'lid:z',
        tail: { type: 'invoice', lid: 'z' },
      },
      opts
    )
    expect((body as any).laterId).toBe(idMap['z'])
  })
})

describe('resolveGraph — rejections', () => {
  const expectCode = (fn: () => unknown, code: string) => {
    try {
      fn()
      throw new Error('expected a GraphCreateError')
    } catch (err) {
      expect(err).toBeInstanceOf(GraphCreateError)
      expect((err as GraphCreateError).code).toBe(code)
    }
  }

  it('rejects a client-supplied id anywhere in the graph', () => {
    expectCode(
      () => resolveGraph({ type: 'customer', lid: '1', id: 'cus_whatever' }, opts),
      'CLIENT_SUPPLIED_ID'
    )
    expectCode(
      () => resolveGraph({ type: 'customer', lid: '1', nested: { id: 'anything' } }, opts),
      'CLIENT_SUPPLIED_ID'
    )
  })

  it('rejects a reference to an undeclared lid', () => {
    expectCode(
      () => resolveGraph({ type: 'customer', lid: '1', ref: 'lid:missing' }, opts),
      'UNKNOWN_LID'
    )
  })

  it('rejects a duplicated lid', () => {
    expectCode(
      () =>
        resolveGraph(
          { type: 'customer', lid: '1', child: { type: 'invoice', lid: '1' } },
          opts
        ),
      'DUPLICATE_LID'
    )
  })

  it('rejects a lid node that does not declare its type', () => {
    expectCode(() => resolveGraph({ lid: '1', name: 'x' }, opts), 'MISSING_TYPE')
  })

  it('rejects an unregistered entity type', () => {
    expectCode(() => resolveGraph({ type: 'dragon', lid: '1' }, opts), 'UNKNOWN_TYPE')
  })

  it('rejects creating an entity owned by another service', () => {
    // The aggregate-boundary rule: a graph spanning services cannot be created
    // atomically, so cross-service entities must be referenced, not created.
    expectCode(() => resolveGraph({ type: 'portal', lid: '1' }, opts), 'CROSS_AGGREGATE_LID')
  })

  it('rejects a malformed lid', () => {
    expectCode(() => resolveGraph({ type: 'customer', lid: '' }, opts), 'MALFORMED_LID')
    expectCode(() => resolveGraph({ type: 'customer', lid: 7 }, opts), 'MALFORMED_LID')
  })

  it('bounds graph size', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({ type: 'invoice', lid: `n${i}` }))
    expectCode(() => resolveGraph({ nodes }, { aggregate: AGGREGATE, maxNodes: 5 }), 'GRAPH_TOO_LARGE')
  })

  it('bounds graph depth', () => {
    let deep: unknown = { type: 'invoice', lid: 'x' }
    for (let i = 0; i < 10; i++) deep = { child: deep }
    expectCode(() => resolveGraph(deep, { aggregate: AGGREGATE, maxDepth: 4 }), 'GRAPH_TOO_DEEP')
  })

  it('reports the path to the offending node', () => {
    try {
      resolveGraph({ type: 'customer', lid: '1', invoices: [{ id: 'nope' }] }, opts)
    } catch (err) {
      expect((err as GraphCreateError).path).toBe('/invoices/0')
    }
  })
})

describe('graphCreate middleware', () => {
  const next = () => undefined

  it('rewrites the body in place and exposes idMap on res.locals', () => {
    const req: GraphRequestLike = {
      method: 'POST',
      body: { type: 'customer', lid: '1', name: 'Acme' },
    }
    const res = makeRes()
    graphCreate(opts)(req, res, next)

    expect((req.body as any).id).toBeDefined()
    expect((req.body as any).lid).toBeUndefined()
    expect(idMapOf(res)['1']).toBe((req.body as any).id)
  })

  it('merges idMap into the JSON response without the handler doing anything', () => {
    const req: GraphRequestLike = { method: 'POST', body: { type: 'customer', lid: '1' } }
    const res = makeRes()
    graphCreate(opts)(req, res, next)

    res.json({ status: 'created' })
    expect(res.payload).toEqual({ status: 'created', idMap: idMapOf(res) })
  })

  it('does not clobber an idMap the handler set itself', () => {
    const req: GraphRequestLike = { method: 'POST', body: { type: 'customer', lid: '1' } }
    const res = makeRes()
    graphCreate(opts)(req, res, next)

    res.json({ idMap: { custom: 'kept' } })
    expect(res.payload).toEqual({ idMap: { custom: 'kept' } })
  })

  it('leaves non-object payloads alone', () => {
    const req: GraphRequestLike = { method: 'POST', body: { type: 'customer', lid: '1' } }
    const res = makeRes()
    graphCreate(opts)(req, res, next)

    res.json([1, 2, 3])
    expect(res.payload).toEqual([1, 2, 3])
  })

  it('answers 422 with an actionable code on a bad graph', () => {
    const req: GraphRequestLike = { method: 'POST', body: { type: 'customer', lid: '1', id: 'x' } }
    const res = makeRes()
    let advanced = false
    graphCreate(opts)(req, res, () => {
      advanced = true
    })

    expect(advanced).toBe(false)
    expect(res.statusCode).toBe(422)
    expect(res.payload).toMatchObject({ code: 'CLIENT_SUPPLIED_ID', path: '' })
  })

  it('ignores reads and bodiless requests', () => {
    for (const req of [
      { method: 'GET', body: { type: 'customer', lid: '1' } },
      { method: 'POST' },
    ] as GraphRequestLike[]) {
      const res = makeRes()
      let advanced = false
      graphCreate(opts)(req, res, () => {
        advanced = true
      })
      expect(advanced).toBe(true)
      expect(res.statusCode).toBeUndefined()
    }
  })

  it('does not decorate responses when the request created nothing', () => {
    const req: GraphRequestLike = { method: 'POST', body: { name: 'no lid here' } }
    const res = makeRes()
    graphCreate(opts)(req, res, next)

    res.json({ ok: true })
    expect(res.payload).toEqual({ ok: true })
  })
})
