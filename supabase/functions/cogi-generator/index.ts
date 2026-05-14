import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

function setNestedValue(obj: unknown, path: string, value: unknown): void {
  const keys = path.replace(/^\$\./, "").split(".")
  let current: any = obj

  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current)) {
      current[keys[i]] = {}
    }
    current = current[keys[i]]
  }

  current[keys[keys.length - 1]] = value
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*" }
    })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  try {
    const { responses, reference_id } = await req.json()

    const { data: reference, error: refError } = await supabase
      .from("cogi_references")
      .select("*")
      .eq("id", reference_id)
      .single()

    if (refError || !reference) {
      throw new Error("Reference not found")
    }

    if (!reference.generation_template) {
      throw new Error("Reference rules not learned yet")
    }

    const generatedJson = JSON.parse(JSON.stringify(reference.json_data))
    const { mappings } = reference.generation_template

    for (const [key, path] of Object.entries(mappings)) {
      if (responses[key]) {
        setNestedValue(generatedJson, path as string, responses[key])
      }
    }

    const { data: result, error: saveError } = await supabase
      .from("cogi_results")
      .insert([{
        responses,
        generated_json: generatedJson,
        reference_id
      }])
      .select()

    if (saveError) throw saveError

    return new Response(JSON.stringify(result[0]), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    })
  }
})
