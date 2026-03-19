import { createClient } from "jsr:@supabase/supabase-js@2"

function getClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )
}

// 노트 목록 조회 (content 제외 — 목록에선 불필요)
export async function getNotes() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("notes")
    .select("id, title, content_type, tags, created_at, updated_at")
    .order("updated_at", { ascending: false })
  if (error) throw error
  return data
}

// 단일 노트 조회 (content 포함)
export async function getNoteById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("id", id)
    .single()
  if (error) return null
  return data
}

// 노트 생성
export async function createNote(body: {
  title?: string
  content?: string
  content_type?: string
  tags?: string[]
}) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("notes")
    .insert({
      title: body.title ?? "새 메모",
      content: body.content ?? "",
      content_type: body.content_type ?? "markdown",
      tags: body.tags ?? [],
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// 노트 수정
export async function updateNote(id: string, changes: Record<string, unknown>) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("notes")
    .update(changes)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data
}

// 노트 삭제
export async function deleteNote(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("notes").delete().eq("id", id)
  if (error) throw error
}
