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

// 🔹 Helper function to update bank/cash balances
async function updateAccountBalance(conn, paymentMethod, accountId, amount, isIncrease) {
  if (!accountId) return; // Skip if no account selected

  const operation = isIncrease ? '+' : '-';
  
  if (paymentMethod === 'Cash') {
    await conn.query(
      `UPDATE cashInHand SET current_balance = current_balance ${operation} ? WHERE id = ?`,
      [amount, accountId]
    );
  } else if (['Bank Transfer', 'UPI', 'Cheque', 'Card'].includes(paymentMethod)) {
    await conn.query(
      `UPDATE Banks SET current_balance = current_balance ${operation} ? WHERE id = ?`,
      [amount, accountId]
    );
  }
}

// GET - Fetch all expenses
export async function GET(request) {
  try {
    const conn = await getTenantConnection(request);

    const [expenses] = await conn.execute(
      `SELECT 
        e.*,
        DATE_FORMAT(e.expense_date, '%Y-%m-%d') as expense_date,
        CASE 
          WHEN e.payment_method = 'Cash' THEN c.name
          WHEN e.payment_method IN ('Bank Transfer', 'UPI', 'Cheque', 'Card') THEN b.name
          ELSE NULL
        END AS account_name
       FROM expenses e 
       LEFT JOIN cashInHand c ON e.account_id = c.id AND e.payment_method = 'Cash'
       LEFT JOIN Banks b ON e.account_id = b.id AND e.payment_method IN ('Bank Transfer', 'UPI', 'Cheque', 'Card')
       ORDER BY e.expense_date DESC`
    );

    await conn.end();
    return NextResponse.json({ expenses });
  } catch (error) {
    console.error("GET Expenses Error:", error);
    if (error.message === "UNAUTHORIZED" || error.message === "INVALID_TOKEN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { message: "Failed to fetch expenses" },
      { status: 500 }
    );
  }
}

// POST - Create new expense
export async function POST(request) {
  const conn = await getTenantConnection(request);

  try {
    const { expense_date, amount, description, category, payment_method, account_id } = await request.json();

    if (!expense_date || !amount || !description || !category || !payment_method) {
      await conn.end();
      return NextResponse.json(
        { message: "All required fields are required" },
        { status: 400 }
      );
    }

    // Start transaction
    await conn.beginTransaction();

    // Insert expense record
    const [result] = await conn.execute(
      `INSERT INTO expenses (expense_date, amount, description, category, payment_method, account_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [expense_date, amount, description, category, payment_method, account_id || null]
    );

    // Update account balance (expenses decrease account balance)
    if (account_id) {
      await updateAccountBalance(conn, payment_method, account_id, amount, false);
    }

    await conn.commit();
    await conn.end();
    
    return NextResponse.json(
      { message: "Expense created successfully", id: result.insertId },
      { status: 201 }
    );
  } catch (error) {
    await conn.rollback();
    await conn.end();
    console.error("POST Expense Error:", error);
    if (error.message === "UNAUTHORIZED" || error.message === "INVALID_TOKEN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { message: "Failed to create expense" },
      { status: 500 }
    );
  }
}

// PUT - Update expense
export async function PUT(request) {
  const conn = await getTenantConnection(request);

  try {
    const { id, expense_date, amount, description, category, payment_method, account_id } = await request.json();

    if (!id || !expense_date || !amount || !description || !category || !payment_method) {
      await conn.end();
      return NextResponse.json(
        { message: "All required fields are required" },
        { status: 400 }
      );
    }

    // Start transaction
    await conn.beginTransaction();

    // Get old expense data to reverse previous balance changes
    const [oldExpense] = await conn.execute(
      `SELECT amount, payment_method, account_id FROM expenses WHERE id = ?`,
      [id]
    );

    if (oldExpense.length === 0) {
      await conn.rollback();
      await conn.end();
      return NextResponse.json(
        { message: "Expense not found" },
        { status: 404 }
      );
    }

    const old = oldExpense[0];

    // Reverse old balance changes (add back the old expense amount)
    if (old.account_id) {
      await updateAccountBalance(conn, old.payment_method, old.account_id, old.amount, true);
    }

    // Update expense record
    const [result] = await conn.execute(
      `UPDATE expenses 
       SET expense_date = ?, amount = ?, description = ?, category = ?, payment_method = ?, account_id = ?
       WHERE id = ?`,
      [expense_date, amount, description, category, payment_method, account_id || null, id]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      await conn.end();
      return NextResponse.json(
        { message: "Expense not found" },
        { status: 404 }
      );
    }

    // Apply new balance changes (subtract the new expense amount)
    if (account_id) {
      await updateAccountBalance(conn, payment_method, account_id, amount, false);
    }

    await conn.commit();
    await conn.end();
    
    return NextResponse.json({ message: "Expense updated successfully" });
  } catch (error) {
    await conn.rollback();
    await conn.end();
    console.error("PUT Expense Error:", error);
    if (error.message === "UNAUTHORIZED" || error.message === "INVALID_TOKEN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { message: "Failed to update expense" },
      { status: 500 }
    );
  }
}

// DELETE - Delete expense
export async function DELETE(request) {
  const conn = await getTenantConnection(request);

  try {
    const { id } = await request.json();

    if (!id) {
      await conn.end();
      return NextResponse.json(
        { message: "Expense ID is required" },
        { status: 400 }
      );
    }

    // Start transaction
    await conn.beginTransaction();

    // Get expense data to reverse balance changes
    const [expense] = await conn.execute(
      `SELECT amount, payment_method, account_id FROM expenses WHERE id = ?`,
      [id]
    );

    if (expense.length === 0) {
      await conn.rollback();
      await conn.end();
      return NextResponse.json(
        { message: "Expense not found" },
        { status: 404 }
      );
    }

    const exp = expense[0];

    // Reverse balance changes (add back the expense amount)
    if (exp.account_id) {
      await updateAccountBalance(conn, exp.payment_method, exp.account_id, exp.amount, true);
    }

    // Delete expense record
    const [result] = await conn.execute(
      `DELETE FROM expenses WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      await conn.end();
      return NextResponse.json(
        { message: "Expense not found" },
        { status: 404 }
      );
    }

    await conn.commit();
    await conn.end();
    
    return NextResponse.json({ message: "Expense deleted successfully" });
  } catch (error) {
    await conn.rollback();
    await conn.end();
    console.error("DELETE Expense Error:", error);
    if (error.message === "UNAUTHORIZED" || error.message === "INVALID_TOKEN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { message: "Failed to delete expense" },
      { status: 500 }
    );
  }
}