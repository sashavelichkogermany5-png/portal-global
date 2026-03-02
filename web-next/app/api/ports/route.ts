import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const resolvePortsPath = () => path.resolve(process.cwd(), "..", "logs", "ports.json");

export async function GET() {
  const filePath = resolvePortsPath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return NextResponse.json({ ok: false, error: "ports.json not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "Failed to read ports.json" }, { status: 500 });
  }
}
