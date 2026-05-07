// 用户状态管理
// 处理登录、注册、用户信息、令牌管理

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { StoreKey } from "../constant";

export interface UserInfo {
  id: string;
  username: string;
  createdAt?: string;
}

interface UserState {
  token: string;
  user: UserInfo | null;
  isLoggedIn: boolean;

  // 操作
  setAuth: (token: string, user: UserInfo) => void;
  logout: () => void;
  getToken: () => string;
  fetchUser: () => Promise<void>;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      token: "",
      user: null,
      isLoggedIn: false,

      setAuth(token: string, user: UserInfo) {
        set({ token, user, isLoggedIn: true });
      },

      logout() {
        set({ token: "", user: null, isLoggedIn: false });
      },

      getToken() {
        return get().token;
      },

      async fetchUser() {
        const token = get().token;
        if (!token) return;

        try {
          const res = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (res.ok) {
            const data = await res.json();
            set({ user: data.user, isLoggedIn: true });
          } else {
            // 令牌无效，清除登录状态
            set({ token: "", user: null, isLoggedIn: false });
          }
        } catch {
          // 网络错误不清除登录状态，避免误登出
        }
      },
    }),
    {
      name: StoreKey.User,
      version: 1,
    },
  ),
);
