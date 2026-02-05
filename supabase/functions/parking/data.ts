// supabase/functions/parking/data.ts
export const VALID_PARKING_CODES = new Map<string, any>([
  ["A100", { name: "강남 제1주차장", capacity: 120 }],
  ["B200", { name: "판교 환승주차장", capacity: 300 }],
  ["C300", { name: "시청 공영주차장", capacity: 80 }],
])
