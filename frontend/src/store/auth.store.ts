import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '../api';

interface AuthState {
  user:    User | null;
  token:   string | null;
  setAuth: (user: User, token: string) => void;
  clear:   () => void;
  isAuthenticated: boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user:  null,
      token: null,
      isAuthenticated: false,
      setAuth: (user, token) => {
        localStorage.setItem('sp_token', token);
        set({ user, token, isAuthenticated: true });
      },
      clear: () => {
        localStorage.removeItem('sp_token');
        set({ user: null, token: null, isAuthenticated: false });
      },
    }),
    { name: 'sp_auth', partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated }) },
  ),
);
