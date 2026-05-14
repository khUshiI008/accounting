import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
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

//////////////////////////////////////////////////////////////////
// 🔹 CREATE PAYMENT
//////////////////////////////////////////////////////////////////
export async function POST(request) {
  const conn = await getTenantConnection(request);

  try {
    const body = await request.json();

    const {
      party_id,
      payment_date,
      payment_type,
      amount,
      payment_method,
      account_id,
      reference_number,
      notes,
    } = body;

    if (!party_id || !payment_date || !payment_type || !amount || !payment_method) {
      return NextResponse.json(
        { message: "Required fields missing" },
        { status: 400 }
      );
    }

    // Start transaction
    await conn.beginTransaction();

    // Insert payment record
    const [result] = await conn.query(
      `INSERT INTO payments 
      (party_id, payment_date, payment_type, amount, payment_method, account_id, reference_number, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        party_id,
        payment_date,
        payment_type,
        amount,
        payment_method,
        account_id || null,
        reference_number || null,
        notes || null,
      ]
    );

    // Update account balance based on payment type and method
    if (account_id) {
      if (payment_type === 'received') {
        // Money coming in - increase account balance
        await updateAccountBalance(conn, payment_method, account_id, amount, true);
      } else if (payment_type === 'paid') {
        // Money going out - decrease account balance
        await updateAccountBalance(conn, payment_method, account_id, amount, false);
      }
    }

    await conn.commit();
    await conn.end();

    return NextResponse.json(
      { message: "Payment saved successfully" },
      { status: 201 }
    );
  } catch (error) {
    await conn.rollback();
    await conn.end();
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 GET ALL PAYMENTS
//////////////////////////////////////////////////////////////////
export async function GET(request) {
  try {
    const conn = await getTenantConnection(request);

    const [payments] = await conn.query(
      `SELECT p.*, pa.name AS party_name,
              CASE 
                WHEN p.payment_method = 'Cash' THEN c.name
                WHEN p.payment_method IN ('Bank Transfer', 'UPI', 'Cheque', 'Card') THEN b.name
                ELSE NULL
              END AS account_name
       FROM payments p
       JOIN parties pa ON p.party_id = pa.id
       LEFT JOIN cashInHand c ON p.account_id = c.id AND p.payment_method = 'Cash'
       LEFT JOIN Banks b ON p.account_id = b.id AND p.payment_method IN ('Bank Transfer', 'UPI', 'Cheque', 'Card')
       ORDER BY p.payment_date DESC, p.created_at DESC`
    );

    await conn.end();

    return NextResponse.json(
      { payments },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 UPDATE PAYMENT
//////////////////////////////////////////////////////////////////
export async function PUT(request) {
  const conn = await getTenantConnection(request);

  try {
    const body = await request.json();

    const {
      id,
      party_id,
      payment_date,
      payment_type,
      amount,
      payment_method,
      account_id,
      reference_number,
      notes,
    } = body;

    if (!id || !party_id || !payment_date || !payment_type || !amount || !payment_method) {
      return NextResponse.json(
        { message: "Required fields missing" },
        { status: 400 }
      );
    }

    // Start transaction
    await conn.beginTransaction();

    // Get old payment data to reverse previous balance changes
    const [oldPayment] = await conn.query(
      `SELECT payment_type, amount, payment_method, account_id FROM payments WHERE id = ?`,
      [id]
    );

    if (oldPayment.length === 0) {
      await conn.rollback();
      await conn.end();
      return NextResponse.json(
        { message: "Payment not found" },
        { status: 404 }
      );
    }

    const old = oldPayment[0];

    // Reverse old balance changes
    if (old.account_id) {
      if (old.payment_type === 'received') {
        // Reverse: decrease account balance (was increased)
        await updateAccountBalance(conn, old.payment_method, old.account_id, old.amount, false);
      } else if (old.payment_type === 'paid') {
        // Reverse: increase account balance (was decreased)
        await updateAccountBalance(conn, old.payment_method, old.account_id, old.amount, true);
      }
    }

    // Update payment record
    await conn.query(
      `UPDATE payments 
       SET party_id = ?, payment_date = ?, payment_type = ?, 
           amount = ?, payment_method = ?, account_id = ?, reference_number = ?, notes = ?
       WHERE id = ?`,
      [
        party_id,
        payment_date,
        payment_type,
        amount,
        payment_method,
        account_id || null,
        reference_number || null,
        notes || null,
        id,
      ]
    );

    // Apply new balance changes
    if (account_id) {
      if (payment_type === 'received') {
        // Money coming in - increase account balance
        await updateAccountBalance(conn, payment_method, account_id, amount, true);
      } else if (payment_type === 'paid') {
        // Money going out - decrease account balance
        await updateAccountBalance(conn, payment_method, account_id, amount, false);
      }
    }

    await conn.commit();
    await conn.end();

    return NextResponse.json(
      { message: "Payment updated successfully" },
      { status: 200 }
    );
  } catch (error) {
    await conn.rollback();
    await conn.end();
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 DELETE PAYMENT
//////////////////////////////////////////////////////////////////
export async function DELETE(request) {
  const conn = await getTenantConnection(request);

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { message: "Payment ID required" },
        { status: 400 }
      );
    }

    // Start transaction
    await conn.beginTransaction();

    // Get payment data to reverse balance changes
    const [payment] = await conn.query(
      `SELECT payment_type, amount, payment_method, account_id FROM payments WHERE id = ?`,
      [id]
    );

    if (payment.length === 0) {
      await conn.rollback();
      await conn.end();
      return NextResponse.json(
        { message: "Payment not found" },
        { status: 404 }
      );
    }

    const p = payment[0];

    // Reverse balance changes
    if (p.account_id) {
      if (p.payment_type === 'received') {
        // Reverse: decrease account balance (was increased)
        await updateAccountBalance(conn, p.payment_method, p.account_id, p.amount, false);
      } else if (p.payment_type === 'paid') {
        // Reverse: increase account balance (was decreased)
        await updateAccountBalance(conn, p.payment_method, p.account_id, p.amount, true);
      }
    }

    // Delete payment record
    await conn.query(`DELETE FROM payments WHERE id = ?`, [id]);

    await conn.commit();
    await conn.end();

    return NextResponse.json(
      { message: "Payment deleted successfully" },
      { status: 200 }
    );
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

  return NextResponse.json(
    { message: "Internal server error" },
    { status: 500 }
  );
}
