import { NextResponse } from "next/server";
import { getTenantContext, handleError } from "@/lib/tenantDB";

export async function GET(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    const [banks] = await conn.query(
      `SELECT id, name, account_number, IFSC_code AS ifsc_code, branch_name,
              opening_balance, current_balance, created_at, 'bank_account' AS party_type
       FROM Banks WHERE tenant_id = ? ORDER BY created_at DESC`,
      [tenantId]
    );
    const [cash] = await conn.query(
      `SELECT id, name, opening_balance, current_balance, created_at, 'cash_in_hand' AS party_type
       FROM cashInHand WHERE tenant_id = ? ORDER BY created_at DESC`,
      [tenantId]
    );
    const [parties] = await conn.query(
      `SELECT id, name, mobile, city, gst_status, gst_number,
              creditLimit AS credit_limit, opening_balance, created_at, party_type,
              gst_percentage, current_tax AS current_text
       FROM parties WHERE tenant_id = ? ORDER BY created_at DESC`,
      [tenantId]
    );

    let allData = [...banks, ...cash, ...parties];
    if (type) allData = allData.filter((item) => item.party_type === type);

    return NextResponse.json({ parties: allData }, { status: 200 });
  } catch (error) {
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}
