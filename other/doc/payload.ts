type PlayerLog = {
  // also dictates if a thumbnail for a skill is shown instead of whatever is currently or not
  speaker: string;
  dialogue: string; // HTML result to be interpreted by App
  vitals?: { vitality?: "gain" | "loss"; morale?: "gain" | "loss" };
  skillCheck?: {
    // speaker is the skill
    difficulty:
      | "trivial"
      | "easy"
      | "medium"
      | "challenging"
      | "formidable"
      | "legendary"
      | "heroic"
      | "godly"
      | "impossible";
    result: "success" | "failure";
    diceRoll: { dice1: 1 | 2 | 3 | 4 | 5 | 6; dice2: 1 | 2 | 3 | 4 | 5 | 6 };
  };
  // can only exist for skill speaker, it displays as a list of options in the id="log" for a player which he can click and take a specific dialogue path
  // how can picking an option from here gracefully move to the correct playerlog and ignoring or moving away from the other playerlogs?
  options?: string[];
};

type Payload = {
  [key: string]: PlayerLog[];
};
