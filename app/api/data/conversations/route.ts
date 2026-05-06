import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// 对话数据存储目录
const DATA_DIR = path.join(process.cwd(), "data", "conversations");

// 确保目录存在
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 获取所有对话列表
export async function GET() {
  try {
    ensureDir(DATA_DIR);
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    const sessions = files.map((file) => {
      const filePath = path.join(DATA_DIR, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return {
        id: data.id,
        title: data.title,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        messageCount: data.messages?.length || 0,
      };
    });
    // 按更新时间倒序
    sessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return NextResponse.json({ sessions });
  } catch (error: any) {
    return NextResponse.json(
      { error: "读取对话列表失败", detail: error.message },
      { status: 500 },
    );
  }
}

// 保存对话
export async function POST(req: NextRequest) {
  try {
    ensureDir(DATA_DIR);
    const body = await req.json();
    const { id, title, messages, mask, model } = body;

    if (!id) {
      return NextResponse.json({ error: "缺少对话 ID" }, { status: 400 });
    }

    const session = {
      id,
      title: title || "新对话",
      messages: messages || [],
      mask: mask || null,
      model: model || null,
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const filePath = path.join(DATA_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");

    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    return NextResponse.json(
      { error: "保存对话失败", detail: error.message },
      { status: 500 },
    );
  }
}
