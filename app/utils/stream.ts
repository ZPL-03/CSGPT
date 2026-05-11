// 使用 Tauri 命令发送请求
// 参见 src-tauri/src/stream.rs 和 src-tauri/src/main.rs
// 1. invoke('stream_fetch', {url, method, headers, body}), get response with headers.
// 2. listen event: `stream-response` multi times to get body

type ResponseEvent = {
  id: number;
  payload: {
    request_id: number;
    status?: number;
    chunk?: number[];
  };
};

type StreamResponse = {
  request_id: number;
  status: number;
  status_text: string;
  headers: Record<string, string>;
};

export function fetch(url: string, options?: RequestInit): Promise<Response> {
  if (window.__TAURI__) {
    const {
      signal,
      method = "GET",
      headers: _headers = {},
      body = [],
    } = options || {};
    let unlisten: Function | undefined;
    let setRequestId: Function | undefined;
    const requestIdPromise = new Promise((resolve) => (setRequestId = resolve));
    const ts = new TransformStream();
    const writer = ts.writable.getWriter();

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      unlisten && unlisten();
      writer.ready.then(() => {
        writer.close().catch((e) => console.error(e));
      });
    };

    if (signal) {
      signal.addEventListener("abort", () => close());
    }
    // @ts-ignore Tauri 流式响应：多次监听事件并写入 Response.body
    window.__TAURI__.event
      .listen("stream-response", (e: ResponseEvent) =>
        requestIdPromise.then((request_id) => {
          const { request_id: rid, chunk, status } = e?.payload || {};
          if (request_id != rid) {
            return;
          }
          if (chunk) {
            writer.ready.then(() => {
              writer.write(new Uint8Array(chunk));
            });
          } else if (status === 0) {
            // 响应体结束
            close();
          }
        }),
      )
      .then((u: Function) => (unlisten = u));

    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      "User-Agent": navigator.userAgent,
    };
    for (const item of new Headers(_headers || {})) {
      headers[item[0]] = item[1];
    }
    return window.__TAURI__
      .invoke("stream_fetch", {
        method: method.toUpperCase(),
        url,
        headers,
        body:
          typeof body === "string"
            ? Array.from(new TextEncoder().encode(body))
            : [],
      })
      .then((res: StreamResponse) => {
        const { request_id, status, status_text: statusText, headers } = res;
        setRequestId?.(request_id);
        const response = new Response(ts.readable, {
          status,
          statusText,
          headers,
        });
        if (status >= 300) {
          setTimeout(close, 100);
        }
        return response;
      })
      .catch((e) => {
        console.error("stream error", e);
        return new Response("", { status: 599 });
      });
  }
  return window.fetch(url, options);
}
