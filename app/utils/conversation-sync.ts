// 对话数据同步工具
// 将对话数据同步到 PostgreSQL 数据库

import { useUserStore } from "../store/user";

// 防抖定时器
let syncTimer: ReturnType<typeof setTimeout> | null = null;

// 同步单个对话到数据库
export async function syncConversationToDB(session: any) {
  const userStore = useUserStore.getState();
  if (!userStore.isLoggedIn || !userStore.token) return;

  try {
    await fetch("/api/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userStore.token}`,
      },
      body: JSON.stringify({
        id: session.id,
        topic: session.topic,
        messages: session.messages,
        mask: session.mask,
        memoryPrompt: session.memoryPrompt,
        lastUpdate: session.lastUpdate,
      }),
    });
  } catch (error) {
    console.error("[Sync] Failed to sync conversation:", error);
  }
}

// 防抖同步当前对话
export function debouncedSyncCurrentSession(session: any) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncConversationToDB(session);
  }, 2000); // 2 秒防抖
}

// 删除数据库中的对话
export async function deleteConversationFromDB(sessionId: string) {
  const userStore = useUserStore.getState();
  if (!userStore.isLoggedIn || !userStore.token) return;

  try {
    await fetch(`/api/conversations/${sessionId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${userStore.token}`,
      },
    });
  } catch (error) {
    console.error("[Sync] Failed to delete conversation:", error);
  }
}

// 从数据库加载用户所有对话
export async function loadConversationsFromDB(): Promise<any[]> {
  const userStore = useUserStore.getState();
  if (!userStore.isLoggedIn || !userStore.token) return [];

  try {
    const res = await fetch("/api/conversations", {
      headers: {
        Authorization: `Bearer ${userStore.token}`,
      },
    });

    if (!res.ok) return [];

    const data = await res.json();
    return data.conversations || [];
  } catch (error) {
    console.error("[Sync] Failed to load conversations:", error);
    return [];
  }
}

// 从数据库加载单个对话详情（含消息）
export async function loadConversationDetail(
  sessionId: string,
): Promise<any | null> {
  const userStore = useUserStore.getState();
  if (!userStore.isLoggedIn || !userStore.token) return null;

  try {
    const res = await fetch(`/api/conversations/${sessionId}`, {
      headers: {
        Authorization: `Bearer ${userStore.token}`,
      },
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.conversation || null;
  } catch (error) {
    console.error("[Sync] Failed to load conversation detail:", error);
    return null;
  }
}
