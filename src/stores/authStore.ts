import { create } from "zustand";
import { login as apiLogin } from "../api/client";

interface AuthState {
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("token"),

  login: async (username, password) => {
    const res = await apiLogin(username, password);
    localStorage.setItem("token", res.access_token);
    set({ token: res.access_token });
  },

  logout: () => {
    localStorage.removeItem("token");
    set({ token: null });
  },
}));
