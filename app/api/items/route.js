import { NextResponse } from "next/server";
import { getTenantContext, handleError } from "@/lib/tenantDB";

export async function POST(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;

    const body = await request.json();
    const { name, unit, price, stock, HSN_code } = body;
    console.log("item form:", body);

    if (!name || !unit || !price) {
      return NextResponse.json(
        { message: "Name, unit, and price are required" },
        { status: 400 }
      );
    }

    if (unit !== "service" && (!HSN_code || HSN_code.trim() === "")) {
      return NextResponse.json(
        { message: "HSN Code is required for products" },
        { status: 400 }
      );
    }

    const finalHSNCode = HSN_code && HSN_code.trim() !== "" ? HSN_code : "9988";

    const [result] = await conn.query(
      `INSERT INTO products (tenant_id, name, unit, price, stock, HSN_code)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenantId, name, unit, price, stock || 0, finalHSNCode]
    );

    await conn.end();

    return NextResponse.json(
      {
        message: "Item added successfully",
        item: { id: result.insertId, name, unit, price, stock: stock || 0, HSN_code: finalHSNCode },
      },
      { status: 201 }
    );
  } catch (error) {
    if (conn) await conn.end().catch(() => {});
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}

export async function GET(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;

    const [items] = await conn.query(
      `SELECT id, name, unit, price, stock, created_at, HSN_code
       FROM products WHERE tenant_id = ?
       ORDER BY created_at DESC`,
      [tenantId]
    );

    await conn.end();
    return NextResponse.json({ items }, { status: 200 });
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

    const body = await request.json();
    const { id, name, unit, price, stock, HSN_code } = body;

    if (!id) {
      return NextResponse.json({ message: "Item ID is required" }, { status: 400 });
    }

    if (unit !== "service" && (!HSN_code || HSN_code.trim() === "")) {
      return NextResponse.json({ message: "HSN Code is required for products" }, { status: 400 });
    }

    const finalHSNCode = HSN_code && HSN_code.trim() !== "" ? HSN_code : "9988";

    await conn.query(
      `UPDATE products SET name=?, unit=?, price=?, stock=?, HSN_code=?
       WHERE id=? AND tenant_id=?`,
      [name, unit, price, stock, finalHSNCode, id, tenantId]
    );

    await conn.end();
    return NextResponse.json({ message: "Item updated successfully" }, { status: 200 });
  } catch (error) {
    if (conn) await conn.end().catch(() => {});
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

    if (!id) {
      return NextResponse.json({ message: "Item ID is required" }, { status: 400 });
    }

    const [purchaseCheck] = await conn.query(
      `SELECT COUNT(*) as count FROM purchase_items WHERE item_id = ? AND tenant_id = ?`,
      [id, tenantId]
    );
    const [salesCheck] = await conn.query(
      `SELECT COUNT(*) as count FROM sale_items WHERE item_id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    const purchaseCount = purchaseCheck[0]?.count || 0;
    const salesCount = salesCheck[0]?.count || 0;

    if (purchaseCount > 0 || salesCount > 0) {
      await conn.end();
      return NextResponse.json(
        {
          message: `Cannot delete item. It is used in ${purchaseCount} purchase(s) and ${salesCount} sale(s).`,
          usedInPurchases: purchaseCount,
          usedInSales: salesCount,
        },
        { status: 400 }
      );
    }

    await conn.query(`DELETE FROM products WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
    await conn.end();

    return NextResponse.json({ message: "Item deleted successfully" }, { status: 200 });
  } catch (error) {
    if (conn) await conn.end().catch(() => {});
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}
