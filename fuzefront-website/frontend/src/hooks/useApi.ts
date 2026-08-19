/**
 * React hooks for API integration
 * Provides easy-to-use hooks for common API operations
 */

import { useState, useEffect, useCallback } from 'react';
import apiService, { 
  ApiError, 
  ContactFormData, 
  NewsletterData, 
  AnalyticsEvent
} from '../services/api';

const IS_DEVELOPMENT = import.meta.env.DEV || import.meta.env.NODE_ENV === 'development';

// Generic API hook type
interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  success: boolean;
}

// Generic API hook
export function useApi<T>(
  apiCall: () => Promise<T>, 
  dependencies: unknown[] = []
): UseApiState<T> & { refetch: () => Promise<void> } {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: true,
    error: null,
    success: false,
  });

  const fetchData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const data = await apiCall();
      setState({
        data,
        loading: false,
        error: null,
        success: true,
      });
    } catch (error) {
      if (IS_DEVELOPMENT) {
        console.error('API Error:', error);
      }
      setState({
        data: null,
        loading: false,
        error: error instanceof ApiError ? error.message : 'An unexpected error occurred',
        success: false,
      });
    }
  }, [apiCall, ...dependencies]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData,
  };
}

// Health check hook with interval and retry logic
export function useHealthCheck(intervalMs: number = 30000) {
  const [state, setState] = useState<UseApiState<unknown>>({
    data: null,
    loading: true,
    error: null,
    success: false,
  });

  const checkHealth = useCallback(async () => {
    try {
      const data = await apiService.health();
      setState({
        data,
        loading: false,
        error: null,
        success: true,
      });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof ApiError ? error.message : 'Health check failed',
        success: false,
      });
    }
  }, []);

  useEffect(() => {
    checkHealth();
    
    const interval = setInterval(checkHealth, intervalMs);
    return () => clearInterval(interval);
  }, [checkHealth, intervalMs]);

  return {
    ...state,
    refetch: checkHealth,
  };
}

// Contact form hook
export function useContactForm() {
  const [state, setState] = useState<UseApiState<unknown>>({
    data: null,
    loading: false,
    error: null,
    success: false,
  });

  const submitForm = useCallback(async (formData: ContactFormData) => {
    setState({ data: null, loading: true, error: null, success: false });
    
    try {
      const response = await apiService.submitContactForm(formData);
      setState({
        data: response,
        loading: false,
        error: null,
        success: true,
      });
      return response;
    } catch (error) {
      const errorMessage = error instanceof ApiError ? error.message : 'Failed to send message';
      setState({
        data: null,
        loading: false,
        error: errorMessage,
        success: false,
      });
      throw error;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null, success: false });
  }, []);

  return {
    ...state,
    submitForm,
    reset,
  };
}

// Newsletter hook
export function useNewsletter() {
  const [state, setState] = useState<UseApiState<unknown>>({
    data: null,
    loading: false,
    error: null,
    success: false,
  });

  const subscribe = useCallback(async (data: NewsletterData) => {
    setState({ data: null, loading: true, error: null, success: false });
    
    try {
      const response = await apiService.subscribeToNewsletter(data);
      setState({
        data: response,
        loading: false,
        error: null,
        success: true,
      });
      return response;
    } catch (error) {
      const errorMessage = error instanceof ApiError ? error.message : 'Failed to subscribe';
      setState({
        data: null,
        loading: false,
        error: errorMessage,
        success: false,
      });
      throw error;
    }
  }, []);

  const unsubscribe = useCallback(async (email: string) => {
    setState({ data: null, loading: true, error: null, success: false });
    
    try {
      const response = await apiService.unsubscribeFromNewsletter(email);
      setState({
        data: response,
        loading: false,
        error: null,
        success: true,
      });
      return response;
    } catch (error) {
      const errorMessage = error instanceof ApiError ? error.message : 'Failed to unsubscribe';
      setState({
        data: null,
        loading: false,
        error: errorMessage,
        success: false,
      });
      throw error;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null, success: false });
  }, []);

  return {
    ...state,
    subscribe,
    unsubscribe,
    reset,
  };
}

// Analytics hooks
export function useAnalytics() {
  const trackPageView = useCallback((page?: string, referrer?: string) => {
    const currentPage = page || apiService.getCurrentPage();
    const currentReferrer = referrer || apiService.getReferrer();
    const sessionId = sessionStorage.getItem('sessionId') || apiService.generateSessionId();
    
    // Store session ID
    sessionStorage.setItem('sessionId', sessionId);
    
    return apiService.trackPageView(currentPage, currentReferrer, sessionId);
  }, []);

  const trackEvent = useCallback((event: Omit<AnalyticsEvent, 'page' | 'sessionId'>) => {
    const sessionId = sessionStorage.getItem('sessionId') || apiService.generateSessionId();
    sessionStorage.setItem('sessionId', sessionId);
    
    return apiService.trackEvent({
      ...event,
      page: apiService.getCurrentPage(),
      sessionId,
    });
  }, []);

  return {
    trackPageView,
    trackEvent,
  };
}

// Analytics summary hook (for admin dashboard)
export function useAnalyticsSummary() {
  return useApi(() => apiService.getAnalyticsSummary());
}

// Newsletter stats hook (for admin dashboard)
export function useNewsletterStats() {
  return useApi(() => apiService.getNewsletterStats());
}

// Page analytics hook (for admin dashboard)
export function usePageAnalytics() {
  return useApi(() => apiService.getPageAnalytics());
}

// Auto page view tracking hook with debouncing
export function useAutoPageTracking() {
  const { trackPageView } = useAnalytics();
  const [hasTrackedInitial, setHasTrackedInitial] = useState(false);

  useEffect(() => {
    if (!hasTrackedInitial) {
      trackPageView().catch(err => IS_DEVELOPMENT && console.error(err));
      setHasTrackedInitial(true);
    }

    let timeoutId: number;
    const handleRouteChange = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        trackPageView().catch(err => IS_DEVELOPMENT && console.error(err));
      }, 500);
    };

    window.addEventListener('popstate', handleRouteChange);
    
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('popstate', handleRouteChange);
    };
  }, [trackPageView, hasTrackedInitial]);
}