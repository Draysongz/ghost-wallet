import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { type RiskRule, type TradeLesson, type SibylBridgeResult, type SibylEntity  } from "./schema.js";
import { fileURLToPath } from "url";
import { configDotenv } from "dotenv";

configDotenv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const pyPath = path.resolve(__dirname, "../../ghost-memory.py");
const execFileAsync = promisify(execFile);

// Every function below requires tenantId as its FIRST parameter -- pass
// the user's wallet_address (from GhostUser in Mongo), never a static
// value. Each Telegram user's rules/lessons must stay isolated by their
// own wallet address.

export const storeRule = async (tenantId: string, rule: RiskRule) => {
    try {
        const { stdout } = await execFileAsync('python3', [pyPath, "store-rule", "--tenant_id", tenantId, "--rule_type", rule.rule_type, "--applies_to", rule.applies_to, "--threshold", rule.threshold.toString(), "--unit", rule.unit, "--notes", rule.notes ?? ""])
        return JSON.parse(stdout) as SibylBridgeResult<RiskRule>;
    } catch (error) {
        console.error("Error occurred while storing rule:", error);
        throw error;
    }
}

export const listRules = async (tenantId: string, limit?: number) => {
    try {
        const args = [pyPath, "list-rules", "--tenant_id", tenantId];
        if (limit !== undefined) {
            args.push("--limit", limit.toString());
        }
        const { stdout } = await execFileAsync("python3", args);
        return JSON.parse(stdout) as SibylBridgeResult<RiskRule>;
    } catch (error) {
        console.error("Error occurred while listing rules:", error);
        throw error;
    }
}

export const storeLesson = async (tenantId: string, lesson: TradeLesson) => {
    try {
        const { stdout } = await execFileAsync('python3', [pyPath, "store-lesson", "--tenant_id", tenantId, "--asset", lesson.asset, "--category_tags", lesson.category_tags.join(","), "--position_size_usd", lesson.position_size_usd.toString(), "--outcome_pct", lesson.outcome_pct.toString(), "--lesson", lesson.lesson])
        return JSON.parse(stdout) as SibylBridgeResult<TradeLesson>;
    } catch (error) {
        console.error("Error occurred while storing lesson:", error);
        throw error;
    }
}

export const listLessons = async (tenantId: string, limit?: number) => {
    try {
        const args = [pyPath, "list-lessons", "--tenant_id", tenantId];
        if (limit !== undefined) {
            args.push("--limit", limit.toString());
        }
        const { stdout } = await execFileAsync("python3", args);
        return JSON.parse(stdout) as SibylBridgeResult<TradeLesson>;
    } catch (error) {
        console.error("Error occurred while listing lessons:", error);
        throw error;
    }
}