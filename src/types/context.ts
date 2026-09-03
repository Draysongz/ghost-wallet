import { Context, Scenes } from "telegraf";

export interface SessionData extends Scenes.WizardSessionData {
  // Add global session fields here later.
}

export type GhostContext = Context & {
  session: Scenes.WizardSession<SessionData>;
  scene: Scenes.SceneContextScene<GhostContext, SessionData>;
  wizard: Scenes.WizardContextWizard<GhostContext>;
};