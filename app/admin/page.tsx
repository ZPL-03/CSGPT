"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useUserStore } from "../store/user";

interface UserItem {
  id: string;
  username: string;
  createdAt: string;
  conversationCount: number;
}

interface ConversationItem {
  id: string;
  topic: string;
  userId: string;
  username: string;
  lastUpdate: string;
  messageCount: number;
}

interface MessageItem {
  id: string;
  role: string;
  content: string;
  date: string;
  isError: boolean;
  model: string;
}

interface Stats {
  users: number;
  userList: UserItem[];
  conversations: number;
  conversationList: ConversationItem[];
  messages: number;
  dbSize: string;
  dataSize: string;
}

type TabKey = "overview" | "users" | "conversations";

// 管理后台登录表单
function AdminLogin() {
  const userStore = useUserStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim()) {
      setError("用户名不能为空");
      return;
    }
    if (!password) {
      setError("密码不能为空");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "登录失败");
        return;
      }
      userStore.setAuth(data.token, data.user);
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={CENTER_STYLE}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: "var(--disabled-background)",
          padding: 32,
          borderRadius: 12,
          width: 340,
        }}
      >
        <div
          style={{
            textAlign: "center",
            marginBottom: 16,
            fontSize: 36,
            fontWeight: 700,
          }}
        >
          CSGPT
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 20, textAlign: "center" }}>
          CSGPT 管理后台
        </h2>
        <p
          style={{
            margin: "0 0 20px",
            fontSize: 14,
            color: "var(--secondary-text)",
            textAlign: "center",
          }}
        >
          请使用管理员账号登录
        </p>
        <input
          type="text"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError("");
          }}
          placeholder="用户名"
          autoFocus
          style={INPUT_STYLE}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          placeholder="密码"
          style={INPUT_STYLE}
        />
        {error && (
          <p
            style={{
              color: "#e53e3e",
              fontSize: 13,
              margin: "0 0 12px",
              textAlign: "center",
            }}
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading || !username || !password}
          style={{
            width: "100%",
            padding: "8px 0",
            borderRadius: 6,
            border: "none",
            background: "var(--foreground-color)",
            color: "var(--background-color)",
            fontSize: 14,
            cursor: "pointer",
            opacity: loading ? 0.6 : 1,
            boxSizing: "border-box",
          }}
        >
          {loading ? "登录中..." : "登录"}
        </button>
      </form>
    </div>
  );
}

const CENTER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  background: "var(--background-color)",
  color: "var(--foreground-color)",
  fontFamily: "system-ui, sans-serif",
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  marginBottom: 12,
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid var(--border-color)",
  background: "var(--background-color)",
  color: "var(--foreground-color)",
  fontSize: 14,
  boxSizing: "border-box",
};

const CARD_STYLE: React.CSSProperties = {
  background: "var(--disabled-background)",
  borderRadius: 10,
  padding: 20,
};

const TAB_STYLE: React.CSSProperties = {
  padding: "8px 20px",
  borderRadius: 6,
  border: "none",
  fontSize: 14,
  cursor: "pointer",
  background: "transparent",
  color: "var(--foreground-color)",
};

const TAB_ACTIVE_STYLE: React.CSSProperties = {
  ...TAB_STYLE,
  background: "var(--foreground-color)",
  color: "var(--background-color)",
};

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString("zh-CN");
  } catch {
    return dateStr;
  }
}

export default function AdminPage() {
  const userStore = useUserStore();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "user" | "conversation";
    id: string;
    name: string;
  } | null>(null);

  // 对话消息查看
  const [expandedConvId, setExpandedConvId] = useState<string | null>(null);
  const [convMessages, setConvMessages] = useState<MessageItem[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const fetchStats = useCallback(async () => {
    const token = userStore.token;
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.status === 401) {
        setIsAdmin(false);
        return;
      }
      if (!res.ok) {
        setError(data.error || data.detail || "获取数据失败");
        setIsAdmin(false);
        return;
      }
      setStats(data);
      setIsAdmin(true);
    } catch {
      setError("网络错误，请检查网络连接后刷新页面");
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  }, [userStore.token]);

  useEffect(() => {
    if (userStore.isLoggedIn && userStore.token) {
      fetchStats();
    }
  }, [userStore.isLoggedIn, userStore.token, fetchStats]);

  async function fetchConvMessages(convId: string) {
    const token = userStore.token;
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/admin/stats?id=${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "获取消息失败");
        return;
      }
      setConvMessages(data.messages || []);
    } catch {
      setError("获取对话消息失败");
    } finally {
      setLoadingMessages(false);
    }
  }

  function toggleConversation(convId: string) {
    if (expandedConvId === convId) {
      setExpandedConvId(null);
      setConvMessages([]);
    } else {
      setExpandedConvId(convId);
      setConvMessages([]);
      fetchConvMessages(convId);
    }
  }

  async function handleDelete(type: "user" | "conversation", id: string) {
    const token = userStore.token;
    setError("");
    try {
      const res = await fetch(`/api/admin/stats?type=${type}&id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "删除失败");
        return;
      }
      setDeleteConfirm(null);
      if (expandedConvId === id) {
        setExpandedConvId(null);
        setConvMessages([]);
      }
      fetchStats();
    } catch {
      setError("网络错误");
    }
  }

  // 未登录
  if (!userStore.isLoggedIn) {
    return <AdminLogin />;
  }

  // 加载中或权限检查中
  if (isAdmin === null) {
    return (
      <div style={CENTER_STYLE}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 16, marginBottom: 12 }}>
            {loading ? "加载中..." : "验证中..."}
          </p>
          {error && (
            <p
              style={{
                color: "#e53e3e",
                fontSize: 13,
                margin: "0 0 16px",
                maxWidth: 300,
              }}
            >
              {error}
            </p>
          )}
          {(error || !loading) && (
            <button
              onClick={fetchStats}
              style={{
                padding: "6px 20px",
                borderRadius: 6,
                border: "1px solid var(--border-color)",
                background: "transparent",
                color: "var(--foreground-color)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              重试
            </button>
          )}
        </div>
      </div>
    );
  }

  // 非管理员
  if (!isAdmin) {
    return (
      <div style={CENTER_STYLE}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ marginBottom: 12, fontSize: 22 }}>无访问权限</h2>
          {error && (
            <p
              style={{
                color: "#e53e3e",
                fontSize: 13,
                marginBottom: 16,
                maxWidth: 400,
              }}
            >
              {error}
            </p>
          )}
          <p
            style={{
              color: "var(--secondary-text)",
              fontSize: 14,
              marginBottom: 20,
            }}
          >
            当前账号不是管理员，无法访问管理后台
          </p>
          <button
            onClick={() => {
              userStore.logout();
              window.location.href = "/";
            }}
            style={{
              padding: "8px 24px",
              borderRadius: 6,
              border: "1px solid var(--border-color)",
              background: "transparent",
              color: "var(--foreground-color)",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "概览" },
    { key: "users", label: "用户管理" },
    { key: "conversations", label: "对话管理" },
  ];

  // 删除确认弹窗
  function renderDeleteConfirm() {
    if (!deleteConfirm) return null;
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}
        onClick={() => setDeleteConfirm(null)}
      >
        <div
          style={{
            background: "var(--background-color)",
            padding: 24,
            borderRadius: 12,
            maxWidth: 400,
            width: "90%",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>确认删除</h3>
          <p
            style={{
              margin: "0 0 20px",
              fontSize: 14,
              color: "var(--secondary-text)",
            }}
          >
            {deleteConfirm.type === "user"
              ? `确定要删除用户「${deleteConfirm.name}」及其所有数据吗？此操作不可撤销。`
              : `确定要删除对话「${deleteConfirm.name}」吗？此操作不可撤销。`}
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button
              onClick={() => setDeleteConfirm(null)}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                border: "1px solid var(--border-color)",
                background: "transparent",
                color: "var(--foreground-color)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              取消
            </button>
            <button
              onClick={() => handleDelete(deleteConfirm.type, deleteConfirm.id)}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                border: "none",
                background: "#e53e3e",
                color: "#fff",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              确认删除
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderOverview() {
    const cards = [
      { label: "注册用户", value: stats?.users },
      { label: "对话总数", value: stats?.conversations },
      { label: "消息总数", value: stats?.messages },
      { label: "数据库大小", value: stats?.dbSize },
      { label: "数据大小", value: stats?.dataSize },
    ];
    return (
      <div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 16,
            marginBottom: 32,
          }}
        >
          {cards.map((c) => (
            <div key={c.label} style={CARD_STYLE}>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--secondary-text)",
                  marginBottom: 8,
                }}
              >
                {c.label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {loading ? "..." : c.value ?? "-"}
              </div>
            </div>
          ))}
        </div>

        {/* 最近用户 */}
        <div style={{ ...CARD_STYLE, marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>最近注册用户</h3>
          {stats?.userList && stats.userList.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    fontSize: 13,
                    color: "var(--secondary-text)",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  <th style={{ padding: "8px 0", fontWeight: 500 }}>用户名</th>
                  <th style={{ padding: "8px 0", fontWeight: 500 }}>对话数</th>
                  <th style={{ padding: "8px 0", fontWeight: 500 }}>
                    注册时间
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.userList.slice(0, 10).map((u) => (
                  <tr
                    key={u.id}
                    style={{
                      fontSize: 14,
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    <td style={{ padding: "10px 0" }}>{u.username}</td>
                    <td style={{ padding: "10px 0" }}>{u.conversationCount}</td>
                    <td style={{ padding: "10px 0" }}>
                      {formatDate(u.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: 14, color: "var(--secondary-text)" }}>
              暂无注册用户
            </p>
          )}
        </div>

        {/* 最近对话 */}
        <div style={CARD_STYLE}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>最近对话</h3>
          {stats?.conversationList && stats.conversationList.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    fontSize: 13,
                    color: "var(--secondary-text)",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  <th style={{ padding: "8px 0", fontWeight: 500 }}>主题</th>
                  <th style={{ padding: "8px 0", fontWeight: 500 }}>用户</th>
                  <th style={{ padding: "8px 0", fontWeight: 500 }}>消息数</th>
                  <th style={{ padding: "8px 0", fontWeight: 500 }}>
                    最后更新
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.conversationList.slice(0, 10).map((c) => (
                  <tr
                    key={c.id}
                    style={{
                      fontSize: 14,
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    <td
                      style={{
                        padding: "10px 0",
                        maxWidth: 320,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.topic || "（无主题）"}
                    </td>
                    <td style={{ padding: "10px 0" }}>{c.username}</td>
                    <td style={{ padding: "10px 0" }}>{c.messageCount}</td>
                    <td style={{ padding: "10px 0" }}>
                      {formatDate(c.lastUpdate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: 14, color: "var(--secondary-text)" }}>
              暂无对话记录
            </p>
          )}
        </div>
      </div>
    );
  }

  function renderUsers() {
    const isSelf = (username: string) => username === userStore.user?.username;
    return (
      <div style={CARD_STYLE}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16 }}>所有用户</h3>
          <button
            onClick={fetchStats}
            disabled={loading}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              border: "1px solid var(--border-color)",
              background: "transparent",
              color: "var(--foreground-color)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            刷新
          </button>
        </div>
        {stats?.userList && stats.userList.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  fontSize: 13,
                  color: "var(--secondary-text)",
                  borderBottom: "1px solid var(--border-color)",
                }}
              >
                <th style={{ padding: "8px 0", fontWeight: 500 }}>用户名</th>
                <th style={{ padding: "8px 0", fontWeight: 500 }}>对话数</th>
                <th style={{ padding: "8px 0", fontWeight: 500 }}>注册时间</th>
                <th style={{ padding: "8px 0", fontWeight: 500, width: 80 }}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.userList.map((u) => (
                <tr
                  key={u.id}
                  style={{
                    fontSize: 14,
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  <td style={{ padding: "10px 0" }}>{u.username}</td>
                  <td style={{ padding: "10px 0" }}>{u.conversationCount}</td>
                  <td style={{ padding: "10px 0" }}>
                    {formatDate(u.createdAt)}
                  </td>
                  <td style={{ padding: "10px 0" }}>
                    <button
                      onClick={() =>
                        setDeleteConfirm({
                          type: "user",
                          id: u.id,
                          name: u.username,
                        })
                      }
                      disabled={isSelf(u.username)}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 4,
                        border: "none",
                        fontSize: 12,
                        background: isSelf(u.username)
                          ? "var(--disabled-background)"
                          : "rgba(229,62,62,0.1)",
                        color: isSelf(u.username)
                          ? "var(--secondary-text)"
                          : "#e53e3e",
                        cursor: isSelf(u.username) ? "not-allowed" : "pointer",
                      }}
                      title={isSelf(u.username) ? "不能删除自己" : "删除该用户"}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ fontSize: 14, color: "var(--secondary-text)" }}>
            暂无注册用户
          </p>
        )}
      </div>
    );
  }

  function renderConversations() {
    return (
      <div style={CARD_STYLE}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16 }}>所有对话</h3>
          <button
            onClick={fetchStats}
            disabled={loading}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              border: "1px solid var(--border-color)",
              background: "transparent",
              color: "var(--foreground-color)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            刷新
          </button>
        </div>
        {stats?.conversationList && stats.conversationList.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  fontSize: 13,
                  color: "var(--secondary-text)",
                  borderBottom: "1px solid var(--border-color)",
                }}
              >
                <th
                  style={{ padding: "8px 0", fontWeight: 500, width: 40 }}
                ></th>
                <th style={{ padding: "8px 0", fontWeight: 500 }}>主题</th>
                <th style={{ padding: "8px 0", fontWeight: 500 }}>用户</th>
                <th style={{ padding: "8px 0", fontWeight: 500 }}>消息数</th>
                <th style={{ padding: "8px 0", fontWeight: 500 }}>最后更新</th>
                <th style={{ padding: "8px 0", fontWeight: 500, width: 80 }}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.conversationList.map((c) => (
                <ConverationRow
                  key={c.id}
                  conv={c}
                  isExpanded={expandedConvId === c.id}
                  messages={convMessages}
                  loadingMessages={loadingMessages}
                  onToggle={() => toggleConversation(c.id)}
                  onDelete={() =>
                    setDeleteConfirm({
                      type: "conversation",
                      id: c.id,
                      name: c.topic || "（无主题）",
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ fontSize: 14, color: "var(--secondary-text)" }}>
            暂无对话记录
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--background-color)",
        color: "var(--foreground-color)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {renderDeleteConfirm()}

      {/* 顶部导航 */}
      <div
        style={{
          borderBottom: "1px solid var(--border-color)",
          padding: "0 32px",
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            height: 56,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              CSGPT 管理后台
            </h2>
            <div style={{ display: "flex", gap: 4 }}>
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  style={activeTab === t.key ? TAB_ACTIVE_STYLE : TAB_STYLE}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 13, color: "var(--secondary-text)" }}>
              当前用户：{userStore.user?.username}
            </span>
            <button
              onClick={() => {
                userStore.logout();
                window.location.href = "/";
              }}
              style={{
                padding: "4px 12px",
                borderRadius: 6,
                border: "1px solid var(--border-color)",
                background: "transparent",
                color: "var(--foreground-color)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              退出登录
            </button>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          style={{ maxWidth: 1400, margin: "16px auto 0", padding: "0 32px" }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(229,62,62,0.1)",
              color: "#e53e3e",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        </div>
      )}

      {/* 主内容区 */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 32px" }}>
        {activeTab === "overview" && renderOverview()}
        {activeTab === "users" && renderUsers()}
        {activeTab === "conversations" && renderConversations()}
      </div>
    </div>
  );
}

// 对话行组件，支持展开查看消息
function ConverationRow({
  conv,
  isExpanded,
  messages,
  loadingMessages,
  onToggle,
  onDelete,
}: {
  conv: ConversationItem;
  isExpanded: boolean;
  messages: MessageItem[];
  loadingMessages: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const roleLabel = (role: string) => {
    switch (role) {
      case "user":
        return "用户";
      case "assistant":
        return "助手";
      case "system":
        return "系统";
      default:
        return role;
    }
  };

  return (
    <>
      <tr
        style={{
          fontSize: 14,
          borderBottom: "1px solid var(--border-color)",
          cursor: "pointer",
          background: isExpanded ? "var(--disabled-background)" : undefined,
        }}
        onClick={onToggle}
      >
        <td style={{ padding: "10px 0", textAlign: "center" }}>
          <span
            style={{
              fontSize: 12,
              transition: "transform 0.2s",
              display: "inline-block",
              transform: isExpanded ? "rotate(90deg)" : undefined,
            }}
          >
            ▶
          </span>
        </td>
        <td
          style={{
            padding: "10px 0",
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {conv.topic || "（无主题）"}
        </td>
        <td style={{ padding: "10px 0" }}>{conv.username}</td>
        <td style={{ padding: "10px 0" }}>{conv.messageCount}</td>
        <td style={{ padding: "10px 0" }}>{formatDate(conv.lastUpdate)}</td>
        <td style={{ padding: "10px 0" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            style={{
              padding: "3px 10px",
              borderRadius: 4,
              border: "none",
              background: "rgba(229,62,62,0.1)",
              color: "#e53e3e",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            删除
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6} style={{ padding: "0 0 16px 0" }}>
            <div
              style={{
                background: "var(--background-color)",
                borderRadius: 8,
                padding: 16,
                margin: "8px 0 0 40px",
              }}
            >
              {loadingMessages ? (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--secondary-text)",
                    textAlign: "center",
                    padding: 16,
                  }}
                >
                  加载消息中...
                </p>
              ) : messages.length === 0 ? (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--secondary-text)",
                    textAlign: "center",
                    padding: 16,
                  }}
                >
                  暂无消息
                </p>
              ) : (
                <div style={{ maxHeight: 480, overflowY: "auto" }}>
                  {messages.map((m, i) => (
                    <div
                      key={m.id || i}
                      style={{
                        marginBottom: i < messages.length - 1 ? 12 : 0,
                        padding: "8px 12px",
                        borderRadius: 6,
                        background:
                          m.role === "user"
                            ? "var(--disabled-background)"
                            : "transparent",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color:
                              m.role === "assistant"
                                ? "#3182ce"
                                : m.role === "user"
                                ? "#e53e3e"
                                : "var(--secondary-text)",
                          }}
                        >
                          {roleLabel(m.role)}
                        </span>
                        {m.model && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--secondary-text)",
                              background: "var(--disabled-background)",
                              padding: "1px 6px",
                              borderRadius: 3,
                            }}
                          >
                            {m.model}
                          </span>
                        )}
                        {m.isError && (
                          <span style={{ fontSize: 11, color: "#e53e3e" }}>
                            错误
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--secondary-text)",
                            marginLeft: "auto",
                          }}
                        >
                          {formatDate(m.date)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          lineHeight: 1.6,
                          maxHeight: 200,
                          overflowY: "auto",
                        }}
                      >
                        {m.content || "（空消息）"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
