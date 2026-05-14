import { NextResponse } from "next/server";
import { getTenantContext, handleError } from "@/lib/tenantDB";

async function updateAccountBalance(conn, paymentMethod, accountId, amount, isIncrease) {
  if (!accountId) return;
  const op = isIncrease ? "+" : "-";
  if (paymentMethod === "Cash") {
    await conn.query(`UPDATE cashInHand SET current_balance = current_balance ${op} ? WHERE id = ?`, [amount, accountId]);
  } else if (["Bank Transfer", "UPI", "Cheque", "Card"].includes(paymentMethod)) {
    await conn.query(`UPDATE Banks SET current_balance = current_balance ${op} ? WHERE id = ?`, [amount, accountId]);
  }
}

export async function POST(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;
    const { party_id, payment_date, payment_type, amount, payment_method, account_id, reference_number, notes } = await request.json();

    if (!party_id || !payment_date || !payment_type || !amount || !payment_method) {
      return NextResponse.json({ message: "Required fields missing" }, { status: 400 });
    }

    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO payments (tenant_id, party_id, payment_date, payment_type, amount, payment_method, account_id, reference_number, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, party_id, payment_date, payment_type, amount, payment_method, account_id || null, reference_number || null, notes || null]
    );

    if (account_id) {
      await updateAccountBalance(conn, payment_method, account_id, amount, payment_type === "received");
    }

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Payment saved successfully" }, { status: 201 });
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

    const [payments] = await conn.query(
      `SELECT p.*, pa.name AS party_name,
              CASE
                WHEN p.payment_method = 'Cash' THEN c.name
                WHEN p.payment_method IN ('Bank Transfer', 'UPI', 'Cheque', 'Card') THEN b.name
                ELSE NULL
              END AS account_name
       FROM payments p
       JOIN parties pa ON p.party_id = pa.id AND pa.tenant_id = ?
       LEFT JOIN cashInHand c ON p.account_id = c.id AND p.payment_method = 'Cash' AND c.tenant_id = ?
       LEFT JOIN Banks b ON p.account_id = b.id AND p.payment_method IN ('Bank Transfer', 'UPI', 'Cheque', 'Card') AND b.tenant_id = ?
       WHERE p.tenant_id = ?
       ORDER BY p.payment_date DESC, p.created_at DESC`,
      [tenantId, tenantId, tenantId, tenantId]
    );

    await conn.end();
    return NextResponse.json({ payments }, { status: 200 });
  } catch (error) {
    if (conn) await conn.end().catch(() => {});
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}

export async function PUT(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;
    const { id, party_id, payment_date, payment_type, amount, payment_method, account_id, reference_number, notes } = await request.json();

    if (!id || !party_id || !payment_date || !payment_type || !amount || !payment_method) {
      return NextResponse.json({ message: "Required fields missing" }, { status: 400 });
    }

    await conn.beginTransaction();

    const [oldPayment] = await conn.query(
      `SELECT payment_type, amount, payment_method, account_id FROM payments WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (oldPayment.length === 0) {
      await conn.rollback();
      return NextResponse.json({ message: "Payment not found" }, { status: 404 });
    }

    const old = oldPayment[0];
    if (old.account_id) {
      await updateAccountBalance(conn, old.payment_method, old.account_id, old.amount, old.payment_type === "paid");
    }

    await conn.query(
      `UPDATE payments SET party_id=?, payment_date=?, payment_type=?, amount=?, payment_method=?, account_id=?, reference_number=?, notes=?
       WHERE id=? AND tenant_id=?`,
      [party_id, payment_date, payment_type, amount, payment_method, account_id || null, reference_number || null, notes || null, id, tenantId]
    );

    if (account_id) {
      await updateAccountBalance(conn, payment_method, account_id, amount, payment_type === "received");
    }

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Payment updated successfully" }, { status: 200 });
  } catch (error) {
    if (conn) { await conn.rollback().catch(() => {}); await conn.end().catch(() => {}); }
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}

export async function DELETE(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;
    const { id } = await request.json();

    if (!id) return NextResponse.json({ message: "Payment ID required" }, { status: 400 });

    await conn.beginTransaction();

    const [payment] = await conn.query(
      `SELECT payment_type, amount, payment_method, account_id FROM payments WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (payment.length === 0) {
      await conn.rollback();
      return NextResponse.json({ message: "Payment not found" }, { status: 404 });
    }

    const p = payment[0];
    if (p.account_id) {
      await updateAccountBalance(conn, p.payment_method, p.account_id, p.amount, p.payment_type === "paid");
    }

    await conn.query(`DELETE FROM payments WHERE id = ? AND tenant_id = ?`, [id, tenantId]);

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Payment deleted successfully" }, { status: 200 });
  } catch (error) {
    if (conn) { await conn.rollback().catch(() => {}); await conn.end().catch(() => {}); }
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}
