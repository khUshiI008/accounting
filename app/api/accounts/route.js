import { NextResponse } from "next/server";
import { getTenantContext, handleError } from "@/lib/tenantDB";

export async function GET(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;

    const [banks] = await conn.query(
      `SELECT id, name, account_number, current_balance, 'bank' as account_type
       FROM Banks WHERE tenant_id = ? ORDER BY name`,
      [tenantId]
    );

    const [cash] = await conn.query(
      `SELECT id, name, current_balance, 'cash' as account_type
       FROM cashInHand WHERE tenant_id = ? ORDER BY name`,
      [tenantId]
    );

    await conn.end();

    return NextResponse.json({
      banks,
      cash,
      accounts: [...banks, ...cash],
    });
  } catch (error) {
    if (conn) await conn.end().catch(() => {});
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}
