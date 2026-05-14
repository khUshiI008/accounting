import { NextResponse } from "next/server";
import { getTenantContext, handleError } from "@/lib/tenantDB";

async function updateAccountBalance(conn, accountType, accountId, amount, isIncrease) {
  const op = isIncrease ? "+" : "-";
  if (accountType === "cash") {
    await conn.query(`UPDATE cashInHand SET current_balance = current_balance ${op} ? WHERE id = ?`, [amount, accountId]);
  } else if (accountType === "bank") {
    await conn.query(`UPDATE Banks SET current_balance = current_balance ${op} ? WHERE id = ?`, [amount, accountId]);
  }
}

async function checkAccountBalance(conn, accountType, accountId, requiredAmount) {
  let result;
  if (accountType === "cash") {
    [result] = await conn.query(`SELECT current_balance FROM cashInHand WHERE id = ?`, [accountId]);
  } else {
    [result] = await conn.query(`SELECT current_balance FROM Banks WHERE id = ?`, [accountId]);
  }
  return Number(result[0]?.current_balance || 0) >= Number(requiredAmount);
}

export async function POST(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;
    const { from_account_type, from_account_id, to_account_type, to_account_id, amount, transfer_date, description } = await request.json();

    if (!from_account_type || !from_account_id || !to_account_type || !to_account_id || !amount || !transfer_date) {
      return NextResponse.json({ message: "All required fields must be provided" }, { status: 400 });
    }
    if (from_account_type === to_account_type && String(from_account_id) === String(to_account_id)) {
      return NextResponse.json({ message: "Cannot transfer to the same account" }, { status: 400 });
    }
    if (Number(amount) <= 0) {
      return NextResponse.json({ message: "Transfer amount must be greater than 0" }, { status: 400 });
    }

    await conn.beginTransaction();

    const hasFunds = await checkAccountBalance(conn, from_account_type, from_account_id, amount);
    if (!hasFunds) {
      await conn.rollback();
      return NextResponse.json({ message: "Insufficient balance in source account" }, { status: 400 });
    }

    const [result] = await conn.query(
      `INSERT INTO bank_vouchers (tenant_id, from_account_type, from_account_id, to_account_type, to_account_id, amount, transfer_date, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, from_account_type, from_account_id, to_account_type, to_account_id, amount, transfer_date, description || null]
    );

    await updateAccountBalance(conn, from_account_type, from_account_id, amount, false);
    await updateAccountBalance(conn, to_account_type, to_account_id, amount, true);

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Transfer completed successfully", id: result.insertId }, { status: 201 });
  } catch (error) {
    if (conn) { await conn.rollback().catch(() => {}); await conn.end().catch(() => {}); }
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}

export async function GET(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;

    const [transfers] = await conn.query(
      `SELECT bv.*,
        CASE WHEN bv.from_account_type = 'cash' THEN c1.name WHEN bv.from_account_type = 'bank' THEN b1.name END AS from_account_name,
        CASE WHEN bv.to_account_type = 'cash' THEN c2.name WHEN bv.to_account_type = 'bank' THEN b2.name END AS to_account_name
       FROM bank_vouchers bv
       LEFT JOIN cashInHand c1 ON bv.from_account_id = c1.id AND bv.from_account_type = 'cash' AND c1.tenant_id = ?
       LEFT JOIN Banks b1 ON bv.from_account_id = b1.id AND bv.from_account_type = 'bank' AND b1.tenant_id = ?
       LEFT JOIN cashInHand c2 ON bv.to_account_id = c2.id AND bv.to_account_type = 'cash' AND c2.tenant_id = ?
       LEFT JOIN Banks b2 ON bv.to_account_id = b2.id AND bv.to_account_type = 'bank' AND b2.tenant_id = ?
       WHERE bv.tenant_id = ?
       ORDER BY bv.transfer_date DESC, bv.created_at DESC`,
      [tenantId, tenantId, tenantId, tenantId, tenantId]
    );

    await conn.end();
    return NextResponse.json({ transfers });
  } catch (error) {
    if (conn) await conn.end().catch(() => {});
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}
