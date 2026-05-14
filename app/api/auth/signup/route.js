import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import masterDB from "@/lib/masterDB";

export async function POST(request) {
  try {
    const body = await request.json();
    const { company_name, company_type, email, mobile, password } = body;
    console.log("req reached:", body);

    // 1. Validate fields
    if (!company_name || !company_type || !email || !mobile || !password) {
      return NextResponse.json(
        { message: "All fields are required" },
        { status: 400 }
      );
    }

    // 2. Validate company_type matches ENUM
    const validTypes = ["Sales", "Production", "Services", "Retail", "Technology", "Other"];
    if (!validTypes.includes(company_type)) {
      return NextResponse.json(
        { message: `Invalid company type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // 3. Check if email already exists
    const [existing] = await masterDB.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { message: "Email already registered" },
        { status: 409 }
      );
    }

    // 4. Insert user into master DB
    console.log("Storing user in DB...");
    const [userResult] = await masterDB.query(
      `INSERT INTO users (company_name, company_type, email, mobile, password)
        VALUES (?, ?, ?, ?, ?)`,
      [company_name, company_type, email, mobile, password]
    );

    const userId = userResult.insertId;
    // db_name is now just a reference label, not a real separate database
    const db_name = `tenant_${userId}`;

    console.log("userId:", userId);

    // 5. Save tenant mapping (no DB creation needed - all tables are in shared DB)
    await masterDB.query(
      "INSERT INTO tenants (user_id, db_name) VALUES (?, ?)",
      [userId, db_name]
    );

    console.log("Tenant registered successfully");

    // 6. Return success
    return NextResponse.json(
      {
        message: "Account created successfully",
        user: { id: userId, company_name, company_type, email },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
