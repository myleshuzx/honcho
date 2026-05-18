import { NextRequest, NextResponse } from "next/server";

const HONCHO_API_BASE_URL = process.env.HONCHO_API_BASE_URL || "http://127.0.0.1:8000";
const HONCHO_ADMIN_TOKEN = process.env.HONCHO_ADMIN_TOKEN;

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const suffix = path.map(encodeURIComponent).join("/");
  const target = new URL(`/v3/control-plane/${suffix}`, HONCHO_API_BASE_URL);
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  if (HONCHO_ADMIN_TOKEN) {
    headers.set("authorization", `Bearer ${HONCHO_ADMIN_TOKEN}`);
  }

  const response = await fetch(target, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    cache: "no-store"
  });

  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json"
    }
  });
}

export const GET = proxy;
export const POST = proxy;
