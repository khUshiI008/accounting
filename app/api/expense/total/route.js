import { NextResponse } from "next/server";
import { getTenantContext, handleError } from "@/lib/tenantDB";

export async function GET(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;

    const [result] = await conn.execute(
      `SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses WHERE tenant_id = ?`,
      [tenantId]
    );

    await conn.end();
    return NextResponse.json({ total_expenses: result[0].total_expenses });
  } catch (error) {
    if (conn) await conn.end().catch(() => {});
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}
