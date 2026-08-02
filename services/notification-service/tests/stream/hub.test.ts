import { StreamHub } from '../../src/stream/hub';
import { NotificationDTO } from '../../src/db/repositories/notifications';

/** A minimal Response stand-in — the hub only ever calls write/end. */
function fakeRes(opts: { failWrite?: boolean } = {}) {
  const frames: string[] = [];
  return {
    frames,
    ended: false,
    write(chunk: string) {
      if (opts.failWrite) throw new Error('EPIPE');
      frames.push(chunk);
      return true;
    },
    end() {
      (this as any).ended = true;
    },
  } as any;
}

const notification: NotificationDTO = {
  id: 'n-1',
  type: 'system.test',
  category: 'system',
  severity: 'info',
  title: 'Hello',
  body: null,
  actionUrl: null,
  actionLabel: null,
  data: {},
  organizationId: null,
  appId: null,
  readAt: null,
  seenAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
};

describe('StreamHub', () => {
  it('delivers to every stream a user has open', () => {
    const hub = new StreamHub(60_000, 5);
    const a = fakeRes();
    const b = fakeRes();
    hub.add('user-1', a);
    hub.add('user-1', b);

    hub.publish('user-1', notification);

    expect(a.frames.join('')).toContain('event: notification');
    expect(b.frames.join('')).toContain('"id":"n-1"');
    hub.closeAll();
  });

  it('never delivers one user’s notification to another', () => {
    const hub = new StreamHub(60_000, 5);
    const mine = fakeRes();
    const theirs = fakeRes();
    hub.add('user-1', mine);
    hub.add('user-2', theirs);

    hub.publish('user-1', notification);

    expect(mine.frames.length).toBe(1);
    expect(theirs.frames.length).toBe(0);
    hub.closeAll();
  });

  it('refuses a stream beyond the per-user cap', () => {
    const hub = new StreamHub(60_000, 2);
    expect(hub.add('user-1', fakeRes())).not.toBeNull();
    expect(hub.add('user-1', fakeRes())).not.toBeNull();

    // Without this bound a client stuck reconnecting can pin every socket.
    expect(hub.add('user-1', fakeRes())).toBeNull();
    expect(hub.countFor('user-1')).toBe(2);
    hub.closeAll();
  });

  it('drops a dead client without failing the rest of the publish', () => {
    const hub = new StreamHub(60_000, 5);
    const dead = fakeRes({ failWrite: true });
    const alive = fakeRes();
    hub.add('user-1', dead);
    hub.add('user-1', alive);

    expect(() => hub.publish('user-1', notification)).not.toThrow();

    expect(alive.frames.join('')).toContain('event: notification');
    expect(hub.countFor('user-1')).toBe(1);
    hub.closeAll();
  });

  it('frees the slot when a client disconnects', () => {
    const hub = new StreamHub(60_000, 1);
    const res = fakeRes();
    const client = hub.add('user-1', res)!;

    hub.remove(client);

    expect(hub.countFor('user-1')).toBe(0);
    expect(hub.add('user-1', fakeRes())).not.toBeNull();
    hub.closeAll();
  });

  it('publishing to a user with no stream is a no-op', () => {
    const hub = new StreamHub(60_000, 5);
    expect(() => hub.publish('nobody', notification)).not.toThrow();
    expect(hub.size).toBe(0);
  });

  it('closeAll ends every stream and empties the registry', () => {
    const hub = new StreamHub(60_000, 5);
    const a = fakeRes();
    hub.add('user-1', a);
    hub.add('user-2', fakeRes());

    hub.closeAll();

    expect(a.ended).toBe(true);
    expect(hub.size).toBe(0);
  });
});
