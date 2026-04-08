import { create } from "zustand";
import { login as apiLogin } from "../api/client";
import { LOCAL_STORAGE_TOKEN_KEY } from "../constants";

interface AuthState {
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY),

  login: async (username, password) => {
    const res = await apiLogin(username, password);
    localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, res.access_token);
    set({ token: res.access_token });
  },

  logout: () => {
    localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
    set({ token: null });
  },
}));
