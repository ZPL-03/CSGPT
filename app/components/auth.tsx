import styles from "./auth.module.scss";
import { IconButton } from "./button";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { useAccessStore } from "../store";
import Locale from "../locales";
import BotIcon from "../icons/bot.svg";
import { PasswordInput } from "./ui-lib";
import clsx from "clsx";

export function AuthPage() {
  const navigate = useNavigate();
  const accessStore = useAccessStore();
  const [error, setError] = useState("");

  const handleConfirm = () => {
    if (!accessStore.accessCode.trim()) {
      setError("请输入访问码");
      return;
    }
    // 访问码验证在服务端 API 路由中进行，前端只检查非空
    navigate(Path.Chat);
  };

  return (
    <div className={styles["auth-page"]}>
      <div className={clsx("no-dark", styles["auth-logo"])}>
        <BotIcon />
      </div>

      <div className={styles["auth-title"]}>CSGPT - 复合材料结构设计助手</div>
      <div className={styles["auth-tips"]}>请输入访问码以使用系统</div>

      <PasswordInput
        style={{ marginTop: "3vh", marginBottom: "1vh" }}
        aria="访问码"
        aria-label="访问码"
        value={accessStore.accessCode}
        type="password"
        placeholder="请输入访问码"
        onKeyDown={(e) => {
          if (e.key === "Enter") handleConfirm();
        }}
        onChange={(e) => {
          setError("");
          accessStore.update(
            (access) => (access.accessCode = e.currentTarget.value),
          );
        }}
      />

      {error && (
        <div style={{ color: "red", fontSize: "14px", marginBottom: "1vh" }}>
          {error}
        </div>
      )}

      <div className={styles["auth-actions"]}>
        <IconButton
          text="确认"
          type="primary"
          onClick={handleConfirm}
        />
      </div>
    </div>
  );
}
