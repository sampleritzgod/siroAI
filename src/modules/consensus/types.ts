export type PanelModelInfo = {
  id: string;
  label: string;
  provider: string;
};

export type PanelAnswerSuccess = {
  modelId: string;
  label: string;
  provider: string;
  ok: true;
  answer: string;
};

export type PanelAnswerFailure = {
  modelId: string;
  label: string;
  provider: string;
  ok: false;
  error: string;
};

export type PanelAnswer = PanelAnswerSuccess | PanelAnswerFailure;

export type ConsensusResult = {
  prompt: string;
  panel: PanelAnswer[];
  evaluator: {
    modelId: string;
    label: string;
  };
  finalAnswer: string | null;
  error: string | null;
};

export const PANEL_TIMEOUT_MS = 45_000;
export const EVALUATOR_TIMEOUT_MS = 60_000;
