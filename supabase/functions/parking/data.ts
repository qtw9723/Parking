import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const DATA_GO_KR_KEY = Deno.env.get("PUBLIC_DATA_SERVICE_KEY") ?? ""

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

/**
 * 조회 범위 상수
 * - 실시간 API는 5,000건이면 교집합 대상이 모두 포함됩니다 (실측 인덱스 2779~4804, 약 0.6초)
 * - 상세 API는 50,000건에 약 25초 소요되며, 그 이상 늘려도 교집합 건수가 거의 늘지 않습니다
 */
const REALTIME_LOOKUP_ROWS = 5000
const STTUS_LOOKUP_ROWS = 50000

/**
 * ID 가공 함수
 */
function getLogicalId(id: any): string {
  return String(id ?? "").trim().replace(/\uFEFF/g, "").split("-").slice(0, 2).join("-")
}

/**
 * 실시간 정보 API 호출 (PrkRealtimeInfo)
 */
async function fetchRealtime(numOfRows = 100, pageNo = 1) {
  const url = `http://apis.data.go.kr/B553881/Parking/PrkRealtimeInfo?serviceKey=${DATA_GO_KR_KEY}&pageNo=${pageNo}&numOfRows=${numOfRows}&format=2`
  try {
    const res = await fetch(url)
    const json = await res.json()
    return json?.PrkRealtimeInfo || json?.PrkSttusInfo || []
  } catch (e) {
    console.error("Realtime Fetch Error:", e)
    return []
  }
}

/**
 * 상세 정보 API 호출 (PrkSttusInfo)
 */
async function fetchSttusInfo(numOfRows = 100, pageNo = 1) {
  const url = `http://apis.data.go.kr/B553881/Parking/PrkSttusInfo?serviceKey=${DATA_GO_KR_KEY}&pageNo=${pageNo}&numOfRows=${numOfRows}&format=2`
  try {
    const res = await fetch(url)
    const json = await res.json()
    return json?.PrkSttusInfo || []
  } catch (e) {
    console.error("Status Fetch Error:", e)
    return []
  }
}

/* ==========================================================
   EXPORT FUNCTIONS
========================================================== */

/**
 * 1️⃣ 최초 데이터 적재 (ID만 먼저 넣기)
 */
export async function initParkingIds() {
  const realtimeList = await fetchRealtime()
  if (!realtimeList || realtimeList.length === 0) return 0

  const rows = realtimeList.map((r: any) => ({
    prk_center_id: r.prk_center_id
  }))

  const uniqueRows = Array.from(
    new Map(rows.map((row) => [row.prk_center_id, row])).values()
  )

  const { error } = await supabase.from("parking_lot").upsert(uniqueRows, { onConflict: "prk_center_id" })
  if (error) throw error

  return uniqueRows.length
}

/**
 * 2️⃣ 순서대로 나머지 값 적재 (ID 매칭 없이 업데이트)
 */
export async function updateParkingDetails() {
  const url = `http://apis.data.go.kr/B553881/Parking/PrkSttusInfo?serviceKey=${DATA_GO_KR_KEY}&pageNo=1&numOfRows=100&format=2`;

  const res = await fetch(url);
  const json = await res.json();
  const apiList = json?.PrkSttusInfo || [];

  if (apiList.length === 0) return { success: false, message: "API 데이터 없음" };

  // 1. 기존 DB ID 가져오기
  const { data: dbRows, error: selectError } = await supabase
    .from("parking_lot")
    .select("prk_center_id")
    .order("created_at", { ascending: true });

  if (selectError || !dbRows) throw selectError;

  // 2. 데이터 매핑 (순서대로)
  const updateRows = dbRows.map((dbRow: any, index: number) => {
    const apiData = apiList[index];
    if (!apiData) return null;

    return {
      prk_center_id: dbRow.prk_center_id,
      name: apiData.prk_plce_nm,
      sido: apiData.prk_plce_adres_sido,
      sigungu: apiData.prk_plce_adres_sigungu,
      address: apiData.prk_plce_adres,
      latitude: apiData.prk_plce_entrc_la ? Number(apiData.prk_plce_entrc_la) : null,
      longitude: apiData.prk_plce_entrc_lo ? Number(apiData.prk_plce_entrc_lo) : null,
    };
  }).filter(Boolean);

  // 3. DB 업데이트 수행
  const { error: upsertError } = await supabase
    .from("parking_lot")
    .upsert(updateRows);

  if (upsertError) throw upsertError;

  // 4. 🔥 결과 반환: 업데이트된 데이터 중 상위 5개만 샘플로 보여주거나 전체 반환
  // 여기서는 업데이트된 전체 리스트를 반환하도록 구성했습니다.
  return {
    success: true,
    updated_count: updateRows.length,
    data: updateRows // 방금 DB에 밀어넣은 데이터 배열
  };
}
/**
 * 🆕 최소 주차면수 기준 재적재 (기존 데이터 전량 교체)
 *
 * 실시간 API와 상세 API는 prk_center_id 체계가 서로 달라 대부분 매칭되지 않습니다.
 * 그래서 양쪽 모두에 존재하는 ID(교집합)만 골라 적재합니다.
 * 이렇게 하면 이름·주소·좌표(상세 API)와 실시간 점유 현황(실시간 API)이 모두 정확히 붙습니다.
 *
 * @param minSpaces 최소 총 주차면수 (이상). 기본 50
 * @param limit     최대 적재 건수. 0이면 조건에 맞는 전량
 */
export async function reloadParking(minSpaces = 50, limit = 0) {
  const [realtimeList, sttusList] = await Promise.all([
    fetchRealtime(REALTIME_LOOKUP_ROWS),
    fetchSttusInfo(STTUS_LOOKUP_ROWS),
  ])

  if (!realtimeList.length || !sttusList.length) {
    throw new Error(`외부 API 응답 없음 (realtime=${realtimeList.length}, sttus=${sttusList.length})`)
  }

  const sttusMap = new Map<string, any>(
    sttusList.map((s: any) => [s.prk_center_id, s] as [string, any])
  )

  const seen = new Set<string>()
  const rows: any[] = []

  for (const r of realtimeList) {
    const id = r.prk_center_id
    if (!id || seen.has(id)) continue
    if (Number(r.pkfc_ParkingLots_total ?? 0) < minSpaces) continue

    const s = sttusMap.get(id)
    if (!s) continue // 상세 정보가 없으면 제외 (교집합만 적재)

    seen.add(id)
    rows.push({
      prk_center_id: id,
      name: s.prk_plce_nm ?? null,
      sido: s.prk_plce_adres_sido ?? null,
      sigungu: s.prk_plce_adres_sigungu ?? null,
      address: s.prk_plce_adres ?? null,
      latitude: s.prk_plce_entrc_la ? Number(s.prk_plce_entrc_la) : null,
      longitude: s.prk_plce_entrc_lo ? Number(s.prk_plce_entrc_lo) : null,
    })

    if (limit > 0 && rows.length >= limit) break
  }

  if (rows.length === 0) {
    return {
      success: false,
      message: `조건에 맞는 주차장이 없습니다 (min_spaces=${minSpaces})`,
      min_spaces: minSpaces,
      inserted: 0,
    }
  }

  // 기존 데이터 전량 삭제 후 교체
  const { error: deleteError } = await supabase
    .from("parking_lot")
    .delete()
    .neq("prk_center_id", "__none__")
  if (deleteError) throw deleteError

  const { error: insertError } = await supabase.from("parking_lot").insert(rows)
  if (insertError) throw insertError

  return {
    success: true,
    min_spaces: minSpaces,
    scanned: { realtime: realtimeList.length, sttus: sttusList.length },
    inserted: rows.length,
    sample: rows.slice(0, 5),
  }
}

/**
 * 3️⃣ 전체 주차장 조회
 */
export async function getAllParking() {
  const { data: parking, error } = await supabase.from("parking_lot").select("*")
  if (error) throw error

  const realtimeList = await fetchRealtime(REALTIME_LOOKUP_ROWS)
  const realtimeMap = new Map(realtimeList.map((r: any) => [r.prk_center_id, r]))

  return parking.map((p: any) => {
    const r = realtimeMap.get(p.prk_center_id)
    return {
      ...p,
      realtime: r ?? null
    }
  })
}

/**
 * 4️⃣ 단일 주차장 조회 (실시간 병합)
 */
export async function getParkingById(id: string) {
  // 1. DB 상세 조회 (고정 정보)
  const { data: dbData, error } = await supabase
    .from("parking_lot")
    .select("name,sido, sigungu, address, latitude, longitude, prk_center_id") // 필요한 컬럼만 명시하면 더 깔끔합니다.
    .eq("prk_center_id", id)
    .single()

  if (error || !dbData) return null

  // 2. 실시간 정보 가져오기
  const realtimeList = await fetchRealtime(REALTIME_LOOKUP_ROWS)

  // 3. 해당 ID의 실시간 데이터 딱 하나만 찾기
  const realtimeData = realtimeList.find((r: any) => r.prk_center_id === id)

  // 4. 최종 결과 조립 (불필요한 raw 데이터 제외)
  return {
    prk_center_id: dbData.prk_center_id,
    name: dbData.name,
    sido: dbData.sido,
    sigungu: dbData.sigungu,
    address: dbData.address,
    latitude: dbData.latitude,
    longitude: dbData.longitude,
    // 실시간 정보에서 숫자만 추출해서 넣기
    total_spaces: realtimeData
      ? parseInt(realtimeData.pkfc_ParkingLots_total || "0")
      : 0,
    available_spaces: realtimeData
      ? parseInt(realtimeData.pkfc_Available_ParkingLots_total || "0")
      : 0,
    last_updated: new Date().toISOString()
  }
}