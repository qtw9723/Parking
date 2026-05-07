import { createClient } from "jsr:@supabase/supabase-js@2"
import {
  getLists, createList, updateList, deleteList,
  getItems, createItem, updateItem, deleteItem, reorderItems,
  savePushSubscription, deletePushSubscription,
  checkAlarms,
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

async function getUser(req: Request) {
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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const method = req.method
    const id = url.searchParams.get("id")
    const type = url.searchParams.get("type")  // list | item

    // ── GET ──────────────────────────────────────────────────────────────────
    if (method === "GET") {
      const user = await getUser(req)
      if (!user) return json({ error: "unauthorized" }, 401)

      // GET ?type=lists
      if (type === "lists") return json(await getLists(user.id))

      // GET ?type=items&listId=xxx  or  ?type=items (all)
      if (type === "items") {
        const listId = url.searchParams.get("listId") ?? undefined
        return json(await getItems(user.id, listId))
      }

      return json({ error: "type required" }, 400)
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (method === "POST") {
      const body = await req.json()

      // alarm-check — cron 호출 (BACKUP_SECRET 인증)
      if (body.action === "alarm-check") {
        const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "")
        if (token !== Deno.env.get("BACKUP_SECRET")) return json({ error: "unauthorized" }, 401)
        return json(await checkAlarms())
      }

      const user = await getUser(req)
      if (!user) return json({ error: "unauthorized" }, 401)

      // push-subscribe
      if (body.action === "push-subscribe") {
        await savePushSubscription(user.id, { endpoint: body.endpoint, p256dh: body.p256dh, auth: body.auth })
        return json({ success: true })
      }

      // push-unsubscribe
      if (body.action === "push-unsubscribe") {
        await deletePushSubscription(body.endpoint)
        return json({ success: true })
      }

      // reorder items
      if (body.action === "reorder") {
        await reorderItems(body.items)
        return json({ success: true })
      }

      // create list
      if (type === "list") {
        const list = await createList(user.id, body.title, body.color ?? "#9d8ffc")
        return json(list, 201)
      }

      // create item
      if (type === "item") {
        const item = await createItem({ ...body, user_id: user.id })
        return json(item, 201)
      }

      return json({ error: "type required" }, 400)
    }

    // ── PATCH ────────────────────────────────────────────────────────────────
    if (method === "PATCH") {
      if (!id) return json({ error: "id required" }, 400)
      const user = await getUser(req)
      if (!user) return json({ error: "unauthorized" }, 401)
      const body = await req.json()

      if (type === "list") return json(await updateList(id, body))
      if (type === "item") return json(await updateItem(id, body))
      return json({ error: "type required" }, 400)
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (method === "DELETE") {
      if (!id) return json({ error: "id required" }, 400)
      const user = await getUser(req)
      if (!user) return json({ error: "unauthorized" }, 401)

      if (type === "list") { await deleteList(id); return json({ success: true }) }
      if (type === "item") { await deleteItem(id); return json({ success: true }) }
      return json({ error: "type required" }, 400)
    }

    return json({ error: "invalid route" }, 404)
  } catch (e) {
    console.error("❌ todos error", e)
    return json({ error: "internal server error", details: e.message }, 500)
  }
})
