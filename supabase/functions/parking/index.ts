import {
  initParkingIds,
  getParkingById,
  getAllParking,
  updateParkingDetails,
  reloadParking,
} from "./data.ts"

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    // Supabase URL이 .../v1/parking 이면 pathname은 "/"가 됩니다.
    const pathname = url.pathname
    const method = req.method

    console.log(`Method: ${method}, Path: ${pathname}`); // 로그로 경로 확인용

    // 🆕 최소 주차면수 기준 재적재 (기존 데이터 전량 교체)
    //    예: POST /reload?min=50  ,  POST /reload?min=50&limit=100
    if (method === "POST" && pathname.includes("/reload")) {
      const minParam = Number(url.searchParams.get("min"))
      const limitParam = Number(url.searchParams.get("limit"))
      const min = Number.isFinite(minParam) && minParam > 0 ? minParam : 50
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 0

      const result = await reloadParking(min, limit)
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { "Content-Type": "application/json" }
      })
    }

    // 2️⃣ 데이터 추가 적재 (이름, 주소 등)
    if (method === "POST" && pathname.includes("/initInfo")) {
      // 주의: data.ts에 updateParkingDetails 함수가 있다면 그걸 호출해야 합니다.
      const count = await updateParkingDetails()
      return new Response(JSON.stringify({ success: true, inserted: count }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    }

    // 1️⃣ 최초 데이터 적재 (ID만)
    if (method === "POST" && pathname.includes("/init")) {
      const count = await initParkingIds()
      return new Response(JSON.stringify({ success: true, inserted: count }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    }

    // 3️⃣ 주차장 조회 (전체 또는 단일)
    // 주소 끝이 /v1/parking 이면 pathname은 "/" 이거나 "" 일 수 있습니다.
    if (method === "GET" && (pathname === "/" || pathname === "" || pathname === "/parking")) {
      const id = url.searchParams.get("id");

      // ID가 있는 경우 (?id=...) -> 단일 조회
      if (id && id.trim() !== "") {
        const data = await getParkingById(id);
        if (!data) {
          return new Response(JSON.stringify({ error: "parking not found", id }), {
            status: 404,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      // ID가 없는 경우 -> 전체 목록 반환
      const allData = await getAllParking();
      return new Response(JSON.stringify(allData), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 경로가 맞지 않을 때
    return new Response(JSON.stringify({ error: "invalid route", path: pathname }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    })

  } catch (e) {
    console.error("❌ parking index error", e)
    return new Response(JSON.stringify({ error: "internal server error", details: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    })
  }
})