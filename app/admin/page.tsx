"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useUserStore } from "../store/user";
import styles from "./admin.module.scss";

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

// 管理后台验证阶段
type AdminPhase = "login" | "verifying" | "denied" | "error" | "granted";

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString("zh-CN");
  } catch {
    return dateStr;
  }
}

// 管理后台登录表单
function AdminLogin({ onLoginSuccess }: { onLoginSuccess: () => void }) {
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
      useUserStore.getState().setAuth(data.token, data.user);
      onLoginSuccess();
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles["admin-login"]}>
      <form onSubmit={handleSubmit} className={styles["admin-login-card"]}>
        <div className={styles["admin-login-header"]}>CSGPT</div>
        <h2 className={styles["admin-login-title"]}>管理后台</h2>
        <p className={styles["admin-login-subtitle"]}>请使用管理员账号登录</p>
        <input
          type="text"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError("");
          }}
          placeholder="用户名"
          autoFocus
          className={styles["admin-login-input"]}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          placeholder="密码"
          className={styles["admin-login-input"]}
        />
        {error && <p className={styles["admin-login-error"]}>{error}</p>}
        <button
          type="submit"
          disabled={loading || !username || !password}
          className={styles["admin-login-btn"]}
        >
          {loading ? "登录中..." : "登录"}
        </button>
      </form>
    </div>
  );
}

export default function AdminPage() {
  const userStore = useUserStore();
  const [phase, setPhase] = useState<AdminPhase>("verifying");
  const [errorMsg, setErrorMsg] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "user" | "conversation";
    id: string;
    name: string;
  } | null>(null);
  const [expandedConvId, setExpandedConvId] = useState<string | null>(null);
  const [convMessages, setConvMessages] = useState<MessageItem[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // 验证管理员身份 — 直接从 store 读取 token，不依赖响应式追踪
  async function verifyAdmin() {
    const token = useUserStore.getState().token;
    if (!token) {
      setPhase("login");
      return;
    }
    setPhase("verifying");
    setErrorMsg("");
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.status === 401) {
        setPhase("denied");
        return;
      }
      if (!res.ok) {
        setErrorMsg(data.error || data.detail || "获取数据失败");
        setPhase("error");
        return;
      }
      setStats(data);
      setPhase("granted");
    } catch {
      setErrorMsg("网络错误，请检查网络连接后重试");
      setPhase("error");
    }
  }

  // 登录成功后重新验证
  function handleLoginSuccess() {
    verifyAdmin();
  }

  // 组件挂载及登录状态变化时验证
  useEffect(() => {
    if (userStore.isLoggedIn) {
      verifyAdmin();
    } else {
      setPhase("login");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userStore.isLoggedIn]);

  // 刷新统计数据（仅在已授权后使用）
  async function refreshStats() {
    const token = useUserStore.getState().token;
    if (!token) return;
    setErrorMsg("");
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || data.detail || "获取数据失败");
        return;
      }
      setStats(data);
    } catch {
      setErrorMsg("网络错误");
    }
  }

  async function fetchConvMessages(convId: string) {
    const token = useUserStore.getState().token;
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/admin/stats?id=${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "获取消息失败");
        return;
      }
      setConvMessages(data.messages || []);
    } catch {
      setErrorMsg("获取对话消息失败");
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
    const token = useUserStore.getState().token;
    setErrorMsg("");
    try {
      const res = await fetch(`/api/admin/stats?type=${type}&id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "删除失败");
        return;
      }
      setDeleteConfirm(null);
      if (expandedConvId === id) {
        setExpandedConvId(null);
        setConvMessages([]);
      }
      refreshStats();
    } catch {
      setErrorMsg("网络错误");
    }
  }

  function doLogout() {
    useUserStore.getState().logout();
    window.location.reload();
  }

  // 登录页
  if (phase === "login") {
    return <AdminLogin onLoginSuccess={handleLoginSuccess} />;
  }

  // 验证中
  if (phase === "verifying") {
    return (
      <div className={styles["admin-status"]}>
        <div className={styles["admin-status-body"]}>
          <p className={styles["admin-status-text"]}>加载中...</p>
        </div>
      </div>
    );
  }

  // 无权限
  if (phase === "denied") {
    return (
      <div className={styles["admin-status"]}>
        <div className={styles["admin-status-body"]}>
          <h2 className={styles["admin-status-title"]}>无访问权限</h2>
          <p className={styles["admin-status-desc"]}>当前账号不是管理员</p>
          <button onClick={doLogout} className={styles["admin-btn"]}>
            退出登录
          </button>
        </div>
      </div>
    );
  }

  // 验证出错（网络问题等）
  if (phase === "error") {
    return (
      <div className={styles["admin-status"]}>
        <div className={styles["admin-status-body"]}>
          <p className={styles["admin-status-text"]}>验证失败</p>
          {errorMsg && (
            <p className={styles["admin-status-error"]}>{errorMsg}</p>
          )}
          <button onClick={verifyAdmin} className={styles["admin-btn"]}>
            重试
          </button>
        </div>
      </div>
    );
  }

  // 已授权 — 管理后台主界面
  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "概览" },
    { key: "users", label: "用户" },
    { key: "conversations", label: "对话" },
  ];

  return (
    <div className={styles["admin-page"]}>
      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <div
          className={styles["admin-modal-overlay"]}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className={styles["admin-modal"]}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles["admin-modal-title"]}>确认删除</h3>
            <p className={styles["admin-modal-body"]}>
              {deleteConfirm.type === "user"
                ? `确定要删除用户「${deleteConfirm.name}」及其所有数据吗？此操作不可撤销。`
                : `确定要删除对话「${deleteConfirm.name}」吗？此操作不可撤销。`}
            </p>
            <div className={styles["admin-modal-actions"]}>
              <button
                onClick={() => setDeleteConfirm(null)}
                className={styles["admin-btn-cancel"]}
              >
                取消
              </button>
              <button
                onClick={() =>
                  handleDelete(deleteConfirm.type, deleteConfirm.id)
                }
                className={styles["admin-btn-confirm-delete"]}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 顶部导航 */}
      <nav className={styles["admin-nav"]}>
        <div className={styles["admin-nav-inner"]}>
          <div className={styles["admin-nav-left"]}>
            <span className={styles["admin-nav-brand"]}>管理后台</span>
            <div className={styles["admin-nav-tabs"]}>
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={styles["admin-nav-tab"]}
                  data-active={activeTab === t.key}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles["admin-nav-right"]}>
            <span className={styles["admin-nav-user"]}>
              {userStore.user?.username}
            </span>
            <button onClick={doLogout} className={styles["admin-btn-sm"]}>
              退出
            </button>
          </div>
        </div>
      </nav>

      {/* 错误提示 */}
      {errorMsg && (
        <div className={styles["admin-error-bar"]}>
          <div className={styles["admin-error-msg"]}>{errorMsg}</div>
        </div>
      )}

      {/* 主内容 */}
      <div className={styles["admin-content"]}>
        {activeTab === "overview" && <OverviewTab stats={stats} />}
        {activeTab === "users" && (
          <UsersTab
            stats={stats}
            isSelf={(u) => u === userStore.user?.username}
            onDelete={(u) =>
              setDeleteConfirm({ type: "user", id: u.id, name: u.username })
            }
            onRefresh={refreshStats}
          />
        )}
        {activeTab === "conversations" && (
          <ConversationsTab
            stats={stats}
            expandedConvId={expandedConvId}
            convMessages={convMessages}
            loadingMessages={loadingMessages}
            onToggle={toggleConversation}
            onDelete={(c) =>
              setDeleteConfirm({
                type: "conversation",
                id: c.id,
                name: c.topic || "（无主题）",
              })
            }
            onRefresh={refreshStats}
          />
        )}
      </div>
    </div>
  );
}

// 概览标签页
function OverviewTab({ stats }: { stats: Stats | null }) {
  const cards = [
    { label: "注册用户", value: stats?.users },
    { label: "对话总数", value: stats?.conversations },
    { label: "消息总数", value: stats?.messages },
    { label: "数据库", value: stats?.dbSize },
    { label: "数据", value: stats?.dataSize },
  ];

  return (
    <div>
      <div className={styles["admin-stat-grid"]}>
        {cards.map((c) => (
          <div key={c.label} className={styles["admin-stat-card"]}>
            <div className={styles["admin-stat-label"]}>{c.label}</div>
            <div className={styles["admin-stat-value"]}>
              {stats ? c.value ?? "-" : "..."}
            </div>
          </div>
        ))}
      </div>

      <div className={styles["admin-grid-2"]}>
        <div className={styles["admin-card"]}>
          <h3 className={styles["admin-card-title"]}>用户列表</h3>
          {stats?.userList && stats.userList.length > 0 ? (
            <div className={styles["admin-table-wrap"]}>
              <table className={styles["admin-table"]}>
                <thead>
                  <tr>
                    <th className={styles["admin-th"]}>用户名</th>
                    <th className={styles["admin-th"]}>对话</th>
                    <th
                      className={styles["admin-th"]}
                      style={{ textAlign: "right" }}
                    >
                      注册时间
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.userList.map((u) => (
                    <tr key={u.id}>
                      <td className={styles["admin-td"]}>{u.username}</td>
                      <td className={styles["admin-td"]}>
                        {u.conversationCount}
                      </td>
                      <td
                        className={styles["admin-td"]}
                        style={{ textAlign: "right" }}
                      >
                        {formatDate(u.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles["admin-empty"]}>暂无数据</p>
          )}
        </div>

        <div className={styles["admin-card"]}>
          <h3 className={styles["admin-card-title"]}>对话列表</h3>
          {stats?.conversationList && stats.conversationList.length > 0 ? (
            <div className={styles["admin-table-wrap"]}>
              <table className={styles["admin-table"]}>
                <thead>
                  <tr>
                    <th className={styles["admin-th"]}>主题</th>
                    <th className={styles["admin-th"]}>用户</th>
                    <th className={styles["admin-th"]}>消息</th>
                    <th
                      className={styles["admin-th"]}
                      style={{ textAlign: "right" }}
                    >
                      更新时间
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.conversationList.map((c) => (
                    <tr key={c.id}>
                      <td
                        className={`${styles["admin-td"]} ${styles["admin-topic-cell"]}`}
                      >
                        {c.topic || "（无主题）"}
                      </td>
                      <td className={styles["admin-td"]}>{c.username}</td>
                      <td className={styles["admin-td"]}>{c.messageCount}</td>
                      <td
                        className={styles["admin-td"]}
                        style={{ textAlign: "right" }}
                      >
                        {formatDate(c.lastUpdate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles["admin-empty"]}>暂无数据</p>
          )}
        </div>
      </div>
    </div>
  );
}

// 用户管理标签页
function UsersTab({
  stats,
  isSelf,
  onDelete,
  onRefresh,
}: {
  stats: Stats | null;
  isSelf: (u: string) => boolean;
  onDelete: (u: UserItem) => void;
  onRefresh: () => void;
}) {
  return (
    <div className={styles["admin-card"]}>
      <div className={styles["admin-card-header"]}>
        <h3 className={styles["admin-card-title"]}>所有用户</h3>
        <button onClick={onRefresh} className={styles["admin-btn-sm"]}>
          刷新
        </button>
      </div>
      {stats?.userList && stats.userList.length > 0 ? (
        <div className={styles["admin-table-wrap"]}>
          <table className={styles["admin-table"]}>
            <thead>
              <tr>
                <th className={styles["admin-th"]}>用户名</th>
                <th className={styles["admin-th"]}>对话数</th>
                <th
                  className={styles["admin-th"]}
                  style={{ textAlign: "right" }}
                >
                  注册时间
                </th>
                <th
                  className={styles["admin-th"]}
                  style={{ textAlign: "center", width: 50 }}
                >
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.userList.map((u) => (
                <tr key={u.id}>
                  <td className={styles["admin-td"]}>{u.username}</td>
                  <td className={styles["admin-td"]}>{u.conversationCount}</td>
                  <td
                    className={styles["admin-td"]}
                    style={{ textAlign: "right" }}
                  >
                    {formatDate(u.createdAt)}
                  </td>
                  <td
                    className={styles["admin-td"]}
                    style={{ textAlign: "center" }}
                  >
                    <button
                      onClick={() => onDelete(u)}
                      disabled={isSelf(u.username)}
                      className={styles["admin-delete-btn"]}
                      title={isSelf(u.username) ? "不能删除自己" : "删除"}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles["admin-empty"]}>暂无注册用户</p>
      )}
    </div>
  );
}

// 对话管理标签页
function ConversationsTab({
  stats,
  expandedConvId,
  convMessages,
  loadingMessages,
  onToggle,
  onDelete,
  onRefresh,
}: {
  stats: Stats | null;
  expandedConvId: string | null;
  convMessages: MessageItem[];
  loadingMessages: boolean;
  onToggle: (id: string) => void;
  onDelete: (c: ConversationItem) => void;
  onRefresh: () => void;
}) {
  return (
    <div className={styles["admin-card"]}>
      <div className={styles["admin-card-header"]}>
        <h3 className={styles["admin-card-title"]}>所有对话</h3>
        <button onClick={onRefresh} className={styles["admin-btn-sm"]}>
          刷新
        </button>
      </div>
      {stats?.conversationList && stats.conversationList.length > 0 ? (
        <div className={styles["admin-table-wrap"]}>
          <table className={styles["admin-table"]}>
            <thead>
              <tr>
                <th className={styles["admin-th"]} style={{ width: 24 }}></th>
                <th className={styles["admin-th"]}>主题</th>
                <th className={styles["admin-th"]}>用户</th>
                <th className={styles["admin-th"]}>消息</th>
                <th
                  className={styles["admin-th"]}
                  style={{ textAlign: "right" }}
                >
                  最后更新
                </th>
                <th
                  className={styles["admin-th"]}
                  style={{ textAlign: "center", width: 50 }}
                >
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.conversationList.map((c) => (
                <ConvRow
                  key={c.id}
                  conv={c}
                  isExpanded={expandedConvId === c.id}
                  messages={convMessages}
                  loadingMessages={loadingMessages}
                  onToggle={() => onToggle(c.id)}
                  onDelete={() => onDelete(c)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles["admin-empty"]}>暂无对话记录</p>
      )}
    </div>
  );
}

// 对话行：可展开查看消息详情
function ConvRow({
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
  const roleCfg: Record<string, { label: string; color: string }> = {
    user: { label: "用户", color: "#e53e3e" },
    assistant: { label: "助手", color: "#3182ce" },
    system: { label: "系统", color: "#888" },
  };

  return (
    <>
      <tr
        onClick={onToggle}
        className={
          isExpanded
            ? styles["admin-tr-expanded"]
            : styles["admin-tr-clickable"]
        }
      >
        <td
          className={styles["admin-td"]}
          style={{ textAlign: "center", width: 24 }}
        >
          <span
            className={styles["admin-expand-arrow"]}
            data-expanded={isExpanded}
          >
            ▶
          </span>
        </td>
        <td className={`${styles["admin-td"]} ${styles["admin-topic-cell"]}`}>
          {conv.topic || "（无主题）"}
        </td>
        <td className={styles["admin-td"]}>{conv.username}</td>
        <td className={styles["admin-td"]}>{conv.messageCount}</td>
        <td className={styles["admin-td"]} style={{ textAlign: "right" }}>
          {formatDate(conv.lastUpdate)}
        </td>
        <td className={styles["admin-td"]} style={{ textAlign: "center" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className={styles["admin-delete-btn"]}
          >
            删除
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6} style={{ padding: 0 }}>
            <div className={styles["admin-msg-panel"]}>
              {loadingMessages ? (
                <div className={styles["admin-msg-loading"]}>加载中...</div>
              ) : messages.length === 0 ? (
                <div className={styles["admin-msg-loading"]}>暂无消息</div>
              ) : (
                <div className={styles["admin-msg-list"]}>
                  {messages.map((m, i) => {
                    const role = roleCfg[m.role] || {
                      label: m.role,
                      color: "#888",
                    };
                    return (
                      <div
                        key={m.id || i}
                        className={`${styles["admin-msg-item"]} ${
                          m.role === "user" ? styles["admin-msg-item-user"] : ""
                        }`}
                      >
                        <div className={styles["admin-msg-meta"]}>
                          <span
                            className={styles["admin-msg-role"]}
                            style={{ color: role.color }}
                          >
                            {role.label}
                          </span>
                          {m.model && (
                            <span className={styles["admin-msg-model"]}>
                              {m.model}
                            </span>
                          )}
                          {m.isError && (
                            <span className={styles["admin-msg-error-tag"]}>
                              错误
                            </span>
                          )}
                          <span className={styles["admin-msg-date"]}>
                            {formatDate(m.date)}
                          </span>
                        </div>
                        <div className={styles["admin-msg-content"]}>
                          {m.content || "（空）"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
