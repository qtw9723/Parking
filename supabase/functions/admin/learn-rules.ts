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

async function callGeminiAPI(jsonData: unknown, apiKey: string): Promise<unknown> {
  const prompt = `분석해줄 Cogi Dialog JSON 구조:
${JSON.stringify(jsonData, null, 2)}

이 JSON의 구조를 분석하고, 사용자의 답변(봇 이름, 인사말, 기능 설명 등)을 기반으로 어떻게 이 JSON을 변환해야 하는지 규칙을 정의해줘.

반환 형식은 반드시 다음 JSON 구조여야 해:
{
  "mappings": {
    "botName": "$.path.to.field",
    "greeting": "$.another.path"
  },
  "rules": "변환 규칙 설명",
  "instructions": "특별한 지시사항"
}

JSON 객체만 반환해줘, 다른 설명은 없이.`

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  })

  if (!response.ok) {
    throw new Error("Gemini API error: " + (await response.text()))
  }

  const result = await response.json()
  const text = result.candidates[0].content.parts[0].text

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Could not extract JSON from Gemini response")

  return JSON.parse(jsonMatch[0])
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*" }
    })
  }

  if (!verifyAdminToken(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  }

  try {
    const url = new URL(req.url)
    const referenceId = url.pathname.split("/").slice(-2)[0]

    const { data: reference, error: fetchError } = await supabase
      .from("cogi_references")
      .select("*")
      .eq("id", referenceId)
      .single()

    if (fetchError || !reference) {
      throw new Error("Reference not found")
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY")
    if (!geminiKey) throw new Error("Gemini API key not configured")

    const template = await callGeminiAPI(reference.json_data, geminiKey)

    const { error: updateError } = await supabase
      .from("cogi_references")
      .update({
        generation_template: template,
        template_status: "completed"
      })
      .eq("id", referenceId)

    if (updateError) throw updateError

    return new Response(JSON.stringify({ success: true, template }), {
      headers: { "Content-Type": "application/json" }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    })
  }
})
