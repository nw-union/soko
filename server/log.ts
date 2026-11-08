// 環境変数（LOG_ADAPTER・LOG_LEVEL）に合わせたロガー. 軽いので、使うところで毎回 log() を呼んでよい
import { env } from "void/env";
import { newLogger } from "./logger.ts";

export const log = () => newLogger(env.LOG_ADAPTER, env.LOG_LEVEL);
