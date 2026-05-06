// 用户认证页面
// 支持登录和注册两种模式

import styles from "./auth.module.scss";
import { IconButton } from "./button";
import { useState } from "react";
import { useUserStore } from "../store/user";
import Locale from "../locales";
import BotIcon from "../icons/bot.svg";
import EyeIcon from "../icons/eye.svg";
import EyeOffIcon from "../icons/eye-off.svg";
import clsx from "clsx";

export function AuthPage() {
  const userStore = useUserStore();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async () => {
    setError("");

    if (!username.trim()) {
      setError(Locale.Auth.Username + "不能为空");
      return;
    }
    if (!password) {
      setError(Locale.Auth.Password + "不能为空");
      return;
    }
    if (!isLogin && password !== confirmPassword) {
      setError(Locale.Auth.PasswordMismatch);
      return;
    }

    setLoading(true);
    try {
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "操作失败");
        return;
      }

      userStore.setAuth(data.token, data.user);
      window.location.href = "/#/";
    } catch (e) {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className={styles["auth-page"]}>
      <div className={clsx("no-dark", styles["auth-logo"])}>
        <BotIcon />
      </div>

      <div className={styles["auth-title"]}>
        {isLogin ? Locale.Auth.LoginTitle : Locale.Auth.RegisterTitle}
      </div>
      <div className={styles["auth-tips"]}>{Locale.Auth.Tips}</div>

      {/* 用户名输入 */}
      <div className={styles["auth-field"]}>
        <label className={styles["auth-label"]}>{Locale.Auth.Username}</label>
        <input
          className={styles["auth-input"]}
          type="text"
          placeholder={Locale.Auth.UsernamePlaceholder}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError("");
          }}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      </div>

      {/* 密码输入 */}
      <div className={styles["auth-field"]}>
        <label className={styles["auth-label"]}>{Locale.Auth.Password}</label>
        <div className={styles["auth-password-wrap"]}>
          <input
            className={styles["auth-input"]}
            type={showPassword ? "text" : "password"}
            placeholder={Locale.Auth.PasswordPlaceholder}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className={styles["auth-eye-btn"]}
            onClick={() => setShowPassword(!showPassword)}
            tabIndex={-1}
          >
            {showPassword ? <EyeIcon /> : <EyeOffIcon />}
          </button>
        </div>
      </div>

      {/* 注册模式下显示确认密码 */}
      {!isLogin && (
        <div className={styles["auth-field"]}>
          <label className={styles["auth-label"]}>
            {Locale.Auth.ConfirmPassword}
          </label>
          <div className={styles["auth-password-wrap"]}>
            <input
              className={styles["auth-input"]}
              type={showPassword ? "text" : "password"}
              placeholder={Locale.Auth.ConfirmPassword}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div style={{ color: "red", fontSize: "14px", marginBottom: "1vh" }}>
          {error}
        </div>
      )}

      {/* 操作按钮 */}
      <div className={styles["auth-actions"]}>
        <IconButton
          text={
            loading ? "..." : isLogin ? Locale.Auth.Login : Locale.Auth.Register
          }
          type="primary"
          onClick={handleSubmit}
          disabled={loading}
        />

        <div
          style={{
            marginTop: "16px",
            fontSize: "14px",
            textAlign: "center",
            cursor: "pointer",
            color: "var(--primary)",
          }}
          onClick={() => {
            setIsLogin(!isLogin);
            setError("");
            setConfirmPassword("");
          }}
        >
          {isLogin ? Locale.Auth.NoAccount : Locale.Auth.HasAccount}{" "}
          {isLogin ? Locale.Auth.GoRegister : Locale.Auth.GoLogin}
        </div>
      </div>
    </div>
  );
}
