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

//////////////////////////////////////////////////////////////////
// 🔹 GET PARTY LEDGER
//////////////////////////////////////////////////////////////////
export async function GET(request) {
  let conn;
  try {
    conn = await getTenantConnection(request);

    const { searchParams } = new URL(request.url);
    const partyId = searchParams.get("party_id");
    const year = searchParams.get("year");

    console.log("Ledger API - Party ID:", partyId, "Year:", year);

    if (!partyId) {
      return NextResponse.json(
        { message: "Party ID required" },
        { status: 400 }
      );
    }

    // Get party details
    const [party] = await conn.query(
      "SELECT * FROM parties WHERE id = ?",
      [partyId]
    );

    console.log("Party found:", party.length);

    if (party.length === 0) {
      await conn.end();
      return NextResponse.json(
        { message: "Party not found" },
        { status: 404 }
      );
    }

    // Build date filter
    let salesDateFilter = "";
    let purchasesDateFilter = "";
    let salesParams = [partyId];
    let purchasesParams = [partyId];

    if (year) {
      salesDateFilter = "AND YEAR(date) = ?";
      purchasesDateFilter = "AND YEAR(date) = ?";
      salesParams.push(year);
      purchasesParams.push(year);
    }

    // Get all sales for this party
    const [sales] = await conn.query(
      `SELECT 
        id,
        bill_number,
        date,
        total_amount,
        'sale' as type
       FROM sales 
       WHERE party_id = ? ${salesDateFilter}
       ORDER BY date ASC`,
      salesParams
    );

    console.log("Sales found:", sales.length);

    // Get all purchases for this party
    const [purchases] = await conn.query(
      `SELECT 
        id,
        bill_number,
        date,
        total_amount,
        'purchase' as type
       FROM purchases 
       WHERE party_id = ? ${purchasesDateFilter}
       ORDER BY date ASC`,
      purchasesParams
    );

    console.log("Purchases found:", purchases.length);

    // Combine sales and purchases only (not payments as separate entries)
    const transactions = [
      ...sales.map((s) => ({
        ...s,
        description: `Sale - Bill #${s.bill_number}`,
        debit: Number(s.total_amount),
        credit: 0,
      })),
      ...purchases.map((p) => ({
        ...p,
        description: `Purchase - Bill #${p.bill_number}`,
        debit: 0,
        credit: Number(p.total_amount),
      })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calculate running balance
    let balance = 0;
    const ledgerEntries = transactions.map((t) => {
      balance += t.debit - t.credit;
      return {
        ...t,
        balance: balance,
      };
    });

    // Calculate totals
    const totalDebit = transactions.reduce((sum, t) => sum + Number(t.debit), 0);
    const totalCredit = transactions.reduce((sum, t) => sum + Number(t.credit), 0);
    const closingBalance = totalDebit - totalCredit;

    await conn.end();

    return NextResponse.json(
      {
        party: party[0],
        ledger: ledgerEntries,
        summary: {
          openingBalance: 0,
          totalDebit,
          totalCredit,
          closingBalance,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    if (conn) await conn.end();
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
