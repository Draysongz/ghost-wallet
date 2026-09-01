// Ghost Wallet stores two distinct kinds of memory in Sibyl, under two
// separate categories:
//
//   1. Risk rules  -- explicit limits the user has stated. Generic shape
//      so new rule types can be added later without touching this file.
//
//   2. Trade lessons -- records of what actually happened on a past trade,
//      tagged with comparable characteristics so a NEW proposed trade can
//      be matched against past mistakes (not just exact-asset matches).

// ---------------------------------------------------------------------
// Risk rules
// ---------------------------------------------------------------------

export type RuleType =
  | "max_exposure_pct"      // e.g. "never exceed 20% in a given category"
  | "avoid_category"        // e.g. "avoid low-liquidity meme tokens"
  | "max_position_size"     // e.g. "never put more than $X in one trade"
  | "cooldown_after_loss"   // e.g. "wait 24h before trading after a loss"
  | string;                 // escape hatch: allow new rule types without a schema change

export interface RiskRule {
  rule_type: RuleType;
  // what the rule applies to -- e.g. "speculative", "meme-tokens", "*"
  applies_to: string;
  // the actual limit. Meaning depends on rule_type:
  //   max_exposure_pct -> percentage (0-100)
  //   max_position_size -> dollar amount
  //   cooldown_after_loss -> hours
  //   avoid_category -> unused, leave as 0
  threshold: number;
  unit: "percent" | "usd" | "hours" | "none";
  // the user's own words for why this rule exists -- shown back to them
  // in the "Why?" explanation
  notes: string;
  created_at?: string; // set by the bridge script, not the caller
}

// ---------------------------------------------------------------------
// Trade lessons
// ---------------------------------------------------------------------

export interface TradeLesson {
  asset: string;               // token symbol/name
  // tags used to MATCH this lesson against a future proposed trade 
  // this is what makes recall generalize instead of only firing on the
  // exact same token again
  category_tags: string[];     // e.g. ["meme", "low-liquidity"]
  position_size_usd: number;
  outcome_pct: number;         // e.g. -68 for a 68% loss, positive for a win
  // the actual takeaway, in plain language -- this is what gets shown to
  // the user when a future trade triggers a block
  lesson: string;
  created_at?: string;
}

// ---------------------------------------------------------------------
// Sibyl entity wrapper + bridge result types
// (mirrors the shape returned by ghost_memory.py)
// ---------------------------------------------------------------------

export interface SibylEntity<T> {
  id: string;
  tenant_id: string;
  category: string;
  name: string;
  status: string | null;
  body: T;
  created_at: string;
  updated_at: string;
}

export interface SibylBridgeResult<T = RiskRule | TradeLesson> {
  ok: boolean;
  action: "store_rule" | "store_lesson" | "list_rules" | "list_lessons" | "evaluate";
  entity?: SibylEntity<T>;
  entities?: SibylEntity<T>[];
  error?: string;
}