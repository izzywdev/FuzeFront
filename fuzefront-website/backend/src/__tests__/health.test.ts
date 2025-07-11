import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

// Simple health check test
describe('Health Check', () => {
  let app: express.Application;
  
  beforeAll(() => {
    app = express();
    app.use(helmet());
    app.use(cors());
    app.use(compression());
    app.use(express.json());
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: 'fuzefront-website-backend'
      });
    });
  });
  
  it('should return health status', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);
    
    expect(response.body).toMatchObject({
      status: 'healthy',
      service: 'fuzefront-website-backend'
    });
    expect(response.body.timestamp).toBeDefined();
    expect(response.body.uptime).toBeDefined();
  });
  
  it('should include security headers', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);
    
    expect(response.headers).toHaveProperty('x-content-type-options');
    expect(response.headers).toHaveProperty('x-frame-options');
  });
});

// Basic API validation test
describe('API Validation', () => {
  let app: express.Application;
  
  beforeAll(() => {
    app = express();
    app.use(helmet());
    app.use(cors());
    app.use(express.json());
    
    // Simple validation endpoint
    app.post('/api/test', (req, res) => {
      const { email } = req.body;
      
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email is required' });
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      
      res.json({ success: true, message: 'Valid email' });
    });
  });
  
  it('should reject invalid email', async () => {
    const response = await request(app)
      .post('/api/test')
      .send({ email: 'invalid-email' })
      .expect(400);
    
    expect(response.body).toHaveProperty('error', 'Invalid email format');
  });
  
  it('should accept valid email', async () => {
    const response = await request(app)
      .post('/api/test')
      .send({ email: 'test@example.com' })
      .expect(200);
    
    expect(response.body).toHaveProperty('success', true);
  });
  
  it('should reject missing email', async () => {
    const response = await request(app)
      .post('/api/test')
      .send({})
      .expect(400);
    
    expect(response.body).toHaveProperty('error', 'Email is required');
  });
});

// Rate limiting test
describe('Rate Limiting', () => {
  let app: express.Application;
  
  beforeAll(() => {
    app = express();
    
    // Simple rate limiter - very permissive for testing
    const limiter = rateLimit({
      windowMs: 1000, // 1 second
      max: 2, // 2 requests per second
      message: { error: 'Too many requests' }
    });
    
    app.use('/api/', limiter);
    app.use(express.json());
    
    app.get('/api/test', (req, res) => {
      res.json({ success: true });
    });
  });
  
  it('should allow normal requests', async () => {
    const response = await request(app)
      .get('/api/test')
      .expect(200);
    
    expect(response.body).toHaveProperty('success', true);
  });
  
  it('should enforce rate limits', async () => {
    // Make multiple requests quickly to trigger rate limit
    const requests = [];
    for (let i = 0; i < 5; i++) {
      requests.push(request(app).get('/api/test'));
    }
    
    const responses = await Promise.all(requests);
    
    // At least one should be rate limited
    const rateLimitedResponses = responses.filter(r => r.status === 429);
    expect(rateLimitedResponses.length).toBeGreaterThan(0);
  });
});