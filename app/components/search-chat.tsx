import { useMemo, useState } from "react";
import { ErrorBoundary } from "./error";
import styles from "./mask.module.scss";
import { useNavigate } from "react-router-dom";
import { IconButton } from "./button";
import CloseIcon from "../icons/close.svg";
import EyeIcon from "../icons/eye.svg";
import SearchIcon from "../icons/search.svg";
import Locale from "../locales";
import { Path } from "../constant";
import { ChatMessage, useChatStore } from "../store";
import clsx from "clsx";

type SearchItem = {
  id: number;
  name: string;
  content: string;
};

function messageToSearchText(message: ChatMessage) {
  const parts: string[] = [];
  if (typeof message.content === "string") {
    parts.push(message.content);
  } else if (Array.isArray(message.content)) {
    for (const item of message.content) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "text") {
        parts.push(item.text || "");
      }
      if (item.type === "file_url") {
        parts.push(item.file_url?.name || "");
      }
      if (item.type === "image_url") {
        parts.push(item.image_url?.name || "");
      }
    }
  }
  if (message.fileContent) parts.push(message.fileContent);
  return parts.filter(Boolean).join("\n");
}

function findSnippets(content: string, query: string) {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const snippets: string[] = [];
  let position = lowerContent.indexOf(lowerQuery);
  while (position !== -1 && snippets.length < 4) {
    const start = Math.max(0, position - 36);
    const end = Math.min(content.length, position + query.length + 36);
    snippets.push(content.substring(start, end).replace(/\s+/g, " ").trim());
    position = lowerContent.indexOf(lowerQuery, position + lowerQuery.length);
  }
  return snippets;
}

export function SearchChatPage() {
  const navigate = useNavigate();
  const chatStore = useChatStore();
  const sessions = chatStore.sessions;
  const selectSession = chatStore.selectSession;
  const [searchText, setSearchText] = useState("");

  const searchResults = useMemo(() => {
    const query = searchText.trim();
    if (!query) return [];

    const results: SearchItem[] = [];
    sessions.forEach((session, index) => {
      const titleSnippets = findSnippets(session.topic, query);
      const messageSnippets = session.messages.flatMap((message) =>
        findSnippets(messageToSearchText(message), query),
      );
      const snippets = [...titleSnippets, ...messageSnippets];
      if (snippets.length > 0) {
        results.push({
          id: index,
          name: session.topic,
          content: snippets.join(" ... "),
        });
      }
    });

    return results.sort((a, b) => b.content.length - a.content.length);
  }, [searchText, sessions]);

  return (
    <ErrorBoundary>
      <div className={styles["mask-page"]}>
        <div className="window-header">
          <div className="window-header-title">
            <div className="window-header-main-title">
              {Locale.SearchChat.Page.Title}
            </div>
            <div className="window-header-submai-title">
              {Locale.SearchChat.Page.SubTitle(searchResults.length)}
            </div>
          </div>

          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<CloseIcon />}
                bordered
                onClick={() => navigate(-1)}
              />
            </div>
          </div>
        </div>

        <div className={styles["mask-page-body"]}>
          <div className={styles["mask-filter"]}>
            <input
              type="text"
              className={styles["search-bar"]}
              placeholder={Locale.SearchChat.Page.Search}
              autoFocus
              value={searchText}
              onInput={(event) => setSearchText(event.currentTarget.value)}
            />
            <IconButton icon={<SearchIcon />} bordered />
          </div>

          <div>
            {searchText.trim() && searchResults.length === 0 ? (
              <p className={styles["mask-empty"]}>
                {Locale.SearchChat.Page.NoResult}
              </p>
            ) : null}
            {searchResults.map((item) => (
              <div
                className={styles["mask-item"]}
                key={item.id}
                onClick={() => {
                  navigate(Path.Chat);
                  selectSession(item.id);
                }}
                style={{ cursor: "pointer" }}
              >
                <div className={styles["mask-header"]}>
                  <div className={styles["mask-title"]}>
                    <div className={styles["mask-name"]}>{item.name}</div>
                    <div className={clsx(styles["mask-info"], "one-line")}>
                      {item.content}
                    </div>
                  </div>
                </div>
                <div className={styles["mask-actions"]}>
                  <IconButton
                    icon={<EyeIcon />}
                    text={Locale.SearchChat.Item.View}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
