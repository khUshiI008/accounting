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

export async function GET(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;

    const [expenses] = await conn.execute(
      `SELECT e.*, DATE_FORMAT(e.expense_date, '%Y-%m-%d') as expense_date,
        CASE
          WHEN e.payment_method = 'Cash' THEN c.name
          WHEN e.payment_method IN ('Bank Transfer', 'UPI', 'Cheque', 'Card') THEN b.name
          ELSE NULL
        END AS account_name
       FROM expenses e
       LEFT JOIN cashInHand c ON e.account_id = c.id AND e.payment_method = 'Cash' AND c.tenant_id = ?
       LEFT JOIN Banks b ON e.account_id = b.id AND e.payment_method IN ('Bank Transfer', 'UPI', 'Cheque', 'Card') AND b.tenant_id = ?
       WHERE e.tenant_id = ?
       ORDER BY e.expense_date DESC`,
      [tenantId, tenantId, tenantId]
    );

    await conn.end();
    return NextResponse.json({ expenses });
  } catch (error) {
    if (conn) await conn.end().catch(() => {});
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}

export async function POST(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;
    const { expense_date, amount, description, category, payment_method, account_id } = await request.json();

    if (!expense_date || !amount || !description || !category || !payment_method) {
      return NextResponse.json({ message: "All required fields are required" }, { status: 400 });
    }

    await conn.beginTransaction();

    const [result] = await conn.execute(
      `INSERT INTO expenses (tenant_id, expense_date, amount, description, category, payment_method, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, expense_date, amount, description, category, payment_method, account_id || null]
    );

    if (account_id) await updateAccountBalance(conn, payment_method, account_id, amount, false);

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Expense created successfully", id: result.insertId }, { status: 201 });
  } catch (error) {
    if (conn) { await conn.rollback().catch(() => {}); await conn.end().catch(() => {}); }
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}

export async function PUT(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;
    const { id, expense_date, amount, description, category, payment_method, account_id } = await request.json();

    if (!id || !expense_date || !amount || !description || !category || !payment_method) {
      return NextResponse.json({ message: "All required fields are required" }, { status: 400 });
    }

    await conn.beginTransaction();

    const [oldExpense] = await conn.execute(
      `SELECT amount, payment_method, account_id FROM expenses WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (oldExpense.length === 0) {
      await conn.rollback();
      return NextResponse.json({ message: "Expense not found" }, { status: 404 });
    }

    const old = oldExpense[0];
    if (old.account_id) await updateAccountBalance(conn, old.payment_method, old.account_id, old.amount, true);

    await conn.execute(
      `UPDATE expenses SET expense_date=?, amount=?, description=?, category=?, payment_method=?, account_id=?
       WHERE id=? AND tenant_id=?`,
      [expense_date, amount, description, category, payment_method, account_id || null, id, tenantId]
    );

    if (account_id) await updateAccountBalance(conn, payment_method, account_id, amount, false);

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Expense updated successfully" });
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

    if (!id) return NextResponse.json({ message: "Expense ID is required" }, { status: 400 });

    await conn.beginTransaction();

    const [expense] = await conn.execute(
      `SELECT amount, payment_method, account_id FROM expenses WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (expense.length === 0) {
      await conn.rollback();
      return NextResponse.json({ message: "Expense not found" }, { status: 404 });
    }

    const exp = expense[0];
    if (exp.account_id) await updateAccountBalance(conn, exp.payment_method, exp.account_id, exp.amount, true);

    await conn.execute(`DELETE FROM expenses WHERE id = ? AND tenant_id = ?`, [id, tenantId]);

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Expense deleted successfully" });
  } catch (error) {
    if (conn) { await conn.rollback().catch(() => {}); await conn.end().catch(() => {}); }
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}
