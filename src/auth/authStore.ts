import { create } from "zustand";
import { DEMO_PASSWORD, getDemoUserById, getDemoUserByUsername, type CurrentUser } from "@/auth/roles";

const STORAGE_KEY = "x-rag-current-user";

function readStoredUser(): CurrentUser | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Pick<CurrentUser, "id">;
    return getDemoUserById(parsed.id);
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function persistUser(user: CurrentUser | null) {
  if (typeof window === "undefined") return;

  if (user) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}

interface AuthState {
  currentUser: CurrentUser | null;
  loginAsUser: (userId: string) => CurrentUser | null;
  loginWithPassword: (username: string, password: string) => CurrentUser | null;
  switchRole: (userId: string) => CurrentUser | null;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: readStoredUser(),
  loginAsUser: (userId) => {
    const user = getDemoUserById(userId);
    if (!user) return null;
    persistUser(user);
    set({ currentUser: user });
    return user;
  },
  loginWithPassword: (username, password) => {
    const user = getDemoUserByUsername(username);
    if (!user || password !== DEMO_PASSWORD) return null;
    persistUser(user);
    set({ currentUser: user });
    return user;
  },
  switchRole: (userId) => get().loginAsUser(userId),
  logout: () => {
    persistUser(null);
    set({ currentUser: null });
  }
}));
