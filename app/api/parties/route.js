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

// ─── Route helpers ────────────────────────────────────────────────────────────
function isBank(t)    { return t === "bank_account"; }
function isCash(t)    { return t === "cash_in_hand"; }
function isParty(t)   { return t === "sundry_debtor" || t === "sundry_creditor"; }
function isGST(t)     { return t === "gst"; }

//////////////////////////////////////////////////////////////////
// 🔹 POST — Create
//////////////////////////////////////////////////////////////////
export async function POST(request) {
  let conn;
  try {
    conn = await getTenantConnection(request);
    const body = await request.json();
    const { party_type } = body;
    console.log("req reached:", body);
    console.log("party_type:", party_type);

    if (!party_type) {
      return NextResponse.json({ message: "party_type is required" }, { status: 400 });
    }

    let insertId;

    // ── Bank Account ──────────────────────────────────────────
    if (isBank(party_type)) {
      const { name, account_number, ifsc_code, branch_name, opening_balance } = body;

      if (!name || !account_number || !ifsc_code || !branch_name) {
        return NextResponse.json(
          { message: "name, account_number, ifsc_code and branch_name are required" },
          { status: 400 }
        );
      }

      const [result] = await conn.query(
        `INSERT INTO Banks (name, account_number, IFSC_code, branch_name, opening_balance, current_balance)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, account_number, ifsc_code, branch_name, opening_balance || 0, opening_balance || 0]
      );
      insertId = result.insertId;
    }

    // ── Cash in Hand ──────────────────────────────────────────
    else if (isCash(party_type)) {
      const { name, opening_balance } = body;

      if (!name) {
        return NextResponse.json({ message: "name is required" }, { status: 400 });
      }

      const [result] = await conn.query(
        `INSERT INTO cashInHand (name, opening_balance, current_balance)
         VALUES (?, ?, ?)`,
        [name, opening_balance || 0, opening_balance || 0]
      );
      insertId = result.insertId;
    }

    // ── Sundry Debtor / Creditor ──────────────────────────────
    else if (isParty(party_type)) {
      const { name, mobile, city, gst_status, gst_number, opening_balance, credit_limit } = body;

      if (!name) {
        return NextResponse.json({ message: "name is required" }, { status: 400 });
      }

      const [result] = await conn.query(
        `INSERT INTO parties 
          (name, mobile, city, gst_status, gst_number, opening_balance, creditLimit, party_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          mobile         || null,
          city           || null,
          gst_status     || "Non-GST",
          gst_number     || null,
          opening_balance || 0,
          party_type === "sundry_debtor" ? (credit_limit || 0) : 0,
          party_type,
        ]
      );
      insertId = result.insertId;
    }

    // ── GST Party Type ────────────────────────────────────────
    else if (isGST(party_type)) {
      const { name, gst_percentage, current_text } = body;

      if (!name) {
        return NextResponse.json({ message: "name is required" }, { status: 400 });
      }

      const [result] = await conn.query(
        `INSERT INTO parties 
          (name, gst_percentage, current_tax, party_type)
         VALUES (?, ?, ?, ?)`,
        [
          name,
          gst_percentage || 0,
          current_text || 0,
          party_type,
        ]
      );
      insertId = result.insertId;
    }

    else {
      return NextResponse.json({ message: "Invalid party_type" }, { status: 400 });
    }

    return NextResponse.json(
      { message: "Record created successfully", id: insertId },
      { status: 201 }
    );
  } catch (error) {
    return handleError(error);
  } finally {
    if (conn) await conn.end();
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 GET — Fetch all (banks + cash + parties unified)
//////////////////////////////////////////////////////////////////
export async function GET(request) {
  let conn;
  try {
    conn = await getTenantConnection(request);

    const [banks] = await conn.query(
      `SELECT id, name, account_number, IFSC_code AS ifsc_code, branch_name,
              opening_balance, current_balance, created_at,
              'bank_account' AS party_type
       FROM Banks ORDER BY created_at DESC`
    );

    const [cash] = await conn.query(
      `SELECT id, name, opening_balance, current_balance, created_at,
              'cash_in_hand' AS party_type
       FROM cashInHand ORDER BY created_at DESC`
    );

    const [parties] = await conn.query(
      `SELECT id, name, mobile, city, gst_status, gst_number,
              creditLimit AS credit_limit, opening_balance, created_at, party_type,
              gst_percentage, current_tax AS current_text
       FROM parties ORDER BY created_at DESC`
    );

    // Return all in one array — frontend filters by party_type
    return NextResponse.json(
      { parties: [...banks, ...cash, ...parties] },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  } finally {
    if (conn) await conn.end();
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 PUT — Update
//////////////////////////////////////////////////////////////////
export async function PUT(request) {
  let conn;
  try {
    conn = await getTenantConnection(request);
    const body = await request.json();
    const { id, party_type } = body;

    if (!id || !party_type) {
      return NextResponse.json({ message: "id and party_type are required" }, { status: 400 });
    }

    // ── Bank Account ──────────────────────────────────────────
    if (isBank(party_type)) {
      const { name, account_number, ifsc_code, branch_name, opening_balance } = body;

      await conn.query(
        `UPDATE Banks
         SET name=?, account_number=?, IFSC_code=?, branch_name=?, opening_balance=?
         WHERE id=?`,
        [name, account_number, ifsc_code, branch_name, opening_balance || 0, id]
      );
    }

    // ── Cash in Hand ──────────────────────────────────────────
    else if (isCash(party_type)) {
      const { name, opening_balance } = body;

      await conn.query(
        `UPDATE cashInHand SET name=?, opening_balance=? WHERE id=?`,
        [name, opening_balance || 0, id]
      );
    }

    // ── Sundry Debtor / Creditor ──────────────────────────────
    else if (isParty(party_type)) {
      const { name, mobile, city, gst_status, gst_number, opening_balance, credit_limit } = body;

      await conn.query(
        `UPDATE parties
         SET name=?, mobile=?, city=?, gst_status=?, gst_number=?,
             opening_balance=?, creditLimit=?, party_type=?
         WHERE id=?`,
        [
          name,
          mobile      || null,
          city        || null,
          gst_status  || "Non-GST",
          gst_number  || null,
          opening_balance || 0,
          party_type === "sundry_debtor" ? (credit_limit || 0) : 0,
          party_type,
          id,
        ]
      );
    }

    // ── GST Party Type ────────────────────────────────────────
    else if (isGST(party_type)) {
      const { name, gst_percentage, current_text } = body;

      await conn.query(
        `UPDATE parties
         SET name=?, gst_percentage=?, current_tax=?, party_type=?
         WHERE id=?`,
        [
          name,
          gst_percentage || 0,
          current_text || 0,
          party_type,
          id,
        ]
      );
    }

    else {
      return NextResponse.json({ message: "Invalid party_type" }, { status: 400 });
    }

    return NextResponse.json({ message: "Record updated successfully" }, { status: 200 });
  } catch (error) {
    return handleError(error);
  } finally {
    if (conn) await conn.end();
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 DELETE
//////////////////////////////////////////////////////////////////
export async function DELETE(request) {
  let conn;
  try {
    conn = await getTenantConnection(request);
    const { id, party_type } = await request.json();

    if (!id || !party_type) {
      return NextResponse.json({ message: "id and party_type are required" }, { status: 400 });
    }

    if (isBank(party_type))        await conn.query("DELETE FROM Banks       WHERE id=?", [id]);
    else if (isCash(party_type))   await conn.query("DELETE FROM cashInHand  WHERE id=?", [id]);
    else if (isParty(party_type) || isGST(party_type))  await conn.query("DELETE FROM parties     WHERE id=?", [id]);
    else return NextResponse.json({ message: "Invalid party_type" }, { status: 400 });

    return NextResponse.json({ message: "Record deleted successfully" }, { status: 200 });
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