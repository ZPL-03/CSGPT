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
      setError(Locale.Auth.Tips);
      return;
    }
    navigate(Path.Chat);
  };

  return (
    <div className={styles["auth-page"]}>
      <div className={clsx("no-dark", styles["auth-logo"])}>
        <BotIcon />
      </div>

      <div className={styles["auth-title"]}>{Locale.Auth.TopTips}</div>
      <div className={styles["auth-tips"]}>{Locale.Auth.Tips}</div>

      <PasswordInput
        style={{ marginTop: "3vh", marginBottom: "1vh" }}
        aria={Locale.Auth.Input}
        aria-label={Locale.Auth.Input}
        value={accessStore.accessCode}
        type="password"
        placeholder={Locale.Auth.Input}
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
          text={Locale.Auth.Confirm}
          type="primary"
          onClick={handleConfirm}
        />
      </div>
    </div>
  );
}
