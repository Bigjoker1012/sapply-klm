import { matchAlias, addUnresolved, addAlias } from "./readSwitch";

export async function findRawMaterialBySynonym(synonym: string): Promise<string | null> {
  if (!synonym || !synonym.trim()) return null;
  return matchAlias(synonym);
}

export async function addToUnmatchedQueue(
  originalText: string,
  sourceType: string,
  fileName: string
): Promise<void> {
  await addUnresolved(originalText, sourceType, fileName, 0, "");
}

export async function addSynonymByUid(rawUid: string, synonym: string, source: string): Promise<void> {
  await addAlias(rawUid, synonym, source);
}
