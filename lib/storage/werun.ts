import { KEYS } from "./keys";
import { readJSON, removeKey, writeJSON } from "./io";
import { WERUN_API_URL, WERUN_TOKEN_PATTERN } from "../werun";

export function loadWeRunToken(): string {
  const value = readJSON<unknown>(KEYS.werunConnection, null);
  if (!value || typeof value !== "object") return "";
  const { apiUrl, token } = value as Record<string, unknown>;
  // 更换服务端时绝不把旧凭证发给新地址。
  return apiUrl === WERUN_API_URL && typeof token === "string" && WERUN_TOKEN_PATTERN.test(token) ? token : "";
}

export function saveWeRunToken(token: string): void {
  if (!WERUN_TOKEN_PATTERN.test(token)) throw new Error("连接码格式不正确");
  writeJSON(KEYS.werunConnection, { apiUrl: WERUN_API_URL, token });
  if (loadWeRunToken() !== token) throw new Error("无法保存连接，请检查设备存储空间");
}

export function forgetWeRunToken(): void {
  removeKey(KEYS.werunConnection);
}
