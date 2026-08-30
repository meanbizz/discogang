// ==========================================
// Basic Primitives & Literals
// ==========================================

export type AttributeId = "intellect" | "psyche" | "physique" | "motorics";

export type SkillId =
  // Intellect
  | "logic"
  | "encyclopedia"
  | "rhetoric"
  | "drama"
  | "conceptualization"
  | "visual-calculus"
  // Psyche
  | "volition"
  | "inland-empire"
  | "empathy"
  | "authority"
  | "esprit-de-corps"
  | "suggestion"
  // Physique
  | "endurance"
  | "pain-threshold"
  | "physical-instrument"
  | "electrochemistry"
  | "shivers"
  | "half-light"
  // Motorics
  | "hand-eye-coordination"
  | "perception"
  | "reaction-speed"
  | "savoir-faire"
  | "interfacing"
  | "composure";

export type Difficulty =
  | "trivial" // 6+
  | "easy" // 8+
  | "medium" // 10+
  | "challenging" // 12+
  | "formidable" // 13+
  | "legendary" // 14+
  | "heroic" // 15+
  | "godly" // 16+
  | "impossible"; // 18+

export type SpeakerType =
  | "narrator" // Descriptive narrative (no portrait, italicized)
  | "skill" // Disco Elysium skill (auto-resolves built-in portrait)
  | "npc" // World character (uses provided portrait)
  | "entity" // Inanimate/surreal object (e.g., Horrific Necktie)
  | "player"; // Spoken or internal player reaction

export type D6 = 1 | 2 | 3 | 4 | 5 | 6;
export type CheckResult = "success" | "failure";
export type VitalChange = "gain" | "loss";

// ==========================================
// Dialogue Node Components
// ==========================================

export interface SkillCheckData {
  /** The skill being rolled, e.g. 'shivers', 'logic', 'hand-eye-coordination' */
  skill: SkillId | string;
  difficulty: Difficulty;
  result: CheckResult;
  diceRoll: {
    dice1: D6;
    dice2: D6;
  };
  /** Optional modifier added to the 2d6 result (stat + modifiers) */
  modifier?: number;
}

export interface VitalsEffect {
  vitality?: VitalChange;
  morale?: VitalChange;
}

export interface DialogueOption {
  id: string;
  /** Label shown to the player (e.g. '"Let\'s inspect the vehicle."') */
  label: string;
  /** Target DialogueNode ID, or null to terminate the dialogue */
  next: string | null;
}

// ==========================================
// Main Dialogue Node Structure
// ==========================================

export interface DialogueNode {
  id: string;
  /** Display name (e.g. "NARRATOR", "KIM KITSURAGI", "HALF LIGHT") */
  speaker: string;
  /** Classifies visual rendering and portrait behavior */
  speakerType?: SpeakerType;
  /** HTML/text body of the dialogue node */
  dialogue: string;

  /**
   * For linear sequences without player choices:
   * automatically renders this target Node ID immediately.
   */
  next?: string | null;

  /** Health/Morale modification triggered upon viewing this node */
  vitals?: VitalsEffect;

  /** Skill check result banner displayed at the top of the node */
  skillCheck?: SkillCheckData;

  /** Branching choices presented as clickable buttons */
  options?: DialogueOption[];
}

// ==========================================
// Trees & Master Payloads
// ==========================================

export interface PlayerDialogueTree {
  /** Entry-point Node ID for this player */
  root: string;
  /** Map of all available dialogue nodes keyed by their node ID */
  nodes: Record<string, DialogueNode>;
}

/**
 * Complete GM Ingestion Payload
 * Keyed by character name (e.g. "Detective Harrier") or PeerJS ID.
 */
export type TurnResolutionPayload = Record<string, PlayerDialogueTree>;
