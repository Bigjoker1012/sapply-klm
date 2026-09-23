import { findRawByAlias, addToReviewQueue, addAlias } from "./sheetsService";

export async function findRawMaterialBySynonym(synonym: string): Promise<string | null> {
  if (!synonym || !synonym.trim()) return null;
  return findRawByAlias(synonym);
}

export async function addToUnmatchedQueue(
  originalText: string,
  sourceType: string,
  fileName: string
): Promise<void> {
  await addToReviewQueue(originalText, sourceType, fileName);
}

export async function addSynonymByUid(rawUid: string, synonym: string, source: string): Promise<void> {
  await addAlias(rawUid, synonym, source);
}
