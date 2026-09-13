"use client";

import type { ReactNode } from "react";

import {
  buildInteractionEvent,
  getCurrentExperimentSession,
} from "@/lib/experiment/session";
import { sendExperimentEventBestEffort } from "@/lib/intake/api";
import type { Branch } from "@/lib/intake/types";

export function TrackedSimulationLink({
  branch,
  children,
}: {
  branch: Branch;
  children: ReactNode;
}) {
  function handleClick() {
    try {
      const session = getCurrentExperimentSession();
      sendExperimentEventBestEffort(buildInteractionEvent("quote_cta_clicked", session, branch));
    } catch {
      // The anchor remains fully functional when analytics is unavailable.
    }
  }

  return <a className="primary-link" href="#simulacao" onClick={handleClick}>{children}</a>;
}
