// 用户认证页面
// 支持登录和注册两种模式

import styles from "./auth.module.scss";
import { IconButton } from "./button";
import { useState } from "react";
import clsx from "clsx";
import { useUserStore } from "../store/user";
import Locale from "../locales";
import BotPng from "../icons/bot.svg";

export function AuthPage() {
  const userStore = useUserStore();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
        <BotPng width={56} height={56} />
      </div>

      <div className={styles["auth-title"]}>
        {isLogin ? Locale.Auth.LoginTitle : Locale.Auth.RegisterTitle}
      </div>
      <div className={styles["auth-tips"]}>{Locale.Auth.Tips}</div>

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

      <div className={styles["auth-field"]}>
        <label className={styles["auth-label"]}>{Locale.Auth.Password}</label>
        <input
          className={styles["auth-input"]}
          type="password"
          placeholder={Locale.Auth.PasswordPlaceholder}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {!isLogin && (
        <div className={styles["auth-field"]}>
          <label className={styles["auth-label"]}>
            {Locale.Auth.ConfirmPassword}
          </label>
          <input
            className={styles["auth-input"]}
            type="password"
            placeholder={Locale.Auth.ConfirmPassword}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setError("");
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
      )}

      {error && <div className={styles["auth-error"]}>{error}</div>}

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
