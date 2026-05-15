import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import masterDB from "@/lib/masterDB";

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
  const [tenant] = await masterDB.query("SELECT db_name FROM tenants WHERE user_id = ?", [userId]);
  if (tenant.length === 0) {
    throw new Error("TENANT_NOT_FOUND");
  }
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: tenant[0].db_name,
  });
  return { connection };
}

//////////////////////////////////////////////////////////////////
// 🔹 CREATE CHALLAN (WITH ITEMS)
//////////////////////////////////////////////////////////////////
export async function POST(request) {
  let conn;
  try {
    ({ connection: conn } = await getTenantConnection(request));
    const body = await request.json();
    const { party, itemsList, amount } = body;

    if (!party || !amount || !itemsList || itemsList.length === 0) {
      return NextResponse.json({ message: "Required fields missing" }, { status: 400 });
    }

    await conn.beginTransaction();

    const [challanResult] = await conn.query(
      `INSERT INTO challans (party_id, amount) VALUES (?, ?)`,
      [party, amount]
    );
    const challanId = challanResult.insertId;

    for (const item of itemsList) {
      await conn.query(
        `INSERT INTO challan_items (challan_id, item_id, quantity) VALUES (?, ?, ?)`,
        [challanId, item.id, item.qty]
      );
    }

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Challan saved successfully" }, { status: 201 });
  } catch (error) {
    if (conn) { await conn.rollback(); await conn.end(); }
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 GET ALL CHALLANS
//////////////////////////////////////////////////////////////////
export async function GET(request) {
  let conn;
  try {
    ({ connection: conn } = await getTenantConnection(request));

    const [challans] = await conn.query(
      `SELECT c.*, pa.name AS party_name
       FROM challans c
       JOIN parties pa ON c.party_id = pa.id
       ORDER BY c.created_at DESC`
    );

    for (let challan of challans) {
      const [items] = await conn.query(
        `SELECT ci.*, pr.name FROM challan_items ci JOIN products pr ON ci.item_id = pr.id WHERE ci.challan_id = ?`,
        [challan.id]
      );
      challan.items = items;
    }

    await conn.end();
    return NextResponse.json({ challans }, { status: 200 });
  } catch (error) {
    if (conn) await conn.end();
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 UPDATE CHALLAN
//////////////////////////////////////////////////////////////////
export async function PUT(request) {
  let conn;
  try {
    ({ connection: conn } = await getTenantConnection(request));
    const body = await request.json();
    const { id, party, itemsList, amount } = body;

    if (!id || !party || !amount || !itemsList || itemsList.length === 0) {
      return NextResponse.json({ message: "Required fields missing" }, { status: 400 });
    }

    await conn.beginTransaction();

    await conn.query(
      `UPDATE challans SET party_id = ?, amount = ? WHERE id = ?`,
      [party, amount, id]
    );

    await conn.query(`DELETE FROM challan_items WHERE challan_id = ?`, [id]);

    for (const item of itemsList) {
      await conn.query(
        `INSERT INTO challan_items (challan_id, item_id, quantity) VALUES (?, ?, ?)`,
        [id, item.id, item.qty]
      );
    }

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Challan updated successfully" }, { status: 200 });
  } catch (error) {
    if (conn) { await conn.rollback(); await conn.end(); }
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 DELETE CHALLAN
//////////////////////////////////////////////////////////////////
export async function DELETE(request) {
  let conn;
  try {
    ({ connection: conn } = await getTenantConnection(request));
    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ message: "Challan ID required" }, { status: 400 });
    }

    await conn.beginTransaction();

    await conn.query(`DELETE FROM challan_items WHERE challan_id = ?`, [id]);
    await conn.query(`DELETE FROM challans WHERE id = ?`, [id]);

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Challan deleted successfully" }, { status: 200 });
  } catch (error) {
    if (conn) { await conn.rollback(); await conn.end(); }
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 ERROR HANDLER
//////////////////////////////////////////////////////////////////
function handleError(error) {
  console.error(error);
  if (error.message === "UNAUTHORIZED") {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  if (error.message === "INVALID_TOKEN") {
    return NextResponse.json({ message: "Invalid token" }, { status: 401 });
  }
  if (error.message === "TENANT_NOT_FOUND") {
    return NextResponse.json({ message: "Tenant not found" }, { status: 404 });
  }
  return NextResponse.json({ message: "Internal server error" }, { status: 500 });
}