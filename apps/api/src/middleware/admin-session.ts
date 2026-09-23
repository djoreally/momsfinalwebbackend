import crypto from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getSql } from "../../../packages/db/src/index.js";

const COOKIE_NAME = "moms_admin_session";

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const requireAdminSession: MiddlewareHandler = async (c, next) => {
  const token = readCookie(c.req.header("cookie"), COOKIE_NAME);
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const sql = getSql();
  const rows = await sql`
    SELECT u.id
    FROM admin_sessions s
    JOIN admin_users u ON u.id = s.admin_user_id
    WHERE s.token_hash = ${hashToken(token)}
      AND s.expires_at > now()
      AND u.role = 'admin'
    LIMIT 1
  `;

  if (!rows.length) return c.json({ error: "unauthorized" }, 401);
  await next();
};
