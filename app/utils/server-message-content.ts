export type ServerChatMessageLike = {
  role?: string;
  content?: string | any[];
  fileContent?: string;
};

export function normalizeServerMessageText(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function serverMessageContentToText(
  content: string | any[] | undefined,
) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => {
      if (item?.type === "text") {
        return item.text || "";
      }
      if (item?.type === "image_url") {
        return item.image_url?.name ? `图片：${item.image_url.name}` : "";
      }
      if (item?.type === "file_url") {
        return item.file_url?.name ? `文件：${item.file_url.name}` : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function lastUserMessageText(messages: ServerChatMessageLike[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role || "").toLowerCase() !== "user") continue;
    const text = [
      serverMessageContentToText(message.content),
      message.fileContent || "",
    ]
      .map(normalizeServerMessageText)
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  return "";
}
