export interface Config {
  port: number;
  kafka: {
    brokers: string[];
    clientId: string;
    groupId: string;
  };
  email: {
    provider: 'sendgrid' | 'smtp';
    from: string;
    sendgridApiKey?: string;
    smtp?: {
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      pass?: string;
    };
  };
}

export function loadConfig(): Config {
  const brokers = (process.env.KAFKA_BROKERS || 'fuzeinfra-kafka:9092')
    .split(',')
    .map((b) => b.trim());

  const provider = (process.env.EMAIL_PROVIDER || 'smtp') as 'sendgrid' | 'smtp';

  return {
    port: parseInt(process.env.PORT || '3003', 10),
    kafka: {
      brokers,
      clientId: process.env.KAFKA_CLIENT_ID || 'email-service',
      groupId: process.env.KAFKA_GROUP_ID || 'email-service-group',
    },
    email: {
      provider,
      from: process.env.EMAIL_FROM || 'noreply@fuzefront.com',
      sendgridApiKey: process.env.SENDGRID_API_KEY,
      smtp:
        provider === 'smtp'
          ? {
              host: process.env.SMTP_HOST || 'localhost',
              port: parseInt(process.env.SMTP_PORT || '1025', 10),
              secure: process.env.SMTP_SECURE === 'true',
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            }
          : undefined,
    },
  };
}
