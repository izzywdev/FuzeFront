/**
 * React hooks for API integration
 * Provides easy-to-use hooks for common API operations
 */

import { useState, useEffect, useCallback } from 'react';
import apiService, { 
  ApiError, 
  ContactFormData, 
  NewsletterData, 
  AnalyticsEvent,
  AnalyticsSummary 
} from '../services/api';

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
  dependencies: any[] = []
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
      console.error('API Error:', error);
      setState({
        data: null,
        loading: false,
        error: error instanceof ApiError ? error.message : 'An unexpected error occurred',
        success: false,
      });
    }
  }, dependencies);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData,
  };
}

// Health check hook
export function useHealthCheck() {
  return useApi(() => apiService.health());
}

// Contact form hook
export function useContactForm() {
  const [state, setState] = useState<UseApiState<any>>({
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
  const [state, setState] = useState<UseApiState<any>>({
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

// Auto page view tracking hook
export function useAutoPageTracking() {
  const { trackPageView } = useAnalytics();

  useEffect(() => {
    // Track page view on mount
    trackPageView().catch(console.error);

    // Track page view on route changes (if using React Router)
    const handleRouteChange = () => {
      setTimeout(() => {
        trackPageView().catch(console.error);
      }, 100);
    };

    // Listen for popstate events (back/forward navigation)
    window.addEventListener('popstate', handleRouteChange);
    
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
    };
  }, [trackPageView]);
}