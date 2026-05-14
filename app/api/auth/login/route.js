import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import masterDB from "@/lib/masterDB";

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    console.log("Login request:", body);

    // 1. Validate input
    if (!email || !password) {
      return NextResponse.json(
        { message: "Email and password are required" },
        { status: 400 }
      );
    }

    // 2. Find user in master DB
    const [users] = await masterDB.query(
      "SELECT id, email, password, company_type FROM users WHERE email = ?",
      [email]
    );

    if (users.length === 0) {
      return NextResponse.json(
        { message: "User not found" },
        { status: 404 }
      );
    }

    const user = users[0];

    // 3. Check password (NO encryption)
    if (user.password !== password) {
      return NextResponse.json(
        { message: "Invalid password" },
        { status: 401 }
      );
    }

    // 4. Get tenant DB info
    const [tenants] = await masterDB.query(
      "SELECT db_name FROM tenants WHERE user_id = ?",
      [user.id]
    );

    if (tenants.length === 0) {
      return NextResponse.json(
        { message: "Tenant not found" },
        { status: 500 }
      );
    }

    const db_name = tenants[0].db_name;

    console.log("DB name:", db_name);
    console.log("Company Type from DB:", user.company_type); // Debug log
    
    // 5. Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        companyType: user.company_type,
        db_name: db_name, // 🔥 important for SaaS
      },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "1d" }
    );

    console.log("Token payload:", { userId: user.id, email: user.email, companyType: user.company_type }); // Debug log

    // 6. Send response
    return NextResponse.json(
      {
        message: "Login successful",
        token,
        user: {
          id: user.id,
          email: user.email,
        },
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}