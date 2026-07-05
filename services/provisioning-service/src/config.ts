export interface Config {
  port: number;
  kafka: {
    brokers: string[];
    clientId: string;
    groupId: string;
  };
  securityServiceUrl: string;
  internalProvisionSecret: string;
}

export function loadConfig(): Config {
  const brokers = process.env.KAFKA_BROKERS;
  if (!brokers) throw new Error('KAFKA_BROKERS is required');

  const securityServiceUrl = process.env.SECURITY_SERVICE_URL;
  if (!securityServiceUrl) throw new Error('SECURITY_SERVICE_URL is required');

  const internalProvisionSecret = process.env.INTERNAL_PROVISION_SECRET;
  if (!internalProvisionSecret) throw new Error('INTERNAL_PROVISION_SECRET is required');

  return {
    port: parseInt(process.env.PORT || '3005', 10),
    kafka: {
      brokers: brokers.split(',').map((b) => b.trim()),
      clientId: process.env.KAFKA_CLIENT_ID || 'provisioning-service',
      groupId: process.env.KAFKA_GROUP_ID || 'provisioning-service-group',
    },
    securityServiceUrl,
    internalProvisionSecret,
  };
}
