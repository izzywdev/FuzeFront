// bootstrap.ts — CLI entrypoint for the chat-db-bootstrap Job.
//
// #499 follow-up (decoupling): chat-service used to have its dedicated
// `fuzefront_chat` database created by the CENTRAL fuzefront-db-bootstrap Job
// via its EXTRA_DATABASES mechanism (backend/src/scripts/db-bootstrap.ts +
// deploy/helm/fuzefront/templates/db-bootstrap-job.yaml). That meant the
// central/backend bootstrap had to know chat-service's database name — the
// exact cross-service coupling the platform is moving away from ("each
// microservice owns its own db-bootstrap script, so the microservices are
// unaware of each other").
//
// This script is chat-service's OWN privileged, idempotent provisioning step.
// It connects as the FuzeInfra Postgres SUPERUSER (never the runtime role) and:
//   1. CREATE DATABASE <DB_NAME>  (if absent) — chat's own `fuzefront_chat`.
//   2. GRANT CONNECT on it to the runtime role <DB_USER> (fuzefront_user).
//   3. ALTER DATABASE ... OWNER TO <DB_USER>, so chat can create its own
//      schemas the same way Authentik's extra-DB path always could.
//   4. ALTER SCHEMA public OWNER TO <DB_USER> (+ GRANT ALL), so the chat-
//      db-migrate Job (which connects as the runtime role) can run its knex
//      migrations without any cluster-level privilege.
//
// Deliberately does NOT create the <DB_USER> role itself — that role is the
// shared least-privilege runtime role already created by the central
// fuzefront-db-bootstrap Job (hook-weight -5, before this Job's -4). Owning
// the *database* is what decouples chat; owning the *role* is a separate,
// not-yet-done follow-up (see db-bootstrap-job.yaml's TODO on authentik).
//
// Invoked by the Helm `chat-db-bootstrap` pre-install/pre-upgrade hook as
// `node dist/db/bootstrap.js`, BEFORE chat-db-migrate (see hook-weight
// ordering in templates/chat-db-bootstrap-job.yaml /
// templates/chat-db-migrate-job.yaml).
//
// Env:
//   DB_HOST, DB_PORT                    target Postgres
//   DB_NAME                             chat's own database (chatService.dbName)
//   DB_USER                             least-privilege runtime role (must already exist)
//   DB_SUPERUSER, DB_SUPERUSER_PASSWORD privileged bootstrap credentials

import { Client } from 'pg';

function req(name: string): string {
  const v = process.env[name];
  if (!v || v === 'undefined' || v === 'null') {
    throw new Error(`Missing required env var ${name} for chat DB bootstrap`);
  }
  return v;
}

// Quote a SQL identifier (e.g. role/db/schema name) safely.
function ident(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export async function bootstrap(): Promise<void> {
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '5432', 10);
  const dbName = req('DB_NAME');
  const appUser = req('DB_USER');
  const superUser = req('DB_SUPERUSER');
  const superPassword = req('DB_SUPERUSER_PASSWORD');

  // eslint-disable-next-line no-console
  console.log(
    `[chat-db-bootstrap] host=${host}:${port} db=${dbName} appUser=${appUser} superUser=${superUser}`
  );

  // --- Step 1: connect to the default DB to create the database if absent. ---
  const admin = new Client({
    host,
    port,
    user: superUser,
    password: superPassword,
    database: 'postgres',
  });
  await admin.connect();
  try {
    const roleExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
    if (roleExists.rows.length === 0) {
      // The shared runtime role should already exist (created by the central
      // fuzefront-db-bootstrap Job, which runs at a lower hook-weight). If it
      // doesn't, fail loudly rather than silently degrading — chat cannot
      // grant ownership to a role that doesn't exist.
      throw new Error(
        `Runtime role ${appUser} does not exist. Expected the central db-bootstrap ` +
          'Job (hook-weight -5) to have created it before this Job (-4) runs.'
      );
    }

    const dbExists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (dbExists.rows.length === 0) {
      // eslint-disable-next-line no-console
      console.log(`[chat-db-bootstrap] creating database ${dbName}...`);
      try {
        await admin.query(`CREATE DATABASE ${ident(dbName)}`);
      } catch (e: any) {
        // Concurrent bootstrap (e.g. retried Job) — treat duplicate as success.
        if (e?.code === '42P04' || e?.code === '23505') {
          // eslint-disable-next-line no-console
          console.log('[chat-db-bootstrap] database already exists (created concurrently)');
        } else {
          throw e;
        }
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(`[chat-db-bootstrap] database ${dbName} exists`);
    }

    await admin.query(`GRANT CONNECT ON DATABASE ${ident(dbName)} TO ${ident(appUser)}`);
    // Make the app role OWN the database (not just the public schema) so chat
    // can create its own schemas if it ever needs to, mirroring how the
    // central bootstrap treats Authentik's extra database.
    await admin.query(`ALTER DATABASE ${ident(dbName)} OWNER TO ${ident(appUser)}`);
  } finally {
    await admin.end();
  }

  // --- Step 2: connect to chat's own DB to grant schema ownership. ---
  const dbAdmin = new Client({
    host,
    port,
    user: superUser,
    password: superPassword,
    database: dbName,
  });
  await dbAdmin.connect();
  try {
    // eslint-disable-next-line no-console
    console.log(`[chat-db-bootstrap] granting ${appUser} ownership of ${dbName}.public...`);
    // To re-assign object ownership, the bootstrap role must be a member of
    // the target role (a true superuser is implicitly a member of every
    // role). Idempotent.
    await dbAdmin.query(`GRANT ${ident(appUser)} TO CURRENT_USER`);
    await dbAdmin.query(`ALTER SCHEMA public OWNER TO ${ident(appUser)}`);
    await dbAdmin.query(`GRANT ALL ON SCHEMA public TO ${ident(appUser)}`);
  } finally {
    await dbAdmin.end();
  }

  // eslint-disable-next-line no-console
  console.log('[chat-db-bootstrap] complete');
}

// Only self-execute as a CLI, so tests can import `bootstrap` without side effects.
if (require.main === module) {
  bootstrap()
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[chat-db-bootstrap] failed:', err);
      // Fail loudly and non-zero: this is a pre-upgrade hook, so a silent
      // success here would let chat-db-migrate (and then chat-service) run
      // against a database that was never actually created/owned correctly.
      process.exit(1);
    });
}
