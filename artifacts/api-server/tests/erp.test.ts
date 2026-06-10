/**
 * erp.ts 회귀 테스트 — 검색 갭 1·2 (출하된 호기 + 거래처→제품 우회) 회귀 방지가 주 목표.
 *
 * 운영 Neon DB에 실 SELECT를 보내는 통합 테스트. 데이터 변경 없음.
 * vitest.config.ts 가 PRIVATE/app_db.json 의 database_url 을 DATABASE_URL 환경변수로 주입.
 *
 * 케이스:
 *   ① 부품코드 + 호기 → vendor 정확 매칭 (shipments JOIN)
 *   ② 제품명 + 호기 (출하됨) → 단건 + vendor (갭 1 회귀 방지)
 *   ③ 거래처명만 → shipments 우회로 item 매칭 (갭 2 회귀 방지)
 *   ④ 호기 단독 → production_orders ∪ shipments 합집합 후보
 *   ⑤ 한자 정규화 → JD-1400EⅡ = JD-1400EII 동일 결과
 */
import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import erpRouter from "../src/routes/erp";

const app = express();
app.use(express.json());
app.use("/api", erpRouter);

describe("/api/erp/input-data", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL 미설정 — PRIVATE/app_db.json 의 database_url 이 vitest.config 로 주입되지 않았습니다.",
      );
    }
  });

  it("① 부품코드 + 호기 345 → 단건 + 거래처(리파츠) 자동매칭", async () => {
    const res = await request(app)
      .get("/api/erp/input-data?itemCode=T8NH-0000000-00&hogi=345")
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.itemCode).toBe("T8NH-0000000-00");
    expect(res.body.modelName).toMatch(/T-380N/);
    expect(res.body.itemGroup).toBe("T-380N");
    expect(res.body.factory).toBe("아산");
    expect(res.body.plantCd).toBe("SA00");
    expect(res.body.shipmentUnit).toBe("345");
    // 갭 1 핵심: shipments 매칭으로 vendor 추출
    expect(res.body.vendorCd).toBeTruthy();
    expect(res.body.vendorNm).toMatch(/리파츠/);
  });

  it("② 제품명 + 출하된 호기 (갭 1 회귀 방지) — production_orders 에 없어도 shipments 로 잡아야 함", async () => {
    const res = await request(app)
      .get("/api/erp/input-data?product=T-380N&hogi=345")
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.itemCode).toBe("T8NH-0000000-00");
    expect(res.body.vendorNm).toMatch(/리파츠/);
  });

  it("③ 거래처명 '리파츠' 단독 (갭 2 회귀 방지) — vendor → shipments 우회로 item 잡아야 함", async () => {
    const res = await request(app)
      .get("/api/erp/input-data?product=리파츠")
      .expect(200);
    // 단건이면 ok:true, 다건이면 후보 — 둘 다 허용. 핵심은 0건이 아닐 것.
    if (res.body.ok) {
      expect(res.body.itemCode).toBeTruthy();
    } else {
      expect(Array.isArray(res.body.candidates)).toBe(true);
      expect(res.body.candidates.length).toBeGreaterThan(0);
    }
  });

  it("④ 호기 단독 — production_orders + shipments 합집합 후보", async () => {
    const res = await request(app).get("/api/erp/input-data?hogi=100").expect(200);
    if (res.body.ok) {
      expect(res.body.itemCode).toBeTruthy();
    } else {
      expect(Array.isArray(res.body.candidates)).toBe(true);
      expect(res.body.candidates.length).toBeGreaterThan(0);
    }
  });

  it("⑤ 한자/영문 로마숫자 정규화 — JD-1400EⅡ = JD-1400EII", async () => {
    const han = await request(app)
      .get("/api/erp/input-data?product=JD-1400EⅡ&hogi=102")
      .expect(200);
    const eng = await request(app)
      .get("/api/erp/input-data?product=JD-1400EII&hogi=102")
      .expect(200);
    expect(han.body.ok).toBe(true);
    expect(eng.body.ok).toBe(true);
    expect(han.body.itemCode).toBe(eng.body.itemCode);
    expect(han.body.itemCode).toBe("D580000");
    expect(han.body.vendorNm).toBeTruthy();
  });
});
