import { verifyTurnstileToken } from "./turnstile";

interface BookRow {
  id: number;
  isbn: string | null;
  title: string;
  author: string | null;
  owner_id: number | null;
  owner_name: string | null;
  cover_url: string | null;
  created_at: string;
}

interface AddBookBody {
  isbn?: string;
  title?: string;
  author?: string;
  owner_id?: number;
  coverUrl?: string;
  turnstileToken?: string;
}

function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(env: Env, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

async function handleGetBooks(request: Request, env: Env, url: URL): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.READ_LIMITER.limit({ key: ip });
  if (!success) return json(env, { error: "rate limited, try again shortly" }, 429);

  const isbn = url.searchParams.get("isbn");
  if (!isbn) return json(env, { error: "isbn query param is required" }, 400);

  const { results } = await env.DB.prepare(
    `SELECT books.id, books.isbn, books.title, books.author, books.owner_id,
            people.name AS owner_name, books.cover_url, books.created_at
     FROM books LEFT JOIN people ON people.id = books.owner_id
     WHERE books.isbn = ?`,
  )
    .bind(isbn)
    .all<BookRow>();

  return json(env, { results });
}

async function handleGetPeople(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.READ_LIMITER.limit({ key: ip });
  if (!success) return json(env, { error: "rate limited, try again shortly" }, 429);

  const { results } = await env.DB.prepare(`SELECT id, name FROM people ORDER BY name`).all();
  return json(env, { results });
}

async function handlePostBook(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success: withinLimit } = await env.WRITE_LIMITER.limit({ key: ip });
  if (!withinLimit) return json(env, { error: "rate limited, try again shortly" }, 429);

  let body: AddBookBody;
  try {
    body = await request.json();
  } catch {
    return json(env, { error: "body must be JSON" }, 400);
  }

  if (!body.title || !body.turnstileToken) {
    return json(env, { error: "title and turnstileToken are required" }, 400);
  }

  // The frontend already downsizes uploaded photos before base64-encoding
  // them, but this is the actual boundary — cap defensively against a
  // client that skips that step (or calls the API directly).
  if (body.coverUrl && body.coverUrl.length > 400_000) {
    return json(env, { error: "cover image is too large" }, 400);
  }

  const verification = await verifyTurnstileToken(body.turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  const expectedHostname = new URL(env.ALLOWED_ORIGIN).hostname;
  if (!verification.success || verification.hostname !== expectedHostname) {
    return json(env, { error: "turnstile verification failed" }, 403);
  }

  const insert = await env.DB.prepare(
    `INSERT INTO books (isbn, title, author, owner_id, cover_url) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(body.isbn ?? null, body.title, body.author ?? null, body.owner_id ?? null, body.coverUrl ?? null)
    .run();

  return json(env, { id: insert.meta.last_row_id }, 201);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (request.method === "GET" && url.pathname === "/books") {
      return handleGetBooks(request, env, url);
    }
    if (request.method === "GET" && url.pathname === "/people") {
      return handleGetPeople(request, env);
    }
    if (request.method === "POST" && url.pathname === "/books") {
      return handlePostBook(request, env);
    }

    return json(env, { error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
