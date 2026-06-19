import express, { Application, Request, Response } from 'express';

export function createApp(): Application {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'provisioning-service' });
  });

  return app;
}
