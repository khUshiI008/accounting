import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import masterDB from "@/lib/masterDB";

/**
 * Returns a connection to the SINGLE shared database (u272022322_accounts)
 * along with the tenantId (userId) so every query can filter by tenant_id.
 *
 * Usage in any route:
 *   const { conn, tenantId, companyType } = await getTenantContext(request);
 *   const [rows] = await conn.query("SELECT * FROM products WHERE tenant_id = ?", [tenantId]);
 *   await conn.end();
 */
export async function getTenantContext(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("UNAUTHORIZED");
  }

  const token = authHeader.split(" ")[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new Error("INVALID_TOKEN");
  }

  const userId = decoded.userId;
  const companyType = decoded.companyType;

  // Verify tenant exists
  const [tenant] = await masterDB.query(
    "SELECT id FROM tenants WHERE user_id = ?",
    [userId]
  );
  if (tenant.length === 0) throw new Error("TENANT_NOT_FOUND");

  // Connect to the single shared DB (same as master DB)
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_DATABASE, // single shared DB
    port: process.env.DB_PORT,
  });

  return { conn, tenantId: userId, companyType };
}

export function handleError(error) {
  console.error(error);
  if (error.message === "UNAUTHORIZED")
    return { status: 401, message: "Unauthorized" };
  if (error.message === "INVALID_TOKEN")
    return { status: 401, message: "Invalid token" };
  if (error.message === "TENANT_NOT_FOUND")
    return { status: 404, message: "Tenant not found" };
  return { status: 500, message: "Internal server error" };
}
