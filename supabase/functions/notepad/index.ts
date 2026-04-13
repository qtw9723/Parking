import {
  getNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  getProjects,
  saveVersion,
  getVersions,
  runDailyBackup,
  restoreVersion,
} from "./data.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

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

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) return null
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
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
      const action = url.searchParams.get("action")
      const type = url.searchParams.get("type")

      // GET ?type=projects
      if (type === "projects") {
        const projects = await getProjects()
        return json(projects)
      }

      // GET ?action=versions&noteId=xxx
      if (action === "versions") {
        const noteId = url.searchParams.get("noteId")
        if (!noteId) return json({ error: "noteId required" }, 400)
        const versions = await getVersions(noteId)
        return json(versions)
      }

      if (id) {
        const note = await getNoteById(id)
        if (!note) return json({ error: "note not found", id }, 404)
        return json(note)
      }
      const notes = await getNotes()
      return json(notes)
    }

    // POST /notepad
    if (method === "POST") {
      const body = await req.json()

      // action: backup — pg_cron이 service_role key로 호출
      if (body.action === "backup") {
        const authHeader = req.headers.get("Authorization") ?? ""
        const token = authHeader.replace("Bearer ", "")
        if (token !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
          return json({ error: "unauthorized" }, 401)
        }
        await runDailyBackup()
        return json({ success: true })
      }

      // action: snapshot — 클라이언트 shrinkage 감지 시 호출
      if (body.action === "snapshot") {
        const user = await getUserFromRequest(req)
        if (!user) return json({ error: "unauthorized" }, 401)
        if (!body.noteId) return json({ error: "noteId required" }, 400)
        const version = await saveVersion(body.noteId, {
          title: body.title ?? "",
          content: body.content ?? "",
          content_type: body.content_type ?? "markdown",
          tags: body.tags ?? [],
        }, "shrinkage")
        return json(version)
      }

      // action: restore — 특정 버전으로 복구
      if (body.action === "restore") {
        const user = await getUserFromRequest(req)
        if (!user) return json({ error: "unauthorized" }, 401)
        if (!body.noteId || !body.versionId) {
          return json({ error: "noteId and versionId required" }, 400)
        }
        const note = await restoreVersion(body.noteId, body.versionId)
        return json(note)
      }

      // 기본: 노트 생성
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
