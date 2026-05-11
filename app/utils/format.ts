export function prettyObject(msg: any) {
  const obj = msg;
  if (typeof msg !== "string") {
    msg = JSON.stringify(msg, null, "  ");
  }
  if (msg === "{}") {
    return obj.toString();
  }
  if (msg.startsWith("```json")) {
    return msg;
  }
  return ["```json", msg, "```"].join("\n");
}

export function* chunks(s: string, maxBytes = 1000 * 1000) {
  const decoder = new TextDecoder("utf-8");
  let buf = new TextEncoder().encode(s);
  while (buf.length) {
    let i = buf.lastIndexOf(32, maxBytes + 1);
    // 找不到空格时向前搜索
    if (i < 0) i = buf.indexOf(32, maxBytes);
    // 仍无空格则取全部
    if (i < 0) i = buf.length;
    // 安全截断点，避免截断多字节字符
    yield decoder.decode(buf.slice(0, i));
    buf = buf.slice(i + 1); // 跳过空格
  }
}
