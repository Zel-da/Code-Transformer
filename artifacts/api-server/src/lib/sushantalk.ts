import { logger } from "./logger.js";

// ────────────────────────────────────────────────────────────────
// 레거시 채널 webhook (부서 단위 발송)
// ────────────────────────────────────────────────────────────────

type SushantalkChannel = "qc" | "lab";

const WEBHOOK_URLS: Record<SushantalkChannel, string | undefined> = {
  qc: process.env.SSUSHAN_TALK_QC_WEBHOOK_URL,
  lab: process.env.SSUSHAN_TALK_LAB_WEBHOOK_URL,
};

export async function sendSushantalkMessage(
  channel: SushantalkChannel,
  text: string,
): Promise<void> {
  const url = WEBHOOK_URLS[channel];
  if (!url) {
    logger.debug({ channel }, "Sushantalk webhook URL not configured, skipping");
    return;
  }
  await sendSushantalkToUrl(url, text);
}

export async function sendSushantalkToUrl(
  url: string,
  text: string,
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Sushantalk webhook failed: ${response.status} ${response.statusText}`);
  }
}

// ────────────────────────────────────────────────────────────────
// 신규 PAT 기반 외부 API (개인 DM / 다수 수신자 / 채널 공지)
// ────────────────────────────────────────────────────────────────

function getPatConfig(): { baseUrl: string; token: string } | null {
  const baseUrl = (process.env.SUSHANTALK_BASE_URL ?? "").replace(/\/+$/, "");
  const token = process.env.SUSHANTALK_PAT_TOKEN ?? "";
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

/** PAT API가 설정되어 있는지 확인 */
export function isPatConfigured(): boolean {
  return getPatConfig() !== null;
}

export type SushantalkRecipient =
  | { toEmail: string }
  | { toEmployeeId: string }
  | { toName: string; toDept: string };

export interface SendDmOptions {
  recipient: SushantalkRecipient;
  content: string;
  botName?: string;
  roomName?: string;
}

export interface SendBulkOptions {
  recipients: SushantalkRecipient[];
  content: string;
  botName?: string;
  roomName?: string;
}

export interface SendChannelOptions {
  channelName: string;
  content: string;
  botName?: string;
}

/**
 * 개인 DM 발송 (단건).
 * SUSHANTALK_BASE_URL + SUSHANTALK_PAT_TOKEN 환경변수가 없으면 false 반환.
 */
export async function sendDm(opts: SendDmOptions): Promise<boolean> {
  const cfg = getPatConfig();
  if (!cfg) {
    logger.debug("SUSHANTALK_PAT_TOKEN not configured, skipping DM");
    return false;
  }

  const body = { ...opts.recipient, content: opts.content } as Record<string, unknown>;
  if (opts.botName) body.botName = opts.botName;
  if (opts.roomName) body.roomName = opts.roomName;

  const res = await fetch(`${cfg.baseUrl}/api/external/v1/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sushantalk DM failed: ${res.status} ${text}`);
  }
  return true;
}

/**
 * 다수 수신자 동시 발송 (최대 100명).
 * 이메일이 있는 수신자만 대상으로 하며, 성공/실패 수를 반환.
 */
export async function sendBulkDm(opts: SendBulkOptions): Promise<{ sent: number; failed: number }> {
  const cfg = getPatConfig();
  if (!cfg || opts.recipients.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const body: Record<string, unknown> = {
    recipients: opts.recipients,
    content: opts.content,
  };
  if (opts.botName) body.botName = opts.botName;
  if (opts.roomName) body.roomName = opts.roomName;

  const res = await fetch(`${cfg.baseUrl}/api/external/v1/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sushantalk bulk DM failed: ${res.status} ${text}`);
  }

  const json = await res.json() as { sent?: unknown[]; failed?: unknown[] };
  return {
    sent: json.sent?.length ?? 0,
    failed: json.failed?.length ?? 0,
  };
}

/**
 * 채널 공지 발송.
 */
export async function sendChannelNotice(opts: SendChannelOptions): Promise<boolean> {
  const cfg = getPatConfig();
  if (!cfg) {
    logger.debug("SUSHANTALK_PAT_TOKEN not configured, skipping channel notice");
    return false;
  }

  const body: Record<string, unknown> = {
    channelName: opts.channelName,
    content: opts.content,
  };
  if (opts.botName) body.botName = opts.botName;

  const res = await fetch(`${cfg.baseUrl}/api/external/v1/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sushantalk channel notice failed: ${res.status} ${text}`);
  }
  return true;
}
