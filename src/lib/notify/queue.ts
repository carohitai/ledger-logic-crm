import { after } from "next/server";
import { createServiceClient, serviceConfigured } from "@/lib/supabase/service";
import { notifyClientChange, type ChangeNotice } from "./client-change";

/**
 * Sends a change notice after the current server action's response has been
 * delivered, so saving a client never waits on Teams / Graph round-trips.
 * Silently does nothing when the service key is absent (local dev).
 */
export function queueChangeNotice(notice: ChangeNotice): void {
  if (!serviceConfigured()) return;
  after(async () => {
    try {
      await notifyClientChange(createServiceClient(), notice);
    } catch (e) {
      console.error("[notify] client change fan-out failed", e);
    }
  });
}
