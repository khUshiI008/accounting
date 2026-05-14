import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import masterDB from "@/lib/masterDB";

// Verify admin token
function verifyAdmin(request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("UNAUTHORIZED");
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "admin") {
      throw new Error("FORBIDDEN");
    }
    return decoded;
  } catch {
    throw new Error("INVALID_TOKEN");
  }
}

// GET all users
export async function GET(request) {
  try {
    verifyAdmin(request);

    const [users] = await masterDB.query(
      "SELECT id, company_name, company_type, email, mobile, created_at FROM users ORDER BY created_at DESC"
    );

    return NextResponse.json({ users }, { status: 200 });
  } catch (error) {
    return handleError(error);
  }
}

// DELETE user
export async function DELETE(request) {
  try {
    verifyAdmin(request);

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { message: "User ID is required" },
        { status: 400 }
      );
    }

    // Get tenant database name
    const [tenant] = await masterDB.query(
      "SELECT db_name FROM tenants WHERE user_id = ?",
      [userId]
    );

    // Delete tenant database if exists
    if (tenant.length > 0) {
      await masterDB.query(`DROP DATABASE IF EXISTS \`${tenant[0].db_name}\``);
    }

    // Delete from tenants table
    await masterDB.query("DELETE FROM tenants WHERE user_id = ?", [userId]);

    // Delete from users table
    await masterDB.query("DELETE FROM users WHERE id = ?", [userId]);

    return NextResponse.json(
      { message: "User deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error) {
  console.error(error);

  if (error.message === "UNAUTHORIZED") {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (error.message === "FORBIDDEN") {
    return NextResponse.json(
      { message: "Access forbidden - Admin only" },
      { status: 403 }
    );
  }

  if (error.message === "INVALID_TOKEN") {
    return NextResponse.json({ message: "Invalid token" }, { status: 401 });
  }

  return NextResponse.json(
    { message: "Internal server error" },
    { status: 500 }
  );
}
