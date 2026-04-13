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

// ─── note_versions ────────────────────────────────────────────────────────

// 버전 저장
export async function saveVersion(
  noteId: string,
  note: { title: string; content: string; content_type: string; tags: string[] },
  trigger: "daily_backup" | "shrinkage" | "pre_restore",
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("note_versions")
    .insert({
      note_id: noteId,
      title: note.title,
      content: note.content,
      content_type: note.content_type,
      tags: note.tags,
      trigger,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// 버전 목록 조회 (최신순, 최대 200개)
export async function getVersions(noteId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("note_versions")
    .select("id, trigger, created_at, title, content, content_type, tags")
    .eq("note_id", noteId)
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) throw error
  return data ?? []
}

// 자정 백업 실행 — 변경된 노트만, daily_backup 90개 초과분 정리
export async function runDailyBackup() {
  const supabase = getClient()

  const { data: notes, error: notesError } = await supabase
    .from("notes")
    .select("id, title, content, content_type, tags")
  if (notesError) throw notesError

  for (const note of notes ?? []) {
    // 마지막 daily_backup 조회
    const { data: lastBackup } = await supabase
      .from("note_versions")
      .select("content")
      .eq("note_id", note.id)
      .eq("trigger", "daily_backup")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    // 변경된 경우에만 저장
    if (!lastBackup || lastBackup.content !== note.content) {
      await saveVersion(note.id, note, "daily_backup")
    }

    // 90개 초과분 정리
    const { data: allBackups } = await supabase
      .from("note_versions")
      .select("id")
      .eq("note_id", note.id)
      .eq("trigger", "daily_backup")
      .order("created_at", { ascending: false })

    const toDelete = (allBackups ?? []).slice(90)
    if (toDelete.length > 0) {
      await supabase
        .from("note_versions")
        .delete()
        .in("id", toDelete.map((v) => v.id))
    }
  }
}

// 특정 버전으로 복구 (현재 상태를 pre_restore로 먼저 저장)
export async function restoreVersion(noteId: string, versionId: string) {
  const supabase = getClient()

  // 복구할 버전 조회
  const { data: version, error: versionError } = await supabase
    .from("note_versions")
    .select("title, content, content_type, tags")
    .eq("id", versionId)
    .single()
  if (versionError || !version) throw new Error("version not found")

  // 현재 노트 상태를 pre_restore로 저장
  const { data: currentNote } = await supabase
    .from("notes")
    .select("title, content, content_type, tags")
    .eq("id", noteId)
    .single()
  if (currentNote) {
    await saveVersion(noteId, currentNote, "pre_restore")
  }

  // 노트를 해당 버전으로 업데이트
  const { data: updatedNote, error: updateError } = await supabase
    .from("notes")
    .update({
      title: version.title,
      content: version.content,
      content_type: version.content_type,
      tags: version.tags,
    })
    .eq("id", noteId)
    .select()
    .single()
  if (updateError) throw updateError
  return updatedNote
}
