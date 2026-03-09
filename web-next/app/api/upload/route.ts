import { NextRequest, NextResponse } from "next/server";
import { fileUpload } from "../../lib/upload";

export const runtime = "nodejs";

const resolveApiBaseUrl = () => {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_BASE_URL;
  if (base) {
    return base.replace(/\/$/, "");
  }
  const port = process.env.BACKEND_PORT || process.env.PORT || "3000";
  return `http://localhost:${port}`;
};

const hasBackendSession = async (request: NextRequest) => {
  const baseUrl = resolveApiBaseUrl();
  const headers: Record<string, string> = {};
  const cookie = request.headers.get("cookie");
  const authorization = request.headers.get("authorization");
  const tenantId = request.headers.get("x-tenant-id");
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  if (tenantId) headers["x-tenant-id"] = tenantId;

  try {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      method: "GET",
      headers
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return !(payload && payload.ok === false);
  } catch {
    return false;
  }
};

export async function POST(request: NextRequest) {
  const backendSessionOk = await hasBackendSession(request);
  if (!backendSessionOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }
    const uploadedFile = await fileUpload(file);

    return NextResponse.json(
      {
        id: uploadedFile.filename,
        url: uploadedFile.path,
        name: uploadedFile.filename,
        size: uploadedFile.size,
        type: uploadedFile.mimetype
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("File upload error:", message, error);
    return NextResponse.json(
      {
        error: "File upload failed",
        ...(process.env.NODE_ENV === "production" ? {} : { message })
      },
      { status: 500 }
    );
  }
}
