// 对话数据同步工具
// 将对话数据同步到 PostgreSQL 数据库，支持从数据库加载和合并

import { useUserStore } from "../store/user";

function isEmptyStreamingAssistant(message: any) {
  return (
    message?.role === "assistant" &&
    message?.streaming &&
    !message?.content &&
    !message?.tools?.length
  );
}

function getPersistableMessages(session: any) {
  return (session.messages || [])
    .filter((message: any) => !isEmptyStreamingAssistant(message))
    .map((message: any) => {
      // 剥离 stream 标记和大文件提取文本，避免超过 Vercel 4.5MB 请求体限制
      const { streaming, fileContent, ...persistableMessage } = message;
      return persistableMessage;
    });
}

// 同步单个对话到数据库
export async function syncConversationToDB(session: any) {
  const userStore = useUserStore.getState();
  if (!userStore.isLoggedIn || !userStore.token) return false;

  try {
    const response = await fetch("/api/conversations", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userStore.token}`,
      },
      body: JSON.stringify({
        id: session.id,
        topic: session.topic,
        messages: getPersistableMessages(session),
        mask: session.mask,
        memoryPrompt: session.memoryPrompt,
        lastUpdate: session.lastUpdate,
        lastSummarizeIndex: session.lastSummarizeIndex,
        clearContextIndex: session.clearContextIndex,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("[Sync] Conversation sync rejected:", {
        status: response.status,
        detail,
      });
      return false;
    }
    return true;
  } catch (error) {
    console.error("[Sync] Failed to sync conversation:", error);
    return false;
  }
}

// 删除数据库中的对话
export async function deleteConversationFromDB(sessionId: string) {
  const userStore = useUserStore.getState();
  if (!userStore.isLoggedIn || !userStore.token) return;

  try {
    await fetch(`/api/conversations/${sessionId}`, {
      method: "DELETE",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${userStore.token}`,
      },
    });
  } catch (error) {
    console.error("[Sync] Failed to delete conversation:", error);
  }
}

// 从数据库加载用户所有对话（仅元数据，不含消息）
export async function loadConversationsFromDB(): Promise<any[]> {
  const userStore = useUserStore.getState();
  if (!userStore.isLoggedIn || !userStore.token) return [];

  try {
    const res = await fetch("/api/conversations", {
      cache: "no-store",
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
      cache: "no-store",
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

// 将数据库中的消息 content 字段还原为原始类型
// 存库时 MultimodalContent[] 被 JSON.stringify，加载时需反序列化
function parseMessageContent(content: string): string | any[] {
  if (!content) return content;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return content;
}

// 从数据库加载用户所有对话（含完整消息），返回 ChatSession 数组
export async function loadAllConversationsFromDB(): Promise<any[]> {
  const userStore = useUserStore.getState();
  if (!userStore.isLoggedIn || !userStore.token) return [];

  try {
    // 获取对话列表
    const listRes = await fetch("/api/conversations", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${userStore.token}` },
    });
    if (!listRes.ok) return [];

    const listData = await listRes.json();
    const conversations = listData.conversations || [];
    if (conversations.length === 0) return [];

    // 并行加载每个对话的详情（含消息）
    const sessions = await Promise.all(
      conversations.map(async (conv: any) => {
        try {
          const detailRes = await fetch(`/api/conversations/${conv.id}`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${userStore.token}` },
          });
          if (!detailRes.ok) return null;

          const detailData = await detailRes.json();
          const c = detailData.conversation;

          return {
            id: c.id,
            topic: c.topic || "新的聊天",
            memoryPrompt: c.memoryPrompt || "",
            messages: (c.messages || []).map((m: any) => ({
              id: m.id,
              role: m.role,
              content: parseMessageContent(m.content),
              date: m.date,
              isError: m.isError || false,
              model: m.model,
              tools: m.tools,
              fileContent: m.fileContent,
              streaming: false,
            })),
            stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
            lastUpdate: c.lastUpdate || Date.now(),
            lastSummarizeIndex: c.lastSummarizeIndex || 0,
            clearContextIndex: c.clearContextIndex || undefined,
            mask: c.maskConfig || null,
          };
        } catch {
          return null;
        }
      }),
    );

    return sessions.filter(Boolean);
  } catch (error) {
    console.error("[Sync] Failed to load all conversations:", error);
    return [];
  }
}
