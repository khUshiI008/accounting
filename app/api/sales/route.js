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

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: tenant[0].db_name,
  });

  return { connection };
}

//////////////////////////////////////////////////////////////////
// 🔹 CREATE SALE (WITH ITEMS)
//////////////////////////////////////////////////////////////////
export async function POST(request) {
  const { connection: conn } = await getTenantConnection(request);

  try {
    const body = await request.json();
    const { bill_number, party, date, gst_party_id, itemsList } = body;

    if (!party || !date || !itemsList || itemsList.length === 0) {
      return NextResponse.json(
        { message: "Required fields missing" },
        { status: 400 }
      );
    }

    // Get GST percentage from GST party if selected
    let gstPercent = 0;
    if (gst_party_id) {
      const [gstParty] = await conn.query(
        "SELECT gst_percentage FROM parties WHERE id = ? AND party_type = 'gst'",
        [gst_party_id]
      );
      if (gstParty.length > 0) {
        gstPercent = gstParty[0].gst_percentage;
      }
    }

    // Check stock availability for all items
    for (const item of itemsList) {
      const [product] = await conn.query(
        "SELECT stock, name FROM products WHERE id = ?",
        [item.id]
      );

      if (product.length === 0) {
        await conn.end();
        return NextResponse.json(
          { message: `Product not found: ${item.name}` },
          { status: 400 }
        );
      }

      if (product[0].stock < item.qty) {
        await conn.end();
        return NextResponse.json(
          {
            message: `Insufficient stock for ${product[0].name}. Available: ${product[0].stock}, Required: ${item.qty}`,
          },
          { status: 400 }
        );
      }
    }

    await conn.beginTransaction();

    // Calculate values
    let subtotal = 0;
    const totalItems = itemsList.length;
    itemsList.forEach((item) => { subtotal += item.qty * item.price; });

    const gstAmount = (subtotal * gstPercent) / 100;
    const totalAmount = subtotal + gstAmount;

    // Insert into sales
    const insertQuery = `INSERT INTO sales 
      (bill_number, party_id, date, subtotal, total_items,
       gst_percent, gst_amount, total_amount, gst_party_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const insertValues = [
      bill_number, party, date, subtotal, totalItems,
      gstPercent, gstAmount, totalAmount, gst_party_id || null,
    ];

    const [saleResult] = await conn.query(insertQuery, insertValues);
    const saleId = saleResult.insertId;

    // Insert items and reduce stock
    for (const item of itemsList) {
      await conn.query(
        `INSERT INTO sale_items (sale_id, item_id, quantity, price, total) VALUES (?, ?, ?, ?, ?)`,
        [saleId, item.id, item.qty, item.price, item.qty * item.price]
      );
      // Always reduce stock on sale
      await conn.query(
        `UPDATE products SET stock = stock - ? WHERE id = ?`,
        [item.qty, item.id]
      );
    }

    // Update GST party current_tax if GST was applied
    if (gst_party_id && gstAmount > 0) {
      await conn.query(
        `UPDATE parties SET current_tax = current_tax + ? WHERE id = ? AND party_type = 'gst'`,
        [gstAmount, gst_party_id]
      );
    }

    await conn.commit();
    await conn.end();

    return NextResponse.json({ message: "Sale saved successfully" }, { status: 201 });
  } catch (error) {
    await conn.rollback();
    await conn.end();
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 GET ALL SALES
//////////////////////////////////////////////////////////////////
export async function GET(request) {
  try {
    const { connection: conn } = await getTenantConnection(request);

    const query = `SELECT s.*, pa.name AS party_name, pa.mobile as party_mobile, pa.gst_number as party_gst,
                          gst_pa.name AS gst_party_name, gst_pa.gst_percentage
                   FROM sales s
                   JOIN parties pa ON s.party_id = pa.id
                   LEFT JOIN parties gst_pa ON s.gst_party_id = gst_pa.id AND gst_pa.party_type = 'gst'
                   ORDER BY s.created_at DESC`;

    const [sales] = await conn.query(query);

    for (let sale of sales) {
      const [items] = await conn.query(
        `SELECT si.*, pr.name FROM sale_items si JOIN products pr ON si.item_id = pr.id WHERE si.sale_id = ?`,
        [sale.id]
      );
      sale.items = items;
    }

    await conn.end();
    return NextResponse.json({ sales }, { status: 200 });
  } catch (error) {
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 UPDATE SALE
//////////////////////////////////////////////////////////////////
export async function PUT(request) {
  const { connection: conn } = await getTenantConnection(request);

  try {
    const body = await request.json();
    const { id, bill_number, party, date, gst_party_id, itemsList } = body;

    if (!id || !party || !date || !itemsList || itemsList.length === 0) {
      return NextResponse.json(
        { message: "Required fields missing" },
        { status: 400 }
      );
    }

    // Get GST percentage from GST party if selected
    let gstPercent = 0;
    if (gst_party_id) {
      const [gstParty] = await conn.query(
        "SELECT gst_percentage FROM parties WHERE id = ? AND party_type = 'gst'",
        [gst_party_id]
      );
      if (gstParty.length > 0) {
        gstPercent = gstParty[0].gst_percentage;
      }
    }

    // Get old items to check stock availability with restored quantities
    const [oldItems] = await conn.query(
      `SELECT item_id, quantity FROM sale_items WHERE sale_id = ?`,
      [id]
    );

    // Check stock availability (current stock + old qty for same item)
    for (const item of itemsList) {
      const [product] = await conn.query(
        "SELECT stock, name FROM products WHERE id = ?",
        [item.id]
      );

      if (product.length === 0) {
        await conn.end();
        return NextResponse.json(
          { message: `Product not found: ${item.name}` },
          { status: 400 }
        );
      }

      const oldItem = oldItems.find((oi) => oi.item_id === item.id);
      const availableStock = product[0].stock + (oldItem ? oldItem.quantity : 0);

      if (availableStock < item.qty) {
        await conn.end();
        return NextResponse.json(
          {
            message: `Insufficient stock for ${product[0].name}. Available: ${availableStock}, Required: ${item.qty}`,
          },
          { status: 400 }
        );
      }
    }

    await conn.beginTransaction();

    // Calculate values
    let subtotal = 0;
    const totalItems = itemsList.length;
    itemsList.forEach((item) => { subtotal += item.qty * item.price; });

    const gstAmount = (subtotal * gstPercent) / 100;
    const totalAmount = subtotal + gstAmount;

    // Update sale record
    await conn.query(
      `UPDATE sales 
       SET bill_number = ?, party_id = ?, date = ?,
           subtotal = ?, total_items = ?,
           gst_percent = ?, gst_amount = ?,
           total_amount = ?, gst_party_id = ?
       WHERE id = ?`,
      [bill_number, party, date, subtotal, totalItems, gstPercent, gstAmount, totalAmount, gst_party_id || null, id]
    );

    // Restore stock from old items
    for (const item of oldItems) {
      await conn.query(
        `UPDATE products SET stock = stock + ? WHERE id = ?`,
        [item.quantity, item.item_id]
      );
    }

    await conn.query(`DELETE FROM sale_items WHERE sale_id = ?`, [id]);

    // Insert new items and reduce stock
    for (const item of itemsList) {
      await conn.query(
        `INSERT INTO sale_items (sale_id, item_id, quantity, price, total) VALUES (?, ?, ?, ?, ?)`,
        [id, item.id, item.qty, item.price, item.qty * item.price]
      );
      // Always reduce stock on sale
      await conn.query(
        `UPDATE products SET stock = stock - ? WHERE id = ?`,
        [item.qty, item.id]
      );
    }

    // Update GST party current_tax
    if (gst_party_id && gstAmount > 0) {
      await conn.query(
        `UPDATE parties SET current_tax = current_tax + ? WHERE id = ? AND party_type = 'gst'`,
        [gstAmount, gst_party_id]
      );
    }

    await conn.commit();
    await conn.end();

    return NextResponse.json({ message: "Sale updated successfully" }, { status: 200 });
  } catch (error) {
    await conn.rollback();
    await conn.end();
    return handleError(error);
  }
}

//////////////////////////////////////////////////////////////////
// 🔹 DELETE SALE
//////////////////////////////////////////////////////////////////
export async function DELETE(request) {
  const { connection: conn } = await getTenantConnection(request);

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ message: "Sale ID required" }, { status: 400 });
    }

    await conn.beginTransaction();

    // Restore stock before deleting
    const [items] = await conn.query(
      `SELECT item_id, quantity FROM sale_items WHERE sale_id = ?`,
      [id]
    );
    for (const item of items) {
      await conn.query(
        `UPDATE products SET stock = stock + ? WHERE id = ?`,
        [item.quantity, item.item_id]
      );
    }

    await conn.query(`DELETE FROM sale_items WHERE sale_id = ?`, [id]);
    await conn.query(`DELETE FROM sales WHERE id = ?`, [id]);

    await conn.commit();
    await conn.end();

    return NextResponse.json({ message: "Sale deleted successfully" }, { status: 200 });
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

  return NextResponse.json({ message: "Internal server error" }, { status: 500 });
}