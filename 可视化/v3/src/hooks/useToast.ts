import { useState, useCallback } from 'react';

interface ToastState {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  isVisible: boolean;
  duration?: number;
}

export const useToast = () => {
  const [toast, setToast] = useState<ToastState>({
    message: '',
    type: 'info',
    isVisible: false,
    duration: 4000
  });

  const showToast = useCallback((
    message: string, 
    type: 'info' | 'success' | 'warning' | 'error' = 'info',
    duration: number = 4000
  ) => {
    setToast({
      message,
      type,
      isVisible: true,
      duration
    });
  }, []);

  const hideToast = useCallback(() => {
    setToast(prev => ({
      ...prev,
      isVisible: false
    }));
  }, []);

  const showInfo = useCallback((message: string, duration?: number) => {
    showToast(message, 'info', duration);
  }, [showToast]);

  const showSuccess = useCallback((message: string, duration?: number) => {
    showToast(message, 'success', duration);
  }, [showToast]);

  const showWarning = useCallback((message: string, duration?: number) => {
    showToast(message, 'warning', duration);
  }, [showToast]);

  const showError = useCallback((message: string, duration?: number) => {
    showToast(message, 'error', duration);
  }, [showToast]);

  return {
    toast,
    showToast,
    hideToast,
    showInfo,
    showSuccess,
    showWarning,
    showError
  };
};
