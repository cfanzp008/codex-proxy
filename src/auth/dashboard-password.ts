import type { AppConfig } from "../config-schema.js";

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getDashboardPassword(config: AppConfig): string | null {
  return nonEmpty(config.server.dashboard_password) ?? nonEmpty(config.server.proxy_api_key);
}
