import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  type RiskRule,
  type TradeLesson,
  type SibylBridgeResult,
} from "./schema.js";
import { fileURLToPath } from "url";
import { configDotenv } from "dotenv";

configDotenv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pyPath = path.resolve(__dirname, "../../ghost-memory.py");

const execFileAsync = promisify(execFile);

// Every function below requires tenantId as its FIRST parameter.
// Pass the user's wallet_address from GhostUser.
// Each Telegram user's rules/lessons must stay isolated by their wallet address.

/**
 * Create a new risk rule.
 *
 * Note: ghost-memory.py uses (rule_type, applies_to) as the
 * unique identity of a rule. Storing the same combination again
 * will update the existing rule.
 */
export const storeRule = async (
  tenantId: string,
  rule: RiskRule,
) => {
  try {
    const { stdout } = await execFileAsync("python3", [
      pyPath,
      "store-rule",
      "--tenant_id",
      tenantId,
      "--rule_type",
      rule.rule_type,
      "--applies_to",
      rule.applies_to,
      "--threshold",
      rule.threshold.toString(),
      "--unit",
      rule.unit,
      "--notes",
      rule.notes ?? "",
    ]);

    return JSON.parse(stdout) as SibylBridgeResult<RiskRule>;
  } catch (error) {
    console.error("Error occurred while storing rule:", error);
    throw error;
  }
};

/**
 * Edit an existing risk rule.
 *
 * rule_type + applies_to identify which rule to edit.
 * Only threshold, unit and notes are updated.
 */
export const editRule = async (
  tenantId: string,
  rule: {
    rule_type: string;
    applies_to: string;
    threshold?: number;
    unit?: RiskRule["unit"];
    notes?: string;
  },
) => {
  try {
    const args = [
      pyPath,
      "edit-rule",
      "--tenant_id",
      tenantId,
      "--rule_type",
      rule.rule_type,
      "--applies_to",
      rule.applies_to,
    ];

    if (rule.threshold !== undefined) {
      args.push("--threshold", rule.threshold.toString());
    }

    if (rule.unit !== undefined) {
      args.push("--unit", rule.unit);
    }

    if (rule.notes !== undefined) {
      args.push("--notes", rule.notes);
    }

    const { stdout } = await execFileAsync("python3", args);

    return JSON.parse(stdout) as SibylBridgeResult<RiskRule>;
  } catch (error) {
    console.error("Error occurred while editing rule:", error);
    throw error;
  }
};

/**
 * Delete an existing risk rule.
 *
 * rule_type + applies_to identify the rule to delete.
 */
export const deleteRule = async (
  tenantId: string,
  rule: {
    rule_type: string;
    applies_to: string;
  },
) => {
  try {
    const { stdout } = await execFileAsync("python3", [
      pyPath,
      "delete-rule",
      "--tenant_id",
      tenantId,
      "--rule_type",
      rule.rule_type,
      "--applies_to",
      rule.applies_to,
    ]);

    return JSON.parse(stdout) as SibylBridgeResult<RiskRule>;
  } catch (error) {
    console.error("Error occurred while deleting rule:", error);
    throw error;
  }
};

export const listRules = async (
  tenantId: string,
  limit?: number,
) => {
  try {
    const args = [
      pyPath,
      "list-rules",
      "--tenant_id",
      tenantId,
    ];

    if (limit !== undefined) {
      args.push("--limit", limit.toString());
    }

    const { stdout } = await execFileAsync("python3", args);

    return JSON.parse(stdout) as SibylBridgeResult<RiskRule>;
  } catch (error) {
    console.error("Error occurred while listing rules:", error);
    throw error;
  }
};

 
export const storeLesson = async (tenantId: string, lesson: TradeLesson) => {
    try {
        const args = [
            pyPath, "store-lesson",
            "--tenant_id", tenantId,
            "--asset", lesson.asset,
            "--category_tags", lesson.category_tags.join(","),
            "--position_size_usd", lesson.position_size_usd.toString(),
            "--lesson", lesson.lesson,
        ];
 
        // outcome_pct is nullable now (open/pending lessons don't have
        // one yet) -- only pass the flag when there's a real value
        if (lesson.outcome_pct !== null) {
            args.push("--outcome_pct", lesson.outcome_pct.toString());
        }
 
        if (lesson.status) {
            args.push("--status", lesson.status);
        }
        if (lesson.coingecko_id) {
            args.push("--coingecko_id", lesson.coingecko_id);
        }
        if (lesson.entry_price_usd !== undefined) {
            args.push("--entry_price_usd", lesson.entry_price_usd.toString());
        }
        if (lesson.was_override) {
            args.push("--was_override"); // store_true flag on the Python side, no value needed
        }
        if (lesson.override_reason) {
            args.push("--override_reason", lesson.override_reason);
        }
 
        const { stdout } = await execFileAsync('python3', args);
        return JSON.parse(stdout) as SibylBridgeResult<TradeLesson>;
    } catch (error) {
        console.error("Error occurred while storing lesson:", error);
        throw error;
    }
}

export const listLessons = async (
  tenantId: string,
  limit?: number,
) => {
  try {
    const args = [
      pyPath,
      "list-lessons",
      "--tenant_id",
      tenantId,
    ];

    if (limit !== undefined) {
      args.push("--limit", limit.toString());
    }

    const { stdout } = await execFileAsync("python3", args);

    return JSON.parse(stdout) as SibylBridgeResult<TradeLesson>;
  } catch (error) {
    console.error("Error occurred while listing lessons:", error);
    throw error;
  }
};