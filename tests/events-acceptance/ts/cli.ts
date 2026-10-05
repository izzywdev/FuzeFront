/** Cross-language helper (case 7): invoked as a subprocess by cross/test_cross_language.py via `npx tsx cli.ts`. */
import * as A from './adapter'

async function main() {
  const [cmd, ...a] = process.argv.slice(2)
  const db = A.connectDb()
  if (cmd === 'produce') {
    // produce <topic> <aggregateId> <version> : enqueue via the TS package, relay it to Kafka, print the outbox event_id
    const [topic, agg, v] = a
    await db.transaction((trx) =>
      A.enqueue(trx, A.buildEvent({ topic, aggregateType: 'organization', aggregateId: agg, aggregateVersion: Number(v), payload: { kind: 'created', data: { from: 'ts' } } })))
    await A.drain(db, { publish: await A.realPublisher() })
    console.log(JSON.stringify({ eventId: (await db('event_outbox').where({ aggregate_id: agg }).first()).event_id }))
  } else if (cmd === 'consume') {
    // consume <topic> <group> <expectedEventId> : run the TS consumer until that event is applied; print effects
    const [topic, group, want] = a
    let seen = false
    const h = await A.startConsumer({ groupId: group, topics: [topic], db, handler: async (env, trx) => { await A.projectionHandler(env, trx); if (env.eventId === want) seen = true } })
    await A.waitFor(async () => seen, 40000, 'cross event consumed')
    await h.stop()
    console.log(JSON.stringify({ proj: await A.projState(db), processed: (await db('processed_events').where({ event_id: want })).length }))
  }
  await A.closeRaw(); await db.destroy(); process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
