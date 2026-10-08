// @ts-check
/**
 * Best-of length per round. Change values here, nothing else needs to move.
 */
export const FORMATS = {
  swissStage: 3,
  playoffs: { quarter: 5, semi: 5, final: 7 },
  gslGroup: { regular: 3, upperFinal: 5, qualifier: 3 },
  hybrid: {
    upperMatch: 5,
    lowerRound1: 3,
    lowerRound2: 3,
    lowerFinal: 5,
    grandFinal: 7,
  },
};