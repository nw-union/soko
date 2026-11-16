// 実行環境 (Workers) の時計と乱数
import type { ClockPort, RandomPort } from "../domain/shared/port.ts";

export const systemClock: ClockPort = {
  now: () => new Date(),
};

export const cryptoRandom: RandomPort = {
  bytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  float: () => Math.random(),
};
