import { listRules, listLessons } from "../memory/client.js";
import { type RiskRule, type TradeLesson } from "../memory/schema.js";

export interface ProposedTrade {
  asset: string;
  category_tags: string[];
  position_size_usd: number;
  portfolio_value_usd: number;
  current_category_exposure_usd: number;
}

export interface EvaluationResult {
  decision: "approve" | "block" | "modify";
  reason: string;
  triggered_by: (RiskRule | TradeLesson)[];
  suggested_size_usd?: number; // only present when decision is "modify"
}

// a lesson only counts as a meaningful warning if it lost at least this much
const BAD_OUTCOME_THRESHOLD_PCT = -30;

function tagsOverlap(a: string[], b: string[]): boolean {
  return a.some((tag) => b.includes(tag));
}

function ruleApplies(rule: RiskRule, trade: ProposedTrade): boolean {
  return rule.applies_to === "*" || trade.category_tags.includes(rule.applies_to);
}

export async function evaluate(tenantId: string, trade: ProposedTrade): Promise<EvaluationResult> {
  const [rulesResponse, lessonsResponse] = await Promise.all([
    listRules(tenantId),
    listLessons(tenantId),
  ]);

  const rules: RiskRule[] =
    rulesResponse.ok && rulesResponse.entities
      ? rulesResponse.entities.map((e) => e.body)
      : [];

  const lessons: TradeLesson[] =
    lessonsResponse.ok && lessonsResponse.entities
      ? lessonsResponse.entities.map((e) => e.body)
      : [];

  const triggeredBy: (RiskRule | TradeLesson)[] = [];
  const reasons: string[] = [];

  let hardBlock = false;
  // tracks the tightest allowed size across every rule that suggests a cap --
  // we take the MINIMUM of all suggested caps, since every rule must be satisfied
  let tightestAllowedSize: number | undefined = undefined;

  // --- check risk rules ---
  for (const rule of rules) {
    if (!ruleApplies(rule, trade)) continue;

    if (rule.rule_type === "avoid_category") {
      // hard rule -- no partial size makes this okay, it's a full block
      hardBlock = true;
      triggeredBy.push(rule);
      reasons.push(
        `This trade matches a category you've told Ghost to avoid (${rule.applies_to}). ${rule.notes}`.trim()
      );
      continue;
    }

    if (rule.rule_type === "max_exposure_pct" && rule.unit === "percent") {
      const newExposureUsd = trade.current_category_exposure_usd + trade.position_size_usd;
      const newExposurePct = (newExposureUsd / trade.portfolio_value_usd) * 100;

      if (newExposurePct > rule.threshold) {
        const maxAllowedTotalUsd = (rule.threshold / 100) * trade.portfolio_value_usd;
        const maxAdditionalUsd = maxAllowedTotalUsd - trade.current_category_exposure_usd;

        triggeredBy.push(rule);
        reasons.push(
          `This would take your ${rule.applies_to} exposure to ${newExposurePct.toFixed(
            1
          )}%, above your ${rule.threshold}% limit. ${rule.notes}`.trim()
        );

        if (maxAdditionalUsd <= 0) {
          // already at or over the limit before this trade -- no size fits
          hardBlock = true;
        } else {
          tightestAllowedSize =
            tightestAllowedSize === undefined
              ? maxAdditionalUsd
              : Math.min(tightestAllowedSize, maxAdditionalUsd);
        }
      }
    }

    if (rule.rule_type === "max_position_size" && rule.unit === "usd") {
      if (trade.position_size_usd > rule.threshold) {
        triggeredBy.push(rule);
        reasons.push(
          `This trade is above your max position size of $${rule.threshold}. ${rule.notes}`.trim()
        );
        tightestAllowedSize =
          tightestAllowedSize === undefined
            ? rule.threshold
            : Math.min(tightestAllowedSize, rule.threshold);
      }
    }

    // NOTE: cooldown_after_loss is not implemented yet -- it needs a
    // "time since last loss" check this function doesn't currently have
    // access to. Left out of the MVP; add later if there's time.
  }

  // --- check trade lessons (pattern match, not a hard limit) ---
  // NOTE: lessons with outcome_pct === null are still "open" (pending
  // resolution) -- they haven't happened yet as far as memory is
  // concerned, so they can't be cited as a past mistake. The type guard
  // below (`lesson is TradeLesson & { outcome_pct: number }`) tells
  // TypeScript outcome_pct is definitely a number from here on, not just
  // filtered at runtime.
  const matchingLessons = lessons.filter(
    (lesson): lesson is TradeLesson & { outcome_pct: number } =>
      lesson.outcome_pct !== null &&
      tagsOverlap(lesson.category_tags, trade.category_tags) &&
      lesson.outcome_pct <= BAD_OUTCOME_THRESHOLD_PCT
  );

  if (matchingLessons.length > 0 && !hardBlock) {
    for (const lesson of matchingLessons) {
      triggeredBy.push(lesson);
      reasons.push(
        `You lost ${Math.abs(lesson.outcome_pct)}% on ${lesson.asset}, a similar trade: "${lesson.lesson}"`
      );
    }
    // a lesson alone (no rule violation) doesn't hard-block -- it suggests
    // caution, so if nothing else already capped the size, suggest half
    if (tightestAllowedSize === undefined) {
      tightestAllowedSize = trade.position_size_usd / 2;
    }
  }

  // --- combine into a final decision ---
  if (hardBlock) {
    return {
      decision: "block",
      reason: reasons.join(" "),
      triggered_by: triggeredBy,
    };
  }

  if (tightestAllowedSize !== undefined && tightestAllowedSize < trade.position_size_usd) {
    return {
      decision: "modify",
      reason: reasons.join(" "),
      triggered_by: triggeredBy,
      suggested_size_usd: Math.round(tightestAllowedSize * 100) / 100,
    };
  }

  return {
    decision: "approve",
    reason: "No rules or past lessons were triggered by this trade.",
    triggered_by: [],
  };
}