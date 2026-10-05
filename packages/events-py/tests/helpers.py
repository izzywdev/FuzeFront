from fuzefront_events import build_event, enqueue_event_async

ORG1 = "org_01h455vb4pex5vsknk084sn02q"
ORG2 = "org_01h455vb4pex5vsknk084sn02r"


def ev(agg=ORG1, version=1, topic="identity.org.updated", payload=None):
    return build_event(
        topic=topic,
        aggregate_type="organization",
        aggregate_id=agg,
        aggregate_version=version,
        producer="svc",
        payload=payload or {"v": version},
        correlation_id="c",
    )


async def enqueue(sf, *events):
    async with sf() as s, s.begin():
        for e in events:
            await enqueue_event_async(s, e)
