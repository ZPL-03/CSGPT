// 用户认证页面
// 支持登录和注册两种模式

import styles from "./auth.module.scss";
import { IconButton } from "./button";
import { useState } from "react";
import { Path } from "../constant";
import { useUserStore } from "../store/user";
import Locale from "../locales";
import BotIcon from "../icons/bot.svg";
import { PasswordInput } from "./ui-lib";
import clsx from "clsx";

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

    // 基础验证
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

      // 登录/注册成功
      userStore.setAuth(data.token, data.user);
      // 刷新页面进入主界面
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
        <PasswordInput
          className={styles["auth-input"]}
          aria-label={Locale.Auth.Password}
          value={password}
          type="password"
          placeholder={Locale.Auth.PasswordPlaceholder}
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            setPassword(e.currentTarget.value);
            setError("");
          }}
        />
      </div>

      {/* 注册模式下显示确认密码 */}
      {!isLogin && (
        <div className={styles["auth-field"]}>
          <label className={styles["auth-label"]}>
            {Locale.Auth.ConfirmPassword}
          </label>
          <PasswordInput
            className={styles["auth-input"]}
            aria-label={Locale.Auth.ConfirmPassword}
            value={confirmPassword}
            type="password"
            placeholder={Locale.Auth.ConfirmPassword}
            onKeyDown={handleKeyDown}
            onChange={(e) => {
              setConfirmPassword(e.currentTarget.value);
              setError("");
            }}
          />
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

        {/* 切换登录/注册 */}
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
