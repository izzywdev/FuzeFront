/**
 * API Service for FuzeFront Website
 * Handles all backend API calls with proper error handling and types
 */

/// <reference lib="dom" />

// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Request configuration
const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
};

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  timestamp?: string;
  data?: T;
  error?: string;
  details?: unknown[];
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  environment: string;
  version: string;
}

export interface ContactFormData {
  name: string;
  email: string;
  company?: string;
  subject: string;
  message: string;
  phone?: string;
  interest?: 'platform' | 'infrastructure' | 'consultation' | 'partnership' | 'other';
}

export interface NewsletterData {
  email: string;
  name?: string;
  interests?: Array<'platform' | 'infrastructure' | 'updates' | 'blog' | 'events'>;
}

export interface AnalyticsEvent {
  event: string;
  page: string;
  timestamp?: string;
  sessionId?: string;
  properties?: Record<string, unknown>;
}

export interface AnalyticsSummary {
  totalEvents: number;
  pageViews: number;
  customEvents: number;
  uniquePages: number;
  recentEvents: unknown[];
  timestamp: string;
}

// Error Types
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// HTTP Client
class HttpClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: globalThis.RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const config: globalThis.RequestInit = {
      headers: {
        ...DEFAULT_HEADERS,
        ...options.headers,
      },
      ...options,
    };

    try {
      console.log(`🌐 API Request: ${config.method || 'GET'} ${url}`);
      
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        console.error(`❌ API Error: ${response.status}`, data);
        throw new ApiError(
          data.error || data.message || 'Request failed',
          response.status,
          data
        );
      }

      console.log(`✅ API Success: ${config.method || 'GET'} ${url}`, data);
      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      console.error(`🚨 Network Error: ${url}`, error);
      throw new ApiError(
        'Network error. Please check your connection and try again.',
        0,
        { originalError: error }
      );
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

// Create HTTP client instance
const httpClient = new HttpClient(API_BASE_URL);

// API Service Functions
export const apiService = {
  // Health Check
  async health(): Promise<HealthResponse> {
    return httpClient.get<HealthResponse>('/health');
  },

  // Contact Form
  async submitContactForm(data: ContactFormData): Promise<ApiResponse> {
    return httpClient.post<ApiResponse>('/api/contact/submit', data);
  },

  // Newsletter
  async subscribeToNewsletter(data: NewsletterData): Promise<ApiResponse> {
    return httpClient.post<ApiResponse>('/api/newsletter/subscribe', data);
  },

  async unsubscribeFromNewsletter(email: string): Promise<ApiResponse> {
    return httpClient.post<ApiResponse>('/api/newsletter/unsubscribe', { email });
  },

  async getNewsletterStats(): Promise<{ totalSubscribers: number; timestamp: string }> {
    return httpClient.get('/api/newsletter/stats');
  },

  // Analytics
  async trackPageView(page: string, referrer?: string, sessionId?: string): Promise<ApiResponse> {
    return httpClient.post<ApiResponse>('/api/analytics/page-view', {
      page,
      referrer,
      sessionId,
    });
  },

  async trackEvent(event: AnalyticsEvent): Promise<ApiResponse> {
    return httpClient.post<ApiResponse>('/api/analytics/event', event);
  },

  async getAnalyticsSummary(): Promise<AnalyticsSummary> {
    return httpClient.get<AnalyticsSummary>('/api/analytics/summary');
  },

  async getPageAnalytics(): Promise<{
    pages: Array<{ page: string; views: number }>;
    totalPageViews: number;
    timestamp: string;
  }> {
    return httpClient.get('/api/analytics/pages');
  },

  // Utility Functions
  generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },

  getCurrentPage(): string {
    return window.location.pathname;
  },

  getReferrer(): string {
    return document.referrer || 'direct';
  },
};

// Export everything
export default apiService;