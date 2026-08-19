export interface Config {
  port: number;
  databaseUrl?: string;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || '3009', 10),
    databaseUrl: process.env.DATABASE_URL,
  };
}
