"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.waitForPostgres = waitForPostgres;
exports.ensureDatabase = ensureDatabase;
exports.runMigrations = runMigrations;
exports.runSeeds = runSeeds;
exports.initializeDatabase = initializeDatabase;
exports.checkDatabaseHealth = checkDatabaseHealth;
exports.closeDatabase = closeDatabase;
const knex_1 = require("knex");
const path_1 = __importDefault(require("path"));
const pg_1 = require("pg");
// Database configuration based on environment
const getDatabaseConfig = () => {
    const isProduction = process.env.NODE_ENV === 'production';
    const usePostgres = process.env.USE_POSTGRES === 'true' || !isProduction;
    if (usePostgres) {
        // PostgreSQL configuration (shared infrastructure)
        return {
            client: 'pg',
            connection: {
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT || '5432'),
                database: process.env.DB_NAME || 'fuzefront_platform',
                user: process.env.DB_USER || 'postgres',
                password: process.env.DB_PASSWORD || 'postgres',
            },
            pool: {
                min: 2,
                max: 10,
            },
            migrations: {
                tableName: 'knex_migrations',
                directory: path_1.default.join(__dirname, isProduction ? '../migrations' : '../migrations'),
                extension: isProduction ? 'js' : 'ts',
            },
            seeds: {
                directory: path_1.default.join(__dirname, isProduction ? '../seeds' : '../seeds'),
            },
        };
    }
    else {
        // SQLite configuration (fallback)
        return {
            client: 'sqlite3',
            connection: {
                filename: path_1.default.join(__dirname, '../database.sqlite'),
            },
            useNullAsDefault: true,
            migrations: {
                tableName: 'knex_migrations',
                directory: path_1.default.join(__dirname, isProduction ? '../migrations' : '../migrations'),
                extension: isProduction ? 'js' : 'ts',
            },
            seeds: {
                directory: path_1.default.join(__dirname, isProduction ? '../seeds' : '../seeds'),
            },
        };
    }
};
// Create database instance
exports.db = (0, knex_1.knex)(getDatabaseConfig());
// Database initialization functions
async function waitForPostgres(maxRetries = 30, retryDelay = 2000) {
    console.log('🔍 Checking PostgreSQL availability...');
    for (let i = 0; i < maxRetries; i++) {
        try {
            const client = new pg_1.Client({
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT || '5432'),
                database: 'postgres', // Connect to default database first
                user: process.env.DB_USER || 'postgres',
                password: process.env.DB_PASSWORD || 'postgres',
            });
            await client.connect();
            await client.query('SELECT 1');
            await client.end();
            console.log('✅ PostgreSQL is ready!');
            return;
        }
        catch (error) {
            console.log(`⏳ Waiting for PostgreSQL... (attempt ${i + 1}/${maxRetries})`);
            if (i === maxRetries - 1) {
                throw new Error(`Failed to connect to PostgreSQL after ${maxRetries} attempts: ${error}`);
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
}
async function ensureDatabase() {
    console.log('🔧 Ensuring database exists...');
    const client = new pg_1.Client({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: 'postgres', // Connect to default database
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
    });
    try {
        await client.connect();
        // Check if database exists
        const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [process.env.DB_NAME || 'fuzefront_platform']);
        if (result.rows.length === 0) {
            console.log(`📦 Creating database "${process.env.DB_NAME || 'fuzefront_platform'}"...`);
            await client.query(`CREATE DATABASE "${process.env.DB_NAME || 'fuzefront_platform'}"`);
            console.log('✅ Database created successfully!');
        }
        else {
            console.log('✅ Database already exists');
        }
    }
    catch (error) {
        console.error('❌ Error ensuring database:', error);
        throw error;
    }
    finally {
        await client.end();
    }
}
async function runMigrations() {
    console.log('🚀 Running database migrations...');
    try {
        const [batchNo, log] = await exports.db.migrate.latest();
        if (log.length === 0) {
            console.log('✅ Database is already up to date');
        }
        else {
            console.log(`✅ Ran ${log.length} migration(s):`);
            log.forEach((migration) => {
                console.log(`  - ${migration}`);
            });
            console.log(`📦 Batch: ${batchNo}`);
        }
    }
    catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}
async function runSeeds() {
    console.log('🌱 Running database seeds...');
    try {
        const [log] = await exports.db.seed.run();
        if (log.length === 0) {
            console.log('✅ No seeds to run');
        }
        else {
            console.log(`✅ Ran ${log.length} seed(s):`);
            log.forEach((seed) => {
                console.log(`  - ${seed}`);
            });
        }
    }
    catch (error) {
        console.error('❌ Seeding failed:', error);
        throw error;
    }
}
async function initializeDatabase() {
    console.log('🔧 Initializing database...');
    try {
        // 1. Wait for PostgreSQL to be available
        await waitForPostgres();
        // 2. Ensure the database exists
        await ensureDatabase();
        // 3. Run migrations
        await runMigrations();
        // 4. Run seeds (only in development)
        if (process.env.NODE_ENV !== 'production') {
            await runSeeds();
        }
        console.log('✅ Database initialization complete!');
    }
    catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    }
}
async function checkDatabaseHealth() {
    try {
        await exports.db.raw('SELECT 1');
        return true;
    }
    catch (error) {
        console.error('❌ Database health check failed:', error);
        return false;
    }
}
async function closeDatabase() {
    try {
        await exports.db.destroy();
        console.log('🔌 Database connection closed');
    }
    catch (error) {
        console.error('❌ Error closing database:', error);
    }
}
exports.default = exports.db;
//# sourceMappingURL=database.js.map