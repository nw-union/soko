// 実行環境 (Workers) の時計と乱数
import type { ClockPort, RandomPort } from "../domain/port.ts";

export const systemClock: ClockPort = {
  now: () => new Date(),
};

export const cryptoRandom: RandomPort = {
  bytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
};
