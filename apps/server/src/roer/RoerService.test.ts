import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../serverSettings.ts";
import * as RoerService from "./RoerService.ts";

const threadId = ThreadId.make("thread-1");

function fixture(
  answer: (path: string, body: unknown) => Response,
  roer = { url: "https://roer.test", token: "roer-secret" },
) {
  const requests: Array<{ path: string; body: unknown }> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      expect(request.headers.authorization).toBe(`Bearer ${roer.token}`);
      const path = new URL(request.url).pathname;
      const body =
        request.body._tag === "Uint8Array"
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : undefined;
      requests.push({ path, body });
      return HttpClientResponse.fromWeb(request, answer(path, body));
    }),
  );
  const layer = RoerService.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(Settings.ServerSettingsService.layerTest({ roer })),
    Layer.provide(
      Layer.succeed(ThreadManagementService.ThreadManagementService, {
        getThreadShell: () =>
          Effect.succeed({ id: threadId, title: "Fix login", projectId: "project-1" }),
      } as unknown as ThreadManagementService.ThreadManagementService["Service"]),
    ),
  );
  return { requests, layer };
}

describe("RoerService", () => {
  it.effect("offers nothing until a URL and token are set", () => {
    const { requests, layer } = fixture(() => Response.json({}), { url: "", token: "" });
    return Effect.gen(function* () {
      const roer = yield* RoerService.RoerService;
      expect((yield* roer.placement({ threadId })).configured).toBe(false);
      expect(requests).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("moves a thread with its title and project, and links to its job in Roer", () => {
    const { requests, layer } = fixture(() =>
      Response.json({
        klusId: "klus_1",
        waar: "server",
        status: "bezig",
        branch: "mate/fix-login-abc123",
      }),
    );
    return Effect.gen(function* () {
      const roer = yield* RoerService.RoerService;
      const placement = yield* roer.moveThread({ threadId, to: "cloud" });
      expect(requests).toEqual([
        {
          path: "/api/t3/thread/thread-1/verplaats",
          body: { naar: "server", titel: "Fix login", project: "project-1" },
        },
      ]);
      expect(placement).toEqual({
        configured: true,
        location: "cloud",
        running: true,
        jobId: "klus_1",
        jobUrl: "https://roer.test/#/klus/klus_1",
        branch: "mate/fix-login-abc123",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("passes Roer's reason for refusing a move on, and never the token", () => {
    const { layer } = fixture((path) =>
      path.endsWith("/verplaats")
        ? Response.json(
            { fout: "In C:\\code\\app is sinds het verplaatsen iets veranderd." },
            { status: 409 },
          )
        : Response.json({}, { status: 500 }),
    );
    return Effect.gen(function* () {
      const roer = yield* RoerService.RoerService;
      const refused = yield* roer.moveThread({ threadId, to: "local" }).pipe(Effect.flip);
      expect(refused.detail).toMatch(/sinds het verplaatsen iets veranderd/);
      const failed = yield* roer.placement({ threadId }).pipe(Effect.flip);
      expect(failed.detail).toBe("Roer answered with HTTP 500.");
      expect(failed.detail).not.toContain("roer-secret");
    }).pipe(Effect.provide(layer));
  });

  it.effect("shows the cloud work, then only what changed, quickly while the cloud works", () => {
    let text = "Ik kijk";
    // Roer sends a growing text again with its new content; an unchanged row is not news.
    const { requests, layer } = fixture(() =>
      Response.json({
        klusId: "klus_1",
        waar: "server",
        status: "bezig",
        branch: null,
        regels: [
          {
            volgnr: 4,
            tijd: "2026-10-21T10:00:00.000Z",
            gebeurtenis: { soort: "melding", tekst: "Verplaatst naar de server.", naar: "server" },
          },
          {
            volgnr: 5,
            tijd: "2026-10-21T10:00:01.000Z",
            gebeurtenis: { soort: "tekst", tekst: text, klaar: false },
          },
        ],
      }),
    );
    return Effect.gen(function* () {
      const roer = yield* RoerService.RoerService;
      const frames = yield* roer
        .activity({ threadId })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
      yield* TestClock.adjust("1 second");
      text = "Ik kijk naar de login";
      yield* TestClock.adjust("1 second");
      const [first, second] = yield* Fiber.join(frames);
      expect(first!.replace).toBe(true);
      expect(first!.entries.map((entry) => [entry.kind, entry.text])).toEqual([
        ["notice", "Moved to the cloud"],
        ["assistant", "Ik kijk"],
      ]);
      expect(second!.replace).toBe(false);
      expect(second!.entries.map((entry) => entry.text)).toEqual(["Ik kijk naar de login"]);
      expect(requests[1]!.path).toBe("/api/t3/thread/thread-1/wolk");
    }).pipe(Effect.provide(layer));
  });

  it.effect("sends to the cloud and stops its turn, but not once the thread is back", () => {
    let where = "server";
    const { requests, layer } = fixture((path) =>
      path.startsWith("/api/klus/")
        ? Response.json({ klus: {} })
        : Response.json({ klusId: "klus_1", waar: where, status: "bezig", branch: null }),
    );
    return Effect.gen(function* () {
      const roer = yield* RoerService.RoerService;
      yield* roer.steerThread({ threadId, action: { type: "send", text: "Test ook de uitlog" } });
      yield* roer.steerThread({ threadId, action: { type: "interrupt" } });
      expect(requests.filter((request) => request.path.startsWith("/api/klus/"))).toEqual([
        { path: "/api/klus/klus_1/bericht", body: { tekst: "Test ook de uitlog" } },
        { path: "/api/klus/klus_1/onderbreek", body: {} },
      ]);
      where = "laptop";
      const refused = yield* roer
        .steerThread({ threadId, action: { type: "interrupt" } })
        .pipe(Effect.flip);
      expect(refused.detail).toMatch(/runs on this machine/);
    }).pipe(Effect.provide(layer));
  });
});
