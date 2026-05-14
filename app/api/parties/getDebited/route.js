import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import masterDB from "@/lib/masterDB";
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
export async function GET(request) {
  let conn;
  try {
    conn = await getTenantConnection(request);

    // ✅ Get type from query params
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // sundry_debtor / sundry_creditor

    const [banks] = await conn.query(
      `SELECT id, name, account_number, IFSC_code AS ifsc_code, branch_name,
              opening_balance, current_balance, created_at,
              'bank_account' AS party_type
       FROM Banks`
    );

    const [cash] = await conn.query(
      `SELECT id, name, opening_balance, current_balance, created_at,
              'cash_in_hand' AS party_type
       FROM cashInHand`
    );

    // ✅ Directly using party_type (no alias needed now)
    const [parties] = await conn.query(
      `SELECT id, name, mobile, city, gst_status, gst_number,
              creditLimit AS credit_limit, opening_balance, created_at,
              party_type, gst_percentage, current_tax AS current_text
       FROM parties
       ${type ? "WHERE party_type = ?" : ""}
       ORDER BY created_at DESC`,
      type ? [type] : []
    );

    let allData = [...banks, ...cash, ...parties];

    // ✅ If filtering for only party types (debtor/creditor)
    if (type) {
      allData = allData.filter(item => item.party_type === type);
    }

    return NextResponse.json({ parties: allData }, { status: 200 });

  } catch (error) {
    return handleError(error);
  } finally {
    if (conn) await conn.end();
  }
}