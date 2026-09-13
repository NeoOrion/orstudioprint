"use client";

import { useEffect } from "react";

import { getCurrentExperimentSession } from "@/lib/experiment/session";

export function ExperimentSessionBootstrap() {
  useEffect(() => {
    try {
      getCurrentExperimentSession();
    } catch {
      // Experiment initialization must never affect the public site.
    }
  }, []);

  return null;
}
