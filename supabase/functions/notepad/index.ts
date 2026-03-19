import {
  getNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
} from "./data.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  })
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const method = req.method
    const id = url.searchParams.get("id")

    // GET /notepad or GET /notepad?id={id}
    if (method === "GET") {
      if (id) {
        const note = await getNoteById(id)
        if (!note) return json({ error: "note not found", id }, 404)
        return json(note)
      }
      const notes = await getNotes()
      return json(notes)
    }

    // POST /notepad — 노트 생성
    if (method === "POST") {
      const body = await req.json()
      const note = await createNote(body)
      return json(note, 201)
    }

    // PATCH /notepad?id={id} — 노트 수정
    if (method === "PATCH") {
      if (!id) return json({ error: "id required" }, 400)
      const body = await req.json()
      const note = await updateNote(id, body)
      return json(note)
    }

    // DELETE /notepad?id={id} — 노트 삭제
    if (method === "DELETE") {
      if (!id) return json({ error: "id required" }, 400)
      await deleteNote(id)
      return json({ success: true })
    }

    return json({ error: "invalid route", method, path: url.pathname }, 404)
  } catch (e) {
    console.error("❌ notepad index error", e)
    return json({ error: "internal server error", details: e.message }, 500)
  }
})
