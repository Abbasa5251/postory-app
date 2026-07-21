"use client";

import {
  useRealtime,
  type ClientSubscriptionToken,
  type UseRealtimeOptions,
  type UseRealtimeResult,
} from "inngest/react";
import type { Realtime } from "inngest/realtime";

/**
 * Shared realtime subscription for generation-job streams (C2 copy, C3 adapt,
 * and future D/F jobs). Wraps `useRealtime` with the config every job stream
 * needs, so each subscription site declares only its channel + topics:
 *
 *  - `pauseOnHidden: false` — keep the stream alive when the tab is backgrounded.
 *    The hook's default (`true`) tears the subscription down on tab-hide, and
 *    Inngest realtime does NOT replay missed messages, so a job that finishes
 *    while the user is looking elsewhere would never reach the UI.
 *  - the job's subscription token (a plain string minted server-side, scoped to
 *    that job's channel) wrapped in the token factory the hook expects.
 *
 * The channel/topics generics are threaded through so per-topic message typing
 * is preserved exactly as with a direct `useRealtime` call.
 */
export function useJobStream<
  TChannel extends Realtime.ChannelInput,
  TTopics extends readonly string[] | undefined,
>(
  options: Pick<UseRealtimeOptions<TChannel, TTopics>, "channel" | "topics"> & {
    /**
     * The per-job subscription token minted by the generate/adapt action
     * (`getClientSubscriptionToken`), scoped to that job's channel.
     */
    token: ClientSubscriptionToken;
  },
): UseRealtimeResult<TChannel, TTopics> {
  const { token, ...rest } = options;
  return useRealtime<TChannel, TTopics>({
    ...rest,
    token: () => Promise.resolve(token),
    pauseOnHidden: false,
  });
}
