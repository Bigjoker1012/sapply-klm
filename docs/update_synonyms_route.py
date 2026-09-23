import sys

# Read the file
with open('/opt/sapply-klm/server/src/routes/synonyms.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Update POST / route to pass userId
old_post = '''router.post("/", async (req: Request, res: Response) => {
  const { rawMaterialId, raw_uid, synonym, source } = req.body;
  try {
    const uid = raw_uid || rawMaterialId;
    await addAliasPG(uid, synonym, source || "manual");'''

new_post = '''router.post("/", async (req: Request, res: Response) => {
  const { rawMaterialId, raw_uid, synonym, source } = req.body;
  try {
    const uid = raw_uid || rawMaterialId;
    const userId = req.user?.id;
    await addAliasPG(uid, synonym, source || "manual", userId);'''

# Update POST /confirm route to pass userId
old_confirm = '''router.post("/confirm", async (req: Request, res: Response) => {
  const { queueId, rawMaterialId, raw_uid, synonym } = req.body;
  try {
    const uid = raw_uid || rawMaterialId;
    if (synonym) await addAliasPG(uid, synonym, "manual");'''

new_confirm = '''router.post("/confirm", async (req: Request, res: Response) => {
  const { queueId, rawMaterialId, raw_uid, synonym } = req.body;
  try {
    const uid = raw_uid || rawMaterialId;
    const userId = req.user?.id;
    if (synonym) await addAliasPG(uid, synonym, "manual", userId);'''

# Apply replacements
content = content.replace(old_post, new_post)
content = content.replace(old_confirm, new_confirm)

# Write back
with open('/opt/sapply-klm/server/src/routes/synonyms.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Updated synonyms routes to pass userId')
