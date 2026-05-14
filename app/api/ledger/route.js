import { NextResponse } from "next/server";
import { getTenantContext, handleError } from "@/lib/tenantDB";

export async function GET(request) {
  let conn;
  try {
    const { conn: c, tenantId } = await getTenantContext(request);
    conn = c;

    const { searchParams } = new URL(request.url);
    const partyId = searchParams.get("party_id");
    const year = searchParams.get("year");

    if (!partyId) {
      return NextResponse.json({ message: "Party ID required" }, { status: 400 });
    }

    const [party] = await conn.query(
      "SELECT * FROM parties WHERE id = ? AND tenant_id = ?",
      [partyId, tenantId]
    );

    if (party.length === 0) {
      await conn.end();
      return NextResponse.json({ message: "Party not found" }, { status: 404 });
    }

    let dateFilter = year ? "AND YEAR(date) = ?" : "";
    const salesParams = year ? [tenantId, partyId, year] : [tenantId, partyId];
    const purchasesParams = year ? [tenantId, partyId, year] : [tenantId, partyId];

    const [sales] = await conn.query(
      `SELECT id, bill_number, date, total_amount, 'sale' as type
       FROM sales WHERE tenant_id = ? AND party_id = ? ${dateFilter} ORDER BY date ASC`,
      salesParams
    );

    const [purchases] = await conn.query(
      `SELECT id, bill_number, date, total_amount, 'purchase' as type
       FROM purchases WHERE tenant_id = ? AND party_id = ? ${dateFilter} ORDER BY date ASC`,
      purchasesParams
    );

    const transactions = [
      ...sales.map((s) => ({
        ...s,
        description: `Sale - Bill #${s.bill_number}`,
        debit: Number(s.total_amount),
        credit: 0,
      })),
      ...purchases.map((p) => ({
        ...p,
        description: `Purchase - Bill #${p.bill_number}`,
        debit: 0,
        credit: Number(p.total_amount),
      })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    let balance = 0;
    const ledgerEntries = transactions.map((t) => {
      balance += t.debit - t.credit;
      return { ...t, balance };
    });

    const totalDebit = transactions.reduce((sum, t) => sum + Number(t.debit), 0);
    const totalCredit = transactions.reduce((sum, t) => sum + Number(t.credit), 0);

    await conn.end();

    return NextResponse.json(
      {
        party: party[0],
        ledger: ledgerEntries,
        summary: {
          openingBalance: 0,
          totalDebit,
          totalCredit,
          closingBalance: totalDebit - totalCredit,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    if (conn) await conn.end().catch(() => {});
    const e = handleError(error);
    return NextResponse.json({ message: e.message }, { status: e.status });
  }
}
