import sys

# Read index.ts
with open('/opt/sapply-klm/server/src/index.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Add import
if 'diagnostRoutes' not in content:
    content = content.replace(
        'import expiryRoutes from "./routes/expiry";',
        'import expiryRoutes from "./routes/expiry";\nimport diagnostRoutes from "./routes/diagnost";'
    )

# Add route
if 'app.use("/api/diagnost"' not in content:
    content = content.replace(
        'app.use("/api/expiry", expiryRoutes);',
        'app.use("/api/expiry", expiryRoutes);\napp.use("/api/diagnost", diagnostRoutes);'
    )

# Write back
with open('/opt/sapply-klm/server/src/index.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Added diagnost route to index.ts')
