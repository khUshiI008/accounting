import { NextResponse } from "next/server";
import { getTenantContext, handleError } from "@/lib/tenantDB";

export async function POST(request) {
  let conn;
  try {
    const { conn: c, tenantId, companyType } = await getTenantContext(request);
    conn = c;
    const { bill_number, party, date, state, gst_party_id, itemsList } = await request.json();

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

    await conn.beginTransaction();

    let subtotal = 0;
    itemsList.forEach((item) => { subtotal += item.qty * item.price; });
    const gstAmount = (subtotal * gstPercent) / 100;
    const totalAmount = subtotal + gstAmount;

    const [purchaseResult] = await conn.query(
      `INSERT INTO purchases (tenant_id, bill_number, party_id, date, state, subtotal, total_items, gst_percent, gst_amount, total_amount, gst_party_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, bill_number, party, date, state, subtotal, itemsList.length, gstPercent, gstAmount, totalAmount, gst_party_id || null]
    );
    const purchaseId = purchaseResult.insertId;

    for (const item of itemsList) {
      await conn.query(
        `INSERT INTO purchase_items (tenant_id, purchase_id, item_id, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)`,
        [tenantId, purchaseId, item.id, item.qty, item.price, item.qty * item.price]
      );
      if (companyType === "Production") {
        await conn.query(`UPDATE products SET stock = stock + ? WHERE id = ? AND tenant_id = ?`, [item.qty, item.id, tenantId]);
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
    return NextResponse.json({ message: "Purchase saved successfully" }, { status: 201 });
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

    const [purchases] = await conn.query(
      `SELECT p.*, pa.name AS party_name, gst_pa.name AS gst_party_name, gst_pa.gst_percentage
       FROM purchases p
       JOIN parties pa ON p.party_id = pa.id AND pa.tenant_id = ?
       LEFT JOIN parties gst_pa ON p.gst_party_id = gst_pa.id AND gst_pa.party_type = 'gst' AND gst_pa.tenant_id = ?
       WHERE p.tenant_id = ?
       ORDER BY p.created_at DESC`,
      [tenantId, tenantId, tenantId]
    );

    for (let purchase of purchases) {
      const [items] = await conn.query(
        `SELECT pi.*, pr.name FROM purchase_items pi
         JOIN products pr ON pi.item_id = pr.id AND pr.tenant_id = ?
         WHERE pi.purchase_id = ? AND pi.tenant_id = ?`,
        [tenantId, purchase.id, tenantId]
      );
      purchase.items = items;
    }

    await conn.end();
    return NextResponse.json({ purchases }, { status: 200 });
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
    const { id, bill_number, party, date, state, gst_party_id, itemsList } = await request.json();

    if (!id || !party || !date || !itemsList || itemsList.length === 0) {
      return NextResponse.json({ message: "Required fields missing" }, { status: 400 });
    }

    await conn.beginTransaction();

    const [oldSale] = await conn.query(
      "SELECT gst_amount, gst_party_id FROM purchases WHERE id = ? AND tenant_id = ?",
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

    let subtotal = 0;
    itemsList.forEach((item) => { subtotal += item.qty * item.price; });
    const gstAmount = (subtotal * gstPercent) / 100;
    const totalAmount = subtotal + gstAmount;

    await conn.query(
      `UPDATE purchases SET bill_number=?, party_id=?, date=?, state=?, subtotal=?, total_items=?, gst_percent=?, gst_amount=?, total_amount=?, gst_party_id=?
       WHERE id=? AND tenant_id=?`,
      [bill_number, party, date, state, subtotal, itemsList.length, gstPercent, gstAmount, totalAmount, gst_party_id || null, id, tenantId]
    );

    if (oldSale.length > 0 && oldSale[0].gst_party_id && oldSale[0].gst_amount > 0) {
      await conn.query(
        `UPDATE parties SET current_tax = current_tax - ? WHERE id = ? AND party_type = 'gst' AND tenant_id = ?`,
        [oldSale[0].gst_amount, oldSale[0].gst_party_id, tenantId]
      );
    }

    const [oldItems] = await conn.query(
      `SELECT item_id, quantity FROM purchase_items WHERE purchase_id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (companyType === "Production") {
      for (const item of oldItems) {
        await conn.query(`UPDATE products SET stock = stock - ? WHERE id = ? AND tenant_id = ?`, [item.quantity, item.item_id, tenantId]);
      }
    }

    await conn.query(`DELETE FROM purchase_items WHERE purchase_id = ? AND tenant_id = ?`, [id, tenantId]);

    for (const item of itemsList) {
      await conn.query(
        `INSERT INTO purchase_items (tenant_id, purchase_id, item_id, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)`,
        [tenantId, id, item.id, item.qty, item.price, item.qty * item.price]
      );
      if (companyType === "Production") {
        await conn.query(`UPDATE products SET stock = stock + ? WHERE id = ? AND tenant_id = ?`, [item.qty, item.id, tenantId]);
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
    return NextResponse.json({ message: "Purchase updated successfully" }, { status: 200 });
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

    if (!id) return NextResponse.json({ message: "Purchase ID required" }, { status: 400 });

    await conn.beginTransaction();

    const [purchase] = await conn.query(
      "SELECT gst_amount, gst_party_id FROM purchases WHERE id = ? AND tenant_id = ?",
      [id, tenantId]
    );

    if (purchase.length > 0 && purchase[0].gst_party_id && purchase[0].gst_amount > 0) {
      await conn.query(
        `UPDATE parties SET current_tax = current_tax - ? WHERE id = ? AND party_type = 'gst' AND tenant_id = ?`,
        [purchase[0].gst_amount, purchase[0].gst_party_id, tenantId]
      );
    }

    if (companyType === "Production") {
      const [items] = await conn.query(
        `SELECT item_id, quantity FROM purchase_items WHERE purchase_id = ? AND tenant_id = ?`,
        [id, tenantId]
      );
      for (const item of items) {
        await conn.query(`UPDATE products SET stock = stock - ? WHERE id = ? AND tenant_id = ?`, [item.quantity, item.item_id, tenantId]);
      }
    }

    await conn.query(`DELETE FROM purchase_items WHERE purchase_id = ? AND tenant_id = ?`, [id, tenantId]);
    await conn.query(`DELETE FROM purchases WHERE id = ? AND tenant_id = ?`, [id, tenantId]);

    await conn.commit();
    await conn.end();
    return NextResponse.json({ message: "Purchase deleted successfully" }, { status: 200 });
  } catch (error) {
    if (conn) { await conn.rollback().catch(() => {}); await conn.end().catch(() => {}); }
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}
