"use client";

import { useEffect, useState, useCallback } from "react";
import { useUserStore } from "../store/user";
import BotPng from "../icons/bot.svg";
import Locale from "../locales";

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

interface Stats {
  users: number;
  userList: UserItem[];
  conversations: number;
  conversationList: ConversationItem[];
  messages: number;
  dbSize: string;
  dataSize: string;
}

// 管理后台内部登录表单，登录后不跳转，留在当前页面
function AdminLogin() {
  const userStore = useUserStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
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
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--background-color)",
        color: "var(--foreground-color)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "var(--disabled-background)",
          padding: 32,
          borderRadius: 12,
          width: 340,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <BotPng width={48} height={48} />
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
          placeholder={Locale.Auth.Username}
          autoFocus
          style={{
            width: "100%",
            marginBottom: 12,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--border-color)",
            background: "var(--background-color)",
            color: "var(--foreground-color)",
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          placeholder={Locale.Auth.Password}
          style={{
            width: "100%",
            marginBottom: 12,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--border-color)",
            background: "var(--background-color)",
            color: "var(--foreground-color)",
            fontSize: 14,
            boxSizing: "border-box",
          }}
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
          {loading ? "登录中..." : Locale.Auth.Login}
        </button>
      </form>
    </div>
  );
}

export default function AdminPage() {
  const userStore = useUserStore();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "user" | "conversation";
    id: string;
    name: string;
  } | null>(null);

  const fetchStats = useCallback(async () => {
    const token = userStore.token;
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setIsAdmin(false);
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "请求失败");
        return;
      }
      const data = await res.json();
      setStats(data);
      setIsAdmin(true);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [userStore.token]);

  useEffect(() => {
    if (userStore.isLoggedIn && userStore.token) {
      fetchStats();
    }
  }, [userStore.isLoggedIn, userStore.token, fetchStats]);

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
      fetchStats();
    } catch {
      setError("网络错误");
    }
  }

  // 未登录：显示登录表单
  if (!userStore.isLoggedIn) {
    return <AdminLogin />;
  }

  // 正在检查管理员权限
  if (isAdmin === null) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "var(--background-color)",
          color: "var(--foreground-color)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {loading ? "加载中..." : "验证中..."}
      </div>
    );
  }

  // 非管理员
  if (!isAdmin) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "var(--background-color)",
          color: "var(--foreground-color)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h2 style={{ marginBottom: 12, fontSize: 22 }}>无访问权限</h2>
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

  // 确认删除对话框
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

  const cardStyle: React.CSSProperties = {
    background: "var(--disabled-background)",
    borderRadius: 10,
    padding: 20,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--background-color)",
        color: "var(--foreground-color)",
        fontFamily: "system-ui, sans-serif",
        padding: 40,
      }}
    >
      {renderDeleteConfirm()}

      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 32,
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: 24 }}>CSGPT 管理后台</h2>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--secondary-text)",
              }}
            >
              当前用户：{userStore.user?.username}
            </p>
          </div>
          <button
            onClick={() => {
              userStore.logout();
              window.location.href = "/";
            }}
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
            退出登录
          </button>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(229,62,62,0.1)",
              color: "#e53e3e",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {/* 概览卡片 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 16,
            marginBottom: 32,
          }}
        >
          {[
            { label: "注册用户", value: stats?.users },
            { label: "对话总数", value: stats?.conversations },
            { label: "消息总数", value: stats?.messages },
            { label: "数据库大小", value: stats?.dbSize },
          ].map((card) => (
            <div key={card.label} style={cardStyle}>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--secondary-text)",
                  marginBottom: 8,
                }}
              >
                {card.label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {loading ? "..." : card.value ?? "-"}
              </div>
            </div>
          ))}
        </div>

        {/* 用户列表 */}
        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16 }}>注册用户</h3>
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
                  <th style={{ padding: "8px 0", fontWeight: 500 }}>
                    注册时间
                  </th>
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
                      {new Date(u.createdAt).toLocaleString("zh-CN")}
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
                        disabled={u.username === userStore.user?.username}
                        style={{
                          padding: "3px 10px",
                          borderRadius: 4,
                          border: "none",
                          background:
                            u.username === userStore.user?.username
                              ? "var(--disabled-background)"
                              : "rgba(229,62,62,0.1)",
                          color:
                            u.username === userStore.user?.username
                              ? "var(--secondary-text)"
                              : "#e53e3e",
                          fontSize: 12,
                          cursor:
                            u.username === userStore.user?.username
                              ? "not-allowed"
                              : "pointer",
                        }}
                        title={
                          u.username === userStore.user?.username
                            ? "不能删除自己"
                            : "删除该用户"
                        }
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

        {/* 对话列表 */}
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>所有对话</h3>
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
                  <th style={{ padding: "8px 0", fontWeight: 500, width: 80 }}>
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.conversationList.map((c) => (
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
                        maxWidth: 240,
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
                      {new Date(c.lastUpdate).toLocaleString("zh-CN")}
                    </td>
                    <td style={{ padding: "10px 0" }}>
                      <button
                        onClick={() =>
                          setDeleteConfirm({
                            type: "conversation",
                            id: c.id,
                            name: c.topic || "（无主题）",
                          })
                        }
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
    </div>
  );
}
