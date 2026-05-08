import { createClient } from "jsr:@supabase/supabase-js@2"
import webpush from "npm:web-push@3"

function getClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )
}

// ─── Lists ────────────────────────────────────────────────────────────────────

export async function getLists(userId: string) {
  const { data, error } = await getClient()
    .from("todo_lists")
    .select("*")
    .eq("user_id", userId)
    .order("order_index", { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createList(userId: string, title: string, color: string) {
  const supabase = getClient()
  const { data: existing } = await supabase
    .from("todo_lists").select("order_index").eq("user_id", userId)
    .order("order_index", { ascending: false }).limit(1).maybeSingle()
  const order_index = (existing?.order_index ?? -1) + 1
  const { data, error } = await supabase
    .from("todo_lists").insert({ user_id: userId, title, color, order_index })
    .select().single()
  if (error) throw error
  return data
}

export async function updateList(id: string, changes: Record<string, unknown>) {
  const { data, error } = await getClient()
    .from("todo_lists").update(changes).eq("id", id).select().single()
  if (error) throw error
  return data
}

export async function deleteList(id: string) {
  const { error } = await getClient().from("todo_lists").delete().eq("id", id)
  if (error) throw error
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function getItems(userId: string, listId?: string) {
  let q = getClient().from("todo_items").select("*").eq("user_id", userId)
  if (listId) q = q.eq("list_id", listId)
  const { data, error } = await q.order("order_index", { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createItem(body: {
  list_id: string
  user_id: string
  text: string
  priority?: number
  due_date?: string | null
  start_date?: string | null
  scheduled_time?: string | null
  memo?: string | null
  recurrence?: string
  note_id?: string | null
  note_ids?: string[]
  tags?: string[]
  end_time?: string | null
  end_date?: string | null
}) {
  const supabase = getClient()
  const { data: existing } = await supabase
    .from("todo_items").select("order_index").eq("list_id", body.list_id)
    .order("order_index", { ascending: false }).limit(1).maybeSingle()
  const order_index = (existing?.order_index ?? -1) + 1
  const { data, error } = await supabase
    .from("todo_items").insert({ ...body, order_index }).select().single()
  if (error) throw error
  return data
}

export async function updateItem(id: string, changes: Record<string, unknown>) {
  if (changes.done === true) {
    // 주기 항목이면 완료 표시 대신 last_completed_at 갱신 후 done 리셋
    const { data: current } = await getClient()
      .from("todo_items").select("recurrence").eq("id", id).single()
    if (current?.recurrence && current.recurrence !== "none") {
      changes = { ...changes, done: false, last_completed_at: new Date().toISOString(), completed_at: null }
    } else {
      if (!changes.completed_at) changes.completed_at = new Date().toISOString()
    }
  }
  if (changes.done === false) {
    changes.completed_at = null
  }
  const { data, error } = await getClient()
    .from("todo_items").update(changes).eq("id", id).select().single()
  if (error) throw error
  return data
}

export async function deleteItem(id: string) {
  const { error } = await getClient().from("todo_items").delete().eq("id", id)
  if (error) throw error
}

export async function reorderItems(items: { id: string; order_index: number }[]) {
  const supabase = getClient()
  await Promise.all(
    items.map(({ id, order_index }) =>
      supabase.from("todo_items").update({ order_index }).eq("id", id)
    )
  )
}

// ─── Push ─────────────────────────────────────────────────────────────────────

export async function savePushSubscription(
  userId: string,
  sub: { endpoint: string; p256dh: string; auth: string },
) {
  const { error } = await getClient()
    .from("push_subscriptions")
    .upsert({ user_id: userId, ...sub }, { onConflict: "endpoint" })
  if (error) throw error
}

export async function deletePushSubscription(endpoint: string) {
  const { error } = await getClient()
    .from("push_subscriptions").delete().eq("endpoint", endpoint)
  if (error) throw error
}

export async function getPushSubscriptions(userId: string) {
  const { data, error } = await getClient()
    .from("push_subscriptions").select("*").eq("user_id", userId)
  if (error) throw error
  return data ?? []
}

// ─── Alarms ───────────────────────────────────────────────────────────────────

type PushPayload = { title: string; body: string; itemId?: string }

async function sendPushToUser(userId: string, payload: PushPayload) {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY")
  if (!publicKey || !privateKey) return

  webpush.setVapidDetails("mailto:admin@example.com", publicKey, privateKey)

  const subs = await getPushSubscriptions(userId)
  await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      )
    ),
  )
}

async function hasAlarmLogToday(itemId: string, channel: string): Promise<boolean> {
  // KST 오늘 자정 기준 (UTC+9)
  const kstOffset = 9 * 60 * 60 * 1000
  const kstNow = new Date(Date.now() + kstOffset)
  kstNow.setUTCHours(0, 0, 0, 0)
  const dayStartUTC = new Date(kstNow.getTime() - kstOffset)

  const { data } = await getClient()
    .from("todo_alarm_logs")
    .select("id")
    .eq("item_id", itemId)
    .eq("channel", channel)
    .gte("sent_at", dayStartUTC.toISOString())
    .maybeSingle()
  return !!data
}

async function logAlarm(itemId: string, channel: string) {
  await getClient().from("todo_alarm_logs").insert({ item_id: itemId, channel })
}

export async function checkAlarms() {
  // KST 현재 시각
  const kstOffset = 9 * 60 * 60 * 1000
  const kstNow = new Date(Date.now() + kstOffset)
  const todayKST = kstNow.toISOString().slice(0, 10)           // YYYY-MM-DD
  const currentMins = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes()

  // 오늘 날짜, scheduled_time 있는 미완료 항목
  const { data: items, error } = await getClient()
    .from("todo_items")
    .select("*")
    .eq("done", false)
    .eq("start_date", todayKST)
    .not("scheduled_time", "is", null)

  if (error) throw error
  if (!items?.length) return { checked: 0, sent: 0 }

  let sent = 0

  for (const item of items) {
    const [h, m] = (item.scheduled_time as string).split(":").map(Number)
    const scheduledMins = h * 60 + m
    const diff = scheduledMins - currentMins // 양수 = 아직 미래

    // 15분 전 알람 (14~16분 범위 → cron 1분 단위 여유)
    if (diff >= 14 && diff <= 16) {
      if (!await hasAlarmLogToday(item.id, "push:before")) {
        await sendPushToUser(item.user_id, {
          title: "⏰ 15분 후 일정",
          body: item.text,
          itemId: item.id,
        })
        await logAlarm(item.id, "push:before")
        sent++
      }
    }

    // 시간 됐는데 미완료 알람 (-1~1분 범위)
    if (diff >= -1 && diff <= 1) {
      if (!await hasAlarmLogToday(item.id, "push:at")) {
        await sendPushToUser(item.user_id, {
          title: "🔔 지금 일정 (미완료)",
          body: item.text,
          itemId: item.id,
        })
        await logAlarm(item.id, "push:at")
        sent++
      }
    }
  }

  return { checked: items.length, sent }
}
