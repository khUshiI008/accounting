import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import masterDB from "@/lib/masterDB";

// ─── Common: Get tenant connection ────────────────────────────────────────────
async function getTenantConnection(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");

  const token = authHeader.split(" ")[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new Error("INVALID_TOKEN");
  }

  const [tenant] = await masterDB.query(
    "SELECT db_name FROM tenants WHERE user_id = ?",
    [decoded.userId]
  );
  if (tenant.length === 0) throw new Error("TENANT_NOT_FOUND");

  return await mysql.createConnection({
    host:     process.env.DB_HOST,
    user:     process.env.DB_USER,
    password: process.env.DB_PASS,
    database: tenant[0].db_name,
  });
}

//////////////////////////////////////////////////////////////////
// 🔹 GET — Fetch GST parties only
//////////////////////////////////////////////////////////////////
export async function GET(request) {
  let conn;
  try {
    conn = await getTenantConnection(request);

    const [gstParties] = await conn.query(
      `SELECT id, name, gst_percentage, current_tax AS current_text
       FROM parties 
       WHERE party_type = 'gst'
       ORDER BY name ASC`
    );

    return NextResponse.json(
      { gstParties },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  } finally {
    if (conn) await conn.end();
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 Error Handler
//////////////////////////////////////////////////////////////////
function handleError(error) {
  console.error(error);
  if (error.message === "UNAUTHORIZED")     return NextResponse.json({ message: "Unauthorized" },        { status: 401 });
  if (error.message === "INVALID_TOKEN")    return NextResponse.json({ message: "Invalid token" },       { status: 401 });
  if (error.message === "TENANT_NOT_FOUND") return NextResponse.json({ message: "Tenant not found" },    { status: 404 });
  return NextResponse.json({ message: "Internal server error" }, { status: 500 });
}