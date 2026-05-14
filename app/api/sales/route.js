import { NextResponse } from "next/server";
import { getTenantContext, handleError } from "@/lib/tenantDB";

export async function POST(request) {
  let conn;
  try {
    const { conn: c, tenantId, companyType } = await getTenantContext(request);
    conn = c;
    const { bill_number, party, date, gst_party_id, itemsList } = await request.json();

    if (!party || !date || !itemsList || itemsList.length === 0) {
      return NextResponse.json({ message: "Required fields missing" }, { status: 400 });
    }

    let gstPercent = 0;
    if (gst_party_id) {
      const [gstParty] = await conn.query(
        "SELECT gst_percentage FROM parties WHERE id = ? AND party_type = 'gst' AND tenant_id = ?",
        [gst_party_id, tenantId]
      );
      if (gstParty.length > 0) gstPercent = gstParty[0].gst_percentage;
    }

    if (companyType === "Production") {
      for (const item of itemsList) {
        const [product] = await conn.query(
          "SELECT stock, name FROM products WHERE id = ? AND tenant_id = ?",
          [item.id, tenantId]
        );
        if (product.length === 0) return NextResponse.json({ message: `Product not found: ${item.name}` }, { status: 400 });
        if (product[0].stock < item.qty) {
          return NextResponse.json({ message: `Insufficient stock for ${product[0].name}. Available: ${product[0].stock}, Required: ${item.qty}` }, { status: 400 });
        }
      }
    }

    await conn.beginTransaction();

    let subtotal = 0;
    itemsList.forEach((item) => { subtotal += item.qty * item.price; });
    const gstAmount = (subtotal * gstPercent) / 100;
    const totalAmount = subtotal + gstAmount;

    const [saleResult] = await conn.query(
      `INSERT INTO sales (tenant_id, bill_number, party_id, date, subtotal, total_items, gst_percent, gst_amount, total_amount, gst_party_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, bill_number, party, date, subtotal, itemsList.length, gstPercent, gstAmount, totalAmount, gst_party_id || null]
    );
    const saleId = saleResult.insertId;

    for (const item of itemsList) {
      await conn.query(
        `INSERT INTO sale_items (tenant_id, sale_id, item_id, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)`,
        [tenantId, saleId, item.id, item.qty, item.price, item.qty * item.price]
      );
      if (companyType === "Production") {
        await conn.query(`UPDATE products SET stock = stock - ? WHERE id = ? AND tenant_id = ?`, [item.qty, item.id, tenantId]);
      }
    }

    if (gst_party_id && gstAmount > 0) {
      await conn.query(
        `UPDATE parties SET current_tax = current_tax + ? WHERE id = ? AND party_type = 'gst' AND tenant_id = ?`,
        [gstAmount, gst_party_id, tenantId]
      );
    }

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Sale saved successfully" }, { status: 201 });
  } catch (error) {
    if (conn) { await conn.rollback().catch(() => {}); await conn.end().catch(() => {}); }
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}

export async function GET(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;

    const [sales] = await conn.query(
      `SELECT s.*, pa.name AS party_name, pa.mobile as party_mobile, pa.gst_number as party_gst,
              gst_pa.name AS gst_party_name, gst_pa.gst_percentage
       FROM sales s
       JOIN parties pa ON s.party_id = pa.id AND pa.tenant_id = ?
       LEFT JOIN parties gst_pa ON s.gst_party_id = gst_pa.id AND gst_pa.party_type = 'gst' AND gst_pa.tenant_id = ?
       WHERE s.tenant_id = ?
       ORDER BY s.created_at DESC`,
      [tenantId, tenantId, tenantId]
    );

    for (let sale of sales) {
      const [items] = await conn.query(
        `SELECT si.*, pr.name FROM sale_items si
         JOIN products pr ON si.item_id = pr.id AND pr.tenant_id = ?
         WHERE si.sale_id = ? AND si.tenant_id = ?`,
        [tenantId, sale.id, tenantId]
      );
      sale.items = items;
    }

    await conn.end();
    return NextResponse.json({ sales }, { status: 200 });
  } catch (error) {
    if (conn) await conn.end().catch(() => {});
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}

export async function PUT(request) {
  let conn;
  try {
    const { conn: c, tenantId, companyType } = await getTenantContext(request);
    conn = c;
    const { id, bill_number, party, date, gst_party_id, itemsList } = await request.json();

    if (!id || !party || !date || !itemsList || itemsList.length === 0) {
      return NextResponse.json({ message: "Required fields missing" }, { status: 400 });
    }

    const [oldSale] = await conn.query(
      "SELECT gst_amount, gst_party_id FROM sales WHERE id = ? AND tenant_id = ?",
      [id, tenantId]
    );

    let gstPercent = 0;
    if (gst_party_id) {
      const [gstParty] = await conn.query(
        "SELECT gst_percentage FROM parties WHERE id = ? AND party_type = 'gst' AND tenant_id = ?",
        [gst_party_id, tenantId]
      );
      if (gstParty.length > 0) gstPercent = gstParty[0].gst_percentage;
    }

    if (companyType === "Production") {
      const [oldItems] = await conn.query(
        `SELECT item_id, quantity FROM sale_items WHERE sale_id = ? AND tenant_id = ?`,
        [id, tenantId]
      );
      for (const item of itemsList) {
        const [product] = await conn.query("SELECT stock, name FROM products WHERE id = ? AND tenant_id = ?", [item.id, tenantId]);
        if (product.length === 0) return NextResponse.json({ message: `Product not found: ${item.name}` }, { status: 400 });
        const oldItem = oldItems.find((oi) => oi.item_id === item.id);
        const availableStock = product[0].stock + (oldItem ? oldItem.quantity : 0);
        if (availableStock < item.qty) {
          return NextResponse.json({ message: `Insufficient stock for ${product[0].name}. Available: ${availableStock}, Required: ${item.qty}` }, { status: 400 });
        }
      }
    }

    await conn.beginTransaction();

    let subtotal = 0;
    itemsList.forEach((item) => { subtotal += item.qty * item.price; });
    const gstAmount = (subtotal * gstPercent) / 100;
    const totalAmount = subtotal + gstAmount;

    await conn.query(
      `UPDATE sales SET bill_number=?, party_id=?, date=?, subtotal=?, total_items=?, gst_percent=?, gst_amount=?, total_amount=?, gst_party_id=?
       WHERE id=? AND tenant_id=?`,
      [bill_number, party, date, subtotal, itemsList.length, gstPercent, gstAmount, totalAmount, gst_party_id || null, id, tenantId]
    );

    if (oldSale.length > 0 && oldSale[0].gst_party_id && oldSale[0].gst_amount > 0) {
      await conn.query(
        `UPDATE parties SET current_tax = current_tax - ? WHERE id = ? AND party_type = 'gst' AND tenant_id = ?`,
        [oldSale[0].gst_amount, oldSale[0].gst_party_id, tenantId]
      );
    }

    const [oldItems] = await conn.query(
      `SELECT item_id, quantity FROM sale_items WHERE sale_id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (companyType === "Production") {
      for (const item of oldItems) {
        await conn.query(`UPDATE products SET stock = stock + ? WHERE id = ? AND tenant_id = ?`, [item.quantity, item.item_id, tenantId]);
      }
    }

    await conn.query(`DELETE FROM sale_items WHERE sale_id = ? AND tenant_id = ?`, [id, tenantId]);

    for (const item of itemsList) {
      await conn.query(
        `INSERT INTO sale_items (tenant_id, sale_id, item_id, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)`,
        [tenantId, id, item.id, item.qty, item.price, item.qty * item.price]
      );
      if (companyType === "Production") {
        await conn.query(`UPDATE products SET stock = stock - ? WHERE id = ? AND tenant_id = ?`, [item.qty, item.id, tenantId]);
      }
    }

    if (gst_party_id && gstAmount > 0) {
      await conn.query(
        `UPDATE parties SET current_tax = current_tax + ? WHERE id = ? AND party_type = 'gst' AND tenant_id = ?`,
        [gstAmount, gst_party_id, tenantId]
      );
    }

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Sale updated successfully" }, { status: 200 });
  } catch (error) {
    if (conn) { await conn.rollback().catch(() => {}); await conn.end().catch(() => {}); }
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}

export async function DELETE(request) {
  let conn;
  try {
    const { conn: c, tenantId, companyType } = await getTenantContext(request);
    conn = c;
    const { id } = await request.json();

    if (!id) return NextResponse.json({ message: "Sale ID required" }, { status: 400 });

    await conn.beginTransaction();

    const [sale] = await conn.query(
      "SELECT gst_amount, gst_party_id FROM sales WHERE id = ? AND tenant_id = ?",
      [id, tenantId]
    );

    if (sale.length > 0 && sale[0].gst_party_id && sale[0].gst_amount > 0) {
      await conn.query(
        `UPDATE parties SET current_tax = current_tax - ? WHERE id = ? AND party_type = 'gst' AND tenant_id = ?`,
        [sale[0].gst_amount, sale[0].gst_party_id, tenantId]
      );
    }

    if (companyType === "Production") {
      const [items] = await conn.query(
        `SELECT item_id, quantity FROM sale_items WHERE sale_id = ? AND tenant_id = ?`,
        [id, tenantId]
      );
      for (const item of items) {
        await conn.query(`UPDATE products SET stock = stock + ? WHERE id = ? AND tenant_id = ?`, [item.quantity, item.item_id, tenantId]);
      }
    }

    await conn.query(`DELETE FROM sale_items WHERE sale_id = ? AND tenant_id = ?`, [id, tenantId]);
    await conn.query(`DELETE FROM sales WHERE id = ? AND tenant_id = ?`, [id, tenantId]);

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Sale deleted successfully" }, { status: 200 });
  } catch (error) {
    if (conn) { await conn.rollback().catch(() => {}); await conn.end().catch(() => {}); }
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}
