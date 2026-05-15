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
// 🔹 CREATE PURCHASE (WITH ITEMS)
//////////////////////////////////////////////////////////////////
export async function POST(request) {
  const { connection: conn } = await getTenantConnection(request);
  try {
    const body = await request.json();
    const { bill_number, party, date, state, gst_party_id, itemsList } = body;

    if (!party || !date || !itemsList || itemsList.length === 0) {
      return NextResponse.json({ message: "Required fields missing" }, { status: 400 });
    }

    // Get GST percentage from GST party if selected
    let gstPercent = 0;
    if (gst_party_id) {
      const [gstParty] = await conn.query(
        "SELECT gst_percentage FROM parties WHERE id = ? AND party_type = 'gst'",
        [gst_party_id]
      );
      if (gstParty.length > 0) {
        gstPercent = gstParty[0].gst_percentage;
      }
    }

    await conn.beginTransaction();

    let subtotal = 0;
    const totalItems = itemsList.length;
    itemsList.forEach((item) => { subtotal += item.qty * item.price; });
    const gstAmount = (subtotal * gstPercent) / 100;
    const totalAmount = subtotal + gstAmount;

    const [purchaseResult] = await conn.query(
      `INSERT INTO purchases (bill_number, party_id, date, state, subtotal, total_items, gst_percent, gst_amount, total_amount, gst_party_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bill_number, party, date, state, subtotal, totalItems, gstPercent, gstAmount, totalAmount, gst_party_id || null]
    );
    const purchaseId = purchaseResult.insertId;

    for (const item of itemsList) {
      await conn.query(
        `INSERT INTO purchase_items (purchase_id, item_id, quantity, price, total) VALUES (?, ?, ?, ?, ?)`,
        [purchaseId, item.id, item.qty, item.price, item.qty * item.price]
      );
      // Always increase stock on purchase
      await conn.query(`UPDATE products SET stock = stock + ? WHERE id = ?`, [item.qty, item.id]);
    }

    // Update GST party current_tax if GST was applied
    if (gst_party_id && gstAmount > 0) {
      await conn.query(
        `UPDATE parties SET current_tax = current_tax + ? WHERE id = ? AND party_type = 'gst'`,
        [gstAmount, gst_party_id]
      );
    }

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Purchase saved successfully" }, { status: 201 });
  } catch (error) {
    await conn.rollback();
    await conn.end();
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 GET ALL PURCHASES
//////////////////////////////////////////////////////////////////
export async function GET(request) {
  try {
    const { connection: conn } = await getTenantConnection(request);

    const [purchases] = await conn.query(
      `SELECT p.*, pa.name AS party_name, gst_pa.name AS gst_party_name, gst_pa.gst_percentage
       FROM purchases p
       JOIN parties pa ON p.party_id = pa.id
       LEFT JOIN parties gst_pa ON p.gst_party_id = gst_pa.id AND gst_pa.party_type = 'gst'
       ORDER BY p.created_at DESC`
    );

    for (let purchase of purchases) {
      const [items] = await conn.query(
        `SELECT pi.*, pr.name FROM purchase_items pi JOIN products pr ON pi.item_id = pr.id WHERE pi.purchase_id = ?`,
        [purchase.id]
      );
      purchase.items = items;
    }

    await conn.end();
    return NextResponse.json({ purchases }, { status: 200 });
  } catch (error) {
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 UPDATE PURCHASE
//////////////////////////////////////////////////////////////////
export async function PUT(request) {
  const { connection: conn } = await getTenantConnection(request);
  try {
    const body = await request.json();
    const { id, bill_number, party, date, state, gst_party_id, TDS, itemsList } = body;

    if (!id || !party || !date || !itemsList || itemsList.length === 0) {
      return NextResponse.json({ message: "Required fields missing" }, { status: 400 });
    }

    // Get GST percentage from GST party if selected
    let gstPercent = 0;
    if (gst_party_id) {
      const [gstParty] = await conn.query(
        "SELECT gst_percentage FROM parties WHERE id = ? AND party_type = 'gst'",
        [gst_party_id]
      );
      if (gstParty.length > 0) {
        gstPercent = gstParty[0].gst_percentage;
      }
    }

    await conn.beginTransaction();

    let subtotal = 0;
    const totalItems = itemsList.length;
    itemsList.forEach((item) => { subtotal += item.qty * item.price; });
    const gstAmount = (subtotal * gstPercent) / 100;
    const tdsAmount = (subtotal * (TDS || 0)) / 100;
    const totalAmount = subtotal + gstAmount - tdsAmount;

    await conn.query(
      `UPDATE purchases SET bill_number = ?, party_id = ?, date = ?, state = ?, subtotal = ?, total_items = ?, gst_percent = ?, gst_amount = ?, tds_percent = ?, tds_amount = ?, total_amount = ?, gst_party_id = ? WHERE id = ?`,
      [bill_number, party, date, state, subtotal, totalItems, gstPercent, gstAmount, TDS || 0, tdsAmount, totalAmount, gst_party_id || null, id]
    );

    // Restore old stock before re-inserting
    const [oldItems] = await conn.query(`SELECT item_id, quantity FROM purchase_items WHERE purchase_id = ?`, [id]);
    for (const item of oldItems) {
      await conn.query(`UPDATE products SET stock = stock - ? WHERE id = ?`, [item.quantity, item.item_id]);
    }

    await conn.query(`DELETE FROM purchase_items WHERE purchase_id = ?`, [id]);

    // Insert new items and increase stock
    for (const item of itemsList) {
      await conn.query(
        `INSERT INTO purchase_items (purchase_id, item_id, quantity, price, total) VALUES (?, ?, ?, ?, ?)`,
        [id, item.id, item.qty, item.price, item.qty * item.price]
      );
      await conn.query(`UPDATE products SET stock = stock + ? WHERE id = ?`, [item.qty, item.id]);
    }

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Purchase updated successfully" }, { status: 200 });
  } catch (error) {
    await conn.rollback();
    await conn.end();
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 DELETE PURCHASE
//////////////////////////////////////////////////////////////////
export async function DELETE(request) {
  const { connection: conn } = await getTenantConnection(request);
  try {
    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ message: "Purchase ID required" }, { status: 400 });
    }

    await conn.beginTransaction();

    // Restore stock when deleting a purchase
    const [items] = await conn.query(`SELECT item_id, quantity FROM purchase_items WHERE purchase_id = ?`, [id]);
    for (const item of items) {
      await conn.query(`UPDATE products SET stock = stock - ? WHERE id = ?`, [item.quantity, item.item_id]);
    }

    await conn.query(`DELETE FROM purchase_items WHERE purchase_id = ?`, [id]);
    await conn.query(`DELETE FROM purchases WHERE id = ?`, [id]);

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Purchase deleted successfully" }, { status: 200 });
  } catch (error) {
    await conn.rollback();
    await conn.end();
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