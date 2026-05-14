import { NextResponse } from "next/server";
import { getTenantContext, handleError } from "@/lib/tenantDB";

export async function GET(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;

    const [gstParties] = await conn.query(
      `SELECT id, name, gst_percentage, current_tax AS current_text
       FROM parties WHERE tenant_id = ? AND party_type = 'gst' ORDER BY name ASC`,
      [tenantId]
    );

    return NextResponse.json({ gstParties }, { status: 200 });
  } catch (error) {
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}
