import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import masterDB from "@/lib/masterDB";

// 🔹 Common Tenant Connection
async function getTenantConnection(request) {
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

  const [tenant] = await masterDB.query(
    "SELECT db_name FROM tenants WHERE user_id = ?",
    [userId]
  );

  if (tenant.length === 0) {
    throw new Error("TENANT_NOT_FOUND");
  }

  return await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: tenant[0].db_name,
  });
}

// GET - Fetch bank and cash accounts
export async function GET(request) {
  try {
    const conn = await getTenantConnection(request);

    // Get bank accounts
    const [banks] = await conn.query(
      `SELECT id, name, account_number, current_balance, 'bank' as account_type
       FROM Banks 
       ORDER BY name`
    );

    // Get cash accounts
    const [cash] = await conn.query(
      `SELECT id, name, current_balance, 'cash' as account_type
       FROM cashInHand 
       ORDER BY name`
    );

    await conn.end();

    return NextResponse.json({
      banks,
      cash,
      accounts: [...banks, ...cash]
    });
  } catch (error) {
    console.error("GET Accounts Error:", error);
    if (error.message === "UNAUTHORIZED" || error.message === "INVALID_TOKEN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { message: "Failed to fetch accounts" },
      { status: 500 }
    );
  }
}