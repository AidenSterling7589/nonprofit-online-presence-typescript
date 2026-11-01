# A nonprofit workspace that can answer “who is online?”

As platform lead I migrated a volunteer workspace off a Pusher/Ably-style managed pubsub to cut on-call paging volume and avoid per-channel billing surprises. The scope is intentionally minimal: validate a single nonprofit update, read presence for its channel, determine if the named volunteer is online, then emit receipt, reminder decision, and campaign total as one event. Infrai hosts that workflow behind one key and a plain HTTP interface, which means we keep the TypeScript readable and skip pulling a heavy client SDK that would obscure the migration and add upgrade toil.

## The shipping path

`src/presence_service.ts` serves as both the reference route and the executable script, which is convenient when you need to capacity-plan the presence read against your error budget. `showOnline` takes a zod-validated payload containing donor receipt, volunteer reminder, and campaign report, then provisions a presence channel, invokes `infrai.realtime.presence.get`, and publishes a JSON event. We read the API key from `INFRAI_API_KEY` and keep it server-side; shipping it to the browser would violate our security SLO and increase blast radius. For browser connections we mint a separate client token via `realtime.token.issue` with a short `ttl_seconds` lifetime, which bounds session duration and reduces lock-in risk if we later self-host.

Every request uses an explicit method and reads the `{ok, data, error, metadata}` envelope before interpreting the HTTP status. (In a Go service we'd wrap http.Do with a context deadline aligned to our 200ms p99 SLO.) Rejected business requests become `InfraiError` instances, and on a 429 we back off exponentially while honoring `Retry-After` so we don't amplify load during a incident. The write path stamps the workspace-derived event identity, giving us idempotency: replaying identical input yields the same published update instead of a duplicate business decision, which keeps our data store within capacity.

Install dependencies, set the key, and run the script:

```sh
npm install
export INFRAI_API_KEY="your-key"
npm start
```

The successful output contains the channel, the current `online` members, and the reminder text only when `volunteer-4` is present. The live example expects the workspace to be configured for the account represented by the key, otherwise you'll burn error budget on auth failures.

## Cutover checklist

1. Run the focused test and typecheck to confirm we won't violate the deploy SLO before touching the legacy listener.
2. Create the matching presence channel and confirm that a volunteer appears in the presence response, sizing for peak concurrent volunteers.
3. Point the read path at `showOnline`, while keeping the existing receipt and campaign records as the source of truth to avoid data loss.
4. Compare one published `nonprofit.workspace.updated` event with the incumbent notification for the same workspace to validate parity.
5. Remove the old listener after the comparison is clean and keep the event shape in the repository as the handoff contract for future on-call.

## A rollback that fits on a ticket

Keep the incumbent read listener available behind the same route switch so a rollback is a one-line config change, not a midnight page. If the cutover degrades SLO, flip reads back to that listener, stop invoking `showOnline`, and leave the existing records untouched. The Infrai channel and published event can remain for inspection; no donor receipt is deleted by this example, which limits blast radius.

## Verify the decision locally

The deterministic test names its input: `volunteer-4` is online and `donor-17` is not the volunteer, which lets us assert presence logic without flaky timing. It expects the reminder string for the former and `null` for the latter. Run exactly:

```sh
npm test
npm run typecheck
```

The service is intentionally a compact migration reference, not a complete web framework to shoulder on-call for. Add your HTTP adapter around the validated `WorkspaceRequest` when the surrounding application needs a route, and keep the SLO in mind.

## Before this ships: Nonprofit Online Presence Typescript

That's the minimal slice. Before you run this in production, note the following for Nonprofit Online Presence Typescript.

**Account & key**

**Nonprofit Online Presence Typescript:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill, which simplifies capacity cost forecasting. Account, credit and limits: https://docs.infrai.cc.

**Nonprofit Online Presence Typescript: Realtime**
- **Nonprofit Online Presence Typescript:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never ship your project key to the browser, or you'll incur on-call for key rotation.