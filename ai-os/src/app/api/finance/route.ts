import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const transactions = await sql`SELECT * FROM transactions ORDER BY occurred_on DESC, created_at DESC LIMIT 300`;
  const summary = await sql`
    SELECT currency, kind, SUM(amount) AS total
    FROM transactions
    WHERE occurred_on >= date_trunc('month', CURRENT_DATE)
    GROUP BY currency, kind`;
  return NextResponse.json({ transactions, summary });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const kind = b.kind === "income" ? "income" : "expense";
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "bad amount" }, { status: 400 });
  const currency = typeof b.currency === "string" && b.currency.trim() ? b.currency.trim().toUpperCase().slice(0, 5) : "UZS";
  const category = typeof b.category === "string" && b.category.trim() ? b.category.trim().slice(0, 40) : "other";
  const note = typeof b.note === "string" ? b.note.slice(0, 200) : null;
  const occurredOn = typeof b.occurred_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.occurred_on) ? b.occurred_on : null;

  const id = randomUUID();
  await sql`INSERT INTO transactions (id, kind, amount, currency, category, note, occurred_on)
            VALUES (${id}, ${kind}, ${amount}, ${currency}, ${category}, ${note}, ${occurredOn ?? sql`CURRENT_DATE`})`;
  return NextResponse.json({ id });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  await sql`DELETE FROM transactions WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
