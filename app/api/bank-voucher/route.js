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

// 🔹 Helper function to update account balances
async function updateAccountBalance(conn, accountType, accountId, amount, isIncrease) {
  const operation = isIncrease ? '+' : '-';
  
  if (accountType === 'cash') {
    await conn.query(
      `UPDATE cashInHand SET current_balance = current_balance ${operation} ? WHERE id = ?`,
      [amount, accountId]
    );
  } else if (accountType === 'bank') {
    await conn.query(
      `UPDATE Banks SET current_balance = current_balance ${operation} ? WHERE id = ?`,
      [amount, accountId]
    );
  }
}

// 🔹 Helper function to check account balance
async function checkAccountBalance(conn, accountType, accountId, requiredAmount) {
  let balance = 0;
  
  if (accountType === 'cash') {
    const [result] = await conn.query(
      `SELECT current_balance FROM cashInHand WHERE id = ?`,
      [accountId]
    );
    balance = result[0]?.current_balance || 0;
  } else if (accountType === 'bank') {
    const [result] = await conn.query(
      `SELECT current_balance FROM Banks WHERE id = ?`,
      [accountId]
    );
    balance = result[0]?.current_balance || 0;
  }
  
  return Number(balance) >= Number(requiredAmount);
}

// POST - Create transfer
export async function POST(request) {
  const conn = await getTenantConnection(request);

  try {
    const {
      from_account_type,
      from_account_id,
      to_account_type,
      to_account_id,
      amount,
      transfer_date,
      description,
    } = await request.json();

    // Validation
    if (!from_account_type || !from_account_id || !to_account_type || !to_account_id || !amount || !transfer_date) {
      return NextResponse.json(
        { message: "All required fields must be provided" },
        { status: 400 }
      );
    }

    if (from_account_type === to_account_type && from_account_id === to_account_id) {
      return NextResponse.json(
        { message: "Cannot transfer to the same account" },
        { status: 400 }
      );
    }

    if (Number(amount) <= 0) {
      return NextResponse.json(
        { message: "Transfer amount must be greater than 0" },
        { status: 400 }
      );
    }

    // Start transaction
    await conn.beginTransaction();

    // Check if source account has sufficient balance
    const hasSufficientBalance = await checkAccountBalance(conn, from_account_type, from_account_id, amount);
    if (!hasSufficientBalance) {
      await conn.rollback();
      await conn.end();
      return NextResponse.json(
        { message: "Insufficient balance in source account" },
        { status: 400 }
      );
    }

    // Create transfer record
    const [result] = await conn.query(
      `INSERT INTO bank_vouchers 
       (from_account_type, from_account_id, to_account_type, to_account_id, amount, transfer_date, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [from_account_type, from_account_id, to_account_type, to_account_id, amount, transfer_date, description || null]
    );

    // Update account balances
    // Decrease from account
    await updateAccountBalance(conn, from_account_type, from_account_id, amount, false);
    
    // Increase to account
    await updateAccountBalance(conn, to_account_type, to_account_id, amount, true);

    await conn.commit();
    await conn.end();

    return NextResponse.json(
      { message: "Transfer completed successfully", id: result.insertId },
      { status: 201 }
    );
  } catch (error) {
    await conn.rollback();
    await conn.end();
    console.error("POST Transfer Error:", error);
    if (error.message === "UNAUTHORIZED" || error.message === "INVALID_TOKEN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { message: "Failed to create transfer" },
      { status: 500 }
    );
  }
}

// GET - Fetch all transfers
export async function GET(request) {
  try {
    const conn = await getTenantConnection(request);

    const [transfers] = await conn.query(
      `SELECT 
        bv.*,
        CASE 
          WHEN bv.from_account_type = 'cash' THEN c1.name
          WHEN bv.from_account_type = 'bank' THEN b1.name
        END AS from_account_name,
        CASE 
          WHEN bv.to_account_type = 'cash' THEN c2.name
          WHEN bv.to_account_type = 'bank' THEN b2.name
        END AS to_account_name
       FROM bank_vouchers bv
       LEFT JOIN cashInHand c1 ON bv.from_account_id = c1.id AND bv.from_account_type = 'cash'
       LEFT JOIN Banks b1 ON bv.from_account_id = b1.id AND bv.from_account_type = 'bank'
       LEFT JOIN cashInHand c2 ON bv.to_account_id = c2.id AND bv.to_account_type = 'cash'
       LEFT JOIN Banks b2 ON bv.to_account_id = b2.id AND bv.to_account_type = 'bank'
       ORDER BY bv.transfer_date DESC, bv.created_at DESC`
    );

    await conn.end();

    return NextResponse.json({ transfers });
  } catch (error) {
    console.error("GET Transfers Error:", error);
    if (error.message === "UNAUTHORIZED" || error.message === "INVALID_TOKEN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { message: "Failed to fetch transfers" },
      { status: 500 }
    );
  }
}