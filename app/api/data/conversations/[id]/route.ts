import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// 对话数据存储目录
const DATA_DIR = path.join(process.cwd(), "data", "conversations");

// 获取单个对话
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const filePath = path.join(DATA_DIR, `${params.id}.json`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "对话不存在" }, { status: 404 });
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: "读取对话失败", detail: error.message },
      { status: 500 },
    );
  }
}

// 更新对话
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const filePath = path.join(DATA_DIR, `${params.id}.json`);
    const body = await req.json();

    // 如果文件存在，合并数据
    let existing: any = {};
    if (fs.existsSync(filePath)) {
      existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }

    const updated = {
      ...existing,
      ...body,
      id: params.id,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf-8");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: "更新对话失败", detail: error.message },
      { status: 500 },
    );
  }
}

// 删除对话
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const filePath = path.join(DATA_DIR, `${params.id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: "删除对话失败", detail: error.message },
      { status: 500 },
    );
  }
}
