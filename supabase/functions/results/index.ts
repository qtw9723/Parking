import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

function verifyAdminToken(req: Request): boolean {
  const auth = req.headers.get("Authorization")
  if (!auth?.startsWith("Bearer ")) return false
  const token = auth.slice(7)
  try {
    const decoded = atob(token)
    return decoded.includes("master")
  } catch {
    return false
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*" }
    })
  }

  try {
    const url = new URL(req.url)
    const pathSegments = url.pathname.split("/")
    const id = pathSegments[pathSegments.length - 1] !== "results" ? pathSegments[pathSegments.length - 1] : null

    if (req.method === "GET") {
      if (id && id !== "results") {
        const { data, error } = await supabase
          .from("cogi_results")
          .select("*")
          .eq("id", id)
          .single()

        if (error) throw error
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" }
        })
      } else {
        const { data, error } = await supabase
          .from("cogi_results")
          .select("*")
          .order("created_at", { ascending: false })

        if (error) throw error
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" }
        })
      }
    }

    if (req.method === "DELETE") {
      if (!verifyAdminToken(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
      }

      const { error } = await supabase
        .from("cogi_results")
        .delete()
        .eq("id", id)

      if (error) throw error
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      })
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    })
  }
})
