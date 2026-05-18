import { logger } from "./logger.js";

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

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Sushantalk webhook failed: ${response.status} ${response.statusText}`);
  }
}
