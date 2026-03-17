import { useState, useEffect, useCallback } from 'react';
import { dealsApi } from '../api';
import { Deal } from '../types';

const POLLING_STATUSES = [
  'AWAITING_BUYER_CONFIRMATION',
  'ESCROW_DEDUCTING',
  'SETTLING',
  'REFUNDING',
];

export function useDeal(dealId: string | null, pollInterval = 5000) {
  const [deal, setDeal]       = useState<Deal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!dealId) return;
    try {
      const res = await dealsApi.get(dealId);
      setDeal(res.data);
      setError(null);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load deal');
    }
  }, [dealId]);

  // Initial load
  useEffect(() => {
    if (!dealId) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [dealId, refresh]);

  // Auto-poll for in-progress states
  useEffect(() => {
    if (!deal || !POLLING_STATUSES.includes(deal.status)) return;
    const interval = setInterval(refresh, pollInterval);
    return () => clearInterval(interval);
  }, [deal?.status, refresh, pollInterval]);

  return { deal, loading, error, refresh };
}

export function useDeals(role: 'buyer' | 'seller', filter?: string) {
  const [deals, setDeals]     = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await dealsApi.list(role, filter);
      setDeals(res.data);
      setError(null);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load deals');
    }
  }, [role, filter]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return { deals, loading, error, refresh };
}
