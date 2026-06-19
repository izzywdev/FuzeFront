"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * FuzeFront DB bootstrap (privileged, run once per install/upgrade).
 *
 * This is the ONLY place that performs cluster-level provisioning. It is run by
 * the Helm `pre-install,pre-upgrade` Job (deploy/helm/fuzefront/templates/
 * db-bootstrap-job.yaml) connecting as the FuzeInfra Postgres SUPERUSER. It
 * idempotently:
 *   1. CREATE DATABASE <DB_NAME>            (if absent)
 *   2. CREATE ROLE <DB_USER> LOGIN PASSWORD (if absent; else sync password)
 *      as a least-privilege role (NOSUPERUSER NOCREATEDB NOCREATEROLE)
 *   3. GRANT CONNECT on the DB, and make <DB_USER> OWN the `public` schema so
 *      the runtime can run its own migrations (CREATE TABLE etc.) without any
 *      cluster-level privilege.
 *
 * Runtime (src/config/database.ts) connects as <DB_USER> and never does any of
 * the above — it only verifies the DB exists.
 *
 * Env:
 *   DB_HOST, DB_PORT                  target Postgres
 *   DB_NAME                           application database to provision
 *   DB_USER                           least-privilege runtime role to create
 *   DB_PASSWORD                       password for the runtime role (from Secret)
 *   DB_SUPERUSER, DB_SUPERUSER_PASSWORD  privileged bootstrap credentials
 *                                        (the FuzeInfra Postgres superuser)
 */
const pg_1 = require("pg");
function req(name) {
    const v = process.env[name];
    if (!v || v === 'undefined' || v === 'null') {
        throw new Error(`Missing required env var ${name} for DB bootstrap`);
    }
    return v;
}
// Quote a SQL identifier (e.g. role/db/schema name) safely.
function ident(name) {
    return '"' + name.replace(/"/g, '""') + '"';
}
// Quote a SQL string literal (e.g. a password).
function literal(value) {
    return "'" + value.replace(/'/g, "''") + "'";
}
async function bootstrap() {
    const host = process.env.DB_HOST || 'localhost';
    const port = parseInt(process.env.DB_PORT || '5432', 10);
    const dbName = req('DB_NAME');
    const appUser = req('DB_USER');
    const appPassword = req('DB_PASSWORD');
    const superUser = req('DB_SUPERUSER');
    const superPassword = req('DB_SUPERUSER_PASSWORD');
    console.log(`🔧 DB bootstrap: host=${host}:${port} db=${dbName} appUser=${appUser} superUser=${superUser}`);
    // --- Step 1 & 2: connect to the default DB to create DATABASE + ROLE. ---
    const admin = new pg_1.Client({
        host,
        port,
        user: superUser,
        password: superPassword,
        database: 'postgres',
    });
    await admin.connect();
    try {
        // Role first, so the database can be created or owned consistently.
        const roleExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
        if (roleExists.rows.length === 0) {
            console.log(`📝 Creating least-privilege role ${appUser}...`);
            await admin.query(`CREATE ROLE ${ident(appUser)} WITH LOGIN PASSWORD ${literal(appPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
        }
        else {
            console.log(`✅ Role ${appUser} exists — syncing password/attributes`);
            await admin.query(`ALTER ROLE ${ident(appUser)} WITH LOGIN PASSWORD ${literal(appPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
        }
        const dbExists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
        if (dbExists.rows.length === 0) {
            console.log(`📦 Creating database ${dbName}...`);
            try {
                // Note: do NOT set OWNER here. The bootstrap role only needs CREATEDB;
                // assigning ownership to another role would additionally require the
                // bootstrap role to be a member of that role (or a true superuser).
                // Least-privilege ownership is granted at the schema level below
                // (ALTER SCHEMA public OWNER), which is all the runtime needs.
                await admin.query(`CREATE DATABASE ${ident(dbName)}`);
            }
            catch (e) {
                // Concurrent bootstrap (e.g. retried Job) — treat duplicate as success.
                if (e?.code === '42P04' || e?.code === '23505') {
                    console.log('✅ Database already exists (created concurrently)');
                }
                else {
                    throw e;
                }
            }
        }
        else {
            console.log(`✅ Database ${dbName} exists`);
        }
        await admin.query(`GRANT CONNECT ON DATABASE ${ident(dbName)} TO ${ident(appUser)}`);
    }
    finally {
        await admin.end();
    }
    // --- Step 3: connect to the app DB to grant schema ownership. ---
    const dbAdmin = new pg_1.Client({
        host,
        port,
        user: superUser,
        password: superPassword,
        database: dbName,
    });
    await dbAdmin.connect();
    try {
        console.log(`🔑 Granting ${appUser} ownership of schema public...`);
        // To re-assign object ownership, the bootstrap role must be a member of the
        // target role (a true superuser is implicitly a member of every role, but
        // this also makes the script work when the bootstrap role is merely
        // CREATEDB+CREATEROLE). Idempotent.
        await dbAdmin.query(`GRANT ${ident(appUser)} TO CURRENT_USER`);
        // Owning the schema lets the runtime run its own migrations (CREATE TABLE,
        // sequences, etc.) without any cluster-level privilege.
        await dbAdmin.query(`ALTER SCHEMA public OWNER TO ${ident(appUser)}`);
        await dbAdmin.query(`GRANT ALL ON SCHEMA public TO ${ident(appUser)}`);
    }
    finally {
        await dbAdmin.end();
    }
    console.log('🎉 DB bootstrap complete');
}
bootstrap().catch(err => {
    console.error('❌ DB bootstrap failed:', err);
    process.exit(1);
});
//# sourceMappingURL=db-bootstrap.js.map