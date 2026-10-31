import {
  FILES_URL_PREFIX,
  FILE_UPLOAD_CHUNK_SIZE,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import { MultimodalContent, RequestMessage } from "@/app/client/api";
import Locale from "@/app/locales";
import { useUserStore } from "@/app/store/user";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "./format";
import { fetch as tauriFetch } from "./stream";
import { THINKING_BLOCK_END, THINKING_BLOCK_START } from "./thinking";

const MODEL_IMAGE_DATA_URL_LIMIT = 2 * 1024 * 1024;
const EXTRACTED_TEXT_CHUNK_SIZE = 512 * 1024;

export function compressImage(file: Blob, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (readerEvent: any) => {
      // 非图片文件保持原始 data URL
      if (!file.type.startsWith("image/")) {
        resolve(readerEvent.target.result);
        return;
      }

      const image = new Image();
      image.onload = () => {
        let canvas = document.createElement("canvas");
        let ctx = canvas.getContext("2d");
        let width = image.width;
        let height = image.height;
        let quality = 0.9;
        let dataUrl;

        do {
          canvas.width = width;
          canvas.height = height;
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
          ctx?.drawImage(image, 0, 0, width, height);
          dataUrl = canvas.toDataURL("image/jpeg", quality);

          if (dataUrl.length < maxSize) break;

          if (quality > 0.5) {
            quality -= 0.1;
          } else {
            width *= 0.9;
            height *= 0.9;
          }
        } while (dataUrl.length > maxSize);

        resolve(dataUrl);
      };
      image.onerror = () => {
        resolve(readerEvent.target.result);
      };
      image.src = readerEvent.target.result;
    };
    reader.onerror = reject;

    if (file.type.includes("heic")) {
      try {
        const heic2any = require("heic2any");
        heic2any({ blob: file, toType: "image/jpeg" })
          .then((blob: Blob) => {
            reader.readAsDataURL(blob);
          })
          .catch((e: any) => {
            reject(e);
          });
      } catch (e) {
        reject(e);
      }
      return;
    }

    reader.readAsDataURL(file);
  });
}

export async function preProcessImageContentBase(
  content: RequestMessage["content"],
  transformImageUrl: (url: string) => Promise<{ [key: string]: any }>,
) {
  if (typeof content === "string") {
    return content;
  }
  const result = [];
  for (const part of content) {
    if (part?.type == "image_url" && part?.image_url?.url) {
      try {
        const url = await resolveAttachmentDataUrl(part?.image_url?.url);
        result.push(await transformImageUrl(url));
      } catch (error) {
        console.error("Error processing image URL:", error);
        throw error;
      }
    } else if (part?.type == "file_url" && part?.file_url?.url) {
      // 将文件 URL 转为 data URL，使模型请求体包含文件数据。
      try {
        const dataUrl = await resolveAttachmentDataUrl(part?.file_url?.url);
        result.push({
          type: "file_url",
          file_url: {
            url: dataUrl,
            name: part.file_url.name,
            size: part.file_url.size,
            type: part.file_url.type,
          },
        });
      } catch (error) {
        console.error("Error processing file URL:", error);
        throw error;
      }
    } else {
      result.push({ ...part });
    }
  }
  return result;
}

export async function preProcessImageContent(
  content: RequestMessage["content"],
) {
  return preProcessImageContentBase(content, async (url) => ({
    type: "image_url",
    image_url: { url },
  })) as Promise<MultimodalContent[] | string>;
}

export function resolveAttachmentDataUrl(attachmentUrl: string) {
  if (attachmentUrl.startsWith("data:")) {
    return Promise.resolve(attachmentUrl);
  }
  if (attachmentUrl.includes(FILES_URL_PREFIX)) {
    return fetch(attachmentUrl, {
      method: "GET",
      mode: "cors",
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`文件读取异常：${res.status}`);
        }
        return res.blob();
      })
      .then((blob) => compressImage(blob, MODEL_IMAGE_DATA_URL_LIMIT));
  }
  return Promise.resolve(attachmentUrl);
}

export function base64Image2Blob(base64Data: string, contentType: string) {
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: contentType });
}

async function parseFileUploadResponse(response: Response) {
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const detail = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(
      `文件上传失败：服务端返回 ${response.status}${
        detail ? `，${detail}` : ""
      }`,
    );
  }

  if (!response.ok || data?.code !== 0) {
    throw new Error(data?.error || data?.message || "文件上传失败");
  }
  return data;
}

// 将文件分片发送到服务端附件接口，避免线上函数请求体限制。
export async function uploadFile(
  file: Blob,
  filename?: string,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const token = useUserStore.getState().token;
  if (!token) {
    throw new Error("用户未登录");
  }

  const uploadName =
    filename ||
    ((file as File).name && (file as File).name.trim()) ||
    "upload.bin";
  const headers = {
    Authorization: `Bearer ${token}`,
  };
  let fileUrl = "";

  try {
    const initResponse = await fetch("/api/files", {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: uploadName,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      }),
    });
    const initData = await parseFileUploadResponse(initResponse);
    fileUrl = initData.data;
    const chunkSize =
      Number(initData.chunkSize) > 0
        ? Number(initData.chunkSize)
        : FILE_UPLOAD_CHUNK_SIZE;

    if (file.size === 0) {
      onProgress?.(100);
    }

    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, file.size);
      const chunk = file.slice(offset, end);
      const chunkResponse = await fetch(`${fileUrl}?offset=${offset}`, {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
        },
        body: chunk,
      });
      await parseFileUploadResponse(chunkResponse);
      onProgress?.(Math.round((end / Math.max(file.size, 1)) * 98));
    }

    const completeResponse = await fetch(fileUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "complete" }),
    });
    await parseFileUploadResponse(completeResponse);
    onProgress?.(100);
    return fileUrl;
  } catch (error) {
    if (fileUrl) {
      await fetch(fileUrl, {
        method: "DELETE",
        headers,
      }).catch(() => {});
    }
    throw error;
  }
}

export async function saveExtractedText(
  fileUrl: string,
  extractedText: string,
) {
  if (!fileUrl?.startsWith("/api/files/")) {
    throw new Error("文件地址无效");
  }
  if (typeof extractedText !== "string") {
    throw new Error("文件解析内容无效");
  }
  const token = useUserStore.getState().token;
  if (!token) {
    throw new Error("用户未登录");
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const postAction = async (body: Record<string, unknown>) => {
    const response = await fetch(fileUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    await parseFileUploadResponse(response);
  };

  await postAction({ action: "beginExtractedText" });
  for (
    let offset = 0;
    offset < extractedText.length;
    offset += EXTRACTED_TEXT_CHUNK_SIZE
  ) {
    await postAction({
      action: "appendExtractedText",
      chunk: extractedText.slice(offset, offset + EXTRACTED_TEXT_CHUNK_SIZE),
    });
  }
  await postAction({ action: "completeExtractedText" });
}

// 服务端文件解析：读取文件表数据并执行完整解析管线。
export async function reparseFileOnServer(fileId: string): Promise<{
  text: string;
  originalFormat: string;
  noiseLinesRemoved: number;
  formulaRecords: Array<{
    formula: string;
    display: boolean;
    description: string;
  }>;
  metadata: Record<string, any>;
}> {
  const token = useUserStore.getState().token;
  if (!token) {
    throw new Error("用户未登录");
  }

  const response = await fetch(`/api/files/${fileId}/parse`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `重解析请求失败：${response.status}`);
  }

  return response.json();
}

export function streamWithThink(
  chatPath: string,
  requestPayload: any,
  headers: any,
  tools: any[],
  funcs: Record<string, Function>,
  controller: AbortController,
  parseSSE: (
    text: string,
    runTools: any[],
  ) => {
    isThinking: boolean;
    content: string | undefined;
    finishReason?: string | null;
  },
  processToolMessage: (
    requestPayload: any,
    toolCallMessage: any,
    toolCallResult: any[],
  ) => void,
  options: any,
) {
  let responseText = "";
  let remainText = "";
  let finished = false;
  let running = false;
  let runTools: any[] = [];
  let responseRes: Response;
  let isInThinkingMode = false;
  let isInThinkTag = false;
  let finishReason: string | null = null;

  function appendStreamSegment(content: string, isThinking: boolean) {
    if (!content) return;

    if (isThinking) {
      if (!isInThinkingMode) {
        isInThinkingMode = true;
        if (remainText.length > 0) {
          remainText += "\n\n";
        }
        remainText += THINKING_BLOCK_START;
      }
      remainText += content;
      return;
    }

    if (isInThinkingMode) {
      isInThinkingMode = false;
      remainText += THINKING_BLOCK_END + "\n\n";
    }
    remainText += content;
  }

  function appendStreamChunk(content: string, isThinking: boolean) {
    if (isThinking) {
      appendStreamSegment(content, true);
      return;
    }

    let cursor = 0;
    while (cursor < content.length) {
      if (isInThinkTag) {
        const endIndex = content.indexOf("</think>", cursor);
        if (endIndex < 0) {
          appendStreamSegment(content.slice(cursor), true);
          return;
        }
        appendStreamSegment(content.slice(cursor, endIndex), true);
        isInThinkTag = false;
        cursor = endIndex + "</think>".length;
        continue;
      }

      const startIndex = content.indexOf("<think>", cursor);
      if (startIndex < 0) {
        appendStreamSegment(content.slice(cursor), false);
        return;
      }

      appendStreamSegment(content.slice(cursor, startIndex), false);
      isInThinkTag = true;
      cursor = startIndex + "<think>".length;
    }
  }

  // 逐帧动画渲染响应文本
  function animateResponseText() {
    if (finished || controller.signal.aborted) {
      responseText += remainText;
      if (responseText?.length === 0) {
        options.onError?.(new Error("empty response from server"));
      }
      return;
    }

    if (remainText.length > 0) {
      const fetchCount = Math.max(1, Math.round(remainText.length / 60));
      const fetchText = remainText.slice(0, fetchCount);
      responseText += fetchText;
      remainText = remainText.slice(fetchCount);
      options.onUpdate?.(responseText, fetchText);
    }

    requestAnimationFrame(animateResponseText);
  }

  // 启动动画渲染
  animateResponseText();

  const finish = () => {
    if (!finished) {
      if (isInThinkingMode) {
        remainText += THINKING_BLOCK_END;
        isInThinkingMode = false;
      }
      if (!running && runTools.length > 0) {
        const toolCallMessage = {
          role: "assistant",
          tool_calls: [...runTools],
        };
        running = true;
        runTools.splice(0, runTools.length); // 清空工具调用队列
        return Promise.all(
          toolCallMessage.tool_calls.map((tool) => {
            options?.onBeforeTool?.(tool);
            return Promise.resolve(
              // @ts-ignore
              funcs[tool.function.name](
                // @ts-ignore
                tool?.function?.arguments
                  ? JSON.parse(tool?.function?.arguments)
                  : {},
              ),
            )
              .then((res) => {
                let content = res.data || res?.statusText;
                content =
                  typeof content === "string"
                    ? content
                    : JSON.stringify(content);
                if (res.status >= 300) {
                  return Promise.reject(content);
                }
                return content;
              })
              .then((content) => {
                options?.onAfterTool?.({
                  ...tool,
                  content,
                  isError: false,
                });
                return content;
              })
              .catch((e) => {
                options?.onAfterTool?.({
                  ...tool,
                  isError: true,
                  errorMsg: e.toString(),
                });
                return e.toString();
              })
              .then((content) => ({
                name: tool.function.name,
                role: "tool",
                content,
                tool_call_id: tool.id,
              }));
          }),
        ).then((toolCallResult) => {
          processToolMessage(requestPayload, toolCallMessage, toolCallResult);
          setTimeout(() => {
            // 工具调用完成后继续请求
            running = false;
            chatApi(chatPath, headers, requestPayload, tools);
          }, 60);
        });
        return;
      }
      if (running) {
        return;
      }
      finished = true;
      options.onFinish(responseText + remainText, responseRes, {
        finishReason,
      });
    }
  };

  controller.signal.onabort = finish;

  function chatApi(
    chatPath: string,
    headers: any,
    requestPayload: any,
    tools: any,
  ) {
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: tools && tools.length ? tools : undefined,
      }),
      signal: controller.signal,
      headers,
    };
    const requestTimeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    fetchEventSource(chatPath, {
      fetch: tauriFetch as any,
      ...chatPayload,
      async onopen(res) {
        clearTimeout(requestTimeoutId);
        const contentType = res.headers.get("content-type");
        responseRes = res;

        if (contentType?.startsWith("text/plain")) {
          responseText = await res.clone().text();
          return finish();
        }

        if (
          !res.ok ||
          !res.headers
            .get("content-type")
            ?.startsWith(EventStreamContentType) ||
          res.status !== 200
        ) {
          const responseTexts = [responseText];
          let extraInfo = await res.clone().text();
          try {
            const resJson = await res.clone().json();
            extraInfo = prettyObject(resJson);
          } catch {}

          if (res.status === 401) {
            responseTexts.push(Locale.Error.Unauthorized);
          }

          if (extraInfo) {
            responseTexts.push(extraInfo);
          }

          responseText = responseTexts.join("\n\n");

          return finish();
        }
      },
      onmessage(msg) {
        if (msg.data === "[DONE]" || finished) {
          return finish();
        }
        const text = msg.data;
        // 跳过空消息
        if (!text || text.trim().length === 0) {
          return;
        }
        try {
          const chunk = parseSSE(text, runTools);
          if (chunk?.finishReason) {
            finishReason = chunk.finishReason;
          }
          // 跳过空内容
          if (!chunk?.content || chunk.content.length === 0) {
            return;
          }

          appendStreamChunk(chunk.content, chunk.isThinking);
        } catch (e) {
          console.error("[Request] parse error", text, msg, e);
          // 解析失败仅记录日志，不抛出异常
        }
      },
      onclose() {
        finish();
      },
      onerror(e) {
        options?.onError?.(e);
        throw e;
      },
      openWhenHidden: true,
    });
  }
  chatApi(chatPath, headers, requestPayload, tools);
}
