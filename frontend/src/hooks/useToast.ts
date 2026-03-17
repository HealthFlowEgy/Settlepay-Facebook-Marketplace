import { useState, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id:   number;
  msg:  string;
  type: ToastType;
}

let _id = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((msg: string, type: ToastType = 'info') => {
    const id = ++_id;
    setToasts(prev => [...prev, { id, msg, type }]);
    return id;
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const success = useCallback((msg: string) => show(msg, 'success'), [show]);
  const error   = useCallback((msg: string) => show(msg, 'error'),   [show]);
  const info    = useCallback((msg: string) => show(msg, 'info'),    [show]);
  const warning = useCallback((msg: string) => show(msg, 'warning'), [show]);

  return { toasts, show, dismiss, success, error, info, warning };
}
