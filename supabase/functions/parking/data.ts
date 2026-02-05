import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const DATA_GO_KR_KEY = Deno.env.get("PUBLIC_DATA_SERVICE_KEY") ?? ""

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

/**
 * ID 가공 함수
 */
function getLogicalId(id: any): string {
  return String(id ?? "").trim().replace(/\uFEFF/g, "").split("-").slice(0, 2).join("-")
}

/**
 * 실시간 정보 API 호출 (PrkRealtimeInfo)
 */
async function fetchRealtime() {
  const url = `http://apis.data.go.kr/B553881/Parking/PrkRealtimeInfo?serviceKey=${DATA_GO_KR_KEY}&pageNo=1&numOfRows=100&format=2`
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
async function fetchSttusInfo() {
  const url = `http://apis.data.go.kr/B553881/Parking/PrkSttusInfo?serviceKey=${DATA_GO_KR_KEY}&pageNo=1&numOfRows=100&format=2`
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
 * 3️⃣ 전체 주차장 조회
 */
export async function getAllParking() {
  const { data: parking, error } = await supabase.from("parking_lot").select("*")
  if (error) throw error

  const realtimeList = await fetchRealtime()
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
  const realtimeList = await fetchRealtime()

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