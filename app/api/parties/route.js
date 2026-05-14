import { NextResponse } from "next/server";
import { getTenantContext, handleError } from "@/lib/tenantDB";

function isBank(t)  { return t === "bank_account"; }
function isCash(t)  { return t === "cash_in_hand"; }
function isParty(t) { return t === "sundry_debtor" || t === "sundry_creditor"; }
function isGST(t)   { return t === "gst"; }

export async function POST(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;
    const body = await request.json();
    const { party_type } = body;

    if (!party_type) {
      return NextResponse.json({ message: "party_type is required" }, { status: 400 });
    }

    let insertId;

    if (isBank(party_type)) {
      const { name, account_number, ifsc_code, branch_name, opening_balance } = body;
      if (!name || !account_number || !ifsc_code || !branch_name) {
        return NextResponse.json(
          { message: "name, account_number, ifsc_code and branch_name are required" },
          { status: 400 }
        );
      }
      const [result] = await conn.query(
        `INSERT INTO Banks (tenant_id, name, account_number, IFSC_code, branch_name, opening_balance, current_balance)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tenantId, name, account_number, ifsc_code, branch_name, opening_balance || 0, opening_balance || 0]
      );
      insertId = result.insertId;
    }

    else if (isCash(party_type)) {
      const { name, opening_balance } = body;
      if (!name) return NextResponse.json({ message: "name is required" }, { status: 400 });
      const [result] = await conn.query(
        `INSERT INTO cashInHand (tenant_id, name, opening_balance, current_balance) VALUES (?, ?, ?, ?)`,
        [tenantId, name, opening_balance || 0, opening_balance || 0]
      );
      insertId = result.insertId;
    }

    else if (isParty(party_type)) {
      const { name, mobile, city, gst_status, gst_number, opening_balance, credit_limit } = body;
      if (!name) return NextResponse.json({ message: "name is required" }, { status: 400 });
      const [result] = await conn.query(
        `INSERT INTO parties (tenant_id, name, mobile, city, gst_status, gst_number, opening_balance, creditLimit, party_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId, name, mobile || null, city || null,
          gst_status || "Non-GST", gst_number || null,
          opening_balance || 0,
          party_type === "sundry_debtor" ? (credit_limit || 0) : 0,
          party_type,
        ]
      );
      insertId = result.insertId;
    }

    else if (isGST(party_type)) {
      const { name, gst_percentage, current_text } = body;
      if (!name) return NextResponse.json({ message: "name is required" }, { status: 400 });
      const [result] = await conn.query(
        `INSERT INTO parties (tenant_id, name, gst_percentage, current_tax, party_type) VALUES (?, ?, ?, ?, ?)`,
        [tenantId, name, gst_percentage || 0, current_text || 0, party_type]
      );
      insertId = result.insertId;
    }

    else {
      return NextResponse.json({ message: "Invalid party_type" }, { status: 400 });
    }

    return NextResponse.json({ message: "Record created successfully", id: insertId }, { status: 201 });
  } catch (error) {
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

export async function GET(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;

    const [banks] = await conn.query(
      `SELECT id, name, account_number, IFSC_code AS ifsc_code, branch_name,
              opening_balance, current_balance, created_at, 'bank_account' AS party_type
       FROM Banks WHERE tenant_id = ? ORDER BY created_at DESC`,
      [tenantId]
    );

    const [cash] = await conn.query(
      `SELECT id, name, opening_balance, current_balance, created_at, 'cash_in_hand' AS party_type
       FROM cashInHand WHERE tenant_id = ? ORDER BY created_at DESC`,
      [tenantId]
    );

    const [parties] = await conn.query(
      `SELECT id, name, mobile, city, gst_status, gst_number,
              creditLimit AS credit_limit, opening_balance, created_at, party_type,
              gst_percentage, current_tax AS current_text
       FROM parties WHERE tenant_id = ? ORDER BY created_at DESC`,
      [tenantId]
    );

    return NextResponse.json({ parties: [...banks, ...cash, ...parties] }, { status: 200 });
  } catch (error) {
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

export async function PUT(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;
    const body = await request.json();
    const { id, party_type } = body;

    if (!id || !party_type) {
      return NextResponse.json({ message: "id and party_type are required" }, { status: 400 });
    }

    if (isBank(party_type)) {
      const { name, account_number, ifsc_code, branch_name, opening_balance } = body;
      await conn.query(
        `UPDATE Banks SET name=?, account_number=?, IFSC_code=?, branch_name=?, opening_balance=?
         WHERE id=? AND tenant_id=?`,
        [name, account_number, ifsc_code, branch_name, opening_balance || 0, id, tenantId]
      );
    } else if (isCash(party_type)) {
      const { name, opening_balance } = body;
      await conn.query(
        `UPDATE cashInHand SET name=?, opening_balance=? WHERE id=? AND tenant_id=?`,
        [name, opening_balance || 0, id, tenantId]
      );
    } else if (isParty(party_type)) {
      const { name, mobile, city, gst_status, gst_number, opening_balance, credit_limit } = body;
      await conn.query(
        `UPDATE parties SET name=?, mobile=?, city=?, gst_status=?, gst_number=?,
         opening_balance=?, creditLimit=?, party_type=? WHERE id=? AND tenant_id=?`,
        [name, mobile || null, city || null, gst_status || "Non-GST", gst_number || null,
         opening_balance || 0, party_type === "sundry_debtor" ? (credit_limit || 0) : 0,
         party_type, id, tenantId]
      );
    } else if (isGST(party_type)) {
      const { name, gst_percentage, current_text } = body;
      await conn.query(
        `UPDATE parties SET name=?, gst_percentage=?, current_tax=?, party_type=? WHERE id=? AND tenant_id=?`,
        [name, gst_percentage || 0, current_text || 0, party_type, id, tenantId]
      );
    } else {
      return NextResponse.json({ message: "Invalid party_type" }, { status: 400 });
    }

    return NextResponse.json({ message: "Record updated successfully" }, { status: 200 });
  } catch (error) {
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

export async function DELETE(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;
    const { id, party_type } = await request.json();

    if (!id || !party_type) {
      return NextResponse.json({ message: "id and party_type are required" }, { status: 400 });
    }

    if (isBank(party_type))
      await conn.query("DELETE FROM Banks WHERE id=? AND tenant_id=?", [id, tenantId]);
    else if (isCash(party_type))
      await conn.query("DELETE FROM cashInHand WHERE id=? AND tenant_id=?", [id, tenantId]);
    else if (isParty(party_type) || isGST(party_type))
      await conn.query("DELETE FROM parties WHERE id=? AND tenant_id=?", [id, tenantId]);
    else
      return NextResponse.json({ message: "Invalid party_type" }, { status: 400 });

    return NextResponse.json({ message: "Record deleted successfully" }, { status: 200 });
  } catch (error) {
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}
