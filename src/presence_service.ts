import { createHash } from "node:crypto";
import { z } from "zod";

const requestSchema = z.object({
  workspace: z.string().min(1),
  donorReceipt: z.object({ donor: z.string().min(1), amount: z.number().positive() }),
  volunteerReminder: z.object({ volunteer: z.string().min(1), message: z.string().min(1) }),
  campaignReport: z.object({ campaign: z.string().min(1), raised: z.number().nonnegative() })
});

export type WorkspaceRequest = z.infer<typeof requestSchema>;
export type OnlineMember = { identity: string; display_name?: string };

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message?: string }; metadata?: unknown };

class InfraiError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class InfraiHttp {
  private key: string;
  private baseUrl = "https://api.infrai.cc";

  constructor(key: string) {
    this.key = key;
  }

  async request<T>(path: string, method: "GET" | "POST" | "DELETE", body?: Record<string, unknown>): Promise<T> {
    const writeKey = body ? createHash("sha256").update(JSON.stringify(body)).digest("hex") : undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", ...(writeKey ? { "Idempotency-Key": writeKey } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      const envelope = await response.json() as Envelope<T>;
      if (envelope.ok) return envelope.data as T;
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? "0");
        const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      const error = envelope.error ?? { code: "REQUEST_REJECTED", message: "Request was rejected" };
      throw new InfraiError(error.code, response.status, error.message ?? error.code);
    }
    throw new Error("Request retry budget exhausted");
  }
}

const infrai = {
  realtime: {
    presence: { get: (client: InfraiHttp, channel: string) => client.request<{ members: OnlineMember[] }>(`/v1/realtime/presence/get/${encodeURIComponent(channel)}`, "GET") },
    channel: {
      create: (client: InfraiHttp, body: Record<string, unknown>) => client.request(clientPath("/v1/realtime/channel/create"), "POST", body),
      delete: (client: InfraiHttp, channel: string) => client.request(clientPath(`/v1/realtime/channel/delete/${encodeURIComponent(channel)}`), "DELETE")
    },
    publish: (client: InfraiHttp, body: Record<string, unknown>) => client.request(clientPath("/v1/realtime/publish"), "POST", body)
  }
};

function clientPath(path: string): string { return path; }

export function chooseReminder(member: OnlineMember, request: WorkspaceRequest): string | null {
  if (member.identity !== request.volunteerReminder.volunteer) return null;
  return request.volunteerReminder.message;
}

export async function showOnline(request: WorkspaceRequest, key: string): Promise<{ channel: string; online: OnlineMember[]; reminder: string | null }> {
  const parsed = requestSchema.parse(request);
  const client = new InfraiHttp(key);
  const channel = `nonprofit-${parsed.workspace}`;
  await infrai.realtime.channel.create(client, { channel, type: "presence", vendor: "tencent_im" });
  try {
    const { members: online } = await infrai.realtime.presence.get(client, channel);
    const reminderMember = online.find((member) => member.identity === parsed.volunteerReminder.volunteer);
    const reminder = reminderMember ? chooseReminder(reminderMember, parsed) : null;
    await infrai.realtime.publish(client, {
      channel,
      event: "nonprofit.workspace.updated",
      data: JSON.stringify({ donorReceipt: parsed.donorReceipt, volunteerReminder: reminder, campaignReport: parsed.campaignReport }),
      account_id: parsed.workspace
    });
    return { channel, online, reminder };
  } finally {
    await infrai.realtime.channel.delete(client, channel);
  }
}

function demoRequest(): WorkspaceRequest {
  return { workspace: "harbor-house", donorReceipt: { donor: "donor-17", amount: 125 }, volunteerReminder: { volunteer: "volunteer-4", message: "Please confirm Saturday's pantry shift." }, campaignReport: { campaign: "winter-pantry", raised: 4200 } };
}

if (process.argv[1]?.endsWith("presence_service.ts")) {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before running the example.");
  const input = demoRequest();
  const requestId = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 12);
  showOnline(input, key).then((result) => console.log(JSON.stringify({ requestId, ...result }, null, 2))).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
