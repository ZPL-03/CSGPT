// 用户认证工具函数
// JWT 令牌生成、验证、密码加密

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";

const JWT_SECRET =
  process.env.JWT_SECRET || "csgpt-jwt-secret-change-in-production";
const TOKEN_EXPIRY = "7d"; // 令牌有效期 7 天

// 加密密码
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

// 验证密码
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// 生成 JWT 令牌
export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// 验证 JWT 令牌
export function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded;
  } catch {
    return null;
  }
}

// 从请求头中提取用户 ID
export async function getUserFromRequest(
  request: Request,
): Promise<string | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) return null;

  // 验证用户是否存在
  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { id: true },
  });

  return user?.id ?? null;
}
