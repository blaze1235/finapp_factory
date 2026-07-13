import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/server/auth";
import { sql } from "@/server/db";

const MAX_CONTENT_CHARS = 60_000;
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json", ".log"];

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const documents = await sql`SELECT id, filename, size_bytes, created_at FROM documents ORDER BY created_at DESC LIMIT 200`;
  return NextResponse.json({ documents });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "no file" }, { status: 400 });

  const name = file.name || "upload.txt";
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  let content: string;
  if (ext === ".pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buf });
      const result = await parser.getText();
      await parser.destroy();
      content = result.text;
    } catch (e) {
      return NextResponse.json({ error: `Couldn't read PDF: ${String(e).slice(0, 150)}` }, { status: 400 });
    }
  } else if (TEXT_EXTENSIONS.includes(ext) || file.type.startsWith("text/")) {
    content = buf.toString("utf-8");
  } else {
    return NextResponse.json(
      { error: `Unsupported file type "${ext}". Supported: .txt .md .csv .json .log .pdf` },
      { status: 400 },
    );
  }

  content = content.trim().slice(0, MAX_CONTENT_CHARS);
  if (!content) return NextResponse.json({ error: "File has no extractable text" }, { status: 400 });

  const id = randomUUID();
  await sql`INSERT INTO documents (id, filename, content, size_bytes) VALUES (${id}, ${name}, ${content}, ${buf.length})`;
  return NextResponse.json({ id, filename: name, chars: content.length });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  await sql`DELETE FROM documents WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
